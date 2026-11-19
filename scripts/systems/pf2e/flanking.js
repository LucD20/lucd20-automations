import { MODULE_ID } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";

/**
 * Rule 24 (docs/pf2e-rules.md, owner Q292): the flanking overlay. PF2e / SF2e, each user for themselves.
 * - With your token selected and a creature targeted that you flank: a broken shield over the target and a
 *   line from your token to each ally you flank it with.
 * - While you drag your token: the same for where it would end (the drag preview), so you see where you will
 *   flank before dropping it.
 * - PF2e's own rules decide (TokenPF2e#isFlanking / #canFlank / #onOppositeSides, the "flanking" automation
 *   setting, reach, allies, hidden tokens). For the drag preview the original token is left out of the
 *   allies, and gang-up abilities are not counted (only allies on opposite sides).
 * - Only tokens this user can see: the target and the allies.
 * (verify) in Foundry V14 / PF2e 8.7: the drag preview is a TokenPF2e clone whose `refreshToken` fires while
 * it moves, with the original's id (`isPreview`).
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

/** Two flankers on opposite sides of the target (PF2e's own test when there; else the same geometry). */
function opposite(a, b, target) {
  if (typeof a.onOppositeSides === "function") return a.onOppositeSides(a, b, target);
  const { left, right, top, bottom } = target.bounds;
  const hits = (p, q) => segmentsCross(a.center, b.center, p, q);
  return (hits({ x: left, y: top }, { x: left, y: bottom }) && hits({ x: right, y: top }, { x: right, y: bottom }))
    || (hits({ x: left, y: top }, { x: right, y: top }) && hits({ x: left, y: bottom }, { x: right, y: bottom }));
}

/** The allies `token` flanks `target` with (empty: not flanking). `token` may be a drag preview. */
export function flankingAllies(token, target) {
  if (!token?.actor || !target?.actor || token === target || typeof token.canFlank !== "function") return [];
  if (!token.canFlank(target)) return [];
  const actor = token.actor;
  return canvas.tokens.placeables.filter(t => t !== token && t.id !== token.id && !t.isPreview && t.visible
    && t.actor && t.actor.isAllyOf?.(actor) && t.canFlank(target) && opposite(token, t, target));
}

/** A broken shield: two halves of a shield split by a zigzag, pushed apart. */
function brokenShield(x, y, size, color) {
  const g = new PIXI.Graphics();
  const w = size, h = size * 1.15;
  const crack = [[0.05 * w, -h / 2], [-0.08 * w, -h / 4], [0.08 * w, 0], [-0.05 * w, h / 4], [0, h / 2]];
  const half = side => {
    const pts = side < 0
      ? [[-w / 2, -h / 2], ...crack, [-w / 2, 0]]
      : [[w / 2, -h / 2], ...crack, [w / 2, 0]];
    const shift = side * size * 0.08;
    g.lineStyle(Math.max(2, size * 0.06), 0x000000, 0.9);
    g.beginFill(color, 0.95);
    g.drawPolygon(pts.flatMap(([px, py]) => [x + px + shift, y + py]));
    g.endFill();
  };
  half(-1);
  half(1);
  return g;
}

/** The tokens to draw from: this user's controlled, owned tokens (their drag previews when dragging). */
function sources() {
  const controlled = canvas.tokens.controlled.filter(t => t.isOwner && t.actor);
  const previews = (canvas.tokens.preview?.children ?? []).filter(p => p.isPreview && controlled.some(c => c.id === p.id));
  return controlled.map(c => previews.find(p => p.id === c.id) ?? c);
}

export function draw() {
  clear();
  if (!canvas?.ready || !game.user.targets.size) return;
  const container = ensureLayer();
  const grid = canvas.grid?.size ?? 100;
  const color = CONFIG.Canvas.dispositionColors?.CONTROLLED ?? 0xff9829;
  const flanked = new Set();
  for (const token of sources()) {
    for (const target of game.user.targets) {
      if (!target.visible) continue;
      const allies = flankingAllies(token, target);
      if (!allies.length) continue;
      flanked.add(target);
      const g = new PIXI.Graphics();
      for (const ally of allies) {
        g.lineStyle(Math.max(3, grid * 0.04), 0x000000, 0.6);
        g.moveTo(token.center.x, token.center.y).lineTo(ally.center.x, ally.center.y);
        g.lineStyle(Math.max(2, grid * 0.025), color, 0.95);
        g.moveTo(token.center.x, token.center.y).lineTo(ally.center.x, ally.center.y);
      }
      container.addChild(g);
    }
  }
  for (const target of flanked) {
    const size = Math.max(18, grid * 0.32);
    container.addChild(brokenShield(target.center.x, target.bounds.top + size * 0.15, size, color));
  }
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
    feature.on("targetToken", user => { if (user.isSelf) schedule(); });
    feature.on("controlToken", schedule);
    feature.on("refreshToken", token => {
      if (!game.user.targets.size) return;
      if (token.isPreview || token.controlled || game.user.targets.has(token) || canvas.tokens.controlled.length) schedule();
    });
    feature.on("deleteToken", schedule);
    feature.on("canvasReady", schedule);
    feature.on("canvasTearDown", () => { layer = null; });
    feature.onCleanup(() => {
      clearTimeout(timer);
      clear();
      layer?.destroy?.({ children: true });
      layer = null;
    });
    schedule();
  }
});
