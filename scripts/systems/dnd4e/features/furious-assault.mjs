import { MATCHERS } from "../constants.mjs";
import { F, L, matches } from "../utils.mjs";

/*
 * Furious Assault (half-orc): "The attack deals 1[W] extra damage if it's a weapon attack, or 1d8
 * extra damage if it isn't." Using the power (e.g. from its reaction card after a hit) arms the
 * extra damage for that actor's next damage roll, where it shows up as a checked toggle.
 */

const pending = new Map(); // actor uuid -> timestamp
const WINDOW = 5 * 60 * 1000;

export function onUsePower(item, actor) {
	if (!matches(item, MATCHERS.furiousAssault)) return false;
	pending.set(actor.uuid, Date.now());
	ui.notifications.info(F("Info.FuriousAssaultArmed", { name: actor.name }));
	return true;
}

function isWeaponPower(item) {
	return ["melee", "ranged", "any", "meleeRanged"].includes(item?.system?.weaponType)
		|| (item?.system?.rangeType === "weapon");
}

export function damageExtra({ actor, item }) {
	const t = pending.get(actor.uuid);
	if (!t) return null;
	if (Date.now() - t > WINDOW) {
		pending.delete(actor.uuid);
		return null;
	}
	let formula = "1d8";
	if (isWeaponPower(item)) {
		const dice = item.getWepDice?.(1);
		if (dice) formula = String(dice);
	}
	return {
		id: "furiousAssault",
		label: F("Damage.FuriousAssault", { formula }),
		hint: L("Damage.FuriousAssaultHint"),
		formula,
		checked: true,
		requiresHit: true,
		onApplied: async () => pending.delete(actor.uuid),
	};
}
