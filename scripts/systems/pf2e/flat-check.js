import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { waitForDice } from "../../core/dice.js";
import { nameForPlayers, itemBySlug } from "./card.js";
import { feetBetween } from "./reactive-strike.js";
import { sysId } from "./sys.js";

/**
 * Rule 12 (docs/pf2e-rules.md): flat checks, replacing the "PF2e Flat Check" module (owner, Q185–Q195, as
 * recommended). On the active GM's client, after the roll's dice:
 * - When: a Strike or spell attack roll; a spell actually cast (its card has flags.pf2e.casting; a spell with
 *   an attack roll waits for that roll); a skill action with the attack trait (Shove, Trip, Grapple...);
 *   an action or consumable with the manipulate trait used while Grabbed. Never on a reroll.
 * - Attacker: Dazzled (targets concealed, DC 5), Blinded (targets hidden, DC 11), Grabbed (manipulate, DC 5),
 *   Stupefied N (spells, DC 5 + N). Grabbed and Stupefied need no target; the others only with one.
 * - Target: Concealed DC 5; Hidden, Invisible, Undetected, Unnoticed DC 11. An area or aura: no target checks.
 * - The DC per target is the highest that applies (one flat check, as the rules say); one d20 per target.
 * - Blind-Fight, Keen Eyes / Liminal Fetchling, Sure Strike / True Strike, See the Unseen adjust it.
 * - Everyone sees the card, except when a target is a hidden token or Hidden / Invisible / Undetected /
 *   Unnoticed, the attacker's token is hidden, or the roll was secret: then the GM only (the 3D dice too).
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.FlatCheck.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const FLAG = "flatCheck";
const SEEN = new Set(); // message ids handled
const HIDDEN_LIKE = ["hidden", "invisible", "undetected", "unnoticed"];
const ATTACHED = "flatCheckLines";

/*
 * v0.90.1 (owner: "Automation needs to be concealment aware, waiting for the flat check"): the flat check of an
 * attack is known to the other automations. pending: message id → Promise<{ any, failed: Set<target token uuid>,
 * self }>. Registered at once (before the dice), resolved after the flat check's own dice.
 */
const pending = new Map();

/**
 * Did this message's flat check fail (for this target, or any)? Waits for it; false when there is none
 * (Flat Checks off, nothing concealed). A failed flat check: the attack / spell / action is lost (a miss).
 */
export async function flatCheckFailed(message, targetUuid = null) {
	const p = pending.get(message?.id ?? message);
	if (!p) return false;
	const r = await p.catch(() => null);
	if (!r) return false;
	return r.self || (targetUuid ? r.failed.has(targetUuid) : r.any);
}

const traitsOf = (item) => {
	const t = item?.system?.traits?.value ?? item?.traits ?? [];
	return new Set(t instanceof Set ? [...t] : Array.isArray(t) ? t : []);
};
const has = (actor, slug) => !!(actor?.hasCondition?.(slug) ?? (actor?.itemTypes?.condition ?? []).some((c) => c.slug === slug));
const valueOf = (actor, slug) => {
	const c = actor?.getCondition?.(slug) ?? (actor?.itemTypes?.condition ?? []).find((x) => x.slug === slug);
	return Number(c?.value ?? c?.system?.value?.value ?? 1) || 1;
};
const hasEffect = (actor, slugs) => (actor?.itemTypes?.effect ?? []).some((e) => slugs.includes(e.slug ?? e.system?.slug));
const hasFeat = (actor, slug, name) => !!itemBySlug(actor, [slug], name);
const cellsOf = (doc) => {
	const size = canvas.grid?.size ?? 100;
	const x0 = Math.round(doc.x / size), y0 = Math.round(doc.y / size);
	return { x0, y0, x1: x0 + Math.max(1, Math.round(doc.width ?? 1)) - 1, y1: y0 + Math.max(1, Math.round(doc.height ?? 1)) - 1 };
};

/* -------------------------------------------- */
/*  What a message is                           */
/* -------------------------------------------- */

/**
 * The flat-check case of a chat message, or null: { kind: "strike"|"spell"|"action", item, targets (token docs), area }.
 */
export function caseOf(message) {
	const flags = message?.flags?.[sysId()] ?? {};
	const context = flags.context ?? null;
	const item = message?.item ?? null;
	if (context?.isReroll) return null;
	const type = context?.type;
	const options = context?.options ?? [];
	const ctxTargets = () => (context?.target?.token ? [fromUuidSync(context.target.token)].filter(Boolean) : []);
	if (type === "attack-roll") return { kind: "strike", item, targets: ctxTargets(), area: false };
	if (type === "spell-attack-roll") return { kind: "spell", item, targets: ctxTargets(), area: false };
	if (type === "skill-check") {
		const traits = (context.traits ?? []).map((t) => t?.name ?? t);
		const attack = traits.includes("attack") || options.includes("attack") || options.includes("trait:attack") || options.includes("item:trait:attack");
		return attack ? { kind: "action", item, targets: ctxTargets(), area: false, traits } : null;
	}
	if (context || message.rolls?.length) return null; // damage, saves, other checks
	// A spell actually cast (not only posted): its card carries flags.pf2e.casting.
	if (flags.casting && item?.type === "spell") {
		const traits = traitsOf(item);
		if (traits.has("attack")) return null; // its attack roll is the moment
		const area = !!item.system?.area || traits.has("aura") || !!item.system?.area?.type;
		return { kind: "spell", item, targets: area ? [] : messageTargets(message), area };
	}
	// An action or consumable with the manipulate trait (Grabbed), not a passive one.
	if (["action", "consumable"].includes(item?.type) && traitsOf(item).has("manipulate") && item.system?.actionType?.value !== "passive") {
		return { kind: "manipulate", item, targets: [], area: false };
	}
	return null;
}

