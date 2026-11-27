import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature, getFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { waitForDice } from "../../core/dice.js";
import { hasReaction } from "./reactions.js";
import { pf2eCard, wireOpen, sourceUuid, itemBySlug, compactCard, nameForPlayers } from "./card.js";
import { shing } from "../../core/sound.js";
import { sysId } from "./sys.js";

/**
 * Rule 7 (docs/pf2e-rules.md): Reactive Strike prompts. Trigger (PF2e): "A creature within your reach
 * uses a manipulate action or a move action, makes a ranged attack, or leaves a square during a move
 * action it's using." Melee Strike against it, no multiple attack penalty; a critical hit against a
 * manipulate action disrupts it. Step never triggers it.
 * Owner's choices (Q164–Q168):
 * - Every move that leaves a square in reach prompts; the card reminds that a Step doesn't (Foundry
 *   can't tell a Step from a 5-ft Stride).
 * - The card goes to the reactor's owners and the GM; a monster's to the GM only.
 * - While dragging a token in combat, everyone sees which enemies' reach the move leaves (any enemy,
 *   whether or not it has Reactive Strike: reach only, no ability is revealed).
 * - The card has one button per melee Strike (targeting the trigger, no MAP) and Skip; all four
 *   triggers are detected. Only creatures with Reactive Strike and their reaction left get a card.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.Reactive.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const SLUGS = new Set(["reactive-strike", "attack-of-opportunity"]);
const NAMES = /^(reactive strike|attack of opportunity)$/i;
const NO_REACT = ["unconscious", "dying", "dead", "paralyzed", "petrified", "stunned", "restrained", "grabbed-immobile"];
const COLOR = 0xff5a3d;
const recent = new Map(); // dedupe key → time
const warn = { layer: null, serial: 0, marked: new Set(), feature: null };

/* -------------------------------------------- */
/*  Geometry (PF2e: 5-10-5 diagonals; 10-ft reach takes two diagonal squares)   */
/* -------------------------------------------- */

const cellsAt = (x, y, w, h) => {
	const size = canvas.grid.size;
	const x0 = Math.round(x / size), y0 = Math.round(y / size);
	return { x0, y0, x1: x0 + Math.max(1, Math.round(w)) - 1, y1: y0 + Math.max(1, Math.round(h)) - 1 };
};
const cellsOf = (doc) => cellsAt(doc.x, doc.y, doc.width, doc.height);

/** Distance in feet between two footprints, PF2e counting. */
export function feetBetween(a, b) {
	const dx = Math.max(0, b.x0 - a.x1, a.x0 - b.x1);
	const dy = Math.max(0, b.y0 - a.y1, a.y0 - b.y1);
	return 5 * (Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2));
}

/** Within reach: by distance, and the 10-foot reach exception (two squares diagonally). */
export function withinReach(a, b, reach) {
	const dx = Math.max(0, b.x0 - a.x1, a.x0 - b.x1);
	const dy = Math.max(0, b.y0 - a.y1, a.y0 - b.y1);
	if (dx === 0 && dy === 0) return true;
	if (reach === 10 && dx <= 2 && dy <= 2) return true;
	return feetBetween(a, b) <= reach;
}

/**
 * A creature's melee reach in feet: PF2e's `getReach({ action: "attack" })` (its ready Strikes, reach traits),
 * never less than the base reach (v0.75.1: Enlarge sets the base reach to 10 through CreatureSize).
 */
export function reachOf(actor) {
	const base = Number(actor?.system?.attributes?.reach?.base) || 0;
	let attack = 0;
	try {
		attack = Number(actor?.getReach?.({ action: "attack" })) || 0;
	} catch (err) { /* fall through */ }
	return Math.max(attack, base) || 5;
}

export const enemies = (a, b) => {
	const da = a.document?.disposition, db = b.document?.disposition;
	return (da === 1 && db === -1) || (da === -1 && db === 1);
};
export const down = (actor) => NO_REACT.some((s) => actor?.hasCondition?.(s) || actor?.statuses?.has?.(s)) || (Number(actor?.system?.attributes?.hp?.value) <= 0 && actor?.system?.attributes?.hp?.max > 0);

