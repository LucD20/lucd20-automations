import { error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { broadcast, onBroadcast } from "../../core/socket.js";
import { readHP } from "../../core/hp.js";
import { clearAll, onTokenRefresh, engineState } from "./engine.js";
import { playReaction, lookOf, TYPES } from "./reactions.js";
import { playClip, jb2aLibrary } from "./jb2a.js";

/**
 * Token Reactions (owner, docs/PLAN.md §19, Q276–Q281; the look is docs/mockups/token-reactions-fable.html).
 *
 * When a creature takes a hit that matters, its token's art reacts like a coin on the table: thrown in a way
 * that depends on the damage type, with particles and a mark on the ground that fades. Only the drawing moves;
 * the token stays on its square and the art always comes back to it.
 *
 * - When (GM, world options): critical hits, hits that drop it to 0 HP, hits for at least a share of its max HP.
 * - Detection, on the active GM's client only: an actor's HP went down (compared with the last value seen, so
 *   it works whoever applied it, also for unlinked tokens). The damage type, the critical and the attacker come
 *   from the system's last damage roll for that target (system adapters: PF2e, D&D 4e); elsewhere, or without
 *   one, the default look.
 * - The GM's client sends { scene, token, type, crit, kill, share, amount, attacker } to every client; each
 *   one plays it only if that user sees the token on the canvas (never a hidden or unseen token; nothing is
 *   sent at all for a token hidden from players), with its own options: on/off, Less motion (also the
 *   browser's "reduce motion"), damage number (only for users who can see that token's HP bar), screen shake,
 *   strength, JB2A.
 * - The attacker's token lunges at its target when this user sees it.
 */

const SOCKET_TYPE = "tokenReaction";
/** How long a damage roll can explain an HP drop. */
const WINDOW = 3 * 60 * 1000;
/** A roll that names other targets still explains a drop this soon after it (applied to someone else). */
const LOOSE_WINDOW = 60 * 1000;

let feature = null;
/** actor uuid → { value, max, temp } last seen */
const cache = new Map();
/** Damage rolls seen lately, oldest first: { time, type, crit, attacker, scene, targets, actors, used } */
const records = [];

/* -------------------------------------------- */
/*  System adapters                             */
/* -------------------------------------------- */

const adapters = [];

/**
 * A system explains hits from its damage roll messages:
 *   { system: "pf2e", fromMessage(message) → { type, crit, attacker, scene, targets, actors } | null }
 * type: the system's damage type name (see `lookOf`); attacker: a token id on `scene`; targets: token uuids,
 * actors: actor uuids the roll was aimed at (empty when unknown, e.g. an area).
 */
export function registerReactionAdapter(adapter) {
  adapters.push(adapter);
}

const activeAdapters = () => adapters.filter(a => !a.system || a.system === game.system.id);

function onChatMessage(message) {
  if (!game.user.isGM) return;
  for (const adapter of activeAdapters()) {
    let found = null;
    try {
      found = adapter.fromMessage?.(message);
    } catch (err) {
      error("Token Reactions: could not read a damage roll.", err);
    }
    if (!found) continue;
    records.push({
      time: Date.now(), type: found.type ?? null, crit: !!found.crit, attacker: found.attacker ?? null, scene: found.scene ?? null,
      targets: [...(found.targets ?? [])], actors: [...(found.actors ?? [])], used: new Set()
    });
    if (records.length > 30) records.shift();
    return;
  }
}

/**
 * The damage roll behind an HP drop: the newest one, not yet used for this actor, that was aimed at it or at
 * nobody in particular; failing that, a roll of the last minute that nobody took yet (damage applied to someone
 * else than it was aimed at).
 */
export function findRecord(actorUuid, tokenUuids = [], now = Date.now()) {
  let loose = null;
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (now - r.time > WINDOW) break;
    if (r.used.has(actorUuid)) continue;
    const aimed = r.targets.length || r.actors.length;
    if (r.actors.includes(actorUuid) || tokenUuids.some(u => r.targets.includes(u))) return r;
    if (!aimed) return loose ?? r; // an area roll, unless a newer roll is still waiting to be applied
    if (!loose && !r.used.size && now - r.time <= LOOSE_WINDOW) loose = r;
  }
  return loose;
}

/* -------------------------------------------- */
/*  Detection (active GM)                       */
/* -------------------------------------------- */

/** { amount, share, kill } for an HP change that is a hit, else null. */
export function hitFrom(before, after) {
  if (!before || !after) return null;
  const amount = (before.value + before.temp) - (after.value + after.temp);
  const max = Math.max(before.max, after.max);
  // Not a hit: healing, or max HP going down and dragging HP with it.
  if (!(amount > 0) || !(max > 0) || after.max < before.max) return null;
  return { amount, share: Math.min(1, amount / max), kill: before.value > 0 && after.value <= 0 };
}

