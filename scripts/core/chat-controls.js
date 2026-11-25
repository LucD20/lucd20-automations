/**
 * Our chat tools: one "Automations" button next to the chat's "Export Chat Log" button opens a menu of them
 * (v0.87.2; each used to be its own button, and the row pushed Foundry's Clear Chat out).
 *
 * Foundry draws the chat before modules start, re-draws it, and can move its
 * control buttons elsewhere (e.g. while another sidebar tab is open). A
 * MutationObserver keeps our buttons present wherever the Export/Clear pair is.
 *
 * addChatControl({ id, icon, tooltip, order, visible: () => bool, onClick: (event, button) => {},
 *                  className, active: () => bool }) → remove()
 */

import { schedule, watchDOM } from "./dom-watch.js";

const controls = new Map();
let stopWatching = null;

export function addChatControl(definition) {
  controls.set(definition.id, definition);
  stopWatching ??= watchDOM("chat-controls", apply);
  schedule();
  return () => {
    controls.delete(definition.id);
    schedule();
    if (!controls.size) {
      for (const el of document.querySelectorAll("[data-lucd20-control]")) el.remove();
      closeMenu();
      stopWatching?.();
      stopWatching = null;
    }
  };
}

/** Re-check buttons (e.g. after an "active" state changed). */
export function refreshChatControls() {
  schedule();
}

/** Chat's Export buttons: the ones sitting next to a Clear Chat (flush) button. */
function exportButtons() {
  return [...document.querySelectorAll('[data-action="export"]')].filter(b => b.parentElement?.querySelector('[data-action="flush"]'));
}

/**
 * v0.87.2 (owner: "so many buttons on the chat that the delete chat button is gone ... a button called
 * 'Automations', you click and it shows all this module's options"): one button next to Export opens a menu
 * of every visible control (icon, name, on/off state), and the module's settings at the bottom.
 */
const LAUNCHER = "lucd20-automations";
let menu = null;

function visibleDefs() {
  return [...controls.values()].filter(d => d.visible?.() ?? true).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function apply() {
  const defs = visibleDefs();
  for (const exportButton of exportButtons()) {
    const box = exportButton.parentElement;
    // Buttons from versions before the menu.
    for (const old of box.querySelectorAll("[data-lucd20-control]:not([data-lucd20-control='" + LAUNCHER + "'])")) old.remove();
    let button = box.querySelector(`[data-lucd20-control="${LAUNCHER}"]`);
    if (!defs.length) { button?.remove(); continue; }
    if (!button) {
      button = makeButton(exportButton, { id: LAUNCHER, icon: "fa-solid fa-wand-magic-sparkles", tooltip: game.i18n.localize("LUCD20.ChatMenu.Title"), onClick: (event, b) => toggleMenu(b) });
      exportButton.before(button);
    }
    const anyActive = defs.some(d => d.active?.());
    if (button.classList.contains("active") !== anyActive) button.classList.toggle("active", anyActive);
  }
  if (menu) fillMenu();
}

function closeMenu() {
  menu?.remove();
  menu = null;
  document.removeEventListener("pointerdown", onOutside, true);
  document.removeEventListener("keydown", onEscape, true);
}
function onOutside(event) {
  if (menu && !menu.contains(event.target) && !event.target.closest?.(`[data-lucd20-control="${LAUNCHER}"]`)) closeMenu();
}
function onEscape(event) {
  if (event.key === "Escape" && menu) { event.stopPropagation(); closeMenu(); }
}

/**
 * Draws the menu's items, only when they changed (v0.87.6: the page's DOM watcher re-applies on every change,
 * and redrawing each time replaced the item under the pointer between press and release, so clicks were lost
 * and the redraw fed the watcher again).
 */
function fillMenu() {
  const esc = v => Handlebars.escapeExpression(String(v ?? ""));
  const defs = visibleDefs();
  const sig = defs.map(d => `${d.id}:${d.active?.() ? 1 : 0}`).join("|");
  if (menu.dataset.sig === sig) return;
  menu.dataset.sig = sig;
  menu.innerHTML = `<header>${esc(game.i18n.localize("LUCD20.ChatMenu.Title"))}</header>
    <ul>${defs.map(d => `<li><button type="button" data-id="${esc(d.id)}" class="${d.active?.() ? "is-active" : ""}"><i class="${esc(d.icon)} fa-fw"></i><span>${esc(d.tooltip)}</span>${d.active?.() ? '<i class="fa-solid fa-circle lucd20-menu-on"></i>' : ""}</button></li>`).join("")}</ul>
    <footer><button type="button" data-id="__settings"><i class="fa-solid fa-gear fa-fw"></i><span>${esc(game.i18n.localize("LUCD20.ChatMenu.Settings"))}</span></button></footer>`;
}

function toggleMenu(anchor) {
  if (menu) return closeMenu();
  menu = document.createElement("div");
  menu.className = "lucd20-chat-menu";
  fillMenu();
  document.body.append(menu);
  // Above the button, right edges lined up (the chat sits on the right of the screen).
  const r = anchor.getBoundingClientRect();
  menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  menu.style.bottom = `${Math.max(8, window.innerHeight - r.top + 6)}px`;
  menu.addEventListener("click", async event => {
    const b = event.target.closest("button[data-id]");
    if (!b) return;
    event.preventDefault();
    const id = b.dataset.id;
    closeMenu();
    if (id === "__settings") {
      const { SettingsHub } = await import("./settings-hub.js");
      new SettingsHub().render({ force: true });
      return;
    }
    controls.get(id)?.onClick?.(event, anchor);
    schedule();
  });
  document.addEventListener("pointerdown", onOutside, true);
  document.addEventListener("keydown", onEscape, true);
}

/** Copy the Export button's look, swapping its icon. */
function makeButton(exportButton, def) {
  const button = exportButton.cloneNode(true);
  button.removeAttribute("id");
  button.removeAttribute("data-action");
  button.dataset.lucd20Control = def.id;
  button.dataset.tooltip = def.tooltip;
  button.setAttribute("aria-label", def.tooltip);
  const iconClasses = def.icon.split(" ");
  const icons = [...button.querySelectorAll("i")];
  for (const el of [button, ...icons]) {
    el.className = el.className.replace(/\bfa-(?!fw\b)[\w-]+/g, "").replace(/\b(fas|far|fab)\b/g, "").trim();
  }
  if (def.className) button.classList.add(...def.className.split(" "));
  (icons[0] ?? button).classList.add(...iconClasses);
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    def.onClick?.(event, button);
    schedule();
  });
  return button;
}
