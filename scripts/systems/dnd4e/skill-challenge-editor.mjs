import { MODULE_ID, error } from "../../core/constants.js";
import { DIFFICULTIES, EFFECTS, normalizeChallenge } from "./skill-challenge-engine.mjs";
import { FLAG, L, esc, skillIds, skillLabel } from "./skill-challenge-shared.mjs";

/*
 * Skill Challenge editor (GM): a form for the data on a world journal page.
 * Compendium pages are read-only in Foundry, so those are edited in their
 * source files. Saving writes every field, so nothing stale is left behind.
 *
 * Routes are edited as JSON (each can override any field of any skill).
 */

const { ApplicationV2 } = foundry.applications.api;
const E = (key, data) => L(`Editor.${key}`, data);

const BLANK = {
	skills: () => ({ skill: skillIds()[0] ?? "", role: "primary", dc: 10 }),
	stages: () => ({ name: "", successes: 0, penalty: 2, skills: [], note: "" }),
	thresholds: () => ({ failures: 1, text: "" }),
	groupChecks: () => ({ name: "", note: "", options: [] })
};

/* -------------------------------------------- */
/*  Fields                                      */
/* -------------------------------------------- */

const csv = value => String(value ?? "").split(/[,;]/).map(s => s.trim()).filter(Boolean);
/** "stl 17, blu 12" ↔ [{ skill, dc }] */
const optionsText = options => (options ?? []).map(o => `${o.skill} ${o.dc}`).join(", ");
const parseOptions = value => csv(value).map(part => {
	const [skill, dc] = part.split(/[\s:]+/);
	return { skill, dc: Number(dc) || 10 };
}).filter(o => o.skill);

function read(input) {
	switch (input.dataset.kind) {
		case "int": return Math.trunc(Number(input.value)) || 0;
		case "bool": return input.checked;
		case "list": return csv(input.value);
		case "options": return parseOptions(input.value);
		default: return input.value;
	}
}

function setPath(object, path, value) {
	const parts = path.split(".");
	let target = object;
	for (const part of parts.slice(0, -1)) target = target[part];
	target[parts.at(-1)] = value;
}

const field = (label, control, { wide = false, hint = "" } = {}) => `<label class="f${wide ? " wide" : ""}"${hint ? ` data-tooltip="${esc(hint)}"` : ""}><span>${label}</span>${control}</label>`;
const num = (path, value, attrs = "") => `<input type="number" step="1" data-path="${path}" data-kind="int" value="${esc(value)}" ${attrs}>`;
const txt = (path, value, kind = "text") => `<input type="text" data-path="${path}" data-kind="${kind}" value="${esc(value)}">`;
const area = (path, value) => `<textarea data-path="${path}" data-kind="text" rows="2">${esc(value)}</textarea>`;
const check = (path, value, label) => `<label class="f check"><input type="checkbox" class="ll-check" data-path="${path}" data-kind="bool" ${value ? "checked" : ""}><span>${label}</span></label>`;
const select = (path, value, options) => `<select data-path="${path}" data-kind="text">${options.map(([v, label]) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>`;

const itemHeader = (listName, index, title) => `<header><strong>${esc(title)}</strong>
	<span class="tools">
		${listName === "skills" ? `<button type="button" class="ll-btn ll-btn-square" data-action="move" data-list="${listName}" data-index="${index}" data-d="-1" aria-label="${esc(E("Up"))}" data-tooltip="${esc(E("Up"))}"><i class="fa-solid fa-arrow-up ll-i"></i></button>
		<button type="button" class="ll-btn ll-btn-square" data-action="move" data-list="${listName}" data-index="${index}" data-d="1" aria-label="${esc(E("Down"))}" data-tooltip="${esc(E("Down"))}"><i class="fa-solid fa-arrow-down ll-i"></i></button>` : ""}
		<button type="button" class="ll-btn ll-btn-square ll-btn-danger" data-action="remove" data-list="${listName}" data-index="${index}" aria-label="${esc(E("Remove"))}" data-tooltip="${esc(E("Remove"))}"><i class="fa-solid fa-trash ll-i"></i></button>
	</span></header>`;

