import { MODULE_ID } from "../constants.mjs";
import { F, setting, log } from "../utils.mjs";
import { getState, spend, canModify, isCombatantsTurn } from "./state.mjs";

/*
 * Moving a token on the map spends move actions automatically, on the combatant's own turn:
 *  - The first move (walk/run/shift...) starts a "movement block" and spends a move action
 *    (or a standard action through the normal trade if the move action is gone).
 *  - Further moves of the same kind continue that block until the speed is used up
 *    (walk speed for walking, shift speed for shifting); going past it spends another action.
 *  - Moves that are part of a Charge, teleports, undo and GM-dragged player tokens are ignored.
 * Clicking Walk / Shift / Run in the action panel starts a block the same way, so the following
 * drag doesn't spend a second action.
 */

const FLAG = "actions";

function speedFor(actor, mode) {
	const mv = actor?.system?.movement ?? {};
	if (mode === "shift") return Number(mv.shift?.value) || 1;
	if (mode === "run") return (Number(mv.walk?.value) || 6) + (Number(mv.run?.value) || 2);
	return Number(mv.walk?.value) || 6;
}

function squaresMoved(passed) {
	const gridDistance = canvas.scene?.grid?.distance || 1;
	if (Number.isFinite(passed?.cost) && passed.cost > 0) return Math.round(passed.cost / gridDistance);
	if (Number.isFinite(passed?.spaces)) return passed.spaces;
	return 0;
}

function modeOf(waypoints) {
	const actions = new Set(waypoints.map((w) => w.action).filter(Boolean));
	if (actions.has("teleport")) return "teleport";
	if (actions.size && [...actions].every((a) => a === "shift")) return "shift";
	return "walk";
}

/** Start (or replace) the current movement block without spending, used after the panel buttons. */
export async function startMovementBlock(combatant, mode) {
	if (!canModify(combatant)) return;
	const state = getState(combatant);
	state.movement = { mode, used: 0, budget: speedFor(combatant.actor, mode) };
	await combatant.setFlag(MODULE_ID, FLAG, state);
}

export async function onMoveTokenSpend(tokenDoc, movement, operation, user) {
	if (!setting("actionTracker") || !setting("autoMoveActions")) return;
	if (user?.id !== game.user.id) return; // the user who moved does the bookkeeping
	const flags = operation?.[MODULE_ID] ?? {};
	if (flags.forced) return; // pushed, pulled, slid, or a shift granted by someone else's power
	// Moves chosen on the map with the module's square picker count like a drag
	if (!["dragging", "keyboard", "paste"].includes(movement?.method) && !flags.countMovement) return;
	const combatant = tokenDoc.combatant;
	if (!combatant?.combat?.started || !isCombatantsTurn(combatant) || !canModify(combatant)) return;
	// A GM dragging a player's token is usually forced movement (push/pull/slide).
	if (game.user.isGM && combatant.actor?.hasPlayerOwner) return;

	const waypoints = movement.passed?.waypoints ?? [];
	const squares = squaresMoved(movement.passed);
	if (!squares) return;
	const mode = modeOf(waypoints);
	if (mode === "teleport") return;

	let state = getState(combatant);
	if (state.chargePending) return; // the charge's movement is part of the charge

	// Free shift granted by a power (e.g. Nimble Strike)
	if (mode === "shift" && (state.freeShift || 0) >= squares) {
		state.freeShift -= squares;
		await combatant.setFlag(MODULE_ID, FLAG, state);
		log("free shift", combatant.name, squares);
		return;
	}

	const block = state.movement;
	const sameMode = block && (block.mode === mode || (block.mode === "run" && mode === "walk"));
	if (sameMode && block.used + squares <= block.budget) {
		block.used += squares;
		await combatant.setFlag(MODULE_ID, FLAG, state);
		log("movement continues", combatant.name, `${block.used}/${block.budget}`);
		return;
	}

	// New move action (spend handles the standard -> move trade and warnings)
	let remaining = squares - (sameMode ? Math.max(0, block.budget - block.used) : 0);
	const budget = speedFor(combatant.actor, mode);
	let spentActions = 0;
	let spentAs = "move";
	while (remaining > 0) {
		const result = await spend(combatant, "move", { source: `token movement (${mode})` });
		spentAs = result.spent ?? "move";
		spentActions += 1;
		remaining -= budget;
		if (spentActions > 3) break;
	}
	state = getState(combatant);
	const usedInLast = budget + remaining; // remaining is <= 0 here
	state.movement = { mode, used: Math.max(0, usedInLast), budget, spentAs };
	await combatant.setFlag(MODULE_ID, FLAG, state);
	if (mode === "shift" && squares > budget) ui.notifications.warn(F("Actions.WarnShiftTooFar", { name: combatant.name, squares, budget }));
	log("movement spent", combatant.name, mode, squares, "squares,", spentActions, "action(s)");
}
