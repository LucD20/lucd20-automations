import { error } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";

/**
 * Effects Halo (replaces PF2e Effects Halo; owner, Q266–Q267, as recommended), every system, per player.
 * - A token's effect icons sit in rings just outside its footprint (an ellipse for non-square tokens; a second
 *   ring when the first is full), as round badges with a background and a border colour.
 * - Drawn **under every token**: on the canvas layer of token art, at the token's elevation, below the tokens
 *   there, so token art (its own, with padding, and its neighbours') covers the icons, never the reverse.
 * - Only the icons Foundry already drew for this user on that token (they're copied from the token's own
 *   effects, which are then hidden); the overlay icon (dead) stays on the token. Nothing for a token the user
 *   can't see; hidden tokens (GM) at half opacity.
 * - Layout as the original (MIT): icon radius = square × size / 2, rings at the footprint's half size × distance
 *   plus the icon's radius, 10 % gaps, starting at the top and going round anticlockwise.
 * - Switching it off has Foundry redraw its own icons.
 */

let feature = null;
/** The badges' sort: under every token at their elevation. The Turn Markers go just under this (owner, v0.70.1). */
export const HALO_SORT = -1e6;
/** Whether this user's halo is on (the Turn Markers then sort under it). */
export const haloActive = () => !!feature?.active;
/** token id → { token, sprites: PIXI sprites, key } */
const entries = new Map();
/** "src|tint|bg|border" → round badge texture */
const badgeCache = new Map();
const BADGE = 96; // badge texture size in pixels

