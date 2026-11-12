import { defineFeature } from "../core/registry.js";
import { doorControlClass, doorControls, doorControlOf } from "../core/doors.js";

/**
 * Secret Door Highlight (replaces Smart Doors' secret door tint). GM only.
 *
 * Secret door icons get a purple ring with a soft glow and an eye-slash badge
 * in the corner, and the icon itself a light purple tint (Q18: icon only, the
 * wall is not marked). Only the GM sees secret door icons, so nothing leaks.
 */

const COLOR = 0xa612d4; // PF2e / Foundry "secret" disposition color
const TINT = 0xe2b8ff;
const SIZE = 40; // icon size inside the (possibly scaled) container

function isSecret(control) {
  return control.wall?.document?.door === CONST.WALL_DOOR_TYPES?.SECRET;
}

function removeMark(control) {
  const mark = control.lucd20SecretMark;
  if (mark) {
    mark.destroy({ children: true });
    control.lucd20SecretMark = null;
  }
  if (control.lucd20Tinted && control.icon) {
    control.icon.tint = 0xffffff;
    control.lucd20Tinted = false;
  }
}

function addMark(control) {
  if (control.lucd20SecretMark || !control.addChild) return;
  const mark = new PIXI.Container();
  mark.eventMode = "none";

  // Glow: a few wider, fainter rings behind the main one.
  const glow = new PIXI.Graphics();
  for (const [width, alpha] of [[10, 0.12], [7, 0.2], [4, 0.35]]) {
    glow.lineStyle(width, COLOR, alpha).drawRoundedRect(-2, -2, SIZE + 4, SIZE + 4, 8);
  }
  const ring = new PIXI.Graphics();
  ring.lineStyle(3, COLOR, 1).drawRoundedRect(-2, -2, SIZE + 4, SIZE + 4, 7);
  mark.addChild(glow, ring);

  // Eye-slash badge, bottom-right.
  const badge = new PIXI.Container();
  const disc = new PIXI.Graphics();
  disc.lineStyle(1.5, 0xffffff, 0.9).beginFill(COLOR, 1).drawCircle(0, 0, 9).endFill();
  const eye = new PIXI.Text("", {
    fontFamily: "Font Awesome 6 Free",
    fontWeight: "900",
    fontSize: 10,
    fill: 0xffffff
  });
  eye.anchor.set(0.5);
  badge.addChild(disc, eye);
  badge.position.set(SIZE, SIZE);
  mark.addChild(badge);

  control.addChild(mark);
  control.lucd20SecretMark = mark;
  if (control.icon) {
    control.icon.tint = TINT;
    control.lucd20Tinted = true;
  }
}

function refresh(control) {
  if (!control) return;
  if (game.user.isGM && isSecret(control)) addMark(control);
  else removeMark(control);
}

defineFeature({
  id: "secretDoorHighlight",
  category: "doors",
  scope: "world",
  gmOnly: true,
  defaultEnabled: false,

  enable(feature) {
    const DoorControl = doorControlClass();
    if (!DoorControl) return console.warn("lucd20-automations | Secret Door Highlight: DoorControl not found.");
    feature.wrap(DoorControl.prototype, "draw", function (original, ...args) {
      // A re-draw may reset the icon's tint: drop our mark first, add it back after.
      removeMark(this);
      const result = original(...args);
      if (result instanceof Promise) return result.then(r => (refresh(this), r));
      refresh(this);
      return result;
    });
    feature.on("canvasReady", () => doorControls().forEach(refresh));
    feature.on("updateWall", wall => {
      if (wall.parent?.id === canvas?.scene?.id) refresh(doorControlOf(wall.id));
    });
    doorControls().forEach(refresh);
    feature.onCleanup(() => doorControls().forEach(removeMark));
  }
});
