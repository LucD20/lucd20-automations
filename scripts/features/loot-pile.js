import { MODULE_ID, error, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { findFreeSpot, snapTopLeft } from "../core/placement.js";
import { executeAsGM, onGMRequest } from "../core/socket.js";
import { AnswerWindow } from "../core/answer-window.js";
import { addPurses, cleanPurse, emptyPurse, isEmptyPurse, purseFromValue, purseValue, splitAsIs, splitByValue } from "../core/coins.js";

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
 *   by NPC. Players do not take items: they Claim one for their character or
 *   ask for it to go to the Party Stash, and everyone sees who asked (claimer
 *   tokens and a stash count on the row). The GM confirms: one claim goes to
 *   that character whatever the stash count; two or more claims for more than
 *   there is open "Who gets it?" for the GM and the claimers.
 * - Coins are one row at the top (systems whose adapter knows coins). Only the
 *   GM hands them out: "Split evenly" (as they are, or by value) and "Custom
 *   split"; what is left goes to the Party Stash.
 * - Requests live on the pile (flag `claims`), written by the GM's client;
 *   every transfer runs there too (players don't own the pile).
 * - PF2e: native loot actor + the party's inventory as Party Stash
 *   (scripts/systems/pf2e/loot-pile.js). Other systems: the pile and a
 *   "Party Stash" are actors of an existing type, flagged by this module.
 */

const STASH_KEY = "lootPile_stashId";
const FLAG_PILE = "lootPile";
const FLAG_CLAIMS = "claims";
const FLAG_DECIDING = "deciding";
const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const { ApplicationV2, DialogV2 } = foundry.applications.api;

const state = { feature: null };

/* -------------------------------------------- */
/*  System adapters                             */
/* -------------------------------------------- */

const adapters = [];

/**
 * { system, pileType, isLoot(item), isCoins(item), level(actor), stash() → Actor|null,
 *   pileData(base) → actor creation data,
 *   coins (optional): denominations [{ id, value }] highest first, coinsOf(actor) → purse,
 *   addCoins(actor, purse), removeCoins(actor, purse), characters() → Actor[] a split is between }
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
  pileData: base => base,
  denominations: null,
  characters: null
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

  // Centre of the dead NPCs' tokens, then the nearest free square: never under
  // or on top of another token (the hidden bodies included).
  const tokens = groups.map(g => g.token).filter(Boolean);
  const size = scene?.grid?.size ?? canvas.dimensions?.size ?? 100;
  const centre = tokens.length
    ? tokens.reduce((acc, t) => ({ x: acc.x + t.x + (t.width * size) / 2, y: acc.y + t.y + (t.height * size) / 2 }), { x: 0, y: 0 })
    : { x: canvas.dimensions.width / 2, y: canvas.dimensions.height / 2 };
  const cx = centre.x / Math.max(tokens.length, 1);
  const cy = centre.y / Math.max(tokens.length, 1);
  const proto = pile.prototypeToken;
  const w = (proto?.width ?? 1) * size;
  const h = (proto?.height ?? 1) * size;
  const position = findFreeSpot({ x: cx, y: cy }, w, h, { scene }) ?? snapTopLeft({ x: cx, y: cy }, w, h, scene);
  const tokenDoc = await pile.getTokenDocument(position);
  // Visible even when the dead NPCs' tokens are hidden (Defeat at 0 HP).
  await scene.createEmbeddedDocuments("Token", [{ ...tokenDoc.toObject(), hidden: false }]);
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

/** Send every item in the pile to the Party Stash (one chat line). GM only. */
async function stashAll({ pileUuid }, senderId) {
  const sender = game.users.get(senderId) ?? game.user;
  const pile = fromUuidSync(pileUuid);
  if (!isPile(pile)) throw new Error("Not a loot pile.");
  const items = lootItems(pile);
  if (!items.length) return true;
  const announce = state.feature?.get("announce");
  await saveClaims(pile, [], null);
  for (const item of items) await transfer({ pileUuid, itemId: item.id, target: "stash" }, { quiet: true });
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

/** Move an item (or part of a stack) from the pile to a character or the Party Stash. */
async function transfer({ pileUuid, itemId, target, quantity }, { quiet = false } = {}) {
  const pile = fromUuidSync(pileUuid);
  if (!isPile(pile)) throw new Error("Not a loot pile.");
  const item = pile.items.get(itemId);
  if (!item) throw new Error("That item is already gone.");

  const destination = target === "stash" ? await stashActor(true) : fromUuidSync(target);
  if (!destination) throw new Error("No destination.");

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
        item: esc(item.name), count: hasQty && n > 1 ? `${n}× ` : "", actor: esc(destination.name)
      })}</p>`,
      speaker: { alias: pile.name }
    });
  }

  await removeIfEmpty(pile);
  return true;
}

async function removeIfEmpty(pile) {
  if (!pile.items.size && state.feature?.get("deleteWhenEmpty") && game.actors.get(pile.id)) await deletePile(pile);
}

/* -------------------------------------------- */
/*  Claims (kept on the pile, written by the GM) */
/* -------------------------------------------- */
/*
 * flags.claims: [{ itemId, userId, kind: "claim" | "stash", actorUuid, quantity }], at most one per
 * user and item. An array on purpose: an update replaces it whole.
 * flags.deciding: the id of the item "Who gets it?" is open for, or null.
 */

const stackSize = item => (typeof item?.system?.quantity === "number" ? item.system.quantity : 1);
const claimsOf = pile => pile?.getFlag(MODULE_ID, FLAG_CLAIMS) ?? [];
/** The pile's items that are shown as rows: coins are their own row where the system knows coins. */
function lootItems(pile) {
  const a = adapter();
  return [...pile.items].filter(item => !(a.denominations && a.isCoins(item)));
}

async function saveClaims(pile, claims, deciding) {
  const alive = new Set(pile.items.map(i => i.id));
  const update = { [`flags.${MODULE_ID}.${FLAG_CLAIMS}`]: claims.filter(c => alive.has(c.itemId)) };
  if (deciding !== undefined) update[`flags.${MODULE_ID}.${FLAG_DECIDING}`] = deciding;
  await pile.update(update);
}

/**
 * What is asked of one item.
 * state: "none" | "claimed" (goes to the claimers) | "contested" (more asked than there is) | "stash".
 */
function requestsFor(item, claims) {
  const mine = claims.filter(c => c.itemId === item.id);
  const claimers = mine.filter(c => c.kind === "claim");
  const stashers = mine.filter(c => c.kind === "stash");
  const asked = claimers.reduce((sum, c) => sum + Math.min(Number(c.quantity) || stackSize(item), stackSize(item)), 0);
  const state = claimers.length > 1 && asked > stackSize(item) ? "contested" : claimers.length ? "claimed" : stashers.length ? "stash" : "none";
  return { claimers, stashers, state };
}

/** A player (or the GM) asks for an item, changes the request, or takes it back (kind null). */
async function request({ pileUuid, itemId, kind, actorUuid, quantity }, senderId) {
  const sender = game.users.get(senderId) ?? game.user;
  const pile = fromUuidSync(pileUuid);
  if (!isPile(pile)) throw new Error("Not a loot pile.");
  const item = pile.items.get(itemId);
  if (!item) throw new Error("That item is already gone.");
  const claims = claimsOf(pile).filter(c => !(c.itemId === itemId && c.userId === sender.id));
  if (kind === "claim") {
    const actor = fromUuidSync(actorUuid);
    if (!actor) throw new Error("No character.");
    if (!sender.isGM && !actor.testUserPermission(sender, "OWNER")) throw new Error("You don't own that character.");
    claims.push({ itemId, userId: sender.id, kind, actorUuid, quantity: Math.min(Math.max(Number(quantity) || stackSize(item), 1), stackSize(item)) });
  } else if (kind === "stash") claims.push({ itemId, userId: sender.id, kind, actorUuid: null, quantity: stackSize(item) });
  await saveClaims(pile, claims);
  return true;
}

/** A player's "Send all to Party Stash": a stash request on every item they have not asked for. */
async function requestAll({ pileUuid }, senderId) {
  const sender = game.users.get(senderId) ?? game.user;
  const pile = fromUuidSync(pileUuid);
  if (!isPile(pile)) throw new Error("Not a loot pile.");
  const claims = claimsOf(pile).slice();
  for (const item of lootItems(pile)) {
    if (claims.some(c => c.itemId === item.id && c.userId === sender.id)) continue;
    claims.push({ itemId: item.id, userId: sender.id, kind: "stash", actorUuid: null, quantity: stackSize(item) });
  }
  await saveClaims(pile, claims);
  return true;
}

/** GM: do what a row asks. One claim (or claims that fit the stack) go to the claimers; else the stash. */
async function approve(pile, itemId) {
  const item = pile.items.get(itemId);
  if (!item) return false;
  const { claimers, state: status } = requestsFor(item, claimsOf(pile));
  if (status === "none" || status === "contested") return false;
  const deciding = pile.getFlag(MODULE_ID, FLAG_DECIDING) === itemId ? null : undefined;
  await saveClaims(pile, claimsOf(pile).filter(c => c.itemId !== itemId), deciding);
  if (status === "stash") await transfer({ pileUuid: pile.uuid, itemId, target: "stash" });
  else for (const c of claimers) await transfer({ pileUuid: pile.uuid, itemId, target: c.actorUuid, quantity: c.quantity });
  return true;
}

async function approveAll(pile) {
  for (const item of lootItems(pile)) {
    if (!game.actors.get(pile.id)) break;
    await approve(pile, item.id);
  }
}

/** GM: give an item directly (also the answer of "Who gets it?"). Clears what was asked of it. */
async function give(pile, itemId, target, quantity) {
  const deciding = pile.getFlag(MODULE_ID, FLAG_DECIDING) === itemId ? null : undefined;
  await saveClaims(pile, claimsOf(pile).filter(c => c.itemId !== itemId), deciding);
  await transfer({ pileUuid: pile.uuid, itemId, target, quantity });
}

async function refuse(pile, itemId) {
  const deciding = pile.getFlag(MODULE_ID, FLAG_DECIDING) === itemId ? null : undefined;
  await saveClaims(pile, claimsOf(pile).filter(c => c.itemId !== itemId), deciding);
}

/* -------------------------------------------- */
/*  Coins                                       */
/* -------------------------------------------- */

const denominations = () => adapter().denominations ?? [];
/** The highest coin a conversion may use (setting): "top" = the system's highest. */
function highestCoin() {
  const wanted = state.feature?.get("highestCoin");
  return denominations().some(d => d.id === wanted) ? wanted : denominations()[0]?.id ?? null;
}
const pileCoins = pile => (adapter().denominations ? cleanPurse(adapter().coinsOf(pile), denominations()) : null);
const purseText = purse => denominations().filter(d => purse[d.id] > 0).map(d => `${purse[d.id]} ${d.id}`).join(" ") || "0";

/** The characters a split is between: the system's party, else every player-owned character. */
function splitCharacters() {
  const own = adapter().characters?.();
  if (own?.length) return own;
  return game.actors.filter(a => a.hasPlayerOwner && isCharacter(a)).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * GM: hand out the pile's coins. shares: [{ actor, purse }]; rest goes to the Party Stash.
 * Shares plus rest must be worth exactly what the pile holds.
 */
async function splitCoins(pile, shares, rest, { even = false } = {}) {
  const a = adapter();
  const denoms = denominations();
  const total = pileCoins(pile);
  const out = shares.reduce((sum, s) => sum + purseValue(s.purse, denoms), purseValue(rest, denoms));
  if (out !== purseValue(total, denoms)) throw new Error("The coins do not add up.");
  await a.removeCoins(pile, total);
  for (const s of shares) if (!isEmptyPurse(s.purse)) await a.addCoins(s.actor, s.purse);
  if (!isEmptyPurse(rest)) await a.addCoins(await stashActor(true), rest);

  if (state.feature?.get("announce")) {
    const given = shares.filter(s => !isEmptyPurse(s.purse));
    const names = given.map(s => esc(s.actor.name));
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} ${localize("LUCD20.LootPile.And")} ${names.at(-1)}` : names[0] ?? "";
    let text = even && given.length
      ? localize(given.length > 1 ? "LUCD20.LootPile.AnnounceSplitEven" : "LUCD20.LootPile.AnnounceSplitOne", { names: list, coins: purseText(given[0].purse) })
      : given.length ? localize("LUCD20.LootPile.AnnounceSplitCustom", { list: given.map(s => `${esc(s.actor.name)} ${purseText(s.purse)}`).join("; ") }) : "";
    if (!isEmptyPurse(rest)) text += ` ${localize("LUCD20.LootPile.AnnounceSplitRest", { coins: purseText(rest) })}`;
    if (text.trim()) {
      await ChatMessage.create({ content: `<p class="lucd20-loot-announce"><i class="fa-solid fa-coins"></i> ${text.trim()}</p>`, speaker: { alias: pile.name } });
    }
  }
  await removeIfEmpty(pile);
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