/** Does this creature have Reactive Strike (or the old Attack of Opportunity)? */
export function hasReactiveStrike(actor) {
	return (actor?.items ?? []).some((i) => i.type === "action" && (SLUGS.has(i.slug ?? i.system?.slug) || NAMES.test(i.name ?? "")));
}

export function combatantOfToken(token) {
	const combat = game.combat;
	if (!combat?.started) return null;
	const c = token.document?.combatant ?? token.combatant ?? null;
	return c && c.combat === combat ? c : null;
}

/** Tokens that could react to `trigger` now (Reactive Strike, reaction left, hostile, can act). */
function reactors(trigger) {
	return (canvas.tokens?.placeables ?? []).filter((t) => t !== trigger && t.actor && enemies(trigger, t) && !down(t.actor)
		&& hasReactiveStrike(t.actor) && combatantOfToken(t) && (!getFeature("pf2eReactions")?.isEnabled || hasReaction(combatantOfToken(t))));
}

/** Expand waypoints into grid steps. */
function gridSteps(origin, waypoints) {
	const size = canvas.grid.size;
	const steps = [];
	let prev = origin;
	for (const wp of waypoints) {
		const ax = Math.round(prev.x / size), ay = Math.round(prev.y / size);
		const bx = Math.round(wp.x / size), by = Math.round(wp.y / size);
		const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
		for (let i = 1; i <= n; i++) steps.push({ x: (ax + Math.round(((bx - ax) * i) / n)) * size, y: (ay + Math.round(((by - ay) * i) / n)) * size, action: wp.action });
		prev = wp;
	}
	return steps;
}
const NO_TRIGGER_ACTIONS = ["blink", "displace"]; // teleport, forced movement

/** Along a path: Map(token → square left in its reach). `among` decides who counts. */
export function leftReach(mover, origin, waypoints, among) {
	const out = new Map();
	if (!mover || !origin || !waypoints?.length) return out;
	const w = mover.document.width, h = mover.document.height;
	let from = origin;
	for (const step of gridSteps(origin, waypoints)) {
		if (!NO_TRIGGER_ACTIONS.includes(step.action)) {
			const a = cellsAt(from.x, from.y, w, h);
			for (const t of among) if (!out.has(t) && withinReach(cellsOf(t.document), a, reachOf(t.actor))) out.set(t, { x: from.x, y: from.y });
		}
		from = step;
	}
	return out;
}

/* -------------------------------------------- */
/*  Cards                                       */
/* -------------------------------------------- */

const shownName = (token) => (token?.document?.playersCanSeeName === false ? L("ACreature") : (token?.name ?? token?.document?.name ?? ""));

function whisperFor(actor) {
	const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
	const owners = game.users.filter((u) => !u.isGM && u.active && actor?.testUserPermission?.(u, "OWNER")).map((u) => u.id);
	// A monster's card: the GMs only (players never learn who has Reactive Strike).
	return actor?.hasPlayerOwner ? [...new Set([...owners, ...gms])] : gms;
}

/** Melee Strikes of a creature: [{ index, label }]. */
function meleeStrikes(actor) {
	return (actor?.system?.actions ?? []).map((a, index) => ({ a, index }))
		.filter(({ a }) => a?.type === "strike" && a.ready !== false && (a.item?.isMelee ?? !a.item?.isRanged))
		.map(({ a, index }) => ({ index, label: a.label ?? a.item?.name ?? "Strike" }));
}

