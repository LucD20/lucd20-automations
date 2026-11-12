/**
 * The settings layout from docs/PLAN.md §2.
 *
 * CATEGORIES defines the sidebar order. FEATURE_ORDER defines the order of
 * cards inside each category and lists features that are planned but not yet
 * built (shown greyed out to the GM so the final layout is visible from day one).
 * A feature that is built and registered replaces its planned entry.
 */

export const CATEGORIES = [
  { id: "combat", icon: "fa-solid fa-shield-halved" },
  { id: "chat", icon: "fa-solid fa-comments" },
  { id: "tokens", icon: "fa-solid fa-map-location-dot" },
  { id: "vision", icon: "fa-solid fa-eye" },
  { id: "sheets", icon: "fa-solid fa-window-maximize" },
  { id: "statistics", icon: "fa-solid fa-chart-simple" },
  { id: "doors", icon: "fa-solid fa-door-closed" },
  { id: "scenes", icon: "fa-solid fa-clapperboard" },
  { id: "playerSettings", icon: "fa-solid fa-user-lock" },
  { id: "exploration", icon: "fa-solid fa-magnifying-glass", systems: ["pf2e"] }
];

export const FEATURE_ORDER = [
  { id: "turnMarker", category: "combat", phase: 5 },
  { id: "nextTurnMarker", category: "combat", phase: 5 },
  { id: "turnAnnouncer", category: "combat", phase: 4 },
  { id: "lootPile", category: "combat", phase: 10 },
  { id: "combatTrackerWindow", category: "combat", phase: 14 },
  { id: "encounterVisibility", category: "combat", phase: 13 },
  { id: "defeatAutomation", category: "combat", phase: 13 },
  { id: "hudCombatLock", category: "combat", phase: 12 },
  { id: "combatMovement", category: "combat", phase: 15 },
  { id: "chatPins", category: "chat", phase: 4 },
  { id: "damageLog", category: "chat", phase: 7 },
  { id: "describe", category: "chat", phase: 18 },
  { id: "multiTokenEdit", category: "tokens", phase: 6 },
  { id: "folderDrop", category: "tokens", phase: 6 },
  { id: "pauseNotifier", category: "tokens", phase: 15 },
  { id: "statusHighlight", category: "tokens", phase: 16 },
  { id: "riding", category: "tokens", phase: 21 },
  { id: "tokenScatter", category: "tokens", phase: 22 },
  { id: "tokenTooltip", category: "tokens", phase: 23 },
  { id: "pathfinding", category: "tokens", phase: 25 },
  { id: "doorIconSize", category: "doors", phase: 19 },
  { id: "secretDoorHighlight", category: "doors", phase: 19 },
  { id: "lockedDoorAlert", category: "doors", phase: 19 },
  { id: "gmVision", category: "vision", phase: 9 },
  { id: "outOfSightOutlines", category: "vision", phase: 9 },
  { id: "cleanTitleBars", category: "sheets", phase: 3 },
  { id: "headerButtons", category: "sheets", phase: 3 },
  { id: "sceneNavigation", category: "scenes", phase: 16 },
  { id: "scenePalette", category: "scenes", phase: 16 },
  { id: "hiddenTrackNames", category: "scenes", phase: 17 },
  { id: "diceStats", category: "statistics", phase: 8 },
  { id: "forceSettings", category: "playerSettings", phase: 2 },
  { id: "searchAutomation", category: "exploration", phase: 11, systems: ["pf2e"] },
  { id: "hazardDetection", category: "exploration", phase: 11, systems: ["pf2e"] }
];

/** Whether a category / feature entry applies to the active game system. */
export function isAvailableForSystem(entry) {
  return !entry.systems?.length || entry.systems.includes(game.system.id);
}
