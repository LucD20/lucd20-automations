import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature, getFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { waitForDice } from "../../core/dice.js";
import { hasReaction, spendReaction } from "./reactions.js";
import { addImmunity, immunitiesOf } from "./immunity.js";
import { pf2eCard, wireOpen, sourceUuid, itemBySlug, compactCard, nameForPlayers } from "./card.js";
import { degree } from "./guardians-deflection.js";
import { sysId } from "./sys.js";
import { useSignature } from "../../features/signature-spells/signature-spells.js";

/**
 * Rule 28 (docs/pf2e-rules.md): Such a Disgrace! (Dandy archetype feat 4; reaction; fortune). Owner, v0.89.0:
 * "30 feet, need to see who fails on a mental save; reroll can be done manually in Foundry or the owner of the
 * PC affected by it gets a notification to reroll, keep the higher result."
 * Trigger: an ally within 30 feet fails a Will saving throw against a mental effect. The ally rerolls it with a
 * +1 circumstance bonus and uses the higher result; it is then immune to Such a Disgrace! for 10 minutes.
 *
 * - Active GM's client, after Dice So Nice: a Will save (not secret) that fails or critically fails, against a
 *   mental effect (the roll's options carry "mental"), → for each creature with the feat on the saver's side,
 *   within 30 ft, reaction left, not down, the saver not immune: a card to its players and the GM (React / Skip).
 * - React: the reaction is spent, the saver immune for 10 minutes, and a card goes to the saver's players and
 *   the GM: "Reroll (+1, keep the higher)". Its click rolls a d20 with the first roll's modifier + 1, keeps the
 *   higher total and says the result's degree (the DC only for the GM: PF2e may hide it). The first save's
 *   message is not changed: apply the kept result (or reroll in Foundry by hand instead).
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.Disgrace.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const SLUGS = ["such-a-disgrace"];
const NAME = /^such a disgrace!?$/i;
const KIND = "suchADisgrace";
const RANGE_FT = 30;
const NO_REACT = ["unconscious", "dying", "dead", "paralyzed", "petrified", "stunned", "restrained"];
const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];
const seen = new Set();

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);
const ownersOf = (actor) => (actor?.hasPlayerOwner ? game.users.filter((u) => !u.isGM && u.active && actor.testUserPermission?.(u, "OWNER")).map((u) => u.id) : []);
const down = (actor) => NO_REACT.some((s) => actor?.hasCondition?.(s) || actor?.statuses?.has?.(s)) || (Number(actor?.system?.attributes?.hp?.value) <= 0 && actor?.system?.attributes?.hp?.max > 0);
const combatantOf = (doc) => {
	const c = doc?.combatant ?? null;
	return c && c.combat === game.combat && game.combat?.started ? c : null;
};
const d20Of = (roll) => {
	const die = (roll?.dice ?? []).find((d) => Number(d.faces) === 20);
	return Number(die?.total ?? die?.results?.find?.((r) => r.active !== false)?.result) || null;
};

/** Is this message's save a Will save against a mental effect? */
export function isMentalWill(context) {
	const o = (context?.options ?? []).map(String);
	const will = context?.statistic === "will" || o.includes("will") || o.some((x) => x === "check:statistic:will" || x.endsWith(":will"));
	const mental = o.some((x) => x === "mental" || x.endsWith(":mental"));
	return will && mental;
}

/** Feet between two tokens' footprints (squares between them × the scene's distance). */
function feetBetween(a, b) {
	const size = canvas.grid.size, unit = Number(canvas.scene?.grid?.distance ?? canvas.grid?.distance) || 5;
	const box = (d) => ({ x0: Math.round(d.x / size), y0: Math.round(d.y / size), x1: Math.round(d.x / size) + Math.max(1, Math.round(d.width)) - 1, y1: Math.round(d.y / size) + Math.max(1, Math.round(d.height)) - 1 });
	const p = box(a), q = box(b);
	const dx = Math.max(0, q.x0 - p.x1, p.x0 - q.x1), dy = Math.max(0, q.y0 - p.y1, p.y0 - q.y1);
	return Math.max(dx, dy) * unit;
}

