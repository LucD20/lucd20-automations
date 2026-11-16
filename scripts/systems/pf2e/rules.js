import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { waitForDice } from "../../core/dice.js";
import { pickSquare } from "../../core/square-picker.js";

/**
 * PF2e rules the owner wants automated, replacing several automation modules. Each rule is noted
 * in docs/pf2e-rules.md as the owner gave it; this file holds rules 1–4.
 *
 * 1. Frightened (pf2eFrightened): goes down by 1 at the end of the creature's turn.
 * 2. Sickened (pf2eSickened): gets a retch DC when it is applied, and a chat line with a Fortitude
 *    button at the start of the creature's turn.
 * 3. Shove (pf2eShove): on a success the roller chooses where the target is pushed.
 * 4. Trip (pf2eTrip): Prone (and damage) by degree of success.
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

/* -------------------------------------------- */
/*  1. Frightened                               */
/* -------------------------------------------- */

/** Did the encounter move forward from `prior` to `current` (not back, when the GM steps back)? */
function movedForward(prior, current) {
  if (!prior || !current) return false;
  if ((current.round ?? 0) !== (prior.round ?? 0)) return (current.round ?? 0) > (prior.round ?? 0);
  return (current.turn ?? 0) > (prior.turn ?? 0);
}

defineFeature({
  id: "pf2eFrightened",
  category: "pf2e",
  systems: ["pf2e"],
  scope: "world",
  gmOnly: true,
  defaultEnabled: true,

  enable(feature) {
    feature.on("combatTurnChange", async (combat, prior, current) => {
      if (!game.user.isActiveGM || !movedForward(prior, current)) return;
      const actor = combat.combatants.get(prior.combatantId)?.actor;
      if (!actor?.hasCondition?.("frightened")) return;
      try {
        await actor.decreaseCondition("frightened");
      } catch (err) {
        error("Could not reduce Frightened.", err);
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
async function remindRetch(actor, tokenDoc) {
  const condition = sickenedOf(actor);
  if (!condition) return;
  const dc = Number(condition.getFlag(MODULE_ID, RETCH)?.dc) || retchDC(actor).dc;
  await ChatMessage.create({
    content: `<div class="lucd20-retch-card"><p><i class="fa-solid fa-face-dizzy"></i> ${L("RetchLine", { value: conditionValue(condition), dc })}</p>
      <button type="button" data-lucd20-retch data-actor="${esc(actor.uuid)}" data-dc="${dc}"><i class="fa-solid fa-dice-d20"></i> ${L("RetchButton", { dc })}</button></div>`,
    speaker: ChatMessage.getSpeaker?.({ actor, token: tokenDoc }) ?? { alias: actor.name },
    flags: { [MODULE_ID]: { retch: { actor: actor.uuid, dc } } }
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
    feature.on("combatTurnChange", (combat, prior, current) => {
      if (!game.user.isActiveGM || !movedForward(prior, current)) return;
      const combatant = combat.combatants.get(current.combatantId);
      if (combatant?.actor) remindRetch(combatant.actor, combatant.token).catch(err => error("Retch reminder failed.", err));
    });
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
  const from = { x: target.x + width / 2, y: target.y + height / 2 };
  const viewed = scene === canvas.scene;
  const rect = viewed ? canvas.dimensions?.sceneRect : null;
  const others = [...scene.tokens].filter(d => d !== target && !d.hidden);
  return shoveOffsets(centre(shover), centre(target), critical).map(o => ({
    x: target.x + o.dx * size, y: target.y + o.dy * size, width, height, steps: o.steps, color: o.steps === 1 ? GREEN : BLUE
  })).filter(s => {
    if (rect && (s.x < rect.x || s.y < rect.y || s.x + width > rect.x + rect.width || s.y + height > rect.y + rect.height)) return false;
    // Not through a wall, and not onto another creature.
    const to = { x: s.x + width / 2, y: s.y + height / 2 };
    const backend = viewed ? CONFIG.Canvas?.polygonBackends?.move : null;
    if (backend?.testCollision?.(from, to, { type: "move", mode: "any" })) return false;
    return !others.some(d => s.x < d.x + d.width * size && s.x + width > d.x && s.y < d.y + d.height * size && s.y + height > d.y);
  });
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
  const choice = await pickSquare(squares, { hint: L(outcome === "criticalSuccess" ? "ShoveHintCritical" : "ShoveHint", { name: target?.name ?? "" }) });
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
  await target.update({ x, y });
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
    flavor: `<strong>${esc(L("TripDamage", { name: target.name }))}</strong>`,
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

export const _test = { shoveSquares, shoveMove, onShoveMessage, onTripMessage, onConditionCreated, remindRetch, onRetchClick, movedForward };
