import { MODULE_ID } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { isShowing, registerOverlay, show } from "./tactical-overlay.js";

/**
 * Rule 24 (docs/pf2e-rules.md, owner Q292; v0.81.1 rework): the flanking overlay. PF2e / SF2e, per user.
 * - Shown with the cover line for a few seconds (tactical-overlay.js) when you select your token or target a
 *   creature, and after your token moves: a line to each ally you already flank the target with, a broken
 *   shield over the target when you do, and **every square you could stand in to flank it** (within your
 *   reach, not occupied, on the opposite side of an ally that can flank it), so there is no guessing.
 * - While you drag your token: those squares stay shown (no timer); the square under your token is filled
 *   stronger and the target gets the broken shield when it would be flanked from there (v0.81.2, owner: the
 *   shield on your own token "feels like you are being flanked"; always over the target).
 * - PF2e's own rules where it has them: TokenPF2e#canFlank (the "flanking" automation setting, enemies,
 *   flankable, hidden tokens, reach) and #onOppositeSides for tokens; for empty squares the same geometry
 *   (the line between the two centres passes through opposite sides of the target). Gang-up abilities are
 *   not counted. Square grids only for the squares.
 * - Only tokens this user can see: the target and the allies.
 * (verify) in Foundry V14 / PF2e 8.7: the drag preview (`canvas.tokens.preview`, `isPreview`, same id) and its
 * `refreshToken` while it moves; `getReach({ action: "attack" })`.
 */

let layer = null;
let timer = null;

function ensureLayer() {
  if (layer && !layer.destroyed && layer.parent) return layer;
  layer = new PIXI.Container();
  layer.name = `${MODULE_ID}-flanking`;
  layer.eventMode = "none";
  (canvas.controls ?? canvas.interface ?? canvas.stage).addChild(layer);
  return layer;
}

function clear() {
  if (layer && !layer.destroyed) layer.removeChildren().forEach(c => c.destroy({ children: true }));
}

/* -------------------------------------------- */
/*  Geometry                                    */
/* -------------------------------------------- */

/** Do segments a–b and c–d cross (touching counts)? Foundry's helper when there. */
function segmentsCross(a, b, c, d) {
  const fn = foundry.utils?.lineSegmentIntersects;
  if (typeof fn === "function") return fn(a, b, c, d);
  const o = (p, q, r) => Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y));
  const on = (p, q, r) => Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) && Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
  const [o1, o2, o3, o4] = [o(a, b, c), o(a, b, d), o(c, d, a), o(c, d, b)];
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && on(a, c, b)) || (o2 === 0 && on(a, d, b)) || (o3 === 0 && on(c, a, d)) || (o4 === 0 && on(c, b, d));
}

/** Does the line between points a and b pass through opposite sides of the bounds? */
function oppositePoints(a, b, { left, right, top, bottom }) {
  const hits = (p, q) => segmentsCross(a, b, p, q);
  return (hits({ x: left, y: top }, { x: left, y: bottom }) && hits({ x: right, y: top }, { x: right, y: bottom }))
    || (hits({ x: left, y: top }, { x: right, y: top }) && hits({ x: left, y: bottom }, { x: right, y: bottom }));
}

/** Two flankers on opposite sides of the target (PF2e's own test when there). */
function opposite(a, b, target) {
  if (typeof a.onOppositeSides === "function") return a.onOppositeSides(a, b, target);
  return oppositePoints(a.center, b.center, target.bounds);
}

/** The visible allies of `token` that can flank `target` (PF2e's canFlank). */
function flankers(token, target) {
  const actor = token.actor;
  return canvas.tokens.placeables.filter(t => t !== token && t.id !== token.id && !t.isPreview && t.visible
    && t.actor && t.actor.isAllyOf?.(actor) && t.canFlank(target));
}

/** The allies `token` flanks `target` with (empty: not flanking). `token` may be a drag preview. */
export function flankingAllies(token, target) {
  if (!token?.actor || !target?.actor || token === target || typeof token.canFlank !== "function") return [];
  if (!token.canFlank(target)) return [];
  return flankers(token, target).filter(t => opposite(token, t, target));
}

const isSquareGrid = () => {
  const g = canvas.grid;
  if (!g) return false;
  if (typeof g.isSquare === "boolean") return g.isSquare;
  return (g.type ?? CONST?.GRID_TYPES?.SQUARE ?? 1) === (CONST?.GRID_TYPES?.SQUARE ?? 1);
};

/**
 * The squares (top-left corners for `token`'s size) where `token` would flank `target`: within its reach,
 * not on any other creature, on the opposite side from a visible ally that can flank the target.
 * → [{ x, y, w, h, allies }]
 */
