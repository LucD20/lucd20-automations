import { MODULE_ID, MATCHERS, KIND } from "../constants.mjs";
import { L, F, matches, actorHas, tokenForActor, tokenArt, tierDice, currentTurnKey, sameTurn, setting } from "../utils.mjs";
import { buildEffect, createEffects, effectsOfKind } from "../effects.mjs";
import { pickNearestEnemy } from "../targeting.mjs";

/** Called from the dnd4e.usePower hook. */
export async function onUsePower(item, actor) {
	if (!setting("enableCurse") || !matches(item, MATCHERS.warlocksCurse)) return false;
	const source = tokenForActor(actor);
	if (!source) {
		ui.notifications.warn(L("Warn.NoSourceToken"));
		return true;
	}
	const target = await pickNearestEnemy(source, item.name);
	if (!target) return true;

	// "You can't place a Warlock's Curse on a creature that is already affected by your or another character's Warlock's Curse."
	if (effectsOfKind(target.actor, KIND.CURSE).length) {
		ui.notifications.warn(F("Warn.AlreadyCursed", { target: target.name }));
		return true;
	}

	const effect = buildEffect({
		kind: KIND.CURSE,
		name: F("Effect.CurseName", { source: actor.name }),
		img: `modules/${MODULE_ID}/assets/dnd4e/curse.svg`,
		extraFlags: { portrait: tokenArt(source, actor) },
		source: actor,
		durationType: "endOfEncounter",
		description: F("Effect.CurseDesc", { source: actor.name }),
	});
	await createEffects(target.actor, [effect]);
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		content: `<p>${F("Chat.CursePlaced", { source: actor.name, target: target.name })}</p>`,
	});
	return true;
}

/** Damage-dialog extra for Warlock's Curse. */
export function damageExtra({ actor, targets }) {
	if (!setting("enableCurse")) return null;
	if (!actorHas(actor, MATCHERS.warlocksCurse)) return null;
	const cursed = targets.find((t) => effectsOfKind(t.actor, KIND.CURSE, actor.uuid).length);
	if (!cursed) return null;

	const formula = `${tierDice(actor)}d6`;
	const used = actor.getFlag(MODULE_ID, "curseUsed");
	const available = !sameTurn(used, currentTurnKey());
	return {
		id: "curse",
		label: F("Damage.Curse", { formula }),
		hint: available ? F("Damage.CurseTarget", { target: cursed.name }) : L("Damage.CurseUsed"),
		formula,
		checked: available,
		requiresHit: true,
		onApplied: async () => {
			const key = currentTurnKey();
			if (key) await actor.setFlag(MODULE_ID, "curseUsed", key);
		},
	};
}
