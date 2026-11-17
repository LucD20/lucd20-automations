import { localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";

/**
 * Roll Chances (replaces "PF2e Chances"; owner, Q212–Q217, as recommended): a thin bar under a roll's result
 * with the chance of each outcome, in small text inside it. The maths here; what a roll is and who may see it
 * in each system's adapter (scripts/systems/<id>/chances.*), which hooks itself in through `enable(feature)`.
 * - PF2e: the four degrees of success against the DC, fortune / misfortune, degree adjustments; on the card
 *   and in the roll window; players see it only where they could see the DC.
 * - D&D 4e: Miss / Hit / Crit per target against its defense (crit range, natural 1), and saving throws; the
 *   GM only by default (a setting shows it to players).
 */

const adapters = [];
/** { system, enable(feature) } */
export function registerChancesAdapter(adapter) {
	adapters.push(adapter);
}

/** Chance of each natural d20 value 1..20 (index 1..20), for 1d20, 2d20kh or 2d20kl. */
export function d20Weights(mode = "normal") {
	const w = [0];
	for (let v = 1; v <= 20; v++) {
		if (mode === "high") w.push((v * v - (v - 1) * (v - 1)) / 400);
		else if (mode === "low") w.push(((21 - v) * (21 - v) - (20 - v) * (20 - v)) / 400);
		else w.push(1 / 20);
	}
	return w;
}

/** The d20 term of a roll (or its JSON): "high" (kh), "low" (kl) or "normal", and the natural result kept. */
export function d20Of(roll) {
	const die = (roll?.dice ?? roll?.terms ?? []).find((d) => (d.faces ?? d.options?.faces) === 20);
	if (!die) return null;
	const mods = (die.modifiers ?? []).join(" ");
	const mode = (die.number ?? 1) >= 2 ? (/kl|dh/.test(mods) ? "low" : /kh|dl/.test(mods) ? "high" : "normal") : "normal";
	const kept = (die.results ?? []).filter((r) => r.active !== false && !r.discarded);
	const natural = kept.length ? kept[0].result : null;
	return { mode, natural };
}

/**
 * Chances of named outcomes: outcomeOf(natural) → key, summed over the d20's weights.
 * Returns { key: probability } (0..1).
 */
export function chances(outcomeOf, mode = "normal") {
	const w = d20Weights(mode);
	const out = {};
	for (let v = 1; v <= 20; v++) {
		const key = outcomeOf(v);
		out[key] = (out[key] ?? 0) + w[v];
	}
	return out;
}

/** The bar: segments [{ key, label, p }] left to right; each shows its % inside when wide enough. */
export function barHTML(segments, { extraClass = "" } = {}) {
	const shown = segments.filter((s) => s.p > 0.0001);
	const parts = shown.map((s) => {
		const pct = Math.round(s.p * 100);
		const text = s.p >= 0.09 ? `${pct}%` : "";
		return `<span class="lucd20-ch-seg lucd20-ch-${s.key}" style="flex: ${s.p.toFixed(4)} 1 0">${text}</span>`;
	}).join("");
	return `<div class="lucd20-ch-bar ${extraClass}" aria-label="${Handlebars.escapeExpression(shown.map((s) => `${s.label} ${Math.round(s.p * 100)}%`).join(", "))}">${parts}</div>`;
}

export const label = (key) => localize(`LUCD20.Chances.${key}`);

defineFeature({
	id: "rollChances",
	category: "chat",
	systems: ["pf2e", "dnd4e"],
	scope: "world",
	defaultEnabled: true,
	settings: {
		showPlayers4e: { kind: "boolean", default: false, scope: "world" }
	},

	enable(feature) {
		for (const a of adapters) if (a.system === game.system.id) a.enable(feature);
	}
});
