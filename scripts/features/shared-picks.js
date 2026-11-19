import { defineFeature } from "../core/registry.js";
import { clearWatched, initSharedPicks, setSharedPicksEnabled } from "../core/shared-pick.js";

/**
 * Shared Picks (owner, v0.76.0, docs/PLAN.md §22 Q284): everyone sees, live, what is being chosen on the
 * map (Shove's squares, Demoralizing Charge's squadmates, 4e forced movement, shifts and charges); the GM
 * can take over. The work is in core/shared-pick.js; this is its switch.
 */

const state = { feature: null };

defineFeature({
  id: "sharedPicks",
  category: "combat",
  scope: "world",
  gmOnly: true,
  defaultEnabled: true,

  init(feature) {
    state.feature = feature;
    setSharedPicksEnabled(() => !!state.feature?.active);
    initSharedPicks();
  },

  enable() {},

  disable() {
    clearWatched();
  }
});
