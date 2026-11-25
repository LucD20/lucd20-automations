import { MODULE_ID, localize, systemMatches } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { broadcast, onBroadcast } from "../../core/socket.js";
import { addChatControl } from "../../core/chat-controls.js";
import { onEncounterEnd, ReportWindow, reportVisible } from "../encounter-report.js";
import { CARDS, RARITIES, cardById, cardNumber, computeStats, dealCards } from "./catalog.js";

/**
 * Combat Cards (owner, PLAN §26.8; v0.85.0). At the end of a recorded fight (the Encounter Report's
 * recording), every player character gets one card (catalog.js): the cards fill the screen for everyone,
 * flipping over one by one; after a few seconds the report fades in too (owner: "The cards first, then after
 * 5 seconds, the report fades in").
 * - Look: the approved mockup (docs/mockups/combat-cards*.html): foil card, gold ribbon title, numeral,
 *   rarity edge and badge; the actor's portrait fills the art window (owner: "Full portraits that fit");
 *   a picture on a light background is blended onto parchment.
 * - Foil the first time a character earns a card; later copies show the rarity colours only (owner).
 * - The collection is kept on each actor (`flags.lucd20-automations.cards`: card id → [{ at, scene, value,
 *   foil }]), so it follows the character. The Party Deck (owner: "a 'Party Deck' tab ... all cards gained,
 *   stacked by same type") shows the party's: a tab on PF2e's party sheet, and a window from the chat
 *   buttons (every system). Cards not yet earned stay a mystery: face down, rarity only (owner).
 * - GM: grant or remove cards from the Deck (corrections).
 */

const FLAG = "cards";
const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const t = (key, data) => localize(`LUCD20.CombatCards.${key}`, data);
const ct = (id, key, data) => localize(`LUCD20.CombatCards.Card.${id}.${key}`, data);
const state = { feature: null, overlay: null, timers: [] };

/** Cards that can trigger in this system (pf2 cards need PF2e / SF2e roll data). */
const playable = () => CARDS.filter(c => !c.pf2 || systemMatches("pf2e"));

/* -------------------------------------------- */
/*  A card                                      */
/* -------------------------------------------- */

/**
 * The card's HTML. c = { card (id), value, name, portrait, foil, quote (1 | 2) }.
 */
export function cardHTML(c, { you = false, extra = "" } = {}) {
  const def = cardById(c.card);
  if (!def) return "";
  const title = ct(c.card, "Name");
  const size = title.length > 16 ? "is-long" : title.length > 12 ? "is-mid" : "";
  const art = c.portrait
    ? `<div class="lcc-art"><img src="${esc(c.portrait)}" alt=""></div>`
    : `<div class="lcc-art is-empty"><i class="fa-solid fa-user"></i></div>`;
  return `<div class="lcc-card is-${def.rarity} ${c.foil ? "is-foil" : "is-plain"} ${extra}" data-card="${esc(c.card)}">
    ${you ? `<span class="lcc-you">${esc(t("You"))}</span>` : ""}
    <div class="lcc-inner">${art}
      <div class="lcc-banner ${size}">${esc(title)}</div>
      <div class="lcc-body"><div class="lcc-who">${esc(c.name ?? "")}</div>
        <div class="lcc-stat">${esc(c.value ?? "")}<small>${esc(ct(c.card, "Stat"))}</small></div>
        <div class="lcc-quote">“${esc(ct(c.card, c.quote === 2 ? "Q2" : "Q1"))}”</div></div>
    </div>
    <div class="lcc-sheen"></div>
    <span class="lcc-num">#${cardNumber(c.card)}</span><span class="lcc-rarity">${esc(t(`Rarity.${def.rarity}`))}</span>
  </div>`;
}

/** A title too wide for its ribbon shrinks until it fits (fonts differ between systems). */
function fitBanners(root) {
  for (const el of root.querySelectorAll(".lcc-banner")) {
    let size = parseFloat(getComputedStyle(el).fontSize) || 20;
    for (let i = 0; i < 12 && el.scrollWidth > el.clientWidth + 1 && size > 11; i++) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
  }
}

