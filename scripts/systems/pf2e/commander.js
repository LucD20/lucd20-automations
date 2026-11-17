import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature, getFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { waitForDice } from "../../core/dice.js";
import { pickSeveral } from "../../core/square-picker.js";
import { pf2eCard, answered, wireOpen, sourceUuid, compactCard, nameForPlayers } from "./card.js";
import { grantDrilledReaction, revokeDrilledReaction } from "./reactions.js";
import { onTurns, audience } from "./rules.js";
import { feetBetween } from "./reactive-strike.js";

/**
 * Rule 9 (docs/pf2e-rules.md): the Commander's Demoralizing Charge (expert tactic, 2 actions, brandish).
 * "Signal up to two squadmates within the aura of your commander's banner; as a free action, those
 * squadmates can immediately Stride toward an enemy they are observing. If they end this movement adjacent
 * to an enemy, they can attempt to Strike that enemy as a reaction. For each of these Strikes that are
 * successful, the target enemy must succeed at a Will save against your class DC or become Frightened 1
 * (Frightened 2 on a critical failure) [...] If both Strikes target the same enemy, that enemy attempts the
 * save only once after the final attack and takes a –1 circumstance penalty to their Will save (–2 if both
 * Strikes are successful, –3 if both are successful and either is a critical hit)."
 * As proposed and accepted by the owner:
 * 1. The commander's own card of Demoralizing Charge starts it (on the commander's client). Banner not
 *    raised: a warning, the tactic goes on.
 * 2. The commander picks up to two allies within 30 ft (the banner's aura; not the commander: brandish).
 *    Allies who already answered a tactic this round can't be picked (one tactic per round).
 * 3. Each chosen ally gets a card (their player and the GM): Stride, then Strike as a reaction; Skip.
 *    Drilled Reactions: an ally without their reaction gets the commander's extra reaction (once a round).
 * 4. The GM's client reads each ally's next Strike (until the end of the commander's turn): its target and
 *    whether it hit. The ally's card then shows only the tactic's name, to everyone.
 * 5. When both have answered (or the commander's turn ends): for each enemy hit, a GM-only card with the
 *    Will save against the class DC and the right penalty; Roll, after Dice So Nice: Frightened 1 / 2.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.Commander.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const SLUG = "demoralizing-charge";
const AURA = 30;
const tactics = new Map(); // id → the tactic in progress (GM's client)
let idSeq = 0;

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);
const ownersOf = (actor) => (actor?.hasPlayerOwner ? game.users.filter((u) => !u.isGM && u.active && actor.testUserPermission?.(u, "OWNER")).map((u) => u.id) : []);
const roundKey = () => `${game.combat?.id}:${game.combat?.round}`;
const cellsOf = (doc) => {
	const size = canvas.grid.size;
	const x0 = Math.round(doc.x / size), y0 = Math.round(doc.y / size);
	return { x0, y0, x1: x0 + Math.max(1, Math.round(doc.width)) - 1, y1: y0 + Math.max(1, Math.round(doc.height)) - 1 };
};

/** The commander's class DC. (verify) where PF2e 8.7 keeps it. */
export function classDC(actor) {
	return Number(actor?.classDC?.dc?.value ?? actor?.classDCs?.commander?.dc?.value ?? actor?.system?.attributes?.classDC?.value) || null;
}

/** −1 when both Strikes targeted it, −2 when both hit, −3 when both hit and one was a critical hit. */
export function penaltyFor(strikes) {
	if (strikes.length < 2) return 0;
	const hits = strikes.filter((s) => s.outcome === "success" || s.outcome === "criticalSuccess");
	if (hits.length < 2) return -1;
	return hits.some((s) => s.outcome === "criticalSuccess") ? -3 : -2;
}

/** Saves to roll: one per enemy hit at least once, with its penalty. */
export function savesFrom(strikes) {
	const byTarget = new Map();
	for (const s of strikes) if (s.target) byTarget.set(s.target, [...(byTarget.get(s.target) ?? []), s]);
	return [...byTarget].filter(([, list]) => list.some((s) => s.outcome === "success" || s.outcome === "criticalSuccess"))
		.map(([target, list]) => ({ target, penalty: penaltyFor(list) }));
}

/* -------------------------------------------- */
/*  1–2. The commander's client                 */
/* -------------------------------------------- */

