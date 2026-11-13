/**
 * Token Tooltip values. One value string per row, in one of three forms:
 *
 * 1. A data path, read from the actor's system data:  attributes.ac.value
 * 2. Text with {…} blocks. Inside a block, <path> or @path reads a value and
 *    the rest is a JavaScript expression; several statements are allowed and
 *    the last one is the result:
 *      P: {<stats.parry.value>}
 *      {@saves.fortitude.value + 10}
 *      {hp=<attributes.hp.value>; hpt=<attributes.hp.temp>; hpt ? concat(hp, " (", hpt, ")") : hp}
 *    The mathjs helpers used by Token Tooltip Alt work too (concat, string,
 *    typeOf, compareText, floor, ceil, round, abs, min, max), so old
 *    expressions can be pasted as they are.
 * 3. A script, when it contains "return": a JavaScript function body with
 *    token, actor, data (= actor.system) and _token (your token) — as in
 *    Token Tooltip Alt's functions.
 *
 * A row is hidden when its value (or any {…} block) is empty, null,
 * undefined or NaN, so "hide when there's nothing" needs no extra code.
 * Objects with value/max show as "value/max". Helpers (v0.28.0, so common
 * rows are one short call): hp(@attributes.hp [, "nice"]),
 * hpStatus(@attributes.hp [, "nice"]), dc(@saves.will.value),
 * speed("fly") (PF2e), fraction(@x), distance() (from your token, in scene
 * units), signed(n). HELPERS below lists them for the editor.
 *
 * Rows are written by the GM (a world setting) and run on every client, like
 * Token Tooltip Alt's functions.
 */

const cache = new Map(); // value string → compiled evaluator

export function getPath(obj, path) {
  if (!obj || !path) return undefined;
  let cur = obj;
  for (const part of String(path).trim().split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

/* -------------------------------------------- */
/*  Helpers available in expressions            */
/* -------------------------------------------- */

function typeOf(x) {
  if (x === null) return "null";
  if (x === undefined) return "undefined";
  if (Array.isArray(x)) return "Array";
  const t = typeof x;
  return t === "object" ? "Object" : t;
}

/** "nice" option: the owner's joke, "Nice" at 69 % of max HP (or exactly 69). */
function isNice(value, max) {
  return value === Math.floor(max * 0.69) || value === 69;
}

/** hp(@attributes.hp [, "nice"]) → "62", "62 (5)" with temp HP, "Ø" at 0. */
function hp(obj, option) {
  if (!obj || typeof obj !== "object") return obj;
  const { value, max } = obj;
  const temp = Number(obj.temp) || 0;
  if (typeof value !== "number") return undefined;
  if (value <= 0 && !temp) return "Ø";
  const base = option === "nice" && max > 0 && isNice(value, max) ? "Nice" : String(value);
  return temp ? `${base} (${temp})` : base;
}

/** hpStatus(@attributes.hp) or hpStatus(value, max) → Healthy / Grazed / Bloodied / Critical / Ø. */
function hpStatus(value, max, option) {
  if (value && typeof value === "object") return hpStatus(value.value, value.max, max);
  if (!(max > 0) || typeof value !== "number") return undefined;
  if (value <= 0) return "Ø";
  if (option === "nice" && isNice(value, max)) return "Nice";
  const r = value / max;
  if (r < 0.26) return "Critical";
  if (r < 0.51) return "Bloodied";
  if (r < 0.76) return "Grazed";
  return "Healthy";
}

/** dc(@saves.will.value) → the modifier + 10 (hidden when there's no modifier). */
function dc(mod) {
  if (mod && typeof mod === "object") mod = mod.value ?? mod.totalModifier ?? mod.mod;
  return typeof mod === "number" ? mod + 10 : undefined;
}

/** PF2e speed("fly"): that speed, hidden when the creature doesn't have it. */
function speed(type, actor) {
  const sys = actor?.system ?? {};
  const v = sys.movement?.speeds?.[type]?.value ?? (type === "land" ? sys.attributes?.speed?.total ?? sys.attributes?.speed?.value : sys.attributes?.speed?.otherSpeeds?.find?.(s => s.type === type)?.value);
  return v || undefined;
}

/** "value/max" from an object (or two numbers). */
function fraction(value, max) {
  if (value && typeof value === "object") return fraction(value.value, value.max);
  return typeof value === "number" ? (typeof max === "number" ? `${value}/${max}` : String(value)) : undefined;
}

const signed = n => (typeof n === "number" && !Number.isNaN(n) ? (n >= 0 ? `+${n}` : `${n}`) : n);

/** Distance from `from` to `to` in scene units, edge to edge, with elevation. */
export function tokenDistance(from, to) {
  if (!from || !to || from === to) return null;
  if (typeof from.distanceTo === "function") {
    try {
      const d = from.distanceTo(to); // PF2e: reach-aware, elevation included
      if (Number.isFinite(d)) return d;
    } catch {
      /* fall back below */
    }
  }
  const size = canvas.dimensions.size;
  const unit = canvas.dimensions.distance;
  const a = from.document;
  const b = to.document;
  const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width * size, b.x + b.width * size)) / size;
  const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height * size, b.y + b.height * size)) / size;
  // Height: the lower token is as tall as it is wide (Medium = 1 square).
  const low = (a.elevation ?? 0) <= (b.elevation ?? 0) ? a : b;
  const gapZ = Math.max(0, Math.abs((a.elevation ?? 0) - (b.elevation ?? 0)) - (low.width - 1) * unit) / unit;
  const [n1, n2, n3] = [Math.round(gapX), Math.round(gapY), Math.round(gapZ)].sort((x, y) => y - x);
  const D = CONST.GRID_DIAGONALS ?? {};
  const rule = canvas.grid?.diagonals;
  let squares;
  if (rule === D.EXACT) squares = Math.hypot(n1, n2, n3);
  else if (rule === D.ALTERNATING_1) squares = n1 + Math.floor(n2 / 2); // 5/10/5
  else if (rule === D.ALTERNATING_2) squares = n1 + Math.ceil(n2 / 2); // 10/5/10
  else if (rule === D.RECTILINEAR || rule === D.MANHATTAN) squares = n1 + n2 + n3;
  else squares = n1; // equidistant
  // Adjacent counts as one square (5 ft in PF2e), as Foundry's ruler does.
  return Math.round((squares + 1) * unit * 100) / 100;
}

