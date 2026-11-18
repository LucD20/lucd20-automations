import { TX } from "../../token-reactions/textures.js";
import {
  TAU, PI, OBL, rnd, sgn, clamp, lerp, easeOut, easeIO, rotv, axisOf,
  P, ringFx, dust, sparks, mark, shake, walls, phHold, phAir, phStop, phReturn, stepWobble,
  coinFor, activeCoin, useLayersOf, useLayersAt, simScale, freezeFor, snapshot, engineState
} from "../../token-reactions/engine.js";
import { TYPES, MARK } from "../../token-reactions/reactions.js";
import { claimReaction } from "../../token-reactions/token-reactions.js";

/**
 * The Swashbuckler's finisher on the canvas (docs/PLAN.md §21; ported from docs/mockups/swashbuckler-finisher.html):
 * the attacker's art lunges and holds while the blade works, three slashes carve the sigil on the target (D),
 * the hit freezes into the impact frame (B) and the screen slash (C), then the target's art is thrown like a
 * coin, with the finisher's own accent and the confetti (F).
 *
 * It draws with the Token Reactions engine (coins, particles, ground marks; lengths in its units, a square =
 * 90) and with containers of its own on the canvas's interface group (the sigil, the hat, the impact frame).
 * - Token Reactions off for this user: nothing is lunged or thrown; the sigil, the sparks and B / C still play.
 * - Less motion: the sigil is drawn without sparks and the target only flashes.
 * - Nothing here is drawn for a token this user doesn't see; an unseen attacker's place is never given away
 *   (no lunge, no hat, a random direction for the blow).
 */

const GOLD = 0xffd24a;
const ADD = () => PIXI.BLEND_MODES.ADD;
/** For the harness: `hold` (seconds) keeps the big hit's freeze on the screen long enough to look at. */
export const _test = { hold: null };

/* -------------------------------------------- */
/*  Textures of our own                         */
/* -------------------------------------------- */

const FT = {};

function cv(w, h, fn) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  fn(c.getContext("2d"));
  return PIXI.Texture.from(c);
}

function ownTextures() {
  if (FT.hat) return FT;
  // The swashbuckler's hat, seen from above: brim, crown, gold band, feather.
  FT.hat = cv(192, 192, x => {
    x.translate(96, 104);
    const pg = x.createLinearGradient(20, -10, 90, -70); pg.addColorStop(0, "#fff8e6"); pg.addColorStop(1, "#e89a2e");
    x.fillStyle = pg; x.strokeStyle = "#1a0f0c"; x.lineWidth = 2.5; x.beginPath(); x.moveTo(18, -16); x.bezierCurveTo(30, -70, 78, -100, 92, -70); x.bezierCurveTo(98, -40, 70, -16, 44, -8); x.closePath(); x.fill(); x.stroke();
    const brim = x.createRadialGradient(0, 0, 0, 0, 0, 74); brim.addColorStop(0, "#6a1c26"); brim.addColorStop(1, "#22090c");
    x.fillStyle = brim; x.lineWidth = 3; x.beginPath(); x.ellipse(0, 0, 74, 70, 0, 0, TAU); x.fill(); x.stroke();
    x.strokeStyle = "#e8b84a"; x.lineWidth = 3; x.beginPath(); x.ellipse(0, 0, 68, 64, 0, 0, TAU); x.stroke();
    const crown = x.createRadialGradient(-8, -10, 0, -8, -10, 40); crown.addColorStop(0, "#9a2c3a"); crown.addColorStop(1, "#3c0e16");
    x.fillStyle = crown; x.strokeStyle = "#1a0f0c"; x.beginPath(); x.ellipse(0, 0, 34, 32, 0, 0, TAU); x.fill(); x.stroke();
    x.strokeStyle = "#e8b84a"; x.lineWidth = 5; x.beginPath(); x.ellipse(0, 0, 38, 36, 0, 0, TAU); x.stroke();
  });
  FT.petal = cv(32, 44, x => {
    const g = x.createLinearGradient(0, 0, 32, 44); g.addColorStop(0, "#fff"); g.addColorStop(1, "rgba(255,255,255,.6)");
    x.fillStyle = g; x.beginPath(); x.moveTo(16, 2); x.bezierCurveTo(36, 12, 30, 38, 16, 42); x.bezierCurveTo(2, 38, -4, 12, 16, 2); x.fill();
    x.strokeStyle = "rgba(0,0,0,.18)"; x.lineWidth = 1.5; x.beginPath(); x.moveTo(16, 6); x.quadraticCurveTo(19, 24, 16, 40); x.stroke();
  });
  FT.cards = ["spade", "heart", "club", "diamond"].map((s, i) => cv(40, 56, x => {
    x.fillStyle = "#fbf6ea"; x.strokeStyle = "#2a2018"; x.lineWidth = 2; x.beginPath();
    if (x.roundRect) x.roundRect(2, 2, 36, 52, 5); else x.rect(2, 2, 36, 52);
    x.fill(); x.stroke();
    x.translate(20, 28); x.fillStyle = i % 2 ? "#c2182c" : "#15110e"; x.beginPath();
    if (s === "heart" || s === "spade") {
      const k = s === "heart" ? 1 : -1;
      x.moveTo(0, 12 * k); x.bezierCurveTo(-18, -2 * k, -10, -16 * k, 0, -6 * k); x.bezierCurveTo(10, -16 * k, 18, -2 * k, 0, 12 * k); x.fill();
      if (s === "spade") { x.beginPath(); x.moveTo(0, 2); x.lineTo(-5, 15); x.lineTo(5, 15); x.closePath(); x.fill(); }
    } else if (s === "diamond") { x.moveTo(0, -14); x.lineTo(10, 0); x.lineTo(0, 14); x.lineTo(-10, 0); x.closePath(); x.fill(); }
    else {
      for (const [a, b] of [[0, -7], [-7, 3], [7, 3]]) { x.moveTo(a + 6, b); x.arc(a, b, 6, 0, TAU); }
      x.fill(); x.beginPath(); x.moveTo(0, 2); x.lineTo(-4, 15); x.lineTo(4, 15); x.closePath(); x.fill();
    }
  }));
  return FT;
}

/** Free them (the feature was switched off). */
export function disposeCanvas() {
  for (const tex of [FT.hat, FT.petal, ...(FT.cards ?? [])]) { try { tex?.destroy(true); } catch { /* already gone */ } }
  for (const key of Object.keys(FT)) delete FT[key];
}

/* -------------------------------------------- */
/*  Who and where                               */
/* -------------------------------------------- */

const elevOf = token => token.mesh?.elevation ?? token.document?.elevation ?? 0;

