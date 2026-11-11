import { MODULE_ID, error } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";

/**
 * Turn Marker and Next-Turn Marker (replace Combat Booster's markers).
 *
 * A rotating image under the token of the current (or next) combatant.
 * - Size follows the token's footprint: grid size × max(width, height) × (1 + scale).
 *   Scale 0 = exactly the token's size, 0.45 = 45 % larger, the same for every
 *   token of that size. "Follow token art scale" (on by default) also multiplies
 *   by the art scale, so art drawn bigger (e.g. PF2e Scale 2) gets a bigger marker.
 * - Drawn on the same layer as token art, just below the token, at the
 *   token's elevation. "Draw above tokens" attaches it to the token instead.
 * - Only visible while combat is running and only when the token itself is
 *   visible to this user (never reveals hidden tokens to players).
 * - Next-Turn Marker skips defeated combatants. Its image defaults to the
 *   Turn Marker image with a sepia filter at half opacity (Combat Booster's look).
 *
 * Marker images from Combat Booster (MIT) are in assets/markers/.
 */

const MARKERS = `modules/${MODULE_ID}/assets/markers`;

const COLOR_CHOICES = {
  none: "LUCD20.TurnMarkers.Color.none",
  sepia: "LUCD20.TurnMarkers.Color.sepia",
  grayscale: "LUCD20.TurnMarkers.Color.grayscale",
  tint: "LUCD20.TurnMarkers.Color.tint"
};

/** Options that set size and speed (the Next-Turn Marker can share these with the Turn Marker). */
const SIZE_KEYS = ["speed", "scale", "followArtScale"];

function markerSettings({ image, color, tint, opacity, shareable = false }) {
  // When the Next-Turn Marker shares size/speed, its own size/speed options are hidden.
  const sized = shareable ? { dependsOn: "!matchTurnMarker" } : {};
  return {
    image: { kind: "file", fileType: "imagevideo", default: image },
    ...(shareable ? { matchTurnMarker: { kind: "boolean", default: true } } : {}),
    speed: { kind: "range", min: 0, max: 3, step: 0.05, default: 0.1, ...sized },
    scale: { kind: "range", min: 0, max: 3, step: 0.05, default: 0.2, ...sized },
    color: { kind: "select", default: color, choices: COLOR_CHOICES },
    opacity: { kind: "range", min: 0.05, max: 1, step: 0.05, default: opacity },
    tint: { kind: "color", default: tint, dependsOn: "color", dependsValue: "tint" },
    followArtScale: { kind: "boolean", default: true, ...sized },
    above: { kind: "boolean", default: false }
  };
}

/* -------------------------------------------- */
/*  Which token                                 */
/* -------------------------------------------- */

function currentToken(combat) {
  return combat?.started ? combat.combatant?.token?.object ?? null : null;
}

function nextToken(combat) {
  if (!combat?.started) return null;
  const turns = combat.turns ?? [];
  if (turns.length < 2 || combat.turn === null || combat.turn === undefined) return null;
  for (let i = 1; i < turns.length; i++) {
    const candidate = turns[(combat.turn + i) % turns.length];
    if (!candidate.isDefeated) return candidate.token?.object ?? null;
  }
  return null;
}

/* -------------------------------------------- */
/*  Renderer                                    */
/* -------------------------------------------- */

const loadTexture = src => (foundry.canvas?.loadTexture ?? globalThis.loadTexture)(src);
const ColorMatrixFilter = () => PIXI.ColorMatrixFilter ?? PIXI.filters?.ColorMatrixFilter;
const PrimarySpriteMesh = () => foundry.canvas?.primary?.PrimarySpriteMesh ?? globalThis.PrimarySpriteMesh;

class MarkerRenderer {
  constructor(feature, pickToken, imagePath, { shareSize = () => false } = {}) {
    this.feature = feature;
    this.pickToken = pickToken;
    this.imagePath = imagePath;
    this.shareSize = shareSize;
    this.sprite = null;
    this.src = null;
    this.token = null;
    this.running = false;
    this.tick = this.tick.bind(this);
  }

