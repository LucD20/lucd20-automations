import { TX } from "./textures.js";
import {
  TAU, PI, OBL, rnd, sgn, clamp, lerp, easeOut, easeIO, rotv, axisOf, hex3,
  P, ringFx, dust, sparks, mark, jag, bolt, shake,
  phHold, phAir, phStop, phReturn, phDead, stepWobble, showNumber, coinFor, activeCoin, useLayersOf, simScale
} from "./engine.js";

/**
 * Token Reactions: the twelve looks of the owner's chosen mockup (docs/mockups/token-reactions-fable.html),
 * one per kind of damage: how the token is thrown (its own throw, rolled afresh every hit: strike point, angle,
 * flips, spin, bounces), the burst around it and the mark it leaves on the ground. The numbers are the
 * mockup's tuning; lengths are in its units (a square = 90), `c.U` = the token's size, `c.I` = the strength.
 */

/* -------------------------------------------- */
/*  Which look for which damage type            */
/* -------------------------------------------- */

/** Damage types that share another type's look, with their own colour. Anything unknown: `default`. */
const ALIAS = {
  default: { look: "bludgeoning" },
  untyped: { look: "bludgeoning" },
  physical: { look: "bludgeoning" }, // D&D 4e
  damage: { look: "bludgeoning" }, // D&D 4e (untyped)
  bleed: { look: "slashing", col: 0xff3a3a },
  precision: { look: "piercing" },
  poison: { look: "acid", col: 0x8fe07a },
  spirit: { look: "vitality", col: 0xcfe0ff },
  holy: { look: "vitality" },
  unholy: { look: "void", col: 0xc04a6a },
  lightning: { look: "electricity" }, // D&D 4e / 5e names
  thunder: { look: "sonic" },
  psychic: { look: "mental" },
  radiant: { look: "vitality" },
  necrotic: { look: "void" },
  positive: { look: "vitality" }, // PF2e before the remaster
  negative: { look: "void" }
};

/** { look, col } for a damage type name (any system). */
export function lookOf(type) {
  const id = String(type ?? "").trim().toLowerCase();
  if (TYPES[id]) return { look: id, col: TYPES[id].col };
  const alias = ALIAS[id] ?? ALIAS.default;
  return { look: alias.look, col: alias.col ?? TYPES[alias.look].col };
}

/* -------------------------------------------- */
/*  Ground marks                                */
/* -------------------------------------------- */

