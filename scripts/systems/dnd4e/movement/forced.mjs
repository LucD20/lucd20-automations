import { MODULE_ID, SOCKET } from "../constants.mjs";
import { F, L, setting, log, tokenForActor, areAllies, areEnemies, isDefeated, gridDistance } from "../utils.mjs";
import { pickMovement } from "./picker.mjs";
import { freeShiftFor, freeShiftTiming } from "../actions/free-shift.mjs";
import { combatantForActor, isCombatantsTurn, spend, getState } from "../actions/state.mjs";
import { meleeBasicAttack } from "../reactions/opportunity.mjs";
import { addPendingAttackMod } from "../features/conditional.mjs";
import { markFreeUse } from "../actions/hooks.mjs";
import { forcedMovesFor, allyShiftsFor } from "./parse.mjs";

/*
 * Movement chosen on the map (see picker.mjs):
 *   - Forced movement in a power's text: "push/pull/slide the target N squares",
 *     "o alvo é empurrado/puxado/conduzido N quadrados". After the attack (and Dice So Nice) the
 *     attacker picks the square for each target; skipping leaves a button in chat for later.
 *   - Free shifts of the power's user ("Shift 1 square before or after you attack"): picker right away;
 *     a shift that only comes after the attack ("Effect: The wolf shifts up to 4 squares") waits for the roll.
 *   - Shifts granted to allies ("the target/an ally can shift N squares"): the ally's player picks.
 *   - "During the slide, you or an ally can make a melee basic attack" (Blunder): a chat card with a
 *     button per creature that can make that attack, with its power bonus.
 *   - "You can slide the target 1 square as a minor action" (Curse of the Dark Dream): a button at the
 *     start of the warlock's turn.
 */

/* -------------------------------------------- */
/*  After an attack                               */
/* -------------------------------------------- */

export async function onAttackRolled(itemData, targetData, actor) {
	if (!setting("clickMovement") || !actor) return;
	const item = (itemData?.uuid ? fromUuidSync(itemData.uuid) : null) ?? itemData;
	const attacker = tokenForActor(actor);
	if (!attacker) return;
	const groups = { hit: targetData?.targetHit ?? [], miss: targetData?.targetMissed ?? [], effect: targetData?.targets ?? [] };
	const later = shiftAfter.get(actor.uuid);
	shiftAfter.delete(actor.uuid);
	for (const move of forcedMovesFor(item)) {
		for (const target of groups[move.when]) await offerForced({ power: item.name, attacker, target, move });
	}
	for (const shift of allyShiftsFor(item)) {
		for (const target of groups[shift.when]) if (target !== attacker && areAllies(attacker, target)) requestShift(target, shift.squares, item.name);
	}
	if (later && Date.now() - later.time < 10 * 60 * 1000 && !isDefeated(attacker)) {
		await pickMovement({ token: attacker, mode: "shift", squares: later.squares, power: item.name, moveOptions: { countMovement: later.count } });
	}
}

const shiftAfter = new Map(); // actor uuid -> { squares, count, time }: free shift to pick once the attack is rolled

/** Non-attack powers (e.g. Majestic Word: "you also slide the target 1 square"), and free shifts. */
export async function onUsePower(item, actor) {
	if (!setting("clickMovement")) return false;
	const me = tokenForActor(actor);
	if (!me) return false;
	// Free shift of the user (Nimble Strike, Fox's Cunning, Pressing Strike...)
	const free = freeShiftFor(item);
	if (free) {
		const combatant = combatantForActor(actor);
		const count = !!combatant?.combat?.started && isCombatantsTurn(combatant);
		// In combat the tracker already refunded a shift made just before the power: nothing left to pick
		const available = !count || (getState(combatant).freeShift || 0) > 0;
		if (available && freeShiftTiming(item) === "after") shiftAfter.set(actor.uuid, { squares: free, count, time: Date.now() });
		else if (available) pickMovement({ token: me, mode: "shift", squares: free, power: item.name, moveOptions: { countMovement: count } });
	}
	if (item.system?.attack?.isAttack) return false; // forced movement waits for the attack result
	const targets = Array.from(game.user.targets).filter((t) => t.actor);
	for (const move of forcedMovesFor(item)) {
		if (move.when === "miss") continue;
		for (const target of targets) await offerForced({ power: item.name, attacker: me, target, move });
	}
	for (const shift of allyShiftsFor(item)) {
		for (const target of targets) if (target !== me && areAllies(me, target)) requestShift(target, shift.squares, item.name);
	}
	return false;
}

/* -------------------------------------------- */
/*  Forced movement                               */
/* -------------------------------------------- */

