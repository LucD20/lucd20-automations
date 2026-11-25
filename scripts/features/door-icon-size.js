import { defineFeature } from "../core/registry.js";
import { doorControlClass, doorControls, doorIconBox } from "../core/doors.js";

/**
 * Door Icon Size (replaces Smart Doors' icon size). Per player.
 *
 * Foundry draws door icons at a fixed pixel size whatever the scene's grid
 * size, so they look tiny on large grids. Like Smart Doors, this scales each
 * door icon relative to the scene's grid size (grid × 0.4 × factor) and keeps
 * its visual centre pinned to the wall's midpoint regardless of Foundry's
 * icon anchor, pivot or base pixel size. Default factor 1.5 (Q19).
 */

const BASE = 40; // fallback icon size in px

function gridSizeFor(control) {
  return control?.wall?.scene?.grid?.size
    ?? canvas?.scene?.grid?.size
    ?? canvas?.grid?.size
    ?? canvas?.dimensions?.size
    ?? 100;
}

function scaleFor(control, factor, box) {
  const base = Math.max(box.w, box.h) || BASE;
  return (gridSizeFor(control) * factor * 0.4) / base;
}

function place(control, factor) {
  const box = doorIconBox(control, BASE);
  const k = factor ? scaleFor(control, factor, box) : 1;
  control.scale?.set?.(k, k);
  const mid = control.wall?.midpoint;
  if (mid) {
    const px = control.pivot?.x ?? 0;
    const py = control.pivot?.y ?? 0;
    control.position?.set?.(mid[0] - (box.cx - px) * k, mid[1] - (box.cy - py) * k);
  }
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
    if (typeof DoorControl.prototype.refresh === "function") {
      feature.wrap(DoorControl.prototype, "refresh", function (original, ...args) {
        const result = original(...args);
        place(this, factor());
        return result;
      });
    }
    feature.on("canvasReady", () => refreshAll(factor()));
    feature.on("updateScene", (scene, changes) => {
      if (scene?.id === canvas?.scene?.id && (changes?.grid !== undefined || changes?.["grid.size"] !== undefined)) {
        refreshAll(factor());
      }
    });
    refreshAll(factor());
    feature.onCleanup(() => refreshAll(0));
  },

  onSettingChange(feature) {
    refreshAll(Number(feature.get("factor")) || 1.5);
  }
});
