/*
 * D&D 4e HUD: what it shows, read from a dnd4e 0.9.3 actor. Pure where it can be (tested in
 * test39.js); the HUD itself (hud.mjs) only draws what `buildModel` returns.
 *
 * Fields read (owner's exported sheets, dnd4e 0.9.3):
 *   system.attributes.hp.{value,max}, attributes.temphp.value, attributes.init.value
 *   system.details.{level,race,class,surges.{value,max},surgeValue,secondWind,deathsavefail,deathsaves}
 *   system.actionpoints.{value,encounteruse}, system.movement.walk.value, system.defences.{ac,fort,ref,wil}.value
 *   power items: system.{actionType,useType,powerType,prepared,uses.{value,max},rangeType,rangePower,area,
 *     weaponType,attack.{isAttack,def,isBasic}}, item.getAttackBonus() (async, the sheet's own number)
 */

export const TABS = ["standard", "move", "minor", "free", "triggered"];
export const ROWS = ["atwill", "enc", "daily", "basic"];
export const DEFENCES = [["ac", "AC"], ["fort", "Fort"], ["ref", "Ref"], ["wil", "Will"]];
// Monsters (Q157): a Traits tab (auras, passive abilities) instead of Free; columns At-Will, Recharge, Basic.
export const NPC_TABS = ["standard", "move", "minor", "triggered", "traits"];
export const NPC_ROWS = ["atwill", "rech", "basic"];

/** A monster power's tab: free actions go with the triggered ones, no action = a trait. */
export function npcTabFor(actionType) {
	if (["standard", "move", "minor"].includes(actionType)) return actionType;
	if (["reaction", "interrupt", "opportunity", "free"].includes(actionType)) return "triggered";
	return "traits";
}

/** A monster power's column. Every monster power is `powerType: inherent`, so Basic is the basic-attack flag. */
export function npcRowFor(system = {}) {
	if (system.attack?.isBasic) return "basic";
	if (["atwill", "other", undefined, null, ""].includes(system.useType)) return "atwill";
	return "rech";
}

/**
 * A recharge power: { roll } (recharges on that number or more on a d6) or { cond } (a condition such as
 * "when first bloodied"), else null. As dnd4e's sheet does: a recharge power with neither recharges on a 6.
 */
export function rechargeOf(system = {}) {
	if (system.useType !== "recharge") return null;
	const roll = parseInt(system.rechargeRoll, 10);
	if (Number.isFinite(roll) && roll > 0) return { roll: Math.min(6, roll) };
	const cond = typeof system.rechargeCondition === "string" ? system.rechargeCondition.trim() : "";
	return cond ? { cond } : { roll: 6 };
}

const stripHTML = (html) => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** A trait's text: its effect, else its description, without markup; cut at about 220 characters. */
export function traitText(system = {}) {
	const text = stripHTML(system.effect?.detail || system.description?.value || "");
	return text.length > 220 ? `${text.slice(0, 217).trimEnd()}…` : text;
}

/**
 * Resistances, vulnerabilities and immunities: [{ kind: "res"|"vul"|"imm", value, type }] (the words are
 * the HUD's, in lang/en.json). (verify) field use in dnd4e 0.9.3: `resistances.<type>.{value,immune}`.
 */
export function resistancesOf(s = {}) {
	const out = [];
	for (const [type, r] of Object.entries(s.resistances ?? {})) {
		if (!r || typeof r !== "object") continue;
		if (r.immune) { out.push({ kind: "imm", value: 0, type }); continue; }
		const v = Number(r.value) || 0;
		if (v > 0) out.push({ kind: "res", value: v, type });
		else if (v < 0) out.push({ kind: "vul", value: -v, type });
	}
	const u = s.untypedResistances ?? {};
	for (const t of u.resistances ?? []) out.push({ kind: "res", value: 0, type: String(t) });
	for (const t of u.vulnerabilities ?? []) out.push({ kind: "vul", value: 0, type: String(t) });
	for (const t of u.immunities ?? []) out.push({ kind: "imm", value: 0, type: String(t) });
	return out;
}

/** Which tab a power's action type goes in. */
export function tabFor(actionType) {
	if (["standard", "move", "minor", "free"].includes(actionType)) return actionType;
	if (["reaction", "interrupt", "opportunity"].includes(actionType)) return "triggered";
	return "free"; // "none" / empty: usable at no action cost
}

/** Which usage row a power goes in. */
export function rowFor(system = {}) {
	if (system.powerType === "inherent") return "basic";
	switch (system.useType) {
		case "encounter": case "recharge": return "enc";
		case "daily": case "item": return "daily";
		default: return "atwill";
	}
}

/**
 * The compendium names carry a prefix: "Ranger 01-Twin Strike", "Bard-Majestic Word",
 * "Half-Orc Power-Furious Assault", "Warlock Pact Boon 01-Fate of the Void". The HUD shows what
 * follows it. A name without such a prefix ("Ranged Basic Attack") is left as it is.
 */
