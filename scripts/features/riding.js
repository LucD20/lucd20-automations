import { MODULE_ID, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { executeAsGM, onGMRequest } from "../core/socket.js";
import { addMoveRule } from "../core/movement-block.js";
import { findFreeSpot, occupiedRects } from "../core/placement.js";

/**
 * Riding (replaces Rideable, only mounting).
 *
 * - The GM marks a token Rideable with a button in its Token HUD (Q12).
 * - Mount: select your token(s), target a Rideable token, press M. Players
 *   mount their own tokens within 1 square of the mount; the GM any token at
 *   any distance (Q14). The rider sits with its centre ~30 % in from one of the
 *   mount's corners (top-left first, then the others, Q13), at half its art
 *   scale, at the mount's elevation, drawn above it.
 * - While riding, the rider can't be moved on its own (shared movement block)
 *   and its vision comes from the mount's centre (`Token#_getVisionSourceData`,
 *   owner checked it exists in V14, Q15). When the mount moves, the active GM
 *   moves the riders along the same path (Q16).
 * - Dismount: press M with the rider selected. It goes to the closest free
 *   square it can reach from the mount (core/placement.js) and gets its art
 *   scale back.
 * - All document changes are made on the active GM's client (players ask
 *   through the socket), with an option flag so our own moves aren't treated
 *   as the rider moving by itself.
 *
 * Flags: mount `rideable: true`; rider `riding: { mountId, corner, scaleX,
 * scaleY, pf2e }` (what to restore).
 */

const OPT = "lucd20Riding"; // update option on our own moves
const INSET = 0.3; // rider centre, fraction of the mount's size in from the corner
const SCALE = 0.5; // rider art scale while riding
const CORNERS = [[0, 0], [1, 0], [0, 1], [1, 1]]; // TL, TR, BL, BR

const ridingOf = doc => doc?.getFlag?.(MODULE_ID, "riding") ?? null;
const isRideable = doc => !!doc?.getFlag?.(MODULE_ID, "rideable");

function gridSize(scene) {
  return scene?.grid?.size ?? canvas?.dimensions?.size ?? 100;
}

function ridersOf(mount) {
  return [...(mount.parent?.tokens ?? [])].filter(t => ridingOf(t)?.mountId === mount.id);
}

/** Top-left of the rider for a mount at (x, y). */
function riderPosition(mount, rider, corner, at = mount) {
  const size = gridSize(mount.parent);
  const mw = mount.width * size;
  const mh = mount.height * size;
  const [cx, cy] = CORNERS[corner] ?? CORNERS[0];
  const centreX = at.x + (cx ? mw * (1 - INSET) : mw * INSET);
  const centreY = at.y + (cy ? mh * (1 - INSET) : mh * INSET);
  return {
    x: Math.round(centreX - (rider.width * size) / 2),
    y: Math.round(centreY - (rider.height * size) / 2)
  };
}

/** Gap in pixels between two tokens' rectangles (0 when touching or overlapping). */
function gap(a, b) {
  const size = gridSize(a.parent);
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width * size, b.x + b.width * size));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height * size, b.y + b.height * size));
  return Math.max(dx, dy);
}

/* -------------------------------------------- */
/*  GM side                                     */
/* -------------------------------------------- */

