import { localize, systemMatches } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";

/**
 * Damage Estimate (replaces "PF2e Damage Estimate"; owner, Q224–Q227, as recommended): one small line above
 * the Roll button of the damage window, "Average 14 (6–22)", for the roller only. PF2e lists persistent
 * damage apart; 4e shows the critical too. Each user chooses average, range or both (client setting).
 * Not on the damage card. Each system's adapter (scripts/systems/<id>/damage-estimate.*) hooks itself in.
 */

const adapters = [];
export function registerDamageEstimateAdapter(adapter) {
	adapters.push(adapter);
}
const L = (key, data) => localize(`LUCD20.DamageEstimate.${key}`, data);

/**
 * { min, avg, max } of a dice formula: NdM (N optional), numbers, + − × * /, parentheses. Dice modifiers
 * (kh, r1...) and [flavors] are ignored; "(2)d8" reads as 2d8. Returns null when it can't be read.
 */
export function estimate(formula) {
	const text = String(formula ?? "")
		.replace(/\[[^\]]*\]/g, "")
		.replace(/×/g, "*")
		.replace(/\((\d+)\)\s*d/gi, "$1d")
		.replace(/(\d*d\d+)[a-z]+\d*/gi, "$1")
		.replace(/\s+/g, "");
	if (!text || /[^0-9d+\-*/().]/i.test(text)) return null;
	const at = (mode) => {
		let i = 0;
		const peek = () => text[i];
		const num = () => { let s = ""; while (/\d/.test(peek() ?? "")) s += text[i++]; return s; };
		const factor = () => {
			if (peek() === "(") { i++; const v = expr(); if (text[i++] !== ")") throw new Error("paren"); return v; }
			if (peek() === "-") { i++; return -factor(); }
			if (peek() === "+") { i++; return factor(); }
			const n = num();
			if (/d/i.test(peek() ?? "")) {
				i++;
				const faces = Number(num());
				const count = n === "" ? 1 : Number(n);
				if (!faces) throw new Error("die");
				return mode === "min" ? count : mode === "max" ? count * faces : count * (faces + 1) / 2;
			}
			if (n === "") throw new Error("number");
			return Number(n);
		};
		const term = () => { let v = factor(); while (peek() === "*" || peek() === "/") { const op = text[i++]; const r = factor(); v = op === "*" ? v * r : v / r; } return v; };
		const expr = () => { let v = term(); while (peek() === "+" || peek() === "-") { const op = text[i++]; const r = term(); v = op === "+" ? v + r : v - r; } return v; };
		const v = expr();
		if (i !== text.length) throw new Error("rest");
		return v;
	};
	try {
		return { min: at("min"), avg: at("avg"), max: at("max") };
	} catch {
		return null;
	}
}

const round = (n) => Math.round(n * 10) / 10;

/** "Average 14 (6–22)" as the user chose; prefix e.g. "Crit". */
export function describe(e, mode, prefix = "") {
	if (!e) return "";
	const avg = `${round(e.avg)}`, range = `${Math.floor(e.min)}–${Math.floor(e.max)}`;
	const body = mode === "average" ? L("Average", { avg }) : mode === "range" ? range : L("Both", { avg, range });
	return prefix ? `${prefix}: ${body}` : body;
}

export function lineHTML(parts) {
	const text = parts.filter(Boolean);
	if (!text.length) return "";
	return `<div class="lucd20-de-line">${text.map((t) => `<span>${Handlebars.escapeExpression(t)}</span>`).join("")}</div>`;
}

defineFeature({
	id: "damageEstimate",
	category: "chat",
	systems: ["pf2e", "dnd4e"],
	scope: "world",
	defaultEnabled: true,
	settings: {
		show: { kind: "select", default: "both", scope: "client", choices: { both: "LUCD20.DamageEstimate.Choice.both", average: "LUCD20.DamageEstimate.Choice.average", range: "LUCD20.DamageEstimate.Choice.range" } }
	},

	enable(feature) {
		for (const a of adapters) if (systemMatches(a.system)) a.enable(feature);
	}
});
