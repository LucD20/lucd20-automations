import { MODULE_ID } from "../constants.mjs";
import { F, L, matches, actorHas, setting, log } from "../utils.mjs";
import { buildEffect, createEffects, deleteEffects, effectsOfKind } from "../effects.mjs";
import { meleeBasicAttack, isOpportunityAttack } from "../reactions/opportunity.mjs";

/*
 * Class, racial and feat rules:
 *   Bloodhunt (tiefling)        +1 racial bonus to attack rolls against bloodied foes
 *   Defensive Mobility (feat)   +2 AC against opportunity attacks (attacks made from the module's opportunity card)
 *   Shadow Walk (warlock)       on your turn, once you are 3+ squares away from where you started it, you have
 *                               concealment until the end of your next turn (the system's "concealed" status)
 *   Rampage (barbarian)         once per round, a critical hit with a barbarian attack power offers a melee basic
 *                               attack as a free action (chat card)
 *   Words of Friendship (bard)  +5 power bonus to the next Diplomacy check before the end of your next turn
 *                               (shown and used up by skill-rolls.mjs)
 * Half-Orc Resilience (temporary HP) lives in temp-hp.mjs.
 * Labels use the item's own name on the sheet, so they follow whatever language the sheet is in.
 */

export const FEATURES = {
	bloodhunt: { ids: ["bloodhunt"], names: /^(bloodhunt|ca[çc]ada de sangue)$/i },
	defensiveMobility: { ids: ["defensive-mobility"], names: /^(defensive mobility|mobilidade defensiva)$/i },
	shadowWalk: { ids: ["shadow-walk"], names: /^(shadow walk|caminhar nas sombras|andar nas sombras|passo sombrio)$/i },
	rampage: { ids: ["rampage"], names: /^(rampage|massacre)$/i },
	wordsOfFriendship: { ids: ["bard-words-of-friendship"], names: /words of friendship|palavras de amizade/i },
};

const SHADOW_WALK = "shadowWalk";
const WORDS = "wordsOfFriendship";

const featureItem = (actor, matcher) => actor?.items?.find((i) => matches(i, matcher));
const on = () => setting("classFeatures");

export function isBloodied(actor) {
	if (!actor) return false;
	if (actor.statuses?.has("bloodied") || actor.system?.details?.isBloodied) return true;
	const hp = actor.system?.attributes?.hp;
	const at = Number(actor.system?.details?.bloodied) || Math.floor((hp?.max || 0) / 2);
	return !!hp && hp.value > 0 && hp.value <= at;
}

/* -------------------------------------------- */
/*  Bloodhunt                                     */
/* -------------------------------------------- */

/** Attack modifier for the attack dialog / roll (see on-hit.mjs attackModifiers). */
export function bloodhuntModifier(attacker, target) {
	if (!on() || !attacker?.actor || !target?.actor) return null;
	const feat = featureItem(attacker.actor, FEATURES.bloodhunt);
	if (!feat || !isBloodied(target.actor)) return null;
	return { key: "bloodhunt", label: feat.name, value: 1, type: "race" };
}

/* -------------------------------------------- */
/*  Defensive Mobility                            */
/* -------------------------------------------- */

/** dnd4e.evaluateTargetDefence: +2 AC against an opportunity attack. */
export function onEvaluateTargetDefence(item, attacker, target, config) {
	if (!on() || config?.defence !== "ac" || !config.bonuses) return;
	const attackerActor = attacker?.actor ?? attacker;
	if (!isOpportunityAttack(attackerActor) || !actorHas(target?.actor, FEATURES.defensiveMobility)) return;
	(config.bonuses.untyped ??= []).push("2");
	log("defensive mobility", target.name, "+2 AC vs opportunity attack");
}

/* -------------------------------------------- */
/*  Shadow Walk                                   */
/* -------------------------------------------- */

const turnStart = new Map(); // token id -> { key, x, y, applied }
const turnKey = (combat) => (combat ? `${combat.id}:${combat.round}:${combat.turn}` : null);

