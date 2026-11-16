import { MODULE_ID, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { appElement, appHeader, openAppWindows } from "../../core/dom.js";
import { watchDOM } from "../../core/dom-watch.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { cleanPurse, emptyPurse, isEmptyPurse } from "../../core/coins.js";
import { lootApi, registerLootAdapter } from "../../features/loot-pile.js";

/*
 * D&D 4e: loot, the Party Stash and coin tracking.
 *
 * - Loot adapter. 4e keeps coins as five numbers on the actor (ad, pp, gp, sp, cp), characters and
 *   NPCs alike, and has no loot or party actor. So a pile and the Party Stash are NPC-type actors
 *   flagged by the module, their coins are their own coin numbers, a split adds to each character's
 *   numbers, and the fallen's coins are offered in "Loot the fallen". 10 cp = 1 sp, 10 sp = 1 gp,
 *   100 gp = 1 pp, 100 pp = 1 ad.
 * - Party Stash window (feature dnd4ePartyStash): laid out like a character sheet in the colours and
 *   type of the 4e books (and of Fox's 4e Styling, whose fonts it uses when that module is active),
 *   with a dark variant. Coins in boxes and the ledger on the left, items by tab on the right. Anyone
 *   takes from it; the GM gives and splits its coins. Opened from the Actors sidebar.
 * - Coin tracking (feature dnd4eCoinLog): every change to a player character's coins or the stash's,
 *   however it was made, goes to that actor's ledger and to chat (whispered to the GM and the
 *   character's owners; the stash's to everyone). A "Coin log" button sits in each character sheet's
 *   title bar.
 *
 * Ledgers are an array on the actor (flag `ledger`, newest last, 200 entries): { t, kind: "coins" |
 * "take" | "add", user, delta, total, reason, item, n, actor }. Written by the active GM's client.
 */

const DENOMINATIONS = [
	{ id: "ad", value: 1000000 }, { id: "pp", value: 10000 }, { id: "gp", value: 100 }, { id: "sp", value: 10 }, { id: "cp", value: 1 }
];
const LOOT_TYPES = new Set(["weapon", "equipment", "consumable", "tool", "loot", "backpack"]);
const PC = "Player Character";
const LEDGER = "ledger";
const LEDGER_MAX = 200;
const REASON = "lucd20CoinReason";
const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const { ApplicationV2 } = foundry.applications.api;
const L = (key, data) => localize(`LUCD20.PartyStash.${key}`, data);
const icon = name => `<i class="fa-solid ${name}" aria-hidden="true"></i>`;

const state = { stash: null, coins: null, cache: new Map() };

/* -------------------------------------------- */
/*  Loot adapter                                */
/* -------------------------------------------- */

const coinsOf = actor => cleanPurse(actor?.system?.currency ?? {}, DENOMINATIONS);

function writeCoins(actor, purse, reason) {
	const update = Object.fromEntries(DENOMINATIONS.map(d => [`system.currency.${d.id}`, purse[d.id]]));
	return actor.update(update, { [REASON]: reason ?? null });
}

function addCoins(actor, purse, reason) {
	const now = coinsOf(actor);
	return writeCoins(actor, Object.fromEntries(DENOMINATIONS.map(d => [d.id, now[d.id] + (Number(purse?.[d.id]) || 0)])), reason);
}

function removeCoins(actor, purse, reason) {
	const now = coinsOf(actor);
	return writeCoins(actor, Object.fromEntries(DENOMINATIONS.map(d => [d.id, Math.max(0, now[d.id] - (Number(purse?.[d.id]) || 0))])), reason);
}

const isStash = actor => !!actor?.getFlag?.(MODULE_ID, "partyStash");
const playerCharacters = () => game.actors.filter(a => a.type === PC && a.hasPlayerOwner).sort((a, b) => a.name.localeCompare(b.name));

registerLootAdapter({
	system: "dnd4e",
	pileType: "NPC",
	isLoot: item => LOOT_TYPES.has(item.type),
	isCoins: () => false,
	level: actor => Number(actor.system?.details?.level) || 0,
	denominations: DENOMINATIONS,
	coinsOnActor: true,
	coinsOf,
	addCoins,
	removeCoins,
	setCoins: (actor, purse, reason) => writeCoins(actor, cleanPurse(purse, DENOMINATIONS), reason),
	characters: playerCharacters,
	// Items into or out of the Party Stash go to its ledger.
	onHandOut({ source, stash, given }) {
		const entries = [];
		for (const [destination, moved] of given) {
			for (const { item, n } of moved) {
				if (isStash(source) && destination !== source) entries.push({ kind: "take", item: item.name, n, actor: destination.name });
				else if (destination === stash && !isStash(source)) entries.push({ kind: "add", item: item.name, n, actor: source.name });
			}
		}
		const ledgerOf = isStash(source) ? source : stash;
		if (entries.length && ledgerOf) addEntries(ledgerOf, entries);
	}
});

/* -------------------------------------------- */
/*  Ledgers                                     */
/* -------------------------------------------- */

const entriesOf = actor => actor?.getFlag(MODULE_ID, LEDGER) ?? [];

/** Append to an actor's ledger (the active GM's client only: one writer). */
async function addEntries(actor, entries, userId = game.user.id) {
	if (!game.user.isActiveGM || !entries.length) return;
	const stamped = entries.map(e => ({ t: Date.now(), user: userId, ...e }));
	await actor.update({ [`flags.${MODULE_ID}.${LEDGER}`]: [...entriesOf(actor), ...stamped].slice(-LEDGER_MAX) });
}

const signed = n => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);
const deltaText = delta => DENOMINATIONS.filter(d => delta?.[d.id]).map(d => `${signed(delta[d.id])} ${d.id}`).join(", ");
const purseText = purse => DENOMINATIONS.filter(d => purse?.[d.id] > 0).map(d => `${purse[d.id]} ${d.id}`).join(" ") || "0";
const reasonText = reason => (reason ? L(`Reason.${reason}`) : "");

