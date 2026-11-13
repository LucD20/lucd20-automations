import { MODULE_ID, KIND } from "../constants.mjs";
import { F, L, log, setting, tokenForActor, visibleEnemies, matches } from "../utils.mjs";
import { effectsOfKind, createEffects } from "../effects.mjs";
import { chooseToken } from "../targeting.mjs";
import { meleeBasicAttack } from "../reactions/opportunity.mjs";
import { combatantForActor, setChargePending, isCombatantsTurn } from "../actions/state.mjs";
import { chargeDestinations } from "./reach.mjs";
import { pickMovement } from "./picker.mjs";

/*
 * Charge line. Rules (Rules Compendium): move your speed, at least 2 squares from where you started,
 * every square closer to the target, and end on the nearest square from which you can attack it;
 * if that square is occupied, you can't charge. Then a melee basic attack (or a power usable in its
 * place, e.g. Howling Strike) with +1 to the attack roll (the system's "charging" status).
 *
 * Started from the action panel ("Charge") or by powers like Swift Charge ("you charge an enemy").
 * Powers that add squares to the charge ("if you're raging you can move 2 additional squares as part
 * of the charge") are read from their text.
 */

const SWIFT_CHARGE = { ids: ["barbarian-swift-charge"], names: /swift charge|investida c[ée]lere/i };
const CHARGE_EFFECT_RE = /\b(makes? a charge|charges? an enemy|realiza uma investida|faz uma investida)\b/i;
const IN_PLACE_RE = /(when (?:you )?(?:make a )?charg\w*[^.]*in place of a melee basic attack|quando realizar uma investida[^.]*no lugar de um ataque b[áa]sico corpo a corpo)/i;
const EXTRA_RE = /(?:move|mover)\s+(\d+)\s+(?:additional squares|extra squares|quadrados adicionais)/i;
const RAGE_RE = /\b(rag(?:e|ing)|f[úu]ria)\b/i;

function plain(html) {
	return String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ");
}

function powerText(item) {
	const sys = item?.system ?? {};
	return [sys.special, sys.effect?.detail, plain(sys.description?.value)].filter(Boolean).join(" ");
}

function isRaging(actor) {
	return effectsOfKind(actor, KIND.RAGE).length > 0;
}

/** Powers usable as the charge's attack: the melee basic attack plus "use this power in place of a melee basic attack". */
export function chargeAttacks(actor) {
	const list = [];
	const basic = meleeBasicAttack(actor);
	if (basic) list.push(basic);
	for (const item of actor.items) {
		if (item.type !== "power" || item === basic) continue;
		if (item.system?.attack?.canCharge || IN_PLACE_RE.test(powerText(item))) list.push(item);
	}
	return list.filter((p) => !(p.system?.uses?.max && p.system.uses.value <= 0));
}

/** Extra squares this attack power grants for the charge (Howling Strike: +2 while raging). */
export function extraSquares(actor, power) {
	const text = powerText(power);
	const sentence = text.split(/(?<=\.)\s/).find((s) => EXTRA_RE.test(s));
	if (!sentence) return 0;
	if (RAGE_RE.test(sentence) && !isRaging(actor)) return 0;
	return Number(sentence.match(EXTRA_RE)[1]) || 0;
}

function speedOf(actor) {
	return Number(actor.system?.movement?.walk?.value) || 6;
}

function reachOf(power) {
	const sys = power?.system ?? {};
	if (sys.rangeType === "reach") return Math.max(1, Number(sys.rangePower ?? sys.range?.value ?? 1) || 1);
	return 1;
}

async function chooseAttack(actor) {
	const options = chargeAttacks(actor);
	if (options.length <= 1) return options[0] ?? null;
	const { DialogV2 } = foundry.applications.api;
	const choice = await DialogV2.wait({
		window: { title: L("Charge.ChooseAttack") },
		content: `<p>${F("Charge.ChooseAttackHint", { name: actor.name })}</p>`,
		buttons: options.map((p, i) => ({ action: String(i), label: p.name, icon: "fa-solid fa-hand-fist", default: i === 0 })),
		rejectClose: false,
	}).catch(() => null);
	return choice === null || choice === undefined ? null : options[Number(choice)] ?? null;
}