const MARK = {
  bludgeoning(c, x, y, k = 1) {
    const R = c.R * k;
    mark(x, y, 7, g => {
      g.beginFill(0x070504, .5).drawCircle(0, 0, R * .32).endFill(); g.beginFill(0x070504, .25).drawCircle(rnd(-6, 6), rnd(-6, 6), R * .6).endFill();
      const n = 6 + (c.I * 3 | 0);
      for (let i = 0; i < n; i++) jag(g, 0, 0, i / n * TAU + rnd(-.3, .3), R * rnd(.7, 1.5) * (.6 + .4 * c.I), 4.5 * k, 0x050403, .9, 2);
    });
  },
  slashing(c, x, y) {
    const R = c.R, a = c.cutAng, n = c.crit ? 3 : 1;
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * R * .34, ox = x - Math.sin(a) * off, oy = y + Math.cos(a) * off, len = R * (1.9 + .8 * c.I), w = 5 + 3 * c.I;
      const lens = () => {
        const pts = [];
        for (let i = 0; i <= 10; i++) pts.push(lerp(-len / 2, len / 2, i / 10), -Math.sin(i / 10 * PI) * w + rnd(-1, 1));
        for (let i = 10; i >= 0; i--) pts.push(lerp(-len / 2, len / 2, i / 10), Math.sin(i / 10 * PI) * w * .5);
        return pts;
      };
      mark(ox, oy, 7, g => { g.rotation = a; g.beginFill(0x040303, .92).drawPolygon(lens()).endFill(); });
      mark(ox, oy, .5, g => { g.rotation = a; g.lineStyle(3, 0xffd9d0, 1).moveTo(-len / 2, 0).lineTo(len / 2, 0); g.lineStyle(9, 0xff4a3a, .35).moveTo(-len / 2, 0).lineTo(len / 2, 0); }, { add: true });
    }
  },
  piercing(c, x, y) {
    const R = c.R;
    mark(x, y, 7, g => {
      g.beginFill(0x030202, .95).drawCircle(0, 0, R * .13).endFill(); g.lineStyle(2, 0x8a8172, .4).drawCircle(0, 0, R * .17);
      for (let i = 0; i < 5; i++) jag(g, 0, 0, rnd(0, TAU), R * rnd(.3, .6), 2.2, 0x050403, .85, 0);
      // The groove of the thrust, along its direction.
      const ca = c.dir.x, sa = c.dir.y, pt = (px, py) => [px * ca - py * sa, px * sa + py * ca];
      g.beginFill(0x050403, .5).drawPolygon([...pt(0, -R * .07), ...pt(R * .9, 0), ...pt(0, R * .07)]).endFill();
    });
  },
  fire(c, x, y, k = 1) {
    const R = c.R * k;
    mark(x, y, 7, g => {
      for (let i = 0; i < 11; i++) { const a = rnd(0, TAU), d = rnd(0, R * .6); g.beginFill(0x030202, .24).drawCircle(Math.cos(a) * d, Math.sin(a) * d, R * rnd(.45, .85)).endFill(); }
      for (let i = 0; i < 9; i++) jag(g, 0, 0, rnd(0, TAU), R * rnd(.9, 1.5), 3, 0x030202, .35, 0);
    });
    mark(x, y, 2.8, g => {
      for (let i = 0; i < 26; i++) { const a = rnd(0, TAU), d = R * rnd(.4, 1.25); g.beginFill(i % 3 ? 0xff7a1a : 0xffd27a, rnd(.4, .9)).drawCircle(Math.cos(a) * d, Math.sin(a) * d, rnd(1.5, 4) * k).endFill(); }
      g.lineStyle(7, 0xff5a10, .22).drawCircle(0, 0, R * 1.05);
    }, { add: true, fade: 2.2 });
  },
  cold(c, x, y, k = 1) {
    const R = c.R * k;
    mark(x, y, 6.5, g => {
      const pts = [];
      for (let i = 0; i < 16; i++) { const a = i / 16 * TAU, r = R * rnd(.85, 1.5); pts.push(Math.cos(a) * r, Math.sin(a) * r); }
      g.beginFill(0xbfe6ff, .2).drawPolygon(pts).endFill(); g.beginFill(0xe8f6ff, .16).drawCircle(0, 0, R * .7).endFill();
      for (let i = 0; i < 9; i++) {
        const a = rnd(0, TAU), len = R * rnd(.7, 1.4);
        g.lineStyle(2, 0xf0faff, .6).moveTo(0, 0).lineTo(Math.cos(a) * len, Math.sin(a) * len);
        for (let j = 1; j < 4; j++) for (const s of [-1, 1]) { const bx = Math.cos(a) * len * j / 4, by = Math.sin(a) * len * j / 4; g.lineStyle(1.3, 0xf0faff, .5).moveTo(bx, by).lineTo(bx + Math.cos(a + s * 1) * len * .16, by + Math.sin(a + s * 1) * len * .16); }
      }
      g.lineStyle(0);
    });
  },
  electricity(c, x, y) {
    const R = c.R;
    mark(x, y, 6.5, g => { for (let i = 0; i < 6; i++) jag(g, 0, 0, i / 6 * TAU + rnd(-.4, .4), R * rnd(1, 1.8), 3.2, 0x06060c, .85, 3); g.beginFill(0x06060c, .4).drawCircle(0, 0, R * .3).endFill(); });
    mark(x, y, .7, g => { for (let i = 0; i < 7; i++) jag(g, 0, 0, rnd(0, TAU), R * rnd(1, 1.9), 3, 0xa8d8ff, .95, 3); }, { add: true, fade: .6 });
  },
  acid(c, x, y, k = 1) {
    const R = c.R * k, blobs = [];
    for (let i = 0; i < 8; i++) { const a = rnd(0, TAU), d = rnd(0, R * .75); blobs.push([Math.cos(a) * d, Math.sin(a) * d, R * rnd(.25, .6)]); }
    mark(x, y, 6.5, g => {
      for (const b of blobs) g.beginFill(0x2f4a0c, .55).drawCircle(b[0], b[1], b[2] + 4).endFill();
      for (const b of blobs) g.beginFill(0x7fbf22, .6).drawCircle(b[0], b[1], b[2]).endFill();
      for (const b of blobs) g.beginFill(0xd2ff7a, .3).drawEllipse(b[0] - b[2] * .25, b[1] - b[2] * .3, b[2] * .45, b[2] * .25).endFill();
    }, { upd: (g, t, dt, m) => {
      // It keeps bubbling for a while.
      if (m.t < m.life - 1.5 && Math.random() < dt * 14 * k) {
        const b = blobs[Math.random() * blobs.length | 0], px = x + b[0] + rnd(-b[2], b[2]) * .6, py = y + b[1] + rnd(-b[2], b[2]) * .6;
        P(TX.ring, px, py, 0, { s0: 3, s1: rnd(12, 22), life: .4, tint: 0xd8ff8a, add: true, below: true, pw: 1 });
        if (Math.random() < .4) P(TX.smoke, px, py, 4, { vz: rnd(40, 90), life: 1, s0: 16, s1: 50, tint: 0xb8e060, a: .2, drag: 1 });
      }
    } });
  },
  sonic(c, x, y, k = 1) {
    const R = c.R;
    mark(x, y, 1.5 * (.6 + .4 * k), () => { }, { add: true, fade: .2, upd: (g, t) => {
      g.clear();
      for (let i = 0; i < 3; i++) { const tt = t - i * .16; if (tt <= 0) continue; const a = Math.max(0, 1 - tt / 1); g.lineStyle(6 * a + 1, 0xbfeaff, a * .8 * k).drawEllipse(0, 0, R * (.6 + tt * 3.4) * k, R * (.6 + tt * 3.4) * k * .92); }
    } });
  },
  force(c, x, y, k = 1) {
    const R = c.R * k, a = Math.atan2(c.dir.y, c.dir.x);
    mark(x, y, 2.4, g => {
      g.rotation = a; g.lineStyle(4.5, 0xa890ff, .9).drawCircle(0, 0, R * 1.02); g.lineStyle(1.5, 0xffffff, .8).drawCircle(0, 0, R * .88);
      for (let i = 0; i < 3; i++) { const o = R * (1.25 + i * .28); g.lineStyle(4 - i, 0xc8b8ff, .8 - i * .2).moveTo(o - R * .2, -R * .3).lineTo(o, 0).lineTo(o - R * .2, R * .3); }
    }, { add: true, upd: (g, t) => g.scale.set(.8 + .3 * easeOut(Math.min(1, t / .3))) });
    mark(x, y, 5, g => g.lineStyle(3, 0x060410, .5).drawCircle(0, 0, R * 1.02));
  },
  mental(c, x, y) {
    const R = c.R;
    mark(x, y, 3.4, g => {
      for (const [o, col, w] of [[0, 0xff7ad9, 3.5], [PI, 0x9a6bff, 2.5]]) {
        g.lineStyle(w, col, .8);
        for (let i = 0; i <= 60; i++) { const th = i / 60 * 5 * PI, r = R * 1.35 * i / 60, px = Math.cos(th + o) * r, py = Math.sin(th + o) * r * .92; i ? g.lineTo(px, py) : g.moveTo(px, py); }
      }
    }, { add: true, upd: (g, t, dt) => { g.rotation -= dt * 2.2; } });
  },
  void(c, x, y) {
    const R = c.R, life = 2.6, sc = (g, t) => g.scale.set(Math.max(.01, easeOut(Math.min(1, t / .4)) * (t > life - .6 ? Math.pow((life - t) / .6, 2) : 1)));
    mark(x, y, life, g => { g.beginFill(0x000000, .95).drawCircle(0, 0, R * 1.12).endFill(); }, { fade: .15, upd: sc });
    mark(x, y, life, g => {
      g.lineStyle(6, 0x7a3dff, .9).drawCircle(0, 0, R * 1.13); g.lineStyle(2, 0xe2c8ff, .9).drawCircle(0, 0, R * 1.1);
      for (let i = 0; i < 5; i++) { const a0 = i / 5 * TAU; g.lineStyle(2.5, 0xa070ff, .6).arc(0, 0, R * (1.3 + i * .05), a0, a0 + .8); g.moveTo(0, 0); }
    }, { add: true, fade: .15, upd: (g, t, dt) => { sc(g, t); g.rotation += dt * 5; } });
  },
  vitality(c, x, y) {
    const R = c.R;
    mark(x, y, 3.4, g => {
      g.lineStyle(4, 0xffe08a, .9).drawCircle(0, 0, R * 1.28); g.lineStyle(1.8, 0xfff6d0, .85).drawCircle(0, 0, R * 1.08);
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; g.lineStyle(i % 2 ? 2 : 3.5, 0xffe08a, .85).moveTo(Math.cos(a) * R * 1.08, Math.sin(a) * R * 1.08).lineTo(Math.cos(a) * R * (i % 2 ? 1.28 : 1.6), Math.sin(a) * R * (i % 2 ? 1.28 : 1.6)); }
      g.lineStyle(2, 0xfff0b0, .7);
      for (let i = 0; i <= 8; i++) { const a = i * 3 / 8 * TAU, px = Math.cos(a) * R * 1.05, py = Math.sin(a) * R * 1.05; i ? g.lineTo(px, py) : g.moveTo(px, py); }
    }, { add: true, upd: (g, t, dt) => { g.rotation += dt * .7; } });
  }
};