async function onCommanderMessage(message) {
	const item = message?.item;
	if ((message?.author?.id ?? message?.user?.id) !== game.user.id || (item?.slug ?? item?.system?.slug) !== SLUG || message.flags?.pf2e?.context) return;
	const actor = message.actor;
	const token = message.token?.object ?? actor?.getActiveTokens?.()?.[0];
	if (!actor || !token) return;
	if (!game.combat?.started) return ui.notifications.info(L("NotInCombat"));
	// Brandish: the banner must be raised (the system's toggle). A warning only.
	if (!(actor.rollOptions?.all?.["commanders-banner"] ?? actor.getRollOptions?.()?.includes?.("commanders-banner"))) ui.notifications.warn(L("NoBanner"));
	const size = canvas.grid.size;
	const mine = cellsOf(token.document);
	const allies = (canvas.tokens?.placeables ?? []).filter((t) => t !== token && t.actor && t.document.disposition === token.document.disposition && !t.document.hidden && feetBetween(mine, cellsOf(t.document)) <= AURA);
	// v0.48.2 (owner): always allowed (misclicks happen). Allies who answered another commander's tactic this
	// round are shown grey, as a reminder, but can be picked; this commander's own earlier signal is redone.
	const commanderUuid = token.document.uuid;
	const entries = allies.map((t) => {
		const mark = t.document.combatant?.getFlag?.(MODULE_ID, "tacticRound");
		const other = mark?.round === roundKey() && mark.commander !== commanderUuid;
		return { x: t.document.x, y: t.document.y, width: t.document.width * size, height: t.document.height * size, color: other ? 0x777777 : 0x3fb950, value: t.document.uuid };
	});
	if (!entries.length) return ui.notifications.info(L("NoAllies"));
	// v0.48.1 (owner): the last squadmates start chosen when they are still in range; the second click signals.
	const last = actor.getFlag?.(MODULE_ID, "dcLast") ?? [];
	const chosen = await pickSeveral(entries, { max: 2, hint: L("Pick"), confirm: L("Signal"), cancel: L("Cancel"), preselected: last, auto: true });
	if (!chosen?.length) return;
	await actor.setFlag?.(MODULE_ID, "dcLast", chosen).catch?.(() => {});
	// Drilled Reactions (owner): the commander chooses who gets the extra reaction, once a round.
	let drilled = null;
	// A redo in the same round may choose Drilled Reactions again (the earlier signal is cancelled).
	const redo = token.document.combatant?.getFlag?.(MODULE_ID, "dcRound") === roundKey();
	const drilledFree = redo || token.document.combatant?.getFlag?.(MODULE_ID, "drilledRound") !== roundKey();
	if (drilledFree) {
		const picks = entries.filter((e) => chosen.includes(e.value)).map((e) => ({ ...e, color: 0xd9b26a }));
		drilled = (await pickSeveral(picks, { max: 1, hint: L("PickDrilled"), confirm: L("Give"), cancel: L("NoOne"), auto: true }))?.[0] ?? null;
	}
	await executeAsGM("pf2eRules.dcStart", { commander: token.document.uuid, allies: chosen, item: item.uuid, drilled });
}

/* -------------------------------------------- */
/*  3–5. The GM's client                        */
/* -------------------------------------------- */