const isCharacter = a => !isPile(a) && !a.getFlag(MODULE_ID, "partyStash") && a.type !== "party" && a.type !== "loot";

/** Characters this user can claim for (the GM: every player's character, to give to). */
function takers() {
  if (game.user.isGM) return game.actors.filter(a => a.hasPlayerOwner && isCharacter(a)).sort((a, b) => a.name.localeCompare(b.name));
  const owned = game.actors.filter(a => a.isOwner && isCharacter(a));
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

function portraitHTML(img, extra = "", tooltip = "") {
  return `<span class="lucd20-loot-portrait ${extra}" ${tooltip ? `data-tooltip="${esc(tooltip)}" aria-label="${esc(tooltip)}"` : ""}><img src="${esc(img)}" alt=""></span>`;
}

const actorPortrait = (actor, extra = "small", tooltip = actor?.name ?? "") => portraitHTML(tokenImage(actor?.prototypeToken, actor), extra, tooltip);

function coinChipsHTML(purse, { zeros = false } = {}) {
  const chips = denominations().filter(d => zeros || purse[d.id] > 0)
    .map(d => `<span class="ll-coin ll-coin-${d.id}"><b>${purse[d.id]}</b> ${esc(d.id)}</span>`).join("");
  return `<span class="ll-coin-list">${chips || `<span class="ll-coin"><b>0</b></span>`}</span>`;
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
    position: { width: 640, height: 560 },
    actions: {
      claim: LootPileWindow.#onClaim,
      stash: LootPileWindow.#onStash,
      give: LootPileWindow.#onGive,
      approve: LootPileWindow.#onApprove,
      refuse: LootPileWindow.#onRefuse,
      decide: LootPileWindow.#onDecide,
      approveAll: LootPileWindow.#onApproveAll,
      splitEven: LootPileWindow.#onSplitEven,
      splitCustom: LootPileWindow.#onSplitCustom,
      openSheet: LootPileWindow.#onOpenSheet,
      deletePile: LootPileWindow.#onDelete,
      stashAll: LootPileWindow.#onStashAll
    }
  };

  static open(pile) {
    const id = `lucd20-loot-${pile.id}`;
    const existing = foundry.applications.instances?.get(id);
    syncDeciding(pile);
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

  /** Players only: the character they claim for. */
  #takerHTML(options) {
    const label = localize("LUCD20.LootPile.ClaimingFor");
    if (!options.length) {
      return `<p class="lucd20-loot-taker lucd20-loot-hint">${icon("fa-circle-info")}<span>${localize("LUCD20.LootPile.NoCharacter")}</span></p>`;
    }
    if (options.length === 1) {
      return `<div class="lucd20-loot-taker">
          <span class="label">${label}</span>
          <span class="lucd20-loot-taker-chip">${actorPortrait(options[0], "small", "")}<strong>${esc(options[0].name)}</strong></span>
        </div>`;
    }
    return `<div class="lucd20-loot-taker">
        <label for="${this.id}-taker">${label}</label>
        <select id="${this.id}-taker" data-taker>${options.map(a =>
          `<option value="${esc(a.uuid)}" ${a.uuid === this.taker ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>
      </div>`;
  }

  #coinsHTML(gm) {
    const purse = pileCoins(this.pile);
    if (!purse || isEmptyPurse(purse)) return "";
    const actions = gm
      ? `<span class="ll-coin-actions">
          <button type="button" class="ll-btn ll-btn-take" data-action="splitEven">${icon("fa-scale-balanced")}<span>${localize("LUCD20.LootPile.SplitEven")}</span></button>
          <button type="button" class="ll-btn" data-action="splitCustom">${icon("fa-sliders")}<span>${localize("LUCD20.LootPile.SplitCustom")}</span></button>
        </span>`
      : `<span class="ll-coins-note">${localize("LUCD20.LootPile.CoinsNote")}</span>`;
    return `<div class="lucd20-loot-coins"><span class="ll-coins-title">${icon("fa-coins")}${localize("LUCD20.LootPile.Coins")}</span>${coinChipsHTML(purse)}${actions}</div>`;
  }

  /** Who asked for this item: claimer tokens, then a stash icon with a count. Hover gives the names. */
  #requestsHTML({ claimers, stashers }) {
    const tokens = claimers.map(c => {
      const actor = fromUuidSync(c.actorUuid);
      const many = Number(c.quantity) > 1 ? ` ×${c.quantity}` : "";
      return actorPortrait(actor, `small ${c.userId === game.user.id ? "is-me" : ""}`, `${actor?.name ?? unknownName()}${many}`);
    }).join("");
    const names = stashers.map(c => game.users.get(c.userId)?.name ?? "?").join(", ");
    const stash = stashers.length
      ? `<span class="ll-stash-count" data-tooltip="${esc(localize("LUCD20.LootPile.StashAskedBy", { names }))}">${icon("fa-box-archive")}<b>${stashers.length}</b></span>`
      : "";
    return `<span class="ll-requests"><span class="ll-tokens">${tokens}</span>${stash}</span>`;
  }

  #rowHTML(item, claims, gm) {
    const requests = requestsFor(item, claims);
    const mine = claims.find(c => c.itemId === item.id && c.userId === game.user.id);
    const L = key => localize(`LUCD20.LootPile.${key}`);
    let actions;
    if (gm && requests.state === "none") {
      actions = `<button type="button" class="ll-btn ll-btn-a" data-action="give" data-tooltip="${esc(L("GiveHint"))}">${icon("fa-user")}<span>${L("GiveTo")}</span></button>
        <button type="button" class="ll-btn ll-btn-b" data-action="stash" data-tooltip="${esc(L("StashHint"))}">${icon("fa-box-archive")}<span>${L("Stash")}</span></button>`;
    } else if (gm) {
      const names = requests.claimers.map(c => fromUuidSync(c.actorUuid)?.name ?? unknownName()).join(", ");
      const [action, glyph, label] = requests.state === "contested" ? ["decide", "fa-gavel", L("WhoGetsIt")]
        : requests.state === "claimed" ? ["approve", "fa-check", localize("LUCD20.LootPile.GiveToName", { name: esc(names) })]
          : ["approve", "fa-check", L("SendToStash")];
      actions = `<button type="button" class="ll-btn ll-btn-take ll-btn-wide" data-action="${action}">${icon(glyph)}<span>${label}</span></button>
        <button type="button" class="ll-btn ll-btn-square" data-action="refuse" data-tooltip="${esc(L("Refuse"))}" aria-label="${esc(L("Refuse"))}">${icon("fa-xmark")}</button>`;
    } else {
      const claimed = mine?.kind === "claim";
      const stashed = mine?.kind === "stash";
      const noCharacter = this.taker ? "" : `disabled data-tooltip="${esc(L("ClaimDisabled"))}"`;
      actions = `<button type="button" class="ll-btn ll-btn-a ${claimed ? "ll-btn-on" : "ll-btn-take"}" data-action="claim" ${claimed ? `data-tooltip="${esc(L("TakeBack"))}"` : noCharacter || `data-tooltip="${esc(L("ClaimHint"))}"`}>
          ${icon(claimed ? "fa-hourglass-half" : "fa-hand")}<span>${claimed ? L("ClaimedWaiting") : L("Claim")}</span></button>
        <button type="button" class="ll-btn ll-btn-b ${stashed ? "ll-btn-on is-stash" : ""}" data-action="stash" data-tooltip="${esc(stashed ? L("TakeBack") : L("StashAskHint"))}">
          ${icon(stashed ? "fa-hourglass-half" : "fa-box-archive")}<span>${stashed ? L("StashWaiting") : L("Stash")}</span></button>`;
    }
    return `
      <li class="lucd20-loot-item ll-row is-${requests.state}" data-item-id="${item.id}">
        ${itemIconHTML(item)}
        <span class="name">${esc(item.name)}</span>
        ${qtyPill(item)}
        ${this.#requestsHTML(requests)}
        <span class="actions">${actions}</span>
      </li>`;
  }

  async _renderHTML() {
    const pile = this.pile;
    const gm = game.user.isGM;
    const claims = claimsOf(pile);
    const items = lootItems(pile);
    const groups = new Map();
    for (const item of items) {
      const source = item.getFlag(MODULE_ID, "source") ?? { level: 0 };
      const key = source.actorUuid ?? `${source.level}|${source.name}`;
      if (!groups.has(key)) groups.set(key, { ...sourceDisplay(source), level: source.level ?? 0, items: [] });
      groups.get(key).items.push(item);
    }
    const sorted = [...groups.values()].sort((a, b) => (b.level - a.level) || a.name.localeCompare(b.name));
    const options = gm ? [] : takers();
    if (!options.some(a => a.uuid === this.taker)) this.taker = options[0]?.uuid ?? null;

    const list = sorted.length
      ? sorted.map(g => `
        <section class="lucd20-loot-group">
          ${groupHeaderHTML(g)}
          <ol>${g.items.sort((a, b) => a.name.localeCompare(b.name)).map(item => this.#rowHTML(item, claims, gm)).join("")}</ol>
        </section>`).join("")
      : `<div class="lucd20-loot-empty">
          <i class="ll-empty-art fa-solid fa-sack-dollar" aria-hidden="true"></i>
          <p class="title">${localize("LUCD20.LootPile.Empty")}</p>
          <p class="sub">${localize("LUCD20.LootPile.EmptySub")}</p>
        </div>`;

    const ready = items.filter(item => ["claimed", "stash"].includes(requestsFor(item, claims).state)).length;
    const footer = `
      <footer class="lucd20-loot-footer ${gm ? "is-gm" : ""}">
        ${gm ? `<button type="button" class="ll-btn ll-btn-footer ll-btn-take" data-action="approveAll" ${ready ? "" : "disabled"}>
          ${icon("fa-check-double")}<span>${localize("LUCD20.LootPile.ApproveAll", { count: ready })}</span></button>` : ""}
        <button type="button" class="ll-btn ll-btn-footer ll-btn-all" data-action="stashAll" ${sorted.length ? "" : "disabled"}>
          ${icon("fa-box-archive")}<span>${localize("LUCD20.LootPile.StashAll")}</span></button>
        ${gm ? `
        <button type="button" class="ll-btn ll-btn-footer" data-action="openSheet">${icon("fa-arrow-up-right-from-square")}<span>${localize("LUCD20.LootPile.OpenSheet")}</span></button>
        <button type="button" class="ll-btn ll-btn-footer ll-btn-danger" data-action="deletePile">${icon("fa-trash")}<span>${localize("LUCD20.LootPile.Delete")}</span></button>` : ""}
      </footer>`;

    return `<div class="lucd20-loot-body">${gm ? "" : this.#takerHTML(options)}${this.#coinsHTML(gm)}<div class="lucd20-loot-list">${list}</div>${footer}</div>`;
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

  #item(button) {
    return this.pile.items.get(button.closest("[data-item-id]")?.dataset.itemId);
  }

  /** "How many?" for a stack; Shift+click means the whole stack. Null = cancelled. */
  async #quantity(item, event, { name = null, verb = "Take" } = {}) {
    const quantity = item.system?.quantity;
    if (typeof quantity !== "number" || quantity <= 1 || event?.shiftKey) return stackSize(item);
    return LootQuantityWindow.wait(item, name, verb);
  }

  async #run(button, work) {
    button.disabled = true;
    try {
      await work();
    } catch (err) {
      ui.notifications.warn(err.message ?? String(err));
      button.disabled = false;
    }
  }

  async #request(button, payload) {
    return this.#run(button, () => executeAsGM("lootPile.request", { pileUuid: this.pile.uuid, ...payload }));
  }

  /** Player: claim for the character above, or take the claim back. */
  static async #onClaim(event, button) {
    const item = this.#item(button);
    if (!item) return;
    const mine = claimsOf(this.pile).find(c => c.itemId === item.id && c.userId === game.user.id);
    if (mine?.kind === "claim") return this.#request(button, { itemId: item.id, kind: null });
    if (!this.taker) return;
    const quantity = await this.#quantity(item, event, { name: fromUuidSync(this.taker)?.name, verb: "Claim" });
    if (!quantity) return;
    return this.#request(button, { itemId: item.id, kind: "claim", actorUuid: this.taker, quantity });
  }

  /** Player: ask for the Party Stash (or take that back). GM: send it there now. */
  static async #onStash(event, button) {
    const item = this.#item(button);
    if (!item) return;
    if (game.user.isGM) {
      const quantity = await this.#quantity(item, event);
      if (!quantity) return;
      return this.#run(button, () => give(this.pile, item.id, "stash", quantity));
    }
    const mine = claimsOf(this.pile).find(c => c.itemId === item.id && c.userId === game.user.id);
    return this.#request(button, { itemId: item.id, kind: mine?.kind === "stash" ? null : "stash" });
  }

  /** GM: give an item nobody asked for to a character. */
  static async #onGive(event, button) {
    const item = this.#item(button);
    if (!item) return;
    const target = await GiveWindow.wait(item);
    if (!target) return;
    const quantity = await this.#quantity(item, event, { name: fromUuidSync(target)?.name });
    if (!quantity) return;
    return this.#run(button, () => give(this.pile, item.id, target, quantity));
  }

  static #onApprove(event, button) {
    const item = this.#item(button);
    if (item) return this.#run(button, () => approve(this.pile, item.id));
  }

  static #onRefuse(event, button) {
    const item = this.#item(button);
    if (item) return this.#run(button, () => refuse(this.pile, item.id));
  }

  /** GM: open "Who gets it?" for everyone who claimed it. */
  static #onDecide(event, button) {
    const item = this.#item(button);
    if (item) return this.#run(button, () => saveClaims(this.pile, claimsOf(this.pile), item.id));
  }

  static #onApproveAll(event, button) {
    return this.#run(button, () => approveAll(this.pile));
  }

  static #onSplitEven() {
    SplitWindow.open(this.pile);
  }

  static #onSplitCustom() {
    CustomSplitWindow.open(this.pile);
  }

  static async #onStashAll(event, button) {
    if (!game.user.isGM) return this.#run(button, () => executeAsGM("lootPile.requestAll", { pileUuid: this.pile.uuid }));
    const confirmed = await DialogV2.confirm({
      window: { title: localize("LUCD20.LootPile.StashAll") },
      content: `<p>${localize("LUCD20.LootPile.StashAllContent", { count: lootItems(this.pile).length })}</p>`
    });
    if (!confirmed) return;
    return this.#run(button, () => stashAll({ pileUuid: this.pile.uuid }, game.user.id));
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