/** Active GM's client. */
export async function onSave(message) {
	if (!game.user.isActiveGM) return;
	const context = message?.flags?.[sysId()]?.context;
	if (context?.type !== "saving-throw" || context.isReroll || seen.has(message.id)) return;
	if (!["failure", "criticalFailure"].includes(context.outcome) || !isMentalWill(context)) return;
	if (message.blind || message.whisper?.length) return; // a secret save: no card that would tell
	const saver = message.token ?? (context.token ? fromUuidSync(context.token) : null) ?? message.actor?.getActiveTokens?.()?.[0]?.document ?? null;
	if (!saver?.actor || immunitiesOf(saver.actor, { kind: KIND }).length) return;
	const dandies = (canvas.tokens?.placeables ?? []).map((t) => t.document).filter((doc) => {
		const actor = doc.actor;
		if (!actor || doc === saver || doc.hidden || down(actor) || !itemBySlug(actor, SLUGS, NAME)) return false;
		if (doc.disposition !== saver.disposition || doc.disposition === 0) return false;
		const c = combatantOf(doc);
		if (c && getFeature("pf2eReactions")?.isEnabled && !hasReaction(c)) return false;
		return feetBetween(doc, saver) <= RANGE_FT;
	});
	if (!dandies.length) return;
	seen.add(message.id);
	await waitForDice(message.id);
	for (const doc of dandies) {
		const feat = itemBySlug(doc.actor, SLUGS, NAME);
		await ChatMessage.create({
			content: pf2eCard({
				img: feat.img, title: feat.name, glyph: "R", who: doc.name, open: sourceUuid(feat), extraClass: "lucd20-sd-card",
				body: `<p>${L("Line", { ally: `<b>${esc(nameForPlayers(saver, L("ACreature")))}</b>`, degree: L(context.outcome) })}</p>`,
				buttons: [{ data: "lucd20-sd", value: "react", icon: "fa-face-angry", label: L("React") }, { data: "lucd20-sd", value: "skip", icon: "fa-xmark", label: L("Skip") }]
			}),
			speaker: { alias: doc.name },
			whisper: [...new Set([...ownersOf(doc.actor), ...gmIds()])],
			flags: { [MODULE_ID]: { disgrace: { save: message.id, token: doc.uuid, saver: saver.uuid, img: feat.img, title: feat.name, open: sourceUuid(feat) } } }
		});
	}
}

async function onClick(card, button) {
	const data = card.getFlag(MODULE_ID, "disgrace");
	if (!data || data.done) return;
	const value = button.dataset.lucd20Sd;
	if (value === "reroll") {
		const saver = fromUuidSync(data.saver);
		if (!(game.user.isGM || saver?.actor?.isOwner)) return ui.notifications.warn(L("NotYours"));
	} else {
		const doc = fromUuidSync(data.token);
		if (!(game.user.isGM || doc?.actor?.isOwner)) return ui.notifications.warn(L("NotYours"));
	}
	button.disabled = true;
	await executeAsGM("pf2eDisgrace.answer", { card: card.id, value });
}

