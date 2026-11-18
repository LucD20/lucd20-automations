import { MODULE_ID, error, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";

/**
 * Quick Teleport (replaces Stairways, much simpler; owner, Q272–Q273, as recommended). GM only, every system.
 * - A "Place stairs" tool in Foundry's Regions controls. Click (one square) or drag (a rectangle) for the first
 *   end, then the same for the other end, on this scene or after switching to another one.
 * - Two Regions are created right away, each with Foundry's own Teleport Token behaviour pointing at the other
 *   ("Stairs 3 · A" / "Stairs 3 · B", one colour per pair). Foundry does the teleporting; nothing is kept here.
 * - Two-way by default; "One-way" on the tool's bar gives only the first end a teleport.
 * - The player is asked before teleporting (the behaviour's "choice"), so a drag or a route across the stairs
 *   doesn't teleport by surprise. The regions are seen by the GM only: the map art shows the stairs.
 * - Esc, right-click or Cancel stops; after the first end, Cancel deletes it.
 * - v0.71.1 (owner's movement record: the token stopped at y 2351, half a square into the stairs, then teleported, so the
 *   walk showed fractions like "85.1 + 4.9000…06 ft"): for any region with a Teleport Token behaviour, a token enters it
 *   at the first grid square of its path that is inside, not where its centre crosses the edge. Done through V14's
 *   `TokenDocument#segmentizeRegionMovementPath` (made to be overridden): only the ENTER point moves forward along the
 *   same path, to a snapped position inside the region, so the walk counts whole squares and the teleport costs 0.
 */

const FLAG = "quickTeleport";
const COLORS = ["#4aa3df", "#e67e22", "#9b59b6", "#2ecc71", "#e74c3c", "#f1c40f", "#1abc9c", "#ff6fae"];
const t = (key, data) => localize(`LUCD20.QuickTeleport.${key}`, data);

/** The next pair number, across every scene. */
function nextPair() {
  let max = 0;
  for (const scene of game.scenes ?? []) {
    for (const region of scene.regions ?? []) max = Math.max(max, Number(region.getFlag?.(MODULE_ID, FLAG)?.pair ?? region.flags?.[MODULE_ID]?.[FLAG]?.pair) || 0);
  }
  return max + 1;
}

/** Foundry's Teleport Token behaviour, asking the player first. */
export function teleportBehavior(destinationUuid) {
  return { name: t("BehaviorName"), type: "teleportToken", system: { destination: destinationUuid, choice: true } };
}

/** One end: a GM-only rectangle region, flagged with its pair. */
async function createEnd(scene, rect, { pair, end, color, behaviors = [] }) {
  const [region] = await scene.createEmbeddedDocuments("Region", [{
    name: t("RegionName", { n: pair, end: end.toUpperCase() }),
    color,
    visibility: CONST.REGION_VISIBILITY?.GAMEMASTER ?? 1,
    shapes: [{ type: "rectangle", x: rect.x, y: rect.y, width: rect.width, height: rect.height, rotation: 0, hole: false }],
    behaviors,
    flags: { [MODULE_ID]: { [FLAG]: { pair, end } } }
  }]);
  return region;
}

/* -------------------------------------------- */
/*  Placing                                     */
/* -------------------------------------------- */

export class StairsPlacer {
  static active = null;

  static start() {
    if (!game.user.isGM) return;
    if (StairsPlacer.active) return StairsPlacer.active.showBar();
    StairsPlacer.active = new StairsPlacer();
    StairsPlacer.active.begin();
  }

  constructor() {
    this.first = null;      // { uuid, pair, color }
    this.oneWay = false;
    this.busy = false;
    for (const m of ["down", "move", "up", "key", "context", "teardown"]) this[m] = this[m].bind(this);
  }

  begin() {
    window.addEventListener("pointerdown", this.down, true);
    window.addEventListener("pointermove", this.move, true);
    window.addEventListener("pointerup", this.up, true);
    window.addEventListener("keydown", this.key, true);
    window.addEventListener("contextmenu", this.context, true);
    this.teardownHook = Hooks.on("canvasTearDown", this.teardown);
    this.showBar();
  }

  stop() {
    window.removeEventListener("pointerdown", this.down, true);
    window.removeEventListener("pointermove", this.move, true);
    window.removeEventListener("pointerup", this.up, true);
    window.removeEventListener("keydown", this.key, true);
    window.removeEventListener("contextmenu", this.context, true);
    if (this.teardownHook) Hooks.off("canvasTearDown", this.teardownHook);
    this.preview?.destroy();
    this.preview = null;
    this.bar?.remove();
    this.bar = null;
    if (StairsPlacer.active === this) StairsPlacer.active = null;
  }

  /** The scene changes (placing the other end elsewhere): the preview went with the old canvas. */
  teardown() {
    this.preview = null;
    this.start = null;
  }

  showBar() {
    this.bar?.remove();
    const bar = document.createElement("div");
    bar.className = "lucd20-pick-bar lucd20-qt-bar";
    const text = document.createElement("span");
    text.textContent = this.first ? t("PlaceSecond", { n: this.first.pair }) : t("PlaceFirst");
    const oneWay = document.createElement("label");
    oneWay.className = "lucd20-qt-oneway";
    oneWay.innerHTML = `<input type="checkbox"${this.oneWay ? " checked" : ""}> ${t("OneWay")}`;
    oneWay.title = t("OneWayHint");
    oneWay.querySelector("input").addEventListener("change", (e) => { this.oneWay = e.currentTarget.checked; });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.innerHTML = `<i class="fa-solid fa-xmark"></i> ${t("Cancel")}`;
    cancel.addEventListener("click", () => this.cancel());
    bar.append(text, oneWay, cancel);
    const hotbar = (document.getElementById("lucd20-hud4e") ?? document.getElementById("hotbar"))?.getBoundingClientRect();
    bar.style.bottom = `${hotbar?.height ? Math.max(8, window.innerHeight - hotbar.top + 12) : 100}px`;
    document.body.append(bar);
    this.bar = bar;
  }

  point(event) {
    if (canvas.canvasCoordinatesFromClient) return canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
    const rect = canvas.app.view.getBoundingClientRect();
    return canvas.stage.worldTransform.applyInverse(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
  }

  /** A rectangle snapped to the grid; at least one square. */
  rect(a, b) {
    const s = canvas.dimensions.size;
    const x1 = Math.floor(Math.min(a.x, b.x) / s) * s;
    const y1 = Math.floor(Math.min(a.y, b.y) / s) * s;
    const x2 = Math.max(Math.ceil(Math.max(a.x, b.x) / s) * s, x1 + s);
    const y2 = Math.max(Math.ceil(Math.max(a.y, b.y) / s) * s, y1 + s);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  draw(r) {
    if (!this.preview || this.preview.destroyed) {
      this.preview = new PIXI.Graphics();
      this.preview.eventMode = "none";
      (canvas.controls ?? canvas.stage).addChild(this.preview);
    }
    const c = Number.parseInt((this.first?.color ?? COLORS[(nextPair() - 1) % COLORS.length]).slice(1), 16);
    this.preview.clear().lineStyle(3, c, 0.95).beginFill(c, 0.18).drawRect(r.x, r.y, r.width, r.height).endFill();
  }

  down(event) {
    if (this.busy || event.target !== canvas.app?.view) return;
    if (event.button === 2) return this.cancel(event);
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.start = this.point(event);
    this.draw(this.rect(this.start, this.start));
  }

  move(event) {
    if (!this.start || event.target !== canvas.app?.view) return;
    this.draw(this.rect(this.start, this.point(event)));
  }

  async up(event) {
    if (!this.start || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = this.rect(this.start, this.point(event));
    this.start = null;
    this.preview?.clear();
    this.busy = true;
    try {
      if (!this.first) await this.placeFirst(rect);
      else await this.placeSecond(rect);
    } catch (err) {
      error("Quick Teleport failed.", err);
      ui.notifications.error(t("Failed"));
    } finally {
      this.busy = false;
    }
  }

  async placeFirst(rect) {
    const pair = nextPair();
    const color = COLORS[(pair - 1) % COLORS.length];
    const region = await createEnd(canvas.scene, rect, { pair, end: "a", color });
    this.first = { uuid: region.uuid, pair, color };
    this.showBar();
  }

  async placeSecond(rect) {
    const { uuid, pair, color } = this.first;
    const a = await fromUuid(uuid);
    if (!a) {
      // The first end was deleted meanwhile: this one becomes the first.
      this.first = null;
      return this.placeFirst(rect);
    }
    const b = await createEnd(canvas.scene, rect, { pair, end: "b", color, behaviors: this.oneWay ? [] : [teleportBehavior(uuid)] });
    await a.createEmbeddedDocuments("RegionBehavior", [teleportBehavior(b.uuid)]);
    ui.notifications.info(t(this.oneWay ? "PlacedOneWay" : "Placed", { n: pair }));
    this.first = null;
    this.stop();
  }

  key(event) {
    if (event.key === "Escape") this.cancel(event);
  }

  context(event) {
    if (event.target === canvas.app?.view) event.preventDefault();
  }

  async cancel(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const first = this.first;
    this.first = null;
    this.stop();
    if (first) {
      const region = await fromUuid(first.uuid);
      await region?.delete();
    }
  }
}

/* -------------------------------------------- */
/*  Entering teleport regions on the grid       */
/* -------------------------------------------- */

const SEG = () => CONST.REGION_MOVEMENT_SEGMENTS ?? { EXIT: -1, MOVE: 0, ENTER: 1 };
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** Whether a position is a token's top-left on the grid (square grids only). */
function onGrid(grid, p) {
  if (!grid?.getOffset || !grid?.getTopLeftPoint) return false;
  const tl = grid.getTopLeftPoint(grid.getOffset({ x: p.x + 0.5, y: p.y + 0.5 }));
  return Math.abs(tl.x - p.x) < 0.5 && Math.abs(tl.y - p.y) < 0.5;
}

/** Distance along the waypoints' path to a point on it (NaN when it isn't on it). */
function progressOn(waypoints) {
  const cum = [0];
  for (let k = 1; k < waypoints.length; k++) cum[k] = cum[k - 1] + dist(waypoints[k - 1], waypoints[k]);
  return (p) => {
    for (let k = 1; k < waypoints.length; k++) {
      const a = waypoints[k - 1], b = waypoints[k], len = dist(a, b);
      if (!len) continue;
      const cross = Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len;
      const along = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len;
      if (cross <= 1.5 && along >= -1.5 && along <= len + 1.5) return cum[k - 1] + Math.max(0, Math.min(len, along));
    }
    return Number.NaN;
  };
}

/** The first grid position on the path at or after `p` that is inside the region, with its progress. */
function firstSquareInside(token, region, waypoints, p, progress, grid) {
  const start = progress(p);
  if (!Number.isFinite(start)) return null;
  const size = grid.size ?? canvas.dimensions?.size ?? 100;
  let cum = 0;
  for (let k = 1; k < waypoints.length; k++) {
    const a = waypoints[k - 1], b = waypoints[k], len = dist(a, b);
    const steps = Math.max(1, Math.round(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / size));
    for (let i = 1; i <= steps; i++) {
      const at = cum + (len * i) / steps;
      if (at < start - 0.5) continue;
      const q = { ...b, x: Math.round(a.x + ((b.x - a.x) * i) / steps), y: Math.round(a.y + ((b.y - a.y) * i) / steps) };
      if (!onGrid(grid, q)) continue;
      if (token.testInsideRegion?.(region, q)) return { point: q, at };
      return null; // the first square after the crossing isn't inside: leave Foundry's segments alone
    }
    cum += len;
  }
  return null;
}

/**
 * Move each ENTER of a teleport region from the edge crossing to the first square inside, and start what follows from
 * there (segments it skips over are dropped). Any doubt: Foundry's own segments.
 */
export function snapTeleportEntries(token, region, waypoints, segments) {
  const teleports = [...(region?.behaviors ?? [])].some(b => b.type === "teleportToken" && !b.disabled);
  const grid = token?.parent?.grid ?? canvas.grid;
  const square = grid && (grid.isSquare ?? grid.type === (CONST.GRID_TYPES?.SQUARE ?? 1));
  if (!teleports || !square || !Array.isArray(segments) || !Array.isArray(waypoints) || waypoints.length < 2) return segments;
  const { ENTER, EXIT } = SEG();
  const progress = progressOn(waypoints);
  const out = [];
  for (let n = 0; n < segments.length; n++) {
    const seg = segments[n];
    if (seg.type !== ENTER || onGrid(grid, seg.to)) { out.push(seg); continue; }
    const found = firstSquareInside(token, region, waypoints, seg.to, progress, grid);
    if (!found) { out.push(seg); continue; }
    const to = { ...seg.to, x: found.point.x, y: found.point.y };
    const rest = [];
    let m = n + 1;
    for (; m < segments.length; m++) {
      const next = segments[m], at = progress(next.to);
      if (!Number.isFinite(at)) return segments;
      if (at <= found.at + 0.5) {
        if (next.type === EXIT) return segments; // it leaves before that square: keep Foundry's
        continue; // skipped over
      }
      rest.push({ ...next, from: to });
      break;
    }
    out.push({ ...seg, to, snapped: true }, ...rest);
    n = m; // segments after `m` follow unchanged
  }
  return out;
}

/* -------------------------------------------- */
/*  The tool                                    */
/* -------------------------------------------- */

function onSceneControls(controls) {
  if (!game.user.isGM) return;
  const regions = Array.isArray(controls) ? controls.find(c => c.name === "regions") : controls?.regions;
  if (!regions?.tools) return;
  const tool = {
    name: "lucd20Stairs",
    title: t("Tool"),
    icon: "fa-solid fa-stairs",
    button: true,
    visible: true,
    order: 90,
    onChange: () => StairsPlacer.start(),
    onClick: () => StairsPlacer.start()
  };
  if (Array.isArray(regions.tools)) {
    if (regions.tools.some(x => x.name === tool.name)) return;
    delete tool.onChange;
    regions.tools.push(tool);
  } else {
    delete tool.onClick;
    regions.tools[tool.name] = tool;
  }
}

function refreshControls() {
  if (canvas?.ready) ui.controls?.render?.({ reset: true });
}

defineFeature({
  id: "quickTeleport",
  category: "scenes",
  scope: "world",
  gmOnly: true,
  defaultEnabled: true,

  enable(f) {
    f.on("getSceneControlButtons", onSceneControls);
    const TokenDoc = CONFIG.Token?.documentClass;
    if (typeof TokenDoc?.prototype?.segmentizeRegionMovementPath === "function") {
      f.wrap(TokenDoc.prototype, "segmentizeRegionMovementPath", function (original, region, waypoints) {
        const segments = original(region, waypoints);
        try {
          return snapTeleportEntries(this, region, waypoints, segments);
        } catch (err) {
          error("Quick Teleport: entering a teleport region on the grid failed.", err);
          return segments;
        }
      });
    }
    refreshControls();
    f.onCleanup(() => {
      StairsPlacer.active?.stop();
      refreshControls();
    });
  }
});
