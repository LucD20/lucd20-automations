import { KIND, MATCHERS, MODULE_ID } from "../constants.mjs";
import { F, L, actorHas, setting } from "../utils.mjs";
import { buildEffect, createEffects, deleteEffects, effectsOfKind } from "../effects.mjs";

/**
 * GM-side: when a creature drops to 0 HP, end the quarry/curse on it ("until the quarry is
 * defeated" / "until the cursed enemy drops to 0 hit points"), and grant Fate of the Void
 * to Star Pact warlocks whose curse it carried.
 */
export async function onUpdateActor(actor, changes) {
	if (!game.users.activeGM?.isSelf) return;
	const hpChange = foundry.utils.getProperty(changes, "system.attributes.hp.value");
	if (hpChange === undefined || hpChange > 0) return;

	const quarry = effectsOfKind(actor, KIND.QUARRY);
	const curses = effectsOfKind(actor, KIND.CURSE);
	const ids = [...quarry, ...curses].map((e) => e.id);
	if (!ids.length) return;

	for (const curse of curses) {
		const warlock = await fromUuid(curse.flags[MODULE_ID].source);
		if (warlock && setting("enableCurse") && actorHas(warlock, MATCHERS.starPact)) await grantFateOfTheVoid(warlock, actor);
	}
	await deleteEffects(actor, ids);
}

async function grantFateOfTheVoid(warlock, fallen) {
	const existing = effectsOfKind(warlock, KIND.FATE_OF_THE_VOID)[0];
	const stacks = (existing?.flags[MODULE_ID]?.stacks ?? 0) + 1;
	if (existing) await deleteEffects(warlock, [existing.id]);
	const effect = buildEffect({
		kind: KIND.FATE_OF_THE_VOID,
		name: F("Effect.FateName", { bonus: stacks }),
		img: "icons/magic/perception/eye-ringed-glow-angry-small-teal.webp",
		source: warlock,
		durationType: "endOfUserTurn",
		description: L("Effect.FateDesc"),
		extraFlags: { stacks },
	});
	await createEffects(warlock, [effect]);
	const owners = game.users.filter((u) => warlock.testUserPermission(u, "OWNER")).map((u) => u.id);
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor: warlock }),
		whisper: owners,
		content: `<p>${F("Chat.FateOfTheVoid", { actor: warlock.name, target: fallen.name, bonus: stacks })}</p>`,
	});
}
