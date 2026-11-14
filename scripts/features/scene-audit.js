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
 * - Two tools in the Token controls: "Mark a problem" (click a square or drag
 *   over several, then say what is wrong) and "Scene Audit" (the list).
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

const cellsText = c => (c.c0 === c.c1 && c.r0 === c.r1 ? L("Cell", { col: c.c0, row: c.r0 }) : L("Cells", { c0: c.c0, r0: c.r0, c1: c.c1, r1: c.r1 }));

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

async function addMark(cells) {
  const answer = await askMark();
  if (!answer || typeof answer !== "object") return;
  const scene = canvas.scene;
  await saveMarks(scene, [...marksOf(scene), { id: newId(), cells, ...answer }]);
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
    const c = mark.cells;
    const box = new PIXI.Graphics();
    box.lineStyle(Math.max(3, size / 25), 0xff3df2, 0.95).beginFill(0xff3df2, 0.18)
      .drawRect(x + c.c0 * size, y + c.r0 * size, (c.c1 - c.c0 + 1) * size, (c.r1 - c.r0 + 1) * size).endFill();
    layer.addChild(box);
    const label = new PIXI.Text(String(i + 1), { fontFamily: "Signika, sans-serif", fontSize: size * 0.55, fontWeight: "700", fill: 0xffffff, stroke: 0x000000, strokeThickness: Math.max(4, size / 16) });
    label.anchor.set(0.5);
    label.position.set(x + (c.c0 + 0.5) * size, y + (c.r0 + 0.5) * size);
    layer.addChild(label);
  });
  (canvas.interface ?? canvas.controls ?? canvas.stage).addChild(layer);
  state.layer = layer;
}

/** Click a square, or drag over several. Right-click or Esc stops. */
class Placer {
  constructor() {
    for (const name of ["down", "move", "up", "key", "context"]) this[name] = this[name].bind(this);
  }

  static start() {
    state.placer?.stop();
    state.placer = new Placer();
    state.placer.begin();
    ui.notifications?.info(L("PlaceHint"));
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
    if (state.placer === this) state.placer = null;
  }

  point(event) {
    if (canvas.canvasCoordinatesFromClient) return canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
    const rect = canvas.app.view.getBoundingClientRect();
    return canvas.stage.worldTransform.applyInverse(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
  }

  cells(a, b) {
    const { x, y, size } = frame();
    const col = p => Math.floor((p.x - x) / size);
    const row = p => Math.floor((p.y - y) / size);
    return { c0: Math.min(col(a), col(b)), r0: Math.min(row(a), row(b)), c1: Math.max(col(a), col(b)), r1: Math.max(row(a), row(b)) };
  }

  draw(c) {
    const { x, y, size } = frame();
    if (!this.preview) {
      this.preview = new PIXI.Graphics();
      this.preview.eventMode = "none";
      (canvas.interface ?? canvas.controls ?? canvas.stage).addChild(this.preview);
    }
    this.preview.clear().lineStyle(3, 0xff3df2, 0.95).beginFill(0xff3df2, 0.2)
      .drawRect(x + c.c0 * size, y + c.r0 * size, (c.c1 - c.c0 + 1) * size, (c.r1 - c.r0 + 1) * size).endFill();
  }

  down(event) {
    if (event.target !== canvas.app?.view) return;
    if (event.button === 2) return this.cancel(event);
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.start = this.point(event);
    this.draw(this.cells(this.start, this.start));
  }

  move(event) {
    if (!this.start || event.target !== canvas.app?.view) return;
    this.draw(this.cells(this.start, this.point(event)));
  }

  async up(event) {
    if (!this.start || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const cells = this.cells(this.start, this.point(event));
    this.stop();
    await addMark(cells);
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
    marks: marksOf(scene).map((m, i) => ({ n: i + 1, kind: m.kind, note: m.note, cells: m.cells })),
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
    about: "Positions are in squares from the top-left corner of the map image (col, row; walls as [x1, y1, x2, y2]). cells: c0,r0 = first square, c1,r1 = last square of a mark.",
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
        <div class="who"><span class="name">${L(`Kinds.${m.kind}`)} <span class="sub">${esc(cellsText(m.cells))}</span></span>${m.note ? `<span class="note">${esc(m.note)}</span>` : ""}</div>
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
    const c = marks[index].cells;
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
export const _test = { AuditWindow, Placer, addMark, marksOf, state };