/* -------------------------------------------- */
/*  The twelve reactions                        */
/* -------------------------------------------- */

const glowSet = (S, col, amt, damp) => { S.glowCol = hex3(col); S.glow = amt; S.glowDamp = damp; };
const landDust = (c, S, sp, n = 5) => { if (sp > c.U * 1.5) dust(S.x, S.y + c.R * .3, n, 60 + sp * .12); };

/**
 * Per type: `col` (flash and number), `stop` (the hit-stop: duration, squash, push), `burst(c)` (particles at the
 * blow) and `build(c)` (the phases of the throw).
 */
export const TYPES = {
  // A heavy lob away from the blow: rubble, dust, a crater where it stood and a smaller one where it lands.
  bludgeoning: { col: 0xe8d8b8, stop: { dur: .075, sq: .4, push: .11 },
    burst(c) {
      for (let i = 0; i < 9 + c.I * 7; i++) {
        const a = Math.atan2(c.dir.y, c.dir.x) + rnd(-1.5, 1.5), v = rnd(120, 520) * c.I;
        P(TX.rock, c.ix, c.iy, 10, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rnd(200, 620), g: 1900, life: rnd(.7, 1.3), s0: rnd(5, 13), tint: [0x8a7f70, 0x6a6258, 0xa39683][i % 3], vr: rnd(-14, 14), bounce: true, pw: 4 });
      }
      dust(c.x, c.y, 9, 190 * c.I); P(TX.star, c.ix, c.iy, 30, { s0: 60, s1: 200 * c.I, life: .18, add: true, tint: 0xfff0d0, rot: rnd(0, 1) }); ringFx(c.x, c.y, c.R, c.R * 3.4, .32, 0xd8c8a8, { a: .5 }); shake(7 * c.I);
    },
    build(c) {
      const a = rotv(c.dir, rnd(-.28, .28)), sp = rnd(2.4, 3.4) * c.I * c.U, flips = (c.crit ? 1 : 0) + (c.I > 1.05 || Math.random() < .4 ? 1 : 0);
      return [phAir(c, { main: true, vx: a.x * sp, vy: a.y * sp, vz: rnd(6.4, 7.8) * Math.pow(c.I, .6) * c.U, g: 27 * c.U, flips, tiltMax: rnd(.5, .95), axis: axisOf(a, true) + rnd(-.35, .35) + c.off * .5, yaw: c.off * rnd(2, 5), e: .3, fb: .45, fs: 7, wDamp: 2.5, wKick: 1.5, maxB: 2,
        onLand(S, sp2, i, k) { dust(S.x, S.y + c.R * .3, 8 - i * 3, 150 * k + 60); if (i === 0) { shake(9 * k * c.I); MARK.bludgeoning(c, S.x, S.y, .55); ringFx(S.x, S.y, c.R, c.R * 3, .3, 0xd8c8a8, { a: .4 }); } } })];
    } },

  // Spun out sideways along the cut, skidding with sparks; a gash on the ground.
  slashing: { col: 0xff6a5a, stop: { dur: .035, sq: .12, push: .04 },
    burst(c) {
      const a = c.cutAng;
      P(TX.spark, c.x, c.y, 30, { s0: 26 + 14 * c.I, s1: 4, ax: c.R * .09, life: .2, add: true, tint: 0xfff0ea, rot: a, pw: 1 });
      P(TX.spark, c.x, c.y, 30, { s0: 60, s1: 10, ax: c.R * .05, life: .28, add: true, tint: 0xff4a3a, rot: a, a: .6 });
      sparks(c.x, c.y, 20, 12 * c.I, 0xffb0a0, 620, { ang: a + (c.side > 0 ? 0 : PI), spread: .35 }); sparks(c.x, c.y, 20, 6, 0xfff0e0, 420, { ang: a + (c.side > 0 ? PI : 0), spread: .3 }); shake(3 * c.I);
    },
    build(c) {
      const cut = { x: Math.cos(c.cutAng) * c.side, y: Math.sin(c.cutAng) * c.side }, sp = rnd(4.4, 5.6) * c.I * c.U;
      let sk = 0;
      return [phAir(c, { main: true, vx: cut.x * sp, vy: cut.y * sp, vz: rnd(1.8, 3.2) * Math.sqrt(c.I) * c.U, flips: c.crit ? 1 : 0, tiltMax: rnd(.3, .6) * sgn(), axis: Math.atan2(cut.y, cut.x), prec: c.side * rnd(2, 5),
        yaw: c.side * rnd(13, 21) * c.I, e: .22, fb: .82, fs: 2.3, cf: 1.2, wDamp: 1.5, wKick: 1, maxB: 2, yawFric: 2.2,
        onLand(S, v) { landDust(c, S, v, 4); sparks(S.x, S.y, 4, 6, 0xffc8a0, 300); },
        during(S, dt, air) { if (!air) { const v = Math.hypot(S.vx, S.vy); sk += dt; if (v > c.U * 1.1 && sk > .03) { sk = 0; sparks(S.x + rnd(-1, 1) * c.R * .7, S.y + rnd(-1, 1) * c.R * .7, 2, 1, 0xffc890, 240, { ang: Math.atan2(-S.vy, -S.vx), spread: .6 }); } } } })];
    } },

  // Struck on the near edge: it flips up on the spot (or just stands on its rim), a hole and a groove under it.
  piercing: { col: 0xf0f0ff, stop: { dur: .05, sq: .16, push: .17 },
    burst(c) {
      const a = Math.atan2(c.dir.y, c.dir.x);
      for (let i = 0; i < 7; i++) {
        const v = rnd(900, 1700);
        P(TX.spark, c.x + rnd(-8, 8), c.y + rnd(-8, 8), 24, { vx: Math.cos(a + rnd(-.07, .07)) * v, vy: Math.sin(a + rnd(-.07, .07)) * v, drag: 3.5, life: rnd(.2, .42), s0: rnd(4, 7), ax: rnd(5, 9), stretch: true, add: true, tint: 0xf0f0ff });
      }
      P(TX.star, c.ix, c.iy, 26, { s0: 30, s1: 110, life: .14, add: true }); sparks(c.ix, c.iy, 20, 5, 0xffffff, 330, { ang: a + PI, spread: .7 }); shake(2.5 * c.I);
    },
    build(c) {
      const stand = !c.crit && Math.random() < .3, flips = stand ? 0 : 1 + (c.I > .95 && Math.random() < .7 ? 1 : 0) + (c.crit ? 1 : 0), sp = rnd(.6, 1.2) * c.I * c.U;
      return [phAir(c, { main: true, vx: c.dir.x * sp, vy: c.dir.y * sp, vz: (stand ? 3.8 : 3.4 + 1.3 * flips) * Math.pow(c.I, .4) * c.U, g: 24 * c.U, flips, tiltMax: 1.28, axis: axisOf(c.dir, false) + c.off * .25, yaw: c.off * 3,
        e: .46, fb: .45, fs: 9, wDamp: 5, wKick: .8, maxB: 3, onLand(S, v) { landDust(c, S, v, 3); } })];
    } },

  // Lifted on the heat, tumbling lazily and trailing embers and smoke; scorch marks.
  fire: { col: 0xff8a2a, stop: { dur: .05, sq: .1, push: .05, init: S => glowSet(S, 0xff7a20, .85, 1.1) },
    burst(c) {
      for (let i = 0; i < 20 * c.I; i++) {
        const a = rnd(0, TAU), v = rnd(60, 380) * c.I;
        P(TX.dot, c.x + rnd(-1, 1) * c.R * .5, c.y + rnd(-1, 1) * c.R * .5, rnd(5, 40), { vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rnd(150, 520), g: -120, drag: 2.2, life: rnd(.5, 1.3), s0: rnd(6, 16), s1: 2, add: true, tint: [0xff5a10, 0xffa030, 0xffe080][i % 3] });
      }
      for (let i = 0; i < 7; i++) P(TX.smoke, c.x + rnd(-1, 1) * c.R * .5, c.y + rnd(-1, 1) * c.R * .4, 20, { vx: rnd(-50, 50), vy: rnd(-30, 30), vz: rnd(90, 220), drag: 1.2, life: rnd(.8, 1.5), s0: 40, s1: 150, add: i < 3, tint: i < 3 ? 0xff6a10 : 0x2a2420, a: i < 3 ? .7 : .4, vr: rnd(-1, 1) });
      shake(3 * c.I);
    },
    build(c) {
      const a = rotv(c.dir, rnd(-.5, .5)), sp = rnd(1.9, 2.8) * c.I * c.U, lazy = !c.crit && Math.random() < .3;
      let em = 0;
      return [phAir(c, { main: true, vx: a.x * sp, vy: a.y * sp, vz: rnd(4.6, 5.6) * Math.sqrt(c.I) * c.U, g: 10 * c.U, drag: .9, flips: lazy ? 0 : 1 + (c.crit ? 1 : 0), tiltMax: rnd(.7, 1.1), axis: axisOf(a, true) + rnd(-.7, .7), prec: rnd(1.5, 3.5) * sgn(), yaw: rnd(-4, 4),
        e: .25, fb: .5, fs: 5, wDamp: 2.4, maxB: 2,
        onLand(S, v, i) {
          landDust(c, S, v, 3);
          if (i === 0) {
            MARK.fire(c, S.x, S.y, .5);
            for (let k = 0; k < 10; k++) { const an = rnd(0, TAU); P(TX.dot, S.x, S.y, 4, { vx: Math.cos(an) * rnd(80, 260), vy: Math.sin(an) * rnd(80, 260), vz: rnd(80, 300), g: 500, life: rnd(.4, .9), s0: rnd(4, 9), s1: 1, add: true, tint: 0xff9030 }); }
          }
        },
        during(S, dt, air) {
          em += dt;
          if (air && em > .028) {
            em = 0;
            P(TX.dot, S.x + rnd(-1, 1) * c.R * .6, S.y + rnd(-1, 1) * c.R * .4, S.z + rnd(-10, 10), { vz: rnd(20, 120), vx: rnd(-40, 40), drag: 1, life: rnd(.4, .9), s0: rnd(8, 20), s1: 2, add: true, tint: Math.random() < .5 ? 0xff6a10 : 0xffb040 });
            if (Math.random() < .3) P(TX.smoke, S.x, S.y, S.z, { vz: 60, life: .9, s0: 30, s1: 90, tint: 0x2a2420, a: .3, drag: 1 });
          }
        } })];
    } },

  // Frozen stiff: it slides flat across the floor leaving a frost trail, shivers, then the ice shatters.
  cold: { col: 0x9fe0ff, stop: { dur: .1, sq: 0, push: .05, init: S => glowSet(S, 0x7fc8ff, .7, .5), hold: (S, u) => { S.frost = u; } },
    burst(c) {
      for (let i = 0; i < 12; i++) P(TX.smoke, c.x + rnd(-1, 1) * c.R, c.y + rnd(-1, 1) * c.R * .8, 6, { vx: rnd(-80, 80) + c.dir.x * 120, vy: rnd(-60, 60) + c.dir.y * 120, vz: rnd(0, 40), drag: 2, life: rnd(.7, 1.4), s0: 40, s1: 130, tint: 0xd8f0ff, a: .3, below: i % 2 === 0 });
      for (let i = 0; i < 10 * c.I; i++) { const a = rnd(0, TAU), v = rnd(100, 380); P(TX.shard, c.ix, c.iy, 20, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rnd(100, 380), g: 1700, life: rnd(.5, .9), s0: rnd(5, 12), tint: 0xdff4ff, vr: rnd(-12, 12), bounce: true, add: true, a: .9 }); }
      shake(2 * c.I);
    },
    build(c) {
      const sp = rnd(3.6, 4.6) * c.I * c.U;
      let tr = 0;
      const shatter = S => {
        S.frost = 0; S.flash = .9; S.flashCol = 0xffffff; S.glow = 0; S.sclV = 2.2;
        for (let i = 0; i < 22; i++) {
          const a = rnd(0, TAU), v = rnd(120, 520);
          P(TX.shard, S.x + Math.cos(a) * c.R * .5, S.y + Math.sin(a) * c.R * .5, 14, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rnd(120, 480), g: 1800, life: rnd(.5, 1), s0: rnd(6, 16), tint: 0xe6f6ff, vr: rnd(-14, 14), bounce: true, add: true, a: .9 });
        }
        ringFx(S.x, S.y, c.R, c.R * 3, .3, 0xbfe8ff);
      };
      return [phAir(c, { main: true, vx: c.dir.x * sp, vy: c.dir.y * sp, vz: c.crit ? 4.6 * c.U : 0, g: 26 * c.U, stiff: true, e: .2, fb: c.crit ? .95 : 1, fs: .5, cf: 3.2, maxB: 1,
        onLand(S, v) { if (v > c.U) { dust(S.x, S.y, 6, 120, 0xd8f0ff, .3); MARK.cold(c, S.x, S.y, .6); shake(5); } },
        during(S, dt, air) {
          tr += dt;
          if (!air && tr > .05 && Math.hypot(S.vx, S.vy) > c.U * .5) {
            tr = 0;
            const x = S.x, y = S.y;
            mark(x, y, 4.5, g => { g.beginFill(0xcfeeff, .13).drawCircle(0, 0, c.R * .8).endFill(); for (let i = 0; i < 2; i++) { const a = rnd(0, TAU); g.lineStyle(1.3, 0xf0faff, .4).moveTo(0, 0).lineTo(Math.cos(a) * c.R * .8, Math.sin(a) * c.R * .8); } });
            P(TX.smoke, x, y, 2, { vz: 20, life: .8, s0: 30, s1: 80, tint: 0xd8f0ff, a: .2, below: true });
          }
        } }),
      phHold(.55, (S, u, dt, t) => { S.jx = Math.sin(t * 75) * 4.5 * (1 - u * .6); S.frost = 1; S.glow = .6; }, null, S => { S.jx = 0; shatter(S); }),
      phHold(.12)];
    } },

  // Held and jolted by bolts (from the attacker, or from above), then it leaps straight up, arcing to the ground.
  electricity: { col: 0xfff48a, stop: { dur: .03, sq: 0, push: 0 },
    burst(c) { sparks(c.x, c.y, 24, 16 * c.I, 0xcfe8ff, 760, { g: 900, up: .8 }); shake(4 * c.I); },
    build(c) {
      let jt = 1, arc = 0;
      const zap = S => {
        const from = c.atkPos() ?? { x: S.x + rnd(-.6, .6) * c.U, y: S.y - c.U * 5 };
        bolt(from.x, from.y, S.x + rnd(-1, 1) * c.R * .5, S.y + rnd(-1, 1) * c.R * .5 - c.tok.zc * OBL, 0x8fc8ff, 3.2);
        S.flash = rnd(.5, 1); S.flashCol = Math.random() < .5 ? 0xffffff : 0xfff27a;
      };
      const ph = [phHold(.27 + (c.crit ? .14 : 0), (S, u, dt) => {
        jt += dt;
        if (jt > .042) { jt = 0; S.jx = rnd(-.08, .08) * c.U; S.jy = rnd(-.08, .08) * c.U; S.wA = rnd(.1, .38); S.wPhi = rnd(0, TAU); S.psi = rnd(-.12, .12); zap(S); sparks(S.x, S.y, 20, 2, 0xfff27a, 500, { g: 900 }); }
      }, null, S => { S.jx = S.jy = 0; S.wA = 0; S.psi = 0; shake(6 * c.I); ringFx(S.x, S.y, c.R, c.R * 3.2, .25, 0xa8d8ff); })];
      const a = rnd(0, TAU), sp = rnd(.1, .55) * c.I * c.U;
      ph.push(phAir(c, { main: true, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rnd(8.4, 10) * Math.pow(c.I, .45) * c.U, g: 23 * c.U, flips: 1 + (c.I > .8 ? 1 : 0) + (c.crit ? 1 : 0), axis: rnd(0, TAU), prec: rnd(2, 6) * sgn(), yaw: rnd(6, 13) * sgn(),
        e: .43, fb: .5, fs: 8, wDamp: 2.3, maxB: 3, onLand(S, v) { landDust(c, S, v, 4); sparks(S.x, S.y, 4, 6, 0xcfe8ff, 380, { g: 900 }); },
        during(S, dt, air) {
          arc += dt;
          if (air && arc > .09 && S.z > c.U * .4) {
            arc = rnd(-.05, .03);
            const gx = S.x + rnd(-1, 1) * c.R * 1.3, gy = S.y + rnd(-1, 1) * c.R * .8;
            bolt(S.x, S.y - S.z * OBL, gx, gy, 0x8fc8ff, 2, .07); sparks(gx, gy, 2, 2, 0xfff27a, 240, { g: 900 }); S.flash = Math.max(S.flash, .35); S.flashCol = 0xcfe8ff;
          }
        } }));
      // Aftershocks: a twitch or two once it has landed (not when it dropped to 0 HP).
      for (let i = 0, n = c.kill ? 0 : 1 + (Math.random() < .6 ? 1 : 0); i < n; i++) {
        const ta = rnd(0, TAU);
        ph.push(phHold(rnd(.07, .24)), phAir(c, { vx: Math.cos(ta) * rnd(.2, .7) * c.U, vy: Math.sin(ta) * rnd(.2, .7) * c.U, vz: rnd(1.7, 2.8) * c.U, flips: 0, tiltMax: rnd(.22, .45), axis: rnd(0, TAU), yaw: rnd(-6, 6), e: .2, maxB: 1, wDamp: 4.5, fs: 10,
          pre(S) { S.flash = .6; S.flashCol = 0xfff27a; sparks(S.x, S.y, 12, 6, 0xfff27a, 420, { g: 900 }); bolt(S.x, S.y, S.x + rnd(-1, 1) * c.R * 1.6, S.y + rnd(-1, 1) * c.R * 1.2, 0x8fc8ff, 2, .08); } }));
      }
      return ph;
    } },

  // Soft and wobbling like jelly: a low, slow lob, dripping; it lands with a splat in a bubbling pool.
  acid: { col: 0xa8f040, stop: { dur: .065, sq: .32, push: .06, init: S => { glowSet(S, 0x9be03a, .7, .9); S.qK = 95; S.qC = 5; } },
    burst(c) {
      for (let i = 0; i < 18 * c.I; i++) {
        const a = Math.atan2(c.dir.y, c.dir.x) + rnd(-1.7, 1.7), v = rnd(80, 420);
        P(TX.dot, c.ix, c.iy, 20, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rnd(120, 460), g: 1500, life: rnd(.7, 1.6), s0: rnd(7, 16), s1: rnd(10, 20), tint: [0x9be03a, 0x6fb020, 0xd2ff7a][i % 3], pw: 5 });
      }
      for (let i = 0; i < 5; i++) P(TX.smoke, c.x + rnd(-1, 1) * c.R * .6, c.y, 20, { vz: rnd(60, 140), vx: rnd(-30, 30), life: 1.3, s0: 40, s1: 120, tint: 0xb8e060, a: .25, drag: 1 });
    },
    build(c) {
      const a = rotv(c.dir, rnd(-.7, .7)), sp = rnd(1.3, 2) * c.I * c.U;
      let dr = 0;
      return [phAir(c, { main: true, vx: a.x * sp, vy: a.y * sp, vz: rnd(2.9, 3.7) * Math.sqrt(c.I) * c.U, g: 13 * c.U, flips: c.crit ? 1 : 0, tiltMax: rnd(.35, .7) * sgn(), axis: axisOf(a, true) + rnd(-.6, .6), prec: rnd(-2.5, 2.5), yaw: rnd(-2.5, 2.5),
        e: .12, fb: .75, fs: 1.9, cf: 1.1, wDamp: 2, wKick: .8, maxB: 1, pre(S) { S.jel = .17 * Math.min(1.3, c.I); S.jelDamp = 1.5; },
        onLand(S, v, i, k) {
          if (i === 0) {
            S.q = -.25 * k; S.qv = 9 * k; S.qDir = rnd(0, PI); S.jel = Math.max(S.jel, .12); MARK.acid(c, S.x, S.y, .55);
            for (let j = 0; j < 14; j++) { const an = rnd(0, TAU), vv = rnd(100, 340); P(TX.dot, S.x + Math.cos(an) * c.R * .7, S.y + Math.sin(an) * c.R * .7, 4, { vx: Math.cos(an) * vv, vy: Math.sin(an) * vv, vz: rnd(80, 300), g: 1500, life: rnd(.6, 1.3), s0: rnd(6, 13), tint: 0x9be03a, pw: 5 }); }
          }
        },
        during(S, dt) { dr += dt; if (dr > .06) { dr = 0; P(TX.dot, S.x + rnd(-1, 1) * c.R * .7, S.y + rnd(-1, 1) * c.R * .5, S.z, { g: 1300, life: rnd(.8, 1.4), s0: rnd(5, 10), tint: 0x8fd030, pw: 5 }); } } })];
    } },

  // Rattled: a run of short hops, each smaller, rings spreading from every landing, the art rippling.
  sonic: { col: 0xbfeaff, stop: { dur: .04, sq: .1, push: .03 },
    burst(c) { for (let i = 0; i < 3; i++) P(TX.ring, c.ix, c.iy, 30, { s0: 20, s1: c.R * (3 + i * 1.6), life: .3 + i * .1, tint: 0xdff4ff, add: true, rot: 0, pw: 1, a: .7 }); dust(c.x, c.y, 6, 150); shake(5 * c.I); },
    build(c) {
      const n = 4 + (c.I > 1 ? 1 : 0) + (c.crit ? 1 : 0), ph = [];
      for (let k = 0; k < n; k++) {
        const a = rotv(c.dir, rnd(-.8, .8)), big = c.crit && k === 0, sp = rnd(.35, .7) * c.I * c.U * (k === 0 ? 1.5 : 1);
        ph.push(phAir(c, { main: k === n - 1, vx: a.x * sp, vy: a.y * sp, vz: (big ? 6.4 : 3.9 * Math.pow(.74, k) * Math.sqrt(c.I)) * c.U, g: 32 * c.U, flips: big ? 1 : 0, tiltMax: rnd(.2, .52) * Math.pow(.86, k) * sgn(), axis: rnd(0, TAU), yaw: rnd(-3.5, 3.5),
          e: 0, maxB: 0, noSettle: k < n - 1, fs: 20, wDamp: 3.2, wKick: .6, pre: k === 0 ? S => { S.rip = .085 * Math.min(1.3, c.I); S.ripDir = Math.atan2(c.dir.y, c.dir.x); } : null,
          onLand(S, v, i, kk) { S.rip = Math.max(S.rip, .05); MARK.sonic(c, S.x, S.y, .35 + kk * .5); dust(S.x, S.y + c.R * .3, 2, 70); shake(2.2 * kk * c.I + 1); } }));
      }
      return ph;
    } },

  // Bent by the push, then shot far and flat, skipping like a stone; a ring where it stood and at each skip.
  force: { col: 0xb8a0ff, stop: { dur: .08, sq: -.24, push: .08, init: (S) => { S.bend = -.4; S.bendV = 0; }, hold: (S) => { S.bend = -.4; S.bendV = 0; } },
    burst(c) {
      const a = Math.atan2(c.dir.y, c.dir.x);
      P(TX.ring, c.ix, c.iy, 30, { s0: 30, s1: c.R * 3.6, life: .26, tint: 0xd8c8ff, add: true, rot: 0, pw: 1 });
      for (let i = 0; i < 10; i++) { const o = rnd(-1, 1) * c.R; P(TX.spark, c.x - Math.sin(a) * o, c.y + Math.cos(a) * o, 20, { vx: c.dir.x * rnd(700, 1500), vy: c.dir.y * rnd(700, 1500), drag: 3, life: rnd(.2, .4), s0: rnd(3, 6), ax: rnd(6, 11), stretch: true, add: true, tint: 0xb8a0ff }); }
      shake(5 * c.I);
    },
    build(c) {
      const a = rotv(c.dir, rnd(-.07, .07)), sp = rnd(6, 7.4) * c.I * c.U;
      return [phAir(c, { main: true, vx: a.x * sp, vy: a.y * sp, vz: rnd(1.9, 2.7) * Math.pow(c.I, .3) * c.U, flips: c.crit ? 1 : 0, tiltMax: rnd(.2, .36), axis: axisOf(a, c.crit), yaw: c.off * 2.5, e: .62, fb: .82, fs: 5, wDamp: 3.2, wKick: .55, maxB: 4,
        pre(S) { S.bendDir = Math.atan2(c.dir.y, c.dir.x); S.bendV = 5; },
        onLand(S, v, i, k) { ringFx(S.x, S.y, c.R * .8, c.R * (2 + k * 2), .3, 0xb8a0ff, { a: .8 }); mark(S.x, S.y, 3, g => g.lineStyle(2.5, 0xa890ff, .7).drawEllipse(0, 0, c.R * .9, c.R * .85), { add: true }); landDust(c, S, v, 3); shake(2 * k); } })];
    } },

  // It floats up, swaying in a figure of eight with ghost images, a spiral under it, then drops.
  mental: { col: 0xff8ae0, stop: { dur: .05, sq: 0, push: 0, init: S => glowSet(S, 0xd070ff, .55, .5) },
    burst(c) { P(TX.ring, c.x, c.y, 40, { s0: c.R * 3, s1: c.R * .6, life: .35, tint: 0xff8ae0, add: true, rot: 0, fi: .5, pw: 1, a: .7 }); },
    build(c) {
      let x0, y0, st = 0;
      const dur = 1.2 + (c.crit ? .4 : 0), h = rnd(.7, .95) * Math.sqrt(c.I) * c.U, f = rnd(3.6, 4.8), ph0 = rnd(0, TAU), fa = rnd(0, TAU);
      return [phHold(dur, (S, u, dt, t) => {
        const env = Math.sqrt(Math.sin(PI * Math.min(1, u * 1.02)));
        S.z = h * easeOut(Math.min(1, u * 2.4)) + Math.sin(t * 5) * .04 * c.U;
        S.x = x0 + Math.sin(t * f + ph0) * .24 * c.U * env * c.side; S.y = y0 + Math.sin(t * f * 2 + ph0) * .11 * c.U * env;
        S.wA = .34 * env * (1 + .3 * Math.sin(t * 3)) * Math.min(1.2, c.I); S.wPhi += S.wDir * 5.5 * dt; S.psi = Math.sin(t * 3.1) * .4 * env; S.ghost = env; S.glow = .5;
        if (c.crit) { S.phi = fa; S.theta = TAU * easeIO(clamp((u - .2) / .6, 0, 1)); }
        st += dt;
        if (st > .09) { st = 0; const a = t * 7; for (const o of [0, PI]) P(Math.random() < .6 ? TX.star : TX.ring, S.x + Math.cos(a + o) * c.R * .95, S.y + Math.sin(a + o) * c.R * .3, S.z + c.R * 1.1, { vz: 30, life: .55, s0: rnd(12, 22), s1: 4, add: true, tint: o ? 0xff8ae0 : 0xa880ff, vr: 4 }); }
      }, S => { x0 = S.x; y0 = S.y; }, S => { S.theta = 0; }),
      phAir(c, { main: true, g: 21 * c.U, e: .3, fb: .4, fs: 8, wDamp: 2.3, wKick: 1.1, maxB: 2, yawFric: 6, onLand(S, v) { landDust(c, S, v, 4); } })];
    } },

  // Sucked inwards, small and dark, spinning over a black hole; then spat out, tumbling.
  void: { col: 0x9a60ff, stop: { dur: .04, sq: 0, push: 0 },
    burst() { },
    build(c) {
      let x0, y0, em = 0;
      const a = rotv(c.dir, rnd(-1.3, 1.3)), sp = rnd(2.2, 3.2) * c.I * c.U;
      return [phHold(.5 + (c.crit ? .12 : 0), (S, u, dt) => {
        const e = u * u;
        S.scl = 1 - .5 * e; S.sclV = 0; S.dark = .8 * e; S.psiRate = S.wDir * 24 * e; S.psi += S.psiRate * dt; S.x = x0 - c.dir.x * .2 * c.U * e; S.y = y0 - c.dir.y * .2 * c.U * e;
        S.q = .12 * Math.sin(u * 30) * e; S.qDir = S.psi; em += dt;
        if (em > .02) {
          em = 0;
          const an = rnd(0, TAU), r = c.R * rnd(1.5, 2.3);
          P(TX.dot, S.x + Math.cos(an) * r, S.y + Math.sin(an) * r, 10, { vx: -Math.cos(an) * r * 3 - Math.sin(an) * 240, vy: -Math.sin(an) * r * 3 + Math.cos(an) * 240, life: .32, s0: rnd(6, 13), s1: 2, add: true, tint: Math.random() < .5 ? 0x7a3dff : 0xd0a8ff, fi: .3 });
        }
      }, S => { x0 = S.x; y0 = S.y; }, S => {
        S.sclV = 8; S.flash = 1; S.flashCol = 0xb080ff; S.q = 0; shake(7 * c.I); ringFx(S.x, S.y, c.R * .4, c.R * 4, .35, 0x9a60ff);
        for (let i = 0; i < 18; i++) { const an = rnd(0, TAU), v = rnd(200, 620); P(TX.dot, S.x, S.y, 20, { vx: Math.cos(an) * v, vy: Math.sin(an) * v, vz: rnd(100, 500), g: 700, drag: 1.5, life: rnd(.4, .9), s0: rnd(6, 14), s1: 2, add: true, tint: i % 2 ? 0x7a3dff : 0xe2c8ff }); }
      }),
      phAir(c, { main: true, vx: a.x * sp, vy: a.y * sp, vz: rnd(6.2, 7.6) * Math.sqrt(c.I) * c.U, g: 23 * c.U, flips: 1 + (c.crit ? 1 : 0), axis: rnd(0, TAU), prec: rnd(-2.5, 2.5), yawAir: 1.6, e: .3, fb: .5, fs: 7, wDamp: 2.4, maxB: 2, yawFric: 3.5,
        onLand(S, v) { landDust(c, S, v, 5); } })];
    } },

  // Carried up on a pillar of light, rolling over gently, motes rising; a sun sigil on the ground.
  vitality: { col: 0xffe08a, stop: { dur: .07, sq: 0, push: 0, init: S => glowSet(S, 0xffe9a8, .6, 1.2) },
    burst(c) {
      P(TX.pillar, c.x, c.y, 0, { s0: c.R * 2.6, s1: c.R * 1.6, ax: .5, sy: 3, life: .9, tint: 0xffe08a, add: true, rot: 0, ay: 1, a: .75, pw: 1, fi: .1 });
      P(TX.rays, c.x, c.y, 20, { s0: c.R * 2, s1: c.R * 5, life: .4, tint: 0xfff0c0, add: true, vr: 1.5, a: .7 });
      for (let i = 0; i < 20 * c.I; i++) { const a = rnd(0, TAU), r = rnd(.2, 1.2) * c.R; P(i % 4 ? TX.dot : TX.star, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r * .8, rnd(0, 20), { vz: rnd(120, 420), vx: Math.cos(a) * 30, vy: Math.sin(a) * 20, drag: .8, life: rnd(.7, 1.5), s0: rnd(6, 16), s1: 2, add: true, tint: i % 3 ? 0xffe08a : 0xffffff, vr: 2 }); }
    },
    build(c) {
      const a = rotv(c.dir, rnd(-.35, .35)), sp = rnd(.9, 1.5) * c.I * c.U, roll = c.crit || c.I > .72;
      let em = 0;
      return [phAir(c, { main: true, vx: a.x * sp, vy: a.y * sp, vz: rnd(5.6, 6.6) * Math.sqrt(c.I) * c.U, g: 11.5 * c.U, drag: .5, flips: roll ? 1 + (c.crit ? 1 : 0) : 0, tiltMax: rnd(.8, 1.1) * c.side, axis: Math.atan2(a.y, a.x) + (c.side > 0 ? 0 : PI), e: .18, fb: .4, fs: 8, wDamp: 4.5, wKick: .5, maxB: 1,
        onLand(S, v, i) { if (i === 0) ringFx(S.x, S.y, c.R, c.R * 2.6, .4, 0xffe08a, { a: .6 }); },
        during(S, dt, air) { em += dt; if (air && em > .05) { em = 0; P(TX.dot, S.x + rnd(-1, 1) * c.R * .8, S.y + rnd(-1, 1) * c.R * .5, S.z, { vz: rnd(-40, 60), life: rnd(.5, .9), s0: rnd(5, 11), s1: 1, add: true, tint: 0xffe9a8 }); } } })];
    } }
};