/** A token's place and size in the engine's units: where its art is drawn now. */
function geo(token, k) {
  const m = token.mesh, grid = canvas.dimensions?.size ?? 100, doc = token.document ?? {};
  const w = token.w ?? grid * (doc.width ?? 1), h = token.h ?? grid * (doc.height ?? 1), foot = (w + h) / 2 / k;
  const coin = activeCoin(token.id);
  const at = coin && !coin.gone ? { x: coin.hx * k, y: coin.hy * k }
    : m?.position ? { x: m.position.x - (m.pivot?.x ?? 0) * (m.scale?.x ?? 1), y: m.position.y - (m.pivot?.y ?? 0) * (m.scale?.y ?? 1) }
      : { x: (token.x ?? 0) + w / 2, y: (token.y ?? 0) + h / 2 };
  return { x: at.x / k, y: at.y / k, R: foot / 2 * .93, U: foot * .85 };
}

/** Everything one hit needs (as Token Reactions' own context): the direction of the blow, where it lands, the strength. */
function mkCtx(R, token) {
  const g = geo(token, R.k), from = R.from, crit = R.f.crit;
  let dx = 0, dy = 0, dist = 0;
  if (from) { dx = g.x - from.x; dy = g.y - from.y; dist = Math.hypot(dx, dy); }
  if (!(dist > 1)) { const a = rnd(0, TAU); dx = Math.cos(a); dy = Math.sin(a); dist = 1; }
  dx /= dist; dy /= dist;
  const side = sgn(), off = rnd(-1, 1);
  const c = {
    token, tok: null, T: { col: GOLD }, R: g.R, U: g.U, elev: elevOf(token), dir: { x: dx, y: dy }, dist, side, off, crit, kill: false, less: R.less,
    I: (crit ? 1.3 : 1.02) * (R.f.kind === "lethal" ? 1.12 : 1) * clamp(Number(R.tr.intensity) || 1, .3, 2),
    x: g.x, y: g.y, jit: 0, jab: 0, released: false, sigil: null
  };
  c.cutAng = Math.atan2(dy, dx) + side * rnd(1.0, 1.5);
  c.scrAng = sgn() * rnd(.32, .58); // the angle of the screen-wide cut (impact frame line, screen slash)
  c.ix = c.x - dx * c.R * .55 - dy * off * c.R * .55; c.iy = c.y - dy * c.R * .55 + dx * off * c.R * .55;
  return c;
}

/** Draw at this hit's elevation from now on (the engine changes it as it steps). */
function use(c) {
  if (c.tok && !c.tok.gone && activeCoin(c.tok.id) === c.tok) useLayersOf(c.tok);
  else useLayersAt(c.elev);
}

const alive = coin => !!coin && !coin.gone && activeCoin(coin.id) === coin;

/* -------------------------------------------- */
/*  How the target is thrown                    */
/* -------------------------------------------- */

const STYLES = {
  slash: { mark: "slashing", stop: TYPES.slashing.stop, burst: c => TYPES.slashing.burst(c), build: c => TYPES.slashing.build(c) },
  pierce: { mark: "piercing", stop: TYPES.piercing.stop, burst: c => TYPES.piercing.burst(c), build: c => TYPES.piercing.build(c) },
  // Unbalancing: a short hop, then the art teeters on its rim like a coin that will not lie down.
  teeter: { mark: "slashing", stop: { dur: .05, sq: .2, push: .1 }, burst: c => TYPES.slashing.burst(c),
    build(c) {
      const a = rotv(c.dir, rnd(-.3, .3)), sp = rnd(1.3, 1.8) * c.I * c.U;
      let em = 0;
      return [phAir(c, { main: true, vx: a.x * sp, vy: a.y * sp, vz: 3.3 * c.U, g: 24 * c.U, flips: c.crit ? 1 : 0, tiltMax: .9, axis: axisOf(a, true), yaw: c.side * 4, e: .1, fb: .4, fs: 9, maxB: 0, noSettle: true, wKick: 0,
        onLand(S, v) { if (v > c.U * 1.5) dust(S.x, S.y + c.R * .3, 5, 60 + v * .12); shake(3); } }),
      { init(S) { S.wA = c.crit ? 1.3 : 1.12; S.wAv = 0; S.wPhi = axisOf(a, true); S.wDir = c.side; S.vx = S.vy = 0; S.psiRate = 0; },
        update(S, dt) {
          stepWobble(S, dt, 1.9);
          const d = S.wA * c.U * 1.05 * dt * S.wDir;
          S.x += Math.cos(S.wPhi + PI / 2) * d; S.y += Math.sin(S.wPhi + PI / 2) * d; S.psi += S.wDir * S.wA * 1.6 * dt;
          walls(c, S);
          em += dt;
          if (em > .11 && S.wA > .12) {
            em = 0;
            const an = S.wPhi + PI / 2;
            P(TX.star, S.x + Math.cos(an) * c.R * .8, S.y + Math.sin(an) * c.R * .35, (c.tok?.zc ?? 0) + c.R * .9, { vz: 30, life: .5, s0: rnd(12, 20), s1: 3, add: true, tint: 0x9ff5e6, vr: 5 });
            if (S.wA > .5) dust(S.x - Math.cos(S.wPhi) * c.R * .8, S.y - Math.sin(S.wPhi) * c.R * .8, 1, 40, 0x9a8d7c, .18);
          }
          return S.wA < .02;
        } }];
    } }
};

/* -------------------------------------------- */
/*  D. Signature mark                           */
/* -------------------------------------------- */

/** Each sigil is three strokes; a stroke is a curve a → b bent through c: [ax, ay, cx, cy, bx, by], in units of the mark's radius. */
export const SIGILS = {
  S: [[.66, -.6, 0, -.88, -.56, -.5], [-.56, -.5, -.1, .1, .56, .5], [.56, .5, 0, .92, -.7, .64]],
  X: [[-.66, -.66, .1, -.1, .66, .66], [.66, -.66, .1, .1, -.66, .66], [-.74, .92, 0, 1.06, .74, .86]],
  star: [[0, -.92, .07, 0, 0, .92], [-.8, -.46, 0, .08, .8, .46], [.8, -.46, 0, .08, -.8, .46]]
};
const strokePt = (d, u) => { const v = 1 - u; return [v * v * d[0] + 2 * u * v * d[2] + u * u * d[4], v * v * d[1] + 2 * u * v * d[3] + u * u * d[5]]; };

/** A blade-shaped ribbon along the first `p` of the stroke. */
function strokePoly(d, R, p, w) {
  const n = 16, m = Math.max(1, Math.ceil(n * p)), a = [], b = [];
  for (let i = 0; i <= m; i++) {
    const u = Math.min(p, i / n), v = 1 - u, q = strokePt(d, u);
    let tx = 2 * v * (d[2] - d[0]) + 2 * u * (d[4] - d[2]), ty = 2 * v * (d[3] - d[1]) + 2 * u * (d[5] - d[3]);
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const ww = w * Math.pow(Math.sin(PI * u), .6) * (p >= 1 ? 1 : Math.min(1, (p - u) * 9));
    a.push(q[0] * R - ty * ww, q[1] * R + tx * ww); b.unshift(q[0] * R + ty * ww, q[1] * R - tx * ww);
  }
  return a.concat(b);
}