/** Whether the GM's options ask for a reaction to this hit. */
export function wanted(hit, options) {
  if (hit.crit && options.onCrit) return true;
  if (hit.kill && options.onKill) return true;
  return !!options.onBigHit && hit.share * 100 >= options.threshold - 1e-9;
}

function remember(actor) {
  const hp = readHP(actor);
  if (hp && actor?.uuid) cache.set(actor.uuid, hp);
}

function snapshotAll() {
  for (const actor of game.actors ?? []) remember(actor);
  for (const token of canvas?.tokens?.placeables ?? []) if (token.actor) remember(token.actor);
}

/** The actor's tokens on the scene this GM is viewing. */
function tokensOf(actor) {
  if (actor.isToken && actor.token) return [actor.token];
  const scene = canvas?.scene;
  return (actor.getActiveTokens?.(false, true) ?? []).filter(d => d && (!scene || !d.parent || d.parent === scene || d.parent.id === scene.id));
}

function checkActor(actor) {
  if (!actor?.uuid) return;
  const after = readHP(actor);
  if (!after) return;
  const before = cache.get(actor.uuid);
  cache.set(actor.uuid, after);
  if (!before || !game.user.isActiveGM || !feature?.active) return;
  const hit = hitFrom(before, after);
  if (!hit) return;
  try {
    detect(actor, hit);
  } catch (err) {
    error("Token Reactions: could not react to a hit.", err);
  }
}

function detect(actor, hit) {
  const docs = tokensOf(actor);
  if (!docs.length) return;
  const record = findRecord(actor.uuid, docs.map(d => d.uuid).filter(Boolean));
  record?.used.add(actor.uuid);
  hit.crit = !!record?.crit;
  hit.type = record?.type ?? "default";
  const options = { onCrit: feature.get("onCrit"), onKill: feature.get("onKill"), onBigHit: feature.get("onBigHit"), threshold: feature.get("threshold") };
  if (!wanted(hit, options)) return;
  for (const doc of docs) {
    const scene = doc.parent?.id ?? canvas.scene?.id ?? null;
    send({
      scene, token: doc.id, type: hit.type, crit: hit.crit, kill: hit.kill,
      share: Math.round(hit.share * 100) / 100, amount: hit.amount,
      attacker: record?.attacker && (!record.scene || record.scene === scene) && record.attacker !== doc.id ? record.attacker : null
    }, doc);
  }
}

/** Play here and on every other client (each decides for its own user). Nothing leaves for a hidden token. */
function send(payload, doc) {
  Hooks.callAll("lucd20.tokenReaction", payload);
  show(payload);
  if (!doc?.hidden) broadcast(SOCKET_TYPE, payload);
}

/* -------------------------------------------- */
/*  Showing it (every client)                   */
/* -------------------------------------------- */

const reducedMotion = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

function tokenById(id) {
  if (!id) return null;
  return canvas.tokens?.get?.(id) ?? (canvas.tokens?.placeables ?? []).find(t => t.id === id) ?? null;
}

/** This user sees the token on the canvas right now (Foundry decides: hidden tokens, vision, fog). */
export function canSee(token) {
  if (!token || token.destroyed || !token.mesh || token.mesh.destroyed) return false;
  if (token.visible !== true || token.renderable === false) return false;
  return !token.document?.hidden || game.user.isGM;
}

/** This user may know the token's HP: the GM, its owners, or its bar is shown to everyone. */
export function canSeeHP(token) {
  if (game.user.isGM) return true;
  const actor = token.actor ?? token.document?.actor;
  if (actor?.testUserPermission?.(game.user, "OWNER") || actor?.isOwner) return true;
  const modes = globalThis.CONST?.TOKEN_DISPLAY_MODES ?? { HOVER: 30, ALWAYS: 50 };
  const mode = token.document?.displayBars;
  return mode === modes.ALWAYS || mode === modes.HOVER;
}