async function mount({ sceneId, riderIds, mountId }, senderId) {
  const scene = game.scenes.get(sceneId);
  const mountDoc = scene?.tokens.get(mountId);
  const sender = game.users.get(senderId) ?? game.user;
  if (!mountDoc || !isRideable(mountDoc)) throw new Error(localize("LUCD20.Riding.NotRideable"));
  if (ridingOf(mountDoc)) throw new Error(localize("LUCD20.Riding.MountIsRiding"));
  const used = new Set(ridersOf(mountDoc).map(r => ridingOf(r).corner));
  const size = gridSize(scene);
  let mounted = 0;
  for (const id of riderIds) {
    const rider = scene.tokens.get(id);
    if (!rider || rider.id === mountId || ridingOf(rider)) continue;
    if (!sender.isGM) {
      if (!rider.testUserPermission(sender, "OWNER")) continue;
      if (gap(rider, mountDoc) > size + 1) throw new Error(localize("LUCD20.Riding.TooFar", { name: rider.name }));
    }
    const corner = [0, 1, 2, 3].find(c => !used.has(c)) ?? 0;
    used.add(corner);
    const pos = riderPosition(mountDoc, rider, corner);
    const pf2e = game.system.id === "pf2e"
      ? { linkToActorSize: rider.flags?.pf2e?.linkToActorSize, autoscale: rider.flags?.pf2e?.autoscale }
      : null;
    const update = {
      ...pos,
      elevation: mountDoc.elevation,
      sort: (mountDoc.sort ?? 0) + 1,
      "texture.scaleX": (rider.texture?.scaleX ?? 1) * SCALE,
      "texture.scaleY": (rider.texture?.scaleY ?? 1) * SCALE,
      [`flags.${MODULE_ID}.riding`]: { mountId, corner, scaleX: rider.texture?.scaleX ?? 1, scaleY: rider.texture?.scaleY ?? 1, pf2e }
    };
    // PF2e would otherwise put the size-linked scale back.
    if (pf2e) Object.assign(update, { "flags.pf2e.linkToActorSize": false, "flags.pf2e.autoscale": false });
    await rider.update(update, { [OPT]: true });
    mounted++;
  }
  return mounted;
}

/** Restore the rider and put it on the closest free square it can reach from the mount. */
async function dismount(rider, { place = true } = {}) {
  const data = ridingOf(rider);
  if (!data) return;
  const scene = rider.parent;
  const mountDoc = scene?.tokens.get(data.mountId);
  const size = gridSize(scene);
  const update = {
    "texture.scaleX": data.scaleX ?? 1,
    "texture.scaleY": data.scaleY ?? 1,
    [`flags.${MODULE_ID}.-=riding`]: null
  };
  if (data.pf2e) {
    // Put PF2e's own values back; if there were none, remove ours so PF2e's defaults apply.
    for (const key of ["linkToActorSize", "autoscale"]) {
      if (data.pf2e[key] === undefined || data.pf2e[key] === null) update[`flags.pf2e.-=${key}`] = null;
      else update[`flags.pf2e.${key}`] = data.pf2e[key];
    }
  }
  if (place) {
    const ref = mountDoc ?? rider;
    const origin = { x: ref.x + (ref.width * size) / 2, y: ref.y + (ref.height * size) / 2 };
    const occupied = occupiedRects(scene, { exclude: [rider.id] });
    const spot = findFreeSpot(origin, rider.width * size, rider.height * size, { scene, occupied });
    if (spot) Object.assign(update, spot);
  }
  await rider.update(update, { [OPT]: true });
}

async function dismountMany({ sceneId, riderIds }, senderId) {
  const scene = game.scenes.get(sceneId);
  const sender = game.users.get(senderId) ?? game.user;
  for (const id of riderIds) {
    const rider = scene?.tokens.get(id);
    if (!rider || !ridingOf(rider)) continue;
    if (!sender.isGM && !rider.testUserPermission(sender, "OWNER")) continue;
    await dismount(rider);
  }
}

/** Mount moved: move its riders along the same path. */
function followMount(mountDoc, changes, options) {
  if (!("x" in changes) && !("y" in changes) && !("elevation" in changes)) return;
  const riders = ridersOf(mountDoc);
  if (!riders.length) return;
  const waypoints = options?.movement?.[mountDoc.id]?.waypoints;
  for (const rider of riders) {
    const { corner } = ridingOf(rider);
    const target = { ...riderPosition(mountDoc, rider, corner), elevation: mountDoc.elevation };
    const moveOptions = { [OPT]: true, constrainOptions: { ignoreWalls: true, ignoreCost: true } };
    if (Array.isArray(waypoints) && waypoints.length > 1 && typeof rider.move === "function") {
      const path = waypoints.map(w => ({
        ...riderPosition(mountDoc, rider, corner, w),
        elevation: w.elevation ?? mountDoc.elevation,
        snapped: false,
        explicit: w.explicit ?? false
      }));
      rider.move(path, moveOptions).catch(() => rider.update(target, { [OPT]: true }));
    } else {
      rider.update(target, { [OPT]: true });
    }
  }
}

/* -------------------------------------------- */
/*  Player side (M key, HUD)                    */
/* -------------------------------------------- */

