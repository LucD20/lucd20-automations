import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { waitForDice } from "../../core/dice.js";
import { pf2eCard, wireOpen, sourceUuid, itemBySlug, compactCard, nameForPlayers } from "./card.js";
import { addImmunity, immunitiesOf, timeLeft } from "./immunity.js";
import { recallKnowledge } from "./recall-knowledge.js";
import { registerStrikeOption } from "./strike-options.js";
import { sysId, sysApi, sysConfig } from "./sys.js";

/**
 * Rule 21 (docs/pf2e-rules.md): Combat Assessment (Commander / Fighter feat 1, owner's AoN link).
 * "You make a telegraphed attack to learn about your foe": a melee Strike; if it hits, you can immediately
 * attempt a check to Recall Knowledge about the target, +2 circumstance on a critical hit. The target is then
 * temporarily immune to Combat Assessment for 1 day.
 *
 * - The action's card (slug `combat-assessment`) marks the creature; its next melee Strike within 2 minutes is
 *   the assessment (active GM's client, after Dice So Nice).
 * - A hit (owner: "just roll the recall knowledge automatically"): our Recall Knowledge (recall-knowledge.js,
 *   v0.78.0, replacing PF2e Workbench's macro) runs at once on the GM's client against the target, +2 on a
 *   critical hit; the result goes to the GMs only. If that fails (the target not on the scene): a card to
 *   the striker's players and the GM with a button per identifying skill, a click rolls it secretly.
 * - The target becomes immune for a day (our tracker, no PF2e effect; rule 23 shows it on the Token HUD).
 *   A target already immune: the card says so, no buttons. A miss: no card, the immunity still starts.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.CombatAssessment.${key}`, data);
const SLUGS = ["combat-assessment"];
const NAME = /^combat assessment$/i;
const KIND = "combatAssessment";
const WINDOW_MS = 120000;
const FALLBACK_SKILLS = ["arcana", "crafting", "medicine", "nature", "occultism", "religion", "society"];
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

const skillLabel = (actor, slug) => actor?.skills?.[slug]?.label ?? game.i18n?.localize?.(sysConfig()?.skills?.[slug]?.label ?? "") ?? slug;

/** Is this message a melee Strike (attack roll)? */
function meleeStrike(message) {
	const context = message?.flags?.[sysId()]?.context;
	if (context?.type !== "attack-roll" || context.isReroll) return false;
	const options = context.options ?? [];
	if (options.includes("ranged") || options.includes("item:ranged")) return false;
	return message.item?.isMelee !== false;
}

/**
 * v0.87.8 (owner: "Click to attack, on the roll dialog it shows a 'Combat Assessment' toggle, where you can
 * click on the name to open the feat"): melee Strikes of a creature with the feat get an entry in PF2e's roll
 * window (v0.88.1: in the shared "Feats for this Strike" section); on, the roll carries the option
 * `lucd20-combat-assessment` and that Strike is the assessment. The name opens the feat. A target already
 * immune: the entry says so (no checkbox).
 */
export const TAG = "lucd20-combat-assessment";
/** v0.88.1: an entry of "Feats for this Strike" (strike-options.js, the owner's mockup C). */
let featureOn = () => false;
registerStrikeOption({
	id: "combatAssessment",
	tag: TAG,
	active: () => featureOn(),
	item: (actor) => itemBySlug(actor, SLUGS, NAME),
	applies: (context, item, strike) => strike.melee,
	blocked: (context) => {
		const target = context.target?.actor ?? context.target?.token?.actor ?? null;
		const immune = target ? immunitiesOf(target, { kind: KIND }) : [];
		return immune.length ? L("ImmuneShort", { left: timeLeft(immune[0]) }) : null;
	}
});

/** Active GM's client: the action card arms it (or the roll window's toggle); the next melee Strike is the assessment. */
export async function onMessage(message) {
	if (!game.user.isActiveGM) return;
	const actor = message?.actor;
	if (!actor) return;
	if (isAssessment(message.item) && !message.flags?.[sysId()]?.context) return void pending.set(actor.id, Date.now());
	if (!meleeStrike(message) || seen.has(message.id)) return;
	const tagged = (message.flags?.[sysId()]?.context?.options ?? []).includes(TAG);
	const armed = pending.get(actor.id);
	if (!tagged && (!armed || Date.now() - armed > WINDOW_MS)) return;
	pending.delete(actor.id);
	seen.add(message.id);
	const context = message.flags[sysId()].context;
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

/** GM's client: our Recall Knowledge (recall-knowledge.js) against the target. True if it was rolled. */
async function askRecall(message, { striker, target, critical, label }) {
	const sDoc = striker ? fromUuidSync(striker) : null, tDoc = target ? fromUuidSync(target) : null;
	if (!sDoc?.actor || !tDoc?.object) return false;
	try {
		await recallKnowledge({ actor: sDoc.actor, token: sDoc.object ?? null, targets: [tDoc.object], label, modifiers: critical ? [{ label: L("CriticalBonus"), value: 2 }] : [], ignoreMaybe: SLUGS });
		return true;
	} catch (err) {
		error("Combat Assessment: Recall Knowledge failed.", err);
		return false;
	}
}

/** The striker's client: roll the chosen skill as a secret Recall Knowledge (fallback card). */
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
	const Modifier = sysApi()?.Modifier;
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
	},

	enable(feature) {
		featureOn = () => !!feature.active;
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

export const _test = { onMessage, onClick, claim, pending, seen, identifySkills };
