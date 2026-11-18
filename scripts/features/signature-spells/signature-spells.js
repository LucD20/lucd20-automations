import { error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { broadcast, onBroadcast } from "../../core/socket.js";
import { canSee } from "../token-reactions/token-reactions.js";
import { allSignatures, signatureById, signatureFor } from "./registry.js";
import { clearAll as clearReactions } from "../token-reactions/engine.js";
import { ABORT, centerOf, clearEffects, hold, makeFx, onFrame } from "./effects.js";
import { dicePoints, diceLanded, dsnActive, dsnHooks, resetDsn, willAnimate } from "./dsn.js";
import "./spells/index.js";

/**
 * Signature Spells (owner, docs/PLAN.md §20): some spells get an effect of their own, tied to Dice So Nice.
 * The first: Chain Lightning (`spells/chain-lightning.js`). The second is not a spell: the Swashbuckler's
 * finisher, on the damage roll of a Strike (`spells/finisher.js`, docs/PLAN.md §21).
 *
 * - A system's reader (`registerSignatureReader`, e.g. `systems/pf2e/signature-spells.js`) says what a chat
 *   message is: which item, which roll, who cast it, at whom. `registry.js` finds the signature for it.
 * - Everything is local: every client reads the same chat message and plays for its own user. Nothing is
 *   sent (only the GM's preview is).
 *   - Nothing at all for a roll this user may not see (secret, blind, a whisper to others).
 *   - The dice part plays only where Dice So Nice animates the message's roll for this user: lightning
 *     around the dice while they roll, through them when they have landed, then from the last die.
 *   - The targets: only tokens this user sees on the canvas; a hidden or unseen token is skipped, the chain
 *     jumps to the next one. Each plays its Token Reactions look as the bolt arrives.
 *   - Without Dice So Nice (not active, off for this user, not shown for this roll, or it never finishes):
 *     the reduced version, at once: the chain from the caster's token (when seen; else from above).
 * - The damage is applied later: Token Reactions then plays only its quiet version (flash and number) on the
 *   tokens the chain already threw (`claimReaction`), unless the hit drops them to 0 HP.
 * - This user's Token Reactions options count: Less motion (no darting bolts, one plain chain, a flash on
 *   each token), strength, screen shake; with Token Reactions off, the bolts and a small burst only.
 */

const SOCKET_TYPE = "signaturePreview";
let lastRun = null;
/** If the dice have not landed by then, go on without them. */
const DICE_TIMEOUT = 15000;

let feature = null;
const runs = new Set();
const readers = [];

/**
 * A system reads its chat messages:
 *   { system: "pf2e", read(message) → { slug, name, roll, caster, scene, targets, ordered } | null }
 * roll: what kind of roll the message is ("damage", "attack", …); caster: a token id on `scene`; targets:
 * token uuids; ordered: the targets are in the order they were chosen (else: nearest next, from the caster).
 */
export function registerSignatureReader(reader) {
  readers.push(reader);
}

function read(message) {
  for (const reader of readers) {
    if (reader.system && reader.system !== game.system.id) continue;
    try {
      const info = reader.read?.(message);
      if (info) return info;
    } catch (err) {
      error("Signature Spells: could not read a message.", err);
    }
  }
  return null;
}

/* -------------------------------------------- */
/*  Who is hit, in which order                  */
/* -------------------------------------------- */

const tokenById = id => (id ? canvas.tokens?.get?.(id) ?? (canvas.tokens?.placeables ?? []).find(t => t.id === id) ?? null : null);

/** A token uuid → its token on the scene in view, or null. */
function tokenOf(uuid) {
  const m = /^Scene\.([^.]+)\.Token\.([^.]+)/.exec(String(uuid ?? ""));
  if (!m || (canvas.scene?.id && m[1] !== canvas.scene.id)) return null;
  return tokenById(m[2]);
}

/** Nearest next: from `start`, always the closest token not yet taken. */
export function nearestNext(tokens, start) {
  const left = [...tokens], out = [];
  let at = start;
  while (left.length) {
    let best = 0;
    if (at) for (let i = 1; i < left.length; i++) if (Math.hypot(left[i].x - at.x, left[i].y - at.y) < Math.hypot(left[best].x - at.x, left[best].y - at.y)) best = i;
    const [next] = left.splice(best, 1);
    out.push(next.token);
    at = next;
  }
  return out;
}

const owns = token => !!(token && !token.destroyed && (token.isOwner || token.actor?.isOwner || token.document?.isOwner));

/**
 * What this user gets to see of it: the caster and the targets they see, in order. `casterOwned`: the caster's
 * token when it is this user's own (seen or not: they know who rolled).
 */
function contextOf({ caster, targets, ordered }) {
  const from = tokenById(caster), casterSeen = canSee(from) ? from : null;
  let list = [...new Set((targets ?? []).map(t => (typeof t === "string" ? tokenOf(t) : t)).filter(t => t && canSee(t)))];
  if (!ordered) list = nearestNext(list.map(token => ({ token, ...centerOf(token) })), casterSeen ? centerOf(casterSeen) : null);
  return { caster: casterSeen, casterOwned: owns(from) ? from : null, targets: list };
}

/* -------------------------------------------- */
/*  A run                                       */
/* -------------------------------------------- */

/**
 * Play a signature for this user.
 * @param {object} sig    the definition
 * @param {object} info   { caster, targets, ordered }
 * @param {object} [o]    dice: a promise → true when Dice So Nice's dice have landed (the dice part plays
 *                        while waiting), false when they never did; claim: the targets' later Token
 *                        Reactions are ours (a real roll, not a preview); total: the roll's total
 */
export async function play(sig, info, { dice = null, claim = false, total = null } = {}) {
  if (sig.solo) stopAll();
  const run = { sig, dead: false, claim, info, total, t0: performance.now(), log: [], cleanups: new Set(), get: key => feature?.get(key) };
  runs.add(run);
  lastRun = run;
  const release = hold();
  const fx = makeFx(run);
  try {
    sig.start?.(fx, { ...contextOf(info), info });
    let from = null;
    if (dice) {
      const seen = new Set();
      const stop = onFrame(dt => {
        const points = dicePoints();
        for (const p of points) seen.add(p.mesh);
        if (!fx.less) sig.rolling?.(fx, points, dt);
      });
      let landed = false;
      try { landed = await dice; } finally { stop(); }
      if (run.dead) return;
      if (landed) {
        const points = seen.size ? dicePoints({ of: seen }) : dicePoints({ settled: true });
        if (points.length) {
          await sig.result?.(fx, points);
          from = Object.assign(points.at(-1), { screen: true });
        }
      }
    }
    await sig.toTargets?.(fx, { from, ...contextOf(info), info });
  } catch (err) {
    if (err !== ABORT) error(`Signature Spells: ${sig.id} stopped.`, err);
  } finally {
    endRun(run);
    release();
  }
}

/** A run is over (or stopped): what it put on the canvas and the screen goes, what it changed is put back. */
function endRun(run) {
  run.dead = true;
  runs.delete(run);
  for (const fn of [...(run.cleanups ?? [])]) fn();
}

function stopAll() {
  for (const run of [...runs]) endRun(run);
  runs.clear();
  clearEffects();
}

const wanted = sig => !!sig && !!feature?.active && !!feature.get("show") && !!feature.get(sig.id) && !!canvas?.ready && document.visibilityState !== "hidden";

async function onChatMessage(message) {
  if (!feature?.active || !feature.get("show") || !canvas?.ready) return;
  if (message?.visible === false || message?.isContentVisible === false) return; // not this user's to see
  const info = read(message);
  const sig = signatureFor(info, message);
  if (!wanted(sig)) return;
  if (info.scene && canvas.scene?.id && info.scene !== canvas.scene.id) return;
  // Dice So Nice decides in its own createChatMessage handler: ask once every handler has run.
  await new Promise(resolve => setTimeout(resolve, 0));
  if (!wanted(sig)) return;
  const dice = willAnimate(message) ? diceLanded(message.id, DICE_TIMEOUT) : null;
  const total = Number(message.rolls?.[0]?.total);
  await play(sig, info, { dice, claim: true, total: Number.isFinite(total) ? total : null });
}

/* -------------------------------------------- */
/*  Preview (GM, settings window)               */
/* -------------------------------------------- */

const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const t = (key, data) => localize(`LUCD20.SignatureSpells.${key}`, data);

/**
 * On the GM's targets (cast by the selected token), or on the selected tokens. The GM also gets the dice
 * (when Dice So Nice is active); everyone else the chain alone, on the tokens they see.
 */
async function preview(button) {
  const panel = button?.closest(".lucd20-tr-panel");
  const sig = signatureById(panel?.querySelector("select")?.value) ?? allSignatures()[0];
  if (!sig) return;
  // The signature's own choices (which finisher …), next to the button.
  const options = {};
  for (const key of Object.keys(sig.previewOptions ?? {})) {
    const value = panel?.querySelector(`select[data-for="${sig.id}"][data-option="${key}"]`)?.value;
    if (value != null && value in (sig.previewOptions[key].choices ?? {})) options[key] = value;
  }
  const controlled = canvas.tokens?.controlled ?? [], targets = [...(game.user.targets ?? [])];
  const list = targets.length ? targets : controlled;
  if (!list.length) return ui.notifications.warn(t("PreviewNone"));
  const caster = targets.length ? controlled.find(c => !targets.includes(c)) ?? null : null;
  const scene = canvas.scene?.id ?? null;
  // Nothing about a hidden token leaves this client.
  broadcast(SOCKET_TYPE, { spell: sig.id, scene, caster: caster && !caster.document?.hidden ? caster.id : null, targets: list.filter(x => !x.document?.hidden).map(x => x.id),
    ...(Object.keys(options).length ? { options } : {}) });
  let dice = null, total = null;
  if (dsnActive() && sig.preview && typeof game.dice3d.showForRoll === "function") {
    try {
      const roll = await new Roll(sig.preview).evaluate();
      if (Number.isFinite(Number(roll.total))) total = Number(roll.total);
      const shown = Promise.resolve(game.dice3d.showForRoll(roll, game.user, false)).then(v => v !== false, () => false);
      dice = Promise.race([shown, new Promise(resolve => setTimeout(() => resolve(false), DICE_TIMEOUT))]);
    } catch (err) {
      error("Signature Spells: could not roll the preview's dice.", err);
    }
  }
  await play(sig, { ...previewInfo(sig, options), caster: caster?.id ?? null, targets: list, ordered: true }, { dice, total: dice ? total : null });
}

/** What a preview stands for: the signature says what its reader would have found. */
function previewInfo(sig, options) {
  try { return { roll: "damage", ...(sig.previewInfo?.(options ?? {}) ?? {}) }; } catch { return { roll: "damage" }; }
}

function onPreview(payload) {
  const sig = signatureById(payload?.spell);
  if (!sig || !feature?.active || !feature.get("show") || !canvas?.ready || document.visibilityState === "hidden") return;
  if (payload.scene && canvas.scene?.id && payload.scene !== canvas.scene.id) return;
  const options = payload.options && typeof payload.options === "object" ? payload.options : {};
  play(sig, { ...previewInfo(sig, options), caster: payload.caster, targets: (payload.targets ?? []).map(tokenById).filter(Boolean), ordered: true });
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

export const _test = { runs, readers, onChatMessage, onPreview, contextOf, get lastRun() { return lastRun; } };

defineFeature({
  id: "signatureSpells",
  category: "tokens",
  scope: "world",
  defaultEnabled: true,
  settings: {
    show: { kind: "boolean", default: true, scope: "client" },
    // One GM switch per signature spell, then that spell's own options.
    ...Object.fromEntries(allSignatures().flatMap(sig => [[sig.id, { kind: "boolean", default: true }], ...Object.entries(sig.settings ?? {})]))
  },

  init() {
    onBroadcast(SOCKET_TYPE, onPreview);
  },

  enable(f) {
    feature = f;
    f.on("createChatMessage", message => { onChatMessage(message); });
    for (const [hook, fn] of Object.entries(dsnHooks)) f.on(hook, fn);
    f.on("canvasTearDown", () => { stopAll(); clearReactions(); });
    f.onCleanup(() => {
      stopAll();
      // What a signature drew with the Token Reactions engine (marks, sparks, thrown art) ends with it.
      clearReactions();
      resetDsn();
      lastRun = null;
      for (const sig of allSignatures()) { try { sig.dispose?.(); } catch (err) { error(`Signature Spells: ${sig.id} could not be freed.`, err); } }
    });
  },

  // Options are read when a spell plays. Switched off for me, or a spell switched off: what plays ends now.
  onSettingChange(f, key, value) {
    if (!value) stopAll();
  },

  renderPanel() {
    const sigs = allSignatures();
    const options = sigs.map(sig => `<option value="${esc(sig.id)}">${esc(localize(`LUCD20.Feature.signatureSpells.Setting.${sig.id}.Name`))}</option>`).join("");
    // A signature's own choices: shown while it is the one picked.
    const extra = sigs.flatMap((sig, i) => Object.entries(sig.previewOptions ?? {}).map(([key, o]) => `<select data-for="${esc(sig.id)}" data-option="${esc(key)}" aria-label="${esc(localize(o.label))}"${i ? " hidden" : ""}>${
      Object.entries(o.choices ?? {}).map(([value, label]) => `<option value="${esc(value)}">${esc(localize(label))}</option>`).join("")}</select>`)).join("");
    const pick = extra ? ` onchange="for (const s of this.parentElement.querySelectorAll('select[data-for]')) s.hidden = s.dataset.for !== this.value"` : "";
    return `<div class="lucd20-tr-panel">
      <select aria-label="${esc(t("PreviewSpell"))}"${pick}>${options}</select>${extra}
      <button type="button" data-action="featureAction" data-feature="signatureSpells" data-feature-action="preview"><i class="fa-solid fa-bolt"></i> ${esc(t("Preview"))}</button>
      <span class="hint">${esc(t("PreviewHint"))}</span>
    </div>`;
  },

  hubActions: {
    preview: (f, button) => preview(button)
  }
});
