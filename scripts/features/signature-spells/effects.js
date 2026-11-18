import { canSee, claimReaction, playOn, reactionOptions } from "../token-reactions/token-reactions.js";
import { overlayZ } from "./dsn.js";

/**
 * Signature Spells: drawing (docs/PLAN.md §20).
 *
 * Two surfaces, one frame loop (requestAnimationFrame, only while something is playing):
 * - the screen: a transparent 2D canvas over the whole window, one above Dice So Nice's own canvas, for what
 *   happens on and from the dice. It takes no clicks and is removed when nothing is left to draw.
 * - the canvas: one PIXI.Graphics on Foundry's interface group, for bolts between tokens (it pans and zooms
 *   with the scene and stays under the windows).
 * A bolt is a jagged line between two moving points that reshapes itself every few milliseconds, grows from
 * its start to its end, and fades. With Less motion bolts keep one shape and have no forks.
 */

export const ABORT = Symbol("signature aborted");
const OVERLAY_ID = "lucd20-signature-overlay";
const rnd = (a, b) => a + Math.random() * (b - a);

const S = {
  bolts: [], glows: [], frames: new Set(), holds: 0,
  raf: null, last: 0, el: null, ctx: null, g: null
};
export const effectsState = S;

/* -------------------------------------------- */
/*  Points                                      */
/* -------------------------------------------- */

/** A token's centre on the canvas. */
export function centerOf(token) {
  const c = token?.center;
  if (c && Number.isFinite(c.x)) return { x: c.x, y: c.y };
  const size = canvas.dimensions?.size ?? 100, d = token?.document ?? {};
  return { x: (token?.x ?? d.x ?? 0) + (token?.w ?? (d.width ?? 1) * size) / 2, y: (token?.y ?? d.y ?? 0) + (token?.h ?? (d.height ?? 1) * size) / 2 };
}

function viewOffset() {
  const rect = canvas.app?.view?.getBoundingClientRect?.();
  return { x: rect?.left ?? 0, y: rect?.top ?? 0 };
}

/** Canvas point → viewport point. */
export function toScreen(p) {
  const q = canvas.stage.worldTransform.apply(new PIXI.Point(p.x, p.y)), o = viewOffset();
  return { x: q.x + o.x, y: q.y + o.y };
}

/** Viewport point → canvas point. */
export function toWorld(p) {
  const o = viewOffset(), q = canvas.stage.worldTransform.applyInverse(new PIXI.Point(p.x - o.x, p.y - o.y));
  return { x: q.x, y: q.y };
}

const worldScale = () => (canvas.dimensions?.size ?? 100) / 100;

/* -------------------------------------------- */
/*  Surfaces                                    */
/* -------------------------------------------- */

function overlay() {
  if (S.el?.isConnected) return S.ctx;
  const el = S.el = document.createElement("canvas");
  el.id = OVERLAY_ID;
  el.style.cssText = `position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:${overlayZ()};`;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  el.width = Math.round(window.innerWidth * ratio); el.height = Math.round(window.innerHeight * ratio);
  el.dataset.ratio = ratio;
  document.body.appendChild(el);
  S.ctx = el.getContext("2d");
  return S.ctx;
}

function worldLayer() {
  if (S.g && !S.g.destroyed && S.g.parent) return S.g;
  const parent = canvas?.interface ?? canvas?.stage;
  if (!parent) return null;
  const g = S.g = new PIXI.Graphics();
  g.eventMode = "none";
  g.blendMode = PIXI.BLEND_MODES.ADD;
  g.zIndex = 9e5;
  parent.addChild(g);
  return g;
}

function removeSurfaces() {
  S.el?.remove(); S.el = null; S.ctx = null;
  try { if (S.g && !S.g.destroyed) S.g.destroy(); } catch { /* torn down with the canvas */ }
  S.g = null;
}

/* -------------------------------------------- */
/*  Bolts and glows                             */
/* -------------------------------------------- */

/** A bolt's shape: [t along the line, offset across it (in units of its length)], forks: [t, angle, length]. */
function shapeOf(b, dist) {
  const n = Math.max(3, Math.min(40, Math.round(dist / b.seg)));
  const pts = [[0, 0]];
  for (let i = 1; i < n; i++) { const t = i / n; pts.push([t, rnd(-1, 1) * b.jag * Math.sin(Math.PI * t) ** 0.6]); }
  pts.push([1, 0]);
  const forks = [];
  for (let i = 0; i < b.forks; i++) forks.push([rnd(.2, .8), rnd(.35, .9) * (Math.random() < .5 ? -1 : 1), rnd(.12, .3)]);
  return { pts, forks };
}

