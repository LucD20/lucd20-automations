import { MODULE_ID, localize, systemMatches } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { readHP } from "../core/hp.js";
import { broadcast, executeAsGM, onBroadcast, onGMRequest } from "../core/socket.js";
import { addChatControl } from "../core/chat-controls.js";
import { tokenArt, portraitHTML, PLACEHOLDER_PORTRAIT } from "./loot-pile.js";

/** Debug: `CONFIG.debug.lucd20Report = true` (or lucd20Rules) logs what is recorded. */
const dbg = (...args) => { if (CONFIG.debug?.lucd20Report || CONFIG.debug?.lucd20Rules) console.log("lucd20-automations | Encounter Report:", ...args); };

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
 * The report window (v0.84.3; was a chat card): opens for everyone at the end (option: GM only), with a
 * list of past encounters; reopened from the chat's buttons. One row per creature on the players' side that took part,
 * by name (v0.84.6; was best first):
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

const state = { feature: null, cache: new Map(), hints: [], pending: [], saveTimer: null, local: new Map(), dirty: new Set(), ended: new Set() };

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
  dbg("hint", hint.target, "←", hint.source, hint.kind ?? "");
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

/*
 * The data of a combat being recorded lives in `state.local` on the active GM's client (the truth) and is
 * copied to the combat's flag (to survive a reload). v0.84.6: a save that reaches the server after the
 * combat was deleted failed ("Cannot read properties of undefined (reading '_id')"); the end of the
 * combat now reads the local copy, and late saves are skipped.
 */
const localData = combat => {
  if (!combat?.id) return null;
  if (!state.local.has(combat.id)) {
    const saved = combat.getFlag?.(MODULE_ID, FLAG);
    if (saved) state.local.set(combat.id, foundry.utils.deepClone(saved));
  }
  return state.local.get(combat.id) ?? null;
};
const recording = combat => !!combat?.started && !!localData(combat);

/** Foundry's dispositions: FRIENDLY 1, NEUTRAL 0, HOSTILE -1, SECRET -2 (counted as hostile: hidden foes). */
function sideOf(token) {
  const d = token?.disposition ?? token?.document?.disposition;
  return d === 1 ? FRIENDLY : d === -1 || d === -2 ? HOSTILE : 0;
}

/**
 * Snapshot the participants when the combat starts: HP, side, name, picture, master.
 * The history is a world setting every client can read, so a name players can't see (PF2e
 * `playersCanSeeName`) is never stored: "Unknown creature" and the placeholder picture instead.
 */
async function startRecording(combat) {
  if (!game.user.isActiveGM || !combat?.started || typeof combat.getFlag !== "function" || localData(combat)) return;
  // An array, not keyed by UUID: Foundry reads the dots in "Actor.x" / "Scene.y.Token.z.Actor.x" keys as
  // nested paths when the flag is saved, and the lookups then find nobody (v0.84.4: "didn't track anything").
  const participants = [];
  for (const c of combat.combatants) {
    const actor = c.actor;
    if (!actor || participants.some(x => x.uuid === actor.uuid)) continue;
    const hp = readHP(actor);
    const master = activeAdapters().map(a => a.masterOf?.(actor)).find(Boolean) ?? null;
    const nameHidden = c.token?.playersCanSeeName === false;
    const art = nameHidden ? { src: PLACEHOLDER_PORTRAIT, scale: 1 } : tokenArt(c.token ?? actor.prototypeToken, actor);
    participants.push({
      uuid: actor.uuid, name: nameHidden ? localize("LUCD20.TurnAnnouncer.Unknown") : (c.token?.name ?? c.name ?? actor.name),
      img: art.src, scale: art.scale, side: sideOf(c.token), hp: hp ? hp.value + hp.temp : 0, master,
      hidden: !!c.hidden || !!c.token?.hidden
    });
    if (hp) state.cache.set(actor.uuid, hp);
  }
  state.local.set(combat.id, { participants, events: [] });
  await save(combat.id);
  dbg("recording", combat.id, participants.map(p => `${p.name} (side ${p.side}, ${p.hp} HP)`));
}

