import { MODULE_ID, error, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { executeAsGM, onGMRequest } from "../core/socket.js";

/**
 * Loot Pile (replaces Combat Booster's "Body pile").
 *
 * - When combat ends, the active GM gets a review window listing the gear of
 *   every NPC marked as defeated (grouped by NPC: highest level first, then
 *   name; items alphabetical), with checkboxes.
 * - Confirming creates a loot pile actor + token at the centre of the dead
 *   NPCs and moves the checked items into it (each remembers which NPC it came
 *   from). The NPC tokens stay on the map.
 * - Double-clicking the pile opens the Loot window for everyone: items grouped
 *   by NPC with Take (to your character) and Party Stash. The GM also gets
 *   "Open sheet" (the system's own loot sheet) and "Delete pile".
 * - Transfers run on the GM's client (players don't own the pile).
 * - PF2e: native loot actor + the party's inventory as Party Stash
 *   (scripts/systems/pf2e/loot-pile.js). Other systems: the pile and a
 *   "Party Stash" are actors of an existing type, flagged by this module.
 */

const STASH_KEY = "lootPile_stashId";
const FLAG_PILE = "lootPile";
const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const { ApplicationV2, DialogV2 } = foundry.applications.api;

const state = { feature: null };

/* -------------------------------------------- */
/*  System adapters                             */
/* -------------------------------------------- */

const adapters = [];

/**
 * { system, pileType, isLoot(item), isCoins(item), level(actor), stash() → Actor|null,
 *   pileData(base) → actor creation data }
 */
export function registerLootAdapter(adapter) {
  adapters.push(adapter);
}

const GENERIC_LOOT_TYPES = new Set([
  "weapon", "armor", "shield", "equipment", "consumable", "treasure", "backpack", "loot", "tool", "container", "gear", "item"
]);

const genericAdapter = {
  pileType: null,
  isLoot: item => GENERIC_LOOT_TYPES.has(item.type),
  isCoins: () => false,
  level: actor => Number(actor.system?.details?.level?.value ?? actor.system?.details?.level ?? actor.system?.level ?? 0) || 0,
  stash: () => null,
  pileData: base => base
};

function adapter() {
  return { ...genericAdapter, ...(adapters.find(a => a.system === game.system.id) ?? {}) };
}

/** Actor type for piles/stash in systems without a loot type: prefer loot, then npc. */
function containerType() {
  const own = adapter().pileType;
  if (own) return own;
  const types = Object.keys(CONFIG.Actor?.typeLabels ?? {}).length
    ? Object.keys(CONFIG.Actor.typeLabels)
    : game.documentTypes?.Actor ?? [];
  return ["loot", "npc", "character"].find(t => types.includes(t)) ?? types.find(t => t !== "base") ?? "npc";
}

const isPile = actor => !!actor?.getFlag?.(MODULE_ID, FLAG_PILE);

/* -------------------------------------------- */
/*  Collecting loot after combat                */
/* -------------------------------------------- */

function lootGroups(combat) {
  const a = adapter();
  const includeCoins = state.feature.get("includeCoins");
  const groups = [];
  for (const combatant of combat.combatants ?? []) {
    const actor = combatant.actor;
    if (!combatant.isDefeated || !actor || actor.hasPlayerOwner || isPile(actor)) continue;
    const items = actor.items
      .filter(item => a.isLoot(item) && (includeCoins || !a.isCoins(item)))
      .sort((x, y) => x.name.localeCompare(y.name));
    if (!items.length) continue;
    const token = combatant.token;
    groups.push({
      actor,
      token,
      tokenUuid: token?.uuid ?? null,
      name: token?.name ?? actor.name,
      nameHidden: token?.playersCanSeeName === false,
      level: a.level(actor),
      img: token?.texture?.src && !/\.(webm|mp4)$/i.test(token.texture.src) ? token.texture.src : actor.img,
      items
    });
  }
  return groups.sort((x, y) => (y.level - x.level) || x.name.localeCompare(y.name));
}

async function reviewLoot(combat) {
  const groups = lootGroups(combat);
  if (!groups.length) return;

  const selected = await LootReviewWindow.wait(groups);
  if (!Array.isArray(selected) || !selected.length) return;

  const chosen = groups.map((g, gi) => ({ ...g, items: g.items.filter(item => selected.includes(`${gi}:${item.id}`)) }))
    .filter(g => g.items.length);
  try {
    await createPile(chosen, combat.scene ?? canvas.scene);
  } catch (err) {
    error("Could not create the loot pile.", err);
    ui.notifications.error(localize("LUCD20.LootPile.Failed"));
  }
}

async function lootFolder() {
  const name = localize("LUCD20.LootPile.Folder");
  return game.folders.find(f => f.type === "Actor" && f.name === name)
    ?? Folder.create({ name, type: "Actor", color: "#8a6d1f" });
}

async function createPile(groups, scene) {
  const feature = state.feature;
  const folder = await lootFolder();
  const base = {
    name: feature.get("pileName") || localize("LUCD20.LootPile.DefaultName"),
    type: containerType(),
    img: feature.get("image"),
    folder: folder?.id,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: { [MODULE_ID]: { [FLAG_PILE]: true } },
    prototypeToken: { texture: { src: feature.get("image") }, actorLink: true, displayName: CONST.TOKEN_DISPLAY_MODES?.HOVER ?? 30 }
  };
  const pile = await Actor.create(adapter().pileData(base));

  const items = [];
  for (const g of groups) {
    for (const item of g.items) {
      const data = item.toObject();
      delete data._id;
      if (data.system && "containerId" in data.system) data.system.containerId = null;
      // Hidden names are decided here, on the GM's side: the item then carries
      // no name or art, so they never reach a player's client.
      const source = { level: g.level, actorUuid: g.actor.uuid, tokenUuid: g.tokenUuid };
      if (g.nameHidden) source.hidden = true;
      else Object.assign(source, { name: g.name, img: g.img });
      foundry.utils.setProperty(data, `flags.${MODULE_ID}.source`, source);
      items.push(data);
    }
  }
  await pile.createEmbeddedDocuments("Item", items);
  for (const g of groups) await g.actor.deleteEmbeddedDocuments("Item", g.items.map(i => i.id));

  // Centre of the dead NPCs' tokens, snapped to the grid.
  const tokens = groups.map(g => g.token).filter(Boolean);
  const size = scene?.grid?.size ?? canvas.dimensions?.size ?? 100;
  const centre = tokens.length
    ? tokens.reduce((acc, t) => ({ x: acc.x + t.x + (t.width * size) / 2, y: acc.y + t.y + (t.height * size) / 2 }), { x: 0, y: 0 })
    : { x: canvas.dimensions.width / 2, y: canvas.dimensions.height / 2 };
  const cx = centre.x / Math.max(tokens.length, 1);
  const cy = centre.y / Math.max(tokens.length, 1);
  const position = { x: Math.round((cx - size / 2) / size) * size, y: Math.round((cy - size / 2) / size) * size };
  const tokenDoc = await pile.getTokenDocument(position);
  await scene.createEmbeddedDocuments("Token", [tokenDoc.toObject()]);
  ui.notifications.info(localize("LUCD20.LootPile.Created", { count: items.length }));
  return pile;
}

/* -------------------------------------------- */
/*  Transfers (run on the GM's client)          */
/* -------------------------------------------- */

async function stashActor(create = false) {
  const own = adapter().stash();
  if (own) return own;
  const id = game.settings.get(MODULE_ID, STASH_KEY);
  const existing = id ? game.actors.get(id) : null;
  if (existing || !create) return existing ?? null;
  const folder = await lootFolder();
  const stash = await Actor.create({
    name: localize("LUCD20.LootPile.Stash"),
    type: containerType(),
    img: "icons/svg/chest.svg",
    folder: folder?.id,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: { [MODULE_ID]: { partyStash: true } }
  });
  await game.settings.set(MODULE_ID, STASH_KEY, stash.id);
  return stash;
}

async function deletePile(pile) {
  for (const scene of game.scenes) {
    const ids = scene.tokens.filter(t => t.actorId === pile.id).map(t => t.id);
    if (ids.length) await scene.deleteEmbeddedDocuments("Token", ids);
  }
  await pile.delete();
}

/** Send every item in the pile to the Party Stash (one chat line). */
async function stashAll({ pileUuid }, senderId) {
  const sender = game.users.get(senderId) ?? game.user;
  const pile = fromUuidSync(pileUuid);
  if (!isPile(pile)) throw new Error("Not a loot pile.");
  const items = [...pile.items];
  if (!items.length) return true;
  const announce = state.feature?.get("announce");
  for (const item of items) await transfer({ pileUuid, itemId: item.id, target: "stash" }, senderId, { quiet: true });
  if (announce) {
    const stash = await stashActor(true);
    await ChatMessage.create({
      content: `<p class="lucd20-loot-announce"><i class="fa-solid fa-sack-dollar"></i> ${localize("LUCD20.LootPile.AnnounceStashAll", {
        user: esc(sender.name), count: items.length, actor: esc(stash?.name ?? "")
      })}</p>`,
      speaker: { alias: pile.name }
    });
  }
  return true;
}

async function transfer({ pileUuid, itemId, target, quantity }, senderId, { quiet = false } = {}) {
  const sender = game.users.get(senderId) ?? game.user;
  const pile = fromUuidSync(pileUuid);
  if (!isPile(pile)) throw new Error("Not a loot pile.");
  const item = pile.items.get(itemId);
  if (!item) throw new Error("That item is already gone.");

  const destination = target === "stash" ? await stashActor(true) : fromUuidSync(target);
  if (!destination) throw new Error("No destination.");
  if (target !== "stash" && !sender.isGM && !destination.testUserPermission(sender, "OWNER")) {
    throw new Error("You don't own that character.");
  }

  const hasQty = typeof item.system?.quantity === "number";
  const total = hasQty ? item.system.quantity : 1;
  const n = hasQty ? Math.min(Math.max(Number(quantity) || total, 1), total) : 1;
  const data = item.toObject();
  delete data._id;
  if (data.flags?.[MODULE_ID]) delete data.flags[MODULE_ID];
  if (data.system && "containerId" in data.system) data.system.containerId = null;
  if (hasQty) data.system.quantity = n;

  const same = hasQty && destination.items.find(i => i.type === item.type && i.name === item.name && typeof i.system?.quantity === "number");
  if (same) await same.update({ "system.quantity": same.system.quantity + n });
  else await destination.createEmbeddedDocuments("Item", [data]);

  if (hasQty && n < total) await item.update({ "system.quantity": total - n });
  else await item.delete();

  if (state.feature?.get("announce") && !quiet) {
    const key = target === "stash" ? "LUCD20.LootPile.AnnounceStash" : "LUCD20.LootPile.AnnounceTake";
    await ChatMessage.create({
      content: `<p class="lucd20-loot-announce"><i class="fa-solid fa-sack-dollar"></i> ${localize(key, {
        user: esc(sender.name), item: esc(item.name), count: hasQty && n > 1 ? `${n}× ` : "", actor: esc(destination.name)
      })}</p>`,
      speaker: { alias: pile.name }
    });
  }

  if (!pile.items.size && state.feature?.get("deleteWhenEmpty")) await deletePile(pile);
  return true;
}

/* -------------------------------------------- */
/*  Loot windows                                */
/* -------------------------------------------- */
/*
 * Look: docs/PLAN.md "Loot Pile" (ported from the approved mockup on branch
 * mockup/loot-window). Class names lucd20-loot-* / ll-* and the --ll-* tokens
 * in styles/lucd20.css come from that mockup. All three windows carry the
 * token root class "lucd20-loot-app".
 */

const PLACEHOLDER_PORTRAIT = "icons/svg/mystery-man.svg";
const icon = name => `<i class="ll-i fa-solid ${name}" aria-hidden="true"></i>`;
const hasQuantity = item => typeof item.system?.quantity === "number";
const qtyPill = item => (hasQuantity(item) && item.system.quantity !== 1
  ? `<span class="qty" data-tooltip="${esc(localize("LUCD20.LootPile.Quantity", { count: item.system.quantity }))}">×${item.system.quantity}</span>`
  : "");
const unknownName = () => localize("LUCD20.TurnAnnouncer.Unknown");

/** Characters this user can take items for. */
function takers() {
  const notContainer = a => !isPile(a) && !a.getFlag(MODULE_ID, "partyStash") && a.type !== "party" && a.type !== "loot";
  if (game.user.isGM) return game.actors.filter(a => a.hasPlayerOwner && notContainer(a)).sort((a, b) => a.name.localeCompare(b.name));
  const owned = game.actors.filter(a => a.isOwner && notContainer(a));
  const mine = game.user.character;
  return mine ? [mine, ...owned.filter(a => a !== mine)] : owned;
}

function tokenImage(token, actor) {
  const src = token?.texture?.src;
  return src && !/\.(webm|mp4|m4v|ogv)$/i.test(src) ? src : actor?.img ?? PLACEHOLDER_PORTRAIT;
}

/**
 * Name and portrait of the NPC an item came from. Hidden names were decided on
 * the GM's side when the pile was made: the item then stores no name or art at
 * all, so players get "Unknown creature" and a neutral portrait, and only the
 * GM looks the real ones up from the token/actor.
 */
function sourceDisplay(source) {
  const hidden = !!(source.hidden || source.nameHidden);
  if (hidden && !game.user.isGM) return { name: unknownName(), img: PLACEHOLDER_PORTRAIT, unknown: true };
  if (hidden) {
    const token = source.tokenUuid ? fromUuidSync(source.tokenUuid) : null;
    const actor = source.actorUuid ? fromUuidSync(source.actorUuid) : null;
    return { name: source.name ?? token?.name ?? actor?.name ?? unknownName(), img: source.img ?? tokenImage(token, actor) };
  }
  return { name: source.name ?? unknownName(), img: source.img ?? PLACEHOLDER_PORTRAIT };
}

function portraitHTML(img, extra = "") {
  return `<span class="lucd20-loot-portrait ${extra}"><img src="${esc(img)}" alt=""></span>`;
}

function itemIconHTML(item, extra = "") {
  return `<span class="lucd20-loot-icon ${extra}"><img src="${esc(item.img)}" alt=""></span>`;
}

function groupHeaderHTML({ name, img, level }, before = "", after = "") {
  return `<header class="lucd20-loot-group-header">
      ${before}${portraitHTML(img)}
      <span class="who"><span class="npc">${esc(name)}</span><span class="level">${localize("LUCD20.LootPile.Level", { level })}</span></span>
      ${after}
    </header>`;
}

/* --- Loot Pile window ------------------------------------------------ */

class LootPileWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["lucd20-loot-app", "lucd20-loot-window"],
    window: { icon: "fa-solid fa-sack-dollar", resizable: true },
    position: { width: 420, height: 560 },
    actions: {
      take: LootPileWindow.#onTake,
      stash: LootPileWindow.#onStash,
      openSheet: LootPileWindow.#onOpenSheet,
      deletePile: LootPileWindow.#onDelete,
      stashAll: LootPileWindow.#onStashAll
    }
  };

  static open(pile) {
    const id = `lucd20-loot-${pile.id}`;
    const existing = foundry.applications.instances?.get(id);
    return (existing ?? new this({ id, pileUuid: pile.uuid })).render({ force: true });
  }

  constructor(options) {
    super(options);
    this.pile = fromUuidSync(options.pileUuid);
    this.taker = takers()[0]?.uuid ?? null;
  }

  get title() {
    return this.pile?.name ?? localize("LUCD20.LootPile.DefaultName");
  }

  #takerHTML(options) {
    const label = localize("LUCD20.LootPile.TakingFor");
    if (!options.length) {
      return `<p class="lucd20-loot-taker lucd20-loot-hint">${icon("fa-circle-info")}<span>${localize("LUCD20.LootPile.NoCharacter")}</span></p>`;
    }
    // One character (players): a static chip. Several, or the GM: a dropdown.
    if (options.length === 1 && !game.user.isGM) {
      const actor = options[0];
      return `<div class="lucd20-loot-taker">
          <span class="label">${label}</span>
          <span class="lucd20-loot-taker-chip">${portraitHTML(tokenImage(actor.prototypeToken, actor), "small")}<strong>${esc(actor.name)}</strong></span>
        </div>`;
    }
    return `<div class="lucd20-loot-taker">
        <label for="${this.id}-taker">${label}</label>
        <select id="${this.id}-taker" data-taker>${options.map(a =>
          `<option value="${esc(a.uuid)}" ${a.uuid === this.taker ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>
      </div>`;
  }

  async _renderHTML() {
    const pile = this.pile;
    const gm = game.user.isGM;
    const groups = new Map();
    for (const item of pile.items) {
      const source = item.getFlag(MODULE_ID, "source") ?? { level: 0 };
      const key = source.actorUuid ?? `${source.level}|${source.name}`;
      if (!groups.has(key)) groups.set(key, { ...sourceDisplay(source), level: source.level ?? 0, items: [] });
      groups.get(key).items.push(item);
    }
    const sorted = [...groups.values()].sort((a, b) => (b.level - a.level) || a.name.localeCompare(b.name));
    const options = takers();
    if (!options.some(a => a.uuid === this.taker)) this.taker = options[0]?.uuid ?? null;

    const stashLabel = localize("LUCD20.LootPile.StashHint");
    const takeDisabled = this.taker ? "" : `disabled data-tooltip="${esc(localize("LUCD20.LootPile.TakeDisabled"))}"`;
    const row = item => `
      <li class="lucd20-loot-item" data-item-id="${item.id}">
        ${itemIconHTML(item)}
        <span class="name">${esc(item.name)}</span>
        ${qtyPill(item)}
        <span class="actions">
          <button type="button" class="ll-btn ll-btn-take" data-action="take" ${takeDisabled || `data-tooltip="${esc(localize("LUCD20.LootPile.TakeHint"))}"`}>
            ${icon("fa-download")}<span>${localize("LUCD20.LootPile.Take")}</span></button>
          <button type="button" class="ll-btn" data-action="stash" aria-label="${esc(stashLabel)}" data-tooltip="${esc(stashLabel)}">
            ${icon("fa-box-archive")}<span><span class="ll-wide">${localize("LUCD20.LootPile.StashPrefix")}</span>${localize("LUCD20.LootPile.StashShort")}</span></button>
        </span>
      </li>`;

    const list = sorted.length
      ? sorted.map(g => `
        <section class="lucd20-loot-group">
          ${groupHeaderHTML(g)}
          <ol>${g.items.sort((a, b) => a.name.localeCompare(b.name)).map(row).join("")}</ol>
        </section>`).join("")
      : `<div class="lucd20-loot-empty">
          <i class="ll-empty-art fa-solid fa-sack-dollar" aria-hidden="true"></i>
          <p class="title">${localize("LUCD20.LootPile.Empty")}</p>
          <p class="sub">${localize("LUCD20.LootPile.EmptySub")}</p>
        </div>`;

    const footer = `
      <footer class="lucd20-loot-footer ${gm ? "is-gm" : ""}">
        <button type="button" class="ll-btn ll-btn-footer ll-btn-all" data-action="stashAll" ${sorted.length ? "" : "disabled"}>
          ${icon("fa-box-archive")}<span>${localize("LUCD20.LootPile.StashAll")}</span></button>
        ${gm ? `
        <button type="button" class="ll-btn ll-btn-footer" data-action="openSheet">${icon("fa-arrow-up-right-from-square")}<span>${localize("LUCD20.LootPile.OpenSheet")}</span></button>
        <button type="button" class="ll-btn ll-btn-footer ll-btn-danger" data-action="deletePile">${icon("fa-trash")}<span>${localize("LUCD20.LootPile.Delete")}</span></button>` : ""}
      </footer>`;

    return `<div class="lucd20-loot-body">${this.#takerHTML(options)}<div class="lucd20-loot-list">${list}</div>${footer}</div>`;
  }

  _replaceHTML(result, content) {
    const top = content.querySelector(".lucd20-loot-list")?.scrollTop ?? 0;
    content.innerHTML = result;
    const list = content.querySelector(".lucd20-loot-list");
    if (list) list.scrollTop = top;
    content.querySelector("[data-taker]")?.addEventListener("change", event => {
      this.taker = event.target.value;
    });
  }

  async #move(target, button) {
    const itemId = button.closest("[data-item-id]")?.dataset.itemId;
    const item = this.pile.items.get(itemId);
    if (!item) return;
    let quantity = item.system?.quantity;
    if (typeof quantity === "number" && quantity > 1) {
      const taker = target === "stash" ? null : fromUuidSync(target);
      quantity = await LootQuantityWindow.wait(item, target === "stash" ? null : taker?.name);
      if (!quantity) return;
    }
    button.disabled = true;
    try {
      await executeAsGM("lootPile.transfer", { pileUuid: this.pile.uuid, itemId, target, quantity });
    } catch (err) {
      ui.notifications.warn(err.message ?? String(err));
      button.disabled = false;
    }
  }

  static #onTake(event, button) {
    if (this.taker) return this.#move(this.taker, button);
  }

  static #onStash(event, button) {
    return this.#move("stash", button);
  }

  static async #onStashAll(event, button) {
    const confirmed = await DialogV2.confirm({
      window: { title: localize("LUCD20.LootPile.StashAll") },
      content: `<p>${localize("LUCD20.LootPile.StashAllContent", { count: this.pile.items.size })}</p>`
    });
    if (!confirmed) return;
    button.disabled = true;
    try {
      await executeAsGM("lootPile.stashAll", { pileUuid: this.pile.uuid });
    } catch (err) {
      ui.notifications.warn(err.message ?? String(err));
      button.disabled = false;
    }
  }

  static #onOpenSheet() {
    this.pile.sheet?.render(true);
  }

  static async #onDelete() {
    const confirmed = await DialogV2.confirm({
      window: { title: localize("LUCD20.LootPile.Delete") },
      content: `<p>${localize("LUCD20.LootPile.DeleteContent", { name: esc(this.pile.name) })}</p>`
    });
    if (!confirmed) return;
    await deletePile(this.pile);
    this.close();
  }
}