async function offerForced({ power, attacker, target, move }) {
	if (!target?.document || target.destroyed || isDefeated(target)) return;
	const before = { x: target.document.x, y: target.document.y };
	const result = await pickMovement({
		token: target, mode: move.mode, squares: move.squares, source: attacker, power,
		moveOptions: { forced: true },
	});
	if (result.moved) {
		if (move.followUp) {
			await settle(target, before);
			await postFollowUpCard({ power, attacker, target, bonus: move.followUp.bonus });
		}
		return;
	}
	await postForcedCard({ power, attacker, target, move });
}

/** Wait for a move made by the GM (socket) to land before looking at who is adjacent. */
async function settle(token, start) {
	for (let i = 0; i < 20; i++) {
		if (token.document.x !== start.x || token.document.y !== start.y) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	await (token.movementAnimationPromise ?? Promise.resolve());
}

/** Skipped: leave a button in chat to do it later. */
async function postForcedCard({ power, attacker, target, move }) {
	const label = F(`Move.Button.${move.mode}`, { name: target.name, squares: move.squares });
	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ token: attacker.document }),
		whisper: [game.user.id],
		content: `<div class="d4ea-move-card">
			<p><strong>${foundry.utils.escapeHTML(power)}</strong></p>
			<button type="button" class="d4ea-move-later"><i class="fa-solid fa-arrows-up-down-left-right"></i> ${foundry.utils.escapeHTML(label)}</button>
		</div>`,
		flags: { [MODULE_ID]: { forcedMove: { power, attacker: attacker.document.uuid, target: target.document.uuid, ...move } } },
	});
}

async function onLaterButton(message, btn) {
	const data = message.getFlag(MODULE_ID, "forcedMove");
	const attacker = fromUuidSync(data?.attacker)?.object;
	const target = fromUuidSync(data?.target)?.object;
	if (!attacker || !target) return ui.notifications.warn(L("Move.TokenGone"));
	btn.disabled = true;
	const before = { x: target.document.x, y: target.document.y };
	const result = await pickMovement({ token: target, mode: data.mode, squares: data.squares, source: attacker, power: data.power, moveOptions: { forced: true } });
	if (!result.moved) {
		btn.disabled = false;
		return;
	}
	if (data.followUp) await settle(target, before);
	if (data.followUp) await postFollowUpCard({ power: data.power, attacker, target, bonus: data.followUp.bonus });
	await message.update({ content: `<div class="d4ea-move-card"><p><strong>${foundry.utils.escapeHTML(data.power)}</strong></p><p><i class="fa-solid fa-check"></i> ${foundry.utils.escapeHTML(F(`Move.Done.${data.mode}`, { name: target.name }))}</p></div>`, [`flags.${MODULE_ID}.forcedMove.done`]: true });
}

/* -------------------------------------------- */
/*  "You or an ally can make a melee basic attack against the target" (Blunder)  */
/* -------------------------------------------- */

async function postFollowUpCard({ power, attacker, target, bonus }) {
	const candidates = canvas.tokens.placeables.filter((t) => t.actor && !t.document.hidden && !isDefeated(t)
		&& (t === attacker || areAllies(attacker, t)) && areEnemies(t, target) && gridDistance(t, target) <= 1 && meleeBasicAttack(t.actor));
	if (!candidates.length) return;
	const buttons = candidates.map((t) => `<button type="button" class="d4ea-followup" data-token="${t.document.uuid}">
		<i class="fa-solid fa-hand-fist"></i> ${foundry.utils.escapeHTML(F("Move.FollowUpButton", { name: t.name, bonus }))}</button>`).join("");
	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ token: attacker.document }),
		content: `<div class="d4ea-move-card d4ea-followup-card">
			<p><strong>${foundry.utils.escapeHTML(power)}</strong>: ${foundry.utils.escapeHTML(F("Move.FollowUp", { target: target.name, bonus }))}</p>
			${buttons}
		</div>`,
		flags: { [MODULE_ID]: { followUp: { power, target: target.document.uuid, bonus } } },
	});
}

async function onFollowUpButton(message, btn) {
	const data = message.getFlag(MODULE_ID, "followUp");
	if (data?.used) return;
	const tokenDoc = fromUuidSync(btn.dataset.token);
	const actor = tokenDoc?.actor;
	const target = fromUuidSync(data?.target)?.object;
	if (!actor || !target) return ui.notifications.warn(L("Move.TokenGone"));
	if (!actor.isOwner) return ui.notifications.warn(L("Opportunity.NotOwner"));
	const power = meleeBasicAttack(actor);
	if (!power) return ui.notifications.warn(F("Opportunity.NoBasic", { name: actor.name }));
	target.setTarget(true, { releaseOthers: true });
	if (data.bonus) addPendingAttackMod(actor, { key: "followUp", label: data.power, value: data.bonus, type: "power" });
	markFreeUse(actor);
	if (message.canUserModify(game.user, "update")) await message.setFlag(MODULE_ID, "followUp.used", true);
	if (typeof actor.usePower === "function") await actor.usePower(power, { configureDialog: true, fastForward: false });
	else await power.roll();
}

