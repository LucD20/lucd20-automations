import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { waitForDice } from "../../core/dice.js";
import { pf2eCard, wireOpen, sourceUuid, compactCard, nameForPlayers } from "./card.js";
import { onTurns, audience } from "./rules.js";
import { feetBetween } from "./reactive-strike.js";
import { sysId, sysApi } from "./sys.js";

/**
 * Rule 10 (docs/pf2e-rules.md): Roaring Heart (animist feat 6, War of Immortals p. 25; 2 actions).
 * "You Stride twice. At any point during this movement, you can Shove up to two creatures you pass
 * adjacent to. When you end the movement, [...] you and each ally in a 30-foot emanation gain temporary Hit
 * Points equal to half your level if you successfully Shoved at least one enemy, or equal to your level if
 * you succeeded at Shoving both. These temporary Hit Points last until the beginning of your next turn."
 * Owner's choices (Q177–Q179):
 * - Using it posts a small card to the animist's player and the GM with Shove (the Athletics Shove check)
 *   and Cancel; once a Shove is done, Confirm too; after two Shoves, only Confirm and Cancel (owner, v0.49.1).
 *   Confirm gives the temporary HP from where the animist stands then; Cancel gives none. Moving doesn't end it.
 * - Shoves: the animist's Shove rolls during it, the first two; a success against an enemy counts.
 * - The temporary HP: a PF2e effect (TempHP rule) on the animist and each ally within 30 ft, ending at the
 *   start of the animist's next turn (removed then by this module too); one chat line says who got how many.
 * All on the active GM's client.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.RoaringHeart.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const SLUG = "roaring-heart";
const FLAG = "roaringHeart";
const open = new Map(); // animist actor id → { token, card, shoves: [{ success, enemy }], img, title, link }

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

const BUTTONS = {
	shove: { icon: "fa-hand", label: "Shove" },
	confirm: { icon: "fa-check", label: "Confirm" },
	cancel: { icon: "fa-xmark", label: "Cancel" }
};
const cardContent = (state) => pf2eCard({
	img: state.img, title: state.title, who: fromUuidSync(state.token)?.name ?? "", open: state.link, extraClass: "lucd20-rh-card",
	body: state.shoves.length ? `<p class="lucd20-rh-line">${lineOf(state)}</p>` : "",
	buttons: [...(state.shoves.length < 2 ? ["shove"] : []), ...(state.shoves.length ? ["confirm"] : []), "cancel"]
		.map((value) => ({ data: "lucd20-rh", value, icon: BUTTONS[value].icon, label: L(BUTTONS[value].label) }))
});

const lineOf = (s) => L("Line", { n: s.shoves.filter((x) => x.success && x.enemy).length, of: Math.min(2, s.shoves.length) });

/** The card is reprinted at the bottom of the chat after each step (owner, v0.49.2): the old one goes. */
let queue = Promise.resolve(); // one card change at a time (two rolls close together)
const serial = (fn) => (queue = queue.then(fn, fn));
const dropCard = (state) => serial(() => dropNow(state));
async function dropNow(state) {
	const old = state.card ? game.messages.get(state.card) : null;
	state.card = null;
	if (old) await old.delete().catch(() => {});
}
const postCard = (state, options) => serial(() => postNow(state, options));
async function postNow(state, { content, done = false } = {}) {
	await dropNow(state);
	const me = fromUuidSync(state.token);
	const card = await ChatMessage.create({
		content: content ?? cardContent(state),
		speaker: { alias: nameForPlayers(me, me?.name) },
		...(done ? audience(me?.combatant ?? { token: me, hidden: me?.hidden }) : { whisper: [...new Set([...ownersOf(me?.actor), ...gmIds()])] }),
		flags: { [MODULE_ID]: { [FLAG]: { actorId: state.actorId, token: state.token, done } } }
	});
	state.card = card?.id ?? null;
}

async function startFor(message) {
	const actor = message.actor;
	const doc = message.token ?? actor?.getActiveTokens?.()?.[0]?.document;
	if (!actor || !doc) return;
	await finish(actor.id, { replaced: true }); // a second use replaces the first
	const item = message.item;
	const state = { actorId: actor.id, token: doc.uuid, card: null, shoves: [], img: item?.img ?? null, title: item?.name ?? L("Name"), link: sourceUuid(item) };
	open.set(actor.id, state);
	await postCard(state);
}

