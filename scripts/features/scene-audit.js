import { MODULE_ID, error, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { appElement } from "../core/dom.js";

/**
 * Scene Audit (GM): mark what is wrong on a map and export it.
 *
 * For checking imported scenes: the GM marks squares ("a wall is missing
 * here"), and exports one file that says where each mark is and also lists
 * the scene's walls, doors, tokens, notes and lights as they are now. Whoever
 * maintains the scene's source can then fix it from the file, or copy over
 * what the GM corrected by hand in Foundry.
 *
 * - Two tools in the Token controls: "Mark a problem" (click squares one by
 *   one, or drag, to pick any shape; Done; then say what is wrong) and
 *   "Scene Audit" (the list).
 * - Marks are kept on the scene (flag `audit`) and drawn for the GM only.
 * - Export: one JSON file, for this scene or for every scene with marks.
 *   Positions are in squares counted from the top-left of the map image.
 */

const FLAG = "audit";
const KINDS = ["wallMissing", "wallWrong", "door", "token", "grid", "other"];
const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const { ApplicationV2, DialogV2 } = foundry.applications.api;
const L = (key, data) => localize(`LUCD20.SceneAudit.${key}`, data);

const state = { feature: null, layer: null, placer: null };

/* -------------------------------------------- */
/*  Marks                                       */
/* -------------------------------------------- */

const marksOf = scene => foundry.utils.deepClone(scene?.flags?.[MODULE_ID]?.[FLAG] ?? []);
const newId = () => foundry.utils.randomID?.() ?? Math.random().toString(36).slice(2, 18);

async function saveMarks(scene, marks) {
  await scene.setFlag(MODULE_ID, FLAG, marks);
  redraw();
  AuditWindow.refresh();
}

/** Where the map image starts on the canvas, and the size of a square. */
function frame(scene = canvas.scene) {
  const d = scene?.dimensions ?? canvas.dimensions;
  return { x: d?.sceneX ?? 0, y: d?.sceneY ?? 0, size: d?.size ?? scene?.grid?.size ?? 100 };
}

/** The squares of a mark as [[col, row], …] (marks made before v0.33.1 stored one rectangle). */
function squaresOf(mark) {
  if (Array.isArray(mark.squares)) return mark.squares;
  const c = mark.cells ?? { c0: 0, r0: 0, c1: 0, r1: 0 };
  const out = [];
  for (let row = c.r0; row <= c.r1; row++) for (let col = c.c0; col <= c.c1; col++) out.push([col, row]);
  return out;
}

/** The rectangle around a set of squares. */
function bounds(squares) {
  const cols = squares.map(q => q[0]);
  const rows = squares.map(q => q[1]);
  return { c0: Math.min(...cols), r0: Math.min(...rows), c1: Math.max(...cols), r1: Math.max(...rows) };
}

function squaresText(squares) {
  if (squares.length === 1) return L("Cell", { col: squares[0][0], row: squares[0][1] });
  const b = bounds(squares);
  return L("Cells", { count: squares.length, c0: b.c0, r0: b.r0, c1: b.c1, r1: b.r1 });
}

/** Ask what is wrong. → { kind, note } or null. */
async function askMark(mark = {}) {
  const content = `<div class="lucd20-search-form">
      <label class="row"><span>${L("Kind")}</span><select name="kind">${KINDS.map(k => `<option value="${k}" ${k === mark.kind ? "selected" : ""}>${L(`Kinds.${k}`)}</option>`).join("")}</select></label>
      <label class="row column"><span>${L("Note")}</span><textarea name="note" rows="3" placeholder="${esc(L("NoteHint"))}">${esc(mark.note ?? "")}</textarea></label>
    </div>`;
  return DialogV2.wait({
    classes: ["lucd20-loot-app", "lucd20-audit-dialog"],
    window: { title: L("MarkTitle"), icon: "fa-solid fa-flag" },
    position: { width: 380 },
    content,
    rejectClose: false,
    buttons: [
      { action: "save", label: L("Save"), icon: "fa-solid fa-check", default: true, callback: (event, button) => ({ kind: button.form.elements.kind.value, note: button.form.elements.note.value.trim() }) },
      { action: "cancel", label: L("Cancel"), icon: "fa-solid fa-xmark", callback: () => null }
    ]
  });
}

async function addMark(squares) {
  if (!squares.length) return;
  const answer = await askMark();
  if (!answer || typeof answer !== "object") return;
  const scene = canvas.scene;
  await saveMarks(scene, [...marksOf(scene), { id: newId(), squares, ...answer }]);
}

/* -------------------------------------------- */
/*  Drawing on the map (GM only)                */
/* -------------------------------------------- */

function redraw() {
  state.layer?.destroy({ children: true });
  state.layer = null;
  if (!state.feature?.active || !game.user.isGM || !canvas?.ready) return;
  const marks = marksOf(canvas.scene);
  if (!marks.length) return;
  const { x, y, size } = frame();
  const layer = new PIXI.Container();
  layer.eventMode = "none";
  marks.forEach((mark, i) => {
    const squares = squaresOf(mark);
    const c = { c0: squares[0][0], r0: squares[0][1] }; // the number sits on the first square
    const box = new PIXI.Graphics();
    box.lineStyle(Math.max(3, size / 25), 0xff3df2, 0.95).beginFill(0xff3df2, 0.18);
    for (const [col, row] of squares) box.drawRect(x + col * size, y + row * size, size, size);
    box.endFill();
    layer.addChild(box);
    const label = new PIXI.Text(String(i + 1), { fontFamily: "Signika, sans-serif", fontSize: size * 0.55, fontWeight: "700", fill: 0xffffff, stroke: 0x000000, strokeThickness: Math.max(4, size / 16) });
    label.anchor.set(0.5);
    label.position.set(x + (c.c0 + 0.5) * size, y + (c.r0 + 0.5) * size);
    layer.addChild(label);
  });
  (canvas.interface ?? canvas.controls ?? canvas.stage).addChild(layer);
  state.layer = layer;
}

/**
 * Pick the squares of a mark: each click adds a square (click it again to take
 * it out), dragging paints over several, so any shape works (an L, a corridor).
 * A small bar at the top has Done and Cancel; Enter and Esc do the same.
 */
class Placer {
  constructor() {
    for (const name of ["down", "move", "up", "key", "context"]) this[name] = this[name].bind(this);
    this.squares = new Map(); // "col,row" → [col, row]
  }

  static start() {
    state.placer?.stop();
    state.placer = new Placer();
    state.placer.begin();
  }

  begin() {
    window.addEventListener("pointerdown", this.down, true);
    window.addEventListener("pointermove", this.move, true);
    window.addEventListener("pointerup", this.up, true);
    window.addEventListener("keydown", this.key, true);
    window.addEventListener("contextmenu", this.context, true);
    this.bar = document.createElement("div");
    this.bar.className = "lucd20-audit-bar";
    this.bar.innerHTML = `<i class="fa-solid fa-flag"></i><span class="text"></span>
      <button type="button" data-do="done"><i class="fa-solid fa-check"></i> ${L("Done")}</button>
      <button type="button" data-do="cancel"><i class="fa-solid fa-xmark"></i> ${L("Cancel")}</button>`;
    this.bar.addEventListener("click", event => {
      const what = event.target.closest("[data-do]")?.dataset.do;
      if (what === "done") this.finish();
      else if (what === "cancel") this.stop();
    });
    document.body.append(this.bar);
    this.refresh();
  }

  stop() {
    window.removeEventListener("pointerdown", this.down, true);
    window.removeEventListener("pointermove", this.move, true);
    window.removeEventListener("pointerup", this.up, true);
    window.removeEventListener("keydown", this.key, true);
    window.removeEventListener("contextmenu", this.context, true);
    this.preview?.destroy();
    this.preview = null;
    this.bar?.remove();
    this.bar = null;
    if (state.placer === this) state.placer = null;
  }

  async finish() {
    const squares = [...this.squares.values()];
    this.stop();
    await addMark(squares);
  }

  point(event) {
    if (canvas.canvasCoordinatesFromClient) return canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
    const rect = canvas.app.view.getBoundingClientRect();
    return canvas.stage.worldTransform.applyInverse(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
  }

  /** The square under a canvas point, counted from the map image's corner. */
  square(p) {
    const { x, y, size } = frame();
    return [Math.floor((p.x - x) / size), Math.floor((p.y - y) / size)];
  }

  /** Add or take out one square. `on` forces it (used while dragging). */
  toggle(square, on) {
    const key = square.join(",");
    const add = on ?? !this.squares.has(key);
    if (add) this.squares.set(key, square);
    else this.squares.delete(key);
    this.refresh();
    return add;
  }

  refresh() {
    const { x, y, size } = frame();
    if (!this.preview) {
      this.preview = new PIXI.Graphics();
      this.preview.eventMode = "none";
      (canvas.interface ?? canvas.controls ?? canvas.stage).addChild(this.preview);
    }
    this.preview.clear().lineStyle(3, 0xff3df2, 0.95).beginFill(0xff3df2, 0.25);
    for (const [col, row] of this.squares.values()) this.preview.drawRect(x + col * size, y + row * size, size, size);
    this.preview.endFill();
    const text = this.bar?.querySelector(".text");
    if (text) text.textContent = this.squares.size ? L("Picked", { count: this.squares.size }) : L("PlaceHint");
    const done = this.bar?.querySelector('[data-do="done"]');
    if (done) done.disabled = !this.squares.size;
  }

  down(event) {
    if (event.target !== canvas.app?.view) return;
    if (event.button === 2) return this.cancel(event);
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    // The first square decides what the drag does: paint squares in, or take them out.
    this.painting = { on: this.toggle(this.square(this.point(event))) };
  }

  move(event) {
    if (!this.painting || event.target !== canvas.app?.view) return;
    this.toggle(this.square(this.point(event)), this.painting.on);
  }

  up(event) {
    if (!this.painting || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.painting = null;
  }

  key(event) {
    if (event.key === "Escape") this.cancel(event);
    else if (event.key === "Enter" && this.squares.size) {
      event.preventDefault();
      event.stopPropagation();
      this.finish();
    }
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

/* -------------------------------------------- */
/*  Export                                      */
/* -------------------------------------------- */

const round = n => Math.round(n * 100) / 100;

/** Everything about one scene that helps fix its source: marks, and what is on the map now. */
export function sceneReport(scene) {
  const { x, y, size } = frame(scene);
  const gx = v => round((v - x) / size);
  const gy = v => round((v - y) / size);
  const level = scene.initialLevel && typeof scene.initialLevel === "object" ? scene.initialLevel : scene.levels?.get?.(scene.initialLevel);
  const list = collection => [...(collection ?? [])];
  return {
    name: scene.name,
    id: scene.id,
    image: level?.background?.src ?? scene.background?.src ?? null,
    grid: { size, type: scene.grid?.type ?? null, distance: scene.grid?.distance ?? null, units: scene.grid?.units ?? null },
    size: { squaresWide: round((scene.width ?? 0) / size), squaresHigh: round((scene.height ?? 0) / size), width: scene.width, height: scene.height, padding: scene.padding, sceneX: x, sceneY: y },
    marks: marksOf(scene).map((m, i) => ({ n: i + 1, kind: m.kind, note: m.note, squares: squaresOf(m), bounds: bounds(squaresOf(m)) })),
    walls: list(scene.walls).map(w => ({ c: [gx(w.c[0]), gy(w.c[1]), gx(w.c[2]), gy(w.c[3])], door: w.door, ds: w.ds, move: w.move, sight: w.sight, dir: w.dir })),
    tokens: list(scene.tokens).map(t => ({ name: t.name, actorId: t.actorId ?? t.actor?.id ?? null, col: gx(t.x), row: gy(t.y), width: t.width, height: t.height, hidden: !!t.hidden })),
    notes: list(scene.notes).map(n => ({ col: gx(n.x), row: gy(n.y), text: n.text, entryId: n.entryId, pageId: n.pageId })),
    lights: list(scene.lights).map(l => ({ col: gx(l.x), row: gy(l.y), dim: l.config?.dim, bright: l.config?.bright }))
  };
}

export function auditReport(scenes) {
  return {
    format: "lucd20-scene-audit",
    version: 1,
    exported: new Date().toISOString(),
    foundry: game.version ?? game.release?.version ?? null,
    system: game.system?.id ?? null,
    about: "Positions are in squares from the top-left corner of the map image (col, row; walls as [x1, y1, x2, y2]). A mark lists its squares as [col, row]; bounds is the rectangle around them.",
    scenes: scenes.map(sceneReport)
  };
}

function download(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scene";

function exportScenes(scenes, name) {
  if (!scenes.length) return ui.notifications?.warn(L("NothingToExport"));
  download(`scene-audit-${name}.json`, auditReport(scenes));
  ui.notifications?.info(L("Exported", { count: scenes.length }));
}

/* -------------------------------------------- */
/*  List window                                 */
/* -------------------------------------------- */

class AuditWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "lucd20-scene-audit",
    classes: ["lucd20-loot-app", "lucd20-audit-window"],
    window: { title: "LUCD20.SceneAudit.Title", icon: "fa-solid fa-clipboard-list", resizable: true },
    position: { width: 460, height: 480 },
    actions: {
      mark: () => Placer.start(),
      edit: AuditWindow.#onEdit,
      remove: AuditWindow.#onRemove,
      pan: AuditWindow.#onPan,
      exportScene: () => exportScenes(canvas.scene ? [canvas.scene] : [], slug(canvas.scene?.name)),
      exportAll: () => exportScenes([...game.scenes].filter(s => marksOf(s).length), "all"),
      clear: AuditWindow.#onClear
    }
  };

  static get instance() {
    return foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id) ?? null;
  }

  static open() {
    return (this.instance ?? new this()).render({ force: true });
  }

  static refresh() {
    const app = this.instance;
    if (app?.rendered) app.render();
  }

  async _renderHTML() {
    const scene = canvas.scene;
    const marks = marksOf(scene);
    const others = [...(game.scenes ?? [])].filter(s => s !== scene && marksOf(s).length).length;
    const rows = marks.map((m, i) => `<li class="lucd20-audit-row" data-id="${esc(m.id)}">
        <span class="n">${i + 1}</span>
        <div class="who"><span class="name">${L(`Kinds.${m.kind}`)} <span class="sub">${esc(squaresText(squaresOf(m)))}</span></span>${m.note ? `<span class="note">${esc(m.note)}</span>` : ""}</div>
        <div class="actions">
          <button type="button" class="ll-btn ll-btn-square" data-action="pan" data-tooltip="${esc(L("Pan"))}" aria-label="${esc(L("Pan"))}"><i class="fa-solid fa-location-crosshairs ll-i"></i></button>
          <button type="button" class="ll-btn ll-btn-square" data-action="edit" data-tooltip="${esc(L("Edit"))}" aria-label="${esc(L("Edit"))}"><i class="fa-solid fa-pen ll-i"></i></button>
          <button type="button" class="ll-btn ll-btn-square ll-btn-danger" data-action="remove" data-tooltip="${esc(L("Remove"))}" aria-label="${esc(L("Remove"))}"><i class="fa-solid fa-trash ll-i"></i></button>
        </div>
      </li>`).join("");
    return `<div class="lucd20-audit-body">
        <p class="lucd20-audit-scene"><strong>${esc(scene?.name ?? L("NoScene"))}</strong><span>${L("Count", { count: marks.length })}${others ? ` · ${L("Others", { count: others })}` : ""}</span></p>
        <div class="lucd20-audit-scroll">${marks.length ? `<ol class="lucd20-audit-list">${rows}</ol>`
          : `<div class="lucd20-loot-empty"><i class="fa-solid fa-flag ll-empty-art"></i><p class="title">${L("Empty")}</p><p class="sub">${L("EmptyHint")}</p></div>`}</div>
        <footer class="lucd20-loot-footer">
          <button type="button" class="ll-btn ll-btn-footer ll-btn-take" data-action="mark" ${scene ? "" : "disabled"}><i class="fa-solid fa-flag ll-i"></i> ${L("Mark")}</button>
          <button type="button" class="ll-btn ll-btn-footer" data-action="exportScene" ${scene ? "" : "disabled"} data-tooltip="${esc(L("ExportHint"))}"><i class="fa-solid fa-file-export ll-i"></i> ${L("ExportScene")}</button>
          <button type="button" class="ll-btn ll-btn-footer" data-action="exportAll" ${marks.length || others ? "" : "disabled"}><i class="fa-solid fa-file-export ll-i"></i> ${L("ExportAll")}</button>
          <button type="button" class="ll-btn ll-btn-footer ll-btn-danger" data-action="clear" ${marks.length ? "" : "disabled"}><i class="fa-solid fa-trash ll-i"></i> ${L("Clear")}</button>
        </footer>
      </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static #mark(target) {
    const id = target.closest("[data-id]")?.dataset.id;
    const marks = marksOf(canvas.scene);
    return { marks, index: marks.findIndex(m => m.id === id) };
  }

  static async #onEdit(event, target) {
    const { marks, index } = AuditWindow.#mark(target);
    if (index < 0) return;
    const answer = await askMark(marks[index]);
    if (!answer || typeof answer !== "object") return;
    Object.assign(marks[index], answer);
    await saveMarks(canvas.scene, marks);
  }

  static async #onRemove(event, target) {
    const { marks, index } = AuditWindow.#mark(target);
    if (index < 0) return;
    marks.splice(index, 1);
    await saveMarks(canvas.scene, marks);
  }

  static #onPan(event, target) {
    const { marks, index } = AuditWindow.#mark(target);
    if (index < 0) return;
    const { x, y, size } = frame();
    const c = bounds(squaresOf(marks[index]));
    canvas.animatePan?.({ x: x + ((c.c0 + c.c1 + 1) / 2) * size, y: y + ((c.r0 + c.r1 + 1) / 2) * size, duration: 300 });
  }

  static async #onClear() {
    const ok = await DialogV2.confirm({ window: { title: L("Clear"), icon: "fa-solid fa-trash" }, content: `<p>${L("ClearConfirm", { name: esc(canvas.scene?.name) })}</p>` });
    if (ok) await saveMarks(canvas.scene, []);
  }
}

/* -------------------------------------------- */
/*  Scene controls                              */
/* -------------------------------------------- */

function onSceneControls(controls) {
  if (!game.user.isGM) return;
  const tokens = Array.isArray(controls) ? controls.find(c => c.name === "token") : controls?.tokens ?? controls?.token;
  if (!tokens?.tools) return;
  const tools = [
    { name: "lucd20AuditMark", title: L("Mark"), icon: "fa-solid fa-flag", button: true, visible: true, order: 95, onChange: () => Placer.start(), onClick: () => Placer.start() },
    { name: "lucd20AuditList", title: L("Title"), icon: "fa-solid fa-clipboard-list", button: true, visible: true, order: 96, onChange: () => AuditWindow.open(), onClick: () => AuditWindow.open() }
  ];
  for (const tool of tools) {
    if (Array.isArray(tokens.tools)) {
      if (tokens.tools.some(t => t.name === tool.name)) continue;
      delete tool.onChange;
      tokens.tools.push(tool);
    } else {
      delete tool.onClick;
      tokens.tools[tool.name] = tool;
    }
  }
}

const refreshControls = () => {
  try {
    if (canvas?.ready) ui.controls?.render?.({ reset: true });
  } catch (err) {
    error("Scene Audit: could not refresh the scene controls.", err);
  }
};

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

defineFeature({
  id: "sceneAudit",
  category: "scenes",
  scope: "world",
  gmOnly: true,
  defaultEnabled: false,

  enable(feature) {
    state.feature = feature;
    if (!game.user.isGM) return;
    feature.on("getSceneControlButtons", onSceneControls);
    feature.on("canvasReady", () => {
      redraw();
      AuditWindow.refresh();
    });
    feature.on("updateScene", (scene, change) => {
      if (scene === canvas.scene && change?.flags?.[MODULE_ID]) redraw();
      AuditWindow.refresh();
    });
    refreshControls();
    redraw();
    feature.onCleanup(() => {
      state.placer?.stop();
      state.layer?.destroy({ children: true });
      state.layer = null;
      AuditWindow.instance?.close();
      state.feature = null;
      refreshControls();
    });
  }
});

/** For the harness. */
export const _test = { AuditWindow, Placer, addMark, marksOf, squaresOf, state };
