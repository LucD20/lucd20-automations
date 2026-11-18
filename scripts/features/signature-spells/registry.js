/**
 * Signature Spells: the list of spells with an effect of their own (docs/PLAN.md §20).
 *
 * Adding one = one file in `spells/` (imported from `spells/index.js`) calling `defineSignature`, plus its
 * texts under `LUCD20.Feature.signatureSpells.Setting.<id>` in `lang/en.json`:
 *
 * ```js
 * defineSignature({
 *   id: "chainLightning",                 // its GM switch (a world option of the feature) and text key
 *   match: { pf2e: { slug: "chain-lightning", roll: "damage" } },
 *                                         // per system: the item's slug and which roll starts it; or a
 *                                         // function (info, message) → boolean. `info` is what the system's
 *                                         // reader found: { slug, name, roll, caster, scene, targets, ordered }
 *   look: "electricity",                  // the Token Reactions look its targets play
 *   preview: "8d12",                      // dice thrown by the GM's preview
 *   rolling(fx, dice, dt) {},             // every frame while Dice So Nice rolls: dice = [{ x, y, r, at() }]
 *   async result(fx, dice) {},            // the dice have landed (dice may be empty: skipped then)
 *   async toTargets(fx, ctx) {}           // ctx = { from: { x, y, screen: true } | Token | null, caster, targets }
 * });
 * ```
 *
 * `fx` is the toolkit of `effects.js` (bolts on the screen and on the canvas, glows, `strike`, `wait`, `less`).
 * Every part is optional; with Less motion `rolling` is not called.
 */

const signatures = [];

export function defineSignature(definition) {
  if (!definition?.id) throw new Error("A signature spell needs an id.");
  if (signatures.some(s => s.id === definition.id)) return;
  signatures.push(definition);
}

export const allSignatures = () => signatures;
export const signatureById = id => signatures.find(s => s.id === id) ?? null;

/** The signature a system's reading of a message starts, or null. */
export function signatureFor(info, message, systemId = game.system?.id) {
  if (!info) return null;
  for (const sig of signatures) {
    const m = typeof sig.match === "function" ? sig.match : sig.match?.[systemId];
    if (!m) continue;
    if (typeof m === "function") { if (m(info, message)) return sig; continue; }
    if (m.slug && m.slug === info.slug && (!m.roll || m.roll === info.roll)) return sig;
  }
  return null;
}
