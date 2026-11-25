import { getFeature } from "../../core/registry.js";

/**
 * The cover and flanking overlays shown together for a few seconds (owner, v0.81.1: "the cover overlay always on
 * was distracting … token selected + target shows the overlay for 5 seconds (editable)").
 * - show(): starts (or restarts) the window and asks every registered overlay to redraw; when it ends they
 *   redraw again (and draw nothing).
 * - The length is the Cover feature's "previewSeconds" (client; 0 = always shown, the old behaviour); 5 when
 *   the Cover feature is off.
 */

const overlays = new Map();
let until = 0;
let timer = null;

export function seconds() {
  const cover = getFeature("pf2eCover");
  if (cover?.active && cover.get("preview") !== false) {
    const value = Number(cover.get("previewSeconds"));
    return Number.isFinite(value) && value >= 0 ? value : 5;
  }
  return 5;
}

/** Is the overlay window open (or always on)? */
export const isShowing = () => seconds() === 0 || Date.now() < until;

/** Register an overlay's redraw; returns the unregister function. */
export function registerOverlay(id, redraw) {
  overlays.set(id, redraw);
  return () => overlays.delete(id);
}

export function redrawAll() {
  for (const redraw of overlays.values()) {
    try { redraw(); } catch (err) { console.error("lucd20-automations | overlay", err); }
  }
}

/** Open the window for the set seconds and redraw everything. */
export function show() {
  const s = seconds();
  clearTimeout(timer);
  if (s > 0) {
    until = Date.now() + s * 1000;
    timer = setTimeout(() => { until = 0; redrawAll(); }, s * 1000 + 20);
  }
  redrawAll();
}

/** Close the window now. */
export function hide() {
  clearTimeout(timer);
  until = 0;
  redrawAll();
}
