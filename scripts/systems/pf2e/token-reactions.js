import { registerReactionAdapter } from "../../features/token-reactions/token-reactions.js";
import { damageTargets } from "./shield-block.js";
import { sysId } from "./sys.js";

/**
 * PF2e detail for Token Reactions: a damage roll's message tells the damage type (the instance that deals the
 * most), whether it followed a critical hit, who rolled it and at whom. The generic part then matches it to
 * the HP that goes down when the damage is applied.
 *
 * (verify) in PF2e 8.7: `flags.pf2e.context` = { type: "damage-roll", outcome, target: { actor, token } },
 * `DamageRoll#instances[]` with `.type`, `.total`, `.persistent`, and `DamageRoll#kinds` (a Set with "damage"
 * and/or "healing"). A critical from a failed save (a basic save's double damage) can't be told from the roll:
 * it then reacts only as a kill or a big hit.
 */

/** The damage type that deals the most in a roll, or null. */
export function mainType(roll) {
	let best = null;
	for (const instance of roll?.instances ?? []) {
		const type = instance?.type ?? instance?.damageType;
		if (!type) continue;
		const total = Number(instance.total) || 0;
		if (!best || total > best.total) best = { type: String(type), total };
	}
	return best?.type ?? null;
}

export function fromMessage(message) {
	const context = message?.flags?.[sysId()]?.context;
	if (context?.type !== "damage-roll") return null;
	const roll = message.rolls?.[0];
	const kinds = roll?.kinds;
	if (kinds?.has?.("healing") && !kinds.has("damage")) return null;
	const targets = damageTargets(message).map((doc) => doc?.uuid).filter(Boolean);
	const actors = context.target?.actor ? [context.target.actor] : [];
	return {
		type: mainType(roll) ?? "untyped",
		crit: context.outcome === "criticalSuccess",
		attacker: message.speaker?.token ?? null,
		scene: message.speaker?.scene ?? null,
		targets,
		actors
	};
}

registerReactionAdapter({ system: "pf2e", fromMessage });
