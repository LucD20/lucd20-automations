import { MODULE_ID, error, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { appElement } from "../core/dom.js";
import { watchDOM } from "../core/dom-watch.js";

/**
 * Setting Presets (GM): save how a world is set up and apply it to another.
 *
 * A preset holds every world setting (core, system, every module), the GM's
 * own client settings (keybindings included), the GM's per-user settings, and
 * which modules are active. It is a JSON file in the Foundry user data
 * (`lucd20-presets/`), so every world on the same server lists it; where the
 * server refuses the upload it is kept in this world instead. Export / Import
 * move one between servers.
 *
 * - Viewing: grouped by module, each setting with its real name when its
 *   module is loaded (the raw key under it) and its value; settings that
 *   differ from this world are marked.
 * - Applying: tick what to apply. Things that only make sense in the world
 *   they came from (stored ids, logs, migration marks, the world clock) are
 *   never applied, nor are another game system's own settings. Settings of
 *   modules that are not active yet are written anyway, so they are in place
 *   after the reload. Modules the preset had active are switched on; others
 *   are left alone unless asked.
 * - Client settings are only ever read from and written to this browser.
 */

const DIR = "lucd20-presets";
const LOCAL_KEY = "settingPresets_local";
const FORMAT = "lucd20-setting-preset";
const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const { ApplicationV2, DialogV2 } = foundry.applications.api;
const L = (key, data) => localize(`LUCD20.SettingPresets.${key}`, data);
const icon = name => `<i class="ll-i fa-solid ${name}" aria-hidden="true"></i>`;

const state = { feature: null };

/* -------------------------------------------- */
/*  Reading and writing Foundry's settings      */
/* -------------------------------------------- */

/** Every stored world-side Setting document (world-scope ones, and per-user ones which carry a user). */
const worldDocuments = () => [...(game.settings.storage.get("world") ?? [])];
const clientStore = () => game.settings.storage.get("client") ?? globalThis.localStorage;
const userIdOf = doc => (typeof doc.user === "object" ? doc.user?.id : doc.user) ?? null;

/** A stored value as data: Foundry keeps settings as JSON text. */
function parse(raw) {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return raw;
  }
}

