import { MODULE_ID, localize } from "../../core/constants.js";
import { defineFeature, getFeature } from "../../core/registry.js";
import { appElement } from "../../core/dom.js";
import { initSearchSockets, isSearching, pathPoints, pixelsPerUnit, searchSpot } from "./search-engine.js";
import { hazardDefaults, hazardSpot, sceneHazards, sceneRegionSpots } from "./search-spots.js";
import { SearchManager, SpotPlacer, editSpot } from "./search-ui.js";

/**
 * PF2e Search Automation (search spots) and Hazard Detection.
 * Replaces the Monk's Active Tiles setup with "Search-Trained" effects.
 *
 * Triggers (active GM only):
 *   - a player character's token moves (every point along the move counts),
 *   - a door opens or closes (hazard areas change with walls),
 *   - a character changes exploration activity while standing somewhere.
 * Theater of Mind: "Roll Search now" in the Search Spots manager.
 */

const busy = new Set();
const isPC = actor => actor?.type === "character" && actor.hasPlayerOwner;

function tokenCentre(doc) {
  const size = canvas.dimensions.size;
  return { x: doc.x + (doc.width * size) / 2, y: doc.y + (doc.height * size) / 2 };
}

/** Last known centre of each token, to sample the path of a move. */
const lastPositions = new Map();

function rememberPositions() {
  lastPositions.clear();
  for (const t of canvas.scene?.tokens ?? []) lastPositions.set(t.id, tokenCentre(t));
}

async function trigger(spot, how, options = {}) {
  if (busy.has(spot.id)) return;
  busy.add(spot.id);
  try {
    await searchSpot(spot, { save: patch => spot.save(patch), where: spot.centre, how, ...options });
  } finally {
    busy.delete(spot.id);
    SearchManager.refresh();
  }
}

/* -------------------------------------------- */
/*  Search spots                                */
/* -------------------------------------------- */

function checkRegions(actor, points, how) {
  if (!isSearching(actor)) return;
  for (const spot of sceneRegionSpots(canvas.scene)) {
    if (!spot.enabled || spot.found || !spot.dc) continue;
    if (points.some(p => spot.contains(p))) trigger(spot, how);
  }
}

/* -------------------------------------------- */
/*  Hazards                                     */
/* -------------------------------------------- */

function hazardOptions(spot) {
  const feature = getFeature("hazardDetection");
  return {
    allowNonSearching: !!feature?.get("nonSearching"),
    onFound: async () => {
      if (spot.doc.hidden) await spot.doc.update({ hidden: false });
    }
  };
}

function checkHazards(actor, points, how) {
  const feature = getFeature("hazardDetection");
  if (!feature?.active) return;
  const nonSearching = feature.get("nonSearching");
  for (const spot of sceneHazards(canvas.scene, hazardDefaults())) {
    if (!spot.enabled || spot.found || spot.dc === null) continue;
    if (!isSearching(actor) && !(nonSearching && !spot.minRank)) continue;
    if (points.some(p => spot.contains(p))) trigger(spot, how, hazardOptions(spot));
  }
}

/* -------------------------------------------- */
/*  Hazard areas (GM)                           */
/* -------------------------------------------- */

const areas = { layer: null, timer: null };

function clearAreas() {
  if (areas.layer && !areas.layer.destroyed) {
    areas.layer.parent?.removeChild(areas.layer);
    areas.layer.destroy({ children: true });
  }
  areas.layer = null;
}

