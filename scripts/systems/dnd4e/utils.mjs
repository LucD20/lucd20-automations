import { dnd4eSetting } from "./cards.mjs";
import { MODULE_ID } from "./constants.mjs";

export const L = (key) => game.i18n.localize(`DND4EAUTO.${key}`);
export const F = (key, data) => game.i18n.format(`DND4EAUTO.${key}`, data);

/* Merged into LucD20 Automations: the old keys map onto the feature cards (cards.mjs). */
export function setting(key) {
	return dnd4eSetting(key);
}

export function log(...args) {
	if (setting("debug")) console.log(`${MODULE_ID} |`, ...args);
}

/* -------------------------------------------- */
/*  Item / actor recognition                    */
/* -------------------------------------------- */

/** Does an item (or item roll data) match a matcher from MATCHERS? */
export function matches(item, matcher) {
	if (!item) return false;
	const sys = item.system ?? item;
	const identifier = sys.identifier ?? item.identifier;
	if (identifier && matcher.ids.includes(identifier)) return true;
	const name = item.name ?? "";
	return matcher.names.test(name);
}

export function actorHas(actor, matcher) {
	return !!actor?.items?.some((i) => matches(i, matcher));
}

export function isRagePower(item) {
	const sys = item?.system;
	if (!sys) return false;
	if (sys.effectType?.rage) return true;
	return (sys.keyWords ?? []).some((k) => /^(rage|f[úu]ria)$/i.test(String(k).trim()));
}

/** Is this power a melee attack? (used for melee-only bonuses like Bloodhunt Rage) */
export function isMeleePower(item, targets = [], attacker = null) {
	const sys = item?.system;
	if (!sys) return false;
	if (["melee", "touch", "reach"].includes(sys.rangeType)) return true;
	if (sys.rangeType !== "weapon") return false;
	if (sys.weaponType === "melee") return true;
	if (sys.weaponType === "ranged" || sys.weaponType === "implement") return false;
	// "any"/"meleeRanged": decide by distance to the target
	if (attacker && targets.length) return targets.every((t) => gridDistance(attacker, t) <= 1);
	return true;
}

/** Is this attack a ranged attack (creatures can grant cover)? */
export function isRangedPower(item, target = null, attacker = null) {
	const sys = item?.system;
	if (!sys) return false;
	if (sys.rangeType === "range") return true;
	if (sys.rangeType !== "weapon") return false;
	if (sys.weaponType === "ranged") return true;
	if (sys.weaponType === "melee") {
		// thrown melee weapons count as ranged when the target is out of reach
		return !!(attacker && target && gridDistance(attacker, target) > 1);
	}
	return !!(attacker && target && gridDistance(attacker, target) > 1);
}

export function isAreaPower(item) {
	return ["rangeBurst", "rangeBlast", "wall"].includes(item?.system?.rangeType);
}

export function isCloseAttack(item) {
	return ["closeBurst", "closeBlast"].includes(item?.system?.rangeType);
}

/* -------------------------------------------- */
/*  Tokens and geometry                          */
/* -------------------------------------------- */

/** Best token on the current canvas for an actor. */
export function tokenForActor(actor) {
	if (!actor || !canvas?.ready) return null;
	if (actor.token?.object) return actor.token.object;
	const controlled = canvas.tokens.controlled.find((t) => t.actor === actor);
	if (controlled) return controlled;
	return actor.getActiveTokens(true)[0] ?? null;
}

/** Grid footprint of a token, in grid offsets. */
export function footprint(token) {
	const size = canvas.grid.size;
	const doc = token.document;
	const x0 = Math.round(doc.x / size);
	const y0 = Math.round(doc.y / size);
	const w = Math.max(1, Math.round(doc.width));
	const h = Math.max(1, Math.round(doc.height));
	return { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1, w, h };
}

/** 4e distance (squares) between two tokens: diagonals cost 1, measured footprint to footprint. */
export function gridDistance(a, b) {
	if (!a || !b) return Infinity;
	const fa = footprint(a);
	const fb = footprint(b);
	const dx = Math.max(0, fb.x0 - fa.x1, fa.x0 - fb.x1);
	const dy = Math.max(0, fb.y0 - fa.y1, fa.y0 - fb.y1);
	return Math.max(dx, dy);
}

const D = () => CONST.TOKEN_DISPOSITIONS;

/** Are two tokens enemies of each other (by disposition)? */
export function areEnemies(a, b) {
	const da = a.document.disposition;
	const db = b.document.disposition;
	if (da === D().FRIENDLY) return db === D().HOSTILE;
	if (da === D().HOSTILE) return db === D().FRIENDLY;
	return false;
}

export function areAllies(a, b) {
	if (a === b) return false;
	const da = a.document.disposition;
	return (da === b.document.disposition) && (da !== D().NEUTRAL) && (da !== D().SECRET);
}

