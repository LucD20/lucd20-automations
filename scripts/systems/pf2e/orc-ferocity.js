import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature, getFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { hasReaction, spendReaction } from "./reactions.js";
import { itemBySlug, nameForPlayers } from "./card.js";

/**
 * Rule 29 (docs/pf2e-rules.md): Orc Ferocity (orc ancestry feat 1; reaction; once per day). Owner, v0.89.0: "it
 * needs to prevent a token to actually die; it triggers before damage is actually applied to the token so it
 * doesn't trigger dying, change initiative etc., and leave the creature at 1 HP. For NPCs and PCs alike."
 * Trigger: you would be reduced to 0 Hit Points but not immediately killed. You avoid being knocked out and
 * remain at 1 Hit Point, and your wounded condition increases by 1.
 *
 * - Before the HP change is saved (`preUpdateActor`, and `preUpdateActorDelta` for unlinked tokens), on the
 *   client making it: HP going from above 0 to 0 on a creature with the feat, its daily use left (the feat's
 *   frequency), its reaction left in an encounter, not already dead → the change is rewritten to 1 HP. So the
 *   creature never reaches 0: no dying, no unconscious, no initiative move, not marked defeated.
 * - Then on the GM's client: wounded +1, the daily use spent, the reaction spent, a chat line. Should PF2e still
 *   add dying / unconscious in the next moment, they are removed.
 * Not caught: "immediately killed" (e.g. massive damage) — the GM decides; the module can't tell from the HP.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.OrcFerocity.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const SLUGS = ["orc-ferocity"];
const NAME = /^orc ferocity$/i;
const HP = "system.attributes.hp.value";
const recent = new Map(); // actor uuid → time saved (one per hit)

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);
const combatantOf = (actor) => (game.combat?.started ? game.combat.combatants?.find?.((c) => c.actor?.uuid === actor?.uuid) ?? null : null);

/** Can it trigger now? → the feat or null. */
export function usable(actor) {
	const feat = actor ? itemBySlug(actor, SLUGS, NAME) : null;
	if (!feat) return null;
	const freq = feat.system?.frequency;
	if (freq && Number.isFinite(Number(freq.value)) && Number(freq.value) <= 0) return null;
	if (actor.hasCondition?.("dead") || actor.statuses?.has?.("dead")) return null;
	const c = combatantOf(actor);
	if (c && getFeature("pf2eReactions")?.isEnabled && !hasReaction(c)) return null;
	return feat;
}

/** The change about to be saved: 0 HP becomes 1. → true when it did. */
export function rewrite(actor, change) {
	const next = foundry.utils.getProperty(change, HP);
	if (next === undefined || next === null) return false;
	if (Number(next) > 0) return false;
	// The same hit seen twice (an unlinked token's actor and its delta): keep it at 1, count it once.
	if (Date.now() - (recent.get(actor.uuid) ?? 0) < 1500) {
		foundry.utils.setProperty(change, HP, 1);
		return true;
	}
	const now = Number(actor?.system?.attributes?.hp?.value);
	if (!(now > 0)) return false;
	const feat = usable(actor);
	if (!feat) return false;
	recent.set(actor.uuid, Date.now());
	foundry.utils.setProperty(change, HP, 1);
	executeAsGM("pf2eOrcFerocity.after", { actor: actor.uuid, feat: feat.id }).catch((err) => error("Orc Ferocity: the GM step failed.", err));
	return true;
}

/** GM's client: wounded +1, the daily use, the reaction, the line; dying / unconscious undone if PF2e added them. */
async function after({ actor: uuid, feat: featId }) {
	const actor = fromUuidSync(uuid);
	const feat = actor?.items?.get?.(featId);
	if (!actor || !feat) return false;
	try { await actor.increaseCondition?.("wounded"); } catch (err) { error("Orc Ferocity: wounded failed.", err); }
	const freq = feat.system?.frequency;
	if (freq && Number.isFinite(Number(freq.value))) await feat.update({ "system.frequency.value": Math.max(0, Number(freq.value) - 1) });
	const c = combatantOf(actor);
	if (c && getFeature("pf2eReactions")?.isEnabled) await spendReaction(c, { source: feat.name });
	const token = actor.token ?? actor.getActiveTokens?.()?.[0]?.document ?? null;
	const hidden = !!token?.hidden;
	await ChatMessage.create({
		content: `<p class="lucd20-rule-note"><i class="fa-solid fa-heart-crack"></i> ${L("Line", { name: `<strong>${esc(nameForPlayers(token, actor.name))}</strong>` })}</p>`,
		speaker: { alias: localize("LUCD20.PF2eRules.Speaker") },
		whisper: hidden ? gmIds() : []
	});
	for (const wait of [300, 1200]) {
		setTimeout(async () => {
			for (const slug of ["dying", "unconscious"]) {
				if (actor.hasCondition?.(slug)) await actor.decreaseCondition?.(slug, { forceRemove: true }).catch(() => {});
			}
		}, wait);
	}
	return true;
}

defineFeature({
	id: "pf2eOrcFerocity",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,
	init(feature) {
		onGMRequest("pf2eOrcFerocity.after", (payload) => (feature.active ? after(payload) : false));
	},
	enable(feature) {
		feature.on("preUpdateActor", (actor, change) => { rewrite(actor, change); });
		// Unlinked tokens: the change goes to the token's actor delta.
		feature.on("preUpdateActorDelta", (delta, change) => {
			const actor = delta?.parent?.actor;
			if (actor) rewrite(actor, change);
		});
	}
});

export const _test = { rewrite, usable, after };