/** The run's own container on the canvas (the sigils, the hat), made when first needed. */
function ownLayer(R) {
  if (!R.layer || R.layer.destroyed) R.layer = R.fx.worldLayer(1);
  return R.layer;
}

function mkSigil(R, c) {
  const layer = ownLayer(R);
  if (!layer) return null;
  const k = new PIXI.Container();
  k.position.set(c.x * R.k, c.y * R.k); k.scale.set(R.k); k.rotation = rnd(-.16, .16);
  layer.addChild(k);
  const sg = { k, x: c.x, y: c.y, rot: k.rotation, R: c.R * (c.crit ? .84 : .72), w: Math.max(3.6, c.R * .085) * (c.crit ? 1.25 : 1), dead: false };
  sg.strokes = SIGILS[R.f.o.sigil ?? "S"].map(def => {
    const glow = new PIXI.Graphics(), core = new PIXI.Graphics();
    glow.blendMode = ADD();
    k.addChild(glow, core);
    return { def, glow, core, p: 0 };
  });
  R.sigils.push(sg);
  return sg;
}

function drawStroke(sg, s) {
  if (sg.k.destroyed) return;
  const p = s.p;
  s.glow.clear(); s.core.clear();
  if (p <= 0) return;
  s.glow.beginFill(0xff9a1a, .2).drawPolygon(strokePoly(s.def, sg.R, p, sg.w * 2.6)).endFill();
  s.core.beginFill(0x6a2f06, .9).drawPolygon(strokePoly(s.def, sg.R, p, sg.w * 1.55)).endFill();
  s.core.beginFill(GOLD).drawPolygon(strokePoly(s.def, sg.R, p, sg.w)).endFill().beginFill(0xfffbe6).drawPolygon(strokePoly(s.def, sg.R, p, sg.w * .42)).endFill();
}

/** One slash of the blade: the stroke is drawn, sparks fly off its end, the target flinches. */
function slashStroke(R, c, sg, s, dur) {
  const { fx, less } = R;
  fx.tween(dur, u => { s.p = less ? u : easeOut(u); drawStroke(sg, s); });
  if (less) return;
  use(c);
  const d = s.def, rot = sg.rot, a = Math.atan2(d[5] - d[1], d[4] - d[0]) + rot;
  const m = rotv({ x: (d[0] + d[4]) / 2 * sg.R, y: (d[1] + d[5]) / 2 * sg.R }, rot), e = rotv({ x: d[4] * sg.R, y: d[5] * sg.R }, rot), len = sg.R * 3.6;
  P(TX.spark, sg.x + m.x, sg.y + m.y, 0, { s0: 46, s1: 6, ax: len / 46, life: .16, add: true, tint: 0xfff6dc, rot: a, pw: 1 });
  P(TX.spark, sg.x + m.x, sg.y + m.y, 0, { s0: 100, s1: 14, ax: len * .8 / 100, life: .22, add: true, tint: 0xffa820, rot: a, a: .5 });
  sparks(sg.x + e.x, sg.y + e.y, 6, c.crit ? 9 : 6, GOLD, 560, { ang: a, spread: .5 });
  if (alive(c.tok)) { const S = c.tok.S; S.q = .11; S.qv = 0; S.qDir = a; S.flash = .16; S.flashCol = 0xffe9a8; S.dark = .5; }
  c.jit = c.crit ? 8 : 5; c.jab = 11;
  fx.shake(2.5);
}

/** The target's art stands in for its token, pinned and trembling, while the blade works. */
function pin(R, c) {
  const t = coinFor(c.token);
  if (!t) return;
  c.tok = t;
  R.coins.add(t);
  t.play([{ update(S, dt) { S.jx = rnd(-1, 1) * c.jit; S.jy = rnd(-1, 1) * c.jit; c.jit *= Math.exp(-16 * dt); return c.released; } }]);
}

async function carve(R, c) {
  const { fx, f, less } = R;
  const sg = f.o.D ? c.sigil = mkSigil(R, c) : null;
  if (R.tr.on && !less) pin(R, c);
  if (!sg) { if (!less) await fx.wait(50); return; }
  const per = less ? .1 : R.ctxs.length > 1 ? .062 : .075;
  for (const s of sg.strokes) {
    slashStroke(R, c, sg, s, per * .8);
    await fx.wait(per * 1000);
  }
}

function killSigil(R, sg) {
  const i = R.sigils.indexOf(sg);
  if (i >= 0) R.sigils.splice(i, 1);
  try { if (!sg.k.destroyed) sg.k.destroy({ children: true }); } catch { /* torn down with the canvas */ }
}

/** The mark bursts as the target flies: it stays scorched into the floor for a while. */
function shatter(R, sg, c) {
  if (sg.dead) return;
  sg.dead = true;
  const { fx, less } = R, kx = sg.x, ky = sg.y, rot = sg.rot;
  use(c);
  mark(kx, ky, 6, g => { g.rotation = rot; for (const s of sg.strokes) g.beginFill(0x070403, .6).drawPolygon(strokePoly(s.def, sg.R, 1, sg.w * .9)).endFill(); });
  mark(kx, ky, 2.6, g => { g.rotation = rot; for (const s of sg.strokes) g.beginFill(0xffb030, .7).drawPolygon(strokePoly(s.def, sg.R, 1, sg.w * .6)).endFill(); }, { add: true, fade: 1.9 });
  if (less) { fx.tween(.9, u => { if (!sg.k.destroyed) sg.k.alpha = 1 - Math.max(0, (u - .55) / .45); }, () => killSigil(R, sg)); return; }
  P(TX.star, kx, ky, 0, { s0: sg.R * 1.2, s1: sg.R * 4.4, life: .2, add: true, tint: 0xfff2c0, rot: rnd(0, 1), vr: 3 });
  for (const s of sg.strokes) for (let i = 0; i <= 6; i++) {
    const q = rotv({ x: strokePt(s.def, i / 6)[0] * sg.R, y: strokePt(s.def, i / 6)[1] * sg.R }, rot), x = kx + q.x, y = ky + q.y;
    sparks(x, y, 8, 2, i % 2 ? GOLD : 0xfff2c0, 560, { g: 1300, up: .9 });
    if (i % 2 === 0) P(TX.shard, x, y, 10, { vx: rnd(-320, 320) + c.dir.x * 160, vy: rnd(-320, 320) + c.dir.y * 160, vz: rnd(150, 520), g: 1700, life: rnd(.45, .85), s0: rnd(5, 11), tint: GOLD, vr: rnd(-14, 14), bounce: true, add: true, a: .95 });
  }
  fx.tween(.11, u => { if (!sg.k.destroyed) { sg.k.alpha = 1 - u; sg.k.scale.set(R.k * (1 + .35 * u)); } }, () => killSigil(R, sg));
}

