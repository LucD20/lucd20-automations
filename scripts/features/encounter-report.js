import { MODULE_ID, localize, systemMatches } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { readHP } from "../core/hp.js";
import { executeAsGM, onGMRequest } from "../core/socket.js";

/**
 * Encounter Report (owner, PLAN §26; v0.84.0). At the end of an encounter, a chat card with each ally's damage.
 *
 * Recording (the active GM's client, while a combat has started):
 * - Every HP change of a creature (value + temporary HP; the same reading as the Damage Log) is an event:
 *   { round, turn (the combatant whose turn it is), target, amount, kind: damage | heal, source }.
 * - The source comes from a "hint" the system adds for that target within a few seconds (before or after the
 *   HP change): PF2e's damage-applied message (its origin item's actor; persistent damage: the condition's
 *   origin), D&D 4e's damage buttons (the damage card's speaker). No hint → no source ("missed damage").
 * - Kept on the combat's flags; when the combat is deleted the card is posted and a summary goes to a world
 *   history (newest 20; for a later Dice Stats tab).
 *
 * The card (everyone sees it by default; option): one row per creature on the players' side that took part,
 * best first:
 *   Damage (dealt by itself to enemies; minions' / companions' damage also shown added to their master,
 *   "45 +12") | % of enemy HP (its damage ÷ the HP the enemies had when the combat started) | On its turn
 *   (damage to enemies by anyone on its side during its turn: the commander case) | Friendly fire | Taken |
 *   Healed.
 * "Missed damage: N" (damage with no known source) at the bottom, faded. Enemies get no rows (no names, no HP:
 * only percentages).
 */

const FLAG = "encounterReport";
const HISTORY_KEY = "encounterReport_history";
const HINT_WINDOW_MS = 4000;
const SETTLE_MS = 2000;
const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const t = (key, data) => localize(`LUCD20.EncounterReport.${key}`, data);
const FRIENDLY = 1, HOSTILE = -1;

const state = { feature: null, cache: new Map(), hints: [], pending: [], saveTimer: null };

/* -------------------------------------------- */
/*  System adapters                             */
/* -------------------------------------------- */

const adapters = [];

/** { system, mount(feature, noteSource) → cleanup, masterOf(actor) → uuid | null } */
export function registerEncounterReportAdapter(adapter) {
  adapters.push(adapter);
}
const activeAdapters = () => adapters.filter(a => !a.system || systemMatches(a.system));

/**
 * Tell the recorder who caused the next HP change of `targetUuid` (from any client; it reaches the GM).
 * kind: "damage" | "heal" | null (either).
 */
export async function noteSource(targetUuid, sourceUuid, kind = null) {
  if (!targetUuid || !sourceUuid) return;
  const hint = { target: targetUuid, source: sourceUuid, kind, time: Date.now() };
  if (game.user.isActiveGM) return addHint(hint);
  try { await executeAsGM("encounterReport.hint", hint); } catch { /* no GM: nothing to record */ }
}

function addHint(hint) {
  hint.time = Date.now();
  state.hints.push(hint);
  state.hints = state.hints.filter(h => Date.now() - h.time < HINT_WINDOW_MS * 2);
  // A hint arriving after its HP change (PF2e) resolves the pending event at once.
  const ev = state.pending.find(e => e.target === hint.target && !e.source && (!hint.kind || hint.kind === e.kind) && Math.abs(e.time - hint.time) < HINT_WINDOW_MS);
  if (ev) {
    ev.source = hint.source;
    hint.used = true;
  }
}

function takeHint(ev) {
  const hint = state.hints.find(h => !h.used && h.target === ev.target && (!h.kind || h.kind === ev.kind) && Math.abs(h.time - ev.time) < HINT_WINDOW_MS);
  if (!hint) return null;
  hint.used = true;
  return hint.source;
}

/* -------------------------------------------- */
/*  Recording                                   */
/* -------------------------------------------- */

const recording = combat => !!combat?.started && !!combat.getFlag?.(MODULE_ID, FLAG);

/** Foundry's dispositions: FRIENDLY 1, NEUTRAL 0, HOSTILE -1, SECRET -2 (counted as hostile: hidden foes). */
function sideOf(token) {
  const d = token?.disposition ?? token?.document?.disposition;
  return d === 1 ? FRIENDLY : d === -1 || d === -2 ? HOSTILE : 0;
}

