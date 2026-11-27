import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { waitForDice } from "../../core/dice.js";
import { pf2eCard, wireOpen, sourceUuid, compactCard, nameForPlayers } from "./card.js";
import { sysId, sysPack } from "./sys.js";

/**
 * Rule 32 (docs/pf2e-rules.md): Aid (basic reaction). Trigger: an ally is about to use an action that requires
 * a skill check or attack roll; requirement: you prepared to help (usually an action on your turn). A check
 * decided by the GM, typically DC 15: critical success +2 circumstance to the ally's check (+3 master, +4
 * legendary), success +1, critical failure −1. (PLAN §29, N2.)
 *
 * - PF2e's Aid action posted to chat (the reaction; the reaction tracker spends it) → a card to the aider's
 *   players and the GM: the ally (the aider's one targeted ally, else a button per ally on the scene), a skill
 *   (the aider's best preselected; Perception too), the DC (15, editable), Roll / Cancel.
 * - Roll: that skill against the DC, tagged `action:aid`. Any other skill check or attack roll the aider
 *   makes within 2 minutes counts instead (to Aid a Strike with a Strike), its degree worked out against the DC.
 * - The result (GM's client, after the dice): PF2e's "Effect: Aid" on the ally with the bonus preset (its
 *   choice skipped); PF2e removes it after the ally's next attack roll or skill check, or at the start of the
 *   ally's next turn. A failure: no effect. A line says what happened.
 * The rank for +3 / +4: the skill's rank, or for an attack roll the weapon category's (verify) proficiency.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.Aid.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const FLAG = "aid";
const AID_ID = "HCl3pzVefiv9ZKQW"; // actionspf2e: Aid
const EFFECT_UUID = "Compendium.pf2e.other-effects.Item.AHMUpMbaVkZ5A1KX"; // Effect: Aid
const WINDOW_MS = 120000;
const TAG = "action:aid";
const pending = new Map(); // aider actor uuid → { card, until }

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);
const ownersOf = (actor) => (actor?.hasPlayerOwner ? game.users.filter((u) => !u.isGM && u.active && actor.testUserPermission?.(u, "OWNER")).map((u) => u.id) : []);
const slugOf = (item) => item?.slug ?? item?.system?.slug ?? "";

/** Is this message PF2e's Aid action (its card, not a roll)? */
export function isAidAction(message) {
	const item = message?.item;
	if (!item || message.flags?.[sysId()]?.context) return false;
	return slugOf(item) === "aid" || String(sourceUuid(item) ?? "").endsWith(AID_ID) || /^aid$/i.test(item.name ?? "");
}

/** Degree of success 0–3: by 10 or more, and the natural 20 / 1 step. */
export function degreeOf(total, die, dc) {
	const diff = Number(total) - Number(dc);
	let d = diff >= 10 ? 3 : diff >= 0 ? 2 : diff > -10 ? 1 : 0;
	if (die === 20) d++;
	else if (die === 1) d--;
	return Math.max(0, Math.min(3, d));
}

/** The bonus for a degree and the check's rank (0 untrained … 4 legendary). */
export function bonusFor(degree, rank) {
	if (degree === 3) return rank >= 4 ? 4 : rank >= 3 ? 3 : 2;
	if (degree === 2) return 1;
	if (degree === 0) return -1;
	return 0;
}

const OUTCOMES = ["criticalFailure", "failure", "success", "criticalSuccess"];

/** The aider's skills (and Perception): [{ slug, label, mod, rank }]. */
function skillsOf(actor) {
	const out = [];
	const per = actor?.perception ?? actor?.skills?.perception;
	if (per) out.push({ slug: "perception", label: per.label ?? localize("LUCD20.PF2eRules.Aid.Perception"), mod: Number(per.mod) || 0, rank: Number(per.rank) || 0 });
	for (const [slug, s] of Object.entries(actor?.skills ?? {})) {
		if (slug === "perception" || !s) continue;
		out.push({ slug, label: s.label ?? slug, mod: Number(s.mod) || 0, rank: Number(s.rank) || 0 });
	}
	return out;
}

