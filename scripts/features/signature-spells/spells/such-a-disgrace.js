import { localize } from "../../../core/constants.js";
import { defineSignature } from "../registry.js";
import { F_DISPLAY, F_SCRIPT, loadFonts } from "./finisher.js";

/**
 * Such a Disgrace! (the Dandy archetype's reaction; owner, docs/PLAN.md §28; the look is variant C of
 * `docs/mockups/such-a-disgrace.html`, "the spotlight of shame"): the window goes dark, a spotlight finds the
 * ally who failed the save, a gloved hand in a lace cuff comes down and wags its finger ("tut, tut, tut")
 * while the dandy says what they think; then the light turns gold and the ally gets their "+1".
 *
 * - It starts when the feat's card is posted to chat. On whom: the one who used it says (`choose`, asked on
 *   that client only): the ally whose failed Will save the system's reader found (`info.candidates`); with
 *   several, a small window to pick one; with none, the token that user targets.
 * - Everything is painted on the screen overlay, placed from the tokens every frame (it follows a pan or a
 *   zoom). No token is moved or changed.
 * - Only for users who see the ally's token. The speech bubble only when they also see the dandy's.
 * - Less motion: no dark, no hand; the bubble, a blush, the ring and the "+1" fade in and out.
 */

const t = (key, data) => localize(`LUCD20.SignatureSpells.SuchADisgrace.${key}`, data);
const TAU = Math.PI * 2, PI = Math.PI;
const GOLD = "#ffd24a", CREAM = "#fbf3e2", INK = "#2a1a26", PLUM = "#5b2a55";
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const seg = (x, a, b) => clamp((x - a) / (b - a));
const eOut = p => 1 - Math.pow(1 - p, 3);
const eIn = p => p * p * p;
const eBack = p => { const k = 1.9; return 1 + (k + 1) * Math.pow(p - 1, 3) + k * Math.pow(p - 1, 2); };
const pop = (x, a, len, inn = .16, out = .14) => eBack(seg(x, a, a + inn)) * (1 - seg(x, a + len - out, a + len));

/** The times of the mockup, in seconds: how long it all takes, and when the ally pulls themselves together. */
export const TIMES = { full: { length: 3.6, shapeUp: 2.2 }, less: { length: 1.7, shapeUp: .45 } };

function text(c, s, x, y, o = {}) {
  c.save(); c.translate(x, y); if (o.rot) c.rotate(o.rot); if (o.s != null) c.scale(o.s, o.s);
  c.globalAlpha *= o.a ?? 1; c.font = o.font; c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
  if (o.stroke) { c.strokeStyle = o.stroke; c.lineWidth = o.lw || 6; c.strokeText(s, 0, 0); }
  c.fillStyle = o.fill || CREAM; c.fillText(s, 0, 0); c.restore();
}

/** A gloved hand pointing down, the wrist at 0,0: coat sleeve, lace cuff, a fist with the thumb across, the index out. */
function pointingHand(c) {
  c.lineJoin = "round"; c.lineCap = "round"; c.strokeStyle = INK; c.lineWidth = 5;
  c.fillStyle = PLUM; c.beginPath(); c.moveTo(-30, -2600); c.lineTo(30, -2600); c.lineTo(38, -14); c.lineTo(-38, -14); c.closePath(); c.stroke(); c.fill();
  c.fillStyle = GOLD; c.beginPath(); c.arc(22, -40, 5, 0, TAU); c.arc(22, -62, 5, 0, TAU); c.fill();
  c.fillStyle = CREAM; c.beginPath(); for (let i = 0; i < 5; i++) { c.moveTo(-36 + i * 18 + 11, -4); c.arc(-36 + i * 18, -4, 11, 0, TAU); } c.stroke(); c.fill();
  c.beginPath(); c.roundRect(-41, -24, 82, 17, 6); c.stroke(); c.fill();
  const h = new Path2D(); h.roundRect(-28, 34, 19, 78, 9.5); h.roundRect(-31, 6, 62, 48, 16); c.stroke(h); c.fill(h);
  c.lineWidth = 3;
  for (const [x, len, w] of [[-6, 24, 12], [7, 21, 12], [20, 17, 11]]) { c.beginPath(); c.roundRect(x, 38, w, len, w / 2); c.stroke(); c.fill(); }
  c.save(); c.translate(6, 33); c.rotate(-.22); c.beginPath(); c.roundRect(-20, -7, 40, 15, 7.5); c.stroke(); c.fill(); c.restore();
  c.lineWidth = 2; c.beginPath(); c.moveTo(-24, 66); c.lineTo(-13, 66); c.moveTo(-24, 86); c.lineTo(-13, 86); c.stroke();
}

function sparkle(c, x, y, r, a) {
  c.save(); c.translate(x, y); c.globalAlpha *= a; c.fillStyle = GOLD; c.beginPath();
  for (let i = 0; i < 8; i++) { const rad = i % 2 ? r * .28 : r, an = i * PI / 4; c.lineTo(Math.cos(an) * rad, Math.sin(an) * rad); }
  c.fill(); c.restore();
}