/** combatTurnChange (active GM): remember where the new combatant starts its turn. */
export function onTurnChange(combat) {
	if (!game.users.activeGM?.isSelf) return;
	const tok = combat?.combatant?.token;
	if (tok) turnStart.set(tok.id, { key: turnKey(combat), x: tok.x, y: tok.y, applied: false });
}

/** moveToken (active GM). */
export async function onMoveToken(tokenDoc, movement, operation) {
	if (!on() || !game.users.activeGM?.isSelf || !game.combat?.started) return;
	if (game.combat.combatant?.tokenId !== tokenDoc.id) return; // "on your turn"
	if (operation?.[MODULE_ID]?.forced) return; // being pushed or pulled isn't moving
	const actor = tokenDoc.actor;
	const feat = featureItem(actor, FEATURES.shadowWalk);
	if (!feat) return;
	const key = turnKey(game.combat);
	let start = turnStart.get(tokenDoc.id);
	if (!start || start.key !== key) {
		const origin = movement?.origin ?? tokenDoc;
		start = { key, x: origin.x, y: origin.y, applied: false };
		turnStart.set(tokenDoc.id, start);
	}
	if (start.applied) return;
	const dest = movement?.destination ?? tokenDoc;
	const size = canvas.grid.size;
	const squares = Math.round(Math.max(Math.abs((dest.x ?? tokenDoc.x) - start.x), Math.abs((dest.y ?? tokenDoc.y) - start.y)) / size);
	log("shadow walk:", tokenDoc.name, squares, "squares from the turn start");
	if (squares < 3) return;
	start.applied = true;
	const old = effectsOfKind(actor, SHADOW_WALK);
	if (old.length) await deleteEffects(actor, old.map((e) => e.id));
	await createEffects(actor, [buildEffect({
		kind: SHADOW_WALK,
		name: feat.name,
		img: CONFIG.statusEffects?.find((s) => s.id === "concealed")?.img ?? feat.img,
		source: actor,
		durationType: "endOfUserTurn",
		statuses: ["concealed"],
		description: L("Features.ShadowWalkDesc"),
	})]);
	ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${F("Features.ShadowWalk", { actor: actor.name, feature: feat.name })}</p>` });
}

/* -------------------------------------------- */
/*  Rampage                                       */
/* -------------------------------------------- */

function isBarbarianAttackPower(item, actor) {
	const sys = item?.system;
	if (!sys || sys.powerSubtype !== "attack" || sys.attack?.isBasic) return false;
	if (/barbarian|b[áa]rbaro/i.test(sys.subName ?? "")) return true;
	return sys.powerType === "class" && /barbarian|b[áa]rbaro/i.test(actor?.system?.details?.class ?? "");
}

/** The attack's chat message (the system's multiattack roll), to read which targets were critical hits. */
function attackMessage(actor) {
	const recent = game.messages.contents.slice(-15).reverse();
	return recent.find((m) => m.speaker?.actor === actor.id && Date.now() - m.timestamp < 30000 && m.rolls?.[0]?.multirollData?.length);
}

export function criticalTargets(message) {
	return (message?.rolls?.[0]?.multirollData ?? []).filter((r) => r.critstate === "critical").map((r) => r.targetID);
}

/** dnd4e.rollAttack (attacker's client, after Dice So Nice). */
export async function onAttackRolled(itemData, targetData, actor) {
	if (!on() || !actor) return;
	const feat = featureItem(actor, FEATURES.rampage);
	if (!feat) return;
	const item = itemData?.uuid ? fromUuidSync(itemData.uuid) : null;
	if (!isBarbarianAttackPower(item, actor)) return;
	const crits = criticalTargets(attackMessage(actor));
	if (!crits.length) return;
	const combat = game.combat;
	const used = actor.getFlag(MODULE_ID, "rampageRound");
	if (combat && used?.combat === combat.id && used.round === combat.round) return; // once per round
	if (!meleeBasicAttack(actor)) return;
	if (combat) await actor.setFlag(MODULE_ID, "rampageRound", { combat: combat.id, round: combat.round });
	const target = (targetData?.targets ?? []).find((t) => crits.includes(t.id));
	const whisper = game.users.filter((u) => u.isGM || actor.testUserPermission(u, "OWNER")).map((u) => u.id);
	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		whisper,
		content: `<div class="d4ea-oa-card d4ea-react-card">
			<h3><i class="fa-solid fa-burst"></i> ${foundry.utils.escapeHTML(feat.name)}</h3>
			<p>${F("Features.Rampage", { actor: actor.name, power: item.name })}</p>
			<button type="button" class="d4ea-react-use d4ea-rampage">
				<i class="fa-solid fa-hand-fist"></i> ${L("Features.RampageButton")}
			</button></div>`,
		flags: { [MODULE_ID]: { rampage: { actor: actor.uuid, target: target?.document?.uuid ?? null } } },
	});
	log("rampage card", actor.name, item.name);
}

async function onRampageButton(message, btn) {
	const data = message.getFlag(MODULE_ID, "rampage");
	if (!data || data.used) return;
	const actor = fromUuidSync(data.actor);
	if (!actor) return;
	if (!actor.isOwner) return ui.notifications.warn(L("Opportunity.NotOwner"));
	const power = meleeBasicAttack(actor);
	if (!power) return ui.notifications.warn(F("Opportunity.NoBasic", { name: actor.name }));
	const target = data.target ? fromUuidSync(data.target)?.object : null;
	if (target) target.setTarget(true, { releaseOthers: true });
	const { markFreeUse } = await import("../actions/hooks.mjs"); // lazy: keeps the action panel out of this module's imports
	markFreeUse(actor);
	btn.disabled = true;
	if (message.canUserModify(game.user, "update")) await message.setFlag(MODULE_ID, "rampage.used", true);
	if (typeof actor.usePower === "function") await actor.usePower(power, { configureDialog: true, fastForward: false });
	else await power.roll();
}

/* -------------------------------------------- */
/*  Words of Friendship                           */
/* -------------------------------------------- */

/** dnd4e.usePower. */
export async function onUsePower(item, actor) {
	if (!on() || !matches(item, FEATURES.wordsOfFriendship) || item.type !== "power") return false;
	const old = effectsOfKind(actor, WORDS);
	if (old.length) await deleteEffects(actor, old.map((e) => e.id));
	await createEffects(actor, [buildEffect({
		kind: WORDS,
		name: `${item.name} (+5)`,
		img: item.img,
		source: actor,
		durationType: "endOfUserTurn",
		changes: [{ key: "system.skills.dip.power", type: "add", value: "5", priority: null }],
		description: L("Features.WordsDesc"),
		extraFlags: { skillBonus: { skill: "dip", value: 5, var: "wordsOfFriendship" } },
	})]);
	ui.notifications.info(F("Features.WordsArmed", { actor: actor.name, power: item.name }));
	return true;
}

/* -------------------------------------------- */

export function registerClassFeatureHooks() {
	Hooks.on("dnd4e.evaluateTargetDefence", (...args) => {
		try { onEvaluateTargetDefence(...args); } catch (e) { console.error(`${MODULE_ID} | defensive mobility`, e); }
	});
	Hooks.on("combatTurnChange", (combat) => onTurnChange(combat));
	Hooks.on("moveToken", (doc, movement, operation) => {
		onMoveToken(doc, movement, operation).catch((e) => console.error(`${MODULE_ID} | shadow walk`, e));
	});
	Hooks.on("renderChatMessageHTML", (message, html) => {
		const data = message.flags?.[MODULE_ID]?.rampage;
		if (!data) return;
		html.querySelectorAll(".d4ea-rampage").forEach((b) => {
			if (data.used) b.disabled = true;
			b.addEventListener("click", () => onRampageButton(message, b));
		});
	});
}
