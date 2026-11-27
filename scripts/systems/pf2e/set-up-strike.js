import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { waitForDice } from "../../core/dice.js";
import { itemBySlug, nameForPlayers } from "./card.js";
import { registerStrikeOption } from "./strike-options.js";
import { flatCheckFailed } from "./flat-check.js";
import { sysId } from "./sys.js";

/**
 * Rule 27 (docs/pf2e-rules.md): Set-Up Strike (Commander feat 2; 1 action; flourish). Owner, v0.89.0: "A toggle
 * just like Combat Assessment, granting off-guard on a hit; off-guard goes away after someone hits the target;
 * lasts 1 round." The feat: "If the Strike is successful, the target is off-guard against the next attack that
 * one of your allies attempts against it before the start of your next turn." (Built as written: the next
 * attack attempt by an ally, hit or miss.)
 *
 * - "Feats for this Strike" (strike-options.js) gets a Set-Up Strike checkbox for a creature with the feat.
 * - Active GM's client: a Strike with it that succeeds makes the target off-guard (PF2e's condition, unless it
 *   already was), and a line says so. It goes again after the next attack roll against that target by one of
 *   the commander's allies (same side, not the commander), or at the start of the commander's next turn.
 * Known limit: PF2e's off-guard counts against everyone, so another Strike by the commander before an ally's
 * also gets it.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.SetUpStrike.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
export const TAG = "lucd20-set-up-strike";
const SLUGS = ["set-up-strike"];
const NAME = /^set-?up strike$/i;
const seen = new Set();
const marks = new Map(); // target token uuid → { by: commander token uuid, byActor, side, added }

let featureOn = () => false;
registerStrikeOption({
	id: "setUpStrike",
	tag: TAG,
	active: () => featureOn(),
	item: (actor) => itemBySlug(actor, SLUGS, NAME)
});

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);
const isOffGuard = (actor) => !!(actor?.hasCondition?.("off-guard") || actor?.statuses?.has?.("off-guard"));

async function setOffGuard(actor, on) {
	try {
		if (on) await (actor.increaseCondition?.("off-guard") ?? actor.toggleStatusEffect?.("off-guard", { active: true }));
		else await (actor.decreaseCondition?.("off-guard", { forceRemove: true }) ?? actor.toggleStatusEffect?.("off-guard", { active: false }));
	} catch (err) { error("Set-Up Strike: off-guard failed.", err); }
}

async function clear(targetUuid) {
	const m = marks.get(targetUuid);
	if (!m) return;
	marks.delete(targetUuid);
	const target = fromUuidSync(targetUuid);
	if (m.added && target?.actor) await setOffGuard(target.actor, false);
}

/** Active GM's client. */
export async function onMessage(message) {
	if (!game.user.isActiveGM) return;
	const context = message?.flags?.[sysId()]?.context;
	if (!["attack-roll", "spell-attack-roll"].includes(context?.type) || context.isReroll || seen.has(message.id)) return;
	const target = context.target?.token ? fromUuidSync(context.target.token) : null;
	const attacker = context.origin?.token ? fromUuidSync(context.origin.token) : message.token ?? null;
	if (!target?.actor || !attacker) return;
	// An ally's attack against a marked target: the off-guard is spent (hit or miss).
	const mark = marks.get(target.uuid);
	if (mark && attacker.uuid !== mark.by && attacker.disposition === mark.side) {
		seen.add(message.id);
		await waitForDice(message.id);
		await clear(target.uuid);
		return;
	}
	// The Set-Up Strike itself.
	if (!(context.options ?? []).includes(TAG) || !["success", "criticalSuccess"].includes(context.outcome)) return;
	seen.add(message.id);
	await waitForDice(message.id);
	if (await flatCheckFailed(message, target.uuid)) return; // v0.90.1: the flat check failed: a miss
	const already = isOffGuard(target.actor);
	if (!already) await setOffGuard(target.actor, true);
	marks.set(target.uuid, { by: attacker.uuid, side: attacker.disposition, added: !already });
	const hidden = target.hidden || attacker.hidden;
	await ChatMessage.create({
		content: `<p class="lucd20-rule-note"><i class="fa-solid fa-person-falling"></i> ${L("Line", { target: `<strong>${esc(nameForPlayers(target, L("ACreature")))}</strong>`, name: esc(nameForPlayers(attacker, L("ACreature"))) })}</p>`,
		speaker: { alias: localize("LUCD20.PF2eRules.Speaker") },
		whisper: hidden ? gmIds() : []
	});
}

/** The commander's next turn: any mark of theirs goes. */
async function onTurn(combat) {
	if (!game.user.isActiveGM || !marks.size) return;
	const current = combat?.combatant?.token?.uuid ?? combat?.combatant?.tokenId ?? null;
	for (const [target, m] of [...marks]) if (current && (m.by === current || m.by.endsWith(`.${current}`))) await clear(target);
}

defineFeature({
	id: "pf2eSetUpStrike",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,
	enable(feature) {
		featureOn = () => !!feature.active;
		feature.on("createChatMessage", (message) => { onMessage(message).catch((err) => error("Set-Up Strike failed.", err)); });
		feature.on("updateCombat", (combat, change) => { if ("turn" in (change ?? {}) || "round" in (change ?? {})) onTurn(combat); });
		feature.on("deleteCombat", () => { for (const t of [...marks.keys()]) clear(t); });
	}
});

export const _test = { onMessage, marks, onTurn };