/* -------------------------------------------- */
/*  Shifts granted to allies                      */
/* -------------------------------------------- */

/** The user who should pick for a token: an active player owning it, else the active GM. */
function pickerUserFor(actor) {
	return game.users.find((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER")) ?? game.users.activeGM;
}

export function requestShift(target, squares, power) {
	const user = pickerUserFor(target.actor);
	if (!user) return;
	const payload = { op: "pickShift", userId: user.id, tokenUuid: target.document.uuid, squares, power };
	if (user.isSelf) return handlePickShiftSocket(payload);
	game.socket.emit(SOCKET, payload);
}

export function handlePickShiftSocket(payload) {
	if (payload.userId !== game.user.id) return;
	const token = fromUuidSync(payload.tokenUuid)?.object;
	if (!token) return;
	// The ally's own shift: no action spent (granted by the power), no opportunity attacks
	pickMovement({ token, mode: "shift", squares: payload.squares, power: payload.power, moveOptions: { forced: true } });
}

/* -------------------------------------------- */
/*  "You can slide the target 1 square as a minor action" (Curse of the Dark Dream)  */
/* -------------------------------------------- */

/** combatTurnChange (active GM): remind the owner at the start of their turn. */
async function onTurnStart(combat) {
	if (!setting("clickMovement") || !game.users.activeGM?.isSelf) return;
	const actor = combat.combatant?.actor;
	if (!actor) return;
	for (const token of canvas.tokens.placeables) {
		for (const e of token.actor?.effects ?? []) {
			const f = e.flags?.[MODULE_ID];
			if (!f?.minorSlide || f.source !== actor.uuid || e.disabled) continue;
			const owners = game.users.filter((u) => u.isGM || actor.testUserPermission(u, "OWNER")).map((u) => u.id);
			await ChatMessage.create({
				speaker: ChatMessage.getSpeaker({ actor }),
				whisper: owners,
				content: `<div class="d4ea-move-card">
					<p><strong>${foundry.utils.escapeHTML(e.name)}</strong></p>
					<button type="button" class="d4ea-minor-slide"><i class="fa-solid fa-arrows-up-down-left-right"></i> ${foundry.utils.escapeHTML(F("Move.MinorSlide", { name: token.name, squares: f.minorSlide }))}</button>
				</div>`,
				flags: { [MODULE_ID]: { minorSlide: { source: actor.uuid, target: token.document.uuid, squares: f.minorSlide, power: e.name, round: combat.round } } },
			});
		}
	}
}

async function onMinorSlideButton(message, btn) {
	const data = message.getFlag(MODULE_ID, "minorSlide");
	if (data?.used) return;
	const source = fromUuidSync(data?.source);
	if (!source?.isOwner) return ui.notifications.warn(L("Opportunity.NotOwner"));
	const target = fromUuidSync(data.target)?.object;
	const me = tokenForActor(source);
	if (!target || !me) return ui.notifications.warn(L("Move.TokenGone"));
	btn.disabled = true;
	const result = await pickMovement({ token: target, mode: "slide", squares: data.squares, source: me, power: data.power, moveOptions: { forced: true } });
	if (!result.moved) {
		btn.disabled = false;
		return;
	}
	const combatant = combatantForActor(source);
	if (combatant?.combat?.started) await spend(combatant, "minor", { source: data.power });
	if (!message.canUserModify(game.user, "update")) return;
	await message.update({ content: `<div class="d4ea-move-card"><p><strong>${foundry.utils.escapeHTML(data.power)}</strong></p><p><i class="fa-solid fa-check"></i> ${foundry.utils.escapeHTML(F("Move.Done.slide", { name: target.name }))}</p></div>`, [`flags.${MODULE_ID}.minorSlide.used`]: true });
}

/* -------------------------------------------- */

export function onRenderChatMessage(message, html) {
	const bind = (selector, fn) => html.querySelectorAll(selector).forEach((btn) => btn.addEventListener("click", (ev) => {
		ev.preventDefault();
		fn(message, btn).catch((e) => console.error(`${MODULE_ID} | movement button`, e));
	}));
	bind(".d4ea-move-later", onLaterButton);
	bind(".d4ea-followup", onFollowUpButton);
	bind(".d4ea-minor-slide", onMinorSlideButton);
	if (message.getFlag(MODULE_ID, "followUp")?.used) html.querySelectorAll(".d4ea-followup").forEach((b) => { b.disabled = true; });
}

export function registerMovementHooks() {
	Hooks.on("combatTurnChange", (combat) => {
		onTurnStart(combat).catch((e) => console.error(`${MODULE_ID} | minor slide`, e));
	});
	log("click movement ready");
}
