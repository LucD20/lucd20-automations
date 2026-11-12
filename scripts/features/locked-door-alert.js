import { MODULE_ID, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { doorControlClass, doorControlOf } from "../core/doors.js";

/**
 * Locked Door Alert (replaces Smart Doors' locked door alert).
 *
 * When a player clicks a locked door, a public chat message says who tried it
 * (their controlled token's actor, else their character). At most once every
 * 10 s per player and door (Q17). Foundry's own handling (the lock sound) still
 * runs. Hovering the message highlights the door on the GM's map.
 *
 * System adapters can replace the message with a richer card (PF2e: ways to
 * open the lock, scripts/systems/pf2e/door-locks.js):
 *   registerLockedDoorAdapter({ system, init(feature), enable(feature),
 *     postCard(feature, control, who) → true when it posted a card })
 */

const adapters = [];
export function registerLockedDoorAdapter(adapter) {
  adapters.push(adapter);
}
const activeAdapters = () => adapters.filter(a => !a.system || a.system === game.system.id);

const COOLDOWN_MS = 10_000;
const lastTry = new Map(); // wall id → time (this client = this player)

function triedBy() {
  const token = canvas?.tokens?.controlled?.find(t => t.actor?.isOwner);
  const actor = token?.actor ?? game.user.character ?? null;
  return { actor, token: token?.document ?? null, name: token?.document?.name ?? actor?.name ?? game.user.name };
}

async function alert(feature, control) {
  const wall = control.wall?.document;
  if (!wall) return;
  const now = Date.now();
  if (now - (lastTry.get(wall.id) ?? 0) < COOLDOWN_MS) return;
  lastTry.set(wall.id, now);

  const who = triedBy();
  for (const adapter of activeAdapters()) {
    if (await adapter.postCard?.(feature, control, who)) return;
  }
  const speaker = ChatMessage.getSpeaker?.({ actor: who.actor, token: who.token }) ?? { alias: who.name };
  await ChatMessage.create({
    content: `<p class="lucd20-locked-door">${localize("LUCD20.Doors.Locked", { name: Handlebars.escapeExpression(who.name) })}</p>`,
    speaker,
    flags: { [MODULE_ID]: { lockedDoor: { wallId: wall.id, sceneId: wall.parent?.id } } }
  });
}

function isLeftClick(event) {
  const button = event?.button ?? event?.data?.button ?? 0;
  return button === 0;
}

/** GM: hovering the message highlights the door. */
function onRenderMessage(message, html) {
  const data = message.getFlag?.(MODULE_ID, "lockedDoor");
  const el = html instanceof HTMLElement ? html : html?.[0];
  if (!data || !el || !game.user.isGM) return;
  const toggle = on => {
    if (canvas?.scene?.id !== data.sceneId) return;
    const control = doorControlOf(data.wallId);
    if (!control) return;
    if (control.border) control.border.visible = on;
    if (control.icon) control.icon.alpha = on ? 1 : 0.6;
    control.lucd20Pulse = on;
  };
  el.addEventListener("mouseenter", () => toggle(true));
  el.addEventListener("mouseleave", () => toggle(false));
}

defineFeature({
  id: "lockedDoorAlert",
  category: "doors",
  scope: "world",
  defaultEnabled: false,
  settings: {
    lockOptions: { kind: "boolean", default: true, system: "pf2e" },
    autoUnlock: { kind: "boolean", default: true, system: "pf2e", dependsOn: "lockOptions" }
  },

  init(feature) {
    for (const adapter of activeAdapters()) adapter.init?.(feature);
  },

  enable(feature) {
    for (const adapter of activeAdapters()) adapter.enable?.(feature);
    const DoorControl = doorControlClass();
    if (!DoorControl) return console.warn("lucd20-automations | Locked Door Alert: DoorControl not found.");
    feature.wrap(DoorControl.prototype, "_onMouseDown", function (original, event, ...rest) {
      try {
        const doc = this.wall?.document;
        const locked = doc?.ds === CONST.WALL_DOOR_STATES?.LOCKED;
        if (locked && !game.user.isGM && isLeftClick(event) && !game.paused && game.user.can?.("WALL_DOORS") !== false) alert(feature, this);
      } catch (err) {
        console.error(`${MODULE_ID} | Locked Door Alert failed.`, err);
      }
      return original(event, ...rest);
    });
    feature.on("renderChatMessageHTML", onRenderMessage);
  },

  onSettingChange() {} // read when needed
});
