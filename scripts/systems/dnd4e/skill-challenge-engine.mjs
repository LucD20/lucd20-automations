/*
 * Skill Challenge rules, with no Foundry calls (so the harness can test them).
 *
 * A challenge is data on a journal text page, in
 * flags["lucd20-automations"].skillChallenge (format: docs/skill-challenge.md).
 *
 * A run is only a log plus a few choices (route, successes needed, revealed
 * skills). Everything else (tally, uses per skill, current DCs, waiting
 * bonuses, stage, status) is worked out again from the log each time, so Undo
 * is "drop the last entry". The log never stores a DC: it is kept in a world
 * setting, which players' clients receive.
 *
 *   check  { type: "check", skillId, skill, outcome, ds, df, grant, mod, … }
 *   group  { type: "group", name, results: [{ actorName, skill, total, outcome }], ds, df }
 *   manual { type: "manual", ds, df }
 * ds / df = change to successes / failures. grant = { value, skills } bonus
 * (or penalty) for the next check.
 */

export const EFFECTS = ["success", "bonus", "cancelFailure", "none"];
export const DIFFICULTIES = ["easier", "easy", "medium", "hard", "harder"];

const int = (value, fallback = 0) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Math.trunc(Number(value)) : fallback);
const list = value => (Array.isArray(value) ? value : []);
const text = value => String(value ?? "");

function normalizeSkill(s, seen) {
	const role = s.role === "secondary" ? "secondary" : "primary";
	let id = text(s.id ?? s.skill);
	while (seen.has(id)) id += "+";
	seen.add(id);
	const effect = EFFECTS.includes(s.effect) ? s.effect : (role === "primary" ? "success" : "none");
	return {
		id,
		skill: text(s.skill),
		role,
		dc: int(s.dc, 10),
		max: Math.max(0, int(s.max, 0)),
		dcStep: int(s.dcStep, 0),
		effect,
		bonus: Math.abs(int(s.bonus, effect === "bonus" ? 2 : 0)),
		penalty: Math.abs(int(s.penalty, 0)),
		bonusSkills: list(s.bonusSkills).map(String),
		countsFailure: typeof s.countsFailure === "boolean" ? s.countsFailure : role === "primary",
		hidden: s.hidden === true,
		difficulty: DIFFICULTIES.includes(s.difficulty) ? s.difficulty : "",
		description: text(s.description),
		note: text(s.note)
	};
}

const normalizeOptions = options => list(options).filter(o => o?.skill).map(o => ({ skill: text(o.skill), dc: int(o.dc, 10) }));

/** Fill in defaults, so the rest of the code can rely on every field. Returns null for unusable data. */
export function normalizeChallenge(raw) {
	if (!raw || typeof raw !== "object") return null;
	const complexity = Math.max(0, int(raw.complexity, 0));
	const successes = Math.max(1, int(raw.successes, complexity ? 2 + 2 * complexity : 4));
	const seen = new Set();
	const skills = list(raw.skills).filter(s => s?.skill).map(s => normalizeSkill(s, seen));
	return {
		level: int(raw.level, 0),
		xp: int(raw.xp, 0),
		complexity,
		successes,
		failures: Math.max(1, int(raw.failures, 3)),
		visibility: ["open", "secret"].includes(raw.visibility) ? raw.visibility : null,
		playerRolls: raw.playerRolls !== false,
		hints: raw.hints !== false,
		skills,
		routes: list(raw.routes).filter(r => r?.name).map((r, i) => ({
			id: text(r.id ?? `route${i + 1}`),
			name: text(r.name),
			note: text(r.note),
			// Overrides for listed skills (matched by id, else by skill key) and extra skills.
			skills: list(r.skills).filter(s => s?.skill || s?.id).map(s => ({ ...s }))
		})),
		stages: list(raw.stages).filter(s => s && typeof s === "object").map((s, i) => ({
			name: text(s.name || `${i + 1}`),
			successes: Math.max(0, int(s.successes, 0)),
			penalty: Math.abs(int(s.penalty, 2)),
			skills: list(s.skills).map(String),
			note: text(s.note)
		})),
		thresholds: list(raw.thresholds).filter(t => t?.text).map(t => ({ failures: Math.max(0, int(t.failures, 1)), text: text(t.text) }))
			.sort((a, b) => a.failures - b.failures),
		groupChecks: list(raw.groupChecks).filter(g => g?.name).map(g => ({ name: text(g.name), note: text(g.note), rule: g.rule === "all" ? "all" : "half", options: normalizeOptions(g.options) })),
		successText: text(raw.successText),
		failureText: text(raw.failureText),
		note: text(raw.note)
	};
}

/**
 * The challenge as this run plays it: its route's changes applied and the
 * "successes needed" the GM set in the runner.
 */
