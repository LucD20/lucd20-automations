import { MODULE_ID, error, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { appElement } from "../core/dom.js";

/**
 * Dice Stats (replaces Dice Stats).
 *
 * - The active GM's client records every die of every roll message, per user.
 * - Two counters: All time (never reset) and Session. When the GM joins, a
 *   prompt asks "Start a new session?" — Yes clears Session only.
 * - Everyone can see everyone's stats (GM included as a player).
 * - Blind rolls (and the GM's whispered rolls) go to a GM-only pool, so players
 *   can't learn secret results from the stats.
 * - System adapters split d20 checks by type and degree of success (PF2e).
 * - Opened from a button at the bottom of the Actors tab.
 *
 * Stored in a world setting: { users: { id: { allTime: Pool, session: Pool } }, sessionStart }
 * Pool = { public: Stats, hidden: Stats }
 * Stats = { rolls, dice: { faces: { n, sum, dist: { result: n } } },
 *           checks: { type: { n, sum, nat1, nat20, outcomes: { criticalSuccess, success, failure, criticalFailure } } } }
 */

const DATA_KEY = "diceStats_data";
const OUTCOMES = ["criticalSuccess", "success", "failure", "criticalFailure"];
const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const { ApplicationV2, DialogV2 } = foundry.applications.api;

const state = { feature: null, data: null, saveTimer: null, view: { period: "session", includeHidden: true } };

/* -------------------------------------------- */
/*  System adapters                             */
/* -------------------------------------------- */

const adapters = [];

/** { system: "pf2e", check(message) → { type, outcome } | null, types: { type: "label key" } } */
export function registerDiceStatsAdapter(adapter) {
  adapters.push(adapter);
}

const activeAdapter = () => adapters.find(a => !a.system || a.system === game.system.id) ?? null;

/* -------------------------------------------- */
/*  Data                                        */
/* -------------------------------------------- */

const emptyStats = () => ({ rolls: 0, dice: {}, checks: {} });
const emptyPool = () => ({ public: emptyStats(), hidden: emptyStats() });
const emptyData = () => ({ users: {}, sessionStart: Date.now() });

function userRecord(userId) {
  state.data.users[userId] ??= { allTime: emptyPool(), session: emptyPool() };
  return state.data.users[userId];
}

/** Active results of every die in a roll: [{ faces, result }]. */
function dieResults(roll) {
  const out = [];
  for (const die of roll.dice ?? []) {
    const faces = Number(die.faces);
    if (!faces) continue;
    for (const r of die.results ?? []) {
      if (r.active === false || r.discarded) continue;
      out.push({ faces, result: Number(r.result) });
    }
  }
  return out;
}

function addToStats(stats, rolls, check) {
  for (const roll of rolls) {
    stats.rolls += 1;
    for (const { faces, result } of dieResults(roll)) {
      const d = (stats.dice[faces] ??= { n: 0, sum: 0, dist: {} });
      d.n += 1;
      d.sum += result;
      d.dist[result] = (d.dist[result] ?? 0) + 1;
    }
  }
  if (check) {
    const natural = rolls.map(r => dieResults(r).find(x => x.faces === 20)).find(Boolean)?.result;
    if (natural) {
      const c = (stats.checks[check.type] ??= { n: 0, sum: 0, nat1: 0, nat20: 0, outcomes: {} });
      c.n += 1;
      c.sum += natural;
      if (natural === 1) c.nat1 += 1;
      if (natural === 20) c.nat20 += 1;
      if (OUTCOMES.includes(check.outcome)) c.outcomes[check.outcome] = (c.outcomes[check.outcome] ?? 0) + 1;
    }
  }
}

function onChatMessage(message) {
  if (!game.user.isActiveGM || !state.data) return;
  const rolls = message.rolls ?? [];
  if (!rolls.length) return;
  const author = message.author ?? message.user;
  if (!author?.id) return;

  const whispered = (message.whisper?.length ?? 0) > 0;
  const hidden = !!message.blind || (author.isGM && whispered);
  let check = null;
  try {
    check = activeAdapter()?.check?.(message) ?? null;
  } catch (err) {
    error("Dice Stats adapter failed.", err);
  }

  const record = userRecord(author.id);
  for (const pool of [record.allTime, record.session]) addToStats(hidden ? pool.hidden : pool.public, rolls, check);
  scheduleSave();
  render();
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(save, 1000);
}

async function save() {
  try {
    await game.settings.set(MODULE_ID, DATA_KEY, state.data);
  } catch (err) {
    error("Could not save dice stats.", err);
  }
}

async function resetSession() {
  for (const record of Object.values(state.data.users)) record.session = emptyPool();
  state.data.sessionStart = Date.now();
  await save();
  render();
}

async function askNewSession() {
  const confirmed = await DialogV2.confirm({
    window: { title: localize("LUCD20.DiceStats.NewSessionTitle"), icon: "fa-solid fa-chart-simple" },
    content: `<p>${localize("LUCD20.DiceStats.NewSessionContent")}</p>`
  });
  if (confirmed) await resetSession();
}

/* -------------------------------------------- */
/*  View model                                  */
/* -------------------------------------------- */

function mergeStats(a, b) {
  const out = foundry.utils.deepClone(a);
  out.rolls += b.rolls;
  for (const [faces, d] of Object.entries(b.dice)) {
    const t = (out.dice[faces] ??= { n: 0, sum: 0, dist: {} });
    t.n += d.n;
    t.sum += d.sum;
    for (const [r, n] of Object.entries(d.dist)) t.dist[r] = (t.dist[r] ?? 0) + n;
  }
  for (const [type, c] of Object.entries(b.checks)) {
    const t = (out.checks[type] ??= { n: 0, sum: 0, nat1: 0, nat20: 0, outcomes: {} });
    t.n += c.n;
    t.sum += c.sum;
    t.nat1 += c.nat1;
    t.nat20 += c.nat20;
    for (const o of OUTCOMES) if (c.outcomes[o]) t.outcomes[o] = (t.outcomes[o] ?? 0) + c.outcomes[o];
  }
  return out;
}

function statsFor(userId) {
  const record = state.data?.users?.[userId];
  if (!record) return emptyStats();
  const pool = record[state.view.period] ?? emptyPool();
  return game.user.isGM && state.view.includeHidden ? mergeStats(pool.public, pool.hidden) : pool.public;
}

const fmt = (n, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : "—");

function distributionHTML(d20) {
  const counts = Array.from({ length: 20 }, (_, i) => d20?.dist?.[i + 1] ?? 0);
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const bars = counts.map((n, i) => {
    const pct = total ? (n / total) * 100 : 0;
    const tip = localize("LUCD20.DiceStats.BarTip", { face: i + 1, count: n, pct: fmt(pct) });
    return `<div class="ds-bar-slot" data-tooltip="${esc(tip)}"><div class="ds-bar" style="height:${(n / max) * 100}%"></div></div>`;
  }).join("");
  const ticks = Array.from({ length: 20 }, (_, i) => `<span>${[1, 5, 10, 15, 20].includes(i + 1) ? i + 1 : ""}</span>`).join("");
  return `<div class="ds-dist" role="img" aria-label="${esc(localize("LUCD20.DiceStats.Distribution"))}">
      <div class="ds-bars">${bars}</div><div class="ds-ticks">${ticks}</div></div>`;
}

function outcomeBarHTML(outcomes) {
  const total = OUTCOMES.reduce((a, o) => a + (outcomes[o] ?? 0), 0);
  if (!total) return `<span class="ds-muted">—</span>`;
  const segs = OUTCOMES.filter(o => outcomes[o]).map(o => {
    const n = outcomes[o];
    const pct = (n / total) * 100;
    const tip = `${localize(`LUCD20.DiceStats.Outcome.${o}`)}: ${n} (${fmt(pct)}%)`;
    return `<div class="ds-seg ds-${o}" style="flex-grow:${n}" data-tooltip="${esc(tip)}">${pct >= 12 ? n : ""}</div>`;
  }).join("");
  return `<div class="ds-outcomes">${segs}</div>`;
}

function userCardHTML(user, stats) {
  const d20 = stats.dice[20];
  const nat = r => d20?.dist?.[r] ?? 0;
  const other = Object.entries(stats.dice)
    .filter(([faces]) => faces !== "20")
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([faces, d]) => `<span class="ds-chip">d${faces} <b>×${d.n}</b> · ${localize("LUCD20.DiceStats.Avg")} ${fmt(d.sum / d.n)}</span>`)
    .join("");

  const adapter = activeAdapter();
  const checkRows = adapter
    ? Object.keys(adapter.types).filter(t => stats.checks[t]?.n).map(t => {
        const c = stats.checks[t];
        return `<tr><th scope="row">${esc(localize(adapter.types[t]))}</th><td>${c.n}</td><td>${fmt(c.sum / c.n)}</td>
          <td>${c.nat20}</td><td>${c.nat1}</td><td class="ds-outcome-cell">${outcomeBarHTML(c.outcomes)}</td></tr>`;
      }).join("")
    : "";

  return `
    <section class="ds-card">
      <header class="ds-card-header">
        <span class="ds-user-dot" style="background:${esc(user.color?.css ?? user.color ?? "#888")}"></span>
        <h3>${esc(user.name)}</h3>
        <span class="ds-muted">${localize("LUCD20.DiceStats.Rolls", { count: stats.rolls })}</span>
      </header>
      ${d20?.n ? `
        <div class="ds-d20-summary">
          <span><b>d20</b> ×${d20.n}</span>
          <span>${localize("LUCD20.DiceStats.Avg")} <b>${fmt(d20.sum / d20.n)}</b></span>
          <span>${localize("LUCD20.DiceStats.Nat20")} <b>${nat(20)}</b></span>
          <span>${localize("LUCD20.DiceStats.Nat1")} <b>${nat(1)}</b></span>
        </div>
        ${distributionHTML(d20)}` : `<p class="ds-muted">${localize("LUCD20.DiceStats.NoD20")}</p>`}
      ${checkRows ? `
        <table class="ds-checks">
          <thead><tr><th>${localize("LUCD20.DiceStats.Check")}</th><th>${localize("LUCD20.DiceStats.Count")}</th>
            <th>${localize("LUCD20.DiceStats.Avg")}</th><th>20</th><th>1</th><th>${localize("LUCD20.DiceStats.Result")}</th></tr></thead>
          <tbody>${checkRows}</tbody>
        </table>` : ""}
      ${other ? `<div class="ds-chips">${other}</div>` : ""}
    </section>`;
}

