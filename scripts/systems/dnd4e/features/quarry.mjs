import { MODULE_ID, MATCHERS, KIND } from "../constants.mjs";
import { L, F, matches, actorHas, tokenForActor, tokenArt, tierDice, currentTurnKey, ownTurnStartedSince, setting } from "../utils.mjs";
import { buildEffect, createEffects, deleteEffects, effectsOfKind, tokensWithEffect } from "../effects.mjs";
import { pickNearestEnemy } from "../targeting.mjs";

/** Called from the dnd4e.usePower hook. */
export async function onUsePower(item, actor) {
	if (!setting("enableQuarry") || !matches(item, MATCHERS.huntersQuarry)) return false;
	const source = tokenForActor(actor);
	if (!source) {
		ui.notifications.warn(L("Warn.NoSourceToken"));
		return true;
	}
	const target = await pickNearestEnemy(source, item.name);
	if (!target) return true;

	// Only one quarry at a time: remove the old one(s).
	for (const t of tokensWithEffect(KIND.QUARRY, actor.uuid)) {
		if (t === target) continue;
		await deleteEffects(t.actor, effectsOfKind(t.actor, KIND.QUARRY, actor.uuid).map((e) => e.id));
	}
	if (effectsOfKind(target.actor, KIND.QUARRY, actor.uuid).length) {
		ui.notifications.info(F("Info.AlreadyQuarry", { target: target.name }));
		return true;
	}

	const effect = buildEffect({
		kind: KIND.QUARRY,
		name: F("Effect.QuarryName", { source: actor.name }),
		img: `modules/${MODULE_ID}/assets/dnd4e/quarry.svg`,
		extraFlags: { portrait: tokenArt(source, actor) },
		source: actor,
		durationType: "endOfEncounter",
		description: F("Effect.QuarryDesc", { source: actor.name }),
	});
	await createEffects(target.actor, [effect]);
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		content: `<p>${F("Chat.QuarryDesignated", { source: actor.name, target: target.name })}</p>`,
	});
	return true;
}

/** Damage-dialog extra for Hunter's Quarry. */
export function damageExtra({ actor, targets }) {
	if (!setting("enableQuarry")) return null;
	if (!actorHas(actor, MATCHERS.huntersQuarry)) return null;
	const quarryTarget = targets.find((t) => effectsOfKind(t.actor, KIND.QUARRY, actor.uuid).length);
	if (!quarryTarget) return null;

	const die = actorHas(actor, MATCHERS.lethalHunter) ? 8 : 6;
	const formula = `${tierDice(actor)}d${die}`;
	const used = actor.getFlag(MODULE_ID, "quarryUsed");
	const available = ownTurnStartedSince(actor, used);
	return {
		id: "quarry",
		label: F("Damage.Quarry", { formula }),
		hint: available ? F("Damage.QuarryTarget", { target: quarryTarget.name }) : L("Damage.QuarryUsed"),
		formula,
		checked: available,
		requiresHit: true,
		onApplied: async () => {
			const key = currentTurnKey();
			if (key) await actor.setFlag(MODULE_ID, "quarryUsed", key);
		},
	};
}
