import { MODULE_ID, localize } from "../../core/constants.js";
import { AnswerWindow } from "../../core/answer-window.js";
import { RANKS, searchSpot } from "./search-engine.js";
import { REGION_FLAG, hazardDefaults, rankLabel, sceneHazards, sceneRegionSpots } from "./search-spots.js";

/**
 * Windows for PF2e search: the spot settings form (new search spot, edit spot,
 * edit hazard), the Search Spots manager (list, Roll Search now, Reset, Pan,
 * Edit, Delete; Place search spot; Reset all), and the place-a-spot tool.
 * They reuse the Loot Pile look (token root class "lucd20-loot-app").
 */

const { ApplicationV2, DialogV2 } = foundry.applications.api;
const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const icon = name => `<i class="ll-i fa-solid ${name}" aria-hidden="true"></i>`;

/* -------------------------------------------- */
/*  Settings form                               */
/* -------------------------------------------- */

export class SpotConfigWindow extends AnswerWindow {
  static DEFAULT_OPTIONS = {
    classes: ["lucd20-loot-app", "lucd20-search-config"],
    window: { title: "LUCD20.Search.ConfigTitle", icon: "fa-solid fa-magnifying-glass" },
    position: { width: 380, height: "auto" },
    actions: { save: SpotConfigWindow.#onSave, cancel: SpotConfigWindow.#onCancel, forget: SpotConfigWindow.#onForget }
  };

  /** mode: "new" | "region" | "hazard"; values: current settings. Resolves with the new values or null. */
  setup({ mode, values, spot = null }) {
    this.mode = mode;
    this.values = values;
    this.spot = spot;
  }

  /** Characters who already rolled for this spot (older data: only failures are known). */
  #rolled() {
    const spot = this.spot;
    if (!spot) return [];
    const rolls = { ...(spot.rolls ?? {}) };
    for (const id of spot.failed ?? []) rolls[id] ??= { name: game.actors.get(id)?.name ?? id, total: null, success: false };
    return Object.entries(rolls).map(([id, r]) => ({ id, ...r })).sort((a, b) => a.name.localeCompare(b.name));
  }

