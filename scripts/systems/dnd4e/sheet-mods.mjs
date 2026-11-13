import { decorateActorSheet } from "./power-badges.mjs";
import { MODULE_ID } from "./constants.mjs";
import { setting } from "./utils.mjs";

/*
 * On actor sheets (dnd4e default and Fox's 4e Aesthetics, PCs and NPCs), defences changed by
 * temporary effects are coloured (red = net penalty, green = net bonus) and their tooltip lists
 * what is changing them, e.g. "Palavra Pavorosa: −3".
 */

const DEFENCES = ["ac", "fort", "ref", "wil"];
const VALUE_SELECTORS = [".defence-bonus", ".def-total", ".defence-value", ".ruler", ".value"];

function changeValue(change) {
	const v = Number(change.value);
	if (!Number.isFinite(v)) return null;
	const type = change.type ?? change.mode;
	if (type === "add" || type === 2) return v;
	return null; // overrides/multipliers aren't shown as a simple +/-
}

/** { ac: [{name, value}], fort: [...], ... } from the actor's temporary effects. */
export function defenceModifiers(actor) {
	const out = Object.fromEntries(DEFENCES.map((d) => [d, []]));
	const effects = actor.appliedEffects ?? actor.effects?.filter((e) => !e.disabled) ?? [];
	for (const effect of effects) {
		if (!effect.isTemporary) continue; // skip permanent race/class/feat bonuses
		const changes = effect.system?.changes ?? effect.changes ?? [];
		for (const change of changes) {
			const key = change.key ?? "";
			const value = changeValue(change);
			if (value === null || value === 0) continue;
			if (key.startsWith("system.modifiers.defences.")) {
				for (const d of DEFENCES) out[d].push({ name: effect.name, value });
				continue;
			}
			const m = key.match(/^system\.defences\.(ac|fort|ref|wil)\.(?!base\b)/);
			if (m) out[m[1]].push({ name: effect.name, value });
		}
	}
	return out;
}

const signed = (v) => (v > 0 ? `+${v}` : `−${Math.abs(v)}`);

export function decorateSheet(app, element) {
	if (!setting("sheetModHighlights")) return;
	const actor = app.document ?? app.actor;
	if (!(actor instanceof Actor)) return;
	const root = element instanceof HTMLElement ? element : element?.[0];
	if (!root) return;
	const mods = defenceModifiers(actor);
	for (const d of DEFENCES) {
		for (const box of root.querySelectorAll(`[data-defence="${d}"]`)) {
			const valueEl = VALUE_SELECTORS.map((s) => box.querySelector(s)).find(Boolean);
			if (!valueEl) continue;
			// The tooltip may live on a wrapper (Fox NPC sheets put it on the label around the input)
			let el = valueEl;
			if (!valueEl.hasAttribute("data-tooltip")) {
				const wrapper = valueEl.closest("[data-tooltip]");
				if (wrapper && box.contains(wrapper)) el = wrapper;
			}
			valueEl.classList.remove("d4ea-mod-penalty", "d4ea-mod-bonus");
			el.classList.remove("d4ea-mod-penalty", "d4ea-mod-bonus");
			if (el.dataset.d4eaTooltip !== undefined) el.dataset.tooltip = el.dataset.d4eaTooltip;
			const list = mods[d];
			if (!list.length) continue;
			const net = list.reduce((a, m) => a + m.value, 0);
			valueEl.classList.add(net < 0 ? "d4ea-mod-penalty" : "d4ea-mod-bonus");
			el.dataset.d4eaTooltip ??= el.dataset.tooltip ?? "";
			const lines = list.map((m) => `${foundry.utils.escapeHTML(m.name)}: ${signed(m.value)}`).join("<br>");
			el.dataset.tooltip = `${lines}${el.dataset.d4eaTooltip ? `<hr>${el.dataset.d4eaTooltip}` : ""}`;
			// Fox NPC sheets show an editable input next to a hidden "ruler" with the total
			if (valueEl.classList.contains("ruler")) box.querySelector("input.number")?.classList.add(net < 0 ? "d4ea-mod-penalty" : "d4ea-mod-bonus");
		}
	}
}

export function registerSheetModHooks() {
	Hooks.on("renderApplicationV2", (app, element) => {
		try {
			if (app.document instanceof Actor) decorateSheet(app, element);
			if (app.document instanceof Actor) decorateActorSheet(app, element);
		} catch (err) {
			console.error(`${MODULE_ID} | sheet highlights`, err);
		}
	});
}
