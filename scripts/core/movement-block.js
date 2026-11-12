import { localize } from "./constants.js";
import { broadcast, onBroadcast } from "./socket.js";

/**
 * One place where token moves are checked, shared by Combat Movement and
 * Paused Movement Notice, so a move is checked once and gets one message.
 *
 * - addMoveRule(id, rule) → remove(): `rule(tokenDoc)` returns a lang key
 *   when the current user may not move that token, else null. Rules only run
 *   for players (the GM can always move).
 * - V14 sends every move (drag, arrow keys, ruler/waypoints) through
 *   `preMoveToken` (owner checked); returning false cancels it.
 * - showBlockedText(tokenDoc, key): the message floats up from the token on
 *   every client that can see the token (hidden tokens never show it).
 */

const rules = new Map();
let hookId = null;
const lastShown = new Map(); // token id → time, so held arrow keys don't stack texts

function onPreMove(tokenDoc) {
  if (game.user.isGM) return true;
  for (const rule of rules.values()) {
    const key = rule(tokenDoc);
    if (key) {
      showBlockedText(tokenDoc, key);
      return false;
    }
  }
  return true;
}

export function addMoveRule(id, rule) {
  rules.set(id, rule);
  hookId ??= Hooks.on("preMoveToken", onPreMove);
  return () => {
    rules.delete(id);
    if (!rules.size && hookId !== null) {
      Hooks.off("preMoveToken", hookId);
      hookId = null;
    }
  };
}

function drawText(sceneId, tokenId, key) {
  if (!canvas?.ready || canvas.scene?.id !== sceneId) return;
  const token = canvas.tokens?.get(tokenId);
  if (!token || !token.visible) return; // never reveal a hidden token
  canvas.interface?.createScrollingText?.(token.center, localize(key), {
    anchor: CONST.TEXT_ANCHOR_POINTS?.TOP ?? 2,
    direction: CONST.TEXT_ANCHOR_POINTS?.TOP ?? 2,
    distance: canvas.dimensions.size,
    fontSize: 28,
    fill: "#ffd166",
    stroke: 0x000000,
    strokeThickness: 4,
    jitter: 0.1,
    duration: 2000
  });
}

/** Float the message over the token here and on every other client. */
export function showBlockedText(tokenDoc, key) {
  const now = Date.now();
  if (now - (lastShown.get(tokenDoc.id) ?? 0) < 900) return;
  lastShown.set(tokenDoc.id, now);
  const payload = { sceneId: tokenDoc.parent?.id, tokenId: tokenDoc.id, key };
  drawText(payload.sceneId, payload.tokenId, key);
  broadcast("movement.blocked", payload);
}

onBroadcast("movement.blocked", ({ sceneId, tokenId, key }) => {
  if (typeof key === "string" && key.startsWith("LUCD20.")) drawText(sceneId, tokenId, key);
});
