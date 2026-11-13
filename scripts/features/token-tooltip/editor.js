import { MODULE_ID, localize } from "../../core/constants.js";
import { evaluate, clearCache } from "./expressions.js";
import { presetFor } from "./presets.js";
import { importTTA } from "./tta-import.js";

const { ApplicationV2, DialogV2 } = foundry.applications.api;
const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const icon = name => `<i class="ll-i fa-solid ${name}" aria-hidden="true"></i>`;
const WHO = ["gm", "owner", "friendly", "others", "all"];

/** Enough lines for the value (≈ 44 characters per line), 1–8. */
function valueRows(value) {
  const lines = String(value ?? "").split("\n");
  const needed = lines.reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 44)), 0);
  return Math.min(8, Math.max(1, needed));
}

/** The token values are previewed on: your selected token, else the first one you can see. */
function previewToken() {
  return canvas?.tokens?.controlled?.[0] ?? (canvas?.tokens?.placeables ?? []).find(t => t.actor && t.visible) ?? null;
}

function actorTypes() {
  const types = game.documentTypes?.Actor ?? Object.keys(CONFIG.Actor?.dataModels ?? CONFIG.Actor?.typeLabels ?? {});
  return types.filter(t => t !== "base");
}

function typeLabel(type) {
  const key = CONFIG.Actor?.typeLabels?.[type];
  return key ? game.i18n.localize(key) : type;
}

function iconClass(name) {
  const n = String(name || "fa-circle").trim();
  return /\bfa-(solid|regular|brands)\b/.test(n) ? n : `fa-solid ${n}`;
}

/** Every value in the actor's system data as path → value (primitives only). */
function flatten(obj, prefix = "", out = [], depth = 0, seen = new Set()) {
  if (!obj || typeof obj !== "object" || depth > 7 || seen.has(obj) || out.length > 4000) return out;
  seen.add(obj);
  for (const key of Object.keys(obj)) {
    let v;
    try {
      v = obj[key];
    } catch {
      continue;
    }
    const path = prefix ? `${prefix}.${key}` : key;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) out.push({ path, value: v });
    else if (Array.isArray(v)) {
      if (v.length && v.length <= 20) v.forEach((x, i) => (x && typeof x === "object" ? flatten(x, `${path}.${i}`, out, depth + 1, seen) : out.push({ path: `${path}.${i}`, value: x })));
    } else if (typeof v === "object") flatten(v, path, out, depth + 1, seen);
  }
  return out;
}

/**
 * Token Tooltip editor (GM). Rows: icon (with preview), colour, value, who
 * sees it, actor types, live preview on the selected token. Drag to reorder.
 * Data browser: the selected token's system data with live values; click one
 * to insert @path into the value you were editing. Import a Token Tooltip
 * Alt export; reset to the system's defaults.
 */