/** A spell card's targets: Target Helper's, else the caster's user's targets at the time. */
function messageTargets(message) {
	const helper = message.flags?.["pf2e-toolbelt"]?.targetHelper?.targets;
	if (Array.isArray(helper) && helper.length) return helper.map((u) => fromUuidSync(u)).filter(Boolean);
	const user = game.users.get(message.author?.id ?? message.author);
	return [...(user?.targets ?? [])].map((t) => t.document ?? t).filter(Boolean);
}

/* -------------------------------------------- */
/*  The DC                                      */
/* -------------------------------------------- */

/** The attacker's own flat check (no target needed): { dc, why } or null. */
export function attackerCheck(actor, found, { ignoreGrabbed = false } = {}) {
	const list = [];
	const traits = found.kind === "action" ? new Set(found.traits ?? []) : traitsOf(found.item);
	if (!ignoreGrabbed && has(actor, "grabbed") && traits.has("manipulate")) list.push({ dc: 5, why: "grabbed" });
	const spell = found.item?.type === "spell" || found.kind === "spell";
	if (spell && has(actor, "stupefied")) {
		const n = valueOf(actor, "stupefied");
		list.push({ dc: 5 + n, why: "stupefied", value: n });
	}
	return list.sort((a, b) => b.dc - a.dc)[0] ?? null;
}

/** The flat check against one target: { dc, why } or null (target state, attacker's senses, feats, effects). */
export function targetCheck(attackerDoc, targetDoc, { ignoreConcealed = false } = {}) {
	const me = attackerDoc?.actor, them = targetDoc?.actor;
	if (!them) return null;
	let state = null;
	if (HIDDEN_LIKE.some((s) => has(them, s))) state = HIDDEN_LIKE.find((s) => has(them, s));
	else if (has(them, "concealed")) state = "concealed";
	// The attacker's senses.
	if (has(me, "blinded") && !["undetected", "unnoticed"].includes(state)) state = state === "invisible" ? state : "hidden";
	else if (has(me, "dazzled") && !state) state = "concealed";
	if (!state) return null;
	// See the Unseen: invisible counts as concealed.
	if (state === "invisible" && hasEffect(me, ["spell-effect-see-the-unseen", "spell-effect-see-invisibility"])) state = "concealed";
	// Sure Strike / True Strike: no flat check for concealed or hidden.
	if (["concealed", "hidden", "invisible"].includes(state) && hasEffect(me, ["spell-effect-sure-strike", "spell-effect-true-strike"])) return null;
	if (state === "concealed" && ignoreConcealed) return null;
	const blindFight = hasFeat(me, "blind-fight", /^Blind-Fight$/i);
	const keen = hasFeat(me, "keen-eyes", /^Keen Eyes$/i) || hasFeat(me, "liminal-fetchling", /^Liminal Fetchling$/i);
	if (blindFight) {
		if (state === "concealed") return null;
		if (["hidden", "invisible"].includes(state)) return { dc: 5, why: state };
		// Undetected, adjacent and not of a higher level: only hidden to them.
		const adjacent = feetBetween(cellsOf(attackerDoc), cellsOf(targetDoc)) <= 5;
		if (adjacent && (Number(them.level) || 0) <= (Number(me?.level) || 0)) return { dc: 5, why: state };
	}
	if (keen) {
		if (state === "concealed") return { dc: 3, why: state };
		if (["hidden", "invisible"].includes(state)) return { dc: 9, why: state };
	}
	return { dc: state === "concealed" ? 5 : 11, why: state };
}

/* -------------------------------------------- */
/*  The card                                    */
/* -------------------------------------------- */

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);

