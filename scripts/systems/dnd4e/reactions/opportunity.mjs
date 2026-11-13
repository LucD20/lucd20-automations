import { MODULE_ID } from "../constants.mjs";
import { F, L, setting, log, areEnemies, isDefeated, isRangedPower, isAreaPower, tokenForActor } from "../utils.mjs";
import { combatantForActor, getState } from "../actions/state.mjs";

/*
 * Opportunity attacks. An enemy provokes from you when, adjacent to you, it
 *  - leaves a square adjacent to you without shifting or teleporting, or
 *  - makes a ranged or area attack.
 * We whisper a chat card to whoever controls the threatening creature (its players and the GM)
 * with a button that makes its melee basic attack as an opportunity attack against the provoker.
 */

const NO_OPPORTUNITY = ["dazed", "stunned", "dominated", "helpless", "unconscious", "surprised", "dying", "dead", "removed"];
const SAFE_ACTIONS = ["shift", "teleport"];
const pendingOpportunity = new Map(); // actor uuid -> timestamp
const recentCards = new Map(); // dedupe key -> timestamp
const activeOpportunity = new Map(); // actor uuid -> timestamp: the next attack roll is an opportunity attack

/** Is this actor's attack being rolled from an opportunity card? (Defensive Mobility and the like) */
export function isOpportunityAttack(actor) {
	const t = activeOpportunity.get(actor?.uuid);
	return !!t && Date.now() - t < 120000;
}

export function clearOpportunityAttack(actor) {
	if (actor) activeOpportunity.delete(actor.uuid);
}

/** Was this power use started from an opportunity card? (consumed once) */
export function consumePendingOpportunity(actor) {
	const t = pendingOpportunity.get(actor?.uuid);
	if (!t) return false;
	pendingOpportunity.delete(actor.uuid);
	return Date.now() - t < 60000;
}

function canTakeOpportunity(token) {
	if (!token?.actor || token.document.hidden || isDefeated(token)) return false;
	if (NO_OPPORTUNITY.some((s) => token.actor.statuses?.has(s))) return false;
	const combatant = combatantForActor(token.actor);
	if (!combatant) return false;
	if (combatant.combat?.combatant?.id === combatant.id) return false; // not on its own turn
	return getState(combatant).used.opportunity < 1;
}

/** Grid offsets of a footprint at pixel position (x, y). */
function footprintAt(x, y, width, height) {
	const size = canvas.grid.size;
	const x0 = Math.round(x / size);
	const y0 = Math.round(y / size);
	return { x0, y0, x1: x0 + Math.max(1, Math.round(width)) - 1, y1: y0 + Math.max(1, Math.round(height)) - 1 };
}

function adjacent(fa, fb) {
	const dx = Math.max(0, fb.x0 - fa.x1, fa.x0 - fb.x1);
	const dy = Math.max(0, fb.y0 - fa.y1, fa.y0 - fb.y1);
	return Math.max(dx, dy) === 1;
}

function tokenFootprint(token) {
	const d = token.document;
	return footprintAt(d.x, d.y, d.width, d.height);
}

/** Expand waypoints into one entry per grid step, each tagged with the movement action used to enter it. */
function gridSteps(origin, waypoints) {
	const size = canvas.grid.size;
	const steps = [];
	let prev = origin;
	for (const wp of waypoints) {
		const ax = Math.round(prev.x / size), ay = Math.round(prev.y / size);
		const bx = Math.round(wp.x / size), by = Math.round(wp.y / size);
		const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
		for (let i = 1; i <= n; i++) {
			const gx = ax + Math.round(((bx - ax) * i) / n);
			const gy = ay + Math.round(((by - ay) * i) / n);
			steps.push({ x: gx * size, y: gy * size, action: wp.action });
		}
		prev = wp;
	}
	return steps;
}

/** Threatening tokens that the movement provoked from. */
function provokedByMovement(moverDoc, movement) {
	const mover = moverDoc.object;
	if (!mover) return [];
	const origin = movement.origin ?? movement.passed?.waypoints?.[0];
	const waypoints = movement.passed?.waypoints ?? [];
	if (!origin || !waypoints.length) return [];
	const w = moverDoc.width, h = moverDoc.height;
	const threats = canvas.tokens.placeables.filter((t) => t !== mover && areEnemies(mover, t) && canTakeOpportunity(t));
	if (!threats.length) return [];

	const provoked = new Set();
	let from = origin;
	for (const step of gridSteps(origin, waypoints)) {
		if (!SAFE_ACTIONS.includes(step.action)) {
			const fpFrom = footprintAt(from.x, from.y, w, h);
			for (const t of threats) if (adjacent(fpFrom, tokenFootprint(t))) provoked.add(t);
		}
		from = step;
	}
	return [...provoked];
}

function whisperTargets(actor) {
	const users = game.users.filter((u) => u.isGM || actor.testUserPermission(u, "OWNER"));
	return users.map((u) => u.id);
}

