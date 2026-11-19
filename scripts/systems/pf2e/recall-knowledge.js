import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { sysId } from "./sys.js";

/**
 * Recall Knowledge (owner, v0.78.0: "assimilate that macro into our module, with any improvements"). Replaces
 * PF2e Workbench's "Recall_Knowledge" macro (community macro; read for what it does, no code copied: its
 * repository has no licence). One secret d20 for every skill; the whole result goes to the GMs only.
 *
 * recallKnowledge({ actor, token, targets, modifiers, label }):
 * - With targets (creatures / hazards): per target, the skills that identify it with their totals and the
 *   degree of success against each attempt's DC (1st–4th), then the creature's lore DCs (unspecific,
 *   specific) and every Lore of the actor against both; modifiers that only apply to some Recall Knowledge
 *   checks ("might apply"); Unified Theory (Arcana for Nature / Occultism / Religion), Dubious Knowledge and
 *   Unmistakable Lore noted.
 * - Without targets: every Recall Knowledge skill and Lore with its total.
 *
 * Better than the macro:
 * - The DCs, the skills and the attempt progression come from PF2e itself (`identificationDCs`: rarity,
 *   proficiency without level, the lore adjustments), worked out the same way when PF2e has none.
 * - `modifiers` are added to every total (Combat Assessment's +2 on a critical hit): no temporary effect.
 * - Degree-of-success adjustments (e.g. a feat that upgrades a success) from the actor's rule elements.
 * - Our own card style (no inline styles), all text localized, hidden names safe (the card is GM-only).
 *
 * Used by Combat Assessment (rule 21), the PF2e shortcut "Recall Knowledge" and the API
 * `game.modules.get("lucd20-automations").api.pf2e.recallKnowledge()`.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.Recall.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
export const RK_SKILLS = ["arcana", "crafting", "medicine", "nature", "occultism", "religion", "society"];
// Creature traits → identifying skills (PF2e's own table, used when the system gives none).
const IDENTIFY = {
	aberration: ["occultism"], animal: ["nature"], astral: ["occultism"], beast: ["arcana", "nature"], celestial: ["religion"],
	construct: ["arcana", "crafting"], dragon: ["arcana"], dream: ["occultism"], elemental: ["arcana", "nature"], ethereal: ["occultism"],
	fey: ["nature"], fiend: ["religion"], fungus: ["nature"], giant: ["society"], humanoid: ["society"], monitor: ["religion"],
	ooze: ["occultism"], shade: ["religion"], plant: ["nature"], spirit: ["occultism"], time: ["occultism"], undead: ["religion"]
};
// The difficulty steps (GM Core): incredibly easy … incredibly hard; rarity starts higher, lores lower.
const STEPS = [-10, -5, -2, 0, 2, 5, 10];
const RARITY_START = { common: 3, uncommon: 4, rare: 5, unique: 6 };
const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];
const RANKS = ["U", "T", "E", "M", "L"];

/** DC by level (GM Core), as PF2e computes it. */
export function levelDC(level) {
	if (level > 20) return level * 2;
	return 14 + level + (level < 0 ? 0 : Math.floor(level / 3));
}

/** A progression of DCs from a step (index into STEPS) on; the steps beyond "incredibly hard" are dropped. */
function progression(base, start) {
	return STEPS.slice(Math.max(0, start)).slice(0, 4).map((s) => base + s);
}

/** The DCs and skills to identify a creature: PF2e's, else worked out the same way. */
export function identification(target) {
	const sys = target?.identificationDCs;
	if (sys?.standard?.progression?.length) {
		return { skills: [...new Set(sys.skills ?? [])], standard: sys.standard.progression.slice(0, 4), lore: (sys.lore ?? []).map((l) => l.progression?.slice(0, 4) ?? []) };
	}
	const traits = new Set(target?.system?.traits?.value ?? [...(target?.traits ?? [])]);
	const skills = [...new Set([...traits].flatMap((t) => IDENTIFY[t] ?? []))];
	const base = levelDC(Number(target?.level ?? target?.system?.details?.level?.value) || 0);
	const start = RARITY_START[target?.rarity ?? target?.system?.traits?.rarity] ?? 3;
	return { skills, standard: progression(base, start), lore: [progression(base, start - 1), progression(base, start - 2)] };
}

