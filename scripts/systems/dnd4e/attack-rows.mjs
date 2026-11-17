import { d20Of } from "../../features/roll-chances.js";

/**
 * The rows of a 4e attack message, one per target: [{ entry, total, natural, mode }].
 * dnd4e 0.9.3 (MultiAttackRoll.toMessage) posts one roll per target, each carrying its row in
 * `roll.options.multirollData` (target, defense, hit state...), and the whole in flags.dnd4e["multi-attack-roll"].
 * Older shapes (one roll with `multirollData`) are read too.
 */
export function attackRows(message) {
	const rolls = message?.rolls ?? [];
	if (rolls.length && rolls.every((r) => r?.options?.multirollData)) {
		return rolls.map((r) => {
			const d = d20Of(r);
			return d?.natural ? { entry: r.options.multirollData, total: Number(r.total ?? r.options.multirollData.total), natural: d.natural, mode: d.mode } : { entry: r.options.multirollData, total: null, natural: null };
		});
	}
	const legacy = rolls[0]?.multirollData ?? message?.flags?.dnd4e?.["multi-attack-roll"]?.multirollData ?? (() => {
		try {
			const raw = message?._source?.rolls?.[0];
			return (typeof raw === "string" ? JSON.parse(raw) : raw)?.multirollData;
		} catch {
			return null;
		}
	})();
	if (!Array.isArray(legacy) || !legacy.length || legacy[0] === "???") return [];
	return legacy.map((entry) => {
		const d = partD20(entry.parts);
		return { entry, total: Number(entry.total), natural: d?.natural ?? null, mode: d?.mode ?? "normal" };
	});
}

/** The kept d20 of a row's dice parts (tooltip data). */
function partD20(parts) {
	const die = (parts ?? []).find((p) => Number(p.faces) === 20 || /d20/i.test(String(p.formula ?? "")));
	if (!die) return null;
	const rolls = die.rolls ?? die.results ?? [];
	const kept = rolls.filter((r) => !/discarded|rerolled/.test(String(r.classes ?? "")) && r.discarded !== true && r.active !== false);
	const formula = String(die.formula ?? "");
	const mode = rolls.length >= 2 ? (/kl|dh/.test(formula) ? "low" : "high") : "normal";
	const natural = parseInt(String(kept[0]?.result ?? "").replace(/<[^>]+>/g, ""), 10);
	return Number.isFinite(natural) ? { natural, mode } : null;
}
