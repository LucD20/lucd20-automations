# LucD20 Automations — Plan

Personal Foundry VTT module that replaces many single-feature modules with one
package. Sole user: the repo owner (public repo, not published to Foundry's
package list).

**Targets**

| | Version |
|---|---|
| Foundry VTT | V14, build 368 |
| PF2e (primary) | 8.7 |
| D&D 4e (testing) | 0.9.3 |
| Shadow of the Demon Lord | planned |

---

## 1. Decisions made

| Topic | Decision |
|---|---|
| Packaging | **One module** (`lucd20-automations`). System-specific code lives in `scripts/systems/<id>/`; its features declare `systems: ["<id>"]` and are only registered and started in that system (the files are imported everywhere, which keeps loading simple and reliable). No per-system add-on modules. |
| Toggles | Every feature has an on/off switch. Options for a disabled feature are hidden. |
| Settings UI | A single "Open LucD20 Automations" button in Foundry's settings, which opens our own window with categories (see §2). |
| Language | Plain JavaScript (ES modules), no build step. English text kept in `lang/en.json`. |
| Dependencies | None. No libWrapper. |
| Updates | Installed in Foundry via the manifest URL. Every push that bumps `version` in `module.json` creates a GitHub release automatically; the owner clicks Update in Foundry. Disable the original module when its replacement lands. |
| Loot / Party Stash | PF2e uses its native `loot` and `party` actors. Other systems get a module-provided solution; whether that is a new actor sub-type or a flagged existing type is decided when we test on 4e. |

### Rules that apply to every feature

1. **Never leak hidden information** to players: hidden tokens, GM/blind/secret
   rolls, NPC names the system hides, HP of tokens they can't see.
2. **Toggle without reload** wherever possible. Settings that need a reload
   are marked as such in the UI.
3. **Generic first, system-specific on top.** A feature works in any system;
   a system adapter adds detail (e.g. PF2e damage types in the Damage Log).

---

## 2. Settings organization

Foundry's native settings tab shows one button. The window it opens has a
category sidebar; each category has one card per feature. Each card has an
on/off switch, its options underneath, and badges per setting:

- **World**: set by the GM for everyone.
- **Per player**: each user has their own value. Has a 🔒 button
  (Force Client Settings) to set a default or lock it.
- **Reload**: changing it reloads the world.

Inside a card, options sit **two per row**, and every option in a row lines
up (names, controls and hints share row heights). Image and text options take
the full width.

System-only features get their own category, shown only in that system.
System-specific extras of a generic feature appear inside that feature's card
under a labelled sub-section (e.g. "PF2e").

```
⚔️ Combat               Turn Marker · Next-Turn Marker · Turn Announcer · Loot Pile
💬 Chat                 Chat Pins · Damage Log
🗺️ Tokens & Placement   Multi-Token Edit · Folder Drop
👁️ GM Vision            GM Vision Mode · Out-of-Sight Outlines
🗂️ Sheets & Windows     Clean Title Bars · Always Show Header Buttons
📊 Statistics           Dice Stats
🔒 Player Settings      Force / lock any module's per-player settings
🔍 Exploration (PF2e)   Search Automation · Hazard Detection
```

---

## 3. Feature specs

Each spec lists the agreed behavior and the first draft of its settings.
Settings lists will be refined while building each feature.

### ⚔️ Combat

#### Turn Marker
*Replaces part of Combat Booster.* ✅ v0.6.0
- A rotating image **under** the token of the active combatant (same canvas
  layer as token art, just below the token, at its elevation).
- Size follows the token's footprint: grid size × max(width, height) ×
  (1 + scale). Scale 0 = the token's size, 0.45 = 45 % larger; identical for
  every token of the same size (a 2×2 token gets a marker twice as big).
- "Follow token art scale" is **off** by default: art with padding (PF2e
  iconics at Scale 2) made markers bigger on some tokens and hidden under the
  art on others (fixed in v0.7.2).
