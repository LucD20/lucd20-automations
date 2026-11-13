import { MODULE_ID } from "./constants.mjs";
import { getFeature } from "../../core/registry.js";

/*
 * Merged into LucD20 Automations: the old on/off settings are now feature
 * cards (cards.mjs). What stays here is data the module keeps (power-level
 * marks) and the keybindings.
 */
export function registerSettings() {
	game.settings.register(MODULE_ID, "powerLevels-overrides", {
		scope: "world",
		config: false,
		type: Object,
		default: {},
		onChange: () => import("./power-badges.mjs").then((m) => m.refreshAll()),
	});

	game.keybindings.register(MODULE_ID, "dnd4eToggleActionPanel", {
		name: "DND4EAUTO.Keybindings.toggleActionPanel",
		editable: [],
		onDown: () => {
			import("./actions/panel.mjs").then((m) => m.ActionPanel.toggle());
			return true;
		},
	});

	game.keybindings.register(MODULE_ID, "dnd4eToggleCoverPreview", {
		name: "DND4EAUTO.Keybindings.toggleCoverPreview",
		editable: [],
		onDown: () => {
			const cover = getFeature("dnd4eCover");
			if (cover) cover.set("preview", !cover.get("preview"));
			return true;
		},
	});
}