/** Allies of the aider on the scene (same disposition, not itself). */
function alliesOf(token) {
	return (canvas.tokens?.placeables ?? []).filter((t) => t.document !== token && t.actor && t.document.disposition === token.disposition && !t.document.hidden);
}

function cardBody(data, aider) {
	if (!data.ally) return `<p>${L("WhichAlly")}</p>`;
	const ally = fromUuidSync(data.ally);
	const skills = skillsOf(aider?.actor);
	const best = data.skill ?? skills.slice().sort((a, b) => b.mod - a.mod)[0]?.slug;
	const options = skills.map((s) => `<option value="${esc(s.slug)}"${s.slug === best ? " selected" : ""}>${esc(s.label)} (${s.mod >= 0 ? "+" : ""}${s.mod})</option>`).join("");
	return `<p>${L("Line", { ally: `<strong>${esc(nameForPlayers(ally, L("AnAlly")))}</strong>` })}</p>
	<div class="lucd20-aid-row"><select data-lucd20-aid-skill>${options}</select><label>${L("DC")} <input type="number" data-lucd20-aid-dc value="${Number(data.dc) || 15}" min="0" max="60" /></label></div>
	<p class="lucd20-aid-hint">${L("OrAny")}</p>`;
}

function cardButtons(data, aider) {
	if (!data.ally) {
		return [...alliesOf(aider).slice(0, 8).map((t) => ({ data: "lucd20-aid", value: `ally:${t.document.uuid}`, icon: "fa-user", label: nameForPlayers(t.document, L("AnAlly")) })),
			{ data: "lucd20-aid", value: "cancel", icon: "fa-xmark", label: L("Cancel") }];
	}
	return [{ data: "lucd20-aid", value: "roll", icon: "fa-dice-d20", label: L("Roll") }, { data: "lucd20-aid", value: "cancel", icon: "fa-xmark", label: L("Cancel") }];
}

const render = (data, aider) => pf2eCard({ img: data.img, title: data.title, glyph: "R", who: aider?.name ?? "", open: data.open, extraClass: "lucd20-aid-card", body: cardBody(data, aider), buttons: cardButtons(data, aider) });

/** Active GM's client: the Aid action was posted. */
export async function onAidAction(message) {
	if (!game.user.isActiveGM || !isAidAction(message)) return;
	const aider = message.token ?? message.actor?.getActiveTokens?.()?.[0]?.document ?? null;
	if (!aider?.actor) return;
	// The aider's user's one targeted ally, if any.
	const author = game.users.get(message.author?.id ?? message.author);
	const targets = [...(author?.targets ?? [])].filter((t) => t.document !== aider && t.document?.disposition === aider.disposition);
	const item = message.item;
	const data = { aider: aider.uuid, ally: targets.length === 1 ? targets[0].document.uuid : null, dc: 15, img: item.img, title: item.name, open: sourceUuid(item) };
	const card = await ChatMessage.create({
		content: render(data, aider),
		speaker: ChatMessage.getSpeaker?.({ token: aider }) ?? { alias: aider.name },
		whisper: [...new Set([...ownersOf(aider.actor), ...gmIds()])],
		flags: { [MODULE_ID]: { [FLAG]: data } }
	});
	pending.set(aider.actor.uuid, { card: card.id, until: Date.now() + WINDOW_MS });
	return card;
}

