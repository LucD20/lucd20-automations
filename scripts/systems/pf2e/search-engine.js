import { MODULE_ID, error, localize } from "../../core/constants.js";
import { broadcast, onBroadcast } from "../../core/socket.js";

/**
 * Shared engine for PF2e Search Automation (search spots) and Hazard Detection.
 *
 * A "spot" is anything that can be found: a search-spot Region or a hazard
 * token. Every spot has: dc, minRank (0–4), note, found, failed (actor ids).
 *
 * - Who is Searching: the exploration activity chosen in PF2e's party sheet
 *   (character.system.exploration holds the ids of the chosen action items).
 * - The roll: PF2e's own Perception check, secret, as the Search action, so
 *   feats and items that change Search apply.
 * - One failed roll per character per spot; a success marks the spot found.
 * - On a find: pause, pan everyone's camera, "Found something..." over the
 *   finder's token for everyone, and a private card for the GM.
 */

export const RANKS = ["untrained", "trained", "expert", "master", "legendary"];
const esc = value => Handlebars.escapeExpression(String(value ?? ""));

/* -------------------------------------------- */
/*  Characters                                  */
/* -------------------------------------------- */

/** Player characters: the party's members, or every player-owned character. */
export function partyCharacters() {
  const party = game.actors.party ?? game.actors.find(a => a.type === "party");
  const members = party?.members?.filter(a => a?.type === "character");
  if (members?.length) return members;
  return game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
}

export function isSearching(actor) {
  const chosen = actor?.system?.exploration ?? [];
  return chosen.some(id => {
    const item = actor.items.get(id);
    return item && (item.slug === "search" || item.system?.slug === "search");
  });
}

export function perceptionRank(actor) {
  return Number(actor?.perception?.rank ?? actor?.system?.perception?.rank ?? 0) || 0;
}

/** The token of this character on the scene being viewed, if any. */
export function tokenOf(actor) {
  return actor?.getActiveTokens?.(false, false)?.[0] ?? null;
}

/* -------------------------------------------- */
/*  Rolling                                     */
/* -------------------------------------------- */

/**
 * Roll for every eligible character against a spot. Returns
 * { finders: [{actor, roll}], failed: [{actor, roll}], skipped: [{actor, reason}] }.
 * `allowNonSearching`: characters who aren't Searching also roll (hazards with
 * no minimum proficiency, when that option is on).
 */
export async function rollForSpot(spot, { allowNonSearching = false } = {}) {
  const result = { finders: [], failed: [], skipped: [] };
  for (const actor of partyCharacters()) {
    if (spot.failed.includes(actor.id)) {
      result.skipped.push({ actor, reason: "failed" });
      continue;
    }
    if (!isSearching(actor) && !(allowNonSearching && !spot.minRank)) {
      result.skipped.push({ actor, reason: "notSearching" });
      continue;
    }
    if (perceptionRank(actor) < spot.minRank) {
      result.skipped.push({ actor, reason: "rank" });
      continue;
    }
    let roll = null;
    try {
      roll = await actor.perception.roll({
        dc: { value: spot.dc },
        action: "search",
        traits: ["secret"],
        extraRollOptions: ["action:search", "secret"],
        messageMode: "gm",
        rollMode: "gmroll",
        skipDialog: true,
        // The rolls go into one private card instead of one message each.
        createMessage: false,
        label: localize("LUCD20.Search.RollLabel", { name: spot.label })
      });
    } catch (err) {
      error(`Search roll failed for ${actor.name}.`, err);
    }
    if (!roll) continue;
    (roll.degreeOfSuccess >= 2 ? result.finders : result.failed).push({ actor, roll });
  }
  return result;
}

/* -------------------------------------------- */
/*  Finding                                     */
/* -------------------------------------------- */

function settings() {
  const get = key => game.settings.get(MODULE_ID, `searchAutomation_${key}`);
  return { pause: get("pause"), pan: get("pan"), text: get("foundText") || localize("LUCD20.Search.FoundDefault"), card: get("gmCard") };
}