/** The bolt's lines now, as arrays of points. */
function linesOf(b, now) {
  const a = b.a(), z = b.b();
  if (!a || !z) return null;
  const dx = z.x - a.x, dy = z.y - a.y, dist = Math.hypot(dx, dy);
  if (!(dist > 1)) return null;
  if (!b.shape || (b.flicker && now - b.shapedAt >= b.flicker)) { b.shape = shapeOf(b, dist / b.k); b.shapedAt = now; }
  const nx = -dy / dist, ny = dx / dist, age = now - b.born;
  const reach = b.grow > 0 ? Math.min(1, age / b.grow) : 1;
  const at = (t, off) => ({ x: a.x + dx * t + nx * off * b.k, y: a.y + dy * t + ny * off * b.k });
  const main = [];
  for (const [t, off] of b.shape.pts) {
    if (t > reach) { main.push(at(reach, 0)); break; }
    main.push(at(t, off));
  }
  const lines = [main];
  for (const [t, angle, len] of b.shape.forks) {
    if (t > reach) continue;
    const i = b.shape.pts.findIndex(p => p[0] >= t), p0 = at(b.shape.pts[i][0], b.shape.pts[i][1]);
    const ca = Math.cos(angle), sa = Math.sin(angle), fx = (dx * ca - dy * sa) * len, fy = (dx * sa + dy * ca) * len;
    lines.push([p0, { x: p0.x + fx * .5 + nx * rnd(-6, 6) * b.k, y: p0.y + fy * .5 + ny * rnd(-6, 6) * b.k }, { x: p0.x + fx, y: p0.y + fy }]);
  }
  return lines;
}

const css = (col, alpha) => `rgba(${col >> 16 & 255},${col >> 8 & 255},${col & 255},${alpha})`;

function addBolt(space, a, b, o = {}, less = false) {
  const now = performance.now();
  const bolt = {
    space, a: typeof a === "function" ? a : () => a, b: typeof b === "function" ? b : () => b,
    born: now, life: o.life ?? 200, grow: o.grow ?? 0, fade: o.fade ?? 90,
    flicker: less ? 0 : o.flicker ?? 45, forks: less ? 0 : o.forks ?? 0,
    width: o.width ?? 2.4, col: o.col ?? 0x8fc8ff, jag: o.jag ?? 13, seg: o.seg ?? 26,
    k: space === "world" ? worldScale() : 1, shape: null, shapedAt: 0
  };
  S.bolts.push(bolt);
  start();
  return bolt;
}

function addGlow(space, at, o = {}) {
  S.glows.push({ space, at: typeof at === "function" ? at : () => at, born: performance.now(), life: o.life ?? 300, r: o.r ?? 40, col: o.col ?? 0x8fc8ff, alpha: o.alpha ?? .55, k: space === "world" ? worldScale() : 1 });
  start();
}

/* -------------------------------------------- */
/*  The frame loop                              */
/* -------------------------------------------- */

function start() {
  if (S.raf != null) return;
  S.last = performance.now();
  S.raf = requestAnimationFrame(frame);
}

function frame(now) {
  S.raf = null;
  const dt = Math.min(.05, (now - S.last) / 1000);
  S.last = now;
  for (const fn of [...S.frames]) { try { fn(dt, now); } catch (err) { console.error(err); S.frames.delete(fn); } }
  S.bolts = S.bolts.filter(b => now - b.born < b.life);
  S.glows = S.glows.filter(g => now - g.born < g.life);
  try { draw(now); } catch (err) { console.error(err); S.bolts = []; S.glows = []; }
  if (!S.bolts.length && !S.glows.length && !S.frames.size && !S.holds) { removeSurfaces(); return; }
  S.raf = requestAnimationFrame(frame);
}

function draw(now) {
  const screen = S.bolts.some(b => b.space === "screen") || S.glows.some(g => g.space === "screen");
  const ctx = screen || S.el ? overlay() : null;
  if (ctx) {
    const ratio = Number(S.el.dataset.ratio) || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = ctx.lineJoin = "round";
  }
  const world = S.bolts.some(b => b.space === "world") || S.glows.some(g => g.space === "world");
  const g = world || S.g ? worldLayer() : null;
  g?.clear();
  for (const glow of S.glows) {
    const p = glow.at();
    if (!p) continue;
    const u = (now - glow.born) / glow.life, alpha = glow.alpha * (1 - u) * (u < .15 ? u / .15 : 1), r = glow.r * glow.k * (.8 + .4 * u);
    if (glow.space === "screen" && ctx) {
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, css(0xffffff, alpha)); grad.addColorStop(.3, css(glow.col, alpha * .6)); grad.addColorStop(1, css(glow.col, 0));
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    } else if (glow.space === "world" && g) {
      g.lineStyle(0);
      for (const [f, a] of [[1, .12], [.7, .16], [.42, .22], [.2, .4]]) g.beginFill(f < .3 ? 0xffffff : glow.col, a * alpha).drawCircle(p.x, p.y, r * f).endFill();
    }
  }
  for (const b of S.bolts) {
    const lines = linesOf(b, now);
    if (!lines) continue;
    const alpha = Math.min(1, (b.life - (now - b.born)) / b.fade);
    if (b.space === "screen" && ctx) {
      for (const [w, col, a, blur] of [[b.width * 3.4, b.col, .32, 14], [b.width, 0xffffff, 1, 0]]) {
        ctx.strokeStyle = css(col, a * alpha); ctx.shadowColor = css(b.col, alpha); ctx.shadowBlur = blur;
        lines.forEach((line, i) => {
          ctx.lineWidth = i ? w * .55 : w;
          ctx.beginPath(); ctx.moveTo(line[0].x, line[0].y);
          for (const p of line) ctx.lineTo(p.x, p.y);
          ctx.stroke();
        });
      }
      ctx.shadowBlur = 0;
    } else if (b.space === "world" && g) {
      for (const [w, col, a] of [[b.width * 3.4, b.col, .3], [b.width, 0xffffff, 1]]) lines.forEach((line, i) => {
        g.lineStyle((i ? w * .55 : w) * b.k, col, a * alpha);
        g.moveTo(line[0].x, line[0].y);
        for (const p of line) g.lineTo(p.x, p.y);
      });
    }
  }
}