const PrimarySpriteMesh = () => foundry.canvas?.primary?.PrimarySpriteMesh ?? globalThis.PrimarySpriteMesh;
const TOKENS_LAYER = () => foundry.canvas?.primary?.PrimaryCanvasGroup?.SORT_LAYERS?.TOKENS ?? 700;
const color = (hex, fallback) => (/^#?[0-9a-f]{6}$/i.test(hex ?? "") ? Number.parseInt(hex.replace("#", ""), 16) : fallback);

/* -------------------------------------------- */
/*  Which icons                                 */
/* -------------------------------------------- */

/** The effect icon sprites Foundry drew on a token (not the background, not the overlay). */
function effectIcons(token) {
  const fx = token?.effects;
  if (!fx?.children) return [];
  return fx.children.filter(c => c !== fx.bg && c !== fx.overlay && c instanceof PIXI.Sprite && c.texture);
}

/* -------------------------------------------- */
/*  Badges                                      */
/* -------------------------------------------- */

/** A round badge: background, border, the icon clipped to a circle. Rendered once per icon and colours. */
function badgeTexture(texture, tint) {
  const bg = feature.get("background"), border = feature.get("border");
  const key = `${texture.baseTexture?.uid ?? texture.textureCacheIds?.[0] ?? ""}:${texture.frame?.x},${texture.frame?.y}|${tint}|${bg}|${border}`;
  const cached = badgeCache.get(key);
  if (cached && !cached.destroyed) return cached;
  const renderer = canvas.app?.renderer;
  if (!renderer) return texture;
  const r = BADGE / 2, line = 5;
  const container = new PIXI.Container();
  const disc = new PIXI.Graphics();
  disc.lineStyle(line, color(border, 0x5e0000), 1, 1);
  disc.beginFill(color(bg, 0xd8c384)).drawCircle(r, r, r - line / 2).endFill();
  container.addChild(disc);
  const icon = new PIXI.Sprite(texture);
  const inner = BADGE - 4 * line;
  const scale = inner / Math.max(texture.width || 1, texture.height || 1);
  icon.scale.set(scale);
  icon.anchor.set(0.5);
  icon.position.set(r, r);
  if (tint !== undefined && tint !== null && tint !== 0xffffff) icon.tint = tint;
  const mask = new PIXI.Graphics().beginFill(0xffffff).drawCircle(r, r, r - 2 * line).endFill();
  container.addChild(mask);
  icon.mask = mask;
  container.addChild(icon);
  const rt = PIXI.RenderTexture.create({ width: BADGE, height: BADGE, resolution: 1 });
  renderer.render(container, { renderTexture: rt, clear: true });
  container.destroy({ children: true });
  badgeCache.set(key, rt);
  return rt;
}

function clearBadges() {
  for (const t of badgeCache.values()) if (!t.destroyed) t.destroy(true);
  badgeCache.clear();
}

/* -------------------------------------------- */
/*  Layout                                      */
/* -------------------------------------------- */

/** Ramanujan's ellipse circumference. */
function circumference(a, b) {
  if (Math.abs(a - b) < 0.001) return 2 * Math.PI * a;
  const h = (a - b) ** 2 / (a + b) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/** The icons' centres, relative to the token's centre, and the icon radius. */
export function haloLayout(count, { grid, width = 1, height = 1, size = 0.2, distance = 1 }) {
  const r = (grid * size) / 2;
  const gap = r * 0.1, rowGap = r * 0.1;
  const hw = (grid * width) / 2 * distance, hh = (grid * height) / 2 * distance;
  const points = [];
  let row = 1, i = 0;
  while (points.length < count) {
    const a = hw + (2 * row - 1) * r + row * rowGap;
    const b = hh + (2 * row - 1) * r + row * rowGap;
    const max = Math.max(1, Math.floor(circumference(a, b) / (2 * r + gap)));
    const start = (0.5 + Math.PI / max) * Math.PI;
    for (i = 0; i < max && points.length < count; i++) {
      const theta = -(i / max) * 2 * Math.PI - start;
      points.push({ x: a * Math.cos(theta), y: b * Math.sin(theta) });
    }
    row++;
  }
  return { r, points };
}

/* -------------------------------------------- */
/*  Drawing                                     */
/* -------------------------------------------- */

function makeSprite(texture) {
  const Primary = PrimarySpriteMesh();
  let sprite;
  try {
    sprite = Primary && canvas.primary ? new Primary(texture) : new PIXI.Sprite(texture);
  } catch {
    sprite = new PIXI.Sprite(texture);
  }
  sprite.anchor?.set(0.5);
  sprite.eventMode = "none";
  const parent = canvas.primary ?? canvas.stage;
  if (Primary && sprite instanceof Primary) {
    parent.addChild(sprite);
    parent.sortDirty = true;
  } else {
    parent.addChildAt(sprite, 0); // no primary sorting: under everything in it
  }
  return sprite;
}

function destroySprites(entry) {
  for (const s of entry.sprites) if (!s.destroyed) { s.parent?.removeChild(s); s.destroy({ texture: false, baseTexture: false }); }
  entry.sprites = [];
}

function removeEntry(id) {
  const entry = entries.get(id);
  if (!entry) return;
  destroySprites(entry);
  entries.delete(id);
}

/** Take over a token's icons: hide Foundry's, (re)make ours when the set changed. */
function sync(token) {
  if (!feature?.active || !token || token.destroyed) return;
  const fx = token.effects;
  if (!fx) return;
  if (fx.bg) fx.bg.visible = false;
  const icons = effectIcons(token);
  for (const icon of icons) icon.renderable = false;
  const id = token.id ?? token.document?.id;
  if (!icons.length) return removeEntry(id);
  const key = icons.map(i => `${i.texture.baseTexture?.uid ?? ""}:${i.tint}`).join(",");
  let entry = entries.get(id);
  if (entry && entry.key === key && entry.token === token && entry.sprites.every(s => !s.destroyed)) return;
  if (!entry) entries.set(id, entry = { token, sprites: [], key: "" });
  destroySprites(entry);
  entry.token = token;
  entry.key = key;
  try {
    entry.sprites = icons.map(i => makeSprite(badgeTexture(i.texture, i.tint)));
  } catch (err) {
    error("Effects Halo: could not draw the icons.", err);
  }
  place(entry);
}

/** Position, size, layer and visibility of one token's icons (every frame: tokens move, scatter, animate). */
function place(entry) {
  const { token, sprites } = entry;
  if (!token || token.destroyed || !token.document) return removeEntry(entry.token?.id);
  const show = token.visible !== false && token.renderable !== false && token.effects?.visible !== false;
  const doc = token.document;
  const grid = canvas.dimensions?.size ?? canvas.grid?.size ?? 100;
  const { r, points } = haloLayout(sprites.length, {
    grid, width: doc.width ?? 1, height: doc.height ?? 1, size: feature.get("size"), distance: feature.get("distance")
  });
  const cx = (token.x ?? doc.x) + (token.w ?? grid * (doc.width ?? 1)) / 2;
  const cy = (token.y ?? doc.y) + (token.h ?? grid * (doc.height ?? 1)) / 2;
  const mesh = token.mesh;
  const elevation = mesh?.elevation ?? doc.elevation ?? 0;
  const alpha = doc.hidden ? 0.5 : 1;
  sprites.forEach((s, i) => {
    if (s.destroyed) return;
    s.visible = show;
    if (!show) return;
    s.position.set(cx + points[i].x, cy + points[i].y);
    if (s.width !== r * 2) { s.width = r * 2; s.height = r * 2; }
    s.alpha = alpha;
    if ("elevation" in s && s.elevation !== elevation) s.elevation = elevation;
    if ("sortLayer" in s) s.sortLayer = mesh?.sortLayer ?? TOKENS_LAYER();
    // Below every token at this elevation (they all sort above this).
    if ("sort" in s && s.sort !== HALO_SORT) s.sort = HALO_SORT;
  });
}

function tick() {
  for (const entry of entries.values()) place(entry);
}

function syncAll() {
  for (const token of canvas.tokens?.placeables ?? []) sync(token);
}

function clearAll({ restore = true } = {}) {
  for (const id of [...entries.keys()]) removeEntry(id);
  if (!restore) return;
  // Foundry redraws its own icons (new sprites, its own background).
  for (const token of canvas.tokens?.placeables ?? []) {
    for (const icon of effectIcons(token)) icon.renderable = true;
    if (token.effects?.bg) token.effects.bg.visible = true;
    token.renderFlags?.set?.({ redrawEffects: true });
  }
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

export const _test = { entries };

defineFeature({
  id: "effectsHalo",
  category: "tokens",
  scope: "client",
  defaultEnabled: true,
  settings: {
    size: { kind: "range", min: 0.1, max: 0.4, step: 0.02, default: 0.2 },
    distance: { kind: "range", min: 0.6, max: 2, step: 0.05, default: 1 },
    background: { kind: "color", default: "#d8c384" },
    border: { kind: "color", default: "#5e0000" }
  },

  enable(f) {
    feature = f;
    f.on("refreshToken", (token) => sync(token));
    f.on("destroyToken", (token) => removeEntry(token.id));
    f.on("canvasReady", () => { clearAll({ restore: false }); syncAll(); });
    f.on("canvasTearDown", () => { clearAll({ restore: false }); clearBadges(); });
    const ticker = canvas.app?.ticker;
    if (ticker) {
      ticker.add(tick);
      f.onCleanup(() => ticker.remove(tick));
    }
    f.onCleanup(() => { clearAll(); clearBadges(); });
    if (canvas.ready) syncAll();
  }
});