/** Your token: controlled, else your character's token on this scene. */
export function referenceToken() {
  const controlled = canvas.tokens?.controlled?.[0];
  if (controlled) return controlled;
  return game.user.character?.getActiveTokens?.(false, false)?.[0] ?? null;
}

function baseScope(token) {
  const actor = token?.actor ?? null;
  const ref = referenceToken();
  const Ray = foundry.canvas?.geometry?.Ray ?? globalThis.Ray;
  return {
    token,
    actor,
    data: actor?.system ?? {},
    _token: ref,
    Ray,
    __get: path => getPath(actor?.system, path),
    distance: () => tokenDistance(ref, token) ?? undefined,
    hp,
    hpStatus,
    dc,
    speed: type => speed(type, actor),
    fraction,
    signed,
    concat: (...parts) => parts.map(p => (p === null || p === undefined ? "" : String(p))).join(""),
    string: x => (x === null || x === undefined ? "" : String(x)),
    typeOf,
    compareText: (a, b) => (String(a) === String(b) ? 0 : String(a) < String(b) ? -1 : 1),
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    abs: Math.abs,
    min: Math.min,
    max: Math.max
  };
}

/** A scope where unknown names fall back to globals, and assignments stay local. */
function sandbox(scope) {
  return new Proxy(scope, {
    // Everything is "in" the scope (so assignments stay local), except our own plumbing.
    has: (target, key) => key !== Symbol.unscopables && key !== "__code" && key !== "eval",
    get: (target, key) => (key in target ? target[key] : globalThis[key]),
    set: (target, key, value) => {
      target[key] = value;
      return true;
    }
  });
}

/* -------------------------------------------- */
/*  Compiling                                   */
/* -------------------------------------------- */

/** <path> and @path → __get("path") */
function rewritePaths(code) {
  return code
    .replace(/<\s*([A-Za-z_$][\w$]*(?:\.[\w$-]+)*)\s*>/g, (m, path) => `__get(${JSON.stringify(path)})`)
    .replace(/@([A-Za-z_$][\w$]*(?:\.[\w$-]+)*)/g, (m, path) => `__get(${JSON.stringify(path)})`);
}