- Only shown while combat runs and only on tokens this user can see.
- Images: Combat Booster's markers (MIT, credited) in `assets/markers/`;
  default `blueRunes.webp` (all systems).
- Defaults: rotation speed 0.1 rotations/second (0–3), size beyond the token
  0.2 (0–3, in 0.05 steps), follow art scale **on** (owner's choice, v0.11.1).
- Switching it on turns off Foundry's own turn marker; switching it off turns
  Foundry's back on (only if we turned it off).
- Settings: image · color (original/sepia/grayscale/tint) · tint · rotation
  speed · scale · opacity · follow art scale · draw above tokens (fallback).

#### Next-Turn Marker
*Replaces part of Combat Booster.* ✅ v0.6.0
- Same, on the combatant who acts next. Skips defeated combatants. Never shown
  to players on tokens they can't see.
- Default: the Turn Marker image, sepia, 50 % opacity (Combat Booster's look);
  can use its own image, color and opacity instead.
- **Same size and speed as the Turn Marker** (on by default): only image,
  color and opacity differ, so a token's marker doesn't change size when its
  turn comes. Turn it off to set size/speed separately.
- Empty image = use the Turn Marker's image.

#### Turn Announcer
*Replaces Turn Announcer.* ✅ v0.5.0
- On each turn change, the active GM's client posts a **compact chat card**:
  portrait | "Round X · player" / line / "Name's turn". No message header.
  The portrait is zoomed by the token's art scale (PF2e Scale 2 looks right);
  art above scale 1 spills out of the frame with faded edges.
- Card content: token image, name, owning player(s), **round number**.
- **NPC turns are announced** too (option). Hidden and defeated combatants
  are **skipped**. NPC names follow PF2e's name-visibility rule
  ("Unknown creature" when players can't see the name).
- **"You're up next"**: the owner(s) of the next combatant (skipping hidden
  and defeated) get a simple on-screen notification.
- Settings: announce NPC turns · show player name · show round number ·
  "You're up next" (per player).

#### Loot Pile
*Replaces Combat Booster's "Body pile".* ✅ v0.11.0 · restyled v0.12.0
- When combat ends, the active GM gets the **"Loot the fallen"** window with
  the gear of every NPC **marked as defeated**: grouped by NPC (**highest
  level first**, then name; items alphabetical). Only real gear is listed
  (PF2e: physical items; NPC strikes, spells, actions, effects ignored).
- Confirming creates a loot pile at the **centre of the dead NPCs** and moves
  the checked items into it (each remembers its NPC). **NPC tokens stay on the
  map.** Piles go in an Actors folder "Loot Piles".
- **Double-clicking the pile opens the Loot Pile window for everyone** (GM
  too): items grouped by NPC, each with **Take** and **Party Stash**; **Send
  all to Party Stash** for everyone; the GM also has **Open sheet** (the
  system's own loot sheet) and **Delete pile** (with confirmation).
- Transfers run on the GM's client (players don't own the pile); players can
  only take for characters they own. Same items stack (e.g. coins).
- Chat line "Alice took Dogslicer for Amiri." (option). Empty piles are
  removed (option).
- PF2e (`scripts/systems/pf2e/loot-pile.js`): native `loot` actor; Party
  Stash = the active party's inventory.
- Other systems: the pile and a module "Party Stash" are actors of an
  existing type (`loot`, else `npc`) flagged by the module; the stash is
  created on first use.
- Settings: pile name · pile image · include coins · remove when empty ·
  announce in chat.

**Look (v0.12.0)**, ported from the approved mockup on branch
`mockup/loot-window` (`docs/mockups/`, not merged). Class names
`lucd20-loot-*` / `ll-*` and the `--ll-*` color tokens come from it; all
three windows carry the token root class `lucd20-loot-app`. Styles are in the
"Loot Pile" section of `styles/lucd20.css`.
- **Loot Pile window** (420×560, resizable, works 360–600px wide, scrolls):
  "Taking for" bar · sticky NPC headers (round portrait, name, level) · item
  rows (icon, name, quantity pill, accent-outlined **Take**, neutral **Party
  Stash**) · footer (**Send all to Party Stash**; GM: **Open sheet**, **Delete
  pile** styled destructive) · empty state ("The pile is empty." /
  "Everything has been taken or stashed.", Send all disabled).
- Container queries: under 400px "Party Stash" reads "Stash" (full text in
  the tooltip and aria-label); from 540px the GM footer is one row.
- **"How many?"** for stacks: item icon and name, "N in the pile · taking for
  X", −/+ steppers around the number, "of N"; **defaults to the whole stack**;
  the primary button reads "Take {n}". **Shift+click** on Take or Party Stash
  moves the whole stack without asking (v0.12.1).
- **"Loot the fallen"**: hint bar, groups with item checkboxes, a **select
  all / none** checkbox in each NPC header (tri-state) with an "x of y" count,
  "n of total items selected", **Create loot pile** (primary) and **Skip**.
  Unchecked rows are struck through and dimmed; Create is disabled when
  nothing is selected.

Decisions:
- Player with **one character**: "Taking for" is a static chip with portrait.
  Several characters, or the GM: a dropdown (Foundry's own select).
- Player with **no character**: a hint replaces the "Taking for" bar, and
  Take is **disabled with a tooltip**, not hidden.
- An NPC whose name is hidden from players shows **"Unknown creature" and a
  neutral placeholder portrait** (`icons/svg/mystery-man.svg`). Decided on the
  GM side when the pile is made: those items store no NPC name or art, so they
  never reach a player's client; the GM's window looks the real name and
  portrait up from the token/actor.
- Checkboxes in "Loot the fallen" are drawn by the module (`ll-check`):
  Foundry's own checkbox has no confirmed "some selected" look for the
  select all / none toggle.
- Colors are the mockup's hex values. Foundry V14's CSS variable names could
  not be confirmed from its source in this environment, so none are used;
  swap tokens for theme variables once confirmed. Dark only.
- Icons are Font Awesome Free (the mockup's `fa-sack` / `fa-treasure-chest`
  suggestions are Pro-only): window `fa-sack-dollar`, Take `fa-download`,
  Party Stash `fa-box-archive`, Open sheet `fa-arrow-up-right-from-square`,
  Delete `fa-trash`, review `fa-skull`, hint `fa-circle-info`.

### 💬 Chat

#### Chat Pins
*Replaces DFreds Chat Pins.* ✅ v0.5.0
- **GM only.** Right-click a message → Pin Message / Unpin Message.
- Pinned messages get a **gold or blue outline** and a pin icon.
- A **pin button next to Export Chat Log** opens Pinned Messages (newest
  first, with "Show in chat" and Unpin). The button is kept next to Export
  wherever Foundry draws or moves the chat controls (fixed in v0.8.0: it was
  missing after a reload).
- "Clear Chat" deletes everything except pinned messages; those leave the
  main log and stay in Pinned Messages. Unpinning one of those deletes it.
- Clear Chat uses one shared dialog (`scripts/core/chat-flush.js`) that
  features add to: "N pinned messages will be kept", "Also clear the Damage
  Log".
- Settings: outline color (gold/blue) · players see pin outlines.

#### Damage Log
*Replaces Damage Log.* ✅ v0.8.0
- A **Damage Log button next to the pin button** opens/closes the Damage Log
  **window** (v0.9.0: was drawn inside the chat sidebar, which broke when the
  sidebar was collapsed). Window position is remembered per player.
- Our chat buttons are narrower than Foundry's so the row still fits.
- Logs **damage, healing, temporary HP and max HP** changes. The active GM's
  client compares each actor's HP with the last value it saw, so it catches
  every change, whoever made it (linked actors and unlinked tokens).
- Entry: portrait, name, "took 12 damage" / "healed 8" / "+5 temp HP" /
  "max HP 40 → 45", HP before → after, round, time, who; colored by type.
- GM: **Undo** per entry (restores HP and temp HP), **Clear** button.
- Kept in a world setting (newest 200 by default), **survives Clear Chat**;
  Clear Chat offers "Also clear the Damage Log".
- **Players only see entries for tokens whose HP bar they can see** (hidden
  tokens never), with PF2e's hidden names as "Unknown creature". The data is
  in a world setting that players' clients receive; filtering is in the UI.
- PF2e: the system's "damage applied" message (damage taken, resistances,
  weaknesses, immunities, shield block) is attached as the cause
  (`scripts/systems/pf2e/damage-log.js`). 4e: temp HP from `temphp`.
- Settings: players can open it · players see the cause · entries kept ·
  PF2e: show what caused it.

### 🗺️ Tokens & Placement

#### Multi-Token Edit
*Replaces the token part of Multi Token Edit.* ✅ v0.7.0
- **Tokens only.** With several tokens selected, the right-click menu (token
  HUD) shows a "multiple gears" button in its left column.
- It opens the normal token configuration for one token. On save, **only
  the fields that were changed** are applied to every selected token.
  Changed fields are highlighted.
- Settings: enable.

#### Folder Drop
*Replaces DFreds Droppables.* ✅ v0.7.0
- Dropping an actor folder on the map opens a window:
  - **Random**: scatter around the drop point. Never inside walls or on the
    other side of a wall from the drop point; no overlapping tokens.
  - **Select places**: a list of the actors (alphabetical). Click on the map
    to place the highlighted one (a see-through preview, at the token's real
    size including art scale, follows the cursor);
    the list moves to the next. Click another actor in the list to place it
    instead. "Random for the rest", right-click or Esc to stop.
  - Option: drop as hidden.
- Subfolders: not included unless the option is on.
- PF2e: dropping a Party places everyone in it. Hold **Alt** to drop the
  Party token itself.
- Settings: placement (ask / random / select) · drop as hidden · include
  subfolders.

### 👁️ GM Vision

*Replaces GM Vision and works with PF2e's built-in GM vision.* ✅ v0.10.0
- **On when the GM joins** (option). While on, selected tokens are not vision
  sources for the GM, so the **whole map** stays visible, and darkness is
  drawn with a much lighter color.
- **Ctrl+G** toggles real vision. The **Lighting controls icon** becomes a lit
  bulb while GM Vision is on (like PF2e). Outside PF2e there is also a
  **GM Vision toggle tool** in the Lighting controls (v0.11.1).
- **Darkness brightness** slider: 1 = PF2e's look (`#d1ccff`), lower keeps
  scenes darker, up to 1.5 for almost no darkness.
- PF2e (`scripts/systems/pf2e/gm-vision.js`): drives the system's own GM
  vision (its setting, Ctrl+G, icon and tool); we only switch it on at
  startup and replace its darkness color with the slider's.
- Other systems: the same, implemented by the module (same approach as PF2e:
  `_isVisionSource` returns false for the GM, `CONFIG.Canvas.darknessColor`).
- **Out-of-Sight Outlines** (GM): while the GM looks through tokens (GM
  Vision off), tokens the GM **can't currently see** (behind walls, in
  darkness, out of range) are drawn as a **dashed outline colored by
  disposition**, above fog and darkness. With GM Vision on everything is
  visible, so nothing is outlined. Circle or square. (v0.10.1: was "tokens no
  player can see", which outlined everything while the whole map was visible.)
- Both are GM-only and hidden from players' settings window.

### 🗂️ Sheets & Windows

#### Clean Title Bars
*Replaces Cleaner Sheet Title Bar.* ✅ v0.4.0 (v0.10.0: cleans every title bar
as soon as it appears, so it survives reloads)
- **Every window**: title-bar buttons keep only their icon; the label becomes
  a tooltip. The window title stays. The ⋮ menu is left alone.
- Supports both window styles. Per player (lockable).

#### Always Show Header Buttons
✅ v0.4.0 (was "Always Show Prototype Token")
- Moves chosen ⋮ menu items into the title bar as icons:
  **Prototype Token** and **Configure Ownership** (on by default) plus any
  other items named in "Other ⋮ items" (e.g. `3D Dice Settings`).
- Older-style sheets (PF2e) already show their buttons; there Configure
  Ownership is added for the GM if missing.
- The icon is a separate element inside the button, so styling modules that
  set a font on title-bar buttons (fox-4e-styling) don't break it (v0.11.1).
- Promoted items are only hidden inside the ⋮ menu; Foundry's own list is not
  changed, so the ⋮ button stays for the remaining items (fixed in v0.5.0).
- Settings: Prototype Token · Configure Ownership · Other ⋮ items. Per player.

### 📊 Statistics

#### Dice Stats
*Replaces Dice Stats.* ✅ v0.9.0
- Opened from a **Dice Stats button at the bottom of the Actors tab** (kept
  there whenever the tab is drawn or re-drawn, v0.10.0).
- The active GM's client records **every die of every roll message**, per
  user (the GM appears as a player).
- **Session** and **All time** counts. When the GM joins, "Start a new
  session?" (Yes clears Session only). GM also has a New session button.
- **Everyone can see everyone's stats.** Blind rolls and the GM's whispered
  rolls go to a **GM-only pool** (GM can include/exclude them); players never
  see them in any count.
- Window: summary table (rolls, d20 average, nat 20s, nat 1s), then a card
  per player: d20 distribution chart, other dice chips (count, average).
- PF2e (`scripts/systems/pf2e/dice-stats.js`): d20 checks split by type
  (attack, saving throw, skill, Perception, initiative, flat) with rolls,
  average, nat 20/1 and a degree-of-success bar (crit success → crit failure).
- Charts follow the dataviz rules; colors validated (see the CSS comment).
- Stored in a world setting (players' clients receive it; filtering is in the
  UI, like the Damage Log).
- Settings: ask to start a new session when the GM joins.

### 🔒 Player Settings

*Replaces Force Client Settings.* ✅ v0.3.0
- A lock button sits next to every per-player setting, both in our window and
  in Foundry's Configure Settings (where other modules' settings live).
  Clicking it lets the GM choose, using the GM's own current value:
  - **Default**: applied once to each player; they can change it afterwards.
    Changing the default re-applies it once.
  - **Locked**: always the GM's value; players see the input **greyed out**
    with a 🔒 and can't change it.
- **Only players are affected.** GMs (and Assistant GMs) keep their own values.
- Shortcuts on the lock button: **Shift+click = Default**, **Ctrl+click =
  Locked** (no dialog). Using the shortcut of the current mode again sets it
  back to Not forced.
- The Player Settings card lists every forced setting: switch mode, update to
  the GM's current value, or remove.
- Locks take effect before other modules read their settings, so a reload
  isn't needed for modules that only read settings at startup.

### 🔍 Exploration (PF2e only)

*Replaces the Monk's Active Tiles search setup.* ✅ v0.13.0
Code: `scripts/systems/pf2e/search*.js` (engine, spots, windows, features).

**Shared rules (both features)**
- **Who is Searching**: the exploration activity chosen in PF2e's party sheet
  (`character.system.exploration` holds the chosen action ids; the Search
  action has slug `search`). No "Search-Trained" effects.
- **Who rolls**: the party's characters (or every player character).
  Characters below the spot's **minimum proficiency** (Perception rank) don't
  roll.
- **The roll**: PF2e's own Perception check, **secret**, as the **Search**
  action (`action: "search"`, roll option `action:search`), so feats and items
  that change Search apply. The rolls make **no chat messages of their own**
  (v0.13.1): everything goes into **one private card** for the GM.
- **Any part of the token counts** (v0.13.1): a token is inside a spot or area
  as soon as part of it touches it (corners, edge midpoints and centre are
  checked, all along the move).
- **One failed roll per character per spot.** Reset per spot or for the whole
  scene in the Search Spots manager. Each spot remembers **who already rolled**
  (total, found or missed); the spot's window lists them with a **remove**
  button so that character can search again (removing the last finder marks
  the spot not found).
- **On a find**: pause (option), pan **everyone's** camera to the finder(s)
  and the spot (option), **"Found something..."** floats over the finder's
  token for everyone (text is an option), a **private chat card** for the GM
  (who found it, the rolls vs DC, who couldn't roll, the GM note). The spot
  stops detecting. The **private card** lists every roll (formula, natural
  d20, total, degree of success and margin), who couldn't roll (rank), the
  outcome and the GM note.

**Search Automation (search spots)**
- **Place search spot** (Token controls tool button): drag a rectangle on the
  map (or click for one square, snapped to the grid). The form opens right
  away (name, DC, minimum proficiency, GM note) and a GM-only Region is
  created with those settings in its flags.
- Trigger: a Searching character's token **enters or passes through** the
  spot. Then every Searching character rolls.
- **Search Spots manager** (Token controls): every hazard and spot on the
  scene with status (Hidden / Found / Off, who failed). Per row: **Roll Search
  now** (Theater of Mind: every Searching character rolls immediately; with no
  token on the scene, "Found something..." goes in the chat card), show on the
  map, edit, reset, delete (spots). Footer: Place search spot, **Reset all**.
- Settings: pause on a find · pan everyone's camera · private GM card · text
  over the finder.

**Hazard Detection**
- **On automatically for every hazard token** (option) with a **default range
  of 50 ft** (option; **0 = unlimited**), **measured from the token's edge**.
  **Walls block it**; opening a door extends it automatically.
- Per hazard (token right-click menu → magnifying glass, GM): detection on/off,
  range, DC (pre-filled from the hazard's Stealth DC), minimum proficiency
  (pre-filled from "(trained/expert/master/legendary)" in its Stealth
  details), GM note. Stored on the token.
- Trigger: a Searching character's token enters the area (by moving, by a door
  opening, or by switching to Search while inside). Then **every** Searching
  character rolls, **even outside the area**.
- On a find the hazard token is **revealed** (unhidden).
- The GM sees each active hazard's area as a faint outline (option);
  **Ctrl+H** hides/shows them on the GM's screen (remembered per client).
- **Non-Searching characters also roll** (option, **off by default**): only
  for hazards with no minimum proficiency. The older Core Rulebook (p. 520)
  has non-Searching characters roll for those; GM Core's wording couldn't be
  checked here.
- Settings: on for every hazard token · default range · non-Searching
  characters also roll · show hazard areas to the GM.

---

## 4. Build order

For each phase: agree on details → build → owner tests in Foundry → next.

| # | Phase | Notes |
|---|---|---|
| 0 | Manifest, auto-release workflow, plan | ✅ done |
| 1 | Core: feature registry, settings window, socket | ✅ v0.2.0 |
| 2 | Player Settings (force/lock) | ✅ v0.3.0 |
| 3 | Clean Title Bars, Always Show Header Buttons | ✅ v0.4.0 |
| 4 | Chat Pins, Turn Announcer | ✅ v0.5.0 |
| 5 | Turn Marker, Next-Turn Marker | ✅ v0.6.0 |
| 6 | Multi-Token Edit, Folder Drop | ✅ v0.7.0 |
| 7 | Damage Log (generic → PF2e) | ✅ v0.8.0 |
| 8 | Dice Stats (generic → PF2e) | ✅ v0.9.0 |
| 9 | GM Vision | ✅ v0.10.0 |
| 10 | Loot Pile + Party Stash | ✅ v0.11.0 |
| 11 | PF2e Search + Hazard Detection | ✅ v0.13.0 |

---

## 5. Open questions

- (none)
