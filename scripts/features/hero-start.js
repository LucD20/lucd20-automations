import { MODULE_ID, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { addChatControl } from "../core/chat-controls.js";

/**
 * Hero Start Area (owner, PLAN §22.1 Q296; v0.87.0). Every system.
 * - When the GM creates an encounter on the viewed scene, a bar asks "Click on the map to create the start
 *   area | Cancel". A click marks a square; a click-and-drag marks a rectangle, **wall-aware**: only the
 *   squares reachable from the square where the drag started without crossing a wall (Foundry's movement
 *   walls). Shift + click / drag removes squares.
 * - The first area teleports every player character's token on the scene into it (one per free spot that
 *   fits the token; with no room left they stack on the first square). The GM can keep adding squares
 *   (Done or Escape ends that; reopened from the chat buttons while the encounter hasn't started).
 * - Everyone sees the area (players see where they start): our own canvas overlay, not a Region.
 * - Starting the encounter deletes the area (also when the encounter is deleted: it lived on its flag).
 * Stored on the combat: `flags.lucd20-automations.heroStart` = { scene, cells: ["col,row", …] }.
 * Square grids only (gridless and hex scenes: nothing happens).
 * (verify) in V14: the teleport (`animate: false`, `teleport: true`) moves the tokens without animation or
 * walls; the drag isn't seen by the token layer (pointer events taken in the capture phase).
 */

const FLAG = "heroStart";
const t = (key, data) => localize(`LUCD20.HeroStart.${key}`, data);
const PC_TYPES = ["character", "Player Character"];
const state = { layer: null, picker: null };

const gridSize = scene => scene?.grid?.size ?? canvas?.grid?.size ?? 100;
const squareGrid = scene => {
  const type = scene?.grid?.type ?? canvas?.grid?.type;
  return type === undefined || type === (CONST.GRID_TYPES?.SQUARE ?? 1);
};
const key = (c, r) => `${c},${r}`;
const parse = k => { const [c, r] = k.split(",").map(Number); return { c, r }; };

/** The encounter not yet started on the viewed scene (the one the area belongs to). */
function pendingCombat() {
  const list = typeof game.combats?.filter === "function" ? game.combats.filter(() => true) : [...(game.combats ?? [])];
  return list.find(c => !c.started && (c.scene?.id ?? c._source?.scene ?? null) === (canvas?.scene?.id ?? null)) ?? null;
}

const areaOf = combat => {
  const a = combat?.getFlag?.(MODULE_ID, FLAG);
  return a?.cells?.length && a.scene === canvas?.scene?.id ? a : null;
};

/* -------------------------------------------- */
/*  Walls and squares                           */
/* -------------------------------------------- */

function wallBetween(a, b) {
  const backend = CONFIG.Canvas?.polygonBackends?.move;
  if (!backend?.testCollision) return false;
  try { return !!backend.testCollision(a, b, { type: "move", mode: "any" }); } catch { return false; }
}

/**
 * The squares of the rectangle from `start` to `end` (cells) reachable from `start` without crossing a wall
 * (steps to the 8 neighbours; a diagonal needs no wall on the diagonal itself). Pure apart from the walls.
 */
export function reachableCells(start, end, { size = gridSize(canvas?.scene), blocked = wallBetween } = {}) {
  const c0 = Math.min(start.c, end.c), c1 = Math.max(start.c, end.c), r0 = Math.min(start.r, end.r), r1 = Math.max(start.r, end.r);
  const centre = (c, r) => ({ x: (c + 0.5) * size, y: (r + 0.5) * size });
  const seen = new Set([key(start.c, start.r)]);
  const queue = [start];
  while (queue.length) {
    const { c, r } = queue.shift();
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
      if (!dc && !dr) continue;
      const nc = c + dc, nr = r + dr, k = key(nc, nr);
      if (nc < c0 || nc > c1 || nr < r0 || nr > r1 || seen.has(k)) continue;
      if (blocked(centre(c, r), centre(nc, nr))) continue;
      seen.add(k);
      queue.push({ c: nc, r: nr });
    }
  }
  return [...seen];
}

/**
 * Where each token goes: the first spot (reading order) whose whole footprint is in the area and free (other
 * tokens, and those already placed); none left → the area's first square (they stack).
 * tokens [{ id, w, h }] (w, h in squares); occupied: Set of cell keys. → { id: { c, r } }
 */
