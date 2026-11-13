import { MODULE_ID } from "../constants.mjs";
import { setting } from "../utils.mjs";
import { canModify, togglePip } from "./state.mjs";
import { pipHTML } from "./panel.mjs";

/*
 * Combat Tracker Dock (theripper93/combat-tracker-dock) integration: show the action pips on each
 * combatant portrait. The dock re-renders a portrait (CombatantPortrait#renderInner) whenever its
 * combatant updates, which is exactly when our action flags change.
 */

const WRAPPED = Symbol(`${MODULE_ID}.dockWrapped`);

function decorate(portrait) {
	const el = portrait.element;
	const combatant = portrait.combatant;
	if (!el || !combatant) return;
	el.querySelector(".d4ea-dock-pips")?.remove();
	if (!setting("actionTracker") || !setting("dockPips") || !combatant.combat?.started) return;
	const holder = document.createElement("div");
	holder.className = "d4ea-dock-pips";
	holder.innerHTML = pipHTML(combatant, { interactive: canModify(combatant) });
	for (const type of ["click", "mousedown", "pointerdown", "dblclick", "contextmenu"]) {
		holder.addEventListener(type, (ev) => ev.stopPropagation());
	}
	holder.addEventListener("click", async (ev) => {
		const pip = ev.target.closest("[data-kind]");
		if (!pip || !canModify(combatant)) return;
		ev.preventDefault();
		await togglePip(combatant, pip.dataset.kind);
	});
	(el.querySelector(".combatant-wrapper") ?? el).append(holder);
}

export function integrateCombatDock() {
	const Portrait = CONFIG.combatTrackerDock?.CombatantPortrait;
	if (!Portrait || Portrait.prototype[WRAPPED]) return;
	const original = Portrait.prototype.renderInner;
	Portrait.prototype.renderInner = async function (...args) {
		const result = await original.apply(this, args);
		try {
			decorate(this);
		} catch (err) {
			console.error(`${MODULE_ID} | dock pips`, err);
		}
		return result;
	};
	Portrait.prototype[WRAPPED] = true;
	refreshDock();
}

export function refreshDock() {
	const dock = ui.combatDock;
	if (!dock?.portraits) return;
	for (const p of dock.portraits) decorate(p);
}
