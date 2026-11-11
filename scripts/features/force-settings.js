import { MODULE_ID, error, localize, localizeIfExists } from "../core/constants.js";
import { defineFeature, settingInfo } from "../core/registry.js";
import { setLockProvider } from "../core/setting-locks.js";

/**
 * Force Player Settings (replaces Force Client Settings).
 *
 * The GM picks a mode for any per-player setting (ours, other modules',
 * Foundry's own) using the lock button next to it:
 *   - "default": the GM's value is applied once to each player; they can change it.
 *   - "lock":    the GM's value is enforced; players' inputs are greyed out.
 * Rules never apply to GMs (including Assistant GMs).
 *
 * Rules are stored in a world setting: { "namespace.key": { mode, value, stamp } }.
 * `stamp` changes whenever the GM saves a rule, so a "default" is re-applied
 * once after the GM changes it.
 */

const RULES_KEY = "forceSettings_rules";
const APPLIED_KEY = "forceSettings_appliedDefaults";
const PER_PLAYER_SCOPES = new Set(["client", "user"]);
const MODES = ["none", "default", "lock"];
const ICONS = { none: "fa-solid fa-lock-open", default: "fa-solid fa-flag", lock: "fa-solid fa-lock" };

const state = {
  active: false,
  rules: {},
  originalGet: null,
  originalSet: null
};

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** True for players. Works before game.user exists (during init). */
function isPlayer() {
  if (game.user) return !game.user.isGM;
  const data = game.data?.users?.find(u => u._id === game.userId);
  return !data || data.role < CONST.USER_ROLES.ASSISTANT;
}

function rawGet(namespace, key) {
  return state.originalGet.call(game.settings, namespace, key);
}

function rawSet(namespace, key, value) {
  return state.originalSet.call(game.settings, namespace, key, value);
}

function lockFor(namespace, key) {
  const rule = state.rules[`${namespace}.${key}`];
  return rule?.mode === "lock" ? rule : null;
}

function sameValue(a, b) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function isPerPlayer(setting) {
  return !!setting && PER_PLAYER_SCOPES.has(setting.scope);
}

const escape = value => Handlebars.escapeExpression(String(value ?? ""));

/** Human name of a setting. Our own settings have no core name, so build one. */
function settingName(fullKey, setting) {
  if (setting?.namespace === MODULE_ID) {
    const info = settingInfo(setting.key);
    if (info) {
      const { feature, setting: s } = info;
      if (!s) return `${feature.name} (${localize("LUCD20.ForceSettings.OnOff")})`;
      return `${feature.name}: ${localizeIfExists(`LUCD20.Feature.${feature.id}.Setting.${s.key}.Name`, s.key)}`;
    }
  }
  if (setting?.name) return game.i18n.localize(setting.name);
  return setting?.key ?? fullKey;
}

/** Where a setting comes from: Foundry core, the system, or a module title. */
function settingSource(namespace) {
  if (namespace === "core") return localize("LUCD20.ForceSettings.Core");
  if (namespace === game.system.id) return game.system.title;
  return game.modules.get(namespace)?.title ?? namespace;
}

