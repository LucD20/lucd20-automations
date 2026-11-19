import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { waitForDice } from "../../core/dice.js";
import { pf2eCard, wireOpen, sourceUuid, itemBySlug, compactCard, nameForPlayers } from "./card.js";
import { addImmunity, immunitiesOf, timeLeft } from "./immunity.js";

/**
 * Rule 21 (docs/pf2e-rules.md): Combat Assessment (Commander / Fighter feat 1, owner's AoN link).
 * "You make a telegraphed attack to learn about your foe": a melee Strike; if it hits, you can immediately
 * attempt a check to Recall Knowledge about the target, +2 circumstance on a critical hit. The target is then
 * temporarily immune to Combat Assessment for 1 day.
 *
 * - The action's card (slug `combat-assessment`) marks the creature; its next melee Strike within 2 minutes is
 *   the assessment (active GM's client, after Dice So Nice).
 * - A hit (v0.77.1, owner: "just roll the recall knowledge automatically"): PF2e Workbench's Recall Knowledge
 *   macro runs on the striker's own client (the user who rolled the Strike), with the striker's token
 *   selected and the target targeted; on a critical hit a short-lived effect gives +2 circumstance to skill
 *   checks while it rolls. Without Workbench (or that client not answering): a card to the striker's players
 *   and the GM with a button per skill that identifies the target (PF2e's `identificationDCs.skills`, else the
 *   usual identification skills); a click rolls that skill as a secret Recall Knowledge.
 * - The target becomes immune for a day (our tracker, no PF2e effect; rule 23 shows it on the Token HUD).
 *   A target already immune: the card says so, no buttons. A miss: no card, the immunity still starts.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.CombatAssessment.${key}`, data);
const SLUGS = ["combat-assessment"];
const NAME = /^combat assessment$/i;
const KIND = "combatAssessment";
const WINDOW_MS = 120000;
const FALLBACK_SKILLS = ["arcana", "crafting", "medicine", "nature", "occultism", "religion", "society"];
const RK_PACK = "xdy-pf2e-workbench.asymonous-benefactor-macros-internal";
const RK_MACRO = "XDY DO_NOT_IMPORT Recall_Knowledge";
const QUERY = `${MODULE_ID}.caRecall`;
const pending = new Map(); // actor id → time the action was used
const seen = new Set();

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);
const ownersOf = (actor) => (actor?.hasPlayerOwner ? game.users.filter((u) => !u.isGM && u.active && actor.testUserPermission?.(u, "OWNER")).map((u) => u.id) : []);
const slugOf = (item) => item?.slug ?? item?.system?.slug ?? "";
const isAssessment = (item) => SLUGS.includes(slugOf(item)) || NAME.test(item?.name ?? "");

/** The skills that identify this creature. */
export function identifySkills(actor) {
	const skills = actor?.identificationDCs?.skills;
	return Array.isArray(skills) && skills.length ? [...new Set(skills)] : FALLBACK_SKILLS;
}

const skillLabel = (actor, slug) => actor?.skills?.[slug]?.label ?? game.i18n?.localize?.(CONFIG.PF2E?.skills?.[slug]?.label ?? "") ?? slug;

/** Is this message a melee Strike (attack roll)? */
function meleeStrike(message) {
	const context = message?.flags?.pf2e?.context;
	if (context?.type !== "attack-roll" || context.isReroll) return false;
	const options = context.options ?? [];
	if (options.includes("ranged") || options.includes("item:ranged")) return false;
	return message.item?.isMelee !== false;
}

