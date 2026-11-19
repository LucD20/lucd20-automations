import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { waitForDice } from "../../core/dice.js";
import { pickSquare } from "../../core/square-picker.js";

/**
 * PF2e rules the owner wants automated, replacing several automation modules. Each rule is noted
 * in docs/pf2e-rules.md as the owner gave it; this file holds rules 1–5.
 *
 * 1. Frightened (pf2eFrightened): goes down by 1 at the end of the creature's turn.
 * 2. Sickened (pf2eSickened): gets a retch DC when it is applied, and a chat line with a Fortitude
 *    button at the start of the creature's turn.
 * 3. Shove (pf2eShove): on a success the roller chooses where the target is pushed.
 * 4. Trip (pf2eTrip): Prone (and damage) by degree of success.
 * 5. Temporal Distortion (pf2eTemporalDistortion): after the target's Will save, the caster's
 *    player rolls a d4 for Clumsy, Enfeebled or Stupefied; a PF2e effect grants it for its duration.
 *
 * What a roll is, and against whom, is read from the roll's chat message as PF2e 8.7 writes it
 * (checked by the owner): flags.pf2e.context = { type, options: ["action:shove", …], outcome,
 * origin: { actor, token }, target: { actor, token }, dc: { value } }.
 * Everything that follows a roll waits for Dice So Nice first.
 * Conditions and moves of creatures a player does not own are done by the active GM's client.
 */

const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const L = (key, data) => localize(`LUCD20.PF2eRules.${key}`, data);
const contextOf = message => message?.flags?.pf2e?.context ?? null;
const authorId = message => message?.author?.id ?? message?.user?.id ?? null;
const isAction = (message, slug) => {
  const context = contextOf(message);
  return context?.type === "skill-check" && Array.isArray(context.options) && context.options.includes(`action:${slug}`);
};
const tokenOf = uuid => (uuid ? fromUuidSync(uuid) : null);

/**
 * Who may read a line about this combatant: everyone, unless the creature or its name is hidden
 * from the players; then only the GMs (a hidden creature's name must not reach them).
 */
export function audience(combatant) {
  const secret = combatant?.hidden || combatant?.token?.hidden || combatant?.token?.playersCanSeeName === false;
  return secret ? { whisper: game.users.filter(u => u.isGM).map(u => u.id) } : {};
}

