import { MODULE_ID } from "./constants.mjs";
import { F, L, setting, actorFromSpeaker } from "./utils.mjs";
import { LEVELS, OVERRIDES, levelsFor, setOverride } from "./power-levels.mjs";

/*
 * Renders the automation (◆) and translation (■) symbols next to power names in actor sheets
 * (system and Fox's sheets: rows "li[data-item-id]" with the name in an <h4>) and in power chat
 * cards (".chat-card.item-card" header <h3>). Clicking a symbol (GM) sets it for the whole world.
 */

function symbolsHTML(item) {
	const lv = levelsFor(item);
	const one = (kind, { level, manual }) => {
		const tip = [
			`<strong>${L(`Levels.${kind}`)}: ${L(`Levels.Name${level}`)}</strong>`,
			L(`Levels.${kind}Desc${level}`),
			`<em>${L(manual ? "Levels.Manual" : "Levels.Guessed")}</em>`,
			game.user.isGM ? `<em>${L("Levels.GMHint")}</em>` : "",
		].filter(Boolean).join("<br>");
		return `<span class="d4ea-lvl ${kind} lvl-${LEVELS[level]}" data-d4ea-lvl="${kind}" data-tooltip="${foundry.utils.escapeHTML(tip)}" data-tooltip-direction="UP" role="img" aria-label="${foundry.utils.escapeHTML(`${L(`Levels.${kind}`)}: ${L(`Levels.Name${level}`)}`)}"></span>`;
	};
	return `<span class="d4ea-levels">${one("auto", lv.auto)}${one("tr", lv.tr)}</span>`;
}

function attach(container, item) {
	if (!container || !item || item.type !== "power") return;
	container.querySelector(":scope > .d4ea-levels")?.remove();
	container.insertAdjacentHTML("beforeend", symbolsHTML(item));
	const box = container.querySelector(":scope > .d4ea-levels");
	// Don't let a click on the symbols roll the power / open its summary
	for (const type of ["click", "pointerdown", "mousedown", "dblclick", "contextmenu"]) {
		box.addEventListener(type, (ev) => {
			ev.stopPropagation();
			if (type === "click") {
				ev.preventDefault();
				const kind = ev.target.closest("[data-d4ea-lvl]")?.dataset.d4eaLvl;
				if (kind && game.user.isGM) chooseLevel(item, kind);
			}
		});
	}
	box.addEventListener("dragstart", (ev) => ev.preventDefault());
}

async function chooseLevel(item, kind) {
	const { DialogV2 } = foundry.applications.api;
	const buttons = [
		{ action: "auto", label: L("Levels.UseGuess"), icon: "fa-solid fa-wand-magic-sparkles" },
		...LEVELS.map((name, i) => ({ action: String(i), label: L(`Levels.Name${i}`), icon: `fa-solid fa-square d4ea-btn-${name}` })),
	];
	const choice = await DialogV2.wait({
		window: { title: `${L(`Levels.${kind}`)}: ${item.name}` },
		content: `<p>${F("Levels.ChooseHint", { power: foundry.utils.escapeHTML(item.name) })}</p>`,
		buttons,
		rejectClose: false,
		position: { width: 520 },
	}).catch(() => null);
	if (choice === null || choice === undefined) return;
	await setOverride(item, kind, choice === "auto" ? null : Number(choice));
}

/* -------------------------------------------- */

export function decorateActorSheet(app, element) {
	if (!setting("powerLevels")) return;
	const actor = app.document ?? app.actor;
	if (!(actor instanceof Actor)) return;
	const root = element instanceof HTMLElement ? element : element?.[0];
	if (!root) return;
	for (const row of root.querySelectorAll("li[data-item-id]")) {
		const item = actor.items.get(row.dataset.itemId);
		if (item?.type !== "power") continue;
		attach(row.querySelector("h4"), item);
	}
}

export function decorateChatCard(message, html) {
	if (!setting("powerLevels")) return;
	const card = html.querySelector(".chat-card.item-card[data-item-id]");
	if (!card) return;
	const id = card.dataset.itemId;
	const tokenActor = card.dataset.tokenId ? canvas?.tokens?.get(card.dataset.tokenId)?.actor : null;
	const actor = tokenActor ?? actorFromSpeaker(message.speaker) ?? game.actors.get(card.dataset.actorId);
	const item = actor?.items.get(id);
	attach(card.querySelector(".card-header h3"), item);
}

/** After the GM changes a symbol: redraw open sheets and recent power cards. */
export function refreshAll() {
	for (const app of foundry.applications?.instances?.values?.() ?? []) {
		if (app.rendered && (app.document instanceof Actor)) app.render();
	}
	for (const message of game.messages?.contents.slice(-100) ?? []) {
		if (message.content?.includes("item-card")) ui.chat?.updateMessage?.(message);
	}
}

export const OVERRIDES_SETTING = OVERRIDES;