/**
 * A portrait on a light, opaque background (white paper) is blended onto parchment instead of showing a
 * white block. Sampled once per picture (its corners).
 */
const lightCache = new Map();
function markLight(root) {
  requestAnimationFrame(() => fitBanners(root));
  for (const img of root.querySelectorAll(".lcc-art img")) {
    const apply = light => img.closest(".lcc-art")?.classList.toggle("is-light", !!light);
    if (lightCache.has(img.src)) { apply(lightCache.get(img.src)); continue; }
    const test = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 16;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0, 16, 16);
        const px = [[0, 0], [15, 0], [0, 15], [15, 15], [8, 0]].map(([x, y]) => g.getImageData(x, y, 1, 1).data);
        const light = px.every(d => d[3] > 240 && (d[0] + d[1] + d[2]) / 3 > 225);
        lightCache.set(img.src, light);
        apply(light);
      } catch { lightCache.set(img.src, false); }
    };
    if (img.complete && img.naturalWidth) test();
    else img.addEventListener("load", test, { once: true });
  }
}

/* -------------------------------------------- */
/*  Dealing (active GM, end of a fight)         */
/* -------------------------------------------- */

async function onEnd(data, entry) {
  if (!state.feature?.active) return false;
  const dealt = dealCards(data);
  if (!dealt.length) return false;
  const p = Object.fromEntries((data.participants ?? []).map(x => [x.uuid, x]));
  const cards = [];
  for (const d of dealt) {
    const actor = globalThis.fromUuidSync?.(d.uuid) ?? null;
    const before = actor?.getFlag?.(MODULE_ID, FLAG)?.[d.card] ?? [];
    const foil = before.length === 0;
    if (actor?.update) {
      try {
        await actor.update({ [`flags.${MODULE_ID}.${FLAG}.${d.card}`]: [...before, { at: entry.at, scene: entry.scene ?? "", value: d.value, foil }] });
      } catch (err) { console.error("lucd20-automations | Combat Cards: saving", err); }
    }
    cards.push({ uuid: d.uuid, card: d.card, value: d.value, foil, name: p[d.uuid]?.name ?? actor?.name ?? "", portrait: p[d.uuid]?.portrait ?? actor?.img ?? null, quote: Math.random() < 0.5 ? 1 : 2 });
  }
  entry.cards = cards;
  entry.won = computeStats(data).party.won;
  const payload = { cards, scene: entry.scene ?? "", rounds: entry.rounds ?? null, won: entry.won };
  broadcast("combatCards.show", payload);
  show(payload);
  return true;
}

/* -------------------------------------------- */
/*  The overlay                                 */
/* -------------------------------------------- */

function closeOverlay() {
  state.overlay?.remove();
  state.overlay = null;
}