/* --- "Give to…" (GM) ---------------------------------------------------- */

class GiveWindow extends AnswerWindow {
  static DEFAULT_OPTIONS = {
    classes: ["lucd20-loot-app", "lucd20-loot-give-dialog"],
    window: { title: "LUCD20.LootPile.GiveTo", icon: "fa-solid fa-user" },
    position: { width: 320, height: "auto" },
    actions: { pick: GiveWindow.#onPick }
  };

  /** Resolves with the chosen character's uuid, or null. */
  static wait(item) {
    return super.wait({ item });
  }

  setup({ item }) {
    this.item = item;
  }

  async _renderHTML() {
    const rows = takers().map(actor => `<button type="button" class="ll-btn ll-give-row" data-action="pick" data-uuid="${esc(actor.uuid)}">
        ${actorPortrait(actor, "", "")}<span>${esc(actor.name)}</span></button>`).join("");
    return `<div class="lucd20-loot-body ll-give">
        <div class="ll-what">${itemIconHTML(this.item)}<strong>${esc(this.item.name)}</strong>${qtyPill(this.item)}</div>
        ${rows || `<p class="lucd20-loot-hint">${localize("LUCD20.LootPile.NoCharacters")}</p>`}
      </div>`;
  }

  static #onPick(event, button) {
    this.answer(button.dataset.uuid);
  }
}

