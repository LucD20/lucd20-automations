import { MODULE_ID } from "../constants.mjs";
import { F, L, setting, log, areEnemies, isMeleePower, gridDistance, tokenForActor, actorFromSpeaker } from "../utils.mjs";
import { combatantForActor, getState, isCombatantsTurn } from "../actions/state.mjs";

/*
 * Triggered powers ("Trigger:" line) offered as whispered chat cards when their trigger happens.
 * Powers are classified by their trigger text (English and Portuguese), so new powers with similar
 * triggers work too, for player characters and monsters alike:
 *   selfAttackRoll   "You make an attack roll and dislike the result"       (Elven Accuracy)
 *   meleeAttacked    "An enemy makes a melee attack against you"            (Fox's Cunning)
 *   attacked         "An enemy makes an attack against you / attacks you"
 *   hitSelf          "An enemy (within N squares of you) hits you"           (Infernal Wrath)
 *   hitEnemy         "You hit an enemy (with an attack)"                     (Furious Assault)
 *   dropEnemy        "Your attack reduces an enemy to 0 hit points or fewer" (Swift Charge)
 */

const TRIGGERS = [
	{ type: "dropEnemy", re: /(reduces?|reduz(ir)?)\s+(an?\s+|um\s+)?(enemy|inimigo)\s+(to|a)\s+0/i },
	{ type: "selfAttackRoll", re: /dislike the result|n[ãa]o gost(a|ar) do resultado/i },
	{ type: "meleeAttacked", re: /melee attack against you|ataque corpo a corpo contra (voc[êe]|o personagem|ele)/i },
	{ type: "hitSelf", re: /\bhits you\b|(atinge|acerta)\s+(voc[êe]|o personagem)/i },
	{ type: "attacked", re: /(makes an attack against you|attacks you)|ataca (voc[êe]|o personagem)|faz um ataque contra (voc[êe]|o personagem)/i },
	{ type: "hitEnemy", re: /(you|personagem|b[áa]rbaro|voc[êe])\s+(hit|hits|atinge|acerta)\s+(an?\s+|um\s+)?(enemy|inimigo)/i },
];
const REACTION_ACTIONS = ["free", "reaction", "interrupt", "none", "special"];

export function classify(item) {
	const sys = item?.system;
	if (item?.type !== "power" || !sys?.trigger) return null;
	if (!REACTION_ACTIONS.includes(sys.actionType)) return null;
	const text = String(sys.trigger);
	const match = TRIGGERS.find((t) => t.re.test(text));
	if (!match) return null;
	const range = text.match(/within (\d+) squares?|a at[ée] (\d+) quadrados?/i);
	return { type: match.type, range: range ? Number(range[1] ?? range[2]) : null };
}

function usesLeft(item) {
	const uses = item.system.uses;
	if (!uses?.per || !uses.max || !["enc", "day", "charges", "round"].includes(uses.per)) return true;
	return Number(uses.value) > 0;
}

/** Can `actor` use `item` as a reaction right now? */
export function canReact(actor, item) {
	if (!usesLeft(item)) return false;
	if (["reaction", "interrupt"].includes(item.system.actionType)) {
		const combatant = combatantForActor(actor);
		if (combatant) {
			if (isCombatantsTurn(combatant)) return false;
			if (getState(combatant).used.immediate >= 1) return false;
		}
	}
	return true;
}

function triggeredPowers(actor, type) {
	return actor.items.filter((i) => classify(i)?.type === type && canReact(actor, i));
}

function whisperTargets(actor) {
	return game.users.filter((u) => u.isGM || actor.testUserPermission(u, "OWNER")).map((u) => u.id);
}

function actionLabel(item) {
	const at = item.system.actionType;
	const key = { free: "free", reaction: "immediate", interrupt: "immediate" }[at];
	return key ? L(`Actions.${key}`) : "";
}

async function postCard({ actor, token, powers, reasonKey, reasonData, targetToken = null }) {
	if (!powers.length) return;
	const buttons = powers.map((p) => `
		<button type="button" class="d4ea-react-use" data-actor="${actor.uuid}" data-item="${p.id}" data-target-scene="${targetToken?.scene?.id ?? ""}" data-target="${targetToken?.id ?? ""}">
			<i class="fa-solid fa-bolt"></i> ${F("Reaction.Button", { power: actionLabel(p) ? `${p.name} (${actionLabel(p)})` : p.name })}
		</button>
		<p class="d4ea-react-trigger">${foundry.utils.escapeHTML(p.system.trigger)}</p>`).join("");
	await ChatMessage.create({
		speaker: token ? ChatMessage.getSpeaker({ token: token.document }) : ChatMessage.getSpeaker({ actor }),
		whisper: whisperTargets(actor),
		content: `<div class="d4ea-oa-card d4ea-react-card">
			<h3><i class="fa-solid fa-bolt"></i> ${L("Reaction.Title")}</h3>
			<p>${F(reasonKey, reasonData)}</p>${buttons}</div>`,
		flags: { [MODULE_ID]: { reaction: true } },
	});
	log("reaction card", actor.name, powers.map((p) => p.name));
}

/* -------------------------------------------- */
/*  Events                                        */
/* -------------------------------------------- */

