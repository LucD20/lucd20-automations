import { MODULE_ID, localize } from "../../../core/constants.js";
import { defineSignature } from "../registry.js";
import { attack, disposeCanvas } from "./finisher-canvas.js";

/**
 * The Swashbuckler's finisher (owner, docs/PLAN.md §21; the look, the timing and every part are the owner's
 * approved mockup, docs/mockups/swashbuckler-finisher.html). It plays once, when the damage of a Strike made
 * with a finisher is rolled:
 *
 *   E  dice flourish   Dice So Nice's own dice spin in a gold blur; when they land a blade glint crosses them
 *                      and the total flashes
 *   A  cut-in strip    a slanted band slams across the window with the portrait and the finisher's name
 *   D  signature mark  three gold slashes carve a sigil on the target; it shatters as the target flies
 *   B  impact frame    a short freeze in stark black and white with speed lines, at the hit
 *   C  screen slash    a glint cuts the scene, the two halves slide apart and rejoin with a flash
 *   F  confetti        the hat goes up and twirls (or petals, or playing cards)
 *
 * This file: what starts it, the options, and the parts drawn on the screen overlay (E, A). The parts on the
 * canvas (the lunge, D, B, C, F and the throw) are in `finisher-canvas.js`.
 */

const TAU = Math.PI * 2, PI = Math.PI;
const GOLD = 0xffd24a;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeBack = t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const css = (col, alpha = 1) => `rgba(${col >> 16 & 255},${col >> 8 & 255},${col & 255},${alpha})`;
const L = key => localize(`LUCD20.SignatureSpells.Finisher.${key}`);

/** Per finisher: the band's colour, its accent, and how the target is thrown. Anything else: Confident's look. */
export const FIN = {
  confident: { band: 0xa8122c, accent: 0xffd24a, style: "slash" },
  unbalancing: { band: 0x0d6670, accent: 0x8ff5e6, style: "teeter" },
  bleeding: { band: 0x7a0a14, accent: 0xff4a4a, style: "slash" },
  dual: { band: 0x3b2a94, accent: 0xc0aaff, style: "slash" },
  lethal: { band: 0x1a0a0e, accent: 0xff2a4a, style: "slash" },
  impaling: { band: 0x28507a, accent: 0xcfe4ff, style: "pierce" }
};

/** Which of ours a roll's finisher is ("unbalancing", "unbalancing-finisher" …), or null: the generic one. */
export function kindOf(info) {
  const slug = String(info?.finisher?.slug ?? "").toLowerCase().replace(/-finisher$/, "");
  return Object.hasOwn(FIN, slug) ? slug : null;
}

/** This run's choices, read once: the finisher, the critical, the GM's parts (Less motion drops B, C and F). */
function state(fx) {
  if (fx.memo.f) return fx.memo.f;
  const info = fx.info, kind = kindOf(info), on = key => fx.get(key) !== false;
  const pick = (key, list) => (list.includes(fx.get(key)) ? fx.get(key) : list[0]);
  loadFonts();
  return fx.memo.f = {
    kind, F: FIN[kind ?? "confident"], crit: info.outcome === "criticalSuccess",
    o: {
      E: on("finisherDice"), A: on("finisherStrip"), D: on("finisherMark"),
      B: on("finisherFrame") && !fx.less, C: on("finisherSlash") && !fx.less, F: on("finisherConfetti") && !fx.less,
      sigil: pick("finisherSigil", ["S", "X", "star"]), conf: pick("finisherConfettiKind", ["hat", "petals", "suits"])
    }
  };
}

/* -------------------------------------------- */
/*  Fonts and the portrait                      */
/* -------------------------------------------- */

export const F_DISPLAY = '"LucD20 Anton", Impact, Haettenschweiler, "Arial Narrow", sans-serif';
export const F_SCRIPT = '"LucD20 Kaushan Script", "Brush Script MT", "Segoe Script", cursive';
let fontsAsked = false;

/** The mockup's two faces (Anton, Kaushan Script; SIL OFL, in assets/fonts), asked for once; until they are in, the fallbacks draw. */
export function loadFonts() {
  if (fontsAsked) return;
  fontsAsked = true;
  try {
    for (const [family, file] of [["LucD20 Anton", "Anton.woff2"], ["LucD20 Kaushan Script", "KaushanScript.woff2"]]) {
      const face = new FontFace(family, `url("modules/${MODULE_ID}/assets/fonts/${file}")`);
      face.load().then(f => document.fonts.add(f)).catch(() => { /* the fallback font */ });
    }
  } catch { /* no FontFace: the fallback fonts */ }
}

