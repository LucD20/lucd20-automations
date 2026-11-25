import { registerSignatureReader } from "../../features/signature-spells/signature-spells.js";
import { damageTargets } from "./shield-block.js";
import { feetBetween } from "./reactive-strike.js";
import { sysId } from "./sys.js";

/**
 * PF2e detail for Signature Spells: which spell a damage roll belongs to, who cast it and at whom.
 *
 * (verify) in PF2e 8.7 / PF2e Toolbelt:
 * - a spell's damage roll: `flags.pf2e.context.type === "damage-roll"`; the spell is `message.item`
 *   (`flags.pf2e.origin.uuid`), its slug `item.slug`; also among the roll options as `item:slug:<slug>`
 *   (`context.options`) or `origin:item:slug:<slug>` (`origin.rollOptions`);
 * - the targets: Target Helper's rows (`flags["pf2e-toolbelt"].targetHelper.targets`, token uuids, in the
 *   order they were targeted), else the roll's own target (`context.target.token`), else the tokens the
 *   message's author has targeted right now (`message.author.targets`).
 * - v0.75.0 (Swashbuckler finisher, owner: "just the damage that has Finisher applied"): the roll's options
 *   (`context.options`) and outcome are passed on, so a signature can match a Strike, not only a spell's slug.
 *   A finisher's damage roll carries the `finisher` option (Precise Strike's toggle) (verify), and the finisher
 *   used, when PF2e says so, as `finisher:<slug>` or the action's `item:slug:<slug>` (verify).
 * - v0.90.0 (Such a Disgrace!, PLAN §28): an item's card posted to chat (no `context`, or a self-effect's) is
 *   read as `roll: "card"`. For Such a Disgrace! it also says who it could be for (`candidates`): the allies
 *   within 30 feet whose latest Will save, in the last minutes of chat, failed. (verify) a save's message:
 *   `context.type === "saving-throw"`, Will by `context.domains` / the option `check:statistic:will`,
 *   `context.outcome`, `context.isReroll` on a reroll, the origin's traits as `item:trait:mental` /
 *   `origin:item:trait:mental` among `context.options`; the feat's slug is `such-a-disgrace`.
 */

const slugOf = (message) => {
	const flags = message?.flags?.[sysId()] ?? {};
	const item = message.item ?? null;
	const slug = item?.slug ?? item?.system?.slug;
	if (slug) return { slug, name: item.name ?? slug };
	for (const option of [...(flags.context?.options ?? []), ...(flags.origin?.rollOptions ?? [])]) {
		const m = /^(?:origin:)?item:slug:([a-z0-9-]+)$/.exec(String(option));
		if (m) return { slug: m[1], name: m[1] };
	}
	return null;
};

/** Which finisher, if the roll says (e.g. `finisher:unbalancing`, or the action's slug `unbalancing-finisher`). */
export function finisherOf(options) {
	for (const o of options) {
		const m = /^finisher:([a-z0-9-]+)$/.exec(o) ?? /^(?:origin:)?item:slug:([a-z0-9-]+)-finisher$/.exec(o);
		if (m) return m[1];
	}
	return null;
}

const cellsOf = (doc) => {
	const size = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
	const x0 = Math.round(doc.x / size), y0 = Math.round(doc.y / size);
	return { x0, y0, x1: x0 + Math.max(1, Math.round(doc.width ?? 1)) - 1, y1: y0 + Math.max(1, Math.round(doc.height ?? 1)) - 1 };
};
const tokenUuid = (message) => message?.token?.uuid ?? (message?.speaker?.token && message.speaker.scene ? `Scene.${message.speaker.scene}.Token.${message.speaker.token}` : null);

const SAVE_WINDOW = 3 * 60 * 1000, LOOK_BACK = 40;

/**
 * Such a Disgrace!: who the dandy's card could be for. The allies within 30 feet whose latest Will save failed
 * (not a reroll: that one has been answered), among the last messages this user may see. When any of those
 * saves is known to be against a mental effect, only those.
 * @returns {string[]} token uuids, the latest save first
 */