/* -------------------------------------------- */
/*  B. Impact frame                             */
/* -------------------------------------------- */

const INK_FRAG = `varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float thr;
uniform float inv;
void main(void) {
  vec4 c = texture2D(uSampler, vTextureCoord);
  vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
  float v = step(thr, dot(rgb, vec3(0.3, 0.59, 0.11)));
  v = mix(v, 1.0 - v, inv);
  gl_FragColor = vec4(vec3(v) * c.a, c.a);
}`;

/** Stark two-tone: light parts white, the rest black (`inv`: the other way round), the art's own outline kept. */
function inkFilter(thr, inv) {
  try {
    return new PIXI.Filter(undefined, INK_FRAG, { thr, inv: inv ? 1 : 0 });
  } catch {
    // No custom filter: a colour matrix pushed to its ends does nearly the same.
    const Matrix = PIXI.ColorMatrixFilter ?? PIXI.filters?.ColorMatrixFilter;
    const f = new Matrix(), K = inv ? -40 : 40, o = .5 - thr * K;
    f.matrix = [.3 * K, .59 * K, .11 * K, 0, o, .3 * K, .59 * K, .11 * K, 0, o, .3 * K, .59 * K, .11 * K, 0, o, 0, 0, 0, 1, 0];
    return f;
  }
}

/** The art through the ink filter, as a small texture. */
function bake(tex, thr, inv) {
  const renderer = canvas.app.renderer, s = Math.min(1, 256 / Math.max(tex.width, tex.height));
  const sprite = new PIXI.Sprite(tex);
  sprite.scale.set(s);
  sprite.filters = [inkFilter(thr, inv)];
  const rt = PIXI.RenderTexture.create({ width: Math.max(2, Math.ceil(tex.width * s)), height: Math.max(2, Math.ceil(tex.height * s)), resolution: 1 });
  try {
    renderer.render(sprite, { renderTexture: rt, clear: true });
  } catch (err) {
    rt.destroy(true);
    throw err;
  } finally {
    sprite.destroy();
  }
  return rt;
}

/** Where to cut between black and white: about the art's own average brightness, so dark and light art both read. */
function thresholdOf(tex) {
  let rt = null;
  try {
    const renderer = canvas.app.renderer, sprite = new PIXI.Sprite(tex);
    sprite.width = 16; sprite.height = 16;
    rt = PIXI.RenderTexture.create({ width: 16, height: 16, resolution: 1 });
    renderer.render(sprite, { renderTexture: rt, clear: true });
    sprite.destroy();
    const px = renderer.extract.pixels(rt);
    let sum = 0, weight = 0;
    for (let i = 0; i < px.length; i += 4) { const a = px[i + 3] / 255; sum += (px[i] * .3 + px[i + 1] * .59 + px[i + 2] * .11) / 255 * a; weight += a; }
    return weight > 1 ? clamp(sum / weight * .96, .2, .7) : .45;
  } catch {
    return .45;
  } finally {
    try { rt?.destroy(true); } catch { /* nothing */ }
  }
}

/** One token as an ink cut-out: its outline and its two-tone art, where its art is drawn right now. */
function inkToken(R, token, crit, made) {
  const mesh = token.mesh, coin = activeCoin(token.id), live = coin && !coin.gone ? coin : null;
  let base = live?.tex ?? null;
  if (!base) {
    const snap = (token.hasDynamicRing ?? token.document?.ring?.enabled) ? snapshot(mesh) : null;
    if (snap) made.push(snap);
    base = snap ?? mesh.texture;
  }
  if (!base || base.valid === false || !(base.width > 1)) return null;
  const thr = thresholdOf(base);
  const normal = bake(base, thr, false); made.push(normal);
  const inverted = crit ? bake(base, thr, true) : null; if (inverted) made.push(inverted);
  const outline = bake(base, 2, true); made.push(outline); // everything white: the silhouette
  const k = R.k, w = Math.abs(mesh.width) || token.w || 100, h = Math.abs(mesh.height) || token.h || 100;
  const at = live ? { x: live.sx * k, y: live.sy * k } : (() => { const g = geo(token, k); return { x: g.x * k, y: g.y * k }; })();
  const box = new PIXI.Container();
  box.position.set(at.x, at.y);
  box.rotation = (mesh.rotation || 0) + (live?.S?.psi ?? 0);
  box.scale.set(Math.sign(mesh.scale?.x ?? 1) || 1, Math.sign(mesh.scale?.y ?? 1) || 1);
  const edge = new PIXI.Sprite(outline), art = new PIXI.Sprite(normal);
  for (const s of [edge, art]) s.anchor.set(.5);
  edge.width = w * 1.09; edge.height = h * 1.09; art.width = w; art.height = h;
  box.addChild(edge, art);
  return { box, edge, art, normal, inverted };
}

/**
 * The frame, ready to show: a sheet over the view, speed lines from the target, the tokens involved (those this
 * user sees) as ink cut-outs, the sigil in ink. It sits above everything on the canvas, so nothing under it has
 * to be hidden or put back. Null when it can't be made.
 */
