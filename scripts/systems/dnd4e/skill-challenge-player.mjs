import { MODULE_ID, error } from "../../core/constants.js";
import { appElement } from "../../core/dom.js";
import { schedule, watchDOM } from "../../core/dom-watch.js";
import { executeAsGM } from "../../core/socket.js";
import { PUBLIC_KEY, L, esc, signed, skillLabel, tallyHTML, portraitsHTML } from "./skill-challenge-shared.mjs";

/*
 * Skill Challenges, the players' side.
 *
 * Players get a window for each open challenge that is running: the skills,
 * the descriptions written for them, a word for how hard each one is and the
 * tally. It opens by itself when the GM starts (or continues) a challenge and
 * can be reopened from a button at the bottom of their Journal tab.
 *
 * Everything shown comes from the world setting PUBLIC_KEY, which the GM's
 * client fills with publicView() (engine): no DCs, limits, GM notes, stages,
 * thresholds or hidden skills ever reach a player's client through it.
 * Rolling asks the GM's client, which checks the request and sends back the
 * normal roll request.
 */

const { ApplicationV2 } = foundry.applications.api;
const view = { actorId: null, known: new Set(), active: false };

const publicRuns = () => game.settings.get(MODULE_ID, PUBLIC_KEY) ?? {};

/** This player's characters (their own first). */
function myCharacters() {
	const pcs = (game.actors?.contents ?? [...(game.actors ?? [])]).filter(a => a.type === "Player Character" && a.isOwner);
	return pcs.sort((a, b) => (b.id === game.user.character?.id) - (a.id === game.user.character?.id) || a.name.localeCompare(b.name));
}

function challengeHTML(key, run, actor) {
	const group = role => {
		const rows = run.skills.filter(s => s.role === role).map(s => {
			const total = Number(actor?.system?.skills?.[s.skill]?.total);
			return `<li class="lucd20-sc-skill${s.spent ? " spent" : ""}" data-skill="${esc(s.id)}">
				<div class="main">
					<span class="name">${esc(skillLabel(s.skill))}${Number.isFinite(total) ? ` <span class="mod">${signed(total)}</span>` : ""}</span>
					<span class="chips">${s.difficulty ? `<span class="chip diff ${esc(s.difficulty)}" data-tooltip="${esc(L("Difficulty.Hint"))}">${L(`Difficulty.${s.difficulty}`)}</span>` : ""}${s.spent ? `<span class="chip spent">${L("Player.Spent")}</span>` : ""}</span>
					${run.canRoll ? `<button type="button" class="ll-btn ll-btn-take" data-action="roll" ${s.spent || !actor ? "disabled" : ""}><i class="fa-solid fa-dice-d20 ll-i"></i> ${L("Roll")}</button>` : ""}
				</div>
				${s.description ? `<p class="note">${esc(s.description).replace(/\n/g, "<br>")}</p>` : ""}
			</li>`;
		}).join("");
		return rows ? `<h4>${L(role === "primary" ? "Primary" : "Secondary")}</h4><ol class="lucd20-sc-skills">${rows}</ol>` : "";
	};
	return `<section class="lucd20-sc-public" data-key="${esc(key)}">
		<header class="lucd20-sc-head"><h3>${esc(run.name)}</h3>${tallyHTML(run, { successes: run.tally[0], failures: run.tally[1] })}</header>
		<div class="skills">${group("primary")}${group("secondary")}</div>
		${run.canRoll ? "" : `<p class="lucd20-sc-notes">${L("Player.GMCalls")}</p>`}
	</section>`;
}

export class PlayerWindow extends ApplicationV2 {
	static DEFAULT_OPTIONS = {
		id: "lucd20-skill-challenge-player",
		classes: ["lucd20-loot-app", "lucd20-sc-player"],
		window: { title: "LUCD20.SkillChallenge.Title", icon: "fa-solid fa-list-check", resizable: true },
		position: { width: 420, height: 560 },
		actions: { pick: PlayerWindow.#onPick, roll: PlayerWindow.#onRoll }
	};

	static get instance() {
		return foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id) ?? null;
	}

