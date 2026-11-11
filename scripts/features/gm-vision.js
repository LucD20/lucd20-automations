import { MODULE_ID } from "../core/constants.js";
import { defineFeature, getFeature } from "../core/registry.js";

/**
 * GM Vision Mode (replaces GM Vision; works with PF2e's own GM vision).
 *
 * While on (GM only): selected tokens are not vision sources, so the GM sees
 * the whole map; darkness is drawn with a much lighter color. Ctrl+G toggles.
 * On when the GM joins (option). The Lighting controls icon becomes a lit bulb.
 *
 * How it is done matches PF2e's implementation: tokens stop being vision
 * sources for the GM, and CONFIG.Canvas.darknessColor is swapped. In PF2e the
 * system's own GM vision is used (its setting, keybinding and icon) and only
 * its color is replaced by ours (scripts/systems/pf2e/gm-vision.js).
 *
 * Out-of-Sight Outlines: tokens that no player-owned token has line of sight
 * to get a dashed outline colored by disposition.
 */

const PF2E_LOOK = 0xd1ccff;
const state = { feature: null, active: false, defaultDarkness: null, backend: null, startedOnce: false };

/* -------------------------------------------- */
/*  Backends                                    */
/* -------------------------------------------- */

const backends = [];

/**
 * A system with its own GM vision registers a backend:
 * { system, isOn(), setOn(value), defaultDarkness(), setColor(color), restoreColor() }
 */
export function registerGMVisionBackend(backend) {
  backends.push(backend);
}

const coreBackend = {
  isOn: () => state.active,
  setOn(value) {
    state.active = !!value;
    applyCore();
  },
  defaultDarkness: () => state.defaultDarkness,
  setColor() {
    if (state.active) applyCore();
  },
  restoreColor() {
    CONFIG.Canvas.darknessColor = state.defaultDarkness;
  }
};

function backend() {
  return state.backend ?? coreBackend;
}

export function isGMVisionOn() {
  return !!game.user?.isGM && !!getFeature("gmVision")?.active && backend().isOn();
}

/* -------------------------------------------- */
/*  Color                                       */
/* -------------------------------------------- */