async function toggle() {
  const controlled = (canvas?.tokens?.controlled ?? []).map(t => t.document).filter(d => d.isOwner);
  if (!controlled.length) {
    ui.notifications.warn(localize("LUCD20.Riding.SelectFirst"));
    return;
  }
  const sceneId = canvas.scene.id;
  const riding = controlled.filter(d => ridingOf(d));
  try {
    if (riding.length) {
      await executeAsGM("riding.dismount", { sceneId, riderIds: riding.map(d => d.id) });
      return;
    }
    const target = [...(game.user.targets ?? [])][0]?.document;
    if (!target || !isRideable(target)) {
      ui.notifications.warn(localize("LUCD20.Riding.TargetFirst"));
      return;
    }
    const riders = controlled.filter(d => d.id !== target.id);
    if (!riders.length) return;
    const count = await executeAsGM("riding.mount", { sceneId, riderIds: riders.map(d => d.id), mountId: target.id });
    if (!count) ui.notifications.warn(localize("LUCD20.Riding.NothingMounted"));
  } catch (err) {
    ui.notifications.warn(err.message);
  }
}

function addHudButton(hud, html) {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? hud.element;
  const doc = hud.document ?? hud.object?.document;
  if (!root || !doc) return;
  root.querySelector(".lucd20-rideable")?.remove();
  const column = root.querySelector(".col.right") ?? root.querySelector(".col.left") ?? root;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon lucd20-rideable";
  button.classList.toggle("active", isRideable(doc));
  button.dataset.tooltip = localize(isRideable(doc) ? "LUCD20.Riding.RideableOn" : "LUCD20.Riding.RideableOff");
  button.innerHTML = '<i class="fa-solid fa-horse"></i>';
  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    const on = !isRideable(doc);
    if (!on) for (const rider of ridersOf(doc)) await dismount(rider);
    await doc.setFlag(MODULE_ID, "rideable", on);
    button.classList.toggle("active", on);
    button.dataset.tooltip = localize(on ? "LUCD20.Riding.RideableOn" : "LUCD20.Riding.RideableOff");
  });
  column.append(button);
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

defineFeature({
  id: "riding",
  category: "tokens",
  scope: "world",
  defaultEnabled: false,

  init(feature) {
    game.keybindings.register(MODULE_ID, "ridingToggle", {
      name: "LUCD20.Riding.Key",
      hint: "LUCD20.Riding.KeyHint",
      editable: [{ key: "KeyM" }],
      onDown: () => {
        if (!feature.active || !canvas?.ready) return false;
        toggle();
        return true;
      }
    });
    onGMRequest("riding.mount", (payload, senderId) => {
      if (!feature.active) throw new Error(localize("LUCD20.Riding.Disabled"));
      return mount(payload, senderId);
    });
    onGMRequest("riding.dismount", (payload, senderId) => {
      if (!feature.active) throw new Error(localize("LUCD20.Riding.Disabled"));
      return dismountMany(payload, senderId);
    });
  },

  enable(feature) {
    // Riders can't move on their own.
    feature.onCleanup(addMoveRule("riding", doc => (ridingOf(doc) ? "LUCD20.Riding.Blocked" : null)));

    feature.on("renderTokenHUD", addHudButton);

    feature.on("updateToken", (doc, changes, options) => {
      if (!game.user.isActiveGM || options?.[OPT]) return;
      if (ridersOf(doc).length) followMount(doc, changes, options);
      // A rider moved by someone else (e.g. the GM dragging it): it got off.
      if (ridingOf(doc) && ("x" in changes || "y" in changes)) dismount(doc, { place: false });
    });

    feature.on("deleteToken", doc => {
      if (!game.user.isActiveGM) return;
      for (const rider of ridersOf(doc)) dismount(rider);
    });

    // Vision from the mount's centre.
    const TokenClass = CONFIG.Token.objectClass;
    if (typeof TokenClass?.prototype?._getVisionSourceData === "function") {
      feature.wrap(TokenClass.prototype, "_getVisionSourceData", function (original, ...args) {
        const data = original(...args);
        const riding = ridingOf(this.document);
        const mountToken = riding ? this.document.parent?.tokens.get(riding.mountId)?.object : null;
        if (data && mountToken?.center) {
          data.x = mountToken.center.x;
          data.y = mountToken.center.y;
        }
        return data;
      });
    }
  }
});