/* -------------------------------------------- */
/*  A hit                                       */
/* -------------------------------------------- */

/**
 * Everything one hit needs: the look, the direction of the blow (from the attacker, else any), where across
 * the token it lands, the strength.
 */
function context(coin, hit, attacker) {
  const { look, col } = lookOf(hit.type);
  const T = Object.assign(Object.create(TYPES[look]), { col });
  const share = clamp(Number(hit.share) || 0, .02, 1), crit = !!hit.crit, kill = !!hit.kill;
  let dx, dy, dist = 0;
  if (attacker) { dx = coin.hx - attacker.x; dy = coin.hy - attacker.y; dist = Math.hypot(dx, dy); }
  if (!(dist > 1)) { const a = rnd(0, TAU); dx = Math.cos(a); dy = Math.sin(a); dist = 1; }
  dx /= dist; dy /= dist;
  const side = sgn(), off = rnd(-1, 1); // off: where across the token the blow lands; it sets the torque
  const c = { type: look, T, tok: coin, R: coin.R, U: coin.U, dir: { x: dx, y: dy }, dist, side, off, crit, kill, share,
    less: !!hit.less, number: hit.number ?? null, clip: hit.clip ?? null,
    I: (.45 + .95 * Math.pow(share, .6)) * (crit ? 1.28 : 1) * (kill ? 1.1 : 1) * clamp(Number(hit.intensity) || 1, .3, 2),
    x: coin.hx, y: coin.hy, atkPos: () => attacker?.pos?.() ?? null };
  c.cutAng = Math.atan2(dy, dx) + side * rnd(1.0, 1.5);
  c.ix = c.x - dx * c.R * .55 - dy * off * c.R * .55; c.iy = c.y - dy * c.R * .55 + dx * off * c.R * .55;
  return c;
}

