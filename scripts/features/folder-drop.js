import { TEMPLATE_PATH, error, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { findFreeSpot, occupiedRects, snapTopLeft } from "../core/placement.js";

/**
 * Folder Drop (replaces DFreds Droppables). GM only.
 *
 * Drop an actor folder on the map (or, in PF2e, a Party — hold Alt to drop the
 * Party token itself) and place every actor in it:
 *   - Random: scattered around the drop point, on the grid, never overlapping
 *     tokens, never inside or across a wall from the drop point.
 *   - Select places: a list of the actors (alphabetical). Click the map to place
 *     the highlighted one (a see-through preview follows the cursor); the list
 *     moves to the next. Click another actor in the list to place it instead.
 *     Right-click or Esc to stop.
 * Option: drop as hidden. Subfolders are included only if the option is on.
 */

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const loadTexture = src => (foundry.canvas?.loadTexture ?? globalThis.loadTexture)(src);

const state = { feature: null, session: null };

/* -------------------------------------------- */
/*  What was dropped                            */
/* -------------------------------------------- */

function folderActors(folder) {
  const folders = state.feature.get("includeSubfolders") ? [folder, ...(folder.getSubfolders?.(true) ?? [])] : [folder];
  return folders.flatMap(f => f.contents ?? []).filter(a => a?.documentName === "Actor");
}

function altHeld(event) {
  return !!(event?.altKey || game.keyboard?.isModifierActive?.("Alt"));
}

function onDropCanvasData(canvasObj, data, event) {
  if (!game.user.isGM || !data) return;
  let actors = null;

  if (data.type === "Folder") {
    const folder = data.uuid ? fromUuidSync(data.uuid) : game.folders.get(data.id);
    if (folder?.type !== "Actor") return;
    actors = folderActors(folder);
  } else if (data.type === "Actor") {
    const actor = data.uuid ? fromUuidSync(data.uuid) : game.actors.get(data.id);
    // PF2e Party: place its members (everyone listed in the party folder).
    if (actor?.type !== "party" || !Array.isArray(actor.members) || altHeld(event)) return;
    actors = actor.members.filter(Boolean);
  } else return;

  if (!actors.length) {
    ui.notifications.warn(localize("LUCD20.FolderDrop.Empty"));
    return false;
  }
  handleDrop(actors, { x: data.x, y: data.y }).catch(err => error("Folder drop failed.", err));
  return false;
}

async function handleDrop(actors, origin) {
  const feature = state.feature;
  actors = [...actors].sort((a, b) => a.name.localeCompare(b.name));
  let mode = feature.get("placement");
  let hidden = feature.get("hidden");

  if (mode === "ask") {
    const choice = await askPlacement(actors, hidden);
    if (!choice) return;
    ({ mode, hidden } = choice);
  }
  if (mode === "random") await placeRandom(actors, origin, { hidden });
  else if (mode === "select") await PlacementSession.start(actors, { hidden });
}

async function askPlacement(actors, hidden) {
  const names = actors.slice(0, 12).map(a => esc(a.name)).join(", ") + (actors.length > 12 ? ", …" : "");
  const content = `
    <div class="lucd20-folder-drop-dialog">
      <p class="hint">${names}</p>
      <label class="lucd20-radio"><input type="radio" name="mode" value="random" checked>
        <span><strong>${localize("LUCD20.FolderDrop.Mode.random.Label")}</strong>
        <span class="hint">${localize("LUCD20.FolderDrop.Mode.random.Hint")}</span></span></label>
      <label class="lucd20-radio"><input type="radio" name="mode" value="select">
        <span><strong>${localize("LUCD20.FolderDrop.Mode.select.Label")}</strong>
        <span class="hint">${localize("LUCD20.FolderDrop.Mode.select.Hint")}</span></span></label>
      <label class="lucd20-check"><input type="checkbox" name="hidden" ${hidden ? "checked" : ""}> ${localize("LUCD20.FolderDrop.Hidden")}</label>
    </div>`;
  return DialogV2.wait({
    window: { title: localize("LUCD20.FolderDrop.DialogTitle", { count: actors.length }), icon: "fa-solid fa-users" },
    classes: ["lucd20-folder-drop"],
    content,
    buttons: [
      {
        action: "place",
        label: localize("LUCD20.FolderDrop.Place"),
        icon: "fa-solid fa-check",
        default: true,
        callback: (event, button) => ({ mode: button.form.elements.mode.value, hidden: button.form.elements.hidden.checked })
      },
      { action: "cancel", label: localize("LUCD20.FolderDrop.Cancel"), icon: "fa-solid fa-xmark", callback: () => null }
    ],
    rejectClose: false
  });
}

/* -------------------------------------------- */
/*  Geometry                                    */
/* -------------------------------------------- */

function tokenSize(actor) {
  const size = canvas.dimensions.size;
  const proto = actor.prototypeToken;
  return { w: (proto?.width ?? 1) * size, h: (proto?.height ?? 1) * size };
}

async function tokenData(actor, position, hidden) {
  const doc = await actor.getTokenDocument({ x: position.x, y: position.y, hidden: hidden || actor.prototypeToken?.hidden });
  return doc.toObject();
}

async function placeRandom(actors, origin, { hidden }) {
  const occupied = occupiedRects();
  const data = [];
  let skipped = 0;
  for (const actor of actors) {
    const { w, h } = tokenSize(actor);
    const spot = findFreeSpot(origin, w, h, { occupied, random: true });
    if (!spot) {
      skipped++;
      continue;
    }
    occupied.push({ ...spot, w, h });
    data.push(await tokenData(actor, spot, hidden));
  }
  if (data.length) await canvas.scene.createEmbeddedDocuments("Token", data);
  if (skipped) ui.notifications.warn(localize("LUCD20.FolderDrop.NoRoom", { count: skipped }));
}

/* -------------------------------------------- */
/*  Select places                               */
/* -------------------------------------------- */

class PlacementPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "lucd20-folder-drop-panel",
    classes: ["lucd20-placement"],
    window: { title: "LUCD20.FolderDrop.PanelTitle", icon: "fa-solid fa-location-dot" },
    position: { width: 280, height: "auto", top: 80, left: 120 },
    actions: {
      pick: PlacementPanel.#onPick,
      randomRest: PlacementPanel.#onRandomRest,
      done: PlacementPanel.#onDone
    }
  };

  static PARTS = { list: { template: `${TEMPLATE_PATH}/folder-drop-panel.hbs` } };

  constructor(session, options) {
    super(options);
    this.session = session;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const s = this.session;
    return Object.assign(context, {
      entries: s.entries.map((e, i) => ({ index: i, name: e.actor.name, img: e.img, placed: e.placed, current: i === s.index })),
      hint: localize("LUCD20.FolderDrop.PanelHint"),
      labels: { randomRest: localize("LUCD20.FolderDrop.RandomRest"), done: localize("LUCD20.FolderDrop.Done") }
    });
  }

  static #onPick(event, target) {
    this.session.select(Number(target.dataset.index));
  }

  static async #onRandomRest() {
    await this.session.randomRest();
  }

  static #onDone() {
    this.session.finish();
  }

  async _onClose(options) {
    await super._onClose?.(options);
    this.session.panelClosed = true;
    if (this.session.active) this.session.finish();
  }
}

