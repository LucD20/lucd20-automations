import { localize } from "../../core/constants.js";

/**
 * "Feats for this Strike" in PF2e's roll window (owner, v0.88.1; mockup C of docs/mockups/strike-options.html:
 * "C is good. Remember to make the names clickable"). A folding section with a checkbox per feat the
 * attacker has that can change this Strike; two columns; "N on" in its heading; folded or not is remembered
 * (this browser). A feat's icon and name open the feat. Checked, the roll's options get the feat's tag (so the
 * GM's client knows, e.g. Combat Assessment).
 *
 * registerStrikeOption({ id, tag, types = ["attack-roll"], active() → bool, item(actor) → Item | null,
 *   applies(context, item, roll) → bool, blocked(context, item) → string | null, toggle(app, on) })
 *   blocked: shown instead of a usable checkbox (e.g. "immune"); toggle: also change the roll itself (e.g. add a
 *   modifier: Orc Superstition, v0.89.0). types: "attack-roll" ("Feats for this Strike") and/or "saving-throw"
 *   ("Feats for this save").
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.StrikeOptions.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const FOLD_KEY = "lucd20-automations.strikeOptionsFolded";
const defs = [];
let hooked = false;

export function registerStrikeOption(def) {
	defs.push(def);
	if (!hooked) {
		hooked = true;
		Hooks.on("renderCheckModifiersDialog", (app, html) => onDialog(app, html));
	}
}

const TYPES = ["attack-roll", "saving-throw"];

/** The roller, the roll's item, whether a Strike is melee, the roll's options. */
export function strikeOf(context) {
	if (!context || !TYPES.includes(context.type) || context.isReroll) return null;
	const actor = context.origin?.token?.actor ?? context.origin?.actor ?? context.actor ?? context.token?.actor ?? null;
	const item = context.origin?.item ?? context.item ?? null;
	const opts = context.options instanceof Set ? context.options : new Set(context.options ?? []);
	const melee = item?.isMelee ?? !(opts.has("ranged") || opts.has("item:ranged"));
	return actor ? { actor, item, melee, type: context.type, options: opts } : null;
}

const optionSet = (context) => (context?.options instanceof Set ? context.options : null);
function hasTag(context, tag) {
	const set = optionSet(context);
	return set ? set.has(tag) : (context?.options ?? []).includes(tag);
}
function setTag(context, tag, on) {
	const set = optionSet(context);
	if (set) { if (on) set.add(tag); else set.delete(tag); return; }
	const list = (context.options ?? []).filter((o) => o !== tag);
	context.options = on ? [...list, tag] : list;
}

const folded = () => { try { return localStorage.getItem(FOLD_KEY) === "1"; } catch { return false; } };
const setFolded = (v) => { try { localStorage.setItem(FOLD_KEY, v ? "1" : "0"); } catch { /* no storage */ } };

export function onDialog(app, html) {
	const context = app?.context;
	const root = html instanceof HTMLElement ? html : (html?.[0] ?? app?.element);
	if (!root) return;
	root.querySelector(".lucd20-so")?.remove();
	const strike = strikeOf(context);
	if (!strike) return;
	const rows = [];
	for (const def of defs) {
		if (def.active && !def.active()) continue;
		if (!(def.types ?? ["attack-roll"]).includes(strike.type)) continue;
		const item = def.item?.(strike.actor);
		if (!item || (def.applies && !def.applies(context, item, strike, app))) continue;
		const blocked = def.blocked?.(context, item) ?? null;
		if (blocked && hasTag(context, def.tag)) setTag(context, def.tag, false);
		rows.push({ def, item, blocked, on: !blocked && hasTag(context, def.tag) });
	}
	if (!rows.length) return;
	const count = () => rows.filter((r) => r.on).length;
	const html2 = `<details class="lucd20-so" ${folded() ? "" : "open"}>
		<summary><i class="fa-solid fa-chevron-down lucd20-so-chev"></i> ${esc(L(strike.type === "saving-throw" ? "TitleSave" : "Title"))} <span class="lucd20-so-count">${esc(L("On", { n: count() }))}</span></summary>
		<div class="lucd20-so-grid">${rows.map((r, i) => `<div class="lucd20-so-opt ${r.blocked ? "is-blocked" : ""}" data-i="${i}">
			<input type="checkbox" ${r.on ? "checked" : ""} ${r.blocked ? "disabled" : ""} aria-label="${esc(r.item.name)}">
			<img src="${esc(r.item.img)}" alt="" class="lucd20-so-open" data-tooltip="${esc(L("Open"))}">
			<span class="lucd20-so-text"><a class="lucd20-so-open lucd20-so-name" data-tooltip="${esc(L("Open"))}">${esc(r.item.name)}</a>${r.blocked ? `<small>${esc(r.blocked)}</small>` : ""}</span>
		</div>`).join("")}</div></details>`;
	const anchor = root.querySelector(".lucd20-cover-pick") ?? root.querySelector(".lucd20-ch-dialog") ?? root.querySelector("button.roll, button[type='submit'], [data-action='roll']");
	if (anchor) anchor.insertAdjacentHTML("beforebegin", html2);
	else root.querySelector(".window-content")?.insertAdjacentHTML("beforeend", html2);
	const section = root.querySelector(".lucd20-so");
	const fit = () => requestAnimationFrame(() => { try { app?.setPosition?.({ height: "auto" }); } catch { /* not positionable */ } });
	section.addEventListener("toggle", () => { setFolded(!section.open); fit(); });
	for (const el of section.querySelectorAll(".lucd20-so-opt")) {
		const r = rows[Number(el.dataset.i)];
		for (const open of el.querySelectorAll(".lucd20-so-open")) open.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); r.item.sheet?.render(true); });
		el.querySelector("input").addEventListener("change", (event) => {
			r.on = event.target.checked;
			setTag(context, r.def.tag, r.on);
			r.def.toggle?.(app, r.on);
			section.querySelector(".lucd20-so-count").textContent = L("On", { n: count() });
		});
	}
	fit();
}

export const _test = { defs, onDialog };