/** The dandy's speech bubble; to the left of the token when there is no room on the right. */
function bubble(c, p, alpha, words, flip) {
  if (p <= 0 || alpha <= 0) return;
  c.save(); c.globalAlpha *= alpha; c.scale(flip ? -1 : 1, 1); c.translate(34, -46); c.scale(p, p); c.rotate(-.05);
  c.font = `31px ${F_SCRIPT}`;
  const w = Math.max(150, c.measureText(words).width + 46);
  c.fillStyle = CREAM; c.strokeStyle = INK; c.lineWidth = 3; c.lineJoin = "round";
  c.beginPath(); c.roundRect(-6, -74, w, 60, 22); c.moveTo(18, -16); c.lineTo(0, 4); c.lineTo(46, -16); c.stroke(); c.fill();
  c.translate(-6 + w / 2, -43); c.scale(flip ? -1 : 1, 1);
  text(c, words, 0, 0, { font: `31px ${F_SCRIPT}`, fill: PLUM });
  c.restore();
}

/** The gold ring, the sparkles and the "+1": the ally pulls themselves together. Around 0,0, a token being 80 across. */
function shapeUp(c, x, at, less) {
  const p = seg(x, at, at + (less ? 1 : .7));
  if (x < at || p >= 1) return;
  c.save(); c.strokeStyle = GOLD; c.globalAlpha = 1 - p; c.lineWidth = less ? 4 : 6 * (1 - p) + 1;
  c.beginPath(); c.arc(0, 0, 40 + (less ? 14 : 70 * eOut(p)), 0, TAU); c.stroke(); c.restore();
  if (!less) for (let i = 0; i < 8; i++) { const an = i * TAU / 8 + .3, d = 50 + 70 * eOut(p); sparkle(c, Math.cos(an) * d, Math.sin(an) * d, 11 * (1 - p * .5), 1 - p); }
  text(c, "+1", 4, less ? -86 : -58 - 46 * eOut(p), { font: `44px ${F_DISPLAY}`, fill: GOLD, stroke: INK, lw: 7, a: less ? Math.sin(PI * p) : 1 - eIn(p), s: less ? 1 : .6 + .4 * eBack(seg(x, at, at + .2)) });
}

/**
 * One frame, `x` seconds in. `s`: { ally: {x, y} on the screen, k: its scale (1 = a token 80 px across),
 * dandy: {x, y} | null, kd, vw, vh, less, words: { shout, tut } }.
 */
export function paint(c, x, s) {
  const T = s.less ? TIMES.less : TIMES.full, tr = T.shapeUp, { ally, k } = s;
  const blush = s.less ? Math.sin(PI * seg(x, 0, T.length)) : seg(x, .7, 1) * (1 - seg(x, 2.3, 2.9));
  const onAlly = fn => { c.save(); c.translate(ally.x, ally.y); c.scale(k, k); fn(); c.restore(); };
  if (!s.less) {
    // The dark, with a hole of light on the ally, and the beam from above.
    const dim = .74 * eOut(seg(x, .2, .55)) * (1 - seg(x, 2.35, 2.95)), warm = seg(x, tr, tr + .25);
    if (dim > 0) {
      const g = c.createRadialGradient(ally.x, ally.y, (62 + 40 * warm) * k, ally.x, ally.y, (150 + 60 * warm) * k);
      g.addColorStop(0, "rgba(8,4,10,0)"); g.addColorStop(1, `rgba(8,4,10,${dim})`);
      c.fillStyle = g; c.fillRect(0, 0, s.vw, s.vh);
      c.save(); c.globalAlpha = dim * .2; c.fillStyle = warm > .5 ? GOLD : "#fff"; c.beginPath();
      c.moveTo(ally.x - 40 * k, Math.min(0, ally.y - 600 * k)); c.lineTo(ally.x + 40 * k, Math.min(0, ally.y - 600 * k));
      c.lineTo(ally.x + (100 + 30 * warm) * k, ally.y); c.lineTo(ally.x - (100 + 30 * warm) * k, ally.y); c.fill(); c.restore();
    }
  }
  onAlly(() => {
    if (blush > 0) { c.fillStyle = `rgba(255,80,120,${.3 * blush})`; c.beginPath(); c.arc(0, 0, 40, 0, TAU); c.fill(); }
    if (s.less) return;
    // A drop of sweat.
    const al = seg(x, .9, 1.05) * (1 - seg(x, 1.9, 2.1));
    if (al > 0) {
      const y = -34 + 26 * seg(x, .9, 2.1);
      c.save(); c.globalAlpha = al; c.fillStyle = "#9fd8ff"; c.strokeStyle = "#3d6f96"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(40, y - 16); c.quadraticCurveTo(52, y + 4, 40, y + 6); c.quadraticCurveTo(28, y + 4, 40, y - 16); c.fill(); c.stroke(); c.restore();
    }
    // The hand: in from the upper right along its own arm, wagging about the wrist, and away.
    const inn = eBack(seg(x, .55, .82)), out = eIn(seg(x, 2.05, 2.4)), far = 460 * (1 - inn) + 900 * out, TILT = .42;
    if (x > .55 && out < 1) {
      const wag = (x > .82 && x < 2.02) ? .3 * Math.sin((x - .82) * TAU / .4) : 0;
      c.save(); c.translate(74 + Math.sin(TILT) * far, -176 - Math.cos(TILT) * far); c.rotate(TILT + wag); c.scale(1.2, 1.2); pointingHand(c); c.restore();
    }
    [.9, 1.3, 1.7].forEach((t0, i) => {
      const p = seg(x, t0, t0 + .6);
      if (x >= t0 && p < 1) text(c, s.words.tut, i % 2 ? 132 : -132, -120 - 34 * eOut(p) - i * 8, { font: `46px ${F_SCRIPT}`, fill: CREAM, stroke: INK, lw: 6, rot: i % 2 ? .16 : -.16, a: 1 - eIn(p), s: .7 + .3 * eBack(seg(x, t0, t0 + .15)) });
    });
  });
  if (s.dandy) {
    c.save(); c.translate(s.dandy.x, s.dandy.y); c.scale(s.kd, s.kd);
    const flip = s.dandy.x + 330 * s.kd > s.vw;
    if (s.less) bubble(c, 1, Math.sin(PI * seg(x, 0, T.length)), s.words.shout, flip);
    else bubble(c, pop(x, .3, 2), 1, s.words.shout, flip);
    c.restore();
  }
  onAlly(() => shapeUp(c, x, tr, s.less));
}

