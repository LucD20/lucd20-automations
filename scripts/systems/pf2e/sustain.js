import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { onTurns } from "./rules.js";
import { nameForPlayers } from "./card.js";
import { sysId } from "./sys.js";

/**
 * Merge 3 (docs/pf2e-rules.md §14): sustained spells, replacing "PF2e Sustain Reminder" (owner, Q202–Q206):
 * - A sustained spell actually cast (flags.pf2e.casting): an effect "Sustaining: X" on the caster, one per
 *   cast, lasting the spell's limit ("1 minute" = 10 rounds) or until it ends.
 * - The start of the caster's turn: a compact card, one line per spell, Sustain and End (to the caster's
 *   players and the GM; the GM only for a hidden token). The limit reached: the effect ends, one line says so.
 * - The end of the caster's turn, a spell not sustained: "Was X sustained?" Yes / No (owner, Q205: ask before
 *   removing). No ends it. Using the Sustain action from the sheet sustains the only spell waiting.
 * - v0.75.1 (owner): a second cast of a spell already being sustained keeps both effects and posts one line
 *   "X: duplicate effect?" Yes (the new effect goes, nothing else said) / No (both kept).
 * - v0.76.1 (owner): sustaining Earth's Bile (the Sustain button, or the Sustain action from the sheet) posts
 *   its spell card again at the cast rank, so its effect can be used again. Not the end-of-turn "Yes" (that
 *   only says it was sustained earlier). The card carries our flag, so it is not taken for a new cast.
 * The cards go once every line is answered. On the active GM's client.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.Sustain.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const FLAG = "sustain";
const CARD = "sustainCard";
const UNIT_ROUNDS = { round: 1, minute: 10, hour: 600, day: 14400 };
const REPOST = "sustainRepost";
/** Spells whose card is posted again when sustained (owner: "for now, just that one"). */
const REPOST_SLUGS = new Set(["earths-bile"]);
const REPOST_NAMES = /^earth['’]?s bile$/i;

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);
const ownersOf = (actor) => (actor?.hasPlayerOwner ? game.users.filter((u) => !u.isGM && u.active && actor.testUserPermission?.(u, "OWNER")).map((u) => u.id) : []);

/** A spell's limit in rounds ("1 minute" → 10), or null (no limit). */
export function limitRounds(text) {
	const m = String(text ?? "").toLowerCase().match(/(\d+)\s*(round|minute|hour|day)/);
	return m ? Number(m[1]) * UNIT_ROUNDS[m[2]] : null;
}

const sustained = (actor) => (actor?.itemTypes?.effect ?? []).filter((e) => e.getFlag?.(MODULE_ID, FLAG));

/** A sustained spell was cast: its effect on the caster. */
async function onCast(message) {
	const spell = message.item;
	if (message.flags?.[MODULE_ID]?.[REPOST]) return; // our own repost of a sustained spell
	if (!message.flags?.[sysId()]?.casting || spell?.type !== "spell" || !spell.system?.duration?.sustained) return;
	const actor = message.actor;
	if (!actor) return;
	const limit = limitRounds(spell.system.duration.value);
	const round = game.combat?.started ? game.combat.round : null;
	const slug = `sustaining-${spell.slug ?? spell.system?.slug ?? "spell"}`;
	const already = sustained(actor).some((e) => (e.slug ?? e.system?.slug) === slug);
	const [created] = await actor.createEmbeddedDocuments("Item", [{
		type: "effect",
		name: L("Effect", { spell: spell.name }),
		img: spell.img,
		system: {
			slug,
			description: { value: spell.system?.description?.value ?? "" },
			duration: limit ? { value: limit, unit: "rounds", expiry: "turn-start", sustained: true } : { value: -1, unit: "unlimited", expiry: null, sustained: true },
			level: { value: message.flags?.[sysId()]?.origin?.castRank ?? spell.rank ?? 1 },
			tokenIcon: { show: true }
		},
		// sustained: this turn (the turn it was cast needs no Sustain).
		flags: { [MODULE_ID]: { [FLAG]: { spell: spell.uuid, name: spell.name, ends: limit && round !== null ? round + limit : null, sustained: true } } }
	}]);
	if (already && created) {
		const token = message.token ?? actor.getActiveTokens?.()?.[0]?.document ?? null;
		await postCard({ actor, token }, [created], "dup");
	}
}

