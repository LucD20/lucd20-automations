import { error, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { appElement, appHeader, openAppWindows } from "../core/dom.js";

/**
 * Always Show Header Buttons.
 *
 * Newer-style windows hide many controls in the ⋮ menu. This moves chosen
 * ones into the title bar as icons: Prototype Token, Configure Ownership and
 * any extra items named in the options (matched by their label).
 * Older-style sheets (e.g. PF2e) already show their buttons; there we only add
 * Configure Ownership if the sheet doesn't have it.
 */

const state = { options: null, observers: new Set() };

function readOptions(feature) {
  return {
    prototypeToken: feature.get("prototypeToken"),
    ownership: feature.get("ownership"),
    extras: feature.get("extras").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
  };
}

function controlLabel(control) {
  return game.i18n.localize(control.label ?? "");
}

function isPromoted(control) {
  const opts = state.options;
  if (!opts) return false;
  const action = String(control.action ?? "");
  const label = controlLabel(control);
  if (opts.prototypeToken && (/prototype/i.test(action) || /prototype token/i.test(label))) return true;
  if (opts.ownership && (/ownership/i.test(action) || /ownership/i.test(label))) return true;
  return opts.extras.includes(label.toLowerCase());
}

/* -------------------------------------------- */
/*  Newer-style windows (ApplicationV2)         */
/* -------------------------------------------- */

/**
 * Hide promoted entries inside the rendered ⋮ menu. Foundry's own list is left
 * untouched (changing it can hide the ⋮ button itself); a MutationObserver
 * re-applies this whenever Foundry rebuilds the menu.
 */
function hidePromotedInMenu(menu) {
  for (const el of menu.querySelectorAll("[data-action]")) {
    const control = { action: el.dataset.action, label: (el.querySelector(".control-label") ?? el).textContent.trim() };
    (el.closest("li") ?? el).classList.toggle("lucd20-promoted-hidden", isPromoted(control));
  }
}

function watchMenu(app) {
  const menu = appElement(app)?.querySelector(".controls-dropdown");
  if (!menu) return;
  hidePromotedInMenu(menu);
  if (menu._lucd20Observer) return;
  const observer = new MutationObserver(() => hidePromotedInMenu(menu));
  observer.observe(menu, { childList: true, subtree: true });
  menu._lucd20Observer = observer;
  state.observers.add(observer);
}

/** The ⋮ entries this window should show as title-bar buttons (only ones the user may use). */
function promotedControls(app) {
  if (typeof app._headerControlButtons === "function") {
    return [...app._headerControlButtons()].filter(isPromoted);
  }
  // Fallback: read the rendered ⋮ menu.
  const root = appElement(app);
  return [...(root?.querySelectorAll(".controls-dropdown [data-action]") ?? [])]
    .map(el => ({
      action: el.dataset.action,
      label: (el.querySelector(".control-label") ?? el).textContent.trim(),
      icon: [...(el.querySelector("i")?.classList ?? [])].filter(c => c !== "control-icon" && c !== "fa-fw").join(" "),
      source: el
    }))
    .filter(isPromoted);
}

function runControl(app, control, event, button) {
  event.preventDefault();
  event.stopPropagation();
  try {
    if (control.source) return control.source.click();
    if (typeof control.onClick === "function") return control.onClick.call(app, event);
    const action = app.options?.actions?.[control.action];
    const handler = typeof action === "function" ? action : action?.handler;
    if (handler) return handler.call(app, event, button);
    appElement(app)?.querySelector(`.controls-dropdown [data-action="${CSS.escape(control.action ?? "")}"]`)?.click();
  } catch (err) {
    error(`Header button "${control.action}" failed.`, err);
  }
}

function addButtons(app) {
  const header = appHeader(app);
  if (!header) return;
  for (const old of header.querySelectorAll("[data-lucd20-promoted]")) old.remove();

  const anchor = header.querySelector('[data-action="toggleControls"]') ?? header.querySelector('[data-action="close"]');
  for (const control of promotedControls(app)) {
    const label = controlLabel(control);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `header-control icon ${control.icon ?? "fa-solid fa-circle"}`;
    button.dataset.tooltip = label;
    button.dataset.lucd20Promoted = control.action ?? label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", event => runControl(app, control, event, button));
    header.insertBefore(button, anchor);
  }
  watchMenu(app);
}

/* -------------------------------------------- */
/*  Older-style sheets (Application v1)         */
/* -------------------------------------------- */

function openOwnership(document) {
  const AppV2 = foundry.applications.apps?.DocumentOwnershipConfig;
  if (AppV2) return new AppV2({ document }).render({ force: true });
  const AppV1 = globalThis.DocumentOwnershipConfig;
  if (AppV1) return new AppV1(document).render(true);
}

function onGetDocumentSheetHeaderButtons(app, buttons) {
  if (!state.options?.ownership || !game.user.isGM || !app.document) return;
  if (buttons.some(b => /ownership|permission/i.test(`${b.class ?? ""} ${b.label ?? ""}`))) return;
  buttons.unshift({
    label: localize("LUCD20.Feature.headerButtons.Setting.ownership.Name"),
    class: "lucd20-configure-ownership",
    icon: "fa-solid fa-lock",
    onclick: () => openOwnership(app.document)
  });
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

defineFeature({
  id: "headerButtons",
  category: "sheets",
  scope: "client",
  defaultEnabled: false,
  settings: {
    prototypeToken: { kind: "boolean", default: true },
    ownership: { kind: "boolean", default: true },
    extras: { kind: "string", default: "" }
  },

  enable(feature) {
    state.options = readOptions(feature);
    feature.on("renderApplicationV2", app => addButtons(app));
    feature.on("getDocumentSheetHeaderButtons", onGetDocumentSheetHeaderButtons);
    for (const app of openAppWindows()) if (app.rendered && typeof app._headerControlButtons === "function") addButtons(app);

    feature.onCleanup(() => {
      state.options = null;
      for (const el of document.querySelectorAll("[data-lucd20-promoted]")) el.remove();
      for (const observer of state.observers) observer.disconnect();
      state.observers.clear();
      for (const menu of document.querySelectorAll(".controls-dropdown")) delete menu._lucd20Observer;
      for (const el of document.querySelectorAll(".lucd20-promoted-hidden")) el.classList.remove("lucd20-promoted-hidden");
    });
  }
});