const VIDEO = /\.(webm|mp4|m4v|ogv|ogg)(\?|#|$)/i;
const images = new Map(); // src → Promise<HTMLImageElement | null>

/** An image by its path, or null (a video, a broken path, too slow): the strip then has no portrait. */
function loadImage(src) {
  if (!src || typeof src !== "string" || VIDEO.test(src)) return Promise.resolve(null);
  if (images.has(src)) return images.get(src);
  const promise = new Promise(resolve => {
    const img = new Image();
    const done = () => resolve(img.complete && img.naturalWidth > 1 ? img : null);
    img.onload = done; img.onerror = () => resolve(null);
    setTimeout(done, 4000);
    img.src = src;
  });
  images.set(src, promise);
  if (images.size > 12) images.delete(images.keys().next().value);
  return promise;
}

/** The token's art as it is on the canvas, when it is a still image. */
function meshImage(token) {
  try {
    const source = token.mesh?.texture?.baseTexture?.resource?.source;
    if (!source || source instanceof HTMLVideoElement) return null;
    const w = source.naturalWidth ?? source.width, h = source.naturalHeight ?? source.height;
    return w > 1 && h > 1 ? source : null;
  } catch {
    return null;
  }
}

/**
 * The portrait for the strip: the actor's image for the GM and the actor's owners; for everyone else the
 * token's art (what they see on the canvas anyway), so a portrait never tells more than the token does.
 */
function portraitOf(token) {
  const actor = token.actor ?? token.document?.actor;
  const own = game.user.isGM || !!actor?.isOwner || !!token.isOwner;
  const actorSrc = own && actor?.img && !/mystery-man/.test(actor.img) ? actor.img : null;
  return [actorSrc, token.document?.texture?.src].filter(Boolean)
    .reduce((p, src) => p.then(img => img ?? loadImage(src)), Promise.resolve(null))
    .then(img => img ?? meshImage(token));
}

/**
 * The name under the finisher's: the actor's for the GM and its owners; for everyone else the token's name,
 * and none at all when players can't see that name (PF2e: `playersCanSeeName`). Never a hidden name.
 */
export function nameOf(token) {
  const doc = token.document ?? {}, actor = token.actor ?? doc.actor;
  if (game.user.isGM || actor?.isOwner || token.isOwner) return actor?.name ?? doc.name ?? token.name ?? null;
  if (doc.playersCanSeeName === false) return null;
  if (doc.playersCanSeeName === undefined) {
    const modes = globalThis.CONST?.TOKEN_DISPLAY_MODES ?? { HOVER: 30, ALWAYS: 50 };
    if (doc.displayName !== modes.ALWAYS && doc.displayName !== modes.HOVER) return null;
  }
  return doc.name ?? token.name ?? null;
}

/* -------------------------------------------- */
/*  Small things drawn on the screen            */
/* -------------------------------------------- */

function glow(ctx, x, y, r, col, alpha) {
  if (!(alpha > .004) || !(r > 0)) return;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, css(0xffffff, alpha)); grad.addColorStop(.35, css(col, alpha * .75)); grad.addColorStop(1, css(col, 0));
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

function starPath(ctx, x, y, r, rot, points = 4, inner = .16) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + i / (points * 2) * TAU, rr = i % 2 ? r * inner : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

/** Sparks, stars, dots and rings on the screen (around the dice), drawn additively. */
class Sparkles {
  list = [];

  add(kind, x, y, o) {
    if (this.list.length < 260) this.list.push({ kind, x, y, vx: 0, vy: 0, drag: 0, life: .4, t: 0, s0: 10, s1: 2, col: GOLD, rot: rnd(0, TAU), vr: 0, ax: 3, a: 1, ...o });
  }

  draw(ctx, dt) {
    ctx.globalCompositeOperation = "lighter";
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      if (p.t >= p.life) { this.list.splice(i, 1); continue; }
      if (p.drag) { const f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const u = p.t / p.life, s = lerp(p.s0, p.s1, u), a = p.a * (u < .06 ? u / .06 : 1 - Math.pow((u - .06) / .94, 1.4));
      if (!(a > .004) || !(s > .2)) continue;
      if (p.kind === "dot") glow(ctx, p.x, p.y, s / 2, p.col, a);
      else if (p.kind === "star") { ctx.fillStyle = css(p.col, a); starPath(ctx, p.x, p.y, s / 2, p.rot); ctx.fill(); }
      else if (p.kind === "ring") { ctx.strokeStyle = css(p.col, a); ctx.lineWidth = Math.max(1.5, s * .045); ctx.beginPath(); ctx.arc(p.x, p.y, s / 2, 0, TAU); ctx.stroke(); }
      else { // a streak along its flight
        ctx.fillStyle = css(p.col, a);
        ctx.beginPath(); ctx.ellipse(p.x, p.y, s * p.ax / 2, s / 4, Math.atan2(p.vy, p.vx), 0, TAU); ctx.fill();
      }
    }
  }
}

/**
 * A line of display text: a hard drop shadow, a thick dark outline, then the fill (a colour, or a top-to-bottom
 * gradient [top, bottom]). Drawn around (x, y), scaled by `scale`.
 */
function drawText(ctx, str, x, y, { font = F_DISPLAY, size = 40, fill = 0xffffff, stroke = 0x08050a, strokeW = 8, shadow = null, scale = 1, align = "center", spacing = 0, alpha = 1, italic = false }) {
  if (!str || !(alpha > .004)) return;
  ctx.save();
  ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.globalAlpha *= alpha;
  ctx.font = `${italic ? "italic " : ""}${size}px ${font}`;
  ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.lineJoin = "round"; ctx.miterLimit = 2;
  try { if ("letterSpacing" in ctx) ctx.letterSpacing = `${spacing}px`; } catch { /* an older browser */ }
  const paint = Array.isArray(fill) ? (() => { const g = ctx.createLinearGradient(0, -size * .45, 0, size * .45); g.addColorStop(0, css(fill[0])); g.addColorStop(1, css(fill[1])); return g; })() : css(fill);
  if (shadow) {
    const sx = Math.cos(shadow.ang ?? PI * .28) * shadow.dist, sy = Math.sin(shadow.ang ?? PI * .28) * shadow.dist;
    ctx.strokeStyle = ctx.fillStyle = css(shadow.col);
    ctx.lineWidth = strokeW;
    ctx.strokeText(str, sx, sy); ctx.fillText(str, sx, sy);
  }
  if (strokeW > 0) { ctx.strokeStyle = css(stroke); ctx.lineWidth = strokeW; ctx.strokeText(str, 0, 0); }
  ctx.fillStyle = paint;
  ctx.fillText(str, 0, 0);
  ctx.restore();
}

function textWidth(ctx, str, size, font = F_DISPLAY, spacing = 0) {
  ctx.save();
  ctx.font = `${size}px ${font}`;
  try { if ("letterSpacing" in ctx) ctx.letterSpacing = `${spacing}px`; } catch { /* an older browser */ }
  const w = ctx.measureText(str).width;
  ctx.restore();
  return w;
}

/* -------------------------------------------- */
/*  E. Dice flourish (on Dice So Nice's dice)   */
/* -------------------------------------------- */

/** While they roll: each die in a gold glow and a whirl that spins up, throwing off sparks. */
function rolling(fx, dice, dt) {
  const f = state(fx), m = fx.memo;
  if (!f.o.E) return;
  m.dice = dice;
  m.rollT = (m.rollT ?? 0) + dt;
  if (!m.rollPaint) {
    m.sp = new Sparkles();
    m.spin = 0;
    const arcs = Array.from({ length: 8 }, () => ({ r: rnd(.75, 1.55), a: rnd(0, TAU), sw: rnd(.7, 2.2), w: rnd(1.5, 4.5), al: rnd(.45, .95) }));
    m.rollPaint = fx.screenPaint((ctx, now, d) => {
      const v = Math.min(1, m.rollT / .5);
      m.spin += d * (14 + 60 * v * v);
      ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
      for (const die of m.dice ?? []) {
        glow(ctx, die.x, die.y, die.r * 2.3, 0xffa820, .55 * v);
        for (const k of arcs) {
          const a = k.a + m.spin * (.7 + k.r * .3);
          ctx.strokeStyle = css(GOLD, k.al * v * .8); ctx.lineWidth = k.w;
          ctx.beginPath(); ctx.arc(die.x, die.y, die.r * k.r, a, a + k.sw); ctx.stroke();
        }
      }
      m.sp.draw(ctx, d);
    }, { z: 2 });
  }
  const v = Math.min(1, m.rollT / .5);
  for (const die of dice) {
    if (Math.random() > dt * 34 * v) continue;
    const a = rnd(0, TAU);
    m.sp.add(Math.random() < .6 ? "star" : "dot", die.x + Math.cos(a) * die.r, die.y + Math.sin(a) * die.r,
      { vx: Math.cos(a) * rnd(60, 260), vy: Math.sin(a) * rnd(60, 260), drag: 2, life: rnd(.25, .55), s0: rnd(10, 22), col: Math.random() < .5 ? GOLD : 0xfff2c0, vr: rnd(-5, 5) });
  }
}

/** The line the blade glint takes across the dice: through the two furthest apart, left to right. */
function glintLine(dice) {
  if (dice.length === 1) {
    const d = dice[0], l = d.r * 2.8;
    return { x0: d.x - l * .98, y0: d.y + l * .2, x1: d.x + l * .98, y1: d.y - l * .2 };
  }
  let a = dice[0], b = dice[1], best = -1;
  for (let i = 0; i < dice.length; i++) for (let j = i + 1; j < dice.length; j++) {
    const d = Math.hypot(dice[i].x - dice[j].x, dice[i].y - dice[j].y);
    if (d > best) { best = d; a = dice[i]; b = dice[j]; }
  }
  if (b.x < a.x) [a, b] = [b, a];
  const len = Math.max(1, best), dx = (b.x - a.x) / len, dy = (b.y - a.y) / len, ext = a.r * 2.4;
  return { x0: a.x - dx * ext, y0: a.y - dy * ext, x1: b.x + dx * ext, y1: b.y + dy * ext };
}

/** They have landed: a ring and sparks off each die, the glint across them, the total. */
async function result(fx, dice) {
  const f = state(fx), m = fx.memo;
  m.rollPaint?.(); m.rollPaint = null;
  if (!f.o.E || !dice.length) return;
  fx.note("dice");
  const total = fx.total, sc = f.crit ? 1.14 : 1, t0 = performance.now();
  const cx = dice.reduce((s, d) => s + d.x, 0) / dice.length, r0 = Math.max(...dice.map(d => d.r));
  const top = Math.min(...dice.map(d => d.y)), bottom = Math.max(...dice.map(d => d.y));
  const totalAt = (vw, vh) => ({ x: clamp(cx, 130, vw - 130), y: top - r0 * 2.7 > 70 ? top - r0 * 2.7 : Math.min(vh - 70, bottom + r0 * 2.7) });
  const drawTotal = (ctx, vw, vh, scale, alpha, raysRot, raysAlpha) => {
    if (total == null) return;
    const p = totalAt(vw, vh);
    if (raysAlpha > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(p.x, p.y); ctx.rotate(raysRot);
      ctx.fillStyle = css(0xffb020, raysAlpha * alpha * .5);
      for (let i = 0; i < 14; i++) { const a = i / 14 * TAU, w = .06 + (i % 3) * .025, r = 150 * sc * (.75 + (i % 4) * .08); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a - w) * r, Math.sin(a - w) * r); ctx.lineTo(Math.cos(a + w) * r, Math.sin(a + w) * r); ctx.closePath(); ctx.fill(); }
      glow(ctx, 0, 0, 120 * sc, 0xffb020, raysAlpha * alpha * .6);
      ctx.restore();
    }
    drawText(ctx, String(total), p.x, p.y, { size: 104 * sc, fill: [0xfffbe0, 0xffc23a], stroke: 0x1a0508, strokeW: 11, scale, alpha });
    if (f.crit) drawText(ctx, L("Critical"), p.x, p.y + 70 * sc * scale, { size: 30, fill: 0xffffff, stroke: 0x8a0a14, strokeW: 7, spacing: 2, scale, alpha });
  };

  if (fx.less) { // no blur, no glint: a soft glow on the dice and the total, fading in and out
    fx.screenPaint((ctx, now, dt, vw, vh) => {
      const T = (now - t0) / 1000;
      if (T >= .8) return false;
      const a = Math.min(1, T / .1, (.8 - T) / .14);
      ctx.globalCompositeOperation = "lighter";
      for (const d of dice) { const p = d.at(); glow(ctx, p.x, p.y, p.r * 2.2, 0xffa820, .3 * a); }
      ctx.globalCompositeOperation = "source-over";
      drawTotal(ctx, vw, vh, 1, a, 0, 0);
    }, { z: 2 });
    return fx.wait(500);
  }

  const sp = m.sp ?? new Sparkles(), line = glintLine(dice), gA = Math.atan2(line.y1 - line.y0, line.x1 - line.x0), gLen = Math.hypot(line.x1 - line.x0, line.y1 - line.y0);
  const st = dice.map(d => ({ d, fl: 1, cut: false, along: ((d.x - line.x0) * (line.x1 - line.x0) + (d.y - line.y0) * (line.y1 - line.y0)) / gLen }));
  for (const d of dice) {
    sp.add("ring", d.x, d.y, { s0: d.r * 2, s1: d.r * 8.8, life: .26, a: .9, col: GOLD });
    for (let j = 0; j < 7; j++) { const a = rnd(0, TAU), v = rnd(180, 460); sp.add("spark", d.x, d.y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 3, life: rnd(.2, .4), s0: rnd(5, 8), ax: rnd(2.5, 4) }); }
  }
  // The strip comes in over the dice when it is on; else the total stays a little longer.
  const tG = .12, tN = .18, tEnd = f.o.A ? .59 : .77;
  let rays = 0;
  fx.screenPaint((ctx, now, dt, vw, vh) => {
    const T = (now - t0) / 1000;
    if (T >= tEnd) return false;
    ctx.globalAlpha = Math.min(1, (tEnd - T) / .12);
    ctx.globalCompositeOperation = "lighter";
    for (const s of st) {
      const p = s.d.at();
      glow(ctx, p.x, p.y, p.r * 2.3, 0xffa820, lerp(.9, .4, Math.min(1, T / .06)));
      glow(ctx, p.x, p.y, p.r * 2, 0xffffff, s.fl);
      s.fl *= Math.exp(-13 * dt);
    }
    if (T >= tG) { // the blade glint slices across the settled dice
      const gu = Math.min(1, (T - tG) / .1), fade = Math.max(0, 1 - Math.max(0, T - tG - .1) / .2);
      const hx = lerp(line.x0, line.x1, gu), hy = lerp(line.y0, line.y1, gu);
      ctx.lineCap = "round";
      ctx.strokeStyle = css(0xffa820, .45 * fade); ctx.lineWidth = 10 * fade + .01;
      ctx.beginPath(); ctx.moveTo(line.x0, line.y0); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.strokeStyle = css(0xffffff, fade); ctx.lineWidth = 3.2 * fade + .4;
      ctx.beginPath(); ctx.moveTo(line.x0, line.y0); ctx.lineTo(hx, hy); ctx.stroke();
      if (gu < 1) { ctx.fillStyle = css(0xffffff, .95); ctx.beginPath(); ctx.ellipse(hx, hy, 70, 9, gA, 0, TAU); ctx.fill(); }
      for (const s of st) if (!s.cut && gu * gLen >= s.along) { s.cut = true; s.fl = 1; sp.add("star", s.d.x, s.d.y, { s0: 30, s1: 130, life: .2, col: 0xfff6d8, vr: 3 }); }
    }
    sp.draw(ctx, dt);
    if (T >= tN) {
      const v = Math.min(1, (T - tN) / .13);
      rays += dt * 1.6;
      ctx.globalCompositeOperation = "source-over";
      drawTotal(ctx, vw, vh, lerp(2.3, 1, easeOut(v)) * (1 + .03 * Math.sin(T * 30)), Math.min(1, v * 3), rays, .85 - .35 * v);
    }
  }, { z: 2 });
  return fx.wait(470);
}

