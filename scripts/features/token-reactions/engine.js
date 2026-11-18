import { HALO_SORT } from "../effects-halo.js";
import { TX, textures, destroyTextures } from "./textures.js";

/**
 * Token Reactions: the drawing engine, ported from the owner's chosen mockup
 * (docs/mockups/token-reactions-fable.html) onto Foundry's canvas.
 *
 * - The simulation runs in the mockup's units (a square = 90), so its tuned numbers carry over; every layer is
 *   scaled by `grid size / 90`.
 * - A token that reacts gets a "coin": its own art on a small subdivided mesh that can tilt, flip and bend in
 *   fake 3D, with a shadow. While the coin exists the token's own mesh is not rendered (its bars, effects and
 *   name too, unless Less motion); everything is put back exactly when the coin ends. The token, its document
 *   and its mesh are never moved.
 * - Layers, in the canvas layer of token art (PrimaryCanvasGroup, sorted by elevation → layer → sort):
 *   ground marks, ground particles and shadows under every token at that elevation; a coin at its token's own
 *   sort, above the other tokens while airborne; particles above the tokens. Damage numbers go on the
 *   interface, above everything.
 * - One ticker callback, only while something animates.
 *
 * (verify) in Foundry V14: plain PIXI containers with `elevation` / `sortLayer` / `sort` among the primary
 * group's children (as Sequencer does); `mesh.renderable = false` hides a token's art without Foundry undoing
 * it for long (it is re-applied every frame and on refreshToken).
 */

/* -------------------------------------------- */
/*  Basics                                      */
/* -------------------------------------------- */

/** A square in simulation units (the mockup's grid). */
export const G = 90;
export const TAU = Math.PI * 2, PI = Math.PI;
const FOC = 950; // fake camera height: things nearer the camera draw bigger
export const OBL = 0.7; // fake oblique view: height lifts things up the screen
const MAX_PARTICLES = 600;
const FX_SORT = 2e6, AIR_SORT = 1e6;

export const rnd = (a, b) => a + Math.random() * (b - a);
export const sgn = () => (Math.random() < 0.5 ? -1 : 1);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = t => 1 - Math.pow(1 - t, 3);
export const easeIO = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const rotv = (d, a) => ({ x: d.x * Math.cos(a) - d.y * Math.sin(a), y: d.x * Math.sin(a) + d.y * Math.cos(a) });
/**
 * Flip axis (angle of a horizontal axis) for tumbling along direction d.
 * leadDown = true: the leading edge dips (rolling forwards); false: it lifts (struck on the near edge).
 */
export const axisOf = (d, leadDown) => (leadDown ? Math.atan2(d.x, -d.y) : Math.atan2(-d.x, d.y));
const rgb = (r, g, b) => (clamp(r * 255 | 0, 0, 255) << 16) | (clamp(g * 255 | 0, 0, 255) << 8) | clamp(b * 255 | 0, 0, 255);
export const hex3 = h => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];

const TOKENS_LAYER = () => (foundry.canvas?.groups?.PrimaryCanvasGroup ?? foundry.canvas?.primary?.PrimaryCanvasGroup)?.SORT_LAYERS?.TOKENS ?? 700;

/** Engine state. */
const E = {
  k: 1, // world pixels per simulation unit
  ticker: null,
  running: false,
  parts: [],
  marks: [],
  nums: [],
  extras: [], // { step(dt) → true when done, destroy() }
  coins: new Map(), // token id → Coin
  sets: new Map(), // elevation → layer set
  numsLayer: null,
  shk: 0,
  shakeOn: true,
  stageOff: null, // while the stage is shaken: { base: where it belongs, at: where we left it }
  slowT: 0,
  ts: 1,
  wallsOk: true
};
/** The layer set that drawing goes to right now (the reacting token's elevation). */
let L = null;

export const engineState = E;

/* -------------------------------------------- */
/*  Layers                                      */
/* -------------------------------------------- */

function primary() {
  return canvas.primary ?? canvas.stage;
}

function primaryChild(elevation, sort, sortLayer = TOKENS_LAYER()) {
  const c = new PIXI.Container();
  c.eventMode = "none";
  c.elevation = elevation;
  c.sortLayer = sortLayer;
  c.sort = sort;
  c.scale.set(E.k);
  const parent = primary();
  parent.addChild(c);
  parent.sortDirty = true;
  return c;
}

/** Ground and effect layers at an elevation: under and over the tokens there. */
function layerSet(elevation) {
  let set = E.sets.get(elevation);
  if (set && !set.ground.destroyed && !set.fx.destroyed && set.ground.parent) return set;
  if (!E.sets.size) E.k = (canvas.dimensions?.size ?? canvas.grid?.size ?? 100) / G;
  // Under the Effects Halo's badges, over the Turn Markers (which sit just under the halo).
  const ground = primaryChild(elevation, HALO_SORT - 0.5);
  const fx = primaryChild(elevation, FX_SORT);
  set = { elevation, ground, fx };
  for (const name of ["marks", "below", "shadows"]) set[name] = ground.addChild(new PIXI.Container());
  E.sets.set(elevation, set);
  return set;
}

function numsLayer() {
  if (E.numsLayer && !E.numsLayer.destroyed && E.numsLayer.parent) return E.numsLayer;
  const c = E.numsLayer = new PIXI.Container();
  c.eventMode = "none";
  c.zIndex = 1e6;
  c.scale.set(E.k);
  (canvas.interface ?? canvas.stage).addChild(c);
  return c;
}

function destroyLayers() {
  for (const set of E.sets.values()) for (const c of [set.ground, set.fx]) {
    try { if (!c.destroyed) c.destroy({ children: true }); } catch { /* torn down with the canvas */ }
  }
  E.sets.clear();
  try { if (E.numsLayer && !E.numsLayer.destroyed) E.numsLayer.destroy({ children: true }); } catch { /* same */ }
  E.numsLayer = null;
  L = null;
}

/** Draw at this token's elevation from now on. */
export function useLayersOf(coin) {
  L = coin.layers;
}

/** The effects layer in use, and the scale (for the optional JB2A clip). */
export const fxLayer = () => L?.fx ?? null;

/* -------------------------------------------- */
/*  Screen shake, slow motion                   */
/* -------------------------------------------- */

export const shake = a => { if (E.shakeOn) E.shk = Math.max(E.shk, a); };
export const slowMotion = t => { E.slowT = t; };

