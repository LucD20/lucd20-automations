import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { pf2eCard, wireOpen, sourceUuid, compactCard, nameForPlayers } from "./card.js";
import { onTurns, audience } from "./rules.js";
import { feetBetween } from "./reactive-strike.js";

/**
 * Rule 10 (docs/pf2e-rules.md): Roaring Heart (animist feat 6, War of Immortals p. 25; 2 actions).
 * "You Stride twice. At any point during this movement, you can Shove up to two creatures you pass
 * adjacent to. When you end the movement, [...] you and each ally in a 30-foot emanation gain temporary Hit
 * Points equal to half your level if you successfully Shoved at least one enemy, or equal to your level if
 * you succeeded at Shoving both. These temporary Hit Points last until the beginning of your next turn."
 * Owner's choices (Q177–Q179):
 * - Using it posts a small card (Finish) to the animist's player and the GM. The movement ends after the
 *   animist's second token move, with Finish, or at the end of their turn.
 * - Shoves: the animist's Shove rolls during it, the first two; a success against an enemy counts.
 * - The temporary HP: a PF2e effect (TempHP rule) on the animist and each ally within 30 ft, ending at the
 *   start of the animist's next turn (removed then by this module too); one chat line says who got how many.
 * All on the active GM's client.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.RoaringHeart.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const SLUG = "roaring-heart";
const FLAG = "roaringHeart";
const open = new Map(); // animist actor id → { token, card, moves, shoves: [{ success, enemy }], img, title, link }

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);
const ownersOf = (actor) => (actor?.hasPlayerOwner ? game.users.filter((u) => !u.isGM && u.active && actor.testUserPermission?.(u, "OWNER")).map((u) => u.id) : []);
const cellsOf = (doc) => {
	const size = canvas.grid.size;
	const x0 = Math.round(doc.x / size), y0 = Math.round(doc.y / size);
	return { x0, y0, x1: x0 + Math.max(1, Math.round(doc.width)) - 1, y1: y0 + Math.max(1, Math.round(doc.height)) - 1 };
};

/** Temporary HP: half the level for one enemy Shoved, the level for two, else none. */
export function tempHPFor(level, successes) {
	if (successes >= 2) return Math.max(0, Number(level) || 0);
	if (successes === 1) return Math.max(0, Math.floor((Number(level) || 0) / 2));
	return 0;
}

const lineOf = (s) => L("Line", { n: s.shoves.filter((x) => x.success && x.enemy).length, of: Math.min(2, s.shoves.length) });

async function startFor(message) {
	const actor = message.actor;
	const doc = message.token ?? actor?.getActiveTokens?.()?.[0]?.document;
	if (!actor || !doc) return;
	await finish(actor.id, { cancelled: true }); // a second use replaces the first
	const item = message.item;
	const state = { actorId: actor.id, token: doc.uuid, card: null, moves: 0, shoves: [], img: item?.img ?? null, title: item?.name ?? L("Name"), link: sourceUuid(item) };
	open.set(actor.id, state);
	const card = await ChatMessage.create({
		content: pf2eCard({
			img: state.img, title: state.title, open: state.link, extraClass: "lucd20-rh-card",
			body: `<p>${L("Do")}</p><p class="lucd20-rh-line">${lineOf(state)}</p>`,
			buttons: [{ data: "lucd20-rh", value: "finish", icon: "fa-flag-checkered", label: L("Finish") }]
		}),
		speaker: { alias: nameForPlayers(doc, doc.name) },
		whisper: [...new Set([...ownersOf(actor), ...gmIds()])],
		flags: { [MODULE_ID]: { [FLAG]: { actorId: actor.id } } }
	});
	state.card = card?.id ?? null;
}

/** The animist's Shoves during Roaring Heart: the first two count; a success against an enemy is a hit. */
async function onShove(message) {
	const context = message.flags?.pf2e?.context;
	if (context?.type !== "skill-check" || !(context.options ?? []).includes("action:shove")) return;
	const state = open.get(message.actor?.id);
	if (!state || state.shoves.length >= 2) return;
	const me = fromUuidSync(state.token), target = context.target?.token ? fromUuidSync(context.target.token) : null;
	const enemy = !!me && !!target && ((me.disposition === 1 && target.disposition === -1) || (me.disposition === -1 && target.disposition === 1));
	state.shoves.push({ success: ["success", "criticalSuccess"].includes(context.outcome), enemy });
	const card = state.card ? game.messages.get(state.card) : null;
	if (card) await card.update({ content: card.content.replace(/<p class="lucd20-rh-line">[\s\S]*?<\/p>/, `<p class="lucd20-rh-line">${lineOf(state)}</p>`) });
}

