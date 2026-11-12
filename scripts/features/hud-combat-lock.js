import { localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";

/**
 * Lock Combat Toggle (replaces part of Monk's Combat Details).
 *
 * The Token HUD's "Toggle combat state" button can still add tokens to combat,
 * but clicking it on a token that is already in combat (which would remove it,
 * and every other selected combatant, losing their initiative) only shows a
 * notification. Combatants are removed from the combat tracker; the GM can
 * Shift+click the button to remove anyway.
 *
 * One click listener on the document, in the capture phase, so it runs before
 * Foundry's own handler wherever and however often the HUD is drawn.
 */

const BUTTON = '#token-hud [data-action="combat"], .token-hud [data-action="combat"]';

/** The token the HUD is open for. */
function hudToken() {
  const hud = canvas?.hud?.token;
  return hud?.object ?? hud?.document?.object ?? null;
}

function inCombat(token) {
  return !!(token?.inCombat ?? token?.document?.inCombat);
}

function onClick(event) {
  const button = event.target instanceof Element ? event.target.closest(BUTTON) : null;
  if (!button) return;
  if (!inCombat(hudToken())) return; // adding to combat is fine
  if (event.shiftKey && game.user.isGM) return; // GM override: Foundry removes it as usual

  event.preventDefault();
  event.stopImmediatePropagation();
  ui.notifications.info(localize(game.user.isGM ? "LUCD20.HudCombatLock.BlockedGM" : "LUCD20.HudCombatLock.Blocked"));
}

defineFeature({
  id: "hudCombatLock",
  category: "combat",
  scope: "world",
  gmOnly: true,
  defaultEnabled: false,

  enable(feature) {
    // pointerdown/mousedown are not stopped: Foundry's HUD buttons act on click.
    document.addEventListener("click", onClick, true);
    feature.onCleanup(() => document.removeEventListener("click", onClick, true));
  }
});