function describeValue(setting, value) {
  if (typeof value === "boolean") return localize(value ? "LUCD20.ForceSettings.On" : "LUCD20.ForceSettings.Off");
  const choices = setting?.choices;
  if (choices && typeof choices === "object" && value in choices) return game.i18n.localize(choices[value]);
  if (value === null || value === undefined || value === "") return "—";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/**
 * Update lock buttons in open windows. Foundry's settings window is updated in
 * place (re-rendering it would scroll it back to the top); ours is re-rendered
 * and keeps its scroll position.
 */
function refreshWindows() {
  const instances = foundry.applications.instances;
  if (!instances) return;
  const SettingsConfig = foundry.applications.settings?.SettingsConfig;
  for (const app of instances.values()) {
    if (!app.rendered) continue;
    if (app.id === "lucd20-automations-settings") app.render();
    else if (SettingsConfig ? app instanceof SettingsConfig : app.constructor?.name === "SettingsConfig") {
      undecorateSettingsConfig(app.element);
      if (state.active) decorateSettingsConfig(app, app.element);
    }
  }
}

/* -------------------------------------------- */
/*  Enforcement (players only)                  */
/* -------------------------------------------- */

/**
 * Wrap game.settings.get/set at init so locked values are in effect before any
 * other module reads its settings, and players can't change them.
 */
function installWrappers() {
  const settings = game.settings;
  state.originalGet = settings.get;
  state.originalSet = settings.set;

  settings.get = function (namespace, key, ...rest) {
    if (state.active) {
      const rule = lockFor(namespace, key);
      if (rule && isPlayer()) return foundry.utils.deepClone(rule.value);
    }
    return state.originalGet.call(this, namespace, key, ...rest);
  };

  settings.set = function (namespace, key, value, ...rest) {
    if (state.active) {
      const rule = lockFor(namespace, key);
      if (rule && isPlayer()) return Promise.resolve(foundry.utils.deepClone(rule.value));
    }
    return state.originalSet.call(this, namespace, key, value, ...rest);
  };
}

/** Write locked values and new defaults into the player's own stored settings. */
async function applyRules() {
  if (!state.active || !isPlayer()) return;
  const applied = { ...(rawGet(MODULE_ID, APPLIED_KEY) ?? {}) };
  let appliedChanged = false;

  for (const [fullKey, rule] of Object.entries(state.rules)) {
    const setting = game.settings.settings.get(fullKey);
    if (!isPerPlayer(setting)) continue;
    const { namespace, key } = setting;
    try {
      if (rule.mode === "lock") {
        if (!sameValue(rawGet(namespace, key), rule.value)) await rawSet(namespace, key, foundry.utils.deepClone(rule.value));
      } else if (rule.mode === "default" && applied[fullKey] !== rule.stamp) {
        await rawSet(namespace, key, foundry.utils.deepClone(rule.value));
        applied[fullKey] = rule.stamp;
        appliedChanged = true;
      }
    } catch (err) {
      error(`Could not apply forced setting "${fullKey}".`, err);
    }
  }
  if (appliedChanged) await rawSet(MODULE_ID, APPLIED_KEY, applied);
}

function onRulesChange(value) {
  state.rules = value ?? {};
  if (!state.active || !game.ready) return;
  applyRules();
  refreshWindows();
}

/* -------------------------------------------- */
/*  GM: editing rules                           */
/* -------------------------------------------- */

async function saveRule(fullKey, mode, { refreshValue = true } = {}) {
  const setting = game.settings.settings.get(fullKey);
  const rules = foundry.utils.deepClone(state.rules);
  if (mode === "none") delete rules[fullKey];
  else {
    const value = refreshValue || !(fullKey in rules)
      ? foundry.utils.deepClone(rawGet(setting.namespace, setting.key))
      : rules[fullKey].value;
    rules[fullKey] = { mode, value, stamp: Date.now() };
  }
  await game.settings.set(MODULE_ID, RULES_KEY, rules);
}

/** Click: dialog. Shift+click: Default. Ctrl+click (Cmd on Mac): Locked. */
async function openDialog(fullKey, event) {
  if (isPlayer()) return;
  const setting = game.settings.settings.get(fullKey);
  if (!isPerPlayer(setting)) return;

  const shortcut = event?.shiftKey ? "default" : event?.ctrlKey || event?.metaKey ? "lock" : null;
  if (shortcut) {
    await saveRule(fullKey, shortcut);
    ui.notifications?.info(localize(`LUCD20.ForceSettings.Notify.${shortcut}`, { name: settingName(fullKey, setting) }));
    return;
  }

  const current = state.rules[fullKey]?.mode ?? "none";
  const value = rawGet(setting.namespace, setting.key);

  const modes = MODES.map(mode => `
    <label class="lucd20-lock-mode">
      <input type="radio" name="mode" value="${mode}" ${mode === current ? "checked" : ""}>
      <i class="${ICONS[mode]} fa-fw"></i>
      <span>
        <strong>${localize(`LUCD20.ForceSettings.Mode.${mode}.Label`)}</strong>
        <span class="hint">${localize(`LUCD20.ForceSettings.Mode.${mode}.Hint`)}</span>
      </span>
    </label>`).join("");

  const content = `
    <div class="lucd20-lock-dialog-body">
      <p class="lucd20-lock-target">
        <strong>${escape(settingName(fullKey, setting))}</strong>
        <span class="hint">${escape(settingSource(setting.namespace))}</span>
      </p>
      <p>${localize("LUCD20.ForceSettings.ValueNote", { value: escape(describeValue(setting, value)) })}</p>
      <fieldset class="lucd20-lock-modes">${modes}</fieldset>
    </div>`;

  const mode = await foundry.applications.api.DialogV2.wait({
    window: { title: localize("LUCD20.ForceSettings.DialogTitle"), icon: "fa-solid fa-user-lock" },
    classes: ["lucd20-lock-dialog"],
    content,
    buttons: [
      {
        action: "save",
        label: localize("LUCD20.ForceSettings.Save"),
        icon: "fa-solid fa-check",
        default: true,
        callback: (event, button) => button.form.elements.mode.value
      },
      { action: "cancel", label: localize("LUCD20.ForceSettings.Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (!MODES.includes(mode)) return;
  await saveRule(fullKey, mode);
}

function lockState(fullKey) {
  const mode = state.rules[fullKey]?.mode ?? "none";
  const gm = !isPlayer();
  return {
    key: fullKey,
    mode,
    gm,
    lockedForMe: !gm && mode === "lock",
    icon: ICONS[mode],
    tooltip: gm
      ? `${localize(`LUCD20.ForceSettings.Tooltip.${mode}`)} ${localize("LUCD20.ForceSettings.Tooltip.Shortcuts")}`
      : localize("LUCD20.ForceSettings.LockedByGM")
  };
}

/* -------------------------------------------- */
/*  Foundry's Configure Settings window         */
/* -------------------------------------------- */

function decorateSettingsConfig(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const gm = !isPlayer();

  for (const setting of game.settings.settings.values()) {
    if (!setting.config || !isPerPlayer(setting)) continue;
    const fullKey = `${setting.namespace}.${setting.key}`;
    const input = root.querySelector(`[name="${CSS.escape(fullKey)}"]`);
    const group = input?.closest(".form-group");
    if (!group || group.querySelector(".lucd20-lock")) continue;
    const label = group.querySelector("label") ?? group;
    const lock = lockState(fullKey);
    label.classList.add("lucd20-lock-label");

    if (gm) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `lucd20-lock icon mode-${lock.mode}`;
      button.dataset.tooltip = lock.tooltip;
      button.innerHTML = `<i class="${lock.icon}"></i>`;
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openDialog(fullKey, event);
      });
      label.append(button);
    } else if (lock.lockedForMe) {
      for (const el of group.querySelectorAll("[name], button, input, select, textarea")) {
        if (el.disabled) continue;
        el.disabled = true;
        el.setAttribute("disabled", "");
        el.dataset.lucd20Locked = "";
      }
      group.classList.add("lucd20-locked");
      const icon = document.createElement("i");
      icon.className = "lucd20-lock fa-solid fa-lock";
      icon.dataset.tooltip = lock.tooltip;
      label.append(icon);
    }
  }
}

function undecorateSettingsConfig(html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  for (const el of root.querySelectorAll(".lucd20-lock")) el.remove();
  for (const el of root.querySelectorAll("[data-lucd20-locked]")) {
    el.disabled = false;
    el.removeAttribute("disabled");
    delete el.dataset.lucd20Locked;
  }
  for (const el of root.querySelectorAll(".lucd20-locked")) el.classList.remove("lucd20-locked");
  for (const el of root.querySelectorAll(".lucd20-lock-label")) el.classList.remove("lucd20-lock-label");
}

/* -------------------------------------------- */
/*  Settings window panel (GM)                  */
/* -------------------------------------------- */

function renderPanel() {
  const entries = Object.entries(state.rules);
  if (!entries.length) return `<p class="lucd20-panel-empty">${localize("LUCD20.ForceSettings.Empty")}</p>`;

  const rows = entries
    .map(([fullKey, rule]) => {
      const setting = game.settings.settings.get(fullKey);
      const name = settingName(fullKey, setting);
      const source = setting ? settingSource(setting.namespace) : localize("LUCD20.ForceSettings.Missing");
      return { fullKey, rule, setting, name, source };
    })
    .sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name))
    .map(({ fullKey, rule, setting, name, source }) => {
      const key = escape(fullKey);
      const next = rule.mode === "lock" ? "default" : "lock";
      return `
        <tr>
          <td><strong>${escape(name)}</strong><span class="hint">${escape(source)}</span></td>
          <td>
            <button type="button" class="lucd20-mode-button mode-${rule.mode}" data-action="featureAction" data-feature="forceSettings"
              data-feature-action="toggleMode" data-key="${key}" data-tooltip="${localize(`LUCD20.ForceSettings.SwitchTo.${next}`)}">
              <i class="${ICONS[rule.mode]}"></i> ${localize(`LUCD20.ForceSettings.Mode.${rule.mode}.Label`)}
            </button>
          </td>
          <td class="value">${escape(describeValue(setting, rule.value))}</td>
          <td class="controls">
            ${setting ? `<button type="button" class="icon" data-action="featureAction" data-feature="forceSettings" data-feature-action="refreshValue"
              data-key="${key}" data-tooltip="${localize("LUCD20.ForceSettings.RefreshValue")}"><i class="fa-solid fa-arrows-rotate"></i></button>` : ""}
            <button type="button" class="icon" data-action="featureAction" data-feature="forceSettings" data-feature-action="remove"
              data-key="${key}" data-tooltip="${localize("LUCD20.ForceSettings.Remove")}"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>`;
    })
    .join("");

  return `
    <table class="lucd20-forced-list">
      <thead><tr>
        <th>${localize("LUCD20.ForceSettings.Column.Setting")}</th>
        <th>${localize("LUCD20.ForceSettings.Column.Mode")}</th>
        <th>${localize("LUCD20.ForceSettings.Column.Value")}</th>
        <th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function removeRule(fullKey) {
  const rules = foundry.utils.deepClone(state.rules);
  delete rules[fullKey];
  await game.settings.set(MODULE_ID, RULES_KEY, rules);
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

defineFeature({
  id: "forceSettings",
  category: "playerSettings",
  scope: "world",
  defaultEnabled: false,

  init() {
    game.settings.register(MODULE_ID, RULES_KEY, {
      scope: "world",
      config: false,
      type: Object,
      default: {},
      onChange: onRulesChange
    });
    game.settings.register(MODULE_ID, APPLIED_KEY, {
      scope: "client",
      config: false,
      type: Object,
      default: {}
    });
    installWrappers();
    state.rules = rawGet(MODULE_ID, RULES_KEY) ?? {};
    state.active = !!rawGet(MODULE_ID, "forceSettings_enabled");
  },

  enable(feature) {
    state.active = true;
    setLockProvider({ info: lockState, openDialog });
    feature.onCleanup(() => setLockProvider(null));
    feature.on("renderSettingsConfig", decorateSettingsConfig);
    applyRules();
    refreshWindows();
  },

  disable() {
    state.active = false;
    // Runs before tracked cleanups; refresh after they finish.
    setTimeout(refreshWindows, 0);
  },

  renderPanel,

  hubActions: {
    toggleMode: (feature, target) => {
      const rule = state.rules[target.dataset.key];
      if (!rule) return;
      return saveRule(target.dataset.key, rule.mode === "lock" ? "default" : "lock", { refreshValue: false });
    },
    refreshValue: (feature, target) => {
      const rule = state.rules[target.dataset.key];
      if (rule) return saveRule(target.dataset.key, rule.mode, { refreshValue: true });
    },
    remove: (feature, target) => removeRule(target.dataset.key)
  }
});