/** PF2e's degree of success (natural 20 / 1 shift it). */
export function degreeOf(total, dc, natural) {
	let d = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
	if (natural === 20) d += 1;
	else if (natural === 1) d -= 1;
	return Math.max(0, Math.min(3, d));
}

/** Degree-of-success adjustments from the actor's rule elements (e.g. "a success is a critical success"). */
function adjusted(actor, degree, { total, natural, dc, domains = [], options = [] }) {
	const all = [...options, `check:total:${total}`, `check:total:natural:${natural}`, `check:total:delta:${total - dc}`];
	let best = null;
	for (const domain of domains) {
		for (const a of actor?.synthetics?.degreeOfSuccessAdjustments?.[domain] ?? []) {
			if (a.predicate?.test && !a.predicate.test(all)) continue;
			for (const adj of [a.adjustments?.all, a.adjustments?.[DEGREES[degree]]].filter(Boolean)) {
				const named = DEGREES.indexOf(adj.amount);
				const to = named >= 0 ? named : Math.max(0, Math.min(3, degree + Number(adj.amount)));
				if (!best || to > best.degree) best = { degree: to, label: adj.label ?? a.label ?? "" };
			}
		}
	}
	return best && best.degree !== degree ? best : null;
}

const flatOptions = (predicate) => {
	const out = [];
	const walk = (p) => { for (const t of p ?? []) (t && typeof t === "object" ? Object.values(t).forEach(walk) : out.push(t)); };
	walk(predicate);
	return out;
};

/**
 * A skill's total for this d20 without a message: PF2e works out the modifiers (with the target's roll
 * options, so trait-based bonuses count). Falls back to the plain modifier.
 */
async function skillTotal(actor, slug, d20, target, extra) {
	const skill = actor.skills?.[slug];
	if (!skill) return null;
	const options = ["action:recall-knowledge", `action:recall-knowledge:${slug}`, `skill:rank:${skill.rank ?? 0}`, ...(target?.getSelfRollOptions?.("target") ?? [])];
	let modifier = Number(skill.check?.mod ?? skill.mod ?? 0), rollOptions = options, domains = [];
	try {
		const result = await Promise.race([
			new Promise((resolve) => skill.roll({
				createMessage: false, skipDialog: true, rollMode: "blindroll", extraRollOptions: options, modifiers: [],
				callback: (roll, outcome, message) => resolve({ roll, message })
			})),
			new Promise((resolve) => setTimeout(() => resolve(null), 3000))
		]);
		if (result?.roll) {
			modifier = Number(result.roll.options?.totalModifier ?? modifier);
			rollOptions = result.message?.getFlag?.(sysId(), "context.options") ?? result.message?.flags?.[sysId()]?.context?.options ?? options;
			domains = result.message?.getFlag?.(sysId(), "context.domains") ?? result.message?.flags?.[sysId()]?.context?.domains ?? [];
		}
	} catch (err) {
		/* the plain modifier */
	}
	modifier += extra;
	// Recall Knowledge modifiers whose conditions aren't met for this check ("might apply").
	const conditional = (skill.modifiers ?? []).filter((m) => flatOptions(m.predicate).includes("action:recall-knowledge") && m.predicate?.test);
	const maybe = conditional.filter((m) => !m.predicate.test(rollOptions));
	const applied = conditional.filter((m) => m.predicate.test(rollOptions)).map((m) => m.slug);
	return { slug, label: skill.label ?? slug, rank: Number(skill.rank) || 0, modifier, total: d20 + modifier, rollOptions, domains, maybe, applied };
}

const signed = (n) => `${n >= 0 ? "+" : ""}${n}`;
const hasFeat = (actor, slug) => (actor?.itemTypes?.feat ?? []).find((f) => (f.slug ?? f.system?.slug) === slug) ?? null;