export function failedWillSaves(message) {
	const me = message?.token ?? (tokenUuid(message) ? fromUuidSync(tokenUuid(message)) : null);
	const all = game.messages?.contents ?? [...(game.messages ?? [])];
	const now = Number(message?.timestamp) || Date.now();
	const done = new Set(), found = [];
	for (let i = all.length - 1, n = 0; i >= 0 && n < LOOK_BACK; i--, n++) {
		const m = all[i];
		if (!m || m === message || (m.id && m.id === message?.id)) continue;
		if (now - (Number(m.timestamp) || now) > SAVE_WINDOW) break;
		const c = m.flags?.[sysId()]?.context;
		if (c?.type !== "saving-throw") continue;
		const options = (c.options ?? []).map(String);
		if (!(c.domains ?? []).includes("will") && !options.includes("check:statistic:will")) continue;
		const uuid = tokenUuid(m);
		if (!uuid || done.has(uuid)) continue;
		done.add(uuid); // only its latest Will save counts
		if (m.visible === false || m.isContentVisible === false) continue; // a save this user may not see
		if (c.isReroll || !["failure", "criticalFailure"].includes(c.outcome)) continue;
		const doc = m.token ?? fromUuidSync(uuid);
		if (me && doc) {
			if (doc === me || doc.uuid === me.uuid || doc.disposition !== me.disposition) continue;
			if (feetBetween(cellsOf(me), cellsOf(doc)) > 30) continue;
		}
		found.push({ uuid, mental: options.some((o) => /(^|:)item:trait:mental$/.test(o)) });
	}
	const mental = found.filter((f) => f.mental);
	return (mental.length ? mental : found).map((f) => f.uuid);
}

/** What a card's slug adds to its reading. */
const CARD_EXTRAS = { "such-a-disgrace": (message) => ({ candidates: failedWillSaves(message) }) };
const sluggify = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** An item's card posted to chat (a feat or action used, no roll). */
function readCard(message) {
	const item = message?.item;
	if (!item) return null;
	const found = slugOf(message) ?? { slug: sluggify(item.name), name: item.name ?? "" };
	// A card without a slug of its own (made by hand): by its name.
	const slug = Object.hasOwn(CARD_EXTRAS, found.slug) ? found.slug : Object.hasOwn(CARD_EXTRAS, sluggify(item.name)) ? sluggify(item.name) : found.slug;
	return { ...found, slug, options: [], outcome: null, finisher: null, roll: "card", caster: message.speaker?.token ?? null, scene: message.speaker?.scene ?? null, targets: [], ordered: true,
		...(CARD_EXTRAS[slug]?.(message) ?? {}) };
}

export function read(message) {
	const context = message?.flags?.[sysId()]?.context;
	if (!context || context.type === "self-effect") return readCard(message);
	if (context.type !== "damage-roll") return null;
	const options = (context.options ?? []).map(String);
	const found = slugOf(message) ?? { slug: null, name: message.item?.name ?? "" };
	const rows = message.flags?.["pf2e-toolbelt"]?.targetHelper?.targets;
	let targets = Array.isArray(rows) && rows.length ? rows.filter((u) => typeof u === "string") : damageTargets(message).map((doc) => doc?.uuid).filter(Boolean);
	let ordered = targets.length > 0;
	if (!targets.length) {
		targets = [...(message.author?.targets ?? [])].map((t) => t?.document?.uuid).filter(Boolean);
		ordered = false;
	}
	const finisher = options.includes("finisher") ? { slug: finisherOf(options) } : null;
	return { ...found, options, outcome: context.outcome ?? null, finisher, roll: "damage", caster: message.speaker?.token ?? null, scene: message.speaker?.scene ?? null, targets, ordered };
}

registerSignatureReader({ system: "pf2e", read });