function onUpdateActor(actor) {
  if (!game.user.isActiveGM) return;
  const combat = game.combat;
  const before = state.cache.get(actor.uuid);
  const after = readHP(actor);
  if (after) state.cache.set(actor.uuid, after);
  const delta = before && after ? (before.value + before.temp) - (after.value + after.temp) : 0;
  if (delta) dbg("HP change", actor.name, -delta, { combat: combat?.id ?? null, started: !!combat?.started, recording: recording(combat) });
  if (!before || !after || !delta || !combat?.started) return;
  // A combat already running when the feature started (or whose start was missed): start now.
  if (!recording(combat)) startRecording(combat);
  const ev = {
    time: Date.now(), combat: combat.id, round: combat.round, turn: combat.combatant?.actor?.uuid ?? null,
    target: actor.uuid, amount: Math.abs(delta), kind: delta > 0 ? "damage" : "heal", source: null,
    down: delta > 0 && before.value > 0 && after.value <= 0
  };
  ev.source = takeHint(ev);
  dbg("event", ev.kind, ev.amount, actor.name, "source:", ev.source ?? "none yet", ev.down ? "(down)" : "");
  state.pending.push(ev);
  setTimeout(() => settle(ev), SETTLE_MS);
}

/**
 * An attack roll and whether it hit (from the system adapter; GM side). → an "attack" event.
 * outcome: "criticalSuccess" | "success" | "failure" | "criticalFailure".
 */
export function noteAttack(sourceUuid, outcome) {
  if (!game.user.isActiveGM || !sourceUuid || !outcome) return;
  const combat = game.combat;
  if (!recording(combat)) return;
  record(combat.id, { round: combat.round, turn: combat.combatant?.actor?.uuid ?? null, kind: "attack", source: sourceUuid, outcome });
  dbg("attack", sourceUuid, outcome);
}

/** After a moment (a late hint may still come), add the event to its combat. */
function settle(ev) {
  const i = state.pending.indexOf(ev);
  if (i < 0) return;
  state.pending.splice(i, 1);
  if (!ev.source) ev.source = takeHint(ev);
  record(ev.combat, stripEvent(ev));
}

function record(combatId, ev) {
  const data = state.local.get(combatId) ?? localData(game.combats?.get(combatId));
  if (!data) return;
  data.events.push(ev);
  state.dirty.add(combatId);
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSaves, 300);
}

const stripEvent = ({ round, turn, target, amount, kind, source, down }) => ({ round, turn, target, amount, kind, source, ...(down ? { down: true } : {}) });

async function save(id) {
  const combat = game.combats?.get(id);
  const data = state.local.get(id);
  if (!combat || !data || state.ended.has(id)) return;
  try {
    await combat.setFlag(MODULE_ID, FLAG, foundry.utils.deepClone(data));
  } catch (err) {
    dbg("save skipped (combat gone?)", id, err?.message);
  }
}

async function flushSaves() {
  const ids = [...state.dirty];
  state.dirty.clear();
  for (const id of ids) await save(id);
}

/* -------------------------------------------- */
/*  The report                                  */
/* -------------------------------------------- */

/**
 * The rows from a combat's recorded data. Pure (tests).
 * → { rows: [{ uuid, name, damage, companions, pct, onTurn, friendly, taken, healed }], missed }
 */
export function buildReport(data) {
  const list = data?.participants ?? [];
  const p = Array.isArray(list) ? Object.fromEntries(list.map(x => [x.uuid, x])) : list;
  const side = uuid => p[uuid]?.side ?? 0;
  const row = uuid => (rows[uuid] ??= { uuid, name: p[uuid]?.name ?? "?", img: p[uuid]?.img ?? null, damage: 0, companions: 0, onTurn: 0, friendly: 0, taken: 0, healed: 0 });
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
    .sort((a, b) => a.name.localeCompare(b.name));
  return { rows: out, missed, foes: buildFoes(p, data?.events ?? []) };
}