/** Pan to fit these points (canvas coordinates). Runs on every client. */
function panTo(points) {
  if (!canvas?.ready || !points.length) return;
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const margin = canvas.dimensions.size * 3;
  const width = Math.max(...xs) - Math.min(...xs) + margin * 2;
  const height = Math.max(...ys) - Math.min(...ys) + margin * 2;
  const scale = Math.min(window.innerWidth / width, window.innerHeight / height, canvas.stage.scale.x || 1, 1.5);
  canvas.animatePan({
    x: (Math.max(...xs) + Math.min(...xs)) / 2,
    y: (Math.max(...ys) + Math.min(...ys)) / 2,
    scale: Math.max(scale, 0.3),
    duration: 800
  });
}

function scrollingText(points, text) {
  if (!canvas?.ready) return;
  for (const point of points) {
    canvas.interface?.createScrollingText?.(point, text, {
      anchor: CONST.TEXT_ANCHOR_POINTS?.TOP ?? 2,
      direction: CONST.TEXT_ANCHOR_POINTS?.TOP ?? 2,
      distance: canvas.dimensions.size,
      fontSize: 32,
      fill: "#f3b469",
      stroke: 0x000000,
      strokeThickness: 4,
      duration: 3500
    });
  }
}

export function initSearchSockets() {
  onBroadcast("search.found", ({ points, finderPoints, text, pan }) => {
    if (pan) panTo(points);
    scrollingText(finderPoints, text);
  });
}

const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];

/** One line per roll: name, formula, natural d20, total, degree and margin. */
function rollLine({ actor, roll }, dc) {
  const degree = DEGREES[roll.degreeOfSuccess] ?? (roll.total >= dc ? "success" : "failure");
  const natural = roll.dice?.find(d => Number(d.faces) === 20)?.results?.find(r => r.active !== false)?.result;
  const margin = roll.total - dc;
  return `<li class="lucd20-search-roll ${degree}">
      <span class="who">${esc(actor.name)}</span>
      <span class="formula">${esc(roll.formula ?? "")}${natural ? ` <span class="nat">(${natural})</span>` : ""}</span>
      <span class="total">${roll.total}</span>
      <span class="degree">${localize(`LUCD20.Search.Degree.${degree}`)} <span class="margin">${margin >= 0 ? "+" : ""}${margin}</span></span>
    </li>`;
}

function gmCard(spot, result, how) {
  const found = result.finders.length > 0;
  const rolls = [...result.finders, ...result.failed].sort((a, b) => b.roll.total - a.roll.total);
  const cantRoll = result.skipped.filter(s => s.reason === "rank").map(({ actor }) =>
    `<li class="skipped">${esc(actor.name)} — ${localize("LUCD20.Search.RankTooLow", { rank: localize(`LUCD20.Search.Rank.${RANKS[spot.minRank]}`) })}</li>`).join("");
  const outcome = found
    ? localize("LUCD20.Search.FoundBy", { names: esc(result.finders.map(f => f.actor.name).join(", ")) })
    : localize("LUCD20.Search.NotFound");
  const lines = [
    `<header><i class="fa-solid ${found ? "fa-eye" : "fa-eye-slash"}"></i> <strong>${esc(spot.label)}</strong><span class="secret">${localize("LUCD20.Search.Secret")}</span></header>`,
    `<p class="lucd20-search-meta">${localize("LUCD20.Search.CardDC", { dc: spot.dc })}${spot.minRank ? ` · ${localize(`LUCD20.Search.Rank.${RANKS[spot.minRank]}`)}` : ""} · ${localize(`LUCD20.Search.How.${how}`)}</p>`,
    rolls.length ? `<ol class="lucd20-search-rolls">${rolls.map(r => rollLine(r, spot.dc)).join("")}</ol>` : "",
    cantRoll ? `<ul class="lucd20-search-skipped">${cantRoll}</ul>` : "",
    `<p class="lucd20-search-outcome ${found ? "found" : "missed"}">${outcome}</p>`,
    found && spot.note ? `<p class="lucd20-search-note"><i class="fa-solid fa-note-sticky"></i> ${esc(spot.note)}</p>` : "",
    found && !result.finders.some(f => tokenOf(f.actor)) ? `<p><em>${esc(settings().text)}</em></p>` : ""
  ];
  return ChatMessage.create({
    content: `<div class="lucd20-search-card ${found ? "found" : "missed"}">${lines.join("")}</div>`,
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    speaker: { alias: localize("LUCD20.Search.Speaker") }
  });
}

