import { localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { LootQuantityWindow } from "../../features/loot-pile.js";

/**
 * Sell (owner, Q295; v0.82.0). PF2e / SF2e.
 * - Each physical item that isn't treasure gets a Sell icon in its row's controls on character, loot and party
 *   sheets (for owners): it sells for half its price (PF2e's own `assetValue` / `Coins.fromPrice`, so
 *   per-batch prices and SF2e credits work), the coins go to the same actor (`inventory.addCurrency`), the item
 *   is removed (or its quantity lowered). A stack asks how many. One chat line: "Longsword ×2: sold for 1 gp".
 * - Every sale asks for confirmation (owner, v0.84.3). Characters get "Sell items" next to PF2e's coin buttons:
 *   a window to tick items (and how many of each) and sell them at once, with the total.
 * - Loot sheets: "Sell all equipment" next to PF2e's own "Sell all treasure": every priced item that isn't
 *   treasure or coins, half price, after a confirmation with the total; treasure inside a sold container is
 *   moved out first.
 * (verify) in PF2e 8.7 / SF2e 1.7: the sheet hooks (`renderActorSheetPF2e`), the row's `.item-controls`, the
 * coinage list's `[data-action="sell-all-treasure"]`, `item.assetValue`, `Coins.fromPrice`, `addCurrency`.
 */

const t = (key, data) => localize(`LUCD20.Sell.${key}`, data);
const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const { DialogV2 } = foundry.applications.api;

const isPhysical = item => (typeof item?.isOfType === "function" ? item.isOfType("physical") : !!item?.system?.quantity);
const isTreasure = item => item?.type === "treasure" || (typeof item?.isOfType === "function" && item.isOfType("treasure"));
const isCoins = item => !!item?.isCurrency || !!item?.isCoinage || item?.system?.stackGroup === "coins";
/** What can be sold: physical, not treasure, not coins. */
export const isSellable = item => isPhysical(item) && !isTreasure(item) && !isCoins(item);

/** Half the price of `quantity` of the item, as PF2e coins (null when PF2e's coin maths isn't there). */
export function halfPrice(item, quantity = item.quantity ?? item.system?.quantity ?? 1) {
  const Coins = item.assetValue?.constructor ?? game.pf2e?.Coins ?? null;
  if (Coins?.fromPrice && item.price) return Coins.fromPrice(item.price, quantity).scale(0.5);
  const full = item.assetValue;
  const all = item.quantity ?? item.system?.quantity ?? 1;
  return full?.scale ? full.scale(0.5 * quantity / Math.max(1, all)) : null;
}

const copper = coins => Number(coins?.copperValue) || 0;
const priceText = coins => (coins?.toString ? coins.toString() : String(coins ?? ""));

/** A link to the item's compendium source when it has one (the item itself is gone), else its name. */
function itemLink(item) {
  const source = item.sourceId ?? item._stats?.compendiumSource ?? item.flags?.core?.sourceId;
  return source ? `@UUID[${source}]{${item.name}}` : esc(item.name);
}

/** Move whatever is inside a container out of it (before the container goes). */
async function emptyContainer(item) {
  const inside = (item.actor?.items?.contents ?? []).filter(i => i.system?.containerId === item.id);
  if (inside.length) await item.actor.updateEmbeddedDocuments("Item", inside.map(i => ({ _id: i.id, "system.containerId": null })));
}

/** Sell `quantity` of an item. → the coins received, or null. */
export async function sellItem(item, quantity = item.quantity ?? item.system?.quantity ?? 1, { chat = true } = {}) {
  const actor = item?.actor;
  if (!actor || !isSellable(item)) return null;
  const have = item.quantity ?? item.system?.quantity ?? 1;
  const n = Math.max(1, Math.min(have, Math.floor(quantity)));
  const coins = halfPrice(item, n);
  if (!coins) return null;
  if (n >= have) {
    await emptyContainer(item);
    await item.delete();
  } else {
    await item.update({ "system.quantity": have - n });
  }
  if (copper(coins) > 0) await actor.inventory?.addCurrency?.(coins);
  if (chat) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p class="lucd20-sell-line"><i class="fa-solid fa-hand-holding-dollar"></i> ${itemLink(item)}${n > 1 ? ` ×${n}` : ""}: ${esc(t("SoldFor", { price: priceText(coins) }))}</p>`
    });
  }
  return coins;
}

/** Sell every priced item that isn't treasure or coins. → { count, coins } */
export async function sellAllEquipment(actor, { chat = true } = {}) {
  const items = (actor?.items?.contents ?? []).filter(i => isSellable(i) && copper(halfPrice(i)) > 0);
  if (!items.length) return { count: 0, coins: null };
  const ids = new Set(items.map(i => i.id));
  // Keep what is inside a sold container (treasure, coins) by moving it out first.
  const keep = (actor.items.contents ?? []).filter(i => !ids.has(i.id) && ids.has(i.system?.containerId));
  if (keep.length) await actor.updateEmbeddedDocuments("Item", keep.map(i => ({ _id: i.id, "system.containerId": null })));
  let total = null;
  const lines = [];
  for (const item of items) {
    const coins = halfPrice(item);
    total = total ? total.plus(coins) : coins;
    const qty = item.quantity ?? item.system?.quantity ?? 1;
    lines.push(`<li>${itemLink(item)}${qty > 1 ? ` ×${qty}` : ""}: ${esc(priceText(coins))}</li>`);
  }
  await actor.deleteEmbeddedDocuments("Item", [...ids]);
  if (total && copper(total) > 0) await actor.inventory?.addCurrency?.(total);
  if (chat) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="lucd20-sell-all"><p><i class="fa-solid fa-hand-holding-dollar"></i> ${esc(t("SoldAll", { count: items.length, price: priceText(total) }))}</p><details><summary>${esc(t("Items"))}</summary><ul>${lines.join("")}</ul></details></div>`
    });
  }
  return { count: items.length, coins: total };
}