/** When the Turn Announcer is on, wait for its "X's turn" card so a line posted now lands under it. */
async function afterTurnCard(since) {
  let announcer = false;
  try {
    announcer = !!game.settings.get(MODULE_ID, "turnAnnouncer_enabled");
  } catch (err) {
    announcer = false;
  }
  if (!announcer) return;
  for (let i = 0; i < 20; i++) {
    const posted = (game.messages?.contents ?? []).slice(-6).some(m => m.flags?.[MODULE_ID]?.turnCard && (m.timestamp ?? 0) >= since - 100);
    if (posted) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/* -------------------------------------------- */
/*  1. Frightened                               */
/* -------------------------------------------- */

/** Did the encounter move forward from `prior` to `current` (not back, when the GM steps back)? */
function movedForward(prior, current) {
  if (!prior || !current) return false;
  if ((current.round ?? 0) !== (prior.round ?? 0)) return (current.round ?? 0) > (prior.round ?? 0);
  return (current.turn ?? 0) > (prior.turn ?? 0);
}

/**
 * Turns ending and starting, worked out from the encounter's own updates (v0.41.1: the
 * `combatTurnChange` hook did not arrive in the owner's world, so nothing here depends on it).
 * The last known position of every encounter is remembered; when its round or turn changes and it
 * moved forward, the listeners hear which combatant's turn ended and whose began.
 * onTurns(feature, { end(combatant), start(combatant) }): active GM's client only.
 */
const positions = new Map(); // combat id → { round, turn, combatantId }
const positionOf = combat => ({ round: combat.round ?? 0, turn: combat.turn ?? 0, combatantId: combat.combatant?.id ?? null });

export function onTurns(feature, { end, start }) {
  for (const combat of game.combats ?? []) if (!positions.has(combat.id)) positions.set(combat.id, positionOf(combat));
  const key = `turns-${feature.id}`;
  const seen = new Map(); // combat id → last position this feature acted on
  feature.on("updateCombat", (combat, change) => {
    if (!("turn" in (change ?? {})) && !("round" in (change ?? {}))) return;
    const current = positionOf(combat);
    const prior = seen.get(combat.id) ?? positions.get(combat.id) ?? combat.previous ?? null;
    seen.set(combat.id, current);
    // The shared memory moves on after every listener of this update has read it.
    queueMicrotask(() => positions.set(combat.id, current));
    // CONFIG.debug.lucd20Rules = true in the console logs what each encounter update is taken to be.
    if (CONFIG.debug?.lucd20Rules) console.log(`${MODULE_ID} | ${key}`, { change, prior, current, activeGM: game.user.isActiveGM, started: combat.started });
    if (!game.user.isActiveGM || !combat.started) return;
    const first = !prior || (prior.round ?? 0) < 1; // the encounter has just begun: a turn starts, none ends
    if (!first && !movedForward(prior, current)) return;
    const run = (handler, id, what) => {
      const combatant = id ? combat.combatants.get(id) : null;
      if (handler && combatant?.actor) Promise.resolve(handler(combatant)).catch(err => error(`${key}: ${what} failed.`, err));
    };
    if (!first && prior.combatantId !== current.combatantId) run(end, prior.combatantId, "turn end");
    run(start, current.combatantId, "turn start");
  });
  feature.on("deleteCombat", combat => {
    positions.delete(combat.id);
    seen.delete(combat.id);
  });
}

defineFeature({
  id: "pf2eFrightened",
  category: "pf2e",
  systems: ["pf2e"],
  scope: "world",
  gmOnly: true,
  defaultEnabled: true,

  enable(feature) {
    onTurns(feature, {
      async end(combatant) {
        const actor = combatant.actor;
        if (!actor.hasCondition?.("frightened")) return;
        const before = conditionValue(actor.itemTypes?.condition?.find(c => c.slug === "frightened"));
        await actor.decreaseCondition("frightened");
        // Said in chat, so the change is not missed.
        const after = before - 1;
        const name = `<strong>${esc(combatant.name ?? actor.name)}</strong>`;
        await ChatMessage.create({
          content: `<p class="lucd20-rule-note"><i class="fa-solid fa-ghost"></i> ${after > 0 ? L("FrightenedDown", { name, before, after }) : L("FrightenedGone", { name })}</p>`,
          speaker: { alias: L("Speaker") },
          ...audience(combatant)
        });
      }
    });
  }
});

/* -------------------------------------------- */
/*  2. Sickened                                 */
/* -------------------------------------------- */

const RETCH = "retch";
// Level-based DCs (GM Core), levels −1 to 25.
const LEVEL_DC = [13, 14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];
export const levelDC = level => LEVEL_DC[Math.min(Math.max(Math.round(Number(level) || 0), -1), 25) + 1];

/**
 * The DC to retch against, for Sickened that has just landed on `actor`. A dragged condition does
 * not say where it came from (checked by the owner), so the recent chat is read, newest first:
 * - the creature's own saving throw: that save's DC (a spell's DC or an ability's, as rolled);
 * - a spell card: the caster's spell DC; another item's card: its owner's level-based DC;
 * - nothing recent: the creature's own level-based DC.
 */
export function retchDC(actor) {
  const recent = (game.messages?.contents ?? []).slice(-15).reverse().filter(m => Date.now() - (m.timestamp ?? Date.now()) < 180000);
  for (const message of recent) {
    const context = contextOf(message);
    if (context?.type === "saving-throw" && context.actor === actor.id && Number(context.dc?.value)) return { dc: Number(context.dc.value), source: "save" };
    const uuid = message.flags?.pf2e?.origin?.uuid;
    const item = uuid ? fromUuidSync(uuid) : null;
    if (!item?.actor || item.actor === actor) continue;
    const spellDC = item.type === "spell" ? Number(item.spellcasting?.statistic?.dc?.value) : 0;
    if (spellDC) return { dc: spellDC, source: "spell" };
    return { dc: levelDC(item.actor.level), source: "level" };
  }
  return { dc: levelDC(actor.level), source: "own" };
}

const sickenedOf = actor => actor?.itemTypes?.condition?.find(c => c.slug === "sickened") ?? null;
const conditionValue = condition => Number(condition?.value ?? condition?.system?.value?.value) || 1;

/** Sickened lands on a creature: give it its retch DC, shown at the end of its description. */
async function onConditionCreated(item) {
  if (!game.user.isActiveGM || item?.type !== "condition" || item.slug !== "sickened" || !item.actor) return;
  if (item.getFlag(MODULE_ID, RETCH)) return;
  const found = retchDC(item.actor);
  const label = `<p class="lucd20-retch"><strong>${esc(L("RetchLabel", { dc: found.dc }))}</strong> ${esc(L(`RetchSource.${found.source}`))}</p>`;
  try {
    await item.update({ [`flags.${MODULE_ID}.${RETCH}`]: found, "system.description.value": `${item.system?.description?.value ?? ""}${label}` });
  } catch (err) {
    error("Could not note the retch DC on Sickened.", err);
  }
}

/** Start of a sickened creature's turn: say what to roll, with a button. */
async function remindRetch(actor, tokenDoc, combatant = null) {
  const condition = sickenedOf(actor);
  if (!condition) return;
  // Under the "X's turn" card, where it is seen when the turn is played.
  await afterTurnCard(Date.now());
  const dc = Number(condition.getFlag(MODULE_ID, RETCH)?.dc) || retchDC(actor).dc;
  await ChatMessage.create({
    content: `<div class="lucd20-retch-card"><p><i class="fa-solid fa-face-dizzy"></i> ${L("RetchLine", { value: conditionValue(condition), dc })}</p>
      <button type="button" data-lucd20-retch data-actor="${esc(actor.uuid)}" data-dc="${dc}"><i class="fa-solid fa-dice-d20"></i> ${L("RetchButton", { dc })}</button></div>`,
    speaker: ChatMessage.getSpeaker?.({ actor, token: tokenDoc }) ?? { alias: actor.name },
    flags: { [MODULE_ID]: { retch: { actor: actor.uuid, dc } } },
    ...audience(combatant)
  });
}

/** The button: Fortitude against the DC; a success takes 1 off Sickened, a critical success 2. */
async function onRetchClick(button) {
  const actor = fromUuidSync(button.dataset.actor);
  const dc = Number(button.dataset.dc);
  if (!actor?.isOwner) return ui.notifications.warn(L("NotYours"));
  if (!sickenedOf(actor)) return ui.notifications.info(L("NotSickened", { name: actor.name }));
  button.disabled = true;
  try {
    const roll = await actor.saves?.fortitude?.roll({ dc: { value: dc }, extraRollOptions: ["action:retch"], skipDialog: false });
    if (!roll) return;
    // The roll's own message: the newest check by this user.
    const message = (game.messages?.contents ?? []).filter(m => authorId(m) === game.user.id && m.rolls?.length).at(-1);
    await waitForDice(message?.id);
    const degree = Number(roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess ?? 0);
    for (let i = 0; i < (degree >= 3 ? 2 : degree === 2 ? 1 : 0) && sickenedOf(actor); i++) await actor.decreaseCondition("sickened");
  } catch (err) {
    error("Retch roll failed.", err);
  } finally {
    button.disabled = false;
  }
}

defineFeature({
  id: "pf2eSickened",
  category: "pf2e",
  systems: ["pf2e"],
  scope: "world",
  gmOnly: true,
  defaultEnabled: true,

  enable(feature) {
    feature.on("createItem", onConditionCreated);
    onTurns(feature, { start: combatant => remindRetch(combatant.actor, combatant.token, combatant) });
    feature.on("renderChatMessageHTML", (message, html) => {
      for (const button of html.querySelectorAll?.("[data-lucd20-retch]") ?? []) {
        button.addEventListener("click", event => {
          event.preventDefault();
          if (feature.active) onRetchClick(button);
        });
      }
    });
  }
});

/* -------------------------------------------- */
/*  3. Shove                                    */
/* -------------------------------------------- */

const GREEN = 0x3fb950;
const BLUE = 0x3b82f6;

/**
 * Where a Shove can push, in squares relative to the target (the owner's diagram):
 * squares exactly 1 (success) or 2 (critical success: 1 or 2) squares from the target by PF2e
 * counting, on the far side from the shover: their direction from the target is within about 65° of
 * straight away. shover / target: centres in squares. Returns [{ dx, dy, steps }].
 */
export function shoveOffsets(shover, target, critical) {
  const away = { x: target.x - shover.x, y: target.y - shover.y };
  const awayLength = Math.hypot(away.x, away.y);
  if (!awayLength) return [];
  const out = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const a = Math.abs(dx);
      const b = Math.abs(dy);
      const steps = Math.max(a, b) + Math.floor(Math.min(a, b) / 2); // 5-10-5 diagonals
      if (steps < 1 || steps > (critical ? 2 : 1)) continue;
      const cos = (dx * away.x + dy * away.y) / (Math.hypot(dx, dy) * awayLength);
      if (cos < 0.4) continue;
      out.push({ dx, dy, steps });
    }
  }
  return out;
}

