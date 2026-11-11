import { MODULE_ID, error, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { appElement } from "../core/dom.js";
import { addChatControl, refreshChatControls } from "../core/chat-controls.js";
import { addFlushContributor } from "../core/chat-flush.js";

/**
 * Damage Log (replaces Damage Log).
 *
 * - A "Damage Log" toggle next to the chat buttons switches the chat sidebar
 *   between the chat and the log.
 * - The active GM's client records every HP change (damage, healing, temporary
 *   HP, max HP) by comparing each actor's HP with the last value it saw, so it
 *   works no matter who or what changed it (including unlinked tokens).
 * - Entries are kept in a world setting (newest N), survive Clear Chat, and
 *   have their own Clear button. Clear Chat offers "also clear the Damage Log".
 * - Players only see entries for tokens whose HP bar they can see.
 *   (The data itself is in a world setting, which players' clients receive.)
 * - System adapters add detail (PF2e: the "damage applied" message as cause).
 */

const ENTRIES_KEY = "damageLog_entries";
const esc = value => Handlebars.escapeExpression(String(value ?? ""));

const state = {
  feature: null,
  entries: [],
  cache: new Map(), // actor uuid → { value, max, temp }
  showing: false,
  saveTimer: null
};

/* -------------------------------------------- */
/*  System adapters                             */
/* -------------------------------------------- */

const adapters = [];

/**
 * Systems can add detail:
 *   { system: "pf2e", causeFromMessage(message) → { actorUuid, text, messageId } | null }
 */
export function registerDamageLogAdapter(adapter) {
  adapters.push(adapter);
}

const activeAdapters = () => adapters.filter(a => !a.system || a.system === game.system.id);

/* -------------------------------------------- */
/*  Reading HP                                  */
/* -------------------------------------------- */

/** Where this actor keeps HP. Works for PF2e, D&D 4e and other systems using attributes.hp. */
function hpPaths(actor) {
  const a = actor?.system?.attributes;
  if (!a?.hp || typeof a.hp.value !== "number") return null;
  let temp = null;
  if (typeof a.hp.temp === "number") temp = "system.attributes.hp.temp";
  else if (typeof a.temphp?.value === "number") temp = "system.attributes.temphp.value";
  return { value: "system.attributes.hp.value", max: "system.attributes.hp.max", temp };
}

function readHP(actor) {
  const paths = hpPaths(actor);
  if (!paths) return null;
  const get = path => (path ? Number(foundry.utils.getProperty(actor, path)) || 0 : 0);
  return { value: get(paths.value), max: get(paths.max), temp: get(paths.temp) };
}

function remember(actor) {
  const hp = readHP(actor);
  if (hp && actor.uuid) state.cache.set(actor.uuid, hp);
}

function snapshotAll() {
  for (const actor of game.actors ?? []) remember(actor);
  for (const token of canvas?.tokens?.placeables ?? []) if (token.actor) remember(token.actor);
}

/* -------------------------------------------- */
/*  Recording (active GM)                       */
/* -------------------------------------------- */

function tokenFor(actor) {
  if (actor.isToken) return actor.token;
  return actor.getActiveTokens?.(false, true)?.[0] ?? null;
}

function checkActor(actor, userId, options = {}) {
  if (!actor || !game.user.isActiveGM || options.lucd20Undo) return;
  const after = readHP(actor);
  if (!after) return;
  const before = state.cache.get(actor.uuid);
  state.cache.set(actor.uuid, after);
  if (!before) return;
  if (before.value === after.value && before.temp === after.temp && before.max === after.max) return;

  const token = tokenFor(actor);
  const entry = {
    id: foundry.utils.randomID(),
    time: Date.now(),
    round: game.combat?.started ? game.combat.round : null,
    actorUuid: actor.uuid,
    tokenUuid: token?.uuid ?? null,
    name: token?.name ?? actor.name,
    nameHidden: token?.playersCanSeeName === false,
    img: token?.texture?.src && !/\.(webm|mp4)$/i.test(token.texture.src) ? token.texture.src : actor.img,
    before,
    after,
    userId: userId ?? null,
    cause: null,
    messageId: null,
    reverted: false
  };
  state.entries.push(entry);
  scheduleSave();
  render();
}

function onActorHook(actor, changes, options, userId) {
  checkActor(actor, userId, options);
}

function onTokenHook(tokenDoc, changes, options, userId) {
  if (tokenDoc?.actorLink) return; // linked tokens: the actor hook handles it
  checkActor(tokenDoc?.actor, userId, options);
}

function onDeltaHook(delta, changes, options, userId) {
  checkActor(delta?.parent?.actor, userId, options);
}

/** System messages that explain a change (e.g. PF2e "takes 12 damage"). */
function onChatMessage(message) {
  if (!game.user.isActiveGM || !state.feature?.get("details")) return;
  for (const adapter of activeAdapters()) {
    const cause = adapter.causeFromMessage?.(message);
    if (!cause) continue;
    const entry = [...state.entries].reverse().find(e =>
      e.actorUuid === cause.actorUuid && !e.cause && Date.now() - e.time < 5000);
    if (!entry) continue;
    entry.cause = cause.text;
    entry.messageId = cause.messageId ?? message.id;
    scheduleSave();
    render();
    return;
  }
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(save, 300);
}

async function save() {
  const max = Math.max(10, state.feature?.get("maxEntries") ?? 200);
  if (state.entries.length > max) state.entries = state.entries.slice(-max);
  try {
    await game.settings.set(MODULE_ID, ENTRIES_KEY, { entries: state.entries });
  } catch (err) {
    error("Could not save the damage log.", err);
  }
}

async function clearLog() {
  state.entries = [];
  clearTimeout(state.saveTimer);
  await game.settings.set(MODULE_ID, ENTRIES_KEY, { entries: [] });
  render();
}

async function undo(entryId) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry || entry.reverted || !game.user.isGM) return;
  const actor = fromUuidSync(entry.actorUuid);
  const paths = hpPaths(actor);
  if (!paths) return;
  const update = { [paths.value]: entry.before.value };
  if (paths.temp) update[paths.temp] = entry.before.temp;
  await actor.update(update, { lucd20Undo: true });
  state.cache.set(actor.uuid, readHP(actor));
  entry.reverted = true;
  await save();
  render();
}

