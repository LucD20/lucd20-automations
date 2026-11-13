import { MODULE_ID } from "../constants.mjs";
import { L, F, setting, tokenForActor } from "../utils.mjs";
import { getState, remaining, togglePip, isCombatantsTurn, canModify, combatantForActor, ACTIONS } from "./state.mjs";
import { BASIC_ACTIONS, useBasicAction } from "./basic.mjs";

const { ApplicationV2 } = foundry.applications.api;

export const PIP_ICONS = {
	standard: "fa-solid fa-hand-fist",
	move: "fa-solid fa-person-walking",
	minor: "fa-solid fa-hand",
	immediate: "fa-solid fa-bolt-lightning",
	opportunity: "fa-solid fa-eye",
};

/** Which combatant this user's panel shows. */
function shownCombatant() {
	const combat = game.combat;
	if (!combat?.started) return null;
	const controlled = canvas?.tokens?.controlled?.[0];
	const fromControl = controlled ? combatantForActor(controlled.actor) : null;
	if (fromControl) return fromControl;
	if (game.user.isGM) return combat.combatant ?? null;
	const own = game.user.character ? combatantForActor(game.user.character) : null;
	return own ?? (combat.combatant?.isOwner ? combat.combatant : null);
}

export function pipHTML(combatant, { interactive = false } = {}) {
	const state = getState(combatant);
	const left = remaining(state);
	const ownTurn = isCombatantsTurn(combatant);
	return ACTIONS.map((kind) => {
		const available = left[kind] > 0;
		const offTurnOnly = ["immediate", "opportunity"].includes(kind);
		const dim = offTurnOnly ? ownTurn : !ownTurn;
		const count = kind === "standard" && (1 + (state.extra || 0)) > 1 ? `<sup>${Math.max(0, left.standard)}</sup>` : "";
		const classes = ["d4ea-pip", `d4ea-pip-${kind}`, available ? "available" : "spent", dim ? "inactive" : ""].join(" ");
		const attrs = interactive ? `data-action="pip" data-kind="${kind}"` : "";
		return `<span class="${classes}" ${attrs} data-tooltip="${L(`Actions.${kind}`)}: ${available ? L("Actions.Available") : L("Actions.Spent")}"><i class="${PIP_ICONS[kind]}"></i>${count}</span>`;
	}).join("");
}

export class ActionPanel extends ApplicationV2 {
	static instance = null;

	static DEFAULT_OPTIONS = {
		id: `${MODULE_ID}-action-panel`,
		classes: ["d4ea-action-panel"],
		window: { title: "DND4EAUTO.Actions.PanelTitle", minimizable: true, resizable: false },
		position: { width: 300, height: "auto", left: 120, top: 80 },
		actions: {
			pip: ActionPanel.#onPip,
			basic: ActionPanel.#onBasic,
		},
	};

	static autoOpen() {
		if (!setting("actionTracker") || !setting("actionPanel")) return;
		ActionPanel.open();
	}

	static open() {
		if (!ActionPanel.instance) ActionPanel.instance = new ActionPanel();
		ActionPanel.instance.render({ force: true });
	}

	static toggle() {
		if (ActionPanel.instance?.rendered) ActionPanel.instance.close();
		else ActionPanel.open();
	}

	static refresh() {
		const app = ActionPanel.instance;
		if (!app?.rendered) return;
		if (!game.combat) return app.close();
		clearTimeout(app._refreshTimer);
		app._refreshTimer = setTimeout(() => app.render(), 50);
	}

	async _renderHTML() {
		const combatant = shownCombatant();
		if (!combatant) return `<p class="d4ea-empty">${L("Actions.NoCombatant")}</p>`;
		const actor = combatant.actor;
		const editable = canModify(combatant);
		const state = getState(combatant);
		const ownTurn = isCombatantsTurn(combatant);
		const ap = actor?.system?.actionpoints?.value ?? 0;
		const token = combatant.token?.object ?? tokenForActor(actor);
		const img = token?.document.texture.src || combatant.img || actor?.img;
		const traded = state.traded?.length ? `<div class="d4ea-traded">${state.traded.map((t) => {
			const [from, to] = t.split(">");
			return F("Actions.TradeNote", { from: L(`Actions.${from}`), to: L(`Actions.${to}`) });
		}).join(" · ")}</div>` : "";

		const buttons = Object.entries(BASIC_ACTIONS).map(([key, def]) => {
			const kindLabel = def.kind ? L(`Actions.${def.kind}`) : L("Actions.free");
			return `<button type="button" data-action="basic" data-key="${key}" ${editable ? "" : "disabled"} data-tooltip="${kindLabel}">
				<i class="fa-solid ${def.icon}"></i> ${L(`Actions.Basic.${key}`)}</button>`;
		}).join("");

		return `
			<header class="d4ea-who ${ownTurn ? "own-turn" : ""}">
				<img src="${img}" alt="">
				<div><strong>${foundry.utils.escapeHTML(combatant.name)}</strong>
				<small>${ownTurn ? L("Actions.YourTurn") : L("Actions.NotYourTurn")} · ${L("Actions.ActionPoints")}: ${ap}</small></div>
			</header>
			<div class="d4ea-pips">${pipHTML(combatant, { interactive: editable })}</div>
			${traded}
			<div class="d4ea-basic">${buttons}</div>`;
	}

	_replaceHTML(result, content) {
		content.innerHTML = result;
	}

	static async #onPip(event, target) {
		const combatant = shownCombatant();
		if (combatant) await togglePip(combatant, target.dataset.kind);
	}

	static async #onBasic(event, target) {
		const combatant = shownCombatant();
		if (combatant) await useBasicAction(target.dataset.key, combatant);
	}
}
