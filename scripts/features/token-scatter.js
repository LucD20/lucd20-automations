import { MODULE_ID, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";

/**
 * Token Scatter (replaces Z-Scatter). Per player, on by default (Q31).
 *
 * - Tokens that overlap at the same elevation are drawn spread apart a little,
 *   so each can be seen, clicked and targeted. Only the drawing moves (the
 *   token container: art border, bars, effects, name, hit area; and its art
 *   mesh); positions are never changed. Not while a token is moving. Defeated
 *   tokens don't spread (option).
 * - Flying tokens over others (different elevations, Q30): the top token of
 *   such a stack gets a small badge (layers icon + count). Hovering it fans the
 *   stack out; clicking it opens a strip of portraits to select (your own) or
 *   target a token in it. Holding Z fans out every stack on screen.
 * - Only tokens this user can see take part, so nothing hidden is counted.
 * - Work happens only when tokens change, not every frame.
 *
 * Layout (same idea as Z-Scatter, MIT): push each token away from its group's
 * centre (tokens on the exact same spot get evenly spaced directions), then a
 * few passes push overlapping pairs apart; offsets are capped.
 */

const state = {
  feature: null,
  offsets: new Map(), // token id → {x, y} wanted
  fanAll: false, // Z held
  fanGroup: null, // ids fanned by hovering a badge
  timer: null,
  badges: null, // HTML layer
  strip: null
};

const PASSES = 8;

/* -------------------------------------------- */
/*  Which tokens                                */
/* -------------------------------------------- */

/** Token placeables as an array (defensive: other code may stub the canvas). */
function allTokens() {
  const list = canvas?.tokens?.placeables;
  if (!list) return [];
  if (Array.isArray(list)) return list;
  return typeof list[Symbol.iterator] === "function" ? [...list] : Object.values(list);
}

function gridSize() {
  return canvas?.dimensions?.size ?? canvas?.grid?.size ?? 100;
}

function isAnimating(token) {
  return !!(token.animationContexts?.size || token._animation || token.isAnimating);
}

function isDown(token) {
  const actor = token.actor;
  const statuses = actor?.statuses ?? token.document?.actor?.statuses;
  if (statuses?.has?.("dead") || statuses?.has?.("unconscious") || statuses?.has?.("dying")) return true;
  return !!token.combatant?.isDefeated;
}

function candidates() {
  const ignoreDown = state.feature?.get("ignoreDead");
  // `visible` is false for tokens this user can't see (hidden ones for players, out of sight …).
  return allTokens().filter(t => t?.document && t.position && t.visible && !isAnimating(t) && !(ignoreDown && isDown(t)));
}

function rect(token) {
  const size = gridSize();
  const d = token.document;
  return { x: d.x, y: d.y, w: d.width * size, h: d.height * size, el: d.elevation ?? 0 };
}

const overlap = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;

/** Groups of overlapping tokens (connected), optionally regardless of elevation. */
function groups(tokens, { anyElevation = false } = {}) {
  const rects = tokens.map(rect);
  const seen = new Set();
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (seen.has(i)) continue;
    const stack = [i];
    const group = [];
    seen.add(i);
    while (stack.length) {
      const a = stack.pop();
      group.push(a);
      for (let b = 0; b < tokens.length; b++) {
        if (seen.has(b)) continue;
        if (!anyElevation && rects[a].el !== rects[b].el) continue;
        if (overlap(rects[a], rects[b])) {
          seen.add(b);
          stack.push(b);
        }
      }
    }
    if (group.length > 1) out.push(group.map(i => tokens[i]));
  }
  return out;
}

/* -------------------------------------------- */
/*  Layout                                      */
/* -------------------------------------------- */

