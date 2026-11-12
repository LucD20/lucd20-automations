import { defineFeature } from "../core/registry.js";
import { addMoveRule, showBlockedText } from "../core/movement-block.js";

/**
 * Paused Movement Notice (replaces Pause Notifier).
 *
 * Foundry V14 already stops a player's move while the game is paused and shows
 * "You cannot take this action while the game is currently paused." (owner
 * checked). This replaces that notification with "Game's Paused" floating up
 * from the token(s) the player tried to move, seen by everyone who can see
 * the token (owner's decision, Q9). The GM is never blocked.
 *
 * Foundry blocks the move before `preMoveToken`, so the notification itself is
 * intercepted; a move rule catches anything that gets through.
 */

const KEY = "LUCD20.PauseNotifier.Text";
const CORE_KEY = "GAME.PausedWarning";
const CORE_TEXT = "You cannot take this action while the game is currently paused.";

function isPausedWarning(message) {
  if (typeof message !== "string") return false;
  const text = game.i18n.has?.(CORE_KEY) ? game.i18n.localize(CORE_KEY) : CORE_TEXT;
  return message === CORE_KEY || message === text || message === CORE_TEXT;
}

/** The player's own tokens they were trying to move: controlled ones. */
function movingTokens() {
  return (canvas?.tokens?.controlled ?? []).filter(t => t.document?.isOwner).map(t => t.document);
}

/** Replace the notification with the floating text. True when handled. */
function intercept(message) {
  if (game.user.isGM || !game.paused || !isPausedWarning(message)) return false;
  const tokens = movingTokens();
  if (!tokens.length) return false; // not a token move: keep Foundry's notification
  for (const doc of tokens) showBlockedText(doc, KEY);
  return true;
}

defineFeature({
  id: "pauseNotifier",
  category: "tokens",
  scope: "world",
  gmOnly: true,
  defaultEnabled: false,

  enable(feature) {
    const notifications = ui.notifications;
    if (notifications) {
      feature.wrap(notifications, "warn", function (original, message, ...rest) {
        if (intercept(message)) return null;
        return original(message, ...rest);
      });
      if (typeof notifications.notify === "function") {
        feature.wrap(notifications, "notify", function (original, message, type, ...rest) {
          if ((type === "warning" || type === "warn") && intercept(message)) return null;
          return original(message, type, ...rest);
        });
      }
    }
    feature.onCleanup(addMoveRule("pauseNotifier", () => (game.paused ? KEY : null)));
  }
});
