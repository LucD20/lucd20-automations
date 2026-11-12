import { defineFeature } from "../core/registry.js";

/**
 * Active Effect Highlight (replaces part of Monk's Little Details).
 *
 * In the Token HUD's status effects palette, active effects get a colored
 * border and glow so it's obvious which are on. Pure CSS (styles/lucd20.css,
 * "Active Effect Highlight"), switched on with a class on <body>; the color is
 * a CSS variable, so it changes without re-drawing anything.
 */

const BODY_CLASS = "lucd20-status-highlight";
const COLOR_VAR = "--lucd20-status-color";

defineFeature({
  id: "statusHighlight",
  category: "tokens",
  scope: "client",
  defaultEnabled: true,
  settings: {
    color: { kind: "color", default: "#ff9f1a" }
  },

  enable(feature) {
    document.body.classList.add(BODY_CLASS);
    document.documentElement.style.setProperty(COLOR_VAR, feature.get("color") || "#ff9f1a");
    feature.onCleanup(() => {
      document.body.classList.remove(BODY_CLASS);
      document.documentElement.style.removeProperty(COLOR_VAR);
    });
  }
});