/** Split "text {expr} text {expr}" into parts, respecting nested braces. */
function splitTemplate(value) {
  const parts = [];
  let i = 0;
  let text = "";
  while (i < value.length) {
    const ch = value[i];
    if (ch !== "{") {
      text += ch;
      i++;
      continue;
    }
    let depth = 1;
    let j = i + 1;
    let quote = null;
    while (j < value.length && depth) {
      const c = value[j];
      if (quote) {
        if (c === "\\") j++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      j++;
    }
    if (depth) {
      text += value.slice(i);
      break;
    }
    if (text) parts.push({ text });
    text = "";
    parts.push({ code: value.slice(i + 1, j - 1) });
    i = j;
  }
  if (text) parts.push({ text });
  return parts;
}

// eslint-disable-next-line no-new-func
const runExpression = new Function("__s", "__code", "with (__s) { return eval(__code); }");

function compile(value) {
  const src = String(value ?? "").trim();
  if (!src) return () => undefined;
  if (/(^|[\s;{])return\b/.test(src)) {
    // eslint-disable-next-line no-new-func
    const fn = new Function("__s", `with (__s) { ${src}\n}`);
    return token => fn(sandbox(baseScope(token)));
  }
  if (src.includes("{")) {
    const parts = splitTemplate(src).map(p => (p.code !== undefined ? { code: rewritePaths(p.code) } : p));
    return token => {
      const scope = sandbox(baseScope(token));
      let out = "";
      for (const part of parts) {
        if (part.text !== undefined) {
          out += part.text;
          continue;
        }
        const v = runExpression(scope, part.code);
        if (isEmpty(v)) return undefined;
        out += format(v);
      }
      return out;
    };
  }
  return token => getPath(token?.actor?.system, src);
}

export function isEmpty(v) {
  return v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));
}

/** Objects with value/max → "value/max"; arrays → list; booleans → ✓/✗. */
export function format(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(format).filter(Boolean).join(", ");
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (typeof v === "object") {
    if ("value" in v && "max" in v && v.max !== null && v.max !== undefined) return `${format(v.value)}/${format(v.max)}`;
    if ("value" in v) return format(v.value);
    if ("total" in v) return format(v.total);
    return "";
  }
  if (typeof v === "number") return String(Math.round(v * 100) / 100);
  return String(v);
}

/** Evaluate a row's value for a token; undefined = hide the row. Errors hide the row too. */
export function evaluate(value, token) {
  let fn = cache.get(value);
  try {
    if (!fn) {
      fn = compile(value);
      cache.set(value, fn);
    }
    const v = fn(token);
    if (isEmpty(v)) return undefined;
    const text = format(v);
    return text === "" ? undefined : text;
  } catch (err) {
    if (game.user?.isGM) console.warn(`lucd20-automations | Token Tooltip: "${String(value).slice(0, 60)}" failed:`, err.message);
    return undefined;
  }
}

export function clearCache() {
  cache.clear();
}

/** For the editor's helper list: signature, what it does, what to insert. */
export const HELPERS = [
  { sig: "hp(@attributes.hp)", insert: "{hp(@attributes.hp)}", key: "hp" },
  { sig: 'hp(@attributes.hp, "nice")', insert: '{hp(@attributes.hp, "nice")}', key: "hpNice" },
  { sig: "hpStatus(@attributes.hp)", insert: "{hpStatus(@attributes.hp)}", key: "hpStatus" },
  { sig: "dc(@saves.will.value)", insert: "{dc(@saves.will.value)}", key: "dc" },
  { sig: 'speed("fly")', insert: '{speed("fly")}', key: "speed" },
  { sig: "fraction(@resources.focus)", insert: "{fraction(@resources.focus)}", key: "fraction" },
  { sig: "distance()", insert: "~{ceil(distance())}", key: "distance" },
  { sig: "signed(@perception.value)", insert: "{signed(@perception.value)}", key: "signed" },
  { sig: "a ? b : c", insert: '{@x > 0 ? @x : ""}', key: "ternary" },
  { sig: "return …", insert: "return data.attributes.hp.value;", key: "script" }
];
