import { error, localize } from "../../core/constants.js";
import { defineFeature, getFeature } from "../../core/registry.js";
import { hasReaction, spendReaction } from "./reactions.js";
import { itemBySlug } from "./card.js";
import { registerStrikeOption } from "./strike-options.js";
import { sysApi, sysId } from "./sys.js";

/**
 * Rule 30 (docs/pf2e-rules.md): Orc Superstition (orc ancestry feat 1; reaction; concentrate). Owner, v0.89.0:
 * "appears before rolling the spell or magical effect."
 * Trigger: you attempt a saving throw against a spell or magical effect and have not yet rolled. +1 circumstance
 * bonus to that save.
 *
 * - PF2e's save roll window, when the save is against magic (its options have arcane / divine / occult / primal
 *   / magical, as PF2e's own predicate for the feat): "Feats for this save" (strike-options.js) gets an Orc
 *   Superstition checkbox, unless the reaction is spent, the creature has Pervasive Superstition (always on), or
 *   PF2e's own toggle already adds the bonus. Checked: +1 circumstance is added to the roll at once (the total on
 *   the Roll button changes) and the roll carries `lucd20-orc-superstition`.
 * - Active GM's client: a save with that option spends the reaction.
 * Without the roll window (Shift-click / "skip dialog"), there is no chance to use it here.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.OrcSuperstition.${key}`, data);
export const TAG = "lucd20-orc-superstition";
const SLUGS = ["orc-superstition"];
const NAME = /^orc superstition$/i;
const MOD = "lucd20-orc-superstition";
const MAGIC = ["arcane", "divine", "occult", "primal", "magical"];
const seen = new Set();

const combatantOf = (actor) => (game.combat?.started ? game.combat.combatants?.find?.((c) => c.actor?.uuid === actor?.uuid) ?? null : null);
const hasFeat = (actor, slug) => (actor?.itemTypes?.feat ?? []).some((f) => (f.slug ?? f.system?.slug) === slug);

let featureOn = () => false;
registerStrikeOption({
	id: "orcSuperstition",
	tag: TAG,
	types: ["saving-throw"],
	active: () => featureOn(),
	item: (actor) => (hasFeat(actor, "pervasive-superstition") ? null : itemBySlug(actor, SLUGS, NAME)),
	applies: (context, item, roll, app) => {
		if (!MAGIC.some((t) => roll.options.has(t))) return false;
		// PF2e's own toggle already on: its +1 is in the roll.
		const already = (app?.check?.modifiers ?? []).some((m) => m.slug === "orc-superstition" && m.enabled !== false);
		return !already;
	},
	blocked: (context, item) => {
		const c = combatantOf(item.actor);
		return c && getFeature("pf2eReactions")?.isEnabled && !hasReaction(c) ? L("NoReaction") : null;
	},
	toggle: (app, on) => {
		const check = app?.check;
		if (!check) return;
		try {
			check.delete?.(MOD);
			const Modifier = sysApi()?.Modifier;
			if (on && Modifier) check.push(new Modifier({ slug: MOD, label: L("Name"), modifier: 1, type: "circumstance" }));
			const options = app.context?.options instanceof Set ? app.context.options : new Set(app.context?.options ?? []);
			check.calculateTotal?.(options);
			app.render?.();
		} catch (err) { error("Orc Superstition: the modifier failed.", err); }
	}
});

/** Active GM's client: a save rolled with it spends the reaction. */
async function onSave(message) {
	if (!game.user.isActiveGM) return;
	const context = message?.flags?.[sysId()]?.context;
	if (context?.type !== "saving-throw" || !(context.options ?? []).includes(TAG) || seen.has(message.id)) return;
	seen.add(message.id);
	const c = combatantOf(message.actor);
	if (c && getFeature("pf2eReactions")?.isEnabled) await spendReaction(c, { source: L("Name") });
}

defineFeature({
	id: "pf2eOrcSuperstition",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,
	enable(feature) {
		featureOn = () => !!feature.active;
		feature.on("createChatMessage", (message) => { onSave(message).catch((err) => error("Orc Superstition failed.", err)); });
	}
});

export const _test = { onSave };
