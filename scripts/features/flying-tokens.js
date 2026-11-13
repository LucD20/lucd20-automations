import { defineFeature } from "../core/registry.js";

/**
 * Flying Tokens (owner's request, after an old module). Per player.
 *
 * A token above elevation 0:
 * - hovers: its art drifts slowly up/down and a little sideways (each token
 *   on its own rhythm). Only the art moves, through the mesh's pivot, so the
 *   token's position, border, bars and hit area aren't touched;
 * - casts a soft round shadow on the ground under it: the higher it flies,
 *   the further the shadow falls (down-right), the larger, fainter and
 *   blurrier it gets.
 * Only drawn for tokens this user can see. The shadow sits in the primary
 * canvas group just below the flying token (token sort layer).
 */

const state = { feature: null, attachedTo: null, flying: new Map(), time: 0 }; // flying: token id → { token, shadow, phase, basePivot }

const SHADOW_COLOR = 0x000000;

function gridSize() {
  return canvas?.dimensions?.size ?? 100;
}

function gridDistance() {
  return canvas?.dimensions?.distance ?? canvas?.scene?.grid?.distance ?? 5;
}

function allTokens() {
  const list = canvas?.tokens?.placeables;
  if (!list) return [];
  return Array.isArray(list) ? list : [...list];
}

const TOKENS_LAYER = () => foundry.canvas?.groups?.PrimaryCanvasGroup?.SORT_LAYERS?.TOKENS ?? 700;

/**
 * The shadow is a primary canvas object in the token sort layer, just below
 * the flying token (v0.26.1: at elevation 0 with a very low sort it ended up
 * under the scene background in V14). Lower tokens draw under it, so the
 * shadow falls on them too.
 */
function placeInSort(g, token) {
  g.elevation = Math.max(0, (token.document.elevation ?? 0) - 0.01);
  g.sortLayer = TOKENS_LAYER();
  g.sort = (token.document.sort ?? 0) - 1;
  g.zIndex = (token.mesh?.zIndex ?? 0) - 1;
}

function makeShadow(token) {
  const PrimaryGraphics = foundry.canvas?.primary?.PrimaryGraphics;
  let g;
  try {
    g = PrimaryGraphics ? new PrimaryGraphics() : new PIXI.Graphics();
  } catch {
    g = new PIXI.Graphics();
  }
  placeInSort(g, token);
  g.eventMode = "none";
  g.beginFill(SHADOW_COLOR, 1).drawCircle(0, 0, 50).endFill();
  const blur = new PIXI.BlurFilter(4);
  g.filters = [blur];
  g.lucd20Blur = blur;
  const parent = canvas.primary ?? canvas.stage;
  if (PrimaryGraphics && g instanceof PrimaryGraphics) {
    parent.addChild(g);
    parent.sortDirty = true;
  } else {
    // No primary sorting: put it right under the token's art.
    const index = token.mesh?.parent === parent ? parent.getChildIndex(token.mesh) : 0;
    parent.addChildAt(g, Math.max(0, index));
  }
  return g;
}

function removeEntry(id) {
  const entry = state.flying.get(id);
  if (!entry) return;
  entry.shadow?.destroy?.();
  const mesh = entry.token?.mesh;
  if (mesh?.pivot && !mesh.destroyed) mesh.pivot.set(entry.basePivot.x, entry.basePivot.y);
  state.flying.delete(id);
}

/** Which tokens fly (elevation > 0) — rebuilt when tokens change. */
function refreshList() {
  const seen = new Set();
  for (const token of allTokens()) {
    const flying = (token.document?.elevation ?? 0) > 0 && token.mesh;
    if (!flying) continue;
    seen.add(token.id);
    let entry = state.flying.get(token.id);
    if (entry && entry.token !== token) {
      removeEntry(token.id);
      entry = null;
    }
    if (!entry) {
      state.flying.set(token.id, {
        token,
        phase: Math.random() * Math.PI * 2,
        basePivot: { x: token.mesh.pivot?.x ?? 0, y: token.mesh.pivot?.y ?? 0 },
        shadow: state.feature?.get("shadow") ? makeShadow(token) : null
      });
    }
  }
  for (const id of [...state.flying.keys()]) if (!seen.has(id)) removeEntry(id);
}

