import { MODULE_ID } from "../constants.mjs";
import { setting, F } from "../utils.mjs";
import { spend, kindForActionType, combatantForActor, getState, setChargePending, addExtraAction, onTurnChange, resetAll, isCombatantsTurn, canModify } from "./state.mjs";
import { ActionPanel } from "./panel.mjs";
import { renderTrackerPips } from "./tracker-pips.mjs";
import { integrateCombatDock, refreshDock } from "./dock.mjs";
import { consumePendingOpportunity } from "../reactions/opportunity.mjs";
import { onMoveTokenSpend } from "./movement.mjs";
import { freeShiftFor } from "./free-shift.mjs";

const pendingFree = new Map(); // actor uuid -> timestamp: the next power is used as a free action

/** The actor's next power use is part of something else (e.g. Blunder's follow-up attack): don't spend. */
export function markFreeUse(actor) {
	pendingFree.set(actor.uuid, Date.now());
}

/** dnd4e.usePower: spend the power's action. */
export async function onUsePower(item) {
	if (!setting("actionTracker")) return;
	const freeAt = pendingFree.get(item.actor?.uuid);
	if (freeAt) {
		pendingFree.delete(item.actor.uuid);
		if (Date.now() - freeAt < 60000) return;
	}
	const combatant = combatantForActor(item.actor);
	if (!combatant || !combatant.combat?.started || !canModify(combatant)) return;
	// A basic attack started from an opportunity-attack card spends the opportunity action.
	if (consumePendingOpportunity(item.actor)) {
		await spend(combatant, "opportunity", { source: item.name });
		return;
	}
	await grantFreeShift(combatant, item);
	const kind = kindForActionType(item.system?.actionType);
	if (!kind) return;

	// The attack made as part of a Charge is included in the Charge's standard action.
	const state = getState(combatant);
	if (state.chargePending && kind === "standard" && item.system?.attack?.isAttack) {
		await setChargePending(combatant, false);
		return;
	}
	await spend(combatant, kind, { source: item.name });
}

/**
 * Powers with a built-in shift ("Shift 1 square before or after you attack") get a free shift:
 * if the user already shifted this turn with a move action and nothing else since, that move
 * action is refunded; otherwise the next shift of up to N squares this turn is free.
 */
async function grantFreeShift(combatant, item) {
	const squares = freeShiftFor(item);
	if (!squares || !isCombatantsTurn(combatant)) return;
	const state = getState(combatant);
	const block = state.movement;
	if (block?.mode === "shift" && block.used <= squares && block.spentAs && state.used[block.spentAs] > 0) {
		state.used[block.spentAs] -= 1;
		state.movement = null;
		ui.notifications.info(F("Actions.FreeShiftRefund", { name: combatant.name, power: item.name }));
	} else {
		state.freeShift = Math.max(state.freeShift || 0, squares);
		ui.notifications.info(F("Actions.FreeShiftGranted", { name: combatant.name, power: item.name, squares }));
	}
	await combatant.setFlag(MODULE_ID, "actions", state);
}

/** Spending an Action Point (from the sheet or the panel) grants an extra action this turn. */
function onUpdateActor(actor, changes, options, userId) {
	if (!setting("actionTracker") || game.user.id !== userId) return;
	const ap = foundry.utils.getProperty(changes, "system.actionpoints.value");
	if (ap === undefined) return;
	const before = options?.[MODULE_ID]?.apBefore;
	const combatant = combatantForActor(actor);
	if (!combatant || !isCombatantsTurn(combatant)) return;
	if ((before !== undefined) && (ap >= before)) return;
	addExtraAction(combatant);
}

function onPreUpdateActor(actor, changes, options) {
	if (foundry.utils.getProperty(changes, "system.actionpoints.value") === undefined) return;
	options[MODULE_ID] = { apBefore: actor.system.actionpoints?.value };
}

export function registerActionTracker() {
	Hooks.on("combatTurnChange", (combat, previous, current) => {
		onTurnChange(combat, previous, current).catch((e) => console.error(`${MODULE_ID} | turn change`, e));
		ActionPanel.refresh();
		setTimeout(refreshDock, 150);
	});
	Hooks.on("combatStart", (combat) => {
		resetAll(combat).catch((e) => console.error(`${MODULE_ID} | combat start`, e));
		ActionPanel.autoOpen();
	});
	Hooks.on("moveToken", (doc, movement, operation, user) => {
		onMoveTokenSpend(doc, movement, operation, user).catch((e) => console.error(`${MODULE_ID} | movement`, e));
	});
	Hooks.on("preUpdateActor", onPreUpdateActor);
	Hooks.on("updateActor", onUpdateActor);
	Hooks.on("updateCombatant", () => ActionPanel.refresh());
	Hooks.on("updateCombat", () => ActionPanel.refresh());
	Hooks.on("deleteCombat", () => ActionPanel.refresh());
	Hooks.on("controlToken", () => ActionPanel.refresh());
	Hooks.on("renderCombatTracker", (app, element) => renderTrackerPips(app, element));
	Hooks.once("ready", () => {
		integrateCombatDock();
		if (game.combat?.started) ActionPanel.autoOpen();
	});
}
