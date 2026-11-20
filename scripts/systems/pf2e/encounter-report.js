import { registerEncounterReportAdapter } from "../../features/encounter-report.js";
import { sysFlags } from "./sys.js";

/**
 * PF2e / SF2e for the Encounter Report (PLAN §26): who caused an HP change.
 * - PF2e posts a "damage taken" message after applying damage or healing: `flags.pf2e.appliedDamage`
 *   { uuid: the target, isHealing } and `flags.pf2e.origin` = the item that dealt it (its `actor` is the
 *   source). Persistent damage: the origin is the persistent-damage condition on the target itself; its own
 *   `system.context.origin.actor` (who applied it) is the source, else none (missed).
 * - Masters: a familiar's master (`actor.master`); an eidolon / animal companion's linked character when the
 *   system exposes it.
 * (verify) in PF2e 8.7: `origin.actor` on the damage-taken message, the persistent condition's context.
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