/* -------------------------------------------- */
/*  A. Cut-in strip                             */
/* -------------------------------------------- */

function pattern(w, h, paint) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  paint(c.getContext("2d"));
  return c;
}

/**
 * The band across the window: stripes rushing by, the portrait, the finisher's name, "FINISHER!" and who.
 * Returns how long it is on the screen (ms). `who`: { name, img } (either may be null).
 */
function strip(fx, f, who) {
  const F = f.F, crit = f.crit, less = fx.less, Hb = crit ? 250 : 210, ang = -.105;
  const label = f.kind ? L(`Kind.${f.kind}`).toLocaleUpperCase() : null, shout = L("Shout"), img = who.img ?? null;
  const stripes = pattern(96, 96, x => { x.fillStyle = css(F.accent); for (let k = -2; k <= 2; k++) { x.beginPath(); x.moveTo(k * 96, 96); x.lineTo(k * 96 + 40, 96); x.lineTo(k * 96 + 136, 0); x.lineTo(k * 96 + 96, 0); x.closePath(); x.fill(); } });
  const dots = pattern(18, 18, x => { x.fillStyle = "#000"; x.beginPath(); x.arc(9, 9, 4.2, 0, TAU); x.fill(); });
  const streaks = Array.from({ length: 9 }, (_, i) => ({ u: Math.random(), y: rnd(-1, 1), v: rnd(1600, 3200), l: rnd(240, 580), w: rnd(3, 8), a: rnd(.25, .6), col: i % 3 ? 0xffffff : F.accent }));
  const tin = .1, hold = crit ? .68 : .6, tout = .12, dur = less ? .54 : tin + hold + tout, t0 = performance.now();
  const jit = [0, 0];
  let tile = 0, dot = 0, pS = null, pD = null;
  if (!less) { fx.flash(.45); fx.shake(6); }

  fx.screenPaint((ctx, now, dt, vw, vh) => {
    const T = (now - t0) / 1000;
    if (T >= dur) return false;
    const s = clamp(Math.min(vw / 1280, vh / 720), .45, 2.4), half = vw * .64 / s + 80, cy = vh * .47;
    let xa = -half, xb = half, out = 0, alpha = 1, veil;
    if (less) { alpha = Math.min(1, T / .08, (dur - T) / .12); veil = .4 * alpha; }
    else {
      if (T < tin) xb = lerp(-half, half, T / tin);
      else if (T > tin + hold) { out = (T - tin - hold) / tout; xa = lerp(-half, half, out * out); }
      veil = .5 * Math.min(1, T / tin) * (1 - out);
      tile -= dt * 1500; dot -= dt * 90;
      jit[1] = T < .14 ? rnd(-1, 1) * 7 * (1 - T / .14) : 0;
    }
    ctx.fillStyle = `rgba(7,5,10,${veil})`;
    ctx.fillRect(0, 0, vw, vh);
    ctx.globalAlpha = alpha;
    ctx.translate(vw / 2, cy + jit[1] * s); ctx.scale(s, s); ctx.rotate(ang);
    ctx.beginPath(); ctx.rect(xa, -Hb / 2 - 14, Math.max(1, xb - xa), Hb + 28); ctx.clip();
    // the band
    ctx.fillStyle = "#08050a"; ctx.fillRect(-half, -Hb / 2 - 12, half * 2, Hb + 24);
    ctx.fillStyle = css(F.band); ctx.fillRect(-half, -Hb / 2, half * 2, Hb);
    pS ??= ctx.createPattern(stripes, "repeat"); pD ??= ctx.createPattern(dots, "repeat");
    ctx.save();
    ctx.beginPath(); ctx.rect(-half, -Hb / 2, half * 2, Hb); ctx.clip();
    ctx.save(); ctx.globalAlpha = alpha * .24; ctx.translate(tile % 96, -Hb / 2); ctx.fillStyle = pS; ctx.fillRect(-half - 96, 0, half * 2 + 192, Hb); ctx.restore();
    ctx.save(); ctx.globalAlpha = alpha * .16; ctx.translate(dot % 18, -Hb / 2); ctx.fillStyle = pD; ctx.fillRect(-half - 18, 0, half * 2 + 36, Hb); ctx.restore();
    const left = -vw / 2 / s - 60, shade = ctx.createLinearGradient(left, 0, left + 700, 0);
    shade.addColorStop(0, "rgba(0,0,0,.62)"); shade.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shade; ctx.fillRect(-half, -Hb / 2, half * 2, Hb);
    if (!less) {
      ctx.globalCompositeOperation = "lighter";
      for (const k of streaks) {
        k.u -= k.v * dt / (half * 2 + 400);
        if (k.u < 0) k.u += 1;
        const x = lerp(-half - 200, half + 200, k.u), y = k.y * (Hb / 2 - 16);
        const g = ctx.createLinearGradient(x - k.l / 2, 0, x + k.l / 2, 0);
        g.addColorStop(0, css(k.col, 0)); g.addColorStop(.7, css(k.col, k.a)); g.addColorStop(1, css(k.col, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, k.l / 2, k.w / 2, 0, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.restore();
    ctx.fillStyle = css(GOLD); ctx.fillRect(-half, -Hb / 2, half * 2, 7); ctx.fillRect(-half, Hb / 2 - 7, half * 2, 7);
    ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(-half, -Hb / 2 + 11, half * 2, 2); ctx.fillRect(-half, Hb / 2 - 13, half * 2, 2);
    // the portrait, upright, and the words, leaning forwards
    const pe = less ? 1 : easeBack(Math.min(1, T / .2)), te = less ? 1 : easeBack(Math.min(1, Math.max(0, T - .04) / .2));
    const drift = less ? 0 : T, edgeL = -vw / 2 / s;
    if (img) {
      const iw = img.naturalWidth ?? img.width, ih = img.naturalHeight ?? img.height;
      const h = Hb * 1.66, w = h * clamp(iw / ih, .6, 1.5), px = edgeL + 222 - 200 * (1 - pe) + 28 * drift + out * out * 420;
      ctx.save();
      ctx.translate(px, Hb * .1); ctx.rotate(-ang);
      ctx.shadowColor = "rgba(0,0,0,.85)"; ctx.shadowBlur = 22 * s;
      try { ctx.drawImage(img, -w / 2, -h / 2, w, h); } catch { /* an image that can't be drawn: no portrait */ }
      ctx.restore();
    }
    const tx = (img ? 165 : 0) + 560 * (1 - te) - 34 * drift + out * out * 760;
    ctx.save();
    ctx.translate(tx, 0); ctx.transform(1, 0, -.2, 1, 0, 0);
    const pop = less ? 1 : 1 + .32 * (1 - easeOut(Math.min(1, T / .24)));
    const fv = less ? 1 : clamp((T - .12) / .1, 0, 1), whoA = less ? 1 : clamp((T - .16) / .1, 0, 1);
    if (label) {
      if (who.name) drawText(ctx, who.name, -338, 62, { font: F_SCRIPT, size: 34, strokeW: 6, align: "left", alpha: whoA, scale: Math.min(1, 370 / textWidth(ctx, who.name, 34, F_SCRIPT)) });
      const ns = Math.min(1, 690 / textWidth(ctx, label, 124, F_DISPLAY, 2));
      drawText(ctx, label, 0, -34, { size: 124, strokeW: 13, spacing: 2, scale: ns * pop, shadow: { col: F.band === 0x1a0a0e ? 0xb0102a : 0x08050a, dist: 10 } });
      if (less || T > .12) drawText(ctx, shout, 196, 58, { size: 78, fill: [0xfffbe0, 0xffb62a], strokeW: 10, spacing: 3, scale: lerp(1.9, 1, easeOut(fv)), shadow: { col: 0x08050a, dist: 7 } });
    } else {
      // No finisher we know by name: the shout alone, big.
      drawText(ctx, shout, 0, who.name ? -22 : 0, { size: 132, fill: [0xfffbe0, 0xffb62a], strokeW: 13, spacing: 3, scale: Math.min(1, 690 / textWidth(ctx, shout, 132, F_DISPLAY, 3)) * pop, shadow: { col: 0x08050a, dist: 10 } });
      if (who.name) drawText(ctx, who.name, 0, 70, { font: F_SCRIPT, size: 34, strokeW: 6, alpha: whoA, scale: Math.min(1, 560 / textWidth(ctx, who.name, 34, F_SCRIPT)) });
    }
    if (crit) {
      ctx.save();
      ctx.translate(-250, -Hb / 2 + 44); ctx.rotate(-.07);
      ctx.fillStyle = "#08050a"; ctx.fillRect(-98, -27, 196, 54);
      ctx.fillStyle = "#e0182e"; ctx.fillRect(-93, -22, 186, 44);
      drawText(ctx, L("Critical"), 0, 2, { size: 36, strokeW: 0, spacing: 3, scale: Math.min(1, 170 / textWidth(ctx, L("Critical"), 36, F_DISPLAY, 3)) });
      ctx.restore();
    }
    ctx.restore();
    // the bright edge of the wipe
    if (!less && (T < tin || out > 0)) {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "#fff";
      ctx.fillRect(out > 0 ? xa : xb - 34, -Hb / 2 - 14, 34, Hb + 28);
    }
  }, { z: 10 });
  return dur * 1000;
}

/* -------------------------------------------- */
/*  The signature                               */
/* -------------------------------------------- */

const KIND_CHOICES = { generic: "LUCD20.SignatureSpells.Finisher.Kind.generic", ...Object.fromEntries(Object.keys(FIN).map(id => [id, `LUCD20.SignatureSpells.Finisher.Kind.${id}`])) };
const part = { kind: "boolean", default: true, dependsOn: "finisher" };

defineSignature({
  id: "finisher",
  // PF2e: the damage roll of a Strike made with a finisher (the reader finds the `finisher` roll option).
  // Never a spell's damage, should that option be on while one is cast.
  match: { pf2e: info => !!info?.finisher && info.roll === "damage" && !(info.options ?? []).includes("item:type:spell") },
  preview: "2d8+1d6",
  solo: true,
  settings: {
    finisherDice: part,
    finisherStrip: part,
    finisherMark: part,
    finisherSigil: { kind: "select", default: "S", dependsOn: "finisherMark",
      choices: { S: "LUCD20.SignatureSpells.Finisher.Sigil.S", X: "LUCD20.SignatureSpells.Finisher.Sigil.X", star: "LUCD20.SignatureSpells.Finisher.Sigil.star" } },
    finisherFrame: part,
    finisherSlash: part,
    finisherConfetti: part,
    finisherConfettiKind: { kind: "select", default: "hat", dependsOn: "finisherConfetti",
      choices: { hat: "LUCD20.SignatureSpells.Finisher.Confetti.hat", petals: "LUCD20.SignatureSpells.Finisher.Confetti.petals", suits: "LUCD20.SignatureSpells.Finisher.Confetti.suits" } }
  },
  previewOptions: {
    kind: { label: "LUCD20.SignatureSpells.Finisher.PreviewKind", choices: { confident: KIND_CHOICES.confident, ...KIND_CHOICES } },
    hit: { label: "LUCD20.SignatureSpells.Finisher.PreviewHit", choices: { success: "LUCD20.SignatureSpells.Finisher.Hit.success", criticalSuccess: "LUCD20.SignatureSpells.Finisher.Hit.criticalSuccess" } }
  },
  previewInfo: ({ kind, hit }) => ({ finisher: { slug: kind && kind !== "generic" ? kind : null }, outcome: hit === "criticalSuccess" ? "criticalSuccess" : "success" }),

  // The portrait is asked for when the run begins, so it is there when the strip comes.
  start(fx, ctx) {
    const f = state(fx), who = ctx.caster ?? ctx.casterOwned;
    f.portrait = f.o.A && who ? portraitOf(who).catch(() => null) : null;
  },

  rolling,
  result,

  async toTargets(fx, ctx) {
    const f = state(fx);
    fx.memo.rollPaint?.(); fx.memo.rollPaint = null;
    // The strip names the attacker and the impact frame shows it: only for a user who sees that token (or owns it).
    const who = ctx.caster ?? ctx.casterOwned ?? null;
    f.who = !!who;
    if (f.o.A && who) {
      const img = f.portrait ? await Promise.race([f.portrait, new Promise(resolve => setTimeout(() => resolve(null), 350))]) : null;
      if (!fx.alive) return;
      const name = nameOf(who);
      fx.note("strip", { finisher: f.kind, who: name, portrait: !!img, crit: f.crit });
      strip(fx, f, { name, img });
      // The attack starts while the strip is leaving.
      await fx.wait(fx.less ? 460 : f.crit ? 780 : 700);
    }
    await attack(fx, ctx, f);
  },

  dispose() {
    disposeCanvas();
    images.clear();
  }
});
