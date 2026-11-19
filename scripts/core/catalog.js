import { systemMatches } from "./constants.js";
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
  { id: "setup", icon: "fa-solid fa-floppy-disk" },
  { id: "exploration", icon: "fa-solid fa-magnifying-glass", systems: ["pf2e"] },
  { id: "pf2e", icon: "fa-solid fa-dice-d20", systems: ["pf2e"] },
  { id: "dnd4e", icon: "fa-solid fa-dragon", systems: ["dnd4e"] }
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
  { id: "sharedPicks", category: "combat", phase: 66 },
  { id: "chatPins", category: "chat", phase: 4 },
  { id: "damageLog", category: "chat", phase: 7 },
  { id: "describe", category: "chat", phase: 18 },
  { id: "rollChances", category: "chat", phase: 51, systems: ["pf2e", "dnd4e"] },
  { id: "modifiersMatter", category: "chat", phase: 52, systems: ["pf2e", "dnd4e"] },
  { id: "damageEstimate", category: "chat", phase: 53, systems: ["pf2e", "dnd4e"] },
  { id: "multiTokenEdit", category: "tokens", phase: 6 },
  { id: "folderDrop", category: "tokens", phase: 6 },
  { id: "pauseNotifier", category: "tokens", phase: 15 },
  { id: "statusHighlight", category: "tokens", phase: 16 },
  { id: "riding", category: "tokens", phase: 21 },
  { id: "tokenScatter", category: "tokens", phase: 22 },
  { id: "flyingTokens", category: "tokens", phase: 22 },
  { id: "tokenTooltip", category: "tokens", phase: 23 },
  { id: "pathfinding", category: "tokens", phase: 25 },
  { id: "npcHealthBars", category: "tokens", phase: 32 },
  { id: "instantRange", category: "tokens", phase: 57 },
  { id: "shortcuts", category: "tokens", phase: 59 },
  { id: "effectsHalo", category: "tokens", phase: 60 },
  { id: "tokenReactions", category: "tokens", phase: 63 },
  { id: "signatureSpells", category: "tokens", phase: 64 }, // phase 65: the Swashbuckler finisher
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
  { id: "sceneAudit", category: "scenes", phase: 31 },
  { id: "quickTeleport", category: "scenes", phase: 61 },
  { id: "diceStats", category: "statistics", phase: 8 },
  { id: "forceSettings", category: "playerSettings", phase: 2 },
  { id: "settingsMarkers", category: "playerSettings", phase: 56 },
  { id: "settingPresets", category: "setup", phase: 34 },
  { id: "searchAutomation", category: "exploration", phase: 11, systems: ["pf2e"] },
  { id: "hazardDetection", category: "exploration", phase: 11, systems: ["pf2e"] },
  { id: "pf2eFrightened", category: "pf2e", phase: 37, systems: ["pf2e"] },
  { id: "pf2eSickened", category: "pf2e", phase: 37, systems: ["pf2e"] },
  { id: "pf2eShove", category: "pf2e", phase: 37, systems: ["pf2e"] },
  { id: "pf2eTrip", category: "pf2e", phase: 37, systems: ["pf2e"] },
  { id: "pf2eTemporalDistortion", category: "pf2e", phase: 38, systems: ["pf2e"] },
  { id: "pf2eReactions", category: "pf2e", phase: 41, systems: ["pf2e"] },
  { id: "pf2eReactiveStrike", category: "pf2e", phase: 42, systems: ["pf2e"] },
  { id: "pf2eShieldBlock", category: "pf2e", phase: 43, systems: ["pf2e"] },
  { id: "pf2eDemoralizingCharge", category: "pf2e", phase: 44, systems: ["pf2e"] },
  { id: "pf2eRoaringHeart", category: "pf2e", phase: 45, systems: ["pf2e"] },
  { id: "pf2ePunishingShove", category: "pf2e", phase: 46, systems: ["pf2e"] },
  { id: "pf2eFlatCheck", category: "pf2e", phase: 47, systems: ["pf2e"] },
  { id: "pf2eCtrlClick", category: "pf2e", phase: 48, systems: ["pf2e"] },
  { id: "pf2eSustain", category: "pf2e", phase: 49, systems: ["pf2e"] },
  { id: "pf2eHands", category: "pf2e", phase: 50, systems: ["pf2e"] },
  { id: "pf2eCover", category: "pf2e", phase: 54, systems: ["pf2e"] },
  { id: "pf2eAreas", category: "pf2e", phase: 55, systems: ["pf2e"] },
  { id: "pf2eCreatureScale", category: "pf2e", phase: 62, systems: ["pf2e"] },
  { id: "pf2eRecallKnowledge", category: "pf2e", phase: 68, systems: ["pf2e"] },
  { id: "pf2eMultiCheck", category: "pf2e", phase: 69, systems: ["pf2e"] },
  { id: "pf2eBattleMedicine", category: "pf2e", phase: 70, systems: ["pf2e"] },
  { id: "pf2eFlanking", category: "pf2e", phase: 70, systems: ["pf2e"] },
  { id: "pf2eCombatAssessment", category: "pf2e", phase: 67, systems: ["pf2e"] },
  { id: "pf2eGuardiansDeflection", category: "pf2e", phase: 67, systems: ["pf2e"] },
  { id: "dnd4eClassFeatures", category: "dnd4e", phase: 26, systems: ["dnd4e"] },
  { id: "dnd4eCover", category: "dnd4e", phase: 26, systems: ["dnd4e"] },
  { id: "dnd4eActionTracker", category: "dnd4e", phase: 26, systems: ["dnd4e"] },
  { id: "dnd4eOpportunity", category: "dnd4e", phase: 26, systems: ["dnd4e"] },
  { id: "dnd4eTriggeredPowers", category: "dnd4e", phase: 26, systems: ["dnd4e"] },
  { id: "dnd4eDamageApply", category: "dnd4e", phase: 26, systems: ["dnd4e"] },
  { id: "dnd4eClickMovement", category: "dnd4e", phase: 26, systems: ["dnd4e"] },
  { id: "dnd4eReadableRolls", category: "dnd4e", phase: 26, systems: ["dnd4e"] },
  { id: "dnd4eSheetHighlights", category: "dnd4e", phase: 26, systems: ["dnd4e"] },
  { id: "dnd4ePowerSymbols", category: "dnd4e", phase: 26, systems: ["dnd4e"] },
  { id: "dnd4eTokenBadges", category: "dnd4e", phase: 26, systems: ["dnd4e"] },
  { id: "dnd4eMonsterTexts", category: "dnd4e", phase: 26, systems: ["dnd4e"] },
  { id: "dnd4eGameLanguage", category: "dnd4e", phase: 26, systems: ["dnd4e"] },
  { id: "dnd4eSkillChallenge", category: "dnd4e", phase: 29, systems: ["dnd4e"] },
  { id: "dnd4ePartyStash", category: "dnd4e", phase: 35, systems: ["dnd4e"] },
  { id: "dnd4eCoinLog", category: "dnd4e", phase: 35, systems: ["dnd4e"] },
  { id: "dnd4eOpportunityWarning", category: "dnd4e", phase: 36, systems: ["dnd4e"] },
  { id: "dnd4eHud", category: "dnd4e", phase: 39, systems: ["dnd4e"] },
  { id: "dnd4eTips", category: "dnd4e", phase: 58, systems: ["dnd4e"] }
];

