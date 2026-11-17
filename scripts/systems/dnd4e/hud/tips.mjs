import { MATCHERS, KIND } from "../constants.mjs";
import { matches } from "../utils.mjs";
import { tokensWithEffect } from "../effects.mjs";
import { getFeature } from "../../../core/registry.js";
import { localize } from "../../../core/constants.js";

/**
 * New Player Tips (owner, Q252–Q255; Q253: on the HUD): a strip on top of the 4e HUD with a suggestion for the
 * character shown, during its own turn in combat, and the power it points to blinking. Class by class.
 * - Ranger: no prey → "You don't have a prey. You can use Hunter's Quarry, as a minor action, to assign one."
 *   with Hunter's Quarry blinking; a prey → "[Name] is your prey." and, at the start of the ranger's turn, a
 *   ping on the prey for the ranger's players and the GM only (not when it's on another map).
 * Not for a ranger at 0 HP or less. The texts follow the 4e game language.
 */

const T = (key, data) => localize(`LUCD20.Dnd4eTips.${key}`, data);

function enabled(cls) {
	const f = getFeature("dnd4eTips");
	return !!f?.isEnabled && !!f.get(cls);
}

const down = (actor) => Number(actor?.system?.attributes?.hp?.value) <= 0;
const myTurn = (actor) => {
	const c = game.combat;
	return !!c?.started && c.combatant?.actor?.id === actor?.id;
};

/** The tip for this actor now: { text, blink: { tab, powers: [item ids] } } or null. */
export function tipFor(actor) {
	if (!actor || !myTurn(actor) || down(actor)) return null;
	if (enabled("ranger")) {
		const quarry = actor.items?.find?.((i) => matches(i, MATCHERS.huntersQuarry));
		if (quarry) {
			const prey = tokensWithEffect(KIND.QUARRY, actor.uuid);
			if (!prey.length) return { key: "ranger-noPrey", text: T("Ranger.NoPrey", { power: quarry.name }), blink: { tab: "minor", powers: [quarry.id] } };
			return { key: "ranger-prey", text: T("Ranger.Prey", { name: prey.map((t) => t.name).join(", ") }) };
		}
	}
	return null;
}

/** At the start of a ranger's turn: a ping on its prey, for its players and the GM (each on their own screen). */
export function onTurnStart(combat) {
	const actor = combat?.combatant?.actor;
	if (!actor || !enabled("ranger") || down(actor)) return;
	if (!(game.user.isGM || actor.testUserPermission?.(game.user, "OWNER"))) return;
	if (!actor.items?.some?.((i) => matches(i, MATCHERS.huntersQuarry))) return;
	for (const token of tokensWithEffect(KIND.QUARRY, actor.uuid)) {
		if (token.document?.parent !== canvas.scene || token.visible === false) continue;
		// (verify) V14: drawPing draws on this screen only; canvas.ping would show everyone.
		try { canvas.controls?.drawPing?.(token.center, { style: "pulse" }); } catch { /* no ping */ }
	}
}

