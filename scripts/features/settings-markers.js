import { localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";

/**
 * Settings Markers (replaces "Settings Markers"): in Foundry's Configure Settings, each setting's label gets a
 * small mark for whom it applies to: the world (the GM sets it for everyone), each user, or this device
 * (client). The same marks as our own settings window.
 */

const ICONS = { world: "fa-earth-americas", user: "fa-user", client: "fa-desktop" };
const L = (key) => localize(`LUCD20.SettingsMarkers.${key}`);

/** The scope of one entry of the settings window. */
export function scopeOf(entry) {
	const setting = entry?.menu ? game.settings.menus.get(entry.key) : game.settings.settings.get(entry?.field?.name ?? entry?.key);
	if (!setting) return null;
	if ("scope" in setting) return setting.scope === "user" ? "user" : setting.scope === "world" ? "world" : "client";
	return setting.restricted ? "world" : "user";
}

export function mark(html, categories) {
	const root = html instanceof HTMLElement ? html : html?.[0];
	if (!root) return 0;
	let n = 0;
	for (const category of Object.values(categories ?? {})) {
		for (const entry of category.entries ?? []) {
			const scope = scopeOf(entry);
			if (!scope) continue;
			const input = entry.menu ? root.querySelector(`[data-key="${CSS.escape(entry.key)}"]`) : root.querySelector(`[name="${CSS.escape(entry.field?.name ?? "")}"]`);
			const label = input?.closest(".form-group")?.querySelector(":scope > label");
			if (!label || label.querySelector(".lucd20-scope-mark")) continue;
			label.insertAdjacentHTML("afterbegin", `<i class="fa-solid ${ICONS[scope]} lucd20-scope-mark" data-tooltip="${Handlebars.escapeExpression(L(scope))}" data-tooltip-direction="UP"></i>`);
			n++;
		}
	}
	return n;
}

defineFeature({
	id: "settingsMarkers",
	category: "playerSettings",
	scope: "client",
	defaultEnabled: true,

	enable(feature) {
		feature.on("renderSettingsConfig", (app, html, options) => mark(html, options?.categories));
	}
});