class PlacementSession {
  static async start(actors, { hidden }) {
    state.session?.finish();
    const session = new PlacementSession(actors, hidden);
    state.session = session;
    await session.begin();
    return session;
  }

  constructor(actors, hidden) {
    this.hidden = hidden;
    this.entries = actors.map(actor => {
      const src = actor.prototypeToken?.texture?.src;
      return { actor, placed: false, img: src && !src.includes("*") ? src : actor.img };
    });
    this.index = 0;
    this.active = true;
    this.preview = null;
    this.lastPoint = null;
    this.onMove = this.onMove.bind(this);
    this.onDown = this.onDown.bind(this);
    this.onKey = this.onKey.bind(this);
    this.onContext = this.onContext.bind(this);
  }

  get current() {
    return this.entries[this.index];
  }

  async begin() {
    window.addEventListener("pointermove", this.onMove, true);
    window.addEventListener("pointerdown", this.onDown, true);
    window.addEventListener("contextmenu", this.onContext, true);
    window.addEventListener("keydown", this.onKey, true);
    this.panel = new PlacementPanel(this);
    await this.panel.render({ force: true });
    await this.updatePreview();
  }

  finish() {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener("pointermove", this.onMove, true);
    window.removeEventListener("pointerdown", this.onDown, true);
    window.removeEventListener("contextmenu", this.onContext, true);
    window.removeEventListener("keydown", this.onKey, true);
    this.destroyPreview();
    if (state.session === this) state.session = null;
    if (this.panel?.rendered && !this.panelClosed) this.panel.close();
  }