/** The blow lands: mark on the ground, number, burst, and the token's own throw (or just a flash: Less motion). */
function impact(c) {
  const t = c.tok;
  if (t.gone) return;
  useLayersOf(t);
  const S0 = t.S, keep = t.busy ? { x: S0.x, y: S0.y, z: S0.z, psi: S0.psi } : null;
  t.rest();
  if (keep) Object.assign(t.S, keep); // hit again in mid-air: it goes on from where it is
  const S = t.S;
  S.wDir = sgn();
  t.deadBack = c.kill;
  const hx = t.hx, hy = t.hy;
  c.x = S.x; c.y = S.y;
  c.ix += c.x - hx; c.iy += c.y - hy;
  MARK[c.type](c, hx, hy);
  if (c.number != null) showNumber(c, c.number);
  if (c.less) {
    S.x = hx; S.y = hy; S.z = 0; S.psi = 0; S.flashCol = c.T.col;
    let tt = 0;
    t.play([{ update(S2, dt) {
      tt += dt;
      S2.flash = Math.max(0, 1 - tt / .5) * (c.crit ? 1 : .8);
      if (c.kill) S2.alpha = tt < .5 ? 1 - tt * 1.3 : tt < 1.8 ? .35 : Math.min(1, .35 + (tt - 1.8) * 1.6);
      return tt > (c.kill ? 2.3 : .55);
    } }]);
    return;
  }
  c.T.burst(c);
  c.clip?.(c);
  P(TX.star, c.ix, c.iy, 30, { s0: 30, s1: 120 + 60 * c.I, life: .16, add: true, tint: c.T.col, rot: rnd(0, 1) });
  if (c.crit) {
    shake(13);
    P(TX.rays, c.x, c.y, 30, { s0: c.R * 2.4, s1: c.R * 6.5, life: .5, add: true, tint: 0xfff0c0, vr: 2.5, a: .85, pw: 1.2 });
    P(TX.rays, c.x, c.y, 30, { s0: c.R * 2, s1: c.R * 5, life: .42, add: true, tint: c.T.col, vr: -3, a: .7 });
    ringFx(c.x, c.y, c.R, c.R * 6, .4, 0xffffff, { a: .7 });
  }
  let ph = [phStop(c, c.T.stop), ...c.T.build(c)];
  if (c.kill) { const i = ph.findIndex(p => p.main); ph = ph.slice(0, i + 1); ph.push(phDead(c)); }
  else ph.push(phReturn(c));
  t.play(ph);
}