/** Active GM's client: post one card per reactor and trigger (not twice for the same within 15 s). */
export async function postCard(reactor, trigger, kind, detail = "") {
	const key = `${game.combat?.id}:${game.combat?.round}:${reactor.id}:${trigger.id}:${kind}`;
	const now = Date.now();
	for (const [k, t] of recent) if (now - t > 60000) recent.delete(k);
	if (now - (recent.get(key) ?? 0) < 15000) return null;
	recent.set(key, now);
	const strikes = meleeStrikes(reactor.actor);
	const name = `<strong>${esc(shownName(trigger))}</strong>`;
	const reason = L(`Reason.${kind}`, { name, detail: esc(detail) });
	const item = itemBySlug(reactor.actor, [...SLUGS], NAMES);
	// v0.47.1 (owner): PF2e's card style, buttons side by side, a click on the card opens the entry.
	const content = pf2eCard({
		img: item?.img, title: item?.name ?? L("Name"), glyph: "R", who: reactor.name, open: sourceUuid(item), extraClass: "lucd20-rs-card",
		body: `<p>${reason}</p>`,
		buttons: [...strikes.map((s) => ({ data: "lucd20-rs", value: s.index, icon: "fa-hand-fist", label: s.label })), { data: "lucd20-rs", value: "skip", icon: "fa-xmark", label: L("Skip") }]
	});
	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker?.({ token: reactor.document }) ?? { alias: reactor.name },
		whisper: whisperFor(reactor.actor),
		content,
		flags: { [MODULE_ID]: { reactiveStrike: { reactor: reactor.document.uuid, trigger: trigger.document.uuid, kind, detail, img: item?.img ?? null, title: item?.name ?? L("Name"), open: sourceUuid(item) } } }
	});
}

/** The owner's client: Strike (targeting the trigger, no MAP) or Skip. */
async function onCardClick(message, button) {
	const data = message.getFlag(MODULE_ID, "reactiveStrike");
	if (!data || data.done) return;
	const reactorDoc = fromUuidSync(data.reactor), triggerDoc = fromUuidSync(data.trigger);
	const actor = reactorDoc?.actor;
	if (!actor || !(game.user.isGM || actor.isOwner)) return ui.notifications.warn(L("NotYours"));
	button.disabled = true;
	await executeAsGM("pf2eRules.rsDone", { id: message.id, used: button.dataset.lucd20Rs !== "skip" }).catch(() => {});
	if (button.dataset.lucd20Rs === "skip") return;
	const strike = actor.system?.actions?.[Number(button.dataset.lucd20Rs)];
	if (!strike) return;
	triggerDoc?.object?.setTarget?.(true, { releaseOthers: true, groupSelection: false });
	// The first variant: no multiple attack penalty. The off-turn Strike spends the reaction (rule 6).
	const roll = await strike.variants?.[0]?.roll?.({ event: new MouseEvent("click") });
	const degree = Number(roll?.degreeOfSuccess ?? roll?.options?.degreeOfSuccess);
	if (data.kind === "manipulate" && degree === 3) {
		const last = (game.messages?.contents ?? []).filter((m) => (m.author?.id ?? m.user?.id) === game.user.id && m.rolls?.length).at(-1);
		await waitForDice(last?.id);
		await ChatMessage.create({
			content: `<p class="lucd20-rule-note"><i class="fa-solid fa-ban"></i> ${L("Disrupted", { name: `<strong>${esc(triggerDoc?.name ?? "")}</strong>`, detail: esc(data.detail) })}</p>`,
			speaker: { alias: localize("LUCD20.PF2eRules.Speaker") },
			whisper: game.users.filter((u) => u.isGM).map((u) => u.id)
		});
	}
}

/* -------------------------------------------- */
/*  Triggers                                    */
/* -------------------------------------------- */

/** CONFIG.debug.lucd20Rules = true: why each creature with Reactive Strike does or doesn't get a card. */
function debugMove(mover, origin, movement) {
	const waypoints = movement?.passed?.waypoints ?? [];
	const rows = (canvas.tokens?.placeables ?? []).filter((t) => t !== mover && t.actor && hasReactiveStrike(t.actor)).map((t) => {
		const c = combatantOfToken(t);
		return {
			name: t.name, footprint: cellsOf(t.document), reach: reachOf(t.actor), getReach: (() => { try { return t.actor.getReach?.({ action: "attack" }); } catch (err) { return String(err); } })(),
			baseReach: t.actor.system?.attributes?.reach?.base, enemy: enemies(mover, t), down: down(t.actor), inCombat: !!c,
			reaction: !getFeature("pf2eReactions")?.isEnabled || (c ? hasReaction(c) : false),
			left: leftReach(mover, origin, waypoints, [t]).get(t) ?? null
		};
	});
	console.log(`${MODULE_ID} | Reactive Strike move`, { mover: mover.name, moverFootprint: cellsOf(mover.document), origin, waypoints, method: movement?.method, reactors: rows });
}