/** Shake: an offset on the stage's position, taken off again exactly (Foundry pans with the pivot). */
function applyShake(real) {
  const stage = canvas.stage;
  if (!stage?.position) return;
  const prev = E.stageOff;
  // Where the stage belongs: where it was before our offset, or where Foundry has put it since.
  const moved = prev && (Math.abs(stage.position.x - prev.at.x) > 0.01 || Math.abs(stage.position.y - prev.at.y) > 0.01);
  const base = prev && !moved ? prev.base : { x: stage.position.x, y: stage.position.y };
  E.shk *= Math.exp(-9 * real);
  if (E.shk > 0.3) {
    const zoom = (stage.scale?.x ?? 1) * E.k;
    stage.position.set(base.x + rnd(-E.shk, E.shk) * zoom, base.y + rnd(-E.shk, E.shk) * zoom);
    E.stageOff = { base, at: { x: stage.position.x, y: stage.position.y } };
  } else {
    if (prev && !moved) stage.position.set(base.x, base.y);
    E.stageOff = null;
    E.shk = 0;
  }
}

/* -------------------------------------------- */
/*  Particles                                   */
/* -------------------------------------------- */

/** One particle: a tinted sprite with a velocity, gravity, drag, a life and a size from s0 to s1. */
export function P(tex, x, y, z, o) {
  if (E.parts.length > MAX_PARTICLES || !L || !tex) return null;
  const p = Object.assign({ vx: 0, vy: 0, vz: 0, g: 0, drag: 0, life: .6, s0: 10, s1: null, tint: 0xffffff, add: false, a: 1, rot: rnd(0, TAU), vr: 0,
    stretch: false, ax: 1, bounce: false, below: false, fi: .06, pw: 1.4, ay: .5, sy: 1 }, o);
  p.x = x; p.y = y; p.z = z; p.t = 0;
  if (p.s1 == null) p.s1 = p.s0;
  p.tw = tex.width;
  const s = p.sp = new PIXI.Sprite(tex);
  s.anchor.set(.5, p.ay);
  s.tint = p.tint;
  if (p.add) s.blendMode = PIXI.BLEND_MODES.ADD;
  (p.below ? L.below : L.fx).addChild(s);
  s.alpha = 0;
  E.parts.push(p);
  return p;
}

function stepParts(dt) {
  const parts = E.parts;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.t += dt;
    if (p.t >= p.life || p.sp.destroyed) {
      if (!p.sp.destroyed) p.sp.destroy();
      parts.splice(i, 1);
      continue;
    }
    p.vz -= p.g * dt;
    if (p.drag) { const f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; p.vz *= f; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.z < 0 && p.g > 0) {
      p.z = 0;
      if (p.bounce && p.vz < -60) { p.vz *= -.4; p.vx *= .6; p.vy *= .6; p.vr *= .5; }
      else { p.vx = p.vy = p.vz = 0; p.g = 0; p.vr = 0; p.stretch = false; }
    }
    const u = p.t / p.life, s = lerp(p.s0, p.s1, u) / p.tw, sp = p.sp;
    sp.alpha = p.a * (u < p.fi ? u / p.fi : 1 - Math.pow((u - p.fi) / (1 - p.fi), p.pw));
    sp.position.set(p.x, p.y - p.z * OBL);
    if (p.stretch) sp.rotation = Math.atan2(p.vy - p.vz * OBL, p.vx);
    else { p.rot += p.vr * dt; sp.rotation = p.rot; }
    sp.scale.set(s * p.ax, s * p.sy);
  }
}

export const ringFx = (x, y, s0, s1, life, tint, o) => P(TX.ring, x, y, 0, Object.assign({ s0, s1, life, tint, add: true, below: true, rot: 0, pw: 1, a: .9 }, o));

export function dust(x, y, n, power, tint = 0x9a8d7c, a = .34) {
  for (let i = 0; i < n; i++) {
    const an = rnd(0, TAU), v = rnd(.4, 1) * power;
    P(TX.smoke, x + Math.cos(an) * 10, y + Math.sin(an) * 8, rnd(0, 8), { vx: Math.cos(an) * v, vy: Math.sin(an) * v * .8, vz: rnd(10, 50), drag: 3.2, life: rnd(.45, .9), s0: rnd(26, 44), s1: rnd(70, 110), tint, a, vr: rnd(-1, 1), below: Math.random() < .5 });
  }
}

export function sparks(x, y, z, n, tint, speed, o = {}) {
  for (let i = 0; i < n; i++) {
    const an = o.ang != null ? o.ang + rnd(-(o.spread ?? .5), o.spread ?? .5) : rnd(0, TAU), v = rnd(.35, 1) * speed;
    P(TX.spark, x, y, z, Object.assign({ vx: Math.cos(an) * v, vy: Math.sin(an) * v, vz: rnd(.1, .8) * speed * (o.up ?? .6), g: o.g ?? 1500, drag: 1.5, life: rnd(.25, .6), s0: rnd(5, 9), s1: 2, ax: rnd(2.5, 4.5), tint, add: true, stretch: true, bounce: true }, o.p));
  }
}

/* -------------------------------------------- */
/*  Ground marks and short flashes              */
/* -------------------------------------------- */

/** A drawing on the ground (or among the effects: `o.fx`) that lives `life` seconds and fades out. */
export function mark(x, y, life, draw, o = {}) {
  if (!L) return null;
  const g = new PIXI.Graphics();
  g.position.set(x, y);
  if (o.add) g.blendMode = PIXI.BLEND_MODES.ADD;
  draw(g);
  (o.fx ? L.fx : L.marks).addChild(g);
  const m = { g, t: 0, life, upd: o.upd, fade: o.fade ?? Math.min(1.6, life * .45), a: o.a ?? 1, set: L };
  E.marks.push(m);
  g.alpha = 0;
  return m;
}

function stepMarks(dt) {
  const marks = E.marks;
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    m.t += dt;
    if (m.t >= m.life || m.g.destroyed) {
      if (!m.g.destroyed) m.g.destroy();
      marks.splice(i, 1);
      continue;
    }
    m.g.alpha = m.a * Math.min(1, m.t / .06, (m.life - m.t) / m.fade);
    if (m.upd) { L = m.set; m.upd(m.g, m.t, dt, m); }
  }
}