/**
 * Enemies (owner, v0.84.6: "Oh wow, that NPC barely did anything!" / "We killed that one in a round!"):
 * biggest hit dealt, best turn (most damage in one turn), biggest hit taken (and from whom), attacks hit,
 * the round it went down. Hidden combatants get no card; hidden names were never stored.
 */
function buildFoes(p, events) {
  const foes = {};
  const foe = uuid => (foes[uuid] ??= { uuid, name: p[uuid].name, img: p[uuid].img ?? null, scale: p[uuid].scale ?? 1, maxHit: 0, bestTurn: 0, maxTaken: 0, maxTakenBy: null, attacks: 0, hits: 0, crits: 0, down: null, turns: {} });
  const isFoe = uuid => p[uuid] && p[uuid].side === HOSTILE && !p[uuid].hidden;
  for (const uuid of Object.keys(p)) if (isFoe(uuid)) foe(uuid);
  for (const ev of events) {
    if (ev.kind === "attack") {
      if (!isFoe(ev.source)) continue;
      const f = foe(ev.source);
      f.attacks += 1;
      if (ev.outcome === "success" || ev.outcome === "criticalSuccess") f.hits += 1;
      if (ev.outcome === "criticalSuccess") f.crits += 1;
      continue;
    }
    if (ev.kind !== "damage") continue;
    if (isFoe(ev.source) && p[ev.target]?.side !== HOSTILE) {
      const f = foe(ev.source);
      f.maxHit = Math.max(f.maxHit, ev.amount);
      const key = `${ev.round}|${ev.turn}`;
      f.turns[key] = (f.turns[key] ?? 0) + ev.amount;
      f.bestTurn = Math.max(f.bestTurn, f.turns[key]);
    }
    if (isFoe(ev.target)) {
      const f = foe(ev.target);
      if (ev.amount > f.maxTaken) {
        f.maxTaken = ev.amount;
        f.maxTakenBy = ev.source && p[ev.source] && !p[ev.source].hidden ? p[ev.source].name : null;
      }
      if (ev.down && f.down == null) f.down = ev.round;
    }
  }
  return Object.values(foes).map(({ turns, ...f }) => f).sort((a, b) => a.name.localeCompare(b.name));
}

/** A token's picture as on the map (the Loot Pile's helper: ring art, scaled art standing out of its circle). */
const faceHTML = r => portraitHTML(r.img || PLACEHOLDER_PORTRAIT, "lpr-face", "", r.scale ?? 1);

/**
 * The report (v0.84.5, restyled in the Loot Pile's look; v0.84.6: just the stats, no ranking): totals on top,
 * the party's cards by name (portrait, name, damage, % of enemy HP, small stats; zeros faded), then the
 * enemies' cards (their own stats).
 */