function frameStart(R, c) {
  const { fx, k } = R, crit = c.crit, made = [];
  let layer = null;
  try {
    layer = fx.worldLayer(2e5);
    if (!layer) return null;
    const tl = fx.toWorld({ x: 0, y: 0 }), br = fx.toWorld({ x: window.innerWidth, y: window.innerHeight });
    const vw = Math.abs(br.x - tl.x), vh = Math.abs(br.y - tl.y), pad = Math.max(vw, vh) * .4, far = Math.hypot(vw, vh) + pad;
    const x0 = Math.min(tl.x, br.x) - pad, y0 = Math.min(tl.y, br.y) - pad;
    const cx = c.x * k, cy = c.y * k;
    const sheet = new PIXI.Graphics(), lines = new PIXI.Graphics(), inks = new PIXI.Container(), sig = new PIXI.Graphics();
    layer.addChild(sheet, lines, inks, sig);
    layer.pivot.set(cx, cy); layer.position.set(cx, cy);
    const tokens = [...new Set([R.caster, ...R.ctxs.map(x => x.token)])].filter(t => t && fx.canSee(t) && t.mesh && !t.mesh.destroyed);
    const cuts = tokens.map(t => { try { return inkToken(R, t, crit, made); } catch { return null; } }).filter(Boolean);
    for (const cut of cuts) inks.addChild(cut.box);
    const free = fx.cleanup(() => { for (const tex of made) { try { tex.destroy(true); } catch { /* gone */ } } });

    const setInk = v => {
      const dark = v === 1 ? 0x000000 : 0xffffff;
      sheet.clear().beginFill(v === 1 ? 0xffffff : 0x000000).drawRect(x0, y0, vw + pad * 2, vh + pad * 2).endFill();
      lines.clear().beginFill(dark);
      const n = crit ? 120 : 90, small = c.R < 60 ? 1.8 : 1;
      for (let i = 0; i < n; i++) {
        const a = rnd(0, TAU), w = rnd(.004, .02) * (Math.random() < .16 ? 2.4 : 1), ri = c.R * k * rnd(1.5, 3.4) * small;
        lines.drawPolygon([cx + Math.cos(a) * ri, cy + Math.sin(a) * ri, cx + Math.cos(a - w) * far, cy + Math.sin(a - w) * far, cx + Math.cos(a + w) * far, cy + Math.sin(a + w) * far]);
      }
      // The cut itself: one long blade line through the target.
      const d = { x: Math.cos(c.scrAng), y: Math.sin(c.scrAng) }, wd = (crit ? 9 : 6) * k, pts = [];
      for (let i = 0; i <= 12; i++) { const u = i / 12, l = lerp(-far, far, u), ww = wd * Math.sin(PI * u); pts.push(cx + d.x * l - d.y * ww, cy + d.y * l + d.x * ww); }
      for (let i = 12; i >= 0; i--) { const u = i / 12, l = lerp(-far, far, u), ww = wd * Math.sin(PI * u); pts.push(cx + d.x * l + d.y * ww, cy + d.y * l - d.x * ww); }
      lines.drawPolygon(pts).endFill();
      for (const cut of cuts) { cut.edge.tint = dark; cut.art.texture = v === 2 && cut.inverted ? cut.inverted : cut.normal; }
      sig.clear().beginFill(v === 2 ? 0x000000 : 0xffffff);
      for (const sg of R.sigils) for (const s of sg.strokes) {
        if (s.p <= 0) continue;
        const poly = strokePoly(s.def, sg.R, s.p, sg.w * 1.35), co = Math.cos(sg.rot), si = Math.sin(sg.rot), out = [];
        for (let i = 0; i < poly.length; i += 2) out.push((sg.x + poly[i] * co - poly[i + 1] * si) * k, (sg.y + poly[i] * si + poly[i + 1] * co) * k);
        sig.drawPolygon(out);
      }
      sig.endFill();
    };
    setInk(crit ? 2 : 1); // a first draw now: trouble shows here, not in the middle of the hit
    layer.visible = false;
    return {
      run(dur) {
        let ink = 0, rd = 1, punch = crit ? .09 : .06;
        layer.visible = true;
        fx.note("frame", { tokens: cuts.length });
        fx.tween(dur, (u, T, dt) => {
          if (layer.destroyed) return;
          const want = crit && u < .36 ? 2 : 1;
          rd += dt;
          if (want !== ink || rd > .05) { rd = 0; ink = want; setInk(want); }
          punch *= Math.exp(-11 * dt);
          layer.scale.set(1 + punch);
          fx.shake(crit ? 5 : 2.5);
        }, () => { layer.lucdRemove?.(); free(); fx.flash(.6); });
      }
    };
  } catch (err) {
    console.warn("LucD20 | Signature Spells: the impact frame could not be drawn.", err);
    layer?.lucdRemove?.();
    for (const tex of made) { try { tex.destroy(true); } catch { /* gone */ } }
    return null;
  }
}

/* -------------------------------------------- */
/*  C. Screen slash                             */
/* -------------------------------------------- */

/**
 * The scene is rendered into a texture and shown as two halves that slide along the cut, then rejoin. While it
 * shows, the stage's other children are not rendered; they are put back exactly, whatever happens. Only with
 * WebGL 2, and null on any trouble (the hit then plays without it).
 */
