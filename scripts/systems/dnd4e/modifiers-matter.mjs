import { MODULE_ID } from "./constants.mjs";
import { registerModifiersMatterAdapter, mattered, lineHTML, L } from "../../features/modifiers-matter.js";
import { attackRows } from "./attack-rows.mjs";

/**
 * D&D 4e for Modifiers Matter: per target of an attack, the common attack bonuses the system applied
 * (combat advantage, cover, concealment, long range, prone...: `commonAttackBonuses` of dnd4e.preAttackRoll,
 * after the attack window) that turned a miss into a hit or the reverse, as one line under the target's
 * Hit / Miss. A natural crit or natural 1 leaves nothing to matter. GM only, unless Roll Chances' "Show 4e
 * attack chances to players" is on (it hints at the defense).
 */

let pending = null; // { rows: [{ bonuses, crit }], defs, at }
const fresh = () => pending && Date.now() - pending.at < 15000;

function onPreAttack(item, attacker, target, config = {}) {
	if (!fresh()) pending = { rows: [], defs: [], at: Date.now() };
	const bonuses = Object.values(config.commonAttackBonuses ?? {})
		.filter((b) => b?.shouldApply && Number(b.value))
		.map((b) => ({ label: game.i18n.localize(b.label ?? ""), value: Number(b.value) }));
	let crit = 20;
	try {
		const weapon = config.targetOptions?.weaponUuid ? fromUuidSync(config.targetOptions.weaponUuid) : null;
		const value = Number(item?.system?.weaponType === "implement" ? weapon?.system?.critRangeImp : weapon?.system?.critRange);
		if (value >= 2 && value <= 20) crit = value;
	} catch { /* 20 */ }
	pending.rows.push({ bonuses, crit });
	pending.at = Date.now();
}

function onPreCreate(message) {
	if (!attackRows(message).length || !fresh() || !pending.defs?.length) return;
	message.updateSource({ [`flags.${MODULE_ID}.mm4e`]: { defs: pending.defs, rows: pending.rows } });
	pending = null;
}

function onCard(feature, message, html) {
	const data = message.flags?.[MODULE_ID]?.mm4e;
	const multi = attackRows(message);
	if (!data || !multi.length || html.querySelector?.(".lucd20-mm-line")) return;
	if (!game.user.isGM) {
		let show = false;
		try { show = !!game.settings.get(MODULE_ID, "rollChances_showPlayers4e"); } catch { show = false; }
		if (!show) return;
	}
	let rows = [...html.querySelectorAll(".hit-prediction")];
	if (rows.length !== multi.length) rows = [...html.querySelectorAll(".dice-result")];
	multi.forEach(({ entry, total, natural: nat }, i) => {
		const def = Number(data.defs?.[i]), row = data.rows?.[i];
		if (!row?.bonuses?.length || !Number.isFinite(def) || !nat || !Number.isFinite(total) || entry.immune || !rows[i]) return;
		if (nat >= (row.crit ?? 20) || nat === 1) return;
		const list = mattered(row.bonuses.map((b) => ({ ...b, side: "roll" })), (delta) => total + delta >= def);
		if (list.length) rows[i].insertAdjacentHTML("afterend", lineHTML(L("Mattered"), list));
	});
}

registerModifiersMatterAdapter({
	system: "dnd4e",
	enable(feature) {
		feature.on("dnd4e.preAttackRoll", onPreAttack);
		feature.on("dnd4e.rollAttack", (itemData, targetData) => {
			if (!fresh()) return;
			pending.defs = [...(targetData?.targDefValArray ?? [])];
			pending.at = Date.now();
		});
		feature.on("preCreateChatMessage", (message) => onPreCreate(message));
		feature.on("renderChatMessageHTML", (message, html) => onCard(feature, message, html));
	}
});

export const _test = { onPreAttack, onPreCreate, onCard };