export function placeTokens(cells, tokens, occupied = new Set()) {
  const area = new Set(cells);
  const order = cells.map(parse).sort((a, b) => a.r - b.r || a.c - b.c);
  const taken = new Set(occupied);
  const out = {};
  for (const tok of tokens) {
    const w = Math.max(1, Math.round(tok.w)), h = Math.max(1, Math.round(tok.h));
    const spot = order.find(({ c, r }) => {
      for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (!area.has(key(c + i, r + j)) || taken.has(key(c + i, r + j))) return false;
      return true;
    });
    const at = spot ?? order[0];
    if (spot) for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) taken.add(key(at.c + i, at.r + j));
    out[tok.id] = at;
  }
  return out;
}

/** Player characters' tokens on the scene. */
const heroTokens = scene => [...(scene?.tokens ?? [])].filter(d => d.actor?.hasPlayerOwner && PC_TYPES.includes(d.actor?.type));

async function teleportHeroes(scene, cells) {
  const size = gridSize(scene);
  const heroes = heroTokens(scene).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  if (!heroes.length) return;
  const ids = new Set(heroes.map(d => d.id));
  const occupied = new Set();
  for (const d of scene.tokens ?? []) {
    if (ids.has(d.id)) continue;
    const c = Math.round(d.x / size), r = Math.round(d.y / size);
    for (let i = 0; i < Math.max(1, Math.round(d.width)); i++) for (let j = 0; j < Math.max(1, Math.round(d.height)); j++) occupied.add(key(c + i, r + j));
  }
  const spots = placeTokens(cells, heroes.map(d => ({ id: d.id, w: d.width, h: d.height })), occupied);
  const updates = heroes.map(d => ({ _id: d.id, x: spots[d.id].c * size, y: spots[d.id].r * size }));
  await scene.updateEmbeddedDocuments("Token", updates, { animate: false, teleport: true, lucd20HeroStart: true });
}

/* -------------------------------------------- */
/*  The overlay (everyone)                      */
/* -------------------------------------------- */

const GOLD = 0xf0c060;

function drawCells(g, cells, size, { color = GOLD, alpha = 0.22, line = 0.9 } = {}) {
  const set = new Set(cells);
  g.beginFill(color, alpha);
  for (const k of cells) { const { c, r } = parse(k); g.drawRect(c * size, r * size, size, size); }
  g.endFill();
  // The outline: only the area's outer edges.
  g.lineStyle(Math.max(2, size / 25), color, line);
  for (const k of cells) {
    const { c, r } = parse(k), x = c * size, y = r * size;
    if (!set.has(key(c, r - 1))) { g.moveTo(x, y); g.lineTo(x + size, y); }
    if (!set.has(key(c, r + 1))) { g.moveTo(x, y + size); g.lineTo(x + size, y + size); }
    if (!set.has(key(c - 1, r))) { g.moveTo(x, y); g.lineTo(x, y + size); }
    if (!set.has(key(c + 1, r))) { g.moveTo(x + size, y); g.lineTo(x + size, y + size); }
  }
}

function redraw() {
  state.layer?.destroy({ children: true });
  state.layer = null;
  if (!canvas?.ready) return;
  const area = areaOf(pendingCombat());
  const preview = state.picker?.preview ?? null;
  if (!area && !preview) return;
  const size = gridSize(canvas.scene);
  const layer = new PIXI.Container();
  layer.eventMode = "none";
  layer.zIndex = 50;
  const g = new PIXI.Graphics();
  if (area) drawCells(g, area.cells, size);
  if (preview) drawCells(g, preview.cells, size, { color: preview.remove ? 0xe05040 : 0x7fd4ff, alpha: 0.3, line: 1 });
  layer.addChild(g);
  if (area) {
    const first = area.cells.map(parse).sort((a, b) => a.r - b.r || a.c - b.c)[0];
    const label = new PIXI.Text(t("Label"), { fontFamily: "Signika", fontSize: Math.max(14, size / 4), fill: 0xfff3d0, stroke: 0x000000, strokeThickness: 4, fontWeight: "700" });
    label.position.set(first.c * size + 4, first.r * size - label.height - 2);
    layer.addChild(label);
  }
  const parent = canvas.interface ?? canvas.controls ?? canvas.stage;
  parent.addChild(layer);
  if (parent.sortableChildren) parent.sortChildren?.();
  state.layer = layer;
}

/* -------------------------------------------- */
/*  Marking squares (GM)                        */
/* -------------------------------------------- */

function closePicker() {
  state.picker?.close();
  state.picker = null;
  redraw();
}

