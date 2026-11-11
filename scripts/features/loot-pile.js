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

  const qty = item => (typeof item.system?.quantity === "number" && item.system.quantity !== 1 ? ` ×${item.system.quantity}` : "");
  const content = `
    <div class="lucd20-loot-review">
      <p class="hint">${localize("LUCD20.LootPile.ReviewHint")}</p>
      ${groups.map((g, gi) => `
        <section class="lucd20-loot-group">
          <h4><img src="${esc(g.img)}" alt=""> ${esc(g.name)} <span class="hint">${localize("LUCD20.LootPile.Level", { level: g.level })}</span></h4>
          ${g.items.map(item => `
            <label class="lucd20-loot-check">
              <input type="checkbox" name="${gi}:${item.id}" checked>
              <img src="${esc(item.img)}" alt=""> <span>${esc(item.name)}${qty(item)}</span>
            </label>`).join("")}
        </section>`).join("")}
    </div>`;

  const selected = await DialogV2.wait({
    window: { title: localize("LUCD20.LootPile.ReviewTitle"), icon: "fa-solid fa-sack" },
    classes: ["lucd20-loot-review-dialog"],
    position: { width: 420 },
    content,
    buttons: [
      {
        action: "create",
        label: localize("LUCD20.LootPile.Create"),
        icon: "fa-solid fa-check",
        default: true,
        callback: (event, button) => [...button.form.elements].filter(el => el.type === "checkbox" && el.checked).map(el => el.name)
      },
      { action: "skip", label: localize("LUCD20.LootPile.Skip"), icon: "fa-solid fa-xmark", callback: () => null }
    ],
    rejectClose: false
  });
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
      foundry.utils.setProperty(data, `flags.${MODULE_ID}.source`, {
        name: g.name, nameHidden: g.nameHidden, level: g.level, img: g.img, actorUuid: g.actor.uuid
      });
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
      content: `<p class="lucd20-loot-announce"><i class="fa-solid fa-sack"></i> ${localize("LUCD20.LootPile.AnnounceStashAll", {
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
      content: `<p class="lucd20-loot-announce"><i class="fa-solid fa-sack"></i> ${localize(key, {
        user: esc(sender.name), item: esc(item.name), count: hasQty && n > 1 ? `${n}× ` : "", actor: esc(destination.name)
      })}</p>`,
      speaker: { alias: pile.name }
    });
  }

  if (!pile.items.size && state.feature?.get("deleteWhenEmpty")) await deletePile(pile);
  return true;
}

/* -------------------------------------------- */
/*  Loot window                                 */
/* -------------------------------------------- */

/** Characters this user can take items for. */
function takers() {
  const notContainer = a => !isPile(a) && !a.getFlag(MODULE_ID, "partyStash") && a.type !== "party" && a.type !== "loot";
  if (game.user.isGM) return game.actors.filter(a => a.hasPlayerOwner && notContainer(a)).sort((a, b) => a.name.localeCompare(b.name));
  const owned = game.actors.filter(a => a.isOwner && notContainer(a));
  const mine = game.user.character;
  return mine ? [mine, ...owned.filter(a => a !== mine)] : owned;
}

class LootPileWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["lucd20-loot-window"],
    window: { icon: "fa-solid fa-sack", resizable: true },
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

  async _renderHTML() {
    const pile = this.pile;
    const gm = game.user.isGM;
    const groups = new Map();
    for (const item of pile.items) {
      const source = item.getFlag(MODULE_ID, "source") ?? { name: localize("LUCD20.LootPile.Unknown"), level: 0 };
      const key = `${source.level}|${source.name}|${source.actorUuid ?? ""}`;
      if (!groups.has(key)) groups.set(key, { ...source, items: [] });
      groups.get(key).items.push(item);
    }
    const sorted = [...groups.values()].sort((a, b) => (b.level - a.level) || a.name.localeCompare(b.name));
    const options = takers();
    if (!options.some(a => a.uuid === this.taker)) this.taker = options[0]?.uuid ?? null;

    const picker = options.length
      ? `<label class="lucd20-loot-taker">${localize("LUCD20.LootPile.TakingFor")}
          <select data-taker>${options.map(a => `<option value="${esc(a.uuid)}" ${a.uuid === this.taker ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>
        </label>`
      : `<p class="hint">${localize("LUCD20.LootPile.NoCharacter")}</p>`;

    const body = sorted.length
      ? sorted.map(g => `
        <section class="lucd20-loot-group">
          <h3>${g.img ? `<img src="${esc(g.img)}" alt="">` : ""}
            <span>${esc(!gm && g.nameHidden ? localize("LUCD20.TurnAnnouncer.Unknown") : g.name)}</span>
            <span class="hint">${localize("LUCD20.LootPile.Level", { level: g.level })}</span></h3>
          <ol>${g.items.sort((a, b) => a.name.localeCompare(b.name)).map(item => {
            const q = typeof item.system?.quantity === "number" && item.system.quantity !== 1 ? `<span class="qty">×${item.system.quantity}</span>` : "";
            return `<li class="lucd20-loot-item" data-item-id="${item.id}">
              <img src="${esc(item.img)}" alt=""><span class="name">${esc(item.name)} ${q}</span>
              <button type="button" data-action="take" ${this.taker ? "" : "disabled"} data-tooltip="${localize("LUCD20.LootPile.TakeHint")}"><i class="fa-solid fa-hand"></i> ${localize("LUCD20.LootPile.Take")}</button>
              <button type="button" data-action="stash" data-tooltip="${localize("LUCD20.LootPile.StashHint")}"><i class="fa-solid fa-box-archive"></i> ${localize("LUCD20.LootPile.Stash")}</button>
            </li>`;
          }).join("")}</ol>
        </section>`).join("")
      : `<p class="lucd20-loot-empty">${localize("LUCD20.LootPile.Empty")}</p>`;

    const footer = `<footer class="lucd20-loot-footer">
        ${sorted.length ? `<button type="button" data-action="stashAll"><i class="fa-solid fa-box-archive"></i> ${localize("LUCD20.LootPile.StashAll")}</button>` : ""}
        ${gm ? `<button type="button" data-action="openSheet"><i class="fa-solid fa-file-lines"></i> ${localize("LUCD20.LootPile.OpenSheet")}</button>
          <button type="button" data-action="deletePile"><i class="fa-solid fa-trash"></i> ${localize("LUCD20.LootPile.Delete")}</button>` : ""}
      </footer>`;
    return `<div class="lucd20-loot-body">${picker}<div class="lucd20-loot-list">${body}</div>${footer}</div>`;
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
      quantity = await DialogV2.prompt({
        window: { title: item.name },
        content: `<label class="lucd20-loot-qty">${localize("LUCD20.LootPile.HowMany")}
          <input type="number" name="quantity" min="1" max="${quantity}" value="${quantity}" autofocus></label>`,
        ok: { label: localize("LUCD20.LootPile.Take"), callback: (event, b) => Number(b.form.elements.quantity.value) },
        rejectClose: false
      });
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
