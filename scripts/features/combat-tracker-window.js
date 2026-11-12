import { MODULE_ID } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";

/**
 * Combat Tracker Window (replaces part of Monk's Combat Details).
 *
 * - When an encounter is created, the combat tracker pops out at the bottom
 *   right, against the left edge of the sidebar. It stays anchored there as
 *   combatants are added (its height grows upward) until it is moved by hand.
 * - When the combat is deleted, the pop-out closes, but only if we opened it.
 * - Players: it only pops out once the combat has a combatant they can see,
 *   so a combat made of hidden combatants doesn't give anything away.
 * - Once per combat: closing it by hand doesn't make it come back.
 *
 * Foundry already scrolls the tracker so the current and next combatants are
 * visible (owner checked in V14), so there is no "follow the turn" option.
 */

const GAP = 8;
const state = {
  feature: null,
  handled: new Set(), // combat ids already popped out (or skipped) on this client
  opened: null, // { combatId, left, top, manual } while the pop-out is ours
  timer: null
};

function popoutApp() {
  return ui.combat?.popout ?? ui.combat?._popout ?? null;
}

function popoutElement(app = popoutApp()) {
  const el = app?.element;
  return el instanceof HTMLElement ? el : el?.[0] ?? null;
}

function isOpen() {
  const app = popoutApp();
  return !!(app && (app.rendered ?? popoutElement(app)?.isConnected));
}

/** Players only see combatants that aren't hidden (and owned ones). */
function hasVisibleCombatant(combat) {
  if (game.user.isGM) return true;
  return [...(combat.combatants ?? [])].some(c => c.visible ?? (!c.hidden || c.isOwner));
}

/** Whether this combat is shown in this client's tracker (its scene, or no scene). */
function onViewedScene(combat) {
  const scene = combat.scene ?? null;
  return !scene || !canvas?.scene || scene === canvas.scene || scene.id === canvas.scene.id;
}

/** Bottom right, against the left edge of the sidebar. */
function anchor() {
  const el = popoutElement();
  if (!el) return null;
  const sidebar = document.getElementById("sidebar");
  const right = sidebar?.getBoundingClientRect().left || window.innerWidth;
  const width = el.offsetWidth || 300;
  const height = el.offsetHeight || 400;
  return {
    left: Math.max(0, Math.round(right - width - GAP)),
    top: Math.max(0, Math.round(window.innerHeight - height - GAP))
  };
}

function place() {
  const app = popoutApp();
  if (!state.opened || state.opened.manual || !app) return;
  const el = popoutElement(app);
  if (el && state.opened.left !== null) {
    // Moved by hand → leave it where the user put it.
    const rect = el.getBoundingClientRect();
    if (Math.abs(rect.left - state.opened.left) > 2 || Math.abs(rect.top - state.opened.top) > 2) {
      state.opened.manual = true;
      return;
    }
  }
  const pos = anchor();
  if (!pos) return;
  app.setPosition?.(pos);
  state.opened.left = pos.left;
  state.opened.top = pos.top;
}

function schedulePlace() {
  clearTimeout(state.timer);
  state.timer = setTimeout(place, 30);
}

async function popOut(combat) {
  if (state.handled.has(combat.id)) return;
  if (!onViewedScene(combat) || !hasVisibleCombatant(combat)) return;
  state.handled.add(combat.id);
  if (isOpen()) return; // already open: the user's window, not ours
  try {
    await ui.combat?.renderPopout?.(true);
  } catch (err) {
    console.error(`${MODULE_ID} | Combat Tracker Window: could not pop out the tracker.`, err);
    return;
  }
  state.opened = { combatId: combat.id, left: null, top: null, manual: false };
  // Wait for the window to be drawn before measuring it.
  await new Promise(r => requestAnimationFrame(() => r()));
  place();
}

function onDeleteCombat(combat) {
  state.handled.delete(combat.id);
  if (state.opened?.combatId !== combat.id) return;
  const app = popoutApp();
  state.opened = null;
  if (state.feature.get("closeOnEnd") && isOpen()) app.close?.();
}

defineFeature({
  id: "combatTrackerWindow",
  category: "combat",
  scope: "client",
  defaultEnabled: true,
  settings: {
    closeOnEnd: { kind: "boolean", default: true }
  },

  enable(feature) {
    state.feature = feature;
    // Combats that already exist when this starts are not popped out (except,
    // for players, one whose first visible combatant appears later).
    for (const combat of game.combats ?? []) if (hasVisibleCombatant(combat)) state.handled.add(combat.id);

    feature.on("createCombat", combat => popOut(combat));
    // Players: the first combatant they can see.
    const recheck = doc => {
      const combat = doc?.parent ?? doc?.combat ?? null;
      if (combat && !game.user.isGM) popOut(combat);
    };
    feature.on("createCombatant", recheck);
    feature.on("updateCombatant", recheck);
    feature.on("deleteCombat", onDeleteCombat);

    // Keep it anchored to the bottom while rows are added or removed.
    feature.on("renderCombatTracker", app => {
      if (state.opened && app === popoutApp()) schedulePlace();
    });
    for (const hook of ["createCombatant", "deleteCombatant"]) feature.on(hook, () => state.opened && schedulePlace());
    feature.onCleanup(() => {
      clearTimeout(state.timer);
      state.opened = null;
    });
  },

  onSettingChange() {} // read when needed
});
