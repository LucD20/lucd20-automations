import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { watchDOM } from "../../core/dom-watch.js";
import { onTurns } from "./rules.js";

/**
 * Rule 6 (docs/pf2e-rules.md): PF2e reactions, tracked (owner: "automate uses like PF2e Reactions
 * module does it"; Q160–Q163).
 * - One reaction per creature per round, refilled at the start of its turn (and when combat starts).
 * - Spent automatically by: a card of something whose cost is a reaction (an action or feat with
 *   actionType "reaction", a spell cast as a reaction), and a Strike or spell attack made outside the
 *   creature's own turn (Reactive Strike, a Readied Strike, a tactic's reaction). A reaction card
 *   followed by its Strike counts once. Tactic responses (Drilled Reactions) use `spendReaction`.
 * - Shown as a badge on the token (bottom-right; lit = available, grey = spent) and a mark in the
 *   Combat Tracker. Everyone who can see the token sees it (Q161). Owners and the GM click either to
 *   toggle it. Using a reaction with none left warns the GMs and the creature's owners.
 * Stored on the combatant: flags[MODULE_ID].reaction = { used, source }.
 */

const FLAG = "reaction";
const BADGE = "lucd20RxBadge";
const L = (key, data) => localize(`LUCD20.PF2eRules.Reaction.${key}`, data);
const recentCard = new Map(); // actor id → time of its last reaction card (its Strike then counts once)

const stateOf = (combatant) => combatant?.getFlag?.(MODULE_ID, FLAG) ?? { used: 0 };
export const hasReaction = (combatant) => (Number(stateOf(combatant).used) || 0) < 1;
const inCombat = (combatant) => !!combatant?.combat?.started;

/** The combatant of a chat message's actor in the active, started encounter. */
function combatantOf(message) {
	const combat = game.combat;
	if (!combat?.started) return null;
	const token = message.token ?? null;
	if (token?.combatant && token.combatant.combat === combat) return token.combatant;
	const actor = message.actor ?? (message.speaker?.actor ? game.actors?.get(message.speaker.actor) : null);
	return actor ? (combat.getCombatantsByActor?.(actor)?.[0] ?? null) : null;
}

async function setUsed(combatant, used, source = "") {
	if (!combatant) return;
	await combatant.setFlag(MODULE_ID, FLAG, { used, source });
}

/** Spend a reaction (exported for the commander's tactics). Warns when none is left. */
export async function spendReaction(combatant, { source = "" } = {}) {
	if (!combatant || !inCombat(combatant)) return false;
	if (!hasReaction(combatant)) {
		const owners = game.users.filter((u) => u.isGM || (!u.isGM && combatant.actor?.testUserPermission?.(u, "OWNER"))).map((u) => u.id);
		await ChatMessage.create({
			content: `<p class="lucd20-rule-note"><i class="fa-solid fa-rotate-left"></i> ${L("NoneLeft", { name: `<strong>${Handlebars.escapeExpression(combatant.name ?? "")}</strong>`, source: Handlebars.escapeExpression(source) })}</p>`,
			speaker: { alias: localize("LUCD20.PF2eRules.Speaker") },
			whisper: owners
		});
		return false;
	}
	await setUsed(combatant, 1, source);
	return true;
}

/** What a chat message says about reactions: "card" (a reaction's card), "strike" (an off-turn attack) or null. */
export function reactionUse(message) {
	const context = message?.flags?.pf2e?.context;
	const item = message?.item ?? null;
	const cost = item?.system?.actionType?.value ?? item?.system?.time?.value ?? null;
	if (!context && cost === "reaction") return "card";
	if (["attack-roll", "spell-attack-roll"].includes(context?.type) && !context.isReroll) return "strike";
	return null;
}

/** Active GM's client: spend reactions from what lands in chat. */
async function onMessage(message) {
	if (!game.user.isActiveGM) return;
	const kind = reactionUse(message);
	if (!kind) return;
	const combatant = combatantOf(message);
	if (!combatant) return;
	const actorId = combatant.actor?.id;
	if (kind === "card") {
		recentCard.set(actorId, Date.now());
		return spendReaction(combatant, { source: message.item?.name ?? "" });
	}
	// A Strike outside the creature's own turn is a reaction, unless its reaction card just came.
	if (combatant.combat.combatant?.id === combatant.id) return;
	if (Date.now() - (recentCard.get(actorId) ?? 0) < 30000) return void recentCard.delete(actorId);
	return spendReaction(combatant, { source: message.item?.name ?? L("Strike") });
}

/* -------------------------------------------- */
/*  Display                                     */
/* -------------------------------------------- */

const canToggle = (combatant) => !!combatant && (game.user.isGM || combatant.isOwner);
async function toggle(combatant) {
	if (!canToggle(combatant)) return;
	await setUsed(combatant, hasReaction(combatant) ? 1 : 0, "");
}