	static open() {
		return (this.instance ?? new this()).render({ force: true });
	}

	#actor() {
		const pcs = myCharacters();
		return pcs.find(a => a.id === view.actorId) ?? pcs[0] ?? null;
	}

	async _renderHTML() {
		const runs = Object.entries(publicRuns());
		const pcs = myCharacters();
		const actor = this.#actor();
		if (!runs.length) return `<div class="lucd20-loot-empty"><i class="fa-solid fa-list-check ll-empty-art"></i><p class="title">${L("Player.None")}</p></div>`;
		return `<div class="lucd20-sc-body">
			${pcs.length > 1 ? portraitsHTML(pcs, actor?.id) : ""}
			<div class="lucd20-sc-scroll">${runs.map(([key, run]) => challengeHTML(key, run, actor)).join("")}</div>
		</div>`;
	}

	_replaceHTML(result, content) {
		const top = content.querySelector(".lucd20-sc-scroll")?.scrollTop ?? 0;
		content.innerHTML = result;
		const scroll = content.querySelector(".lucd20-sc-scroll");
		if (scroll) scroll.scrollTop = top;
	}

	static #onPick(event, target) {
		view.actorId = target.closest("[data-actor]")?.dataset.actor;
		this.render();
	}

	static async #onRoll(event, target) {
		const actor = this.#actor();
		const key = target.closest("[data-key]")?.dataset.key;
		const skillId = target.closest("[data-skill]")?.dataset.skill;
		if (!actor || !key || !skillId) return;
		target.disabled = true;
		try {
			const answer = await executeAsGM("skillChallenge.playerRoll", { key, skillId, actorId: actor.id });
			if (!answer?.ok) ui.notifications?.warn(L(answer?.reason === "busy" ? "Player.Busy" : "Player.Closed"));
		} catch (err) {
			error("Skill Challenges: could not ask the GM.", err);
			ui.notifications?.warn(L("Player.NoGM"));
		}
		if (this.rendered) this.render();
	}
}

/** The published challenges changed: redraw, open for a new one, close when none is left. */
export function onPublicChange() {
	if (!view.active || game.user.isGM) return;
	const keys = Object.keys(publicRuns());
	const fresh = keys.some(key => !view.known.has(key));
	view.known = new Set(keys);
	const app = PlayerWindow.instance;
	schedule(); // the Journal tab button comes and goes with the challenges
	if (fresh) PlayerWindow.open();
	else if (!keys.length) app?.close();
	else if (app?.rendered) app.render();
}

function addDirectoryButton(root) {
	const has = Object.keys(publicRuns()).length > 0;
	const old = root?.querySelector(".lucd20-sc-open");
	if (!root || has === !!old) return;
	if (!has) return old.remove();
	let footer = root.querySelector(".directory-footer");
	if (!footer) {
		footer = document.createElement("footer");
		footer.className = "directory-footer action-buttons lucd20-directory-footer";
		root.append(footer);
	}
	const button = document.createElement("button");
	button.type = "button";
	button.className = "lucd20-sc-open";
	button.innerHTML = `<i class="fa-solid fa-list-check"></i> ${L("Title")}`;
	button.addEventListener("click", event => {
		event.preventDefault();
		PlayerWindow.open();
	});
	footer.append(button);
}

/** Called when the feature starts on a player's client. */
export function enablePlayerSide(feature) {
	view.active = true;
	// Challenges already running when this player joins are not "new": no pop-up, the button is there.
	view.known = new Set(Object.keys(publicRuns()));
	feature.onCleanup(watchDOM("skill-challenge-player-button", () => {
		addDirectoryButton(appElement(ui.journal) ?? document.getElementById("journal"));
	}));
	feature.onCleanup(() => {
		view.active = false;
		view.known = new Set();
	});
}