/**
 * Play one reaction on this client.
 * @param {Token} token      the token that was hit (already checked: this user sees it)
 * @param {object} hit       { type, crit, kill, share, less, number, intensity, clip }
 * @param {Token|null} from  the attacker's token, when known and seen by this user
 * @returns {boolean} whether anything was drawn
 */
export function playReaction(token, hit, from = null) {
  const coin = coinFor(token, { less: !!hit.less });
  if (!coin) return false;
  useLayersOf(coin);
  const fromMesh = from?.mesh && !from.mesh.destroyed && from !== token ? from.mesh : null;
  let lunger = null;
  // The attacker bumps towards its target, card-game style; the blow lands at the end of the lunge.
  if (fromMesh && !hit.less && !activeCoin(from.id)?.busy) lunger = coinFor(from);
  const k = simScale();
  const attacker = fromMesh ? {
    x: lunger ? lunger.hx : fromMesh.position.x / k,
    y: lunger ? lunger.hy : fromMesh.position.y / k,
    pos: () => (lunger && activeCoin(from.id) === lunger ? { x: lunger.sx, y: lunger.sy } : { x: fromMesh.position.x / k, y: fromMesh.position.y / k })
  } : null;
  const c = context(coin, hit, attacker);
  if (!lunger) { impact(c); return true; }
  const A = lunger;
  A.rest();
  // The target's art stands in already, so nothing changes hands at the moment of the blow.
  if (!coin.busy) coin.play([phHold(.6)]);
  const gap = c.dist - A.R - coin.R, reach = clamp(gap + A.R * .5, A.U * .25, A.U * 1.1), ax = axisOf(c.dir, true);
  const hx = () => A.hx, hy = () => A.hy;
  A.play([
    phHold(.09, (S, u) => { const e = Math.sin(u * PI / 2) * .14 * A.U; S.x = hx() - c.dir.x * e; S.y = hy() - c.dir.y * e; S.z = 8 * u; S.wPhi = ax + PI; S.wA = .12 * u; }),
    phHold(.1, (S, u) => {
      const e = lerp(-.14 * A.U, reach, u * u);
      S.x = hx() + c.dir.x * e; S.y = hy() + c.dir.y * e; S.z = 8 + 10 * u; S.wPhi = ax; S.wA = lerp(-.12, .3, u);
      if (S.wA < 0) { S.wA = -S.wA; S.wPhi = ax + PI; }
    }, null, () => { impact(c); useLayersOf(A); }),
    phHold(c.crit ? .16 : .05, (S) => { S.x = hx() + c.dir.x * reach; S.y = hy() + c.dir.y * reach; }),
    phHold(.3, (S, u) => { const e = 1 - easeOut(u); S.x = hx() + c.dir.x * reach * e; S.y = hy() + c.dir.y * reach * e; S.z = 18 * e; S.wA = .3 * e; S.wPhi = ax; }, null, S => { S.wAv = .5; }),
    { update(S, dt) { stepWobble(S, dt, 5); return S.wA < .012 && S.wAv < .1; } }
  ]);
  return true;
}
