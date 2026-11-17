import { MATCHERS, KIND } from "../constants.mjs";
import { matches, actorFromSpeaker } from "../utils.mjs";
import { tokensWithEffect } from "../effects.mjs";
import { getFeature } from "../../../core/registry.js";
import { localize } from "../../../core/constants.js";

/**
 * New Player Tips (owner, Q252–Q261): lines on top of the 4e HUD for the character shown, each with the power it
 * points to blinking. Up to 3 at once: tips from the last roll first, then the turn's.
 * - Turn tips (the character's own turn in combat, not at 0 HP):
 *   Ranger: the prey (Hunter's Quarry) and Nimble Strike (an enemy adjacent) or Twin Strike.
 *   Warlock: the curse (Warlock's Curse); the cursed enemies pinged at the turn's start.
 *   Barbarian: two or more enemies adjacent → Great Cleave; an enemy within 3 squares, none adjacent →
 *   Pressing Strike; otherwise Charge or Pressing Strike.
 * - After a roll (only with a use left, against an enemy that isn't weak: a minion, or more than 2 levels
 *   below), until used, the next roll or the turn's end:
 *   a hit → Furious Assault; a miss → Elven Accuracy; an enemy dropped during your turn → Swift Charge;
 *   attacked → Fox's Cunning (before the damage).
 * The tips follow the power a character has, so a half-orc's Furious Assault or an elf's Elven Accuracy works
 * whatever the class. Texts follow the 4e game language.
 */

const T = (key, data) => localize(`LUCD20.Dnd4eTips.${key}`, data);

