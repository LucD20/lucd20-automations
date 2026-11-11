# Notes for Claude

- Read `docs/PLAN.md` first: it records every agreed decision, the settings
  layout, feature specs, build order and open questions. Update it when a
  decision changes.
- Targets: Foundry V14 (build 368), PF2e 8.7, D&D 4e 0.9.3. Foundry cannot run
  in the dev container; the owner tests in Foundry and reports back.
- One module. Generic features in `features/`, system code in `systems/<id>/`,
  loaded only when `game.system.id` matches.
- Plain ES modules, no build step, no libWrapper. All UI text goes in
  `lang/en.json`.
- Every feature is togglable. Prefer enabling/disabling without reload.
- Never leak hidden information to players (hidden tokens, secret rolls,
  hidden NPC names, HP bars they can't see).
