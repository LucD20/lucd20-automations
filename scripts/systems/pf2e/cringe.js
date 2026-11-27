import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature, getFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { waitForDice } from "../../core/dice.js";
import { hasReaction, spendReaction } from "./reactions.js";
import { addImmunity, immunitiesOf } from "./immunity.js";
import { pf2eCard, wireOpen, sourceUuid, itemBySlug, compactCard, nameForPlayers } from "./card.js";
import { flatCheckFailed } from "./flat-check.js";
import { sysId } from "./sys.js";

/**
 * Rule 26 (docs/pf2e-rules.md): Cringe (kobold ancestry feat 1; reaction; emotion, mental, visual). Owner,
 * v0.89.0: "A reaction that needs to trigger on a critical, reducing the damage by 2 + level."
 * Trigger: a creature you are aware of critically succeeds on a Strike against you and would deal damage. The
 * attacker takes a circumstance penalty to that Strike's damage equal to your level + 2 (after doubling); it is
 * then immune to your Cringe for 24 hours.
 *
 * On the active GM's client after Dice So Nice: a Strike that critically hits a creature with Cringe (reaction
 * left, not down, the attacker not hidden and not immune to its Cringe) → a card to its players and the GM:
 * Cringe / Skip. Cringe: the reaction is spent, the attacker immune for a day (our tracker), and PF2e's own
 * Cringe toggle (the feat's RollOption "cringe", whose EphemeralEffect gives the attacker's strike damage the
 * penalty) is turned on for the next damage roll of that attacker against it, then off again (or after 2
 * minutes). If the damage was already rolled, the line says how much less to apply.
 * (verify) PF2e 8.7: `actor.toggleRollOption("strike-damage", "cringe", featId, true)`.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.Cringe.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const SLUGS = ["cringe"];
const NAME = /^cringe$/i;
const KIND = "cringe";
const NO_REACT = ["unconscious", "dying", "dead", "paralyzed", "petrified", "stunned", "restrained"];
const WINDOW_MS = 120000;
const seen = new Set();
const armed = new Map(); // target token uuid → { attacker token uuid, featId, actorUuid, until }

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);
const ownersOf = (actor) => (actor?.hasPlayerOwner ? game.users.filter((u) => !u.isGM && u.active && actor.testUserPermission?.(u, "OWNER")).map((u) => u.id) : []);
const down = (actor) => NO_REACT.some((s) => actor?.hasCondition?.(s) || actor?.statuses?.has?.(s)) || (Number(actor?.system?.attributes?.hp?.value) <= 0 && actor?.system?.attributes?.hp?.max > 0);
const combatantOf = (doc) => {
	const c = doc?.combatant ?? null;
	return c && c.combat === game.combat && game.combat?.started ? c : null;
};
const levelOf = (actor) => Number(actor?.level ?? actor?.system?.details?.level?.value) || 0;
export const penaltyFor = (actor) => levelOf(actor) + 2;

/** Active GM's client: a card when a Strike critically hits a creature with Cringe. */
export async function onAttack(message) {
	if (!game.user.isActiveGM) return;
	const context = message?.flags?.[sysId()]?.context;
	if (context?.type !== "attack-roll" || context.isReroll || context.outcome !== "criticalSuccess" || seen.has(message.id)) return;
	const target = context.target?.token ? fromUuidSync(context.target.token) : null;
	const attacker = context.origin?.token ? fromUuidSync(context.origin.token) : message.token ?? null;
	const actor = target?.actor;
	const feat = actor ? itemBySlug(actor, SLUGS, NAME) : null;
	if (!feat || !attacker?.actor || attacker.hidden || down(actor)) return;
	const c = combatantOf(target);
	if (c && getFeature("pf2eReactions")?.isEnabled && !hasReaction(c)) return;
	if (immunitiesOf(attacker.actor, { kind: KIND, by: actor.uuid }).length) return;
	seen.add(message.id);
	await waitForDice(message.id);
	if (await flatCheckFailed(message, target.uuid)) return; // v0.90.1: the flat check failed: a miss
	const n = penaltyFor(actor);
	await ChatMessage.create({
		content: pf2eCard({
			img: feat.img, title: feat.name, glyph: "R", who: target.name, open: sourceUuid(feat), extraClass: "lucd20-cr-card",
			body: `<p>${L("Line", { attacker: `<b>${esc(nameForPlayers(attacker, L("ACreature")))}</b>`, n })}</p>`,
			buttons: [{ data: "lucd20-cr", value: "cringe", icon: "fa-face-grimace", label: L("Cringe") }, { data: "lucd20-cr", value: "skip", icon: "fa-xmark", label: L("Skip") }]
		}),
		speaker: { alias: target.name },
		whisper: [...new Set([...ownersOf(actor), ...gmIds()])],
		flags: { [MODULE_ID]: { cringe: { attack: message.id, token: target.uuid, attacker: attacker.uuid, featId: feat.id, n, img: feat.img, title: feat.name, open: sourceUuid(feat) } } }
	});
}

