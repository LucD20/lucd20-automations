import { MODULE_ID, TEMPLATE_PATH, localize, localizeIfExists, systemLabel } from "./constants.js";
import { CATEGORIES, FEATURE_ORDER, isAvailableForSystem } from "./catalog.js";
import { availableFeatures, getFeature, settingInfo } from "./registry.js";
import { lockInfo, openLockDialog } from "./setting-locks.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * The "LucD20 Automations" window: category sidebar + one card per feature.
 * GMs see everything (including planned features). Players only see features
 * that are on and have per-player options.
 *
 * Changes are saved as soon as they are made (submitOnChange).
 */
export class SettingsHub extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance = null;

  /** Only one window: opening it again brings the existing one to the front. */
  constructor(options = {}) {
    if (SettingsHub.#instance) return SettingsHub.#instance;
    super(options);
    SettingsHub.#instance = this;
  }

  static DEFAULT_OPTIONS = {
    id: "lucd20-automations-settings",
    tag: "form",
    classes: ["lucd20-hub"],
    window: {
      title: "LUCD20.Hub.Title",
      icon: "fa-solid fa-dice-d20",
      resizable: true
    },
    position: { width: 900, height: 680 },
    form: {
      handler: SettingsHub.#onSubmit,
      submitOnChange: true,
      closeOnSubmit: false
    },
    actions: {
      selectCategory: SettingsHub.#onSelectCategory,
      resetFeature: SettingsHub.#onResetFeature,
      lockSetting: SettingsHub.#onLockSetting,
      featureAction: SettingsHub.#onFeatureAction
    }
  };

  static PARTS = {
    main: {
      template: `${TEMPLATE_PATH}/settings-hub.hbs`,
      scrollable: [".lucd20-hub-content"]
    }
  };

  /** Currently selected category id. */
  #category = null;

  /** Current search text (lowercase). */
  #search = "";

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const isGM = game.user.isGM;
    const categories = [];

    for (const category of CATEGORIES.filter(isAvailableForSystem)) {
      const cards = [];
      for (const id of this.#featureIdsFor(category.id)) {
        const feature = getFeature(id);
        const card = feature ? this.#prepareFeature(feature, isGM) : isGM ? this.#preparePlanned(id) : null;
        if (card) cards.push(card);
      }
      if (!cards.length && !isGM) continue;

      const built = cards.filter(c => !c.planned);
      categories.push({
        id: category.id,
        icon: category.icon,
        label: localize(`LUCD20.Category.${category.id}.Label`),
        hint: localizeIfExists(`LUCD20.Category.${category.id}.Hint`),
        cards,
        builtCount: built.length,
        enabledCount: built.filter(c => c.enabled).length
      });
    }

    if (!categories.some(c => c.id === this.#category)) this.#category = categories[0]?.id ?? null;
    for (const c of categories) c.active = c.id === this.#category;

    return Object.assign(context, {
      categories,
      isGM,
      empty: !categories.length,
      labels: {
        search: localize("LUCD20.Hub.Search"),
        noResults: localize("LUCD20.Hub.NoResults"),
        empty: localize("LUCD20.Hub.Empty"),
        reset: localize("LUCD20.Hub.Reset"),
        scopeWorld: localize("LUCD20.Hub.ScopeWorld"),
        scopeClient: localize("LUCD20.Hub.ScopeClient"),
        reload: localize("LUCD20.Hub.Reload"),
        legendWorld: localize("LUCD20.Hub.LegendWorld"),
        legendClient: localize("LUCD20.Hub.LegendClient"),
        legendReload: localize("LUCD20.Hub.LegendReload"),
        enable: localize("LUCD20.Hub.Enable")
      }
    });
  }

  /** Feature ids for a category: catalog order first, then any extra registered features. */
  #featureIdsFor(categoryId) {
    const ids = FEATURE_ORDER.filter(e => e.category === categoryId && isAvailableForSystem(e)).map(e => e.id);
    for (const f of availableFeatures()) {
      if (f.category === categoryId && !ids.includes(f.id)) ids.push(f.id);
    }
    return ids;
  }

  #prepareFeature(feature, isGM) {
    const enabled = feature.isEnabled;
    const canToggle = isGM || feature.scope === "client";
    const editable = feature.settings.filter(s => isGM || s.scope === "client");

    // Players never see features the GM switched off, nor features with nothing for them to change.
    if (!isGM && !canToggle && (!enabled || !editable.length)) return null;

    const groups = [];
    const general = editable.filter(s => !s.system);
    if (general.length) groups.push({ label: null, settings: general.map(s => this.#prepareSetting(feature, s)) });
    for (const system of new Set(editable.filter(s => s.system).map(s => s.system))) {
      groups.push({
        label: systemLabel(system),
        settings: editable.filter(s => s.system === system).map(s => this.#prepareSetting(feature, s))
      });
    }

    const name = feature.name;
    const hint = feature.hint;
    const toggleLock = feature.scope === "client" ? lockInfo(`${MODULE_ID}.${feature.key("enabled")}`) : null;
    const panelHTML = isGM && feature.def.renderPanel ? feature.def.renderPanel(feature) : null;
    return {
      id: feature.id,
      name,
      hint,
      planned: false,
      enabled,
      canToggle,
      toggleLock,
      toggleLocked: !!toggleLock?.lockedForMe,
      enabledName: feature.key("enabled"),
      isClient: feature.scope === "client",
      systemTags: (feature.def.systems ?? []).map(systemLabel),
      groups,
      panelHTML,
      hasSettings: groups.length > 0 || !!panelHTML,
      canReset: groups.length > 0,
      searchText: `${name} ${hint}`.toLowerCase()
    };
  }

  #preparePlanned(id) {
    const entry = FEATURE_ORDER.find(e => e.id === id);
    const name = localizeIfExists(`LUCD20.Feature.${id}.Name`, id);
    const hint = localizeIfExists(`LUCD20.Feature.${id}.Hint`);
    return {
      id,
      name,
      hint,
      planned: true,
      plannedLabel: localize("LUCD20.Hub.Planned", { phase: entry?.phase ?? "?" }),
      enabled: false,
      systemTags: (entry?.systems ?? []).map(systemLabel),
      searchText: `${name} ${hint}`.toLowerCase()
    };
  }

  #prepareSetting(feature, s) {
    const base = `LUCD20.Feature.${feature.id}.Setting.${s.key}`;
    const label = localizeIfExists(`${base}.Name`, s.key);
    const hint = localizeIfExists(`${base}.Hint`);
    const value = feature.get(s.key);
    const lock = s.scope === "client" ? lockInfo(`${MODULE_ID}.${feature.key(s.key)}`) : null;
    return {
      name: feature.key(s.key),
      label,
      hint,
      value,
      kind: s.kind,
      isBoolean: s.kind === "boolean",
      isNumber: s.kind === "number",
      isRange: s.kind === "range",
      isString: s.kind === "string",
      isSelect: s.kind === "select",
      isColor: s.kind === "color",
      isFile: s.kind === "file",
      min: s.min,
      max: s.max,
      step: s.step,
      fileType: s.fileType ?? "any",
      options: s.kind === "select"
        ? Object.entries(s.choices ?? {}).map(([v, l]) => ({ value: v, label: localize(l), selected: v === value }))
        : null,
      isClient: s.scope === "client",
      lock,
      locked: !!lock?.lockedForMe,
      requiresReload: !!s.requiresReload,
      dependsOn: s.dependsOn ? feature.key(s.dependsOn) : null,
      searchText: `${label} ${hint}`.toLowerCase()
    };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.element.addEventListener("change", event => {
      if (event.target.matches?.("input[type=checkbox]")) this.#applyDependencies();
    });
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const search = this.element.querySelector("input[data-search]");
    if (search) {
      search.value = this.#search;
      search.addEventListener("input", event => this.#applySearch(event.target.value));
      search.addEventListener("keydown", event => {
        if (event.key === "Enter") event.preventDefault();
      });
    }
    this.#applyDependencies();
    this.#applySearch(this.#search);
  }

  _onClose(options) {
    super._onClose?.(options);
    SettingsHub.#instance = null;
  }

  /** Hide anything marked data-depends-on="<checkbox name>" while that checkbox is unchecked. */
  #applyDependencies() {
    const form = this.element;
    const isChecked = name => form.querySelector(`input[type=checkbox][name="${CSS.escape(name)}"]`)?.checked ?? true;
    for (const el of form.querySelectorAll("[data-depends-on]")) {
      el.classList.toggle("dependency-hidden", !isChecked(el.dataset.dependsOn));
    }
    for (const card of form.querySelectorAll(".lucd20-feature:not(.planned)")) {
      const toggle = card.querySelector("input[data-feature-toggle]");
      if (toggle) card.classList.toggle("off", !toggle.checked);
    }
    this.#updateCounts();
  }

  #updateCounts() {
    for (const panel of this.element.querySelectorAll(".lucd20-hub-category")) {
      const built = panel.querySelectorAll(".lucd20-feature:not(.planned)");
      const on = [...built].filter(c => !c.classList.contains("off")).length;
      const count = this.element.querySelector(`.lucd20-hub-tab[data-category="${panel.dataset.category}"] .count`);
      if (count) count.textContent = `${on}/${built.length}`;
    }
  }

  /** Filter cards and options across all categories. */
  #applySearch(text) {
    const query = (text ?? "").trim().toLowerCase();
    this.#search = query;
    const root = this.element;
    root.classList.toggle("searching", !!query);
    let anyMatch = false;

    for (const panel of root.querySelectorAll(".lucd20-hub-category")) {
      let panelMatch = false;
      for (const card of panel.querySelectorAll(".lucd20-feature")) {
        const cardMatch = !query || card.dataset.searchText.includes(query);
        let settingMatch = false;
        for (const row of card.querySelectorAll(".lucd20-setting")) {
          const match = !query || cardMatch || row.dataset.searchText.includes(query);
          row.classList.toggle("search-hidden", !match);
          if (match && query && !cardMatch) settingMatch = true;
        }
        for (const group of card.querySelectorAll(".lucd20-setting-group")) {
          group.classList.toggle("search-hidden", !group.querySelector(".lucd20-setting:not(.search-hidden)"));
        }
        const visible = cardMatch || settingMatch;
        card.classList.toggle("search-hidden", !visible);
        if (visible) panelMatch = true;
      }
      panel.classList.toggle("search-match", !!query && panelMatch);
      if (panelMatch) anyMatch = true;
    }
    root.querySelector(".lucd20-hub-no-results")?.classList.toggle("hidden", !query || anyMatch);
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onSelectCategory(event, target) {
    this.#category = target.dataset.category;
    const search = this.element.querySelector("input[data-search]");
    if (search) search.value = "";
    this.#applySearch("");
    for (const el of this.element.querySelectorAll("[data-category]")) {
      if (el.classList.contains("lucd20-hub-tab") || el.classList.contains("lucd20-hub-category")) {
        el.classList.toggle("active", el.dataset.category === this.#category);
      }
    }
    this.element.querySelector(".lucd20-hub-content")?.scrollTo({ top: 0 });
  }

  static async #onResetFeature(event, target) {
    const feature = getFeature(target.dataset.feature);
    if (!feature) return;
    const confirmed = await DialogV2.confirm({
      window: { title: localize("LUCD20.Hub.ResetTitle") },
      content: `<p>${localize("LUCD20.Hub.ResetContent", { name: feature.name })}</p>`
    });
    if (!confirmed) return;

    let reload = null;
    for (const s of feature.settings) {
      if (s.scope === "world" && !game.user.isGM) continue;
      if (feature.get(s.key) === s.default) continue;
      await feature.set(s.key, s.default);
      if (s.requiresReload) reload = reload === "world" ? "world" : s.scope;
    }
    await this.render();
    if (reload) await confirmReload(reload === "world");
  }

  static async #onLockSetting(event, target) {
    await openLockDialog(target.dataset.key);
  }

  /** Buttons inside a feature's own panel: data-feature + data-feature-action. */
  static async #onFeatureAction(event, target) {
    const feature = getFeature(target.dataset.feature);
    const handler = feature?.def.hubActions?.[target.dataset.featureAction];
    if (!handler) return;
    await handler(feature, target);
    await this.render();
  }

  /** Save every changed value. Called on each change in the form. */
  static async #onSubmit(event, form, formData) {
    let reload = null;
    for (const [key, raw] of Object.entries(formData.object)) {
      const info = settingInfo(key);
      if (!info) continue;
      const { feature, setting } = info;
      const scope = setting?.scope ?? feature.scope;
      if (scope === "world" && !game.user.isGM) continue;

      const value = castValue(setting?.kind ?? "boolean", raw);
      if (value === undefined) continue;
      if (game.settings.get(MODULE_ID, key) === value) continue;

      await game.settings.set(MODULE_ID, key, value);
      if (setting?.requiresReload) reload = reload === "world" ? "world" : scope;
    }
    this.#updateCounts();
    if (reload) await confirmReload(reload === "world");
  }
}

function castValue(kind, raw) {
  switch (kind) {
    case "boolean":
      return !!raw;
    case "number":
    case "range": {
      if (raw === "" || raw === null || raw === undefined) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    default:
      return raw === null || raw === undefined ? "" : String(raw);
  }
}

/** Ask to reload; for world settings, reload every connected client. */
async function confirmReload(world) {
  const SettingsConfig = foundry.applications.settings?.SettingsConfig;
  if (SettingsConfig?.reloadConfirm) return SettingsConfig.reloadConfirm({ world });
  const confirmed = await DialogV2.confirm({
    window: { title: localize("LUCD20.Hub.ReloadTitle") },
    content: `<p>${localize("LUCD20.Hub.ReloadContent")}</p>`
  });
  if (!confirmed) return;
  if (world && game.user.isGM) game.socket.emit("reload");
  foundry.utils.debouncedReload();
}
