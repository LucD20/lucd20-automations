import { MODULE_ID } from "../../core/constants.js";
import { registerModifiersMatterAdapter, mattered, lineHTML, L } from "../../features/modifiers-matter.js";
import { d20Of } from "../../features/roll-chances.js";
import { degreeFor, canSee } from "./chances.js";

/**
 * PF2e for Modifiers Matter. The roll's own modifiers (flags.pf2e.modifiers: enabled, not ignored; not the
 * proficiency or attribute modifier, not the multiple attack penalty or potency runes) are highlighted on the
 * card's tags; the target's modifiers to its AC / DC, read when the roll is created (the author's client; in
 * flags.lucd20-automations.mm), get one line before the result. Failure ↔ critical failure on attacks
 * doesn't count (both miss).
 */

const SKIP_TYPES = new Set(["proficiency", "ability"]);
const SKIP_SLUGS = new Set(["base", "proficiency", "multiple-attack-penalty", "potency", "weapon-potency", "striking"]);
const ATTACKS = new Set(["attack-roll", "spell-attack-roll"]);

const counts = (m) => m && m.enabled !== false && !m.ignored && Number(m.modifier) && !SKIP_TYPES.has(m.type) && !SKIP_SLUGS.has(m.slug);

/** The target's modifiers to the DC it set: its AC for attacks, else the statistic named by the DC's slug. */
function dcModifiers(context) {
	let target = null;
	try { target = context?.target?.actor ? fromUuidSync(context.target.actor) : null; } catch { target = null; }
	if (!target || context.type === "saving-throw") return [];
	const slug = context.dc?.slug;
	const stat = ATTACKS.has(context.type) || slug === "ac" || slug === "armor"
		? (target.armorClass ?? target.system?.attributes?.ac)
		: (target.getStatistic?.(slug)?.dc ?? null);
	// Not its armor's item bonus (nor the proficiency and attribute parts): conditions, cover, a raised shield...
	const list = (stat?.modifiers ?? []).filter((m) => counts(m) && m.type !== "item")
		.map((m) => ({ label: m.label, value: Number(m.modifier), side: "dc" }));
	// Off-Guard from flanking is not on the actor: PF2e adds it for this roll.
	const options = context.options ?? [];
	if (ATTACKS.has(context.type) && options.includes("target:condition:off-guard") && !list.some((m) => /off-guard/i.test(m.label))) {
		const label = game.i18n.localize?.("PF2E.ConditionTypeOffGuard");
		list.push({ label: label && label !== "PF2E.ConditionTypeOffGuard" ? label : "Off-Guard", value: -2, side: "dc" });
	}
	return list;
}

function onPreCreate(message) {
	const context = message.flags?.pf2e?.context;
	if (!context?.dc || context.type === "flat-check" || message.flags?.[MODULE_ID]?.mm) return;
	const dcMods = dcModifiers(context);
	if (dcMods.length) message.updateSource({ [`flags.${MODULE_ID}.mm`]: { dcMods } });
}

function onCard(message, html) {
	const flags = message.flags?.pf2e;
	const context = flags?.context;
	const dc = Number(context?.dc?.value);
	if (!context || !Number.isFinite(dc) || context.type === "flat-check" || html.querySelector?.(".lucd20-mm-line, .lucd20-mm-good, .lucd20-mm-bad")) return;
	const roll = message.rolls?.[0];
	const die = d20Of(roll);
	if (!die?.natural) return;
	const modifier = roll.total - die.natural;
	const attack = ATTACKS.has(context.type);
	const outcome = (delta) => {
		const d = degreeFor(die.natural, modifier + delta, dc, context.dosAdjustments ?? null);
		return attack && d === 0 ? 1 : d;
	};
	const own = (flags.modifiers ?? []).filter(counts).map((m) => ({ label: m.label, slug: m.slug, value: Number(m.modifier), side: "roll" }));
	const theirs = message.flags?.[MODULE_ID]?.mm?.dcMods ?? [];
	const found = mattered([...own, ...theirs], outcome);
	// The roll's tags.
	for (const m of found.filter((x) => x.side === "roll")) {
		const tags = [...(html.querySelectorAll?.(".tags.modifiers .tag") ?? [])];
		const tag = tags.find((t) => m.slug && t.dataset.slug === m.slug) ?? tags.find((t) => t.textContent.trim().startsWith(m.label));
		tag?.classList.add(m.good ? "lucd20-mm-good" : "lucd20-mm-bad");
	}
	// The target's: a line, where the DC may be seen.
	const dcList = found.filter((x) => x.side === "dc");
	if (!dcList.length || !canSee(context, { blind: message.blind })) return;
	const anchor = html.querySelector(".degree-of-success") ?? html.querySelector(".dice-roll");
	anchor?.insertAdjacentHTML(anchor.matches(".degree-of-success") ? "beforebegin" : "afterend", lineHTML(L("Target"), dcList));
}

registerModifiersMatterAdapter({
	system: "pf2e",
	enable(feature) {
		feature.on("preCreateChatMessage", (message) => onPreCreate(message));
		feature.on("renderChatMessageHTML", (message, html) => onCard(message, html));
	}
});

export const _test = { onCard, onPreCreate, dcModifiers };
