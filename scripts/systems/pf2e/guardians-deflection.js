import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature, getFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { waitForDice } from "../../core/dice.js";
import { hasReaction, spendReaction } from "./reactions.js";
import { reachOf, withinReach } from "./reactive-strike.js";
import { heldItems } from "./hands.js";
import { pf2eCard, wireOpen, sourceUuid, itemBySlug, compactCard, nameForPlayers } from "./card.js";
import { sysId, sysPack } from "./sys.js";

/**
 * Rule 22 (docs/pf2e-rules.md): Guardian's Deflection (Swashbuckler feat 4, owner's AoN link; the Fighter
 * feat of the same name is read the same way, without the panache).
 * Trigger: an ally within your melee reach is hit by an attack, you can see the attacker, and a +2
 * circumstance bonus to AC would turn the critical hit into a hit or the hit into a miss. Requirements: a
 * single one-handed melee weapon, the other hand(s) free. The ally gets +2 AC against that attack; you gain
 * panache until the end of your next turn.
 *
 * As Shield Block (rule 8), on the active GM's client after Dice So Nice: for an attack roll that hits, each
 * creature with the feat for whom +2 AC changes the result (natural 20 / 1 counted) gets a card (its
 * players and the GM; a monster's to the GM only): what it would change, Deflect / Skip. Only with its
 * reaction left (rule 6), the ally in its reach (rule 7's geometry), the attacker not hidden, the hands as
 * required. Deflect: the reaction is spent, a chat line says the new result (the attack's own card is not
 * changed: roll the damage that line says), Effect: Panache for the swashbuckler. Skip: the card goes.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.Deflection.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const NAME = /^guardian['’]?s deflection/i;
const PANACHE = "Effect: Panache";
const NO_REACT = ["unconscious", "dying", "dead", "paralyzed", "petrified", "stunned", "restrained"];
const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];
const seen = new Set();

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);
const ownersOf = (actor) => (actor?.hasPlayerOwner ? game.users.filter((u) => !u.isGM && u.active && actor.testUserPermission?.(u, "OWNER")).map((u) => u.id) : []);
const slugOf = (item) => item?.slug ?? item?.system?.slug ?? "";
const traitsOf = (item) => {
	const t = item?.traits ?? item?.system?.traits?.value ?? [];
	return new Set(t instanceof Set ? [...t] : t);
};

/** The creature's Guardian's Deflection feat, or null. */
export const deflectionFeat = (actor) => Array.from(actor?.items?.contents ?? actor?.items ?? [])
	.find((i) => ["feat", "action"].includes(i.type) && (slugOf(i).startsWith("guardians-deflection") || NAME.test(i.name ?? ""))) ?? null;
const isSwashbuckler = (feat) => traitsOf(feat).has("swashbuckler") || slugOf(feat).includes("swashbuckler");

/** PF2e's degree of success: index into DEGREES. */
export function degree(total, dc, natural) {
	let d = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
	if (natural === 20) d += 1;
	else if (natural === 1) d -= 1;
	return Math.max(0, Math.min(3, d));
}

/** What +2 AC does to this attack: { from, to } (DEGREES names) or null when it changes nothing. */
export function deflected(total, ac, natural) {
	const from = degree(total, ac, natural), to = degree(total, ac + 2, natural);
	return from >= 2 && to < from ? { from: DEGREES[from], to: DEGREES[to] } : null;
}

const d20Of = (roll) => {
	const die = (roll?.dice ?? []).find((d) => Number(d.faces) === 20);
	return Number(die?.total ?? die?.results?.find?.((r) => r.active !== false)?.result) || null;
};

const cellsOf = (doc) => {
	const size = canvas.grid.size;
	const x0 = Math.round(doc.x / size), y0 = Math.round(doc.y / size);
	return { x0, y0, x1: x0 + Math.max(1, Math.round(doc.width)) - 1, y1: y0 + Math.max(1, Math.round(doc.height)) - 1 };
};
const down = (actor) => NO_REACT.some((s) => actor?.hasCondition?.(s) || actor?.statuses?.has?.(s)) || (Number(actor?.system?.attributes?.hp?.value) <= 0 && actor?.system?.attributes?.hp?.max > 0);
const combatantOf = (doc) => {
	const c = doc?.combatant ?? null;
	return c && c.combat === game.combat && game.combat?.started ? c : null;
};