export function isDefeated(token) {
	const actor = token.actor;
	if (!actor) return true;
	if (actor.statuses?.has("dead")) return true;
	const hp = actor.system?.attributes?.hp?.value;
	return (typeof hp === "number") && (hp <= 0) && (actor.type !== "Player Character");
}

/** Tokens that are enemies of `source`, visible to this client, and not defeated. */
export function visibleEnemies(source) {
	return canvas.tokens.placeables.filter((t) => t !== source && t.actor && !t.document.hidden
		&& t.visible && areEnemies(source, t) && !isDefeated(t));
}

/** Nearest visible enemies (all tied at the minimum distance). */
export function nearestVisibleEnemies(source) {
	const enemies = visibleEnemies(source);
	if (!enemies.length) return [];
	let best = Infinity;
	for (const e of enemies) best = Math.min(best, gridDistance(source, e));
	return enemies.filter((e) => gridDistance(source, e) === best);
}

export function alliesWithin(source, range) {
	return canvas.tokens.placeables.filter((t) => t !== source && t.actor && !t.document.hidden
		&& areAllies(source, t) && !isDefeated(t) && (gridDistance(source, t) <= range));
}

/** Image used as the "who did this" icon on a target: the source token's art. */
export function tokenArt(token, actor) {
	const doc = token?.document;
	return doc?.ring?.enabled && doc.ring.subject?.texture ? doc.ring.subject.texture
		: (doc?.texture?.src || actor?.img || "icons/svg/target.svg");
}

/* -------------------------------------------- */
/*  Combat timing                                 */
/* -------------------------------------------- */

/** Key identifying the current turn of the active combat, or null outside combat. */
export function currentTurnKey() {
	const c = game.combat;
	if (!c?.started) return null;
	return { combat: c.id, round: c.round, turn: c.turn };
}

export function sameTurn(a, b) {
	return !!a && !!b && (a.combat === b.combat) && (a.round === b.round) && (a.turn === b.turn);
}

/**
 * Has `actor`'s own turn started since `used` (a turn key)? Used for Hunter's Quarry, which
 * refreshes at the start of the ranger's turn.
 */
export function ownTurnStartedSince(actor, used) {
	const c = game.combat;
	if (!used || !c?.started || (used.combat !== c.id)) return true;
	const combatant = c.combatants.find((cb) => cb.actor === actor || cb.actor?.id === actor.id);
	const idx = combatant ? c.turns.findIndex((t) => t.id === combatant.id) : -1;
	if (idx < 0) return !sameTurn(used, currentTurnKey());
	// Most recent start of the actor's turn
	const lastStart = (c.turn >= idx) ? { round: c.round, turn: idx } : { round: c.round - 1, turn: idx };
	if (used.round !== lastStart.round) return used.round < lastStart.round;
	return used.turn < lastStart.turn;
}

/** Number of extra damage dice by level (1d/2d/3d at levels 1-10/11-20/21-30). */
export function tierDice(actor) {
	const level = Number(actor?.system?.details?.level) || 1;
	return level >= 21 ? 3 : level >= 11 ? 2 : 1;
}

export function abilityMod(actor, ability) {
	const a = actor?.system?.abilities?.[ability];
	if (!a) return 0;
	if (typeof a.mod === "number") return a.mod;
	return Math.floor(((Number(a.value) || 10) - 10) / 2);
}

export function maximize(formula) {
	try {
		return new Roll(formula).evaluateSync({ maximize: true }).total;
	} catch (err) {
		return formula;
	}
}

/** Find a speaker's actor (the dnd4e hooks give us a ChatMessage speaker). */
export function actorFromSpeaker(speaker) {
	if (!speaker) return null;
	if (speaker.scene && speaker.token) {
		const t = game.scenes.get(speaker.scene)?.tokens.get(speaker.token);
		if (t?.actor) return t.actor;
	}
	return game.actors.get(speaker.actor) ?? null;
}

/**
 * Wait until Dice So Nice has finished animating the roll that is about to be shown, so cards
 * that depend on the result (hit/miss) don't spoil it. Resolves at once without Dice So Nice.
 * The dnd4e hooks fire right before the roll's message is created, so the next completed
 * animation is that roll's.
 */
export function waitForDice(timeout = 12000) {
	const dsn = game.modules.get("dice-so-nice");
	if (!dsn?.active || !game.dice3d) return Promise.resolve();
	if (typeof game.dice3d.isEnabled === "function" && !game.dice3d.isEnabled()) return Promise.resolve();
	return new Promise((resolve) => {
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			Hooks.off("diceSoNiceRollComplete", id);
			resolve();
		};
		const id = Hooks.on("diceSoNiceRollComplete", () => setTimeout(finish, 150));
		setTimeout(finish, timeout);
	});
}
