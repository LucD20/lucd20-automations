import { localize } from "../../core/constants.js";

/* Small helpers shared by the Skill Challenge windows (GM runner, players' window, editor). */

export const FLAG = "skillChallenge";
/** World setting the GM's client writes for players: only what they may know (engine: publicView). */
export const PUBLIC_KEY = "skillChallenge_public";

export const esc = value => Handlebars.escapeExpression(String(value ?? ""));
export const L = (key, data) => localize(`LUCD20.SkillChallenge.${key}`, data);
export const signed = n => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

export const skillIds = () => Object.keys(CONFIG.DND4E?.skills ?? {});

export function skillLabel(id) {
	const label = CONFIG.DND4E?.skills?.[id]?.label;
	return label ? game.i18n.localize(label) : id;
}

/** Successes and failures as rows of pips. `def` needs successes / failures; `st` the counts. */
export function tallyHTML(def, st) {
	const pips = (n, max, cls) => Array.from({ length: max }, (_, i) => `<i class="pip ${cls}${i < n ? " on" : ""}"></i>`).join("");
	return `<div class="lucd20-sc-tally">
		<span class="track success"><span class="label">${L("Successes")}</span><span class="pips">${pips(st.successes, def.successes, "success")}</span><b>${Math.min(st.successes, def.successes)}/${def.successes}</b></span>
		<span class="track failure"><span class="label">${L("Failures")}</span><span class="pips">${pips(st.failures, def.failures, "failure")}</span><b>${Math.min(st.failures, def.failures)}/${def.failures}</b></span>
	</div>`;
}

/** A row of character portraits; click one to choose who rolls. */
export function portraitsHTML(actors, activeId) {
	return `<div class="lucd20-sc-pcs" role="radiogroup" aria-label="${esc(L("Character"))}">
		${actors.length ? actors.map(a => `<button type="button" class="pc${a.id === activeId ? " active" : ""}" role="radio" aria-checked="${a.id === activeId}" data-action="pick" data-actor="${esc(a.id)}" data-tooltip="${esc(a.name)}">
			<img src="${esc(a.img || "icons/svg/mystery-man.svg")}" alt=""><span>${esc(a.name)}</span></button>`).join("") : `<span class="label">${L("NoCharacters")}</span>`}
	</div>`;
}