/* -------------------------------------------- */
/*  The sheets                                  */
/* -------------------------------------------- */

/**
 * Selling one item: always confirmed (owner, v0.84.3), in the Loot Pile's "How many?" dialog (v0.84.5: it has
 * Cancel and the same look); a stack picks how many, the button shows the price.
 */
async function onSellClick(event, actor, itemId) {
  event.preventDefault();
  event.stopPropagation();
  const item = actor.items.get(itemId);
  if (!item) return;
  const have = item.quantity ?? item.system?.quantity ?? 1;
  const n = await LootQuantityWindow.wait(item, null, "Sell", {
    title: t("SellTitle", { name: item.name }),
    icon: "fa-hand-holding-dollar",
    sub: [have > 1 ? t("SellEach", { price: priceText(halfPrice(item, 1)) }) : t("HalfPriceOf", { price: priceText(halfPrice(item, 1)) })],
    label: count => t("SellNFor", { count, price: priceText(halfPrice(item, count)) })
  });
  if (!n) return;
  await sellItem(item, n);
}

/* -------------------------------------------- */
/*  The Sell items window (v0.84.3)             */
/* -------------------------------------------- */

const { ApplicationV2 } = foundry.applications.api;

/** Pick several items (and how many of each) and sell them at once. */
export class SellWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "lucd20-sell-window",
    classes: ["lucd20-loot-app", "lucd20-sell-app"],
    window: { title: "LUCD20.Sell.WindowTitle", icon: "fa-solid fa-hand-holding-dollar", resizable: true },
    position: { width: 460, height: "auto" },
    actions: { cancel: SellWindow.#onCancel, sell: SellWindow.#onSell }
  };

  static open(actor) {
    const app = foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id) ?? new this();
    app.actor = actor;
    app.picked = new Map(); // item id → quantity
    return app.render({ force: true });
  }

  static refresh() {
    const app = foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id);
    if (app?.rendered) app.render();
  }

  get title() {
    return t("WindowFor", { name: this.actor?.name ?? "" });
  }

  items() {
    return (this.actor?.items?.contents ?? []).filter(i => isSellable(i) && copper(halfPrice(i, 1)) > 0).sort((a, b) => a.name.localeCompare(b.name));
  }

  total() {
    let total = null;
    for (const [id, n] of this.picked) {
      const item = this.actor.items.get(id);
      if (!item || !n) continue;
      const c = halfPrice(item, n);
      total = total ? total.plus(c) : c;
    }
    return total;
  }

  async _renderHTML() {
    const items = this.items();
    const icon = name => `<i class="ll-i fa-solid ${name}" aria-hidden="true"></i>`;
    const rows = items.map(i => {
      const have = i.quantity ?? i.system?.quantity ?? 1;
      const n = this.picked.get(i.id) ?? 0;
      const shown = n || have;
      return `<li class="lucd20-sell-row lucd20-loot-item ${n ? "is-picked" : ""}" data-item-id="${esc(i.id)}">
        <input type="checkbox" class="pick ll-check" ${n ? "checked" : ""} aria-label="${esc(i.name)}">
        <span class="lucd20-loot-icon"><img src="${esc(i.img)}" alt=""></span>
        <span class="name">${esc(i.name)}${have > 1 ? ` <span class="have">×${have}</span>` : ""}</span>
        ${have > 1 ? `<input type="number" class="qty-in" min="1" max="${have}" step="1" value="${shown}" aria-label="${esc(t("HowMany", { max: have }))}">` : `<span class="qty-in-none"></span>`}
        <span class="price"><b>${esc(priceText(halfPrice(i, shown)))}</b>${have > 1 ? `<span class="each">${esc(t("Each", { price: priceText(halfPrice(i, 1)) }))}</span>` : ""}</span>
      </li>`;
    }).join("");
    const total = this.total();
    const count = [...this.picked.values()].reduce((s, n) => s + n, 0);
    const all = items.length && this.picked.size === items.length;
    const body = rows
      ? `<ol class="lucd20-sell-list">${rows}</ol>`
      : `<div class="lucd20-loot-empty"><i class="fa-solid fa-sack-xmark ll-empty-art"></i><span class="sub">${esc(t("NothingToSell"))}</span></div>`;
    return `<div class="lucd20-sell-body">
      <header class="lucd20-loot-taker lucd20-sell-head">
        <input type="checkbox" class="ll-check pick-all" ${all ? "checked" : ""} ${items.length ? "" : "disabled"} aria-label="${esc(t("SelectAll"))}">
        <span class="label">${esc(t("Picked", { n: this.picked.size, of: items.length }))}</span>
        <span class="half">${icon("fa-scale-balanced")} ${esc(t("HalfPrice"))}</span>
      </header>
      <div class="lucd20-sell-scroll">${body}</div>
      <footer class="lucd20-loot-footer lucd20-sell-footer">
        <span class="lucd20-sell-total"><span class="label">${esc(t("TotalLabel"))}</span> <b>${esc(total ? priceText(total) : "—")}</b></span>
        <button type="button" class="ll-btn ll-btn-footer" data-action="cancel">${icon("fa-xmark")}<span>${esc(t("Cancel"))}</span></button>
        <button type="button" class="ll-btn ll-btn-footer ll-btn-primary" data-action="sell" ${count ? "" : "disabled"}>${icon("fa-hand-holding-dollar")}<span>${esc(count ? t("SellN", { count }) : t("SellSelected"))}</span></button>
      </footer></div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    const all = content.querySelector("input.pick-all");
    if (all && this.picked.size && !all.checked) all.indeterminate = true;
    all?.addEventListener("change", () => (this.picked.size ? SellWindow.#onNone.call(this) : SellWindow.#onAll.call(this)));
    for (const row of content.querySelectorAll(".lucd20-sell-row")) {
      const id = row.dataset.itemId;
      const qty = row.querySelector("input.qty-in");
      row.querySelector("input.pick").addEventListener("change", ev => {
        if (ev.target.checked) this.picked.set(id, Number(qty?.value) || 1);
        else this.picked.delete(id);
        this.render();
      });
      qty?.addEventListener("change", () => {
        const max = Number(qty.max) || 1;
        const n = Math.min(max, Math.max(1, Math.round(Number(qty.value) || 1)));
        this.picked.set(id, n); // changing how many also picks it
        this.render();
      });
    }
  }

  static #onAll() {
    for (const i of this.items()) this.picked.set(i.id, i.quantity ?? i.system?.quantity ?? 1);
    this.render();
  }

  static #onCancel() {
    this.close();
  }

  static #onNone() {
    this.picked.clear();
    this.render();
  }

  static async #onSell() {
    const total = this.total();
    const count = [...this.picked.values()].reduce((s, n) => s + n, 0);
    if (!count) return;
    const ok = await DialogV2.confirm({
      window: { title: t("SellAllTitle") },
      content: `<p>${esc(t("SellSelectedConfirm", { count, price: priceText(total) }))}</p>`,
      rejectClose: false
    });
    if (!ok) return;
    const lines = [];
    for (const [id, n] of [...this.picked]) {
      const item = this.actor.items.get(id);
      if (!item) continue;
      const coins = await sellItem(item, n, { chat: false });
      if (coins) lines.push(`<li>${itemLink(item)}${n > 1 ? ` ×${n}` : ""}: ${esc(priceText(coins))}</li>`);
    }
    this.picked.clear();
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="lucd20-sell-all"><p><i class="fa-solid fa-hand-holding-dollar"></i> ${esc(t("SoldAll", { count: lines.length, price: priceText(total) }))}</p><details><summary>${esc(t("Items"))}</summary><ul>${lines.join("")}</ul></details></div>`
    });
    this.render();
  }
}