/** A jagged crack from (x, y), branching `depth` times. */
export function jag(g, x, y, ang, len, w, col, alpha, depth) {
  const n = Math.max(2, Math.round(len / 13));
  let px = x, py = y;
  for (let i = 0; i < n; i++) {
    const a = ang + rnd(-.55, .55), l = len / n, nx = px + Math.cos(a) * l, ny = py + Math.sin(a) * l;
    g.lineStyle(w * (1 - i / n) + .7, col, alpha); g.moveTo(px, py); g.lineTo(nx, ny); px = nx; py = ny;
    if (depth > 0 && Math.random() < .32) jag(g, px, py, a + rnd(.5, 1.1) * sgn(), len * (1 - i / n) * .6, w * .6, col, alpha, depth - 1);
  }
  g.lineStyle(0);
}

/** A lightning bolt between two points, for a blink. */
export function bolt(x1, y1, x2, y2, col, w = 3, life = .09) {
  mark(0, 0, life, g => {
    const n = Math.max(3, Math.hypot(x2 - x1, y2 - y1) / 26 | 0), pts = [[x1, y1]], nx = -(y2 - y1), ny = x2 - x1, nl = Math.hypot(nx, ny) || 1;
    for (let i = 1; i < n; i++) { const t = i / n, o = rnd(-16, 16); pts.push([lerp(x1, x2, t) + nx / nl * o, lerp(y1, y2, t) + ny / nl * o]); }
    pts.push([x2, y2]);
    for (const [lw, c, a] of [[w * 3.2, col, .3], [w, 0xffffff, 1]]) { g.lineStyle(lw, c, a); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); }
  }, { add: true, fx: true, fade: life });
}

/* -------------------------------------------- */
/*  The coin: a token's art on a mesh           */
/* -------------------------------------------- */

const N = 8, VN = (N + 1) * (N + 1);
const baseL = new Float32Array(VN * 2), baseUV = new Float32Array(VN * 2), baseAng = new Float32Array(VN), IDX = [];
for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
  const k = j * (N + 1) + i;
  baseL[k * 2] = i / N * 2 - 1; baseL[k * 2 + 1] = j / N * 2 - 1;
  baseUV[k * 2] = i / N; baseUV[k * 2 + 1] = j / N;
  baseAng[k] = Math.atan2(baseL[k * 2 + 1], baseL[k * 2]);
}
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i; IDX.push(a, a + 1, a + N + 1, a + 1, a + N + 2, a + N + 1); }

function rotH(phi, a, o) { // rotation by angle a about the horizontal axis at azimuth phi
  const kx = Math.cos(phi), ky = Math.sin(phi), ca = Math.cos(a), sa = Math.sin(a), ic = 1 - ca;
  o[0] = ca + kx * kx * ic; o[1] = kx * ky * ic; o[2] = ky * sa; o[3] = kx * ky * ic; o[4] = ca + ky * ky * ic; o[5] = -kx * sa; o[6] = -ky * sa; o[7] = kx * sa; o[8] = ca;
  return o;
}
function mul(a, b, o) {
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
const mW = new Float32Array(9), mF = new Float32Array(9), mZ = new Float32Array(9), mT = new Float32Array(9), mO = new Float32Array(9);

const restState = () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, psi: 0, psiRate: 0, phi: 0, theta: 0, wA: 0, wPhi: 0, wAv: 0, wDir: 1,
  q: 0, qv: 0, qDir: 0, qK: 320, qC: 15, bend: 0, bendV: 0, bendDir: 0, rip: 0, ripDir: 0, ripPh: 0, jel: 0, jph: 0, jelDamp: 2,
  scl: 1, sclV: 0, flash: 0, flashCol: 0xffffff, glow: 0, glowCol: [1, 1, 1], glowDamp: 2, frost: 0, ghost: 0, gph: 0, alpha: 1, dark: 0, jx: 0, jy: 0 });

/** The token's outline as a white texture (for the flash, the rim and the back), or null. */
function silhouette(tex) {
  try {
    const renderer = canvas.app?.renderer;
    const Filter = PIXI.ColorMatrixFilter ?? PIXI.filters?.ColorMatrixFilter;
    if (!renderer || !Filter || !tex || tex.valid === false || !(tex.width > 1)) return null;
    const s = Math.min(1, 256 / Math.max(tex.width, tex.height));
    const sprite = new PIXI.Sprite(tex);
    sprite.scale.set(s);
    const white = new Filter();
    white.matrix = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0];
    sprite.filters = [white];
    const rt = PIXI.RenderTexture.create({ width: Math.ceil(tex.width * s), height: Math.ceil(tex.height * s), resolution: 1 });
    renderer.render(sprite, { renderTexture: rt, clear: true });
    sprite.destroy();
    return rt;
  } catch {
    return null;
  }
}

/**
 * The token exactly as Foundry draws it, as a texture (owner, v0.74.2: a dynamic-ring token's texture is only the
 * subject; its ring is drawn by the mesh's shader, so the coin lost its border). Drawn unrotated and unmirrored
 * (the coin applies both itself, as for a plain texture); null on any trouble, and the coin falls back to the plain texture.
 */
function snapshot(mesh) {
  const renderer = canvas.app?.renderer;
  if (!renderer || !mesh || mesh.destroyed) return null;
  const w = Math.ceil(Math.abs(mesh.width)), h = Math.ceil(Math.abs(mesh.height));
  if (!(w > 1 && h > 1)) return null;
  const keep = { rot: mesh.rotation, sx: mesh.scale.x, sy: mesh.scale.y, px: mesh.pivot?.x ?? 0, py: mesh.pivot?.y ?? 0,
    r: mesh.renderable, v: mesh.visible, a: mesh.alpha };
  let rt = null;
  try {
    mesh.rotation = 0; mesh.scale.set(Math.abs(keep.sx), Math.abs(keep.sy)); mesh.pivot?.set?.(0, 0);
    mesh.renderable = true; mesh.visible = true; mesh.alpha = 1;
    const ax = mesh.anchor?.x ?? .5, ay = mesh.anchor?.y ?? .5;
    rt = PIXI.RenderTexture.create({ width: w, height: h, resolution: Math.min(2, renderer.resolution || 1) });
    const transform = new PIXI.Matrix().translate(-(mesh.position.x - ax * w), -(mesh.position.y - ay * h));
    renderer.render(mesh, { renderTexture: rt, clear: true, transform });
    return rt;
  } catch {
    try { rt?.destroy(true); } catch { /* nothing */ }
    return null;
  } finally {
    mesh.rotation = keep.rot; mesh.scale.set(keep.sx, keep.sy); mesh.pivot?.set?.(keep.px, keep.py);
    mesh.renderable = keep.r; mesh.visible = keep.v; mesh.alpha = keep.a;
  }
}