/** dnd4e.rollAttack (attacker's client). */
export async function onAttackRolled(itemData, targetData, speaker) {
	if (!setting("reactionPrompts") || !game.combat?.started) return;
	const attacker = actorFromSpeaker(speaker);
	if (!attacker) return;
	const attackerToken = tokenForActor(attacker);
	const item = itemData?.uuid ? fromUuidSync(itemData.uuid) : null;
	const targets = targetData?.targets ?? [];
	const hit = targetData?.targetHit ?? [];
	const missed = targetData?.targetMissed ?? [];
	const enemyTargets = attackerToken ? targets.filter((t) => areEnemies(attackerToken, t)) : targets;

	// The attacker's own triggers
	if (missed.length) {
		await postCard({ actor: attacker, token: attackerToken, powers: triggeredPowers(attacker, "selfAttackRoll"),
			reasonKey: "Reaction.ReasonSelfMiss", reasonData: { actor: attacker.name, targets: missed.map((t) => t.name).join(", ") } });
	}
	const hitEnemies = hit.filter((t) => enemyTargets.includes(t));
	if (hitEnemies.length) {
		await postCard({ actor: attacker, token: attackerToken, powers: triggeredPowers(attacker, "hitEnemy"),
			reasonKey: "Reaction.ReasonHitEnemy", reasonData: { actor: attacker.name, targets: hitEnemies.map((t) => t.name).join(", ") } });
	}

	// The targets' triggers
	const melee = item ? isMeleePower(item, targets, attackerToken) : false;
	for (const target of enemyTargets) {
		const actor = target.actor;
		if (!actor || actor === attacker) continue;
		const wasHit = hit.includes(target);
		const powers = [];
		for (const p of actor.items) {
			const c = classify(p);
			if (!c || !canReact(actor, p)) continue;
			if (c.range && attackerToken && gridDistance(target, attackerToken) > c.range) continue;
			if (c.type === "attacked" || (c.type === "meleeAttacked" && melee) || (c.type === "hitSelf" && wasHit)) powers.push(p);
		}
		if (!powers.length) continue;
		const reasonKey = wasHit ? "Reaction.ReasonHitYou" : (melee ? "Reaction.ReasonMeleeAttacked" : "Reaction.ReasonAttacked");
		await postCard({ actor, token: target, powers, reasonKey, reasonData: { enemy: attacker.name, actor: actor.name }, targetToken: attackerToken });
	}
}

/** updateActor (active GM): an enemy dropped to 0 HP during someone's turn. */
export async function onUpdateActor(actor, changes) {
	if (!setting("reactionPrompts") || !game.users.activeGM?.isSelf || !game.combat?.started) return;
	const hp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
	if (hp === undefined || hp > 0) return;
	const fallen = tokenForActor(actor);
	const current = game.combat.combatant;
	const attacker = current?.actor;
	const attackerToken = current?.token?.object ?? tokenForActor(attacker);
	if (!attacker || !fallen || !attackerToken || attacker === actor || !areEnemies(attackerToken, fallen)) return;
	await postCard({ actor: attacker, token: attackerToken, powers: triggeredPowers(attacker, "dropEnemy"),
		reasonKey: "Reaction.ReasonDrop", reasonData: { actor: attacker.name, target: fallen.name } });
}

/* -------------------------------------------- */
/*  Buttons                                       */
/* -------------------------------------------- */

function resolve(btn) {
	const actor = fromUuidSync(btn.dataset.actor);
	const item = actor?.items.get(btn.dataset.item);
	return { actor, item };
}

function syncButton(btn) {
	const { actor, item } = resolve(btn);
	btn.dataset.label ??= btn.innerHTML;
	const available = !!(actor && item && canReact(actor, item));
	btn.disabled = !available;
	btn.innerHTML = available ? btn.dataset.label : `<i class="fa-solid fa-ban"></i> ${F("Reaction.Unavailable", { power: item?.name ?? "" })}`;
}

export function syncReactionButtons() {
	document.querySelectorAll(".d4ea-react-use[data-actor]").forEach(syncButton);
}

async function onUseButton(ev) {
	const btn = ev.currentTarget;
	const { actor, item } = resolve(btn);
	if (!actor || !item) return;
	if (!actor.isOwner) return ui.notifications.warn(L("Opportunity.NotOwner"));
	const target = btn.dataset.target ? game.scenes.get(btn.dataset.targetScene)?.tokens.get(btn.dataset.target)?.object : null;
	if (target) target.setTarget(true, { releaseOthers: true });
	if (typeof actor.usePower === "function") await actor.usePower(item, { configureDialog: true, fastForward: false });
	else await item.roll();
}

export function registerTriggerHooks() {
	Hooks.on("renderChatMessageHTML", (message, html) => {
		if (!message.flags?.[MODULE_ID]?.reaction) return;
		html.querySelectorAll(".d4ea-react-use").forEach((b) => {
			b.addEventListener("click", onUseButton);
			syncButton(b);
		});
	});
	const resync = () => setTimeout(syncReactionButtons, 50);
	for (const hook of ["updateCombatant", "combatTurnChange", "updateCombat", "updateItem"]) Hooks.on(hook, resync);
	Hooks.on("updateActor", (actor, changes) => {
		onUpdateActor(actor, changes).catch((e) => console.error(`${MODULE_ID} | reaction drop`, e));
	});
}
