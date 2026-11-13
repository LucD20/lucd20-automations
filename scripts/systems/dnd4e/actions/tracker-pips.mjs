import { setting } from "../utils.mjs";
import { canModify, togglePip } from "./state.mjs";
import { pipHTML, ActionPanel } from "./panel.mjs";

/** Add action pips to each combatant row of the Combat Tracker. */
export function renderTrackerPips(app, element) {
	if (!setting("actionTracker")) return;
	const root = element instanceof HTMLElement ? element : element?.[0];
	const combat = app.viewed ?? game.combat;
	if (!root || !combat?.started) return;

	for (const li of root.querySelectorAll("[data-combatant-id]")) {
		const combatant = combat.combatants.get(li.dataset.combatantId);
		if (!combatant) continue;
		li.querySelector(".d4ea-tracker-pips")?.remove();
		const holder = document.createElement("div");
		holder.className = "d4ea-tracker-pips";
		holder.innerHTML = pipHTML(combatant, { interactive: canModify(combatant) });
		holder.addEventListener("click", async (ev) => {
			const pip = ev.target.closest("[data-kind]");
			if (!pip) return;
			ev.stopPropagation();
			ev.preventDefault();
			await togglePip(combatant, pip.dataset.kind);
		});
		holder.addEventListener("dblclick", (ev) => ev.stopPropagation());
		const name = li.querySelector(".token-name") ?? li.querySelector("h4")?.parentElement ?? li;
		name.append(holder);
	}

	// Button in the tracker header to open the panel
	const header = root.querySelector(".combat-tracker-header, header") ;
	if (header && !header.querySelector(".d4ea-open-panel")) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "d4ea-open-panel inline-control icon fa-solid fa-hand-fist";
		btn.dataset.tooltip = game.i18n.localize("DND4EAUTO.Actions.PanelTitle");
		btn.addEventListener("click", () => ActionPanel.toggle());
		header.append(btn);
	}
}
