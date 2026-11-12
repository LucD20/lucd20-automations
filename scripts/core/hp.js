/**
 * Reading an actor's HP, shared by Damage Log and Defeat at 0 HP.
 * Works for PF2e, D&D 4e and other systems that use `system.attributes.hp`.
 */

/** Where this actor keeps HP, or null when it has none. */
export function hpPaths(actor) {
  const a = actor?.system?.attributes;
  if (!a?.hp || typeof a.hp.value !== "number") return null;
  let temp = null;
  if (typeof a.hp.temp === "number") temp = "system.attributes.hp.temp";
  else if (typeof a.temphp?.value === "number") temp = "system.attributes.temphp.value";
  return { value: "system.attributes.hp.value", max: "system.attributes.hp.max", temp };
}

/** { value, max, temp } or null. */
export function readHP(actor) {
  const paths = hpPaths(actor);
  if (!paths) return null;
  const get = path => (path ? Number(foundry.utils.getProperty(actor, path)) || 0 : 0);
  return { value: get(paths.value), max: get(paths.max), temp: get(paths.temp) };
}