function splitStart(R, c) {
  const { fx } = R, renderer = canvas.app?.renderer, stage = canvas.stage;
  let root = null, rt = null, restore = () => {};
  try {
    if (!renderer || !stage?.children || renderer.context?.webGLVersion !== 2) return null;
    const sw = renderer.screen.width, sh = renderer.screen.height;
    if (!(sw > 8 && sh > 8)) return null;
    rt = PIXI.RenderTexture.create({ width: sw, height: sh, resolution: renderer.resolution || 1 });
    root = new PIXI.Container();
    root.eventMode = "none";
    const hidden = new Map();
    let live = false;
    restore = () => {
      for (const [o, was] of hidden) { try { if (!o.destroyed) o.renderable = was; } catch { /* gone */ } }
      hidden.clear();
      live = false;
    };
    /** The scene as it is now, into the texture: everything rendered but our halves. */
    const snap = () => {
      for (const [o, was] of hidden) if (!o.destroyed) o.renderable = was;
      root.renderable = false;
      try { renderer.render(stage, { renderTexture: rt, clear: true }); }
      finally {
        root.renderable = true;
        if (live) for (const o of hidden.keys()) if (!o.destroyed) o.renderable = false;
      }
    };
    /** Our halves are in screen pixels: undo the stage's pan and zoom. */
    const place = () => {
      const sx = stage.scale?.x || 1, sy = stage.scale?.y || 1;
      root.scale.set(1 / sx, 1 / sy);
      root.position.set((stage.pivot?.x ?? 0) - (stage.position?.x ?? 0) / sx, (stage.pivot?.y ?? 0) - (stage.position?.y ?? 0) / sy);
    };
    const ang = c.scrAng, d = { x: Math.cos(ang), y: Math.sin(ang) }, n = { x: -d.y, y: d.x };
    const at = stage.worldTransform.apply(new PIXI.Point(c.x * R.k, c.y * R.k));
    const px = clamp(at.x, sw * .25, sw * .75), py = clamp(at.y, sh * .3, sh * .7);
    const rect = [[-60, -60], [sw + 60, -60], [sw + 60, sh + 60], [-60, sh + 60]];
    const clip = sign => {
      const out = [];
      for (let i = 0; i < 4; i++) {
        const a = rect[i], b = rect[(i + 1) % 4], da = ((a[0] - px) * n.x + (a[1] - py) * n.y) * sign, db = ((b[0] - px) * n.x + (b[1] - py) * n.y) * sign;
        if (da >= 0) out.push(a[0], a[1]);
        if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); }
      }
      return out;
    };
    const bg = new PIXI.Graphics().beginFill(0x050305).drawRect(-80, -80, sw + 160, sh + 160).endFill();
    // What the texture leaves clear (outside the scene) is the renderer's own background.
    const back = Number(renderer.background?.color ?? renderer.backgroundColor ?? 0) || 0;
    const gap = new PIXI.Graphics().beginFill(0xffa820, .55).drawRect(-3000, -9, 6000, 18).endFill().beginFill(0xfff6dc).drawRect(-3000, -3.5, 6000, 7).endFill();
    gap.position.set(px, py); gap.rotation = ang;
    const halves = [1, -1].map(sign => {
      const k = new PIXI.Container(), sp = new PIXI.Sprite(rt), m = new PIXI.Graphics().beginFill(0xffffff).drawPolygon(clip(sign)).endFill();
      const fill = new PIXI.Graphics().beginFill(back).drawRect(-60, -60, sw + 120, sh + 120).endFill();
      k.addChild(fill, sp, m); k.mask = m;
      return { k, sign };
    });
    const gl = new PIXI.Sprite(TX.spark);
    gl.anchor.set(.5); gl.blendMode = ADD(); gl.rotation = ang; gl.scale.set(sw * .9 / 96, Math.max(.8, 2.4 * sw / 1280));
    root.addChild(bg, gap, ...halves.map(h => h.k), gl);
    const mag = Math.max(5, (c.crit ? 30 : 18) * sw / 1280);
    // The stage may still be moved after our frame (screen shake, a pan): place the halves as it is rendered.
    const onPre = () => { try { if (!root.destroyed && root.parent) place(); } catch { /* next frame */ } };
    const end = fx.cleanup(() => {
      restore();
      try { renderer.off?.("prerender", onPre); } catch { /* nothing */ }
      try { if (!root.destroyed) root.destroy({ children: true }); } catch { /* torn down with the canvas */ }
      try { rt.destroy(true); } catch { /* gone */ }
    });
    snap(); // a first time now: a renderer that can't do it says so here, and nothing was hidden yet
    return {
      run(dur) {
        stage.addChild(root);
        place();
        snap(); // with the impact frame, when that is on
        renderer.on?.("prerender", onPre);
        for (const ch of stage.children) if (ch !== root) hidden.set(ch, ch.renderable);
        live = true;
        for (const o of hidden.keys()) o.renderable = false;
        fx.note("slash");
        fx.tween(dur, u => {
          if (root.destroyed) return;
          try { place(); snap(); } catch { end(); return; }
          const s = u < .18 ? 0 : u < .72 ? easeOut((u - .18) / .54) : 1 - Math.pow((u - .72) / .28, 2);
          for (const h of halves) h.k.position.set((d.x * mag + n.x * mag * .3) * s * h.sign, (d.y * mag + n.y * mag * .3) * s * h.sign);
          const gu = Math.min(1, u / .3), l = lerp(-sw * .8, sw * .8, gu);
          gl.position.set(px + d.x * l, py + d.y * l); gl.alpha = gu < 1 ? 1 : 0;
        }, () => { end(); fx.flash(.5, 0xfff2c0); });
      }
    };
  } catch (err) {
    console.warn("LucD20 | Signature Spells: the screen slash could not be drawn.", err);
    restore();
    try { if (root && !root.destroyed) root.destroy({ children: true }); } catch { /* nothing */ }
    try { rt?.destroy(true); } catch { /* nothing */ }
    return null;
  }
}

/* -------------------------------------------- */
/*  F. Confetti                                 */
/* -------------------------------------------- */

function confetti(R, c) {
  const { fx, f, k } = R, kind = f.o.conf, n = c.crit ? 1.5 : 1, tex = ownTextures();
  use(c);
  if (kind !== "hat") fx.note("confetti", { kind });
  if (kind === "petals") {
    for (let i = 0; i < 46 * n; i++) {
      const a = rnd(0, TAU), v = rnd(60, 440);
      P(tex.petal, c.x, c.y, rnd(30, 90), { vx: Math.cos(a) * v, vy: Math.sin(a) * v * .8, vz: rnd(300, 950), g: 560, drag: 1.7, life: rnd(1.7, 2.9), s0: rnd(12, 22), tint: [0xe8455f, 0xff8fa3, 0xc2203f, 0xffc2cc][i % 4], vr: rnd(-5, 5), flut: rnd(6, 14), pw: 6 });
    }
    return 0;
  }
  if (kind === "suits") {
    for (let i = 0; i < 26 * n; i++) {
      const a = rnd(0, TAU), v = rnd(120, 520);
      P(tex.cards[i % 4], c.x, c.y, rnd(30, 80), { vx: Math.cos(a) * v, vy: Math.sin(a) * v * .8, vz: rnd(400, 1000), g: 1000, drag: 1.3, life: rnd(1.6, 2.6), s0: rnd(18, 27), vr: rnd(-9, 9), flut: rnd(8, 16), pw: 6 });
    }
    return 0;
  }
  // The swashbuckler's hat goes up, twirls and comes back down: only where this user sees the swashbuckler.
  const A = R.A, home = R.from, layer = home ? ownLayer(R) : null;
  if (!layer) return 0;
  fx.note("confetti", { kind });
  const at = () => (alive(A) ? { x: A.S.x, y: A.S.y } : home);
  const sp = new PIXI.Sprite(tex.hat);
  sp.anchor.set(.5);
  layer.addChild(sp);
  const side = c.side, h = c.crit ? 330 : 250, s0 = home.R * 2.5 / 192;
  fx.tween(1.15, u => {
    if (sp.destroyed) return;
    const p = at(), z = 4 * h * u * (1 - u), s = s0 * (1 + z / 500) * k;
    sp.position.set((p.x + Math.sin(u * PI) * 50 * side) * k, (p.y - home.R * .25 - z * OBL) * k);
    sp.scale.set(s * Math.cos(u * TAU * 2.5), s); sp.rotation = u * TAU * 1.5 * side; sp.alpha = Math.min(1, u * 10, (1 - u) * 8);
    if (Math.random() < .25 && u < .8) { useLayersAt(R.casterElev); P(tex.petal, sp.x / k, sp.y / k, 0, { vx: rnd(-40, 40), vy: rnd(20, 80), life: rnd(.5, .9), s0: rnd(6, 10), tint: 0xffe6a0, vr: rnd(-4, 4), flut: 10 }); }
  }, () => { const p = at(); try { if (!sp.destroyed) sp.destroy(); } catch { /* gone */ } useLayersAt(R.casterElev); dust(p.x, p.y, 2, 40, 0x9a8d7c, .15); });
  const p = at();
  useLayersAt(R.casterElev);
  for (let i = 0; i < 10; i++) P(TX.star, p.x + rnd(-1, 1) * home.R, p.y + rnd(-1, 1) * home.R, rnd(20, 60), { vz: rnd(60, 220), life: rnd(.4, .8), s0: rnd(10, 20), s1: 2, add: true, tint: GOLD, vr: rnd(-4, 4) });
  return 1200;
}