/** A click on the card (the aider's owner or the GM). */
async function onClick(message, button, html) {
	const data = message.getFlag(MODULE_ID, FLAG);
	const aider = data ? fromUuidSync(data.aider) : null;
	if (!aider?.actor || data.done) return;
	if (!(game.user.isGM || aider.actor.isOwner)) return ui.notifications.warn(L("NotYours"));
	const value = button.dataset.lucd20Aid;
	if (value === "roll") {
		const slug = html.querySelector("[data-lucd20-aid-skill]")?.value;
		const dc = Number(html.querySelector("[data-lucd20-aid-dc]")?.value) || 15;
		await executeAsGM("pf2eAid.set", { card: message.id, skill: slug, dc });
		const stat = slug === "perception" ? (aider.actor.perception ?? aider.actor.skills?.perception) : aider.actor.skills?.[slug];
		// (verify) PF2e 8.7: Statistic#roll({ dc, extraRollOptions }).
		await stat?.roll?.({ dc: { value: dc }, extraRollOptions: [TAG], label: `${data.title}: ${stat.label ?? slug}` });
		return;
	}
	button.disabled = true;
	await executeAsGM("pf2eAid.set", { card: message.id, ...(value === "cancel" ? { cancel: true } : { ally: value.replace(/^ally:/, "") }) });
}

/** GM's client: the ally chosen, the skill and DC set, or cancelled. */
async function setCard({ card, ally, skill, dc, cancel }, senderId) {
	const m = game.messages.get(card);
	const data = m?.getFlag(MODULE_ID, FLAG);
	if (!data || data.done) return false;
	const aider = fromUuidSync(data.aider);
	const sender = game.users.get(senderId);
	if (sender && !sender.isGM && !aider?.actor?.testUserPermission?.(sender, "OWNER")) return false;
	if (cancel) {
		pending.delete(aider?.actor?.uuid);
		await m.delete();
		return true;
	}
	const next = { ...data, ...(ally ? { ally } : {}), ...(skill ? { skill } : {}), ...(dc ? { dc: Number(dc) } : {}) };
	await m.update({ content: render(next, aider), [`flags.${MODULE_ID}.${FLAG}`]: next });
	if (aider?.actor) pending.set(aider.actor.uuid, { card: m.id, until: Date.now() + WINDOW_MS });
	return true;
}

/** The rank of the check that was rolled. */
function rankOf(actor, context, message) {
	if (context.type === "attack-roll") {
		const item = message.item;
		// (verify) PF2e 8.7: actor.system.proficiencies.attacks[category].rank.
		return Number(actor?.system?.proficiencies?.attacks?.[item?.category]?.rank) || 0;
	}
	const domains = context.domains ?? [];
	const slug = domains.includes("perception") ? "perception" : Object.keys(actor?.skills ?? {}).find((s) => domains.includes(s));
	const stat = slug === "perception" ? (actor?.perception ?? actor?.skills?.perception) : actor?.skills?.[slug];
	return Number(stat?.rank) || 0;
}

const d20Of = (message) => {
	const roll = message.rolls?.[0];
	const die = roll?.dice?.find?.((d) => d.faces === 20) ?? roll?.terms?.find?.((t) => t.faces === 20);
	return Number(die?.total ?? die?.results?.find?.((r) => r.active !== false)?.result) || null;
};