/** Keep the surfaces while a run goes on (between its bolts); the returned function lets go. */
export function hold() {
  S.holds++;
  start();
  let held = true;
  return () => { if (held) { held = false; S.holds = Math.max(0, S.holds - 1); } };
}

/** Call fn(dt, now) every frame until the returned function is called. */
export function onFrame(fn) {
  S.frames.add(fn);
  start();
  return () => S.frames.delete(fn);
}

/** Everything gone, now. */
export function clearEffects() {
  S.bolts = []; S.glows = []; S.frames.clear(); S.holds = 0;
  if (S.raf != null) cancelAnimationFrame(S.raf);
  S.raf = null;
  removeSurfaces();
}

/* -------------------------------------------- */
/*  The toolkit a signature draws with          */
/* -------------------------------------------- */

/**
 * `run`: { dead, claim } — a run that was stopped throws ABORT at its next `wait` (the caller catches it).
 *
 * fx.less                         this user wants less motion
 * fx.memo                         the signature's own notes for this run
 * fx.wait(ms)
 * fx.screenBolt(a, b, o)          a, b: viewport points or functions returning one;
 * fx.worldBolt(a, b, o)           o: { life, grow, flicker, forks, width, col, jag, seg } (ms, pixels)
 * fx.screenGlow(p, o), fx.worldGlow(p, o)   o: { r, life, col, alpha }
 * fx.canSee(token)
 * fx.strike(from, token, o)       a bolt from a die's screen point ({ screen: true }), a token, or the sky
 *                                 (null) to the token; when it arrives the token plays the look `o.look`
 */
export function makeFx(run) {
  const less = reactionOptions().less;
  const fx = {
    less, memo: {}, rnd, canSee, centerOf, toScreen, toWorld,
    get alive() { return !run.dead; },
    wait: ms => new Promise((resolve, reject) => setTimeout(() => (run.dead ? reject(ABORT) : resolve()), ms)),
    screenBolt: (a, b, o) => addBolt("screen", a, b, o, less),
    worldBolt: (a, b, o) => addBolt("world", a, b, o, less),
    screenGlow: (p, o) => addGlow("screen", p, o),
    worldGlow: (p, o) => addGlow("world", p, o),

    async strike(from, token, { look = "default", col, travel = 120, linger = 260, share = 0.3 } = {}) {
      const target = () => (token.destroyed ? null : centerOf(token));
      const o = { life: travel + linger, grow: travel, width: 3, forks: 2, col };
      let origin;
      if (from?.screen) {
        const src = () => from.at?.() ?? from;
        fx.screenBolt(src, () => { const p = target(); return p ? toScreen(p) : null; }, o);
        origin = () => toWorld(src());
      } else if (from && !from.destroyed && from !== token) {
        origin = () => centerOf(from);
        fx.worldBolt(origin, target, o);
      } else {
        // From the sky: straight down from above the top of the view.
        const lean = rnd(-.6, .6) * (token.w ?? 100);
        origin = () => { const p = target() ?? { x: 0, y: 0 }, top = toWorld({ x: 0, y: -30 }).y; return { x: p.x + lean, y: Math.min(top, p.y - (canvas.dimensions?.size ?? 100) * 3) }; };
        fx.worldBolt(origin, target, o);
      }
      await fx.wait(travel);
      if (!canSee(token)) return false;
      const p = target();
      fx.worldGlow(target, { r: Math.max(60, (token.w ?? 100) * .9), life: less ? 380 : 300, col });
      if (run.claim) claimReaction(token.id, look);
      if (!playOn(token, { type: look, share, origin: origin() }) && !less && p) {
        // Token Reactions is off for this user: a small burst of our own.
        for (let i = 0; i < 5; i++) { const a = rnd(0, Math.PI * 2), d = (token.w ?? 100) * rnd(.5, .9); fx.worldBolt(target, { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d }, { life: 160, width: 1.6, jag: 6, seg: 12, col }); }
      }
      return true;
    }
  };
  return fx;
}

/** A bolt that jumps from target to target: each plays `look` as the bolt arrives. */
export async function chain(fx, ctx, { look = "default", col, gap = 240 } = {}) {
  let from = ctx.from ?? ctx.caster ?? null;
  for (const token of ctx.targets) {
    if (!fx.canSee(token)) continue; // never a bolt to a token this user can't see
    await fx.strike(from, token, { look, col });
    from = token;
    await fx.wait(fx.less ? 160 : gap);
  }
}
