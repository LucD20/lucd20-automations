import { registerChancesAdapter, chances, d20Of, barHTML, label } from "../../features/roll-chances.js";
import { sysId, sysApi } from "./sys.js";

/**
 * PF2e for Roll Chances: the four degrees of success of a check against its DC, as PF2e works them out
 * (±10, natural 20 / 1, then the roll's degree adjustments), over the d20 (fortune / misfortune: 2d20 kept).
 * On the check's card (before its result) and in the roll window. Players see it only where they could see
 * the DC: PF2e's "show DCs" setting, the DC shown on the card, or a DC that belongs to a player's character.
 */

const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];
const AMOUNT = { criticalFailure: 0, failure: 1, success: 2, criticalSuccess: 3 };

/** The degree (0..3) for a natural die value, a modifier and a DC, with the roll's adjustment record. */
export function degreeFor(natural, modifier, dc, adjustments = null) {
	const total = natural + modifier;
	let d = total - dc >= 10 ? 3 : dc - total >= 10 ? 0 : total >= dc ? 2 : 1;
	if (natural === 20) d = Math.min(3, d + 1);
	else if (natural === 1) d = Math.max(0, d - 1);
	if (!adjustments) return d;
	for (const outcome of ["all", ...DEGREES]) {
		const a = adjustments[outcome];
		if (!a?.amount) continue;
		if (d === 3 && a.amount === 1) continue;
		if (d === 0 && a.amount === -1) continue;
		if (outcome !== "all" && DEGREES.indexOf(outcome) !== d) continue;
		return typeof a.amount === "string" ? (AMOUNT[a.amount] ?? d) : Math.max(0, Math.min(3, d + a.amount));
	}
	return d;
}

export function pf2eSegments(modifier, dc, { mode = "normal", adjustments = null } = {}) {
	const p = chances((v) => degreeFor(v, modifier, dc, adjustments), mode);
	return DEGREES.map((key, i) => ({ key, label: label(key), p: p[i] ?? 0 }));
}

const opposerOf = (context) => {
	const uuid = context?.type === "saving-throw" ? context?.origin?.actor : context?.target?.actor;
	try { return uuid ? fromUuidSync(uuid) : null; } catch { return null; }
};

/** May this user see the chances of this check? */
export function canSee(context, { blind = false } = {}) {
	if (game.user.isGM) return true;
	if (blind) return false;
	if (sysApi()?.settings?.metagame?.dcs) return true;
	if (context?.dc?.visible || context?.dc?.visibility === "all") return true;
	return !!opposerOf(context)?.hasPlayerOwner;
}

function onCard(message, html) {
	const context = message.flags?.[sysId()]?.context;
	const dc = Number(context?.dc?.value);
	if (!context || !Number.isFinite(dc) || context.type === "flat-check" || html.querySelector?.(".lucd20-ch-bar")) return;
	const roll = message.rolls?.[0];
	const die = d20Of(roll);
	if (!die?.natural) return;
	if (!canSee(context, { blind: message.blind })) return;
	const modifier = roll.total - die.natural;
	const bar = barHTML(pf2eSegments(modifier, dc, { mode: die.mode, adjustments: context.dosAdjustments ?? null }));
	const anchor = html.querySelector(".degree-of-success") ?? html.querySelector(".dice-roll");
	if (anchor) anchor.insertAdjacentHTML(anchor.matches(".degree-of-success") ? "beforebegin" : "afterend", bar);
}

/** The roll window: the chances before rolling (no degree adjustments: they depend on the roll). */
function onDialog(app, html) {
	const root = html instanceof HTMLElement ? html : (html?.[0] ?? app?.element);
	const dc = Number(app?.context?.dc?.value);
	const modifier = Number(app?.check?.totalModifier);
	if (!root || !Number.isFinite(dc) || !Number.isFinite(modifier)) return;
	const ctx = { type: app.context?.type, dc: app.context.dc, target: { actor: app.context?.target?.actor?.uuid }, origin: { actor: app.context?.origin?.actor?.uuid } };
	if (!canSee(ctx)) return;
	const twice = app.context?.rollTwice;
	const mode = twice === "keep-higher" ? "high" : twice === "keep-lower" ? "low" : "normal";
	root.querySelector(".lucd20-ch-bar")?.remove();
	const button = root.querySelector("button.roll, button[type='submit'], [data-action='roll']");
	const bar = barHTML(pf2eSegments(modifier, dc, { mode }), { extraClass: "lucd20-ch-dialog" });
	if (button) button.insertAdjacentHTML("beforebegin", bar);
	else root.querySelector(".window-content")?.insertAdjacentHTML("beforeend", bar);
	requestAnimationFrame(() => { try { app?.setPosition?.({ height: "auto" }); } catch { /* not positionable */ } });
}

registerChancesAdapter({
	system: "pf2e",
	enable(feature) {
		feature.on("renderChatMessageHTML", (message, html) => onCard(message, html));
		// (verify) PF2e 8.7's roll window and its fields: app.check.totalModifier, app.context.dc / rollTwice.
		feature.on("renderCheckModifiersDialog", (app, html) => onDialog(app, html));
	}
});

export const _test = { degreeFor, pf2eSegments, canSee, onCard, onDialog };
