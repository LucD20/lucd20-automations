import { error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { waitForDice } from "../../core/dice.js";
import { itemBySlug } from "./card.js";
import { audience } from "./rules.js";

/**
 * Rule 11 (docs/pf2e-rules.md): Punishing Shove (guardian feat 1). "When you successfully Shove a
 * creature, that creature takes an amount of bludgeoning damage equal to your Strength modifier (or
 * double that amount on a critical success). This damage increases by 2 when you become an expert in
 * Athletics, 6 when you become a master, and 12 when you become legendary."
 * Owner's choices (Q180–Q184, as recommended): after the Shove's dice, a normal PF2e damage roll on the
 * shoved creature, applied with PF2e's own buttons (Target Helper rows); every successful Shove counts;
 * no target, no roll (the system's note stays); independent of the push. On the active GM's client.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.PunishingShove.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const SLUGS = ["punishing-shove"];

/** Strength modifier + 0 / 2 / 6 / 12 by Athletics rank (trained / expert / master / legendary); doubled on a critical. */
export function punishingDamage(strMod, rank, critical) {
	const r = Math.max(0, Number(rank) || 0);
	const base = (Number(strMod) || 0) + r * (r - 1);
	return Math.max(0, critical ? 2 * base : base);
}

async function onShove(message) {
	const context = message.flags?.pf2e?.context;
	if (context?.type !== "skill-check" || !(context.options ?? []).includes("action:shove") || context.isReroll) return;
	if (!["success", "criticalSuccess"].includes(context.outcome)) return;
	const shover = message.actor ?? (context.origin?.token ? fromUuidSync(context.origin.token)?.actor : null);
	if (!itemBySlug(shover, SLUGS, /^Punishing Shove$/i)) return;
	const target = context.target?.token ? fromUuidSync(context.target.token) : null;
	if (!target?.actor) return;
	const critical = context.outcome === "criticalSuccess";
	const amount = punishingDamage(shover.abilities?.str?.mod ?? shover.system?.abilities?.str?.mod, shover.skills?.athletics?.rank, critical);
	if (!amount) return;
	const DamageRoll = CONFIG.Dice?.rolls?.find((r) => r.name === "DamageRoll");
	if (!DamageRoll) return;
	await waitForDice(message.id);
	const roll = await new DamageRoll(`${amount}[bludgeoning]`).evaluate();
	const shoverToken = message.token ?? null;
	// As secret as the Shove: its whisper list (a blind or GM roll), or the GM only for a hidden shover.
	const privacy = message.whisper?.length ? { whisper: [...message.whisper], blind: !!message.blind } : audience(shoverToken?.combatant ?? { token: shoverToken, hidden: shoverToken?.hidden });
	await roll.toMessage({
		flavor: `<strong>${esc(L(critical ? "FlavorCritical" : "Flavor"))}</strong>`,
		speaker: ChatMessage.getSpeaker?.({ actor: shover, token: shoverToken }) ?? { alias: shover.name },
		...privacy,
		// (verify) Target Helper reads its targets from this flag, so its apply rows show the shoved creature.
		flags: { "pf2e-toolbelt": { targetHelper: { targets: [target.uuid] } } }
	});
}

defineFeature({
	id: "pf2ePunishingShove",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,

	enable(feature) {
		feature.on("createChatMessage", (message) => {
			if (!game.user.isActiveGM) return;
			onShove(message).catch((err) => error("Punishing Shove failed.", err));
		});
	}
});

export const _test = { onShove, punishingDamage };