const POWERS = {
	nimbleStrike: { ids: ["ranger-01-nimble-strike"], names: /nimble strike|golpe [áa]gil/i },
	twinStrike: { ids: ["ranger-01-twin-strike"], names: /twin strike|golpe duplo|ataque duplo/i },
	greatCleave: { ids: ["barbarian-01-great-cleave"], names: /great cleave|grande (?:trespassar|golpe)|clivagem/i },
	elvenAccuracy: { ids: ["elf-power-elven-accuracy", "elven-accuracy", "precisao-elfica"], names: /elven accuracy|precis[ãa]o [ée]lfica/i },
	majesticWord: { ids: ["bard-majestic-word", "majestic-word"], names: /majestic word|palavra majestosa/i },
	blunder: { ids: ["bard-01-blunder"], names: /blunder|trapalhada|trope[çc]o/i },
	misdirectedMark: { ids: ["bard-01-misdirected-mark"], names: /misdirected mark|marca (?:indireta|enganosa|desviada)/i },
	viciousMockery: { ids: ["bard-01-vicious-mockery"], names: /vicious mockery|zombaria (?:cruel|perversa)|esc[áa]rnio/i },
	stirringShout: { ids: ["bard-01-stirring-shout"], names: /stirring shout|grito inspirador/i },
	foxsCunning: { ids: ["ranger-01-foxs-cunning", "foxs-cunning"], names: /fox'?s cunning|ast[úu]cia da raposa/i },
	swiftCharge: { ids: ["swift-charge", "barbarian-swift-charge"], names: /swift charge|investida (?:veloz|r[áa]pida)/i }
};

function enabled(cls) {
	const f = getFeature("dnd4eTips");
	return !!f?.isEnabled && !!f.get(cls);
}

const down = (actor) => Number(actor?.system?.attributes?.hp?.value) <= 0;
const myTurn = (actor) => {
	const c = game.combat;
	return !!c?.started && c.combatant?.actor?.id === actor?.id;
};
const turnKey = () => `${game.combat?.id}:${game.combat?.round}:${game.combat?.turn}`;

/** The item a tip points to: a power first (a sheet can hold a feature of the same name). */
const item = (actor, matcher) => {
	const all = actor?.items?.filter?.((i) => matches(i, matcher)) ?? [];
	return all.find((i) => i.type === "power") ?? all[0] ?? null;
};
/** A power with a use left (at-will powers always). */
function usable(actor, matcher) {
	const it = item(actor, matcher);
	if (!it) return null;
	const max = Number(it.system?.uses?.max);
	if (Number.isFinite(max) && max > 0 && Number(it.system?.uses?.value) <= 0) return null;
	return it;
}

/** A minion, or more than 2 levels below this character. */
export function isWeak(me, them) {
	const d = them?.system?.details ?? {};
	if (d.role?.secondary === "minion" || Number(them?.system?.attributes?.hp?.max) === 1) return true;
	const mine = Number(me?.system?.details?.level), theirs = Number(d.level);
	return Number.isFinite(mine) && Number.isFinite(theirs) && theirs < mine - 2;
}

/* -------------------------------------------- */
/*  Where the enemies are                       */
/* -------------------------------------------- */

const tokenOf = (actor) => (canvas.tokens?.placeables ?? []).find((t) => t.actor?.id === actor?.id) ?? null;
const cells = (t) => {
	const d = t.document ?? t, s = canvas.grid.size;
	const x0 = Math.round(d.x / s), y0 = Math.round(d.y / s);
	return { x0, y0, x1: x0 + Math.max(1, Math.round(d.width ?? 1)) - 1, y1: y0 + Math.max(1, Math.round(d.height ?? 1)) - 1 };
};
/** 4e distance in squares between two tokens' spaces (adjacent = 1). */
export function squares(a, b) {
	const A = cells(a), B = cells(b);
	const dx = Math.max(0, B.x0 - A.x1, A.x0 - B.x1), dy = Math.max(0, B.y0 - A.y1, A.y0 - B.y1);
	return Math.max(dx, dy);
}
function allies(token) {
	const mine = token.document?.disposition;
	return (canvas.tokens?.placeables ?? []).filter((t) => t.actor && !t.document?.hidden && t.visible !== false && t.document?.disposition === mine);
}
const hpOf = (actor) => actor?.system?.attributes?.hp ?? {};
const bloodied = (actor) => { const hp = hpOf(actor); return Number(hp.max) > 0 && Number(hp.value) <= Number(hp.max) / 2; };
const tough = (me, them) => {
	const d = them?.system?.details ?? {};
	return ["elite", "solo"].includes(d.role?.secondary) || Number(d.level) >= Number(me?.system?.details?.level) + 2;
};

function enemies(token) {
	const mine = token.document?.disposition;
	return (canvas.tokens?.placeables ?? []).filter((t) => t !== token && t.actor && !t.document?.hidden && t.visible !== false
		&& !down(t.actor) && t.document?.disposition !== undefined && t.document.disposition * mine < 0);
}

/* -------------------------------------------- */
/*  Tips                                        */
/* -------------------------------------------- */

const tip = (key, text, powers = [], tab = null, basics = []) => ({ key, text, blink: powers.length || basics.length ? { tab, powers: powers.map((p) => p.id), basics } : null });

/** The turn's tips for this actor. */
function turnTips(actor) {
	if (!myTurn(actor) || down(actor)) return [];
	const out = [];
	const token = tokenOf(actor);
	const foes = token ? enemies(token) : [];
	const adjacent = token ? foes.filter((t) => squares(token, t) <= 1) : [];
	const near = token ? foes.filter((t) => squares(token, t) <= 3) : [];

	if (enabled("ranger")) {
		const quarry = item(actor, MATCHERS.huntersQuarry);
		if (quarry) {
			const prey = tokensWithEffect(KIND.QUARRY, actor.uuid);
			out.push(prey.length ? tip("ranger-prey", T("Ranger.Prey", { name: prey.map((t) => t.name).join(", ") }))
				: tip("ranger-noPrey", T("Ranger.NoPrey", { power: quarry.name }), [quarry], "minor"));
		}
		const nimble = usable(actor, POWERS.nimbleStrike), twin = usable(actor, POWERS.twinStrike);
		if (adjacent.length && nimble) out.push(tip("ranger-nimble", T("Ranger.Nimble", { power: nimble.name }), [nimble], "standard"));
		else if (twin) out.push(tip("ranger-twin", T("Ranger.Twin", { power: twin.name }), [twin], "standard"));
	}
	if (enabled("warlock")) {
		const curse = item(actor, MATCHERS.warlocksCurse);
		if (curse) {
			const cursed = tokensWithEffect(KIND.CURSE, actor.uuid);
			out.push(cursed.length ? tip("warlock-cursed", T("Warlock.Cursed", { name: cursed.map((t) => t.name).join(", ") }))
				: tip("warlock-noCurse", T("Warlock.NoCurse", { power: curse.name }), curse.type === "power" ? [curse] : [], "minor"));
		}
	}
	if (enabled("barbarian")) {
		const cleave = usable(actor, POWERS.greatCleave), pressing = usable(actor, MATCHERS.pressingStrike);
		if (adjacent.length >= 2 && cleave) out.push(tip("barb-cleave", T("Barbarian.Cleave", { power: cleave.name, n: adjacent.length }), [cleave], "standard"));
		else if (pressing && near.length && !adjacent.length) out.push(tip("barb-pressing", T("Barbarian.Pressing", { power: pressing.name }), [pressing], "standard"));
		else if (pressing || cleave) out.push(tip("barb-charge", T("Barbarian.Charge", { power: (pressing ?? cleave).name }), pressing ? [pressing] : [], "standard", ["charge"]));
	}
	if (enabled("bard") && token) {
		// Majestic Word: you or an ally within 5 squares bloodied or dying (the dying first).
		const word = usable(actor, POWERS.majesticWord);
		if (word) {
			const hurt = allies(token).filter((t) => squares(token, t) <= 5 && bloodied(t.actor))
				.sort((a, b) => Number(hpOf(a.actor).value) - Number(hpOf(b.actor).value));
			if (hurt.length) {
				const who = hurt[0];
				const key = Number(hpOf(who.actor).value) <= 0 ? "Bard.WordDying" : "Bard.Word";
				out.push(tip("bard-word", T(key, { name: who.name, power: word.name }), [word], "minor"));
			}
		}
		// The attack: Blunder (an ally within 2 squares of a foe within 5), Misdirected Mark (a foe next to an
		// ally within 5 squares of you), else Vicious Mockery; Stirring Shout against a tough foe.
		const friends = allies(token).filter((t) => t !== token);
		const inRange = (n) => foes.filter((t) => squares(token, t) <= n);
		const blunder = usable(actor, POWERS.blunder), mark = usable(actor, POWERS.misdirectedMark), mock = usable(actor, POWERS.viciousMockery);
		const blunderFoe = blunder ? inRange(5).find((f) => friends.some((a) => squares(a, f) <= 2)) : null;
		const markFoe = mark ? inRange(10).find((f) => friends.some((a) => squares(token, a) <= 5 && squares(a, f) <= 1)) : null;
		if (blunderFoe) out.push(tip("bard-blunder", T("Bard.Blunder", { name: blunderFoe.name, power: blunder.name }), [blunder], "standard"));
		else if (markFoe) out.push(tip("bard-mark", T("Bard.Mark", { name: markFoe.name, power: mark.name }), [mark], "standard"));
		else if (mock && inRange(10).length) out.push(tip("bard-mock", T("Bard.Mockery", { power: mock.name }), [mock], "standard"));
		const shout = usable(actor, POWERS.stirringShout);
		const big = shout ? inRange(10).find((f) => tough(actor, f.actor)) : null;
		if (big) out.push(tip("bard-shout", T("Bard.Shout", { name: big.name, power: shout.name }), [shout], "standard"));
	}
	return out;
}

/* After-a-roll tips: actor id → [{ key, text, blink, turn, until, at }] */
const events = new Map();
const MAX_AGE = 3 * 60 * 1000;

function addEvent(actor, entry, until) {
	const list = (events.get(actor.id) ?? []).filter((e) => e.key !== entry.key);
	list.push({ ...entry, turn: turnKey(), until, at: Date.now() });
	events.set(actor.id, list);
	Hooks.callAll("lucd20.tipsChanged");
}
function clearEvents(actor, until) {
	const list = events.get(actor?.id);
	if (!list?.length) return;
	const left = list.filter((e) => e.until !== until);
	if (left.length === list.length) return;
	events.set(actor.id, left);
	Hooks.callAll("lucd20.tipsChanged");
}
function liveEvents(actor) {
	const now = Date.now(), turn = turnKey();
	const list = (events.get(actor?.id) ?? []).filter((e) => now - e.at < MAX_AGE && (e.until === "attacked" || e.turn === turn));
	events.set(actor?.id, list);
	return list;
}

/** Every tip for this actor now (up to 3): after-a-roll ones first. */
export function tipsFor(actor) {
	if (!actor) return [];
	return [...liveEvents(actor), ...turnTips(actor)].slice(0, 3);
}
/** The first tip (kept for older callers). */
export function tipFor(actor) {
	return tipsFor(actor)[0] ?? null;
}

/** Your attack roll (dnd4e.rollAttack, on the roller's client): Furious Assault on a hit, Elven Accuracy on a miss. */
export function onAttack(itemData, targetData, speaker) {
	const actor = actorFromSpeaker(speaker);
	if (!actor) return;
	clearEvents(actor, "roll");
	clearEvents(actor, "damage"); // a new attack: the earlier hit's moment is over
	const strong = (list) => (list ?? []).filter((t) => t?.actor && !isWeak(actor, t.actor));
	const hit = strong(targetData?.targetHit), missed = strong(targetData?.targetMissed);
	if (enabled("barbarian") && hit.length) {
		const fa = usable(actor, MATCHERS.furiousAssault);
		if (fa) addEvent(actor, tip("evt-furious", T("Barbarian.Furious", { power: fa.name, name: hit[0].name }), [fa], "free"), "damage");
	}
	if (enabled("elf") && missed.length) {
		const ea = usable(actor, POWERS.elvenAccuracy);
		if (ea) addEvent(actor, tip("evt-elven", T("Elf.Accuracy", { power: ea.name, name: missed[0].name }), [ea], "free"), "roll");
	}
}

/** Your damage roll: the hit's tips end. */
export function onDamage(item) {
	const actor = item?.actor ?? item?.parent;
	if (actor) clearEvents(actor, "damage");
}

/** An enemy dropped to 0 HP during a barbarian's turn: Swift Charge. */
export function onHitPoints(actor, changes) {
	const hp = foundry.utils.getProperty(changes ?? {}, "system.attributes.hp.value");
	if (hp === undefined || Number(hp) > 0 || !enabled("barbarian")) return;
	const c = game.combat;
	const barb = c?.started ? c.combatant?.actor : null;
	if (!barb || barb.id === actor.id || !(game.user.isGM || barb.testUserPermission?.(game.user, "OWNER"))) return;
	const sc = usable(barb, POWERS.swiftCharge);
	if (sc) addEvent(barb, tip("evt-swift", T("Barbarian.Swift", { power: sc.name, name: actor.name }), sc.type === "power" ? [sc] : [], "free", ["charge"]), "turn");
}

/** An attack against a ranger with Fox's Cunning (any client: its players and the GM see it). */
export function onAttackMessage(message, rows) {
	if (!enabled("ranger") || !rows?.length) return;
	const attacker = actorFromSpeaker(message.speaker);
	for (const { entry } of rows) {
		const token = canvas.tokens?.get?.(entry?.targetID);
		const ranger = token?.actor;
		if (!ranger || !(game.user.isGM || ranger.testUserPermission?.(game.user, "OWNER"))) continue;
		if (attacker && isWeak(ranger, attacker)) continue;
		const fc = usable(ranger, POWERS.foxsCunning);
		if (fc) addEvent(ranger, tip("evt-fox", T("Ranger.Fox", { power: fc.name, name: attacker?.name ?? "" }), [fc], "triggered"), "attacked");
	}
}

/** A damage roll from the attacker: Fox's Cunning's moment is over. */
export function onDamageMessage(message) {
	if (!message?.rolls?.[0]?.options?.hitTypeDamage) return;
	for (const [id, list] of events) {
		const left = list.filter((e) => e.until !== "attacked");
		if (left.length !== list.length) { events.set(id, left); Hooks.callAll("lucd20.tipsChanged"); }
	}
}

/** At the start of a ranger's or warlock's turn: a ping on its prey or cursed enemies, for its players and the GM. */
export function onTurnStart(combat) {
	const actor = combat?.combatant?.actor;
	if (!actor || down(actor)) return;
	if (!(game.user.isGM || actor.testUserPermission?.(game.user, "OWNER"))) return;
	const marked = [];
	if (enabled("ranger") && item(actor, MATCHERS.huntersQuarry)) marked.push(...tokensWithEffect(KIND.QUARRY, actor.uuid));
	if (enabled("warlock") && item(actor, MATCHERS.warlocksCurse)) marked.push(...tokensWithEffect(KIND.CURSE, actor.uuid));
	for (const token of marked) {
		if (token.document?.parent !== canvas.scene || token.visible === false) continue;
		// (verify) V14: drawPing draws on this screen only; canvas.ping would show everyone.
		try { canvas.controls?.drawPing?.(token.center, { style: "pulse" }); } catch { /* no ping */ }
	}
}

export const _test = { events, POWERS };