/** GM's client. react / skip on the dandy's card; reroll on the saver's card. */
async function answer({ card, value }, senderId) {
	const m = game.messages.get(card);
	const data = m?.getFlag(MODULE_ID, "disgrace");
	if (!data || data.done) return false;
	const sender = game.users.get(senderId);
	const doc = fromUuidSync(data.token), saver = fromUuidSync(data.saver);
	const owns = (d) => !sender || sender.isGM || d?.actor?.testUserPermission?.(sender, "OWNER");
	if (value === "skip") { if (!owns(doc)) return false; await m.delete(); return true; }
	if (value === "react") {
		if (!owns(doc)) return false;
		const reveal = doc && !doc.hidden;
		await m.update({
			content: compactCard({ img: data.img, title: data.title, glyph: "R", who: reveal ? nameForPlayers(doc, doc.name) : doc?.name, open: data.open, extraClass: "lucd20-sd-card", result: L("Used") }),
			[`flags.${MODULE_ID}.disgrace.done`]: true,
			...(reveal ? { whisper: [] } : {})
		});
		// The signature animation, "the spotlight of shame" (PLAN §28): on this client and the others (only the
		// card's recipients when the dandy's token is hidden). Does nothing when Signature Spells or its switch is off.
		useSignature("suchADisgrace", { caster: doc, targets: [saver], to: reveal ? null : m.whisper });
		const c = combatantOf(doc);
		if (c && getFeature("pf2eReactions")?.isEnabled) await spendReaction(c, { source: data.title });
		if (saver?.actor) await addImmunity(saver.actor, { kind: KIND, by: doc.actor.uuid, name: doc.name, seconds: 600 });
		// The saver's players get the reroll.
		await ChatMessage.create({
			content: pf2eCard({
				img: data.img, title: data.title, kind: "free", who: saver?.name ?? "", open: data.open, extraClass: "lucd20-sd-card",
				body: `<p>${L("RerollLine", { name: `<b>${esc(doc.name)}</b>` })}</p>`,
				buttons: [{ data: "lucd20-sd", value: "reroll", icon: "fa-dice-d20", label: L("Reroll") }]
			}),
			speaker: { alias: saver?.name ?? "" },
			whisper: [...new Set([...ownersOf(saver?.actor), ...gmIds()])],
			flags: { [MODULE_ID]: { disgrace: { ...data, done: false, reroller: true } } }
		});
		return true;
	}
	if (value === "reroll" && data.reroller) {
		if (!owns(saver)) return false;
		const first = game.messages.get(data.save);
		const context = first?.flags?.[sysId()]?.context ?? {};
		const oldRoll = first?.rolls?.[0];
		const oldTotal = Number(oldRoll?.total), oldD20 = d20Of(oldRoll);
		if (!Number.isFinite(oldTotal) || !oldD20) return false;
		const mod = oldTotal - oldD20 + 1;
		const roll = await new Roll(`1d20 + ${mod}`).evaluate();
		const newD20 = d20Of(roll) ?? (roll.total - mod);
		const dc = Number(context.dc?.value);
		const keepNew = roll.total > oldTotal;
		const kept = keepNew ? { total: roll.total, d20: newD20 } : { total: oldTotal, d20: oldD20 };
		const deg = Number.isFinite(dc) ? DEGREES[degree(kept.total, dc, kept.d20)] : null;
		const who = `<strong>${esc(nameForPlayers(saver, saver?.name ?? ""))}</strong>`;
		const line = L("Rerolled", { name: who, d20: newD20, mod: mod >= 0 ? `+ ${mod}` : `− ${-mod}`, total: roll.total, old: oldTotal, kept: kept.total })
			+ (deg ? ` ${L("Now", { degree: L(deg) })}` : "");
		await ChatMessage.create({
			content: `<p class="lucd20-rule-note"><i class="fa-solid fa-dice-d20"></i> ${line}</p>`,
			speaker: { alias: saver?.name ?? "" },
			rolls: [roll],
			whisper: first?.whisper?.length ? first.whisper : []
		});
		await m.update({ content: compactCard({ img: data.img, title: data.title, kind: "free", who: saver?.name ?? "", open: data.open, extraClass: "lucd20-sd-card", result: L("Kept", { total: kept.total }) }), [`flags.${MODULE_ID}.disgrace.done`]: true });
		return true;
	}
	return false;
}

defineFeature({
	id: "pf2eSuchADisgrace",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,
	init(feature) {
		onGMRequest("pf2eDisgrace.answer", (payload, senderId) => (feature.active ? answer(payload, senderId) : false));
	},
	enable(feature) {
		feature.on("createChatMessage", (message) => { onSave(message).catch((err) => error("Such a Disgrace! failed.", err)); });
		feature.on("renderChatMessageHTML", (message, html) => {
			const data = message.getFlag?.(MODULE_ID, "disgrace");
			if (!data) return;
			wireOpen(html);
			for (const b of html.querySelectorAll?.("[data-lucd20-sd]") ?? []) b.addEventListener("click", () => onClick(message, b));
		});
	}
});

export const _test = { onSave, answer, isMentalWill, feetBetween };