function drawAreas() {
  areas.timer = null;
  clearAreas();
  const feature = getFeature("hazardDetection");
  if (!feature?.active || !feature.get("showAreas") || !game.user.isGM || !canvas?.ready) return;
  const layer = new PIXI.Container();
  layer.eventMode = "none";
  (canvas.interface ?? canvas.controls ?? canvas.stage).addChild(layer);
  areas.layer = layer;
  const backend = CONFIG.Canvas?.polygonBackends?.sight;
  for (const spot of sceneHazards(canvas.scene, hazardDefaults())) {
    if (!spot.enabled || spot.found || spot.dc === null || !spot.range) continue;
    const doc = spot.doc;
    const size = canvas.dimensions.size;
    const radius = spot.range * pixelsPerUnit() + (Math.max(doc.width, doc.height) * size) / 2;
    const g = new PIXI.Graphics();
    g.lineStyle(2, 0xee9b3a, 0.55).beginFill(0xee9b3a, 0.05);
    let shape = null;
    try {
      shape = backend?.create?.(spot.centre, { type: "sight", radius });
    } catch {
      shape = null;
    }
    if (shape?.points?.length) g.drawPolygon(shape.points);
    else g.drawCircle(spot.centre.x, spot.centre.y, radius);
    g.endFill();
    layer.addChild(g);
  }
}

function scheduleAreas() {
  if (areas.timer) return;
  areas.timer = setTimeout(drawAreas, 150);
}

/* -------------------------------------------- */
/*  Token menu button on hazards (GM)           */
/* -------------------------------------------- */

function addHazardButton(hud, html) {
  if (!game.user.isGM) return;
  const root = (html instanceof HTMLElement ? html : html?.[0]) ?? appElement(hud);
  const doc = hud.object?.document ?? hud.document;
  if (!root || doc?.actor?.type !== "hazard" || root.querySelector(".lucd20-hazard-search")) return;
  const column = root.querySelector(".col.left") ?? root.querySelector(".col.right") ?? root;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon lucd20-hazard-search";
  button.dataset.tooltip = localize("LUCD20.Search.HazardButton");
  button.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    const spot = hazardSpot(doc, hazardDefaults());
    if (!spot) return;
    if (spot.dc === null) spot.dc = undefined;
    await editSpot(spot);
    scheduleAreas();
  });
  column.append(button);
}

/* -------------------------------------------- */
/*  Movement, doors, activities (active GM)     */
/* -------------------------------------------- */

function onUpdateToken(doc, changes) {
  if (doc.parent !== canvas.scene) return;
  if (doc.actor?.type === "hazard") scheduleAreas();
  if (!("x" in changes) && !("y" in changes)) return;
  const to = tokenCentre(doc);
  const from = lastPositions.get(doc.id);
  lastPositions.set(doc.id, to);
  if (!game.user.isActiveGM || !isPC(doc.actor)) return;
  const points = pathPoints(from, to);
  if (getFeature("searchAutomation")?.active) checkRegions(doc.actor, points, "entered");
  checkHazards(doc.actor, points, "entered");
}

function onUpdateWall(wall, changes) {
  if (!("ds" in changes) && !("c" in changes)) return;
  scheduleAreas();
  if (!game.user.isActiveGM) return;
  // Re-check after the walls have been updated on the canvas.
  setTimeout(() => {
    for (const token of canvas.scene?.tokens ?? []) {
      if (isPC(token.actor)) checkHazards(token.actor, [tokenCentre(token)], "door");
    }
  }, 200);
}

function onUpdateActor(actor, changes) {
  if (!game.user.isActiveGM || !isPC(actor) || !foundry.utils.hasProperty(changes, "system.exploration")) return;
  for (const token of actor.getActiveTokens?.(false, true) ?? []) {
    if (token.parent !== canvas.scene) continue;
    const point = [tokenCentre(token)];
    if (getFeature("searchAutomation")?.active) checkRegions(actor, point, "entered");
    checkHazards(actor, point, "entered");
  }
}

/* -------------------------------------------- */
/*  Scene controls                              */
/* -------------------------------------------- */