/** The Sustain action used from the sheet: the only spell waiting is sustained. */
async function onSustainAction(message) {
	const item = message.item;
	if ((item?.slug ?? item?.system?.slug) !== "sustain" || item?.type !== "action") return;
	const waiting = sustained(message.actor).filter((e) => !e.getFlag(MODULE_ID, FLAG).sustained);
	if (waiting.length === 1) await markSustained(waiting[0], { repost: true });
}

async function markSustained(effect, { repost = false } = {}) {
	await effect.setFlag(MODULE_ID, FLAG, { ...effect.getFlag(MODULE_ID, FLAG), sustained: true });
	await dropLine(effect.uuid);
	if (repost) await repostSpell(effect).catch((err) => error("Sustain: posting the spell again failed.", err));
}

export function repostsWhenSustained(spell) {
	return REPOST_SLUGS.has(spell?.slug ?? spell?.system?.slug ?? "") || REPOST_NAMES.test(String(spell?.name ?? "").trim());
}

/** The spell's card again, at the rank it was cast; private like the cast when the caster's token is hidden. */
async function repostSpell(effect) {
	const data = effect.getFlag(MODULE_ID, FLAG);
	const spell = data?.spell ? fromUuidSync(data.spell) : null;
	if (!spell || !repostsWhenSustained(spell) || typeof spell.toMessage !== "function") return;
	const actor = effect.parent;
	const token = actor?.getActiveTokens?.()?.[0]?.document ?? null;
	const rollMode = token?.hidden ? "gmroll" : "publicroll";
	const castRank = Number(effect.system?.level?.value) || spell.rank;
	const message = await spell.toMessage(null, { create: false, data: { castRank }, rollMode });
	if (!message) return;
	const source = typeof message.toObject === "function" ? message.toObject() : message;
	foundry.utils.setProperty(source, `flags.${MODULE_ID}.${REPOST}`, true);
	if (rollMode === "gmroll") source.whisper = gmIds();
	await ChatMessage.create(source, { rollMode });
}

async function endSpell(effect, why) {
	const actor = effect.parent;
	const token = actor?.getActiveTokens?.()?.[0]?.document ?? null;
	const name = effect.getFlag(MODULE_ID, FLAG)?.name ?? effect.name;
	await effect.delete();
	await dropLine(effect.uuid);
	await ChatMessage.create({
		content: `<p class="lucd20-rule-note"><i class="fa-solid fa-hourglass-end"></i> ${L(why, { name: `<strong>${esc(name)}</strong>`, caster: esc(nameForPlayers(token, actor?.name ?? "")) })}</p>`,
		speaker: { alias: localize("LUCD20.PF2eRules.Speaker") },
		...privacy(actor, token)
	});
}

/** The caster's players and the GMs; the GMs only for a hidden token or an NPC. */
function privacy(actor, token) {
	const gms = gmIds();
	if (token?.hidden || !actor?.hasPlayerOwner) return { whisper: gms };
	return { whisper: [...new Set([...ownersOf(actor), ...gms])] };
}

/* -------------------------------------------- */
/*  The cards                                   */
/* -------------------------------------------- */

function row(effect, kind) {
	const data = effect.getFlag(MODULE_ID, FLAG);
	const buttons = kind === "ask"
		? [["yes", "fa-check", L("Yes")], ["no", "fa-xmark", L("No")]]
		: kind === "dup"
			? [["dupYes", "fa-check", L("Yes")], ["dupNo", "fa-xmark", L("No")]]
			: [["sustain", "fa-hourglass-half", L("SustainButton")], ["end", "fa-xmark", L("End")]];
	const text = kind === "ask" ? L("Ask", { name: data.name }) : kind === "dup" ? L("Duplicate", { name: data.name }) : data.name;
	return `<div class="lucd20-sus-row" data-lucd20-sus-row="${esc(effect.uuid)}"><img src="${esc(effect.img)}" alt="" /><span>${esc(text)}</span>${buttons.map(([v, icon, label]) => `<button type="button" data-lucd20-sus="${v}" data-effect="${esc(effect.uuid)}"><i class="fa-solid ${icon}"></i> ${esc(label)}</button>`).join("")}</div>`;
}