function mix(a, b, t) {
  const ch = (c, s) => (c >> s) & 0xff;
  const m = s => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

/** 0 = normal darkness, 1 = PF2e's GM vision look, 1.5 = almost no darkness. */
function gmVisionColor() {
  const t = Math.min(Math.max(Number(state.feature?.get("brightness") ?? 1), 0), 1.5);
  const base = Number(backend().defaultDarkness() ?? 0x242448);
  return t <= 1 ? mix(base, PF2E_LOOK, t) : mix(PF2E_LOOK, 0xffffff, (t - 1) * 2);
}

/* -------------------------------------------- */
/*  Core implementation (systems without one)   */
/* -------------------------------------------- */

function refreshCanvas() {
  if (!canvas?.ready) return;
  canvas.environment?.initialize?.();
  for (const token of canvas.tokens?.placeables ?? []) token.initializeVisionSource?.();
  canvas.perception?.update({ refreshLighting: true, refreshVision: true, refreshSounds: true, refreshOcclusion: true });
}

function applyCore() {
  CONFIG.Canvas.darknessColor = state.active && game.user.isGM ? gmVisionColor() : state.defaultDarkness;
  refreshCanvas();
  if (canvas?.activeLayer) ui.controls?.render?.({ reset: true });
  Hooks.callAll("lucd20.gmVisionChanged", state.active);
}

function toggle() {
  const b = backend();
  b.setOn(!b.isOn());
}

function onSceneControls(controls) {
  if (!game.user.isGM) return;
  const lighting = Array.isArray(controls) ? controls.find(c => c.name === "lighting") : controls?.lighting;
  if (!lighting) return;
  // Like PF2e: the Lighting controls icon shows whether GM Vision is on.
  lighting.icon = state.active ? "fa-solid fa-lightbulb-cfl-on lucd20-gm-vision" : "fa-solid fa-lightbulb";
}

/* -------------------------------------------- */
/*  Out-of-sight outlines                       */
/* -------------------------------------------- */

const OUTLINE = "lucd20OutOfSight";
const outlines = { feature: null, timer: null };

function dispositionColor(doc) {
  const colors = CONFIG.Canvas?.dispositionColors ?? {};
  const D = CONST.TOKEN_DISPOSITIONS ?? { SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 };
  switch (doc.disposition) {
    case D.FRIENDLY: return colors.FRIENDLY ?? 0x43dfdf;
    case D.NEUTRAL: return colors.NEUTRAL ?? 0xf1d836;
    case D.HOSTILE: return colors.HOSTILE ?? 0xe72124;
    default: return colors.SECRET ?? 0xa612d4;
  }
}

function blocked(from, to) {
  const backend = CONFIG.Canvas?.polygonBackends?.sight;
  if (!backend?.testCollision) return false;
  try {
    return !!backend.testCollision(from, to, { type: "sight", mode: "any" });
  } catch {
    return false;
  }
}

/** Can any player-owned token see this token (line of sight to its centre or near its corners)? */
function seenByPlayers(token, viewers) {
  if (token.document.hidden) return false;
  const { x, y, w, h } = token;
  const inset = Math.min(w, h) * 0.2;
  const points = [
    { x: x + w / 2, y: y + h / 2 },
    { x: x + inset, y: y + inset }, { x: x + w - inset, y: y + inset },
    { x: x + inset, y: y + h - inset }, { x: x + w - inset, y: y + h - inset }
  ];
  return viewers.some(viewer => {
    if (viewer === token) return true;
    if ("level" in viewer.document && viewer.document.level !== token.document.level) return false;
    const origin = viewer.center ?? { x: viewer.x + viewer.w / 2, y: viewer.y + viewer.h / 2 };
    return points.some(p => !blocked(origin, p));
  });
}

function drawDashed(g, token, color, shape) {
  const { w, h } = token;
  const width = Math.max(2, Math.round(Math.min(w, h) / 40));
  g.lineStyle({ width, color, alpha: 0.95, cap: "round" });
  const dash = Math.max(6, Math.min(w, h) / 9);
  const gap = dash * 0.7;
  if (shape === "square") {
    const pad = width;
    const corners = [[pad, pad], [w - pad, pad], [w - pad, h - pad], [pad, h - pad], [pad, pad]];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i];
      const [bx, by] = corners[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      for (let d = 0; d < len; d += dash + gap) {
        const e = Math.min(d + dash, len);
        g.moveTo(ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len);
        g.lineTo(ax + ((bx - ax) * e) / len, ay + ((by - ay) * e) / len);
      }
    }
  } else {
    const r = Math.min(w, h) / 2 - width;
    const count = Math.max(8, Math.round((2 * Math.PI * r) / (dash + gap)));
    const step = (2 * Math.PI) / count;
    const arc = step * (dash / (dash + gap));
    for (let i = 0; i < count; i++) {
      const a = i * step;
      g.moveTo(w / 2 + r * Math.cos(a), h / 2 + r * Math.sin(a));
      g.arc(w / 2, h / 2, r, a, a + arc);
    }
  }
}

function clearOutlines() {
  for (const token of canvas?.tokens?.placeables ?? []) {
    const g = token.getChildByName?.(OUTLINE) ?? token.children?.find(c => c.name === OUTLINE);
    if (g) {
      token.removeChild(g);
      g.destroy();
    }
  }
}

function updateOutlines() {
  outlines.timer = null;
  const feature = outlines.feature;
  if (!feature?.active || !canvas?.ready) return;
  clearOutlines();
  if (!game.user.isGM) return;
  if (feature.get("onlyWithGMVision") && !isGMVisionOn()) return;

  const tokens = canvas.tokens.placeables;
  const viewers = tokens.filter(t => t.actor?.hasPlayerOwner && !t.document.hidden && t.document.sight?.enabled !== false);
  const shape = feature.get("shape");
  for (const token of tokens) {
    if (token.actor?.hasPlayerOwner) continue;
    if (seenByPlayers(token, viewers)) continue;
    const g = new PIXI.Graphics();
    g.name = OUTLINE;
    g.eventMode = "none";
    drawDashed(g, token, dispositionColor(token.document), shape);
    token.addChild(g);
  }
}

