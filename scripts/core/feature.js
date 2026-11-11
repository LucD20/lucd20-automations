import { MODULE_ID, error, localize, localizeIfExists } from "./constants.js";
import { isAvailableForSystem } from "./catalog.js";

/** Foundry setting `type` for each setting kind a feature can declare. */
const KIND_TYPES = {
  boolean: Boolean,
  number: Number,
  range: Number,
  string: String,
  select: String,
  color: String,
  file: String
};

/**
 * A togglable feature. Created through `defineFeature(definition)`.
 *
 * Definition:
 * ```js
 * {
 *   id: "turnMarker",              // also the localization key: LUCD20.Feature.turnMarker.*
 *   category: "combat",            // a CATEGORIES id
 *   scope: "world",                // scope of the on/off switch: "world" (GM) or "client" (per player)
 *   defaultEnabled: false,
 *   systems: ["pf2e"],             // optional: only exists in these systems
 *   settings: {
 *     image: { kind: "file", fileType: "image", default: "…" },
 *     speed: { kind: "range", min: 0, max: 10, step: 0.5, default: 3 },
 *     mode:  { kind: "select", choices: { a: "LUCD20.…" }, default: "a" },
 *     extra: { kind: "boolean", default: false, system: "pf2e" },   // PF2e sub-section only
 *     size:  { kind: "number", default: 1, dependsOn: "extra" },     // hidden while `extra` is off
 *     tint:  { kind: "color", default: "#fff", dependsOn: "mode", dependsValue: "a" }, // shown only when mode = a
 *     key:   { kind: "string", default: "", scope: "client", requiresReload: true }
 *   },
 *   init(feature) {},              // always runs at `init` (keybindings, socket handlers …)
 *   enable(feature) {},            // runs at `ready` and whenever switched on
 *   disable(feature) {},           // runs when switched off (tracked hooks/wraps are removed automatically)
 *   onSettingChange(feature, key, value) {}, // optional; default: disable + enable
 *   renderPanel(feature) { return "<p>…</p>"; }, // optional, GM only: extra HTML inside the card
 *   hubActions: { name: (feature, button) => {} } // buttons in that HTML:
 *     // <button type="button" data-action="featureAction" data-feature="<id>" data-feature-action="name">
 * }
 * ```
 */
export class Feature {
  #hooks = [];
  #cleanups = [];
  #restartTimer = null;

  constructor(definition) {
    if (!definition?.id) throw new Error(`${MODULE_ID} | A feature needs an id.`);
    if (!definition.category) throw new Error(`${MODULE_ID} | Feature "${definition.id}" needs a category.`);
    this.def = definition;
    this.id = definition.id;
    this.category = definition.category;
    this.scope = definition.scope ?? "world";
    this.active = false;
  }

  /* -------------------------------------------- */
  /*  Identity & settings                         */
  /* -------------------------------------------- */

  /** Whether this feature exists in the active game system. */
  get available() {
    return isAvailableForSystem(this.def);
  }

  get name() {
    return localize(`LUCD20.Feature.${this.id}.Name`);
  }

  get hint() {
    return localizeIfExists(`LUCD20.Feature.${this.id}.Hint`);
  }

  /** Full Foundry setting key for one of this feature's settings. */
  key(settingKey) {
    return `${this.id}_${settingKey}`;
  }

  /** Declared settings that apply to the active system, as a list. */
  get settings() {
    return Object.entries(this.def.settings ?? {})
      .map(([key, s]) => ({ key, ...s, scope: s.scope ?? this.scope }))
      .filter(s => !s.system || s.system === game.system.id);
  }

  get isEnabled() {
    return game.settings.get(MODULE_ID, this.key("enabled"));
  }

  get(settingKey) {
    return game.settings.get(MODULE_ID, this.key(settingKey));
  }

  set(settingKey, value) {
    return game.settings.set(MODULE_ID, this.key(settingKey), value);
  }