class Coin {
  constructor(token) {
    this.token = token;
    this.id = token.id;
    const mesh = this.mesh = token.mesh, doc = token.document ?? {};
    const elevation = mesh.elevation ?? doc.elevation ?? 0;
    this.layers = layerSet(elevation);
    const grid = canvas.dimensions?.size ?? 100;
    const w = token.w ?? grid * (doc.width ?? 1), h = token.h ?? grid * (doc.height ?? 1);
    const foot = (w + h) / 2 / E.k;
    this.R = foot / 2 * .93; // the radius effects are sized by
    this.U = foot * .85; // the unit throws are sized by
    // The art as Foundry draws it: size, mirroring, rotation, tint, opacity.
    this.hw = (Math.abs(mesh.width) || w) / 2 / E.k;
    this.hh = (Math.abs(mesh.height) || h) / 2 / E.k;
    this.rot0 = mesh.rotation || 0;
    const tint = Number(mesh.tint ?? 0xffffff);
    this.tint = hex3(Number.isFinite(tint) ? tint : 0xffffff);
    this.alpha0 = typeof mesh.alpha === "number" ? mesh.alpha : 1;
    this.baseSort = mesh.sort ?? doc.sort ?? 0;
    const ring = !!(token.hasDynamicRing ?? doc.ring?.enabled);
    this.snap = ring ? snapshot(mesh) : null; // (verify) the ring renders through renderer.render on its own
    this.tex = this.snap ?? mesh.texture;
    this.sil = silhouette(this.tex);
    const uv = new Float32Array(baseUV);
    if ((mesh.scale?.x ?? 1) < 0) for (let i = 0; i < VN; i++) uv[i * 2] = 1 - uv[i * 2];
    if ((mesh.scale?.y ?? 1) < 0) for (let i = 0; i < VN; i++) uv[i * 2 + 1] = 1 - uv[i * 2 + 1];
    const mk = tex => new PIXI.SimpleMesh(tex, new Float32Array(VN * 2), new Float32Array(uv), new Uint16Array(IDX));

    this.S = restState();
    this.phases = [];
    this.cur = null;
    this.done = false;
    this.less = false;
    this.deadBack = false;
    this.saved = new Map(); // display object → its `renderable` before we hid it
    this.sx = 0; this.sy = 0; this.zc = 0;

    // The shadow: the art's outline, black, laid flat on the ground (so art with holes casts its own shape).
    this.shadow = this.layers.shadows.addChild(mk(this.sil ?? TX.shadow));
    this.shadow.tint = 0x000000;
    this.shadow.alpha = 0;
    this.c = primaryChild(elevation, this.baseSort, mesh.sortLayer ?? TOKENS_LAYER());
    this.c.zIndex = (mesh.zIndex ?? 0) + 1;
    const outline = this.sil ?? TX.disc;
    this.ghosts = [mk(this.tex), mk(this.tex)];
    this.ghosts[0].tint = 0xff70e0; this.ghosts[1].tint = 0x70c8ff;
    this.edges = [mk(outline), mk(outline), mk(outline)];
    this.face = mk(this.tex);
    this.emblem = mk(TX.skull);
    this.frost = mk(TX.frost);
    this.flash = mk(outline);
    this.flash.blendMode = PIXI.BLEND_MODES.ADD;
    this.c.addChild(...this.ghosts, ...this.edges, this.face, this.emblem, this.frost, this.flash);
    const home = this.home();
    this.S.x = home.x; this.S.y = home.y;
  }

  /**
   * Where the art belongs: the centre of the token's own mesh as drawn now, wherever Foundry, Token Scatter
   * (its position) or Flying Tokens (its pivot) have it.
   */
  home() {
    const m = this.mesh, k = E.k;
    const ax = m.anchor?.x ?? .5, ay = m.anchor?.y ?? .5;
    const x = (m.position?.x ?? 0) - (m.pivot?.x ?? 0) * (m.scale?.x ?? 1) + (.5 - ax) * this.hw * 2 * k;
    const y = (m.position?.y ?? 0) - (m.pivot?.y ?? 0) * (m.scale?.y ?? 1) + (.5 - ay) * this.hh * 2 * k;
    return { x: x / k, y: y / k };
  }
  get hx() { return this.home().x; }
  get hy() { return this.home().y; }

  /** The token is gone, or Foundry drew it anew (another mesh): nothing left to animate. */
  get gone() {
    const t = this.token;
    return !!(t.destroyed || !t.mesh || t.mesh !== this.mesh || this.mesh.destroyed || this.c.destroyed);
  }

  get busy() {
    return !!(this.cur || this.phases.length);
  }

  /** Stop rendering Foundry's own drawing of the token while ours stands in for it. */
  hide() {
    const t = this.token, list = [this.mesh];
    if (!this.less) list.push(t.bars, t.effects, t.nameplate, t.tooltip);
    for (const o of list) {
      if (!o || o.destroyed) continue;
      if (!this.saved.has(o)) this.saved.set(o, o.renderable !== false);
      if (o.renderable !== false) o.renderable = false;
    }
  }

  /** Put back exactly what `hide` changed. */
  restore() {
    for (const [o, was] of this.saved) if (o && !o.destroyed) o.renderable = was;
    this.saved.clear();
  }

  rest() {
    const home = this.home();
    this.S = restState();
    this.S.x = home.x; this.S.y = home.y;
    this.phases = [];
    this.cur = null;
  }

  play(phases) {
    this.phases = phases;
    this.cur = null;
    this.done = false;
  }

  update(dt) {
    const S = this.S;
    while (true) {
      if (!this.cur) {
        if (!this.phases.length) { this.done = true; return; }
        this.cur = this.phases.shift();
        if (this.cur.init) this.cur.init(this.S);
      }
      const phase = this.cur;
      if (phase.update(this.S, dt)) {
        if (phase.end) phase.end(this.S);
        if (this.cur === phase) this.cur = null;
        continue;
      }
      break;
    }
    S.qv += (-S.qK * S.q - S.qC * S.qv) * dt; S.q += S.qv * dt;
    S.bendV += (-300 * S.bend - 11 * S.bendV) * dt; S.bend += S.bendV * dt;
    S.sclV += (-240 * (S.scl - 1) - 13 * S.sclV) * dt; S.scl += S.sclV * dt;
    S.flash *= Math.exp(-7 * dt); S.glow *= Math.exp(-S.glowDamp * dt); S.dark *= Math.exp(-5 * dt); S.jel *= Math.exp(-S.jelDamp * dt); S.jph += 17 * dt;
    S.rip *= Math.exp(-2.5 * dt); S.ripPh += 28 * dt; S.ghost *= Math.exp(-3.5 * dt); S.gph += 6 * dt;
  }