/**
 * The squares offered for this Shove message: [{ x, y, width, height, color, steps }] in scene pixels.
 * Worked out from the target's own scene, so the GM's client can check a choice while looking at
 * another scene (walls are only tested on the scene being viewed).
 */
function shoveSquares(message) {
  const context = contextOf(message);
  const shover = tokenOf(context?.origin?.token);
  const target = tokenOf(context?.target?.token);
  const critical = context?.outcome === "criticalSuccess";
  const scene = target?.parent;
  if (!shover || !target || !scene || shover.parent !== scene || !["success", "criticalSuccess"].includes(context?.outcome)) return [];
  const size = scene.grid?.size ?? canvas.grid.size;
  const centre = doc => ({ x: doc.x / size + doc.width / 2, y: doc.y / size + doc.height / 2 });
  const width = target.width * size;
  const height = target.height * size;
  const viewed = scene === canvas.scene;
  const rect = viewed ? canvas.dimensions?.sceneRect : null;
  const others = [...scene.tokens].filter(d => d !== target && !d.hidden);
  const backend = viewed ? CONFIG.Canvas?.polygonBackends?.move : null;
  const at = o => ({ x: target.x + o.dx * size, y: target.y + o.dy * size });
  const mid = o => ({ x: target.x + o.dx * size + width / 2, y: target.y + o.dy * size + height / 2 });
  const wall = (a, b) => !!backend?.testCollision?.(mid(a), mid(b), { type: "move", mode: "any" });
  // The target's whole footprint at offset o: inside the scene and on no other creature.
  const free = o => {
    const { x, y } = at(o);
    if (rect && (x < rect.x || y < rect.y || x + width > rect.x + rect.width || y + height > rect.y + rect.height)) return false;
    return !others.some(d => x < d.x + d.width * size && x + width > d.x && y < d.y + d.height * size && y + height > d.y);
  };
  const HOME = { dx: 0, dy: 0 };
  // v0.75.1 (owner): a push can't go through creatures. 10 ft: one of the squares half-way along the
  // push (rounded either way) must be free, and no wall on either leg.
  const halves = o => {
    const xs = [Math.floor(o.dx / 2), Math.ceil(o.dx / 2)], ys = [Math.floor(o.dy / 2), Math.ceil(o.dy / 2)];
    const out = [];
    for (const dx of new Set(xs)) for (const dy of new Set(ys)) if (dx || dy) out.push({ dx, dy });
    return out;
  };
  const reachable = o => {
    if (!free(o)) return false;
    if (o.steps === 1) return !wall(HOME, o);
    return halves(o).some(h => free(h) && !wall(HOME, h) && !wall(h, o));
  };
  return shoveOffsets(centre(shover), centre(target), critical).filter(reachable).map(o => ({
    ...at(o), width, height, steps: o.steps, color: o.steps === 1 ? GREEN : BLUE
  }));
}

