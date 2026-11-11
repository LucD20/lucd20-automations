import { MODULE_ID, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";

/**
 * Turn Announcer (replaces Turn Announcer).
 *
 * - At every turn, the active GM's client posts a chat card: token image,
 *   name, owning player(s) and round. Hidden or defeated combatants are skipped.
 *   NPC names follow the system's "can players see this name" rule (PF2e).
 * - "You're up next": the owner(s) of the next combatant get a private
 *   on-screen notification (per-player option).
 */

const state = { lastAnnounced: null, lastHeadsUp: null };
const esc = value => Handlebars.escapeExpression(String(value ?? ""));

function isHiddenCombatant(combatant) {
  return !combatant || combatant.hidden || combatant.token?.hidden;
}

function isPlayerOwned(combatant) {
  return !!combatant.actor?.hasPlayerOwner;
}

function playerOwners(combatant) {
  const actor = combatant.actor;
  if (!actor) return [];
  return game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
}

/** The name players are allowed to see. */
function visibleName(combatant) {
  const token = combatant.token;
  const canSee = token?.playersCanSeeName ?? true; // PF2e (respects its name-visibility setting)
  return canSee || isPlayerOwned(combatant) ? combatant.name : localize("LUCD20.TurnAnnouncer.Unknown");
}

/**
 * Image and zoom for the card portrait. Token art is drawn at the token's
 * texture scale on the map (e.g. PF2e art at Scale 2 has lots of empty space
 * around the figure), so the portrait is zoomed by the same amount and cropped
 * to its frame. Dynamic token rings use their subject image and scale.
 */
function cardPortrait(combatant) {
  const doc = combatant.token;
  const ring = doc?.ring?.enabled ? doc.ring : null;
  let src = ring?.subject?.texture || doc?.texture?.src || combatant.img;
  let zoom = 1;
  if (doc?.texture) zoom = (Math.abs(doc.texture.scaleX ?? 1) + Math.abs(doc.texture.scaleY ?? 1)) / 2;
  if (ring) zoom *= ring.subject?.scale ?? 1;

  const isVideo = /\.(webm|mp4|m4v|ogv)(\?.*)?$/i.test(src ?? "");
  if (isVideo || !src) {
    src = combatant.actor?.img ?? "icons/svg/mystery-man.svg";
    zoom = 1;
  }
  return { src, zoom: Math.min(Math.max(zoom, 0.5), 3) };
}

function portraitHTML(portrait) {
  // Art scaled above 1 spills out of the frame with faded edges, like on the map.
  const zoomed = portrait.zoom > 1.05;
  return `<div class="lucd20-turn-portrait${zoomed ? " zoomed" : ""}">
        <img src="${esc(portrait.src)}" alt="" style="transform: scale(${portrait.zoom})">
      </div>`;
}

function turnKey(combat) {
  return `${combat.id}|${combat.round}|${combat.combatant?.id}`;
}

/* -------------------------------------------- */
/*  Chat card (active GM only)                  */
/* -------------------------------------------- */

async function announce(feature, combat) {
  const combatant = combat.combatant;
  if (!combat.started || !combatant || isHiddenCombatant(combatant) || combatant.isDefeated) return;
  if (!isPlayerOwned(combatant) && !feature.get("announceNpcs")) return;

  const key = turnKey(combat);
  if (state.lastAnnounced === key) return;
  state.lastAnnounced = key;

  const name = visibleName(combatant);
  const players = feature.get("showPlayerName") ? playerOwners(combatant).map(u => u.name) : [];
  const round = feature.get("showRound") ? localize("LUCD20.TurnAnnouncer.Round", { round: combat.round }) : "";
  const portrait = cardPortrait(combatant);
  const top = [
    round ? `<span class="lucd20-turn-round">${esc(round)}</span>` : "",
    players.length ? `<span class="lucd20-turn-player"><i class="fa-solid fa-user"></i> ${esc(players.join(", "))}</span>` : ""
  ].join("");

  // Compact card: portrait | Round · player / ───── / "Name's turn"
  const content = `
    <div class="lucd20-turn-card">
      ${portraitHTML(portrait)}
      <div class="lucd20-turn-text">
        ${top ? `<div class="lucd20-turn-top">${top}</div><hr class="lucd20-turn-rule">` : ""}
        <div class="lucd20-turn-name">${esc(localize("LUCD20.TurnAnnouncer.Turn", { name }))}</div>
      </div>
    </div>`;

  await ChatMessage.create({
    content,
    speaker: { alias: localize("LUCD20.TurnAnnouncer.Speaker") },
    flags: { [MODULE_ID]: { turnCard: true } }
  });
}

/* -------------------------------------------- */
/*  "You're up next" (every client)             */
/* -------------------------------------------- */

/** The next combatant who will act: skips defeated (and hidden) ones, wraps to the next round. */
function nextCombatant(combat) {
  const turns = combat.turns ?? [];
  if (!turns.length || combat.turn === null || combat.turn === undefined) return null;
  for (let i = 1; i <= turns.length; i++) {
    const candidate = turns[(combat.turn + i) % turns.length];
    if (!candidate.isDefeated && !isHiddenCombatant(candidate)) return candidate;
  }
  return null;
}

function headsUp(feature, combat) {
  if (game.user.isGM || !feature.get("headsUp") || !combat.started) return;
  const next = nextCombatant(combat);
  if (!next || next === combat.combatant || !next.actor?.isOwner) return;
  const key = `${turnKey(combat)}>${next.id}`;
  if (state.lastHeadsUp === key) return;
  state.lastHeadsUp = key;
  ui.notifications.info(localize("LUCD20.TurnAnnouncer.UpNext", { name: next.name }));
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

defineFeature({
  id: "turnAnnouncer",
  category: "combat",
  scope: "world",
  defaultEnabled: false,
  settings: {
    announceNpcs: { kind: "boolean", default: true },
    showPlayerName: { kind: "boolean", default: true },
    showRound: { kind: "boolean", default: true },
    headsUp: { kind: "boolean", default: true, scope: "client" }
  },

  enable(feature) {
    // Compact look: hide the message header of turn cards (GM can still delete via right-click).
    const markCard = (message, html) => {
      const el = html instanceof HTMLElement ? html : html?.[0];
      if (el && message.getFlag?.(MODULE_ID, "turnCard")) el.classList.add("lucd20-turn-message");
    };
    feature.on("renderChatMessageHTML", markCard);
    feature.on("renderChatMessage", markCard);
    feature.onCleanup(() => document.querySelectorAll(".lucd20-turn-message").forEach(el => el.classList.remove("lucd20-turn-message")));

    feature.on("updateCombat", (combat, changed) => {
      if (!("turn" in changed) && !("round" in changed)) return;
      if (game.user.isActiveGM) announce(feature, combat);
      headsUp(feature, combat);
    });
  }
});
