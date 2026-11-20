import { registerEncounterReportAdapter, noteAttack } from "../../features/encounter-report.js";
import { sysFlags } from "./sys.js";

/**
 * PF2e / SF2e for the Encounter Report (PLAN §26): who caused an HP change.
 * - PF2e posts a "damage taken" message after applying damage or healing: `flags.pf2e.appliedDamage`
 *   { uuid: the target, isHealing } and `flags.pf2e.origin` = the item that dealt it (its `actor` is the
 *   source). Persistent damage: the origin is the persistent-damage condition on the target itself; its own
 *   `system.context.origin.actor` (who applied it) is the source, else none (missed).
 * - Masters: a familiar's master (`actor.master`); an eidolon / animal companion's linked character when the
 *   system exposes it.
 * - Attack rolls: `flags.pf2e.context` { type: "attack-roll", outcome } on the roll's message; the speaker's actor.
 * (verify) in PF2e 8.7: `origin.actor` on the damage-taken message, the persistent condition's context, the
 * attack roll's `context.outcome` (set when a target was selected).
 */

function sourceOf(message) {
  const flags = sysFlags(message) ?? {};
  const origin = flags.origin;
  if (!origin) return null;
  const item = origin.uuid ? globalThis.fromUuidSync?.(origin.uuid) : null;
  const persistent = item?.slug === "persistent-damage" || item?.system?.persistent || origin.type === "condition";
  if (persistent) return item?.system?.context?.origin?.actor ?? null;
  return origin.actor ?? item?.actor?.uuid ?? null;
}

function onMessage(message, noteSource) {
  if (!game.user.isActiveGM) return;
  // Attack rolls (Strikes, spell attacks): who rolled and the outcome, for the enemies' "Hits 2/5" (v0.84.6).
  const context = sysFlags(message)?.context;
  if (context?.type === "attack-roll" && context.outcome) {
    const actor = message.actor ?? globalThis.fromUuidSync?.(context.actor ?? "") ?? null;
    if (actor?.uuid) noteAttack(actor.uuid, context.outcome);
  }
  const applied = sysFlags(message)?.appliedDamage;
  if (!applied?.uuid) return;
  const source = sourceOf(message);
  if (source) noteSource(applied.uuid, source, applied.isHealing ? "heal" : "damage");
}

registerEncounterReportAdapter({
  system: "pf2e",
  masterOf(actor) {
    return actor?.master?.uuid ?? actor?.system?.master?.uuid ?? null;
  },
  mount(feature, noteSource) {
    feature.on("createChatMessage", message => onMessage(message, noteSource));
  }
});