async function onSellAllClick(event, actor) {
  event.preventDefault();
  event.stopPropagation();
  const items = (actor.items.contents ?? []).filter(i => isSellable(i) && copper(halfPrice(i)) > 0);
  if (!items.length) return ui.notifications.info(t("NothingToSell"));
  const total = items.map(i => halfPrice(i)).reduce((a, b) => a.plus(b));
  const ok = await DialogV2.confirm({
    window: { title: t("SellAllTitle") },
    content: `<p>${esc(t("SellAllConfirm", { count: items.length, price: priceText(total) }))}</p>`,
    rejectClose: false
  });
  if (ok) await sellAllEquipment(actor);
}

function onRenderSheet(sheet, html) {
  const actor = sheet.actor ?? sheet.document;
  const root = html?.[0] ?? html?.element ?? html ?? sheet.element?.[0] ?? sheet.element;
  if (!actor?.isOwner || !(root instanceof HTMLElement)) return;
  if (!["character", "loot", "party", "npc", "familiar"].includes(actor.type)) return;
  // A Sell icon on each sellable item's row.
  for (const row of root.querySelectorAll("li[data-item-id]")) {
    const item = actor.items.get(row.dataset.itemId);
    if (!isSellable(item)) continue;
    const controls = row.querySelector(".item-controls");
    if (!controls || controls.querySelector(".lucd20-sell")) continue;
    const a = document.createElement("a");
    a.className = "lucd20-sell";
    a.dataset.tooltip = t("SellTooltip", { price: priceText(halfPrice(item)) });
    a.setAttribute("aria-label", t("Sell"));
    a.innerHTML = '<i class="fa-solid fa-hand-holding-dollar fa-fw"></i>';
    a.addEventListener("click", ev => onSellClick(ev, actor, item.id));
    const edit = controls.querySelector('[data-action="edit-item"]');
    if (edit) edit.before(a);
    else controls.prepend(a);
  }
  // Characters (and NPCs, familiars): "Sell items" (the window) next to PF2e's coin buttons (owner, v0.84.3).
  if (actor.type !== "loot" && actor.type !== "party") {
    const coinList = (root.querySelector('[data-action="sell-all-treasure"]') ?? root.querySelector('[data-action="add-coins"]'))?.closest("li")?.parentElement;
    if (coinList && !coinList.querySelector(".lucd20-sell-items-btn")) {
      const li = document.createElement("li");
      li.dataset.tooltip = t("WindowTooltip");
      li.innerHTML = `<button type="button" class="lucd20-sell-items-btn" aria-label="${esc(t("WindowTooltip"))}"><i class="fa-solid fa-hand-holding-dollar fa-fw"></i></button>`;
      li.querySelector("button").addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); SellWindow.open(actor); });
      const after = root.querySelector('[data-action="sell-all-treasure"]')?.closest("li");
      if (after) after.after(li);
      else coinList.append(li);
    }
  }
  // Loot sheets: "Sell all equipment" next to PF2e's "Sell all treasure".
  if (actor.type === "loot") {
    const treasure = root.querySelector('[data-action="sell-all-treasure"]')?.closest("li");
    if (treasure && !root.querySelector(".lucd20-sell-all-btn")) {
      const li = document.createElement("li");
      li.dataset.tooltip = t("SellAllTooltip");
      li.innerHTML = `<button type="button" class="lucd20-sell-all-btn" aria-label="${esc(t("SellAllTooltip"))}"><i class="fa-solid fa-hand-holding-dollar fa-fw"></i></button>`;
      li.querySelector("button").addEventListener("click", ev => onSellAllClick(ev, actor));
      treasure.after(li);
    }
  }
}

defineFeature({
  id: "pf2eSell",
  category: "pf2e",
  systems: ["pf2e"],
  defaultEnabled: true,
  enable(feature) {
    feature.on("renderActorSheetPF2e", onRenderSheet);
    feature.on("renderActorSheetSF2e", onRenderSheet); // SF2e (verify the class name)
    for (const hook of ["updateItem", "deleteItem", "createItem"]) feature.on(hook, () => SellWindow.refresh());
    feature.onCleanup(() => document.querySelectorAll(".lucd20-sell, .lucd20-sell-all-btn, .lucd20-sell-items-btn").forEach(el => (el.closest("li:not([data-item-id])") ?? el).remove()));
    feature.onCleanup(() => foundry.applications.instances?.get(SellWindow.DEFAULT_OPTIONS.id)?.close());
  }
});