/** Start: the allies' cards, the round's marks, Drilled Reactions. */
async function start({ commander, allies, item, drilled: drilledTo = null }) {
	const cDoc = fromUuidSync(commander);
	const tactic = fromUuidSync(item);
	if (!cDoc?.actor) return false;
	// A redo: this commander's earlier signal that is still open is cancelled (its extra reaction taken back).
	for (const old of [...tactics.values()].filter((t) => t.commander === commander && !t.done)) {
		old.done = true;
		tactics.delete(old.id);
		for (const ally of old.allies) {
			if (ally.drilled) revokeDrilledReaction(ally.actorId);
			if (ally.status === "waiting") await collapse(ally, old, "Replaced");
		}
	}
	const redo = cDoc.combatant?.getFlag?.(MODULE_ID, "dcRound") === roundKey();
	await cDoc.combatant?.setFlag?.(MODULE_ID, "dcRound", roundKey());
	const id = `dc${Date.now().toString(36)}${++idSeq}`;
	const state = { id, commander, commanderCombatant: cDoc.combatant?.id ?? null, dc: classDC(cDoc.actor), img: tactic?.img ?? null, title: tactic?.name ?? L("Name"), open: sourceUuid(tactic), allies: [], done: false };
	tactics.set(id, state);
	const drilledFree = redo || cDoc.combatant?.getFlag?.(MODULE_ID, "drilledRound") !== roundKey();
	for (const uuid of allies) {
		const doc = fromUuidSync(uuid);
		if (!doc?.actor) continue;
		const combatant = doc.combatant ?? null;
		await combatant?.setFlag?.(MODULE_ID, "tacticRound", { round: roundKey(), commander });
		// Drilled Reactions: once a round, the ally the commander chose gets an extra reaction for this tactic.
		const drilled = drilledFree && drilledTo === uuid;
		if (drilled) {
			grantDrilledReaction(doc.actor.id);
			await cDoc.combatant?.setFlag?.(MODULE_ID, "drilledRound", roundKey());
		}
		const card = await ChatMessage.create({
			content: pf2eCard({
				img: state.img, title: state.title, who: doc.name, open: state.open, extraClass: "lucd20-dc-card",
				body: `<p>${L("Do")}</p>${drilled ? `<p class="lucd20-card-note">${L("Drilled")}</p>` : ""}`,
				buttons: [{ data: "lucd20-dc", value: "skip", icon: "fa-xmark", label: L("Skip") }]
			}),
			speaker: { alias: nameForPlayers(cDoc, cDoc.name) },
			whisper: [...new Set([...ownersOf(doc.actor), ...gmIds()])],
			flags: { [MODULE_ID]: { dcAlly: { tactic: id, token: uuid } } }
		});
		state.allies.push({ token: uuid, actorId: doc.actor.id, card: card?.id ?? null, status: "waiting", strike: null, drilled });
	}
	return true;
}

/** An ally's Strike (GM's client): record its target and outcome; their card shows only the tactic. */
async function onStrike(message) {
	if (!game.user.isActiveGM) return;
	const context = message?.flags?.pf2e?.context;
	if (!["attack-roll", "spell-attack-roll"].includes(context?.type) || context.isReroll) return;
	const actorId = message.actor?.id;
	for (const state of tactics.values()) {
		const ally = state.allies.find((a) => a.actorId === actorId && a.status === "waiting");
		if (!ally) continue;
		ally.status = "struck";
		ally.strike = { target: context.target?.token ?? null, outcome: context.outcome ?? null };
		await collapse(ally, state);
		await maybeFinish(state);
		return;
	}
}

async function collapse(ally, state, closed = false) {
	const card = ally.card ? game.messages.get(ally.card) : null;
	if (!card) return;
	await card.setFlag(MODULE_ID, "dcAlly", { ...card.getFlag(MODULE_ID, "dcAlly"), done: true });
	if (closed) return card.delete(); // v0.50.1 (owner): skipped or replaced, no trace in the chat
	const doc = fromUuidSync(ally.token);
	await card.update({ content: compactCard({ img: state.img, title: state.title, who: nameForPlayers(doc, doc?.name ?? ""), open: state.open, extraClass: "lucd20-dc-card" }), whisper: [], speaker: { alias: nameForPlayers(doc, doc?.name ?? "") } });
}

async function maybeFinish(state, force = false) {
	if (state.done || (!force && state.allies.some((a) => a.status === "waiting"))) return;
	state.done = true;
	tactics.delete(state.id);
	for (const save of savesFrom(state.allies.filter((a) => a.strike).map((a) => a.strike))) {
		const target = fromUuidSync(save.target);
		if (!target?.actor) continue;
		const pen = save.penalty ? ` (${save.penalty})` : "";
		await ChatMessage.create({
			content: pf2eCard({
				img: state.img, title: state.title, open: state.open, extraClass: "lucd20-dc-save",
				body: `<p>${L("SaveLine", { name: `<strong>${esc(target.name)}</strong>`, dc: state.dc ?? "?", penalty: pen })}</p>`,
				buttons: [{ data: "lucd20-dcsave", value: "roll", icon: "fa-dice-d20", label: L("Roll") }]
			}),
			speaker: { alias: L("Speaker") },
			whisper: gmIds(),
			flags: { [MODULE_ID]: { dcSave: { target: save.target, dc: state.dc, penalty: save.penalty, img: state.img, title: state.title, open: state.open } } }
		});
	}
}

