/**
 * Import a Token Tooltip Alt export ({ gmSettings, playerSettings }) into
 * our rows. TTA keeps separate lists per GM/player × actor type × disposition
 * (players also have OWNED); here each distinct row (icon + colour + value)
 * becomes one row with "who" and "types" worked out from where it appeared:
 *
 * - shown to players on owned, friendly, neutral and hostile tokens → all
 * - owned + friendly (not hostile/neutral)                              → friendly
 * - owned only                                                          → owner
 * - only in players' lists, never the GM's (e.g. HP status words)       → others
 * - only in the GM's lists                                              → gm
 * - types: the actor types it appeared on (all of them → no filter)
 *
 * An actor type whose lists are all empty uses TTA's "default" lists, as TTA
 * does when a type isn't customised. Values are kept as they are (TTA paths,
 * {…} expressions and functions all work here).
 */

const PLAYER_SIDES = ["OWNED", "FRIENDLY", "NEUTRAL", "HOSTILE", "SECRET"];

function lists(side) {
  // side: { default: {items:[{disposition, items:[]}]}, character: {...}, ... }
  const out = {};
  for (const [type, block] of Object.entries(side ?? {})) {
    const byDisposition = {};
    let any = false;
    for (const entry of block?.items ?? []) {
      byDisposition[entry.disposition] = entry.items ?? [];
      if (entry.items?.length) any = true;
    }
    out[type] = { lists: byDisposition, custom: any };
  }
  return out;
}

export function importTTA(json, actorTypes = []) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  if (!data || (!data.gmSettings && !data.playerSettings)) throw new Error("Not a Token Tooltip Alt export.");
  const gm = lists(data.gmSettings);
  const player = lists(data.playerSettings);
  const types = [...new Set([...actorTypes, ...Object.keys(gm), ...Object.keys(player)].filter(t => t !== "default"))];

  const rows = new Map(); // key → { row, gm: Set(types), player: Map(type → Set(dispositions)) }
  const order = [];
  const visit = (side, type, disposition, item) => {
    const key = `${item.icon}|${item.color}|${item.value}`;
    let entry = rows.get(key);
    if (!entry) {
      entry = { row: { icon: item.icon || "fa-circle", color: item.color || "#ffffff", value: String(item.value ?? "") }, gmTypes: new Set(), playerTypes: new Map() };
      rows.set(key, entry);
      order.push(key);
    }
    if (side === "gm") entry.gmTypes.add(type);
    else {
      if (!entry.playerTypes.has(type)) entry.playerTypes.set(type, new Set());
      entry.playerTypes.get(type).add(disposition);
    }
  };

  for (const [side, source] of [["gm", gm], ["player", player]]) {
    for (const type of types) {
      const block = source[type]?.custom ? source[type] : source.default;
      if (!block) continue;
      for (const [disposition, items] of Object.entries(block.lists)) {
        for (const item of items) visit(side, type, disposition, item);
      }
    }
  }

  return order.map(key => {
    const { row, gmTypes, playerTypes } = rows.get(key);
    const dispositions = new Set();
    for (const set of playerTypes.values()) for (const d of set) dispositions.add(d);
    const has = d => dispositions.has(d);
    let who;
    if (!gmTypes.size) who = "others"; // players only (e.g. HP status words next to the GM's numbers)
    else if (has("OWNED") && has("FRIENDLY") && (has("NEUTRAL") || has("HOSTILE"))) who = "all";
    else if (has("OWNED") && has("FRIENDLY")) who = "friendly";
    else if (has("OWNED")) who = "owner";
    else if (dispositions.size) who = "all";
    else who = "gm";
    const used = new Set([...gmTypes, ...playerTypes.keys()]);
    const typeList = types.every(t => used.has(t)) ? [] : [...used];
    return { ...row, who, types: typeList };
  });
}

export { PLAYER_SIDES };
