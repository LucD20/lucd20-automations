import { MODULE_ID, SOCKET_NAME, error, localize } from "./constants.js";

/**
 * Two ways for clients to talk to each other:
 *
 * - broadcast(type, payload): fire-and-forget to every other connected client.
 *   Handle with onBroadcast(type, (payload, senderId) => …).
 *
 * - executeAsGM(type, payload): run a handler on the active GM's client and get
 *   its return value back. Used for things players can't do themselves
 *   (e.g. moving an item out of a loot pile they don't own).
 *   Handle with onGMRequest(type, (payload, senderId) => result).
 */

const QUERY_NAME = `${MODULE_ID}.gm`;
const broadcastHandlers = new Map();
const gmHandlers = new Map();

export function onBroadcast(type, handler) {
  broadcastHandlers.set(type, handler);
}

export function onGMRequest(type, handler) {
  gmHandlers.set(type, handler);
}

export function broadcast(type, payload = {}) {
  game.socket.emit(SOCKET_NAME, { type, payload, senderId: game.user.id });
}

export async function executeAsGM(type, payload = {}) {
  const request = { type, payload, senderId: game.user.id };
  if (game.user.isActiveGM) return runGMRequest(request);
  const gm = game.users.activeGM;
  if (!gm) throw new Error(localize("LUCD20.Error.NoGM"));
  return gm.query(QUERY_NAME, request, { timeout: 30_000 });
}

async function runGMRequest({ type, payload, senderId }) {
  const handler = gmHandlers.get(type);
  if (!handler) throw new Error(`${MODULE_ID} | No GM handler for "${type}".`);
  return handler(payload, senderId);
}

export function initSocket() {
  game.socket.on(SOCKET_NAME, message => {
    const handler = broadcastHandlers.get(message?.type);
    if (!handler) return;
    try {
      handler(message.payload, message.senderId);
    } catch (err) {
      error(`Socket handler "${message.type}" failed.`, err);
    }
  });

  if (CONFIG.queries) CONFIG.queries[QUERY_NAME] = request => runGMRequest(request);
  else error("CONFIG.queries is missing; GM requests will not work.");
}