/** The roller's client: after the dice, choose a square and ask the GM's client to move the target. */
async function onShoveMessage(message) {
  if (authorId(message) !== game.user.id || !isAction(message, "shove")) return;
  const outcome = contextOf(message).outcome;
  if (!["success", "criticalSuccess"].includes(outcome)) return;
  await waitForDice(message.id);
  const squares = shoveSquares(message);
  if (!squares.length) return void ui.notifications.info(L("ShoveNowhere"));
  const target = tokenOf(contextOf(message).target.token);
  const size = target.parent?.grid?.size ?? canvas.grid.size;
  const choice = await pickSquare(squares, {
    hint: L(outcome === "criticalSuccess" ? "ShoveHintCritical" : "ShoveHint", { name: target?.name ?? "" }),
    cancel: L("Cancel"),
    // Hovering a square shows the push: an arrow from where the target stands.
    from: { x: target.x + (target.width * size) / 2, y: target.y + (target.height * size) / 2 }
  });
  if (!choice) return;
  try {
    await executeAsGM("pf2eRules.shove", { messageId: message.id, x: choice.x, y: choice.y });
  } catch (err) {
    ui.notifications.warn(err.message ?? String(err));
  }
}

/** GM's client: the square must be one this Shove really offers; then the target is moved. */
async function shoveMove({ messageId, x, y }) {
  const message = game.messages.get(messageId);
  if (!isAction(message, "shove")) throw new Error(L("ShoveStale"));
  if (message.getFlag(MODULE_ID, "shoved")) throw new Error(L("ShoveDone"));
  const square = shoveSquares(message).find(s => s.x === x && s.y === y);
  if (!square) throw new Error(L("ShoveStale"));
  const target = tokenOf(contextOf(message).target.token);
  await message.setFlag(MODULE_ID, "shoved", true);
  // Forced movement: Reactive Strike (rule 7) does not react to it.
  await target.update({ x, y }, { [MODULE_ID]: { forced: true } });
  return true;
}