export class TooltipEditor extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "lucd20-tooltip-editor",
    classes: ["lucd20-loot-app", "lucd20-tooltip-editor"],
    window: { title: "LUCD20.TokenTooltip.EditorTitle", icon: "fa-solid fa-table-list", resizable: true },
    position: { width: 1100, height: 680 },
    actions: {
      add: TooltipEditor.#onAdd,
      remove: TooltipEditor.#onRemove,
      browser: TooltipEditor.#onBrowser,
      import: TooltipEditor.#onImport,
      reset: TooltipEditor.#onReset,
      save: TooltipEditor.#onSave,
      cancel: TooltipEditor.#onCancel,
      toggleType: TooltipEditor.#onToggleType,
      pick: TooltipEditor.#onPick
    }
  };

  static open(config) {
    const existing = foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id);
    if (existing) return existing.render({ force: true });
    return new this(config).render({ force: true });
  }

  constructor(config, options) {
    super(options);
    this.rows = foundry.utils.deepClone(config?.rows ?? []);
    this.showBrowser = true;
    this.search = "";
    this.focused = 0; // row index the data browser inserts into
  }

  /* ------------------------------------------ */

  rowHTML(row, index, token, types) {
    const preview = token ? evaluate(row.value, token) : undefined;
    const who = WHO.map(w => `<option value="${w}" ${row.who === w ? "selected" : ""}>${esc(localize(`LUCD20.TokenTooltip.Who.${w}`))}</option>`).join("");
    const chips = types.map(t => {
      const on = !row.types?.length || row.types.includes(t);
      return `<button type="button" class="tt-type ${on ? "on" : ""}" data-action="toggleType" data-type="${esc(t)}">${esc(typeLabel(t))}</button>`;
    }).join("");
    return `
      <li class="tt-row ${index === this.focused ? "focused" : ""}" data-index="${index}" draggable="true">
        <span class="tt-handle" data-tooltip="${esc(localize("LUCD20.TokenTooltip.Drag"))}">${icon("fa-grip-vertical")}</span>
        <span class="tt-icon-cell">
          <i class="${esc(iconClass(row.icon))} fa-fw tt-icon-preview" style="color:${esc(row.color)}"></i>
          <input type="text" name="icon" value="${esc(row.icon)}" placeholder="fa-heart" spellcheck="false">
        </span>
        <input type="color" name="color" value="${esc(row.color || "#ffffff")}">
        <textarea name="value" rows="${valueRows(row.value)}" spellcheck="false" placeholder="${esc(localize("LUCD20.TokenTooltip.ValuePlaceholder"))}">${esc(row.value)}</textarea>
        <span class="tt-side">
          <select name="who">${who}</select>
          <span class="tt-types">${chips}</span>
        </span>
        <span class="tt-preview ${preview === undefined ? "empty" : ""}" data-tooltip="${esc(localize("LUCD20.TokenTooltip.PreviewHint"))}">${preview === undefined ? "—" : esc(preview)}</span>
        <button type="button" class="ll-btn ll-btn-danger" data-action="remove" aria-label="${esc(localize("LUCD20.TokenTooltip.Remove"))}" data-tooltip="${esc(localize("LUCD20.TokenTooltip.Remove"))}">${icon("fa-trash")}</button>
      </li>`;
  }

  browserHTML(token) {
    if (!token?.actor) return `<p class="tt-browser-empty">${esc(localize("LUCD20.TokenTooltip.SelectToken"))}</p>`;
    const q = this.search.trim().toLowerCase();
    const entries = flatten(token.actor.system).filter(e => !q || e.path.toLowerCase().includes(q) || String(e.value).toLowerCase().includes(q));
    const shown = entries.slice(0, 400);
    return `
      <ul class="tt-browser-list">${shown.map(e => `
        <li><button type="button" class="tt-pick" data-action="pick" data-path="${esc(e.path)}">
          <span class="tt-path">${esc(e.path)}</span><span class="tt-val">${esc(e.value === null ? "null" : String(e.value).slice(0, 40))}</span>
        </button></li>`).join("")}
      </ul>
      ${entries.length > shown.length ? `<p class="tt-browser-more">${esc(localize("LUCD20.TokenTooltip.More", { count: entries.length - shown.length }))}</p>` : ""}`;
  }

  async _renderHTML() {
    const token = previewToken();
    const types = actorTypes();
    const rows = this.rows.map((row, i) => this.rowHTML(row, i, token, types)).join("");
    const previewName = token ? (token.document?.name ?? token.name) : localize("LUCD20.TokenTooltip.NoToken");
    return `
      <div class="lucd20-loot-body">
        <p class="lucd20-loot-taker lucd20-loot-hint">${icon("fa-circle-info")}<span>${localize("LUCD20.TokenTooltip.EditorHint")}</span>
          <span class="tt-preview-on">${icon("fa-eye")} ${esc(previewName)}</span></p>
        <div class="tt-columns ${this.showBrowser ? "with-browser" : ""}">
          <div class="lucd20-loot-list tt-list-wrap">
            <ol class="tt-rows">${rows || `<li class="tt-none">${esc(localize("LUCD20.TokenTooltip.NoRows"))}</li>`}</ol>
          </div>
          ${this.showBrowser ? `
          <aside class="tt-browser">
            <div class="tt-browser-head">${icon("fa-magnifying-glass")}<input type="search" name="search" value="${esc(this.search)}" placeholder="${esc(localize("LUCD20.TokenTooltip.SearchData"))}"></div>
            <p class="tt-browser-hint">${esc(localize("LUCD20.TokenTooltip.BrowserHint"))}</p>
            <div class="tt-browser-body">${this.browserHTML(token)}</div>
          </aside>` : ""}
        </div>
        <footer class="lucd20-loot-footer">
          <button type="button" class="ll-btn ll-btn-footer" data-action="add">${icon("fa-plus")}<span>${localize("LUCD20.TokenTooltip.Add")}</span></button>
          <button type="button" class="ll-btn ll-btn-footer" data-action="browser">${icon("fa-sitemap")}<span>${localize("LUCD20.TokenTooltip.Browser")}</span></button>
          <button type="button" class="ll-btn ll-btn-footer" data-action="import">${icon("fa-file-import")}<span>${localize("LUCD20.TokenTooltip.Import")}</span></button>
          <button type="button" class="ll-btn ll-btn-footer" data-action="reset">${icon("fa-rotate-left")}<span>${localize("LUCD20.TokenTooltip.Reset")}</span></button>
          <span class="tt-footer-gap"></span>
          <button type="button" class="ll-btn ll-btn-footer" data-action="cancel">${icon("fa-xmark")}<span>${localize("LUCD20.TokenTooltip.Cancel")}</span></button>
          <button type="button" class="ll-btn ll-btn-footer ll-btn-primary" data-action="save">${icon("fa-floppy-disk")}<span>${localize("LUCD20.TokenTooltip.Save")}</span></button>
        </footer>
      </div>`;
  }

  _replaceHTML(result, content) {
    const top = content.querySelector(".tt-list-wrap")?.scrollTop ?? 0;
    const btop = content.querySelector(".tt-browser-body")?.scrollTop ?? 0;
    content.innerHTML = result;
    const list = content.querySelector(".tt-list-wrap");
    if (list) list.scrollTop = top;
    const browser = content.querySelector(".tt-browser-body");
    if (browser) browser.scrollTop = btop;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    // Edits update the working copy without a re-draw (keeps focus); preview updates in place.
    root.querySelectorAll(".tt-row").forEach(li => {
      const index = Number(li.dataset.index);
      li.addEventListener("focusin", () => {
        this.focused = index;
        root.querySelectorAll(".tt-row.focused").forEach(el => el.classList.remove("focused"));
        li.classList.add("focused");
      });
      li.addEventListener("input", event => this.#onInput(li, index, event.target));
      li.addEventListener("change", event => this.#onInput(li, index, event.target));
      li.addEventListener("dragstart", event => {
        if (!event.target.closest?.(".tt-handle") && event.target !== li) return;
        this.dragFrom = index;
        event.dataTransfer?.setData("text/plain", String(index));
        li.classList.add("dragging");
      });
      li.addEventListener("dragend", () => li.classList.remove("dragging"));
      li.addEventListener("dragover", event => event.preventDefault());
      li.addEventListener("drop", event => {
        event.preventDefault();
        const from = this.dragFrom ?? Number(event.dataTransfer?.getData("text/plain"));
        this.dragFrom = null;
        if (!Number.isInteger(from) || from === index) return;
        const [row] = this.rows.splice(from, 1);
        this.rows.splice(index, 0, row);
        this.focused = index;
        this.render();
      });
    });
    // Only drag from the handle, so text in the fields can still be selected.
    root.querySelectorAll(".tt-row").forEach(li => {
      li.querySelectorAll("input, textarea, select").forEach(el => {
        el.addEventListener("mousedown", () => (li.draggable = false));
        el.addEventListener("mouseup", () => (li.draggable = true));
        el.addEventListener("blur", () => (li.draggable = true));
      });
    });
    const search = root.querySelector('input[name="search"]');
    search?.addEventListener("input", () => {
      this.search = search.value;
      const body = root.querySelector(".tt-browser-body");
      if (body) body.innerHTML = this.browserHTML(previewToken());
    });
  }

  #onInput(li, index, el) {
    const row = this.rows[index];
    if (!row || !el?.name || el.name === "search") return;
    row[el.name] = el.value;
    if (el.name === "value" && el.tagName === "TEXTAREA") el.rows = valueRows(el.value);
    if (el.name === "icon" || el.name === "color") {
      const i = li.querySelector(".tt-icon-preview");
      if (i) {
        i.className = `${iconClass(row.icon)} fa-fw tt-icon-preview`;
        i.style.color = row.color;
      }
    }
    if (el.name === "value") {
      clearCache();
      const token = previewToken();
      const v = token ? evaluate(row.value, token) : undefined;
      const cell = li.querySelector(".tt-preview");
      if (cell) {
        cell.textContent = v === undefined ? "—" : v;
        cell.classList.toggle("empty", v === undefined);
      }
    }
  }

  /* ------------------------------------------ */

  static #onAdd() {
    this.rows.push({ icon: "fa-circle", color: "#ffffff", value: "", who: "gm", types: [] });
    this.focused = this.rows.length - 1;
    this.render();
  }

  static #onRemove(event, target) {
    const index = Number(target.closest(".tt-row")?.dataset.index);
    if (!Number.isInteger(index)) return;
    this.rows.splice(index, 1);
    this.focused = Math.min(this.focused, this.rows.length - 1);
    this.render();
  }

  static #onToggleType(event, target) {
    const index = Number(target.closest(".tt-row")?.dataset.index);
    const row = this.rows[index];
    if (!row) return;
    const all = actorTypes();
    const current = row.types?.length ? new Set(row.types) : new Set(all);
    const type = target.dataset.type;
    if (current.has(type)) current.delete(type);
    else current.add(type);
    row.types = current.size === all.length || !current.size ? [] : all.filter(t => current.has(t));
    this.render();
  }

  static #onBrowser() {
    this.showBrowser = !this.showBrowser;
    this.render();
  }

  /** Insert @path into the focused row's value (at the cursor), or use the bare path when it's empty. */
  static #onPick(event, target) {
    const path = target.dataset.path;
    const row = this.rows[this.focused];
    if (!row || !path) return;
    const textarea = this.element.querySelector(`.tt-row[data-index="${this.focused}"] textarea[name="value"]`);
    if (!row.value?.trim()) row.value = path;
    else if (textarea && typeof textarea.selectionStart === "number") {
      const { selectionStart: a, selectionEnd: b } = textarea;
      const inBlock = /\{[^}]*$/.test(row.value.slice(0, a));
      const insert = inBlock ? `@${path}` : `{@${path}}`;
      row.value = row.value.slice(0, a) + insert + row.value.slice(b);
    } else row.value += ` {@${path}}`;
    this.render();
  }

  static async #onImport() {
    const content = `<p>${localize("LUCD20.TokenTooltip.ImportHint")}</p><textarea name="json" rows="12" style="width:100%;font-family:monospace"></textarea>`;
    const json = await DialogV2.prompt({
      window: { title: localize("LUCD20.TokenTooltip.Import"), icon: "fa-solid fa-file-import" },
      content,
      ok: { label: localize("LUCD20.TokenTooltip.Import"), callback: (e, button) => button.form.elements.json.value },
      rejectClose: false
    });
    if (!json?.trim()) return;
    try {
      const rows = importTTA(json, actorTypes());
      if (!rows.length) throw new Error(localize("LUCD20.TokenTooltip.ImportEmpty"));
      this.rows = rows;
      this.focused = 0;
      ui.notifications.info(localize("LUCD20.TokenTooltip.Imported", { count: rows.length }));
      this.render();
    } catch (err) {
      ui.notifications.error(localize("LUCD20.TokenTooltip.ImportFailed", { error: err.message }));
    }
  }

  static async #onReset() {
    const ok = await DialogV2.confirm({
      window: { title: localize("LUCD20.TokenTooltip.Reset") },
      content: `<p>${localize("LUCD20.TokenTooltip.ResetConfirm")}</p>`
    });
    if (!ok) return;
    this.rows = presetFor(game.system.id).rows;
    this.render();
  }

  static async #onSave() {
    const rows = this.rows.map(r => ({ icon: r.icon, color: r.color, value: r.value, who: r.who || "gm", types: r.types ?? [] }));
    await game.settings.set(MODULE_ID, "tokenTooltipConfig", { rows });
    ui.notifications.info(localize("LUCD20.TokenTooltip.Saved"));
    this.close();
  }

  static #onCancel() {
    this.close();
  }
}
