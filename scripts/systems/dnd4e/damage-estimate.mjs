import { registerDamageEstimateAdapter, estimate, describe, lineHTML } from "../../features/damage-estimate.js";
import { localize } from "../../core/constants.js";

/**
 * D&D 4e for Damage Estimate: the system's damage window (formula "@damage + @bonus") keeps the power's
 * parts and its critical parts in `rollConfig`; the line above the buttons shows the normal damage and the
 * critical, and follows the window's Bonus field as it is typed.
 */

const isDamageDialog = (app) => !!app?.rollConfig && !app.dialogData?.isD20Roll && app.dialogData?.formula === "@damage + @bonus"
	&& !(app.buttons ?? []).some((b) => b.action === "heal");

/** @paths replaced from the roll data (missing ones count 0). */
export function withData(formula, data) {
	return String(formula ?? "").replace(/@([\w.]+)/g, (_, path) => {
		const v = foundry.utils.getProperty(data ?? {}, path);
		return v === undefined || v === null || v === "" ? "0" : `(${v})`;
	});
}

export function dnd4eLine(config, bonus, mode) {
	const data = { ...(config.data ?? {}), bonus: bonus || 0 };
	// The window rolls "@damage + @bonus": the Bonus field counts for the normal damage too.
	const parts = config.parts ?? [];
	const normal = estimate(withData([...parts, ...(parts.includes("@bonus") ? [] : ["@bonus"])].join(" + "), data));
	if (!normal) return "";
	const crit = config.partsCrit?.length ? estimate(withData(config.partsCrit.join(" + "), data)) : null;
	return lineHTML([describe(normal, mode), crit ? describe(crit, mode, localize("LUCD20.DamageEstimate.Crit")) : ""]);
}

registerDamageEstimateAdapter({
	system: "dnd4e",
	enable(feature) {
		feature.on("renderRollDialog", (app, element) => {
			if (!isDamageDialog(app)) return;
			const root = element instanceof HTMLElement ? element : element?.[0];
			if (!root) return;
			const place = () => {
				root.querySelector(".lucd20-de-line")?.remove();
				const bonus = root.querySelector("input[name='bonus']")?.value?.trim() ?? "";
				const line = dnd4eLine(app.rollConfig, bonus, feature.get("show"));
				const anchor = root.querySelector(".dialog-buttons, footer, .form-footer") ?? root.querySelector("button")?.parentElement;
				if (line && anchor) anchor.insertAdjacentHTML("beforebegin", line);
			};
			place();
			root.querySelector("input[name='bonus']")?.addEventListener("input", place);
		});
	}
});