function scheduleOutlines() {
  if (outlines.timer) return;
  outlines.timer = setTimeout(updateOutlines, 120);
}

/* -------------------------------------------- */
/*  Features                                    */
/* -------------------------------------------- */

defineFeature({
  id: "gmVision",
  category: "vision",
  scope: "client",
  gmOnly: true,
  defaultEnabled: false,
  settings: {
    onAtStartup: { kind: "boolean", default: true },
    brightness: { kind: "range", min: 0, max: 1.5, step: 0.05, default: 1 }
  },

  init(feature) {
    state.feature = feature;
    state.backend = backends.find(b => b.system === game.system.id) ?? null;
    state.defaultDarkness = CONFIG.Canvas.darknessColor;
    // Systems with their own GM vision (PF2e) keep their own Ctrl+G.
    if (!state.backend) {
      game.keybindings.register(MODULE_ID, "gmVision", {
        name: "LUCD20.GMVision.Keybinding",
        hint: "LUCD20.GMVision.KeybindingHint",
        editable: [{ key: "KeyG", modifiers: ["Control"] }],
        restricted: true,
        onDown: () => {
          if (!feature.active || !game.user.isGM) return false;
          toggle();
          return true;
        }
      });
    }
  },

  enable(feature) {
    state.feature = feature;
    if (!game.user.isGM) return;
    const b = backend();

    if (b === coreBackend) {
      feature.wrap(CONFIG.Token.objectClass.prototype, "_isVisionSource", function (original) {
        // Nothing is a vision source for the GM while GM Vision is on → the whole map is visible.
        if (state.active && game.user.isGM) return false;
        return original();
      });
      feature.on("getSceneControlButtons", onSceneControls);
      feature.on("canvasReady", () => state.active && applyCore());
      feature.onCleanup(() => {
        state.active = false;
        CONFIG.Canvas.darknessColor = state.defaultDarkness;
        refreshCanvas();
        ui.controls?.render?.({ reset: true });
        Hooks.callAll("lucd20.gmVisionChanged", false);
      });
    } else {
      b.setColor(gmVisionColor());
      feature.onCleanup(() => b.restoreColor());
    }

    // Only when the GM joins (not again after an option change).
    if (feature.get("onAtStartup") && !state.startedOnce) {
      state.startedOnce = true;
      if (!b.isOn()) b.setOn(true);
    } else if (b === coreBackend && state.active) {
      applyCore();
    }
  },

  onSettingChange(feature, key) {
    if (key === "brightness") backend().setColor(gmVisionColor());
  }
});

defineFeature({
  id: "outOfSightOutlines",
  category: "vision",
  scope: "client",
  gmOnly: true,
  defaultEnabled: false,
  settings: {
    onlyWithGMVision: { kind: "boolean", default: true },
    shape: {
      kind: "select",
      default: "circle",
      choices: { circle: "LUCD20.GMVision.Shape.circle", square: "LUCD20.GMVision.Shape.square" }
    }
  },

  enable(feature) {
    outlines.feature = feature;
    if (!game.user.isGM) return;
    for (const hook of [
      "canvasReady", "refreshToken", "drawToken", "createToken", "updateToken", "deleteToken",
      "createWall", "updateWall", "deleteWall", "sightRefresh", "lucd20.gmVisionChanged"
    ]) feature.on(hook, scheduleOutlines);
    // PF2e's GM vision is a client setting: follow its changes.
    feature.on("clientSettingChanged", key => {
      if (key === "pf2e.gmVision") scheduleOutlines();
    });
    scheduleOutlines();
    feature.onCleanup(() => {
      clearTimeout(outlines.timer);
      outlines.timer = null;
      clearOutlines();
      outlines.feature = null;
    });
  }
});