  /** Project the mesh's grid: squash, jelly, bend and ripple in the coin's plane, then tilt, then perspective. */
  verts(mesh, m, cx, cy, zc, lz, ox, oy, ext = 1, flat = false) {
    const S = this.S, R = this.R * S.scl, hw = this.hw * S.scl * ext, hh = this.hh * S.scl * ext, out = mesh.vertices;
    const q = S.q, dcx = Math.cos(S.qDir), dcy = Math.sin(S.qDir), jel = S.jel, bend = S.bend, rip = S.rip;
    const bcx = Math.cos(S.bendDir), bcy = Math.sin(S.bendDir), rcx = Math.cos(S.ripDir), rcy = Math.sin(S.ripDir);
    for (let i = 0; i < VN; i++) {
      const ux = baseL[i * 2], uy = baseL[i * 2 + 1];
      let px = ux * hw, py = uy * hh, pz = lz;
      if (q) { const a = (px * dcx + py * dcy) * (1 - q), b = (-px * dcy + py * dcx) * (1 + q * .55); px = a * dcx - b * dcy; py = a * dcy + b * dcx; }
      if (jel) { const f = 1 + jel * Math.sin(3 * baseAng[i] + S.jph) + jel * .5 * Math.sin(2 * baseAng[i] - S.jph * 1.3); px *= f; py *= f; }
      if (bend) { const a = ux * bcx + uy * bcy; pz += bend * R * (a * a - .4); }
      if (rip) { const a = ux * rcx + uy * rcy; pz += rip * R * Math.sin(a * 5 - S.ripPh); }
      if (flat) { out[i * 2] = cx + m[0] * px + m[1] * py; out[i * 2 + 1] = cy + m[3] * px + m[4] * py; continue; } // a shadow: dropped straight onto the ground
      const X = m[0] * px + m[1] * py + m[2] * pz, Y = m[3] * px + m[4] * py + m[5] * pz, zw = Math.min(FOC * .7, zc + m[6] * px + m[7] * py + m[8] * pz), s = FOC / (FOC - zw);
      out[i * 2] = cx + ox + X * s; out[i * 2 + 1] = cy + oy + Y * s - zw * OBL;
    }
    mesh.geometry.buffers[0].update();
  }

  draw() {
    const S = this.S, R = Math.max(this.hw, this.hh), t = this.tint;
    const shown = this.token.visible !== false;
    this.c.visible = shown;
    if (!shown) { this.shadow.visible = false; return; }
    rotH(S.wPhi, S.wA, mW); rotH(S.phi, S.theta, mF);
    const c = Math.cos(S.psi + this.rot0), s = Math.sin(S.psi + this.rot0);
    mZ[0] = c; mZ[1] = -s; mZ[2] = 0; mZ[3] = s; mZ[4] = c; mZ[5] = 0; mZ[6] = 0; mZ[7] = 0; mZ[8] = 1;
    mul(mW, mF, mT); mul(mT, mZ, mO);
    let nx = mO[2], ny = mO[5], nz = mO[8];
    const up = nz >= 0 ? 1 : -1;
    nx *= up; ny *= up; nz *= up;
    const drop = R * S.scl * Math.sqrt(Math.max(0, 1 - nz * nz)), th = this.R * .09;
    const zc = Math.sqrt(S.z * S.z + drop * drop) + th * .5, cx = S.x + S.jx, cy = S.y + S.jy;
    this.sx = cx; this.sy = cy - zc * OBL; this.zc = zc;
    // Light from the upper left; a glint when the face swings through the mirror direction.
    const b = clamp(.42 + .58 * (nx * -.3 + ny * -.42 + nz * .86) / .86, .25, 1) * (1 - S.dark);
    const spec = Math.pow(Math.max(0, nx * -.42 + ny * -.56 + nz * .715), 26);
    const gc = S.glowCol, gl = Math.min(1, S.glow);
    // Face up: the art. Face down: its outline, dark (with a skull when it dropped to 0 HP).
    if (up > 0) {
      this.face.texture = this.tex;
      this.face.tint = rgb(b * t[0] * lerp(1, gc[0], gl), b * t[1] * lerp(1, gc[1], gl), b * t[2] * lerp(1, gc[2], gl));
    } else {
      this.face.texture = this.sil ?? TX.disc;
      this.face.tint = rgb(b * .3, b * .23, b * .17);
    }
    this.verts(this.face, mO, cx, cy, zc, up * th * .5, 0, 0);
    this.emblem.visible = up < 0 && this.deadBack;
    if (this.emblem.visible) {
      this.emblem.tint = rgb(b, b, b);
      this.verts(this.emblem, mO, cx, cy, zc, up * th * .52, 0, 0, .62 * Math.min(this.hw, this.hh) / Math.max(this.hw, this.hh));
    }
    this.edges.forEach((e, k) => {
      e.tint = rgb(b * (.2 + k * .07), b * (.15 + k * .055), b * (.1 + k * .04));
      this.verts(e, mO, cx, cy, zc, up * th * (-.5 + k * .3), 0, 0);
    });
    this.frost.visible = S.frost > .01;
    if (this.frost.visible) { this.frost.alpha = Math.min(1, S.frost) * .9; this.verts(this.frost, mO, cx, cy, zc, up * th * .55, 0, 0); }
    const fa = Math.min(1, Math.max(S.flash * .9, spec * .75));
    this.flash.visible = fa > .01;
    if (this.flash.visible) {
      this.flash.alpha = fa;
      this.flash.tint = S.flash * .9 >= spec * .75 ? S.flashCol : 0xfff4d8;
      this.verts(this.flash, mO, cx, cy, zc, up * th * .6, 0, 0);
    }
    this.ghosts.forEach((g, k) => {
      g.visible = S.ghost > .02;
      if (g.visible) { g.alpha = Math.min(1, S.ghost) * .42; const a = S.gph + k * PI; this.verts(g, mO, cx, cy, zc, 0, Math.cos(a) * R * .22, Math.sin(a) * R * .13); }
    });
    this.c.alpha = S.alpha * this.alpha0;
    // Above the other tokens while airborne, at its own place otherwise.
    const sort = zc > th * 2 ? AIR_SORT + S.y : this.baseSort;
    if (this.c.sort !== sort) { this.c.sort = sort; if (this.c.parent) this.c.parent.sortDirty = true; }
    // The shadow falls further, grows and fades with the height. None while the coin lies flat on its square
    // (it would pop in and out around the token).
    const sh = this.shadow, k = clamp(zc / (this.U * 3), 0, 1);
    sh.alpha = S.alpha * this.alpha0 * lerp(.5, .2, k) * clamp((zc - th * .5) / (th * 2), 0, 1);
    sh.visible = sh.alpha > .005;
    if (sh.visible) this.verts(sh, mO, cx + zc * .16, S.y + S.jy + zc * .1 + 4, 0, 0, 0, 0, 1.04 + k * .3, true);
  }

