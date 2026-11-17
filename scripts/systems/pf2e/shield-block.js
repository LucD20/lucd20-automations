import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature, getFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { hasReaction, spendReaction } from "./reactions.js";
import { pf2eCard, answered, wireOpen, sourceUuid, itemBySlug } from "./card.js";

/**
 * Rule 8 (docs/pf2e-rules.md): Shield Block prompts. Owner's choices (Q169–Q172): damage is applied with
 * PF2e Toolbelt's Target Helper (target rows on the damage card); when a creature that has the Shield
 * Block reaction, its shield raised and its reaction left is hit by physical damage, its owner (the GM
 * for a monster) gets a card: the incoming damage (the amount left out for a player when the damage roll
 * was secret), the shield's Hardness and HP, Block and Skip. Block applies that damage with PF2e's own
 * shield block (`actor.applyDamage({ shieldBlockRequest: true })`), spends the reaction and marks the
 * Target Helper row applied, so the damage is not applied twice.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.ShieldBlock.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const PHYSICAL = ["bludgeoning", "piercing", "slashing"];
const TOOLBELT = "pf2e-toolbelt";
const seen = new Set(); // message id + token id: one card each

export const hasShieldBlock = (actor) => (actor?.items ?? []).some((i) => ["action", "feat"].includes(i.type) && ((i.slug ?? i.system?.slug) === "shield-block" || /^shield block$/i.test(i.name ?? "")));

/** The damage card's targets: Target Helper's rows, else the roll's own target. */
export function damageTargets(message) {
	const api = game.modules?.get(TOOLBELT)?.api?.targetHelper;
	const fromHelper = api?.getMessageTargets?.(message);
	if (fromHelper?.length) return fromHelper;
	const uuid = message?.flags?.pf2e?.context?.target?.token;
	const doc = uuid ? fromUuidSync(uuid) : null;
	return doc ? [doc] : [];
}

/** Physical damage? (verify) `DamageRoll#instances[].type` in PF2e 8.7. */
export function isPhysical(roll) {
	return (roll?.instances ?? []).some((i) => PHYSICAL.includes(i.type) || PHYSICAL.includes(i.damageType));
}

const combatantOf = (tokenDoc) => {
	const c = tokenDoc?.combatant ?? null;
	return c && c.combat === game.combat && game.combat?.started ? c : null;
};

/** Could this token block now? */
function canBlock(tokenDoc) {
	const actor = tokenDoc?.actor;
	const shield = actor?.attributes?.shield ?? actor?.system?.attributes?.shield;
	if (!actor || !shield?.raised || shield.broken || shield.destroyed || !hasShieldBlock(actor)) return false;
	const c = combatantOf(tokenDoc);
	return !c || !getFeature("pf2eReactions")?.isEnabled || hasReaction(c);
}

/** Active GM's client: a card for each target that could block this damage. */
export async function onDamage(message) {
	if (!game.user.isActiveGM) return;
	const roll = message?.rolls?.[0];
	if (message?.flags?.pf2e?.context?.type !== "damage-roll" || !roll || !isPhysical(roll)) return;
	const secret = !!message.blind || (message.whisper?.length ?? 0) > 0;
	for (const doc of damageTargets(message)) {
		const key = `${message.id}:${doc.id}`;
		if (seen.has(key) || !canBlock(doc)) continue;
		seen.add(key);
		const actor = doc.actor, shield = actor.attributes?.shield ?? actor.system?.attributes?.shield;
		const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
		const owners = actor.hasPlayerOwner ? game.users.filter((u) => !u.isGM && u.active && actor.testUserPermission?.(u, "OWNER")).map((u) => u.id) : [];
		const line = (withAmount) => L(withAmount ? "Incoming" : "IncomingSecret", { name: `<strong>${esc(doc.name)}</strong>`, amount: roll.total, source: esc(message.item?.name ?? "") });
		const item = itemBySlug(actor, ["shield-block"], /^shield block$/i);
		// v0.47.1 (owner): PF2e's card style, buttons side by side, a click on the card opens the entry.
		const body = (withAmount) => pf2eCard({
			img: item?.img, title: item?.name ?? L("Title"), glyph: "R", open: sourceUuid(item), extraClass: "lucd20-sb-card",
			body: `<p>${line(withAmount)}</p><p>${L("Shield", { name: esc(shield.name), hardness: shield.hardness, hp: shield.hp?.value ?? 0, max: shield.hp?.max ?? 0 })}</p>`,
			buttons: [{ data: "lucd20-sb", value: "block", icon: "fa-shield", label: L("Block") }, { data: "lucd20-sb", value: "skip", icon: "fa-xmark", label: L("Skip") }]
		});
		const flags = { [MODULE_ID]: { shieldBlock: { message: message.id, token: doc.uuid } } };
		// Q172: the amount is shown, except to a player when the damage roll was secret.
		if (secret && owners.length) {
			await ChatMessage.create({ content: body(false), speaker: { alias: doc.name }, whisper: owners, flags });
			await ChatMessage.create({ content: body(true), speaker: { alias: doc.name }, whisper: gms, flags });
		} else {
			await ChatMessage.create({ content: body(true), speaker: { alias: doc.name }, whisper: [...new Set([...owners, ...gms])], flags });
		}
	}
}