/** Snapshot the participants when the combat starts: HP, side, name, master. */
async function startRecording(combat) {
  if (!game.user.isActiveGM || !combat?.started || typeof combat.getFlag !== "function" || combat.getFlag(MODULE_ID, FLAG)) return;
  const participants = {};
  for (const c of combat.combatants) {
    const actor = c.actor;
    if (!actor) continue;
    const hp = readHP(actor);
    const master = activeAdapters().map(a => a.masterOf?.(actor)).find(Boolean) ?? null;
    participants[actor.uuid] = { name: c.token?.name ?? c.name ?? actor.name, side: sideOf(c.token), hp: hp ? hp.value + hp.temp : 0, master, hidden: !!c.hidden || !!c.token?.hidden };
    if (hp) state.cache.set(actor.uuid, hp);
  }
  await combat.setFlag(MODULE_ID, FLAG, { participants, events: [] });
}

function onUpdateActor(actor) {
  if (!game.user.isActiveGM) return;
  const combat = game.combat;
  const before = state.cache.get(actor.uuid);
  const after = readHP(actor);
  if (after) state.cache.set(actor.uuid, after);
  if (!before || !after || !recording(combat)) return;
  const delta = (before.value + before.temp) - (after.value + after.temp);
  if (!delta) return;
  const ev = {
    time: Date.now(), round: combat.round, turn: combat.combatant?.actor?.uuid ?? null,
    target: actor.uuid, amount: Math.abs(delta), kind: delta > 0 ? "damage" : "heal", source: null
  };
  ev.source = takeHint(ev);
  state.pending.push(ev);
  setTimeout(() => settle(ev), SETTLE_MS);
}

/** After a moment (a late hint may still come), write the event to the combat. */
function settle(ev) {
  const i = state.pending.indexOf(ev);
  if (i < 0) return;
  state.pending.splice(i, 1);
  if (!ev.source) ev.source = takeHint(ev);
  const combat = game.combats?.find(c => recording(c) && c.active) ?? game.combat;
  if (!recording(combat)) return;
  (state.unsaved ??= new Map()).set(combat.id, [...(state.unsaved.get(combat.id) ?? []), stripEvent(ev)]);
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSaves, 300);
}

const stripEvent = ({ round, turn, target, amount, kind, source }) => ({ round, turn, target, amount, kind, source });

async function flushSaves() {
  const unsaved = state.unsaved ?? new Map();
  state.unsaved = new Map();
  for (const [id, events] of unsaved) {
    const combat = game.combats?.get(id);
    const data = combat?.getFlag(MODULE_ID, FLAG);
    if (!data) continue;
    await combat.setFlag(MODULE_ID, FLAG, { ...data, events: [...data.events, ...events] });
  }
}

/* -------------------------------------------- */
/*  The report                                  */
/* -------------------------------------------- */

/**
 * The rows from a combat's recorded data. Pure (tests).
 * → { rows: [{ uuid, name, damage, companions, pct, onTurn, friendly, taken, healed }], missed }
 */
export function buildReport(data) {
  const p = data?.participants ?? {};
  const side = uuid => p[uuid]?.side ?? 0;
  const row = uuid => (rows[uuid] ??= { uuid, name: p[uuid]?.name ?? "?", damage: 0, companions: 0, onTurn: 0, friendly: 0, taken: 0, healed: 0 });
  const rows = {};
  let missed = 0;
  for (const ev of data?.events ?? []) {
    if (ev.kind === "heal") {
      if (ev.source && p[ev.source]) row(ev.source).healed += ev.amount;
      continue;
    }
    if (p[ev.target]) row(ev.target).taken += ev.amount;
    if (!ev.source || !p[ev.source]) {
      missed += ev.amount;
    } else if (side(ev.source) !== side(ev.target)) {
      row(ev.source).damage += ev.amount;
      const master = p[ev.source].master;
      if (master && p[master]) row(master).companions += ev.amount;
    } else {
      row(ev.source).friendly += ev.amount;
    }
    // On a creature's turn: damage to its enemies by its side (or by an unknown source).
    const turn = ev.turn;
    if (turn && p[turn] && side(ev.target) !== side(turn) && (!ev.source || side(ev.source) === side(turn))) row(turn).onTurn += ev.amount;
  }
  const enemyHP = s => Object.values(p).filter(x => x.side !== s && x.side !== 0).reduce((n, x) => n + (x.hp || 0), 0);
  const out = Object.values(rows)
    .filter(r => side(r.uuid) === FRIENDLY && !p[r.uuid]?.hidden)
    .map(r => ({ ...r, pct: enemyHP(side(r.uuid)) ? Math.round((r.damage / enemyHP(side(r.uuid))) * 100) : 0 }))
    .sort((a, b) => b.damage + b.companions - (a.damage + a.companions) || a.name.localeCompare(b.name));
  return { rows: out, missed };
}

