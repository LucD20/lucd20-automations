/**
 * LucD20 Automations — entry point.
 * See docs/PLAN.md for the plan and build order.
 */

import { MODULE_ID, log } from "./core/constants.js";
import { availableFeatures, getFeature, initFeatures, startFeatures } from "./core/registry.js";
import { broadcast, executeAsGM, initSocket } from "./core/socket.js";
import { SettingsHub } from "./core/settings-hub.js";

// Feature definitions. System folders are imported in every world, but their
// features declare `systems: [...]` and are only registered and started there.
import "./features/index.js";
import "./systems/index.js";

Hooks.once("init", () => {
  log(`Initializing (system: ${game.system.id})`);

  game.settings.registerMenu(MODULE_ID, "hub", {
    name: "LUCD20.Menu.Name",
    label: "LUCD20.Menu.Label",
    hint: "LUCD20.Menu.Hint",
    icon: "fa-solid fa-dice-d20",
    type: SettingsHub,
    restricted: false
  });

  initSocket();
  initFeatures();

  game.modules.get(MODULE_ID).api = {
    openSettings: () => new SettingsHub().render({ force: true }),
    features: () => availableFeatures(),
    getFeature,
    broadcast,
    executeAsGM
  };
});

Hooks.once("ready", () => {
  startFeatures();
  const active = availableFeatures().filter(f => f.active).map(f => f.id);
  log(`Ready (v${game.modules.get(MODULE_ID).version}). Active features: ${active.join(", ") || "none"}`);
});