/* --- Small window that answers with a value --------------------------- */

/**
 * An ApplicationV2 that resolves wait() with a value when it is answered or closed.
 * Documents are handed over with setup() after construction, not through the
 * options (Foundry copies window options).
 */
class AnswerWindow extends ApplicationV2 {
  static wait(data) {
    return new Promise(resolve => {
      const app = new this();
      app.setup(data);
      app._resolve = resolve;
      app.render({ force: true });
    });
  }

  setup() {}

  answer(value) {
    if (this._answered) return;
    this._answered = true;
    const resolve = this._resolve;
    this._resolve = null;
    resolve?.(value);
    this.close();
  }

  async _onClose(options) {
    await super._onClose?.(options);
    const resolve = this._resolve;
    this._resolve = null;
    resolve?.(null);
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }
}

/* --- "How many?" ------------------------------------------------------ */

class LootQuantityWindow extends AnswerWindow {
  static DEFAULT_OPTIONS = {
    classes: ["lucd20-loot-app", "lucd20-loot-qty-dialog"],
    window: { title: "LUCD20.LootPile.HowMany", icon: "fa-solid fa-download" },
    position: { width: 300, height: "auto" },
    actions: {
      step: LootQuantityWindow.#onStep,
      confirm: LootQuantityWindow.#onConfirm,
      cancel: LootQuantityWindow.#onCancel
    }
  };