function combatantForToken(token) {
	const combat = game.combat;
	if (!combat?.started) return null;
	const c = token.document?.combatant ?? token.combatant ?? null;
	return c && c.combat === combat ? c : null;
}

/** The badge on a token: bottom-right; gold = available, grey = spent. */
export function drawBadge(token) {
	const old = token.children?.find?.((c) => c.name === BADGE);
	const combatant = combatantForToken(token);
	if (!feature?.active || !combatant || token.document?.hidden && !game.user.isGM) {
		if (old) { token.removeChild(old); old.destroy({ children: true }); }
		return;
	}
	const available = hasReaction(combatant);
	const signature = `${available}:${token.w}:${token.h}`;
	if (old?.lucd20Signature === signature) return;
	if (old) { token.removeChild(old); old.destroy({ children: true }); }
	const size = Math.max(16, Math.min(token.w, token.h) * 0.26);
	const badge = new PIXI.Container();
	badge.name = BADGE;
	badge.lucd20Signature = signature;
	badge.position.set(token.w - size * 0.55, token.h - size * 0.55);
	const disc = new PIXI.Graphics();
	disc.lineStyle(2, 0x000000, 0.9).beginFill(available ? 0xd9b26a : 0x5a5a5a, available ? 1 : 0.85).drawCircle(0, 0, size / 2).endFill();
	badge.addChild(disc);
	// The reaction symbol of PF2e's action font ("R"); (verify) the font family name in PF2e 8.7.
	const glyph = new PIXI.Text("R", { fontFamily: "Pathfinder2eActions", fontSize: size * 0.7, fill: available ? 0x1b1a18 : 0xcccccc });
	glyph.anchor.set(0.5);
	badge.addChild(glyph);
	if (!available) {
		const slash = new PIXI.Graphics();
		slash.lineStyle(2, 0xd33, 0.9).moveTo(-size * 0.35, size * 0.35).lineTo(size * 0.35, -size * 0.35);
		badge.addChild(slash);
	}
	badge.alpha = available ? 1 : 0.8;
	if (canToggle(combatant)) {
		badge.eventMode = "static";
		badge.cursor = "pointer";
		badge.on("pointerdown", (event) => {
			event.stopPropagation();
			toggle(combatant).catch((err) => error("Reaction toggle failed.", err));
		});
	} else badge.eventMode = "none";
	token.addChild(badge);
}

function refreshAll() {
	for (const token of canvas?.tokens?.placeables ?? []) drawBadge(token);
}

/** The mark in the Combat Tracker (sidebar and pop-out), kept in place by the DOM watcher. */
export function markTracker() {
	const combat = game.combat;
	for (const li of document.querySelectorAll("#combat [data-combatant-id], #combat-popout [data-combatant-id], .combat-sidebar [data-combatant-id]")) {
		const combatant = combat?.combatants?.get?.(li.dataset.combatantId);
		let mark = li.querySelector(".lucd20-rx");
		if (!feature?.active || !combatant || !combat.started) { mark?.remove(); continue; }
		const available = hasReaction(combatant);
		const state = available ? "on" : "off";
		if (mark?.dataset.state === state) continue;
		if (!mark) {
			mark = document.createElement("span");
			mark.className = "lucd20-rx";
			mark.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				toggle(game.combat?.combatants?.get?.(li.dataset.combatantId)).catch((err) => error("Reaction toggle failed.", err));
			});
			mark.addEventListener("dblclick", (event) => event.stopPropagation());
			(li.querySelector(".token-name") ?? li.querySelector("h4")?.parentElement ?? li).append(mark);
		}
		mark.dataset.state = state;
		mark.dataset.tooltip = L(available ? "Available" : "Spent");
		mark.innerHTML = `<span class="lucd20-rx-glyph">R</span>`;
	}
}

let feature = null;

defineFeature({
	id: "pf2eReactions",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,

	enable(f) {
		feature = f;
		f.on("createChatMessage", (message) => { onMessage(message).catch((err) => error("Reaction tracking failed.", err)); });
		// Refilled at the start of the creature's own turn; all fresh when the encounter starts.
		onTurns(f, { start: (combatant) => (hasReaction(combatant) ? null : setUsed(combatant, 0, "")) });
		f.on("combatStart", (combat) => {
			if (!game.user.isActiveGM) return;
			for (const c of combat.combatants ?? []) if (!hasReaction(c)) setUsed(c, 0, "").catch(() => {});
		});
		const redraw = () => { refreshAll(); markTracker(); };
		f.on("refreshToken", (token) => drawBadge(token));
		for (const hook of ["updateCombatant", "createCombatant", "deleteCombatant", "updateCombat", "deleteCombat", "combatStart", "canvasReady"]) f.on(hook, () => setTimeout(redraw, 0));
		f.onCleanup(watchDOM("pf2eReactions", markTracker));
		f.onCleanup(() => { feature = null; refreshAll(); markTracker(); });
		redraw();
	}
});

export const _test = { onMessage, reactionUse, drawBadge, markTracker, spendReaction, hasReaction, recentCard };
