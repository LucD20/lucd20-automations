import { MODULE_ID } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { readHP } from "../core/hp.js";

/**
 * Defeat at 0 HP (replaces part of Monk's Combat Details).
 *
 * When an NPC combatant's HP drops to 0, the active GM's client marks the
 * combatant defeated, applies the system's defeated status and (option) hides
 * its token, so bodies don't clutter the map. Healed above 0 → undone (option),
 * but only what this feature did: a combatant the GM marked defeated by hand,
 * or a token the GM hid, is left alone.
 *
 * Only NPCs (no player owner) that are combatants are touched. Loot Pile reads
 * defeated combatants whether their token is hidden or not.
 *
 * Acts on HP crossing 0 (compared with the last value seen), so a GM who
 * un-defeats a 0 HP NPC by hand isn't overruled by an unrelated update.
 */

const state = { feature: null, hp: new Map() }; // actor uuid → last HP value

const FLAG_DEFEATED = "defeatedAtZero";
const FLAG_HIDDEN = "hiddenAtZero";

function defeatedStatus() {
  return CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
}

/** Combatants (in every combat) that stand for this actor. */
function combatantsOf(actor) {
  const out = [];
  for (const combat of game.combats ?? []) {
    for (const combatant of combat.combatants ?? []) {
      const cActor = combatant.actor;
      if (!cActor) continue;
      if (actor.isToken ? combatant.tokenId === actor.token?.id : cActor === actor || (cActor.id === actor.id && !cActor.isToken)) {
        out.push(combatant);
      }
    }
  }
  return out;
}

function hasStatus(actor, id) {
  return !!actor.statuses?.has?.(id);
}

async function setStatus(actor, active) {
  const id = defeatedStatus();
  if (hasStatus(actor, id) === active) return;
  try {
    await actor.toggleStatusEffect(id, { active, overlay: true });
  } catch (err) {
    console.error(`${MODULE_ID} | Defeat at 0 HP: could not ${active ? "apply" : "remove"} the defeated status.`, err);
  }
}

async function goDown(actor, combatants) {
  for (const combatant of combatants) {
    if (!combatant.defeated) await combatant.update({ defeated: true, [`flags.${MODULE_ID}.${FLAG_DEFEATED}`]: true });
    const token = combatant.token;
    if (state.feature.get("hideToken") && token && !token.hidden) {
      await token.update({ hidden: true, [`flags.${MODULE_ID}.${FLAG_HIDDEN}`]: true });
    }
  }
  await setStatus(actor, true);
}

async function getUp(actor, combatants) {
  let undid = false;
  for (const combatant of combatants) {
    if (combatant.getFlag(MODULE_ID, FLAG_DEFEATED)) {
      undid = true;
      await combatant.update({ defeated: false, [`flags.${MODULE_ID}.-=${FLAG_DEFEATED}`]: null });
    }
    const token = combatant.token;
    if (token?.getFlag(MODULE_ID, FLAG_HIDDEN)) {
      await token.update({ hidden: false, [`flags.${MODULE_ID}.-=${FLAG_HIDDEN}`]: null });
    }
  }
  if (undid) await setStatus(actor, false);
}

function check(actor) {
  if (!actor || !game.user.isActiveGM || actor.hasPlayerOwner) return;
  const hp = readHP(actor);
  if (!hp || !(hp.max > 0)) return;
  const before = state.hp.get(actor.uuid);
  state.hp.set(actor.uuid, hp.value);
  if (before === hp.value) return;

  const combatants = combatantsOf(actor);
  if (!combatants.length) return;
  const down = hp.value <= 0;
  const wasDown = before !== undefined && before <= 0;
  if (down && !wasDown) goDown(actor, combatants);
  else if (!down && wasDown && state.feature.get("undoOnHeal")) getUp(actor, combatants);
}

function snapshot() {
  const seen = actor => {
    const hp = readHP(actor);
    if (hp) state.hp.set(actor.uuid, hp.value);
  };
  for (const actor of game.actors ?? []) seen(actor);
  for (const combat of game.combats ?? []) for (const c of combat.combatants ?? []) if (c.actor) seen(c.actor);
}

defineFeature({
  id: "defeatAutomation",
  category: "combat",
  scope: "world",
  gmOnly: true,
  defaultEnabled: false,
  settings: {
    hideToken: { kind: "boolean", default: true },
    undoOnHeal: { kind: "boolean", default: true }
  },

  enable(feature) {
    state.feature = feature;
    state.hp.clear();
    snapshot();
    feature.on("updateActor", actor => check(actor));
    feature.on("updateToken", doc => { if (!doc.actorLink) check(doc.actor); });
    feature.on("updateActorDelta", delta => check(delta?.parent?.actor));
    feature.on("createCombatant", combatant => {
      const hp = combatant.actor && readHP(combatant.actor);
      if (hp) state.hp.set(combatant.actor.uuid, hp.value);
    });
    feature.on("canvasReady", snapshot);
  },

  onSettingChange() {} // options are read when they're needed
});
