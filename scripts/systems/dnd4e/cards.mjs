import { defineFeature, getFeature } from "../../core/registry.js";

/*
 * D&D 4e Combat Automation, merged into LucD20 Automations (Q33): the old
 * module's settings become a few feature cards in the "D&D 4e" category.
 * The code still asks for its old keys through `setting(key)` (utils.mjs),
 * which this file maps onto the cards, so every part can be switched off
 * without a reload (the code checks the setting each time it acts).
 */

const SYSTEMS = ["dnd4e"];
const card = def => defineFeature({ category: "dnd4e", systems: SYSTEMS, scope: "world", defaultEnabled: true, ...def });

/** old key → [card id, option] (no option = the card's own switch). */
export const SETTING_MAP = {
  enableQuarry: ["dnd4eClassFeatures", "quarry"],
  enableCurse: ["dnd4eClassFeatures", "curse"],
  enableRage: ["dnd4eClassFeatures", "rage"],
  enableMarks: ["dnd4eClassFeatures", "marks"],
  warnNotNearest: ["dnd4eClassFeatures", "warnNotNearest"],
  primeShot: ["dnd4eClassFeatures", "primeShot"],
  classFeatures: ["dnd4eClassFeatures", "classFeatures"],
  tempHpFeatures: ["dnd4eClassFeatures", "tempHpFeatures"],
  conditionalRiders: ["dnd4eClassFeatures", "conditionalRiders"],
  powerRiders: ["dnd4eClassFeatures", "powerRiders"],
  enableCover: ["dnd4eCover"],
  coverPreview: ["dnd4eCover", "preview"],
  actionTracker: ["dnd4eActionTracker"],
  autoMoveActions: ["dnd4eActionTracker", "autoMoveActions"],
  actionPanel: ["dnd4eActionTracker", "panel"],
  actionWarnings: ["dnd4eActionTracker", "warnings"],
  dockPips: ["dnd4eActionTracker", "dockPips"],
  opportunityAttacks: ["dnd4eOpportunity"],
  reactionPrompts: ["dnd4eTriggeredPowers"],
  damageTargets: ["dnd4eDamageApply"],
  clickMovement: ["dnd4eClickMovement"],
  readableRolls: ["dnd4eReadableRolls"],
  sheetModHighlights: ["dnd4eSheetHighlights"],
  powerLevels: ["dnd4ePowerSymbols"],
  tokenBadges: ["dnd4eTokenBadges"],
  textOverrides: ["dnd4eMonsterTexts"]
};

/** The old module's setting(key), now read from the cards. */
export function dnd4eSetting(key) {
  if (key === "debug") return !!CONFIG.debug?.lucd20dnd4e;
  if (key === "preloadIndexes") return true;
  const entry = SETTING_MAP[key];
  if (!entry) return false;
  const feature = getFeature(entry[0]);
  if (!feature?.isEnabled) return false;
  return entry[1] ? !!feature.get(entry[1]) : true;
}

const refresh = {
  dock: () => import("./actions/dock.mjs").then(m => m.refreshDock?.()).catch(() => {}),
  powers: () => import("./power-badges.mjs").then(m => m.refreshAll?.()).catch(() => {}),
  tokens: () => canvas?.tokens?.placeables?.forEach(t => t.renderFlags?.set({ refresh: true })),
  cover: () => import("./cover-preview.mjs").then(m => (dnd4eSetting("coverPreview") ? m.drawPreview?.() : m.clearPreview?.())).catch(() => {})
};
const noop = () => {};

card({
  id: "dnd4eClassFeatures",
  settings: {
    quarry: { kind: "boolean", default: true },
    curse: { kind: "boolean", default: true },
    rage: { kind: "boolean", default: true },
    marks: { kind: "boolean", default: true },
    warnNotNearest: { kind: "boolean", default: true },
    primeShot: { kind: "boolean", default: true },
    classFeatures: { kind: "boolean", default: true },
    tempHpFeatures: { kind: "boolean", default: true },
    conditionalRiders: { kind: "boolean", default: true },
    powerRiders: { kind: "boolean", default: true }
  },
  enable: noop,
  onSettingChange: noop
});

card({
  id: "dnd4eCover",
  settings: { preview: { kind: "boolean", default: true, scope: "client" } },
  enable: () => refresh.cover(),
  disable: () => refresh.cover(),
  onSettingChange: () => refresh.cover()
});

card({
  id: "dnd4eActionTracker",
  settings: {
    autoMoveActions: { kind: "boolean", default: true },
    panel: { kind: "boolean", default: true, scope: "client" },
    warnings: { kind: "boolean", default: true, scope: "client" },
    dockPips: { kind: "boolean", default: true, scope: "client" }
  },
  enable: () => refresh.dock(),
  disable: () => refresh.dock(),
  onSettingChange: () => refresh.dock()
});

card({ id: "dnd4eOpportunity", enable: noop });
card({ id: "dnd4eTriggeredPowers", enable: noop });
card({ id: "dnd4eDamageApply", enable: noop });
card({ id: "dnd4eClickMovement", enable: noop });
card({ id: "dnd4eReadableRolls", scope: "client", enable: noop });
card({ id: "dnd4eSheetHighlights", scope: "client", enable: noop });
card({ id: "dnd4ePowerSymbols", scope: "client", enable: () => refresh.powers(), disable: () => refresh.powers() });
card({ id: "dnd4eTokenBadges", scope: "client", enable: () => refresh.tokens(), disable: () => refresh.tokens() });
card({
  id: "dnd4eMonsterTexts",
  gmOnly: true,
  enable: noop,
  // Import / export buttons in the card (the same window as Foundry's settings menu).
  renderPanel() {
    return `<div class="lucd20-tt-panel">
      <button type="button" data-action="featureAction" data-feature="dnd4eMonsterTexts" data-feature-action="open">
        <i class="fa-solid fa-language"></i> ${game.i18n.localize("DND4EAUTO.TextOverrides.Button")}</button>
    </div>`;
  },
  hubActions: {
    open: () => import("./features/text-overrides.mjs").then(m => m.openOverridesDialog?.())
  }
});
card({
  id: "dnd4eGameLanguage",
  scope: "client",
  defaultEnabled: false,
  settings: {
    language: { kind: "select", choices: { foundry: "DND4EAUTO.Settings.gameLanguage.Foundry", en: "English", "pt-BR": "Português (Brasil)" }, default: "foundry", requiresReload: true }
  },
  enable: noop
});
