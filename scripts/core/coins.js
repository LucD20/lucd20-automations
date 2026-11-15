/**
 * Coin arithmetic shared by the Loot Pile's coin splitting.
 *
 * A system's coins are a list of denominations, highest first:
 * [{ id: "pp", value: 1000 }, { id: "gp", value: 100 }, …], `value` counted in
 * the lowest coin. A purse is a plain object { pp: 1, gp: 12, … }.
 */

export const emptyPurse = denominations => Object.fromEntries(denominations.map(d => [d.id, 0]));

/** A purse with every denomination present, whole and not negative. */
export function cleanPurse(purse, denominations) {
  const out = emptyPurse(denominations);
  for (const d of denominations) out[d.id] = Math.max(0, Math.floor(Number(purse?.[d.id]) || 0));
  return out;
}

export const purseValue = (purse, denominations) => denominations.reduce((sum, d) => sum + (Number(purse?.[d.id]) || 0) * d.value, 0);

export const isEmptyPurse = purse => !Object.values(purse ?? {}).some(n => n > 0);

/** The fewest coins worth `value`, using no coin above `highest` (a denomination id; none = any). */
export function purseFromValue(value, denominations, highest = null) {
  const out = emptyPurse(denominations);
  const top = Math.max(0, denominations.findIndex(d => d.id === highest));
  let left = Math.max(0, Math.floor(value));
  denominations.forEach((d, i) => {
    if (i < top) return;
    out[d.id] = Math.floor(left / d.value);
    left -= out[d.id] * d.value;
  });
  return out;
}

export function addPurses(a, b, denominations) {
  const out = emptyPurse(denominations);
  for (const d of denominations) out[d.id] = (Number(a?.[d.id]) || 0) + (Number(b?.[d.id]) || 0);
  return out;
}

/** Each kind of coin divided as it is: { share, rest }. */
export function splitAsIs(purse, people, denominations) {
  const share = emptyPurse(denominations);
  const rest = emptyPurse(denominations);
  for (const d of denominations) {
    const n = Number(purse?.[d.id]) || 0;
    share[d.id] = people > 0 ? Math.floor(n / people) : 0;
    rest[d.id] = n - share[d.id] * people;
  }
  return { share, rest };
}

/** The same value for everyone, in the fewest coins: { share, rest }. */
export function splitByValue(purse, people, denominations, highest = null) {
  const total = purseValue(purse, denominations);
  const each = people > 0 ? Math.floor(total / people) : 0;
  return { share: purseFromValue(each, denominations, highest), rest: purseFromValue(total - each * people, denominations, highest) };
}