/* -------------------------------------------- */
/*  Who can see an entry                        */
/* -------------------------------------------- */

function canSeeBars(entry) {
  if (game.user.isGM) return true;
  if (!state.feature.get("showToPlayers")) return false;
  const modes = CONST.TOKEN_DISPLAY_MODES;
  const token = entry.tokenUuid ? fromUuidSync(entry.tokenUuid) : null;
  const actor = token?.actor ?? fromUuidSync(entry.actorUuid);
  const isOwner = !!actor?.testUserPermission?.(game.user, "OWNER");
  if (token?.hidden && !isOwner) return false;
  const mode = token?.displayBars ?? actor?.prototypeToken?.displayBars ?? modes.NONE;
  if (mode === modes.ALWAYS || mode === modes.HOVER) return true;
  if (mode === modes.OWNER || mode === modes.OWNER_HOVER || mode === modes.CONTROL) return isOwner;
  return false;
}

/* -------------------------------------------- */
/*  Panel                                       */
/* -------------------------------------------- */

function describe(entry) {
  const { before, after } = entry;
  const dHp = after.value - before.value;
  const dTemp = after.temp - before.temp;
  const total = dHp + dTemp;
  const parts = [];
  let kind = "other";
  if (total < 0) {
    kind = "damage";
    parts.push(localize("LUCD20.DamageLog.Took", { amount: -total }));
  } else if (dHp > 0) {
    kind = "healing";
    parts.push(localize("LUCD20.DamageLog.Healed", { amount: dHp }));
  }
  if (dTemp > 0) {
    if (kind === "other") kind = "temp";
    parts.push(localize("LUCD20.DamageLog.TempGained", { amount: dTemp }));
  }
  if (after.max !== before.max) {
    if (kind === "other") kind = "max";
    parts.push(localize("LUCD20.DamageLog.MaxChanged", { before: before.max, after: after.max }));
  }
  const detail = [`${localize("LUCD20.DamageLog.HP")} ${before.value} → ${after.value} / ${after.max}`];
  if (before.temp || after.temp) detail.push(`${localize("LUCD20.DamageLog.Temp")} ${before.temp} → ${after.temp}`);
  return { kind, summary: parts.join(" · "), detail: detail.join(" · ") };
}

function entryHTML(entry) {
  const gm = game.user.isGM;
  const name = !gm && entry.nameHidden ? localize("LUCD20.TurnAnnouncer.Unknown") : entry.name;
  const { kind, summary, detail } = describe(entry);
  const time = new Date(entry.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const when = entry.round ? `${localize("LUCD20.TurnAnnouncer.Round", { round: entry.round })} · ${time}` : time;
  const by = gm && entry.userId ? game.users.get(entry.userId)?.name : null;
  return `
    <li class="lucd20-dl-entry ${kind} ${entry.reverted ? "reverted" : ""}" data-entry-id="${esc(entry.id)}">
      <img class="lucd20-dl-portrait" src="${esc(entry.img)}" alt="">
      <div class="lucd20-dl-body">
        <div class="lucd20-dl-line">
          <span class="lucd20-dl-name">${esc(name)}</span>
          <span class="lucd20-dl-summary">${esc(summary)}</span>
        </div>
        <div class="lucd20-dl-detail">${esc(detail)}</div>
        ${entry.cause && (gm || state.feature.get("causeToPlayers")) ? `<div class="lucd20-dl-cause">${esc(entry.cause)}</div>` : ""}
        <div class="lucd20-dl-meta">${esc(when)}${by ? ` · ${esc(by)}` : ""}${entry.reverted ? ` · ${localize("LUCD20.DamageLog.Reverted")}` : ""}</div>
      </div>
      ${gm && !entry.reverted ? `<button type="button" class="lucd20-dl-undo" data-dl-action="undo" data-tooltip="${localize("LUCD20.DamageLog.Undo")}"><i class="fa-solid fa-rotate-left"></i></button>` : ""}
    </li>`;
}

function ensurePanel() {
  const root = appElement(ui.chat);
  if (!root) return null;
  let panel = root.querySelector(".lucd20-damage-log");
  if (panel) return panel;
  const log = root.querySelector(".chat-log");
  if (!log) return null;
  const anchor = log.closest(".chat-scroll") ?? log;
  anchor.dataset.lucd20ChatAnchor = "";
  panel = document.createElement("section");
  panel.className = "lucd20-damage-log";
  panel.addEventListener("click", async event => {
    const button = event.target.closest("[data-dl-action]");
    if (!button) return;
    event.preventDefault();
    if (button.dataset.dlAction === "undo") await undo(button.closest("[data-entry-id]")?.dataset.entryId);
    else if (button.dataset.dlAction === "clear") {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: localize("LUCD20.DamageLog.ClearTitle") },
        content: `<p>${localize("LUCD20.DamageLog.ClearContent")}</p>`
      });
      if (confirmed) await clearLog();
    }
  });
  anchor.after(panel);
  return panel;
}