defineFeature({
  id: "pf2eShove",
  category: "pf2e",
  systems: ["pf2e"],
  scope: "world",
  gmOnly: true,
  defaultEnabled: true,

  init(feature) {
    onGMRequest("pf2eRules.shove", payload => {
      if (!feature.active) throw new Error(L("Off"));
      return shoveMove(payload);
    });
  },

  enable(feature) {
    feature.on("createChatMessage", message => {
      onShoveMessage(message).catch(err => error("Shove failed.", err));
    });
  }
});

/* -------------------------------------------- */
/*  4. Trip                                     */
/* -------------------------------------------- */

async function makeProne(actor) {
  if (actor && !actor.hasCondition?.("prone")) await actor.increaseCondition("prone");
}

/** The active GM's client: after the dice, Prone (and damage) by the degree of success. */
async function onTripMessage(message) {
  if (!game.user.isActiveGM || !isAction(message, "trip")) return;
  const context = contextOf(message);
  const target = tokenOf(context.target?.token)?.actor ?? (context.target?.actor ? fromUuidSync(context.target.actor) : null);
  const tripper = tokenOf(context.origin?.token)?.actor ?? game.actors.get(context.actor);
  await waitForDice(message.id);
  if (context.outcome === "criticalFailure") return makeProne(tripper);
  if (!["success", "criticalSuccess"].includes(context.outcome) || !target) return;
  await makeProne(target);
  if (context.outcome !== "criticalSuccess") return;
  // A normal damage roll: PF2e's own buttons apply it, so resistances and weaknesses are the system's.
  const DamageRoll = CONFIG.Dice?.rolls?.find(r => r.name === "DamageRoll");
  if (!DamageRoll) return;
  const roll = await new DamageRoll("1d6[bludgeoning]").evaluate();
  await roll.toMessage({
    flavor: `<strong>${esc(L("TripDamage"))}</strong>`, // short (owner, v0.50.1); no name, so nothing hidden leaks
    speaker: ChatMessage.getSpeaker?.({ actor: tripper }) ?? { alias: tripper?.name ?? "" }
  });
}

defineFeature({
  id: "pf2eTrip",
  category: "pf2e",
  systems: ["pf2e"],
  scope: "world",
  gmOnly: true,
  defaultEnabled: true,

  enable(feature) {
    feature.on("createChatMessage", message => {
      onTripMessage(message).catch(err => error("Trip failed.", err));
    });
  }
});



/* -------------------------------------------- */
/*  5. Temporal Distortion                      */
/* -------------------------------------------- */

/**
 * Temporal Distortion (oracle focus spell, Dark Archive / Divine Mysteries; Will). Read from the
 * target's saving throw message (owner's check: context.type "saving-throw", context.options has
 * "item:slug:temporal-distortion", flags.pf2e.origin = { actor, uuid, castRank }).
 * - Critical success: nothing. Otherwise a card asks the caster's player (the GM if that player is
 *   not connected) to roll a d4: 1 Clumsy, 2 Enfeebled, 3 Stupefied, 4 the roller chooses.
 * - Success: value 1 for 1 round; failure: 1 for 4 rounds; critical failure: 3 for 2 rounds.
 * - Applied by the active GM's client as a PF2e effect that grants the condition (GrantItem with
 *   the badge value) and lasts N rounds from the caster's turn, ending at the start of a turn. A
 *   new Temporal Distortion on the same creature replaces the old effect. Expired effects are
 *   removed at the start of each turn if PF2e has not removed them.
 */
const TD = "temporalDistortion";
const TD_SLUG = "temporal-distortion";
const TD_CONDITIONS = ["clumsy", "enfeebled", "stupefied"];
const TD_RESULT = { success: { value: 1, rounds: 1 }, failure: { value: 1, rounds: 4 }, criticalFailure: { value: 3, rounds: 2 } };
const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);
const conditionLabel = slug => L(`TD.Condition.${slug}`);