  /** Resolves with the chosen number (defaults to the whole stack), or null. */
  static wait(item, takerName) {
    return super.wait({ item, takerName });
  }

  setup({ item, takerName }) {
    this.item = item;
    this.takerName = takerName;
    this.max = Number(item.system.quantity) || 1;
    this.value = this.max;
  }

  async _renderHTML() {
    const item = this.item;
    const sub = [localize("LUCD20.LootPile.InPile", { count: this.max })];
    if (this.takerName) sub.push(localize("LUCD20.LootPile.TakingForName", { name: esc(this.takerName) }));
    return `
      <form class="lucd20-loot-qty" autocomplete="off">
        <div class="what">
          ${itemIconHTML(item, "large")}
          <span><strong>${esc(item.name)}</strong><span class="sub">${sub.join(" · ")}</span></span>
        </div>
        <div class="field">
          <label for="${this.id}-qty">${localize("LUCD20.LootPile.HowMany")}</label>
          <span class="stepper">
            <button type="button" class="ll-btn ll-btn-square" data-action="step" data-step="-1" aria-label="${esc(localize("LUCD20.LootPile.OneFewer"))}">${icon("fa-minus")}</button>
            <input id="${this.id}-qty" type="number" name="quantity" min="1" max="${this.max}" step="1" value="${this.value}" inputmode="numeric">
            <button type="button" class="ll-btn ll-btn-square" data-action="step" data-step="1" aria-label="${esc(localize("LUCD20.LootPile.OneMore"))}">${icon("fa-plus")}</button>
          </span>
          <span class="range">${localize("LUCD20.LootPile.OfMax", { max: this.max })}</span>
        </div>
        <footer class="lucd20-loot-footer is-dialog">
          <button type="submit" class="ll-btn ll-btn-footer ll-btn-primary" data-action="confirm">${icon("fa-download")}<span data-take-label></span></button>
          <button type="button" class="ll-btn ll-btn-footer" data-action="cancel">${icon("fa-xmark")}<span>${localize("LUCD20.LootPile.Cancel")}</span></button>
        </footer>
      </form>`;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const form = this.element.querySelector(".lucd20-loot-qty");
    const input = form.querySelector("input[name=quantity]");
    input.addEventListener("change", () => this.#sync(input.value));
    input.addEventListener("input", () => this.#sync(input.value, false));
    form.addEventListener("submit", event => {
      event.preventDefault();
      this.answer(this.#sync(input.value));
    });
    this.#sync(this.value);
    input.focus();
    input.select();
  }

  #sync(raw, writeBack = true) {
    const value = Math.min(this.max, Math.max(1, Math.round(Number(raw) || 1)));
    this.value = value;
    const form = this.element.querySelector(".lucd20-loot-qty");
    if (writeBack) form.querySelector("input[name=quantity]").value = value;
    form.querySelector("[data-take-label]").textContent = localize("LUCD20.LootPile.TakeN", { count: value });
    form.querySelector('[data-step="-1"]').disabled = value <= 1;
    form.querySelector('[data-step="1"]').disabled = value >= this.max;
    return value;
  }

  static #onStep(event, button) {
    const input = this.element.querySelector("input[name=quantity]");
    this.#sync(Number(input.value) + Number(button.dataset.step));
  }

  static #onConfirm(event) {
    event?.preventDefault?.();
    this.answer(this.#sync(this.element.querySelector("input[name=quantity]").value));
  }

  static #onCancel() {
    this.answer(null);
  }
}

