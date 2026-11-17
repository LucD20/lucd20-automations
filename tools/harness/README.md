# Browser test harness

Foundry can't run in the dev container. `index.html` is a small stand-in for
Foundry: `game`, settings, `Hooks`, an `ApplicationV2` / `DialogV2` mock,
PIXI 7, Handlebars, Font Awesome Free and the `<range-picker>` /
`<color-picker>` / `<file-picker>` elements. The module is loaded from
`/modules/lucd20-automations/` exactly as Foundry would load it.

It catches logic, rendering and layout mistakes. It does not replace testing in
Foundry, because it only mocks what the existing tests needed. When a new
feature touches more of Foundry's API, extend the mock in the test file (as the
existing tests do) or in `index.html`.

## Use

```bash
tools/harness/setup.sh
```

```bash
cd tools/harness && python3 -m http.server 8765
```

Run the server in the background, then run a test from another shell:

```bash
node tools/harness/tests/test12.js
```

Playwright is preinstalled in the cloud container (`require("playwright")`).
Each test prints `PHASE n CHECKS PASSED` or throws, and writes screenshots
next to itself (`tests/*.png`, ignored by git).

Query string: `?gm=1` signs in as the GM (else a player), and `?system=pf2e`
sets `game.system.id`.

## Tests

| File | Covers |
|---|---|
| `test.js` | Settings window with a demo feature (phase 1; written before the real features, may need updating) |
| `test2.js` | Force Client Settings (2) |
| `test3.js` | Clean Title Bars, Header Buttons (3) |
| `test4.js` | Chat Pins, Turn Announcer (4) |
| `test5.js` | Turn / Next-Turn Markers (5) |
| `test7.js` | Two-per-row option layout in the settings window |
| `test6.js` | Multi-Token Edit, Folder Drop (6) |
| `test8.js` | Damage Log (7) |
| `test9.js` | Dice Stats (8) |
| `test10.js` | GM Vision, Out-of-Sight Outlines (9) |
| `test11.js`, `visual.js` | Loot Pile windows (10) |
| `test12.js`, `card.js` | PF2e Search Automation, Hazard Detection (11) |
| `test13.js` | Planned catalog entries, Turn Announcer new rounds, Lock Combat Toggle (12) |
| `test14.js` | Hidden Until Started, Defeat at 0 HP (13) |
| `test15.js` | Combat Tracker Window, free-spot placement (14) |
| `test16.js` | Combat Movement, Paused Movement Notice (15) |
| `test17.js` | Active Effect Highlight, Scene Navigation, Scene Palette (16) |
| `test18.js` | Hidden Track Names (17) |
| `test19.js` | Describe; round divider look (18) |
| `test20.js` | Door Icon Size, Secret Door Highlight, Locked Door Alert (19); secret door confirm |
| `test21.js` | PF2e door locks (20) |
| `test22.js` | Riding (21) |
| `test23.js` | Token Scatter (22) |
| `test24.js` | Flying Tokens (hover + shadow) |
| `test25.js` | Token Tooltip display, who sees what, expressions (23) |
| `test26.js` | Token Tooltip editor, data browser, helpers, TTA import (24) |
| `test27.js` | Pathfinding (25) |
| `test28.js` | D&D 4e merge: loads in dnd4e, cards, settings map, API; nothing in PF2e (26) |
| `test29.js` | D&D 4e Skill Challenges: rules engine, list, runner, rolls sent to players, chat cards, nothing secret saved or sent (29) |
| `test30.js` | Skill Challenges: players' window and rolls, hidden skills, group checks, routes, stages, thresholds, editor (30) |
| `test31.js` | Scene Audit: marking squares, the list, the exported report (31) |
| `test32.js` | NPC Health Bars: bars Always for Owner on tokens no player owns (32) |
| `test34.js` | Setting Presets: save, the server folder, differences, apply, export, import (34) |
| `test35.js` | D&D 4e: coins of the fallen, the Party Stash window, ledgers, coin tracking (35) |
| `test36.js` | D&D 4e: opportunity attack warning while a move is planned (36) |
| `test37.js` | PF2e rules: Frightened, Sickened and retching, Shove squares, Trip (37) |
| `test38.js` | PF2e rules: Temporal Distortion (38) |
| `test40.js` | PF2e rules: reactions tracked, badge on tokens, Combat Tracker mark (41) |
| `test41.js` | PF2e rules: Reactive Strike cards, triggers, the Strike button, the drag warning (42) |
| `test42.js` | PF2e rules: Shield Block cards, Block with Target Helper, secret damage (43) |
| `test43.js` | PF2e rules: Demoralizing Charge, picking squadmates, their Strikes, Drilled Reactions, the save and Frightened (44) |
| `test44.js` | PF2e rules: Roaring Heart, counting Shoves, the end of the movement, temporary HP effects (45) |
| `test45.js` | PF2e rules: Punishing Shove, its damage by rank and degree, privacy, hidden names (46) |
| `test46.js` | PF2e rules: flat checks: when, DCs, feats and effects, privacy, settings (47) |
| `test47.js` | PF2e: Ctrl-click effects: links, recipients, the GM relay, cast rank, persistent damage (48) |
| `test48.js` | PF2e: sustained spells: effects per cast, reminder, the end-of-turn question, limits (49) |
| `test49.js` | PF2e: hand reminders: hands in use, Strikes, Restrained, rage, buckler (50) |
| `test39.js` | D&D 4e HUD: data from the owner's sheets, columns and tabs, dock, clicks, dying, condition icons, party and selection cards, window sizes, players list and hotbar moved and put back (39); the monster HUD: role block, resistances, recharge roll, traits (40) |

For a new feature, copy the closest test, keep its mock setup and replace the
checks.