/** Ask (or use the current target) for an enemy that can be charged. */
async function chooseTarget(me, speedFor) {
	const targets = Array.from(game.user.targets).filter((t) => t !== me);
	if (targets.length === 1) return targets[0];
	const ok = visibleEnemies(me).filter((t) => !chargeDestinations(me, t, speedFor(t)).reason);
	if (!ok.length) {
		ui.notifications.warn(F("Charge.NoEnemy", { name: me.name }));
		return null;
	}
	if (ok.length === 1) return ok[0];
	return chooseToken(ok, L("Charge.ChooseTarget"), L("Charge.ChooseTargetHint"));
}

/**
 * Run a charge for `actor`: pick the attack, the target and the end square, move, then roll the attack.
 * @param {Actor} actor
 * @param {object} [opts]
 * @param {string} [opts.power]  Name shown in the bar (e.g. "Swift Charge")
 * @param {boolean} [opts.beforeAttack]  Called after the move, before the attack (status, action bookkeeping)
 * @returns {Promise<boolean>} true if the charge happened
 */
export async function runCharge(actor, { power = "", beforeAttack = null } = {}) {
	const me = tokenForActor(actor);
	if (!me) return false;
	if (canvas.grid.type !== CONST.GRID_TYPES.SQUARE) return false;
	const attack = await chooseAttack(actor);
	if (!attack) {
		ui.notifications.warn(F("Opportunity.NoBasic", { name: actor.name }));
		return false;
	}
	const speed = speedOf(actor) + extraSquares(actor, attack);
	const reach = reachOf(attack);
	const target = await chooseTarget(me, () => ({ speed, reach }));
	if (!target) return false;
	const { destinations, reason, nearest } = chargeDestinations(me, target, { speed, reach });
	if (reason) {
		ui.notifications.warn(F(`Charge.Reason.${reason}`, { name: actor.name, target: target.name, nearest, speed }));
		return false;
	}
	target.setTarget(true, { releaseOthers: true });
	const result = await pickMovement({
		token: me, mode: "charge", squares: speed, destinations, targetName: target.name,
		power: power || L("Actions.Basic.charge"), action: "walk", moveOptions: { charge: true },
	});
	if (!result.moved) return false;
	log("charge", actor.name, "->", target.name, result.squares, "squares");
	await beforeAttack?.();
	await waitForArrival(me, result.path?.at(-1));
	if (typeof actor.usePower === "function") await actor.usePower(attack, { configureDialog: true, fastForward: false });
	else await attack.roll();
	return true;
}

async function waitForArrival(token, last) {
	if (!last) return;
	const size = canvas.grid.size;
	for (let i = 0; i < 30; i++) {
		if (Math.round(token.document.x / size) === last.j && Math.round(token.document.y / size) === last.i) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	await (token.movementAnimationPromise ?? Promise.resolve());
}

/** The "charging" status (+1 to the attack via the system) until the end of the user's current action. */
export async function applyCharging(actor) {
	if (actor.statuses?.has("charging")) return;
	const Cls = CONFIG.ActiveEffect.documentClass;
	const base = Cls.fromStatusEffect ? await Cls.fromStatusEffect("charging") : null;
	const data = base ? base.toObject() : { name: "charging", statuses: ["charging"], img: "icons/svg/wingfoot.svg" };
	data.origin = actor.uuid;
	data.system = { ...(data.system ?? {}), durationType: "endOfUserCurrent" };
	data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { kind: "basicAction", source: actor.uuid } };
	await createEffects(actor, [data]);
}

/** Swift Charge and similar powers: "you charge an enemy" as part of the power (no extra action). */
export async function onUsePower(item, actor) {
	if (!setting("clickMovement")) return false;
	if (!matches(item, SWIFT_CHARGE) && !(item.system?.effect?.detail && CHARGE_EFFECT_RE.test(plain(item.system.effect.detail)))) return false;
	const combatant = combatantForActor(actor);
	await runCharge(actor, {
		power: item.name,
		beforeAttack: async () => {
			await applyCharging(actor);
			// The attack is part of the free charge: don't spend a standard action for it
			if (combatant?.combat?.started && isCombatantsTurn(combatant)) await setChargePending(combatant, true);
		},
	});
	return true;
}
