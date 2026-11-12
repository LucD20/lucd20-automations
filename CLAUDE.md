# Notes for Claude

- Read `docs/PLAN.md` first: it records every agreed decision, the settings
  layout, feature specs, build order and open questions. Update it when a
  decision changes.
- Targets: Foundry V14 (build 368), PF2e 8.7, D&D 4e 0.9.3. Foundry cannot run
  in the dev container; the owner tests in Foundry and reports back.
- Before a release, test in the mock-Foundry browser harness:
  `tools/harness/README.md` (setup, server, one test per phase).
- Releases are automatic: bump `version` in `module.json` (semver) and push;
  `.github/workflows/release.yml` creates the GitHub release that Foundry
  updates from. Every change meant for the owner to test needs a version bump.
- One module. Generic features in `scripts/features/`, system code in
  `scripts/systems/<id>/` (features there declare `systems: ["<id>"]`).
- Adding a feature: one file calling `defineFeature({...})` (see the doc
  comment in `scripts/core/feature.js`), imported from the folder's
  `index.js`; its id must match an entry in `scripts/core/catalog.js`
  `FEATURE_ORDER`; its text goes under `LUCD20.Feature.<id>` in
  `lang/en.json` (`Setting.<key>.Name/Hint` for options). Use `feature.on`,
  `feature.wrap`, `feature.onCleanup` so switching it off cleans up.
- Cross-client work: `scripts/core/socket.js` (`broadcast`, `executeAsGM`).
- UI added to Foundry's own windows/sidebar: use `scripts/core/dom-watch.js`
  (or `chat-controls.js` for chat buttons), not render hooks alone; Foundry
  draws before modules start and re-draws/moves things later.
- GM-only features: `gmOnly: true` hides them from players' settings window.
- Plain ES modules, no build step, no libWrapper. All UI text goes in
  `lang/en.json`.
- Every feature is togglable. Prefer enabling/disabling without reload.
- Never leak hidden information to players (hidden tokens, secret rolls,
  hidden NPC names, HP bars they can't see).