export function applyRun(def, run = {}) {
	const out = { ...def, skills: def.skills.map(s => ({ ...s })), route: null };
	const route = def.routes.find(r => r.id === run.route) ?? null;
	if (route) {
		out.route = route;
		const seen = new Set(out.skills.map(s => s.id));
		for (const change of route.skills) {
			const index = out.skills.findIndex(s => s.id === (change.id ?? change.skill));
			if (index >= 0) {
				if (change.remove) out.skills.splice(index, 1);
				else {
					const base = out.skills[index];
					out.skills[index] = normalizeSkill({ ...base, ...change, id: base.id, skill: base.skill }, new Set());
				}
			} else if (!change.remove && change.skill) {
				out.skills.push(normalizeSkill(change, seen));
			}
		}
	}
	if (Number.isFinite(Number(run.needed)) && run.needed !== null) out.successes = Math.max(1, int(run.needed, out.successes));
	return out;
}

/** A skill that isn't in the challenge's list (the runner's "Other skill" row). */
export function otherSkill(skill, dc) {
	return { ...normalizeSkill({ skill, dc, id: `other:${skill}` }, new Set()), other: true };
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
 * The stage the party is in: stages are completed in order, each after its
 * number of successes (the last one takes whatever is left).
 * → { index, stage } or null when the challenge has no stages.
 */
export function currentStage(def, state) {
	if (!def.stages.length) return null;
	let done = 0;
	for (let index = 0; index < def.stages.length; index++) {
		const stage = def.stages[index];
		done += stage.successes;
		if (index === def.stages.length - 1 || !stage.successes || state.successes < done) return { index, stage };
	}
	return null;
}

/** Penalty for using a skill that doesn't belong to the current stage (only when the stage lists its skills). */
export function stagePenalty(def, state, skillDef) {
	const stage = currentStage(def, state)?.stage;
	return stage?.skills.length && !stage.skills.includes(skillDef.id) ? stage.penalty : 0;
}

/**
 * Judge a roll. `mod` is the GM's modifier for this check (wrong stage, a bribe …).
 * → { dc, bonus, mod, outcome, ds, df, grant } (dc is for the GM's eyes; don't store it)
 */
export function resolveCheck(skillDef, state, total, mod = 0) {
	const dc = currentDC(skillDef, state);
	const bonus = waitingBonus(skillDef, state);
	const success = total + bonus + mod >= dc;
	const result = { dc, bonus, mod, outcome: success ? "success" : "failure", ds: 0, df: 0, grant: null };
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

/**
 * A group check. Rule "half": at least half succeed = 1 success, otherwise 1
 * failure. Rule "all": everyone must succeed (one failed check = 1 failure).
 */
export function resolveGroup(results, rule = "half") {
	const wins = results.filter(r => r.outcome === "success").length;
	const passed = rule === "all" ? wins === results.length : wins * 2 >= results.length;
	return passed ? { ds: 1, df: 0 } : { ds: 0, df: 1 };
}

/* -------------------------------------------- */
/*  What players may know                       */
/* -------------------------------------------- */

// Easy / moderate / hard DC by level (Rules Compendium), index = level − 1.
const LEVEL_DCS = [
	[8, 12, 19], [9, 13, 20], [9, 13, 21], [10, 14, 21], [10, 15, 22], [11, 15, 23], [11, 16, 23], [12, 16, 24], [12, 17, 25], [13, 18, 26],
	[13, 19, 27], [14, 20, 28], [14, 20, 29], [15, 21, 29], [15, 22, 30], [16, 22, 31], [16, 23, 31], [17, 23, 32], [17, 24, 33], [18, 25, 34],
	[19, 26, 35], [20, 27, 36], [20, 27, 37], [21, 28, 37], [21, 29, 38], [22, 29, 39], [22, 30, 39], [23, 30, 40], [23, 31, 41], [24, 32, 42]
];

/** A word for how hard a DC is at a level: easier / easy / medium / hard / harder. */
export function difficultyOf(dc, level) {
	const [easy, moderate, hard] = LEVEL_DCS[Math.min(30, Math.max(1, int(level, 1))) - 1];
	if (dc < easy) return "easier";
	if (dc < moderate) return "easy";
	if (dc < (moderate + hard) / 2) return "medium";
	if (dc <= hard) return "hard";
	return "harder";
}

/**
 * The part of a running challenge that players' clients receive: names,
 * descriptions written for players, a difficulty word and the tally. Never a
 * DC, a limit, a GM note, a stage, a threshold or a hidden skill.
 * `def` is the run's challenge (applyRun), `run` needs name / playerRolls / revealed.
 */
export function publicView(def, run, state) {
	const revealed = new Set(run.revealed ?? []);
	return {
		name: run.name,
		successes: def.successes,
		failures: def.failures,
		tally: [Math.min(state.successes, def.successes), Math.min(state.failures, def.failures)],
		canRoll: run.playerRolls !== false,
		skills: def.skills.filter(s => !s.hidden || revealed.has(s.id)).map(s => ({
			id: s.id,
			skill: s.skill,
			role: s.role,
			description: s.description,
			difficulty: def.hints ? (s.difficulty || difficultyOf(currentDC(s, state), def.level)) : "",
			spent: isSpent(s, state)
		}))
	};
}
