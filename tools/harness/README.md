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

For a new feature, copy the closest test, keep its mock setup and replace the
checks.