/** A move in combat (active GM): cards for every reactor whose reach it left. */
export function onMoveToken(doc, movement, operation) {
	if (!game.user.isActiveGM || !game.combat?.started || doc.parent !== canvas.scene) return;
	if (operation?.[MODULE_ID]?.forced || ["undo", "config"].includes(movement?.method)) return;
	const mover = doc.object;
	if (!mover) return;
	const origin = movement?.origin ?? movement?.passed?.waypoints?.[0];
	if (CONFIG.debug?.lucd20Rules) debugMove(mover, origin, movement);
	for (const [reactor] of leftReach(mover, origin, movement?.passed?.waypoints ?? [], reactors(mover))) {
		postCard(reactor, mover, "move").catch((err) => error("Reactive Strike card failed.", err));
	}
}

/** What a chat message triggers: "ranged", "manipulate", "moveAction" or null, with a detail. */
export function messageTrigger(message) {
	const context = message?.flags?.[sysId()]?.context;
	const item = message?.item ?? null;
	if (["attack-roll", "spell-attack-roll"].includes(context?.type)) {
		const ranged = (context.options ?? []).includes("item:ranged") || item?.isRanged === true;
		return ranged && !context.isReroll ? { kind: "ranged", detail: item?.name ?? "" } : null;
	}
	if (context || !item) return null;
	const traits = item.system?.traits?.value ?? [];
	const slug = item.slug ?? item.system?.slug ?? "";
	if (traits.includes("manipulate")) return { kind: "manipulate", detail: item.name };
	if (traits.includes("move") && !["step", "stride"].includes(slug)) return { kind: "moveAction", detail: item.name };
	return null;
}

async function onMessage(message) {
	if (!game.user.isActiveGM || !game.combat?.started) return;
	const found = messageTrigger(message);
	if (!found) return;
	const trigger = message.token?.object ?? message.actor?.getActiveTokens?.()?.[0] ?? null;
	if (!trigger || trigger.document?.parent !== canvas.scene) return;
	const here = cellsOf(trigger.document);
	for (const reactor of reactors(trigger)) {
		if (withinReach(cellsOf(reactor.document), here, reachOf(reactor.actor))) await postCard(reactor, trigger, found.kind, found.detail);
	}
}

/* -------------------------------------------- */
/*  The warning while dragging (Q166: everyone, any enemy, reach only)      */
/* -------------------------------------------- */

function clearWarning() {
	warn.serial++;
	warn.marked = new Set();
	warn.layer?.destroy({ children: true });
	warn.layer = null;
}

function drawWarning(mover, marks) {
	warn.layer?.destroy({ children: true });
	warn.layer = null;
	// The "shing" when another enemy's reach would be left (per-player option, v0.47.2).
	const before = warn.marked;
	warn.marked = new Set(marks.keys());
	if (warn.feature?.get("sound") && [...warn.marked].some((t) => !before.has(t))) shing();
	if (!marks.size) return;
	const size = canvas.grid.size;
	const layer = new PIXI.Container();
	layer.eventMode = "none";
	for (const [threat, from] of marks) {
		const a = { x: threat.document.x + (threat.document.width * size) / 2, y: threat.document.y + (threat.document.height * size) / 2 };
		const b = { x: from.x + (mover.document.width * size) / 2, y: from.y + (mover.document.height * size) / 2 };
		const g = new PIXI.Graphics();
		g.lineStyle(Math.max(3, size / 18), COLOR, 0.9).moveTo(a.x, a.y).lineTo(b.x, b.y);
		const r = size * 0.16;
		const corner = { x: threat.document.x + threat.document.width * size - r, y: threat.document.y + r };
		g.lineStyle(2, 0x000000, 0.8).beginFill(COLOR, 1).drawCircle(corner.x, corner.y, r).endFill();
		const mark = new PIXI.Text("!", { fontFamily: "Signika, sans-serif", fontSize: r * 1.7, fontWeight: "900", fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 });
		mark.anchor.set(0.5);
		mark.position.set(corner.x, corner.y);
		layer.addChild(g, mark);
	}
	const parent = canvas.controls ?? canvas.interface ?? canvas.stage;
	layer.zIndex = 10000;
	parent.addChild(layer);
	if (parent.sortableChildren) parent.sortChildren?.();
	warn.layer = layer;
}

