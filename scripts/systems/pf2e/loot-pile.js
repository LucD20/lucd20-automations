import { registerLootAdapter } from "../../features/loot-pile.js";
import { emptyPurse } from "../../core/coins.js";

/**
 * PF2e for the Loot Pile: piles are native "loot" actors, only physical items
 * count as loot (NPC strikes, spells, actions and effects are ignored), coins
 * are treasure in the "coins" stack group, and the Party Stash is the active
 * party's inventory.
 *
 * Coins: 10 cp = 1 sp, 10 sp = 1 gp, 10 gp = 1 pp. They are added and removed
 * through the system's own inventory (actor.inventory.addCoins / removeCoins),
 * with a plain item fallback where that is missing.
 */

const DENOMINATIONS = [{ id: "pp", value: 1000 }, { id: "gp", value: 100 }, { id: "sp", value: 10 }, { id: "cp", value: 1 }];
const SLUGS = { "platinum-pieces": "pp", "gold-pieces": "gp", "silver-pieces": "sp", "copper-pieces": "cp" };
const NAMES = { pp: "Platinum Pieces", gp: "Gold Pieces", sp: "Silver Pieces", cp: "Copper Pieces" };

const isCoins = item => item.system?.stackGroup === "coins" || !!item.isCoinage;

/** Which coin a coin item is: from its price per unit, else its slug or name. */
function denominationOf(item) {
  const price = item.system?.price?.value ?? {};
  const byPrice = DENOMINATIONS.find(d => Number(price[d.id]) > 0)?.id;
  if (byPrice) return byPrice;
  const slug = item.slug ?? item.system?.slug ?? String(item.name ?? "").toLowerCase().replace(/[^a-z]+/g, "-");
  return SLUGS[slug] ?? null;
}

function coinsOf(actor) {
  const purse = emptyPurse(DENOMINATIONS);
  const own = actor.inventory?.coins;
  if (own && DENOMINATIONS.every(d => typeof own[d.id] === "number")) {
    for (const d of DENOMINATIONS) purse[d.id] = own[d.id];
    return purse;
  }
  for (const item of actor.items) {
    const id = isCoins(item) ? denominationOf(item) : null;
    if (id) purse[id] += Number(item.system?.quantity) || 0;
  }
  return purse;
}

async function addCoins(actor, coins) {
  if (typeof actor.inventory?.addCoins === "function") return actor.inventory.addCoins(coins);
  for (const d of DENOMINATIONS) {
    const n = Number(coins?.[d.id]) || 0;
    if (!n) continue;
    const item = actor.items.find(i => isCoins(i) && denominationOf(i) === d.id);
    if (item) await item.update({ "system.quantity": (Number(item.system.quantity) || 0) + n });
    else await actor.createEmbeddedDocuments("Item", [{ name: NAMES[d.id], type: "treasure", img: "icons/svg/coins.svg", system: { quantity: n, stackGroup: "coins", price: { value: { [d.id]: 1 } } } }]);
  }
}

async function removeCoins(actor, coins) {
  // byValue false: take exactly these coins, do not make change.
  if (typeof actor.inventory?.removeCoins === "function") return actor.inventory.removeCoins(coins, { byValue: false });
  for (const d of DENOMINATIONS) {
    let n = Number(coins?.[d.id]) || 0;
    for (const item of actor.items.filter(i => isCoins(i) && denominationOf(i) === d.id)) {
      if (n <= 0) break;
      const have = Number(item.system.quantity) || 0;
      const take = Math.min(have, n);
      n -= take;
      if (take >= have) await item.delete();
      else await item.update({ "system.quantity": have - take });
    }
  }
}

const party = () => game.actors.party ?? game.actors.find(a => a.type === "party") ?? null;

registerLootAdapter({
  system: "pf2e",
  pileType: "loot",
  isLoot: item => (typeof item.isOfType === "function" ? item.isOfType("physical") : false),
  isCoins,
  level: actor => Number(actor.level ?? actor.system?.details?.level?.value ?? 0) || 0,
  stash: party,
  pileData: base => ({ ...base, system: { lootSheetType: "Loot", hiddenWhenEmpty: false } }),
  denominations: DENOMINATIONS,
  coinsOf,
  addCoins,
  removeCoins,
  // The characters a split is between: the active party's members.
  characters: () => [...(party()?.members ?? [])].filter(a => a?.type === "character")
});