function windowHTML() {
  const users = game.users
    .filter(u => state.data?.users?.[u.id])
    .sort((a, b) => (a.isGM - b.isGM) || a.name.localeCompare(b.name));
  const rows = users.map(u => ({ user: u, stats: statsFor(u.id) })).filter(r => r.stats.rolls > 0);
  const session = state.view.period === "session";
  const since = new Date(state.data?.sessionStart ?? Date.now()).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

  const summary = rows.length ? `
    <table class="ds-summary">
      <thead><tr><th>${localize("LUCD20.DiceStats.Player")}</th><th>${localize("LUCD20.DiceStats.Count")}</th>
        <th>${localize("LUCD20.DiceStats.D20Avg")}</th><th>${localize("LUCD20.DiceStats.Nat20")}</th><th>${localize("LUCD20.DiceStats.Nat1")}</th></tr></thead>
      <tbody>${rows.map(({ user, stats }) => {
        const d = stats.dice[20];
        return `<tr><th scope="row">${esc(user.name)}</th><td>${stats.rolls}</td><td>${d?.n ? fmt(d.sum / d.n) : "—"}</td>
          <td>${d?.dist?.[20] ?? 0}</td><td>${d?.dist?.[1] ?? 0}</td></tr>`;
      }).join("")}</tbody>
    </table>` : "";

  const adapter = activeAdapter();
  const legend = adapter ? `<div class="ds-legend">${OUTCOMES.map(o =>
    `<span><i class="ds-swatch ds-${o}"></i>${localize(`LUCD20.DiceStats.Outcome.${o}`)}</span>`).join("")}</div>` : "";

  return `
    <div class="ds-root">
      <nav class="ds-toolbar">
        <div class="ds-segmented">
          <button type="button" data-action="period" data-period="session" class="${session ? "active" : ""}">${localize("LUCD20.DiceStats.Session")}</button>
          <button type="button" data-action="period" data-period="allTime" class="${!session ? "active" : ""}">${localize("LUCD20.DiceStats.AllTime")}</button>
        </div>
        ${session ? `<span class="ds-muted">${localize("LUCD20.DiceStats.Since", { date: since })}</span>` : ""}
        ${game.user.isGM ? `
          <label class="ds-hidden-toggle"><input type="checkbox" data-action="hidden" ${state.view.includeHidden ? "checked" : ""}> ${localize("LUCD20.DiceStats.IncludeHidden")}</label>
          <button type="button" class="ds-new-session" data-action="newSession"><i class="fa-solid fa-rotate"></i> ${localize("LUCD20.DiceStats.NewSession")}</button>` : ""}
      </nav>
      <div class="ds-scroll">
        ${rows.length ? summary + legend + rows.map(r => userCardHTML(r.user, r.stats)).join("") : `<p class="ds-empty">${localize("LUCD20.DiceStats.Empty")}</p>`}
      </div>
    </div>`;
}

