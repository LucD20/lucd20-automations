import { localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { doorControlClass, doorControls, doorControlOf } from "../core/doors.js";

/**
 * Secret Door Highlight (replaces Smart Doors' secret door tint). GM only.
 *
 * Secret door icons get a thin purple ring and a small eye-slash badge in the
 * corner (Q18: icon only, the wall is not marked). v0.21.1: toned down (no
 * glow, no tint) after the owner found it too distracting. Only the GM sees
 * secret door icons, so nothing leaks.
 *
 * Option "Ask before opening": a GM click that would open a secret door asks
 * for confirmation first, so a misclick doesn't spoil the surprise.
 */

const COLOR = 0xa612d4; // PF2e / Foundry "secret" disposition color
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
}

function addMark(control) {
  if (control.lucd20SecretMark || !control.addChild) return;
  const mark = new PIXI.Container();
  mark.eventMode = "none";
  const ring = new PIXI.Graphics();
  ring.lineStyle(2, COLOR, 0.85).drawRoundedRect(-2, -2, SIZE + 4, SIZE + 4, 6);
  mark.addChild(ring);

  // Small eye-slash badge, bottom-right.
  const badge = new PIXI.Container();
  const disc = new PIXI.Graphics();
  disc.beginFill(COLOR, 0.9).drawCircle(0, 0, 7).endFill();
  const eye = new PIXI.Text("\uf070", {
    fontFamily: "Font Awesome 6 Free",
    fontWeight: "900",
    fontSize: 8,
    fill: 0xffffff
  });
  eye.anchor.set(0.5);
  badge.addChild(disc, eye);
  badge.position.set(SIZE - 1, SIZE - 1);
  mark.addChild(badge);

  control.addChild(mark);
  control.lucd20SecretMark = mark;
}

function refresh(control) {
  if (!control) return;
  if (game.user.isGM && isSecret(control)) addMark(control);
  else removeMark(control);
}

async function confirmOpen(doc) {
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: localize("LUCD20.Doors.SecretConfirmTitle"), icon: "fa-solid fa-eye-slash" },
    content: `<p>${localize("LUCD20.Doors.SecretConfirm")}</p>`,
    rejectClose: false
  });
  if (ok) await doc.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
}

defineFeature({
  id: "secretDoorHighlight",
  category: "doors",
  scope: "world",
  gmOnly: true,
  defaultEnabled: false,
  settings: {
    confirmOpen: { kind: "boolean", default: true }
  },

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
    // Ask before opening a secret door (GM, left click on a closed secret door).
    feature.wrap(DoorControl.prototype, "_onMouseDown", function (original, event, ...rest) {
      const doc = this.wall?.document;
      const button = event?.button ?? event?.data?.button ?? 0;
      const opening = doc?.door === CONST.WALL_DOOR_TYPES?.SECRET && doc.ds === CONST.WALL_DOOR_STATES?.CLOSED;
      if (!game.user.isGM || button !== 0 || !opening || !feature.get("confirmOpen")) return original(event, ...rest);
      event?.stopPropagation?.();
      confirmOpen(doc);
      return false;
    });
    feature.on("canvasReady", () => doorControls().forEach(refresh));
    feature.on("updateWall", wall => {
      if (wall.parent?.id === canvas?.scene?.id) refresh(doorControlOf(wall.id));
    });
    doorControls().forEach(refresh);
    feature.onCleanup(() => doorControls().forEach(removeMark));
  }
});