  /** Register the on/off switch and every option with Foundry (hidden from the core list). */
  registerSettings() {
    game.settings.register(MODULE_ID, this.key("enabled"), {
      scope: this.scope,
      config: false,
      type: Boolean,
      default: this.def.defaultEnabled ?? false,
      onChange: value => this.#onEnabledChange(value)
    });

    for (const s of this.settings) {
      const type = KIND_TYPES[s.kind];
      if (!type) throw new Error(`${MODULE_ID} | Feature "${this.id}": unknown setting kind "${s.kind}" for "${s.key}".`);
      const config = {
        scope: s.scope,
        config: false,
        type,
        default: s.default,
        onChange: value => this.#onSettingChange(s, value)
      };
      if (s.kind === "select") config.choices = s.choices;
      if (s.kind === "range") config.range = { min: s.min, max: s.max, step: s.step };
      game.settings.register(MODULE_ID, this.key(s.key), config);
    }
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  runInit() {
    try {
      this.def.init?.(this);
    } catch (err) {
      error(`Feature "${this.id}" failed during init.`, err);
    }
  }

  start() {
    if (this.active) return;
    this.active = true;
    try {
      this.def.enable?.(this);
    } catch (err) {
      error(`Feature "${this.id}" failed to start.`, err);
      if (game.user?.isGM) ui.notifications?.error(localize("LUCD20.Error.FeatureStart", { name: this.name }));
      this.stop();
    }
  }

  stop() {
    if (!this.active) return;
    try {
      this.def.disable?.(this);
    } catch (err) {
      error(`Feature "${this.id}" failed to stop cleanly.`, err);
    }
    for (const [hook, id] of this.#hooks.splice(0)) Hooks.off(hook, id);
    for (const cleanup of this.#cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (err) {
        error(`Feature "${this.id}" cleanup failed.`, err);
      }
    }
    this.active = false;
  }

  /** Stop and start again on the next tick (batches several setting changes into one restart). */
  restart() {
    clearTimeout(this.#restartTimer);
    this.#restartTimer = setTimeout(() => {
      if (!this.active) return;
      this.stop();
      this.start();
    }, 50);
  }

  #onEnabledChange(value) {
    if (!game.ready) return;
    if (value) this.start();
    else this.stop();
  }

  #onSettingChange(setting, value) {
    // Lets other features react to this one's options (e.g. Next-Turn Marker using the Turn Marker image).
    if (game.ready) Hooks.callAll("lucd20.settingChanged", this.key(setting.key), value);
    if (!game.ready || !this.active || setting.requiresReload) return;
    if (this.def.onSettingChange) {
      try {
        this.def.onSettingChange(this, setting.key, value);
      } catch (err) {
        error(`Feature "${this.id}" failed to apply setting "${setting.key}".`, err);
      }
    } else {
      this.restart();
    }
  }

  /* -------------------------------------------- */
  /*  Helpers for feature code (auto-cleaned)     */
  /* -------------------------------------------- */

  /** Hooks.on that is removed automatically when the feature is switched off. */
  on(hook, fn) {
    const id = Hooks.on(hook, fn);
    this.#hooks.push([hook, id]);
    return id;
  }

  /** Hooks.once that is removed automatically when the feature is switched off. */
  once(hook, fn) {
    const id = Hooks.once(hook, fn);
    this.#hooks.push([hook, id]);
    return id;
  }

  /** Run `fn` when the feature is switched off. */
  onCleanup(fn) {
    this.#cleanups.push(fn);
  }

  /**
   * Wrap `target[method]` while the feature is on. The wrapper receives the
   * original as its first argument: `(original, ...args) => original(...args)`.
   * When switched off the original is restored (or bypassed, if another module
   * wrapped on top of ours in the meantime).
   */
  wrap(target, method, wrapper) {
    const original = target[method];
    if (typeof original !== "function") {
      throw new Error(`${MODULE_ID} | Feature "${this.id}": cannot wrap "${method}", it is not a function.`);
    }
    const state = { active: true };
    const wrapped = function (...args) {
      if (!state.active) return original.apply(this, args);
      return wrapper.call(this, (...a) => original.apply(this, a), ...args);
    };
    target[method] = wrapped;
    this.onCleanup(() => {
      state.active = false;
      if (target[method] === wrapped) target[method] = original;
    });
    return wrapped;
  }
}