export function flankSquares(token, target) {
  if (!token?.actor || !target?.actor || token === target || !isSquareGrid() || typeof token.canFlank !== "function") return [];
  if (!token.canFlank(target, { reach: 1e6 })) return []; // able to flank at all, wherever it stands
  const allies = flankers(token, target);
  if (!allies.length) return [];
  const size = canvas.grid.size;
  const per = canvas.scene?.grid?.distance ?? canvas.grid.distance ?? 5;
  const reachFt = token.actor.getReach?.({ action: "attack" }) ?? token.actor.attributes?.reach?.base ?? 5;
  const reach = Math.max(1, Math.round(reachFt / per));
  const w = Math.max(1, Math.round(token.document.width ?? 1)), h = Math.max(1, Math.round(token.document.height ?? 1));
  const tb = target.bounds;
  const tx0 = Math.round(tb.left / size), ty0 = Math.round(tb.top / size);
  const tx1 = Math.round(tb.right / size), ty1 = Math.round(tb.bottom / size);
  const blockers = canvas.tokens.placeables.filter(t => t.id !== token.id && !t.isPreview && t.visible).map(t => t.bounds);
  const overlaps = (x, y) => blockers.some(b => x * size < b.right && (x + w) * size > b.left && y * size < b.bottom && (y + h) * size > b.top);
  const out = [];
  for (let x = tx0 - reach - w + 1; x <= tx1 + reach - 1; x++) {
    for (let y = ty0 - reach - h + 1; y <= ty1 + reach - 1; y++) {
      const gapX = Math.max(tx0 - (x + w), x - tx1, 0), gapY = Math.max(ty0 - (y + h), y - ty1, 0);
      if (Math.max(gapX, gapY) + 1 > reach) continue;
      if (overlaps(x, y)) continue;
      const c = { x: (x + w / 2) * size, y: (y + h / 2) * size };
      const with_ = allies.filter(a => oppositePoints(c, a.center, tb));
      if (with_.length) out.push({ x: x * size, y: y * size, w: w * size, h: h * size, allies: with_ });
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  Drawing                                     */
/* -------------------------------------------- */

/** A broken shield: two halves of a shield split by a zigzag, pushed apart. */
function brokenShield(x, y, size, color) {
  const g = new PIXI.Graphics();
  const w = size, h = size * 1.15;
  const crack = [[0.05 * w, -h / 2], [-0.08 * w, -h / 4], [0.08 * w, 0], [-0.05 * w, h / 4], [0, h / 2]];
  for (const side of [-1, 1]) {
    const pts = [[side * w / 2, -h / 2], ...crack, [side * w / 2, 0]];
    const shift = side * size * 0.08;
    g.lineStyle(Math.max(2, size * 0.06), 0x000000, 0.9);
    g.beginFill(color, 0.95);
    g.drawPolygon(pts.flatMap(([px, py]) => [x + px + shift, y + py]));
    g.endFill();
  }
  return g;
}

/** This user's controlled, owned tokens; `dragging`: their drag previews. */
function sources() {
  const controlled = (canvas.tokens?.controlled ?? []).filter(t => t.isOwner && t.actor);
  const previews = (canvas.tokens.preview?.children ?? []).filter(p => p.isPreview && controlled.some(c => c.id === p.id));
  return { controlled, previews };
}

const snap = v => Math.round(v);

export function draw() {
  clear();
  if (!canvas?.ready || !game.user.targets?.size) return;
  const { controlled, previews } = sources();
  const dragging = previews.length > 0;
  if (!dragging && !isShowing()) return;
  const container = ensureLayer();
  const grid = canvas.grid?.size ?? 100;
  const color = CONFIG.Canvas.dispositionColors?.CONTROLLED ?? 0xff9829;
  const shields = new Set(); // targets that get the broken shield (always over the target: owner, v0.81.2)
  for (const token of controlled) {
    const preview = previews.find(p => p.id === token.id);
    for (const target of game.user.targets ?? []) {
      if (!target.visible || target === token) continue;
      // The squares to flank from (the real token's reach and allies).
      const squares = flankSquares(token, target);
      const g = new PIXI.Graphics();
      for (const sq of squares) {
        const under = preview && snap(preview.document.x) === snap(sq.x) && snap(preview.document.y) === snap(sq.y);
        g.lineStyle(2, color, under ? 1 : 0.7);
        g.beginFill(color, under ? 0.45 : 0.18);
        g.drawRect(sq.x + 2, sq.y + 2, sq.w - 4, sq.h - 4);
        g.endFill();
        if (under) shields.add(target);
      }
      // Lines to the allies already flanked with (not while dragging: the squares say it).
      if (!dragging) {
        const allies = flankingAllies(token, target);
        for (const ally of allies) {
          g.lineStyle(Math.max(3, grid * 0.04), 0x000000, 0.6);
          g.moveTo(token.center.x, token.center.y).lineTo(ally.center.x, ally.center.y);
          g.lineStyle(Math.max(2, grid * 0.025), color, 0.95);
          g.moveTo(token.center.x, token.center.y).lineTo(ally.center.x, ally.center.y);
        }
        if (allies.length) shields.add(target);
      }
      container.addChild(g);
    }
  }
  const size = Math.max(18, grid * 0.32);
  for (const target of shields) container.addChild(brokenShield(target.center.x, target.bounds.top + size * 0.15, size, color));
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    draw();
  }, 40);
}

defineFeature({
  id: "pf2eFlanking",
  category: "pf2e",
  systems: ["pf2e"],
  scope: "client",
  defaultEnabled: true,
  enable(feature) {
    feature.onCleanup(registerOverlay("flanking", schedule));
    // Open the shared window: selecting, targeting, and after your token moved.
    feature.on("targetToken", user => { if (user.isSelf) show(); });
    feature.on("controlToken", (token, controlled) => { if (controlled) show(); else schedule(); });
    feature.on("updateToken", (doc, changes) => {
      if (("x" in changes || "y" in changes) && (canvas.tokens?.controlled ?? []).some(t => t.id === doc.id)) show();
      else if (isShowing()) schedule();
    });
    // While dragging (the preview moves) and while the window is open (others move).
    feature.on("refreshToken", token => {
      if (!game.user.targets?.size) return;
      if (token.isPreview || isShowing()) schedule();
    });
    feature.on("deleteToken", schedule);
    feature.on("canvasReady", schedule);
    feature.on("canvasTearDown", () => { layer = null; });
    // A drag cancelled leaves no update: redraw after any pointer release.
    const up = () => setTimeout(schedule, 120);
    document.addEventListener("pointerup", up);
    feature.onCleanup(() => {
      document.removeEventListener("pointerup", up);
      clearTimeout(timer);
      clear();
      layer?.destroy?.({ children: true });
      layer = null;
    });
    schedule();
  }
});
