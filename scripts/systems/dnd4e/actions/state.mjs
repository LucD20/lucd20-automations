import { MODULE_ID } from "../constants.mjs";
import { F, L, setting, log } from "../utils.mjs";

/*
 * Per-combatant action economy for the current turn/round, stored in combatant flags so every
 * client sees the same thing:
 *   used.standard / used.move / used.minor  - reset at the start of the combatant's turn
 *   used.immediate                          - one per round, resets at the start of the combatant's turn
 *   used.opportunity                        - one per other combatant's turn, resets every turn change
 *   extra                                   - extra actions from Action Points this turn
 * Trades follow the 4e rules: a standard action can be used as a move or minor action, and a move
 * action as a minor action.
 */

export const ACTIONS = ["standard", "move", "minor", "immediate", "opportunity"];
const FLAG = "actions";

export function emptyState() {
	return { used: { standard: 0, move: 0, minor: 0, immediate: 0, opportunity: 0 }, extra: 0, traded: [], chargePending: false, movement: null, freeShift: 0 };
}

export function getState(combatant) {
	const s = combatant?.getFlag(MODULE_ID, FLAG);
	return s ? foundry.utils.mergeObject(emptyState(), s, { inplace: false }) : emptyState();
}

/** Remaining actions of each kind (before trades). */
export function remaining(state) {
	return {
		standard: 1 + (state.extra || 0) - state.used.standard,
		move: 1 - state.used.move,
		minor: 1 - state.used.minor,
		immediate: 1 - state.used.immediate,
		opportunity: 1 - state.used.opportunity,
	};
}

export function canModify(combatant) {
	return !!combatant && (game.user.isGM || combatant.isOwner);
}

async function save(combatant, state) {
	if (!canModify(combatant)) return;
	await combatant.setFlag(MODULE_ID, FLAG, state);
}

export function isCombatantsTurn(combatant) {
	const c = combatant?.combat;
	return !!c?.started && c.combatant?.id === combatant.id;
}

/** Map a dnd4e power action type to the tracker's action kind (null = not tracked). */
export function kindForActionType(actionType) {
	switch (actionType) {
		case "standard": return "standard";
		case "move": return "move";
		case "minor": return "minor";
		case "reaction":
		case "interrupt": return "immediate";
		case "opportunity": return "opportunity";
		default: return null; // free, none, special...
	}
}

/**
 * Spend an action. Applies trades (standard -> move/minor, move -> minor). Warns, but still
 * records the use, when nothing is left or the action isn't allowed right now.
 * @returns {Promise<{ok: boolean, spent: string|null, warning: string|null}>}
 */
export async function spend(combatant, kind, { source = "" } = {}) {
	if (!combatant || !kind) return { ok: true, spent: null, warning: null };
	const state = getState(combatant);
	const left = remaining(state);
	const ownTurn = isCombatantsTurn(combatant);
	let spent = kind;
	let warning = null;
	const name = combatant.name;

	if (kind === "standard") {
		if (left.standard <= 0) warning = F("Actions.WarnNone", { name, action: L("Actions.standard") });
	} else if (kind === "move") {
		if (left.move <= 0) {
			if (left.standard > 0) spent = "standard";
			else warning = F("Actions.WarnNone", { name, action: L("Actions.move") });
		}
	} else if (kind === "minor") {
		if (left.minor <= 0) {
			if (left.move > 0) spent = "move";
			else if (left.standard > 0) spent = "standard";
			else warning = F("Actions.WarnNone", { name, action: L("Actions.minor") });
		}
	} else if (kind === "immediate") {
		if (ownTurn) warning = F("Actions.WarnImmediateOwnTurn", { name });
		else if (left.immediate <= 0) warning = F("Actions.WarnImmediateUsed", { name });
	} else if (kind === "opportunity") {
		if (ownTurn) warning = F("Actions.WarnOpportunityOwnTurn", { name });
		else if (left.opportunity <= 0) warning = F("Actions.WarnOpportunityUsed", { name });
	}

	if (["standard", "move", "minor"].includes(kind) && !ownTurn && combatant.combat?.started) {
		warning ??= F("Actions.WarnNotYourTurn", { name, action: L(`Actions.${kind}`) });
	}

	state.used[spent] += 1;
	if (spent !== kind) state.traded.push(`${spent}>${kind}`);
	// Any other action ends the current move (a move action is one continuous movement).
	if (kind !== "move") state.movement = null;
	await save(combatant, state);
	if (warning && setting("actionWarnings")) ui.notifications.warn(warning);
	log("spend", name, kind, "as", spent, source, warning ?? "");
	return { ok: !warning, spent, warning };
}

/** Manually toggle one pip (used from the panel / tracker). */
export async function togglePip(combatant, kind) {
	const state = getState(combatant);
	const max = kind === "standard" ? 1 + (state.extra || 0) : 1;
	state.used[kind] = state.used[kind] >= max ? 0 : state.used[kind] + 1;
	await save(combatant, state);
}

export async function addExtraAction(combatant) {
	const state = getState(combatant);
	state.extra = (state.extra || 0) + 1;
	await save(combatant, state);
}

export async function setChargePending(combatant, value) {
	const state = getState(combatant);
	state.chargePending = value;
	await save(combatant, state);
}

/* -------------------------------------------- */
/*  Resets (active GM only)                      */
/* -------------------------------------------- */

export async function onTurnChange(combat, previous, current) {
	if (!game.users.activeGM?.isSelf || !setting("actionTracker")) return;
	const updates = [];
	for (const c of combat.combatants) {
		const state = getState(c);
		let changed = false;
		if (c.id === current.combatantId) {
			const fresh = emptyState();
			fresh.used.opportunity = 0;
			updates.push({ _id: c.id, [`flags.${MODULE_ID}.${FLAG}`]: fresh });
			continue;
		}
		if (state.used.opportunity) {
			state.used.opportunity = 0;
			changed = true;
		}
		if (changed) updates.push({ _id: c.id, [`flags.${MODULE_ID}.${FLAG}`]: state });
	}
	if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
}

export async function resetAll(combat) {
	if (!game.users.activeGM?.isSelf) return;
	const updates = combat.combatants.map((c) => ({ _id: c.id, [`flags.${MODULE_ID}.${FLAG}`]: emptyState() }));
	if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
}

/** The combatant for an actor in the active combat (token-specific for unlinked NPCs). */
export function combatantForActor(actor) {
	const combat = game.combat;
	if (!combat || !actor) return null;
	if (actor.token?.combatant && actor.token.combatant.combat === combat) return actor.token.combatant;
	return combat.getCombatantsByActor(actor)[0] ?? null;
}