/** Active GM's client: the aider's check (after its dice): the effect on the ally. */
export async function onCheck(message) {
	if (!game.user.isActiveGM || !pending.size) return;
	const context = message?.flags?.[sysId()]?.context;
	if (!["skill-check", "perception-check", "attack-roll"].includes(context?.type) || context.isReroll) return;
	const actor = message.actor ?? (context.origin?.actor ? fromUuidSync(context.origin.actor) : null);
	const p = actor ? pending.get(actor.uuid) : null;
	if (!p || p.until < Date.now()) return;
	const card = game.messages.get(p.card);
	const data = card?.getFlag(MODULE_ID, FLAG);
	if (!data || data.done || !data.ally) return;
	pending.delete(actor.uuid);
	await waitForDice(message.id);
	const dc = Number(data.dc) || 15;
	const own = (context.options ?? []).includes(TAG) && Number(context.dc?.value) === dc && OUTCOMES.includes(context.outcome);
	const degree = own ? OUTCOMES.indexOf(context.outcome) : degreeOf(message.rolls?.[0]?.total, d20Of(message), dc);
	const bonus = bonusFor(degree, rankOf(actor, context, message));
	const ally = fromUuidSync(data.ally), aider = fromUuidSync(data.aider);
	if (bonus && ally?.actor) await applyEffect(ally.actor, bonus, aider?.actor);
	const reveal = aider && !aider.hidden;
	const result = bonus > 0 ? `+${bonus}` : bonus < 0 ? `${bonus}` : L("NoEffect");
	await card.update({
		content: compactCard({ img: data.img, title: data.title, glyph: "R", who: reveal ? nameForPlayers(aider, L("ACreature")) : aider?.name, open: data.open, extraClass: "lucd20-aid-card", result: `${result} · ${nameForPlayers(ally, L("AnAlly"))}` }),
		[`flags.${MODULE_ID}.${FLAG}.done`]: true,
		...(reveal ? { whisper: [] } : {})
	});
	const key = bonus > 0 ? "Bonus" : bonus < 0 ? "Penalty" : "Nothing";
	await ChatMessage.create({
		content: `<p class="lucd20-rule-note"><i class="fa-solid fa-handshake-angle"></i> ${L(key, { ally: `<strong>${esc(nameForPlayers(ally, L("AnAlly")))}</strong>`, n: Math.abs(bonus) })}</p>`,
		speaker: { alias: localize("LUCD20.PF2eRules.Speaker") },
		whisper: reveal ? [] : gmIds()
	});
}

/** PF2e's Effect: Aid with its choice preset; our own copy if the compendium is missing. */
async function applyEffect(actor, bonus, aider) {
	try {
		let source = (await fromUuid(EFFECT_UUID).catch(() => null))?.toObject?.();
		if (!source) {
			const pack = sysPack("other-effects");
			source = (await pack?.getDocument?.(EFFECT_UUID.split(".").at(-1)).catch(() => null))?.toObject?.();
		}
		source ??= {
			type: "effect", name: L("EffectName"), img: "icons/skills/social/diplomacy-handshake.webp",
			system: { duration: { value: 1, unit: "rounds", expiry: "turn-start", sustained: false }, rules: [{ key: "FlatModifier", removeAfterRoll: true, selector: ["attack-roll", "skill-check"], type: "circumstance", value: "@item.flags.system.rulesSelections.aidBonus" }] }
		};
		foundry.utils.setProperty(source, "flags.system.rulesSelections.aidBonus", bonus);
		foundry.utils.setProperty(source, `flags.${MODULE_ID}.aid`, { by: aider?.uuid ?? null });
		await actor.createEmbeddedDocuments("Item", [source]);
	} catch (err) { error("Aid: the effect failed.", err); }
}

defineFeature({
	id: "pf2eAid",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,

	init(feature) {
		onGMRequest("pf2eAid.set", (payload, senderId) => (feature.active ? setCard(payload, senderId) : false));
	},

	enable(feature) {
		feature.on("createChatMessage", (message) => {
			onAidAction(message).catch((err) => error("Aid failed.", err));
			onCheck(message).catch((err) => error("Aid failed.", err));
		});
		feature.on("renderChatMessageHTML", (message, html) => {
			const data = message.getFlag?.(MODULE_ID, FLAG);
			if (!data) return;
			wireOpen(html);
			for (const b of html.querySelectorAll?.("[data-lucd20-aid]") ?? []) {
				if (data.done) { b.disabled = true; continue; }
				b.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					if (feature.active) onClick(message, b, html).catch((err) => error("Aid failed.", err));
				});
			}
			// Typing in the card mustn't open the action's entry.
			for (const el of html.querySelectorAll?.("[data-lucd20-aid-skill], [data-lucd20-aid-dc]") ?? []) el.addEventListener("click", (event) => event.stopPropagation());
		});
		feature.onCleanup(() => pending.clear());
	}
});

export const _test = { onAidAction, onCheck, setCard, onClick, pending, degreeOf, bonusFor, isAidAction };