function layout(group) {
  const size = gridSize();
  const spread = Number(state.feature?.get("spread")) || 0.3;
  const items = group.map(t => {
    const r = rect(t);
    return { id: t.id, r, cx: r.x + r.w / 2, cy: r.y + r.h / 2, ox: 0, oy: 0, area: r.w * r.h };
  });
  const minX = Math.min(...items.map(i => i.r.x));
  const minY = Math.min(...items.map(i => i.r.y));
  const maxX = Math.max(...items.map(i => i.r.x + i.r.w));
  const maxY = Math.max(...items.map(i => i.r.y + i.r.h));
  const gx = (minX + maxX) / 2;
  const gy = (minY + maxY) / 2;
  const centred = items.filter(i => Math.hypot(i.cx - gx, i.cy - gy) < 1);
  centred.forEach((item, k) => {
    const angle = (2 * Math.PI * k) / centred.length + Math.PI / 4;
    const push = spread * Math.max(item.r.w / size, 0.5) * size;
    item.ox = Math.cos(angle) * push;
    item.oy = Math.sin(angle) * push;
  });
  for (const item of items) {
    if (centred.includes(item)) continue;
    const dx = item.cx - gx;
    const dy = item.cy - gy;
    const len = Math.hypot(dx, dy) || 1;
    const push = spread * Math.max(item.r.w / size, 0.5) * size;
    item.ox = (dx / len) * push;
    item.oy = (dy / len) * push;
  }
  // Push still-overlapping pairs apart along the axis of least overlap.
  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const ax = a.r.x + a.ox;
        const ay = a.r.y + a.oy;
        const bx = b.r.x + b.ox;
        const by = b.r.y + b.oy;
        const overlapX = Math.min(ax + a.r.w, bx + b.r.w) - Math.max(ax, bx);
        const overlapY = Math.min(ay + a.r.h, by + b.r.h) - Math.max(ay, by);
        if (overlapX <= 0 || overlapY <= 0) continue;
        const total = a.area + b.area;
        const wa = b.area / total; // bigger token moves less
        const wb = a.area / total;
        const limit = spread * size; // never push more than the spread per pass
        if (overlapX < overlapY) {
          const d = Math.min(overlapX + 2, limit) * Math.sign(bx + b.r.w / 2 - (ax + a.r.w / 2) || 1);
          a.ox -= d * wa;
          b.ox += d * wb;
        } else {
          const d = Math.min(overlapY + 2, limit) * Math.sign(by + b.r.h / 2 - (ay + a.r.h / 2) || 1);
          a.oy -= d * wa;
          b.oy += d * wb;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  const out = new Map();
  for (const item of items) {
    const cap = size * spread * Math.max(1, Math.sqrt((item.r.w / size) * (item.r.h / size))) * 1.5;
    const len = Math.hypot(item.ox, item.oy);
    const k = len > cap ? cap / len : 1;
    out.set(item.id, { x: Math.round(item.ox * k), y: Math.round(item.oy * k) });
  }
  return out;
}

/* -------------------------------------------- */
/*  Applying offsets (drawing only)             */
/* -------------------------------------------- */

/**
 * Foundry positions the token container and its art mesh from the document.
 * We remember what we applied; when Foundry has re-positioned the token (its
 * container is no longer where we left it) the offset is applied afresh,
 * otherwise only the difference.
 */
function apply(token, offset) {
  const want = offset ?? { x: 0, y: 0 };
  const applied = token._lucd20Scatter;
  const reset = !applied || Math.abs(token.position.x - applied.at.x) > 0.5 || Math.abs(token.position.y - applied.at.y) > 0.5;
  const prev = reset ? { x: 0, y: 0 } : applied.offset;
  const dx = want.x - prev.x;
  const dy = want.y - prev.y;
  if (!dx && !dy && !reset) return;
  if (dx || dy) {
    token.position.set(token.position.x + dx, token.position.y + dy);
    if (token.mesh?.position) token.mesh.position.set(token.mesh.position.x + dx, token.mesh.position.y + dy);
  }
  token._lucd20Scatter = want.x || want.y ? { offset: want, at: { x: token.position.x, y: token.position.y } } : null;
}

function relayout() {
  state.timer = null;
  if (!canvas?.ready || !state.feature?.active) return;
  const tokens = candidates();
  const offsets = new Map();
  for (const group of groups(tokens)) for (const [id, o] of layout(group)) offsets.set(id, o);
  // Fanned stacks (Z held, or a hovered badge): different elevations too.
  if (state.fanAll || state.fanGroup) {
    for (const group of groups(tokens, { anyElevation: true })) {
      if (!state.fanAll && !group.some(t => state.fanGroup.has(t.id))) continue;
      for (const [id, o] of layout(group)) offsets.set(id, o);
    }
  }
  for (const token of allTokens()) {
    if (!token?.position || isAnimating(token)) continue;
    apply(token, offsets.get(token.id));
  }
  state.offsets = offsets;
  drawBadges(tokens);
}

function schedule(delay = 0) {
  if (state.timer) return;
  state.timer = setTimeout(() => requestAnimationFrame(relayout), delay);
}

/** After a move, wait for the animation to end. */
function scheduleAfterMove(token) {
  let tries = 0;
  const check = () => {
    if (token && isAnimating(token) && tries++ < 40) return setTimeout(check, 100);
    schedule();
  };
  setTimeout(check, 50);
}

/* -------------------------------------------- */
/*  Stack badges (flyers over others)           */
/* -------------------------------------------- */

function ensureLayer() {
  if (state.badges?.isConnected) return state.badges;
  const layer = document.createElement("div");
  layer.id = "lucd20-scatter-badges";
  document.body.append(layer);
  state.badges = layer;
  return layer;
}

function toScreen(x, y) {
  if (!canvas?.stage?.worldTransform) return { x: -9999, y: -9999 };
  const p = canvas.stage.worldTransform.apply(new PIXI.Point(x, y));
  const board = canvas.app?.view?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
  return { x: p.x + board.left, y: p.y + board.top };
}

/** Stacks that mix elevations: [{ top, members }]. */
function stacks(tokens) {
  const out = [];
  for (const group of groups(tokens, { anyElevation: true })) {
    const levels = new Set(group.map(t => t.document.elevation ?? 0));
    if (levels.size < 2) continue;
    const sorted = [...group].sort((a, b) => (b.document.elevation ?? 0) - (a.document.elevation ?? 0) || (b.document.sort ?? 0) - (a.document.sort ?? 0));
    out.push({ top: sorted[0], members: sorted });
  }
  return out;
}

function drawBadges(tokens = candidates()) {
  const layer = ensureLayer();
  if (!state.feature?.get("stackBadge")) {
    layer.replaceChildren();
    return;
  }
  const size = gridSize();
  const wanted = stacks(tokens);
  const keep = new Set();
  for (const { top, members } of wanted) {
    const key = members.map(t => t.id).sort().join(",");
    keep.add(key);
    let badge = layer.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!badge) {
      badge = document.createElement("button");
      badge.type = "button";
      badge.className = "lucd20-stack-badge";
      badge.dataset.key = key;
      badge.addEventListener("mouseenter", () => {
        state.fanGroup = new Set(key.split(","));
        schedule();
      });
      badge.addEventListener("mouseleave", () => {
        state.fanGroup = null;
        schedule(150);
      });
      badge.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openStrip(badge, key.split(","));
      });
      layer.append(badge);
    }
    badge.innerHTML = `<i class="fa-solid fa-layer-group"></i><span>${members.length}</span>`;
    badge.dataset.tooltip = localize("LUCD20.TokenScatter.Stack", { count: members.length });
    const d = top.document;
    const offset = state.offsets.get(top.id) ?? { x: 0, y: 0 };
    const p = toScreen(d.x + d.width * size + offset.x, d.y + offset.y);
    badge.style.left = `${Math.round(p.x)}px`;
    badge.style.top = `${Math.round(p.y)}px`;
  }
  for (const badge of [...layer.children]) if (!keep.has(badge.dataset.key)) badge.remove();
  if (state.strip && !keep.has(state.strip.dataset.key)) closeStrip();
}