/** Whether a category / feature entry applies to the active game system. */
export function isAvailableForSystem(entry) {
  return !entry.systems?.length || entry.systems.some(systemMatches);
}

/* -------------------------------------------- */
/*  The settings window's layout (v0.62.0)      */
/* -------------------------------------------- */

/**
 * The owner chose layout C (docs/mockups/settings-c.png): a tree on the left (groups → pages → a class's
 * section), one line per feature, options opening under it. Groups: General, the active system, Setup.
 * A page takes its features from old categories (`from`) and from PLACE; sections order a page.
 */
export const NAV = [
  { id: "general", pages: [
    { id: "combat", icon: "fa-solid fa-shield-halved", from: ["combat"] },
    { id: "chat", icon: "fa-solid fa-comments", from: ["chat", "statistics"] },
    { id: "tokens", icon: "fa-solid fa-map-location-dot", from: ["tokens"] },
    { id: "visionDoors", icon: "fa-solid fa-eye", from: ["vision", "doors"] },
    { id: "scenesWindows", icon: "fa-solid fa-clapperboard", from: ["scenes", "sheets"] }
  ] },
  { id: "pf2e", systems: ["pf2e"], pages: [
    { id: "pf2eCore", icon: "fa-solid fa-book", from: ["pf2e"], sections: ["conditions", "actions", "reactions", "battlefield", "tools"] },
    { id: "pf2eClasses", icon: "fa-solid fa-users", sections: ["animist", "commander", "guardian", "oracle", "swashbuckler"], tree: true },
    { id: "pf2eExploration", icon: "fa-solid fa-magnifying-glass", from: ["exploration"] },
    { id: "pf2eChat", icon: "fa-solid fa-dice", features: ["rollChances", "modifiersMatter", "damageEstimate"] }
  ] },
  { id: "dnd4e", systems: ["dnd4e"], pages: [
    { id: "dnd4eCore", icon: "fa-solid fa-book", from: ["dnd4e"] },
    { id: "dnd4eClasses", icon: "fa-solid fa-users" },
    { id: "dnd4eInterface", icon: "fa-solid fa-display" },
    { id: "dnd4eTools", icon: "fa-solid fa-toolbox" },
    { id: "dnd4eChat", icon: "fa-solid fa-dice", features: ["rollChances", "modifiersMatter", "damageEstimate"] }
  ] },
  { id: "setup", pages: [
    { id: "players", icon: "fa-solid fa-user-lock", from: ["playerSettings", "setup"] }
  ] }
];

