import { MODULE_ID, localize, warn } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";

/**
 * Shortcuts (replaces F is for Flatfooted and Token Elevator; owner, Q268–Q271, as recommended), every system.
 * - Keys live in Foundry's Configure Controls, under this module. Most start unbound so nothing clashes.
 * - A shortcut about a token acts on the hovered token, else the selected ones, else your character's token
 *   (or your character, for conditions). A hovered token you don't own stops it: it never falls through to
 *   your own token by surprise. Players only change what they own.
 * - Actions (PF2e actions, 4e basic actions) are taken by your token: the selected one, else your character.
 * - Elevation: PageUp / PageDown by one square's distance, Shift for the large step; the mouse wheel over the
 *   Token HUD's elevation box; below 0 allowed. Generic: hide / reveal, end turn, defeated, token / actor art,
 *   a toggle for each of the system's status effects (PF2e uses its conditions instead).
 * - Systems add theirs through `registerShortcuts` (scripts/systems/<id>/shortcuts.*), at `setup`.
 * - Keybindings can only be registered before the game starts, so they always exist; while the feature is
 *   off, or while the module a shortcut came from is still on (both would answer), the key does nothing here.
 * - Each browser copies, once, the keys it had set in F is for Flatfooted and Token Elevator.
 */

/** The modules these shortcuts replace: their keybinding namespace and their default keys. */
export const ORIGINALS = {
  "pf2e-f-is-for-flatfooted": { title: "F is for Flatfooted", defaults: { flatfooted: [{ key: "KeyO", modifiers: [] }] } },
  "token-elevator": {
    title: "Token Elevator",
    defaults: {
      "te-0": [{ key: "IntlBackslash", modifiers: ["Control", "Shift", "Alt"] }],
      "te-1": [{ key: "IntlBackslash", modifiers: [] }],
      "te--1": [{ key: "IntlBackslash", modifiers: ["Control"] }],
      "te-2": [{ key: "IntlBackslash", modifiers: ["Shift"] }],
      "te--2": [{ key: "IntlBackslash", modifiers: ["Control", "Shift"] }]
    }
  }
};

const COPIED_KEY = "shortcuts_copied";
const adapters = [];
/** Every shortcut we registered: our action id → { from: { module, id } }. */
const registeredShortcuts = new Map();
let feature = null;

/**
 * A system's shortcuts. `register(add, api)` runs at `setup` in that system; `statuses: false` leaves out the
 * generic status-effect toggles (PF2e has its own conditions).
 */
export function registerShortcuts(adapter) {
  adapters.push(adapter);
}

/* -------------------------------------------- */
/*  Who a shortcut acts on                      */
/* -------------------------------------------- */

const t = (key, data) => localize(`LUCD20.Shortcuts.${key}`, data);
const owns = (token) => !!(token?.document?.isOwner ?? token?.isOwner);

/** The hovered token, if this user can see it. */
export function hoveredToken() {
  const h = canvas?.tokens?.hover;
  return h && !h.destroyed && h.visible !== false ? h : null;
}

/** Your character's token on this scene. */
function characterToken() {
  const actor = game.user.character;
  return actor?.getActiveTokens?.()?.find(tk => tk.scene === canvas.scene || tk.document?.parent === canvas.scene) ?? null;
}

/**
 * The tokens a shortcut acts on: the hovered one (if you own it; if not, nothing), else the selected ones you
 * own, else your character's token. Warns when there is nothing.
 */
export function targetTokens({ quiet = false } = {}) {
  const hovered = hoveredToken();
  if (hovered) {
    if (owns(hovered)) return [hovered];
    if (!quiet) ui.notifications.warn(t("NotYours", { name: hovered.document?.playersCanSeeName === false && !game.user.isGM ? t("Unknown") : hovered.name }));
    return [];
  }
  const controlled = (canvas?.tokens?.controlled ?? []).filter(owns);
  if (controlled.length) return controlled;
  const own = characterToken();
  if (own) return [own];
  if (!quiet) ui.notifications.warn(t("NoTarget"));
  return [];
}

/** The actors a condition shortcut acts on: as targetTokens, else your character (even off the scene). */
export function targetActors() {
  const hovered = hoveredToken();
  if (hovered || canvas?.tokens?.controlled?.length || characterToken()) return [...new Set(targetTokens().map(tk => tk.actor).filter(Boolean))];
  if (game.user.character) return [game.user.character];
  ui.notifications.warn(t("NoTarget"));
  return [];
}