/**
 * Roll for a spot and handle the outcome. `save(patch)` stores found/failed on
 * the spot. `where` is the spot's centre (canvas coordinates) or null.
 * `how`: "entered" | "door" | "manual".
 */
export async function searchSpot(spot, { save, where, how, allowNonSearching = false, onFound }) {
  if (spot.found || !game.user.isActiveGM) return null;
  const result = await rollForSpot(spot, { allowNonSearching });
  if (!result.finders.length && !result.failed.length) return result;

  const failed = [...new Set([...spot.failed, ...result.failed.map(f => f.actor.id)])];
  const found = result.finders.length > 0;
  const rolls = { ...(spot.rolls ?? {}) };
  for (const { actor, roll } of [...result.finders, ...result.failed]) {
    rolls[actor.id] = { name: actor.name, total: roll.total, success: roll.degreeOfSuccess >= 2 };
  }
  await save({ failed, found, rolls });

  const s = settings();
  if (s.card && (found || result.failed.length)) await gmCard(spot, result, how);
  if (!found) return result;

  await onFound?.();
  if (s.pause && !game.paused) game.togglePause(true, { broadcast: true });
  const finderPoints = result.finders.map(f => tokenOf(f.actor)?.center).filter(Boolean);
  const points = [...finderPoints, where].filter(Boolean);
  const payload = { points, finderPoints, text: s.text, pan: s.pan };
  broadcast("search.found", payload);
  if (s.pan) panTo(points);
  scrollingText(finderPoints, s.text);
  return result;
}

/* -------------------------------------------- */
/*  Geometry                                    */
/* -------------------------------------------- */

export function blockedBySight(from, to) {
  const backend = CONFIG.Canvas?.polygonBackends?.sight;
  if (!backend?.testCollision) return false;
  try {
    return !!backend.testCollision(from, to, { type: "sight", mode: "any" });
  } catch {
    return false;
  }
}

/** Points along a token's move (so passing through an area counts), spaced half a square apart. */
export function pathPoints(from, to) {
  if (!from) return [to];
  const step = (canvas.dimensions?.size ?? 100) / 2;
  const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n }));
}

/**
 * Points covering a token's footprint (corners, edge midpoints and centre,
 * slightly inset) for a token whose centre is at `centre`. Any of them inside
 * an area means part of the token touches it.
 */
export function footprintPoints(centre, doc) {
  const size = canvas.dimensions?.size ?? 100;
  const hw = ((doc?.width ?? 1) * size) / 2 - 2;
  const hh = ((doc?.height ?? 1) * size) / 2 - 2;
  const pts = [];
  for (const fx of [-1, 0, 1]) for (const fy of [-1, 0, 1]) pts.push({ x: centre.x + fx * hw, y: centre.y + fy * hh });
  return pts;
}

/** Footprint points along a move: every sampled centre on the path, with the token's whole footprint. */
export function pathFootprint(from, to, doc) {
  return pathPoints(from, to).flatMap(c => footprintPoints(c, doc));
}

/** Pixels per scene distance unit (feet in PF2e). */
export function pixelsPerUnit() {
  const d = canvas.dimensions;
  return d.distancePixels ?? d.size / (d.distance || 5);
}