/** Where a feature goes when not by its category: page and section. */
export const PLACE = {
  pf2eFrightened: { page: "pf2eCore", section: "conditions" },
  pf2eSickened: { page: "pf2eCore", section: "conditions" },
  pf2eShove: { page: "pf2eCore", section: "actions" },
  pf2eTrip: { page: "pf2eCore", section: "actions" },
  pf2eFlatCheck: { page: "pf2eCore", section: "actions" },
  pf2eRecallKnowledge: { page: "pf2eCore", section: "actions" },
  pf2eReactions: { page: "pf2eCore", section: "reactions" },
  pf2eReactiveStrike: { page: "pf2eCore", section: "reactions" },
  pf2eShieldBlock: { page: "pf2eCore", section: "reactions" },
  pf2eCover: { page: "pf2eCore", section: "battlefield" },
  pf2eAreas: { page: "pf2eCore", section: "battlefield" },
  pf2eSustain: { page: "pf2eCore", section: "battlefield" },
  pf2eHands: { page: "pf2eCore", section: "tools" },
  pf2eCtrlClick: { page: "pf2eCore", section: "tools" },
  pf2eCreatureScale: { page: "pf2eCore", section: "tools" },
  pf2eMultiCheck: { page: "pf2eCore", section: "tools" },
  pf2eBattleMedicine: { page: "pf2eCore", section: "actions" },
  pf2eFlanking: { page: "pf2eCore", section: "battlefield" },
  pf2eRoaringHeart: { page: "pf2eClasses", section: "animist" },
  pf2eDemoralizingCharge: { page: "pf2eClasses", section: "commander" },
  pf2eCombatAssessment: { page: "pf2eClasses", section: "commander" },
  pf2eGuardiansDeflection: { page: "pf2eClasses", section: "swashbuckler" },
  pf2ePunishingShove: { page: "pf2eClasses", section: "guardian" },
  pf2eTemporalDistortion: { page: "pf2eClasses", section: "oracle" },
  dnd4eClassFeatures: { page: "dnd4eClasses" },
  dnd4eHud: { page: "dnd4eInterface" },
  dnd4eTips: { page: "dnd4eInterface" },
  dnd4eReadableRolls: { page: "dnd4eInterface" },
  dnd4eSheetHighlights: { page: "dnd4eInterface" },
  dnd4ePowerSymbols: { page: "dnd4eInterface" },
  dnd4eTokenBadges: { page: "dnd4eInterface" },
  dnd4eMonsterTexts: { page: "dnd4eInterface" },
  dnd4eGameLanguage: { page: "dnd4eInterface" },
  dnd4eSkillChallenge: { page: "dnd4eTools" },
  dnd4ePartyStash: { page: "dnd4eTools" },
  dnd4eCoinLog: { page: "dnd4eTools" }
};

/** The page (and section) a feature belongs to in this world. */
export function placeOf(id, category) {
  const place = PLACE[id];
  if (place) return place;
  const groups = NAV.filter(isAvailableForSystem);
  for (const group of groups) for (const page of group.pages) if (page.features?.includes(id)) return { page: page.id };
  for (const group of groups) for (const page of group.pages) if (page.from?.includes(category)) return { page: page.id };
  return { page: null };
}
