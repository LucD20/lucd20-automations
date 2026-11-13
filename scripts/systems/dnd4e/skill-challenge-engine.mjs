/*
 * Skill Challenge rules, with no Foundry calls (so the harness can test them).
 *
 * A challenge is data on a journal text page, in
 * flags["lucd20-automations"].skillChallenge (format: docs/skill-challenge.md):
 *
 *   { level, xp, complexity, successes, failures, visibility,
 *     skills: [{ skill, role, dc, max, dcStep, effect, bonus, penalty,
 *                bonusSkills, countsFailure, note }],
 *     successText, failureText, note }
 *
 * A run is only a log. Everything else (tally, uses per skill, current DCs,
 * waiting bonuses, status) is worked out again from the log each time, so
 * Undo is "drop the last entry". The log never stores a DC: it is kept in a
 * world setting, which players' clients receive.
 *
 *   check  { type: "check", skillId, outcome: "success" | "failure", ds, df, grant, … }
 *   manual { type: "manual", ds, df }
 * ds / df = change to successes / failures. grant = { value, skills } bonus
 * (or penalty) for the next check.
 */

export const EFFECTS = ["success", "bonus", "cancelFailure", "none"];

const int = (value, fallback = 0) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Math.trunc(Number(value)) : fallback);

/** Fill in defaults, so the rest of the code can rely on every field. Returns null for unusable data. */
export function normalizeChallenge(raw) {
	if (!raw || typeof raw !== "object") return null;
	const complexity = Math.max(0, int(raw.complexity, 0));
	const successes = Math.max(1, int(raw.successes, complexity ? 2 + 2 * complexity : 4));
	const failures = Math.max(1, int(raw.failures, 3));
	const seen = new Set();
	const skills = [];
	for (const s of Array.isArray(raw.skills) ? raw.skills : []) {
		if (!s?.skill) continue;
		const role = s.role === "secondary" ? "secondary" : "primary";
		let id = String(s.id ?? s.skill);
		while (seen.has(id)) id += "+";
		seen.add(id);
		const effect = EFFECTS.includes(s.effect) ? s.effect : (role === "primary" ? "success" : "none");
		skills.push({
			id,
			skill: String(s.skill),
			role,
			dc: int(s.dc, 10),
			max: Math.max(0, int(s.max, 0)),
			dcStep: int(s.dcStep, 0),
			effect,
			bonus: Math.abs(int(s.bonus, effect === "bonus" ? 2 : 0)),
			penalty: Math.abs(int(s.penalty, 0)),
			bonusSkills: Array.isArray(s.bonusSkills) ? s.bonusSkills.map(String) : [],
			countsFailure: typeof s.countsFailure === "boolean" ? s.countsFailure : role === "primary",
			note: String(s.note ?? "")
		});
	}
	return {
		level: int(raw.level, 0),
		xp: int(raw.xp, 0),
		complexity,
		successes,
		failures,
		visibility: ["open", "secret"].includes(raw.visibility) ? raw.visibility : null,
		skills,
		successText: String(raw.successText ?? ""),
		failureText: String(raw.failureText ?? ""),
		note: String(raw.note ?? "")
	};
}

/** A skill that isn't in the challenge's list (the runner's "Other skill" row). */
export function otherSkill(skill, dc) {
	return {
		id: `other:${skill}`, skill, role: "primary", dc: int(dc, 10), max: 0, dcStep: 0, effect: "success",
		bonus: 0, penalty: 0, bonusSkills: [], countsFailure: true, note: "", other: true
	};
}

const matches = (grant, skill) => !grant.skills?.length || grant.skills.includes(skill);

/**
 * Replay a log.
 * → { successes, failures, uses: { skillId: n }, wins: { skillId: n }, bonuses: [grant], status }
 */
export function computeState(def, log = []) {
	const state = { successes: 0, failures: 0, uses: {}, wins: {}, bonuses: [], status: "running" };
	for (const entry of log) {
		if (entry.type === "check") {
			state.uses[entry.skillId] = (state.uses[entry.skillId] ?? 0) + 1;
			if (entry.outcome === "success") state.wins[entry.skillId] = (state.wins[entry.skillId] ?? 0) + 1;
			// A check uses up every waiting bonus that applies to its skill.
			state.bonuses = state.bonuses.filter(g => !matches(g, entry.skill));
			if (entry.grant?.value) state.bonuses.push(entry.grant);
		}
		state.successes = Math.max(0, state.successes + (entry.ds ?? 0));
		state.failures = Math.max(0, state.failures + (entry.df ?? 0));
	}
	if (state.successes >= def.successes) state.status = "success";
	else if (state.failures >= def.failures) state.status = "failure";
	return state;
}

/** The DC of a skill right now (it can rise with each use). */
export function currentDC(skillDef, state) {
	return skillDef.dc + skillDef.dcStep * (state.uses[skillDef.id] ?? 0);
}

/** The bonus (or penalty) waiting for the next check with this skill. */
export function waitingBonus(skillDef, state) {
	return state.bonuses.filter(g => matches(g, skillDef.skill)).reduce((sum, g) => sum + g.value, 0);
}

/** Whether this skill already gave everything it can ("maximum 1 success"). */
export function isSpent(skillDef, state) {
	return skillDef.max > 0 && (state.wins[skillDef.id] ?? 0) >= skillDef.max;
}

/**
 * Judge a roll.
 * → { dc, bonus, outcome, ds, df, grant } (dc is for the GM's eyes; don't store it)
 */
export function resolveCheck(skillDef, state, total) {
	const dc = currentDC(skillDef, state);
	const bonus = waitingBonus(skillDef, state);
	const success = total + bonus >= dc;
	const result = { dc, bonus, outcome: success ? "success" : "failure", ds: 0, df: 0, grant: null };
	const skills = skillDef.bonusSkills;
	if (success) {
		if (skillDef.effect === "success" && !isSpent(skillDef, state)) result.ds = 1;
		else if (skillDef.effect === "bonus" && skillDef.bonus) result.grant = { value: skillDef.bonus, skills };
		else if (skillDef.effect === "cancelFailure" && state.failures > 0) result.df = -1;
	} else {
		if (skillDef.countsFailure) result.df = 1;
		if (skillDef.penalty) result.grant = { value: -skillDef.penalty, skills };
	}
	return result;
}