/** The animist's Shoves during Roaring Heart: the first two count; a success against an enemy is a hit. */
async function onShove(message) {
	const context = message.flags?.[sysId()]?.context;
	if (context?.type !== "skill-check" || !(context.options ?? []).includes("action:shove")) return;
	const state = open.get(message.actor?.id);
	if (!state || state.shoves.length >= 2) return;
	const me = fromUuidSync(state.token), target = context.target?.token ? fromUuidSync(context.target.token) : null;
	const enemy = !!me && !!target && ((me.disposition === 1 && target.disposition === -1) || (me.disposition === -1 && target.disposition === 1));
	state.shoves.push({ success: ["success", "criticalSuccess"].includes(context.outcome), enemy });
	await waitForDice(message.id);
	if (open.get(state.actorId) === state) await postCard(state);
}

/** Confirm: the temporary HP for the animist and each ally within 30 ft; Cancel or a new use: none. */
export async function finish(actorId, { cancelled = false, replaced = false } = {}) {
	const state = open.get(actorId);
	if (!state) return false;
	open.delete(actorId);
	const me = fromUuidSync(state.token);
	const actor = me?.actor;
	if (replaced || cancelled || !actor) {
		await dropCard(state); // nothing happened: no trace in the chat
		return false;
	}
	const successes = state.shoves.filter((s) => s.success && s.enemy).length;
	const value = tempHPFor(actor.level ?? actor.system?.details?.level?.value, successes);
	// One message at the end: the feat's name and the result under it.
	const done = (text) => postCard(state, { done: true, content: compactCard({ img: state.img, title: state.title, who: nameForPlayers(me, me.name), open: state.link, extraClass: "lucd20-rh-card" }).replace(/<\/div>\s*$/, `<p class="lucd20-card-done">${text}</p></div>`) });
	const who = `<strong>${esc(nameForPlayers(me, me.name))}</strong>`;
	if (!value) {
		await done(L("None", { name: who }));
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
	await done(L(others ? "Result" : "ResultAlone", { name: who, others, value }));
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

/** The Shove button: the system's Shove action (Athletics, action:shove) for the clicking user's targets. */
function rollShove({ actorId, token }) {
	const actor = (token ? fromUuidSync(token)?.actor : null) ?? game.actors?.get(actorId);
	if (!actor?.isOwner) return;
	if (!game.user.targets?.size) return ui.notifications.warn(L("TargetFirst"));
	// (verify) PF2e 8.7: game.pf2e.actions is a Collection of Actions ("shove" → use()), with the legacy macro as a property.
	const action = sysApi()?.actions?.get?.("shove");
	const run = action?.use ? action.use({ actors: [actor] }) : sysApi()?.actions?.shove?.({ actors: [actor] });
	Promise.resolve(run).catch((err) => error("Roaring Heart failed.", err));
}

defineFeature({
	id: "pf2eRoaringHeart",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,

	init(feature) {
		onGMRequest("pf2eRules.rhFinish", ({ actorId, cancel }) => (feature.active ? finish(actorId, { cancelled: !!cancel }) : false));
	},

	enable(feature) {
		feature.on("createChatMessage", (message) => {
			if (!game.user.isActiveGM) return;
			const item = message.item;
			const run = (item?.slug ?? item?.system?.slug) === SLUG && !message.flags?.[sysId()]?.context ? startFor(message) : onShove(message);
			Promise.resolve(run).catch((err) => error("Roaring Heart failed.", err));
		});
		// The temporary HP end at the animist's next turn; an unanswered card stays open (Confirm or Cancel).
		onTurns(feature, { start: (combatant) => expire(combatant) });
		feature.on("renderChatMessageHTML", (message, html) => {
			const data = message.getFlag?.(MODULE_ID, FLAG);
			if (!data) return;
			wireOpen(html);
			for (const button of html.querySelectorAll?.("[data-lucd20-rh]") ?? []) {
				button.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					if (!feature.active) return;
					const value = button.dataset.lucd20Rh;
					if (value === "shove") return rollShove(data);
					button.disabled = true;
					executeAsGM("pf2eRules.rhFinish", { actorId: data.actorId, cancel: value === "cancel" }).catch((err) => error("Roaring Heart failed.", err));
				});
			}
		});
	}
});

export const _test = { startFor, onShove, finish, expire, open, tempHPFor, rollShove };