/** A ledger line as text: { who, what }. */
function entryText(entry) {
	const many = entry.n > 1 ? ` ×${entry.n}` : "";
	if (entry.kind === "take") return { who: entry.actor, what: L("EntryTook", { item: `${entry.item}${many}` }) };
	if (entry.kind === "add") return { who: entry.actor, what: L("EntryAdded", { item: `${entry.item}${many}` }) };
	const reason = reasonText(entry.reason);
	return { who: L("Coins"), what: `${deltaText(entry.delta)}${reason ? ` · ${reason}` : ""}` };
}

function ago(t) {
	const minutes = Math.round((Date.now() - t) / 60000);
	if (minutes < 1) return L("JustNow");
	if (minutes < 60) return L("MinutesAgo", { n: minutes });
	if (minutes < 60 * 24) return L("HoursAgo", { n: Math.round(minutes / 60) });
	return new Date(t).toLocaleDateString();
}

const themeClass = () => (document.body.classList.contains("theme-dark") ? "is-dark" : "");

class LedgerWindow extends ApplicationV2 {
	static DEFAULT_OPTIONS = {
		classes: ["lucd20-stash", "lucd20-stash-ledger"],
		window: { icon: "fa-solid fa-scroll", resizable: true },
		position: { width: 460, height: 520 }
	};

	static open(actor) {
		const id = `lucd20-ledger-${actor.id}`;
		return (foundry.applications.instances?.get(id) ?? new this({ id, actorUuid: actor.uuid })).render({ force: true });
	}

	constructor(options) {
		super(options);
		this.actor = fromUuidSync(options.actorUuid);
	}

	get title() {
		return L(isStash(this.actor) ? "LedgerTitle" : "CoinLogTitle", { name: this.actor?.name ?? "" });
	}

