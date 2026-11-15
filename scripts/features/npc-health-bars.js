import { defineFeature } from "../core/registry.js";

/**
 * NPC Health Bars (GM).
 *
 * Every token of a creature no player owns is created with its bars shown
 * "Always for Owner": the GM always sees enemy hit points without setting
 * each token up, and players never see them (they do not own the token).
 * It covers tokens from any source (compendium, imported actors) because it
 * acts when the token is placed. Tokens already on a scene are left alone, and
 * so are tokens of player-owned actors.
 */
defineFeature({
  id: "npcHealthBars",
  category: "tokens",
  scope: "world",
  gmOnly: true,
  defaultEnabled: true,

  enable(feature) {
    feature.on("preCreateToken", document => {
      if (!document.actor || document.actor.hasPlayerOwner) return;
      const mode = CONST.TOKEN_DISPLAY_MODES.OWNER;
      if (document.displayBars !== mode) document.updateSource({ displayBars: mode });
    });
  }
});