function cell(actor, r, dc, natural) {
	if (!Number.isFinite(dc)) return `<td>–</td>`;
	const d = degreeOf(r.total, dc, natural);
	const adj = adjusted(actor, d, { total: r.total, natural, dc, domains: r.domains, options: r.rollOptions });
	if (!adj) return `<td class="lucd20-rk-${DEGREES[d]}">${L(DEGREES[d])}</td>`;
	return `<td class="lucd20-rk-${DEGREES[adj.degree]}" data-tooltip="${esc(adj.label)}"><s>${L(DEGREES[d])}</s> ${L(DEGREES[adj.degree])}</td>`;
}

const skillHead = (r, name = r.label) => `<th>${esc(name)} <span class="lucd20-rk-rank lucd20-rk-rank${r.rank}">${RANKS[r.rank] ?? "?"}</span></th><td class="lucd20-rk-total">${r.total} <small>(${signed(r.modifier)})</small></td>`;

function maybeList(results) {
	const applied = new Set(results.flatMap((r) => r.applied));
	const seen = new Map();
	for (const r of results) for (const m of r.maybe) if (!applied.has(m.slug)) seen.set(m.slug, m);
	if (!seen.size) return "";
	return `<p class="lucd20-rk-maybe">${L("Maybe")} ${[...seen.values()].map((m) => `${esc(m.label)} ${signed(Number(m.modifier) || 0)}`).join(", ")}</p>`;
}

/** The card for one target. */
async function targetSection(actor, targetToken, d20, extra) {
	const target = targetToken.actor;
	const id = identification(target);
	let skills = id.skills;
	const unified = hasFeat(actor, "unified-theory");
	const viaUnified = unified && !skills.includes("arcana") && skills.some((s) => ["nature", "occultism", "religion"].includes(s));
	if (viaUnified) skills = [...skills, "arcana"];
	const results = (await Promise.all(skills.map((s) => skillTotal(actor, s, d20, target, extra)))).filter(Boolean);
	const loreSlugs = Object.values(actor.skills ?? {}).filter((s) => s.lore).map((s) => s.slug);
	const lores = (await Promise.all(loreSlugs.map((s) => skillTotal(actor, s, d20, target, extra)))).filter(Boolean);
	const [unspecific = [], specific = []] = id.lore;
	let html = `<h4>${L("Versus", { name: esc(targetToken.name ?? target.name) })}</h4>`;
	html += `<table class="lucd20-rk-table"><tr><th>${L("Skill")}</th><th>${L("Total")}</th>${id.standard.map((dc, i) => `<th>${L("Attempt", { n: i + 1 })}<br><small>${L("DC", { dc })}</small></th>`).join("")}</tr>`;
	if (!results.length) html += `<tr><td colspan="${2 + id.standard.length}" class="lucd20-rk-none">${L("NoSkill")}</td></tr>`;
	for (const r of results) {
		const name = r.slug === "arcana" && viaUnified ? `${r.label} (${unified.name})` : r.label;
		html += `<tr>${skillHead(r, name)}${id.standard.map((dc) => cell(actor, r, dc, d20)).join("")}</tr>`;
	}
	html += `</table>`;
	if (lores.length || unspecific.length) {
		html += `<table class="lucd20-rk-table"><tr><th>${L("Lore")}</th><th>${L("Total")}</th><th>${L("Unspecific")}<br><small>${L("DC", { dc: unspecific[0] ?? "–" })}</small></th><th>${L("Specific")}<br><small>${L("DC", { dc: specific[0] ?? "–" })}</small></th></tr>`;
		for (const r of lores) html += `<tr>${skillHead(r)}${cell(actor, r, unspecific[0], d20)}${cell(actor, r, specific[0], d20)}</tr>`;
		if (!lores.length) html += `<tr><td colspan="4" class="lucd20-rk-none">${L("NoLore")}</td></tr>`;
		html += `</table>`;
	}
	html += maybeList([...results, ...lores]);
	for (const slug of ["dubious-knowledge", "unmistakable-lore"]) {
		const feat = hasFeat(actor, slug);
		if (feat) html += `<p class="lucd20-rk-note">${L("HasFeat", { name: esc(actor.name), feat: `@UUID[${feat.uuid}]{${esc(feat.name)}}` })}</p>`;
	}
	return html;
}