function onSceneControls(controls) {
  if (!game.user.isGM) return;
  const tokens = Array.isArray(controls) ? controls.find(c => c.name === "token") : controls?.tokens ?? controls?.token;
  if (!tokens?.tools) return;
  const tools = [
    {
      name: "lucd20SearchSpot",
      title: localize("LUCD20.Search.Place"),
      icon: "fa-solid fa-magnifying-glass-location",
      button: true,
      visible: true,
      order: 90,
      onChange: () => SpotPlacer.start(),
      onClick: () => SpotPlacer.start()
    },
    {
      name: "lucd20SearchManager",
      title: localize("LUCD20.Search.ManagerTitle"),
      icon: "fa-solid fa-list-check",
      button: true,
      visible: true,
      order: 91,
      onChange: () => SearchManager.open(),
      onClick: () => SearchManager.open()
    }
  ];
  for (const tool of tools) {
    if (Array.isArray(tokens.tools)) {
      if (tokens.tools.some(t => t.name === tool.name)) continue;
      delete tool.onChange;
      tokens.tools.push(tool);
    } else {
      delete tool.onClick;
      tokens.tools[tool.name] = tool;
    }
  }
}

/* -------------------------------------------- */
/*  Features                                    */
/* -------------------------------------------- */

function refreshControls() {
  if (canvas?.ready) ui.controls?.render?.({ reset: true });
}

defineFeature({
  id: "searchAutomation",
  category: "exploration",
  systems: ["pf2e"],
  scope: "world",
  gmOnly: true,
  defaultEnabled: false,
  settings: {
    pause: { kind: "boolean", default: true },
    pan: { kind: "boolean", default: true },
    gmCard: { kind: "boolean", default: true },
    foundText: { kind: "string", default: "" }
  },

  init() {
    initSearchSockets();
  },

  enable(feature) {
    rememberPositions();
    feature.on("canvasReady", rememberPositions);
    feature.on("updateToken", (doc, changes) => {
      // Hazard Detection registers the same handler; run it once.
      if (!getFeature("hazardDetection")?.active) onUpdateToken(doc, changes);
    });
    feature.on("updateActor", (actor, changes) => {
      if (!getFeature("hazardDetection")?.active) onUpdateActor(actor, changes);
    });
    feature.on("getSceneControlButtons", onSceneControls);
    for (const hook of ["createRegion", "updateRegion", "deleteRegion"]) feature.on(hook, () => SearchManager.refresh());
    refreshControls();
    feature.onCleanup(() => {
      SpotPlacer.active?.stop();
      foundry.applications.instances?.get(SearchManager.DEFAULT_OPTIONS.id)?.close();
      refreshControls();
    });
  }
});

defineFeature({
  id: "hazardDetection",
  category: "exploration",
  systems: ["pf2e"],
  scope: "world",
  gmOnly: true,
  defaultEnabled: false,
  settings: {
    autoEnable: { kind: "boolean", default: true },
    defaultRange: { kind: "number", min: 0, step: 5, default: 50 },
    nonSearching: { kind: "boolean", default: false },
    showAreas: { kind: "boolean", default: true }
  },

  enable(feature) {
    SearchManager.hooks = {
      hazards: true,
      allowNonSearching: spot => spot.kind === "hazard" && !!feature.get("nonSearching"),
      onFound: spot => (spot.kind === "hazard" ? hazardOptions(spot).onFound() : null)
    };
    rememberPositions();
    feature.on("canvasReady", () => {
      rememberPositions();
      scheduleAreas();
    });
    feature.on("updateToken", onUpdateToken);
    feature.on("updateActor", onUpdateActor);
    feature.on("updateWall", onUpdateWall);
    for (const hook of ["createToken", "deleteToken", "createWall", "deleteWall"]) feature.on(hook, scheduleAreas);
    feature.on("renderTokenHUD", addHazardButton);
    // The manager (Theater of Mind, reset) is reachable even when search spots are off.
    feature.on("getSceneControlButtons", onSceneControls);
    scheduleAreas();
    refreshControls();
    feature.onCleanup(() => {
      SearchManager.hooks = { hazards: false, allowNonSearching: () => false, onFound: () => {} };
      clearTimeout(areas.timer);
      areas.timer = null;
      clearAreas();
      document.querySelectorAll(".lucd20-hazard-search").forEach(el => el.remove());
      refreshControls();
    });
  }
});