	async _renderHTML() {
		const rows = [...entriesOf(this.actor)].reverse().map(entry => {
			const { who, what } = entryText(entry);
			const total = entry.kind === "coins" ? `<span class="total">${esc(L("Now", { coins: purseText(entry.total) }))}</span>` : "";
			return `<li><span class="when" data-tooltip="${esc(new Date(entry.t).toLocaleString())}">${esc(ago(entry.t))}</span>
				<span class="what"><b>${esc(who)}</b> ${esc(what)}${total}</span>
				<span class="by">${esc(game.users.get(entry.user)?.name ?? "")}</span></li>`;
		}).join("");
		return `<div class="ls-page ${themeClass()}"><h1>${esc(this.title)}</h1>
			${rows ? `<ol class="ls-ledger-full">${rows}</ol>` : `<p class="ls-empty">${L("LedgerEmpty")}</p>`}</div>`;
	}

	_replaceHTML(result, content) {
		content.innerHTML = result;
	}
}

/* -------------------------------------------- */
/*  Coin tracking                               */
/* -------------------------------------------- */

const tracked = actor => isStash(actor) || (actor?.type === PC && actor.hasPlayerOwner);

function snapshot() {
	state.cache.clear();
	for (const actor of game.actors ?? []) if (tracked(actor)) state.cache.set(actor.id, coinsOf(actor));
}

/** After any update: if a tracked actor's coins changed, log it and say so in chat (the active GM's client). */
async function onActorUpdate(actor, change, options, userId) {
	if (!tracked(actor)) return;
	const now = coinsOf(actor);
	const before = state.cache.get(actor.id) ?? now;
	state.cache.set(actor.id, now);
	if (!game.user.isActiveGM) return;
	const delta = {};
	for (const d of DENOMINATIONS) if (now[d.id] !== before[d.id]) delta[d.id] = now[d.id] - before[d.id];
	if (!Object.keys(delta).length) return;
	const reason = options?.[REASON] ?? null;
	await addEntries(actor, [{ kind: "coins", delta, total: now, reason }], userId);

	const who = game.users.get(userId)?.name ?? "";
	const why = reasonText(reason);
	const content = `<p class="lucd20-coin-change"><i class="fa-solid fa-coins"></i> <strong>${esc(actor.name)}</strong>: ${esc(deltaText(delta))}
		<span class="now">(${esc(L("Now", { coins: purseText(now) }))})</span><span class="by">${esc([why, who].filter(Boolean).join(" · "))}</span></p>`;
	// A character's purse is between the GM and its owners; the stash is everyone's.
	const whisper = isStash(actor) ? [] : game.users.filter(u => u.isGM || actor.testUserPermission(u, "OWNER")).map(u => u.id);
	await ChatMessage.create({ content, whisper, speaker: { alias: L("CoinsSpeaker") } });
}

/** "Coin log" in the title bar of every player character sheet this user owns. */
function drawSheetButtons() {
	for (const app of openAppWindows()) {
		const actor = app.document ?? app.actor ?? app.object;
		if (actor?.documentName !== "Actor" || actor.type !== PC || !actor.isOwner) continue;
		const header = appHeader(app);
		if (!header || header.querySelector(".lucd20-coin-log")) continue;
		const button = document.createElement("button");
		button.type = "button";
		button.className = "header-control icon fa-solid fa-coins lucd20-coin-log";
		button.dataset.tooltip = L("CoinLog");
		button.setAttribute("aria-label", L("CoinLog"));
		button.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();
			LedgerWindow.open(actor);
		});
		const close = header.querySelector('[data-action="close"], .close');
		if (close) close.before(button);
		else header.append(button);
	}
}

function refreshLedgers(actor) {
	const app = foundry.applications.instances?.get(`lucd20-ledger-${actor.id}`);
	if (app?.rendered) app.render();
}