export function reportHTML(report, { rounds = null } = {}) {
  const rows = report.rows ?? [];
  const sum = key => rows.reduce((n, r) => n + (r[key] || 0), 0);
  const tile = (key, value, icon) => `<div class="lpr-tile" data-tooltip="${esc(t(`Tile.${key}Hint`))}"><i class="fa-solid ${icon}"></i><b>${value}</b><span>${esc(t(`Tile.${key}`))}</span></div>`;
  const tiles = `<div class="lpr-tiles">
      ${tile("Damage", sum("damage"), "fa-burst")}
      ${tile("Taken", sum("taken"), "fa-shield-halved")}
      ${tile("Healed", sum("healed"), "fa-heart-pulse")}
      ${rounds != null ? tile("Rounds", rounds, "fa-hourglass-half") : ""}
    </div>`;
  const stat = (key, value, icon, label = t(`Col.${key}`), tip = t(`Col.${key}Hint`)) => `<span class="lpr-stat ${value ? "" : "is-zero"}" data-col="${key}" data-tooltip="${esc(tip)}"><i class="fa-solid ${icon}"></i><b>${value || 0}</b><span>${esc(label)}</span></span>`;
  const cards = rows.map(r => `<li class="lpr-row" data-uuid="${esc(r.uuid)}">
      ${faceHTML(r)}
      <div class="lpr-main">
        <div class="lpr-line"><span class="lpr-name" data-col="Name">${esc(r.name)}</span>
          <span class="lpr-dmg" data-col="Damage" data-tooltip="${esc(t("Col.DamageHint"))}"><b>${r.damage}</b>${r.companions ? ` <span class="lpr-plus">+${r.companions}</span>` : ""}</span>
          <span class="lpr-pct" data-col="Percent" data-tooltip="${esc(t("Col.PercentHint"))}">${r.pct}%</span></div>
        <div class="lpr-stats">${stat("OnTurn", r.onTurn, "fa-hourglass-start")}${stat("Friendly", r.friendly, "fa-people-arrows")}${stat("Taken", r.taken, "fa-shield-halved")}${stat("Healed", r.healed, "fa-heart-pulse")}</div>
      </div>
    </li>`).join("");
  const foes = (report.foes ?? []).map(f => {
    const fate = f.down != null ? t("Foe.Down", { round: f.down }) : t("Foe.Standing");
    const taken = f.maxTakenBy ? t("Foe.TakenBy", { name: f.maxTakenBy }) : t("Foe.Taken");
    const hits = f.attacks ? `<span class="lpr-stat" data-col="Hits" data-tooltip="${esc(t("Foe.HitsHint"))}"><i class="fa-solid fa-crosshairs"></i><b>${f.hits}/${f.attacks}</b><span>${esc(t("Foe.Hits"))}${f.crits ? ` (${esc(t("Foe.Crits", { n: f.crits }))})` : ""}</span></span>` : "";
    return `<li class="lpr-row lpr-foe" data-uuid="${esc(f.uuid)}">
      ${faceHTML(f)}
      <div class="lpr-main">
        <div class="lpr-line"><span class="lpr-name" data-col="Name">${esc(f.name)}</span>
          <span class="lpr-fate ${f.down != null ? "is-down" : ""}" data-col="Fate">${f.down != null ? '<i class="fa-solid fa-skull"></i> ' : ""}${esc(fate)}</span></div>
        <div class="lpr-stats">${stat("MaxHit", f.maxHit, "fa-burst", t("Foe.MaxHit"), t("Foe.MaxHitHint"))}${stat("BestTurn", f.bestTurn, "fa-hourglass-start", t("Foe.BestTurn"), t("Foe.BestTurnHint"))}${stat("MaxTaken", f.maxTaken, "fa-shield-halved", taken, t("Foe.TakenHint"))}${hits}</div>
      </div>
    </li>`;
  }).join("");
  const missed = report.missed ? `<p class="lpr-missed" data-tooltip="${esc(t("MissedHint"))}"><i class="fa-solid fa-circle-question"></i> ${esc(t("Missed", { n: report.missed }))}</p>` : "";
  return `<div class="lucd20-encounter-report">${tiles}
    ${cards ? `<h4 class="lpr-section">${esc(t("Party"))}</h4><ol class="lpr-rows">${cards}</ol>` : `<div class="lucd20-loot-empty"><i class="fa-solid fa-chart-column ll-empty-art"></i><span class="sub">${esc(t("Nothing"))}</span></div>`}
    ${foes ? `<h4 class="lpr-section">${esc(t("Enemies"))}</h4><ol class="lpr-rows">${foes}</ol>` : ""}
    ${missed}</div>`;
}

