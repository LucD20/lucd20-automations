import { MODULE_ID } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";

/**
 * Hidden Until Started (replaces part of Monk's Combat Details).
 *
 * - A combatant whose token is hidden (Foundry's hidden flag) is added hidden
 *   in the tracker, so players don't see what's coming.
 * - When a token stops being hidden, its combatants in every combat on that
 *   scene are revealed. When the combat starts, combatants this feature hid
 *   whose token is visible by then are revealed too (catches tokens revealed
 *   while the feature was off). Combatants the GM hid by hand stay hidden.
 * - A combatant whose token is still hidden is never revealed.
 *
 * Only the active GM's client writes. This is about Foundry's hidden flag, not
 * the Invisible condition.
 */

function tokenOf(combatant) {
  return combatant.token ?? null;
}

/** Combatants on this token's scene that stand for this token. */
function combatantsOfToken(tokenDoc) {
  const out = [];
  for (const combat of game.combats ?? []) {
    const sceneId = combat.scene?.id ?? combat.sceneId ?? combat._source?.scene;
    if (sceneId && sceneId !== tokenDoc.parent?.id) continue;
    for (const combatant of combat.combatants ?? []) {
      if (combatant.tokenId === tokenDoc.id && (!combatant.sceneId || combatant.sceneId === tokenDoc.parent?.id)) out.push({ combat, combatant });
    }
  }
  return out;
}

async function reveal(combat, combatants) {
  const updates = combatants
    .filter(c => c.hidden && !tokenOf(c)?.hidden)
    .map(c => ({ _id: c.id, hidden: false }));
  if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
}

defineFeature({
  id: "encounterVisibility",
  category: "combat",
  scope: "world",
  gmOnly: true,
  defaultEnabled: false,

  enable(feature) {
    // Added with a hidden token → hidden in the tracker. Runs on the creating
    // client (only GMs create hidden-token combatants in practice).
    feature.on("preCreateCombatant", combatant => {
      if (tokenOf(combatant)?.hidden) combatant.updateSource({ hidden: true, [`flags.${MODULE_ID}.hiddenUntilStart`]: true });
    });

    // Token revealed → its combatants revealed.
    feature.on("updateToken", (tokenDoc, changes) => {
      if (!game.user.isActiveGM || changes.hidden !== false) return;
      const byCombat = new Map();
      for (const { combat, combatant } of combatantsOfToken(tokenDoc)) {
        if (!byCombat.has(combat)) byCombat.set(combat, []);
        byCombat.get(combat).push(combatant);
      }
      for (const [combat, list] of byCombat) reveal(combat, list);
    });

    // Combat starts (round 0 → 1) → reveal the ones we hid whose token is visible.
    feature.on("updateCombat", (combat, changed) => {
      if (!game.user.isActiveGM || changed.round !== 1 || !combat.started) return;
      reveal(combat, [...(combat.combatants ?? [])].filter(c => c.getFlag?.(MODULE_ID, "hiddenUntilStart")));
    });
  }
});