export function isTemporalDistortionSave(message) {
  const context = contextOf(message);
  if (context?.type !== "saving-throw") return false;
  const options = Array.isArray(context.options) ? context.options : [];
  const origin = message?.flags?.pf2e?.origin?.rollOptions ?? [];
  return options.includes(`item:slug:${TD_SLUG}`) || origin.includes(`origin:item:slug:${TD_SLUG}`);
}

/** The caster's player: the connected player whose character it is, else a connected owner; null = the GMs. */
function casterPlayer(caster) {
  const players = game.users.filter(u => u.active && !u.isGM && caster?.testUserPermission?.(u, "OWNER"));
  return players.find(u => u.character?.id === caster.id) ?? players[0] ?? null;
}

/** The save's creature and token: the message's speaker, else the context's actor id. */
function saveTarget(message) {
  const speaker = message.speaker ?? {};
  const scene = speaker.scene ? game.scenes?.get(speaker.scene) : null;
  const token = message.token ?? scene?.tokens?.get(speaker.token) ?? null;
  const actor = token?.actor ?? message.actor ?? game.actors?.get(contextOf(message)?.actor) ?? null;
  return { actor, token };
}

/** The target as players may name it (PF2e can hide an NPC's name). */
const shownName = (actor, token) => (token?.playersCanSeeName === false ? L("TD.Unnamed") : (token?.name ?? actor?.name ?? ""));

/** Active GM's client: after the save and its dice, the d4 card for the caster's player. */
async function onTemporalSave(message) {
  if (!game.user.isActiveGM || !isTemporalDistortionSave(message)) return;
  const outcome = contextOf(message).outcome;
  const origin = message.flags.pf2e.origin ?? {};
  const caster = origin.actor ? fromUuidSync(origin.actor) : null;
  const { actor, token } = saveTarget(message);
  if (!caster || !actor) return;
  // A new save (a reroll) replaces a card for the same creature that was not rolled yet.
  for (const old of (game.messages?.contents ?? []).slice(-30)) {
    const data = old.getFlag?.(MODULE_ID, TD);
    if (!data || data.done || data.claimed || data.target !== actor.uuid) continue;
    await old.update({ content: old.content.replace(/<button[\s\S]*?<\/button>/, `<p class="lucd20-td-done">${L("TD.Replaced")}</p>`), [`flags.${MODULE_ID}.${TD}.done`]: true });
  }
  if (!TD_RESULT[outcome]) return; // critical success: unaffected
  await waitForDice(message.id);
  const player = casterPlayer(caster);
  // A save the players could not see, or a creature hidden from them, stays between the roller and the GMs.
  const secret = !!message.blind || (message.whisper?.length ?? 0) > 0 || !!token?.hidden;
  const whisper = secret ? [...new Set([...(player ? [player.id] : []), ...gmIds()])] : [];
  const name = esc(shownName(actor, token));
  const who = player ? esc(player.name) : esc(L("TD.GM"));
  await ChatMessage.create({
    content: `<div class="lucd20-td-card"><p><i class="fa-solid fa-hourglass-half"></i> ${L("TD.Card", { name, who })}</p>
      <p class="lucd20-td-table">${L("TD.Table")}</p>
      <button type="button" data-lucd20-td><i class="fa-solid fa-dice"></i> ${L("TD.Button")}</button></div>`,
    speaker: ChatMessage.getSpeaker?.({ actor: caster }) ?? { alias: caster.name },
    whisper,
    flags: { [MODULE_ID]: { [TD]: { save: message.id, caster: caster.uuid, target: actor.uuid, token: token?.uuid ?? null, outcome, rank: Number(origin.castRank) || null, spell: origin.uuid ?? null, user: player?.id ?? null, secret, whisper } } }
  });
}

/** The card's button, on the roller's client: claim it, roll the d4, wait for the dice, choose on a 4. */
async function onTemporalClick(message, button) {
  const data = message.getFlag(MODULE_ID, TD);
  if (!data || data.done) return;
  button.disabled = true;
  try {
    await executeAsGM("pf2eRules.tdClaim", { cardId: message.id });
    const roll = await new Roll("1d4").evaluate();
    const caster = fromUuidSync(data.caster);
    const rollMessage = await roll.toMessage({
      flavor: `<strong>${esc(L("TD.RollFlavor"))}</strong>`,
      speaker: ChatMessage.getSpeaker?.({ actor: caster }) ?? { alias: caster?.name ?? "" },
      flags: { [MODULE_ID]: { [`${TD}Roll`]: message.id } }
    }, { rollMode: data.secret ? "gmroll" : "publicroll" });
    await waitForDice(rollMessage?.id);
    let choice = null;
    if (Number(roll.total) === 4) {
      while (!choice) choice = await chooseCondition(data);
    }
    await executeAsGM("pf2eRules.tdApply", { cardId: message.id, rollId: rollMessage.id, choice });
  } catch (err) {
    ui.notifications.warn(err.message ?? String(err));
    button.disabled = false;
  }
}

