/**
 * LucD20 Automations — entry point.
 * Phase 0: confirms the module loads. Features arrive from phase 1 on (see docs/PLAN.md).
 */

export const MODULE_ID = "lucd20-automations";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing (system: ${game.system.id})`);
});

Hooks.once("ready", () => {
  const version = game.modules.get(MODULE_ID)?.version;
  console.log(`${MODULE_ID} | Ready (v${version})`);
});