/** The cards on screen, then the report fades in after the delay (if this user sees it). */
export function show(payload) {
  closeOverlay();
  for (const id of state.timers) clearTimeout(id);
  state.timers = [];
  const mine = c => { const a = globalThis.fromUuidSync?.(c.uuid); return !game.user.isGM && (a?.isOwner || game.user.character?.uuid === c.uuid); };
  const rounds = payload.rounds === 1 ? t("RoundOne") : t("RoundsN", { n: payload.rounds ?? "?" });
  const el = document.createElement("div");
  el.id = "lucd20-combat-cards";
  el.className = "lucd20-combat-cards";
  el.innerHTML = `<div class="lcc-stage" role="dialog" aria-label="${esc(t("Title"))}">
      <div class="lcc-heading"><div class="lcc-kicker">${esc([payload.scene, rounds].filter(Boolean).join(" · "))}</div>
        <div class="lcc-title">${esc(payload.won ? t("Victory") : t("BattleOver"))}</div></div>
      <div class="lcc-row">${payload.cards.map((c, i) => cardHTML(c, { you: mine(c), extra: "lcc-deal" }).replace('class="lcc-card', `style="--i:${i}" class="lcc-card`)).join("")}</div>
      <button type="button" class="lcc-close"><i class="fa-solid fa-xmark"></i> ${esc(t("Close"))}</button>
    </div>`;
  el.addEventListener("click", ev => { if (ev.target === el || ev.target.closest(".lcc-close")) closeOverlay(); });
  document.body.append(el);
  state.overlay = el;
  markLight(el);
  const delay = Number(state.feature?.get?.("reportDelay") ?? 5);
  if (delay >= 0) state.timers.push(setTimeout(() => {
    if (!reportVisible()) return;
    const app = ReportWindow.open();
    // Above the cards (they sit over Foundry's windows), fading in.
    Promise.resolve(app).then(a => { if (a?.element) { a.element.classList.add("lucd20-fade-in"); a.element.style.zIndex = "1001"; } }).catch(() => {});
  }, delay * 1000));
}

/* -------------------------------------------- */
/*  The Party Deck                              */
/* -------------------------------------------- */

/** The party: PF2e's active party, else every player-owned character. */
function partyMembers() {
  const party = game.actors?.party;
  const members = party?.members?.filter(a => a?.hasPlayerOwner) ?? [];
  if (members.length) return members;
  return (game.actors?.contents ?? [...(game.actors ?? [])]).filter(a => a.hasPlayerOwner && (a.type === "character" || a.type === "Player Character"));
}

const collectionOf = actor => actor?.getFlag?.(MODULE_ID, FLAG) ?? {};

/** Stacks: card id → { def, copies: [{ actor, at, scene, value, foil }] } (newest last). */
function stacksFor(actors) {
  const stacks = new Map();
  for (const actor of actors) {
    for (const [id, list] of Object.entries(collectionOf(actor))) {
      if (!cardById(id) || !Array.isArray(list)) continue;
      const s = stacks.get(id) ?? { def: cardById(id), copies: [] };
      for (const c of list) s.copies.push({ actor, ...c });
      stacks.set(id, s);
    }
  }
  for (const s of stacks.values()) s.copies.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  return stacks;
}

const deckState = { who: "all", sort: "rarity", unknown: true, selected: null };

export function deckHTML(view = deckState) {
  const members = partyMembers();
  const shown = view.who === "all" ? members : members.filter(a => a.uuid === view.who);
  const stacks = stacksFor(shown);
  const cards = playable();
  const found = cards.filter(c => stacks.has(c.id)).length;
  const perRarity = RARITIES.map(r => `<span class="lpd-chip is-${r}"><b>${cards.filter(c => c.rarity === r && stacks.has(c.id)).length}</b> / ${cards.filter(c => c.rarity === r).length} ${esc(t(`Rarity.${r}`))}</span>`).join("");
  const face = a => `<img src="${esc(a.img)}" alt="" data-tooltip="${esc(a.name)}">`;
  const people = `<span class="lpd-people"><button type="button" class="lpd-person ${view.who === "all" ? "is-on" : ""}" data-who="all">${esc(t("All"))}</button>${members.map(a => `<button type="button" class="lpd-person ${view.who === a.uuid ? "is-on" : ""}" data-who="${esc(a.uuid)}">${face(a)}</button>`).join("")}</span>`;
  const sorts = ["rarity", "count", "newest"].map(k => `<button type="button" class="lpd-chip lpd-sort ${view.sort === k ? "is-on" : ""}" data-sort="${k}">${esc(t(`Sort.${k}`))}</button>`).join("");
  let list = cards.filter(c => view.unknown || stacks.has(c.id));
  const newest = id => stacks.get(id)?.copies.at(-1)?.at ?? 0;
  const count = id => stacks.get(id)?.copies.length ?? 0;
  if (view.sort === "count") list.sort((a, b) => count(b.id) - count(a.id) || cardNumber(a.id) - cardNumber(b.id));
  else if (view.sort === "newest") list.sort((a, b) => newest(b.id) - newest(a.id) || cardNumber(a.id) - cardNumber(b.id));
  else list.sort((a, b) => RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity) || cardNumber(a.id) - cardNumber(b.id));
  const tiles = list.map(def => {
    const s = stacks.get(def.id);
    if (!s) return `<div class="lpd-stack is-unknown"><div class="lpd-back is-${def.rarity}"><div><i class="fa-solid fa-question"></i><b>???</b><small>${esc(t(`Rarity.${def.rarity}`))}</small></div></div></div>`;
    const topCopy = s.copies.find(c => c.foil) ?? s.copies[0];
    const n = s.copies.length;
    const owners = new Map();
    for (const c of s.copies) owners.set(c.actor, (owners.get(c.actor) ?? 0) + 1);
    const backs = n > 2 ? '<span class="lpd-b2"></span><span class="lpd-b1"></span>' : n > 1 ? '<span class="lpd-b1"></span>' : "";
    return `<div class="lpd-stack is-${def.rarity} ${view.selected === def.id ? "is-selected" : ""}" data-card="${esc(def.id)}" role="button" tabindex="0">
      ${backs}${cardHTML({ card: def.id, value: topCopy.value, name: topCopy.actor.name, portrait: topCopy.actor.img, foil: !!topCopy.foil, quote: 1 }, { extra: "lpd-face" })}
      ${n > 1 ? `<span class="lpd-count">×${n}</span>` : ""}
      <span class="lpd-owners">${[...owners].map(([a, k]) => `<span>${face(a)}${k > 1 ? `<i>${k}</i>` : ""}</span>`).join("")}</span>
    </div>`;
  }).join("");
  return `<div class="lucd20-party-deck">
    <div class="lpd-main">
      <div class="lpd-top"><h3>${esc(t("DeckTitle"))}</h3><span class="lpd-found">${esc(t("Discovered", { n: found, of: cards.length }))}</span>
        <span class="lpd-meter"><span style="width:${Math.round((found / Math.max(1, cards.length)) * 100)}%"></span></span></div>
      <div class="lpd-chips">${perRarity}${people}</div>
      <div class="lpd-chips">${sorts}<button type="button" class="lpd-chip lpd-unknown ${view.unknown ? "is-on" : ""}">${esc(t("ShowUnknown"))}</button></div>
      ${members.length ? `<div class="lpd-stacks">${tiles}</div>` : `<p class="lpd-empty">${esc(t("NoParty"))}</p>`}
    </div>
    ${detailHTML(view.selected ? stacks.get(view.selected) : null)}
  </div>`;
}

function detailHTML(stack) {
  if (!stack) return `<aside class="lpd-side is-empty"><i class="fa-solid fa-layer-group"></i><p>${esc(t("PickACard"))}</p></aside>`;
  const id = stack.def.id;
  const top = stack.copies.find(c => c.foil) ?? stack.copies[0];
  const rows = [...stack.copies].reverse().map(c => `<li><img src="${esc(c.actor.img)}" alt="">
      <span class="lpd-t"><b>${esc(c.actor.name)} ${c.foil ? `<span class="lpd-foilmark">${esc(t("Foil"))}</span>` : ""}</b><span>${esc([c.scene || t("NoScene"), c.at ? new Date(c.at).toLocaleDateString() : ""].filter(Boolean).join(" · "))}</span></span>
      <span class="lpd-n">${esc(c.value ?? "")}</span>
      ${game.user.isGM ? `<button type="button" class="lpd-remove" data-actor="${esc(c.actor.uuid)}" data-at="${esc(c.at ?? "")}" data-tooltip="${esc(t("Remove"))}"><i class="fa-solid fa-trash"></i></button>` : ""}</li>`).join("");
  return `<aside class="lpd-side">
    <div class="lpd-big">${cardHTML({ card: id, value: top.value, name: top.actor.name, portrait: top.actor.img, foil: !!top.foil, quote: 1 })}</div>
    <p class="lpd-rule"><b>#${cardNumber(id)} ${esc(ct(id, "Name"))}</b> · ${esc(t(`Rarity.${stack.def.rarity}`))}<br>${esc(ct(id, "Rule"))}</p>
    <h4>${esc(t("EarnedTimes", { n: stack.copies.length }))}</h4><ol>${rows}</ol>
    ${game.user.isGM ? `<div class="lpd-gm"><button type="button" class="lpd-grant" data-card="${esc(id)}"><i class="fa-solid fa-plus"></i> ${esc(t("Grant"))}</button></div>` : ""}
  </aside>`;
}

/** Clicks inside a drawn deck (window or sheet tab); `redraw()` draws it again. */
function bindDeck(root, redraw) {
  root.addEventListener("click", async ev => {
    const el = ev.target.closest("[data-who], [data-sort], .lpd-unknown, .lpd-stack[data-card], .lpd-remove, .lpd-grant");
    if (!el || !root.contains(el)) return;
    ev.preventDefault();
    if (el.dataset.who) deckState.who = el.dataset.who;
    else if (el.dataset.sort) deckState.sort = el.dataset.sort;
    else if (el.classList.contains("lpd-unknown")) deckState.unknown = !deckState.unknown;
    else if (el.classList.contains("lpd-remove")) await removeCopy(el.dataset.actor, Number(el.dataset.at));
    else if (el.classList.contains("lpd-grant")) await grant(el.dataset.card);
    else if (el.classList.contains("lpd-stack")) deckState.selected = deckState.selected === el.dataset.card ? null : el.dataset.card;
    redraw();
  });
}

async function removeCopy(actorUuid, at) {
  if (!game.user.isGM) return;
  const actor = globalThis.fromUuidSync?.(actorUuid);
  const id = deckState.selected;
  const list = [...(collectionOf(actor)[id] ?? [])];
  const i = list.findIndex(c => (c.at ?? 0) === at);
  if (!actor || i < 0) return;
  const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: t("Remove") }, content: `<p>${esc(t("RemoveConfirm", { card: ct(id, "Name"), name: actor.name }))}</p>`, rejectClose: false });
  if (!ok) return;
  list.splice(i, 1);
  if (list.length && !list.some(c => c.foil)) list[0] = { ...list[0], foil: true };
  await actor.update(list.length ? { [`flags.${MODULE_ID}.${FLAG}.${id}`]: list } : { [`flags.${MODULE_ID}.${FLAG}.-=${id}`]: null });
}

async function grant(id) {
  if (!game.user.isGM || !cardById(id)) return;
  const members = partyMembers();
  if (!members.length) return;
  const uuid = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("Grant") },
    content: `<p>${esc(t("GrantWho", { card: ct(id, "Name") }))}</p><select name="who">${members.map(a => `<option value="${esc(a.uuid)}">${esc(a.name)}</option>`).join("")}</select>`,
    ok: { label: t("Grant"), callback: (ev, button) => button.form.elements.who.value },
    rejectClose: false
  });
  const actor = uuid ? globalThis.fromUuidSync?.(uuid) : null;
  if (!actor) return;
  const list = collectionOf(actor)[id] ?? [];
  await actor.update({ [`flags.${MODULE_ID}.${FLAG}.${id}`]: [...list, { at: Date.now(), scene: t("Granted"), value: "", foil: list.length === 0 }] });
}

const { ApplicationV2 } = foundry.applications.api;

export class PartyDeckWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "lucd20-party-deck",
    classes: ["lucd20-loot-app", "lucd20-party-deck-app"],
    window: { title: "LUCD20.CombatCards.DeckTitle", icon: "fa-solid fa-layer-group", resizable: true },
    position: { width: 1000, height: 720 }
  };

  static open() {
    const app = foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id) ?? new this();
    return app.render({ force: true });
  }

  async _renderHTML() { return deckHTML(); }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    markLight(content);
    if (!this._bound) { this._bound = true; bindDeck(content, () => this.render()); }
  }
}

/** Redraw every open deck (window and sheet tabs) after a collection changes. */
function refreshDecks() {
  const app = foundry.applications.instances?.get(PartyDeckWindow.DEFAULT_OPTIONS.id);
  if (app?.rendered) app.render();
  for (const tab of document.querySelectorAll(".lucd20-deck-tab")) drawTab(tab);
}

function drawTab(tab) {
  tab.innerHTML = deckHTML();
  markLight(tab);
}

/**
 * PF2e's party sheet: a "Deck" tab next to its own (its nav's `a[data-tab]` and the `.tab[data-tab]` panes).
 * (verify) in PF2e 8.7: the party sheet's tab markup and group name.
 */
function onRenderPartySheet(sheet, html) {
  const actor = sheet.actor ?? sheet.document;
  if (actor?.type !== "party") return;
  const root = html?.[0] ?? html?.element ?? html ?? sheet.element?.[0] ?? sheet.element;
  if (!(root instanceof HTMLElement) || root.querySelector('[data-tab="lucd20-deck"]')) return;
  const nav = [...root.querySelectorAll("nav")].find(n => n.querySelector("[data-tab]"));
  const pane = root.querySelector(".tab[data-tab]");
  if (!nav || !pane) return;
  const sample = nav.querySelector("[data-tab]");
  const group = sample.dataset.group ?? pane.dataset.group ?? "";
  const link = document.createElement(sample.tagName.toLowerCase());
  link.className = sample.className.replace(/\bactive\b/g, "").trim();
  link.dataset.tab = "lucd20-deck";
  if (group) link.dataset.group = group;
  link.innerHTML = `<i class="fa-solid fa-layer-group"></i> ${esc(t("Tab"))}`;
  link.dataset.tooltip = t("DeckTitle");
  nav.append(link);
  const tab = document.createElement("div");
  tab.className = "tab lucd20-deck-tab lucd20-loot-app";
  tab.dataset.tab = "lucd20-deck";
  if (group) tab.dataset.group = group;
  pane.parentElement.append(tab);
  drawTab(tab);
  bindDeck(tab, () => drawTab(tab));
  const activate = () => {
    for (const el of nav.querySelectorAll("[data-tab]")) el.classList.toggle("active", el === link);
    for (const el of pane.parentElement.querySelectorAll(":scope > .tab[data-tab]")) el.classList.toggle("active", el === tab);
    sheet._lucd20DeckOpen = true;
  };
  link.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); activate(); });
  for (const other of nav.querySelectorAll("[data-tab]")) if (other !== link) other.addEventListener("click", () => { sheet._lucd20DeckOpen = false; link.classList.remove("active"); tab.classList.remove("active"); });
  if (sheet._lucd20DeckOpen) activate();
}

defineFeature({
  id: "combatCards",
  category: "combat",
  defaultEnabled: true,
  settings: {
    reportDelay: { kind: "range", min: 0, max: 20, step: 1, default: 5 }
  },
  init() {
    onBroadcast("combatCards.show", payload => { if (state.feature?.active && payload?.cards?.length) show(payload); });
  },
  enable(feature) {
    state.feature = feature;
    feature.onCleanup(onEncounterEnd(onEnd));
    feature.onCleanup(closeOverlay);
    feature.onCleanup(addChatControl({
      id: "combatCardsDeck", icon: "fa-solid fa-layer-group", tooltip: t("DeckTitle"), order: 42,
      visible: () => true,
      onClick: () => PartyDeckWindow.open()
    }));
    feature.onCleanup(() => foundry.applications.instances?.get(PartyDeckWindow.DEFAULT_OPTIONS.id)?.close());
    feature.onCleanup(() => document.querySelectorAll('.lucd20-deck-tab, [data-tab="lucd20-deck"]').forEach(el => el.remove()));
    feature.on("renderPartySheetPF2e", onRenderPartySheet);
    feature.on("renderActorSheetPF2e", onRenderPartySheet);
    let timer = null;
    feature.on("updateActor", (actor, change) => {
      const mine = change?.flags?.[MODULE_ID] ?? {};
      const touched = Object.keys(mine).some(k => k.startsWith(FLAG) || k.startsWith(`-=${FLAG}`)) || Object.keys(change ?? {}).some(k => k.startsWith(`flags.${MODULE_ID}.${FLAG}`));
      if (!touched) return;
      clearTimeout(timer);
      timer = setTimeout(refreshDecks, 100);
    });
    const onKey = ev => { if (ev.key === "Escape" && state.overlay) closeOverlay(); };
    document.addEventListener("keydown", onKey);
    feature.onCleanup(() => document.removeEventListener("keydown", onKey));
  }
});

export const _test = { show, deckHTML, cardHTML, onEnd, PartyDeckWindow, onRenderPartySheet, deckState };