async function postCard(threat, provoker, reasonKey) {
	const key = `${game.combat?.id}:${game.combat?.round}:${game.combat?.turn}:${threat.id}:${provoker.id}`;
	const now = Date.now();
	for (const [k, entry] of recentCards) if (now - entry.time > 120000) recentCards.delete(k);
	// Don't repeat a card for the same provocation this turn, unless that card was deleted.
	const existing = recentCards.get(key);
	if (existing && (!existing.messageId || game.messages?.has(existing.messageId))) return;
	const entry = { time: now, messageId: null };
	recentCards.set(key, entry);

	const content = `
		<div class="d4ea-oa-card">
			<h3><i class="fa-solid fa-triangle-exclamation"></i> ${L("Opportunity.Title")}</h3>
			<p>${F(reasonKey, { provoker: provoker.name, threat: threat.name })}</p>
			<button type="button" class="d4ea-oa-attack" data-threat-scene="${threat.scene.id}" data-threat="${threat.id}" data-provoker="${provoker.id}">
				<i class="fa-solid fa-hand-fist"></i> ${F("Opportunity.Button", { threat: threat.name, provoker: provoker.name })}
			</button>
			<p class="d4ea-oa-note">${L("Opportunity.Note")}</p>
		</div>`;
	const message = await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ token: threat.document }),
		whisper: whisperTargets(threat.actor),
		content,
		flags: { [MODULE_ID]: { opportunity: { threat: threat.id, provoker: provoker.id } } },
	});
	entry.messageId = message?.id ?? null;
	log("opportunity card", threat.name, "<-", provoker.name, reasonKey);
}

/** moveToken hook (active GM only, to avoid duplicate cards). */
export function onMoveToken(tokenDoc, movement, operation) {
	if (!setting("opportunityAttacks") || !game.users.activeGM?.isSelf) return;
	if (operation?.[MODULE_ID]?.forced) return; // forced movement never provokes
	if (!game.combat?.started || !canvas.grid || canvas.grid.type !== CONST.GRID_TYPES.SQUARE) return;
	if (tokenDoc.parent !== canvas.scene) return;
	if (["undo", "config"].includes(movement?.method)) return;
	if (!tokenDoc.combatant) return;
	for (const threat of provokedByMovement(tokenDoc, movement)) {
		postCard(threat, tokenDoc.object, "Opportunity.ReasonMove");
	}
}

/** dnd4e.usePower hook (attacker's client): ranged and area attacks provoke from adjacent enemies. */
export function onUsePower(item) {
	if (!setting("opportunityAttacks") || !game.combat?.started) return;
	const sys = item?.system;
	if (!sys?.attack?.isAttack) return;
	const attacker = tokenForActor(item.actor);
	if (!attacker) return;
	const provokes = isAreaPower(item) || (sys.rangeType === "range") || (sys.rangeType === "weapon" && sys.weaponType === "ranged");
	if (!provokes) return;
	const fa = tokenFootprint(attacker);
	for (const threat of canvas.tokens.placeables) {
		if (threat === attacker || !areEnemies(attacker, threat) || !canTakeOpportunity(threat)) continue;
		if (adjacent(fa, tokenFootprint(threat))) postCard(threat, attacker, isAreaPower(item) ? "Opportunity.ReasonArea" : "Opportunity.ReasonRanged");
	}
}

export function meleeBasicAttack(actor) {
	const powers = actor.items.filter((i) => i.type === "power");
	return powers.find((i) => i.system.identifier === "melee-basic-attack")
		?? powers.find((i) => i.system.attack?.isBasic && ["melee", "weapon", "touch", "reach"].includes(i.system.rangeType) && i.system.weaponType !== "ranged")
		?? powers.find((i) => i.system.attack?.canOpp);
}

async function onAttackButton(ev) {
	const btn = ev.currentTarget;
	const scene = game.scenes.get(btn.dataset.threatScene);
	const threatDoc = scene?.tokens.get(btn.dataset.threat);
	const provokerDoc = scene?.tokens.get(btn.dataset.provoker);
	const actor = threatDoc?.actor;
	if (!actor) return;
	if (!actor.isOwner) return ui.notifications.warn(L("Opportunity.NotOwner"));
	const power = meleeBasicAttack(actor);
	if (!power) return ui.notifications.warn(F("Opportunity.NoBasic", { name: actor.name }));
	if (provokerDoc?.object) provokerDoc.object.setTarget(true, { releaseOthers: true });
	pendingOpportunity.set(actor.uuid, Date.now());
	activeOpportunity.set(actor.uuid, Date.now());
	if (typeof actor.usePower === "function") await actor.usePower(power, { configureDialog: true, fastForward: false, variance: { isOpp: true } });
	else await power.roll({ variance: { isOpp: true } });
}

/**
 * The button follows the creature's opportunity action: disabled while it's spent (or the creature
 * can't act), enabled again if the GM/player turns the Opportunity pip back on.
 */
function syncButton(btn) {
	const scene = game.scenes.get(btn.dataset.threatScene);
	const threatDoc = scene?.tokens.get(btn.dataset.threat);
	const token = threatDoc?.object;
	btn.dataset.label ??= btn.innerHTML;
	const available = !token || canTakeOpportunity(token);
	btn.disabled = !available;
	btn.classList.toggle("spent", !available);
	btn.innerHTML = available ? btn.dataset.label : `<i class="fa-solid fa-ban"></i> ${L("Opportunity.Used")}`;
}

export function syncOpportunityButtons() {
	document.querySelectorAll(".d4ea-oa-attack").forEach(syncButton);
}

export function registerOpportunityHooks() {
	Hooks.on("moveToken", onMoveToken);
	Hooks.on("renderChatMessageHTML", (message, html) => {
		if (!message.flags?.[MODULE_ID]?.opportunity) return;
		html.querySelectorAll(".d4ea-oa-attack").forEach((b) => {
			b.addEventListener("click", onAttackButton);
			syncButton(b);
		});
	});
	const resync = () => setTimeout(syncOpportunityButtons, 50);
	Hooks.on("updateCombatant", resync);
	Hooks.on("combatTurnChange", resync);
	Hooks.on("updateCombat", resync);
	Hooks.on("createActiveEffect", resync);
	Hooks.on("deleteActiveEffect", resync);
}
