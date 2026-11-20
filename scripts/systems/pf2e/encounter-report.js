import { registerEncounterReportAdapter, noteAttack, noteEvent } from "../../features/encounter-report.js";
import { sysFlags } from "./sys.js";

/**
 * PF2e / SF2e for the Encounter Report (PLAN §26): who caused an HP change.
 * - PF2e posts a "damage taken" message after applying damage or healing: `flags.pf2e.appliedDamage`
 *   { uuid: the target, isHealing } and `flags.pf2e.origin` = the item that dealt it (its `actor` is the
 *   source). Persistent damage: the origin is the persistent-damage condition on the target itself; its own
 *   `system.context.origin.actor` (who applied it) is the source, else none (missed).
 * - Masters: a familiar's master (`actor.master`); an eidolon / animal companion's linked character when the
 *   system exposes it.
 * - Attack rolls: `flags.pf2e.context` { type: "attack-roll", outcome, target.actor } on the roll's message.
 * - Combat Cards (v0.85.0): saving throws (context.type "saving-throw" + outcome), skill actions (context.type
 *   "skill-check", the `action:<slug>` roll option), spells cast (the spell's card: `flags.pf2e.casting`, origin
 *   type "spell"), Hero Points spent (`system.resources.heroPoints.value` going down), the dying value.
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
  const flags = sysFlags(message) ?? {};
  const context = flags.context;
  const actor = message.actor ?? globalThis.fromUuidSync?.(context?.actor ?? "") ?? null;
  const targetUuid = context?.target?.actor ?? null;
  // Attack rolls (Strikes, spell attacks): who rolled, the outcome (needs a target) and at whom (v0.84.6; v0.85.0).
  if (context?.type === "attack-roll" && context.outcome && actor?.uuid) noteAttack(actor.uuid, context.outcome, targetUuid);
  // Combat Cards (v0.85.0). Secret rolls (blind / whispered, e.g. Recall Knowledge) never give an outcome.
  const secret = !!message.blind || !!message.whisper?.length;
  if (actor?.uuid && context?.type === "saving-throw" && context.outcome && !secret) noteEvent({ kind: "save", source: actor.uuid, outcome: context.outcome });
  if (actor?.uuid && context?.type === "skill-check") {
    const action = (context.options ?? []).find(o => typeof o === "string" && o.startsWith("action:"))?.slice(7)?.split(":")[0] ?? null;
    if (action) noteEvent({ kind: "skill", source: actor.uuid, action, ...(context.outcome && !secret ? { outcome: context.outcome } : {}), ...(targetUuid ? { target: targetUuid } : {}) });
  }
  // A spell cast: the spell's own card (no roll context), its origin a spell.
  if (actor?.uuid && !context?.type && flags.origin?.type === "spell" && flags.casting) {
    const spell = message.item ?? (flags.origin.uuid ? globalThis.fromUuidSync?.(flags.origin.uuid) : null);
    const rank = Number(flags.casting?.rank ?? spell?.rank ?? spell?.system?.level?.value) || 0;
    const cantrip = !!spell?.isCantrip || (spell?.system?.traits?.value ?? []).includes("cantrip");
    noteEvent({ kind: "spell", source: actor.uuid, rank: cantrip ? 0 : rank });
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
  /** The highest spell rank the creature has (Big Guns): its non-cantrip spells. */
  maxSpellRank(actor) {
    const ranks = (actor?.itemTypes?.spell ?? []).filter(s => !s.isCantrip && !s.isRitual).map(s => Number(s.rank ?? s.system?.level?.value) || 0);
    return ranks.length ? Math.max(...ranks) : null;
  },
  mount(feature, noteSource) {
    feature.on("createChatMessage", message => onMessage(message, noteSource));
    // Hero Points spent and the dying value (Combat Cards, v0.85.0).
    const seen = new Map();
    const read = a => ({ hero: Number(a?.system?.resources?.heroPoints?.value), dying: Number(a?.system?.attributes?.dying?.value ?? a?.getCondition?.("dying")?.value ?? 0) || 0 });
    for (const a of game.actors ?? []) seen.set(a.uuid, read(a));
    const onActor = actor => {
      if (!game.user.isActiveGM || !actor?.uuid) return;
      const was = seen.get(actor.uuid), now = read(actor);
      seen.set(actor.uuid, now);
      if (!was) return;
      if (Number.isFinite(was.hero) && Number.isFinite(now.hero) && now.hero < was.hero) noteEvent({ kind: "hero", source: actor.uuid });
      if (now.dying > was.dying) noteEvent({ kind: "dying", target: actor.uuid, value: now.dying });
    };
    feature.on("updateActor", onActor);
    // Dying is a condition item: its value changes on the item.
    for (const hook of ["createItem", "updateItem", "deleteItem"]) feature.on(hook, item => { if (item?.slug === "dying" || item?.system?.slug === "dying") onActor(item.actor); });
  }
});
