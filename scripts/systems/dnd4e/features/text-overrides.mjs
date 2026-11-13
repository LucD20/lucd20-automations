import { MODULE_ID } from "../constants.mjs";
import { setting } from "../utils.mjs";

/*
 * Text overrides for actors: the world can store replacement text (names, descriptions,
 * biography, alignment) for monsters, keyed by their original name. The module ships no text
 * of its own; it only applies what the world's GM stored with game.settings.
 *
 * Shape of the "textOverrides" setting:
 *   { "<original actor name>": { name, alignment?, biography?, items: { <identifier>: { name?, subName?, description?, chat? } } } }
 *
 * Only text is touched. Numbers, dice, defences and formulas always come from the original actor.
 */

const SETTING = "textOverrides";

export function registerTextOverrideHooks() {
	game.settings.register(MODULE_ID, SETTING, { scope: "world", config: false, type: Object, default: {} });
	// The import / export window opens from the "Monster texts" card in LucD20 Automations.
	Hooks.on("preCreateActor", onPreCreateActor);
}

function overrides() {
	try { return game.settings.get(MODULE_ID, SETTING) ?? {}; } catch { return {}; }
}

/* The override for an actor, by its original name (kept in a flag once translated). */
export function overrideFor(actorData, table = overrides()) {
	const original = actorData?.flags?.[MODULE_ID]?.translatedFrom ?? actorData?.name;
	return original && table[original] ? { original, spec: table[original] } : null;
}

/* Replaces the leading original name in a token name ("Gray Wolf 2" → "Lobo Cinzento 2"). */
export function renameToken(tokenName, original, translated) {
	if (!tokenName) return translated;
	return tokenName.startsWith(original) ? translated + tokenName.slice(original.length) : tokenName;
}

/* Changes for the actor itself (not its items). */
export function actorChanges(actorData, original, spec) {
	const changes = { [`flags.${MODULE_ID}.translatedFrom`]: original };
	if (spec.name) changes.name = spec.name;
	if (spec.alignment) changes["system.details.alignment"] = spec.alignment;
	if (spec.biography) changes["system.biography"] = spec.biography;
	if (spec.name && actorData?.prototypeToken) changes["prototypeToken.name"] = renameToken(actorData.prototypeToken.name, original, spec.name);
	return changes;
}

/* Changes for one item, or null when the override has nothing for it. */
export function itemChanges(itemData, spec) {
	const t = spec.items?.[itemData?.system?.identifier];
	if (!t) return null;
	const changes = {};
	if (t.name) changes.name = t.name;
	if (t.subName !== undefined) changes["system.subName"] = t.subName;
	if (t.description !== undefined) changes["system.description.value"] = t.description;
	if (t.chat !== undefined) changes["system.description.chat"] = t.chat;
	return changes;
}

function onPreCreateActor(actor, data) {
	if (!setting("textOverrides")) return;
	const found = overrideFor(data);
	if (!found) return;
	const { original, spec } = found;
	const items = (data.items ?? []).map((i) => {
		const c = itemChanges(i, spec);
		return c ? foundry.utils.mergeObject(foundry.utils.deepClone(i), c) : i;
	});
	actor.updateSource({ ...actorChanges(data, original, spec), items });
}

async function translateActor(actor, table) {
	const found = overrideFor(actor.toObject(), table);
	if (!found) return false;
	const { original, spec } = found;
	await actor.update(actorChanges(actor.toObject(), original, spec));
	const updates = actor.items.map((i) => {
		const c = itemChanges(i.toObject(), spec);
		return c ? { _id: i.id, ...c } : null;
	}).filter(Boolean);
	if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
	return true;
}

/*
 * Applies the stored overrides to what already exists: world actors and the unlinked tokens of
 * every scene. New actors (dragged from a compendium) are translated on creation.
 * Returns how many actors and tokens were changed.
 */
export async function translateExisting() {
	if (!game.user.isGM) return { actors: 0, tokens: 0 };
	const table = overrides();
	let actors = 0, tokens = 0;
	for (const actor of game.actors) if (await translateActor(actor, table)) actors++;
	for (const scene of game.scenes) {
		for (const token of scene.tokens) {
			const base = token.baseActor;
			const found = overrideFor(token.actor?.toObject() ?? base?.toObject(), table)
				?? overrideFor(base?.toObject(), table);
			if (!found) continue;
			const name = renameToken(token.name, found.original, found.spec.name ?? found.original);
			if (name !== token.name) await token.update({ name });
			if (!token.actorLink && token.actor) await translateActor(token.actor, table);
			tokens++;
		}
	}
	return { actors, tokens };
}

/* -------------------------------------------- */
/*  Import / export (settings menu)             */
/* -------------------------------------------- */

const FORMAT = "d4ea-text-overrides";

/* Accepts the exported file ({format, actors}) or a bare table. */
export function parseOverrideFile(json) {
	const data = typeof json === "string" ? JSON.parse(json) : json;
	const table = data?.format === FORMAT ? data.actors : data;
	if (!table || typeof table !== "object" || Array.isArray(table)) throw new Error("invalid file");
	for (const [k, v] of Object.entries(table)) {
		if (!v || typeof v !== "object" || (v.items && typeof v.items !== "object")) throw new Error(`invalid entry: ${k}`);
	}
	return table;
}

/* Merges a table into the stored overrides (same original name = replaced) and updates what exists. */
export async function importOverrides(table) {
	await game.settings.set(MODULE_ID, SETTING, { ...overrides(), ...table });
	return translateExisting();
}

export function exportOverrides() {
	return { format: FORMAT, version: 1, actors: overrides() };
}

export async function openOverridesDialog() {
	const { DialogV2 } = foundry.applications.api;
	const count = Object.keys(overrides()).length;
	const L = (k) => game.i18n.localize(`DND4EAUTO.TextOverrides.${k}`);
	const choice = await DialogV2.wait({
		window: { title: L("Title") },
		content: `<p>${game.i18n.format("DND4EAUTO.TextOverrides.Stored", { count })}</p>
			<p>${L("Hint")}</p>
			<div class="form-group"><input type="file" name="file" accept=".json,application/json"></div>`,
		buttons: [
			{ action: "import", label: L("Import"), icon: "fa-solid fa-file-import", default: true,
				callback: async (event, button) => (await button.form.elements.file.files?.[0]?.text()) ?? "" },
			{ action: "export", label: L("Export"), icon: "fa-solid fa-file-export", callback: () => "export" },
		],
		rejectClose: false,
	}).catch(() => null);
	if (choice === "export") {
		const save = foundry.utils.saveDataToFile ?? globalThis.saveDataToFile;
		save(JSON.stringify(exportOverrides(), null, "\t"), "application/json", "traducoes-monstros.json");
		return;
	}
	if (typeof choice !== "string") return;
	if (!choice) { ui.notifications.warn(L("NoFile")); return; }
	try {
		const table = parseOverrideFile(choice);
		const { actors, tokens } = await importOverrides(table);
		ui.notifications.info(game.i18n.format("DND4EAUTO.TextOverrides.Imported", { count: Object.keys(table).length, actors, tokens }));
	} catch (err) {
		console.warn(`${MODULE_ID} | text overrides import`, err);
		ui.notifications.error(L("Invalid"));
	}
}

/* Settings menus need a class; this one only opens the dialog. */
export function overridesMenuClass() {
	return class TextOverridesMenu extends foundry.applications.api.ApplicationV2 {
		render() { openOverridesDialog(); return this; }
	};
}