  /** End: Foundry's own drawing back, ours destroyed. */
  finish() {
    this.restore();
    E.coins.delete(this.id);
    for (const o of [this.c, this.shadow]) {
      try { if (!o.destroyed) o.destroy({ children: true, texture: false, baseTexture: false }); } catch { /* torn down with the canvas */ }
    }
    try { if (this.sil && !this.sil.destroyed) this.sil.destroy(true); } catch { /* same */ }
    try { if (this.snap && !this.snap.destroyed) this.snap.destroy(true); } catch { /* same */ }
    this.sil = null;
    this.done = true;
  }
}

/** The coin of a token (made when missing), or null when the token has no art on the canvas. */
export function coinFor(token, { less = false } = {}) {
  let coin = E.coins.get(token.id);
  if (coin && coin.gone) { coin.finish(); coin = null; }
  if (!coin) {
    if (!token.mesh || token.mesh.destroyed || !token.mesh.texture || !primary()) return null;
    textures();
    if (!E.sets.size) E.k = (canvas.dimensions?.size ?? canvas.grid?.size ?? 100) / G;
    coin = new Coin(token);
    E.coins.set(token.id, coin);
  }
  coin.less = less;
  coin.hide();
  start();
  return coin;
}

export const activeCoin = id => E.coins.get(id) ?? null;
/** World pixels per simulation unit. */
export const simScale = () => E.k;

/* -------------------------------------------- */
/*  Motion model                                */
/* -------------------------------------------- */

/** A coin ringing down: the tilt shrinks while it circles faster and faster. */
export function stepWobble(S, dt, damp) {
  S.wA += S.wAv * dt; S.wAv *= Math.exp(-14 * dt); S.wA -= (damp * S.wA + .05) * dt;
  if (S.wA < 0) S.wA = 0;
  S.wPhi += dt * S.wDir * 3 / Math.sqrt(S.wA + .02);
}

/** Would the art cross a wall that blocks movement? (verify) the polygon backend's testCollision in V14. */
function wallBetween(x0, y0, x1, y1) {
  if (!E.wallsOk) return false;
  try {
    const backend = CONFIG.Canvas?.polygonBackends?.move;
    if (!backend?.testCollision) return false;
    const k = E.k;
    return !!backend.testCollision({ x: x0 * k, y: y0 * k }, { x: x1 * k, y: y1 * k }, { type: "move", mode: "any" });
  } catch {
    E.wallsOk = false;
    return false;
  }
}

/** The art never leaves the map, nor a room: it rebounds off the scene's edge and off walls. */
function walls(c, S) {
  const k = E.k, d = canvas.dimensions, r = d?.sceneRect ?? d?.rect, m = c.R * .9;
  let hit = false;
  if (r) {
    const x0 = r.x / k + m, x1 = (r.x + r.width) / k - m, y0 = r.y / k + m, y1 = (r.y + r.height) / k - m;
    if (S.x < x0) { S.x = x0; S.vx = Math.abs(S.vx) * .55; hit = true; } else if (S.x > x1) { S.x = x1; S.vx = -Math.abs(S.vx) * .55; hit = true; }
    if (S.y < y0) { S.y = y0; S.vy = Math.abs(S.vy) * .55; hit = true; } else if (S.y > y1) { S.y = y1; S.vy = -Math.abs(S.vy) * .55; hit = true; }
  }
  if (c.lastX != null && (Math.abs(S.x - c.lastX) > .5 || Math.abs(S.y - c.lastY) > .5)) {
    if (wallBetween(c.lastX, c.lastY, S.x, S.y)) { S.x = c.lastX; S.y = c.lastY; S.vx *= -.55; S.vy *= -.55; hit = true; }
    else { c.lastX = S.x; c.lastY = S.y; }
  }
  if (hit && Math.hypot(S.vx, S.vy) > c.U) { S.wAv += 1.5; S.psiRate += rnd(-4, 4); }
}

export function phHold(dur, fn, init, end) {
  let t = 0;
  return { init, end, update(S, dt) { t += dt; fn && fn(S, Math.min(1, t / dur), dt, t); return t >= dur; } };
}