async function onClick(card, button) {
	const data = card.getFlag(MODULE_ID, "cringe");
	const doc = data ? fromUuidSync(data.token) : null;
	if (!doc?.actor || data.done) return;
	if (!(game.user.isGM || doc.actor.isOwner)) return ui.notifications.warn(L("NotYours"));
	button.disabled = true;
	await executeAsGM("pf2eCringe.answer", { card: card.id, use: button.dataset.lucd20Cr === "cringe" });
}

/** GM's client: once per card. */
async function answer({ card, use }, senderId) {
	const m = game.messages.get(card);
	const data = m?.getFlag(MODULE_ID, "cringe");
	if (!data || data.done) return false;
	const doc = fromUuidSync(data.token), attacker = fromUuidSync(data.attacker);
	const sender = game.users.get(senderId);
	if (sender && !sender.isGM && !doc?.actor?.testUserPermission?.(sender, "OWNER")) return false;
	if (!use) { await m.delete(); return true; }
	const reveal = doc && !doc.hidden;
	await m.update({
		content: compactCard({ img: data.img, title: data.title, glyph: "R", who: reveal ? nameForPlayers(doc, doc?.name ?? "") : doc?.name, open: data.open, extraClass: "lucd20-cr-card", result: L("Result", { n: data.n }) }),
		[`flags.${MODULE_ID}.cringe.done`]: true,
		...(reveal ? { whisper: [] } : {})
	});
	const c = combatantOf(doc);
	if (c && getFeature("pf2eReactions")?.isEnabled) await spendReaction(c, { source: data.title });
	if (attacker?.actor) await addImmunity(attacker.actor, { kind: KIND, by: doc.actor.uuid, name: doc.name });
	// Already rolled? Then say how much less to apply; else PF2e's toggle for the next damage roll.
	const rolled = game.messages.contents.slice(game.messages.contents.findIndex((x) => x.id === data.attack) + 1)
		.some((x) => isDamageAgainst(x, data.attacker, data.token));
	if (rolled) {
		await ChatMessage.create({ content: `<p class="lucd20-rule-note"><i class="fa-solid fa-face-grimace"></i> ${L("AlreadyRolled", { n: data.n, name: `<strong>${esc(nameForPlayers(doc, doc.name))}</strong>` })}</p>`, speaker: { alias: localize("LUCD20.PF2eRules.Speaker") }, whisper: reveal ? [] : gmIds() });
		return true;
	}
	await setToggle(doc.actor, data.featId, true);
	armed.set(data.token, { attacker: data.attacker, featId: data.featId, actorUuid: doc.actor.uuid, until: Date.now() + WINDOW_MS });
	setTimeout(() => disarm(data.token), WINDOW_MS + 1000);
	return true;
}

function isDamageAgainst(message, attackerUuid, targetUuid) {
	const context = message?.flags?.[sysId()]?.context;
	if (context?.type !== "damage-roll") return false;
	const origin = context.origin?.token ?? message.token?.uuid ?? null;
	return origin === attackerUuid && context.target?.token === targetUuid;
}

async function setToggle(actor, featId, value) {
	try {
		if (typeof actor.toggleRollOption === "function") await actor.toggleRollOption("strike-damage", "cringe", featId, value);
	} catch (err) { error("Cringe: the toggle failed.", err); }
}

async function disarm(targetUuid) {
	const a = armed.get(targetUuid);
	if (!a) return;
	armed.delete(targetUuid);
	const actor = fromUuidSync(a.actorUuid);
	if (actor) await setToggle(actor, a.featId, false);
}

/** GM's client: the attacker's damage roll against it came: the toggle goes off again. */
function onDamage(message) {
	if (!game.user.isActiveGM || !armed.size) return;
	for (const [target, a] of armed) if (isDamageAgainst(message, a.attacker, target)) setTimeout(() => disarm(target), 500);
}

defineFeature({
	id: "pf2eCringe",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,
	init(feature) {
		onGMRequest("pf2eCringe.answer", (payload, senderId) => (feature.active ? answer(payload, senderId) : false));
	},
	enable(feature) {
		feature.on("createChatMessage", (message) => {
			onAttack(message).catch((err) => error("Cringe failed.", err));
			onDamage(message);
		});
		feature.on("renderChatMessageHTML", (message, html) => {
			const data = message.getFlag?.(MODULE_ID, "cringe");
			if (!data) return;
			wireOpen(html);
			for (const b of html.querySelectorAll?.("[data-lucd20-cr]") ?? []) b.addEventListener("click", () => onClick(message, b));
		});
		feature.onCleanup(() => { for (const t of [...armed.keys()]) disarm(t); });
	}
});

export const _test = { onAttack, answer, penaltyFor, armed };
