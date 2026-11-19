import { localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { sysId } from "./sys.js";

/**
 * Merge 4 (docs/pf2e-rules.md §15): hand reminders, replacing "PF2e Hands Management (Reminder)" (owner,
 * Q207–Q211; Q208: no free-hand check for spells). Warnings only, as a notice to whoever acted and the GMs:
 * - more than two hands in use (any time a grip changes);
 * - in an encounter: a Strike with a weapon not held, or held in fewer hands than it needs; a manipulate spell
 *   while Restrained; a concentrate action while raging (not one with the rage trait, not Seek); Raise a Shield
 *   with a buckler while the other hand is busy with something that isn't light.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.Hands.${key}`, data);
const RAGE = ["effect-rage"];

const physical = (actor) => Object.values(actor?.itemTypes ?? {}).flat().filter((i) => (i.handsHeld ?? 0) > 0);
/** Held items that take a hand: a buckler on the arm and weapons attached to a shield don't. */
export function heldItems(actor) {
	return physical(actor).filter((i) => !((i.slug ?? i.system?.slug) === "buckler" && i.handsHeld === 1) && !(i.type === "weapon" && traitsOf(i).has("attached-to-shield")));
}
const traitsOf = (item) => {
	const t = item?.traits ?? item?.system?.traits?.value ?? [];
	return new Set(t instanceof Set ? [...t] : t);
};
export const handsInUse = (actor) => heldItems(actor).reduce((n, i) => n + (Number(i.handsHeld) || 0), 0);
const has = (actor, slug) => !!(actor?.hasCondition?.(slug) ?? (actor?.itemTypes?.condition ?? []).some((c) => c.slug === slug));
// "Effect: Rage" (feat-effects z3uyCMBddrPK5umr; its compendium slug is empty).
const raging = (actor) => (actor?.itemTypes?.effect ?? []).some((e) => RAGE.includes(e.slug ?? e.system?.slug)
	|| String(e.sourceId ?? e._stats?.compendiumSource ?? "").endsWith("z3uyCMBddrPK5umr") || e.name === "Effect: Rage");
const inEncounter = () => !!game.combat?.started;
/** The user who acted and the GMs see it. */
const forMe = (userId) => game.user.isGM || game.user.id === userId;
const warn = (text) => ui.notifications.warn(text);

/** What's wrong with this message's action, or null. */
export function messageWarning(message) {
	const actor = message.actor, item = message.item;
	if (!actor || !item) return null;
	const context = message.flags?.[sysId()]?.context;
	if (context?.isReroll) return null;
	if (context?.type === "attack-roll" && item.type === "weapon" && actor.type === "character") {
		if ((item.slug ?? item.system?.slug) === "basic-unarmed" || item.hands === "0") return null;
		if (!item.isHeld) return L("NotHeld", { name: actor.name, item: item.name });
		const needs = item.hands === "2" ? 2 : 1;
		if ((Number(item.handsHeld) || 0) < needs) return L("OneHand", { name: actor.name, item: item.name });
		return null;
	}
	if (context) return null; // other rolls: their action was already posted
	const traits = traitsOf(item);
	if (message.flags?.[sysId()]?.casting && item.type === "spell" && traits.has("manipulate") && has(actor, "restrained")) return L("Restrained", { name: actor.name, item: item.name });
	if (raging(actor) && traits.has("concentrate") && !traits.has("rage") && (item.slug ?? item.system?.slug) !== "seek") return L("Rage", { name: actor.name, item: item.name });
	return null;
}

defineFeature({
	id: "pf2eHands",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,

	enable(feature) {
		// A grip changed: more than two hands?
		feature.on("updateItem", (item, changes, options, userId) => {
			if (!forMe(userId) || !foundry.utils.hasProperty(changes ?? {}, "system.equipped")) return;
			const actor = item.actor;
			if (!actor || handsInUse(actor) <= 2) return;
			warn(L("TooMany", { name: actor.name, list: heldItems(actor).map((i) => `${i.name} (${i.handsHeld})`).join(", ") }));
		});
		feature.on("createChatMessage", (message) => {
			const author = message.author?.id ?? message.author;
			if (!inEncounter() || !forMe(author)) return;
			const text = messageWarning(message);
			if (text) warn(text);
		});
		// Raise a Shield with a buckler: a hand free, or one holding a light item.
		feature.on("createItem", (item, options, userId) => {
			if (!inEncounter() || !forMe(userId) || (item.slug ?? item.system?.slug) !== "effect-raise-a-shield") return;
			const actor = item.actor;
			const held = physical(actor);
			if (!held.some((i) => (i.slug ?? i.system?.slug) === "buckler")) return;
			const others = held.filter((i) => (i.slug ?? i.system?.slug) !== "buckler");
			const busy = others.reduce((n, i) => n + (Number(i.handsHeld) || 0), 0) >= 2;
			const light = others.some((i) => i.bulk?.light === 1 && !i.bulk?.normal);
			if (busy && !light) warn(L("Buckler", { name: actor.name }));
		});
	}
});

export const _test = { heldItems, handsInUse, messageWarning };