/** One ballistic throw: flight (with planned flips so it lands flat-ish), bounces, slide, coin wobble. */
export function phAir(c, o) {
  o = Object.assign({ vx: 0, vy: 0, vz: 0, g: 22 * c.U, drag: 0, flips: 0, tiltMax: 0, res: null, axis: 0, prec: 0, yaw: 0, yawAir: 0, yawFric: 3,
    e: .3, fb: .5, fs: 6, cf: 1.5, wDamp: 2.6, wKick: 1, maxB: 3, stiff: false, noSettle: false, main: false }, o);
  let t = 0, T = 1, air = true, b = 0, gt = 0, apex = false, rot = false;
  return {
    main: o.main,
    init(S) {
      // 0 HP: it must land face down.
      if (c.kill && o.main) { o.flips = Math.floor(o.flips) + .5; o.vz = Math.max(o.vz, 4.6 * c.U); o.tiltMax = 0; o.noSettle = false; o.res = o.stiff ? 0 : rnd(-.22, .22); }
      if (o.res == null) o.res = (o.flips || o.tiltMax) && !o.stiff ? rnd(-.32, .32) : 0;
      rot = !!(o.flips || o.tiltMax || o.res);
      S.vx = o.vx; S.vy = o.vy; S.vz = o.vz; S.psiRate += o.yaw;
      if (rot) { S.wA = 0; S.wAv = 0; S.phi = o.axis; S.theta = 0; }
      let z = S.z, vz = o.vz;
      const h = 1 / 240;
      T = 0;
      do { vz -= o.g * h; if (o.drag) vz *= Math.exp(-o.drag * .5 * h); z += vz * h; T += h; } while (z > 0 && T < 5);
      c.lastX = S.x; c.lastY = S.y;
      o.pre && o.pre(S);
    },
    update(S, dt) {
      if (air) {
        S.vz -= o.g * dt;
        if (o.drag) { const f = Math.exp(-o.drag * dt); S.vx *= f; S.vy *= f; S.vz *= Math.exp(-o.drag * .5 * dt); }
        S.x += S.vx * dt; S.y += S.vy * dt; S.z += S.vz * dt; S.psi += S.psiRate * dt;
        if (o.yawAir) S.psiRate *= Math.exp(-o.yawAir * dt);
        if (b === 0) {
          t += dt;
          const u = Math.min(1, t / T);
          if (rot) { S.theta = o.flips ? (o.flips * TAU + o.res) * u : o.tiltMax * Math.sin(PI * u) + o.res * u; S.phi += o.prec * dt; }
          // A critical hit hangs for a beat at the top of its arc.
          if (c.crit && o.main && !apex && S.vz <= 0) { apex = true; if (T > .4) slowMotion(.22); }
        } else if (!o.stiff) stepWobble(S, dt, o.wDamp);
        walls(c, S);
        o.during && o.during(S, dt, true);
        if (S.z <= 0 && S.vz < 0) {
          const sp = -S.vz;
          S.z = 0;
          if (b === 0 && rot) {
            const n = Math.round(S.theta / PI), r = S.theta - n * PI;
            S.theta = n * PI;
            if (o.stiff) S.wA = 0; else { S.wA = Math.abs(r); S.wPhi = S.phi + (r < 0 ? PI : 0); }
          }
          const k = Math.min(1.3, sp / (9 * c.U));
          if (!o.stiff) S.wAv += o.wKick * k * 4.5;
          S.sclV -= k * 2.4;
          o.onLand && o.onLand(S, sp, b, k);
          b++;
          const upv = sp * o.e;
          S.vx *= o.fb; S.vy *= o.fb;
          if (upv > 1.1 * c.U && b <= o.maxB) { S.vz = upv; S.psiRate *= .6; }
          else { S.vz = 0; air = false; if (o.noSettle) return true; }
        }
        return false;
      }
      gt += dt;
      const v = Math.hypot(S.vx, S.vy);
      if (v > 0) { const nv = Math.max(0, v - (o.fs * v + o.cf * c.U) * dt); S.vx *= nv / v; S.vy *= nv / v; }
      S.x += S.vx * dt; S.y += S.vy * dt; S.psi += S.psiRate * dt; S.psiRate *= Math.exp(-o.yawFric * dt);
      if (!o.stiff) stepWobble(S, dt, o.wDamp);
      walls(c, S);
      o.during && o.during(S, dt, false);
      return gt > 3 || (v < 6 && S.wA < .012 && Math.abs(S.psiRate) < .5);
    }
  };
}

/** Hit-stop: the token is pinned for a beat, squashed against the blow, before it lets go. */
export function phStop(c, st) {
  let x0, y0;
  const dur = (st.dur || .05) + (c.crit ? .13 : 0);
  return phHold(dur, (S, u) => {
    const j = (1 - u) * (2 + 5 * c.I) * (c.crit ? 1.6 : 1);
    S.jx = rnd(-j, j); S.jy = rnd(-j, j);
    const p = (st.push || 0) * c.U * Math.sin(u * PI / 2);
    S.x = x0 + c.dir.x * p; S.y = y0 + c.dir.y * p; S.q = (st.sq || 0) * Math.min(1.3, c.I); S.qv = 0; S.flash = 1;
    st.hold && st.hold(S, u);
  }, S => { x0 = S.x; y0 = S.y; S.qDir = Math.atan2(c.dir.y, c.dir.x); S.flashCol = c.T.col; st.init && st.init(S); }, S => { S.jx = S.jy = 0; });
}

/** The art goes back to its own square: a short hop, leaning into the move, the spin unwinding. */
export function phReturn(c, pause = .24) {
  let t = 0, x0, y0, p0, p1, d, dist, done = false, ax;
  return {
    init(S) {
      x0 = S.x; y0 = S.y; p0 = S.psi; p1 = Math.round(p0 / TAU) * TAU; S.psiRate = 0; S.vx = S.vy = 0;
      dist = Math.hypot(c.tok.hx - x0, c.tok.hy - y0); d = .26 + dist / (c.U * 13);
      ax = axisOf({ x: (c.tok.hx - x0) / (dist || 1), y: (c.tok.hy - y0) / (dist || 1) }, true);
      if (dist < 3 && Math.abs(p1 - p0) < .05) done = true;
    },
    update(S, dt) {
      t += dt;
      if (done) { stepWobble(S, dt, 5); return S.wA < .012; }
      if (t < pause) { stepWobble(S, dt, 3); return false; }
      const u = Math.min(1, (t - pause) / d), e = easeIO(u), hx = c.tok.hx, hy = c.tok.hy;
      S.x = lerp(x0, hx, e); S.y = lerp(y0, hy, e); S.psi = lerp(p0, p1, e);
      S.z = (14 + dist * .12) * Math.sin(PI * u); S.wA = .24 * Math.sin(PI * u) * Math.min(1, dist / c.U + .2); S.wPhi = ax;
      if (u >= 1) {
        done = true; S.z = 0; S.psi = 0; S.theta = 0; S.wAv = .9 * Math.min(1, dist / c.U + .2); S.sclV = -.9;
        if (dist > c.U * .5) dust(S.x, S.y + c.R * .5, 3, 60, 0x9a8d7c, .2);
      }
      return false;
    }
  };
}

/** 0 HP: it lies face down where it fell and goes dark, then fades and drops back onto its own square. */
export function phDead(c) {
  let t = 0, st = 0;
  return {
    update(S, dt) {
      t += dt;
      if (S.frost < .05 || st > 0) stepWobble(S, dt, 3);
      if (st === 0) { S.dark = Math.min(.62, t * 1.5); if (t > 1.9) { st = 1; t = 0; } }
      else if (st === 1) {
        S.dark = .62; S.alpha = Math.max(0, 1 - t / .4);
        if (t >= .4) {
          const tk = c.tok;
          tk.rest();
          tk.deadBack = false;
          const N2 = tk.S;
          N2.alpha = 0; N2.z = c.U * .5;
          tk.play([phHold(.05), {
            update(S2, dt2) {
              S2.alpha = Math.min(1, S2.alpha + dt2 * 4);
              if (S2.z > 0) {
                S2.vz -= 20 * c.U * dt2; S2.z += S2.vz * dt2;
                if (S2.z <= 0) { S2.z = 0; S2.wAv = 2.4; S2.wPhi = rnd(0, TAU); S2.sclV = -1.4; dust(S2.x, S2.y + c.R * .4, 4, 70, 0x9a8d7c, .2); }
                return false;
              }
              stepWobble(S2, dt2, 3.5);
              return S2.alpha >= 1 && S2.wA < .012 && S2.wAv < .1;
            }
          }]);
          return false;
        }
      }
      return false;
    }
  };
}

