import { registerLootAdapter } from "../../features/loot-pile.js";

/**
 * PF2e for the Loot Pile: piles are native "loot" actors, only physical items
 * count as loot (NPC strikes, spells, actions and effects are ignored), coins
 * are treasure in the "coins" stack group, and the Party Stash is the active
 * party's inventory.
 */

registerLootAdapter({
  system: "pf2e",
  pileType: "loot",
  isLoot: item => (typeof item.isOfType === "function" ? item.isOfType("physical") : false),
  isCoins: item => item.system?.stackGroup === "coins" || !!item.isCoinage,
  level: actor => Number(actor.level ?? actor.system?.details?.level?.value ?? 0) || 0,
  stash: () => game.actors.party ?? game.actors.find(a => a.type === "party") ?? null,
  pileData: base => ({ ...base, system: { lootSheetType: "Loot", hiddenWhenEmpty: false } })
});