/** Active GM's client: the action card arms it; the next melee Strike is the assessment. */
export async function onMessage(message) {
	if (!game.user.isActiveGM) return;
	const actor = message?.actor;
	if (!actor) return;
	if (isAssessment(message.item) && !message.flags?.pf2e?.context) return void pending.set(actor.id, Date.now());
	if (!meleeStrike(message) || seen.has(message.id)) return;
	const armed = pending.get(actor.id);
	if (!armed || Date.now() - armed > WINDOW_MS) return;
	pending.delete(actor.id);
	seen.add(message.id);
	const context = message.flags.pf2e.context;
	const target = context.target?.token ? fromUuidSync(context.target.token) : null;
	if (!target?.actor) return;
	await waitForDice(message.id);
	const striker = message.token ?? actor.getActiveTokens?.()?.[0]?.document ?? null;
	const immune = immunitiesOf(target.actor, { kind: KIND });
	if (!immune.length) await addImmunity(target.actor, { kind: KIND, by: actor.uuid, name: striker?.name ?? actor.name });
	const hit = ["success", "criticalSuccess"].includes(context.outcome);
	if (!hit && !immune.length) return;
	const item = itemBySlug(actor, SLUGS, NAME);
	const whom = nameForPlayers(target, L("ACreature"));
	const critical = context.outcome === "criticalSuccess";
	// v0.77.1: roll it at once with Workbench's macro, on the striker's client.
	if (!immune.length && await askRecall(message, { striker: striker?.uuid ?? null, target: target.uuid, critical, label: item?.name ?? L("Title"), img: item?.img ?? null })) return;
	const body = immune.length
		? `<p>${L("Immune", { name: Handlebars.escapeExpression(whom), left: timeLeft(immune[0]) })}</p>`
		: `<p>${L("Recall", { name: Handlebars.escapeExpression(whom) })}${critical ? ` <span class="lucd20-card-note">${L("Critical")}</span>` : ""}</p>`;
	const buttons = immune.length ? [] : identifySkills(target.actor).map((slug) => ({ data: "lucd20-ca", value: slug, label: skillLabel(actor, slug) }));
	await ChatMessage.create({
		content: pf2eCard({ img: item?.img, title: item?.name ?? L("Title"), glyph: "1", who: striker?.name ?? actor.name, open: sourceUuid(item), body, buttons, extraClass: "lucd20-ca-card" }),
		speaker: { alias: striker?.name ?? actor.name },
		whisper: [...new Set([...ownersOf(actor), ...gmIds()])],
		flags: { [MODULE_ID]: { combatAssessment: { striker: actor.uuid, target: target.uuid, critical, img: item?.img ?? null, title: item?.name ?? L("Title"), open: sourceUuid(item), done: !buttons.length } } }
	});
}

/** GM: ask the client of whoever rolled the Strike to run Recall Knowledge. True if it ran. */
async function askRecall(message, payload) {
	const author = message.author ?? game.users.get(message.user?.id ?? message.user);
	if (!payload.striker || !author?.active) return false;
	if (author.id === game.user.id) return runRecall(payload);
	try {
		return !!(await author.query(QUERY, payload, { timeout: 30_000 }));
	} catch (err) {
		return false;
	}
}

