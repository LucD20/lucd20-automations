import { MODULE_ID, localize } from "../../core/constants.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { registerLockedDoorAdapter } from "../../features/locked-door-alert.js";

/**
 * PF2e door locks (part of Locked Door Alert; PF2e options "Lock options" and
 * "Unlock on success").
 *
 * - Wall settings get a "Lock" section: a description and the ways to open
 *   the door (Q20): Force Open (Athletics), Pick a Lock (Thievery, thieves'
 *   toolkit, successes needed), Other check (any skill, label). Each has a DC.
 *   Stored in `flags.lucd20-automations.lock`.
 * - A player clicking such a locked door posts a card instead of the plain
 *   line: the description, one row per way with the best active party member
 *   on the scene ("Best: Amiri +12") and a Try button (Q21).
 * - Try rolls for the player's own character (a choice if several; the GM can
 *   pick anyone) using PF2e's own actions (so crowbars, feats and the jammed
 *   −2 apply), with the DC shown or hidden per PF2e's "show DCs" setting.
 * - The result goes to the active GM's client, which updates the door
 *   (unlock on success, option; Force Open also opens it and, on a plain
 *   success, turns the door secret: "the players broke it" (owner's call);
 *   Force Open critical failure jams it, −2 to later tries; Pick a Lock counts
 *   successes) and posts one line saying what happened.
 *
 * The lock data is in the wall's flags, which every client receives: it's
 * hidden from players' screens (DC per PF2e's setting), not a secret store.
 */

const FLAG = "lock"; // set from the wall's settings form
const STATE = "lockState"; // { picks, jammed }, written by the GM's client only
const esc = value => Handlebars.escapeExpression(String(value ?? ""));

const TYPES = {
  forceOpen: { icon: "fa-hand-fist", skill: "athletics", action: "forceOpen" },
  pickALock: { icon: "fa-key", skill: "thievery", action: "pickALock" },
  check: { icon: "fa-dice-d20", skill: null, action: null }
};

/* -------------------------------------------- */
/*  Lock data                                   */
/* -------------------------------------------- */

function lockOf(wall) {
  const lock = wall?.getFlag?.(MODULE_ID, FLAG);
  if (!lock) return null;
  const ways = [];
  for (const type of Object.keys(TYPES)) {
    const way = lock[type];
    if (!way?.enabled) continue;
    const dc = Number(way.dc);
    if (!(dc > 0)) continue;
    const skill = type === "check" ? way.skill || "athletics" : TYPES[type].skill;
    ways.push({ type, dc, skill, label: way.label, successes: Math.max(1, Number(way.successes) || 1) });
  }
  if (!ways.length) return null;
  return { description: String(lock.description ?? "").trim(), ways };
}

function stateOf(wall) {
  return { picks: 0, jammed: false, ...(wall?.getFlag?.(MODULE_ID, STATE) ?? {}) };
}

