import { MATCHERS, KIND, MODULE_ID } from "../constants.mjs";
import { F, L, matches, isRagePower, isMeleePower, abilityMod, tokenForActor, setting } from "../utils.mjs";
import { buildEffect, createEffects, deleteEffects, effectsOfKind } from "../effects.mjs";

/**
 * Rage-specific ongoing benefits that the module knows how to automate, keyed by matcher name.
 * Each entry returns a damage-dialog extra (or null) while that rage is active.
 */
const RAGE_BENEFITS = {
	// Bloodhunt Rage: while raging, +Con mod to melee damage rolls if you or the target is bloodied.
	bloodhuntRage: ({ actor, item, targets, attacker }) => {
		if (!isMeleePower(item, targets, attacker)) return null;
		const con = abilityMod(actor, "con");
		if (!con) return null;
		const bloodied = actor.statuses?.has("bloodied") || targets.some((t) => t.actor?.statuses?.has("bloodied"));
		return {
			id: "bloodhuntRage",
			label: F("Damage.BloodhuntRage", { formula: con }),
			hint: bloodied ? L("Damage.BloodhuntActive") : L("Damage.BloodhuntInactive"),
			formula: String(con),
			checked: bloodied,
			requiresHit: false,
		};
	},
};

/** Powers with a "if you're raging" damage rider, keyed by matcher name. */
const RAGING_POWER_BONUS = {
	pressingStrike: { formula: "1d6" },
};

export function activeRage(actor) {
	return effectsOfKind(actor, KIND.RAGE)[0] ?? null;
}

/** Called from the dnd4e.usePower hook. Using a rage power ends the previous rage and starts this one. */
export async function onUsePower(item, actor) {
	if (!setting("enableRage") || !isRagePower(item)) return false;
	const old = effectsOfKind(actor, KIND.RAGE).map((e) => e.id);
	if (old.length) await deleteEffects(actor, old);

	const rageKey = Object.keys(RAGE_BENEFITS).find((k) => matches(item, MATCHERS[k])) ?? null;
	const effect = buildEffect({
		kind: KIND.RAGE,
		name: F("Effect.RageName", { power: item.name }),
		img: item.img,
		source: actor,
		durationType: "endOfEncounter",
		description: item.system.effect?.detail || "",
		extraFlags: { rageKey, powerUuid: item.uuid },
	});
	await createEffects(actor, [effect]);
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		content: `<p>${F("Chat.RageStart", { actor: actor.name, power: item.name })}</p>`
			+ (rageKey ? "" : `<p><em>${L("Chat.RageManual")}</em></p>`),
	});
	return true;
}

/** Damage-dialog extras coming from the active rage. */
export function damageExtras(ctx) {
	if (!setting("enableRage")) return [];
	const rage = activeRage(ctx.actor);
	if (!rage) return [];
	const extras = [];
	const rageKey = rage.flags?.[MODULE_ID]?.rageKey;
	if (rageKey && RAGE_BENEFITS[rageKey]) {
		const extra = RAGE_BENEFITS[rageKey]({ ...ctx, attacker: tokenForActor(ctx.actor) });
		if (extra) extras.push(extra);
	}
	for (const [key, bonus] of Object.entries(RAGING_POWER_BONUS)) {
		if (!matches(ctx.item, MATCHERS[key])) continue;
		extras.push({
			id: `raging-${key}`,
			label: F("Damage.RagingBonus", { power: ctx.item.name, formula: bonus.formula }),
			hint: L("Damage.RagingBonusHint"),
			formula: bonus.formula,
			checked: true,
			requiresHit: true,
		});
	}
	return extras;
}