/** On a 4: the roller chooses the condition. */
async function chooseCondition(data) {
  const { value } = TD_RESULT[data.outcome];
  return foundry.applications.api.DialogV2.wait({
    window: { title: L("TD.ChooseTitle") },
    classes: ["lucd20-td-choose"],
    content: `<p>${L("TD.Choose")}</p>`,
    buttons: TD_CONDITIONS.map(slug => ({ action: slug, label: `${conditionLabel(slug)} ${value}` })),
    rejectClose: false
  });
}

/** GM's client: one roll per card, by the one it is for (any GM may roll in that player's place). */
async function tdClaim({ cardId }, senderId) {
  const card = game.messages.get(cardId);
  const data = card?.getFlag(MODULE_ID, TD);
  if (!data) throw new Error(L("TD.Stale"));
  if (data.done || data.claimed) throw new Error(L("TD.Done"));
  const sender = game.users.get(senderId);
  const designated = data.user ? game.users.get(data.user) : null;
  if (!sender?.isGM && senderId !== data.user && designated?.active) throw new Error(L("TD.NotYours", { who: designated.name }));
  if (!sender?.isGM && !designated && !fromUuidSync(data.caster)?.testUserPermission?.(sender, "OWNER")) throw new Error(L("NotYours"));
  await card.setFlag(MODULE_ID, TD, { ...data, claimed: senderId });
  return true;
}

/** A condition item of PF2e's compendium, by slug: its uuid for a GrantItem rule. */
async function conditionUuid(slug) {
  const pack = game.packs?.get("pf2e.conditionitems");
  const index = pack ? await pack.getIndex() : [];
  const entry = [...index].find(e => (e.system?.slug ?? String(e.name).toLowerCase()) === slug || String(e.name).toLowerCase() === slug);
  if (entry) return entry.uuid ?? `Compendium.pf2e.conditionitems.Item.${entry._id}`;
  const condition = game.pf2e?.ConditionManager?.getCondition?.(slug);
  return condition?.sourceId ?? condition?._stats?.compendiumSource ?? null;
}

/** The effect's data: the condition, its value and its duration from the caster's turn. */
export async function temporalEffect({ slug, value, rounds, caster, target, token, spell, rank }) {
  const uuid = await conditionUuid(slug);
  if (!uuid) throw new Error(L("TD.NoCondition", { condition: slug }));
  const combatant = game.combat?.combatants?.find?.(c => c.actor === caster || c.actorId === caster?.id) ?? null;
  const spellItem = spell ? fromUuidSync(spell) : null;
  return {
    type: "effect",
    name: L("TD.EffectName", { condition: `${conditionLabel(slug)} ${value}` }),
    img: spellItem?.img ?? "icons/svg/clockwork.svg",
    system: {
      slug: `${TD_SLUG}-${slug}`,
      description: { value: `<p>${L("TD.EffectText", { condition: `${conditionLabel(slug)} ${value}`, rounds })}</p>` },
      rules: [{ key: "GrantItem", uuid, alterations: [{ mode: "override", property: "badge-value", value }] }],
      level: { value: rank ?? spellItem?.level ?? 1 },
      duration: { value: rounds, unit: "rounds", expiry: "turn-start", sustained: false },
      start: { value: game.time?.worldTime ?? 0, initiative: combatant?.initiative ?? null },
      tokenIcon: { show: false },
      context: { origin: { actor: caster?.uuid ?? null, token: null, item: spell ?? null, spellcasting: null, rollOptions: [] }, target: { actor: target.uuid, token: token ?? null }, roll: null }
    },
    flags: { [MODULE_ID]: { [TD]: true } }
  };
}