  readOptions() {
    const f = this.feature;
    // Size and speed can come from the Turn Marker (Next-Turn Marker "same size and speed").
    const sized = this.shareSize() ? key => game.settings.get(MODULE_ID, `turnMarker_${key}`) : key => f.get(key);
    this.opts = {
      color: f.get("color"),
      tint: f.get("tint"),
      // Clamp: older versions stored values on a 0–20 / 0–4 scale.
      speed: Math.min(Math.max(sized("speed"), 0), 3),
      scale: Math.min(Math.max(sized("scale"), 0), 3),
      opacity: f.get("opacity"),
      followArtScale: sized("followArtScale"),
      above: f.get("above")
    };
  }

  start() {
    this.running = true;
    this.readOptions();
    if (canvas?.ready) this.refresh();
  }

  stop() {
    this.running = false;
    canvas?.app?.ticker.remove(this.tick);
    this.destroySprite();
    this.src = null;
    this.token = null;
  }

  /** Canvas is being torn down: its layers (and our sprite) go away. */
  tearDown() {
    canvas?.app?.ticker.remove(this.tick);
    this.destroySprite();
    this.src = null;
    this.token = null;
  }

  async refresh() {
    if (!this.running || !canvas?.ready) return;
    this.token = this.pickToken(game.combat);
    const src = this.imagePath();
    if (src !== this.src) await this.load(src);
    canvas.app.ticker.remove(this.tick);
    if (this.sprite) canvas.app.ticker.add(this.tick);
  }

  async load(src) {
    this.destroySprite();
    this.src = src;
    if (!src) return;
    let texture;
    try {
      texture = await loadTexture(src);
    } catch (err) {
      error(`Could not load marker image "${src}".`, err);
    }
    if (!texture || !this.running || this.src !== src || !canvas?.ready) return;

    const video = texture.baseTexture?.resource?.source;
    if (video instanceof HTMLVideoElement) {
      video.loop = true;
      video.muted = true;
      video.play?.().catch(() => {});
    }

    const Primary = PrimarySpriteMesh();
    let sprite;
    if (!this.opts.above && Primary && canvas.primary) {
      sprite = new Primary(texture);
      canvas.primary.addChild(sprite);
    } else {
      sprite = new PIXI.Sprite(texture);
    }
    sprite.anchor.set(0.5, 0.5);
    sprite.visible = false;
    sprite.alpha = this.opts.opacity;
    this.applyColor(sprite);
    this.sprite = sprite;
  }

  applyColor(sprite) {
    const { color, tint } = this.opts;
    sprite.filters = null;
    sprite.tint = 0xffffff;
    if (color === "sepia" || color === "grayscale") {
      const Filter = ColorMatrixFilter();
      if (!Filter) return;
      const filter = new Filter();
      if (color === "sepia") filter.sepia(false);
      else filter.greyscale(0.6, false);
      sprite.filters = [filter];
    } else if (color === "tint" && /^#?[0-9a-f]{6}$/i.test(tint ?? "")) {
      sprite.tint = Number.parseInt(tint.replace("#", ""), 16);
    }
  }

  destroySprite() {
    const sprite = this.sprite;
    this.sprite = null;
    if (!sprite || sprite.destroyed) return;
    sprite.parent?.removeChild(sprite);
    sprite.destroy({ children: true, texture: false, baseTexture: false });
  }

  tick(delta) {
    const sprite = this.sprite;
    if (!sprite || sprite.destroyed) return;
    const token = this.token;
    const show = !!(token && !token.destroyed && game.combat?.started && token.visible && token.renderable !== false);
    if (!show) {
      sprite.visible = false;
      return;
    }

    const doc = token.document;
    const { opts } = this;
    if (opts.above) {
      if (sprite.parent !== token) token.addChildAt(sprite, 0);
      sprite.position.set(token.w / 2, token.h / 2);
    } else {
      sprite.position.set(token.x + token.w / 2, token.y + token.h / 2);
      const mesh = token.mesh;
      if (mesh) {
        if (sprite.elevation !== mesh.elevation) sprite.elevation = mesh.elevation;
        if (sprite.sortLayer !== mesh.sortLayer) sprite.sortLayer = mesh.sortLayer;
        const sort = (mesh.sort ?? 0) - 0.5;
        if (sprite.sort !== sort) sprite.sort = sort;
      }
    }

    let size = canvas.dimensions.size * Math.max(doc.width, doc.height) * (1 + opts.scale);
    if (opts.followArtScale) size *= (Math.abs(doc.texture.scaleX ?? 1) + Math.abs(doc.texture.scaleY ?? 1)) / 2;
    if (sprite.width !== size) sprite.width = size;
    if (sprite.height !== size) sprite.height = size;

    // speed = rotations per second; PIXI's delta is in 60 fps frames.
    sprite.rotation += opts.speed * Math.PI * 2 * ((delta ?? 1) / 60);
    sprite.alpha = opts.opacity;
    sprite.visible = true;
  }
}

