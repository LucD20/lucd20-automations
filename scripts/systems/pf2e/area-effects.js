import { MODULE_ID, error, localize } from "../../core/constants.js";
import { executeAsGM, onGMRequest } from "../../core/socket.js";
import { onTurns } from "./rules.js";
import { sysConfig } from "./sys.js";

/**
 * Rule 20b (docs/pf2e-rules.md; owner, PLAN §29 C5: "all should be possible options; some will do some,
 * others will do others; the functionality needs to be there because then we will automate spells").
 * A lasting effect on a PF2e effect area (a Region), set from the area window or by code (`setAreaEffect`):
 *   { rounds, conditions: [{ slug, value }], when: { placed, enter, turnStart, turnEnd }, leave, filter }
 * - rounds: the area is removed at the start of the turn of whoever was acting when it was placed, once that
 *   many rounds have passed (PF2e's "until the start of your next turn" counting); 0 = until removed by hand.
 *   Outside an encounter it stays.
 * - when: placed (creatures inside when it is set), enter (a creature moving in), turnStart / turnEnd (a
 *   creature starting / ending its turn inside). Any mix.
 * - leave: the conditions it added go when a creature leaves (and when the area ends or is removed).
 * - filter: who counts (as the window's targeting: enemies / allies / both of the caster, me, neutral);
 *   hidden creatures count too (nothing is said about them in chat).
 * Stored on the region: flags.lucd20-automations.areaEffect (+ `applied`: token uuid → condition slugs it
 * added). The active GM's client does all of it. A condition already there is left alone (and never removed
 * by the area); a valued one lower than the area's is raised (not lowered back).
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.Area.Effect.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const FLAG = "areaEffect";
const inside = new Map(); // region id → Set(token uuid)
let tokensIn = () => [];

export const VALUED = new Set(["clumsy", "doomed", "drained", "dying", "enfeebled", "frightened", "sickened", "slowed", "stunned", "stupefied", "wounded"]);
const FALLBACK = ["blinded", "clumsy", "concealed", "confused", "controlled", "dazzled", "deafened", "doomed", "drained", "enfeebled", "fascinated", "fatigued", "fleeing", "frightened", "grabbed", "hidden", "immobilized", "invisible", "off-guard", "paralyzed", "petrified", "prone", "quickened", "restrained", "sickened", "slowed", "stunned", "stupefied", "unconscious", "undetected", "wounded"];

/** The system's conditions: [{ slug, label, valued }]. */
export function conditionList() {
	const types = sysConfig()?.conditionTypes ?? {};
	const slugs = Object.keys(types).length ? Object.keys(types) : FALLBACK;
	return slugs.filter((s) => !["dying", "persistent-damage", "unconscious", "dead"].includes(s)).map((slug) => ({ slug, label: game.i18n.localize(types[slug] ?? slug) || slug, valued: VALUED.has(slug) })).sort((a, b) => a.label.localeCompare(b.label));
}

export const effectOf = (region) => region?.flags?.[MODULE_ID]?.[FLAG] ?? null;
const live = (region) => {
	const e = effectOf(region);
	return e && (e.conditions?.length || e.rounds) ? e : null;
};
const regions = () => (canvas.regions?.placeables ?? []).map((r) => r.document ?? r).filter((r) => live(r));

/** Set a lasting effect (any client: the GM's client stores it). */
export async function setAreaEffect(region, config) {
	return executeAsGM("pf2eAreas.effect", { region: region.uuid, config });
}

function clean(config, combat) {
	const n = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
	const conditions = (config.conditions ?? []).filter((c) => c?.slug).map((c) => ({ slug: String(c.slug), value: VALUED.has(c.slug) ? Math.max(1, n(c.value) || 1) : null }));
	const when = { placed: !!config.when?.placed, enter: !!config.when?.enter, turnStart: !!config.when?.turnStart, turnEnd: !!config.when?.turnEnd };
	const filter = { targets: ["enemies", "allies", "both", "all"].includes(config.filter?.targets) ? config.filter.targets : "all", self: !!config.filter?.self, neutral: config.filter?.neutral !== false };
	const started = combat?.started ? { combat: combat.id, round: combat.round, combatant: combat.combatant?.id ?? null } : null;
	return { rounds: n(config.rounds), conditions, when, leave: !!config.leave, filter, start: started, applied: {} };
}

/** GM's client: store it, then the "placed" application. */
async function store({ region: uuid, config }, senderId) {
	const region = fromUuidSync(uuid);
	if (!region) return false;
	const sender = game.users.get(senderId);
	if (sender && !sender.isGM && region.testUserPermission && !region.testUserPermission(sender, "OWNER")) return false;
	const data = clean(config, game.combat);
	await region.setFlag(MODULE_ID, FLAG, data);
	const now = new Set(tokensIn(region, data.filter).map((d) => d.uuid));
	inside.set(region.id, now);
	if (data.when.placed) for (const u of now) await apply(region, u);
	return true;
}