/** The owner's client: Block applies the damage with Shield Block; Skip only closes the card. */
async function onClick(card, button) {
	const data = card.getFlag(MODULE_ID, "shieldBlock");
	const doc = data ? fromUuidSync(data.token) : null;
	const damage = data ? game.messages.get(data.message) : null;
	if (!doc?.actor || !damage) return;
	if (!(game.user.isGM || doc.actor.isOwner)) return ui.notifications.warn(L("NotYours"));
	button.disabled = true;
	const done = await executeAsGM("pf2eRules.sbClaim", { card: card.id, damage: damage.id, token: doc.id, block: button.dataset.lucd20Sb === "block" });
	if (!done || button.dataset.lucd20Sb !== "block") return;
	const context = damage.flags?.pf2e?.context ?? {};
	await doc.actor.applyDamage({
		damage: damage.rolls[0], token: doc, item: damage.item, rollOptions: new Set(context.options ?? []), shieldBlockRequest: true, outcome: context.outcome ?? null
	});
	const c = combatantOf(doc);
	if (c && getFeature("pf2eReactions")?.isEnabled) await spendReaction(c, { source: L("Title") });
}

/** GM's client: once per card and damage; marks the card and (with Block) the Target Helper row applied. */
async function claim({ card, damage, token, block }, senderId) {
	const cardMsg = game.messages.get(card), dmg = game.messages.get(damage);
	const data = cardMsg?.getFlag(MODULE_ID, "shieldBlock");
	if (!data || data.done || !dmg) return false;
	// Both copies of the card (player and GM) are answered.
	for (const m of game.messages.filter((x) => x.getFlag?.(MODULE_ID, "shieldBlock")?.message === damage && x.getFlag(MODULE_ID, "shieldBlock").token === data.token)) {
		await m.setFlag(MODULE_ID, "shieldBlock", { ...m.getFlag(MODULE_ID, "shieldBlock"), done: true });
		await m.update({ content: answered(m.content, L(block ? "Blocked" : "Skipped")) });
	}
	if (block && game.modules?.get(TOOLBELT)?.active) {
		// (verify) Target Helper keeps applied rows at flags["pf2e-toolbelt"].targetHelper.applied[tokenId][rollIndex].
		await dmg.update({ [`flags.${TOOLBELT}.targetHelper.applied.${token}.0`]: true }).catch(() => {});
	}
	return true;
}

defineFeature({
	id: "pf2eShieldBlock",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,

	init(feature) {
		onGMRequest("pf2eRules.sbClaim", (payload, senderId) => (feature.active ? claim(payload, senderId) : false));
	},

	enable(feature) {
		feature.on("createChatMessage", (message) => { onDamage(message).catch((err) => error("Shield Block failed.", err)); });
		// Target Helper's "Set Target" can add targets after the roll.
		feature.on("updateChatMessage", (message, change) => {
			if (change?.flags?.[TOOLBELT]) onDamage(message).catch((err) => error("Shield Block failed.", err));
		});
		feature.on("renderChatMessageHTML", (message, html) => {
			const data = message.getFlag?.(MODULE_ID, "shieldBlock");
			if (data) wireOpen(html);
			for (const button of html.querySelectorAll?.("[data-lucd20-sb]") ?? []) {
				if (data?.done) { button.disabled = true; continue; }
				button.addEventListener("click", (event) => {
					event.preventDefault();
					if (feature.active) onClick(message, button).catch((err) => error("Shield Block failed.", err));
				});
			}
		});
	}
});

export const _test = { onDamage, onClick, claim, seen, damageTargets, isPhysical };
