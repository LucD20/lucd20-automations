import { MODULE_ID, KIND } from "../constants.mjs";
import { F, L, matches, abilityMod, tierDice, setting, log, tokenForActor, footprint } from "../utils.mjs";
import { buildEffect, createEffects, deleteEffects, effectsOfKind } from "../effects.mjs";
import { rollDamageCard } from "../damage-apply.mjs";

/*
 * Conditional damage and roll riders:
 *   Infernal Wrath   (errata) the triggering enemy takes 1d6 + Int or Cha mod fire damage (2d6/3d6 at 11/21)
 *   Dire Radiance    on hit, the first time the target moves closer to you on its next turn it takes
 *                    1d6 + Con (or Cha) damage (2d6 at 21st)
 *   Elven Accuracy   using it offers to roll your last attack again against the same targets
 *   Fox's Cunning    the next basic attack gets a power bonus equal to your Wisdom modifier
 *   Fate of the Void the warlock's +N goes on the next attack roll during their turn (toggle in the dialog)
 */

const INFERNAL_WRATH = { ids: ["tiefling-power-infernal-wrath", "infernal-wrath"], names: /infernal wrath|c[óo]lera infernal/i };
const DIRE_RADIANCE = { ids: ["warlock-01-dire-radiance", "radiancia-atroz"], names: /dire radiance|radi[âa]ncia atroz/i };
const ELVEN_ACCURACY = { ids: ["elf-power-elven-accuracy", "precisao-elfica", "elven-accuracy"], names: /elven accuracy|precis[ãa]o [ée]lfica/i };
const FOXS_CUNNING = { ids: ["ranger-01-foxs-cunning"], names: /fox'?s cunning|ast[úu]cia da raposa/i };

const lastAttacks = new Map(); // actor uuid -> { itemUuid, targets: [token uuid], time }
const foxPending = new Map(); // actor uuid -> { bonus, time }
const toConsume = new Set(); // modifier keys applied in the current attack roll
const pendingMods = new Map(); // actor uuid -> [{ key, label, value, type, time }]: one-shot bonuses for the next attack

/** A one-shot bonus for the actor's next attack roll (e.g. Blunder's +2 on the follow-up basic attack). */
export function addPendingAttackMod(actor, mod) {
	const list = (pendingMods.get(actor.uuid) ?? []).filter((m) => m.key !== mod.key);
	list.push({ ...mod, time: Date.now() });
	pendingMods.set(actor.uuid, list);
}

/* -------------------------------------------- */
/*  Power use                                     */
/* -------------------------------------------- */

export async function onUsePower(item, actor) {
	if (!setting("conditionalRiders")) return false;
	if (matches(item, INFERNAL_WRATH)) {
		const n = tierDice(actor);
		const mod = Math.max(abilityMod(actor, "int"), abilityMod(actor, "cha"));
		await rollDamageCard({ actor, formula: `${n}d6 + ${mod}`, type: "fire", flavor: item.name, targets: Array.from(game.user.targets) });
		return true;
	}
	if (matches(item, ELVEN_ACCURACY)) {
		await offerReroll(actor);
		return true;
	}
	if (matches(item, FOXS_CUNNING)) {
		const bonus = Math.max(0, abilityMod(actor, "wis"));
		foxPending.set(actor.uuid, { bonus, time: Date.now(), label: item.name });
		ui.notifications.info(F("Conditional.FoxArmed", { name: actor.name, bonus }));
		return true;
	}
	return false;
}

/* -------------------------------------------- */
/*  Attack roll modifiers                         */
/* -------------------------------------------- */

/** Extra attack modifiers (merged into on-hit.attackModifiers). */
export function conditionalModifiers(item, attacker) {
	const mods = [];
	if (!setting("conditionalRiders") || !attacker?.actor) return mods;
	const actor = attacker.actor;
	const fox = foxPending.get(actor.uuid);
	if (fox && Date.now() - fox.time < 5 * 60 * 1000 && item?.system?.attack?.isBasic && fox.bonus) {
		mods.push({ key: "foxsCunning", label: fox.label, value: fox.bonus, type: "power", consume: () => foxPending.delete(actor.uuid) });
	}
	for (const m of pendingMods.get(actor.uuid) ?? []) {
		if (Date.now() - m.time > 5 * 60 * 1000) continue;
		mods.push({ key: `pending-${m.key}`, label: m.label, value: m.value, type: m.type, consume: () => {
			pendingMods.set(actor.uuid, (pendingMods.get(actor.uuid) ?? []).filter((x) => x !== m));
		} });
	}
	const fate = effectsOfKind(actor, KIND.FATE_OF_THE_VOID)[0];
	const stacks = fate?.flags?.[MODULE_ID]?.stacks;
	// The effect is named "Fate of the Void (+2)": the chip shows the value itself
	const fateLabel = (fate?.name ?? "").replace(/\s*\(\s*[+−-]?\d+\s*\)\s*$/, "");
	if (stacks) mods.push({ key: `fate-${fate.id}`, label: fateLabel, value: stacks, consume: () => deleteEffects(actor, [fate.id]) });
	return mods;
}

export function markApplied(mods) {
	for (const m of mods) if (m.consume) toConsume.add(m);
}

/** After the attack: use up one-shot bonuses and remember the attack for Elven Accuracy. */
export async function onAttackRolled(itemData, targetData, actor) {
	for (const m of toConsume) await m.consume(targetData);
	toConsume.clear();
	if (!actor) return;
	lastAttacks.set(actor.uuid, {
		itemUuid: itemData?.uuid,
		targets: (targetData?.targets ?? []).map((t) => t.document?.uuid).filter(Boolean),
		time: Date.now(),
	});
	await applyDireRadiance(itemData, targetData, actor);
}

/* -------------------------------------------- */
/*  Elven Accuracy                                */
/* -------------------------------------------- */

/** Elven Accuracy: target the same creatures again and reroll the last attack ("use the second roll"). */
async function offerReroll(actor) {
	const last = lastAttacks.get(actor.uuid);
	if (!last?.itemUuid || Date.now() - last.time > 10 * 60 * 1000) {
		ui.notifications.warn(F("Conditional.NoLastAttack", { name: actor.name }));
		return;
	}
	const item = fromUuidSync(last.itemUuid);
	if (!item?.rollAttack) return;
	const tokens = last.targets.map((u) => fromUuidSync(u)?.object).filter(Boolean);
	if (tokens.length) {
		tokens[0].setTarget(true, { releaseOthers: true });
		for (const t of tokens.slice(1)) t.setTarget(true, { releaseOthers: false });
	}
	ui.notifications.info(F("Conditional.Rerolling", { power: item.name }));
	await item.rollAttack({});
}

/* -------------------------------------------- */
/*  Dire Radiance                                 */
/* -------------------------------------------- */

async function applyDireRadiance(itemData, targetData, actor) {
	if (!setting("conditionalRiders") || !matches(itemData, DIRE_RADIANCE)) return;
	const hit = targetData?.targetHit ?? [];
	if (!hit.length) return;
	const item = itemData?.uuid ? fromUuidSync(itemData.uuid) : null;
	const ability = item?.system?.attack?.ability || "con";
	const level = Number(actor.system.details?.level) || 1;
	const formula = `${level >= 21 ? 2 : 1}d6 + ${Math.max(0, abilityMod(actor, ability))}`;
	for (const target of hit) {
		if (!target.actor) continue;
		const effect = buildEffect({
			kind: "direRadiance",
			name: F("Conditional.DireName", { power: item?.name ?? "Dire Radiance", formula }),
			img: item?.img ?? "icons/svg/sun.svg",
			source: actor,
			durationType: "endOfTargetTurn",
			description: F("Conditional.DireDesc", { source: actor.name, formula }),
			extraFlags: { formula, power: item?.name ?? "" },
		});
		await createEffects(target.actor, [effect]);
	}
}

function distanceAt(x, y, w, h, other) {
	const size = canvas.grid.size;
	const ax0 = Math.round(x / size), ay0 = Math.round(y / size);
	const a = { x0: ax0, y0: ay0, x1: ax0 + Math.max(1, Math.round(w)) - 1, y1: ay0 + Math.max(1, Math.round(h)) - 1 };
	const b = footprint(other);
	const dx = Math.max(0, b.x0 - a.x1, a.x0 - b.x1);
	const dy = Math.max(0, b.y0 - a.y1, a.y0 - b.y1);
	return Math.max(dx, dy);
}

/** moveToken (active GM): a creature under Dire Radiance moved closer to the warlock on its own turn. */
export async function onMoveToken(tokenDoc, movement) {
	if (!setting("conditionalRiders") || !game.users.activeGM?.isSelf) return;
	const actor = tokenDoc.actor;
	const effects = effectsOfKind(actor, "direRadiance");
	if (!effects.length) return;
	// "on its next turn": the effect lasts until the end of the target's turn; skip only moves made
	// during the warlock's own turn (e.g. forced movement from their powers)
	const current = game.combat?.started ? game.combat.combatant : null;
	const origin = movement?.origin;
	const dest = movement?.destination ?? tokenDoc;
	if (!origin) return log("dire radiance: movement without origin", tokenDoc.name);
	for (const effect of effects) {
		const flags = effect.flags[MODULE_ID];
		const warlock = fromUuidSync(flags.source);
		const warlockToken = tokenForActor(warlock);
		if (!warlockToken) { log("dire radiance: warlock token not on the scene"); continue; }
		if (current && current.actor === warlock) { log("dire radiance: moved during the warlock's turn"); continue; }
		const before = distanceAt(origin.x, origin.y, tokenDoc.width, tokenDoc.height, warlockToken);
		const after = distanceAt(dest.x ?? tokenDoc.x, dest.y ?? tokenDoc.y, tokenDoc.width, tokenDoc.height, warlockToken);
		log("dire radiance: distance", tokenDoc.name, before, "->", after);
		if (after >= before) continue;
		await deleteEffects(actor, [effect.id]); // only the first time
		await rollDamageCard({ actor: warlock, formula: flags.formula, type: "radiant", flavor: F("Conditional.DireFlavor", { power: flags.power, target: tokenDoc.name }), targets: [tokenDoc.object] });
		log("dire radiance triggered", tokenDoc.name, before, "->", after);
	}
}

export function registerConditionalHooks() {
	Hooks.on("moveToken", (doc, movement) => {
		onMoveToken(doc, movement).catch((e) => console.error(`${MODULE_ID} | dire radiance`, e));
	});
}
