import { localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { watchDOM } from "../core/dom-watch.js";
import { appElement } from "../core/dom.js";

/**
 * Scene Navigation (replaces part of Monk's Scene Navigation). GM only.
 *
 * - Left-click views: in the Scenes sidebar, left-clicking a scene views it
 *   instead of opening its settings (owner checked: V14 opens the settings).
 *   Configure stays in the right-click menu.
 * - Navigation toggle: a compass icon on each scene toggles whether it shows
 *   in the navigation bar (`navigation`). Bright when on, dim when off.
 * - Collapse during combat: when a combat starts, the navigation bar collapses
 *   on every client; it re-opens when the last combat ends, if we collapsed it.
 */

const state = { feature: null, collapsedByUs: false };

/** The scene id of a sidebar entry. */
function entryId(li) {
  return li?.dataset.entryId ?? li?.dataset.documentId ?? li?.dataset.sceneId ?? null;
}

function directoryRoot() {
  return appElement(ui.scenes) ?? document.getElementById("scenes");
}

/* -------------------------------------------- */
/*  Left-click views                            */
/* -------------------------------------------- */

/**
 * One click listener on the document, in the capture phase, runs before
 * Foundry's own handlers on the sidebar (V14 opened the settings first even
 * when the compass was clicked).
 */
function onClick(event) {
  if (!game.user.isGM || event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : null;
  const root = directoryRoot();
  if (!target || !root?.contains(target)) return;

  // Compass: toggle the navigation entry, nothing else.
  const compass = target.closest(".lucd20-scene-nav");
  if (compass) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const scene = game.scenes.get(entryId(compass.closest("li")));
    scene?.update({ navigation: !scene.navigation });
    return;
  }

  if (!state.feature?.get("clickToView")) return;
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return; // keep Foundry's modified clicks
  if (target.closest("button, input, select, .entry-controls, .folder-header, header.directory-header, .directory-footer")) return;
  const li = target.closest("li.directory-item, li.entry, li[data-entry-id], li[data-document-id]");
  if (!li || li.classList.contains("folder")) return;
  const scene = game.scenes.get(entryId(li));
  if (!scene) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  scene.view();
}

/** Swallow the other pointer events on the compass so Foundry doesn't start a drag or open anything. */
function onPointer(event) {
  if (event.target instanceof Element && event.target.closest(".lucd20-scene-nav")) event.stopImmediatePropagation();
}

/* -------------------------------------------- */
/*  Navigation toggle                           */
/* -------------------------------------------- */

function drawToggles() {
  const root = directoryRoot();
  if (!root || !game.user.isGM) return;
  const show = state.feature?.get("navToggle");
  for (const li of root.querySelectorAll("li.directory-item, li.entry")) {
    if (li.classList.contains("folder")) continue;
    const scene = game.scenes.get(entryId(li));
    let button = li.querySelector(".lucd20-scene-nav");
    if (!scene || !show) {
      button?.remove();
      continue;
    }
    const on = !!scene.navigation;
    if (button?.dataset.on === String(on)) continue;
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "lucd20-scene-nav inline-control icon fa-solid fa-compass";
      const name = li.querySelector(".entry-name, .document-name, h4, a");
      (name?.parentElement === li ? name : li.firstElementChild ?? li).after(button);
    }
    button.dataset.on = String(on);
    button.classList.toggle("on", on);
    const tip = localize(on ? "LUCD20.SceneNavigation.InNav" : "LUCD20.SceneNavigation.NotInNav");
    button.dataset.tooltip = tip;
    button.setAttribute("aria-label", tip);
  }
}

/* -------------------------------------------- */
/*  Collapse during combat                      */
/* -------------------------------------------- */

function navExpanded() {
  const nav = ui.nav;
  if (!nav) return false;
  if (typeof nav.expanded === "boolean") return nav.expanded;
  if (typeof nav._collapsed === "boolean") return !nav._collapsed;
  return !appElement(nav)?.classList.contains("collapsed");
}

function collapseNav() {
  if (!state.feature?.get("collapseInCombat") || !navExpanded()) return;
  if (typeof ui.nav?.collapse === "function") {
    ui.nav.collapse();
    state.collapsedByUs = true;
  }
}

function expandNav(force = false) {
  if (!state.collapsedByUs) return;
  if (!force && game.combats?.some(c => c.started)) return;
  state.collapsedByUs = false;
  if (!navExpanded() && typeof ui.nav?.expand === "function") ui.nav.expand();
}

defineFeature({
  id: "sceneNavigation",
  category: "scenes",
  scope: "world",
  gmOnly: true,
  defaultEnabled: false,
  settings: {
    clickToView: { kind: "boolean", default: true },
    navToggle: { kind: "boolean", default: true },
    collapseInCombat: { kind: "boolean", default: true }
  },

  enable(feature) {
    state.feature = feature;
    document.addEventListener("click", onClick, true);
    for (const type of ["pointerdown", "mousedown", "dblclick"]) document.addEventListener(type, onPointer, true);
    feature.onCleanup(() => {
      document.removeEventListener("click", onClick, true);
      for (const type of ["pointerdown", "mousedown", "dblclick"]) document.removeEventListener(type, onPointer, true);
    });

    feature.onCleanup(watchDOM("scene-navigation-toggles", drawToggles));
    feature.on("updateScene", (scene, changes) => {
      if ("navigation" in changes) drawToggles();
    });
    feature.onCleanup(() => document.querySelectorAll(".lucd20-scene-nav").forEach(el => el.remove()));

    feature.on("updateCombat", (combat, changed) => {
      if (changed.round === 1 && combat.started) collapseNav();
    });
    feature.on("deleteCombat", () => expandNav());
    if (game.combats?.some(c => c.started)) collapseNav();
    feature.onCleanup(() => expandNav(true));
  },

  onSettingChange() {
    drawToggles();
  }
});
