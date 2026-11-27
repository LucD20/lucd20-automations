import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { waitForDice } from "../../core/dice.js";
import { onTurns } from "./rules.js";
import { pf2eCard, wireOpen, sourceUuid, compactCard, nameForPlayers } from "./card.js";
import { sysId, sysPack } from "./sys.js";

/**
 * Rule 33 (docs/pf2e-rules.md): Albatross Curse (spell 2; occult, primal; misfortune; 30 ft, 1 creature,
 * 1 minute). You and allies within 30 feet of the target get +1 circumstance to attacks against it (PF2e's
 * "Spell Effect: Albatross Curse" does this, with its own predicate). The target can spend an action to Strike
 * the albatross, killing it, then attempts a Will save: critical success unaffected; success stupefied 1 for
 * 1 round; failure roll twice, keep the worse, on its next Will save (1 minute; critical failure 1 hour), after
 * which the albatross disappears. (PLAN §29, N3.)
 *
 * Active GM's client:
 * - The spell cast with one target: PF2e's spell effect on the target (unless it has it), the caster as its
 *   origin; a card to the target's players and the GM: "Strike the albatross".
 * - The button (the target's owner or the GM): the effect is removed, then that client rolls the target's Will
 *   save against the caster's spell DC. After its dice: stupefied 1 (removed at the start of the target's next
 *   turn), or PF2e's Failure / Critical Failure effect (roll twice, keep lower).
 * - The target's next Will save with that effect: after its dice, the effect goes (the albatross disappears).
 * (verify) PF2e 8.7: the spell's `spellcasting.statistic.dc`, `saves.will.roll({ dc, extraRollOptions })`.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.Albatross.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const SLUG = "albatross-curse";
const FLAG = "albatross";
const TAG = "lucd20-albatross";
const FX = {
	curse: "b8BZHeuz5jH8E2SG", // Spell Effect: Albatross Curse
	failure: "Y8OGpgAEgISpTwYd", // Spell Effect: Albatross Curse (Failure)
	criticalFailure: "jSvpjSGnIVBAuFDu" // Spell Effect: Albatross Curse (Critical Failure)
};
const CURSE_SLUGS = ["spell-effect-albatross-curse"];
const AFTER_SLUGS = ["spell-effect-albatross-curse-failure", "spell-effect-albatross-curse-critical-failure"];
const saving = new Map(); // target actor uuid → { card, caster }
const stupefied = new Map(); // target actor uuid → true: remove stupefied 1 at the start of its next turn

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);
const ownersOf = (actor) => (actor?.hasPlayerOwner ? game.users.filter((u) => !u.isGM && u.active && actor.testUserPermission?.(u, "OWNER")).map((u) => u.id) : []);
const slugOf = (item) => item?.slug ?? item?.system?.slug ?? "";
const matches = (e, slugs, ids) => slugs.includes(slugOf(e)) || ids.some((id) => String(sourceUuid(e) ?? "").endsWith(id));
const effectsOf = (actor, slugs) => {
	const ids = slugs === CURSE_SLUGS ? [FX.curse] : [FX.failure, FX.criticalFailure];
	return (actor?.itemTypes?.effect ?? []).filter((e) => matches(e, slugs, ids));
};

/** The spell DC of the cast. */
function dcOf(message) {
	const item = message.item;
	const dc = Number(item?.spellcasting?.statistic?.dc?.value ?? message.flags?.[sysId()]?.casting?.dc ?? message.actor?.attributes?.spellDC?.value ?? message.actor?.system?.attributes?.spellDC?.value);
	return dc || null;
}

/** The one creature the caster targeted (Foundry's targets of the author, else Toolbelt's list). */
function targetOf(message) {
	const author = game.users.get(message.author?.id ?? message.author);
	const mine = [...(author?.targets ?? [])].map((t) => t.document ?? t);
	if (mine.length === 1) return mine[0];
	const helper = message.flags?.["pf2e-toolbelt"]?.targetHelper?.targets ?? [];
	return helper.length === 1 ? fromUuidSync(helper[0]) : null;
}