/** A path search for a dragged token: mark the enemies (this user can see) whose reach it leaves. */
export async function onPath(token, search) {
	const serial = ++warn.serial;
	if (!game.combat?.started || !token?.document?.combatant) return drawWarning(token, new Map());
	let path = search?.result;
	if (!Array.isArray(path)) {
		try { path = await search?.promise; } catch (err) { path = null; }
	}
	if (serial !== warn.serial) return;
	if (!Array.isArray(path) || path.length < 2) return drawWarning(token, new Map());
	const among = (canvas.tokens?.placeables ?? []).filter((t) => t !== token && t.actor && enemies(token, t) && !down(t.actor) && (game.user.isGM || t.visible));
	drawWarning(token, leftReach(token, path[0], path.slice(1), among));
}

defineFeature({
	id: "pf2eReactiveStrike",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,
	settings: {
		sound: { kind: "boolean", default: true, scope: "client" }
	},

	init(feature) {
		onGMRequest("pf2eRules.rsDone", async ({ id, used }) => {
			const message = game.messages.get(id);
			const data = message?.getFlag(MODULE_ID, "reactiveStrike");
			if (!data || data.done) return false;
			await message.setFlag(MODULE_ID, "reactiveStrike", { ...data, done: true });
			if (!used) {
				await message.delete(); // v0.50.1 (owner): not used, no trace in the chat
				return true;
			}
			// v0.47.2 (owner): used, the card shows only the reaction's name and symbol, to everyone (a hidden
			// token's stays with the GM; the speaker is named as players may see it).
			const reactor = fromUuidSync(data.reactor);
			const reveal = reactor && !reactor.hidden;
			await message.update({
				content: compactCard({ img: data.img, title: data.title, glyph: "R", who: reveal ? nameForPlayers(reactor, L("ACreature")) : reactor?.name, open: data.open, extraClass: "lucd20-rs-card", result: L("Struck") }),
				...(reveal ? { whisper: [], speaker: { ...(message.speaker ?? {}), alias: nameForPlayers(reactor, L("ACreature")) } } : {})
			});
			return true;
		});
	},

	enable(feature) {
		warn.feature = feature;
		feature.on("moveToken", onMoveToken);
		feature.on("createChatMessage", (message) => { onMessage(message).catch((err) => error("Reactive Strike failed.", err)); });
		feature.on("renderChatMessageHTML", (message, html) => {
			const data = message.getFlag?.(MODULE_ID, "reactiveStrike");
			if (data) wireOpen(html);
			for (const button of html.querySelectorAll?.("[data-lucd20-rs]") ?? []) {
				if (data?.done) { button.disabled = true; continue; }
				button.addEventListener("click", (event) => {
					event.preventDefault();
					if (feature.active) onCardClick(message, button).catch((err) => error("Reactive Strike failed.", err));
				});
			}
		});
		// The warning while a token is dragged.
		feature.on("lucd20MovementPath", onPath);
		const TokenClass = CONFIG.Token?.objectClass;
		if (typeof TokenClass?.prototype?.findMovementPath === "function") {
			feature.wrap(TokenClass.prototype, "findMovementPath", function (original, waypoints, options) {
				const search = original(waypoints, options);
				onPath(this, search);
				return search;
			});
		}
		for (const hook of ["moveToken", "combatTurnChange", "canvasTearDown"]) feature.on(hook, clearWarning);
		const onKey = (event) => { if (event.key === "Escape") clearWarning(); };
		window.addEventListener("pointerup", clearWarning, true);
		window.addEventListener("contextmenu", clearWarning, true);
		window.addEventListener("keydown", onKey, true);
		feature.onCleanup(() => {
			window.removeEventListener("pointerup", clearWarning, true);
			window.removeEventListener("contextmenu", clearWarning, true);
			window.removeEventListener("keydown", onKey, true);
			clearWarning();
		});
	}
});

export const _test = { onMessage, onMoveToken, onPath, postCard, onCardClick, warn, recent };