/** A single one-handed melee weapon held, nothing else in the hands (when PF2e tells us what is held). */
export function handsReady(actor) {
	const held = heldItems(actor);
	if (!held.length) return false;
	const weapons = held.filter((i) => i.type === "weapon");
	if (weapons.length !== 1 || held.length !== 1) return false;
	const w = weapons[0];
	return (Number(w.handsHeld) || 1) === 1 && w.isMelee !== false;
}

/** Who could deflect this hit on `ally`. */
function deflectors(ally, attacker) {
	return (canvas.tokens?.placeables ?? []).map((t) => t.document).filter((doc) => {
		const actor = doc.actor;
		if (!actor || doc === ally || doc === attacker || doc.hidden || down(actor) || !deflectionFeat(actor)) return false;
		if (doc.disposition !== ally.disposition || doc.disposition === 0) return false;
		const c = combatantOf(doc);
		if (c && getFeature("pf2eReactions")?.isEnabled && !hasReaction(c)) return false;
		if (!handsReady(actor)) return false;
		return withinReach(cellsOf(doc), cellsOf(ally), reachOf(actor));
	});
}

/** Active GM's client: cards for this attack roll. */
export async function onAttack(message) {
	if (!game.user.isActiveGM) return;
	const context = message?.flags?.[sysId()]?.context;
	if (!["attack-roll", "spell-attack-roll"].includes(context?.type) || context.isReroll || seen.has(message.id)) return;
	if (!["success", "criticalSuccess"].includes(context.outcome)) return;
	const ally = context.target?.token ? fromUuidSync(context.target.token) : null;
	const attacker = context.origin?.token ? fromUuidSync(context.origin.token) : message.token ?? null;
	if (!ally?.actor || !attacker || attacker.hidden || ally.parent !== canvas.scene) return;
	const roll = message.rolls?.[0];
	const ac = Number(context.dc?.value ?? ally.actor.armorClass?.value ?? ally.actor.system?.attributes?.ac?.value);
	if (!roll || !Number.isFinite(ac)) return;
	const change = deflected(Number(roll.total), ac, d20Of(roll));
	if (!change) return;
	const who = deflectors(ally, attacker);
	if (!who.length) return;
	seen.add(message.id);
	await waitForDice(message.id);
	for (const doc of who) {
		const feat = deflectionFeat(doc.actor);
		const body = `<p>${L("Line", { attacker: esc(nameForPlayers(attacker, L("ACreature"))), item: esc(message.item?.name ?? ""), ally: esc(nameForPlayers(ally, L("ACreature"))), from: L(change.from), to: L(change.to) })}</p>`;
		await ChatMessage.create({
			content: pf2eCard({
				img: feat?.img, title: feat?.name ?? L("Title"), glyph: "R", who: doc.name, open: sourceUuid(feat), body, extraClass: "lucd20-gd-card",
				buttons: [{ data: "lucd20-gd", value: "deflect", icon: "fa-shield-halved", label: L("Deflect") }, { data: "lucd20-gd", value: "skip", icon: "fa-xmark", label: L("Skip") }]
			}),
			speaker: { alias: doc.name },
			whisper: [...new Set([...ownersOf(doc.actor), ...gmIds()])],
			flags: { [MODULE_ID]: { deflection: { attack: message.id, token: doc.uuid, ally: ally.uuid, attacker: attacker.uuid, item: message.item?.name ?? "", ...change, img: feat?.img ?? null, title: feat?.name ?? L("Title"), open: sourceUuid(feat) } } }
		});
	}
}