async function effectSource(id) {
	const doc = await fromUuid(`Compendium.pf2e.spell-effects.Item.${id}`).catch(() => null)
		?? await sysPack("spell-effects")?.getDocument?.(id).catch(() => null);
	return doc?.toObject?.() ?? null;
}

async function addEffect(actor, id, { caster = null, token = null } = {}) {
	const source = await effectSource(id);
	if (!source) return null;
	if (caster) foundry.utils.setProperty(source, "system.context.origin", { actor: caster.uuid, token: token ?? null, item: null, spellcasting: null });
	foundry.utils.setProperty(source, `flags.${MODULE_ID}.${FLAG}`, { caster: caster?.uuid ?? null });
	return actor.createEmbeddedDocuments("Item", [source]).catch((err) => error("Albatross Curse: the effect failed.", err));
}

/** Active GM's client: the spell was cast. */
export async function onCast(message) {
	if (!game.user.isActiveGM) return;
	const item = message?.item;
	if (item?.type !== "spell" || slugOf(item) !== SLUG || message.flags?.[sysId()]?.context) return;
	const target = targetOf(message);
	const caster = message.actor;
	if (!target?.actor || !caster) return;
	if (!effectsOf(target.actor, CURSE_SLUGS).length) await addEffect(target.actor, FX.curse, { caster, token: message.token?.uuid ?? null });
	const dc = dcOf(message);
	const hidden = !!target.hidden;
	return ChatMessage.create({
		content: pf2eCard({
			img: item.img, title: item.name, glyph: "1", who: hidden ? target.name : nameForPlayers(target, L("ACreature")), open: sourceUuid(item), extraClass: "lucd20-alb-card",
			body: `<p>${L("Line", { target: `<strong>${esc(nameForPlayers(target, L("ACreature")))}</strong>`, dc: dc ?? "?" })}</p>`,
			buttons: [{ data: "lucd20-alb", value: "strike", icon: "fa-crow", label: L("Strike") }]
		}),
		speaker: { alias: localize("LUCD20.PF2eRules.Speaker") },
		whisper: [...new Set([...ownersOf(target.actor), ...gmIds()])],
		flags: { [MODULE_ID]: { [FLAG]: { target: target.uuid, caster: caster.uuid, dc, img: item.img, title: item.name, open: sourceUuid(item) } } }
	});
}

async function onClick(message) {
	const data = message.getFlag(MODULE_ID, FLAG);
	const target = data ? fromUuidSync(data.target) : null;
	if (!target?.actor || data.done) return;
	if (!(game.user.isGM || target.actor.isOwner)) return ui.notifications.warn(L("NotYours"));
	const ok = await executeAsGM("pf2eAlbatross.strike", { card: message.id }).catch((err) => { error("Albatross Curse failed.", err); return false; });
	if (!ok) return;
	await target.actor.saves?.will?.roll?.({ dc: data.dc ? { value: data.dc } : undefined, extraRollOptions: [TAG], label: `${data.title}: ${L("Save")}` });
}

/** GM's client: the albatross is struck: the curse goes, the save comes. */
async function strike({ card }, senderId) {
	const m = game.messages.get(card);
	const data = m?.getFlag(MODULE_ID, FLAG);
	if (!data || data.done) return false;
	const target = fromUuidSync(data.target);
	const sender = game.users.get(senderId);
	if (sender && !sender.isGM && !target?.actor?.testUserPermission?.(sender, "OWNER")) return false;
	const fx = effectsOf(target?.actor, CURSE_SLUGS);
	if (fx.length) await target.actor.deleteEmbeddedDocuments("Item", fx.map((e) => e.id)).catch(() => {});
	await m.update({
		content: compactCard({ img: data.img, title: data.title, glyph: "1", who: target?.hidden ? target?.name : nameForPlayers(target, L("ACreature")), open: data.open, extraClass: "lucd20-alb-card", result: L("Struck") }),
		[`flags.${MODULE_ID}.${FLAG}.done`]: true
	});
	if (target?.actor) saving.set(target.actor.uuid, { card, caster: data.caster, hidden: !!target.hidden });
	return true;
}

