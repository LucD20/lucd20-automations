import { registerGMVisionBackend } from "../../features/gm-vision.js";
import { sysConfig, sysSetting, sysSetSetting } from "./sys.js";

/**
 * PF2e has its own GM vision (client setting "pf2e.gmVision", Ctrl+G, lit
 * lightbulb icon, tokens not vision sources for the GM). We drive that instead
 * of competing with it, and only replace the darkness color PF2e uses
 * (CONFIG.PF2E.Canvas.darkness.gmVision) with our brightness option.
 */

let original = null;

function applyIfOn(color) {
  if (!game.user.isGM || !sysSetting("gmVision")) return;
  CONFIG.Canvas.darknessColor = color;
  if (!canvas?.ready) return;
  canvas.environment?.initialize?.();
  canvas.perception?.update({ refreshLighting: true, refreshVision: true });
}

registerGMVisionBackend({
  system: "pf2e",
  isOn: () => !!sysSetting("gmVision"),
  setOn: value => sysSetSetting("gmVision", !!value),
  defaultDarkness: () => sysConfig()?.Canvas?.darkness?.default ?? CONFIG.Canvas.darknessColor,
  setColor(color) {
    const darkness = sysConfig()?.Canvas?.darkness;
    if (!darkness) return;
    original ??= darkness.gmVision;
    darkness.gmVision = color;
    applyIfOn(color);
  },
  restoreColor() {
    const darkness = sysConfig()?.Canvas?.darkness;
    if (!darkness || original === null) return;
    darkness.gmVision = original;
    applyIfOn(original);
  }
});
