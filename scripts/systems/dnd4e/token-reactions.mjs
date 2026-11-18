import { registerReactionAdapter } from "../../features/token-reactions/token-reactions.js";
import { MODULE_ID } from "./constants.mjs";

/**
 * D&D 4e detail for Token Reactions: a damage roll's message tells the damage type (the typed part that deals
 * the most; "physical" when untyped), whether it is critical damage, who rolled it and, when our damage cards
 * stored them, at whom.
 *
 * (verify) in dnd4e 0.9.3: `roll.options.hitTypeDamage`, `roll.options.hitType` = "normal" | "crit" | "miss",
 * typed terms carry their type in `term.flavor` (as the system's own damage split reads them).
 */

/** The damage type that deals the most in a roll. */
export function mainType(roll) {
	let best = null;
	for (const term of roll?.terms ?? []) {
		if (typeof term?.total !== "number" || !term.flavor) continue;
		// "fire, radiant" → the first one.
		const type = String(term.flavor).split(/[,\s/&]+/).find(Boolean)?.toLowerCase();
		if (type && (!best || term.total > best.total)) best = { type, total: term.total };
	}
	return best?.type ?? "physical";
}

export function fromMessage(message) {
	const roll = message?.rolls?.[0];
	if (!roll?.options?.hitTypeDamage) return null;
	const targets = message.getFlag?.(MODULE_ID, "damageTargets") ?? message.flags?.[MODULE_ID]?.damageTargets ?? [];
	return {
		type: mainType(roll),
		crit: roll.options.hitType === "crit",
		attacker: message.speaker?.token ?? null,
		scene: message.speaker?.scene ?? null,
		targets: [...targets],
		actors: []
	};
}

registerReactionAdapter({ system: "dnd4e", fromMessage });