  select(index) {
    if (!this.entries[index] || this.entries[index].placed) return;
    this.index = index;
    this.panel.render();
    this.updatePreview();
  }

  advance() {
    const next = this.entries.findIndex((e, i) => !e.placed && i > this.index);
    const any = next >= 0 ? next : this.entries.findIndex(e => !e.placed);
    if (any < 0) return this.finish();
    this.index = any;
    this.panel.render();
    this.updatePreview();
  }

  /* --- preview --- */

  destroyPreview() {
    const p = this.preview;
    this.preview = null;
    if (p && !p.destroyed) {
      p.parent?.removeChild(p);
      p.destroy({ children: true, texture: false, baseTexture: false });
    }
  }

  async updatePreview() {
    this.destroyPreview();
    const entry = this.current;
    if (!entry || !this.active || !canvas?.ready) return;
    let texture;
    try {
      texture = await loadTexture(entry.img);
    } catch {
      return;
    }
    if (!texture || !this.active || this.current !== entry) return;
    const { w, h } = tokenSize(entry.actor);
    const art = entry.actor.prototypeToken?.texture ?? {};
    const sprite = new PIXI.Sprite(texture);
    // Same size as the real token: footprint × art scale, centred on the footprint.
    sprite.anchor.set(0.5, 0.5);
    sprite.width = w * Math.abs(art.scaleX ?? 1);
    sprite.height = h * Math.abs(art.scaleY ?? 1);
    sprite.alpha = 0.5;
    sprite.eventMode = "none";
    (canvas.controls ?? canvas.stage).addChild(sprite);
    this.preview = sprite;
    if (this.lastPoint) this.movePreview(this.lastPoint);
  }

  movePreview(point) {
    const entry = this.current;
    if (!this.preview || !entry) return;
    const { w, h } = tokenSize(entry.actor);
    const pos = snapTopLeft(point, w, h);
    this.preview.position.set(pos.x + w / 2, pos.y + h / 2);
  }

  /* --- input --- */

  canvasPoint(event) {
    if (canvas.canvasCoordinatesFromClient) return canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
    const rect = canvas.app.view.getBoundingClientRect();
    return canvas.stage.worldTransform.applyInverse(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
  }

  onMove(event) {
    if (event.target !== canvas.app?.view) return;
    this.lastPoint = this.canvasPoint(event);
    this.movePreview(this.lastPoint);
  }

  onDown(event) {
    if (event.target !== canvas.app?.view) return;
    if (event.button === 0) {
      event.preventDefault();
      event.stopPropagation();
      this.placeCurrent(this.canvasPoint(event));
    } else if (event.button === 2) {
      event.preventDefault();
      event.stopPropagation();
      this.finish();
    }
  }

  onContext(event) {
    if (event.target === canvas.app?.view) event.preventDefault();
  }

  onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.finish();
    }
  }

  async placeCurrent(point) {
    const entry = this.current;
    if (!entry || entry.placed || this.busy) return;
    this.busy = true;
    try {
      const { w, h } = tokenSize(entry.actor);
      const pos = snapTopLeft(point, w, h);
      await canvas.scene.createEmbeddedDocuments("Token", [await tokenData(entry.actor, pos, this.hidden)]);
      entry.placed = true;
      this.advance();
    } catch (err) {
      error("Could not place token.", err);
    } finally {
      this.busy = false;
    }
  }

  async randomRest() {
    const rest = this.entries.filter(e => !e.placed).map(e => e.actor);
    const origin = this.lastPoint ?? { x: canvas.dimensions.width / 2, y: canvas.dimensions.height / 2 };
    this.finish();
    if (rest.length) await placeRandom(rest, origin, { hidden: this.hidden });
  }
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

defineFeature({
  id: "folderDrop",
  category: "tokens",
  scope: "world",
  defaultEnabled: false,
  settings: {
    placement: {
      kind: "select",
      default: "ask",
      choices: {
        ask: "LUCD20.FolderDrop.Placement.ask",
        random: "LUCD20.FolderDrop.Mode.random.Label",
        select: "LUCD20.FolderDrop.Mode.select.Label"
      }
    },
    hidden: { kind: "boolean", default: false },
    includeSubfolders: { kind: "boolean", default: false }
  },

  enable(feature) {
    state.feature = feature;
    feature.on("dropCanvasData", onDropCanvasData);
    feature.onCleanup(() => {
      state.session?.finish();
      state.feature = null;
    });
  }
});