function closeStrip() {
  state.strip?.remove();
  state.strip = null;
}

function openStrip(badge, ids) {
  const key = ids.slice().sort().join(",");
  if (state.strip?.dataset.key === key) return closeStrip();
  closeStrip();
  const strip = document.createElement("div");
  strip.className = "lucd20-stack-strip";
  strip.dataset.key = key;
  const tokens = ids.map(id => canvas.tokens.get(id)).filter(t => t?.visible);
  tokens.sort((a, b) => (b.document.elevation ?? 0) - (a.document.elevation ?? 0));
  for (const token of tokens) {
    const d = token.document;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "lucd20-stack-item";
    item.classList.toggle("controlled", !!token.controlled);
    item.classList.toggle("targeted", !!token.isTargeted);
    // Names only where players could read them anyway (display mode, PF2e hidden names).
    const modes = CONST.TOKEN_DISPLAY_MODES ?? {};
    const shown = [modes.HOVER, modes.ALWAYS].includes(d.displayName) && d.playersCanSeeName !== false;
    const name = game.user.isGM || d.isOwner || shown ? d.name : "";
    const elevation = d.elevation ? `${d.elevation} ${canvas.scene?.grid?.units ?? ""}`.trim() : "";
    item.dataset.tooltip = [name, elevation].filter(Boolean).join(" · ");
    const img = document.createElement("img");
    img.src = d.texture?.src && !/\.(webm|mp4)$/i.test(d.texture.src) ? d.texture.src : token.actor?.img ?? "icons/svg/mystery-man.svg";
    img.alt = "";
    item.append(img);
    if (elevation) {
      const tag = document.createElement("span");
      tag.className = "lucd20-stack-elev";
      tag.textContent = elevation;
      item.append(tag);
    }
    item.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (token.document.isOwner) token.control({ releaseOthers: !event.shiftKey });
      else token.setTarget(!token.isTargeted, { releaseOthers: !event.shiftKey });
      item.classList.toggle("controlled", !!token.controlled);
      item.classList.toggle("targeted", !!token.isTargeted);
    });
    strip.append(item);
  }
  const rectB = badge.getBoundingClientRect();
  strip.style.left = `${Math.round(rectB.left)}px`;
  strip.style.top = `${Math.round(rectB.bottom + 4)}px`;
  document.body.append(strip);
  state.strip = strip;
}