/* --- "Loot the fallen" -------------------------------------------------- */

class LootReviewWindow extends AnswerWindow {
  static DEFAULT_OPTIONS = {
    classes: ["lucd20-loot-app", "lucd20-loot-review-dialog"],
    window: { title: "LUCD20.LootPile.ReviewTitle", icon: "fa-solid fa-skull", resizable: true },
    position: { width: 420, height: 560 },
    actions: {
      create: LootReviewWindow.#onCreate,
      skip: LootReviewWindow.#onSkip
    }
  };

  /** Resolves with the checked keys ("groupIndex:itemId"), or null when skipped/closed. */
  static wait(groups) {
    return super.wait({ groups });
  }

  setup({ groups }) {
    this.groups = groups;
  }

  async _renderHTML() {
    const groups = this.groups.map((g, gi) => {
      const toggle = `<input type="checkbox" class="ll-check" data-group-toggle checked
        aria-label="${esc(localize("LUCD20.LootPile.SelectAllFrom", { name: g.name }))}" data-tooltip="${esc(localize("LUCD20.LootPile.SelectAll"))}">`;
      const items = g.items.map(item => `
        <li><label class="lucd20-loot-check">
          <input type="checkbox" class="ll-check" data-item name="${gi}:${item.id}" checked>
          ${itemIconHTML(item)}
          <span class="name">${esc(item.name)}</span>
          ${qtyPill(item)}
        </label></li>`).join("");
      return `<section class="lucd20-loot-group" data-group>
          ${groupHeaderHTML(g, toggle, `<span class="count" data-group-count></span>`)}
          <ol>${items}</ol>
        </section>`;
    }).join("");
    return `
      <div class="lucd20-loot-body lucd20-loot-review">
        <p class="lucd20-loot-taker lucd20-loot-hint">${icon("fa-circle-info")}<span>${localize("LUCD20.LootPile.ReviewHint")}</span></p>
        <div class="lucd20-loot-list">${groups}</div>
        <footer class="lucd20-loot-footer is-review">
          <span class="summary" data-summary aria-live="polite"></span>
          <button type="button" class="ll-btn ll-btn-footer ll-btn-primary" data-action="create">${icon("fa-sack-dollar")}<span>${localize("LUCD20.LootPile.Create")}</span></button>
          <button type="button" class="ll-btn ll-btn-footer" data-action="skip">${icon("fa-xmark")}<span>${localize("LUCD20.LootPile.Skip")}</span></button>
        </footer>
      </div>`;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element.querySelector(".lucd20-loot-review");
    root.addEventListener("change", event => {
      if (event.target.matches("[data-group-toggle]")) {
        const group = event.target.closest("[data-group]");
        for (const item of group.querySelectorAll("[data-item]")) item.checked = event.target.checked;
      }
      this.#sync();
    });
    this.#sync();
  }