/** Conditions on one creature; what was added is remembered on the region. */
async function apply(region, tokenUuid) {
	const e = effectOf(region);
	const doc = fromUuidSync(tokenUuid);
	const actor = doc?.actor;
	if (!e || !actor) return;
	const added = new Set(e.applied?.[tokenUuid] ?? []);
	for (const c of e.conditions ?? []) {
		try {
			const existing = actor.getCondition?.(c.slug) ?? (actor.itemTypes?.condition ?? []).find((x) => x.slug === c.slug);
			if (!existing) {
				await actor.increaseCondition(c.slug, c.value ? { value: c.value } : {});
				added.add(c.slug);
			} else if (c.value && (Number(existing.value ?? existing.system?.value?.value) || 0) < c.value) {
				await existing.update({ "system.value.value": c.value });
			}
		} catch (err) { error(`Area effect: ${c.slug} failed.`, err); }
	}
	if (added.size !== (e.applied?.[tokenUuid] ?? []).length) await region.setFlag(MODULE_ID, FLAG, { ...e, applied: { ...(e.applied ?? {}), [tokenUuid]: [...added] } });
}

/** Take back what the area added to a creature. */
async function unapply(region, tokenUuid) {
	const e = effectOf(region);
	const slugs = e?.applied?.[tokenUuid] ?? [];
	if (!slugs.length) return;
	const actor = fromUuidSync(tokenUuid)?.actor;
	for (const slug of slugs) {
		try {
			if (actor?.hasCondition?.(slug) ?? actor?.getCondition?.(slug)) await actor.decreaseCondition(slug, { forceRemove: true });
		} catch (err) { error(`Area effect: removing ${slug} failed.`, err); }
	}
	const applied = { ...(e.applied ?? {}) };
	delete applied[tokenUuid];
	if (region.setFlag) await region.setFlag(MODULE_ID, FLAG, { ...e, applied }).catch(() => {});
}

/** Someone moved (or appeared, or the area changed): entering and leaving. */
export async function refresh() {
	if (!game.user.isActiveGM) return;
	for (const region of regions()) {
		const e = live(region);
		const before = inside.get(region.id) ?? new Set(Object.keys(e.applied ?? {}));
		const now = new Set(tokensIn(region, e.filter).map((d) => d.uuid));
		inside.set(region.id, now);
		for (const u of now) if (!before.has(u) && e.when.enter) await apply(region, u);
		for (const u of before) if (!now.has(u) && e.leave) await unapply(region, u);
	}
}

/** Turn start / end of a creature inside; the end of areas whose rounds are over. */
async function onTurn(combatant, phase) {
	const uuid = combatant?.token?.uuid;
	for (const region of regions()) {
		const e = live(region);
		if (phase === "start" && e.rounds && e.start && combatant.id === e.start.combatant && (combatant.combat?.round ?? 0) >= e.start.round + e.rounds) {
			await endArea(region);
			continue;
		}
		if (!uuid || !e.when[phase === "start" ? "turnStart" : "turnEnd"]) continue;
		if (tokensIn(region, e.filter).some((d) => d.uuid === uuid)) await apply(region, uuid);
	}
}

/** The rounds are over: what it added goes (if so set), then the area, and a line. */
export async function endArea(region) {
	const e = effectOf(region);
	if (!e) return;
	if (e.leave) for (const u of Object.keys(e.applied ?? {})) await unapply(region, u);
	inside.delete(region.id);
	const name = region.name || L("AnArea");
	await region.delete().catch(() => {});
	await ChatMessage.create({
		content: `<p class="lucd20-rule-note"><i class="fa-solid fa-hourglass-end"></i> ${L("Ended", { name: `<strong>${esc(name)}</strong>` })}</p>`,
		speaker: { alias: localize("LUCD20.PF2eRules.Speaker") }
	});
}

/** Wired by pf2eAreas (area.js): `tokensIn(region, filter)` is its targeting with hidden creatures included. */
export function initAreaEffects(feature) {
	onGMRequest("pf2eAreas.effect", (payload, senderId) => (feature.active ? store(payload, senderId) : false));
}

export function enableAreaEffects(feature, pick) {
	tokensIn = pick;
	let timer = null;
	const later = () => { clearTimeout(timer); timer = setTimeout(() => refresh().catch((err) => error("Area effects failed.", err)), 120); };
	for (const hook of ["moveToken", "createToken", "deleteToken", "updateRegion"]) feature.on(hook, later);
	feature.on("updateToken", (doc, change) => { if ("x" in (change ?? {}) || "y" in (change ?? {}) || "hidden" in (change ?? {})) later(); });
	feature.on("preDeleteRegion", (region) => {
		const e = game.user.isActiveGM ? effectOf(region) : null;
		if (e?.leave) for (const u of Object.keys(e.applied ?? {})) unapply({ ...region, flags: region.flags, setFlag: null }, u).catch(() => {});
		inside.delete(region.id);
	});
	onTurns(feature, {
		start: (c) => onTurn(c, "start").catch((err) => error("Area effects failed.", err)),
		end: (c) => onTurn(c, "end").catch((err) => error("Area effects failed.", err))
	});
	feature.onCleanup(() => { clearTimeout(timer); inside.clear(); });
}

export const _test = { store, apply, unapply, refresh, onTurn, endArea, inside, clean };
