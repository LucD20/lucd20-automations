import { MODULE_ID } from "../../core/constants.js";

/**
 * Temporary immunities to someone's ability, kept in our own flags (no PF2e effect; owner, Q291):
 * Combat Assessment (rule 21) and Battle Medicine (rule 23). On the target actor:
 *   flags.lucd20-automations.immunities = [{ kind, by: actorUuid, name: "Kyra", at: worldTime, until: worldTime }]
 * Written by the active GM's client. World time (game.time.worldTime, seconds) decides when they end.
 */

const KEY = "immunities";
export const DAY = 86400;

const now = () => Number(game.time?.worldTime) || 0;

/** The target's immunities still running (optionally of one kind / from one actor). */
export function immunitiesOf(actor, { kind = null, by = null } = {}) {
	const list = actor?.getFlag?.(MODULE_ID, KEY) ?? actor?.flags?.[MODULE_ID]?.[KEY] ?? [];
	const t = now();
	return (Array.isArray(list) ? list : []).filter((e) => e.until > t && (!kind || e.kind === kind) && (!by || e.by === by));
}

/** Is the target immune to this kind (from anyone, or from `by`)? */
export const isImmune = (actor, kind, by = null) => immunitiesOf(actor, { kind, by }).length > 0;

/** Add (or renew) an immunity; expired entries are dropped. GM's client. */
export async function addImmunity(actor, { kind, by, name, seconds = DAY }) {
	if (!actor?.setFlag) return;
	const t = now();
	const kept = immunitiesOf(actor).filter((e) => !(e.kind === kind && e.by === by));
	kept.push({ kind, by, name, at: t, until: t + seconds, real: Date.now() });
	await actor.setFlag(MODULE_ID, KEY, kept);
}

/** Remove immunities matching kind (and `by`, when given). GM's client. */
export async function removeImmunity(actor, { kind, by = null }) {
	if (!actor?.setFlag) return;
	const kept = immunitiesOf(actor).filter((e) => !(e.kind === kind && (!by || e.by === by)));
	await actor.setFlag(MODULE_ID, KEY, kept);
}

/** Who the actor has used this kind on (actors carrying an immunity `by` it). */
export function usedBy(actorUuid, kind, actors = game.actors?.contents ?? []) {
	const out = [];
	for (const a of actors) for (const e of immunitiesOf(a, { kind, by: actorUuid })) out.push({ actor: a, ...e });
	return out;
}

/** "18 h", "45 min", "under a minute". */
export function timeLeft(entry) {
	const s = Math.max(0, entry.until - now());
	if (s >= 3600) return `${Math.ceil(s / 3600)} h`;
	if (s >= 60) return `${Math.ceil(s / 60)} min`;
	return "<1 min";
}