function skillHTML(s, i) {
	const p = `skills.${i}`;
	const skills = skillIds().map(id => [id, skillLabel(id)]);
	if (s.skill && !skills.some(([id]) => id === s.skill)) skills.push([s.skill, s.skill]);
	return `<li class="item">
		${itemHeader("skills", i, `${skillLabel(s.skill)} · ${L("DC", { dc: s.dc })}`)}
		<div class="grid">
			${field(E("Skill"), select(`${p}.skill`, s.skill, skills))}
			${field(E("Role"), select(`${p}.role`, s.role, [["primary", E("RolePrimary")], ["secondary", E("RoleSecondary")]]))}
			${field(L("DCLabel"), num(`${p}.dc`, s.dc))}
			${field(E("Max"), num(`${p}.max`, s.max, 'min="0"'), { hint: E("MaxHint") })}
			${field(E("DCStep"), num(`${p}.dcStep`, s.dcStep), { hint: E("DCStepHint") })}
			${field(E("Effect"), select(`${p}.effect`, s.effect, EFFECTS.map(e => [e, E(`Effects.${e}`)])))}
			${field(E("Bonus"), num(`${p}.bonus`, s.bonus, 'min="0"'), { hint: E("BonusHint") })}
			${field(E("Penalty"), num(`${p}.penalty`, s.penalty, 'min="0"'), { hint: E("PenaltyHint") })}
			${field(E("BonusSkills"), txt(`${p}.bonusSkills`, s.bonusSkills.join(", "), "list"), { hint: E("BonusSkillsHint") })}
			${field(E("Difficulty"), select(`${p}.difficulty`, s.difficulty, [["", E("Auto")], ...DIFFICULTIES.map(d => [d, L(`Difficulty.${d}`)])]), { hint: E("DifficultyHint") })}
			${check(`${p}.countsFailure`, s.countsFailure, E("CountsFailure"))}
			${check(`${p}.hidden`, s.hidden, E("Hidden"))}
			${field(E("Description"), area(`${p}.description`, s.description), { wide: true })}
			${field(E("Note"), area(`${p}.note`, s.note), { wide: true })}
		</div>
	</li>`;
}

function stageHTML(s, i) {
	const p = `stages.${i}`;
	return `<li class="item">
		${itemHeader("stages", i, s.name || E("Stage", { n: i + 1 }))}
		<div class="grid">
			${field(E("Name"), txt(`${p}.name`, s.name))}
			${field(E("StageSuccesses"), num(`${p}.successes`, s.successes, 'min="0"'), { hint: E("StageSuccessesHint") })}
			${field(E("StagePenalty"), num(`${p}.penalty`, s.penalty, 'min="0"'))}
			${field(E("StageSkills"), txt(`${p}.skills`, s.skills.join(", "), "list"), { hint: E("StageSkillsHint") })}
			${field(E("Note"), area(`${p}.note`, s.note), { wide: true })}
		</div>
	</li>`;
}

const thresholdHTML = (t, i) => `<li class="item">
	${itemHeader("thresholds", i, L("ThresholdAt", { failures: t.failures }))}
	<div class="grid">${field(L("Failures"), num(`thresholds.${i}.failures`, t.failures, 'min="0"'))}${field(E("Text"), area(`thresholds.${i}.text`, t.text), { wide: true })}</div>
</li>`;

const groupHTML = (g, i) => `<li class="item">
	${itemHeader("groupChecks", i, g.name || L("Group.Title"))}
	<div class="grid">
		${field(E("Name"), txt(`groupChecks.${i}.name`, g.name))}
		${field(E("Options"), txt(`groupChecks.${i}.options`, optionsText(g.options), "options"), { hint: E("OptionsHint") })}
		${field(L("Group.Rule"), select(`groupChecks.${i}.rule`, g.rule, [["half", L("Group.RuleHalf")], ["all", L("Group.RuleAll")]]))}
		${field(E("Note"), area(`groupChecks.${i}.note`, g.note), { wide: true })}
	</div>
</li>`;

const section = (listName, title, items, hint = "") => `<section>
	<h4>${title}</h4>
	${hint ? `<p class="hint">${hint}</p>` : ""}
	<ol class="items">${items}</ol>
	<button type="button" class="ll-btn" data-action="add" data-list="${listName}"><i class="fa-solid fa-plus ll-i"></i> ${E("Add")}</button>
</section>`;

/* -------------------------------------------- */
/*  Window                                      */
/* -------------------------------------------- */

class ChallengeEditor extends ApplicationV2 {
	static DEFAULT_OPTIONS = {
		classes: ["lucd20-loot-app", "lucd20-sc-editor-window"],
		window: { title: "LUCD20.SkillChallenge.Editor.Title", icon: "fa-solid fa-pen", resizable: true },
		position: { width: 620, height: 720 },
		actions: {
			add: ChallengeEditor.#onAdd,
			remove: ChallengeEditor.#onRemove,
			move: ChallengeEditor.#onMove,
			save: ChallengeEditor.#onSave,
			cancel: ChallengeEditor.#onCancel
		}
	};

	constructor(page, onSaved) {
		super({ id: `lucd20-sc-edit-${page.uuid.replace(/[^A-Za-z0-9]/g, "_")}` });
		this.page = page;
		this.onSaved = onSaved;
		const raw = page.flags?.[MODULE_ID]?.[FLAG] ?? {};
		this.data = { name: page.name, ...(normalizeChallenge(raw) ?? normalizeChallenge({})) };
		this.data.visibility ??= "";
		this.routesText = JSON.stringify(raw.routes ?? [], null, 2);
	}

	get title() {
		return `${E("Title")}: ${this.data.name}`;
	}

