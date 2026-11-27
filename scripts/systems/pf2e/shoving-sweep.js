import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature, getFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { waitForDice } from "../../core/dice.js";
import { hasReaction, spendReaction } from "./reactions.js";
import { pf2eCard, wireOpen, sourceUuid, itemBySlug, compactCard, nameForPlayers } from "./card.js";
import { leftReach, enemies, down, combatantOfToken } from "./reactive-strike.js";
import { sysApi, sysId } from "./sys.js";

/**
 * Rule 31 (docs/pf2e-rules.md): Shoving Sweep (Mauler archetype feat 8; reaction). Trigger: an enemy within
 * your reach leaves a square during a move action it's using. Requirement: you wield a melee weapon in two
 * hands. You Shove the triggering creature, ignoring the free-hand requirement; unless you critically succeed,
 * it continues its movement after the Shove. (PLAN §29, N1.)
 *
 * - The move detection is Reactive Strike's (rule 7): a move in combat that leaves a square in the reach of
 *   an enemy with this feat, its reaction left, able to act and holding a melee weapon in two hands → a card
 *   to its owners and the GM (a monster's: the GM only): Shove / Skip.
 * - Shove (GM's client first): the reaction is spent and the mover is put back on the square it was leaving
 *   (the reaction interrupts the move; forced, so nothing else reacts). Then the clicking client targets it and
 *   rolls PF2e's Shove; the Shove automation (rule 3) pushes it as usual.
 * - After that Shove's dice (GM's client): a critical success ends its movement where it was pushed; a success
 *   says it continues its movement (the player moves on); a failure puts it back where its move ended.
 * Foundry can't tell a Step from a 5-ft Stride: the card says a Step doesn't trigger it.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.ShovingSweep.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const SLUGS = ["shoving-sweep"];
const NAME = /^shoving sweep$/i;
const FLAG = "shovingSweep";
const WINDOW_MS = 120000;
const recent = new Map(); // dedupe key → time
const pending = new Map(); // mover token uuid → { by, dest, at, until, hidden }

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);
function whisperFor(actor) {
	const owners = game.users.filter((u) => !u.isGM && u.active && actor?.testUserPermission?.(u, "OWNER")).map((u) => u.id);
	return actor?.hasPlayerOwner ? [...new Set([...owners, ...gmIds()])] : gmIds();
}

/** A melee weapon wielded in two hands. */
export function twoHandedMelee(actor) {
	return (actor?.itemTypes?.weapon ?? []).some((w) => (Number(w.handsHeld) || 0) >= 2 && (w.isMelee ?? !w.isRanged) && w.isEquipped !== false);
}

const feat = (actor) => itemBySlug(actor, SLUGS, NAME);

/** Tokens that could Shoving Sweep `mover` now. */
function sweepers(mover) {
	return (canvas.tokens?.placeables ?? []).filter((t) => t !== mover && t.actor && enemies(mover, t) && !down(t.actor) && feat(t.actor)
		&& twoHandedMelee(t.actor) && combatantOfToken(t) && (!getFeature("pf2eReactions")?.isEnabled || hasReaction(combatantOfToken(t))));
}

/** Active GM's client: a move in combat. */
export function onMoveToken(doc, movement, operation) {
	if (!game.user.isActiveGM || !game.combat?.started || doc.parent !== canvas.scene) return;
	if (operation?.[MODULE_ID]?.forced || ["undo", "config"].includes(movement?.method)) return;
	const mover = doc.object;
	if (!mover) return;
	const origin = movement?.origin ?? movement?.passed?.waypoints?.[0];
	for (const [reactor, from] of leftReach(mover, origin, movement?.passed?.waypoints ?? [], sweepers(mover))) {
		postCard(reactor, mover, from).catch((err) => error("Shoving Sweep card failed.", err));
	}
}

async function postCard(reactor, mover, from) {
	const key = `${game.combat?.id}:${game.combat?.round}:${reactor.id}:${mover.id}`;
	const now = Date.now();
	for (const [k, t] of recent) if (now - t > 60000) recent.delete(k);
	if (now - (recent.get(key) ?? 0) < 15000) return null;
	recent.set(key, now);
	const item = feat(reactor.actor);
	const name = `<strong>${esc(nameForPlayers(mover.document, L("ACreature")))}</strong>`;
	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker?.({ token: reactor.document }) ?? { alias: reactor.name },
		whisper: whisperFor(reactor.actor),
		content: pf2eCard({
			img: item?.img, title: item?.name ?? L("Name"), glyph: "R", who: reactor.name, open: sourceUuid(item), extraClass: "lucd20-ss-card",
			body: `<p>${L("Line", { name })}</p>`,
			buttons: [{ data: "lucd20-ss", value: "shove", icon: "fa-hand-back-fist", label: L("Shove") }, { data: "lucd20-ss", value: "skip", icon: "fa-xmark", label: L("Skip") }]
		}),
		flags: { [MODULE_ID]: { [FLAG]: {
			reactor: reactor.document.uuid, mover: mover.document.uuid, from: { x: from.x, y: from.y }, dest: { x: mover.document.x, y: mover.document.y },
			img: item?.img ?? null, title: item?.name ?? L("Name"), open: sourceUuid(item)
		} } }
	});
}