const documentValue = doc => parse(doc._source?.value ?? doc.value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const splitKey = fullKey => {
  const at = fullKey.indexOf(".");
  return { namespace: fullKey.slice(0, at), key: fullKey.slice(at + 1) };
};

/** Namespaces that are Foundry's, the system's or an installed module's: other keys in the browser's storage are not settings. */
const knownNamespace = namespace => namespace === "core" || namespace === game.system.id || game.modules.has(namespace);

function currentSettings() {
  const world = {};
  const user = {};
  for (const doc of worldDocuments()) {
    const owner = userIdOf(doc);
    if (!owner) world[doc.key] = documentValue(doc);
    else if (owner === game.user.id) user[doc.key] = documentValue(doc);
  }
  const client = {};
  const store = clientStore();
  for (let i = 0; i < store.length; i++) {
    const fullKey = store.key(i);
    if (!fullKey?.includes(".") || !knownNamespace(splitKey(fullKey).namespace)) continue;
    client[fullKey] = parse(store.getItem(fullKey));
  }
  return { world, client, user };
}

const activeModules = () => [...game.modules.values()].filter(m => m.active).map(m => ({ id: m.id, title: m.title ?? m.id, version: m.version ?? "" }))
  .sort((a, b) => a.title.localeCompare(b.title));

/** Everything a preset holds, read from this world and this browser. */
export function capture(name, id = null) {
  const { world, client, user } = currentSettings();
  delete world["core.moduleConfiguration"]; // kept as the list of active modules instead
  delete world[`${MODULE_ID}.${LOCAL_KEY}`]; // presets do not hold presets
  return {
    format: FORMAT,
    version: 1,
    id: id ?? `${slug(name)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    saved: new Date().toISOString(),
    foundry: game.version ?? game.release?.version ?? null,
    system: { id: game.system.id, title: game.system.title ?? game.system.id, version: game.system.version ?? null },
    worldTitle: game.world?.title ?? null,
    modules: activeModules(),
    world,
    client,
    user
  };
}

const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "preset";

/* -------------------------------------------- */
/*  What applies and what does not              */
/* -------------------------------------------- */

/** Settings that belong to the world they were made in: stored ids, logs, clocks, migration marks. */
const WORLD_BOUND = new Set([
  "core.compendiumConfiguration", "core.time", "pf2e.activeParty", "pf2e.worldClock.worldCreatedOn",
  ...["lootPile_stashId", "skillChallenge_runs", "skillChallenge_public", "diceStats_data", "damageLog_entries", "dnd4eMigrated", "forceSettings_appliedDefaults"]
    .map(key => `${MODULE_ID}.${key}`)
]);
const WORLD_BOUND_PATTERN = /migrat|schemaVersion|systemVersion|worldVersion/i;

/** Names that suggest an API key or password (not "keybindings"). */
const SECRET_PATTERN = /(api[-_]?key|token|secret|password|passwd|credential|licen[sc]e)|(?:Key|[-_]key)$/;
export const looksSecret = fullKey => SECRET_PATTERN.test(splitKey(fullKey).key);

/** A copy without the settings that look like secrets (for a file that leaves the server). */
export function withoutSecrets(preset) {
  const copy = foundry.utils.deepClone(preset);
  for (const scope of ["world", "client", "user"]) {
    for (const fullKey of Object.keys(copy[scope] ?? {})) if (looksSecret(fullKey)) delete copy[scope][fullKey];
  }
  return copy;
}

function namespaceTitle(namespace, preset) {
  if (namespace === "core") return L("Core");
  if (namespace === game.system.id) return game.system.title ?? namespace;
  if (namespace === preset.system?.id) return preset.system.title ?? namespace;
  return game.modules.get(namespace)?.title ?? preset.modules?.find(m => m.id === namespace)?.title ?? namespace;
}

/**
 * One row per saved setting: { scope, fullKey, namespace, key, value, label, current, differs, skip }.
 * skip: null, or why it is never applied ("worldData", "otherSystem", "notLoaded" for a per-user setting
 * whose module is not running).
 */
export function rowsOf(preset) {
  const now = currentSettings();
  const rows = [];
  for (const scope of ["world", "user", "client"]) {
    for (const [fullKey, value] of Object.entries(preset[scope] ?? {})) {
      const { namespace, key } = splitKey(fullKey);
      const registered = game.settings.settings.get(fullKey);
      const has = fullKey in now[scope];
      const current = has ? now[scope][fullKey] : registered?.default;
      let skip = null;
      if (WORLD_BOUND.has(fullKey) || WORLD_BOUND_PATTERN.test(key)) skip = "worldData";
      else if (namespace === preset.system?.id && namespace !== game.system.id) skip = "otherSystem";
      else if (scope === "user" && !registered) skip = "notLoaded";
      rows.push({
        scope, fullKey, namespace, key, value, skip,
        label: registered?.name ? localize(registered.name) : null,
        current,
        differs: !(has || registered) || !same(current, value)
      });
    }
  }
  return rows;
}

/** The preset's modules against this world: { id, title, state: "on" | "off" | "missing" }. */
export function moduleRows(preset) {
  return (preset.modules ?? []).map(m => {
    const here = game.modules.get(m.id);
    return { id: m.id, title: here?.title ?? m.title ?? m.id, state: !here ? "missing" : here.active ? "on" : "off" };
  });
}

/* -------------------------------------------- */
/*  Applying                                    */
/* -------------------------------------------- */

async function writeWorld(fullKey, value) {
  const { namespace, key } = splitKey(fullKey);
  if (game.settings.settings.get(fullKey)?.scope === "world") return game.settings.set(namespace, key, value);
  // Its module is not running here: write the stored value itself, so it is there when the module starts.
  const text = JSON.stringify(value);
  const doc = worldDocuments().find(d => d.key === fullKey && !userIdOf(d));
  if (doc) return doc.update({ value: text });
  return getDocumentClass("Setting").create({ key: fullKey, value: text });
}

/**
 * Apply the chosen rows ("scope|fullKey") and, if asked, the modules.
 * Returns { applied, failed: [fullKey], switchedOn, switchedOff, missing: [title] }.
 */
export async function applyPreset(preset, { keys, modules = true, switchOff = false } = {}) {
  const result = { applied: 0, failed: [], switchedOn: 0, switchedOff: 0, missing: [] };
  for (const row of rowsOf(preset)) {
    if (row.skip || !keys.has(`${row.scope}|${row.fullKey}`)) continue;
    try {
      if (row.scope === "client") clientStore().setItem(row.fullKey, JSON.stringify(row.value));
      else if (row.scope === "user") await game.settings.set(row.namespace, row.key, row.value);
      else await writeWorld(row.fullKey, row.value);
      result.applied++;
    } catch (err) {
      error(`Could not apply "${row.fullKey}".`, err);
      result.failed.push(row.fullKey);
    }
  }
  if (modules) {
    const config = { ...(game.settings.get("core", "moduleConfiguration") ?? {}) };
    const wanted = new Set((preset.modules ?? []).map(m => m.id));
    for (const row of moduleRows(preset)) {
      if (row.state === "missing") result.missing.push(row.title);
      else if (row.state === "off") {
        config[row.id] = true;
        result.switchedOn++;
      }
    }
    if (switchOff) {
      for (const module of game.modules.values()) {
        if (!module.active || wanted.has(module.id) || module.id === MODULE_ID) continue; // never this module: it is doing the work
        config[module.id] = false;
        result.switchedOff++;
      }
    }
    if (result.switchedOn || result.switchedOff) await game.settings.set("core", "moduleConfiguration", config);
  }
  return result;
}

/* -------------------------------------------- */
/*  Where presets are kept                      */
/* -------------------------------------------- */

const filePicker = () => foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
const localPresets = () => game.settings.get(MODULE_ID, LOCAL_KEY) ?? {};
const valid = data => data?.format === FORMAT && !data.deleted && typeof data.id === "string";

/** Every preset: files on the server, then any kept in this world. Each gets `where`: "server" | "world". */
export async function listPresets() {
  const found = new Map();
  try {
    const listing = await filePicker().browse("data", DIR);
    for (const path of listing?.files ?? []) {
      if (!path.endsWith(".json")) continue;
      try {
        const response = await fetch(`${foundry.utils.getRoute?.(path) ?? path}?t=${Date.now()}`);
        const data = await response.json();
        if (valid(data)) found.set(data.id, { ...data, where: "server" });
      } catch (err) {
        // Not a preset, or unreadable: leave it out.
      }
    }
  } catch (err) {
    // No folder yet, or no file access on this server.
  }
  for (const data of Object.values(localPresets())) if (valid(data) && !found.has(data.id)) found.set(data.id, { ...data, where: "world" });
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

async function uploadFile(id, data) {
  const picker = filePicker();
  try {
    await picker.createDirectory("data", DIR);
  } catch (err) {
    // It exists already.
  }
  const file = new File([JSON.stringify(data)], `${id}.json`, { type: "application/json" });
  const result = await picker.upload("data", DIR, file, {}, { notify: false });
  if (!result?.path) throw new Error("upload refused");
}

/** Save a preset: as a file on the server, or in this world when the server refuses. Returns where it went. */
export async function savePreset(preset) {
  const { where, ...data } = preset;
  try {
    await uploadFile(data.id, data);
    return "server";
  } catch (err) {
    await game.settings.set(MODULE_ID, LOCAL_KEY, { ...localPresets(), [data.id]: data });
    return "world";
  }
}

/** Foundry cannot delete a file: a deleted preset's file is overwritten with a marker and no longer listed. */
export async function deletePreset(preset) {
  if (preset.where === "server") await uploadFile(preset.id, { format: FORMAT, id: preset.id, deleted: true });
  const local = { ...localPresets() };
  if (preset.id in local) {
    delete local[preset.id];
    await game.settings.set(MODULE_ID, LOCAL_KEY, local);
  }
}

function download(name, text) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

/* -------------------------------------------- */
/*  Window                                      */
/* -------------------------------------------- */

const SCOPE_ICON = { world: "fa-globe", user: "fa-user", client: "fa-display" };

function valueText(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text === undefined ? "" : text;
}

class PresetsWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "lucd20-setting-presets",
    classes: ["lucd20-loot-app", "lucd20-presets-window"],
    window: { title: "LUCD20.SettingPresets.Title", icon: "fa-solid fa-floppy-disk", resizable: true },
    position: { width: 720, height: 640 },
    actions: {
      view: PresetsWindow.#onView,
      update: PresetsWindow.#onUpdate,
      export: PresetsWindow.#onExport,
      import: PresetsWindow.#onImport,
      remove: PresetsWindow.#onRemove,
      back: PresetsWindow.#onBack,
      apply: PresetsWindow.#onApply,
      all: PresetsWindow.#onAll
    }
  };

  presets = null; // the list, once loaded
  open = null; // the preset being looked at
  rows = [];
  ticked = new Set(); // "scope|fullKey" of rows to apply
  filter = { text: "", differs: false };
  modules = { apply: true, switchOff: false };
  exportSecrets = false;

  static get instance() {
    return foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id) ?? null;
  }

  static show() {
    const app = this.instance ?? new this();
    app.presets = null;
    return app.render({ force: true });
  }

  async _renderHTML() {
    return this.open ? this.#detailHTML() : this.#listHTML();
  }

  async #listHTML() {
    this.presets ??= await listPresets();
    const rows = this.presets.map(p => {
      const count = Object.keys(p.world ?? {}).length + Object.keys(p.client ?? {}).length + Object.keys(p.user ?? {}).length;
      const meta = [p.system?.title, L("CountSettings", { count }), L("CountModules", { count: p.modules?.length ?? 0 }), new Date(p.saved).toLocaleDateString()].filter(Boolean).join(" · ");
      return `<li class="lp-preset" data-id="${esc(p.id)}">
          <div class="who"><strong>${esc(p.name)}</strong><span class="sub">${esc(meta)}${p.where === "world" ? ` · ${icon("fa-triangle-exclamation")} ${L("OnlyThisWorld")}` : ""}</span></div>
          <div class="actions">
            <button type="button" class="ll-btn ll-btn-take" data-action="view">${icon("fa-list-check")}<span>${L("ViewApply")}</span></button>
            <button type="button" class="ll-btn ll-btn-square" data-action="update" data-tooltip="${esc(L("UpdateHint"))}" aria-label="${esc(L("UpdateHint"))}">${icon("fa-rotate")}</button>
            <button type="button" class="ll-btn ll-btn-square" data-action="export" data-tooltip="${esc(L("Export"))}" aria-label="${esc(L("Export"))}">${icon("fa-download")}</button>
            <button type="button" class="ll-btn ll-btn-square ll-btn-danger" data-action="remove" data-tooltip="${esc(L("Delete"))}" aria-label="${esc(L("Delete"))}">${icon("fa-trash")}</button>
          </div>
        </li>`;
    }).join("");
    return `<div class="lucd20-loot-body lp-body">
        <form class="lp-new" autocomplete="off">
          <input type="text" name="name" placeholder="${esc(L("NamePlaceholder"))}" aria-label="${esc(L("Name"))}" maxlength="60">
          <button type="submit" class="ll-btn ll-btn-footer ll-btn-take" data-save>${icon("fa-floppy-disk")}<span>${L("Save")}</span></button>
        </form>
        <div class="lp-scroll">${rows ? `<ol class="lp-list">${rows}</ol>`
          : `<div class="lucd20-loot-empty"><i class="fa-solid fa-floppy-disk ll-empty-art"></i><p class="title">${L("Empty")}</p><p class="sub">${L("EmptyHint")}</p></div>`}</div>
        <footer class="lucd20-loot-footer">
          <button type="button" class="ll-btn ll-btn-footer" data-action="import">${icon("fa-upload")}<span>${L("Import")}</span></button>
          <label class="lp-option" data-tooltip="${esc(L("SecretsHint"))}"><input type="checkbox" class="ll-check" data-export-secrets ${this.exportSecrets ? "" : "checked"}><span>${L("LeaveOutSecrets")}</span></label>
          <input type="file" accept=".json,application/json" data-import-file hidden>
        </footer>
      </div>`;
  }

  #detailHTML() {
    const preset = this.open;
    const groups = new Map();
    for (const row of this.rows) {
      if (!groups.has(row.namespace)) groups.set(row.namespace, []);
      groups.get(row.namespace).push(row);
    }
    const order = [...groups.keys()].sort((a, b) => (b === "core") - (a === "core") || (b === preset.system?.id) - (a === preset.system?.id)
      || namespaceTitle(a, preset).localeCompare(namespaceTitle(b, preset)));
    const rowHTML = row => {
      const id = `${row.scope}|${row.fullKey}`;
      const text = valueText(row.value);
      const now = valueText(row.current);
      const state = row.skip ? `<span class="lp-skip" data-tooltip="${esc(L(`Skip.${row.skip}Hint`))}">${L(`Skip.${row.skip}`)}</span>`
        : row.differs ? `<span class="lp-differs" data-tooltip="${esc(L("NowIs", { value: now.slice(0, 300) || "–" }))}">${L("Differs")}</span>` : `<span class="lp-same">${L("Same")}</span>`;
      return `<li class="lp-row ${row.skip ? "is-skip" : row.differs ? "is-differs" : ""}" data-search="${esc(`${row.fullKey} ${row.label ?? ""}`.toLowerCase())}">
          <input type="checkbox" class="ll-check" data-row="${esc(id)}" ${row.skip ? "disabled" : this.ticked.has(id) ? "checked" : ""} aria-label="${esc(row.fullKey)}">
          <i class="fa-solid ${SCOPE_ICON[row.scope]} lp-scope" data-tooltip="${esc(L(`Scope.${row.scope}`))}"></i>
          <span class="who"><span class="name">${esc(row.label ?? row.key)}</span>${row.label ? `<code>${esc(row.key)}</code>` : ""}</span>
          <span class="lp-value" title="${esc(text.slice(0, 2000))}">${esc(text.slice(0, 120))}</span>
          ${state}
        </li>`;
    };
    const groupsHTML = order.map(namespace => {
      const rows = groups.get(namespace).sort((a, b) => a.key.localeCompare(b.key));
      const differ = rows.filter(r => r.differs && !r.skip).length;
      return `<details class="lp-group" data-namespace="${esc(namespace)}" ${differ ? "open" : ""}>
          <summary><input type="checkbox" class="ll-check" data-group aria-label="${esc(namespaceTitle(namespace, preset))}">
            <strong>${esc(namespaceTitle(namespace, preset))}</strong><code>${esc(namespace)}</code>
            <span class="count">${L("GroupCount", { count: rows.length, differs: differ })}</span></summary>
          <ol>${rows.map(rowHTML).join("")}</ol>
        </details>`;
    }).join("");

    const mods = moduleRows(preset);
    const modHTML = mods.map(m => `<li class="lp-mod is-${m.state}">${icon(m.state === "on" ? "fa-check" : m.state === "off" ? "fa-power-off" : "fa-triangle-exclamation")}<span>${esc(m.title)}</span><span class="sub">${L(`Module.${m.state}`)}</span></li>`).join("");
    const turnOn = mods.filter(m => m.state === "off").length;
    const missing = mods.filter(m => m.state === "missing").length;
    const meta = [preset.system?.title, preset.worldTitle, preset.foundry ? `Foundry ${preset.foundry}` : null, new Date(preset.saved).toLocaleString()].filter(Boolean).join(" · ");
    return `<div class="lucd20-loot-body lp-body">
        <header class="lp-head">
          <button type="button" class="ll-btn ll-btn-square" data-action="back" data-tooltip="${esc(L("Back"))}" aria-label="${esc(L("Back"))}">${icon("fa-arrow-left")}</button>
          <div class="who"><strong>${esc(preset.name)}</strong><span class="sub">${esc(meta)}</span></div>
        </header>
        <div class="lp-tools">
          <input type="search" data-search-box placeholder="${esc(L("Search"))}" aria-label="${esc(L("Search"))}" value="${esc(this.filter.text)}">
          <label class="lp-option"><input type="checkbox" class="ll-check" data-only-differs ${this.filter.differs ? "checked" : ""}><span>${L("OnlyDifferences")}</span></label>
          <span class="lp-links"><a data-action="all" data-mode="all">${L("TickAll")}</a> · <a data-action="all" data-mode="differs">${L("TickDiffers")}</a> · <a data-action="all" data-mode="none">${L("TickNone")}</a></span>
        </div>
        <div class="lp-scroll">
          <details class="lp-group lp-modules" ${turnOn || missing ? "open" : ""}>
            <summary><input type="checkbox" class="ll-check" data-modules ${this.modules.apply ? "checked" : ""} aria-label="${esc(L("Modules"))}">
              <strong>${L("Modules")}</strong><span class="count">${L("ModulesCount", { count: mods.length, on: turnOn, missing })}</span></summary>
            <label class="lp-option lp-switch-off"><input type="checkbox" class="ll-check" data-switch-off ${this.modules.switchOff ? "checked" : ""}><span>${L("SwitchOffOthers")}</span></label>
            <ol class="lp-mods">${modHTML}</ol>
          </details>
          ${groupsHTML}
        </div>
        <footer class="lucd20-loot-footer">
          <button type="button" class="ll-btn ll-btn-footer ll-btn-take" data-action="apply">${icon("fa-check")}<span data-apply-label></span></button>
          <span class="lp-note">${L("ApplyNote")}</span>
        </footer>
      </div>`;
  }

  _replaceHTML(result, content) {
    const top = content.querySelector(".lp-scroll")?.scrollTop ?? 0;
    content.innerHTML = result;
    const scroll = content.querySelector(".lp-scroll");
    if (scroll) scroll.scrollTop = top;
    if (!this.open) {
      content.querySelector(".lp-new").addEventListener("submit", event => {
        event.preventDefault();
        this.#save();
      });
      content.querySelector("[data-export-secrets]").addEventListener("change", event => { this.exportSecrets = !event.target.checked; });
      content.querySelector("[data-import-file]").addEventListener("change", event => this.#importFile(event.target.files?.[0]));
      return;
    }
    content.querySelector("[data-search-box]").addEventListener("input", event => {
      this.filter.text = event.target.value;
      this.#sync();
    });
    content.querySelector("[data-only-differs]").addEventListener("change", event => {
      this.filter.differs = event.target.checked;
      this.#sync();
    });
    content.querySelector("[data-modules]").addEventListener("change", event => {
      this.modules.apply = event.target.checked;
      this.#sync();
    });
    content.querySelector("[data-switch-off]").addEventListener("change", event => { this.modules.switchOff = event.target.checked; });
    scroll.addEventListener("change", event => {
      const box = event.target;
      if (box.matches("[data-row]")) this.ticked[box.checked ? "add" : "delete"](box.dataset.row);
      else if (box.matches("[data-group]")) {
        for (const row of box.closest(".lp-group").querySelectorAll("[data-row]:not(:disabled)")) {
          if (row.closest(".lp-row").hidden) continue;
          row.checked = box.checked;
          this.ticked[box.checked ? "add" : "delete"](row.dataset.row);
        }
      } else return;
      this.#sync();
    });
    // Ticking a group's box must not fold the group.
    for (const box of scroll.querySelectorAll("summary input")) box.addEventListener("click", event => event.stopPropagation());
    this.#sync();
  }

  /** Filters, group tick boxes and the Apply label, without redrawing. */
  #sync() {
    const root = this.element;
    const words = this.filter.text.trim().toLowerCase();
    for (const group of root.querySelectorAll(".lp-group[data-namespace]")) {
      let shown = 0;
      for (const row of group.querySelectorAll(".lp-row")) {
        row.hidden = (words && !row.dataset.search.includes(words)) || (this.filter.differs && !row.classList.contains("is-differs"));
        if (!row.hidden) shown++;
      }
      group.hidden = !shown;
      if ((words || this.filter.differs) && shown) group.open = true;
      const boxes = [...group.querySelectorAll("[data-row]:not(:disabled)")];
      const on = boxes.filter(b => b.checked).length;
      const all = group.querySelector("[data-group]");
      all.checked = boxes.length > 0 && on === boxes.length;
      all.indeterminate = on > 0 && on < boxes.length;
      all.disabled = !boxes.length;
    }
    root.querySelector("[data-apply-label]").textContent = L("Apply", { count: this.ticked.size });
    root.querySelector('[data-action="apply"]').disabled = !this.ticked.size && !this.modules.apply;
  }

  #preset(target) {
    const id = target.closest("[data-id]")?.dataset.id;
    return this.presets?.find(p => p.id === id) ?? null;
  }

  async #store(preset) {
    const where = await savePreset(preset);
    if (where === "world") ui.notifications?.warn(L("SavedInWorld"));
    else ui.notifications?.info(L("Saved", { name: preset.name }));
    this.presets = null;
    return this.render();
  }

  /** The form's submit (Enter or the button): one save. */
  async #save() {
    const input = this.element.querySelector('input[name="name"]');
    const name = input.value.trim();
    if (!name) return input.focus();
    return this.#store(capture(name));
  }

  static async #onUpdate(event, target) {
    const preset = this.#preset(target);
    if (!preset) return;
    const ok = await DialogV2.confirm({ window: { title: L("UpdateHint"), icon: "fa-solid fa-rotate" }, content: `<p>${L("UpdateConfirm", { name: esc(preset.name) })}</p>` });
    if (ok) return this.#store(capture(preset.name, preset.id));
  }

  static async #onRemove(event, target) {
    const preset = this.#preset(target);
    if (!preset) return;
    const ok = await DialogV2.confirm({ window: { title: L("Delete"), icon: "fa-solid fa-trash" }, content: `<p>${L("DeleteConfirm", { name: esc(preset.name) })}</p>` });
    if (!ok) return;
    await deletePreset(preset);
    this.presets = null;
    return this.render();
  }

  static #onExport(event, target) {
    const preset = this.#preset(target);
    if (!preset) return;
    const { where, ...data } = this.exportSecrets ? preset : withoutSecrets(preset);
    download(`setting-preset-${slug(preset.name)}.json`, JSON.stringify(data, null, 2));
  }

  static #onImport() {
    this.element.querySelector("[data-import-file]").click();
  }

  async #importFile(file) {
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      data = null;
    }
    if (data?.format !== FORMAT || !data.name) return ui.notifications?.error(L("NotAPreset"));
    // A new id: an import never overwrites a preset that is already here.
    return this.#store({ ...data, id: `${slug(data.name)}-${Math.random().toString(36).slice(2, 6)}` });
  }

  static #onView(event, target) {
    const preset = this.#preset(target);
    if (!preset) return;
    this.open = preset;
    this.rows = rowsOf(preset);
    // Ticked to start with: everything that would change something.
    this.ticked = new Set(this.rows.filter(r => !r.skip && r.differs).map(r => `${r.scope}|${r.fullKey}`));
    this.filter = { text: "", differs: false };
    this.modules = { apply: true, switchOff: false };
    return this.render();
  }

  static #onBack() {
    this.open = null;
    return this.render();
  }

  static #onAll(event, target) {
    const mode = target.dataset.mode;
    for (const box of this.element.querySelectorAll("[data-row]:not(:disabled)")) {
      const row = box.closest(".lp-row");
      if (row.hidden) continue;
      box.checked = mode === "all" || (mode === "differs" && row.classList.contains("is-differs"));
      this.ticked[box.checked ? "add" : "delete"](box.dataset.row);
    }
    this.#sync();
  }

  static async #onApply(event, button) {
    button.disabled = true;
    const result = await applyPreset(this.open, { keys: this.ticked, modules: this.modules.apply, switchOff: this.modules.switchOff });
    const lines = [L("Applied", { count: result.applied })];
    if (result.switchedOn || result.switchedOff) lines.push(L("AppliedModules", { on: result.switchedOn, off: result.switchedOff }));
    if (result.missing.length) lines.push(L("AppliedMissing", { list: esc(result.missing.join(", ")) }));
    if (result.failed.length) lines.push(L("AppliedFailed", { list: esc(result.failed.join(", ")) }));
    const reload = await DialogV2.confirm({
      window: { title: L("AppliedTitle"), icon: "fa-solid fa-check" },
      content: `${lines.map(line => `<p>${line}</p>`).join("")}<p><strong>${L("ReloadAsk")}</strong></p>`
    });
    if (reload) {
      // Everyone reloads: world settings and the module list changed for all.
      game.socket?.emit("reload");
      (foundry.utils.debouncedReload ?? (() => window.location.reload()))();
      return;
    }
    this.rows = rowsOf(this.open);
    this.ticked = new Set(this.rows.filter(r => !r.skip && r.differs).map(r => `${r.scope}|${r.fullKey}`));
    return this.render();
  }
}

/* -------------------------------------------- */
/*  The button in the Settings sidebar          */
/* -------------------------------------------- */

function drawButton() {
  const root = appElement(ui.settings) ?? document.getElementById("settings");
  if (!root || root.querySelector(".lucd20-presets-open")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lucd20-presets-open";
  button.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> ${esc(L("Title"))}`;
  button.addEventListener("click", () => PresetsWindow.show());
  // Next to "Configure Settings" where that can be found, else at the end of the tab.
  const configure = root.querySelector('[data-app="configure"], [data-action="openApp"][data-app="configure"]');
  if (configure) configure.after(button);
  else (root.querySelector("section.settings, .settings-list") ?? root).append(button);
}

defineFeature({
  id: "settingPresets",
  category: "setup",
  scope: "world",
  gmOnly: true,
  defaultEnabled: true,

  init() {
    game.settings.register(MODULE_ID, LOCAL_KEY, { scope: "world", config: false, type: Object, default: {} });
  },

  enable(feature) {
    state.feature = feature;
    if (!game.user.isGM) return;
    feature.onCleanup(watchDOM("setting-presets-button", drawButton));
    feature.onCleanup(() => {
      document.querySelectorAll(".lucd20-presets-open").forEach(el => el.remove());
      PresetsWindow.instance?.close();
      state.feature = null;
    });
  }
});

export const _test = { PresetsWindow, currentSettings };