async function onMessage(feature, message) {
	if (!game.user.isActiveGM || SEEN.has(message.id)) return;
	if (message.getFlag?.(MODULE_ID, FLAG)) return;
	const found = caseOf(message);
	if (!found) return;
	SEEN.add(message.id);
	const attackerDoc = message.token ?? message.actor?.getActiveTokens?.()?.[0]?.document ?? null;
	const actor = message.actor ?? attackerDoc?.actor;
	if (!actor) return;
	const opts = { ignoreConcealed: !!feature.get("ignoreConcealed"), ignoreGrabbed: !!feature.get("ignoreGrabbed") };
	const own = attackerCheck(actor, found, opts);
	const targets = (found.area ? [] : found.targets).filter((t) => t && t !== attackerDoc && t.id !== attackerDoc?.id);
	const rows = [];
	for (const t of targets) {
		const tc = attackerDoc ? targetCheck(attackerDoc, t, opts) : null;
		const best = [tc, own].filter(Boolean).sort((a, b) => b.dc - a.dc)[0];
		if (best) rows.push({ target: t, ...best });
	}
	if (!targets.length && own) rows.push({ target: null, ...own });
	if (!rows.length) return;
	let settle;
	pending.set(message.id, new Promise((res) => { settle = res; }));
	setTimeout(() => pending.delete(message.id), 120000);
	const outcome = { any: false, failed: new Set(), self: false };
	try {
	await waitForDice(message.id);
	// Who may see it.
	const secret = !!message.blind || (message.whisper?.length ?? 0) > 0 || !!attackerDoc?.hidden
		|| rows.some((r) => r.target?.hidden || HIDDEN_LIKE.includes(r.why));
	const hideValue = !!feature.get("hideValue");
	const rolls = [];
	const lines = [];
	for (const r of rows) {
		const roll = await new Roll("1d20").evaluate();
		rolls.push(roll);
		const ok = roll.total >= r.dc;
		if (!ok) { outcome.any = true; if (r.target) outcome.failed.add(r.target.uuid); else outcome.self = true; }
		const whyText = r.why === "stupefied" ? L("Why.stupefied", { value: r.value }) : L(`Why.${r.why}`);
		// v0.51.1 (owner): one line per target, the die and a green or red background; the target's name only
		// when there are several.
		const who = r.target && rows.length > 1 ? `${esc(secret ? r.target.name : nameForPlayers(r.target, L("ACreature")))}: ` : "";
		const die = hideValue ? `<i class="fa-solid ${ok ? "fa-check" : "fa-xmark"}"></i>` : roll.total;
		lines.push(`<div class="lucd20-fc-line ${ok ? "lucd20-fc-ok" : "lucd20-fc-fail"}"><span class="lucd20-fc-die">${die}</span><span>${who}${esc(L("Line", { dc: r.dc, why: whyText }))}</span></div>`);
	}
	const name = secret ? (attackerDoc?.name ?? actor.name) : nameForPlayers(attackerDoc, actor.name);
	const html = `<div class="lucd20-pf2e-card lucd20-fc-card">${lines.join("")}</div>`;
	// v0.90.1 (owner: "Concealment should be attached to the message that triggered them"): when everyone may see
	// it, the lines go into the triggering message's card (its flag, drawn there); the flat check's own message
	// (for the 3D dice) is then hidden from the log. Secret: as before, a GM-only message.
	const attach = !secret && !!message.setFlag && feature.get("attach") !== false;
	const fc = await ChatMessage.create({
		content: html,
		speaker: { alias: name },
		rolls,
		sound: null,
		// GM only: the 3D dice follow the message's whisper, so players see neither.
		...(secret ? { whisper: gmIds(), blind: true } : {}),
		flags: { [MODULE_ID]: { [FLAG]: { source: message.id, attached: attach } } }
	});
	if (attach) await message.setFlag(MODULE_ID, ATTACHED, lines.join("")).catch((err) => error("Flat check: attaching failed.", err));
	if (fc?.id) await waitForDice(fc.id);
	} finally {
		settle(outcome);
	}
}

/** Every client: the attached lines in the triggering card; the flat check's own message hidden. */
function onRender(message, html) {
	const root = html instanceof HTMLElement ? html : html?.[0];
	if (!root) return;
	const fc = message.getFlag?.(MODULE_ID, FLAG);
	if (fc?.attached) { (root.closest?.(".chat-message") ?? root).classList.add("lucd20-fc-attached-source"); return; }
	const lines = message.getFlag?.(MODULE_ID, ATTACHED);
	if (!lines || root.querySelector(".lucd20-fc-inline")) return;
	const box = document.createElement("div");
	box.className = "lucd20-pf2e-card lucd20-fc-card lucd20-fc-inline";
	box.innerHTML = lines;
	const content = root.querySelector(".message-content") ?? root;
	const anchor = content.querySelector(".card-buttons, .message-buttons");
	if (anchor) anchor.before(box); else content.append(box);
}

defineFeature({
	id: "pf2eFlatCheck",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,
	settings: {
		ignoreConcealed: { kind: "boolean", default: false, scope: "world" },
		ignoreGrabbed: { kind: "boolean", default: false, scope: "world" },
		hideValue: { kind: "boolean", default: false, scope: "world" },
		attach: { kind: "boolean", default: true, scope: "world" }
	},

	enable(feature) {
		feature.on("createChatMessage", (message) => {
			onMessage(feature, message).catch((err) => error("Flat check failed.", err));
		});
		feature.on("renderChatMessageHTML", onRender);
	}
});

export const _test = { caseOf, attackerCheck, targetCheck, onMessage, SEEN, pending, onRender };