const isWill = (context) => context?.type === "saving-throw" && ((context.domains ?? []).includes("will") || (context.options ?? []).includes("check:statistic:will") || context.statistic === "will");

/** Active GM's client: Will saves (the albatross's, or the next one under a failure effect). */
export async function onSave(message) {
	if (!game.user.isActiveGM) return;
	const context = message?.flags?.[sysId()]?.context;
	if (!isWill(context) || context.isReroll) return;
	const actor = message.actor ?? (context.actor ? game.actors?.get(context.actor) : null);
	if (!actor) return;
	const name = `<strong>${esc(nameForPlayers(message.token ?? actor.getActiveTokens?.(false, true)?.[0], L("ACreature")))}</strong>`;
	const hidden = !!(message.token?.hidden);
	const line = (key) => ChatMessage.create({
		content: `<p class="lucd20-rule-note"><i class="fa-solid fa-crow"></i> ${L(key, { name })}</p>`,
		speaker: { alias: localize("LUCD20.PF2eRules.Speaker") },
		whisper: hidden || message.whisper?.length ? gmIds() : []
	});
	if ((context.options ?? []).includes(TAG)) {
		const p = saving.get(actor.uuid);
		if (!p) return;
		saving.delete(actor.uuid);
		await waitForDice(message.id);
		const caster = fromUuidSync(p.caster);
		if (context.outcome === "criticalSuccess") return line("Unaffected");
		if (context.outcome === "success") {
			await actor.increaseCondition?.("stupefied", { value: 1 });
			stupefied.set(actor.uuid, true);
			return line("Stupefied");
		}
		await addEffect(actor, context.outcome === "criticalFailure" ? FX.criticalFailure : FX.failure, { caster });
		return line(context.outcome === "criticalFailure" ? "CursedHour" : "Cursed");
	}
	// Its next Will save under the Failure effect: the albatross disappears.
	const after = effectsOf(actor, AFTER_SLUGS);
	if (!after.length) return;
	await waitForDice(message.id);
	await actor.deleteEmbeddedDocuments("Item", after.map((e) => e.id)).catch(() => {});
	return line("Gone");
}

/** The start of the target's next turn: stupefied 1 from the albatross ends. */
async function onTurnStart(combatant) {
	const actor = combatant?.actor;
	if (!actor || !stupefied.has(actor.uuid)) return;
	stupefied.delete(actor.uuid);
	await actor.decreaseCondition?.("stupefied").catch?.(() => {});
}

defineFeature({
	id: "pf2eAlbatrossCurse",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,

	init(feature) {
		onGMRequest("pf2eAlbatross.strike", (payload, senderId) => (feature.active ? strike(payload, senderId) : false));
	},

	enable(feature) {
		feature.on("createChatMessage", (message) => {
			onCast(message).catch((err) => error("Albatross Curse failed.", err));
			onSave(message).catch((err) => error("Albatross Curse failed.", err));
		});
		onTurns(feature, { start: (combatant) => { if (game.user.isActiveGM) onTurnStart(combatant).catch((err) => error("Albatross Curse failed.", err)); } });
		feature.on("renderChatMessageHTML", (message, html) => {
			const data = message.getFlag?.(MODULE_ID, FLAG);
			if (!data) return;
			wireOpen(html);
			for (const b of html.querySelectorAll?.("[data-lucd20-alb]") ?? []) {
				if (data.done) { b.disabled = true; continue; }
				b.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					b.disabled = true;
					if (feature.active) onClick(message).catch((err) => error("Albatross Curse failed.", err));
				});
			}
		});
		feature.onCleanup(() => { saving.clear(); stupefied.clear(); });
	}
});

export const _test = { onCast, onSave, strike, onTurnStart, saving, stupefied };