defineFeature({
	id: "dnd4eCoinLog",
	category: "dnd4e",
	systems: ["dnd4e"],
	scope: "world",
	defaultEnabled: true,

	enable(feature) {
		state.coins = feature;
		snapshot();
		feature.on("updateActor", (actor, change, options, userId) => {
			onActorUpdate(actor, change, options, userId);
			if (change?.flags?.[MODULE_ID]?.[LEDGER] !== undefined) refreshLedgers(actor);
		});
		feature.on("createActor", actor => {
			if (tracked(actor)) state.cache.set(actor.id, coinsOf(actor));
		});
		feature.onCleanup(watchDOM("dnd4e-coin-log-buttons", drawSheetButtons));
		feature.onCleanup(() => {
			document.querySelectorAll(".lucd20-coin-log").forEach(el => el.remove());
			for (const app of foundry.applications.instances?.values() ?? []) if (app instanceof LedgerWindow && !isStash(app.actor)) app.close();
			state.cache.clear();
			state.coins = null;
		});
	}
});

/* -------------------------------------------- */
/*  Party Stash window                          */
/* -------------------------------------------- */

const TABS = ["all", "arms", "magic", "consumables", "gear"];
const itemLevel = item => Number(item.system?.level) || 0;

function category(item) {
	if (item.type === "consumable") return "consumables";
	if (itemLevel(item) > 0) return "magic";
	if (item.type === "weapon" || item.type === "equipment") return "arms";
	return "gear";
}

function typeLabel(item) {
	const key = CONFIG.Item?.typeLabels?.[item.type];
	return key ? localize(key) : item.type;
}

class StashWindow extends ApplicationV2 {
	static DEFAULT_OPTIONS = {
		id: "lucd20-party-stash",
		classes: ["lucd20-stash"],
		window: { title: "LUCD20.PartyStash.Title", icon: "fa-solid fa-box-archive", resizable: true },
		position: { width: 680, height: 600 },
		actions: {
			tab: StashWindow.#onTab,
			take: StashWindow.#onTake,
			give: StashWindow.#onGive,
			splitEven: StashWindow.#onSplitEven,
			splitCustom: StashWindow.#onSplitCustom,
			ledger: StashWindow.#onLedger,
			sheet: StashWindow.#onSheet
		}
	};

	tab = "all";
	taker = null;
	stash = null;

