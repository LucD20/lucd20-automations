import { defineFeature } from "../core/registry.js";
import { watchDOM } from "../core/dom-watch.js";

/**
 * Clean Title Bars (replaces Cleaner Sheet Title Bar).
 *
 * In every window's title bar, buttons keep only their icon; the label moves
 * to a tooltip. The window title itself and the ⋮ menu are left alone.
 * Works for both window styles (older sheets like PF2e's put labels next to
 * the icons; newer ones mostly don't).
 */

const SKIP = ".window-title, .controls-dropdown, menu";

function cleanHeader(header) {
  if (!header) return;
  for (const el of header.querySelectorAll("a, button")) {
    if (el.dataset.lucd20Clean !== undefined || el.closest(SKIP)) continue;

    const textNodes = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    const spans = [...el.children].filter(c => c.tagName === "SPAN" && c.textContent.trim() && !c.querySelector("i, img"));
    if (!textNodes.length && !spans.length) continue;
    // Only clean buttons that still have an icon to show.
    if (!el.querySelector("i, img, svg") && !/\bfa-/.test(el.className)) continue;

    const label = [...textNodes.map(n => n.textContent), ...spans.map(s => s.textContent)].join(" ").replace(/\s+/g, " ").trim();
    el.dataset.lucd20Clean = textNodes.map(n => n.textContent).join("");
    for (const node of textNodes) node.remove();
    for (const span of spans) span.classList.add("lucd20-label-hidden");
    if (!el.dataset.tooltip) {
      el.dataset.tooltip = label;
      el.dataset.lucd20TooltipAdded = "";
    }
    if (!el.hasAttribute("aria-label")) {
      el.setAttribute("aria-label", label);
      el.dataset.lucd20AriaAdded = "";
    }
    el.classList.add("lucd20-clean");
  }
}

function restoreAll() {
  for (const el of document.querySelectorAll("[data-lucd20-clean]")) {
    const text = el.dataset.lucd20Clean;
    if (text) el.append(document.createTextNode(text));
    for (const span of el.querySelectorAll(".lucd20-label-hidden")) span.classList.remove("lucd20-label-hidden");
    if (el.dataset.lucd20TooltipAdded !== undefined) el.removeAttribute("data-tooltip");
    if (el.dataset.lucd20AriaAdded !== undefined) el.removeAttribute("aria-label");
    el.classList.remove("lucd20-clean");
    delete el.dataset.lucd20Clean;
    delete el.dataset.lucd20TooltipAdded;
    delete el.dataset.lucd20AriaAdded;
  }
}

defineFeature({
  id: "cleanTitleBars",
  category: "sheets",
  scope: "client",
  defaultEnabled: false,

  enable(feature) {
    // Watch the page instead of relying on render hooks: every title bar is
    // cleaned as soon as it appears or is re-drawn (including after a reload).
    feature.onCleanup(watchDOM("clean-title-bars", () => {
      for (const header of document.querySelectorAll(".window-header")) cleanHeader(header);
    }));
    feature.onCleanup(restoreAll);
  }
});