	async _renderHTML() {
		const d = this.data;
		return `<div class="lucd20-sc-body lucd20-sc-editor">
			<div class="lucd20-sc-scroll">
				<section>
					<div class="grid">
						${field(E("Name"), txt("name", d.name), { wide: true })}
						${field(E("Level"), num("level", d.level, 'min="0"'))}
						${field(E("XP"), num("xp", d.xp, 'min="0"'))}
						${field(L("Successes"), num("successes", d.successes, 'min="1"'))}
						${field(L("Failures"), num("failures", d.failures, 'min="1"'))}
						${field(E("Visibility"), select("visibility", d.visibility, [["", E("VisibilityDefault")], ["open", L("OpenLabel")], ["secret", L("SecretLabel")]]))}
						${check("playerRolls", d.playerRolls, E("PlayerRolls"))}
						${check("hints", d.hints, E("Hints"))}
						${field(L("OnSuccess"), area("successText", d.successText), { wide: true, hint: E("OutcomeHint") })}
						${field(L("OnFailure"), area("failureText", d.failureText), { wide: true, hint: E("OutcomeHint") })}
						${field(L("Notes"), area("note", d.note), { wide: true })}
					</div>
				</section>
				${section("skills", E("Skills"), d.skills.map(skillHTML).join(""))}
				${section("stages", E("Stages"), d.stages.map(stageHTML).join(""), E("StagesHint"))}
				${section("thresholds", E("Thresholds"), d.thresholds.map(thresholdHTML).join(""), E("ThresholdsHint"))}
				${section("groupChecks", E("GroupChecks"), d.groupChecks.map(groupHTML).join(""), E("GroupChecksHint"))}
				<section>
					<h4>${E("Routes")}</h4>
					<p class="hint">${E("RoutesHint")}</p>
					<textarea class="routes" name="routes" rows="6" spellcheck="false">${esc(this.routesText)}</textarea>
				</section>
			</div>
			<footer class="lucd20-loot-footer">
				<button type="button" class="ll-btn ll-btn-footer ll-btn-primary" data-action="save"><i class="fa-solid fa-floppy-disk ll-i"></i> ${E("Save")}</button>
				<button type="button" class="ll-btn ll-btn-footer" data-action="cancel">${L("Cancel")}</button>
			</footer>
		</div>`;
	}

	_replaceHTML(result, content) {
		const top = content.querySelector(".lucd20-sc-scroll")?.scrollTop ?? 0;
		content.innerHTML = result;
		const scroll = content.querySelector(".lucd20-sc-scroll");
		if (scroll) scroll.scrollTop = top;
		// Every edit goes straight into the working copy, so adding or removing a row never loses typing.
		content.querySelector(".lucd20-sc-editor")?.addEventListener("change", event => {
			const input = event.target;
			if (input.name === "routes") this.routesText = input.value;
			else if (input.dataset?.path) setPath(this.data, input.dataset.path, read(input));
		});
	}

	static #onAdd(event, target) {
		const listName = target.dataset.list;
		const item = BLANK[listName]?.();
		if (!item) return;
		// Through normalize, so the new row has every field.
		// (normalize drops rows without a name / text, so give it placeholders and blank them after)
		const filled = normalizeChallenge({ [listName]: [{ ...item, name: " ", text: " " }] })[listName][0];
		if (filled.name === " ") filled.name = "";
		if (filled.text === " ") filled.text = "";
		this.data[listName].push(filled);
		this.render();
	}

	static #onRemove(event, target) {
		this.data[target.dataset.list]?.splice(Number(target.dataset.index), 1);
		this.render();
	}

	static #onMove(event, target) {
		const items = this.data[target.dataset.list];
		const from = Number(target.dataset.index);
		const to = from + Number(target.dataset.d);
		if (!items || to < 0 || to >= items.length) return;
		items.splice(to, 0, ...items.splice(from, 1));
		this.render();
	}

	static async #onSave() {
		let routes;
		try {
			routes = JSON.parse(this.routesText.trim() || "[]");
			if (!Array.isArray(routes)) throw new Error("not a list");
		} catch (err) {
			return ui.notifications?.error(E("RoutesInvalid"));
		}
		const { name, ...rest } = this.data;
		// Ids are worked out again from the skills (they only matter when a skill is listed twice).
		const data = normalizeChallenge({ ...rest, skills: rest.skills.map(({ id, ...s }) => s), routes, complexity: 0 });
		data.routes = routes;
		data.visibility = rest.visibility || null;
		delete data.complexity;
		try {
			await this.page.update({ name: name.trim() || this.page.name, [`flags.${MODULE_ID}.${FLAG}`]: data });
		} catch (err) {
			error("Skill Challenges: could not save the challenge.", err);
			return ui.notifications?.error(E("SaveFailed"));
		}
		await this.onSaved?.();
		this.close();
	}

	static #onCancel() {
		this.close();
	}
}

/** Open the editor for the challenge on this (world) journal page. */
export async function openEditor(uuid, onSaved) {
	const page = await fromUuid(uuid);
	if (!page) return ui.notifications?.warn(L("Missing"));
	const id = `lucd20-sc-edit-${page.uuid.replace(/[^A-Za-z0-9]/g, "_")}`;
	const app = foundry.applications.instances?.get(id) ?? new ChallengeEditor(page, onSaved);
	return app.render({ force: true });
}
