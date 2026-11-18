import { defineSignature } from "../registry.js";
import { chain } from "../effects.js";

/**
 * Chain Lightning (owner, docs/PLAN.md §20): while the damage dice roll, lightning darts around them; when
 * they have landed, it runs through all of them; then from the last die it hits the first target, the second
 * and so on, each token playing the electricity reaction as the bolt arrives.
 */

const COL = 0x8fc8ff;
const pick = list => list[Math.random() * list.length | 0];

defineSignature({
  id: "chainLightning",
  match: { pf2e: { slug: "chain-lightning", roll: "damage" } },
  look: "electricity",
  preview: "8d12",

  // Small arcs leaping off each die, now and then one from die to die.
  rolling(fx, dice, dt) {
    const m = fx.memo;
    m.t = (m.t ?? 0) + dt;
    if (!dice.length) return;
    while (m.t > .045) {
      m.t -= .045;
      const die = pick(dice), a = fx.rnd(0, Math.PI * 2), len = die.r * fx.rnd(1.3, 2.8);
      fx.screenBolt(() => die.at(), () => { const p = die.at(); return { x: p.x + Math.cos(a) * len, y: p.y + Math.sin(a) * len }; }, { life: 130, width: 1.6, jag: 5, seg: 9, col: COL, fade: 60 });
      if (dice.length > 1 && Math.random() < .4) {
        const other = pick(dice.filter(d => d !== die));
        fx.screenBolt(() => die.at(), () => other.at(), { life: 140, width: 2, jag: 9, seg: 18, col: COL, fade: 70 });
      }
    }
  },

  // The result is clear: one bolt through all the dice, in order, crackling around each.
  async result(fx, dice) {
    const T = fx.less ? 320 : 700;
    for (const die of dice) fx.screenGlow(() => die.at(), { r: die.r * 2.6, life: T, col: COL });
    for (let i = 1; i < dice.length; i++) fx.screenBolt(() => dice[i - 1].at(), () => dice[i].at(), { life: T, grow: fx.less ? 0 : 60 * i, width: 2.8, forks: 1, col: COL });
    if (fx.less) return fx.wait(T);
    for (const end = performance.now() + T; performance.now() < end - 30;) {
      for (const die of dice) {
        const a = fx.rnd(0, Math.PI * 2), len = die.r * fx.rnd(1.2, 2.2);
        fx.screenBolt(() => die.at(), () => { const p = die.at(); return { x: p.x + Math.cos(a) * len, y: p.y + Math.sin(a) * len }; }, { life: 100, width: 1.5, jag: 5, seg: 9, col: COL, fade: 50 });
      }
      await fx.wait(Math.min(60, Math.max(1, end - performance.now())));
    }
  },

  // From the last die (else the caster, else the sky) to the first target, then target to target.
  toTargets: (fx, ctx) => chain(fx, ctx, { look: "electricity", col: COL, gap: 240 })
});
