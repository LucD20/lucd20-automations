/**
 * The PF2e engine under its two names (owner, Q311): PF2e ("pf2e") and SF2e ("sf2e", a fork with the same
 * data model). Code under systems/pf2e/ reaches the system through these, never through "pf2e" directly:
 * - settings and document flags live under the active system's id (SF2e: `sf2e.gmVision`, `flags.sf2e`);
 * - the API (`game.pf2e`) and config (`CONFIG.PF2E`) are looked up under either name;
 * - compendiums: the active system's pack first, then PF2e's (SF2e worlds often have PF2e content too).
 * (verify) in SF2e 1.7: the names of its API and config objects.
 */

/** The active system's id: settings / flags namespace. */
export const sysId = () => game.system?.id ?? "pf2e";

/** The system's flags on a document (or flags object), under its own id, else under "pf2e". */
export function sysFlags(docOrFlags) {
  const flags = docOrFlags?.flags ?? docOrFlags;
  return flags?.[sysId()] ?? flags?.pf2e;
}

/** The system's API object (`game.pf2e`). */
export const sysApi = () => game.pf2e ?? game[sysId()] ?? game.sf2e;

/** The system's config (`CONFIG.PF2E`). */
export const sysConfig = () => CONFIG.PF2E ?? CONFIG[sysId().toUpperCase()] ?? CONFIG.SF2E;

/** A system compendium by name ("conditionitems"): the active system's, else PF2e's. */
export const sysPack = name => game.packs?.get(`${sysId()}.${name}`) ?? game.packs?.get(`pf2e.${name}`);

/** A system setting (client or world), or undefined when it doesn't exist in this system. */
export function sysSetting(key) {
  try { return game.settings.get(sysId(), key); } catch { return undefined; }
}

export const sysSetSetting = (key, value) => game.settings.set(sysId(), key, value);
