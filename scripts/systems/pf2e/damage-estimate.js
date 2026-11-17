import { registerDamageEstimateAdapter, estimate, describe, lineHTML } from "../../features/damage-estimate.js";
import { localize } from "../../core/constants.js";

/**
 * PF2e for Damage Estimate: PF2e's damage window shows the final formula on its Roll button, one span per
 * damage instance (doubled on a critical: "2 × (1d8 + 4)"). Each instance's text is estimated; persistent
 * ones (an hourglass, or bleed) are summed apart. At least 1 damage. The line goes above the button.
 */

export function pf2eLine(button, mode) {
	const instances = [...button.querySelectorAll(".instance")];
	if (!instances.length) return "";
	const normal = { min: 0, avg: 0, max: 0 }, persistent = { min: 0, avg: 0, max: 0 };
	let anyNormal = false, anyPersistent = false;
	for (const span of instances) {
		const e = estimate(span.textContent);
		if (!e) return "";
		const slot = span.querySelector(".fa-hourglass") || span.classList.contains("bleed") ? persistent : normal;
		if (slot === persistent) anyPersistent = true; else anyNormal = true;
		for (const k of ["min", "avg", "max"]) slot[k] += e[k];
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