function tick() {
  if (!canvas?.ready || !state.flying.size) return;
  const dt = (canvas.app?.ticker?.deltaMS ?? 16) / 1000;
  state.time += dt;
  const size = gridSize();
  const hover = state.feature?.get("hover");
  for (const [id, entry] of state.flying) {
    const token = entry.token;
    const mesh = token.mesh;
    if (!mesh || mesh.destroyed || token.destroyed) {
      removeEntry(id);
      continue;
    }
    const elevation = token.document.elevation ?? 0;
    const width = (token.document.width ?? 1) * size;
    // Hover: a few pixels, scaled by token size, ~3.5 s up/down and a slower sideways drift.
    const amp = Math.min(8, 2 + width / 40);
    const t = state.time + entry.phase;
    const dy = hover ? Math.sin(t * 1.8) * amp : 0;
    const dx = hover ? Math.sin(t * 0.7) * amp * 0.5 : 0;
    const sx = mesh.scale?.x || 1;
    const sy = mesh.scale?.y || 1;
    mesh.pivot?.set(entry.basePivot.x - dx / sx, entry.basePivot.y - dy / sy);

    const shadow = entry.shadow;
    if (!shadow) continue;
    const visible = !!(token.visible && mesh.visible && mesh.renderable !== false);
    shadow.visible = visible;
    if (!visible) continue;
    // Height in squares (capped): the shadow falls further, grows and fades.
    const h = Math.min(elevation / gridDistance(), 12);
    const radius = (width / 2) * (0.75 + 0.04 * h);
    const fall = size * 0.12 * h;
    shadow.position.set(mesh.position.x + fall * 0.6, mesh.position.y + fall);
    shadow.scale.set(radius / 50, (radius / 50) * 0.85);
    shadow.alpha = Math.max(0.12, 0.45 - 0.03 * h);
    if (shadow.lucd20Blur) shadow.lucd20Blur.blur = 3 + h * 1.5;
    if (shadow.elevation !== Math.max(0, elevation - 0.01)) {
      placeInSort(shadow, token);
      if (shadow.parent) shadow.parent.sortDirty = true;
    }
  }
}

function clearAll() {
  for (const id of [...state.flying.keys()]) removeEntry(id);
}

defineFeature({
  id: "flyingTokens",
  category: "tokens",
  scope: "client",
  defaultEnabled: true,
  settings: {
    hover: { kind: "boolean", default: true },
    shadow: { kind: "boolean", default: true }
  },

  enable(feature) {
    state.feature = feature;
    const schedule = () => setTimeout(refreshList, 0);
    const attach = () => {
      if (state.attachedTo === canvas?.app?.ticker) return;
      state.attachedTo?.remove?.(tick);
      canvas?.app?.ticker?.add(tick);
      state.attachedTo = canvas?.app?.ticker ?? null;
    };
    feature.on("canvasReady", () => {
      clearAll();
      attach();
      schedule();
    });
    feature.on("canvasTearDown", clearAll);
    feature.on("createToken", schedule);
    feature.on("deleteToken", schedule);
    feature.on("updateToken", (doc, changes) => {
      if ("elevation" in changes || "width" in changes || "texture" in changes) schedule();
    });
    // A re-drawn token gets a new mesh: pick it up.
    feature.on("drawToken", schedule);
    attach();
    feature.onCleanup(() => {
      state.attachedTo?.remove?.(tick);
      state.attachedTo = null;
      clearAll();
    });
    if (canvas?.ready) refreshList();
  },

  onSettingChange(feature) {
    clearAll();
    refreshList();
  }
});