export function cleanName(name = "") {
	const tagged = name.match(/^.+? (?:\d{1,2}|Power|Feature|Utility|Attack)-(.+)$/);
	if (tagged) return tagged[1].trim();
	// "Bard-Majestic Word": only a class name counts as a prefix ("Wolf-Pack ..." would not).
	const single = name.match(/^([A-Z][a-z]+)-(.+)$/);
	if (single && CLASSES.has(single[1])) return single[2].trim();
	return name;
}
const CLASSES = new Set(["Ardent", "Artificer", "Assassin", "Avenger", "Barbarian", "Bard", "Battlemind", "Cleric", "Druid", "Fighter",
	"Invoker", "Monk", "Paladin", "Psion", "Ranger", "Rogue", "Runepriest", "Seeker", "Shaman", "Sorcerer", "Warden", "Warlock", "Warlord",
	"Wizard", "Vampire", "Hybrid"]);

/** The range as an icon and a short text: { icon, text }. Icons: melee, ranged, close, area, personal. */
export function rangeInfo(s = {}) {
	const n = (v) => (v === undefined || v === null || v === "" || v === "0" ? "" : String(v));
	const weapon = { melee: ["melee", "W"], ranged: ["ranged", "W"], meleeRanged: ["meleeRanged", "W"] };
	switch (s.rangeType) {
		case "weapon": {
			const [icon, text] = weapon[s.weaponType] ?? ["melee", "W"];
			return { icon, text };
		}
		case "melee": case "touch": return { icon: "melee", text: n(s.rangePower) || (s.rangeType === "touch" ? "touch" : "1") };
		case "reach": return { icon: "melee", text: n(s.rangePower) };
		case "range": return { icon: "ranged", text: n(s.rangePower) };
		case "closeBurst": return { icon: "close", text: `burst ${n(s.area)}`.trim() };
		case "closeBlast": return { icon: "close", text: `blast ${n(s.area)}`.trim() };
		case "areaBurst": return { icon: "area", text: `burst ${n(s.area)}${n(s.rangePower) ? ` in ${n(s.rangePower)}` : ""}`.trim() };
		case "areaBlast": return { icon: "area", text: `blast ${n(s.area)}${n(s.rangePower) ? ` in ${n(s.rangePower)}` : ""}`.trim() };
		case "wall": return { icon: "area", text: `wall ${n(s.area)}`.trim() };
		case "personal": return { icon: "personal", text: "" };
		default: return { icon: "", text: "" };
	}
}

/** Uses left of a limited power: { left, max } or null (at-will). */
export function usesOf(s = {}) {
	if (!["encounter", "daily", "recharge", "item"].includes(s.useType)) return null;
	const max = Number(s.uses?.max);
	if (!Number.isFinite(max) || max < 1) return null;
	const left = Number(s.uses?.value);
	return { left: Number.isFinite(left) ? Math.max(0, Math.min(left, max)) : max, max };
}

const DEF_LABEL = Object.fromEntries(DEFENCES);
const signed = (v) => (v >= 0 ? `+${v}` : `−${Math.abs(v)}`);

/** "+6 vs AC" (the bonus only when the system gives one). */
export function attackText(s = {}, bonus = null) {
	if (!s.attack?.isAttack) return "";
	const def = DEF_LABEL[s.attack.def] ?? (s.attack.def ? String(s.attack.def).toUpperCase() : "");
	const b = Number(bonus);
	return `${bonus !== null && bonus !== undefined && Number.isFinite(b) ? `${signed(b)} ` : ""}vs ${def}`.trim();
}

// Effects that hinder: shown in red. Statuses as Foundry / dnd4e name them.
const HARMFUL = new Set(["blinded", "dazed", "deafened", "dominated", "dying", "grabbed", "helpless", "immobilized", "marked", "petrified",
	"prone", "restrained", "slowed", "stunned", "surprised", "unconscious", "weakened", "removed", "ongoing", "bleeding", "poisoned", "dead"]);

/** The actor's current conditions and temporary effects: [{ name, img, bad, duration }]. */
export function conditionsOf(actor) {
	const effects = actor?.appliedEffects ?? actor?.effects?.filter?.((e) => !e.disabled) ?? [];
	const out = [];
	for (const e of effects) {
		if (!e.isTemporary && !(e.statuses?.size)) continue;
		const statuses = [...(e.statuses ?? [])];
		const bad = statuses.some((s) => HARMFUL.has(s)) || /ongoing|marked|weakened|slowed|dazed|stunned/i.test(e.name ?? "");
		// The duration as dnd4e words it ("End of target's next turn", "Save ends"), else Foundry's.
		const dt = e.system?.durationType;
		const label = dt && globalThis.CONFIG?.DND4E?.durationType?.[dt]?.label;
		const duration = label ? game.i18n.localize(label) : (e.duration?.label ?? "");
		out.push({ name: e.name ?? statuses[0] ?? "", img: e.img ?? e.icon ?? "icons/svg/aura.svg", bad, duration });
	}
	return out;
}