/**
 * Roll Recall Knowledge for `actor` (default: the selected token's, else your character) against `targets`
 * (default: your targets). `modifiers`: [{ label, value }] added to every total. Posts one card to the GMs.
 */
export async function recallKnowledge({ actor = null, token = null, targets = null, modifiers = [], label = "" } = {}) {
	token ??= canvas?.tokens?.controlled?.[0] ?? null;
	actor ??= token?.actor ?? game.user.character ?? null;
	if (!actor?.skills) return void ui.notifications.warn(L("NoActor"));
	token ??= actor.getActiveTokens?.()?.[0] ?? null;
	const list = [...(targets ?? game.user.targets ?? [])].filter((t) => t?.actor && t.actor !== actor && (t.actor.isOfType?.("creature", "hazard") ?? true));
	const extra = modifiers.reduce((n, m) => n + (Number(m.value) || 0), 0);
	const roll = await new Roll("1d20").evaluate({ allowInteractive: false });
	const d20 = roll.total;
	const name = token?.name ?? actor.name;
	let html = `<div class="lucd20-rk-card"><header><strong>${esc(label || L("Title"))}</strong> <span class="lucd20-rk-d20 lucd20-rk-d20-${d20 === 20 ? "high" : d20 === 1 ? "low" : "mid"}">d20 ${d20}</span>`;
	if (modifiers.length) html += ` <small>${modifiers.map((m) => `${esc(m.label)} ${signed(Number(m.value) || 0)}`).join(", ")}</small>`;
	html += `</header>`;
	if (list.length) {
		for (const t of list) html += await targetSection(actor, t, d20, extra);
	} else {
		const loreSlugs = Object.values(actor.skills ?? {}).filter((s) => s.lore).map((s) => s.slug);
		const results = (await Promise.all([...RK_SKILLS, ...loreSlugs].map((s) => skillTotal(actor, s, d20, null, extra)))).filter(Boolean);
		html += `<table class="lucd20-rk-table"><tr><th>${L("Skill")}</th><th>${L("Total")}</th></tr>${results.map((r) => `<tr>${skillHead(r)}</tr>`).join("")}</table>`;
		html += maybeList(results);
	}
	html += `</div>`;
	const one = list.length === 1 ? list[0] : null;
	const message = await ChatMessage.create({
		content: html,
		speaker: ChatMessage.getSpeaker?.({ actor, token: token?.document ?? token }) ?? { alias: name },
		whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
		blind: true,
		rolls: [roll],
		flags: {
			[sysId()]: { context: { type: "skill-check", options: ["action:recall-knowledge", "check:type:skill", "secret"], traits: ["concentrate", "secret"], rollMode: "blindroll",
				origin: { actor: actor.uuid, token: (token?.document ?? token)?.uuid ?? null }, ...(one ? { target: { actor: one.actor.uuid, token: (one.document ?? one).uuid } } : {}) } },
			[MODULE_ID]: { recallKnowledge: true }
		}
	});
	if (!game.user.isGM) ui.notifications.info(L("Trying", { name }));
	return message;
}

defineFeature({
	id: "pf2eRecallKnowledge",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,

	enable(feature) {
		const api = game.modules.get(MODULE_ID)?.api;
		if (api) api.pf2e = { ...(api.pf2e ?? {}), recallKnowledge: (options) => recallKnowledge(options).catch((err) => error("Recall Knowledge failed.", err)) };
		feature.onCleanup(() => { if (api?.pf2e) delete api.pf2e.recallKnowledge; });
	}
});

export const _test = { identification, levelDC, degreeOf, skillTotal };