/* -------------------------------------------- */
/*  Window                                      */
/* -------------------------------------------- */

class DiceStatsWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "lucd20-dice-stats",
    classes: ["lucd20-dice-stats"],
    window: { title: "LUCD20.DiceStats.Title", icon: "fa-solid fa-chart-simple", resizable: true },
    position: { width: 560, height: 680 },
    actions: {
      period: DiceStatsWindow.#onPeriod,
      hidden: DiceStatsWindow.#onHidden,
      newSession: DiceStatsWindow.#onNewSession
    }
  };

  static get instance() {
    return foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id) ?? null;
  }

  static open() {
    return (this.instance ?? new this()).render({ force: true });
  }

  async _renderHTML() {
    return windowHTML();
  }

  _replaceHTML(result, content) {
    const top = content.querySelector(".ds-scroll")?.scrollTop ?? 0;
    content.innerHTML = result;
    const scroll = content.querySelector(".ds-scroll");
    if (scroll) scroll.scrollTop = top;
  }

  static #onPeriod(event, target) {
    state.view.period = target.dataset.period;
    this.render();
  }

  static #onHidden(event, target) {
    state.view.includeHidden = target.checked;
    this.render();
  }

  static async #onNewSession() {
    await askNewSession();
  }
}

function render() {
  const app = DiceStatsWindow.instance;
  if (app?.rendered) app.render();
}