/** The reactor's client: ask the GM. */
async function onClick(card, button) {
	const data = card.getFlag(MODULE_ID, "deflection");
	const doc = data ? fromUuidSync(data.token) : null;
	if (!doc?.actor || data.done) return;
	if (!(game.user.isGM || doc.actor.isOwner)) return ui.notifications.warn(L("NotYours"));
	button.disabled = true;
	await executeAsGM("pf2eGD.answer", { card: card.id, deflect: button.dataset.lucd20Gd === "deflect" });
}

/** GM's client: once per card. Deflect: reaction, the new result in chat, panache. */
async function answer({ card, deflect }, senderId) {
	const m = game.messages.get(card);
	const data = m?.getFlag(MODULE_ID, "deflection");
	if (!data || data.done) return false;
	const doc = fromUuidSync(data.token);
	const sender = game.users.get(senderId);
	if (sender && !sender.isGM && !doc?.actor?.testUserPermission?.(sender, "OWNER")) return false;
	if (!deflect) { await m.delete(); return true; }
	const reveal = doc && !doc.hidden;
	await m.update({
		content: compactCard({ img: data.img, title: data.title, glyph: "R", who: reveal ? nameForPlayers(doc, doc?.name ?? "") : doc?.name, open: data.open, extraClass: "lucd20-gd-card", result: L("Deflected") }),
		[`flags.${MODULE_ID}.deflection.done`]: true,
		...(reveal ? { whisper: [] } : {})
	});
	const ally = fromUuidSync(data.ally), attacker = fromUuidSync(data.attacker);
	const c = combatantOf(doc);
	if (c && getFeature("pf2eReactions")?.isEnabled) await spendReaction(c, { source: data.title });
	const hidden = !reveal || ally?.hidden || attacker?.hidden;
	await ChatMessage.create({
		content: `<p class="lucd20-rule-note"><i class="fa-solid fa-shield-halved"></i> ${L("Result", { ally: `<strong>${esc(nameForPlayers(ally, L("ACreature")))}</strong>`, attacker: esc(nameForPlayers(attacker, L("ACreature"))), item: esc(data.item), to: L(data.to) })}</p>`,
		speaker: { alias: localize("LUCD20.PF2eRules.Speaker") },
		whisper: hidden ? gmIds() : []
	});
	if (doc?.actor && isSwashbuckler(deflectionFeat(doc.actor))) await givePanache(doc.actor).catch((err) => error("Guardian's Deflection: panache failed.", err));
	return true;
}

/** Effect: Panache until the end of the swashbuckler's next turn (unless it already has panache). */
async function givePanache(actor) {
	const has = (actor.itemTypes?.effect ?? []).some((e) => e.name === PANACHE || slugOf(e) === "effect-panache");
	if (has) return;
	const pack = sysPack("feat-effects");
	const entry = pack?.index?.find?.((e) => e.name === PANACHE) ?? (await pack?.getIndex?.())?.find?.((e) => e.name === PANACHE);
	const effect = entry ? await pack.getDocument(entry._id) : null;
	if (!effect) return void ui.notifications.warn(L("NoPanache"));
	const source = effect.toObject();
	source.system.duration = { value: 1, unit: "rounds", expiry: "turn-end", sustained: false };
	await actor.createEmbeddedDocuments("Item", [source]);
}

defineFeature({
	id: "pf2eGuardiansDeflection",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,

	init(feature) {
		onGMRequest("pf2eGD.answer", (payload, senderId) => (feature.active ? answer(payload, senderId) : false));
	},

	enable(feature) {
		feature.on("createChatMessage", (message) => { onAttack(message).catch((err) => error("Guardian's Deflection failed.", err)); });
		feature.on("renderChatMessageHTML", (message, html) => {
			const data = message.getFlag?.(MODULE_ID, "deflection");
			if (!data) return;
			wireOpen(html);
			for (const button of html.querySelectorAll?.("[data-lucd20-gd]") ?? []) {
				if (data.done) { button.disabled = true; continue; }
				button.addEventListener("click", (event) => {
					event.preventDefault();
					if (feature.active) onClick(message, button).catch((err) => error("Guardian's Deflection failed.", err));
				});
			}
		});
	}
});

export const _test = { onAttack, onClick, answer, seen, deflectors, handsReady, givePanache };