/** Workbench's macro, or null when it isn't installed. */
async function recallMacro() {
	const pack = game.packs?.get(RK_PACK);
	if (!pack) return null;
	let macro = (await pack.getDocuments({ name: RK_MACRO }))?.[0] ?? null;
	if (macro && !macro.canExecute) {
		macro = new macro.constructor(foundry.utils.mergeObject(macro.toObject(), { "-=_id": null, "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }, { performDeletions: true, inplace: true }));
	}
	return macro;
}

/** The striker's client: select the striker, target the foe, run the macro (+2 circumstance on a critical hit). */
export async function runRecall({ striker, target, critical, label, img }) {
	const macro = await recallMacro();
	const sDoc = striker ? fromUuidSync(striker) : null, tDoc = target ? fromUuidSync(target) : null;
	if (!macro || !sDoc?.object || !tDoc?.object || !sDoc.actor?.isOwner) return false;
	sDoc.object.control?.({ releaseOthers: true });
	tDoc.object.setTarget?.(true, { releaseOthers: true, groupSelection: false });
	let bonus = null;
	if (critical) {
		[bonus] = await sDoc.actor.createEmbeddedDocuments("Item", [{
			type: "effect", name: L("CriticalEffect", { name: label }), img: img ?? "icons/svg/book.svg",
			system: { rules: [{ key: "FlatModifier", selector: "skill-check", type: "circumstance", value: 2, label }], duration: { value: -1, unit: "unlimited", expiry: null, sustained: false }, tokenIcon: { show: false } }
		}]) ?? [];
	}
	try {
		const posted = bonus ? nextMessage(15000) : null;
		await macro.execute();
		await posted;
	} finally {
		if (bonus) await bonus.delete().catch(() => {});
	}
	return true;
}

/** Resolves when this user's next chat message is created (the macro's rolls), or after `ms`. */
function nextMessage(ms) {
	return new Promise((resolve) => {
		const id = Hooks.on("createChatMessage", (m) => {
			if ((m.author?.id ?? m.user?.id) !== game.user.id) return;
			Hooks.off("createChatMessage", id);
			clearTimeout(timer);
			setTimeout(resolve, 500);
		});
		const timer = setTimeout(() => { Hooks.off("createChatMessage", id); resolve(); }, ms);
	});
}

/** The striker's client: roll the chosen skill as a secret Recall Knowledge (no Workbench). */
async function onClick(card, button) {
	const data = card.getFlag(MODULE_ID, "combatAssessment");
	const actor = data ? fromUuidSync(data.striker) : null;
	const target = data ? fromUuidSync(data.target) : null;
	if (!actor || data.done) return;
	if (!(game.user.isGM || actor.isOwner)) return ui.notifications.warn(L("NotYours"));
	const ok = await executeAsGM("pf2eCA.claim", { card: card.id });
	if (!ok) return;
	const skill = actor.skills?.[button.dataset.lucd20Ca];
	if (!skill?.roll) return ui.notifications.warn(L("NoSkill"));
	const Modifier = game.pf2e?.Modifier;
	const modifiers = data.critical && Modifier ? [new Modifier({ slug: "combat-assessment", label: data.title, modifier: 2, type: "circumstance" })] : [];
	const dc = target?.actor?.identificationDCs?.standard?.dc;
	await skill.roll({
		label: L("RollLabel", { skill: skill.label ?? button.textContent.trim() }),
		dc: dc ? { value: dc } : undefined,
		modifiers,
		rollMode: "blindroll",
		traits: ["secret"],
		extraRollOptions: ["action:recall-knowledge", "secret", "combat-assessment"]
	});
}

/** GM's client: once per card; it then shows only the feat's name. */
async function claim({ card }) {
	const m = game.messages.get(card);
	const data = m?.getFlag(MODULE_ID, "combatAssessment");
	if (!data || data.done) return false;
	await m.update({
		content: compactCard({ img: data.img, title: data.title, glyph: "1", open: data.open, extraClass: "lucd20-ca-card" }),
		[`flags.${MODULE_ID}.combatAssessment.done`]: true
	});
	return true;
}

defineFeature({
	id: "pf2eCombatAssessment",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,

	init(feature) {
		onGMRequest("pf2eCA.claim", (payload) => (feature.active ? claim(payload) : false));
		if (CONFIG.queries) CONFIG.queries[QUERY] = (payload) => (feature.active ? runRecall(payload).catch((err) => { error("Combat Assessment: Recall Knowledge failed.", err); return false; }) : false);
	},

	enable(feature) {
		feature.on("createChatMessage", (message) => { onMessage(message).catch((err) => error("Combat Assessment failed.", err)); });
		feature.on("renderChatMessageHTML", (message, html) => {
			const data = message.getFlag?.(MODULE_ID, "combatAssessment");
			if (!data) return;
			wireOpen(html);
			for (const button of html.querySelectorAll?.("[data-lucd20-ca]") ?? []) {
				if (data.done) { button.disabled = true; continue; }
				button.addEventListener("click", (event) => {
					event.preventDefault();
					button.disabled = true;
					if (feature.active) onClick(message, button).catch((err) => error("Combat Assessment failed.", err));
				});
			}
		});
		feature.onCleanup(() => pending.clear());
	}
});

export const _test = { onMessage, onClick, claim, pending, seen, identifySkills, runRecall };