/** Button at the bottom of the Actors tab. */
function addDirectoryButton(app, html) {
  const root = (html instanceof HTMLElement ? html : html?.[0]) ?? appElement(app);
  if (!root || root.querySelector(".lucd20-dice-stats-open")) return;
  let footer = root.querySelector(".directory-footer");
  if (!footer) {
    footer = document.createElement("footer");
    footer.className = "directory-footer action-buttons lucd20-directory-footer";
    root.append(footer);
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lucd20-dice-stats-open";
  button.innerHTML = `<i class="fa-solid fa-chart-simple"></i> ${localize("LUCD20.DiceStats.Title")}`;
  button.addEventListener("click", event => {
    event.preventDefault();
    DiceStatsWindow.open();
  });
  footer.append(button);
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

defineFeature({
  id: "diceStats",
  category: "statistics",
  scope: "world",
  defaultEnabled: false,
  settings: {
    askNewSession: { kind: "boolean", default: true }
  },

  init() {
    game.settings.register(MODULE_ID, DATA_KEY, {
      scope: "world",
      config: false,
      type: Object,
      default: emptyData(),
      onChange: value => {
        if (game.user.isActiveGM) return; // the GM's copy is the source
        state.data = value ?? emptyData();
        render();
      }
    });
  },

  enable(feature) {
    state.feature = feature;
    state.data = foundry.utils.deepClone(game.settings.get(MODULE_ID, DATA_KEY) ?? emptyData());
    state.data.users ??= {};
    feature.on("createChatMessage", onChatMessage);
    feature.on("renderActorDirectory", addDirectoryButton);
    if (ui.actors) addDirectoryButton(ui.actors, appElement(ui.actors));

    if (game.user.isGM && feature.get("askNewSession") && !state.askedThisLoad) {
      state.askedThisLoad = true;
      askNewSession();
    }

    feature.onCleanup(() => {
      if (state.saveTimer) {
        clearTimeout(state.saveTimer);
        save();
      }
      document.querySelectorAll(".lucd20-dice-stats-open, .lucd20-directory-footer:empty").forEach(el => el.remove());
      DiceStatsWindow.instance?.close();
      state.feature = null;
    });
  }
});