/** More than one ally it could be: the one who used the feat picks. → the token, or null (closed). */
async function pickOne(tokens) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2?.wait) return tokens[0];
  const esc = v => Handlebars.escapeExpression(String(v ?? ""));
  // A name this user may not read is never written out.
  const nameOf = (token, i) => (game.user.isGM || token.isOwner || token.actor?.isOwner || token.document?.playersCanSeeName !== false ? token.document?.name ?? token.name : null) || t("Ally", { n: i + 1 });
  const action = await DialogV2.wait({
    window: { title: t("PickTitle") },
    classes: ["lucd20-disgrace-pick"],
    content: `<p>${esc(t("Pick"))}</p>`,
    buttons: tokens.map((token, i) => ({ action: `ally${i}`, label: esc(nameOf(token, i)), default: i === 0 })),
    rejectClose: false
  });
  const m = /^ally(\d+)$/.exec(String(action ?? ""));
  return m ? tokens[Number(m[1])] ?? null : null;
}

defineSignature({
  id: "suchADisgrace",
  match: { pf2e: { slug: "such-a-disgrace", roll: "card" } },

  /** On the client of the one who used it: the ally it is for (see the top of the file). */
  async choose(info, { token, canSee }) {
    const me = token(info.caster);
    let list = [...new Set((info.candidates ?? []).map(token))].filter(x => x && x !== me && canSee(x));
    if (!list.length) list = [...(game.user.targets ?? [])].filter(x => x && x !== me && canSee(x));
    if (!list.length) { ui.notifications?.info?.(t("NoAlly")); return []; }
    if (list.length === 1) return list;
    const picked = await pickOne(list);
    return picked ? [picked] : [];
  },

  start() { loadFonts(); },

  async toTargets(fx, ctx) {
    const ally = ctx.targets[0];
    if (!ally || !fx.canSee(ally)) return;
    loadFonts();
    const dandy = ctx.caster && ctx.caster !== ally ? ctx.caster : null;
    const less = !!fx.less, T = less ? TIMES.less : TIMES.full, t0 = performance.now();
    const words = { shout: t("Shout"), tut: t("Tut") };
    // A token 80 px across is the mockup's size; kept readable when the view is zoomed far out or in.
    const scaleOf = token => clamp((token.w ?? 100) * (canvas.stage?.scale?.x ?? 1) / 80, .5, 2.6);
    fx.note("disgrace", { ally: ally.id, dandy: dandy?.id ?? null, less });
    fx.screenPaint((c, now, dt, vw, vh) => {
      const x = (performance.now() - t0) / 1000;
      if (x >= T.length || !fx.alive || ally.destroyed || !fx.canSee(ally)) return false;
      const seen = dandy && !dandy.destroyed && fx.canSee(dandy);
      paint(c, x, { ally: fx.toScreen(fx.centerOf(ally)), k: scaleOf(ally), dandy: seen ? fx.toScreen(fx.centerOf(dandy)) : null, kd: seen ? scaleOf(dandy) : 1, vw, vh, less, words });
      return true;
    });
    fx.later(T.shapeUp * 1000, () => fx.note("shapeUp"));
    await fx.wait(T.length * 1000);
  }
});
