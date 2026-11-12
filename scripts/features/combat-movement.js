import { MODULE_ID, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { addMoveRule } from "../core/movement-block.js";
import { watchDOM } from "../core/dom-watch.js";
import { appElement } from "../core/dom.js";

/**
 * Combat Movement (replaces part of Monk's TokenBar).
 *
 * - While a combat has started, players can only move the token of the
 *   combatant whose turn it is. Tokens that aren't in the combat move freely
 *   (owner's decision, Q8). The GM can always move.
 * - Back to free movement when the combat ends (nothing to undo: the mode is
 *   only read while a started combat exists).
 * - A button in the combat tracker header (GM) switches the combat between
 *   "turn order" and "free" movement; players see the current mode as an icon.
 *   Stored as a flag on the combat, so everyone sees the same mode.
 * - Blocked moves float "Not your turn" over the token (core/movement-block.js).
 *
 * The check runs on the player's client (`preMoveToken`). A GM-side backstop
 * isn't possible for a player's own token update without undoing it after the
 * fact, so there is none.
 */

const KEY = "LUCD20.CombatMovement.NotYourTurn";
const FLAG = "freeMovement";

/** The started combat on this token's scene that this token is part of. */
function combatOf(tokenDoc) {
  const sceneId = tokenDoc.parent?.id;
  for (const combat of game.combats ?? []) {
    if (!combat.started) continue;
    const combatSceneId = combat.scene?.id ?? canvas?.scene?.id;
    if (combatSceneId !== sceneId) continue;
    if ([...(combat.combatants ?? [])].some(c => c.tokenId === tokenDoc.id)) return combat;
  }
  return null;
}

function isFree(combat) {
  return !!combat?.getFlag?.(MODULE_ID, FLAG);
}

function rule(tokenDoc) {
  const combat = combatOf(tokenDoc);
  if (!combat || isFree(combat)) return null;
  return combat.combatant?.tokenId === tokenDoc.id ? null : KEY;
}

/* -------------------------------------------- */
/*  Tracker header control                      */
/* -------------------------------------------- */

/** The started combat shown in the tracker. */
function trackedCombat() {
  const combat = game.combat ?? ui.combat?.viewed ?? null;
  return combat?.started ? combat : null;
}

function headerOf(root) {
  return root.querySelector(".combat-tracker-header .encounter-controls")
    ?? root.querySelector(".combat-tracker-header")
    ?? root.querySelector(".encounter-controls")
    ?? root.querySelector("header:not(.window-header)");
}

function drawControl(root) {
  const combat = trackedCombat();
  const existing = root.querySelector(".lucd20-move-mode");
  if (!combat) {
    existing?.remove();
    return;
  }
  const free = isFree(combat);
  const state = free ? "free" : "turn";
  if (existing?.dataset.state === state) return;
  existing?.remove();
  const header = headerOf(root);
  if (!header) return;

  const isGM = game.user.isGM;
  const el = document.createElement(isGM ? "button" : "span");
  el.className = `lucd20-move-mode inline-control icon fa-solid ${free ? "fa-person-walking" : "fa-shoe-prints"}`;
  el.classList.toggle("free", free);
  el.dataset.state = state;
  const tip = localize(free ? "LUCD20.CombatMovement.Free" : "LUCD20.CombatMovement.Turn");
  el.dataset.tooltip = isGM ? `${tip}<br>${localize("LUCD20.CombatMovement.Toggle")}` : tip;
  el.setAttribute("aria-label", tip);
  if (isGM) {
    el.type = "button";
    el.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const current = trackedCombat();
      if (current) current.setFlag(MODULE_ID, FLAG, !isFree(current));
    });
  }
  header.append(el);
}

function refreshControls() {
  for (const app of [ui.combat, ui.combat?.popout]) {
    const root = appElement(app);
    if (root?.isConnected) drawControl(root);
  }
}

defineFeature({
  id: "combatMovement",
  category: "combat",
  scope: "world",
  gmOnly: true,
  defaultEnabled: false,

  enable(feature) {
    feature.onCleanup(addMoveRule("combatMovement", rule));
    feature.onCleanup(watchDOM("combat-movement-control", refreshControls));
    feature.onCleanup(() => document.querySelectorAll(".lucd20-move-mode").forEach(el => el.remove()));
  }
});
