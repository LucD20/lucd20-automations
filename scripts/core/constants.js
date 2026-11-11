export const MODULE_ID = "lucd20-automations";
export const SOCKET_NAME = `module.${MODULE_ID}`;
export const TEMPLATE_PATH = `modules/${MODULE_ID}/templates`;

const PREFIX = `${MODULE_ID} |`;
export const log = (...args) => console.log(PREFIX, ...args);
export const warn = (...args) => console.warn(PREFIX, ...args);
export const error = (...args) => console.error(PREFIX, ...args);

/** Localize a key, formatting `{placeholders}` when data is given. */
export function localize(key, data) {
  return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

/** Localize a key only if it exists; otherwise return the fallback. */
export function localizeIfExists(key, fallback = "") {
  return game.i18n.has(key) ? game.i18n.localize(key) : fallback;
}

/** Short label for a game system id, e.g. "pf2e" → "PF2e". */
export function systemLabel(systemId) {
  return localizeIfExists(`LUCD20.System.${systemId}`, systemId.toUpperCase());
}