/** The one actor taking an action: the one selected token you own, else your character. */
export function actingActor() {
  const controlled = (canvas?.tokens?.controlled ?? []).filter(owns);
  if (controlled.length > 1) {
    ui.notifications.warn(t("OneOnly"));
    return null;
  }
  const actor = controlled[0]?.actor ?? game.user.character ?? null;
  if (!actor) ui.notifications.warn(t("NoActor"));
  return actor;
}

/* -------------------------------------------- */
/*  Registering                                 */
/* -------------------------------------------- */

const keyText = (b) => [...(b.modifiers ?? []), b.key].join("+");

/** Whether the module a shortcut copies is still on (then its own key answers, not ours). */
const originalActive = (from) => !!from && !!game.modules.get(from.module)?.active;

/**
 * Register one shortcut. `id` becomes "sc-<id>"; `keys` are the default bindings ([] = unbound);
 * `from: { module, id }` names the original module's action it replaces.
 */
function add(id, { name, hint = "", keys = [], run, restricted = false, from = null, repeat = false }) {
  const action = `sc-${id}`;
  if (registeredShortcuts.has(action)) return;
  registeredShortcuts.set(action, { from });
  try {
    game.keybindings.register(MODULE_ID, action, {
      name,
      hint,
      editable: keys,
      restricted,
      repeat,
      onDown: (context) => {
        if (!feature?.active || !canvas?.ready) return false;
        if (originalActive(from)) return false;
        Promise.resolve()
          .then(() => run(context))
          .catch(err => warn(`Shortcut ${action} failed.`, err));
        return true;
      }
    });
  } catch (err) {
    warn(`Shortcut ${action} could not be registered.`, err);
  }
}

/* -------------------------------------------- */
/*  Generic shortcuts                           */
/* -------------------------------------------- */

const squareDistance = () => Number(canvas.scene?.grid?.distance ?? canvas.grid?.distance) || 5;

/** Raise (+) or lower (−) tokens by a number of squares; null puts them back at 0. */
export async function changeElevation(tokens, squares) {
  if (!tokens.length) return;
  const step = squares === null ? 0 : squareDistance() * squares;
  const updates = tokens.map(tk => {
    const now = Number(tk.document.elevation) || 0;
    return { _id: tk.id ?? tk.document.id, elevation: squares === null ? 0 : Math.round((now + step) * 100) / 100 };
  });
  await canvas.scene.updateEmbeddedDocuments("Token", updates);
  if (canvas.hud?.token?.rendered && tokens.includes(canvas.hud.token.object)) canvas.hud.token.render();
}

function toggleVisibility() {
  const layer = canvas.activeLayer;
  const docName = layer?.constructor?.documentName;
  let objects = layer?.controlled ?? [];
  if (!objects.length && docName === "Token" && hoveredToken()) objects = [hoveredToken()];
  if (!objects.length || !docName) return;
  return canvas.scene.updateEmbeddedDocuments(docName, objects.map(o => ({ _id: o.id, hidden: !o.document.hidden })));
}

function endTurn() {
  const combat = game.combat;
  if (!combat?.started || !combat.combatant) return;
  if (!game.user.isGM && !combat.combatant.isOwner) return ui.notifications.warn(t("NotYourTurn"));
  return combat.nextTurn();
}

async function toggleDefeated() {
  for (const tk of targetTokens()) {
    const combatant = tk.combatant ?? game.combat?.combatants?.find(c => c.tokenId === tk.id);
    if (!combatant) continue;
    const defeated = !combatant.isDefeated;
    await combatant.update({ defeated });
    const id = CONFIG.specialStatusEffects?.DEFEATED;
    if (id && tk.actor?.toggleStatusEffect) await tk.actor.toggleStatusEffect(id, { overlay: true, active: defeated });
  }
}

/** Show (and share) a token's or its actor's art. Hidden names stay hidden in the shared title. */
function showArt(kind) {
  const tk = targetTokens({ quiet: true })[0];
  const actor = tk?.actor ?? game.user.character;
  if (!actor) return ui.notifications.warn(t("NoTarget"));
  const src = kind === "token" ? (tk?.document?.texture?.src ?? actor.prototypeToken?.texture?.src) : actor.img;
  if (!src) return;
  const nameHidden = (tk?.document ?? actor.prototypeToken)?.playersCanSeeName === false;
  const title = nameHidden ? t("Unknown") : (kind === "token" ? (tk?.name ?? actor.prototypeToken?.name) : actor.name);
  const Popout = foundry.applications?.apps?.ImagePopout ?? globalThis.ImagePopout;
  if (!Popout) return;
  const popout = Popout.DEFAULT_OPTIONS
    ? new Popout({ src, uuid: nameHidden ? null : actor.uuid, shareable: true, window: { title } })
    : new Popout(src, { title, shareable: true, uuid: nameHidden ? null : actor.uuid });
  popout.render(true);
  popout.shareImage?.();
}

