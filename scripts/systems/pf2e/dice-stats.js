import { registerDiceStatsAdapter } from "../../features/dice-stats.js";

/**
 * PF2e detail for Dice Stats: PF2e marks each check message with
 * flags.pf2e.context.type ("attack-roll", "saving-throw", …) and, when a DC
 * was known, flags.pf2e.context.outcome ("criticalSuccess" … "criticalFailure").
 */

const TYPES = {
  "attack-roll": "attack",
  "spell-attack-roll": "attack",
  "saving-throw": "save",
  "skill-check": "skill",
  "perception-check": "perception",
  "initiative": "initiative",
  "flat-check": "flat"
};

registerDiceStatsAdapter({
  system: "pf2e",
  types: {
    attack: "LUCD20.DiceStats.Type.attack",
    save: "LUCD20.DiceStats.Type.save",
    skill: "LUCD20.DiceStats.Type.skill",
    perception: "LUCD20.DiceStats.Type.perception",
    initiative: "LUCD20.DiceStats.Type.initiative",
    flat: "LUCD20.DiceStats.Type.flat"
  },
  check(message) {
    const context = message.flags?.pf2e?.context;
    const type = TYPES[context?.type];
    if (!type) return null;
    return { type, outcome: context.outcome ?? null };
  }
});