/* -------------------------------------------- */
/*  The strike                                  */
/* -------------------------------------------- */

function goldBurst(R, c) {
  sparks(c.x, c.y, 24, Math.round(16 * c.I), GOLD, 760, { up: .8 }); sparks(c.x, c.y, 24, 8, 0xfff2c0, 520);
  P(TX.star, c.ix, c.iy, 30, { s0: 40, s1: 170 * c.I, life: .2, add: true, tint: 0xffe9a8, rot: rnd(0, 1) });
  ringFx(c.x, c.y, c.R * .8, c.R * 3.6, .32, GOLD, { a: .7 });
  R.fx.shake(6 * c.I);
  for (let i = 0; i < 9; i++) P(TX.star, c.x + rnd(-1, 1) * c.R * 1.4, c.y + rnd(-1, 1) * c.R * 1.1, rnd(10, 60), { vz: rnd(40, 170), life: rnd(.4, .85), s0: rnd(10, 22), s1: 2, add: true, tint: i % 3 ? GOLD : 0xffffff, vr: rnd(-4, 4), fi: .2 });
}

/** Bleeding Finisher: the thrown art drips, and leaves a red trail on the floor. */
function bleed(R, c) {
  const t = c.tok, big = c.R > 60 ? 1.25 : 1;
  let acc = 0, bx, by;
  R.fx.tween(2.6, (u, T, dt) => {
    acc += dt;
    if (acc < .035 || !alive(t)) return;
    acc = 0;
    const S = t.S, left = 2.6 - T, kk = Math.min(1, left / 1.2), moving = Math.hypot(S.vx, S.vy) > 30 || S.z > 4;
    useLayersOf(t);
    if (Math.random() < kk) P(TX.dot, S.x + rnd(-1, 1) * c.R * .5, S.y + rnd(-1, 1) * c.R * .4, (t.zc || 0) + rnd(0, 10), { vx: rnd(-50, 50), vy: rnd(-40, 40), vz: rnd(0, 140), g: 1500, life: rnd(.35, .7), s0: rnd(5, 11), s1: 4, tint: Math.random() < .5 ? 0xd0141e : 0x8a0a12, pw: 4 });
    const ox = bx ?? S.x, oy = by ?? S.y, dist = Math.hypot(S.x - ox, S.y - oy), nb = moving ? Math.min(6, 1 + (dist / 22 | 0)) : 0;
    bx = S.x; by = S.y;
    for (let i = 0; i < nb; i++) {
      const r = rnd(4, 12) * big, e = rnd(.6, 1), v = (i + 1) / nb;
      mark(lerp(ox, S.x, v) + rnd(-1, 1) * c.R * .45, lerp(oy, S.y, v) + rnd(-1, 1) * c.R * .45, 5.5, g => { g.beginFill(0x7a070c, .85).drawEllipse(0, 0, r, r * e).endFill().beginFill(0xc8141e, .6).drawCircle(r * .2, -r * .2, r * .45).endFill(); });
    }
  });
}

/** The hit lands: the mark on the ground, the bursts, the finisher's accent, and the target's own throw. Returns how long our own drawings go on (ms). */
function impactFin(R, c, last) {
  const { fx, f, less, tr } = R, ST = STYLES[f.F.style], a = Math.atan2(c.dir.y, c.dir.x);
  c.released = true;
  let tail = less ? 950 : 250;
  if (!fx.canSee(c.token)) { if (c.sigil) killSigil(R, c.sigil); return tail; } // out of sight meanwhile
  let t = null;
  if (tr.on) {
    t = coinFor(c.token, { less });
    if (t) { c.tok = t; R.coins.add(t); useLayersOf(t); t.rest(); t.S.wDir = sgn(); }
  }
  if (!t) c.tok = null;
  use(c);
  MARK[ST.mark](c, c.x, c.y);
  if (c.sigil) { const sg = c.sigil; fx.later(less ? 0 : 60, () => shatter(R, sg, c)); }
  // The damage is applied later: Token Reactions then only flashes and shows the number.
  if (t && fx.claim) claimReaction(c.token.id, null);
  if (less) {
    if (t) {
      t.S.flashCol = 0xffe9a8;
      let tt = 0;
      t.play([{ update(S, dt) { tt += dt; S.flash = Math.max(0, 1 - tt / .5) * (c.crit ? .6 : .45); return tt > .55; } }]);
    }
    return tail;
  }
  ST.burst(c); goldBurst(R, c);
  if (c.crit) {
    fx.shake(13);
    P(TX.rays, c.x, c.y, 30, { s0: c.R * 2.4, s1: c.R * 6.5, life: .5, add: true, tint: 0xfff0c0, vr: 2.5, a: .85, pw: 1.2 });
    P(TX.rays, c.x, c.y, 30, { s0: c.R * 2, s1: c.R * 5, life: .42, add: true, tint: GOLD, vr: -3, a: .7 });
    ringFx(c.x, c.y, c.R, c.R * 6, .4, 0xffffff, { a: .7 });
  }
  // Small accents per finisher.
  if (f.kind === "bleeding") {
    for (let i = 0; i < 16; i++) { const an = c.cutAng + (c.side > 0 ? 0 : PI) + rnd(-.5, .5), v = rnd(150, 620); P(TX.dot, c.x, c.y, 24, { vx: Math.cos(an) * v, vy: Math.sin(an) * v, vz: rnd(80, 380), g: 1500, life: rnd(.5, 1), s0: rnd(6, 14), s1: 5, tint: i % 2 ? 0xd0141e : 0x8a0a12, pw: 4 }); }
    if (t) { bleed(R, c); tail = Math.max(tail, 2700); }
  } else if (f.kind === "lethal") {
    MARK.bludgeoning(c, c.x, c.y, .8); fx.shake(11); fx.flash(.2, 0xff2040);
    P(TX.rays, c.x, c.y, 30, { s0: c.R * 1.6, s1: c.R * 5.5, life: .45, add: true, tint: 0xff2a4a, vr: 3, a: .8 }); sparks(c.x, c.y, 24, 14, 0xff5a6a, 820, { up: .9 });
  } else if (f.kind === "impaling") { // the thrust goes clean through and out the far side
    P(TX.spark, c.x, c.y, 24, { s0: 50, s1: 6, ax: c.R * 6.5 / 50, life: .24, add: true, tint: 0xffffff, rot: a, pw: 1 });
    P(TX.spark, c.x, c.y, 24, { s0: 110, s1: 14, ax: c.R * 5.5 / 110, life: .3, add: true, tint: 0xbfd8ff, rot: a, a: .5 });
    sparks(c.x + c.dir.x * c.R, c.y + c.dir.y * c.R, 24, 12, 0xeaf2ff, 1000, { ang: a, spread: .22, up: .2 });
  } else if (f.kind === "unbalancing") ringFx(c.x, c.y, c.R, c.R * 3, .45, 0x8ff5e6, { a: .6 });
  if (f.o.F && last) tail = Math.max(tail, confetti(R, c));
  if (t) { useLayersOf(t); t.play([phStop(c, ST.stop), ...ST.build(c), phReturn(c)]); }
  return tail;
}