	static get instance() {
		return foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id) ?? null;
	}

	static show() {
		return (this.instance ?? new this()).render({ force: true });
	}

	async _renderHTML() {
		// The stash is made the first time the GM opens it (or something is sent to it).
		this.stash = await lootApi.stashActor(game.user.isActiveGM);
		const stash = this.stash;
		const gm = game.user.isGM;
		if (!stash) return `<div class="ls-page ${themeClass()}"><p class="ls-empty">${L("NoStash")}</p></div>`;

		const takers = gm ? [] : lootApi.takers();
		if (!takers.some(a => a.uuid === this.taker)) this.taker = takers[0]?.uuid ?? null;
		const purse = coinsOf(stash);
		const boxes = DENOMINATIONS.map(d => `<div class="ls-box ls-coin-${d.id}"><b>${purse[d.id]}</b><span>${d.id}</span></div>`).join("");
		const recent = [...entriesOf(stash)].reverse().slice(0, 6).map(entry => {
			const { who, what } = entryText(entry);
			return `<li><b>${esc(who)}</b> ${esc(what)}<span>${esc(ago(entry.t))}</span></li>`;
		}).join("");

		const items = [...stash.items].filter(item => LOOT_TYPES.has(item.type)).sort((a, b) => a.name.localeCompare(b.name));
		const shown = items.filter(item => this.tab === "all" || category(item) === this.tab);
		const takeDisabled = this.taker ? "" : `disabled data-tooltip="${esc(L("NoCharacter"))}"`;
		const rows = shown.map(item => {
			const level = itemLevel(item);
			const quantity = Number(item.system?.quantity) || 1;
			const action = gm
				? `<button type="button" class="ls-btn ls-take" data-action="give">${icon("fa-user")} ${L("Give")}</button>`
				: `<button type="button" class="ls-btn ls-take" data-action="take" ${takeDisabled}>${icon("fa-hand")} ${L("Take")}</button>`;
			return `<li class="ls-item ${level > 0 ? "is-magic" : "is-mundane"}" data-item-id="${esc(item.id)}">
				<img src="${esc(item.img)}" alt="">
				<span class="n"><b>${esc(item.name)}</b><span>${esc(typeLabel(item))}${level > 0 ? ` · ${esc(L("Level", { level }))}` : ""}</span></span>
				<span class="q">${quantity > 1 ? `×${quantity}` : ""}</span>${action}</li>`;
		}).join("");
		const count = tab => (tab === "all" ? items.length : items.filter(item => category(item) === tab).length);
		const tabs = TABS.map(tab => `<a class="${tab === this.tab ? "is-on" : ""}" data-action="tab" data-tab="${tab}">${L(`Tab.${tab}`)}<span>${count(tab)}</span></a>`).join("");
		const takerHTML = takers.length > 1
			? `<label class="ls-taker">${L("TakingFor")} <select data-taker>${takers.map(a => `<option value="${esc(a.uuid)}" ${a.uuid === this.taker ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>`
			: takers.length === 1 ? `<span class="ls-taker">${L("TakingFor")} <b>${esc(takers[0].name)}</b></span>` : "";

		return `<div class="ls-page ls-stash ${themeClass()}">
			<aside>
				<h1>${L("TitleBreak")}</h1>
				<div class="ls-boxes">${boxes}</div>
				${gm ? `<div class="ls-gm">
					<button type="button" class="ls-btn" data-action="splitEven" ${isEmptyPurse(purse) ? "disabled" : ""}>${icon("fa-scale-balanced")} ${L("SplitEven")}</button>
					<button type="button" class="ls-btn" data-action="splitCustom" ${isEmptyPurse(purse) ? "disabled" : ""}>${icon("fa-sliders")} ${L("SplitCustom")}</button>
					<button type="button" class="ls-btn" data-action="sheet" data-tooltip="${esc(L("SheetHint"))}">${icon("fa-arrow-up-right-from-square")} ${L("Sheet")}</button>
				</div>` : ""}
				<h2>${L("Ledger")}</h2>
				${recent ? `<ol class="ls-ledger">${recent}</ol>` : `<p class="ls-none">${L("LedgerEmpty")}</p>`}
				<a class="ls-more" data-action="ledger">${L("OpenLedger")}</a>
			</aside>
			<main>
				<nav>${tabs}</nav>
				${takerHTML}
				<ol class="ls-items">${rows || `<li class="ls-none">${L(items.length ? "TabEmpty" : "Empty")}</li>`}</ol>
			</main>
		</div>`;
	}

	_replaceHTML(result, content) {
		const top = content.querySelector(".ls-items")?.scrollTop ?? 0;
		content.innerHTML = result;
		const list = content.querySelector(".ls-items");
		if (list) list.scrollTop = top;
		content.querySelector("[data-taker]")?.addEventListener("change", event => { this.taker = event.target.value; });
	}

	#item(target) {
		return this.stash?.items.get(target.closest("[data-item-id]")?.dataset.itemId);
	}

	/** "How many?" for a stack; Shift+click takes all of it. Null = cancelled. */
	async #quantity(item, event, name, verb) {
		const quantity = Number(item.system?.quantity) || 1;
		if (quantity <= 1 || event?.shiftKey) return quantity;
		return lootApi.QuantityWindow().wait(item, name, verb);
	}

	static #onTab(event, target) {
		this.tab = target.dataset.tab;
		return this.render();
	}

	static async #onTake(event, target) {
		const item = this.#item(target);
		if (!item || !this.taker) return;
		const quantity = await this.#quantity(item, event, fromUuidSync(this.taker)?.name, "Take");
		if (!quantity) return;
		target.disabled = true;
		try {
			await executeAsGM("partyStash.take", { itemId: item.id, target: this.taker, quantity });
		} catch (err) {
			ui.notifications.warn(err.message ?? String(err));
			target.disabled = false;
		}
	}

	static async #onGive(event, target) {
		const item = this.#item(target);
		if (!item) return;
		const to = await lootApi.GiveWindow().wait(item);
		if (!to) return;
		const quantity = await this.#quantity(item, event, fromUuidSync(to)?.name, "Give");
		if (quantity) await lootApi.handOut(this.stash, [{ itemId: item.id, target: to, quantity }]);
	}

	static #onSplitEven() {
		lootApi.SplitWindow().open(this.stash);
	}

	static #onSplitCustom() {
		lootApi.CustomSplitWindow().open(this.stash);
	}

	static #onLedger() {
		if (this.stash) LedgerWindow.open(this.stash);
	}

	static #onSheet() {
		this.stash?.sheet?.render(true);
	}
}

/** A player takes from the stash for a character they own (runs on the GM's client). */
async function takeFromStash({ itemId, target, quantity }, senderId) {
	const sender = game.users.get(senderId) ?? game.user;
	const stash = await lootApi.stashActor(false);
	if (!stash?.items.get(itemId)) throw new Error(L("Gone"));
	const actor = fromUuidSync(target);
	if (!actor || (!sender.isGM && !actor.testUserPermission(sender, "OWNER"))) throw new Error(L("NotYours"));
	return lootApi.handOut(stash, [{ itemId, target, quantity }]);
}

function refreshStash(document) {
	const actor = document?.documentName === "Actor" ? document : document?.parent;
	if (!isStash(actor)) return;
	const app = StashWindow.instance;
	if (app?.rendered) app.render();
	refreshLedgers(actor);
}

/** "Party Stash" at the bottom of the Actors tab, for everyone. */
function drawSidebarButton() {
	const root = appElement(ui.actors) ?? document.getElementById("actors");
	if (!root || root.querySelector(".lucd20-party-stash-open")) return;
	let footer = root.querySelector(".directory-footer");
	if (!footer) {
		footer = document.createElement("footer");
		footer.className = "directory-footer action-buttons lucd20-directory-footer";
		root.append(footer);
	}
	const button = document.createElement("button");
	button.type = "button";
	button.className = "lucd20-party-stash-open";
	button.innerHTML = `<i class="fa-solid fa-box-archive"></i> ${esc(L("Title"))}`;
	button.addEventListener("click", event => {
		event.preventDefault();
		StashWindow.show();
	});
	footer.append(button);
}

defineFeature({
	id: "dnd4ePartyStash",
	category: "dnd4e",
	systems: ["dnd4e"],
	scope: "world",
	defaultEnabled: true,

	init(feature) {
		onGMRequest("partyStash.take", (payload, senderId) => {
			if (!feature.active) throw new Error(L("Disabled"));
			return takeFromStash(payload, senderId);
		});
	},

	enable(feature) {
		state.stash = feature;
		for (const hook of ["createItem", "updateItem", "deleteItem", "updateActor"]) feature.on(hook, refreshStash);
		feature.onCleanup(watchDOM("dnd4e-party-stash-button", drawSidebarButton));
		feature.onCleanup(() => {
			document.querySelectorAll(".lucd20-party-stash-open, .lucd20-directory-footer:empty").forEach(el => el.remove());
			StashWindow.instance?.close();
			for (const app of foundry.applications.instances?.values() ?? []) if (app instanceof LedgerWindow && isStash(app.actor)) app.close();
			state.stash = null;
		});
	}
});

export const _test = { StashWindow, LedgerWindow, entriesOf, coinsOf, emptyPurse };
