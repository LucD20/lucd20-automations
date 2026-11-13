import { MODULE_ID, SOCKET } from "./constants.mjs";
import { F, L, setting, log, actorFromSpeaker } from "./utils.mjs";

/*
 * Damage chat cards: the dnd4e "Apply Damage" buttons only affect the *selected* tokens, which
 * players can't do for monsters. We remember the targets of the attack, store them on the damage
 * message, and replace the buttons with:
 *   - Damage / Half  -> the attack's targets (hit targets for hit/crit damage, missed ones for miss damage)
 *   - Damage / Half  -> the selected tokens (for misclicks)
 *   - Retarget       -> replace the stored targets with your current targets
 * Damage to creatures the user doesn't own is applied by the active GM through the socket.
 */

const lastAttack = new Map(); // attacker actor uuid -> { hit, missed, all, time }
const FLAG = "damageTargets";

export function onAttackRolledForDamage(itemData, targetData, speaker) {
	const actor = actorFromSpeaker(speaker);
	if (!actor) return;
	const uuids = (list) => (list ?? []).map((t) => t.document?.uuid).filter(Boolean);
	lastAttack.set(actor.uuid, { hit: uuids(targetData?.targetHit), missed: uuids(targetData?.targetMissed), all: uuids(targetData?.targets), time: Date.now() });
}

function damageRoll(message) {
	const roll = message.rolls?.[0];
	return roll?.options?.hitTypeDamage ? roll : null;
}

/** preCreateChatMessage: attach the attack's targets to a damage roll message. */
export function onPreCreateChatMessage(message, data, options, userId) {
	if (!setting("damageTargets") || userId !== game.user.id) return;
	const roll = damageRoll(message);
	if (!roll) return;
	if (message.getFlag(MODULE_ID, FLAG)?.length) return; // targets already chosen (module damage cards)
	const actor = actorFromSpeaker(message.speaker);
	const last = actor ? lastAttack.get(actor.uuid) : null;
	let targets;
	if (last && (Date.now() - last.time < 10 * 60 * 1000)) {
		targets = roll.options.hitType === "miss" ? last.missed : last.hit;
		if (!targets.length) targets = last.all;
	}
	if (!targets?.length) targets = Array.from(game.user.targets).map((t) => t.document.uuid);
	message.updateSource({ [`flags.${MODULE_ID}.${FLAG}`]: targets });
}

/* -------------------------------------------- */
/*  Applying damage                               */
/* -------------------------------------------- */

/** Same split as the dnd4e system: typed terms keep their type, untyped damage is spread evenly. */
function damageParts(roll) {
	const dealt = [];
	let remain = roll.total;
	for (const term of roll.terms) {
		if (typeof term.total === "number" && term.flavor) {
			dealt.push([term.total, term.flavor]);
			remain -= term.total;
		}
	}
	if (remain) {
		if (!dealt.length) dealt.push([remain, "physical"]);
		else for (let i = 0; i < dealt.length; i++) dealt[i][0] += 0 | (remain / dealt.length + (i < remain % dealt.length));
	}
	return dealt;
}

async function applyToActor(actor, dealt, multiplier) {
	if (!actor) return;
	if (actor.isOwner) return actor.calcDamage(dealt, multiplier);
	if (!game.users.activeGM) return ui.notifications.warn(F("Warn.NoGM", { name: actor.name }));
	game.socket.emit(SOCKET, { op: "damage", actorUuid: actor.uuid, dealt, multiplier });
}

export async function handleDamageSocket(payload) {
	const actor = await fromUuid(payload.actorUuid);
	if (actor) await actor.calcDamage(payload.dealt, payload.multiplier);
}

function storedTargets(message) {
	return (message.getFlag(MODULE_ID, FLAG) ?? []).map((u) => fromUuidSync(u)).filter(Boolean);
}

async function apply(message, mode, half) {
	const roll = damageRoll(message);
	if (!roll) return;
	const divisor = roll.options?.divisors?.[roll.options.hitType]?.value ?? 1;
	const multiplier = half ? 0.5 : 1 / divisor;
	const dealt = damageParts(roll);
	const actors = mode === "targets"
		? storedTargets(message).map((t) => t.actor)
		: canvas.tokens.controlled.map((t) => t.actor);
	if (!actors.length) return ui.notifications.warn(mode === "targets" ? L("DamageApply.NoTargets") : L("DamageApply.NoSelection"));
	for (const actor of actors) await applyToActor(actor, dealt, multiplier);
	log("damage applied", mode, half ? "half" : "full", actors.map((a) => a.name));
}