/** The big hit: a freeze (longer with B or C), then the throw. */
async function bigHit(R, c) {
  const { fx, f } = R;
  // The impact frame shows the attacker: only for a user who sees it (or owns it).
  const frame = f.o.B && f.who ? frameStart(R, c) : null;
  const split = f.o.C ? splitStart(R, c) : null;
  const hold = _test.hold ?? (frame || split ? (split ? .2 : .15) + (c.crit ? .07 : 0) : .05);
  fx.note("hit");
  freezeFor(hold);
  frame?.run(hold);
  split?.run(hold);
  await fx.wait(hold * 1000);
  freezeFor(0);
  fx.note("throw");
  return impactFin(R, c, true);
}

/**
 * The attacker's art bumps towards its target, holds there while the blade works, then goes home. For Dual it
 * spins on to the second target. Resolves when it has arrived.
 */
async function lunge(R, c, i, last) {
  const { fx } = R, A = R.A;
  if (!alive(A)) return fx.wait(i === 0 ? 190 : 150); // nobody to lunge (unseen, or Token Reactions off): the same beat
  const hx = A.hx, hy = A.hy;
  const gap = c.dist - A.R - c.R, reach = clamp(gap + A.R * .5, A.U * .25, A.U * 2.6), ax = axisOf(c.dir, true), tx = hx + c.dir.x * reach, ty = hy + c.dir.y * reach;
  let x0 = hx, y0 = hy, bx = tx, by = ty, arrived;
  const arrive = new Promise(resolve => { arrived = resolve; });
  const ph = [];
  if (i === 0) ph.push(phHold(.09, (S, u) => { const e = Math.sin(u * PI / 2) * .16 * A.U; S.x = hx - c.dir.x * e; S.y = hy - c.dir.y * e; S.z = 8 * u; S.wPhi = ax + PI; S.wA = .14 * u; }));
  ph.push(phHold(i === 0 ? .1 : .15, (S, u) => {
    const e = i === 0 ? u * u : easeIO(u);
    S.x = lerp(x0, tx, e); S.y = lerp(y0, ty, e); S.wPhi = ax;
    if (i === 0) { S.z = 8 + 10 * u; S.wA = lerp(.14, .3, u); } else { S.z = 18 + 34 * Math.sin(PI * u); S.wA = .3; S.psi = TAU * e * c.side; }
  }, S => { x0 = S.x; y0 = S.y; }, S => { S.psi = 0; arrived(); }));
  ph.push({ update(S, dt) { c.jab *= Math.exp(-22 * dt); S.x = tx + c.dir.x * c.jab; S.y = ty + c.dir.y * c.jab; S.z = 18; S.wA = .3 + c.jab * .012; S.wPhi = ax; return c.released; } });
  if (last) ph.push(phHold(c.crit ? .16 : .06, S => { S.x = tx; S.y = ty; }),
    phHold(.32, (S, u) => { const e = 1 - easeOut(u); S.x = lerp(hx, bx, e); S.y = lerp(hy, by, e); S.z = 18 * e; S.wA = .3 * e; S.wPhi = ax; }, S => { bx = S.x; by = S.y; }, S => { S.wAv = .5; }),
    { update(S, dt) { stepWobble(S, dt, 5); return S.wA < .012 && S.wAv < .1; } });
  if (i === 0) A.rest();
  A.play(ph);
  // The art arrives in 0.19 s (0.15 from the first target); if its token is gone meanwhile, go on anyway.
  await Promise.race([arrive, fx.wait(700)]);
}

/**
 * The finisher on the tokens: `ctx` = { caster, targets } as this user sees them, `f` = the run's choices
 * ({ kind, F, crit, who, o: { D, B, C, F, sigil, conf } }).
 */
export async function attack(fx, ctx, f) {
  // Dual: the first two targets, in order; any other finisher has one.
  const list = (f.kind === "dual" ? ctx.targets.slice(0, 2) : ctx.targets.slice(0, 1)).filter(t => fx.canSee(t));
  if (!list.length || !canvas?.ready) return;
  if (!useLayersAt(elevOf(list[0]))) return;
  const tr = fx.tr, less = fx.less;
  engineState.shakeOn = !!tr.shake;
  const k = simScale();
  const caster = ctx.caster && fx.canSee(ctx.caster) && !list.includes(ctx.caster) ? ctx.caster : null;
  const R = { fx, f, k, tr, less, caster, casterElev: caster ? elevOf(caster) : 0, from: caster ? geo(caster, k) : null, A: null, coins: new Set(), sigils: [], layer: null, done: false };
  R.ctxs = list.map(t => mkCtx(R, t));
  // Stopped half-way (switched off, the canvas torn down, another signature): everyone's own drawing back, now.
  fx.cleanup(() => {
    for (const c of R.ctxs) c.released = true;
    if (R.done) return;
    freezeFor(0);
    for (const coin of R.coins) if (alive(coin)) coin.finish();
  });
  let tail = 0;
  if (less) {
    // Less motion: no lunge, no freeze; the mark is drawn, then the target flashes.
    for (let i = 0; i < R.ctxs.length; i++) {
      const c = R.ctxs[i];
      if (i) await fx.wait(150);
      fx.note(i ? "mark2" : "mark");
      await carve(R, c);
      fx.note(i ? "hit2" : "hit");
      tail = Math.max(tail, impactFin(R, c, false));
    }
  } else {
    if (caster && tr.on) { R.A = coinFor(caster); if (R.A) R.coins.add(R.A); }
    for (let i = 0; i < R.ctxs.length; i++) {
      const c = R.ctxs[i], last = i === R.ctxs.length - 1;
      fx.note(i ? "lunge2" : "lunge");
      await lunge(R, c, i, last);
      fx.note(i ? "mark2" : "mark");
      await carve(R, c);
      if (last) tail = Math.max(tail, await bigHit(R, c));
      else { // Dual's first hit: a blink of a pause, the throw, and on to the second
        fx.note("hit1");
        freezeFor(.05);
        await fx.wait(50);
        freezeFor(0);
        fx.note("throw1");
        tail = Math.max(tail, impactFin(R, c, false));
      }
    }
  }
  // Our own drawings (the sigil bursting, the hat, the blood) end with the run; the thrown art goes on by itself.
  R.done = true;
  await fx.wait(tail);
}