/** The owner's client: Shove (the GM rewinds the move first) or Skip. */
async function onClick(message, button) {
	const data = message.getFlag(MODULE_ID, FLAG);
	if (!data || data.done) return;
	const reactor = fromUuidSync(data.reactor), mover = fromUuidSync(data.mover);
	const actor = reactor?.actor;
	if (!actor || !(game.user.isGM || actor.isOwner)) return ui.notifications.warn(L("NotYours"));
	button.disabled = true;
	const use = button.dataset.lucd20Ss === "shove";
	const ok = await executeAsGM("pf2eShovingSweep.answer", { card: message.id, use }).catch((err) => { error("Shoving Sweep failed.", err); return false; });
	if (!use || !ok || !mover) return;
	mover.object?.setTarget?.(true, { releaseOthers: true, groupSelection: false });
	// (verify) PF2e 8.7: game.pf2e.actions is a Collection of Actions ("shove" → use()), with the legacy macro as a property.
	const shove = sysApi()?.actions?.get?.("shove");
	await (shove?.use ? shove.use({ actors: [actor] }) : sysApi()?.actions?.shove?.({ actors: [actor] }));
}

/** GM's client: once per card. */
async function answer({ card, use }, senderId) {
	const m = game.messages.get(card);
	const data = m?.getFlag(MODULE_ID, FLAG);
	if (!data || data.done) return false;
	const reactor = fromUuidSync(data.reactor), mover = fromUuidSync(data.mover);
	const sender = game.users.get(senderId);
	if (sender && !sender.isGM && !reactor?.actor?.testUserPermission?.(sender, "OWNER")) return false;
	await m.setFlag(MODULE_ID, FLAG, { ...data, done: true });
	if (!use) { await m.delete(); return true; }
	const reveal = reactor && !reactor.hidden;
	await m.update({
		content: compactCard({ img: data.img, title: data.title, glyph: "R", who: reveal ? nameForPlayers(reactor, L("ACreature")) : reactor?.name, open: data.open, extraClass: "lucd20-ss-card", result: L("Result") }),
		...(reveal ? { whisper: [] } : {})
	});
	const c = reactor ? combatantOfToken(reactor.object ?? { document: reactor }) : null;
	if (c && getFeature("pf2eReactions")?.isEnabled) await spendReaction(c, { source: data.title });
	if (!mover) return true;
	// The reaction interrupts the move: back to the square it was leaving (forced: nothing reacts to it).
	const moved = mover.x !== data.from.x || mover.y !== data.from.y;
	if (moved) await mover.update({ x: data.from.x, y: data.from.y }, { animate: false, [MODULE_ID]: { forced: true } });
	pending.set(mover.uuid, { by: data.reactor, dest: data.dest, at: data.from, until: Date.now() + WINDOW_MS, hidden: !!(mover.hidden || reactor?.hidden) });
	return true;
}

/** GM's client: the Shove of a pending sweep, after its dice. */
async function onShove(message) {
	if (!game.user.isActiveGM || !pending.size) return;
	const context = message?.flags?.[sysId()]?.context;
	if (context?.type !== "skill-check" || !(context.options ?? []).includes("action:shove") || context.isReroll) return;
	const targetUuid = context.target?.token;
	const p = pending.get(targetUuid);
	const by = context.origin?.token ?? message.token?.uuid ?? null;
	if (!p || p.until < Date.now() || (by && by !== p.by)) return;
	pending.delete(targetUuid);
	await waitForDice(message.id);
	const mover = fromUuidSync(targetUuid);
	if (!mover) return;
	const outcome = context.outcome;
	if (["failure", "criticalFailure"].includes(outcome) && mover.x === p.at.x && mover.y === p.at.y) {
		await mover.update({ x: p.dest.x, y: p.dest.y }, { animate: false, [MODULE_ID]: { forced: true } });
	}
	const key = outcome === "criticalSuccess" ? "Stops" : outcome === "success" ? "Continues" : "Resumes";
	await ChatMessage.create({
		content: `<p class="lucd20-rule-note"><i class="fa-solid fa-hand-back-fist"></i> ${L(key, { name: `<strong>${esc(nameForPlayers(mover, L("ACreature")))}</strong>` })}</p>`,
		speaker: { alias: localize("LUCD20.PF2eRules.Speaker") },
		whisper: p.hidden ? gmIds() : []
	});
}

defineFeature({
	id: "pf2eShovingSweep",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,

	init(feature) {
		onGMRequest("pf2eShovingSweep.answer", (payload, senderId) => (feature.active ? answer(payload, senderId) : false));
	},

	enable(feature) {
		feature.on("moveToken", onMoveToken);
		feature.on("createChatMessage", (message) => { onShove(message).catch((err) => error("Shoving Sweep failed.", err)); });
		feature.on("renderChatMessageHTML", (message, html) => {
			const data = message.getFlag?.(MODULE_ID, FLAG);
			if (!data) return;
			wireOpen(html);
			for (const b of html.querySelectorAll?.("[data-lucd20-ss]") ?? []) {
				if (data.done) { b.disabled = true; continue; }
				b.addEventListener("click", (event) => {
					event.preventDefault();
					if (feature.active) onClick(message, b).catch((err) => error("Shoving Sweep failed.", err));
				});
			}
		});
		feature.onCleanup(() => pending.clear());
	}
});

export const _test = { onMoveToken, onClick, answer, onShove, pending, recent, twoHandedMelee };