/* -------------------------------------------- */
/*  Foundry's own turn marker                   */
/* -------------------------------------------- */

const CORE_DISABLED_KEY = "turnMarker_coreDisabled";

/**
 * Turning our Turn Marker on switches Foundry's built-in turn marker off;
 * turning ours off switches Foundry's back on, but only if we were the ones
 * who switched it off. Done by the active GM (it is a world setting).
 */
async function setCoreTurnMarker(enabled) {
  if (!game.user?.isActiveGM) return;
  let config;
  try {
    config = game.settings.get("core", "combatTrackerConfig");
  } catch {
    return;
  }
  if (!config?.turnMarker || typeof config.turnMarker.enabled !== "boolean") return;
  const withMarker = value => {
    const data = typeof config.toObject === "function" ? config.toObject() : foundry.utils.deepClone(config);
    data.turnMarker.enabled = value;
    return data;
  };
  try {
    if (!enabled && config.turnMarker.enabled) {
      await game.settings.set("core", "combatTrackerConfig", withMarker(false));
      await game.settings.set(MODULE_ID, CORE_DISABLED_KEY, true);
    } else if (enabled && game.settings.get(MODULE_ID, CORE_DISABLED_KEY)) {
      await game.settings.set("core", "combatTrackerConfig", withMarker(true));
      await game.settings.set(MODULE_ID, CORE_DISABLED_KEY, false);
    }
  } catch (err) {
    error("Could not change Foundry's turn marker setting.", err);
  }
}

/* -------------------------------------------- */
/*  Features                                    */
/* -------------------------------------------- */

const REFRESH_HOOKS = [
  "updateCombat", "createCombat", "deleteCombat", "combatStart",
  "createCombatant", "updateCombatant", "deleteCombatant", "deleteToken", "canvasReady"
];

function enableMarker(feature, renderer) {
  const refresh = () => renderer.refresh();
  for (const hook of REFRESH_HOOKS) feature.on(hook, refresh);
  feature.on("canvasTearDown", () => renderer.tearDown());
  renderer.start();
  feature.onCleanup(() => renderer.stop());
}

defineFeature({
  id: "turnMarker",
  category: "combat",
  scope: "world",
  defaultEnabled: false,
  settings: markerSettings({ image: `${MARKERS}/blueRunes.webp`, color: "none", tint: "#ffffff", opacity: 1 }),
  init() {
    game.settings.register(MODULE_ID, CORE_DISABLED_KEY, { scope: "world", config: false, type: Boolean, default: false });
  },
  enable(feature) {
    const renderer = new MarkerRenderer(feature, currentToken, () => feature.get("image"));
    enableMarker(feature, renderer);
    setCoreTurnMarker(false);
  },
  disable(feature) {
    // Only when actually switched off (not when restarting after an option change).
    if (!feature.isEnabled) setCoreTurnMarker(true);
  }
});

defineFeature({
  id: "nextTurnMarker",
  category: "combat",
  scope: "world",
  defaultEnabled: false,
  settings: markerSettings({ image: "", color: "sepia", tint: "#d9a066", opacity: 0.5, shareable: true }),
  enable(feature) {
    // Empty image = same image as the Turn Marker.
    const image = () => feature.get("image") || game.settings.get(MODULE_ID, "turnMarker_image");
    const shareSize = () => feature.get("matchTurnMarker");
    const renderer = new MarkerRenderer(feature, nextToken, image, { shareSize });
    enableMarker(feature, renderer);
    // Follow the Turn Marker's image / size / speed while sharing them.
    feature.on("lucd20.settingChanged", key => {
      if (key === "turnMarker_image" && !feature.get("image")) renderer.refresh();
      if (SIZE_KEYS.some(k => key === `turnMarker_${k}`) && shareSize()) renderer.readOptions();
    });
  }
});
