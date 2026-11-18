import { registerSignatureReader } from "../../features/signature-spells/signature-spells.js";
import { damageTargets } from "./shield-block.js";

/**
 * PF2e detail for Signature Spells: which spell a damage roll belongs to, who cast it and at whom.
 *
 * (verify) in PF2e 8.7 / PF2e Toolbelt:
 * - a spell's damage roll: `flags.pf2e.context.type === "damage-roll"`; the spell is `message.item`
 *   (`flags.pf2e.origin.uuid`), its slug `item.slug`; also among the roll options as `item:slug:<slug>`
 *   (`context.options`) or `origin:item:slug:<slug>` (`origin.rollOptions`);
 * - the targets: Target Helper's rows (`flags["pf2e-toolbelt"].targetHelper.targets`, token uuids, in the
 *   order they were targeted), else the roll's own target (`context.target.token`), else the tokens the
 *   message's author has targeted right now (`message.author.targets`).
 * - v0.75.0 (Swashbuckler finisher, owner: "just the damage that has Finisher applied"): the roll's options
 *   (`context.options`) and outcome are passed on, so a signature can match a Strike, not only a spell's slug.
 *   A finisher's damage roll carries the `finisher` option (Precise Strike's toggle) (verify), and the finisher
 *   used, when PF2e says so, as `finisher:<slug>` or the action's `item:slug:<slug>` (verify).
 */

const slugOf = (message) => {
	const flags = message?.flags?.pf2e ?? {};
	const item = message.item ?? null;
	const slug = item?.slug ?? item?.system?.slug;
	if (slug) return { slug, name: item.name ?? slug };
	for (const option of [...(flags.context?.options ?? []), ...(flags.origin?.rollOptions ?? [])]) {
		const m = /^(?:origin:)?item:slug:([a-z0-9-]+)$/.exec(String(option));
		if (m) return { slug: m[1], name: m[1] };
	}
	return null;
};

/** Which finisher, if the roll says (e.g. `finisher:unbalancing`, or the action's slug `unbalancing-finisher`). */
export function finisherOf(options) {
	for (const o of options) {
		const m = /^finisher:([a-z0-9-]+)$/.exec(o) ?? /^(?:origin:)?item:slug:([a-z0-9-]+)-finisher$/.exec(o);
		if (m) return m[1];
	}
	return null;
}

export function read(message) {
	const context = message?.flags?.pf2e?.context;
	if (context?.type !== "damage-roll") return null;
	const options = (context.options ?? []).map(String);
	const found = slugOf(message) ?? { slug: null, name: message.item?.name ?? "" };
	const rows = message.flags?.["pf2e-toolbelt"]?.targetHelper?.targets;
	let targets = Array.isArray(rows) && rows.length ? rows.filter((u) => typeof u === "string") : damageTargets(message).map((doc) => doc?.uuid).filter(Boolean);
	let ordered = targets.length > 0;
	if (!targets.length) {
		targets = [...(message.author?.targets ?? [])].map((t) => t?.document?.uuid).filter(Boolean);
		ordered = false;
	}
	const finisher = options.includes("finisher") ? { slug: finisherOf(options) } : null;
	return { ...found, options, outcome: context.outcome ?? null, finisher, roll: "damage", caster: message.speaker?.token ?? null, scene: message.speaker?.scene ?? null, targets, ordered };
}

registerSignatureReader({ system: "pf2e", read });