/** The mouse wheel over the Token HUD's elevation box: one step (Shift: the large step) for the HUD's token and the selected ones. */
function onWheel(event) {
  const box = event.target?.closest?.("#token-hud [name='elevation'], #token-hud .elevation");
  if (!box || !feature?.get("hudWheel") || originalActive({ module: "token-elevator" })) return;
  const hudToken = canvas.hud?.token?.object;
  if (!hudToken) return;
  event.preventDefault();
  event.stopPropagation();
  const tokens = [...new Set([hudToken, ...(canvas.tokens?.controlled ?? [])])].filter(owns);
  const squares = (event.shiftKey ? feature.get("largeStep") : feature.get("step")) * (event.deltaY < 0 ? 1 : -1);
  changeElevation(tokens, squares);
}

function registerGeneric() {
  const elevation = (squares) => () => changeElevation(targetTokens(), squares);
  const step = () => feature?.get("step") ?? 1;
  const large = () => feature?.get("largeStep") ?? 2;
  const te = (id) => ({ module: "token-elevator", id });
  add("elevationUp", { name: "LUCD20.Shortcuts.ElevationUp", hint: "LUCD20.Shortcuts.ElevationHint", keys: [{ key: "PageUp", modifiers: [] }], run: () => elevation(step())(), from: te("te-1") });
  add("elevationDown", { name: "LUCD20.Shortcuts.ElevationDown", hint: "LUCD20.Shortcuts.ElevationHint", keys: [{ key: "PageDown", modifiers: [] }], run: () => elevation(-step())(), from: te("te--1") });
  add("elevationUpLarge", { name: "LUCD20.Shortcuts.ElevationUpLarge", hint: "LUCD20.Shortcuts.ElevationHint", keys: [{ key: "PageUp", modifiers: ["Shift"] }], run: () => elevation(large())(), from: te("te-2") });
  add("elevationDownLarge", { name: "LUCD20.Shortcuts.ElevationDownLarge", hint: "LUCD20.Shortcuts.ElevationHint", keys: [{ key: "PageDown", modifiers: ["Shift"] }], run: () => elevation(-large())(), from: te("te--2") });
  add("elevationReset", { name: "LUCD20.Shortcuts.ElevationReset", hint: "LUCD20.Shortcuts.ElevationHint", run: elevation(null), from: te("te-0") });
  const ff = (id) => ({ module: "pf2e-f-is-for-flatfooted", id });
  add("visibility", { name: "LUCD20.Shortcuts.Visibility", hint: "LUCD20.Shortcuts.VisibilityHint", restricted: true, run: toggleVisibility, from: ff("visibility") });
  add("endTurn", { name: "LUCD20.Shortcuts.EndTurn", hint: "LUCD20.Shortcuts.EndTurnHint", run: endTurn, from: ff("endTurn") });
  add("defeated", { name: "LUCD20.Shortcuts.Defeated", hint: "LUCD20.Shortcuts.TokenHint", run: toggleDefeated, from: ff("toggleDefeated") });
  add("tokenArt", { name: "LUCD20.Shortcuts.TokenArt", hint: "LUCD20.Shortcuts.ArtHint", run: () => showArt("token"), from: ff("showTokenArt") });
  add("actorArt", { name: "LUCD20.Shortcuts.ActorArt", hint: "LUCD20.Shortcuts.ArtHint", run: () => showArt("actor"), from: ff("showActorArt") });
}

/** A toggle for each of the system's status effects (not in PF2e, whose conditions come from its adapter). */
function registerStatuses() {
  for (const effect of CONFIG.statusEffects ?? []) {
    if (!effect?.id || effect.hud === false) continue;
    const name = game.i18n.localize(effect.name ?? effect.label ?? effect.id);
    add(`status-${effect.id}`, {
      name: t("Status", { name }),
      hint: t("StatusHint", { name }),
      run: async () => { for (const actor of targetActors()) await actor.toggleStatusEffect?.(effect.id); }
    });
  }
}