export function reportHTML(report) {
  const head = ["Name", "Damage", "Percent", "OnTurn", "Friendly", "Taken", "Healed"].map(k => `<th data-tooltip="${esc(t(`Col.${k}Hint`))}">${esc(t(`Col.${k}`))}</th>`).join("");
  const body = report.rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.damage}${r.companions ? ` <span class="lpr-plus">+${r.companions}</span>` : ""}</td><td>${r.pct}%</td><td>${r.onTurn}</td><td>${r.friendly || ""}</td><td>${r.taken}</td><td>${r.healed || ""}</td></tr>`).join("");
  const missed = report.missed ? `<p class="lpr-missed">${esc(t("Missed", { n: report.missed }))}</p>` : "";
  return `<div class="lucd20-encounter-report"><h3><i class="fa-solid fa-chart-column"></i> ${esc(t("Title"))}</h3>
    <table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="7">${esc(t("Nothing"))}</td></tr>`}</tbody></table>${missed}</div>`;
}

async function onDeleteCombat(combat) {
  if (!game.user.isActiveGM) return;
  // Settle what is still pending right now.
  for (const ev of [...state.pending]) {
    state.pending.splice(state.pending.indexOf(ev), 1);
    if (!ev.source) ev.source = takeHint(ev);
    (state.unsaved ??= new Map()).set(combat.id, [...(state.unsaved.get(combat.id) ?? []), stripEvent(ev)]);
  }
  const data = foundry.utils.deepClone(combat.getFlag?.(MODULE_ID, FLAG));
  if (!data) return;
  data.events = [...(data.events ?? []), ...(state.unsaved?.get(combat.id) ?? [])];
  state.unsaved?.delete(combat.id);
  const report = buildReport(data);
  if (!report.rows.length && !report.missed) return;
  const whisper = state.feature?.get("public") === false ? ChatMessage.getWhisperRecipients("GM").map(u => u.id) : [];
  await ChatMessage.create({ content: reportHTML(report), speaker: { alias: t("Title") }, whisper });
  try {
    const history = game.settings.get(MODULE_ID, HISTORY_KEY) ?? [];
    history.push({ at: Date.now(), scene: combat.scene?.name ?? "", rounds: combat.round, ...report });
    await game.settings.set(MODULE_ID, HISTORY_KEY, history.slice(-20));
  } catch { /* history is optional */ }
}

defineFeature({
  id: "encounterReport",
  category: "combat",
  defaultEnabled: true,
  gmOnly: true,
  settings: {
    public: { kind: "boolean", default: true }
  },
  init() {
    game.settings.register(MODULE_ID, HISTORY_KEY, { scope: "world", config: false, type: Array, default: [] });
    onGMRequest("encounterReport.hint", hint => { if (state.feature?.active) addHint(hint); return true; });
  },
  enable(feature) {
    state.feature = feature;
    for (const a of game.actors ?? []) { const hp = readHP(a); if (hp) state.cache.set(a.uuid, hp); }
    for (const tok of canvas?.tokens?.placeables ?? []) { const hp = tok.actor && readHP(tok.actor); if (hp) state.cache.set(tok.actor.uuid, hp); }
    feature.on("combatStart", combat => startRecording(combat));
    feature.on("updateCombat", combat => { if (combat.started) startRecording(combat); });
    feature.on("createToken", doc => { const hp = doc.actor && readHP(doc.actor); if (hp) state.cache.set(doc.actor.uuid, hp); });
    feature.on("updateActor", onUpdateActor);
    // Unlinked tokens (as the Damage Log): the token's own actor; the cache makes a second call a no-op.
    feature.on("updateToken", doc => { if (!doc?.actorLink && doc?.actor) onUpdateActor(doc.actor); });
    feature.on("updateActorDelta", delta => { const actor = delta?.parent?.actor; if (actor) onUpdateActor(actor); });
    feature.on("deleteCombat", onDeleteCombat);
    for (const adapter of activeAdapters()) {
      const cleanup = adapter.mount?.(feature, noteSource);
      if (typeof cleanup === "function") feature.onCleanup(cleanup);
    }
    if (game.combat?.started) startRecording(game.combat);
  }
});