/** The bar and the clicks/drags on the map. Ends on Done / Cancel / Escape, or when the encounter starts. */
function openPicker(combat) {
  if (!game.user.isGM || !canvas?.ready || !combat || combat.started || !squareGrid(canvas.scene)) return;
  closePicker();
  const scene = canvas.scene;
  const size = gridSize(scene);
  const bar = document.createElement("div");
  bar.className = "lucd20-pick-bar lucd20-hero-start-bar";
  const text = document.createElement("span");
  const done = document.createElement("button");
  done.type = "button";
  bar.append(text, done);
  const setBar = () => {
    const has = !!areaOf(combat);
    text.textContent = has ? t("Adding") : t("Prompt");
    done.innerHTML = has ? `<i class="fa-solid fa-check"></i> ${t("Done")}` : `<i class="fa-solid fa-xmark"></i> ${t("Cancel")}`;
  };
  setBar();
  const hotbar = document.getElementById("hotbar")?.getBoundingClientRect();
  bar.style.bottom = `${hotbar?.height ? Math.max(8, window.innerHeight - hotbar.top + 12) : 100}px`;
  document.body.append(bar);

  const view = canvas.app?.view ?? document.body;
  const cellAt = event => {
    const rect = view.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    const p = canvas.stage?.worldTransform?.applyInverse
      ? canvas.stage.worldTransform.applyInverse(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top))
      : { x: event.clientX, y: event.clientY };
    return { c: Math.floor(p.x / size), r: Math.floor(p.y / size) };
  };
  const overUI = event => !!event.target?.closest?.(".application, #sidebar, #ui-left, #ui-right, #hotbar, #navigation, .lucd20-pick-bar, #lucd20-combat-cards");
  const swallow = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  let drag = null;
  const picker = { preview: null, close: null };

  function onDown(event) {
    if (event.button !== 0 || overUI(event)) return;
    swallow(event);
    drag = { start: cellAt(event), remove: event.shiftKey };
    picker.preview = { cells: [key(drag.start.c, drag.start.r)], remove: drag.remove };
    redraw();
  }
  function onMove(event) {
    if (!drag) return;
    swallow(event);
    const end = cellAt(event);
    if (end.c === drag.end?.c && end.r === drag.end?.r) return;
    drag.end = end;
    picker.preview = { cells: reachableCells(drag.start, end, { size }), remove: drag.remove };
    redraw();
  }
  async function onUp(event) {
    if (!drag) return;
    swallow(event);
    const cells = picker.preview?.cells ?? [];
    const remove = drag.remove;
    drag = null;
    picker.preview = null;
    const before = areaOf(combat)?.cells ?? [];
    const next = remove ? before.filter(k => !cells.includes(k)) : [...new Set([...before, ...cells])];
    await combat.setFlag(MODULE_ID, FLAG, { scene: scene.id, cells: next });
    // The first area: everyone's heroes go in.
    if (!before.length && next.length) await teleportHeroes(scene, next);
    setBar();
    redraw();
  }
  function onKey(event) {
    if (event.key !== "Escape") return;
    swallow(event);
    closePicker();
  }
  // A click on the map would also select / deselect tokens: the clicks are ours while the bar is open.
  const onClickCapture = event => { if (!overUI(event)) swallow(event); };
  done.addEventListener("click", () => closePicker());
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("click", onClickCapture, true);
  window.addEventListener("keydown", onKey, true);
  picker.close = () => {
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("click", onClickCapture, true);
    window.removeEventListener("keydown", onKey, true);
    bar.remove();
  };
  picker.combat = combat;
  state.picker = picker;
}

/** Starting (or deleting) the encounter: the area goes. */
async function onCombatUpdate(combat) {
  if (combat?.started) {
    if (state.picker?.combat === combat) closePicker();
    if (game.user.isActiveGM && combat.getFlag?.(MODULE_ID, FLAG)) await combat.unsetFlag(MODULE_ID, FLAG);
  }
  redraw();
}

defineFeature({
  id: "heroStart",
  category: "combat",
  defaultEnabled: true,
  enable(feature) {
    feature.on("createCombat", (combat, options, userId) => {
      if (userId !== game.user.id || !game.user.isGM) return;
      if ((combat.scene?.id ?? combat._source?.scene) !== canvas?.scene?.id) return;
      setTimeout(() => openPicker(combat), 50);
    });
    feature.on("updateCombat", onCombatUpdate);
    feature.on("deleteCombat", combat => { if (state.picker?.combat === combat) closePicker(); else redraw(); });
    feature.on("canvasReady", () => { if (state.picker && state.picker.combat?.scene?.id !== canvas.scene?.id) closePicker(); redraw(); });
    feature.onCleanup(addChatControl({
      id: "heroStart", icon: "fa-solid fa-flag-checkered", tooltip: t("Control"), order: 43,
      visible: () => game.user.isGM && !!pendingCombat() && squareGrid(canvas?.scene),
      onClick: () => openPicker(pendingCombat())
    }));
    feature.onCleanup(() => { closePicker(); state.layer?.destroy({ children: true }); state.layer = null; });
    redraw();
  }
});

export const _test = { openPicker, closePicker, redraw, state, teleportHeroes };
