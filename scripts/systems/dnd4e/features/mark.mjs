import { MATCHERS, KIND, MODULE_ID } from "../constants.mjs";
import { L, F, matches, tokenForActor, tokenArt, alliesWithin, setting } from "../utils.mjs";
import { buildEffect, createEffects } from "../effects.mjs";
import { chooseToken } from "../targeting.mjs";

/**
 * Mark `targets` on behalf of `marker`.
 * Uses the dnd4e "mark" status plus `system.marker`, so the system's own -2 penalty
 * ("attacks that don't include the marker") is applied automatically on the marked creature's attacks.
 *
 * @param {object} opts
 * @param {Actor}   opts.marker       The creature the targets are marked by
 * @param {Token[]} opts.targets
 * @param {Actor}   [opts.source]     Who applied the mark (duration counts from their turn). Defaults to marker.
 * @param {string}  [opts.durationType] dnd4e duration type, default "endOfUserTurn" (end of the source's next turn)
 * @param {string}  [opts.powerName]
 */
export async function applyMark({ marker, targets, source = null, durationType = "endOfUserTurn", powerName = "" }) {
	source ??= marker;
	const markerToken = tokenForActor(marker);
	for (const target of targets) {
		if (!target?.actor) continue;
		const effect = buildEffect({
			kind: KIND.MARK,
			name: F("Effect.MarkName", { source: marker.name }),
			img: `modules/${MODULE_ID}/assets/dnd4e/mark.svg`,
			source,
			durationType,
			statuses: ["mark"],
			changes: [{ key: "system.marker", type: "override", value: marker.uuid, priority: null }],
			description: F("Effect.MarkDesc", { source: marker.name, power: powerName }),
			extraFlags: { marker: marker.uuid, portrait: tokenArt(markerToken, marker) },
		});
		await createEffects(target.actor, [effect]);
	}
	if (targets.length) {
		ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor: source }),
			content: `<p>${F("Chat.Marked", { targets: targets.map((t) => t.name).join(", "), marker: marker.name })}</p>`,
		});
	}
}

/**
 * dnd4e.rollAttack hook: Misdirected Mark marks every hit target, on behalf of an ally within 5 squares.
 */
export async function onAttackRolled(itemData, targetData, actor) {
	if (!setting("enableMarks")) return;
	if (!matches(itemData, MATCHERS.misdirectedMark)) return;
	const hit = targetData?.targetHit ?? [];
	if (!hit.length) return;

	const bard = tokenForActor(actor);
	if (!bard) return;
	const allies = alliesWithin(bard, 5);
	if (!allies.length) {
		ui.notifications.warn(L("Warn.NoAllyInRange"));
		return;
	}
	const ally = (allies.length === 1) ? allies[0]
		: await chooseToken(allies, F("Dialog.ChooseMarkerTitle", { power: itemData.name }), L("Dialog.ChooseMarkerHint"));
	if (!ally) return;
	await applyMark({ marker: ally.actor, targets: hit, source: actor, durationType: "endOfUserTurn", powerName: itemData.name });
}
