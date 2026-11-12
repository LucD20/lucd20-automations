import { defineFeature } from "../core/registry.js";
import { doorControlClass, doorControls } from "../core/doors.js";

/**
 * Door Icon Size (replaces Smart Doors' icon size). Per player.
 *
 * Foundry draws door icons 40 px wide whatever the grid size, so they get tiny
 * on large grids or when zoomed out. Here the whole icon (art, background,
 * border and hit area) is scaled to grid size × factor × 0.4 by scaling the
 * icon's container, and kept centred on the door. Default factor 1.5 (Q19).
 */

const BASE = 40; // Foundry's icon size in px

function scaleFor(control, factor) {
  const grid = control.wall?.scene?.grid?.size ?? canvas?.grid?.size ?? canvas?.dimensions?.size ?? 100;
  return (grid * factor * 0.4) / BASE;
}

function place(control, factor) {
  const k = factor ? scaleFor(control, factor) : 1;
  control.scale?.set?.(k, k);
  const mid = control.wall?.midpoint;
  if (mid) control.position?.set?.(mid[0] - (BASE / 2) * k, mid[1] - (BASE / 2) * k);
}

function refreshAll(factor) {
  for (const control of doorControls()) place(control, factor);
}

defineFeature({
  id: "doorIconSize",
  category: "doors",
  scope: "client",
  defaultEnabled: true,
  settings: {
    factor: { kind: "range", min: 1, max: 3, step: 0.1, default: 1.5 }
  },

  enable(feature) {
    const DoorControl = doorControlClass();
    if (!DoorControl) return console.warn("lucd20-automations | Door Icon Size: DoorControl not found.");
    const factor = () => Number(feature.get("factor")) || 1.5;
    feature.wrap(DoorControl.prototype, "reposition", function (original, ...args) {
      const result = original(...args);
      place(this, factor());
      return result;
    });
    feature.wrap(DoorControl.prototype, "draw", function (original, ...args) {
      const result = original(...args);
      if (result instanceof Promise) return result.then(r => (place(this, factor()), r));
      place(this, factor());
      return result;
    });
    feature.on("canvasReady", () => refreshAll(factor()));
    refreshAll(factor());
    feature.onCleanup(() => refreshAll(0));
  },

  onSettingChange(feature) {
    refreshAll(Number(feature.get("factor")) || 1.5);
  }
});
