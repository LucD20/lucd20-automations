import { defineSignature } from "../registry.js";
import { chain } from "../effects.js";

/**
 * Chain Lightning (owner, docs/PLAN.md §20): while the damage dice roll, lightning darts around them; when
 * they have landed, it runs through all of them, each die jumping as it is hit and vanishing at the top of
 * its jump; then from where the last die was it hits the first target, the second and so on, each token
 * playing the electricity reaction as the bolt arrives.
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

  // The result is clear: the bolt runs through the dice in order. Each die jumps as it is hit and is gone at
  // the top of its jump, in a burst, so the table is clear when the bolt leaves for the tokens.
  async result(fx, dice) {
    if (fx.less) {
      for (const die of dice) fx.screenGlow(() => die.at(), { r: die.r * 2.6, life: 570, col: COL });
      for (let i = 1; i < dice.length; i++) fx.screenBolt(() => dice[i - 1].at(), () => dice[i].at(), { life: 320, width: 2.8, col: COL });
      await fx.wait(320);
      return fx.diceFade(dice, 250);
    }
    const n = dice.length, step = n > 1 ? Math.min(110, 700 / (n - 1)) : 0, RISE = 240;
    const arcs = (die, count, reach, life) => {
      for (let k = 0; k < count; k++) {
        const a = fx.rnd(0, Math.PI * 2), len = die.r * fx.rnd(reach * .6, reach);
        fx.screenBolt(() => die.at(), () => { const p = die.at(); return { x: p.x + Math.cos(a) * len, y: p.y + Math.sin(a) * len }; }, { life, width: 1.6, jag: 5, seg: 9, col: COL, fade: 60 });
      }
    };
    const jumps = [];
    for (let i = 0; i < n; i++) {
      const die = dice[i];
      if (i) {
        fx.screenBolt(() => dice[i - 1].at(), () => die.at(), { life: step + RISE, grow: step * .8, width: 2.8, forks: 1, col: COL });
        await fx.wait(step);
      }
      fx.screenGlow(() => die.at(), { r: die.r * 2.6, life: RISE + 160, col: COL });
      arcs(die, 3, 2.2, 120);
      jumps.push(fx.diceJump(die, { rise: RISE }).then(() => {
        fx.screenGlow(() => die.at(), { r: die.r * 3.4, life: 220, col: COL, alpha: .9 });
        arcs(die, 6, 3, 150);
      }));
    }
    await Promise.all(jumps);
  },

  // From the last die (else the caster, else the sky) to the first target, then target to target.
  toTargets: (fx, ctx) => chain(fx, ctx, { look: "electricity", col: COL, gap: 240 })
});