/* --- "Who gets it?" ----------------------------------------------------- */

/** Open for the GM and the claimers while the pile's `deciding` flag names an item. */
class ContestWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["lucd20-loot-app", "lucd20-loot-contest"],
    window: { title: "LUCD20.LootPile.WhoGetsIt", icon: "fa-solid fa-gavel", resizable: true },
    position: { width: 420, height: "auto" },
    actions: { award: ContestWindow.#onAward, sheet: ContestWindow.#onSheet }
  };

  static idFor = pile => `lucd20-loot-decide-${pile.id}`;

  constructor(options) {
    super(options);
    this.pile = fromUuidSync(options.pileUuid);
  }

  get item() {
    return this.pile.items.get(this.pile.getFlag(MODULE_ID, FLAG_DECIDING));
  }

  /** The item's own description. Never for a player while the item is unidentified. */
  async #descriptionHTML(item) {
    if (!game.user.isGM && item.isIdentified === false) return "";
    const raw = item.system?.description?.value ?? (typeof item.system?.description === "string" ? item.system.description : "");
    if (!raw) return "";
    const editor = foundry.applications.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    try {
      return (await editor?.enrichHTML?.(raw, { secrets: game.user.isGM, relativeTo: item })) ?? "";
    } catch (err) {
      return "";
    }
  }

  async _renderHTML() {
    const item = this.item;
    if (!item) return "";
    const { claimers } = requestsFor(item, claimsOf(this.pile));
    const gm = game.user.isGM;
    const people = claimers.map(c => {
      const actor = fromUuidSync(c.actorUuid);
      const many = stackSize(item) > 1 ? `<span class="qty">×${c.quantity}</span>` : "";
      return `<div class="ll-contender">${actorPortrait(actor, "large", "")}<strong>${esc(actor?.name ?? unknownName())}</strong>
          <span class="sub">${esc(game.users.get(c.userId)?.name ?? "")}</span>${many}</div>`;
    }).join(`<span class="ll-versus">${localize("LUCD20.LootPile.Versus")}</span>`);
    const buttons = gm
      ? `<footer class="lucd20-loot-footer ll-award"><span class="label">${localize("LUCD20.LootPile.GiveToLabel")}</span>
          ${claimers.map(c => `<button type="button" class="ll-btn ll-btn-footer ll-btn-take" data-action="award" data-target="${esc(c.actorUuid)}" data-quantity="${c.quantity}">
            ${icon("fa-check")}<span>${esc(fromUuidSync(c.actorUuid)?.name ?? unknownName())}</span></button>`).join("")}
          <button type="button" class="ll-btn ll-btn-footer" data-action="award" data-target="stash">${icon("fa-box-archive")}<span>${localize("LUCD20.LootPile.Stash")}</span></button>
        </footer>`
      : `<p class="ll-contest-note">${icon("fa-gavel")}<span>${localize("LUCD20.LootPile.GMDecides")}</span></p>`;
    return `<div class="lucd20-loot-body ll-contest">
        <article class="ll-item-card">
          <header>${itemIconHTML(item, "large")}<span class="who"><strong>${esc(item.name)}</strong>${qtyPill(item)}</span>
            <button type="button" class="ll-btn ll-btn-square" data-action="sheet" data-tooltip="${esc(localize("LUCD20.LootPile.OpenItem"))}" aria-label="${esc(localize("LUCD20.LootPile.OpenItem"))}">${icon("fa-arrow-up-right-from-square")}</button></header>
          <div class="ll-item-text">${await this.#descriptionHTML(item)}</div>
        </article>
        <div class="ll-contenders">${people}</div>
        ${buttons}
      </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static async #onAward(event, button) {
    const item = this.item;
    if (!item || !game.user.isGM) return;
    button.disabled = true;
    try {
      await give(this.pile, item.id, button.dataset.target, Number(button.dataset.quantity) || undefined);
    } catch (err) {
      ui.notifications.warn(err.message ?? String(err));
    }
  }

  static #onSheet() {
    this.item?.sheet?.render(true);
  }

  /** The GM closing it without choosing ends the question for everyone; the claims stay. */
  async _onClose(options) {
    await super._onClose?.(options);
    if (game.user.isGM && this.pile && game.actors.get(this.pile.id) && this.pile.getFlag(MODULE_ID, FLAG_DECIDING)) {
      await saveClaims(this.pile, claimsOf(this.pile), null);
    }
  }
}

/** Open, refresh or close "Who gets it?" on this client to match the pile. */
function syncDeciding(pile) {
  const id = ContestWindow.idFor(pile);
  const app = foundry.applications.instances?.get(id);
  const item = pile.items.get(pile.getFlag(MODULE_ID, FLAG_DECIDING));
  const involved = item && (game.user.isGM || requestsFor(item, claimsOf(pile)).claimers.some(c => c.userId === game.user.id));
  if (!involved) return void app?.close();
  (app ?? new ContestWindow({ id, pileUuid: pile.uuid })).render({ force: true });
}

/* --- Coins: "Split evenly" and "Custom split" (GM) ------------------------ */

class SplitWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["lucd20-loot-app", "lucd20-loot-split"],
    window: { title: "LUCD20.LootPile.SplitEven", icon: "fa-solid fa-scale-balanced", resizable: true },
    position: { width: 460, height: "auto" },
    actions: { mode: SplitWindow.#onMode, split: SplitWindow.#onSplit, cancel: SplitWindow.#onCancel }
  };

  static open(pile) {
    const id = `lucd20-loot-split-${pile.id}`;
    return (foundry.applications.instances?.get(id) ?? new this({ id, pileUuid: pile.uuid })).render({ force: true });
  }

  constructor(options) {
    super(options);
    this.pile = fromUuidSync(options.pileUuid);
    this.characters = splitCharacters();
    this.picked = new Set(this.characters.map(a => a.uuid));
    this.convert = false;
  }

  /** { share, rest } for the ticked characters in the chosen mode. */
  get result() {
    const purse = pileCoins(this.pile);
    const people = this.picked.size;
    return this.convert ? splitByValue(purse, people, denominations(), highestCoin()) : splitAsIs(purse, people, denominations());
  }

  async _renderHTML() {
    const L = key => localize(`LUCD20.LootPile.${key}`);
    const purse = pileCoins(this.pile);
    const { share, rest } = this.result;
    const chosen = this.characters.filter(a => this.picked.has(a.uuid));
    const ticks = this.characters.map(a => `<label class="ll-pick"><input type="checkbox" class="ll-check" data-pick value="${esc(a.uuid)}" ${this.picked.has(a.uuid) ? "checked" : ""}>
        ${actorPortrait(a, "small", "")}<span>${esc(a.name)}</span></label>`).join("");
    const tab = (convert, title, sub) => `<button type="button" class="ll-tab ${this.convert === convert ? "is-on" : ""}" data-action="mode" data-convert="${convert ? 1 : 0}">
        <strong>${title}</strong><span>${sub}</span></button>`;
    const rows = chosen.map(a => `<div class="ll-share">${actorPortrait(a, "small", "")}<span class="who">${esc(a.name)}</span>${coinChipsHTML(share)}</div>`).join("");
    return `<div class="lucd20-loot-body ll-split">
        <div class="lucd20-loot-coins"><span class="ll-coins-title">${icon("fa-coins")}${L("Coins")}</span>${coinChipsHTML(purse)}</div>
        <div class="ll-picks">${ticks || `<p class="lucd20-loot-hint">${L("NoCharacters")}</p>`}</div>
        <div class="ll-tabs">${tab(false, L("SplitNormal"), L("SplitNormalSub"))}${tab(true, L("SplitConvert"), L("SplitConvertSub"))}</div>
        <div class="ll-preview">${rows}
          <div class="ll-share is-stash">${icon("fa-box-archive")}<span class="who">${L("Stash")}</span>${coinChipsHTML(chosen.length ? rest : purse)}</div>
        </div>
        <footer class="lucd20-loot-footer">
          <button type="button" class="ll-btn ll-btn-footer ll-btn-take" data-action="split" ${chosen.length ? "" : "disabled"}>${icon("fa-scale-balanced")}<span>${L("Split")}</span></button>
          <button type="button" class="ll-btn ll-btn-footer" data-action="cancel">${icon("fa-xmark")}<span>${L("Cancel")}</span></button>
        </footer>
      </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    for (const box of content.querySelectorAll("[data-pick]")) {
      box.addEventListener("change", () => {
        if (box.checked) this.picked.add(box.value);
        else this.picked.delete(box.value);
        this.render();
      });
    }
  }

  static #onMode(event, button) {
    this.convert = button.dataset.convert === "1";
    this.render();
  }

  static async #onSplit(event, button) {
    const { share, rest } = this.result;
    const shares = this.characters.filter(a => this.picked.has(a.uuid)).map(actor => ({ actor, purse: share }));
    button.disabled = true;
    try {
      await splitCoins(this.pile, shares, rest, { even: true });
      this.close();
    } catch (err) {
      ui.notifications.warn(err.message ?? String(err));
      button.disabled = false;
    }
  }

  static #onCancel() {
    this.close();
  }
}

class CustomSplitWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["lucd20-loot-app", "lucd20-loot-split", "lucd20-loot-custom-split"],
    window: { title: "LUCD20.LootPile.SplitCustom", icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 500, height: "auto" },
    actions: { give: CustomSplitWindow.#onGive, cancel: CustomSplitWindow.#onCancel }
  };

  static open(pile) {
    const id = `lucd20-loot-custom-${pile.id}`;
    return (foundry.applications.instances?.get(id) ?? new this({ id, pileUuid: pile.uuid })).render({ force: true });
  }

  constructor(options) {
    super(options);
    this.pile = fromUuidSync(options.pileUuid);
    this.characters = splitCharacters();
    this.given = Object.fromEntries(this.characters.map(a => [a.uuid, emptyPurse(denominations())]));
    this.convert = false;
  }

  /**
   * What is left to give. As they are: per coin (a negative number = more given than there is).
   * Converted: by value, shown in the fewest coins; `over` when more is given than the pile is worth.
   */
  get left() {
    const denoms = denominations();
    const pool = pileCoins(this.pile);
    const out = Object.values(this.given).reduce((sum, purse) => addPurses(sum, purse, denoms), emptyPurse(denoms));
    if (this.convert) {
      const value = purseValue(pool, denoms) - purseValue(out, denoms);
      return { purse: purseFromValue(value, denoms, highestCoin()), over: value < 0 };
    }
    const purse = Object.fromEntries(denoms.map(d => [d.id, pool[d.id] - out[d.id]]));
    return { purse, over: denoms.some(d => purse[d.id] < 0) };
  }

  async _renderHTML() {
    const L = key => localize(`LUCD20.LootPile.${key}`);
    const denoms = denominations();
    const head = denoms.map(d => `<th class="ll-coin-${d.id}">${esc(d.id)}</th>`).join("");
    const rows = this.characters.map(a => `<tr data-uuid="${esc(a.uuid)}"><td class="who">${actorPortrait(a, "small", "")}<span>${esc(a.name)}</span></td>
        ${denoms.map(d => `<td><input type="number" min="0" step="1" inputmode="numeric" data-coin="${d.id}" value="${this.given[a.uuid][d.id]}" aria-label="${esc(`${a.name} ${d.id}`)}"></td>`).join("")}</tr>`).join("");
    return `<div class="lucd20-loot-body ll-split">
        <label class="ll-convert"><input type="checkbox" class="ll-check" data-convert ${this.convert ? "checked" : ""}><strong>${L("SplitConvert")}</strong><span>${L("CustomConvertSub")}</span></label>
        <table class="ll-split-table">
          <thead><tr><th></th>${head}</tr>
            <tr class="ll-left"><td>${L("LeftToGive")}</td>${denoms.map(d => `<td data-left="${d.id}"></td>`).join("")}</tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td class="who">${icon("fa-box-archive")}<span>${L("StashGetsRest")}</span></td>${denoms.map(d => `<td data-rest="${d.id}"></td>`).join("")}</tr></tfoot>
        </table>
        <footer class="lucd20-loot-footer">
          <button type="button" class="ll-btn ll-btn-footer ll-btn-take" data-action="give">${icon("fa-check")}<span>${L("GiveCoins")}</span></button>
          <button type="button" class="ll-btn ll-btn-footer" data-action="cancel">${icon("fa-xmark")}<span>${L("Cancel")}</span></button>
        </footer>
      </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    content.querySelector("[data-convert]").addEventListener("change", event => {
      this.convert = event.target.checked;
      this.#sync();
    });
    for (const input of content.querySelectorAll("input[data-coin]")) {
      input.addEventListener("input", () => {
        const uuid = input.closest("[data-uuid]").dataset.uuid;
        this.given[uuid][input.dataset.coin] = Math.max(0, Math.floor(Number(input.value) || 0));
        this.#sync();
      });
    }
    this.#sync();
  }

  /** Update "Left to give" and the stash line without redrawing (typing keeps its place). */
  #sync() {
    const { purse, over } = this.left;
    for (const d of denominations()) {
      const cell = this.element.querySelector(`[data-left="${d.id}"]`);
      cell.textContent = purse[d.id];
      cell.classList.toggle("is-over", purse[d.id] < 0 || over);
      cell.classList.toggle("is-some", purse[d.id] > 0 && !over);
      this.element.querySelector(`[data-rest="${d.id}"]`).textContent = over ? "–" : Math.max(0, purse[d.id]);
    }
    this.element.querySelector('[data-action="give"]').disabled = over;
  }

  static async #onGive(event, button) {
    const { purse, over } = this.left;
    if (over) return;
    const shares = this.characters.map(actor => ({ actor, purse: cleanPurse(this.given[actor.uuid], denominations()) }));
    button.disabled = true;
    try {
      await splitCoins(this.pile, shares, cleanPurse(purse, denominations()));
      this.close();
    } catch (err) {
      ui.notifications.warn(err.message ?? String(err));
      button.disabled = false;
    }
  }

  static #onCancel() {
    this.close();
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
  static wait(item, takerName, verb = "Take") {
    return super.wait({ item, takerName, verb });
  }

  setup({ item, takerName, verb }) {
    this.item = item;
    this.takerName = takerName;
    this.verb = verb;
    this.max = Number(item.system.quantity) || 1;
    this.value = this.max;
  }

  async _renderHTML() {
    const item = this.item;
    const sub = [localize("LUCD20.LootPile.InPile", { count: this.max })];
    if (this.takerName) sub.push(localize("LUCD20.LootPile.ForName", { name: esc(this.takerName) }));
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
    form.querySelector("[data-take-label]").textContent = localize(`LUCD20.LootPile.${this.verb}N`, { count: value });
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
  for (const id of [`lucd20-loot-${actor.id}`, `lucd20-loot-split-${actor.id}`]) {
    const app = foundry.applications.instances?.get(id);
    if (app?.rendered) app.render();
  }
  if (document === actor) syncDeciding(actor);
  else if (foundry.applications.instances?.get(ContestWindow.idFor(actor))?.rendered) syncDeciding(actor);
}

function closePileWindows(actor) {
  for (const id of [`lucd20-loot-${actor.id}`, `lucd20-loot-split-${actor.id}`, `lucd20-loot-custom-${actor.id}`, ContestWindow.idFor(actor)]) {
    foundry.applications.instances?.get(id)?.close();
  }
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
    announce: { kind: "boolean", default: true },
    highestCoin: { kind: "select", default: "top", choices: { top: "LUCD20.LootPile.HighestTop", pp: "LUCD20.LootPile.HighestPP", gp: "LUCD20.LootPile.HighestGP" } }
  },

  init(feature) {
    game.settings.register(MODULE_ID, STASH_KEY, { scope: "world", config: false, type: String, default: "" });
    // Players only ask; every transfer is the GM's own click, on the GM's client.
    onGMRequest("lootPile.request", (payload, senderId) => {
      if (!feature.active) throw new Error(localize("LUCD20.LootPile.Disabled"));
      return request(payload, senderId);
    });
    onGMRequest("lootPile.requestAll", (payload, senderId) => {
      if (!feature.active) throw new Error(localize("LUCD20.LootPile.Disabled"));
      return requestAll(payload, senderId);
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
    feature.on("deleteActor", closePileWindows);

    feature.onCleanup(() => {
      for (const app of foundry.applications.instances?.values() ?? []) {
        if ([LootPileWindow, ContestWindow, SplitWindow, CustomSplitWindow, GiveWindow].some(c => app instanceof c)) app.close();
      }
      state.feature = null;
    });
  }
});

export { LootPileWindow, reviewLoot };
export const _test = { approve, approveAll, claimsOf, give, refuse, requestsFor, splitCoins, ContestWindow, SplitWindow, CustomSplitWindow };
