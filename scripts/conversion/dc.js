/**
 * 1e → 2e DC conversion (PLAN §23.3), from the owner's DC sheet.
 * 2e DC = the level's DC (GM Core) + an offset that depends only on (1e DC − level).
 * Plain ES module with no Foundry calls: the Foundry tools and tools/convert/ (Node) share it.
 */

/** GM Core "DCs by level", levels 0–25. */
export const LEVEL_DC = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40,
  42, 44, 46, 48, 50];

/** Offset by (1e DC − level), from −3 to +27; below / above are capped. */
const OFFSET = [-10, -9, -8, -7, -6, -5, -4, -4, -3, -3, -2, -2, -1, -1, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 6, 7, 8,
  9, 10];
const FIRST = -3;

/** The sheet's minimum proficiency (colour bands; the label row is a band's last row), by (1e DC − level). */
const PROFICIENCY = [[6, "untrained"], [11, "trained"], [16, "expert"], [21, "master"], [Infinity, "legendary"]];

/** The sheet's difficulty (grey lines; the label row is a band's first row), by (1e DC − level). */
const DIFFICULTY = [[27, "incredibly-hard"], [22, "very-hard"], [17, "hard"], [12, "average"], [7, "easy"],
  [2, "very-easy"], [-Infinity, "incredibly-easy"]];

/**
 * Starfinder 1e DCs run 4 higher than Pathfinder 1e's for the same difficulty (the sheet's "SF DC" tab);
 * the sheet uses 3 at levels 14, 17 and 19 (hand edits, "+4-1"; Q309 asks whether they are meant).
 */
export const SOURCE_SHIFT = { pf1e: 0, sf1e: 4 };
const SHIFT_BY_LEVEL = { sf1e: { 14: 3, 17: 3, 19: 3 } };

export function levelDc(level) {
  const i = Math.max(0, Math.min(LEVEL_DC.length - 1, Math.round(Number(level) || 0)));
  return LEVEL_DC[i];
}

/**
 * @param {number} dc1e  the 1e DC
 * @param {number} level the party level
 * @param {"pf1e"|"sf1e"} [source]
 * @returns {{ dc: number, offset: number, proficiency: string, difficulty: string, capped: boolean }}
 */
export function convertDc(dc1e, level, source = "pf1e") {
  const shift = SHIFT_BY_LEVEL[source]?.[Math.round(level)] ?? SOURCE_SHIFT[source] ?? 0;
  const diff = Math.round(dc1e) - shift - Math.round(level);
  const i = diff - FIRST;
  const capped = i < 0 || i >= OFFSET.length;
  const offset = OFFSET[Math.max(0, Math.min(OFFSET.length - 1, i))];
  const proficiency = PROFICIENCY.find(([max]) => diff <= max)[1];
  const difficulty = DIFFICULTY.find(([min]) => diff >= min)[1];
  return { dc: levelDc(level) + offset, offset, proficiency, difficulty, capped };
}