/** A hit arrives (from the GM's client, or made here): play it if this user may and wants to see it. */
export function show(payload) {
  if (!feature?.active || !payload || !canvas?.ready || !feature.get("show")) return false;
  if (document.visibilityState === "hidden") return false; // nothing is drawn in a background tab
  if (payload.scene && canvas.scene?.id && payload.scene !== canvas.scene.id) return false;
  const token = tokenById(payload.token);
  if (!canSee(token)) return false;
  const from = tokenById(payload.attacker);
  const less = !!feature.get("lessMotion") || reducedMotion();
  engineState.shakeOn = !less && !!feature.get("shake");
  const amount = Number(payload.amount);
  const number = feature.get("damageNumber") && amount > 0 && canSeeHP(token) ? Math.max(1, Math.round(amount)) : null;
  const clip = !less && feature.get("jb2a") && jb2aLibrary() ? c => playClip(c.type, c.x, c.y, c.R * 3.4) : null;
  try {
    return playReaction(token, {
      type: payload.type, crit: !!payload.crit, kill: !!payload.kill, share: Number(payload.share) || 0,
      less, number, clip, intensity: feature.get("intensity")
    }, canSee(from) ? from : null);
  } catch (err) {
    error("Token Reactions: could not draw a reaction.", err);
    clearAll();
    return false;
  }
}

/* -------------------------------------------- */
/*  Preview (GM, settings window)               */
/* -------------------------------------------- */

const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const t = (key, data) => localize(`LUCD20.TokenReactions.${key}`, data);

/** Play a reaction on the GM's targets (from the selected token), or on the selected tokens. */
function preview(button, { crit = false, kill = false } = {}) {
  const type = button?.closest(".lucd20-tr-panel")?.querySelector("select")?.value || "bludgeoning";
  const controlled = canvas.tokens?.controlled ?? [];
  const targets = [...(game.user.targets ?? [])];
  const list = targets.length ? targets : controlled;
  if (!list.length) return ui.notifications.warn(t("PreviewNone"));
  const attacker = targets.length ? controlled.find(c => !targets.includes(c)) : null;
  for (const token of list) {
    send({ scene: canvas.scene?.id ?? null, token: token.id, type, crit, kill, share: kill ? 0.5 : 0.3, amount: null, attacker: attacker?.id ?? null }, token.document);
  }
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

export const _test = { cache, records, onChatMessage, checkActor, send, adapters };

defineFeature({
  id: "tokenReactions",
  category: "tokens",
  scope: "world",
  defaultEnabled: true,
  settings: {
    onCrit: { kind: "boolean", default: true },
    onKill: { kind: "boolean", default: true },
    onBigHit: { kind: "boolean", default: true },
    threshold: { kind: "range", min: 5, max: 100, step: 5, default: 25, dependsOn: "onBigHit" },
    show: { kind: "boolean", default: true, scope: "client" },
    lessMotion: { kind: "boolean", default: false, scope: "client" },
    damageNumber: { kind: "boolean", default: true, scope: "client" },
    shake: { kind: "boolean", default: true, scope: "client" },
    intensity: { kind: "range", min: 0.5, max: 1.5, step: 0.1, default: 1, scope: "client" },
    jb2a: { kind: "boolean", default: true, scope: "client" }
  },

  init() {
    onBroadcast(SOCKET_TYPE, payload => show(payload));
  },

  enable(f) {
    feature = f;
    f.on("updateActor", actor => checkActor(actor));
    f.on("updateToken", doc => { if (!doc?.actorLink) checkActor(doc?.actor); });
    f.on("updateActorDelta", delta => checkActor(delta?.parent?.actor));
    f.on("createToken", doc => doc?.actor && remember(doc.actor));
    f.on("createActor", actor => remember(actor));
    f.on("createChatMessage", onChatMessage);
    f.on("canvasReady", snapshotAll);
    f.on("canvasTearDown", () => clearAll());
    f.on("refreshToken", token => onTokenRefresh(token));
    f.onCleanup(() => {
      clearAll({ textures: true });
      cache.clear();
      records.length = 0;
    });
    snapshotAll();
  },

  // Options are read when a hit is shown: nothing to restart. Less motion / off: what is playing ends now.
  onSettingChange(f, key, value) {
    if ((key === "lessMotion" && value) || (key === "show" && !value)) clearAll();
  },

  renderPanel() {
    const options = Object.keys(TYPES).map(id => `<option value="${esc(id)}">${esc(t(`Type.${id}`))}</option>`).join("");
    const button = (action, icon, label) => `<button type="button" data-action="featureAction" data-feature="tokenReactions" data-feature-action="${action}"><i class="fa-solid ${icon}"></i> ${esc(t(label))}</button>`;
    return `<div class="lucd20-tr-panel">
      <select aria-label="${esc(t("PreviewType"))}">${options}</select>
      ${button("preview", "fa-burst", "Preview")}${button("previewCrit", "fa-star", "PreviewCrit")}${button("previewKill", "fa-skull", "PreviewKill")}
      <span class="hint">${esc(t("PreviewHint"))}</span>
    </div>`;
  },

  hubActions: {
    preview: (f, button) => preview(button),
    previewCrit: (f, button) => preview(button, { crit: true }),
    previewKill: (f, button) => preview(button, { kill: true })
  }
});

export { lookOf };