  #sync() {
    const root = this.element.querySelector(".lucd20-loot-review");
    let total = 0;
    let picked = 0;
    for (const group of root.querySelectorAll("[data-group]")) {
      const items = [...group.querySelectorAll("[data-item]")];
      const on = items.filter(i => i.checked).length;
      const toggle = group.querySelector("[data-group-toggle]");
      toggle.checked = on === items.length;
      toggle.indeterminate = on > 0 && on < items.length;
      group.querySelector("[data-group-count]").textContent = localize("LUCD20.LootPile.GroupCount", { count: on, total: items.length });
      total += items.length;
      picked += on;
    }
    root.querySelector("[data-summary]").textContent = localize("LUCD20.LootPile.Selected", { count: picked, total });
    root.querySelector('[data-action="create"]').disabled = picked === 0;
  }

  static #onCreate() {
    const keys = [...this.element.querySelectorAll("[data-item]")].filter(i => i.checked).map(i => i.name);
    this.answer(keys.length ? keys : null);
  }

  static #onSkip() {
    this.answer(null);
  }
}

function refreshWindows(document) {
  const actor = document?.documentName === "Actor" ? document : document?.parent;
  if (!isPile(actor)) return;
  const app = foundry.applications.instances?.get(`lucd20-loot-${actor.id}`);
  if (app?.rendered) app.render();
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

defineFeature({
  id: "lootPile",
  category: "combat",
  scope: "world",
  defaultEnabled: false,
  settings: {
    pileName: { kind: "string", default: "" },
    image: { kind: "file", fileType: "image", default: "icons/svg/chest.svg" },
    includeCoins: { kind: "boolean", default: true },
    deleteWhenEmpty: { kind: "boolean", default: true },
    announce: { kind: "boolean", default: true }
  },

  init(feature) {
    game.settings.register(MODULE_ID, STASH_KEY, { scope: "world", config: false, type: String, default: "" });
    onGMRequest("lootPile.transfer", (payload, senderId) => {
      if (!feature.active) throw new Error(localize("LUCD20.LootPile.Disabled"));
      return transfer(payload, senderId);
    });
    onGMRequest("lootPile.stashAll", (payload, senderId) => {
      if (!feature.active) throw new Error(localize("LUCD20.LootPile.Disabled"));
      return stashAll(payload, senderId);
    });
  },

  enable(feature) {
    state.feature = feature;

    feature.on("deleteCombat", combat => {
      if (game.user.isActiveGM) reviewLoot(combat);
    });

    // Double-click a pile token → Loot window (instead of the actor sheet).
    feature.wrap(CONFIG.Token.objectClass.prototype, "_onClickLeft2", function (original, event) {
      if (isPile(this.actor)) return LootPileWindow.open(this.actor);
      return original(event);
    });

    for (const hook of ["createItem", "updateItem", "deleteItem", "updateActor"]) feature.on(hook, refreshWindows);
    feature.on("deleteActor", actor => foundry.applications.instances?.get(`lucd20-loot-${actor.id}`)?.close());

    feature.onCleanup(() => {
      for (const app of foundry.applications.instances?.values() ?? []) {
        if (app instanceof LootPileWindow) app.close();
      }
      state.feature = null;
    });
  }
});

export { LootPileWindow, reviewLoot };