/* -------------------------------------------- */
/*  Damage number                               */
/* -------------------------------------------- */

export function showNumber(c, n) {
  const k = new PIXI.Container(), g = new PIXI.Graphics(), col = c.T.col, r = (c.crit ? 50 : 38) * (.85 + .3 * Math.min(1.3, c.I)) * clamp(c.R / 84, .7, 1.25);
  const starPts = (ro, ri, m, off) => {
    const p = [];
    for (let i = 0; i < m * 2; i++) { const a = i / (m * 2) * TAU + off, rr = (i % 2 ? ri : ro) * rnd(.9, 1.08); p.push(Math.cos(a) * rr, Math.sin(a) * rr); }
    return p;
  };
  if (c.crit) g.beginFill(0xffd24a).lineStyle(3, 0x1a0f08).drawPolygon(starPts(r * 1.35, r * .85, 9, .3)).endFill();
  g.beginFill(col).lineStyle(3.5, 0x1a0f08).drawPolygon(starPts(r, r * .72, 11, 0)).endFill();
  g.beginFill(0x1a0f08, .28).lineStyle(0).drawCircle(0, 0, r * .62).endFill();
  const t = new PIXI.Text(`${n}${c.crit ? "!" : ""}`, { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: "900", fontSize: r * .82, fill: 0xffffff, stroke: 0x1a0f08, strokeThickness: 6, lineJoin: "round" });
  t.anchor.set(.5);
  k.addChild(g, t);
  numsLayer().addChild(k);
  E.nums.push({ k, tok: c.tok, less: c.less, t: 0, life: c.less ? 1.5 : 1.7, rot: rnd(-.25, .25), ox: c.R * .7 * (Math.random() < .5 ? -1 : 1), oy: -c.R * .75, x: c.x, y: c.y });
  start();
}

function stepNums(dt) {
  const nums = E.nums;
  for (let i = nums.length - 1; i >= 0; i--) {
    const n = nums[i];
    n.t += dt;
    if (n.t >= n.life || n.k.destroyed) {
      if (!n.k.destroyed) n.k.destroy({ children: true });
      nums.splice(i, 1);
      continue;
    }
    // It follows the art while that is drawn; afterwards it stays where the art was last.
    if (E.coins.get(n.tok.id) === n.tok && !n.tok.done) { n.x = n.tok.sx; n.y = n.tok.sy; n.k.visible = n.tok.c.visible; }
    const u = n.t / .22, s = n.less ? 1 : u < 1 ? 1.35 * easeOut(u) + (u > .7 ? -(u - .7) * 1.16 : 0) : 1;
    n.k.scale.set(Math.max(.05, s));
    n.k.rotation = n.less ? 0 : n.rot * (1 + .15 * Math.sin(n.t * 9));
    n.k.alpha = Math.min(1, (n.life - n.t) / .35);
    n.k.position.set(n.x + n.ox, n.y + n.oy - Math.max(0, n.t - 1.2) * 60);
  }
}

/* -------------------------------------------- */
/*  The loop                                    */
/* -------------------------------------------- */

/** Something else to step every frame (the JB2A clip): { step(dt) → true when done, destroy() }. */
export function addExtra(extra) {
  E.extras.push(extra);
  start();
}

function tick() {
  const real = Math.min(.034, (E.ticker?.deltaMS ?? 16) / 1000);
  if (E.slowT > 0) { E.slowT -= real; E.ts = lerp(E.ts, .28, .35); } else E.ts = lerp(E.ts, 1, .2);
  const dt = real * E.ts;
  for (const coin of [...E.coins.values()]) {
    if (coin.gone) { coin.finish(); continue; }
    L = coin.layers;
    coin.hide();
    coin.update(dt);
    if (coin.done) coin.finish();
    else coin.draw();
  }
  stepParts(dt);
  stepMarks(dt);
  stepNums(dt);
  for (let i = E.extras.length - 1; i >= 0; i--) {
    let done = true;
    try { done = E.extras[i].step(dt); } catch { /* a broken clip ends */ }
    if (done) { try { E.extras[i].destroy(); } catch { /* gone */ } E.extras.splice(i, 1); }
  }
  applyShake(real);
  if (!E.coins.size && !E.parts.length && !E.marks.length && !E.nums.length && !E.extras.length && !E.stageOff) stop();
}

function start() {
  if (E.running) return;
  const ticker = canvas.app?.ticker;
  if (!ticker) return;
  E.ticker = ticker;
  E.ts = 1;
  ticker.add(tick);
  E.running = true;
}

/** Nothing left to animate: off the ticker, layers removed. */
function stop() {
  E.ticker?.remove(tick);
  E.ticker = null;
  E.running = false;
  E.shk = 0; E.slowT = 0;
  if (E.stageOff) applyShake(0);
  destroyLayers();
}

/** A token's Foundry drawing changed (refreshToken): keep it hidden while its coin stands in. */
export function onTokenRefresh(token) {
  const coin = E.coins.get(token?.id);
  if (coin && !coin.gone) coin.hide();
}

/** Whether anything is animating (for tests). */
export const isRunning = () => E.running;

/**
 * End everything now: every token's own drawing back, our drawings destroyed, off the ticker.
 * `textures: true` also frees the effect textures (the feature was switched off).
 */
export function clearAll({ textures: free = false } = {}) {
  for (const coin of [...E.coins.values()]) coin.finish();
  E.coins.clear();
  for (const p of E.parts.splice(0)) { try { if (!p.sp.destroyed) p.sp.destroy(); } catch { /* gone */ } }
  for (const m of E.marks.splice(0)) { try { if (!m.g.destroyed) m.g.destroy(); } catch { /* gone */ } }
  for (const n of E.nums.splice(0)) { try { if (!n.k.destroyed) n.k.destroy({ children: true }); } catch { /* gone */ } }
  for (const x of E.extras.splice(0)) { try { x.destroy(); } catch { /* gone */ } }
  E.shk = 0;
  stop();
  if (free) destroyTextures();
}
