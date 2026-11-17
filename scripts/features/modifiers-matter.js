import { localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";

/**
 * Modifiers Matter (replaces "PF2e Modifiers Matter"; owner, Q218–Q223, as recommended): on a roll's card,
 * the modifiers that changed its result. A bonus that made the difference: green; a penalty that cost it: red.
 * Each system's adapter (scripts/systems/<id>/modifiers-matter.*) finds them and hooks itself in.
 * - PF2e: the card's modifier tags are highlighted; the target's own modifiers (its AC or DC, read when the
 *   roll is made) get one short line, shown where the DC may be seen. Failure ↔ critical failure on attacks
 *   doesn't count. No "potentials".
 * - D&D 4e: per target, the common attack bonuses (combat advantage, cover, concealment...) that turned a miss
 *   into a hit or the reverse, in one short line (with the 4e chances' setting for players).
 */

const adapters = [];
/** { system, enable(feature) } */
export function registerModifiersMatterAdapter(adapter) {
	adapters.push(adapter);
}

export const L = (key, data) => localize(`LUCD20.ModifiersMatter.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
export const signed = (n) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

/**
 * Which modifiers mattered. outcome(delta) → the outcome when the roll's total moved by delta (comparable
 * values). mods: [{ label, value, side: "roll"|"dc" }]: a "dc" modifier moves the DC, so removing it moves the
 * total the other way. Returns mods with good: true (it helped the roller) / false (it hurt).
 * A modifier matters alone if removing it changes the outcome; failing that, a whole side of modifiers
 * pushing the same way matters together if removing them all does.
 */
export function mattered(mods, outcome) {
	const now = outcome(0);
	const shift = (m) => (m.side === "dc" ? m.value : -m.value); // removing it moves the total by this much
	const helps = (m) => (m.side === "dc" ? m.value < 0 : m.value > 0);
	const alone = mods.filter((m) => m.value && outcome(shift(m)) !== now);
	if (alone.length) return alone.map((m) => ({ ...m, good: helps(m) }));
	const out = [];
	for (const good of [true, false]) {
		const group = mods.filter((m) => m.value && helps(m) === good);
		if (group.length > 1 && outcome(group.reduce((n, m) => n + shift(m), 0)) !== now) out.push(...group.map((m) => ({ ...m, good })));
	}
	return out;
}

/** The short line: "Target: Off-Guard −2, Shield +2". */
export function lineHTML(prefix, list) {
	if (!list.length) return "";
	const parts = list.map((m) => `<span class="${m.good ? "lucd20-mm-good" : "lucd20-mm-bad"}">${esc(m.label)} ${signed(m.value)}</span>`).join(", ");
	return `<div class="lucd20-mm-line">${esc(prefix)}: ${parts}</div>`;
}

defineFeature({
	id: "modifiersMatter",
	category: "chat",
	systems: ["pf2e", "dnd4e"],
	scope: "world",
	defaultEnabled: true,

	enable(feature) {
		for (const a of adapters) if (a.system === game.system.id) a.enable(feature);
	}
});