async function retarget(message) {
	const targets = Array.from(game.user.targets).map((t) => t.document.uuid);
	if (!targets.length) return ui.notifications.warn(L("DamageApply.NoCurrentTargets"));
	if (message.canUserModify(game.user, "update")) await message.setFlag(MODULE_ID, FLAG, targets);
	else if (game.users.activeGM) game.socket.emit(SOCKET, { op: "retarget", messageId: message.id, targets });
}

export async function handleRetargetSocket(payload) {
	const message = game.messages.get(payload.messageId);
	if (message) await message.setFlag(MODULE_ID, FLAG, payload.targets);
}

/* -------------------------------------------- */
/*  Rendering                                     */
/* -------------------------------------------- */

export function onRenderChatMessage(message, html) {
	if (!setting("damageTargets") || !damageRoll(message)) return;
	let original = html.querySelector(".chatDamageButtons");
	if (original?.style.display === "none") return;
	if (original) original.style.display = "none";
	else {
		// Damage rolled by this module (plain roll, no system buttons): anchor after the roll
		if (!message.getFlag(MODULE_ID, FLAG)) return;
		original = html.querySelector(".dice-roll");
		if (!original) return;
	}

	const targets = storedTargets(message);
	const names = targets.map((t) => foundry.utils.escapeHTML(t.name)).join(", ") || `<em>${L("DamageApply.None")}</em>`;
	const box = document.createElement("div");
	box.className = "d4ea-damage-apply";
	box.innerHTML = `
		<div class="d4ea-dmg-row d4ea-dmg-targets" data-tooltip="${L("DamageApply.TargetsHint")}">
			<span class="d4ea-dmg-label"><i class="fa-solid fa-crosshairs"></i> ${names}</span>
			<button type="button" data-d4ea-dmg="targets" ${targets.length ? "" : "disabled"}><i class="fas fa-user-minus"></i> ${L("DamageApply.Damage")}</button>
			<button type="button" data-d4ea-dmg="targets-half" ${targets.length ? "" : "disabled"}><i class="fas fa-user-shield"></i> ${L("DamageApply.Half")}</button>
		</div>
		<div class="d4ea-dmg-row d4ea-dmg-selected">
			<span class="d4ea-dmg-label"><i class="fa-solid fa-hand-pointer"></i> ${L("DamageApply.Selected")}</span>
			<button type="button" data-d4ea-dmg="selected"><i class="fas fa-user-minus"></i> ${L("DamageApply.Damage")}</button>
			<button type="button" data-d4ea-dmg="selected-half"><i class="fas fa-user-shield"></i> ${L("DamageApply.Half")}</button>
		</div>
		<button type="button" class="d4ea-dmg-retarget" data-d4ea-dmg="retarget" data-tooltip="${L("DamageApply.RetargetHint")}"><i class="fa-solid fa-arrows-rotate"></i> ${L("DamageApply.Retarget")}</button>`;
	box.addEventListener("click", async (ev) => {
		const btn = ev.target.closest("[data-d4ea-dmg]");
		if (!btn) return;
		ev.preventDefault();
		ev.stopPropagation();
		const action = btn.dataset.d4eaDmg;
		if (action === "retarget") return retarget(message);
		const [mode, half] = action.split("-");
		await apply(message, mode, half === "half");
	});
	// Hovering the target names highlights the tokens, like the system does for attack cards
	const label = box.querySelector(".d4ea-dmg-targets .d4ea-dmg-label");
	label.addEventListener("mouseenter", (ev) => targets.forEach((t) => t.object?._onHoverIn?.(ev, { hoverOutOthers: false })));
	label.addEventListener("mouseleave", (ev) => targets.forEach((t) => t.object?._onHoverOut?.(ev)));
	original.after(box);
}

/**
 * Roll damage from the module (Infernal Wrath, Dire Radiance...) as a chat card with the usual
 * Damage / Half / Selected / Retarget buttons, aimed at `targets`.
 * @param {object} opts
 * @param {Actor} opts.actor
 * @param {string} opts.formula   e.g. "1d6 + 3"
 * @param {string} opts.type      damage type, e.g. "fire"
 * @param {string} opts.flavor
 * @param {Token[]} opts.targets
 */
export async function rollDamageCard({ actor, formula, type, flavor, targets = [] }) {
	const typed = type ? formula.split("+").map((p) => `${p.trim()}[${type}]`).join(" + ") : formula;
	const roll = await new Roll(typed, actor?.getRollData?.() ?? {}).evaluate();
	roll.options.hitTypeDamage = true;
	roll.options.hitType = "normal";
	roll.options.d4eaInfo = { actor: actor?.name ?? "", power: flavor ?? "", damage: true };
	return roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor,
		flags: { [MODULE_ID]: { [FLAG]: targets.map((t) => t.document?.uuid ?? t.uuid).filter(Boolean) } },
	});
}