/** GM's client: check the roll, then the effect (replacing an earlier one) and the chat line. */
async function tdApply({ cardId, rollId, choice }, senderId) {
  const card = game.messages.get(cardId);
  const data = card?.getFlag(MODULE_ID, TD);
  if (!data || data.done) throw new Error(L("TD.Done"));
  if (data.claimed !== senderId) throw new Error(L("TD.Stale"));
  const rollMessage = game.messages.get(rollId);
  if (rollMessage?.getFlag(MODULE_ID, `${TD}Roll`) !== cardId || authorId(rollMessage) !== senderId) throw new Error(L("TD.Stale"));
  const total = Number(rollMessage.rolls?.[0]?.total);
  const slug = total === 4 ? (TD_CONDITIONS.includes(choice) ? choice : null) : TD_CONDITIONS[total - 1];
  if (!slug) throw new Error(L("TD.Stale"));
  const target = fromUuidSync(data.target);
  const caster = fromUuidSync(data.caster);
  if (!target) throw new Error(L("TD.Stale"));
  const { value, rounds } = TD_RESULT[data.outcome];
  await card.setFlag(MODULE_ID, TD, { ...data, done: true, total, slug });
  const earlier = (target.itemTypes?.effect ?? []).filter(e => e.getFlag?.(MODULE_ID, TD));
  if (earlier.length) await target.deleteEmbeddedDocuments("Item", earlier.map(e => e.id));
  await target.createEmbeddedDocuments("Item", [await temporalEffect({ slug, value, rounds, caster, target, token: data.token, spell: data.spell, rank: data.rank })]);
  const token = data.token ? fromUuidSync(data.token) : null;
  const name = `<strong>${esc(shownName(target, token))}</strong>`;
  const chosen = total === 4 ? L("TD.Chosen") : "";
  const full = L("TD.Result", { name, condition: `${conditionLabel(slug)} ${value}`, rounds: L(rounds === 1 ? "TD.Round" : "TD.Rounds", { n: rounds }), total, chosen });
  const line = text => `<p class="lucd20-rule-note"><i class="fa-solid fa-hourglass-half"></i> ${text}</p>`;
  const speaker = { alias: L("Speaker") };
  if (!data.secret) {
    await ChatMessage.create({ content: line(full), speaker });
  } else {
    await ChatMessage.create({ content: line(full), speaker, whisper: gmIds() });
    // The roller learns the condition, not the value (which would tell the save's result).
    if (data.claimed && !game.users.get(data.claimed)?.isGM) await ChatMessage.create({ content: line(L("TD.ResultSecret", { name, condition: conditionLabel(slug), total, chosen })), speaker, whisper: [data.claimed] });
  }
  await card.update({ content: card.content.replace(/<button[\s\S]*?<\/button>/, `<p class="lucd20-td-done">${L("TD.CardDone", { total })}</p>`) });
  return true;
}

/** Start of each turn: a Temporal Distortion effect PF2e marks as expired is removed with its condition. */
async function removeExpired(combatant) {
  await new Promise(resolve => setTimeout(resolve, 250)); // PF2e may remove it itself first
  for (const c of combatant.combat?.combatants ?? []) {
    const actor = c.actor;
    const expired = (actor?.itemTypes?.effect ?? []).filter(e => e.getFlag?.(MODULE_ID, TD) && e.isExpired);
    if (expired.length) await actor.deleteEmbeddedDocuments("Item", expired.map(e => e.id)).catch(err => error("Could not remove an expired Temporal Distortion.", err));
  }
}

defineFeature({
  id: "pf2eTemporalDistortion",
  category: "pf2e",
  systems: ["pf2e"],
  scope: "world",
  gmOnly: true,
  defaultEnabled: true,

  init(feature) {
    onGMRequest("pf2eRules.tdClaim", (payload, senderId) => {
      if (!feature.active) throw new Error(L("Off"));
      return tdClaim(payload, senderId);
    });
    onGMRequest("pf2eRules.tdApply", (payload, senderId) => {
      if (!feature.active) throw new Error(L("Off"));
      return tdApply(payload, senderId);
    });
  },

  enable(feature) {
    feature.on("createChatMessage", message => {
      onTemporalSave(message).catch(err => error("Temporal Distortion failed.", err));
    });
    onTurns(feature, { start: removeExpired });
    feature.on("renderChatMessageHTML", (message, html) => {
      for (const button of html.querySelectorAll?.("[data-lucd20-td]") ?? []) {
        if (message.getFlag?.(MODULE_ID, TD)?.done) button.remove();
        button.addEventListener("click", event => {
          event.preventDefault();
          if (feature.active) onTemporalClick(message, button);
        });
      }
    });
  }
});

export const _test = { shoveSquares, shoveMove, onShoveMessage, onTripMessage, onConditionCreated, remindRetch, onRetchClick, movedForward, onTemporalSave, onTemporalClick, tdClaim, tdApply, removeExpired };
