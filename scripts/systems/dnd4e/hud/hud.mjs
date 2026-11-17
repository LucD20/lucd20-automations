import { localize } from "../../../core/constants.js";
import { L, tokenForActor } from "../utils.mjs";
import { getState, remaining, isCombatantsTurn, canModify, combatantForActor, togglePip } from "../actions/state.mjs";
import { BASIC_ACTIONS, useBasicAction } from "../actions/basic.mjs";
import { defenceModifiers } from "../sheet-mods.mjs";
import { buildModel, TABS, ROWS } from "./hud-data.mjs";

/*
 * D&D 4e HUD (phase 39, docs/PLAN.md §17; mockup docs/mockups/hud-4e-sheet.html, take C):
 * a band across the bottom of the screen for the selected PC (else the player's character).
 * Left: the stat block (HP, conditions, surges or death saves, AP, speed, initiative, defences).
 * Middle: powers in tabs by action type, each tab in usage rows (At-Will, Encounter, Daily, Basic).
 * Right: the action dock (the Action Tracker's state) above Foundry's hotbar, which is moved
 * inside the HUD; Foundry's players list is moved into the corner above the HUD's left end.
 * Switching the HUD (or those options) off puts both back where Foundry had them.
 *
 * Placement follows what the owner's 2d12 HUD had to learn: the HUD is placed on the screen
 * itself (fixed), and its right edge is measured from what is really drawn in the bottom band
 * (the sidebar, its tabs, the chat input when it floats), re-measured on resize and whenever the
 * sidebar changes size.
 */