/* -------------------------------------------- */
/*  Keys from the old modules                   */
/* -------------------------------------------- */

/**
 * Copy into our shortcuts the keys this browser had in the modules they replace: the keys set there (stored by
 * Foundry even with the module off), else that module's defaults while it is still on. Ours that this browser
 * already changed are left alone. Returns how many were copied.
 */
export async function copyOriginalKeys({ force = false } = {}) {
  let stored = {};
  try { stored = game.settings.get("core", "keybindings") ?? {}; } catch { /* no stored keys */ }
  let count = 0;
  const modules = new Set();
  for (const [action, { from }] of registeredShortcuts) {
    if (!from) continue;
    if (!force && `${MODULE_ID}.${action}` in stored) continue;
    const original = ORIGINALS[from.module];
    let bindings = stored[`${from.module}.${from.id}`];
    if (!bindings && game.modules.get(from.module)?.active) bindings = original?.defaults?.[from.id];
    if (!bindings?.length) continue;
    const clean = bindings.map(b => ({ key: b.key, modifiers: [...(b.modifiers ?? [])] }));
    const current = (game.keybindings.bindings?.get(`${MODULE_ID}.${action}`) ?? []).map(keyText).join(",");
    if (current === clean.map(keyText).join(",")) continue;
    try {
      await game.keybindings.set(MODULE_ID, action, clean);
      count++;
      modules.add(original?.title ?? from.module);
    } catch (err) {
      warn(`Could not copy the key for ${action}.`, err);
    }
  }
  if (count) ui.notifications.info(t("Copied", { count, modules: [...modules].join(", ") }));
  return count;
}

function openControls() {
  const Cls = foundry.applications?.sidebar?.apps?.ControlsConfig ?? globalThis.ControlsConfig;
  if (Cls) new Cls().render(true);
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

defineFeature({
  id: "shortcuts",
  category: "tokens",
  scope: "world",
  defaultEnabled: true,
  settings: {
    step: { kind: "number", min: 0.5, max: 10, step: 0.5, default: 1, scope: "world" },
    largeStep: { kind: "number", min: 1, max: 20, step: 0.5, default: 2, scope: "world" },
    hudWheel: { kind: "boolean", default: true, scope: "world" }
  },

  init(f) {
    feature = f;
    game.settings.register(MODULE_ID, COPIED_KEY, { scope: "client", config: false, type: Boolean, default: false });
    registerGeneric();
    // System shortcuts need the system's data and our texts: at `setup`, still before keybindings are fixed.
    Hooks.once("setup", () => {
      const mine = adapters.filter(a => a.system === game.system.id);
      for (const a of mine) {
        try { a.register(add, { targetTokens, targetActors, actingActor, hoveredToken, t }); }
        catch (err) { warn(`Shortcuts for ${a.system} failed.`, err); }
      }
      if (mine.every(a => a.statuses !== false)) registerStatuses();
    });
  },

  enable(f) {
    document.addEventListener("wheel", onWheel, { capture: true, passive: false });
    f.onCleanup(() => document.removeEventListener("wheel", onWheel, { capture: true }));
    // Once per browser: bring over the keys of the modules these replace.
    if (!game.settings.get(MODULE_ID, COPIED_KEY)) {
      copyOriginalKeys().finally(() => game.settings.set(MODULE_ID, COPIED_KEY, true));
    }
    if (game.user.isGM) {
      const on = Object.entries(ORIGINALS).filter(([id]) => game.modules.get(id)?.active).map(([, o]) => o.title);
      if (on.length) ui.notifications.warn(t("OriginalOn", { modules: on.join(", ") }), { permanent: false });
    }
  },

  renderPanel() {
    return `<div class="lucd20-sc-panel">
      <button type="button" data-action="featureAction" data-feature="shortcuts" data-feature-action="controls">
        <i class="fa-solid fa-keyboard"></i> ${t("OpenControls")}</button>
      <button type="button" data-action="featureAction" data-feature="shortcuts" data-feature-action="copy">
        <i class="fa-solid fa-copy"></i> ${t("CopyKeys")}</button>
      <span class="hint">${t("PanelHint")}</span>
    </div>`;
  },

  hubActions: {
    controls: () => openControls(),
    copy: async () => { if (!(await copyOriginalKeys({ force: true }))) ui.notifications.info(t("NothingToCopy")); }
  }
});