async function postCard(combatant, effects, kind) {
	if (!effects.length) return;
	const token = combatant.token ?? combatant.actor?.getActiveTokens?.()?.[0]?.document;
	await ChatMessage.create({
		content: `<div class="lucd20-pf2e-card lucd20-sus-card">${effects.map((e) => row(e, kind)).join("")}</div>`,
		speaker: { alias: token?.name ?? combatant.actor.name },
		...privacy(combatant.actor, token),
		flags: { [MODULE_ID]: { [CARD]: { kind, effects: effects.map((e) => e.uuid) } } }
	});
}

/** A line answered: it goes; a card with no line left goes too. */
async function dropLine(uuid) {
	for (const m of game.messages.filter((x) => x.getFlag?.(MODULE_ID, CARD)?.effects?.includes(uuid))) {
		const data = m.getFlag(MODULE_ID, CARD);
		const left = data.effects.filter((u) => u !== uuid);
		if (!left.length) { await m.delete(); continue; }
		const content = m.content.replace(new RegExp(`<div class="lucd20-sus-row" data-lucd20-sus-row="${uuid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">[\\s\\S]*?</div>`), "");
		await m.update({ content, [`flags.${MODULE_ID}.${CARD}.effects`]: left });
	}
}

async function onTurnStart(combatant) {
	const effects = sustained(combatant.actor);
	const live = [];
	for (const e of effects) {
		await dropLine(e.uuid); // an earlier card's line, unanswered, goes: this turn's card takes over
		const data = e.getFlag(MODULE_ID, FLAG);
		if (data.ends !== null && data.ends !== undefined && (game.combat?.round ?? 0) >= data.ends) { await endSpell(e, "Expired"); continue; }
		await e.setFlag(MODULE_ID, FLAG, { ...data, sustained: false });
		live.push(e);
	}
	await postCard(combatant, live, "remind");
}

async function onTurnEnd(combatant) {
	const waiting = sustained(combatant.actor).filter((e) => !e.getFlag(MODULE_ID, FLAG).sustained);
	// The turn's reminder goes: its question takes over.
	for (const e of waiting) await dropLine(e.uuid);
	await postCard(combatant, waiting, "ask");
}

/** GM: a button. */
async function answer({ effect, value }, senderId) {
	const fx = fromUuidSync(effect);
	if (!fx) return dropLine(effect);
	const sender = game.users.get(senderId);
	if (sender && !sender.isGM && !fx.parent?.testUserPermission?.(sender, "OWNER")) return false;
	if (value === "sustain") return markSustained(fx, { repost: true });
	if (value === "yes") return markSustained(fx);
	if (value === "end") return endSpell(fx, "Ended");
	if (value === "no") return endSpell(fx, "NotSustained");
	if (value === "dupYes") { await fx.delete(); return dropLine(effect); }
	if (value === "dupNo") return dropLine(effect);
	return false;
}

defineFeature({
	id: "pf2eSustain",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,

	init(feature) {
		onGMRequest("pf2eSustain.answer", (payload, senderId) => (feature.active ? answer(payload, senderId) : false));
	},

	enable(feature) {
		feature.on("createChatMessage", (message) => {
			if (!game.user.isActiveGM) return;
			Promise.all([onCast(message), onSustainAction(message)]).catch((err) => error("Sustain failed.", err));
		});
		onTurns(feature, { start: onTurnStart, end: onTurnEnd });
		feature.on("renderChatMessageHTML", (message, html) => {
			if (!message.getFlag?.(MODULE_ID, CARD)) return;
			for (const button of html.querySelectorAll?.("[data-lucd20-sus]") ?? []) {
				button.addEventListener("click", (event) => {
					event.preventDefault();
					if (!feature.active) return;
					button.disabled = true;
					executeAsGM("pf2eSustain.answer", { effect: button.dataset.effect, value: button.dataset.lucd20Sus }).catch((err) => error("Sustain failed.", err));
				});
			}
		});
	}
});

export const _test = { limitRounds, onCast, onSustainAction, onTurnStart, onTurnEnd, answer };