const ID = "lucd20-hud4e";
const H = (key, data) => localize(`LUCD20.Dnd4eHud.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const PC = "Player Character";
const ICON = { melee: "fa-khanda", ranged: "fa-bullseye", meleeRanged: "fa-khanda", close: "fa-burst", area: "fa-circle-dot", personal: "fa-user" };
const TAB_ICON = { standard: "fa-hand-fist", move: "fa-person-walking", minor: "fa-hand", free: "fa-feather", triggered: "fa-bolt-lightning" };
const DOCK = [["standard", "fa-hand-fist"], ["move", "fa-person-walking"], ["minor", "fa-hand"], ["immediate", "fa-bolt-lightning"], ["opportunity", "fa-eye"]];
// The module's basic actions (actions/basic.mjs), shown in the Basic row of their tab while in combat.
const BASIC_BY_TAB = { standard: ["charge", "totalDefense", "secondWind", "aidAnother", "ready"], move: ["walk", "shift", "run", "standUp"] };

const st = { feature: null, root: null, tab: "standard", model: null, actor: null, seq: 0, timer: null, homes: new Map() };

/* -------------------------------------------- */
/*  Whose HUD                                   */
/* -------------------------------------------- */

/** Q152: the one selected PC the user owns; else (players only) their assigned character. */
export function currentActor() {
	const pcs = (canvas?.tokens?.controlled ?? []).filter((t) => t.actor?.type === PC && t.actor.isOwner);
	if (pcs.length === 1) return pcs[0].actor;
	if (pcs.length > 1 || game.user.isGM) return null;
	const own = game.user.character;
	return own?.type === PC && own.isOwner ? own : null;
}

/* -------------------------------------------- */
/*  Mount / unmount                             */
/* -------------------------------------------- */

export function mountHud(feature) {
	st.feature = feature;
	if (!st.root?.isConnected) {
		st.root = document.createElement("section");
		st.root.id = ID;
		st.root.className = "lucd20-hud4e";
		st.root.innerHTML = `<div class="h4-players"></div><div class="h4-main"></div><div class="h4-right"><div class="h4-dock"></div><div class="h4-hot"></div></div>`;
		// In Foundry's interface layer, under its windows (which stack from z-index 100). (verify)
		(document.getElementById("interface") ?? document.body).append(st.root);
		st.root.addEventListener("click", onClick);
		st.root.addEventListener("contextmenu", onContext);
	}
	const redraw = () => schedule();
	for (const hook of ["controlToken", "updateActor", "createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect",
		"deleteActiveEffect", "createCombatant", "updateCombatant", "deleteCombatant", "updateCombat", "deleteCombat", "combatStart", "updateUser", "canvasReady", "updateToken"]) {
		feature.on(hook, redraw);
	}
	for (const hook of ["renderHotbar", "renderPlayers", "renderPlayerList", "collapseSidebar", "renderSidebar", "renderChatLog"]) feature.on(hook, () => setTimeout(placeAll, 0));
	const onResize = () => place();
	window.addEventListener("resize", onResize);
	let observer = null;
	try {
		observer = new ResizeObserver(() => place());
		for (const id of ["sidebar", "sidebar-content", "ui-right", "hotbar"]) {
			const el = document.getElementById(id);
			if (el) observer.observe(el);
		}
	} catch (err) { observer = null; }
	feature.onCleanup(() => {
		window.removeEventListener("resize", onResize);
		observer?.disconnect();
	});
	refreshHud(feature);
}

export function unmountHud() {
	clearTimeout(st.timer);
	st.seq++;
	restore("hotbar");
	restore("players");
	st.root?.remove();
	st.root = null;
	st.model = null;
	st.actor = null;
}

/** A setting changed (theme, hotbar, players): re-place and redraw. */
export function refreshHud(feature = st.feature) {
	if (!st.root) return;
	st.root.classList.toggle("light", feature.get("theme") === "light");
	st.root.classList.toggle("dark", feature.get("theme") !== "light");
	placeAll();
	schedule(0);
}

/* -------------------------------------------- */
/*  Foundry's players list and hotbar           */
/* -------------------------------------------- */

/** Move one of Foundry's elements into a HUD slot, remembering where it was. */
function adopt(id, slot) {
	const el = document.getElementById(id);
	if (!el || !slot || el.parentElement === slot) return;
	st.homes.set(id, { parent: el.parentElement, next: el.nextSibling });
	slot.append(el);
	el.classList.add("lucd20-hud4e-held");
}

/** Put an element back where Foundry had it. */
function restore(id) {
	const home = st.homes.get(id);
	const el = document.getElementById(id);
	st.homes.delete(id);
	if (!el || !home?.parent?.isConnected) return;
	el.classList.remove("lucd20-hud4e-held");
	if (home.next?.parentElement === home.parent) home.parent.insertBefore(el, home.next);
	else home.parent.append(el);
}

function placeAll() {
	if (!st.root) return;
	const f = st.feature;
	if (f?.get("hotbar")) adopt("hotbar", st.root.querySelector(".h4-hot"));
	else restore("hotbar");
	if (f?.get("players")) adopt("players", st.root.querySelector(".h4-players"));
	else restore("players");
	st.root.classList.toggle("with-hot", !!f?.get("hotbar"));
	place();
}

/**
 * Left edge: the screen's. Right edge: the leftmost of the sidebar, its tabs and the floating chat
 * input that reach into the bottom band, never wider than 1240 px. Bottom: 0, or above Foundry's
 * hotbar when it is left outside the HUD.
 */
export function place() {
	const root = st.root;
	if (!root) return;
	const W = window.innerWidth, H0 = window.innerHeight, band = H0 - 220;
	const vis = (el) => { const r = el?.getBoundingClientRect?.(); return r && r.width > 0 && r.height > 0 ? r : null; };
	const rightEls = ["sidebar", "sidebar-tabs", "sidebar-content", "chat-form"].map((id) => document.getElementById(id)).concat([...document.querySelectorAll("#chat-notifications .chat-form, #interface .chat-form")]);
	const lefts = rightEls.map(vis).filter((r) => r && r.bottom > band && r.left > W * 0.35).map((r) => r.left);
	const right = lefts.length ? Math.min(...lefts) : W;
	const width = Math.max(560, Math.min(1480, right - 8));
	const hot = document.getElementById("hotbar");
	const outside = hot && !root.contains(hot) ? vis(hot) : null;
	Object.assign(root.style, { left: "0px", width: `${Math.round(width)}px`, bottom: `${outside ? Math.round(H0 - outside.top + 4) : 0}px` });
}

/* -------------------------------------------- */
/*  Drawing                                     */
/* -------------------------------------------- */

function schedule(delay = 60) {
	clearTimeout(st.timer);
	st.timer = setTimeout(() => draw().catch((err) => console.error("lucd20-automations | 4e HUD", err)), delay);
}

export async function draw() {
	const root = st.root;
	if (!root) return;
	const seq = ++st.seq;
	const actor = currentActor();
	const main = root.querySelector(".h4-main");
	root.classList.toggle("empty", !actor);
	if (!actor) {
		st.actor = null; st.model = null;
		// v0.43.3: the band keeps its size and place with nobody shown (owner: "make elements be fixed").
		// v0.43.4 (owner, as PF2e HUD does): with nobody selected the band shows the party.
		main.innerHTML = partyStrip();
		fitAll(main);
		root.querySelector(".h4-dock").innerHTML = "";
		return placeAll();
	}
	let mods = null;
	try { mods = defenceModifiers(actor); } catch (err) { mods = null; }
	const model = await buildModel(actor, { bonusOf: (item) => item.getAttackBonus?.() ?? null, defenceMods: mods });
	if (seq !== st.seq || !st.root) return;
	st.actor = actor;
	st.model = model;
	render();
	placeAll();
}

/** Draw the current model (also on a tab change, without reading the actor again). */
function render() {
	const root = st.root, m = st.model, actor = st.actor;
	if (!root || !m || !actor) return;
	const combatant = combatantForActor(actor);
	const inCombat = !!combatant?.combat?.started;
	root.querySelector(".h4-main").innerHTML = `${portrait(m)}${stats(m)}${powers(m, inCombat)}`;
	root.querySelector(".h4-dock").innerHTML = dock(combatant, inCombat);
	fitAll(root);
}

/* -------------------------------------------- */
/*  The party (nothing selected)                */
/* -------------------------------------------- */

/** The player characters this user may look at (never one a player cannot observe). */
export function partyActors() {
	return (game.actors?.contents ?? [...(game.actors ?? [])])
		.filter((a) => a?.type === PC && a.hasPlayerOwner && (game.user.isGM || a.testUserPermission?.(game.user, "OBSERVER")))
		.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function partyStrip() {
	const actors = partyActors();
	if (!actors.length) return `<p class="h4-empty">${H(game.user.isGM ? "EmptyGM" : "EmptyPlayer")}</p>`;
	return `<div class="h4-party">${actors.map((a) => {
		const s = a.system ?? {}, d = s.details ?? {}, hp = s.attributes?.hp ?? {};
		const value = Number(hp.value) || 0, max = Number(hp.max) || 0;
		const pct = max > 0 ? Math.max(0, Math.min(100, (100 * value) / max)) : 0;
		const def = (k) => esc(s.defences?.[k]?.value ?? "");
		return `<div class="h4-pc" data-party="${a.id}">
			<div class="h4-pc-top"><img src="${esc(a.img)}" alt=""><div class="h4-pc-name"><b class="fit">${esc(a.name)}</b><small>${esc([d.class, d.level].filter((v) => v !== undefined && v !== "").join(" "))}</small></div></div>
			<div class="h4-pc-defs"><span><small>AC</small>${def("ac")}</span><span><small>Fort</small>${def("fort")}</span><span><small>Ref</small>${def("ref")}</span><span><small>Will</small>${def("wil")}</span></div>
			<div class="h4-pc-line"><span>${H("Surges")} ${Number(d.surges?.value) || 0}</span><span>${H("AP")} ${Number(s.actionpoints?.value) || 0}</span><span>${H("Speed")} ${esc(s.movement?.walk?.value ?? "")}</span></div>
			<div class="h4-hp"><div class="f" style="width:${pct}%"></div><div class="bl" style="left:50%"></div><span>${value} / ${max}</span></div>
		</div>`;
	}).join("")}</div>`;
}

/** A party card: select that character's token (the HUD then shows it); no token here: its sheet. */
function onParty(id, sheet = false) {
	const actor = game.actors?.get(id);
	if (!actor) return;
	const token = sheet ? null : (actor.getActiveTokens?.(true) ?? []).find((t) => t.isOwner || game.user.isGM);
	if (token) return token.control({ releaseOthers: true });
	actor.sheet?.render(true);
}

const portrait = (m) => `<div class="h4-por" data-h4="sheet"><img src="${esc(m.img)}" alt=""></div>`;

function hpBar(m) {
	const { value, max, temp } = m.hp;
	const pct = (v) => (max > 0 ? Math.max(0, Math.min(100, (100 * v) / max)) : 0);
	const state = m.dying ? ` · ${H("Dying")}` : m.bloodied ? ` · ${H("Bloodied")}` : "";
	return `<div class="h4-hp"><div class="f" style="width:${pct(value)}%"></div>${temp ? `<div class="t" style="width:${pct(temp)}%"></div>` : ""}
		<div class="bl" style="left:50%"></div><span>${value} / ${max}${temp ? ` · +${temp} ${H("Temp")}` : ""}${state}</span></div>`;
}

function stats(m) {
	const conds = m.conditions.length ? `<div class="h4-conds">${m.conditions.map((c) => `<span class="${c.bad ? "bad" : ""}">${esc(c.name)}</span>`).join("")}</div>` : "";
	const surgeLine = m.dying
		? `<div class="h4-ln"><b class="h4-red">${H("Dying")}</b><span class="h4-death">${H("DeathSaves")} ${Array.from({ length: m.deathMax }, (_, i) => `<i class="${i < m.deathFails ? "x" : ""}"></i>`).join("")}</span>
			<button type="button" class="h4-btn" data-h4="death">${H("Roll")}</button></div>`
		: `<div class="h4-ln"><span><b>${H("Surges")}</b> ${m.surges.value}/${m.surges.max} <span class="h4-mute">(${m.surges.each})</span></span>
			<button type="button" class="h4-btn${m.secondWindUsed ? " done" : ""}" data-h4="sw">${H("SecondWind")}</button></div>`;
	return `<div class="h4-stats">
		<div class="h4-plate"><span class="fit">${esc(m.name)}</span><small>${esc(m.sub)}</small></div>
		<div class="h4-ln"><span>${H("HP")}</span>${hpBar(m)}</div>${conds}${surgeLine}
		<div class="h4-ln"><span><b>${H("AP")}</b> ${m.ap}</span><button type="button" class="h4-btn" data-h4="ap" ${m.ap < 1 ? "disabled" : ""}>${H("Spend")}</button>
			<span class="h4-push"><b>${H("Speed")}</b> ${esc(m.speed)}</span><span><b>${H("Init")}</b> ${esc(signedInit(m.init))}</span></div>
		<div class="h4-defs">${m.defences.map((d) => `<div class="${d.mod > 0 ? "up" : d.mod < 0 ? "dn" : ""}"><b>${esc(d.value)}</b><small>${d.label}</small></div>`).join("")}</div>
	</div>`;
}
const signedInit = (v) => (v === "" || v === null || v === undefined ? "" : Number(v) >= 0 ? `+${Number(v)}` : String(v));

function rangeHTML(r) {
	if (!r.icon && !r.text) return "";
	const icon = ICON[r.icon] ? `<i class="fa-solid ${ICON[r.icon]}"></i>` : "";
	const second = r.icon === "meleeRanged" ? `/<i class="fa-solid fa-bullseye"></i>` : "";
	return `${icon}${second}${r.text ? ` ${esc(r.text)}` : ""}`;
}

function powerChip(p) {
	const pips = p.uses && p.uses.max > 1 ? `<span class="h4-uses">${Array.from({ length: p.uses.max }, (_, i) => `<i class="${i < p.uses.left ? "full" : ""}"></i>`).join("")}</span>` : "";
	return `<div class="h4-pw u-${p.row}${p.used ? " used" : ""}" data-power="${p.id}">
		<div class="h4-h fit">${esc(p.name)}${pips}</div><div class="h4-k"><span class="rg fit">${rangeHTML(p.range)}</span><span class="at">${esc(p.attack)}</span></div></div>`;
}

function basicChip(key) {
	const def = BASIC_ACTIONS[key];
	return `<div class="h4-pw u-basic act" data-basic="${key}"><div class="h4-h fit"><i class="fa-solid ${def.icon}"></i> ${esc(L(`Actions.Basic.${key}`))}</div>
		<div class="h4-k"><span class="rg">${esc(def.kind ? L(`Actions.${def.kind}`) : L("Actions.free"))}</span></div></div>`;
}

function powers(m, inCombat) {
	const basics = (tab) => (inCombat ? (BASIC_BY_TAB[tab] ?? []).filter((k) => BASIC_ACTIONS[k]) : []);
	const count = (tab) => m.powers.filter((p) => p.tab === tab).length + basics(tab).length;
	if (!TABS.includes(st.tab)) st.tab = "standard";
	const tab = st.tab;
	const list = m.powers.filter((p) => p.tab === tab);
	// v0.43.3 (owner): usage in columns, which grow downward (and scroll) as powers are added.
	const cols = ROWS.map((row) => {
		const chips = list.filter((p) => p.row === row).map(powerChip);
		if (row === "basic") chips.push(...basics(tab).map(basicChip));
		return `<div class="h4-col"><b class="u-${row}">${H(`Row.${row}`)}</b><div class="h4-stack">${chips.join("") || `<span class="h4-dash">—</span>`}</div></div>`;
	}).join("");
	return `<div class="h4-powers"><div class="h4-tabs">${TABS.map((t) => `<button type="button" data-tab="${t}" class="${t === tab ? "act" : ""}">
		<i class="fa-solid ${TAB_ICON[t]}"></i> ${H(`Tab.${t}`)}<span class="n">${count(t)}</span></button>`).join("")}</div>
		<div class="h4-cols">${cols}</div></div>`;
}

function dock(combatant, inCombat) {
	if (!inCombat) return `<p class="h4-none">${H("NotInCombat")}</p>`;
	const state = getState(combatant);
	const left = remaining(state);
	const ownTurn = isCombatantsTurn(combatant);
	const editable = canModify(combatant);
	return `<div class="h4-tiles">${DOCK.map(([kind, icon]) => {
		const offTurnOnly = kind === "immediate" || kind === "opportunity";
		const cls = left[kind] > 0 ? ((offTurnOnly ? ownTurn : !ownTurn) ? "off" : "on") : "spent";
		const extra = kind === "standard" && state.extra > 0 ? `<sup>${Math.max(0, left.standard)}</sup>` : "";
		return `<span class="${cls}" ${editable ? `data-pip="${kind}"` : ""}><i class="fa-solid ${icon}"></i>${esc(H(`Dock.${kind}`))}${extra}</span>`;
	}).join("")}</div>`;
}

/** A long name shrinks its font to fit its line (down to 9 px), and only then ends in "…". */
export function fitAll(root) {
	for (const el of root.querySelectorAll(".fit")) {
		el.style.fontSize = "";
		let size = parseFloat(getComputedStyle(el).fontSize) || 12;
		while (el.scrollWidth > el.clientWidth + 0.5 && size > 9) {
			size -= 0.5;
			el.style.fontSize = `${size}px`;
		}
	}
}

/* -------------------------------------------- */
/*  Clicks                                      */
/* -------------------------------------------- */

async function onClick(event) {
	const card = event.target.closest("[data-party]");
	if (card) { event.preventDefault(); return onParty(card.dataset.party); }
	const el = event.target.closest("[data-tab], [data-power], [data-basic], [data-pip], [data-h4]");
	const actor = st.actor;
	if (!el || !actor) return;
	event.preventDefault();
	const combatant = combatantForActor(actor);
	const inCombat = !!combatant?.combat?.started;
	try {
		if (el.dataset.tab) {
			st.tab = el.dataset.tab;
			return render();
		}
		if (el.dataset.power) {
			const item = actor.items.get(el.dataset.power);
			if (!item) return;
			// Q151: as the sheet does, so every automation of the module and the system runs.
			if (typeof actor.usePower === "function") return await actor.usePower(item, { configureDialog: true, fastForward: false });
			return await item.roll?.();
		}
		if (el.dataset.basic) return inCombat ? await useBasicAction(el.dataset.basic, combatant) : undefined;
		if (el.dataset.pip) return inCombat && canModify(combatant) ? await togglePip(combatant, el.dataset.pip) : undefined;
		switch (el.dataset.h4) {
			case "sheet": return actor.sheet?.render(true);
			case "sw": return inCombat ? await useBasicAction("secondWind", combatant) : await BASIC_ACTIONS.secondWind.run(actor);
			case "death": return await actor.rollDeathSave?.(event, { isFF: false });
			case "ap":
				if (actor.system?.actionpoints?.encounteruse) ui.notifications.warn(H("APUsed", { name: actor.name }));
				return inCombat ? await useBasicAction("actionPoint", combatant) : await BASIC_ACTIONS.actionPoint.run(actor);
		}
	} catch (err) {
		console.error("lucd20-automations | 4e HUD click", err);
	}
}

function onContext(event) {
	const card = event.target.closest("[data-party]");
	if (card) { event.preventDefault(); return onParty(card.dataset.party, true); }
	const el = event.target.closest("[data-power]");
	if (!el || !st.actor) return;
	event.preventDefault();
	st.actor.items.get(el.dataset.power)?.sheet?.render(true);
}

export const _test = { st, render, currentActor, tokenForActor, partyActors };
