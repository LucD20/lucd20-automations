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

function cardImage(combatant) {
  const src = combatant.token?.texture?.src ?? combatant.img;
  const isVideo = /\.(webm|mp4|m4v|ogv)(\?.*)?$/i.test(src ?? "");
  return isVideo || !src ? combatant.actor?.img ?? "icons/svg/mystery-man.svg" : src;
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

  const content = `
    <div class="lucd20-turn-card">
      <img class="lucd20-turn-image" src="${esc(cardImage(combatant))}" alt="">
      <div class="lucd20-turn-text">
        <span class="lucd20-turn-name">${esc(name)}</span>
        ${players.length ? `<span class="lucd20-turn-player"><i class="fa-solid fa-user"></i> ${esc(players.join(", "))}</span>` : ""}
      </div>
      ${round ? `<span class="lucd20-turn-round">${esc(round)}</span>` : ""}
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
    feature.on("updateCombat", (combat, changed) => {
      if (!("turn" in changed) && !("round" in changed)) return;
      if (game.user.isActiveGM) announce(feature, combat);
      headsUp(feature, combat);
    });
  }
});
