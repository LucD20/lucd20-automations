import { MODULE_ID } from "./constants.mjs";
import { registerChancesAdapter, chances, d20Of, barHTML, label } from "../../features/roll-chances.js";
import { attackRows } from "./attack-rows.mjs";

/**
 * D&D 4e for Roll Chances: Miss / Hit / Crit per target of an attack roll, against the defense the system
 * compared it with (its crit range: a natural roll at or above it crits; a natural 1 misses); saving throws
 * (Fail / Save against their DC). Attack bars: the GM only, unless "Show 4e attack chances to players" is on
 * (the chance reveals a monster's defense). Saves: everyone who sees the roll.
 * The defenses and crit range are taken from the system's own attack hooks on the rolling client and kept on
 * the message (flags.lucd20-automations.chances).
 */

let pending = null; // { crit, defs, immune, at }
const fresh = () => pending && Date.now() - pending.at < 15000;

/** Miss / Hit / Crit for a modifier against a defense. */
export function attackSegments(modifier, def, { crit = 20, mode = "normal" } = {}) {
	const p = chances((v) => (v >= crit ? "crit" : v === 1 ? "miss" : v + modifier >= def ? "hit" : "miss"), mode);
	return ["miss", "hit", "crit"].map((key) => ({ key: key === "miss" ? "failure" : key === "hit" ? "success" : "criticalSuccess", label: label(key), p: p[key] ?? 0 }));
}

export function saveSegments(modifier, dc, mode = "normal") {
	const p = chances((v) => (v + modifier >= dc ? "save" : "fail"), mode);
	return [{ key: "failure", label: label("fail"), p: p.fail ?? 0 }, { key: "success", label: label("save"), p: p.save ?? 0 }];
}

const debug = (...args) => CONFIG.debug?.lucd20Chances && console.log(`${MODULE_ID} | chances`, ...args);

/** The defense of a row's target now (when the attack's own numbers weren't kept). */
function liveDefense(entry) {
	const token = canvas.tokens?.get?.(entry.targetID) ?? canvas.tokens?.placeables?.find((t) => t.id === entry.targetID);
	const value = Number(token?.actor?.system?.defences?.[entry.def]?.value);
	return Number.isFinite(value) ? value : null;
}

function onPreCreate(message) {
	const rows = attackRows(message);
	debug("preCreate", { rows: rows.length, pending, fresh: fresh() });
	if (!rows?.length || !fresh()) return;
	message.updateSource({ [`flags.${MODULE_ID}.chances`]: { crit: pending.crit ?? 20, defs: pending.defs ?? [], immune: pending.immune ?? [] } });
	pending = null;
}

function onCard(feature, message, html) {
	if (html.querySelector?.(".lucd20-ch-bar")) return;
	const roll = message.rolls?.[0];
	const data = message.flags?.[MODULE_ID]?.chances ?? null;
	const multi = attackRows(message);
	debug("render", { rows: multi.length, data });
	if (multi.length) {
		if (!game.user.isGM && !feature.get("showPlayers4e")) return;
		let rows = [...html.querySelectorAll(".hit-prediction")];
		if (rows.length !== multi.length) rows = [...html.querySelectorAll(".dice-result")];
		multi.forEach(({ entry, total, natural, mode }, i) => {
			const def = Number(data?.defs?.[i] ?? liveDefense(entry));
			debug("row", i, { entry, total, natural, def, row: !!rows[i] });
			if (!natural || !Number.isFinite(total) || !Number.isFinite(def) || data?.immune?.[i] || entry.immune || !rows[i]) return;
			rows[i].insertAdjacentHTML("afterend", barHTML(attackSegments(total - natural, def, { crit: data?.crit ?? 20, mode })));
		});
		return;
	}
	// A saving throw: a d20 with a target number.
	const die = roll?.dice?.find?.((d) => d.faces === 20);
	const dc = Number(die?.options?.target);
	if (!die || !Number.isFinite(dc) || (die.options?.critical ?? 0) < 21) return;
	const d = d20Of(roll);
	if (!d?.natural) return;
	html.querySelector(".dice-roll")?.insertAdjacentHTML("afterend", barHTML(saveSegments(roll.total - d.natural, dc, d.mode)));
}

registerChancesAdapter({
	system: "dnd4e",
	enable(feature) {
		// The crit range of the weapon (or implement) used, then the defenses the system compared against.
		feature.on("dnd4e.preAttackRoll", (item, attacker, target, { targetOptions } = {}) => {
			let crit = 20;
			try {
				const weapon = targetOptions?.weaponUuid ? fromUuidSync(targetOptions.weaponUuid) : null;
				const value = item?.system?.weaponType === "implement" ? weapon?.system?.critRangeImp : weapon?.system?.critRange;
				if (Number(value) >= 2 && Number(value) <= 20) crit = Number(value);
			} catch { /* no weapon: 20 */ }
			pending = { ...(fresh() ? pending : {}), crit, at: Date.now() };
		});
		feature.on("dnd4e.rollAttack", (itemData, targetData) => {
			pending = { ...(fresh() ? pending : {}), defs: [...(targetData?.targDefValArray ?? [])], immune: [...(targetData?.targImmArray ?? [])], at: Date.now() };
		});
		feature.on("preCreateChatMessage", (message) => onPreCreate(message));
		feature.on("renderChatMessageHTML", (message, html) => onCard(feature, message, html));
	}
});

export const _test = { attackSegments, saveSegments, onCard, onPreCreate, setPending: (p) => { pending = p; } };
