/*
 * Reads movement out of a power's text (EN / PT):
 *   forced movement  "push/pull/slide the target N squares", "o alvo é empurrado/puxado/conduzido N quadrados"
 *   ally shifts      "the target / an ally can shift N squares", "o aliado pode ajustar N quadrados"
 *   follow-up        "During the slide, you or one of your allies can make a melee basic attack" (+N power bonus)
 * The detail fields (Hit / Miss / Effect) are read first; without a match there, the description's
 * "Hit:/Sucesso:", "Miss:/Fracasso:" and "Effect:/Efeito:" paragraphs.
 */

const MODES = [
	{ mode: "push", re: /^(push|empurr)/i },
	{ mode: "pull", re: /^(pull|pux)/i },
	{ mode: "slide", re: /^(slide|conduz)/i },
];
const FORCED_RE = /\b(push(?:es|ed)?|pull(?:s|ed)?|slid(?:e|es|ing)|empurr\w*|pux\w*|conduz\w*|conduzid\w*)\b([^.;:]{0,40}?)\b(\d+)\s+(?:squares?|quadrados?)/gi;
const MINOR_RE = /minor action|a[çc][ãa]o m[íi]nima/i;
const ALLY_SHIFT_RE = /\b(ally|allies|target|each ally|aliad[oa]s?|alvo)\b[^.;]{0,30}?\b(shifts?|ajust\w*)\s+(\d+)\s+(?:squares?|quadrados?)/gi;
const FOLLOW_UP_RE = /(during the slide[^.]*melee basic attack|durante (?:a|o) (?:condu[çc][ãa]o|deslocamento)[^.]*ataque b[áa]sico corpo a corpo)/i;
const FOLLOW_UP_BONUS_RE = /\+(\d+) power bonus|b[ôo]nus de poder de \+?(\d+)|\+(\d+) de b[ôo]nus de poder/i;

function plain(html) {
	return String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ");
}

/** Split a power description into its Hit / Miss / Effect paragraphs. */
function descriptionSections(html) {
	const text = plain(html);
	const out = {};
	const re = /\b(Hit|Sucesso|Acerto|Miss|Fracasso|Erro|Effect|Efeito)\s*:/gi;
	const marks = [...text.matchAll(re)];
	for (const [n, m] of marks.entries()) {
		const end = marks[n + 1]?.index ?? text.length;
		const word = m[1].toLowerCase();
		const when = ["hit", "sucesso", "acerto"].includes(word) ? "hit" : ["miss", "fracasso", "erro"].includes(word) ? "miss" : "effect";
		out[when] = `${out[when] ?? ""} ${text.slice(m.index + m[0].length, end)}`;
	}
	return out;
}

/** Hit / Miss / Effect texts of a power: its detail fields, or the description's sections when those are empty. */
export function sectionTexts(item) {
	const sys = item?.system ?? {};
	const fields = { hit: plain(sys.hit?.detail).trim(), miss: plain(sys.miss?.detail).trim(), effect: plain(sys.effect?.detail).trim() };
	const desc = descriptionSections(sys.description?.value);
	for (const k of Object.keys(fields)) if (!fields[k] && desc[k]) fields[k] = desc[k].trim();
	return fields;
}

function powerTexts(item) {
	const sys = item?.system ?? {};
	const fields = { hit: plain(sys.hit?.detail), miss: plain(sys.miss?.detail), effect: plain(sys.effect?.detail) };
	const forced = new RegExp(FORCED_RE.source, "i");
	const ally = new RegExp(ALLY_SHIFT_RE.source, "i");
	if (Object.values(fields).some((t) => forced.test(t) || ally.test(t))) return fields;
	return { ...fields, ...descriptionSections(sys.description?.value) };
}

/**
 * Forced movement in a power: [{ mode, squares, when: "hit"|"miss"|"effect", followUp }].
 * Only the first one per section, skipping repeatable "as a minor action" slides.
 */
export function forcedMovesFor(item) {
	const out = [];
	const texts = powerTexts(item);
	const all = Object.values(texts).join(" ");
	for (const when of ["hit", "miss", "effect"]) {
		const text = texts[when];
		if (!text) continue;
		for (const m of text.matchAll(FORCED_RE)) {
			const around = text.slice(m.index, m.index + m[0].length + 40);
			if (MINOR_RE.test(around)) continue;
			const mode = MODES.find((x) => x.re.test(m[1]))?.mode;
			if (!mode) continue;
			// "you slide each enemy" vs "the target": both apply to the power's targets
			let followUp = null;
			if (FOLLOW_UP_RE.test(all)) {
				const b = all.match(FOLLOW_UP_BONUS_RE);
				followUp = { bonus: Number(b?.[1] ?? b?.[2] ?? b?.[3]) || 0 };
			}
			out.push({ mode, squares: Number(m[3]), when, followUp });
			break;
		}
	}
	return out;
}

/** Shifts the power grants to its targets/allies: [{ squares, when }]. */
export function allyShiftsFor(item) {
	const out = [];
	const texts = powerTexts(item);
	for (const when of ["hit", "miss", "effect"]) {
		const text = texts[when];
		if (!text) continue;
		const m = [...text.matchAll(ALLY_SHIFT_RE)][0];
		if (m) out.push({ squares: Number(m[3]), when });
	}
	return out;
}

/* -------------------------------------------- */
/*  "The target falls prone" riders               */
/* -------------------------------------------- */

/*
 * Read from the power's Hit text (detail field or the description's "Hit:/Sucesso:" paragraph):
 *   "If the wolf has combat advantage against the target, the target falls prone" -> only when the attack
 *     had combat advantage against that target (the Combat Advantage box of the attack dialog)
 *   "the target falls prone" / "o alvo fica derrubado" -> on every hit
 * "2d6 + 5 against a prone target" / "contra um alvo derrubado" is not a rider.
 */
const PRONE_CA = [
	/combat advantage against (?:the |that |a )?target[^.]*?\b(?:falls|is knocked|knocked|knocks it) prone/i,
	/\b(?:falls|is knocked|knocked) prone[^.]*?combat advantage/i,
	/vantagem de combate contra (?:o|esse|um) alvo[^.]*?\bderrubad[oa]/i,
	/(?<![\wÀ-ú])(?:fica|cai|é) derrubad[oa][^.]*?vantagem de combate/i,
];
const PRONE_ALWAYS = [
	/\b(?:the )?target (?:falls|is knocked) prone\b/i,
	/\bknocks? (?:the target|it) prone\b/i,
	/\bo alvo (?:fica|cai|é) derrubad[oa]\b/i,
	/\bderruba o alvo\b/i,
];

/**
 * { combatAdvantage, when } when the power knocks targets prone, else null. when = "hit" (Hit line, hit
 * targets) or "effect" (Effect line, every target).
 */
export function proneRiderFor(item) {
	const texts = sectionTexts(item);
	for (const when of ["hit", "effect"]) {
		const text = texts[when];
		if (!text) continue;
		if (PRONE_CA.some((re) => re.test(text))) return { combatAdvantage: true, when };
		if (PRONE_ALWAYS.some((re) => re.test(text))) return { combatAdvantage: false, when };
	}
	return null;
}
