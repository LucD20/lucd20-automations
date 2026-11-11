/**
 * Buttons next to the chat's "Export Chat Log" button.
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
    for (const el of document.querySelectorAll(`[data-lucd20-control="${definition.id}"]`)) el.remove();
    if (!controls.size) {
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

function apply() {
  const defs = [...controls.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const exportButton of exportButtons()) {
    const box = exportButton.parentElement;
    for (const def of defs) {
      let button = box.querySelector(`[data-lucd20-control="${def.id}"]`);
      const visible = def.visible?.() ?? true;
      if (!visible) {
        button?.remove();
        continue;
      }
      if (!button) {
        button = makeButton(exportButton, def);
        // Inserted in order: earlier defs end up further left.
        const later = defs.slice(defs.indexOf(def) + 1).map(d => box.querySelector(`[data-lucd20-control="${d.id}"]`)).find(Boolean);
        (later ?? exportButton).before(button);
      }
      const active = !!def.active?.();
      if (button.classList.contains("active") !== active) button.classList.toggle("active", active);
    }
  }
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