/** The end of the movement: the temporary HP for the animist and each ally within 30 ft. */
export async function finish(actorId, { cancelled = false } = {}) {
	const state = open.get(actorId);
	if (!state) return false;
	open.delete(actorId);
	const card = state.card ? game.messages.get(state.card) : null;
	const me = fromUuidSync(state.token);
	const actor = me?.actor;
	if (cancelled || !actor) {
		if (card) await card.update({ content: card.content.replace(/<div class="card-buttons lucd20-card-buttons">[\s\S]*?<\/div>\s*<\/div>\s*$/, `<p class="lucd20-card-done">${esc(L("Replaced"))}</p></div>`) });
		return false;
	}
	const successes = state.shoves.filter((s) => s.success && s.enemy).length;
	const value = tempHPFor(actor.level ?? actor.system?.details?.level?.value, successes);
	if (card) await card.update({ content: compactCard({ img: state.img, title: state.title, open: state.link, extraClass: "lucd20-rh-card" }), whisper: [] });
	if (!value) {
		await ChatMessage.create({ content: `<p class="lucd20-rule-note"><i class="fa-solid fa-mountain"></i> ${L("None", { name: `<strong>${esc(nameForPlayers(me, me.name))}</strong>` })}</p>`, speaker: { alias: localize("LUCD20.PF2eRules.Speaker") }, ...audience(me.combatant ?? { token: me, hidden: me.hidden }) });
		return true;
	}
	const mine = cellsOf(me);
	const allies = (canvas.tokens?.placeables ?? []).map((t) => t.document).filter((d) => d.actor && (d === me || (d.disposition === me.disposition && feetBetween(mine, cellsOf(d)) <= 30)));
	const initiative = me.combatant?.initiative ?? null;
	for (const d of allies) {
		const old = (d.actor.itemTypes?.effect ?? []).filter((e) => e.getFlag?.(MODULE_ID, FLAG));
		if (old.length) await d.actor.deleteEmbeddedDocuments("Item", old.map((e) => e.id));
		await d.actor.createEmbeddedDocuments("Item", [{
			type: "effect",
			name: L("Effect", { value }),
			img: state.img ?? "icons/svg/mountain.svg",
			system: {
				slug: "roaring-heart-temp-hp",
				description: { value: `<p>${L("EffectText", { value, name: esc(me.name) })}</p>` },
				// (verify) PF2e's TempHP rule element grants on creation and takes them back when the effect goes.
				rules: [{ key: "TempHP", value }],
				duration: { value: 1, unit: "rounds", expiry: "turn-start", sustained: false },
				start: { value: game.time?.worldTime ?? 0, initiative },
				tokenIcon: { show: false },
				context: { origin: { actor: actor.uuid, token: me.uuid, item: null, spellcasting: null, rollOptions: [] }, target: { actor: d.actor.uuid, token: d.uuid }, roll: null }
			},
			flags: { [MODULE_ID]: { [FLAG]: { origin: actor.uuid } } }
		}]);
	}
	const others = allies.filter((d) => d !== me).length;
	await ChatMessage.create({
		content: `<p class="lucd20-rule-note"><i class="fa-solid fa-mountain"></i> ${L(others ? "Result" : "ResultAlone", { name: `<strong>${esc(nameForPlayers(me, me.name))}</strong>`, others, value })}</p>`,
		speaker: { alias: localize("LUCD20.PF2eRules.Speaker") },
		...audience(me.combatant ?? { token: me, hidden: me.hidden })
	});
	return true;
}

/** The start of the animist's turn: the temporary HP it gave end. */
async function expire(combatant) {
	const origin = combatant.actor?.uuid;
	if (!origin) return;
	for (const t of canvas.tokens?.placeables ?? []) {
		const fx = (t.actor?.itemTypes?.effect ?? []).filter((e) => e.getFlag?.(MODULE_ID, FLAG)?.origin === origin);
		if (fx.length) await t.actor.deleteEmbeddedDocuments("Item", fx.map((e) => e.id)).catch(() => {});
	}
}

defineFeature({
	id: "pf2eRoaringHeart",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,

	init(feature) {
		onGMRequest("pf2eRules.rhFinish", ({ actorId }) => (feature.active ? finish(actorId) : false));
	},

	enable(feature) {
		feature.on("createChatMessage", (message) => {
			if (!game.user.isActiveGM) return;
			const item = message.item;
			const run = (item?.slug ?? item?.system?.slug) === SLUG && !message.flags?.pf2e?.context ? startFor(message) : onShove(message);
			Promise.resolve(run).catch((err) => error("Roaring Heart failed.", err));
		});
		// The second move ends it (Shove's push is forced movement, not the animist's).
		feature.on("moveToken", (doc, movement, operation) => {
			if (!game.user.isActiveGM || operation?.[MODULE_ID]?.forced || ["undo", "config"].includes(movement?.method)) return;
			const state = open.get(doc.actor?.id);
			if (!state || state.token !== doc.uuid) return;
			if (++state.moves >= 2) finish(state.actorId).catch((err) => error("Roaring Heart failed.", err));
		});
		onTurns(feature, {
			end: (combatant) => (open.has(combatant.actor?.id) ? finish(combatant.actor.id) : null),
			start: (combatant) => expire(combatant)
		});
		feature.on("renderChatMessageHTML", (message, html) => {
			const data = message.getFlag?.(MODULE_ID, FLAG);
			if (!data) return;
			wireOpen(html);
			for (const button of html.querySelectorAll?.("[data-lucd20-rh]") ?? []) {
				button.addEventListener("click", (event) => {
					event.preventDefault();
					if (!feature.active) return;
					button.disabled = true;
					executeAsGM("pf2eRules.rhFinish", { actorId: data.actorId }).catch((err) => error("Roaring Heart failed.", err));
				});
			}
		});
	}
});

export const _test = { startFor, onShove, finish, expire, open, tempHPFor };