function render() {
  if (!state.showing || !state.feature) return;
  const panel = ensurePanel();
  if (!panel) return;
  const visible = state.entries.filter(canSeeBars);
  const list = visible.length
    ? `<ol class="lucd20-dl-list">${visible.map(entryHTML).join("")}</ol>`
    : `<p class="lucd20-dl-empty">${localize("LUCD20.DamageLog.Empty")}</p>`;
  panel.innerHTML = `
    <header class="lucd20-dl-header">
      <h3><i class="fa-solid fa-heart-pulse"></i> ${localize("LUCD20.DamageLog.Title")}</h3>
      ${game.user.isGM ? `<button type="button" class="lucd20-dl-clear" data-dl-action="clear" data-tooltip="${localize("LUCD20.DamageLog.Clear")}"><i class="fa-solid fa-trash"></i></button>` : ""}
    </header>
    ${list}`;
  const scroller = panel.querySelector(".lucd20-dl-list");
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

function setShowing(value) {
  state.showing = value;
  const root = appElement(ui.chat);
  root?.classList.toggle("lucd20-show-damage", value);
  if (value) {
    // The log lives in the chat tab: open it if another tab is active.
    if (ui.sidebar?.activeTab && ui.sidebar.activeTab !== "chat") ui.sidebar.changeTab?.("chat", "primary");
    render();
  }
  refreshChatControls();
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

defineFeature({
  id: "damageLog",
  category: "chat",
  scope: "world",
  defaultEnabled: false,
  settings: {
    showToPlayers: { kind: "boolean", default: true },
    causeToPlayers: { kind: "boolean", default: false, dependsOn: "showToPlayers" },
    maxEntries: { kind: "number", min: 10, max: 1000, step: 10, default: 200 },
    details: { kind: "boolean", default: true, system: "pf2e" }
  },

  init() {
    game.settings.register(MODULE_ID, ENTRIES_KEY, {
      scope: "world",
      config: false,
      type: Object,
      default: { entries: [] },
      onChange: value => {
        if (game.user.isActiveGM) return; // the GM's own list is the source
        state.entries = value?.entries ?? [];
        render();
      }
    });
  },

  enable(feature) {
    state.feature = feature;
    state.entries = [...(game.settings.get(MODULE_ID, ENTRIES_KEY)?.entries ?? [])];

    for (const hook of ["updateActor"]) feature.on(hook, onActorHook);
    feature.on("updateToken", onTokenHook);
    feature.on("updateActorDelta", onDeltaHook);
    feature.on("createChatMessage", onChatMessage);
    feature.on("canvasReady", snapshotAll);
    feature.on("createToken", doc => doc.actor && remember(doc.actor));
    feature.on("createActor", actor => remember(actor));
    feature.on("renderChatLog", () => {
      if (state.showing) {
        appElement(ui.chat)?.classList.add("lucd20-show-damage");
        render();
      }
    });
    snapshotAll();

    feature.onCleanup(addChatControl({
      id: "damageLog",
      order: 2,
      icon: "fa-solid fa-heart-pulse",
      className: "lucd20-damage-log-button",
      tooltip: localize("LUCD20.DamageLog.Toggle"),
      visible: () => game.user.isGM || feature.get("showToPlayers"),
      active: () => state.showing,
      onClick: () => setShowing(!state.showing)
    }));

    feature.onCleanup(addFlushContributor("damageLog", {
      wantsDialog: () => state.entries.length > 0,
      dialogContent: () => `<label class="lucd20-flush-option"><input type="checkbox" name="lucd20ClearDamageLog"> ${localize("LUCD20.DamageLog.AlsoClear")}</label>`,
      afterFlush: async values => {
        if (values.lucd20ClearDamageLog) await clearLog();
      }
    }));

    feature.onCleanup(() => {
      if (state.saveTimer) {
        clearTimeout(state.saveTimer);
        save();
      }
      setShowing(false);
      document.querySelectorAll(".lucd20-damage-log").forEach(el => el.remove());
      state.feature = null;
      state.cache.clear();
    });
  }
});