  #rolledHTML() {
    if (!this.spot) return "";
    const rows = this.#rolled().map(r => `
      <li class="lucd20-search-rolled" data-actor="${esc(r.id)}">
        <span class="name">${esc(r.name)}</span>
        <span class="pill ${r.success ? "found" : "missed"}">${r.success ? icon("fa-eye") : icon("fa-eye-slash")} ${localize(r.success ? "LUCD20.Search.Status.found" : "LUCD20.Search.Missed")}${r.total !== null ? ` · ${r.total}` : ""}</span>
        <button type="button" class="ll-btn ll-btn-square" data-action="forget" data-tooltip="${esc(localize("LUCD20.Search.Forget"))}" aria-label="${esc(localize("LUCD20.Search.ForgetFor", { name: r.name }))}">${icon("fa-xmark")}</button>
      </li>`).join("");
    return `<section class="lucd20-search-rolled-list">
        <h4>${localize("LUCD20.Search.AlreadyRolled")}</h4>
        ${rows ? `<ol>${rows}</ol>` : `<p class="hint">${localize("LUCD20.Search.NobodyRolledYet")}</p>`}
      </section>`;
  }

  /** Remove one character's roll so they can search this spot again. */
  static async #onForget(event, target) {
    const id = target.closest("[data-actor]")?.dataset.actor;
    const spot = this.spot;
    if (!id || !spot) return;
    const rolls = { ...(spot.rolls ?? {}) };
    delete rolls[id];
    const failed = (spot.failed ?? []).filter(f => f !== id);
    // Still found only if someone else who found it remains.
    const found = spot.found && Object.values(rolls).some(r => r.success);
    // Flags merge on update: send the whole object with the removed key gone.
    await spot.save({ rolls: null });
    await spot.save({ rolls, failed, found });
    Object.assign(spot, { rolls, failed, found });
    this.render();
  }

  get title() {
    if (this.mode === "hazard") return localize("LUCD20.Search.HazardTitle", { name: this.values.label ?? "" });
    return localize(this.mode === "new" ? "LUCD20.Search.NewSpotTitle" : "LUCD20.Search.SpotTitle");
  }

  async _renderHTML() {
    const v = this.values;
    const hazard = this.mode === "hazard";
    const ranks = RANKS.map((r, i) => `<option value="${i}" ${i === v.minRank ? "selected" : ""}>${rankLabel(i)}</option>`).join("");
    return `
      <form class="lucd20-search-form" autocomplete="off">
        ${hazard ? `
          <label class="row check"><input type="checkbox" name="enabled" ${v.enabled ? "checked" : ""}> ${localize("LUCD20.Search.Field.enabled")}</label>
          <label class="row"><span>${localize("LUCD20.Search.Field.range")}</span><input type="number" name="range" min="0" step="5" value="${v.range}"></label>
          <p class="hint">${localize("LUCD20.Search.Field.rangeHint")}</p>` : `
          <label class="row"><span>${localize("LUCD20.Search.Field.label")}</span><input type="text" name="label" value="${esc(v.label ?? "")}" placeholder="${esc(localize("LUCD20.Search.Field.labelPlaceholder"))}"></label>`}
        <label class="row"><span>${localize("LUCD20.Search.Field.dc")}</span><input type="number" name="dc" min="0" step="1" value="${Number.isFinite(v.dc) ? v.dc : ""}" required></label>
        <label class="row"><span>${localize("LUCD20.Search.Field.minRank")}</span><select name="minRank">${ranks}</select></label>
        <label class="row column"><span>${localize("LUCD20.Search.Field.note")}</span><textarea name="note" rows="3" placeholder="${esc(localize("LUCD20.Search.Field.notePlaceholder"))}">${esc(v.note ?? "")}</textarea></label>
        ${this.#rolledHTML()}
        <footer class="lucd20-loot-footer is-dialog">
          <button type="submit" class="ll-btn ll-btn-footer ll-btn-primary" data-action="save">${icon("fa-floppy-disk")}<span>${localize(this.mode === "new" ? "LUCD20.Search.Create" : "LUCD20.Search.Save")}</span></button>
          <button type="button" class="ll-btn ll-btn-footer" data-action="cancel">${icon("fa-xmark")}<span>${localize("LUCD20.LootPile.Cancel")}</span></button>
        </footer>
      </form>`;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const form = this.element.querySelector(".lucd20-search-form");
    form.addEventListener("submit", event => {
      event.preventDefault();
      this.#submit();
    });
    form.querySelector("[name=dc]")?.focus();
  }

  #submit() {
    const form = this.element.querySelector(".lucd20-search-form");
    const el = form.elements;
    const dc = Number(el.dc.value);
    if (!el.dc.value || !Number.isFinite(dc)) {
      ui.notifications.warn(localize("LUCD20.Search.NeedDC"));
      el.dc.focus();
      return;
    }
    const values = { dc, minRank: Number(el.minRank.value) || 0, note: el.note.value.trim() };
    if (this.mode === "hazard") Object.assign(values, { enabled: el.enabled.checked, range: Math.max(0, Number(el.range.value) || 0) });
    else values.label = el.label.value.trim();
    this.answer(values);
  }

  static #onSave(event) {
    event?.preventDefault?.();
    this.#submit();
  }

  static #onCancel() {
    this.answer(null);
  }
}

/* -------------------------------------------- */
/*  Spot actions (shared with the manager)      */
/* -------------------------------------------- */

export async function editSpot(spot) {
  const values = await SpotConfigWindow.wait({ mode: spot.kind === "hazard" ? "hazard" : "region", values: { ...spot }, spot });
  if (!values) return;
  await spot.save(values);
  if (spot.kind === "region") await spot.doc.update({ name: regionName(values.label) });
}

export async function resetSpot(spot) {
  await spot.save({ rolls: null });
  await spot.save({ found: false, failed: [], rolls: {} });
}

/** Roll now (Theater of Mind): every Searching character rolls against the spot. */
export async function rollNow(spot, { allowNonSearching = false, onFound } = {}) {
  if (spot.found) return ui.notifications.info(localize("LUCD20.Search.AlreadyFound", { name: spot.label }));
  const result = await searchSpot(spot, { save: patch => spot.save(patch), where: spot.centre, how: "manual", allowNonSearching, onFound });
  if (result && !result.finders.length && !result.failed.length) ui.notifications.info(localize("LUCD20.Search.NobodyToRoll"));
}

function regionName(label) {
  return label ? localize("LUCD20.Search.RegionName", { label }) : localize("LUCD20.Search.RegionNameDefault");
}

/* -------------------------------------------- */
/*  Placing a search spot                       */
/* -------------------------------------------- */

/**
 * Drag a rectangle on the map (or click for one square), then fill in the
 * form; the search-spot Region is created with its settings already on it.
 * Right-click or Esc cancels.
 */
export class SpotPlacer {
  static active = null;

  static start() {
    SpotPlacer.active?.stop();
    SpotPlacer.active = new SpotPlacer();
    SpotPlacer.active.begin();
    ui.notifications.info(localize("LUCD20.Search.PlaceHint"));
  }

  constructor() {
    this.down = this.down.bind(this);
    this.move = this.move.bind(this);
    this.up = this.up.bind(this);
    this.key = this.key.bind(this);
    this.context = this.context.bind(this);
  }

  begin() {
    window.addEventListener("pointerdown", this.down, true);
    window.addEventListener("pointermove", this.move, true);
    window.addEventListener("pointerup", this.up, true);
    window.addEventListener("keydown", this.key, true);
    window.addEventListener("contextmenu", this.context, true);
  }

  stop() {
    window.removeEventListener("pointerdown", this.down, true);
    window.removeEventListener("pointermove", this.move, true);
    window.removeEventListener("pointerup", this.up, true);
    window.removeEventListener("keydown", this.key, true);
    window.removeEventListener("contextmenu", this.context, true);
    this.preview?.destroy();
    this.preview = null;
    if (SpotPlacer.active === this) SpotPlacer.active = null;
  }

  point(event) {
    if (canvas.canvasCoordinatesFromClient) return canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
    const rect = canvas.app.view.getBoundingClientRect();
    return canvas.stage.worldTransform.applyInverse(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
  }

  /** Rectangle snapped to the grid; at least one square. */
  rect(a, b) {
    const s = canvas.dimensions.size;
    const x1 = Math.floor(Math.min(a.x, b.x) / s) * s;
    const y1 = Math.floor(Math.min(a.y, b.y) / s) * s;
    const x2 = Math.max(Math.ceil(Math.max(a.x, b.x) / s) * s, x1 + s);
    const y2 = Math.max(Math.ceil(Math.max(a.y, b.y) / s) * s, y1 + s);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  draw(r) {
    if (!this.preview) {
      this.preview = new PIXI.Graphics();
      this.preview.eventMode = "none";
      (canvas.controls ?? canvas.stage).addChild(this.preview);
    }
    this.preview.clear().lineStyle(3, 0xee9b3a, 0.95).beginFill(0xee9b3a, 0.15).drawRect(r.x, r.y, r.width, r.height).endFill();
  }

  down(event) {
    if (event.target !== canvas.app?.view) return;
    if (event.button === 2) return this.cancel(event);
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.start = this.point(event);
    this.draw(this.rect(this.start, this.start));
  }

  move(event) {
    if (!this.start || event.target !== canvas.app?.view) return;
    this.draw(this.rect(this.start, this.point(event)));
  }

  async up(event) {
    if (!this.start || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = this.rect(this.start, this.point(event));
    this.stop();
    await createSpot(rect);
  }

  key(event) {
    if (event.key === "Escape") this.cancel(event);
  }

  context(event) {
    if (event.target === canvas.app?.view) event.preventDefault();
  }

  cancel(event) {
    event.preventDefault();
    event.stopPropagation();
    this.stop();
  }
}

async function createSpot(rect) {
  const values = await SpotConfigWindow.wait({ mode: "new", values: { label: "", dc: null, minRank: 0, note: "" } });
  if (!values) return;
  const visibility = CONST.REGION_VISIBILITY?.GAMEMASTER ?? 1;
  await canvas.scene.createEmbeddedDocuments("Region", [{
    name: regionName(values.label),
    color: "#ee9b3a",
    visibility,
    shapes: [{ type: "rectangle", x: rect.x, y: rect.y, width: rect.width, height: rect.height, rotation: 0, hole: false }],
    flags: { [MODULE_ID]: { [REGION_FLAG]: { ...values, enabled: true, found: false, failed: [] } } }
  }]);
  SearchManager.refresh();
}

/* -------------------------------------------- */
/*  Search Spots manager                        */
/* -------------------------------------------- */

export class SearchManager extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "lucd20-search-manager",
    classes: ["lucd20-loot-app", "lucd20-search-manager"],
    window: { title: "LUCD20.Search.ManagerTitle", icon: "fa-solid fa-magnifying-glass-location", resizable: true },
    position: { width: 460, height: 520 },
    actions: {
      roll: SearchManager.#onRoll,
      reset: SearchManager.#onReset,
      pan: SearchManager.#onPan,
      edit: SearchManager.#onEdit,
      remove: SearchManager.#onRemove,
      place: () => SpotPlacer.start(),
      resetAll: SearchManager.#onResetAll
    }
  };

  /** Set by the features: { hazards: bool, allowNonSearching(spot), onFound(spot) } */
  static hooks = { hazards: false, allowNonSearching: () => false, onFound: () => {} };

  static open() {
    return (foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id) ?? new this()).render({ force: true });
  }

  static refresh() {
    const app = foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id);
    if (app?.rendered) app.render();
  }

  spots() {
    const regions = sceneRegionSpots(canvas.scene);
    const hazards = SearchManager.hooks.hazards ? sceneHazards(canvas.scene, hazardDefaults()).filter(h => h.dc !== null) : [];
    return [...hazards, ...regions].sort((a, b) => a.found - b.found || a.label.localeCompare(b.label));
  }

  async _renderHTML() {
    const spots = this.spots();
    const names = ids => ids.map(id => game.actors.get(id)?.name).filter(Boolean).join(", ");
    const rows = spots.map(spot => {
      const status = spot.found
        ? `<span class="pill found">${icon("fa-eye")} ${localize("LUCD20.Search.Status.found")}</span>`
        : spot.kind === "hazard" && !spot.enabled
          ? `<span class="pill off">${localize("LUCD20.Search.Status.off")}</span>`
          : `<span class="pill hidden">${icon("fa-eye-slash")} ${localize("LUCD20.Search.Status.hidden")}</span>`;
      const failed = spot.failed.length ? `<span class="sub">${localize("LUCD20.Search.FailedBy", { names: esc(names(spot.failed)) })}</span>` : "";
      const meta = [
        localize(spot.kind === "hazard" ? "LUCD20.Search.Kind.hazard" : "LUCD20.Search.Kind.region"),
        localize("LUCD20.Search.CardDC", { dc: spot.dc }),
        spot.minRank ? rankLabel(spot.minRank) : null,
        spot.kind === "hazard" ? (spot.range ? localize("LUCD20.Search.RangeFt", { range: spot.range }) : localize("LUCD20.Search.Unlimited")) : null
      ].filter(Boolean).join(" · ");
      return `
        <li class="lucd20-search-row" data-spot="${esc(spot.id)}">
          <span class="lucd20-loot-icon">${icon(spot.kind === "hazard" ? "fa-triangle-exclamation" : "fa-magnifying-glass-location")}</span>
          <span class="who"><span class="name">${esc(spot.label)}</span><span class="sub">${esc(meta)}</span>${failed}</span>
          ${status}
          <span class="actions">
            <button type="button" class="ll-btn ll-btn-take" data-action="roll" data-tooltip="${esc(localize("LUCD20.Search.RollNow"))}" aria-label="${esc(localize("LUCD20.Search.RollNow"))}" ${spot.found ? "disabled" : ""}>${icon("fa-dice-d20")}</button>
            <button type="button" class="ll-btn" data-action="pan" data-tooltip="${esc(localize("LUCD20.Search.Pan"))}" aria-label="${esc(localize("LUCD20.Search.Pan"))}">${icon("fa-location-crosshairs")}</button>
            <button type="button" class="ll-btn" data-action="edit" data-tooltip="${esc(localize("LUCD20.Search.Edit"))}" aria-label="${esc(localize("LUCD20.Search.Edit"))}">${icon("fa-pen")}</button>
            <button type="button" class="ll-btn" data-action="reset" data-tooltip="${esc(localize("LUCD20.Search.Reset"))}" aria-label="${esc(localize("LUCD20.Search.Reset"))}">${icon("fa-rotate-left")}</button>
            ${spot.kind === "region" ? `<button type="button" class="ll-btn ll-btn-danger" data-action="remove" data-tooltip="${esc(localize("LUCD20.Search.Delete"))}" aria-label="${esc(localize("LUCD20.Search.Delete"))}">${icon("fa-trash")}</button>` : ""}
          </span>
        </li>`;
    }).join("");
    const list = rows
      ? `<ol class="lucd20-search-list">${rows}</ol>`
      : `<div class="lucd20-loot-empty"><i class="ll-empty-art fa-solid fa-magnifying-glass-location" aria-hidden="true"></i><p class="title">${localize("LUCD20.Search.NoSpots")}</p><p class="sub">${localize("LUCD20.Search.NoSpotsSub")}</p></div>`;
    return `
      <div class="lucd20-loot-body">
        <p class="lucd20-loot-taker lucd20-loot-hint">${icon("fa-circle-info")}<span>${localize("LUCD20.Search.ManagerHint")}</span></p>
        <div class="lucd20-loot-list">${list}</div>
        <footer class="lucd20-loot-footer">
          <button type="button" class="ll-btn ll-btn-footer ll-btn-primary" data-action="place">${icon("fa-magnifying-glass-location")}<span>${localize("LUCD20.Search.Place")}</span></button>
          <button type="button" class="ll-btn ll-btn-footer" data-action="resetAll" ${spots.length ? "" : "disabled"}>${icon("fa-rotate-left")}<span>${localize("LUCD20.Search.ResetAll")}</span></button>
        </footer>
      </div>`;
  }

  _replaceHTML(result, content) {
    const top = content.querySelector(".lucd20-loot-list")?.scrollTop ?? 0;
    content.innerHTML = result;
    const list = content.querySelector(".lucd20-loot-list");
    if (list) list.scrollTop = top;
  }

  #spot(target) {
    const id = target.closest("[data-spot]")?.dataset.spot;
    return this.spots().find(s => s.id === id);
  }

  static async #onRoll(event, target) {
    const spot = this.#spot(target);
    if (!spot) return;
    target.disabled = true;
    await rollNow(spot, { allowNonSearching: SearchManager.hooks.allowNonSearching(spot), onFound: () => SearchManager.hooks.onFound(spot) });
    SearchManager.refresh();
  }

  static async #onReset(event, target) {
    const spot = this.#spot(target);
    if (spot) await resetSpot(spot);
    SearchManager.refresh();
  }

  static #onPan(event, target) {
    const centre = this.#spot(target)?.centre;
    if (centre) canvas.animatePan({ ...centre, duration: 500 });
  }

  static async #onEdit(event, target) {
    const spot = this.#spot(target);
    if (spot) await editSpot(spot);
    SearchManager.refresh();
  }

  static async #onRemove(event, target) {
    const spot = this.#spot(target);
    if (!spot) return;
    const confirmed = await DialogV2.confirm({
      window: { title: localize("LUCD20.Search.Delete") },
      content: `<p>${localize("LUCD20.Search.DeleteContent", { name: esc(spot.label) })}</p>`
    });
    if (confirmed) await spot.doc.delete();
    SearchManager.refresh();
  }

  static async #onResetAll() {
    for (const spot of this.spots()) if (spot.found || spot.failed.length) await resetSpot(spot);
    ui.notifications.info(localize("LUCD20.Search.ResetAllDone"));
    SearchManager.refresh();
  }
}
