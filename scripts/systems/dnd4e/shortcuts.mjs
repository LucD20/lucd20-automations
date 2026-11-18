import { registerShortcuts } from "../../features/shortcuts.js";
import { BASIC_ACTIONS, useBasicAction } from "./actions/basic.mjs";
import { combatantForActor } from "./actions/state.mjs";
import { L } from "./utils.mjs";

/**
 * D&D 4e for Shortcuts (Q271): O toggles "grants combat advantage" on the hovered token (the 4e Off-Guard),
 * when the system has that status (with the key this browser gave Off-Guard in F is for Flatfooted, if any); unbound: each basic action (Second Wind, Spend Action Point, Charge,
 * Total Defense ...) and the death saving throw. The 4e conditions come from the generic status toggles.
 * In combat a basic action spends its action through the Action Tracker, as the HUD's buttons do.
 */

const OUT_OF_COMBAT = new Set(["secondWind", "actionPoint"]);

/** The system's combat advantage status: "grantingCA" in dnd4e (verify), else one whose id or name says so. */
function combatAdvantageStatus() {
  const list = CONFIG.statusEffects ?? [];
  return list.find(s => s.id === "grantingCA")
    ?? list.find(s => /grant.*ca$|combat.?advantage/i.test(s.id ?? ""))
    ?? list.find(s => /combat advantage|vantagem em combate/i.test(game.i18n.localize(s.name ?? s.label ?? "")));
}

registerShortcuts({
  system: "dnd4e",
  register(add, { targetActors, actingActor, t }) {
    const ca = combatAdvantageStatus();
    if (ca) {
      add("dnd4e-ca", {
        name: t("Dnd4e.CombatAdvantage"), hint: t("Dnd4e.CombatAdvantageHint"), keys: [{ key: "KeyO", modifiers: [] }],
        run: async () => { for (const actor of targetActors()) await actor.toggleStatusEffect?.(ca.id); },
        // The 4e Off-Guard: it takes the key the browser gave PF2e's Off-Guard in F is for Flatfooted.
        from: { module: "pf2e-f-is-for-flatfooted", id: "flatfooted" }
      });
    }

    for (const key of Object.keys(BASIC_ACTIONS)) {
      const name = L(`Actions.Basic.${key}`);
      add(`dnd4e-basic-${key}`, {
        name: t("Dnd4e.Basic", { name }), hint: t("ActionHint"),
        run: async () => {
          const actor = actingActor();
          if (!actor) return;
          const combatant = game.combat?.started ? combatantForActor(actor) : null;
          if (combatant) return useBasicAction(key, combatant);
          if (OUT_OF_COMBAT.has(key)) return BASIC_ACTIONS[key].run(actor);
          ui.notifications.warn(t("Dnd4e.CombatOnly", { name }));
        }
      });
    }

    add("dnd4e-deathSave", {
      name: t("Dnd4e.DeathSave"), hint: t("ActionHint"),
      run: () => actingActor()?.rollDeathSave?.(null, { isFF: false })
    });
  }
});
