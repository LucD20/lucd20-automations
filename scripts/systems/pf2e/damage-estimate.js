import { registerDamageEstimateAdapter, estimate, describe, lineHTML } from "../../features/damage-estimate.js";
import { localize } from "../../core/constants.js";

/**
 * PF2e for Damage Estimate: PF2e's damage window shows the final formula on its Roll button, one span per
 * damage instance (doubled on a critical: "2 × (1d8 + 4)"). Each instance's text is estimated; persistent
 * ones (an hourglass, or bleed: `isPersistent`) are summed apart and shown as their own "Persistent" range (they
 * aren't rolled now). At least 1 damage. The line goes above the button.
 */

/**
 * Is this damage instance persistent? (v0.90.1; owner: "2d6 piercing + 2d6 bleed shows 4–24; it should just be
 * 2–12 since bleed isn't rolled at the moment".) An hourglass icon among its own icons, a "persistent" or "bleed"
 * class, or a tooltip / label saying persistent or bleed.
 */
export function isPersistent(span) {
	// The element itself and its own icons (direct children): a persistent part nested deeper is split out instead.
	const els = [span, ...[...(span.children ?? [])].filter((c) => c.tagName === "I" || !/\d/.test(c.textContent))];
	if (els.some((e) => [...(e.classList ?? [])].some((c) => c.startsWith("fa-hourglass") || c === "persistent" || c === "bleed"))) return true;
	const said = els.map((e) => `${e.dataset?.tooltip ?? ""} ${e.getAttribute?.("title") ?? ""} ${e.getAttribute?.("aria-label") ?? ""}`).join(" ").toLowerCase();
	return /\bpersistent\b|\bbleed\b/.test(said);
}

export function pf2eLine(button, mode) {
	const instances = [...button.querySelectorAll(".instance")];
	if (!instances.length) return "";
	const normal = { min: 0, avg: 0, max: 0 }, persistent = { min: 0, avg: 0, max: 0 };
	let anyNormal = false, anyPersistent = false;
	if (globalThis.CONFIG?.debug?.lucd20Rules) console.log("lucd20-automations | Damage Estimate: roll button", button.innerHTML);
	const add = (slot, e) => { for (const k of ["min", "avg", "max"]) slot[k] += e[k]; };
	for (const span of instances) {
		if (isPersistent(span)) {
			const e = estimate(span.textContent);
			if (!e) return "";
			add(persistent, e); anyPersistent = true;
			continue;
		}
		// Persistent parts inside a normal instance ("2d6 + 2d6 bleed" in one): counted apart, the rest normal.
		const clone = span.cloneNode(true);
		const inner = [...clone.querySelectorAll("*")].filter((el) => /\d/.test(el.textContent) && isPersistent(el) && !el.querySelector(".instance"));
		for (const el of inner) {
			const e = estimate(el.textContent);
			if (!e) return "";
			add(persistent, e); anyPersistent = true;
			el.remove();
		}
		const rest = clone.textContent.replace(/[+\s]+$/, "").replace(/^[+\s]+/, "").replace(/\+\s*\+/g, "+").trim();
		if (!rest) continue;
		const e = estimate(rest);
		if (!e) return "";
		add(normal, e); anyNormal = true;
	}
	if (anyNormal) for (const k of ["min", "avg", "max"]) normal[k] = Math.max(1, normal[k]); // at least 1 damage
	return lineHTML([anyNormal ? describe(normal, mode) : "", anyPersistent ? describe(persistent, mode, localize("LUCD20.DamageEstimate.Persistent")) : ""]);
}

registerDamageEstimateAdapter({
	system: "pf2e",
	enable(feature) {
		// (verify) PF2e 8.7: the window re-renders when a modifier is toggled, so the line follows.
		feature.on("renderDamageModifierDialog", (app, html) => {
			const root = html instanceof HTMLElement ? html : (html?.[0] ?? app?.element?.[0] ?? app?.element);
			const button = root?.querySelector?.("button[type='submit']");
			if (!button) return;
			root.querySelector(".lucd20-de-line")?.remove();
			const line = pf2eLine(button, feature.get("show"));
			if (line) button.insertAdjacentHTML("beforebegin", line);
		});
	}
});
