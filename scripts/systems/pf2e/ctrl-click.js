import { error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { nameForPlayers } from "./card.js";
import { sysId, sysApi } from "./sys.js";

/**
 * Merge 2 (docs/pf2e-rules.md): Ctrl-click effects, replacing "PF2e Ctrl Click Effects" (owner, Q196–Q201;
 * Q200: the hand icon stays). In chat, Ctrl-click (⌘ on a Mac) a condition or effect link, or a persistent
 * damage link, or click the small hand after it, to apply it:
 * - to the selected tokens, else the targeted ones, else the user's character;
 * - a creature the user doesn't own: through the GM;
 * - conditions with the link's number ("Frightened 2"); effects with the cast rank, the origin (caster, item,
 *   spellcasting) and the roll (as the PF2e system does); persistent damage as its condition (DC 15);
 * - a short notice to the clicker, nothing in chat.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.CtrlClick.${key}`, data);
const MARK = "data-lucd20-cc";

/** Is this chat link one we apply? "condition" | "effect" | "persistent" | null. */
export function linkKind(a) {
	if (a.classList.contains("inline-roll")) return "persistent" in a.dataset && a.dataset.formula ? "persistent" : null;
	if (!a.classList.contains("content-link") || !a.dataset.uuid) return null;
	if (a.dataset.type && a.dataset.type !== "Item") return null;
	const entry = (() => { try { return fromUuidSync(a.dataset.uuid); } catch { return null; } })();
	const type = entry?.type;
	if (type) return ["condition", "effect"].includes(type) ? type : null;
	// Not in the index: PF2e's link label ("Condition Page" / "Effect Page", localized).
	const label = (t) => game.i18n.format("DOCUMENT.TypePageFormat", { type: game.i18n.localize(`TYPES.Item.${t}`), page: "Item" });
	return ["condition", "effect"].find((t) => a.getAttribute("aria-label") === label(t)) ?? null;
}

/** Who gets it: selected tokens, else targets, else the user's character (token documents). */
export function recipients() {
	const controlled = canvas.tokens?.controlled ?? [];
	if (controlled.length) return controlled.map((t) => t.document);
	const targets = [...(game.user.targets ?? [])];
	if (targets.length) return targets.map((t) => t.document ?? t);
	return (game.user.character?.getActiveTokens?.() ?? []).map((t) => t.document ?? t);
}

/** What to apply, from the link and its message: { kind, label, ... } (serializable, for the GM too). */
async function payloadFor(a, kind) {
	if (kind === "persistent") {
		const DamageRoll = CONFIG.Dice?.rolls?.find((r) => r.name === "DamageRoll");
		const roll = DamageRoll ? new DamageRoll(String(a.dataset.formula)) : null;
		const instances = (roll?.instances ?? []).filter((i) => i.persistent);
		if (!instances.length) return null;
		const base = sysApi().ConditionManager.getCondition("persistent-damage").toObject();
		const conditions = instances.map((i) => {
			const c = structuredClone(base);
			c.system = { ...(c.system ?? {}), persistent: { formula: i.head?.expression ?? i.formula, damageType: i.type, dc: 15 } };
			return c;
		});
		return { kind, label: a.innerText.trim(), conditions };
	}
	const doc = await fromUuid(a.dataset.uuid);
	if (!doc) return null;
	const number = Number(a.innerText.match(/[0-9]+/)?.[0]) || null;
	if (doc.type === "condition") return { kind: "condition", label: a.innerText.trim(), slug: doc.slug ?? doc.system?.slug, value: number };
	const message = game.messages.get(a.closest("[data-message-id]")?.dataset.messageId ?? "");
	const source = doc.toObject();
	const castRank = Number(a.closest("[data-cast-rank]")?.dataset.castRank) || message?.flags?.[sysId()]?.origin?.castRank || 0;
	if (castRank > 0) foundry.utils.setProperty(source, "system.level.value", castRank);
	if (number && source.system?.badge?.type === "counter") source.system.badge.value = number;
	if (message?.actor) {
		const { actor, token } = message;
		const target = message.target ?? null;
		const roll = message.rolls?.at?.(-1);
		const item = message.item;
		const spellcasting = item?.isOfType?.("spell") && item.spellcasting
			? { attribute: { type: item.attribute, mod: item.spellcasting.statistic?.attributeModifier?.value ?? 0 }, tradition: item.spellcasting.tradition }
			: null;
		source.system.context = {
			origin: { actor: actor.uuid, token: token?.uuid ?? null, item: item?.uuid ?? null, spellcasting, rollOptions: message.flags?.[sysId()]?.origin?.rollOptions ?? [] },
			target: target?.actor && target?.token ? { actor: target.actor.uuid, token: target.token.uuid } : null,
			roll: roll ? { total: roll.total, degreeOfSuccess: message.isCheckRoll ? (roll.degreeOfSuccess ?? null) : null } : null
		};
	}
	return { kind: "effect", label: a.innerText.trim(), source };
}

/** On whichever client may: the actor of this token gets it. */
export async function applyTo(actor, payload) {
	if (!actor) return false;
	if (payload.kind === "condition") await actor.increaseCondition(payload.slug, payload.value ? { value: payload.value } : {});
	else if (payload.kind === "effect") await actor.createEmbeddedDocuments("Item", [payload.source]);
	else if (payload.kind === "persistent") await actor.createEmbeddedDocuments("Item", payload.conditions);
	return true;
}

async function onApply(a, kind) {
	const docs = recipients().filter((d) => d?.actor);
	if (!docs.length) return ui.notifications.warn(L("NoOne"));
	const payload = await payloadFor(a, kind);
	if (!payload) return;
	for (const doc of docs) {
		if (doc.actor.isOwner) await applyTo(doc.actor, payload);
		else await executeAsGM("pf2eCtrlClick.apply", { token: doc.uuid, payload });
	}
	ui.notifications.info(L("Applied", { what: payload.label, who: docs.map((d) => nameForPlayers(d, L("ACreature"))).join(", ") }));
}

defineFeature({
	id: "pf2eCtrlClick",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	defaultEnabled: true,
	settings: {
		icon: { kind: "boolean", default: true, scope: "client" }
	},

	init(feature) {
		onGMRequest("pf2eCtrlClick.apply", ({ token, payload }) => (feature.active ? applyTo(fromUuidSync(token)?.actor, payload) : false));
	},

	enable(feature) {
		feature.on("renderChatMessageHTML", (message, html) => {
			for (const a of html.querySelectorAll?.("a.content-link, a.inline-roll") ?? []) {
				const kind = linkKind(a);
				if (!kind || a.querySelector(`[${MARK}]`)) continue;
				if (feature.get("icon")) a.insertAdjacentHTML("beforeend", `<span class="lucd20-cc-hit" ${MARK} title="${Handlebars.escapeExpression(L("Tip"))}"><i class="fa-solid fa-hand-sparkles"></i></span>`);
				a.addEventListener("click", (event) => {
					if (!feature.active) return;
					if (!(event.ctrlKey || event.metaKey || event.target.closest?.(`[${MARK}]`))) return;
					event.preventDefault();
					event.stopPropagation();
					event.stopImmediatePropagation();
					onApply(a, kind).catch((err) => error("Ctrl-click failed.", err));
				});
			}
		});
	}
});

export const _test = { linkKind, recipients, applyTo, onApply };
