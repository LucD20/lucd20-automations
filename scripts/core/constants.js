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

/**
 * Systems built on another system's engine count as that system (owner, Q311: everything for PF2e also
 * runs in the SF2e system, a PF2e fork with its own id, settings and flag namespace).
 */
export const SYSTEM_FAMILY = { sf2e: "pf2e" };

/** The engine family of a system id ("sf2e" → "pf2e"; others: themselves). */
export const systemFamily = (id = game.system?.id) => SYSTEM_FAMILY[id] ?? id;

/** Whether a feature / adapter / setting declared for `id` applies to the active system. */
export function systemMatches(id) {
  const own = game.system?.id;
  return !!id && (id === own || id === SYSTEM_FAMILY[own]);
}