function skillLabel(slug) {
  const entry = CONFIG.PF2E?.skills?.[slug];
  const label = typeof entry === "string" ? entry : entry?.label;
  if (label) return game.i18n.localize(label);
  if (slug === "perception") return game.i18n.localize("PF2E.PerceptionLabel");
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function wayLabel(way) {
  if (way.type === "check") return way.label || localize("LUCD20.DoorLocks.Check");
  return localize(`LUCD20.DoorLocks.${way.type === "forceOpen" ? "ForceOpen" : "PickALock"}`);
}

function wallFromCard(el) {
  const card = el.closest(".lucd20-lock-card");
  const scene = game.scenes?.get(card?.dataset.sceneId);
  return scene?.walls?.get(card?.dataset.wallId) ?? null;
}

/* -------------------------------------------- */
/*  Who                                         */
/* -------------------------------------------- */

/** Active party members on the scene (all members if none are on it). */
function partyMembers() {
  const party = game.actors?.party;
  let members = party?.members?.filter(a => a?.type === "character") ?? [];
  if (!members.length) members = (game.actors ?? []).filter(a => a.type === "character" && a.hasPlayerOwner);
  const onScene = members.filter(a => a.getActiveTokens?.(false, true)?.some(t => t.parent?.id === canvas?.scene?.id));
  return onScene.length ? onScene : members;
}

function hasToolkit(actor) {
  return actor.itemTypes?.equipment?.some?.(i => (i.slug ?? "").startsWith("thieves-toolkit") || /thie(f|ves)'?s?'? ?tool/i.test(i.name))
    ?? actor.items?.some?.(i => (i.slug ?? "").startsWith("thieves-toolkit") || /thie(f|ves)'?s?'? ?tool/i.test(i.name))
    ?? false;
}

function modifier(actor, way) {
  const stat = actor.getStatistic?.(way.skill) ?? actor.skills?.[way.skill];
  return typeof stat?.mod === "number" ? stat.mod : null;
}

function canTry(actor, way) {
  return way.type !== "pickALock" || hasToolkit(actor);
}

function best(way) {
  let top = null;
  for (const actor of partyMembers()) {
    if (!canTry(actor, way)) continue;
    const mod = modifier(actor, way);
    if (mod === null) continue;
    if (!top || mod > top.mod) top = { actor, mod };
  }
  return top;
}

const signed = n => (n >= 0 ? `+${n}` : `${n}`);

/* -------------------------------------------- */
/*  Card                                        */
/* -------------------------------------------- */

async function postCard(feature, control, who) {
  if (!feature.get("lockOptions")) return false;
  const wall = control.wall?.document;
  const lock = lockOf(wall);
  if (!lock) return false;
  const speaker = ChatMessage.getSpeaker?.({ actor: who.actor, token: who.token }) ?? { alias: who.name };
  const content = `
    <div class="lucd20-lock-card" data-scene-id="${esc(wall.parent?.id)}" data-wall-id="${esc(wall.id)}">
      <p class="lucd20-lock-title"><i class="fa-solid fa-lock"></i> ${localize("LUCD20.Doors.Locked", { name: esc(who.name) })}</p>
      ${lock.description ? `<p class="lucd20-lock-desc">${esc(lock.description)}</p>` : ""}
      <div class="lucd20-lock-ways"></div>
    </div>`;
  await ChatMessage.create({
    content,
    speaker,
    flags: { [MODULE_ID]: { lockedDoor: { wallId: wall.id, sceneId: wall.parent?.id }, lockCard: true } }
  });
  return true;
}

function showDC() {
  if (game.user.isGM) return true;
  try {
    return !!game.settings.get("pf2e", "metagame_showDC");
  } catch {
    return false;
  }
}

/** Rows are drawn on each client from the live wall data (so edits and unlocks show). */
function drawWays(el) {
  const box = el.querySelector(".lucd20-lock-ways");
  const wall = wallFromCard(el);
  if (!box) return;
  const lock = lockOf(wall);
  const locked = wall?.ds === CONST.WALL_DOOR_STATES?.LOCKED;
  if (!wall || !lock || !locked) {
    const key = !wall ? "Gone" : wall.ds === CONST.WALL_DOOR_STATES?.OPEN ? "Opened" : "Unlocked";
    box.innerHTML = `<p class="lucd20-lock-done"><i class="fa-solid fa-lock-open"></i> ${esc(localize(`LUCD20.DoorLocks.${key}`))}</p>`;
    return;
  }
  const state = stateOf(wall);
  const dcs = showDC();
  box.innerHTML = lock.ways.map((way, index) => {
    const top = best(way);
    const sub = [skillLabel(way.skill), dcs ? `DC ${way.dc}` : null].filter(Boolean).join(" · ");
    const extra = [];
    if (way.type === "pickALock" && way.successes > 1) extra.push(localize("LUCD20.DoorLocks.Progress", { done: state.picks, total: way.successes }));
    if (way.type === "forceOpen" && state.jammed) extra.push(localize("LUCD20.DoorLocks.Jammed"));
    return `
      <div class="lucd20-lock-way">
        <i class="fa-solid ${TYPES[way.type].icon} lucd20-lock-icon"></i>
        <div class="lucd20-lock-text">
          <div class="lucd20-lock-name">${esc(wayLabel(way))} <span class="lucd20-lock-sub">${esc(sub)}</span></div>
          <div class="lucd20-lock-best">${top ? esc(localize("LUCD20.DoorLocks.Best", { name: top.actor.name, mod: signed(top.mod) })) : esc(localize("LUCD20.DoorLocks.NoOne"))}${extra.length ? ` · ${esc(extra.join(" · "))}` : ""}</div>
        </div>
        <button type="button" class="lucd20-lock-try" data-way="${index}"><i class="fa-solid fa-dice-d20"></i> ${esc(localize("LUCD20.DoorLocks.Try"))}</button>
      </div>`;
  }).join("");
}

/* -------------------------------------------- */
/*  Rolling                                     */
/* -------------------------------------------- */

async function chooseActor(way) {
  const candidates = game.user.isGM ? partyMembers() : partyMembers().filter(a => a.isOwner);
  const own = game.user.isGM ? [] : (game.actors ?? []).filter(a => a.type === "character" && a.isOwner && !candidates.includes(a));
  const list = [...candidates, ...own];
  const controlled = canvas?.tokens?.controlled?.map(t => t.actor).find(a => a && list.includes(a));
  if (!game.user.isGM) {
    if (controlled) return controlled;
    if (game.user.character && list.includes(game.user.character)) return game.user.character;
    if (list.length === 1) return list[0];
  }
  if (!list.length) {
    ui.notifications.warn(localize("LUCD20.DoorLocks.NoCharacter"));
    return null;
  }
  const preferred = controlled ?? best(way)?.actor ?? list[0];
  const options = list.map(a => {
    const mod = modifier(a, way);
    return `<option value="${esc(a.id)}" ${a === preferred ? "selected" : ""}>${esc(a.name)}${mod === null ? "" : ` (${signed(mod)})`}</option>`;
  }).join("");
  const id = await foundry.applications.api.DialogV2.prompt({
    window: { title: wayLabel(way), icon: `fa-solid ${TYPES[way.type].icon}` },
    content: `<div class="form-group"><label>${esc(localize("LUCD20.DoorLocks.Who"))}</label><select name="actor">${options}</select></div>`,
    ok: { label: localize("LUCD20.DoorLocks.Try"), icon: "fa-solid fa-dice-d20", callback: (event, button) => button.form.elements.actor.value },
    rejectClose: false
  });
  return id ? game.actors.get(id) : null;
}

const OUTCOMES = ["criticalFailure", "failure", "success", "criticalSuccess"];

function jammedModifier() {
  const Modifier = game.pf2e?.Modifier;
  if (!Modifier) return [];
  return [new Modifier({ slug: "lucd20-jammed", label: localize("LUCD20.DoorLocks.Jammed"), modifier: -2, type: "circumstance" })];
}

async function attempt(wall, way, actor, event) {
  if (!canTry(actor, way)) {
    ui.notifications.warn(localize("LUCD20.DoorLocks.NoToolkit", { name: actor.name }));
    return;
  }
  const state = stateOf(wall);
  const dc = { value: way.dc };
  const report = outcome => {
    if (!outcome) return;
    executeAsGM("doorLocks.result", {
      sceneId: wall.parent?.id,
      wallId: wall.id,
      type: way.type,
      outcome,
      actorName: actor.name
    }).catch(err => ui.notifications.error(err.message));
  };

  const action = TYPES[way.type].action;
  const legacy = action ? game.pf2e?.actions?.[action] : null;
  if (typeof legacy === "function") {
    legacy({
      actors: [actor],
      difficultyClass: dc,
      event,
      modifiers: way.type === "forceOpen" && state.jammed ? jammedModifier() : undefined,
      callback: result => report(result?.outcome)
    });
    return;
  }
  // Other checks (or no PF2e action available): the statistic's own roll.
  const stat = actor.getStatistic?.(way.skill) ?? actor.skills?.[way.skill];
  if (!stat?.roll) return;
  const roll = await stat.roll({ dc, event, extraRollOptions: ["lucd20:door-lock"] });
  const degree = roll?.degreeOfSuccess ?? roll?.options?.degreeOfSuccess;
  report(typeof degree === "number" ? OUTCOMES[degree] : null);
}

async function onTry(button, event) {
  const el = button.closest(".lucd20-lock-card");
  const wall = wallFromCard(el);
  const lock = lockOf(wall);
  const way = lock?.ways[Number(button.dataset.way)];
  if (!wall || !way) return;
  if (wall.ds !== CONST.WALL_DOOR_STATES.LOCKED) {
    ui.notifications.info(localize("LUCD20.DoorLocks.Unlocked"));
    return drawWays(el);
  }
  const actor = await chooseActor(way);
  if (actor) await attempt(wall, way, actor, event);
}

/* -------------------------------------------- */
/*  Result (active GM)                          */
/* -------------------------------------------- */

async function applyResult(feature, { sceneId, wallId, type, outcome, actorName }) {
  const wall = game.scenes?.get(sceneId)?.walls?.get(wallId);
  const lock = lockOf(wall);
  if (!wall || !lock || wall.ds !== CONST.WALL_DOOR_STATES.LOCKED) return;
  const way = lock.ways.find(w => w.type === type);
  if (!way) return;
  const success = outcome === "success" || outcome === "criticalSuccess";
  const autoUnlock = feature.get("autoUnlock");
  const state = stateOf(wall);
  const update = {};
  let key = null;

  if (type === "forceOpen") {
    if (success && autoUnlock) {
      update.ds = CONST.WALL_DOOR_STATES.OPEN;
      if (outcome === "success") {
        update.door = CONST.WALL_DOOR_TYPES.SECRET; // broken: it can't be closed any more
        key = "ResultBroken";
      } else key = "ResultForced";
    } else if (outcome === "criticalFailure" && !state.jammed) {
      update[`flags.${MODULE_ID}.${STATE}.jammed`] = true;
      key = "ResultJammed";
    }
  } else if (type === "pickALock") {
    if (success && autoUnlock) {
      const picks = state.picks + 1;
      if (picks >= way.successes) {
        update.ds = CONST.WALL_DOOR_STATES.CLOSED;
        update[`flags.${MODULE_ID}.${STATE}.picks`] = 0;
        key = "ResultPicked";
      } else {
        update[`flags.${MODULE_ID}.${STATE}.picks`] = picks;
        key = "ResultProgress";
      }
    }
  } else if (success && autoUnlock) {
    update.ds = CONST.WALL_DOOR_STATES.CLOSED;
    key = "ResultUnlocked";
  }

  if (!Object.keys(update).length) return;
  await wall.update(update);
  const picks = stateOf(wall).picks;
  await ChatMessage.create({
    content: `<p class="lucd20-lock-result"><i class="fa-solid fa-lock-open"></i> ${esc(localize(`LUCD20.DoorLocks.${key}`, { name: actorName, done: picks, total: way.successes }))}</p>`,
    speaker: { alias: localize("LUCD20.DoorLocks.Door") }
  });
}

/* -------------------------------------------- */
/*  Wall settings                               */
/* -------------------------------------------- */

function skillOptions(selected) {
  const skills = Object.keys(CONFIG.PF2E?.skills ?? {});
  const all = ["perception", ...skills];
  return all.map(slug => `<option value="${esc(slug)}" ${slug === selected ? "selected" : ""}>${esc(skillLabel(slug))}</option>`).join("");
}

function lockFieldset(wall) {
  const lock = wall?.getFlag?.(MODULE_ID, FLAG) ?? {};
  const base = `flags.${MODULE_ID}.${FLAG}`;
  const way = (type, extra = "") => {
    const data = lock[type] ?? {};
    return `
      <div class="lucd20-lock-row">
        <label class="checkbox"><input type="checkbox" name="${base}.${type}.enabled" ${data.enabled ? "checked" : ""}>
          <i class="fa-solid ${TYPES[type].icon}"></i> ${esc(localize(`LUCD20.DoorLocks.${type === "forceOpen" ? "ForceOpen" : type === "pickALock" ? "PickALock" : "Check"}`))}</label>
        <div class="lucd20-lock-extra">${extra}</div>
        <label class="lucd20-lock-dc">DC <input type="number" name="${base}.${type}.dc" value="${esc(data.dc ?? "")}" min="1" step="1" data-dtype="Number"></label>
      </div>`;
  };
  return `
    <fieldset class="lucd20-lock-config">
      <legend><i class="fa-solid fa-lock"></i> ${esc(localize("LUCD20.DoorLocks.Legend"))}</legend>
      <p class="hint">${esc(localize("LUCD20.DoorLocks.ConfigHint"))}</p>
      <div class="form-group stacked">
        <label>${esc(localize("LUCD20.DoorLocks.Description"))}</label>
        <textarea name="${base}.description" rows="2">${esc(lock.description ?? "")}</textarea>
      </div>
      ${way("forceOpen", `<span class="lucd20-lock-sub">${esc(skillLabel("athletics"))}</span>`)}
      ${way("pickALock", `<span class="lucd20-lock-sub">${esc(skillLabel("thievery"))}</span>
        <label class="lucd20-lock-successes">${esc(localize("LUCD20.DoorLocks.Successes"))} <input type="number" name="${base}.pickALock.successes" value="${esc(lock.pickALock?.successes ?? 1)}" min="1" step="1" data-dtype="Number"></label>`)}
      ${way("check", `<select name="${base}.check.skill">${skillOptions(lock.check?.skill ?? "arcana")}</select>
        <input type="text" name="${base}.check.label" value="${esc(lock.check?.label ?? "")}" placeholder="${esc(localize("LUCD20.DoorLocks.LabelPlaceholder"))}">`)}
    </fieldset>`;
}

function onRenderWallConfig(feature, app, html) {
  if (!game.user.isGM || !feature.get("lockOptions")) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app.element;
  const form = root?.tagName === "FORM" ? root : root?.querySelector("form") ?? root;
  if (!form || form.querySelector(".lucd20-lock-config")) return;
  const wall = app.document ?? app.object;
  const doorField = form.querySelector('[name="door"]');
  const anchor = doorField?.closest("fieldset") ?? doorField?.closest(".form-group");
  const wrapper = document.createElement("div");
  wrapper.innerHTML = lockFieldset(wall);
  const fieldset = wrapper.firstElementChild;
  if (anchor) anchor.after(fieldset);
  else (form.querySelector(".form-footer, footer") ?? form.lastElementChild)?.before(fieldset);
  app.setPosition?.({ height: "auto" });
}

/* -------------------------------------------- */
/*  Adapter                                     */
/* -------------------------------------------- */

registerLockedDoorAdapter({
  system: "pf2e",

  init(feature) {
    onGMRequest("doorLocks.result", payload => {
      if (!feature.active) return null;
      return applyResult(feature, payload);
    });
  },

  enable(feature) {
    feature.on("renderWallConfig", (app, html) => onRenderWallConfig(feature, app, html));
    feature.on("renderChatMessageHTML", (message, html) => {
      if (!message.getFlag?.(MODULE_ID, "lockCard")) return;
      const el = html instanceof HTMLElement ? html : html?.[0];
      const card = el?.querySelector(".lucd20-lock-card");
      if (!card) return;
      drawWays(card);
      card.addEventListener("click", event => {
        const button = event.target.closest(".lucd20-lock-try");
        if (!button) return;
        event.preventDefault();
        onTry(button, event);
      });
    });
    // Unlocked / opened / progress: re-draw the rows of every lock card.
    feature.on("updateWall", () => {
      for (const card of document.querySelectorAll(".lucd20-lock-card")) drawWays(card);
    });
  },

  postCard
});