/**
 * A power's keywords as text. dnd4e keeps them as a list on most powers, but as a Set, a string
 * or an object of flags on others (owner's world, v0.43.1).
 */
export function keywordsOf(p = {}) {
	const k = p.keyWords;
	let list = [];
	if (typeof k === "string") list = k.split(/[,;]/);
	else if (k && typeof k[Symbol.iterator] === "function") list = [...k];
	else if (k && typeof k === "object") list = Object.entries(k).filter(([, v]) => v === true).map(([key]) => key).concat(Object.values(k).filter((v) => typeof v === "string"));
	const custom = typeof p.keywordsCustom === "string" ? p.keywordsCustom.split(/[,;]/) : [];
	return [...list, ...custom].map((v) => String(v ?? "").trim()).filter(Boolean).join(", ");
}

/** The HUD's data for one actor. `bonusOf(item)` gives an attack bonus (or null). */
export async function buildModel(actor, { bonusOf = async () => null, defenceMods = null } = {}) {
	const npc = actor.type === "NPC";
	const s = actor.system ?? {};
	const d = s.details ?? {};
	const hp = s.attributes?.hp ?? {};
	const mods = defenceMods ?? {};
	const net = (k) => (mods[k] ?? []).reduce((a, m) => a + (Number(m.value) || 0), 0);
	const powers = [];
	for (const item of actor.items ?? []) {
		if (item.type !== "power") continue;
		// One odd power must not stop the HUD (v0.43.1: keyWords was not a list on the owner's sheets).
		try {
			const p = item.system ?? {};
			if (p.prepared === false) continue;
			const uses = usesOf(p);
			let bonus = null;
			if (p.attack?.isAttack) {
				try { bonus = await bonusOf(item); } catch (err) { bonus = null; }
			}
			const tab = npc ? npcTabFor(p.actionType) : tabFor(p.actionType);
			powers.push({
				id: item.id, name: cleanName(String(item.name ?? "")), fullName: String(item.name ?? ""), tab, row: npc ? npcRowFor(p) : rowFor(p),
				range: rangeInfo(p), attack: attackText(p, bonus), uses, used: !!uses && uses.left < 1,
				trigger: typeof p.trigger === "string" ? p.trigger : "", keywords: keywordsOf(p),
				recharge: npc ? rechargeOf(p) : null, text: npc && tab === "traits" ? traitText(p) : "",
			});
		} catch (err) {
			console.warn("lucd20-automations | 4e HUD: power skipped", item.name, err);
		}
	}
	powers.sort((a, b) => a.name.localeCompare(b.name));
	const role = d.role ?? {};
	return {
		kind: npc ? "npc" : "pc",
		role: npc ? { primary: role.primary || "", secondary: role.secondary || "standard", leader: !!role.leader } : null,
		level: d.level ?? "", xp: d.exp ?? "",
		minion: npc && (role.secondary === "minion" || Number(hp.max) === 1),
		saves: Number(d.saves?.value) || 0,
		perception: s.skills?.prc?.total ?? s.skills?.prc?.value ?? "",
		passive: { perception: s.passive?.pasprc?.value ?? "", insight: s.passive?.pasins?.value ?? "" },
		resistances: npc ? resistancesOf(s) : [],
		name: actor.name,
		sub: [d.race, d.class, d.level].filter((v) => v !== undefined && v !== null && v !== "").join(" "),
		img: actor.img,
		hp: { value: Number(hp.value) || 0, max: Number(hp.max) || 0, temp: Number(s.attributes?.temphp?.value) || 0 },
		bloodied: (Number(hp.value) || 0) <= (Number(d.bloodied) || (Number(hp.max) || 0) / 2),
		dying: (Number(hp.value) || 0) <= 0,
		surges: { value: Number(d.surges?.value) || 0, max: Number(d.surges?.max) || 0, each: Number(d.surgeValue) || 0 },
		secondWindUsed: !!(d.secondWind || d.secondwind),
		deathFails: Number(d.deathsavefail) || 0, deathMax: Number(d.deathsaves) || 3,
		ap: Number(s.actionpoints?.value) || 0, apUsedThisEncounter: !!s.actionpoints?.encounteruse,
		speed: s.movement?.walk?.value ?? "", init: s.attributes?.init?.value ?? "",
		defences: DEFENCES.map(([k, label]) => ({ key: k, label, value: s.defences?.[k]?.value ?? "", mod: Math.sign(net(k)) })),
		conditions: conditionsOf(actor),
		powers,
	};
}