/** The GM rolls the target's Will save; after the dice, Frightened 1 / 2. */
async function rollSave(card) {
	const data = card.getFlag(MODULE_ID, "dcSave");
	if (!data || data.done || !game.user.isGM) return;
	await card.setFlag(MODULE_ID, "dcSave", { ...data, done: true });
	const target = fromUuidSync(data.target);
	const actor = target?.actor;
	if (!actor) return;
	const Modifier = game.pf2e?.Modifier;
	const modifiers = data.penalty && Modifier ? [new Modifier({ label: data.title, modifier: data.penalty, type: "circumstance" })] : [];
	// (verify) Statistic#roll's `modifiers` and `dc` in PF2e 8.7.
	const roll = await actor.saves?.will?.roll({ dc: { value: data.dc }, modifiers, extraRollOptions: ["emotion", "fear", "mental"], traits: ["emotion", "fear", "mental"], skipDialog: true });
	const last = (game.messages?.contents ?? []).filter((m) => (m.author?.id ?? m.user?.id) === game.user.id && m.rolls?.length).at(-1);
	await waitForDice(last?.id);
	const degree = Number(roll?.degreeOfSuccess ?? roll?.options?.degreeOfSuccess);
	const value = degree === 0 ? 2 : degree === 1 ? 1 : 0;
	if (value) await actor.increaseCondition?.("frightened", { value });
	await card.update({ content: answered(card.content, value ? L("Frightened", { value }) : L("Resisted")) });
	if (value) {
		await ChatMessage.create({
			content: `<p class="lucd20-rule-note"><i class="fa-solid fa-ghost"></i> ${L("Result", { name: `<strong>${esc(nameForPlayers(target, L("ACreature")))}</strong>`, value, title: esc(data.title) })}</p>`,
			speaker: { alias: localize("LUCD20.PF2eRules.Speaker") },
			...audience(target.combatant ?? { token: target, hidden: target.hidden })
		});
	}
}

defineFeature({
	id: "pf2eDemoralizingCharge",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,

	init(feature) {
		onGMRequest("pf2eRules.dcStart", (payload) => (feature.active ? start(payload) : false));
		onGMRequest("pf2eRules.dcSkip", async ({ card }) => {
			const message = game.messages.get(card);
			const data = message?.getFlag(MODULE_ID, "dcAlly");
			const state = data ? tactics.get(data.tactic) : null;
			const ally = state?.allies.find((a) => a.card === card);
			if (!ally || ally.status !== "waiting") return false;
			ally.status = "skipped";
			await collapse(ally, state, true);
			await maybeFinish(state);
			return true;
		});
	},

	enable(feature) {
		feature.on("createChatMessage", (message) => {
			onCommanderMessage(message).catch((err) => error("Demoralizing Charge failed.", err));
			onStrike(message).catch((err) => error("Demoralizing Charge failed.", err));
		});
		// The commander's turn ends: the tactic closes with the Strikes made so far.
		onTurns(feature, {
			end: (combatant) => {
				for (const state of [...tactics.values()]) if (state.commanderCombatant === combatant.id) maybeFinish(state, true).catch((err) => error("Demoralizing Charge failed.", err));
			}
		});
		feature.on("renderChatMessageHTML", (message, html) => {
			const ally = message.getFlag?.(MODULE_ID, "dcAlly"), save = message.getFlag?.(MODULE_ID, "dcSave");
			if (ally || save) wireOpen(html);
			for (const button of html.querySelectorAll?.("[data-lucd20-dc], [data-lucd20-dcsave]") ?? []) {
				if ((ally ?? save)?.done) { button.disabled = true; continue; }
				button.addEventListener("click", (event) => {
					event.preventDefault();
					if (!feature.active) return;
					button.disabled = true;
					const run = save ? rollSave(message) : executeAsGM("pf2eRules.dcSkip", { card: message.id });
					Promise.resolve(run).catch((err) => error("Demoralizing Charge failed.", err));
				});
			}
		});
	}
});

export const _test = { onCommanderMessage, start, onStrike, maybeFinish, rollSave, tactics, penaltyFor, savesFrom };
