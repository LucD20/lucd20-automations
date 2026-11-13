import { MODULE_ID } from "./constants.mjs";
import { registerSettings } from "./settings.mjs";
import "./cards.mjs";
import "./skill-challenge.mjs";
import { registerMigration } from "./migration.mjs";
import { registerSocket } from "./effects.mjs";
import { actorFromSpeaker, log, waitForDice } from "./utils.mjs";
import * as quarry from "./features/quarry.mjs";
import * as curse from "./features/curse.mjs";
import * as rage from "./features/rage.mjs";
import * as mark from "./features/mark.mjs";
import * as defeat from "./features/defeat.mjs";
import * as furiousAssault from "./features/furious-assault.mjs";
import * as onHit from "./features/on-hit.mjs";
import * as tempHp from "./features/temp-hp.mjs";
import * as conditional from "./features/conditional.mjs";
import * as classFeatures from "./features/class-features.mjs";
import * as forcedMove from "./movement/forced.mjs";
import * as charge from "./movement/charge.mjs";
import * as powerBadges from "./power-badges.mjs";
import { onRollDamage, onRenderRollDialog } from "./damage-dialog.mjs";
import { onEvaluateCommonAttackBonuses, computeCover } from "./cover.mjs";
import { registerPreviewHooks, drawPreview } from "./cover-preview.mjs";
import { preloadCompendiumIndexes } from "./preload.mjs";
import { registerSheetModHooks } from "./sheet-mods.mjs";
import { registerGameLanguage } from "./language.mjs";
import { registerBadgeHooks } from "./badges.mjs";
import { registerActionTracker, onUsePower as spendPowerAction } from "./actions/hooks.mjs";
import { ActionPanel } from "./actions/panel.mjs";
import * as opportunity from "./reactions/opportunity.mjs";
import * as triggers from "./reactions/triggers.mjs";
import * as damageApply from "./damage-apply.mjs";
import * as chatExpression from "./chat-expression.mjs";
import * as skillRolls from "./skill-rolls.mjs";
import * as textOverrides from "./features/text-overrides.mjs";

/*
 * Merged into LucD20 Automations: everything starts from our own init, after
 * the feature cards (and their settings) are registered, and only in dnd4e
 * worlds (the hooks below would otherwise also run in other systems).
 */
Hooks.once("lucd20-automations.init", () => {
	if (game.system.id !== "dnd4e") return;
	// Must run in "init": Foundry loads translations right after this hook.
	registerGameLanguage();
	registerSettings();
	registerMigration();
	registerHooks();
	registerPreviewHooks();
	registerBadgeHooks();
	registerActionTracker();
	opportunity.registerOpportunityHooks();
	triggers.registerTriggerHooks();
	tempHp.registerTempHpHooks();
	classFeatures.registerClassFeatureHooks();
	skillRolls.registerSkillRollHooks();
	registerSheetModHooks();
	conditional.registerConditionalHooks();
	forcedMove.registerMovementHooks();
	textOverrides.registerTextOverrideHooks();
	const api = game.modules.get(MODULE_ID).api ?? (game.modules.get(MODULE_ID).api = {});
	api.dnd4e = {
		applyMark: mark.applyMark,
		computeCover,
		drawCoverPreview: drawPreview,
		openActionPanel: () => ActionPanel.open(),
		translateExisting: textOverrides.translateExisting,
	};
});

function registerHooks() {
Hooks.once("ready", () => {
	registerSocket();
	preloadCompendiumIndexes().catch((err) => console.warn(`${MODULE_ID} | preload`, err));
	log("ready");
});

/* A power was used (its chat card was posted). */
Hooks.on("dnd4e.usePower", async (item) => {
	const actor = item?.actor;
	if (!actor) return;
	try {
		await spendPowerAction(item);
		opportunity.onUsePower(item);
		for (const feature of [quarry, curse, rage, furiousAssault, conditional, classFeatures]) {
			if (await feature.onUsePower(item, actor)) break;
		}
		await forcedMove.onUsePower(item, actor);
		await charge.onUsePower(item, actor);
	} catch (err) {
		console.error(`${MODULE_ID} | usePower`, err);
	}
});

/* An attack was rolled against targets (hit/miss known). */
Hooks.on("dnd4e.rollAttack", async (itemData, targetData, speaker) => {
	try {
		const actor = actorFromSpeaker(speaker);
		damageApply.onAttackRolledForDamage(itemData, targetData, speaker);
		onHit.clearAttackModChoices();
		opportunity.clearOpportunityAttack(actor);
		// Everything below depends on hit/miss: wait for Dice So Nice so it doesn't spoil the roll.
		await waitForDice();
		if (actor) await mark.onAttackRolled(itemData, targetData, actor);
		if (actor) await onHit.onAttackRolled(itemData, targetData, actor);
		await triggers.onAttackRolled(itemData, targetData, speaker);
		await conditional.onAttackRolled(itemData, targetData, actor);
		await forcedMove.onAttackRolled(itemData, targetData, actor);
		await classFeatures.onAttackRolled(itemData, targetData, actor);
	} catch (err) {
		console.error(`${MODULE_ID} | rollAttack`, err);
	}
});

/* Damage: remember the power, then add toggles to the damage dialog. */
Hooks.on("dnd4e.rollDamage", (item) => onRollDamage(item));
Hooks.on("renderRollDialog", (app, element) => {
	try {
		onRenderRollDialog(app, element);
		onHit.onRenderAttackDialog(app, element);
		skillRolls.onRenderRollDialog(app, element, chatExpression.labelForVariable);
	} catch (err) {
		console.error(`${MODULE_ID} | renderRollDialog`, err);
	}
});

/* Attack rolls: Prime Shot and penalties from module effects. */
Hooks.on("dnd4e.preAttackRoll", (item, attacker, target, config) => {
	try {
		onHit.onPreAttackRoll(item, attacker, target, config);
	} catch (err) {
		console.error(`${MODULE_ID} | preAttackRoll`, err);
	}
});

/* Attack dialog: automatic cover. */
Hooks.on("dnd4e.evaluateCommonAttackBonuses", (item, attacker, target, config) => {
	try {
		onEvaluateCommonAttackBonuses(item, attacker, target, config);
	} catch (err) {
		console.error(`${MODULE_ID} | cover`, err);
	}
});

/* Quarry/curse end when the creature drops to 0 HP. */
Hooks.on("updateActor", (actor, changes) => {
	defeat.onUpdateActor(actor, changes).catch((err) => console.error(`${MODULE_ID} | updateActor`, err));
});

/* Damage cards: apply to the attack's targets, selected tokens, or retarget. */
Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
	try {
		damageApply.onPreCreateChatMessage(message, data, options, userId);
	} catch (err) {
		console.error(`${MODULE_ID} | damage targets`, err);
	}
});
Hooks.on("renderChatMessageHTML", (message, html) => {
	try {
		damageApply.onRenderChatMessage(message, html);
		chatExpression.onRenderChatMessage(message, html);
		forcedMove.onRenderChatMessage(message, html);
		powerBadges.decorateChatCard(message, html);
	} catch (err) {
		console.error(`${MODULE_ID} | damage buttons`, err);
	}
});
}