async function onDeleteCombat(combat) {
  if (!game.user.isActiveGM) return;
  state.ended.add(combat.id); // no more saves to it
  // Settle what is still pending right now.
  for (const ev of state.pending.filter(e => e.combat === combat.id)) {
    state.pending.splice(state.pending.indexOf(ev), 1);
    if (!ev.source) ev.source = takeHint(ev);
    localData(combat)?.events.push(stripEvent(ev));
  }
  const data = foundry.utils.deepClone(localData(combat));
  state.local.delete(combat.id);
  if (!data) return;
  const report = buildReport(data);
  dbg("combat ended", combat.id, data.events.length, "events", report);
  if (!data.events.some(e => e.kind !== "attack")) return;
  const scene = combat.scene?.name ?? game.scenes?.get(combat._source?.scene)?.name ?? canvas?.scene?.name ?? "";
  const entry = { at: Date.now(), scene, rounds: combat.round, ...report };
  try {
    const history = game.settings.get(MODULE_ID, HISTORY_KEY) ?? [];
    history.push(entry);
    await game.settings.set(MODULE_ID, HISTORY_KEY, history.slice(-20));
  } catch (err) { console.error("lucd20-automations | Encounter Report history", err); }
  // The window (owner, v0.84.3: "should be a window"), for everyone unless the option says GM only.
  const everyone = state.feature?.get("public") !== false;
  if (everyone) broadcast("encounterReport.show", {});
  ReportWindow.open();
}

/* -------------------------------------------- */
/*  The window                                  */
/* -------------------------------------------- */

const { ApplicationV2 } = foundry.applications.api;

const history = () => { try { return game.settings.get(MODULE_ID, HISTORY_KEY) ?? []; } catch { return []; } };
const canSee = () => game.user.isGM || state.feature?.get("public") !== false;

export class ReportWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "lucd20-encounter-report",
    classes: ["lucd20-loot-app", "lucd20-report-app"],
    window: { title: "LUCD20.EncounterReport.Title", icon: "fa-solid fa-chart-column", resizable: true },
    position: { width: 480, height: "auto" },
    actions: {}
  };

  /** Open on the newest report (or a given one: its index in the history). */
  static open(index = null) {
    if (!canSee()) return null;
    const app = foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id) ?? new this();
    const list = history();
    app.index = index ?? list.length - 1;
    return app.render({ force: true });
  }

  async _renderHTML() {
    const list = history();
    const entry = list[this.index] ?? list.at(-1);
    if (!entry) return `<div class="lucd20-loot-empty"><i class="fa-solid fa-chart-column ll-empty-art"></i><span class="sub">${esc(t("NoReports"))}</span></div>`;
    const options = list.map((e, i) => `<option value="${i}" ${list[this.index] === e || (!list[this.index] && i === list.length - 1) ? "selected" : ""}>${esc(t("Entry", { scene: e.scene || t("NoScene"), rounds: e.rounds === 1 ? t("RoundOne") : t("RoundsN", { n: e.rounds ?? "?" }), when: new Date(e.at).toLocaleString() }))}</option>`).reverse().join("");
    return `<div class="lucd20-report-body">
      <header class="lucd20-loot-taker lucd20-report-pick"><label>${esc(t("Encounter"))}</label><select class="pick">${options}</select></header>
      <div class="lucd20-report-scroll">${reportHTML(entry, { rounds: entry.rounds ?? null })}</div></div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    content.querySelector("select.pick")?.addEventListener("change", ev => { this.index = Number(ev.target.value); this.render(); });
  }
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
    onBroadcast("encounterReport.show", () => { if (state.feature?.active) ReportWindow.open(); });
  },
  enable(feature) {
    state.feature = feature;
    // Reopen the reports (history) from the chat's buttons.
    feature.onCleanup(addChatControl({
      id: "encounterReport", icon: "fa-solid fa-chart-column", tooltip: t("Title"), order: 41,
      visible: () => canSee() && history().length > 0,
      onClick: () => ReportWindow.open()
    }));
    feature.onCleanup(() => foundry.applications.instances?.get(ReportWindow.DEFAULT_OPTIONS.id)?.close());
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