function onOutside(event) {
  if (state.strip && !state.strip.contains(event.target) && !event.target.closest?.(".lucd20-stack-badge")) closeStrip();
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

function clearAll() {
  for (const token of allTokens()) if (token?._lucd20Scatter) apply(token, null);
  state.offsets = new Map();
  state.badges?.remove();
  state.badges = null;
  closeStrip();
}

defineFeature({
  id: "tokenScatter",
  category: "tokens",
  scope: "client",
  defaultEnabled: true,
  settings: {
    spread: { kind: "range", min: 0.1, max: 1, step: 0.05, default: 0.3 },
    ignoreDead: { kind: "boolean", default: true },
    stackBadge: { kind: "boolean", default: true }
  },

  init(feature) {
    game.keybindings.register(MODULE_ID, "fanStacks", {
      name: "LUCD20.TokenScatter.Key",
      hint: "LUCD20.TokenScatter.KeyHint",
      editable: [{ key: "KeyZ" }],
      onDown: () => {
        if (!feature.active) return false;
        state.fanAll = true;
        schedule();
        return true;
      },
      onUp: () => {
        if (!state.fanAll) return false;
        state.fanAll = false;
        schedule();
        return true;
      }
    });
  },

  enable(feature) {
    state.feature = feature;
    const watched = ["x", "y", "elevation", "width", "height", "hidden"];
    feature.on("canvasReady", () => {
      clearAll();
      schedule(50);
    });
    feature.on("canvasTearDown", clearAll);
    feature.on("createToken", () => schedule(50));
    feature.on("deleteToken", () => schedule(50));
    feature.on("updateToken", (doc, changes) => {
      if (!watched.some(k => k in changes)) return;
      scheduleAfterMove(doc.object);
    });
    // Foundry re-positioned a token (e.g. after a refresh): put its offset back.
    feature.on("refreshToken", token => {
      if (!token?.position) return;
      const want = state.offsets.get(token.id);
      if (want && !isAnimating(token)) apply(token, want);
    });
    // Who can see what (vision, hidden toggles, conditions).
    feature.on("sightRefresh", () => schedule(100));
    feature.on("updateActor", () => schedule(100));
    feature.on("canvasPan", () => drawBadges());
    document.addEventListener("pointerdown", onOutside, true);
    feature.onCleanup(() => {
      document.removeEventListener("pointerdown", onOutside, true);
      clearTimeout(state.timer);
      state.timer = null;
      state.fanAll = false;
      state.fanGroup = null;
      clearAll();
    });
    schedule();
  },

  onSettingChange() {
    schedule();
  }
});
