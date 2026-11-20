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

**v0.62.0: layout C** (owner, Q241–Q243; mockups `docs/mockups/settings-a/b/c`):
the sidebar is a tree: **General** (Combat, Chat & Rolls, Tokens, Vision &
Doors, Scenes & Windows), the active **system** (PF2e: Core Rules with
sections Conditions / Actions & Checks / Reactions / Battlefield & Spells /
Tools, Classes with a section and a tree entry per class, Exploration, Chat
helpers; 4e: Core Rules, Classes, Interface, Tools, Chat helpers) and
**Setup** (Players & Presets). The layout lives in `scripts/core/catalog.js`
(`NAV`, `PLACE`, `placeOf`); features keep their ids and `category`. Each
feature is one line (switch, name, its hint on one line, a caret); clicking
it opens the full text and options (three per row; tick boxes beside their
name; the reset button inside). Everything starts collapsed; opened lines
stay open while the window is open; the last page and closed tree groups are
remembered per browser. Search opens the lines whose options match.

```
⚔️ Combat               Turn Marker · Next-Turn Marker · Turn Announcer · Loot Pile
                          · Combat Tracker Window · Hidden Until Started · Defeat at 0 HP · Lock Combat Toggle
                          · Combat Movement
💬 Chat                 Chat Pins · Damage Log · Describe
🗺️ Tokens & Placement   Multi-Token Edit · Folder Drop · Paused Movement Notice
                          · Active Effect Highlight · Riding · Token Scatter · Flying Tokens
                          · Token Tooltip · Pathfinding
🚪 Doors                Door Icon Size · Secret Doors · Locked Door Alert (+ PF2e lock options)
🎬 Scenes & Sound       Scene Navigation · Scene Palette · Hidden Track Names
👁️ GM Vision            GM Vision Mode · Out-of-Sight Outlines
🗂️ Sheets & Windows     Clean Title Bars · Always Show Header Buttons
📊 Statistics           Dice Stats
🔒 Player Settings      Force / lock any module's per-player settings
🔍 Exploration (PF2e)   Search Automation · Hazard Detection
```

Every feature of the next pass (§6) is built (v0.14.0–v0.20.0). Doors and
Scenes & Sound sit before Player Settings. Every feature of the third pass
(§7) is built (v0.21.0–v0.28.0).

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
- **New rounds** (v0.14.0, option, on by default): a thin "Round X" divider
  card (no header) when the round goes up, posted before that round's first
  turn card. A double line on each side and outlined text (v0.15.0).
  Only the divider shows: no message header, frame or background (v0.20.0;
  also matched with `:has(.lucd20-round-divider)` and `!important`, since
  PF2e's chat styles still showed the header). Only once per round: stepping back a round and forward again
  doesn't repeat it.
- **NPC turns are announced** too (option). Hidden and defeated combatants
  are **skipped**. NPC names follow PF2e's name-visibility rule
  ("Unknown creature" when players can't see the name).
- **"You're up next"**: the owner(s) of the next combatant (skipping hidden
  and defeated) get a simple on-screen notification.
- Settings: announce NPC turns · show player name · show round number ·
  announce new rounds · "You're up next" (per player).

#### Lock Combat Toggle — `hudCombatLock`
*Replaces part of Monk's Combat Details.* ✅ v0.14.0 · GM only, no options.
- The Token HUD's "Toggle combat state" button still **adds** tokens to
  combat, but on a token already in combat (which would remove it and every
  selected combatant, losing their initiative) it only shows a notification:
  "Remove combatants from the combat tracker".
- **GM: Shift+click** removes anyway (owner's decision). Players are always
  blocked.
- Only the HUD button is blocked (a capture-phase click listener on the
  document); `TokenDocument#toggleCombatant` and the tracker are untouched.

#### Combat Tracker Window — `combatTrackerWindow`
*Replaces part of Monk's Combat Details.* ✅ v0.16.0 · per player, **on by
default** (owner's decision, Q6); can be locked with Force Client Settings.
- When an encounter is created, the combat tracker pops out at the **bottom
  right, against the left edge of the sidebar**. It stays anchored to the
  bottom as rows are added, until moved by hand.
- Players: only once the combat has a combatant they can see (a combat of
  hidden combatants gives nothing away). Only for combats on the viewed
  scene. Once per combat: closing it by hand doesn't bring it back.
- **Close when the combat ends** (option, on): only if we opened it.
- No "follow the turn": Foundry V14 already keeps the current and next
  combatants visible (owner checked, Q5).
- V14 notes (v0.16.1): the tracker class is `EncounterTracker` (render hook
  `renderEncounterTracker`); `ui.combat.renderPopout()` / `ui.combat.popout`
  work. The pop-out waits ~150 ms after the encounter is created so Foundry
  finishes re-drawing the tracker first (that fixed v0.16.0 showing nothing;
  owner confirmed). The temporary console logging was removed in v0.20.1.

#### Combat Movement — `combatMovement`
*Replaces part of Monk's TokenBar.* ✅ v0.17.0 · GM only, no options.
- While a combat has started, players can only move the token of the
  combatant whose turn it is. **Tokens not in the combat move freely** (Q8).
  The GM can always move. Free again when the combat ends.
- **GM button in the combat tracker header** (Q8) switches the combat between
  turn order (shoe prints, amber) and free movement (walking figure, green);
  players see the same icon without the button. Stored as a flag on the
  combat (`freeMovement`), so everyone sees the same mode.
- Blocked moves float **"Not your turn"** over the token for everyone who can
  see it (same as the paused text).
- The check runs in `preMoveToken` on the player's client (V14 fires it for
  moves; owner checked). No GM-side backstop: a player's own token update
  can only be undone after the fact, which isn't worth it.

#### Hidden Until Started — `encounterVisibility`
*Replaces part of Monk's Combat Details.* ✅ v0.15.0 · GM only, no options.
- A combatant **whose token is hidden** (Foundry's hidden flag) is added
  **hidden in the tracker** (owner's decision, Q7: not every NPC). Applies
  whenever it is added, before or during combat.
- **Auto-reveal**: when a token stops being hidden, its combatants in every
  combat on that scene are revealed.
- When the combat starts, combatants this feature hid whose token is visible
  by then are revealed (catches tokens revealed while the feature was off).
  A combatant the GM hid by hand (token visible) stays hidden.
- Never reveals a combatant whose token is still hidden. Not about the
  Invisible condition.

#### Defeat at 0 HP — `defeatAutomation`
*Replaces part of Monk's Combat Details.* ✅ v0.15.0 · GM only.
- When an **NPC combatant** (no player owner) drops to 0 HP, it is marked
  **defeated** and gets the system's defeated status
  (`CONFIG.specialStatusEffects.DEFEATED` via `actor.toggleStatusEffect`).
  NPCs not in a combat are left alone; PCs are never touched.
- **Hide the token** (option, on): hidden as soon as it goes down.
- **Undo when healed** (option, on): back above 0 → not defeated, status
  removed, token shown again. Only undoes what this feature did: a combatant
  the GM defeated by hand or a token the GM hid stays as it is (flags on the
  combatant and token).
- Acts when HP **crosses** 0 (compared with the last value seen), so the GM
  can un-defeat a 0 HP NPC by hand. Only the active GM acts. HP readers are
  shared with Damage Log (`scripts/core/hp.js`).
- Loot Pile gathers defeated combatants whether their token is hidden or
  not; the pile token is always created visible.
- PF2e has its own "dead at 0 HP" automation; both together are harmless
  (each step checks the current state first).

#### Loot Pile
*Replaces Combat Booster's "Body pile".* ✅ v0.11.0 · restyled v0.12.0
- When combat ends, the active GM gets the **"Loot the fallen"** window with
  the gear of every NPC **marked as defeated**: grouped by NPC (**highest
  level first**, then name; items alphabetical). Only real gear is listed
  (PF2e: physical items; NPC strikes, spells, actions, effects ignored).
- Confirming creates a loot pile at the **centre of the dead NPCs** (the
  nearest **free square**: never under or on top of a token, hidden bodies
  included, v0.16.0; shared with Folder Drop in `scripts/core/placement.js`)
  and moves
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

#### Describe — `describe`
*Replaces Narrator Tools (only its "describe").* ✅ v0.20.0 · GM only
(owner's decision, Q2), no options.
- Select text and right-click → **Describe**. On chat messages it's an entry
  in **Foundry's own message menu** (owner's choice); elsewhere (journals,
  item descriptions …) a small menu in Foundry's context-menu style appears,
  only while text is selected and not inside an editor.
- **`/describe Text`** in chat does the same; no chat message is posted
  (`chatMessage` hook; V14 sends the input as HTML, turned into plain text
  with line breaks).
- Everyone sees the text on a **dark band across the middle of the screen**
  (fading out at its top and bottom), bold white text with a dark outline,
  fading in and out (v0.20.1, owner's reference: Narrator Tools). The rest of
  the screen stays usable. Stays **3 s + 0.3 s per word, 4–30 s** (Q3).
- The GM gets **Pause** (keeps it up; becomes Resume) and **Close** under the
  band, both for everyone. A player's click on the band hides it for that
  player only.
- Sent with `broadcast` (`describe.show` / `describe.pause` /
  `describe.hide`); plain text only.

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

#### Active Effect Highlight — `statusHighlight`
*Replaces part of Monk's Little Details.* ✅ v0.18.0 · per player, on by default.
- In the Token HUD's status effects palette, active effects
  (`.effect-control.active`) get a colored border, a tinted background and a
  glow. Pure CSS behind a `<body>` class; the color is a CSS variable.
- Settings: highlight color.

#### Riding — `riding`
*Replaces Rideable (only mounting).* ✅ v0.23.0 · no options.
- The GM marks a token **Rideable** with a horse button in its Token HUD
  (gold when on; turning it off makes its riders get off) (Q12).
  v0.23.1: the button is drawn by a DOM watcher on `canvas.hud.token`
  (v0.23.0 relied on the render hook only and didn't show in V14).
- **Mount**: select your token(s), target the Rideable token, press **M**
  (rebindable; owner checked M is free). Players: their own tokens, within 1
  square of the mount; the GM: any token, any distance (Q14). The rider's
  centre sits **30 % in from a corner** of the mount (top-left, then
  top-right, bottom-left, bottom-right) (Q13), with **0.5 taken off its art
  scale** (owner, v0.23.2: "reduce by 0.5, not set to 0.5": 2 → 1.5, 1 → 0.5,
  min 0.25; from the scale shown on the map, the stored value restored on
  dismount), at the mount's elevation, sorted just above it.
- While riding the rider is blocked from moving on its own (movement block:
  "Riding: press M to get off"), and its **vision comes from the mount's
  centre** (wraps `Token#_getVisionSourceData`; owner confirmed it exists in
  V14, Q15).
- When the mount moves, the active GM moves its riders along the same
  waypoints (`move` with ignoreWalls/ignoreCost), so they travel together
  (Q16). If the GM drags a rider away, it simply gets off there.
- **Dismount**: M with the rider selected → the closest free square it can
  reach from the mount (no token, not across a wall; `core/placement.js`),
  scale restored. Deleting the mount drops its riders the same way.
- PF2e: "link to actor size" and autoscale are switched off while riding
  and restored after (or removed, so PF2e's defaults apply).
- All changes run on the active GM's client (`riding.mount` /
  `riding.dismount` requests); our own moves carry an option flag.

#### Token Scatter — `tokenScatter`
*Replaces Z-Scatter.* ✅ v0.24.0 · per player, on by default (Q31).
- Tokens that overlap (any part) are drawn spread apart a little, so each can
  be seen, clicked and targeted, **whatever their elevation** (v0.25.0, owner:
  flyers over others spread too; the v0.24.0 stack badge, portrait strip and
  Z key were dropped as unnecessary). Only the drawing moves: the token
  container (border, bars, effects, name, hit area) and its art mesh;
  documents never change. Not while a token is moving. Defeated (dead,
  dying, unconscious) tokens are left alone (option).
- Layout as in Z-Scatter (MIT): push away from the group's centre (tokens on
  the exact same spot get evenly spaced directions), up to 8 passes pushing
  overlapping pairs apart (bigger tokens move less), offsets capped.
- Only tokens this user can see take part (`token.visible`).
- Recomputed only when tokens change (create/delete/update, after the move
  animation ends, sight refresh, actor updates); Foundry's own re-positioning
  (`refreshToken`) gets the offset re-applied.
- Settings: spread (0.1–1, 0.3) · leave defeated tokens alone.

#### Flying Tokens — `flyingTokens`
*Owner's request (from an old module).* ✅ v0.25.0 · per player, on by default.
- A token above elevation 0 **hovers**: its art drifts slowly up/down and a
  little sideways, each token on its own rhythm (through the art mesh's
  pivot, so position, border, bars and hit area don't move).
- It casts a **soft round shadow** on the ground: the higher it flies, the
  further the shadow falls (down-right), the larger, fainter and blurrier it
  is (capped at 12 squares of height). The shadow is a `PrimaryGraphics` in
  the token sort layer just below the flyer (v0.27.0: at elevation 0 with a
  very low sort it was hidden under the scene background in V14); only for
  tokens this user sees.
- One ticker callback for the flying tokens only; the list is rebuilt when
  tokens change.
- Settings: hover motion · ground shadow.

#### Token Tooltip — `tokenTooltip`
*Replaces Token Tooltip Alt.* ✅ v0.26.0 display + presets · v0.27.0 editor,
data browser, import. Code: `scripts/features/token-tooltip/`.
- **Hover** a token → a panel to its right (left if no room). v0.27.0: same
  look as TTA's dark theme (owner: v0.26.0 was too bold, spaced and opaque):
  Foundry's `ui/denim075.png` texture, black glow, 5px padding, 0.5rem gaps,
  normal weight, accent border; rows of **coloured icon + value**,
  in **two columns** (filled top to bottom) when there are more than five rows
  (owner's screenshots, Q22). Follows pan and zoom and Token Scatter offsets;
  refreshes when the actor or token changes. Hover only (Q23).
- **One list of rows** for the world (world setting `tokenTooltipConfig`;
  empty = the system's preset). Each row: icon, colour, value, **who sees it**
  (`gm` · `owner` = GM + owners · `friendly` = also everyone on friendly
  tokens · `others` = players who don't own it · `all`) and **actor types**
  (none = all). Replaces TTA's lists per GM/player × disposition × type.
- **Values** (Q25: expressions are fine if intuitive), three forms:
  1. a data path from the actor's system data: `attributes.ac.value`;
  2. text with `{…}` blocks: `<path>` or `@path` read values, the rest is
     JavaScript, several statements allowed, the last is the result
     (`P: {<stats.parry.value>}`, `{@saves.fortitude.value + 10}`). TTA's
     mathjs helpers exist (`concat`, `string`, `typeOf`, `compareText`,
     `floor`, `ceil`, `round`, `abs`, `min`, `max`), so **the owner's old
     expressions paste as they are** (tested);
  3. a script (contains `return`): function body with `token`, `actor`,
     `data`, `_token`, as TTA's functions (`Ray` provided).
  A row is **hidden when its value or any block is empty / null / undefined /
  NaN** (no more null-check boilerplate). `{value, max}` objects show as
  `value/max`. **Helpers** (v0.28.0, owner: "make the expression easier",
  so common rows are one short call; listed with live examples on the
  editor's **Helpers** tab, click to insert; v0.28.1: the tab button's action
  was named "tab", which ApplicationV2 handles itself, so it didn't click): `hp(@attributes.hp [, "nice"])`
  (value, "(temp)", Ø at 0, the owner's "Nice" at 69 %),
  `hpStatus(@attributes.hp [, "nice"])` (Healthy / Grazed / Bloodied /
  Critical / Ø), `dc(@saves.will.value)` (+10, hidden when missing),
  `speed("fly")` (PF2e, hidden when absent), `fraction(@x)`, `distance()`
  (from your controlled token, else your character's: PF2e
  `token.distanceTo`, else edge-to-edge with elevation and the scene's
  diagonal rule, adjacent = 1 square), `signed(n)`. The presets use them
  (`{hp(@attributes.hp, "nice")}` instead of the five-line expression). Assignments stay
  in a per-evaluation sandbox (no globals leak).
- **Presets** (Q24, from the owner's TTA exports): PF2e (HP with temp and the
  owner's "Nice" at 69 %, AC, hero points, save/Perception/Stealth/Athletics
  DCs for the GM, speeds, HP status words for players on NPCs, distance),
  SWADE (bennies, parry, toughness, pace, fly, distance with ⚔️ when
  adjacent, power points, size, scale), Wrath & Glory (wounds, shock, faith,
  defence, resilience, speed, passive awareness, corruption, wrath), and a
  generic one. Pro-only icons swapped for Free look-alikes.
- Hidden while a drag on the map is in progress (v0.28.0: it froze in place).
- Never leaks: only tokens this user can see; rows filtered per user.
  Values are written by the GM and run on every client (as TTA's functions).
- Settings: border colour · text size (per player).
- **Editor** (v0.27.0, GM; "Edit rows" in the feature's card): one line per
  row: drag handle, icon field with live icon, colour, value (monospace,
  grows with the text), who sees it, actor-type chips (all on = no filter),
  **live preview** of the value on the selected token (— = hidden), delete.
  **Data browser** (side panel): every value in the selected token's system
  data with live values, searchable by path or value; clicking one inserts
  `@path` at the cursor of the row being edited (inside a `{…}` block, else
  as a new `{@path}` block; a bare path into an empty value). **Import from
  Token Tooltip Alt** (Q26): paste its export; its lists are merged into rows
  (`tta-import.js`: GM-only → gm, owned → owner, owned + friendly →
  friendly, also neutral/hostile → all, players-only → others; types from
  where each appeared). **Reset to defaults**. Nothing is saved until Save.

#### Pathfinding — `pathfinding`
*Replaces Wayfinder.* ✅ v0.28.0 · square grids only (Q27).
- While dragging a token, Foundry's ruler shows the **cheapest route around
  walls and closed doors** (open doors are passable); your own waypoints are
  kept and each leg is routed. Wraps `CONFIG.Token.objectClass.prototype.
  findMovementPath` with V14's `{ result, promise, cancel }` contract
  (Wayfinder's, MIT, was the reference). Off on gridless/hex scenes and when
  Foundry asks to ignore walls; if no route is found, Foundry's own result is
  used. v0.28.1: when Foundry asks to ignore cost (likely what it does for the
  GM: v0.28.0 routed for players but not the GM), walls still count and
  only terrain is ignored; a skipped search logs its reason once.
  v0.28.3: the owner's debug log showed routes being found but V14 still
  moving straight, so the route is now computed right away and returned as
  `result` (plus a resolved `promise`), with every waypoint complete.
  `CONFIG.debug.lucd20Pathfinding = true` logs each call and result.
  v0.28.4: worked on new scenes but not older ones (owner). Likely cause: big
  older scenes ran past the 60 000-step limit and fell back to Foundry's
  straight path. The search now uses typed arrays with per-square wall /
  explored caches (limit 400 000); squares are mapped through Foundry's grid
  origin. 150 × 150 scene round a long wall ≈ 75 ms in the harness.
  v0.28.6: the owner's log showed straight routes on the old scene: the wall
  test missed walls running exactly through square centres (freehand walls).
  Now inclusive, and when a wall is near a move Foundry's own collision test
  (`CONFIG.Canvas.polygonBackends.move.testCollision`) decides too, so routes
  agree with what Foundry blocks (doors, levels, one-way walls). Wall results
  are kept for the whole drag (next mouse move on a big scene ≈ 85 ms).
- **Per-player toggle** in Token controls (route icon), on by default (Q26).
- **Cost** (owner, Q29): steps per the scene's diagonal rule (PF2e 5/10/5
  with the parity carried from the movement history); **difficult terrain**
  (regions with a movement-cost behaviour; system behaviours that mark
  difficult terrain) costs its multiplier (+0.25 so equal routes avoid it) —
  **hold T** while dragging to ignore terrain; squares **next to a visible
  enemy** (opposite disposition, not defeated; no reach/reaction logic, on
  purpose) cost +4 squares to pass through, except the destination —
  only while **Q is held** (v0.39.0: swapped at the owner's request; before,
  Q switched this off). Only tokens this user can see count, so nothing
  leaks. Note: T is also Foundry's target key.
- **Players only route through explored or visible areas** (Q28):
  `canvas.fog.isPointExplored` if V14 has it, else the explored fog texture is
  read once per drag (Wayfinder's approach), plus what's visible now. The GM
  routes anywhere.
- Plain-JS A* with a binary heap on grid cells (state = cell + diagonal
  parity), token footprint, walls in a bucket grid (a wall end on the move
  blocks too, so diagonals can't slip through corners), collinear points
  dropped. Cached per drag; rebuilt on wall/region/token changes. 60 × 60
  maze ≈ 25 ms in the harness (v0.28.4).
- Settings: avoid difficult terrain · avoid squares next to enemies ·
  players: explored areas only (all on).

#### Paused Movement Notice — `pauseNotifier`
*Replaces Pause Notifier.* ✅ v0.17.0 · GM only, no options.
- V14 already stops a player's move while paused and shows "You cannot take
  this action while the game is currently paused." (owner checked). That
  notification is replaced by **"Game's Paused"** floating up from the
  token(s) the player tried to move (their controlled tokens), **seen by
  everyone** who can see the token (Q9). Other paused warnings (nothing
  controlled) are left alone. The GM is never blocked.
- Shared movement block (`scripts/core/movement-block.js`): move rules run once
  in `preMoveToken`; the floating text is broadcast and drawn only on clients
  that can see the token; repeated attempts don't stack texts.

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

### 🚪 Doors

Shared helper: `scripts/core/doors.js` (V14 `foundry.canvas.containers.DoorControl`,
the door icons on the canvas). Smart Doors has no license, so this is our own
code.

#### Door Icon Size — `doorIconSize`
*Replaces Smart Doors (icon size).* ✅ v0.21.0 · per player, on by default.
- Door icons are scaled to grid size × factor × 0.4 (Foundry draws them 40 px
  whatever the grid), centred on the door. Default factor **1.5**, range 1–3
  (Q19). The whole icon container is scaled (art, background, border, hit
  area). Wraps `DoorControl#draw` and `#reposition`; changes apply at once.

#### Secret Doors — `secretDoorHighlight`
*Replaces Smart Doors (secret door tint).* ✅ v0.21.0 · GM only.
- Secret door icons get a **thin purple ring** and a **small eye-slash badge**
  in the bottom-right corner. Icon only, the wall isn't marked (Q18).
  v0.22.0: toned down (no glow, no tint); v0.21.0 was too distracting.
- **Ask before opening** (option, on, v0.22.0): a GM click that would open a
  closed secret door asks for confirmation first, so a misclick doesn't spoil
  the surprise (owner's request). Closing, locking etc. aren't asked.

#### Locked Door Alert — `lockedDoorAlert`
*Replaces Smart Doors (locked door alert).* ✅ v0.21.0 · no options.
- A player left-clicking a locked door posts a **public** message
  "**Valeros** tries the door: it's locked." (their controlled token's actor,
  else their character, as speaker). **10 s cooldown per player per door**
  (Q17). Not while paused. Foundry's own handling (lock sound) still runs.
- GM: hovering the message highlights the door icon.
- Wraps `DoorControl#_onMouseDown`.
- **PF2e: lock options** ✅ v0.22.0 (`scripts/systems/pf2e/door-locks.js`,
  options "Lock options" and "Unlock on success", both on):
  - The wall's settings get a **Lock** section after the door type: a
    description and the ways to open it, each with a DC: **Force Open**
    (Athletics), **Pick a Lock** (Thievery, thieves' toolkit needed,
    successes needed), **Other check** (any skill + label). Saved with the
    wall's own form in `flags.lucd20-automations.lock`.
  - A player clicking such a locked door posts a **card** instead of the
    plain line: description, one row per way with the **best active party
    member on the scene** ("Best: Amiri +12"; Pick a Lock only counts those
    with a toolkit), progress ("1 / 2 successes"), "Jammed (−2)", and a
    **Try** button. Rows are drawn on each client from the live wall data;
    DCs only for the GM unless PF2e's "show DCs" is on.
  - **Try** rolls for the player's own character (controlled token, else
    their character, else a choice); the GM picks anyone (best preselected)
    (Q21). Force Open and Pick a Lock use PF2e's own actions
    (`game.pf2e.actions.forceOpen/pickALock`), so crowbars and feats apply;
    other checks roll the statistic.
  - The outcome goes to the active GM's client, which updates the door and
    posts one line: Force Open success → **opened and turned secret** ("the
    players broke it": it can't be closed; owner's call), critical success →
    opened intact, critical failure → **jammed** (−2 circumstance to later
    Force Open tries); Pick a Lock → counts successes, unlocks at the
    target; Other check → unlocks (Q20).

### 🎬 Scenes & Sound

#### Scene Navigation — `sceneNavigation`
*Replaces part of Monk's Scene Navigation.* ✅ v0.18.0 · GM only.
- **Left-click views** the scene in the Scenes sidebar (V14 opens its
  settings; owner checked). Modified clicks (Shift/Ctrl/Alt) and right-click
  stay Foundry's; Configure is in the right-click menu.
- **Navigation toggle**: a compass icon on each scene, bright when it shows in
  the navigation bar, dim when not; click toggles `navigation`.
- **Collapse during combat**: on combat start the navigation bar collapses on
  every client; it re-opens when the last combat ends, only if we collapsed
  it (`ui.nav.collapse()` / `expand()`).
- Settings: left-click views · navigation toggle · collapse during combat
  (all on).
- v0.20.0: the compass is a direct child of the scene row, placed over its
  right edge with CSS (V14's rows are thumbnails; it didn't show and
  flickered in v0.19.0).
- v0.28.6: the compass sits on the **top-left corner of the scene's
  thumbnail** (owner's request).
- v0.28.7: the compass switches at once on click (no fade; the server update
  follows).
- v0.19.0: V14's scene name is an action link and Foundry handles the
  click first, so the left-click and the compass are now handled by a
  capture-phase listener on the document (before Foundry); pointer events on
  the compass are swallowed too.

#### Scene Palette — `scenePalette`
*Replaces part of Monk's Little Details.* ✅ v0.18.0 · GM only, no options.
- Scene settings → Basics → Current Level → **Background color** (V14, owner
  checked): five swatches from that level's background image under Foundry's
  color picker (the custom pick, Q10). Click sets the color.
- The fields are found by name (`…background…color`, `…background…src` with
  the same prefix, else the scene's own background image).
- Colors: image drawn at 64 px on a canvas, k-means (farthest-point start, 10
  passes), most common first. Cached per image.
- Look (v0.19.0): 22 px rounded squares in the picker's row, after it.

#### Hidden Track Names — `hiddenTrackNames`
*Replaces part of Monk's Sound Enhancements.* ✅ v0.19.0 · GM only, no options.
- Players see **"Unknown track"** instead of a track's name in the Playlists
  sidebar and its "Currently playing" list (owner: the only places).
  **Playlist names stay visible** (Q11). Tooltips and labels are scrubbed too.
- The GM gets an **eye icon** on each track (both lists), placed beside
  Foundry's own track icons so rows keep their height (v0.20.0): slashed =
  hidden, green eye = revealed. Saved as a flag on the PlaylistSound (`revealed`);
  tracks are hidden by default.
- Display only: the real name is still in the player's client data. Masking
  runs on every sidebar change (dom-watch), so Foundry's re-draws don't show
  the name.

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
| 12 | Next-pass prep: catalog entries + Scenes & Sound category, Turn Announcer rounds, Lock Combat Toggle | ✅ v0.14.0 |
| 13 | Defeat at 0 HP, Hidden Until Started | ✅ v0.15.0 |
| 14 | Combat Tracker Window | ✅ v0.16.0 |
| 15 | Combat Movement, Paused Movement Notice (shared movement block) | ✅ v0.17.0 |
| 16 | Active Effect Highlight, Scene Navigation, Scene Palette | ✅ v0.18.0 |
| 17 | Hidden Track Names | ✅ v0.19.0 |
| 18 | Describe | ✅ v0.20.0 |
| 19 | Doors: Door Icon Size, Secret Door Highlight, Locked Door Alert | ✅ v0.21.0 |
| 20 | PF2e door locks; secret doors toned down + ask before opening | ✅ v0.22.0 |
| 21 | Riding | ✅ v0.23.0 |
| 22 | Token Scatter | ✅ v0.24.0; badge dropped, flyers spread + Flying Tokens v0.25.0 |
| 23 | Token Tooltip: display + presets | ✅ v0.26.0 |
| 24 | Token Tooltip editor, data browser, TTA import | ✅ v0.27.0 |
| 25 | Pathfinding; tooltip helpers + hide while dragging | ✅ v0.28.0 |
| 26–28 | Merge D&D 4e Combat Automation | §8 |
| 29–30 | D&D 4e Skill Challenges | ✅ v0.31.0, v0.32.0 (§9) |
| 31 | Scene Audit | ✅ v0.33.0 (§10) |

---

## 5. Open questions

- Next pass: see §6.3 (all answered).
- Third pass: see §7.3 (all answered).
- D&D 4e merge: see §8.3.
- Skill Challenges: see §9.4.

**Parked** (owner, 2026-11-18: "Dont remove those", back to PF2e first):
1. 4e monster HUD: roll used recharge powers by itself at the start of the
   monster's turn (§17.1, Q156).
2. 4e HUD: a Skills tab, after seeing the HUD in play (§17, Q149).
3. 4e New Player Tips: more classes and monster powers, as sheets come in
   (§17.3–17.6).
4. 4e tips: track Majestic Word's once-per-round limit (§17.5).
5. Shadow of the Demon Lord support (targets table).
6. The open (verify) items for the owner to check in Foundry.
7. Creature Scale for 4e, from the DMG's monster-building numbers (§18).

---

## 6. Next pass

Features taken from more of the owner's current modules. Each one replaces
only the parts the owner uses: Monk's modules have far more options than
needed ("prime example of too many settings"), so keep each card to a switch
and a few options with good defaults.

Behavior marked **(verify)** is from memory of Foundry V12–V13 and must be
checked against V14. Foundry's API docs are not reachable from the dev
container, so when unsure, ask the owner to check in Foundry's console
(F12) instead of guessing.

### 6.1 Features

#### ⚔️ Combat

##### Combat Tracker Window
✅ Built in v0.16.0; spec moved to §3 (Combat).

##### Hidden Until Started, Defeat at 0 HP
✅ Built in v0.15.0; specs moved to §3 (Combat).

##### Lock Combat Toggle, Turn Announcer new rounds
✅ Built in v0.14.0; specs moved to §3 (Combat).

##### Combat Movement
✅ Built in v0.17.0; spec moved to §3 (Combat).

#### 💬 Chat

##### Describe
✅ Built in v0.20.0; spec moved to §3 (Chat).

#### 🗺️ Tokens & Placement

##### Paused Movement Notice
✅ Built in v0.17.0; spec moved to §3 (Tokens & Placement).

##### Active Effect Highlight
✅ Built in v0.18.0; spec moved to §3 (Tokens & Placement).

#### 🎬 Scenes & Sound (new category)

##### Scene Navigation, Scene Palette
✅ Built in v0.18.0; specs moved to §3 (Scenes & Sound).

##### Hidden Track Names
✅ Built in v0.19.0; spec moved to §3 (Scenes & Sound).

### 6.2 Notes for building

- Add every new feature to `scripts/core/catalog.js` `FEATURE_ORDER` (and
  the `scenes` category to `CATEGORIES`) first, with lang names, so the
  layout shows greyed out from phase 12.
- Combat Movement and Paused Movement Notice share one movement block
  (a small core helper, e.g. `scripts/core/movement-block.js`), so a move is
  checked once and gets one message.
- UI inside Foundry's own windows (Token HUD, sidebars, Scene settings,
  combat tracker) goes through `core/dom-watch.js`.
- Test with `tools/harness/` (see its README) before each release.

### 6.3 Questions for the owner

Ask these before building the feature they belong to. Each has a
recommended default.

| # | Feature | Question | Recommended |
|---|---|---|---|
| Q1 | Defeat at 0 HP | Hide dead NPC tokens when? | ✅ Decided: as soon as they go down. Loot Pile must work with hidden NPCs. |
| Q2 | Describe | GM only, or players too? | ✅ Decided: GM only. |
| Q3 | Describe | How long does the text stay? | ✅ Decided: 3 s + 0.3 s per word, between 4 and 30 s. Click to dismiss (the GM's click dismisses it for everyone). Right-click entry goes in Foundry's chat menu. |
| Q4 | Turn Announcer | New-round message as a separate divider card, or as a line on the first turn card of the round? | ✅ Decided: separate thin divider card, on by default. |
| Q4b | Lock Combat Toggle | Can the GM get past the lock from the HUD? | ✅ Decided: Shift+click removes (GM only). Owner confirmed V14's HUD button removes all selected combatants and `TokenDocument#toggleCombatant` exists. |
| Q5 | Combat Tracker Window | Owner checks in V14: does the tracker already follow the current turn and keep the next combatant visible? | ✅ Yes: "follow the turn" not built. |
| Q6 | Combat Tracker Window | Pop out for players too, or only the GM? | ✅ Decided: everyone, per-player setting, on by default. |
| Q7 | Hidden Until Started | Which combatants are hidden before the start? | ✅ Decided: only combatants whose token is hidden. |
| Q7b | Defeat at 0 HP | Undo when healed above 0? | ✅ Decided: yes (option, on). |
| Q8 | Combat Movement | Where is the manual toggle? Do tokens not in the combat move freely? | ✅ Decided: button in the combat tracker header (GM); tokens not in the combat move freely. |
| Q9 | Paused Movement Notice | Who sees "Game's Paused": only the player who tried to move, or everyone? | ✅ Decided: everyone (who can see the token). |
| Q10 | Scene Palette | Are the 5 swatches taken from the level's background image (like Monk's)? Or are they fixed palettes? | ✅ Decided: from the image, plus Foundry's color picker. |
| Q11 | Hidden Track Names | What do players see instead of the name? Also hide the playlist name? | ✅ Decided: "Unknown track"; playlist names stay visible. |

---

## 7. Third pass

Five more modules, taken from the owner's list. Same rules as §6: replace
only what the owner uses, a switch and a few options per card, good
defaults. Behavior marked **(verify)** must be checked in Foundry V14 by the
owner before it is built.

Source notes (from reading each module's code, Nov 2026):

| Module | License | What matters for us |
|---|---|---|
| Rideable (Saibot393) | MIT | Flags on the mount (rider ids) and rider (offset). Only the GM moves riders, on `updateToken` of the mount, with `move(..., {constrainOptions: {ignoreWalls, ignoreCost}})` and an option flag to avoid loops. Blocks rider moves in `preUpdateToken`. No vision handling; unmount doesn't look for free space. Draw order: `rider.sort = mount.sort + 10` set locally on every client. |
| Smart Doors (farling42) | **none** (all rights reserved): write our own | Overrides `DoorControl#reposition`, wraps `#draw` and `#_onMouseDown` (V14: `foundry.canvas.containers.DoorControl`). Icon size = grid × factor × 0.4. Secret doors only get a grey tint. Locked-door message is public, with no cooldown. |
| Token Tooltip Alt | MIT | Hover overlay (HTML), rows of icon + value. Values by typed data path / mathjs / raw JS; separate lists per GM/player × disposition × actor type; no path browser, no system presets; tooltip is destroyed on pan. |
| Wayfinder | MIT | Wraps one method: `CONFIG.Token.objectClass.prototype.findMovementPath` (V14, async `{result, promise, cancel}`). Plain A* on grid cells (+ elevation layers), own wall geometry, all diagonal rules, square + hex, no terrain costs, optional "explored fog only". WASM isn't needed: maps are 1k–10k cells. |
| Z-Scatter | MIT | Hooks only, no overrides. Moves only the drawing (mesh, border, bars, effects, nameplate) and the hit area, never the document. Overlap = rectangles intersect, **same elevation only**. Push-apart relaxation, no shrinking. |

### 7.1 Features

#### 🗺️ Tokens & Placement

##### Riding — `riding`
*Replaces Rideable (only mounting).*
- A GM marks a token **Rideable** (Q12).
- **Mount**: select your token, **target** the rideable token, press **M**
  (verify that M is free in V14 + PF2e). Your token moves onto the mount,
  **a little inside one of its corners** (Q13), drawn above it, at
  **50 % of its art scale**, at the mount's elevation.
- While riding, the rider can't be moved on its own (shared movement block,
  "Riding: press M to dismount"). When the mount moves, its riders move with
  it (the active GM moves them, `ignoreWalls`/`ignoreCost`, a module option
  so the rule doesn't block it).
- **Dismount**: press M again with the rider selected. It goes to the
  **closest free square it can reach** from the mount (no token there, not
  across a wall: `core/placement.js`), and gets its scale back.
- **Vision from the mount's centre** if V14 lets us move a token's vision
  origin cleanly (verify, Q15); otherwise the rider's own (it sits on the
  mount, so the difference is under a square).
- PF2e: keep "link to actor size" from undoing the scale (Rideable had to
  switch it off while riding).
- Riders are kept on the mount (flag) across reloads; deleting either token
  cleans up.

##### Token Scatter — `tokenScatter`
*Replaces Z-Scatter.* Per player.
- Tokens that overlap **at the same elevation** spread apart a little on
  screen so each can be seen, clicked and targeted. Only the drawing moves
  (art, border, bars, effects, name, hit area); positions are not changed.
  Not while a token is moving. Dead tokens (defeated) don't spread (option).
- **Flying tokens over others** (different elevations, Z-Scatter leaves them
  stacked). Idea, Q30:
  - A small **stack badge** (layers icon + count) on the top token of a
    stack. Hovering it fans out the stack for a moment; clicking it opens a
    small strip of portraits under the token: click one to select it
    (if yours) or target it.
  - Holding a key fans out **every** stack on screen while held.
  - No parallax or per-frame work: the badge is only recomputed when tokens
    move.
- Players only ever see (and count) tokens they can see.
- Settings: spread amount · include different elevations in the badge ·
  hold-to-fan key.

##### Token Tooltip — `tokenTooltip`
*Replaces Token Tooltip Alt, with a much simpler setup.*
- Hovering a token shows a small panel next to it: rows of **icon + value**
  (Font Awesome icons). Holding a key shows it on every visible token. It
  follows pan and zoom.
- **One list of rows** (not per disposition × role × actor type). Each row:
  icon, value, color, **who sees it** (GM / owner / everyone) and **on what**
  (PCs / NPCs / all) (Q22).
- **No paths to type.** "Add row" opens a picker:
  - **Presets** for the system (PF2e: HP, temp HP, AC, Fort/Ref/Will,
    Perception, Speed, Level, Hero Points, Focus, Class DC, Spell DC,
    conditions, shield HP…), with a sensible icon and color.
  - **Browse data**: a searchable tree of the selected (or a chosen) token's
    actor data with **live values** ("AC 18", "hp.value 31"); click a value
    to use it. The path is filled in for you.
  - Simple formats instead of expressions: number, `value / max (+temp)`,
    modifier (`+7`), list (conditions), yes/no.
- Never leaks: no tooltip on tokens the player can't see; NPC rows are GM-only
  unless marked "everyone"; PF2e hidden names respected.
- Editor in the lucd20-loot-app style: drag to reorder, preview on the
  selected token.

##### Pathfinding — `pathfinding`
*Replaces Wayfinder.*
- While dragging a token, Foundry's own ruler shows the **shortest path around
  walls** (and closed/locked doors) instead of a straight line. Your own
  waypoints are kept; each leg is routed.
- One wrap: `findMovementPath` on the token class (verify its V14 signature
  in the console before building). Plain-JS A* with a binary heap on grid
  cells, the token's footprint, the scene's diagonal rule; walls from a
  simple segment index rebuilt on wall changes. Searches can be cancelled.
- **Players only route through explored or currently visible areas**, or the
  path would reveal unexplored corridors (Q28, verify how to read V14's fog).
- Off on gridless scenes and when Foundry asks to ignore walls.
- Toggle in Token controls (per player, Q26). Square grids first (Q27).
- Difficult terrain: not in the search at first; Foundry's ruler still shows
  the real cost of the path (Q29).

#### 🚪 Doors (new category)

##### Door Icon Size — `doorIconSize`
*Replaces Smart Doors (icon size).* Per player.
- Door icons scale with the grid, so they don't get tiny when zoomed out.
  Default 1.5 × Foundry's size (range 1–3). Wraps `DoorControl#draw` and
  `#reposition`; switching it off redraws the doors.

##### Secret Door Highlight — `secretDoorHighlight`
*Replaces Smart Doors (secret doors), but more visible.* GM only.
- Secret door icons get a **purple ring and glow** (PF2e's "secret" color)
  and a small **eye-slash badge**, so they can't be mistaken for normal doors
  (Q18). Only the GM sees secret door icons anyway.

##### Locked Door Alert — `lockedDoorAlert`
*Replaces Smart Doors (locked door alert).*
- A player clicking a locked door posts **"Valeros tries the door: it's
  locked."** (their character as speaker, the door's lock sound). Hovering
  the message highlights the door (GM).
- **Cooldown**: one message per player per door every 10 s (Q17).
- **PF2e: lock options** (`doorLocks`, PF2e only). In the wall's settings
  (door section), the GM adds a **description** and **ways to open it** (Q20):
  - **Force Open** (Athletics; PF2e's own action, so the crowbar −2 rule
    applies), DC.
  - **Pick a Lock** (Thievery; needs thieves' toolkit), DC, successes needed.
  - **Other check**: any skill, DC, label (e.g. "Dispel the seal", Arcana).
  Then the locked-door message becomes a **card**: description, one button
  per way, and on top the **party member best at each** ("Best: Amiri,
  Athletics +12") (Q21). Rolls use PF2e's actions / checks with the DC (shown
  or hidden per PF2e's own "show DCs" setting). On a success the GM's client
  unlocks the door (Force Open also opens it) and the card says so.

### 7.2 Build order

| # | Phase | Notes |
|---|---|---|
| 19 | Doors: Door Icon Size, Secret Door Highlight, Locked Door Alert | ✅ v0.21.0 (specs in §3) |
| 20 | PF2e door locks (wall settings, card, best party member, unlock) | ✅ v0.22.0 (spec in §3) |
| 21 | Riding | ✅ v0.23.0 (spec in §3) |
| 22 | Token Scatter + stack badge | ✅ v0.24.0 (spec in §3) |
| 23 | Token Tooltip: display + PF2e presets | ✅ v0.26.0 (spec in §3) |
| 24 | Token Tooltip: editor + data browser | ✅ v0.27.0 (spec in §3) |
| 25 | Pathfinding | ✅ v0.28.0 (spec in §3) |

Each phase: ask its questions → build → harness test → minor version → owner
tests.

### 7.3 Questions for the owner

| # | Feature | Question | Recommended |
|---|---|---|---|
| Q12 | Riding | Which tokens can be ridden, and where is the switch? | ✅ Decided: as recommended. |
| Q13 | Riding | Where does the rider sit? Several riders? | ✅ Decided: as recommended. |
| Q14 | Riding | Who can mount, from how far? | ✅ Decided: as recommended. |
| Q15 | Riding | Vision from the mount's centre (verify in V14 at build time). | ✅ V14 has `Token#_getVisionSourceData`: built. |
| Q16 | Riding | Do riders move together with the mount (same animation) or jump at the end? | ✅ Decided: as recommended. |
| Q17 | Locked Door Alert | Public message or whisper to the GM? Cooldown? | ✅ Decided: public; 10 s per player per door. |
| Q18 | Secret Door Highlight | Purple ring + glow + eye-slash badge OK? Also mark the wall itself? | ✅ Decided: icon only, to try. |
| Q19 | Door Icon Size | Default factor? | ✅ Decided: 1.5, per player, range 1–3. |
| Q20 | Door locks (PF2e) | Ways to open: Force Open, Pick a Lock, Other check. Anything else? Auto-unlock on success? | ✅ Decided: those three; auto-unlock (option). Force Open also turns the door secret ("players broke it"). |
| Q21 | Door locks (PF2e) | Who rolls from the card? Who counts for "best"? | ✅ Decided: as recommended. |
| Q22 | Token Tooltip | One list with per-row "who sees it / on what" OK? | ✅ Owner sent screenshots of the look; one list with who/types built. |
| Q23 | Token Tooltip | When does it show? Which key shows all? | ✅ Hover (Alt optional, not built). |
| Q24 | Token Tooltip | PF2e default rows and who sees them? | ✅ Ported from the owner's TTA exports (PF2e, SWADE, Wrath & Glory). |
| Q25 | Token Tooltip | No expressions at all? | ✅ Owner is fine with expressions if intuitive: TTA-compatible expressions + data browser (phase 24). |
| Q26b | Token Tooltip | Import from Token Tooltip Alt? | ✅ Yes (built v0.27.0). |
| Q26 | Pathfinding | Always on, or a per-player toggle in Token controls? | ✅ Decided: toggle. |
| Q27 | Pathfinding | Do you use hex maps? | ✅ No: square grids only. |
| Q28 | Pathfinding | Players route only through explored/visible areas? | ✅ Decided: explored only. |
| Q29 | Pathfinding | Avoid difficult terrain when searching? | ✅ Decided: yes when there's a better path; also avoid squares next to enemies; hold Q to ignore enemies, T to ignore terrain. |
| Q30 | Token Scatter | Flyers: stack badge + strip of portraits + hold-to-fan key OK? | ✅ Built with key Z (v0.24.0), then dropped by the owner (v0.25.0): flyers just spread too, plus Flying Tokens. |
| Q31 | Token Scatter | Per player, on by default? | ✅ Decided: yes. |

---

## 8. Merge: D&D 4e Combat Automation

The owner's separate module `LucD20/dnd4e-combat-automation` (v0.13.0, ~6 900
lines, EN + pt-BR) moves into this one, so there is one module to install.
The old repo stays as it is; the owner disables the old module once the
merged one works.

What it has (from its code and README):
- **Class features**: Hunter's Quarry, Warlock's Curse (+ Star Pact's Fate
  of the Void), Barbarian rages (Bloodhunt Rage, Pressing Strike), marks
  (Misdirected Mark, `api.applyMark`), Furious Assault, Prime Shot,
  Bloodhunt, Defensive Mobility, Shadow Walk, Rampage, Half-Orc Resilience,
  Words of Friendship, on-hit effects (Vicious Mockery, Dread Word, Curse of
  the Dark Dream, Inspiring Shout, Great Cleave), temp-HP features,
  conditional damage (Hellish Rebuke, Dire Radiance, Elven Accuracy, Fox's
  Cunning), prone/shift riders read from power text.
- **Combat**: cover (corner to corner, walls / enemy creatures) + a
  per-player line preview; action tracker (standard, move, minor, immediate,
  opportunity; pips in the combat tracker, Combat Tracker Dock, a floating
  panel with the basic actions); automatic move-action spending; opportunity
  attack cards; triggered-power cards; damage application from damage cards;
  click-to-move squares for shifts and push / pull / slide; charge.
- **Display**: readable roll breakdowns in chat, skill-check parts, modified
  defences highlighted on sheets (system + Fox's sheets), automation /
  translation symbols on powers (GM sets them world-wide), token badges for
  quarry / curse / mark.
- **GM tools**: monster text overrides (import / export a .json; macro
  `api.translateExisting`).
- **Language**: pt-BR translation; per-user "4e game language" (system +
  module strings in another language than Foundry's UI; wraps
  `i18n.setLanguage` at init).
- Its own socket (`module.dnd4e-combat-automation`), settings, keybindings
  (action panel, cover preview), API on `game.modules.get(...).api`, styles.

### 8.1 Plan

- **Code**: `scripts/systems/dnd4e/` keeps its folder structure (actions,
  movement, reactions, features …) so the owner's mental map stays; only
  the plumbing changes:
  - `MODULE_ID` → this module; its socket → `core/socket.js`
    (`executeAsGM`, `broadcast`); its `setting(key)` helper reads our
    feature switches, so everything can be switched off without a reload
    (its code already checks the setting each time it acts).
  - Hooks it registers stay registered but gated by those switches.
  - Styles → `styles/dnd4e.css` (its own look kept for the action panel,
    cards and pickers; only new windows use the lucd20-loot-app look).
  - API → `game.modules.get("lucd20-automations").api.dnd4e` (`applyMark`,
    `computeCover`, `drawCoverPreview`, `openActionPanel`,
    `translateExisting`); README macros updated.
- **Settings**: a new **⚔️ D&D 4e** category (only in dnd4e), few cards
  with the old switches as options (Q33).
- **Language**: its strings go into `lang/en.json` under their own root
  `DND4EAUTO.*` (kept as is, so ~400 strings and their code stay untouched;
  the cards' names are under `LUCD20.Feature.dnd4e*`) and a new
  `lang/pt-BR.json` with the Portuguese (Q34).
- **Data**: a one-time GM migration copies the old module's world data
  (monster texts, power-level marks) and live flags (quarry / curse / mark
  effects, combatant action state) to this module's scope (Q35).
- **Overlaps with existing features**: none conflict. Its 0-HP handling only
  ends quarry / curse (our Defeat at 0 HP marks defeated); its move-action
  spending works with Combat Movement; its opportunity cards complement
  Pathfinding's "avoid squares next to enemies" (Q36).
- **Tests**: the harness can't run the dnd4e system; a smoke test checks
  everything registers in `?system=dnd4e` and the switches turn hooks off.
  The owner tests in a 4e world.

### 8.1b Done in phase 26 (v0.29.0)

- Code in `scripts/systems/dnd4e/` (same layout, `.mjs` kept); icons in
  `assets/dnd4e/`; styles `styles/dnd4e.css`; docs `docs/dnd4e.md` (its
  README, macros updated).
- `MODULE_ID` is ours, so flags, the power-level data setting and the socket
  channel are this module's. The old socket messages (`op: …`) share our
  channel with ours (`type: …`); each side ignores the other's.
- Startup: our `main.js` calls `Hooks.callAll("lucd20-automations.init")`
  after the feature cards' settings are registered; the 4e code starts from
  there, only in dnd4e (its hooks on `updateActor`, chat messages … would
  otherwise run in other systems too). `api.dnd4e` is added after ours.
- Settings → 13 cards (`cards.mjs`, `SETTING_MAP`): the old `setting(key)`
  helper reads them, so everything switches off without a reload. Debug
  logging: `CONFIG.debug.lucd20dnd4e = true`. Keybindings kept (action panel,
  cover preview), unbound by default. Monster texts: the import / export
  window opens from its card (no extra button in Foundry's settings).
- Smoke test `test28.js`: loads in dnd4e (13 cards, map, API, hooks) and
  nothing of it in PF2e.

### 8.1c Done in phases 27–28 (v0.30.0)

- `lang/pt-BR.json` (registered in `module.json`): the old module's
  Portuguese (`DND4EAUTO`, plus its translations of the dnd4e system and
  Fox's sheet: `DND4E`, `EFFECT`, `Fox4e`), the 4e cards and messages in
  Portuguese. Everything else falls back to English. The "4e game language"
  card (per player, off by default, reload) merges the system's and this
  module's files for the chosen language, as before.
- `migration.mjs`, once (world setting `dnd4eMigrated`), on the active GM:
  old world data (monster texts, power marks) merged in; old world switches
  onto the cards; flags under `dnd4e-combat-automation` copied to ours on
  actors, their effects, tokens, unlinked tokens' effects, combatants and
  chat messages (marked `migratedFrom4e`; old flags left in place). Each
  player's old client options (localStorage) migrate on their own client,
  once. A permanent notification says what moved. On failure it tries again
  next load.

### 8.2 Build order

| # | Phase | Notes |
|---|---|---|
| 26 | Move the code in, plumbing (module id, socket, settings → feature cards, API), styles, EN strings | ✅ v0.29.0 |
| 27 | pt-BR translation + 4e game language | ✅ v0.30.0 |
| 28 | Migration of the old module's data | ✅ v0.30.0 (with 27: both modules can't run together, so the data had to move before the owner switches) |

### 8.3 Questions for the owner

| # | Question | Recommended |
|---|---|---|
| Q32 | Move it in mostly as it is (folder structure, look, behaviour), changing only the plumbing; refactor later only where needed? | ✅ Yes (all of Q32–Q36 as recommended). |
| Q33 | Settings cards in the D&D 4e category (old switches become options): **Class features** (quarry, curse, rage, marks, Prime Shot, class/race/feat rules, temp HP, conditional riders, power riders) · **Cover** (+ per-player line preview) · **Action tracker** (+ auto move actions, panel, warnings, dock pips) · **Opportunity attacks** · **Triggered powers** · **Damage application** · **Click-to-move & charge** · **Readable rolls & skill checks** · **Sheet highlights** · **Power symbols** (automation / translation) · **Token badges** · **Monster texts** (GM) · **4e game language** (per player). OK? | Yes. |
| Q34 | Keep the Portuguese translation (a pt-BR file for the merged module; the rest of the module stays English until translated) and the "4e game language" option? | Yes. |
| Q35 | Migrate the old module's data automatically the first time the GM loads the world (monster texts, power-level marks, current quarry / curse / mark effects, action state)? | Yes, then tell the GM it's done. |
| Q36 | Any overlap you want merged rather than kept side by side (e.g. its opportunity-attack cards and Pathfinding's enemy avoidance, its 0-HP quarry end and Defeat at 0 HP)? | Keep side by side. |

---

## 9. D&D 4e Skill Challenges

A tool to run a 4e skill challenge at the table. The tool is generic and lives
here; the challenges themselves are data on journal pages (the owner's
adventures are in the private `LucD20/lucd20-personal` module: never copy
adventure text into this repo).

### 9.1 Decisions (Q37–Q46, all as recommended)

- **Data**: a normal journal text page with
  `flags["lucd20-automations"].skillChallenge` (format:
  `docs/skill-challenge.md`). The page text is what the GM reads; the flag is
  what the tool runs. Works from the world and from any journal compendium.
- **Running state**: world setting `skillChallenge_runs`, one record per
  started challenge (several at once, survive reloads). A record is only the
  page's uuid, its name, open/secret and a **log**; the tally, uses per skill,
  current DCs and waiting bonuses are replayed from the log, so Undo drops the
  last entry. **No DC and no GM text is stored**: players' clients receive
  world settings. The compendium is never written to.
- **Opening**: "Skill Challenges" button at the bottom of the Journal tab
  (GM): every challenge found, with Start / Continue, open the page, Reset.
- **Rolling**: the GM picks a character and a skill in the runner. The roll
  goes to that character's player if online (else the GM rolls) through the
  system's own `actor.rollSkill`, so readable-roll parts and bonuses apply.
  Only the skill is sent, never the DC. The GM's client judges and counts;
  only the asked player's answer is accepted. Undo, manual + Success /
  + Failure, and an "Other skill" row (any skill, typed DC).
- **Players see**: per challenge. Open = a public card per check ("Stealth:
  Success", what it did, the tally), never a DC. Secret = the card is
  whispered to the GM with the numbers; the player only sees the roll.
- **Rules automated (29)**: DC per skill, primary / secondary, maximum
  successes per skill, DC +N per use, secondary effects (bonus to the next
  check, penalty on a failed check, cancel a failure, nothing). A waiting
  bonus is added by the GM's client when judging (it is not put in the roll).
- **End**: result card to the GM (tally, who contributed, outcome text, XP)
  with **Show players**, which posts the public card (no XP). XP is not
  awarded automatically.
- **Settings**: one card "Skill Challenges" in D&D 4e, `gmOnly`, on by
  default; option "Players see progress by default".
- Code: `scripts/systems/dnd4e/skill-challenge-engine.mjs` (rules, no Foundry
  calls) and `skill-challenge.mjs` (feature, windows, chat). Windows use the
  `lucd20-loot-app` look; styles at the end of `styles/dnd4e.css`. EN + pt-BR.

### 9.2 Build order

| # | Phase | Notes |
|---|---|---|
| 29 | Core: format, list, runner, counting, chat cards, saved state | ✅ v0.31.0; portraits, dice wait, Run button v0.31.1 |
| 30 | Players' window + rolls, hidden skills, group checks, routes, stages, thresholds, editor | ✅ v0.32.0 |

### 9.3 After the owner's first test (v0.31.1)

- **Character picker**: the PCs' portraits in a row (alphabetical); click one
  to choose who rolls. Replaces the dropdown.
- **Dice So Nice**: the GM's client waits for the 3D dice of that roll
  (`game.dice3d.waitFor3DAnimationByMessageID`, at most 12 s) before judging
  and posting the card **(verify)** in Foundry.
- **Run button**: a journal entry with a challenge page gets a title-bar
  button (before ⋮, header structure confirmed by the owner in V14). One
  challenge in the entry: runs it. Several: opens the list.
- "Open the journal page" in the list calls `entry.sheet.render(true,
  { pageId })` **(verify)** that it opens on the right page in V14.
- **Asked for phase 30**: a window for players with the skills and their
  descriptions (never DCs).

### 9.4 Phase 30 (v0.32.0): Q47–Q56, as recommended except Q48

- **Players' window** (Q47–Q49): opens by itself when an open challenge
  starts; a button at the bottom of their Journal tab reopens it while one
  runs (a player who joins later only gets the button). Shows the name, the
  tally and each visible skill with its `description` and a **difficulty
  word** (owner's change to Q48: Easier / Easy / Medium / Hard / Harder, from
  the DC and the challenge's level, or set per skill; can be switched off per
  challenge with `hints`). No DCs, limits, GM notes, stages or thresholds.
- **How players get it**: a second world setting `skillChallenge_public`,
  written by the GM's client with `publicView()` (engine) for open, running
  challenges only. Secret challenges are never in it.
- **Player rolls** (Q50): Roll per skill for their own character; the GM's
  client checks the request (owner, skill visible and not used up, nothing
  else being rolled) and then sends the normal roll request. Per-run switch
  in the runner (hand icon).
- **Hidden skills** (Q51): `hidden: true`; eye button on the runner row.
- **Group checks** (Q52): runner button; a preset from the data or up to
  three typed skills with a DC. Every PC's player picks one of the skills
  and rolls (the GM for absent players). Panel with each result, Skip, Count
  now, Cancel. At least half succeed = 1 success, else 1 failure; or, with
  rule "everyone succeeds" (v0.32.1), one failed check = 1 failure.
- **Routes** (Q53): picked in the runner until the first roll; a route
  overrides fields of listed skills, adds or removes skills.
- **Stages** (Q54): shown in the runner; "Wrong stage −N" sets the modifier
  for the next check, or the penalty is automatic when the stage lists its
  skills. Players don't see stages.
- **Other rules** (Q55): failure thresholds (text whispered to the GM when
  reached), "successes needed" − / + in the runner, and a **modifier for the
  next check** (covers bribes and similar).
- **Editor** (Q56): pencil in the list and the runner, world pages only;
  a form for everything except routes, which are edited as JSON in the same
  window. "New challenge" in the list creates a journal entry and opens it.
- Files: `skill-challenge-shared.mjs`, `-player.mjs`, `-editor.mjs` next to
  the two from phase 29. Tests: `test29.js`, `test30.js`.

---

## 10. Scene Audit — `sceneAudit`

*New, generic (any system).* GM only, off by default, in Scenes & Sound.
Made so the owner can report what is wrong on an imported map without
describing positions in words (Q81–Q87, all as recommended).

- **Mark a problem** (flag tool in the Token controls): each click picks a
  square (click again to take it out), dragging paints, so a mark can have
  any shape (v0.33.1; it was one rectangle). A bar at the top has Done and
  Cancel (Enter / Esc). Then a small dialog asks the kind (missing wall, wrong wall, door,
  token, grid / alignment, other) and a note.
- **Scene Audit** (clipboard tool): the list for the open scene, with show on
  map, edit, remove; Export scenes, Clear all.
- Marks are kept on the scene (flag `audit`) and drawn for the GM only:
  numbered magenta boxes on `canvas.interface`.
- **Export scenes** (v0.33.2, the owner's choice): a window lists every scene
  with a tick box (scenes with marks and the open scene start ticked); Export
  shows the report as text with Copy and Download file. Text on purpose: the
  owner pastes it into a message. `format: "lucd20-scene-audit"`, version 2,
  one line per scene. Per scene: name, image, grid, the marks, and the
  scene's walls, doors, tokens, notes and lights as they are now, so
  hand-made corrections in Foundry can be copied back into a scene's source.
  Walls and tokens are short arrays (the `about` field names the columns).
  Positions are in squares from the top-left corner of the map image
  (padding is taken out).
- Code: `scripts/features/scene-audit.js`. Test: `test31.js`.

---

## 11. NPC Health Bars — `npcHealthBars`

*New, generic (any system).* GM only, **on by default** (the owner wants this
as the standing default), in Tokens.

- A token placed for an actor no player owns gets `displayBars` "Always for
  Owner" (`preCreateToken`), whatever its prototype token says. The GM always
  sees enemy hit points; players never do, since they do not own the token.
- Tokens already on a scene (including those that arrive inside an imported
  scene) and tokens of player-owned actors are not touched. Content the owner
  ships (lucd20-personal) sets the same mode in its own data.
- Code: `scripts/features/npc-health-bars.js`. Test: `test32.js`.

---

## 12. Loot Pile: claims and coins (phase 33) — `lootPile`

*Changes the Loot Pile window (§ Loot Pile above stays true for "Loot the
fallen" and how a pile is made).* PF2e first; D&D 4e coins and its Party
Stash come in a later pass (Q89, Q90: 4e coins are numbers on the actor, the
owner wants them as items there). Mockup: `docs/mockups/loot-claims.html`
(third version approved). Decisions Q88–Q103.

- **Players ask, the GM hands out.** A player's row has **Claim** (for the
  character in "Claiming for"; a stack asks how many, Shift = all) and
  **Party Stash**. Their own request shows on the button ("Claimed,
  waiting…", "Stash, waiting…"); clicking it again takes it back. Nothing
  moves and nothing is said in chat until the GM confirms.
- **Everyone sees who asked**, on the one row: the claimers' tokens (name on
  hover, your own ringed) and a stash icon with the number of stash requests
  (names on hover). Row colour: plain = nobody, orange = goes to the
  claimer(s), red = contested, blue = only stash requests.
- **Rule (owner):** one claim wins over any number of stash requests. Two or
  more claims are a contest, unless a stack has enough for all of them (one
  potion each of two).
- **GM's row:** nobody asked → **Give to…** (pick a character) and **Party
  Stash**, at once. Asked → one wide button (**Give to Ezren**, **Send to
  Stash**, or **Who gets it?**) and ✗ to refuse (clears the requests).
  **Approve all (n)** does every row that is not contested.
- **Who gets it?** opens when the GM clicks it, for the GM and the claimers
  only: the item (its description, never for a player while it is
  unidentified; a button opens the item), the claimers, and for the GM
  "Give to: A | B | Party Stash". The GM closing it leaves the claims.
- **A player's "Send all to Party Stash"** only adds stash requests; the GM's
  does it.
- **Coins** are one row at the top (totals), not item rows. GM only:
  **Split evenly** (tick the characters; *Normal split* = each kind of coin
  as it is, *Convert coins* = same value for everyone in the fewest coins;
  the preview shows each character's coins and what is left) and **Custom
  split** (a number per character and coin, "Left to give" on top, *Convert
  coins* counts by value). Whatever is left goes to the Party Stash.
  Setting **Highest coin when converting** (system's highest / pp / gp).
  Characters: PF2e = the active party's members; otherwise every
  player-owned character.
- Chat (if "announce"): "Ezren took Dogslicer.", "Ring went to The Party.",
  "Coins split: Amiri and Ezren each get 1 gp 5 sp. 2 cp went to the Party
  Stash."
- Data: requests are an array on the pile (flag `claims`: itemId, userId,
  kind, actorUuid, quantity), written by the GM's client on a player's
  request (`lootPile.request`, `lootPile.requestAll`); flag `deciding` names
  the item "Who gets it?" is open for. Every transfer is the GM's own click.
- Coin arithmetic: `scripts/core/coins.js`. A system's adapter gives
  `denominations`, `coinsOf`, `addCoins`, `removeCoins`, `characters`
  (`scripts/systems/pf2e/loot-pile.js` uses `actor.inventory.addCoins` /
  `removeCoins(…, { byValue: false })`). No denominations = no coins row.
- Test: `test11.js` (phases 10 and 33).
- (verify) in Foundry: PF2e 8.7 adds/removes coins as expected on
  characters, the party and the pile; the item description in "Who gets it?";
  a player's window updating when another player claims.

**v0.36.0 (owner's feedback after testing 0.35.0):**

- **Combat ends:** the game is paused while the GM reviews "Loot the fallen"
  (only if it was running; resumed after), and every other client shows
  "Looting the fallen…" (`lootPile.looting` broadcast). When the pile is made
  its window opens for everyone (`lootPile.open`); the pile stays on the map.
- **Approve all** is one batch (`handOut`: one write per kind and actor) and
  one chat message ("Loot handed out:" and a line per character). With
  nothing asked the button reads **Open to everyone**.
- **Open pile:** approving (or opening) sets flag `open`. From then on a
  player's row has **Take** and **Party Stash** that act at once
  (`lootPile.take`), no GM step. Rows that still have requests (a contest)
  keep waiting for the GM. Coins are still the GM's to split.
- **Claimer tokens** use the token's picture as the token shows it: the
  ring's subject texture if there is one, at the token's scale (texture scale
  × ring subject scale, capped), standing out of the circle.
- Riding: the Rideable button is in the Token HUD's left column.

**v0.36.1:** "Who gets it?" has the names above the pictures, and a scaled-up
token keeps the room it needs. The GM's footer button is **Approve (Party
Stash)**: what was claimed goes to the claimers, everything nobody claimed to
the Party Stash, contested rows wait (it replaces the GM's "Send all to Party
Stash"; a player's still only asks). The Coins row has **Party Stash** (all
coins there). Take's tooltip is just "Shift+click: the whole stack".

---

## 13. Setting Presets — `settingPresets` (phase 34)

*New, generic (any system).* GM only, on by default, in a new category
**World Setup**. Asked for in the spirit of Forien's Copy Environment and
BBMM: no setting things up by hand in every new world. Q104–Q114, all as
recommended.

- **Button** "Setting Presets" in the Settings sidebar, after Configure
  Settings (DOM watcher).
- **A preset holds** every stored world setting (core, system, every module,
  registered here or not), the GM's own client settings (this browser's
  storage, keybindings included; only keys of core, the system or an
  installed module), the GM's per-user settings, and the active modules
  (id, title, version). `format: "lucd20-setting-preset"`.
- **Kept as a file** `lucd20-presets/<id>.json` in the Foundry user data, so
  every world on the server lists it. If the server refuses the upload it is
  kept in this world (setting `settingPresets_local`) and says so. Foundry
  cannot delete files: a deleted preset's file is overwritten with a
  `deleted` marker. **Export** (a download; by default without settings whose
  name looks like a secret: key, token, secret, password…) and **Import**
  (always as a new preset).
- **View / Apply**: grouped by module (core, the system, then by title); a
  loaded module's setting shows its real name with the raw key beside it;
  value; "different" (with the value here on hover) / "same"; search; "only
  differences"; tick boxes per setting and per module, starting with every
  difference ticked.
- **Never applied** (shown greyed): things that belong to their world
  (`core.time`, `core.compendiumConfiguration`, stored ids and logs of this
  module, `pf2e.activeParty`, anything named like a migration or schema
  version), another game system's own settings, and per-user settings of a
  module that is not running.
- **Applying**: registered world and per-user settings go through
  `game.settings.set`; world settings of modules that are not running are
  written as Setting documents, ready for when the module starts; client
  settings are written to this browser only. **Modules**: the preset's are
  switched on; others are left on unless "also switch off modules that are
  not in the preset" (never this module). Missing modules are listed. Ends
  with "Reload now for everyone?".
- Code: `scripts/features/setting-presets.js`. Test: `test34.js`.
- (verify) in Foundry V14: that the GM can upload into `lucd20-presets/` on
  the owner's server (Molten); how per-user settings are stored (read here as
  Setting documents carrying a `user`); the button's place in the sidebar;
  writing a Setting document for a module that is off.

---

## 14. D&D 4e: loot, Party Stash, coin tracking (phase 35)

Q115–Q124. Mockup: `docs/mockups/party-stash-4e.html` (style C chosen).
Code: `scripts/systems/dnd4e/party-stash.mjs`; test `test35.js`.

- **Loot adapter.** 4e has no loot or party actor and keeps coins as five
  numbers on the actor (ad, pp, gp, sp, cp), on characters and NPCs alike. So
  a pile and the stash are **NPC-type** actors flagged by the module (a pile
  used to come out as a "Player Character"), loot is weapons, equipment,
  consumables, tools, loot items and backpacks (never powers, features,
  rituals), and coins are **not items** (Q115: an item would not count on the
  sheet). "Loot the fallen" offers each NPC's coins as a line of its own
  (follows "Include coins"); they move to the pile's own coin numbers and
  show as the usual Coins row. A split adds to each character's coin numbers.
  10 cp = 1 sp, 10 sp = 1 gp, 100 gp = 1 pp, 100 pp = 1 ad. Characters of a
  split: every player-owned Player Character. Ritual components are left out.
- **Party Stash** — `dnd4ePartyStash`, on by default. One module-made stash
  actor (made the first time the GM opens the window or something is sent to
  it). Button "Party Stash" at the bottom of the Actors tab, for everyone.
  The window is laid out like a character sheet in the colours and type of
  the 4e books and Fox's 4e Styling (his fonts when his module is active;
  none are shipped), with a **dark variant** under Foundry's dark theme:
  coins in boxes, the GM's Split evenly / Custom split / Open sheet and the
  ledger on the left; tabs (All, Weapons & Armor, Magic Items, Consumables,
  Gear) and item rows on the right (amber edge = has a level, i.e. magic).
  Players **Take** at once for their character; the GM **Gives**. Splitting
  the stash's own coins leaves the rest in it. Putting items in from a
  character sheet is not part of this pass (the GM drops them on the stash's
  own sheet; the Loot Pile sends items and leftover coins here).
- **Coin Log** — `dnd4eCoinLog`, on by default. Every change to a player
  character's coins or the stash's, however made (sheet, split, macro), is
  added to that actor's ledger and posted to chat: a character's whispered
  to the GM and its owners, the stash's to everyone, with who did it and, for
  the module's own changes, why (coin split, loot). A coins button in each
  owned character sheet's title bar opens the log. NPCs and piles are not
  tracked. Detection: the active GM's client keeps the last known purse of
  each tracked actor and compares on `updateActor`.
- **Ledgers**: flag `ledger` on the actor, last 200 entries (`coins`, `take`,
  `add`), written by the active GM's client. The stash's also records items
  put in by a pile and taken by characters.
- Shared loot code gained: `coinsOnActor`, `setCoins`, `onHandOut` in the
  adapter; a pile is only removed when its coins are gone too; the stash is
  never removed.
- (verify) in Foundry: the coins button in the 4e sheet's title bar; the
  stash's NPC sheet accepting dropped items; that the pile and stash, as NPC
  actors, are not picked up by anything that lists NPCs; the look with and
  without Fox's module, light and dark.

**v0.39.0 (owner's feedback on 0.38.0):**

- **Party Stash:** the item's name or picture opens its sheet; the GM types
  new coin amounts straight into the coin boxes; items **dropped on the
  window** go into the stash (`partyStash.put`: from a character the sender
  owns the item moves, a stack asks how many; from the Items sidebar or a
  compendium the GM gets a copy; only loot item types); the stash actor is
  **hidden from the Actors list** (DOM), and **P** opens or closes the window
  (keybinding `dnd4ePartyStash`, changeable), besides the sidebar button.
- **Pathfinding:** keeping away from squares next to enemies now happens only
  **while Q is held** (it was the default, with Q switching it off).

## 15. Opportunity Attack Warning — `dnd4eOpportunityWarning` (phase 36)

*New, D&D 4e.* On by default, for everyone. Asked for "like Draw Steel's".

- While a token is dragged in combat, each enemy the planned move would
  provoke an opportunity attack from gets a "!" badge and an arrow to the
  square the mover would leave. Same rules as the opportunity cards
  (`provokedAlong` in `reactions/opportunity.mjs`): leaving a square next to
  an enemy that still has its opportunity action, can act and is not on its
  own turn; shifting and teleporting never provoke. Players only get marks
  for enemies they can see.
- The planned path: Pathfinding announces every search it answers (hook
  `lucd20MovementPath`); the feature also wraps `Token#findMovementPath` for
  when Pathfinding is off. Marks are local, drawn on `canvas.interface`, and
  cleared on pointer up, right click, Escape, `moveToken` and turn change.
- Code: `scripts/systems/dnd4e/reactions/opportunity-warning.mjs`. Test:
  `test36.js`.
- (verify) in Foundry: that the marks follow the ruler while dragging and go
  when the token is dropped or the drag is cancelled.

**v0.40.0 (owner's feedback on 0.39.0):**

- **Opportunity Attack Warning:** the marks are drawn above the tokens (on
  the controls layer, high z-index); a short metallic "shing" (made with Web
  Audio, no sound file) plays when another enemy becomes a threat; per-player
  setting **Sound**, follows Foundry's interface volume.
- **Pathfinding:** a hint "Hold Q to go around enemies" sits just above the
  macro bar while a token is dragged (per-player setting, on by default; lit
  while Q is held). Squares a visible **enemy stands on are closed** to
  routes (setting **Go around enemy tokens**, on: PF2e and D&D 4e do not let
  you walk through enemies); a diagonal step between two enemies is still
  allowed; the destination itself is never closed.

**v0.40.1:** a coin split in D&D 4e is one chat line ("Coins split: …" or
"Coins handed out: …"); the Coin Log no longer whispers a line per character
for it (the ledgers still record each change). If the Loot Pile's "Announce in
chat" is off there is no split line, so the per-character whispers stay.

---

## 16. PF2e rules (phase 37 on)

The owner is replacing PF2e automation modules with this one, rule by rule.
**`docs/pf2e-rules.md` is the ledger**: every rule as given, its status and
how it was built. New category **Pathfinder 2e** (`pf2e`), one feature per
rule. v0.41.0: Frightened, Sickened, Shove, Trip (`scripts/systems/pf2e/
rules.js`, `test37.js`), plus `core/dice.js` (wait for Dice So Nice by
message) and `core/square-picker.js` (pick one of a few highlighted squares).

**v0.42.0 (phase 38): rule 5, Temporal Distortion** (`pf2eTemporalDistortion`,
`test38.js`). Q134–Q136 answered by the owner (the spell's text, item slug,
Will; durations 1 / 4 / 2 rounds); Q140 single target, nothing before the save
is rolled; Q137–Q139 and Q141–Q143 as recommended. Details in the ledger.

---

## 17. D&D 4e HUD (phase 39, mockups)

*New, D&D 4e.* A HUD in the spirit of PF2e HUD (reonZ/pf2e-hud): HP, healing
surges, defences, speed, Action Points and an action dock (the new Action
Tracker), with powers in tabs. Asked for mockups first.

Decisions (Q144–Q147, all as recommended):
- **Q144** A bottom bar, always on: the player's own character; the GM's
  shows the selected token.
- **Q145** Tabs by action type: Standard, Move, Minor, Free, Triggered
  (immediate + opportunity). Powers are coloured by usage (at-will,
  encounter, daily, basic) and greyed when used.
- **Q146** The HUD's dock replaces the floating basic-actions panel. The pips
  in the combat tracker and Combat Tracker Dock stay, as options.
- **Q147** Action Points: the count, and a click spends 1 for an extra
  standard action (with a warning if one was already spent this encounter).

Mockup: `docs/mockups/hud-4e.html` (+ `.png`), three layouts: A one strip
with a drawer, B portrait with side tab buttons, C power-card hotbar.

Owner's choice: **B's layout in C's style**, close to the 4e books, with a
**dark and a light** theme. The HUD sits at the **bottom right** (against the
sidebar); Foundry's **players list moves up** and the **hotbar moves**
somewhere else (as PF2e HUD and the owner's 2d12 system do).
Second mockup: `docs/mockups/hud-4e-right.html` (+ `.png`), three layouts,
each dark and light: 1 block with side tabs, hotbar where the players list
was; 2 tabs on top and cards opening upward, hotbar inside the HUD; 3 wide,
cards in two columns, hotbar as a column by the scene controls.

Notes for building (learned from the owner's 2d12 HUD, to avoid trial and
error): place the HUD on the screen itself (`#interface`), not inside
Foundry's middle column, whose width Foundry sets; measure the right edge from
what is really drawn in the bottom band (`#sidebar`, `#sidebar-tabs`,
`#sidebar-content`, the chat input when it floats), not `#ui-right` or
`#chat-notifications` (a wide empty area); re-measure on resize and with a
ResizeObserver on the sidebar and controls; move `#players` and `#hotbar` by
re-parenting the elements (a reload puts them back exactly when switched
off). (verify) the V14 build 368 DOM with the owner's HTML before building.

**Third mockup** (`docs/mockups/hud-4e-bottom.html` + `.png`): the owner's
screenshot set the place: the HUD fills the **bottom band from the left edge to
past the hotbar** (the hotbar lives inside it), and the **players list moves up**
into the free corner above its left end. Built from the owner's four level-1
sheets (ranger, warlock, bard, barbarian): power names drop the compendium
prefix ("Ranger 01-Twin Strike" -> Twin Strike), encounter powers with several
uses show pips (Majestic Word 2), the sheets' action types include `reaction`
(Fox's Cunning), Second Wind is `details.secondWind`. Three layouts, each dark
(ranger) and light (bard): 1 everything in view, power cards in a row;
2 a low band with the tab opening upward; 3 the sheet's header, powers in
At-Will / Encounter / Daily / Basic columns.

**Layout 3 chosen** (Q148, "needs a few improvements"). Q149: conditions and
effects line under HP, death saves in place of surges at 0 HP; a Skills tab
maybe later, after seeing it in play. Q150: a monster HUD after the PCs' one.
Owner: powers were cut off; give the powers area more room (the HUD may take
more height, not more width), no taller cards; long names fit some other way.
Fourth mockup (`docs/mockups/hud-4e-sheet.html` + `.png`), three takes on 3:
A four usage columns, taller band, names shrink to fit (down to 9 px, then
"..."), range as 4e power icons (melee / ranged / close, W = weapon) with the
attack on the right; B tabs in a column, powers as one-line book entries in two
columns (Dying + death saves shown); C usage rows of up to three cards.

**Owner's choice: take C** (usage rows). Q151–Q154 as recommended: a click
uses the power exactly as the sheet does (`actor.usePower`), right click opens
it, hover shows its name, keywords and trigger; the HUD is the one selected PC
the user owns, else (players) their assigned character, nothing for a GM with
nothing selected (only the hotbar stays); on by default, per player, with a
dark / light theme, hotbar inside and players list above as options; the
floating action panel no longer opens by itself while the HUD is on; the
module's basic actions appear in the Basic row of their tab while in combat.

**Built v0.43.0 (phase 39)** — `dnd4eHud`, `scripts/systems/dnd4e/hud/`
(`hud-data.mjs` reads the actor, `hud.mjs` draws), `test39.js`.
- Stat block: name plate, HP (temp, bloodied / dying), conditions and
  temporary effects (harmful ones red), surges + Second Wind, or Dying + death
  saves (`deathsavefail` of `deathsaves`) with Roll (`actor.rollDeathSave`);
  AP + Spend (warns if `actionpoints.encounteruse`), speed, initiative, the
  four defences (green / red when temporary effects change them, the Sheet
  Highlights reading).
- Powers: tabs Standard / Move / Minor / Free / Triggered (reaction,
  interrupt, opportunity; "none" goes to Free); rows At-Will (also `other`),
  Encounter (also `recharge`), Daily (also `item`), Basic (`powerType`
  inherent); unprepared powers hidden; uses as pips when more than one; no uses
  left = greyed. Attack line from `item.getAttackBonus()` (the sheet's number)
  + defence; range as icons (melee, ranged, close, area, personal; W = weapon).
  Names lose the compendium prefix; long ones shrink to fit (9 px) then "…".
- Dock: the Action Tracker's state for the combatant, click a tile to toggle
  it (owner / GM); "Actions are tracked in combat." outside combat.
- Placement: fixed at the bottom left, inside `#interface` under windows
  (z-index 30), width up to the sidebar's left edge (max 1240 px), re-measured
  on resize and sidebar changes; `#hotbar` and `#players` are moved in by
  re-parenting and put back exactly when the HUD or the option is off. Bars
  that sit above the hotbar (movement picker, square picker, Pathfinding's Q
  hint) now sit above the HUD.
- (verify) in V14 build 368 / dnd4e 0.9.3, with the owner's HTML snippet:
  the hotbar's markup inside the HUD (5 × 2, page / lock controls), the
  players list in its corner, the HUD under windows and above the canvas, the
  right edge against the collapsed and the open sidebar, `getAttackBonus()`
  numbers matching the sheet, `rollDeathSave` and `actionPoint` from the HUD.

**v0.43.1:** in the owner's world the HUD did not draw: a power's `keyWords`
was not a list (`.filter(...).join is not a function`), which stopped the
whole HUD, leaving only the hotbar and players list in the corner. Keywords
are now read from a list, Set, string or object of flags (plus
`keywordsCustom`), and a power whose data cannot be read is skipped (warning in
the console) instead of stopping the HUD.

**v0.43.2:** the owner's layout (V14, 1920 × 1009): `#interface` holds
`#ui-left` (absolute, 960 wide, scene controls in `#ui-left-column-1`),
`#ui-middle` (`#ui-top`, `#ui-bottom`) and `#ui-right` (absolute; `#sidebar`
at x 1572 with `#sidebar-tabs` 48 wide and `#sidebar-content` 312 wide).
The HUD drew at [0, 819, 1240 × 190]; `#players` sat in its corner at
[4, 668, 200 × 145]; `#hotbar` (an `aside.flexrow`) is 210 × 62 inside it, wider
than the 182 px column, so the column is now 224 px.

**v0.43.3 (owner's first look in V14):**
- The band keeps its size and place with nobody shown (a line says to select
  a token), so the hotbar and players list no longer jump ("make elements be
  fixed").
- Usage in **columns** again (At-Will, Encounter, Daily, Basic; always all
  four, "—" when empty), each growing downward and scrolling: "it will likely
  increase".
- No hover tooltips in the HUD for now.
- Hotbar: slots 40 px with a small corner number (owner: the icons could not
  be seen); the right controls (page + lock / clear) side by side; the HUD's
  button style no longer reaches Foundry's hotbar buttons (it replaced their
  icon font: the mute, menu, page and lock buttons showed empty boxes).
  V14 hotbar (owner's check): `#hotbar-controls-left` (mute, menu, 24 px),
  `menu#action-bar` of `li.slot`, `#hotbar-controls-right` (`nav#hotbar-page-controls`
  + a column with lock / clear). Right column 300 px; HUD up to 1480 px wide.
- (verify) the slot number element is `.slot .key` (styled small in a corner).

**v0.43.4 (owner, comparing with PF2e HUD):**
- Nothing selected: the band is see-through and shows the **party**, as PF2e
  HUD does: a 4e card per player character this user may observe (portrait,
  name, class and level, the four defences, surges, AP, speed, HP); a click
  selects that character's token (the HUD then shows it), a right click opens
  the sheet. A player sees only characters they can observe.
- The macro area no longer moves between selected and not: the dock row's
  height is always reserved.
- Height 190 -> 168 px; conditions on one line. The band's background is
  slightly see-through.

**v0.43.5 (owner: the macro area "is just a block" with nothing selected):**
the hotbar is anchored to the bottom of its column with 44 px slots (column
322 px); the dock above it is taller (58 px, bigger icons). With nothing
selected the column has no background and the dock's place stays empty, so
only the hotbar itself shows, in the same place as when a character is shown.

**v0.43.6 (owner: small windows; Foundry's minimum is 1024 × 768):** a fixed
layout per width the HUD gets (`data-size`), tested at 1920, 1366, 1280, 1024
(sidebar collapsed and open) and 958 px:
- **full** (1250 px and up): as before.
- **compact** (1000–1249): portrait 64 px, stat block 232, macro slots 38.
- **narrow** (780–999): no portrait (the name plate stays), stat block 214,
  slots 32, tabs show icon and count, the four usage groups two per row
  (At-Will | Encounter, Daily | Basic) under one scroll, so a group stays at
  least 150 px wide.
- **tiny** (under 780; 1024 with the sidebar open gives 668): as narrow, the
  hotbar sits just above the HUD's right end and the dock is a slim column of
  five rows (icon + name).

### 17.1 Monster HUD (mockup)

The owner: "Now for NPCs. Mockup again, using the PC as the base." GM only.
Decisions Q155–Q158, all as recommended:
- **Q155** Several NPCs selected: one card per NPC (role colour on its edge,
  level and role, defences, saves, speed, initiative, HP; minions say MINION);
  clicking one shows that monster's full HUD. One NPC selected: its HUD.
- **Q156** Recharge: the card shows its recharge (dice 5–6, or the condition,
  "when first bloodied"); once used it gets a Roll button: a d6 in chat (GM
  only), waits for Dice So Nice, available again on a success. Rolling by
  itself at the start of the turn can come later.
- **Q157** Tabs Standard, Move, Minor, Triggered, **Traits** (auras and
  passive abilities, with their text); columns At-Will, **Recharge** (with
  encounter powers), **Basic** (the basic-attack flag: every monster power is
  `powerType: inherent`, so "inherent" cannot mean basic here).
- **Q158** The monster block: name plate in the role's colour (brute,
  soldier, artillery, lurker, skirmisher, controller; gold edge for elite,
  double for solo), a line "Level 3 Elite Brute (Leader) · 300 XP"
  (`details.role.{primary,secondary,leader}`, `details.level`, `details.exp`),
  HP with bloodied (minions: MINION, no bar), conditions plus resist /
  vulnerable / immune, Saves (`details.saves.value`) and AP with Spend, Speed,
  Init, Perception, the defences.

Mockup: `docs/mockups/hud-4e-npc.html` (+ `.png`), drawn with the released
HUD's stylesheet: A one monster, Standard tab (dark); B bloodied, Traits tab
(light); C several monsters selected.

**Q159 (owner: five conditions did not fit the text line):** conditions and
effects become **icons on the portrait** (the effect's image, 4 per row,
harmful ones framed red); clicking one lists every condition with its duration
(dnd4e's `durationType` label, else Foundry's) just above the HUD. Narrow and
tiny keep a slim portrait strip for the icons. The freed line splits AP from
Speed / Init, and PCs get passive Perception / Insight.

**Built v0.44.0 (phase 40): the monster HUD** (owner: "the NPC is good"),
`hud-data.mjs` / `hud.mjs`, `test39.js` extended:
- GM only. One selected PC or NPC: its HUD; several selected: a card each
  (role colour on the edge, "L3 Elite Brute", defences, saves, speed, init,
  HP, MINION for minions); a card shows that one, "‹ 3" goes back; a new
  selection starts from the cards. Players never get an NPC's HUD.
- The monster block, the tabs and columns as in §17.1. Free actions go in
  Triggered; powers with no action are Traits (their text from the effect,
  else the description, about 220 characters).
- Recharge: dice for "Recharge N" (a recharge power with neither roll nor
  condition recharges on a 6, as the sheet does); the condition text
  otherwise. Used: a Roll button, a d6 whispered to the GMs, after Dice So
  Nice; on N or more `system.uses.value` goes back to `preparedMaxUses`.
- (verify) in the owner's world: `details.role`, `details.saves`,
  `skills.prc.total`, `resistances.<type>.value` (resist > 0, vulnerable < 0)
  and `.immune` on real monsters; `durationType` labels on conditions.

**v0.45.0 (phase 41): PF2e rule 6, reactions** (`pf2eReactions`,
`scripts/systems/pf2e/reactions.js`, `test40.js`). The owner wants the
reaction part automated before the Commander's Demoralizing Charge. Q160–Q163:
reactions only (no PF2e action tracker); a badge on the token everyone who sees
the token sees, and a mark in the Combat Tracker; spent by reaction cards,
off-turn Strikes and (with the tactics) tactic responses; trigger prompts
later. Details in the ledger, `docs/pf2e-rules.md` §6.

**v0.45.1:** no reaction before a creature's first turn, guardians excepted
(owner). **v0.46.0 (phase 42): PF2e rule 7, Reactive Strike** prompts and the
drag warning (`pf2eReactiveStrike`, `scripts/systems/pf2e/reactive-strike.js`,
`test41.js`); Q164–Q168 in the ledger §7. Shove's push is now marked as forced
movement. Next: rule 8, Shield Block; then the Commander's Demoralizing Charge.

**v0.47.0 (phase 43): PF2e rule 8, Shield Block** (`pf2eShieldBlock`,
`scripts/systems/pf2e/shield-block.js`, `test42.js`), working with PF2e
Toolbelt's Target Helper (Q169–Q172 in the ledger §8). Next: the Commander's
Demoralizing Charge.

**v0.47.3 (owner):** Pathfinding, with Q off too, does "the least amount of
reaction dodging": leaving a square next to a visible enemy costs 0.01 of a
square, so of two routes of the same length it takes the one leaving fewer
such squares, never a longer one (Q still adds +4 to go around). The PF2e
reaction cards no longer show the action symbol after the title (the image is
enough).

**v0.48.0 (phase 44): PF2e rule 9, the Commander's Demoralizing Charge**
(`pf2eDemoralizingCharge`, `scripts/systems/pf2e/commander.js`, `test43.js`;
`core/square-picker.js` gains `pickSeveral`; the reaction tracker honours
Drilled Reactions). Details in the ledger §9.

**v0.49.0 (phase 45): PF2e rule 10, the Animist's Roaring Heart**
(`pf2eRoaringHeart`, `scripts/systems/pf2e/roaring-heart.js`, `test44.js`);
details in the ledger §10.
v0.49.1: the card's Shove / Confirm / Cancel buttons replace ending on the
second move (owner). v0.49.2: the card is reprinted after each Shove, is one
row of buttons, and ends as one message (owner: least vertical clutter).

**v0.50.0 (phase 46): PF2e rule 11, the Guardian's Punishing Shove**
(`pf2ePunishingShove`, `scripts/systems/pf2e/punishing-shove.js`, `test45.js`);
details in the ledger §11. v0.50.1: compact cards for all the PF2e rules
(no message header, one line, skipped cards deleted; ledger "Compact cards").

**v0.51.0 (phase 47): PF2e rule 12, flat checks** (`pf2eFlatCheck`,
`scripts/systems/pf2e/flat-check.js`, `test46.js`), replacing PF2e Flat
Check; the merge order of the owner's other modules is in the ledger
("Module merges").

**v0.52.0 (phase 48): Ctrl-click effects** (`pf2eCtrlClick`,
`scripts/systems/pf2e/ctrl-click.js`, `test47.js`); ledger §13.

**v0.53.0 (phase 49): sustained spells** (`pf2eSustain`,
`scripts/systems/pf2e/sustain.js`, `test48.js`); ledger §14. The Ctrl-click
hand became a split button.

**v0.54.0 (phase 50): hand reminders** (`pf2eHands`,
`scripts/systems/pf2e/hands.js`, `test49.js`); ledger §15. Sustain card lines
smaller.

**v0.55.0 (phase 51): Roll Chances, PF2e and 4e** (`rollChances`,
`scripts/features/roll-chances.js`, adapters `systems/pf2e/chances.js` and
`systems/dnd4e/chances.mjs`, `test50.js`); ledger §16.

**v0.56.0 (phase 52): Modifiers Matter, PF2e and 4e** (`modifiersMatter`,
`scripts/features/modifiers-matter.js`, adapters `systems/pf2e/modifiers-matter.js`
and `systems/dnd4e/modifiers-matter.mjs`, `test51.js`); ledger §17. 4e chances
made robust (owner: not working).

**v0.57.0 (phase 53): Damage Estimate, PF2e and 4e** (`damageEstimate`,
`scripts/features/damage-estimate.js`, adapters `systems/pf2e/damage-estimate.js`
and `systems/dnd4e/damage-estimate.mjs`, `test52.js`); ledger §18. Damage
Log: its PF2e-only setting no longer read in other systems.

**v0.58.0 (phase 54): PF2e cover for attack rolls** (`pf2eCover`,
`scripts/systems/pf2e/cover.js`, `test53.js`); ledger §19. v0.59–0.60: areas
(Reflex saves), areas reaching past wall ends.

**v0.61.0 (phase 55): PF2e effect areas** (`pf2eAreas`,
`scripts/systems/pf2e/area.js`, `test54.js`): the 25% reach rule, a targeting
window replacing Toolbelt's, cover on hover, the exact reach; ledger §20.

### 17.2 The HUD in Portuguese (v0.64.0)

Owner: "lets do the translation of the 4e HUD"; terms from the owner's
Livro do Jogador (Devir) index; Q249: the book's term wins over the dnd4e
system's pt-BR file. `LUCD20.Dnd4eHud` in `lang/pt-BR.json` (shown when
Foundry, or the "4e game language" card, is Portuguese). The defence labels
and "vs" became translatable (`Def.*`, `Vs`, `LevelShort`). Choices: PV, Pulsos
(de cura), Retomar o Fôlego, PA, Gastar, Desloc., Inic., Gatilho; tabs Padrão /
Movimento / Mínima / Livre / Com gatilho / Traços; rows Sem limite / Por
encontro / Diário / Básico / Recarga; CA / Fort / Ref / Von; "contra"; TR;
Percepção / Passiva; Moribundo, sangrando, Testes contra a morte; Nível,
N{n}; PX. Monster roles are not in the Livro do Jogador: Bruto, Soldado,
Artilharia, Espreitador, Escaramuçador, Controlador, Elite, Solo, Lacaio,
(Líder), Resistência / Vulnerabilidade / Imunidade: to check against the
Manual dos Monstros. The harness takes `?lang=pt-BR` (test39 with
`HUD_LANG=pt-BR` saves a screenshot).

### 17.3 Grab riders and New Player Tips (v0.65.0)

- Owner: "Ravenous Wolf (and most wolves): After hitting with Bite, apply grab
  to the target." Q250 (general): any power whose Hit text says the target is
  grabbed ("the target is grabbed", "grabs the target", "o alvo fica
  agarrado"; not "against a grabbed target") puts Grabbed on each target hit
  (`grabRiderFor` in movement/parse.mjs, `applyGrabRider` in on-hit.mjs, with
  the power riders' switch). Q251: prone riders already existed.
- Owner: "A module to help new players, we will do class by class, slowly."
  `dnd4eTips` (Interface page, per player; one switch per class). Q253: on
  the HUD: a strip above the band with the suggestion during the character's
  own turn in combat (× hides it for the turn), the power it points to and
  its tab blinking (`hud/tips.mjs`, `showTip` in hud.mjs). Ranger: no prey →
  "You don't have a prey. You can use Hunter's Quarry, as a minor action, to
  assign one." (Hunter's Quarry blinks); a prey → "[Name] is your prey.";
  Q254: at the start of the ranger's turn the prey is pinged for its players
  and the GM, each on their own screen (`canvas.controls.drawPing`, (verify));
  Q255: no ping when the prey is on another scene. Not at 0 HP. Portuguese
  uses the book's "ação mínima" (the owner wrote "Ação Menor").

### 17.4 More tips, NPC symbols (v0.66.0)

Owner: "Do the same for Warlock and its prey" plus Ranger attack suggestions,
Barbarian suggestions, Furious Assault, Swift Charge, Elven Accuracy, Fox's
Cunning, and "Add automation symbols to NPCs too"; Q256–Q261 as recommended.
- `hud/tips.mjs` gives up to 3 tips (after-a-roll first, then the turn's),
  each with its power (and tab, or the Charge basic action) blinking; ×
  hides the shown ones for the turn. Tips follow the powers a character has
  (a half-orc's Furious Assault, an elf's Elven Accuracy), with one switch
  each: Ranger, Warlock, Barbarian, Elf.
- Turn: Ranger: prey; Nimble Strike with an enemy adjacent, else Twin Strike.
  Warlock: nobody cursed → Warlock's Curse reminder, else "[Name] is
  cursed." (pinged with the prey). Barbarian: ≥2 adjacent → Great Cleave; an
  enemy within 3 squares, none adjacent → Pressing Strike; else Charge (its
  button blinks) or Pressing Strike.
- After a roll, with a use left and not against a weak enemy (a minion, or
  more than 2 levels below): a hit → Furious Assault (until the damage roll
  or the next attack); a miss → Elven Accuracy (until the next attack); an
  enemy at 0 HP during a barbarian's turn → Swift Charge (until the turn's
  end); an attack message against a ranger → Fox's Cunning, on its players'
  and the GM's screens, until a damage roll (any attack: the message doesn't
  say melee). Power names matched in English and Portuguese guesses (verify
  against the owner's sheets).
- Q261: the ◆ automation symbol on the HUD's power buttons (PCs and NPCs);
  the symbols on sheets were already meant for NPC sheets too (the owner's
  NPC sheet to confirm). Grab riders count as automated in the guess.

### 17.5 Bard tips (v0.67.0)

Owner: "Now this bard" (an uploaded Elf Bard 1, Virtue of Valor); Q262–Q265
as recommended. Virtue of Valor, Misdirected Mark and Blunder's slide were
already automated. Turn tips: Majestic Word when you or an ally within 5
squares is bloodied or dying (the dying first; a use left); the attack:
Blunder (a foe within 5 squares with an ally within 2 squares of it), else
Misdirected Mark (a foe next to an ally within 5 squares of you), else
Vicious Mockery; Stirring Shout against an elite, a solo, or a creature 2+
levels above. No tip for Words of Friendship. Fix found on the sheet: a
"feature" and a "power" can share a name (Elven Accuracy / Precisão
Élfica): tips point to the power. (Majestic Word's once-per-round limit is
not tracked.)

### 17.6 Tips follow the action left; Howling Strike; a shorter cover label (v0.68.0)

- Owner: "In Melee with an adjacent enemy, Barbarian should suggest Howling
  Strike above Pressing Strike": two or more adjacent → Great Cleave; one →
  Howling Strike; within 3, none adjacent → Pressing Strike; else Charge or
  Pressing Strike.
- Owner: "If a PC doesn't have that action type available, change or stop
  suggesting": with the action tracker on, a tip for a standard / move /
  minor action shows only while that action (or a bigger one to trade down)
  is left this turn (`canStill`); free actions and reactions are not
  filtered.
- Owner: "The text to calculate cover is too big in portuguese": the 4e
  cover preview shows one line when melee and ranged agree ("Cobertura:
  nenhuma"), "Corpo a corpo" instead of "Corpo a corpo/contíguo", and a
  smaller font (about a fifth of a square).

---

## 18. Five more modules (owner, 2026-11-18)

Owner: "To all systems": PF2e Effects Halo ("the effects appear around the
token and not covering it. It should show beneath tokens"), F is for
Flatfooted ("so we can make shortcuts for different systems"), PF2e See
Simple Scale Statistics ("for now, just for 2e"), Stairways ("much simpler.
Just a button in the regions area that creates teleports right away"), Token
Elevator ("part of the keybinds, a keybind to increase or decrease height").

Read from their source (licences: Halo MIT, F is for Flatfooted GPL-3 so
ideas only and no code copied, Scale Statistics MIT, Stairways MIT, Token
Elevator MIT-0):
- **Halo** wraps `Token#_drawEffect` / `_refreshEffects` / `_refreshSize`:
  round icons (background + border colour), placed on rings around the
  token's footprint (icon radius = grid / 10; ring 1 just outside the
  token; more rings when full; ellipse for non-square tokens; follows
  autoscale and dynamic rings); the death overlay stays as it is.
- **F is for Flatfooted**: O toggles Off-Guard on the hovered token; unbound
  keys for every condition (toggle, + / − for valued ones), every
  `game.pf2e.actions` entry and its variants, Raise a Shield, Take Cover,
  compendium browser and its search, cycle alliance, toggle visibility, end
  turn, mark defeated, show token / actor art. Targets: selected tokens,
  else the assigned character.
- **Scale Statistics**: GM Core's Building Creatures tables (plus its own
  "Terrible" row) colour an NPC sheet's AC, HP, Perception, saves, attribute
  modifiers, skills, strike attack and average damage, spell DC / attack,
  resistances and weaknesses (cyan / green / yellow / orange / red); hover
  shows the table row; a sheet header button toggles it; Elite / Weak
  switch it off; a ⚠️ list of creature-building warnings.
- **Stairways**: its own placeable layer (door-like icons, click to use).
  V14 Regions already have a Teleport Token behaviour, so ours only creates
  regions.
- **Token Elevator**: one key (+ Ctrl lower, + Shift large step), hovered
  token first, else the selected ones; mouse wheel on the Token HUD's
  elevation box.

Q266–Q275: owner, "All yes" (as recommended):

| # | Question | Recommendation |
|---|---|---|
| Q266 | Effects Halo — `effectsHalo`, all systems, Tokens page, per player: icons on rings just outside the token, **drawn under every token** (like the Turn Marker, at the token's elevation), so token art covers them and never the reverse; the overlay (death) icon stays on the token; only the icons Foundry already draws for that user, on tokens they can see. | Yes |
| Q267 | Halo options: icon size (0.2 of a square), distance from the token, background and border colour, all per player. The original's per-actor radius is dropped. | Yes |
| Q268 | Shortcuts — `shortcuts`, all systems, Tokens page: keys are set in Foundry's Configure Controls (a button in the card opens it); most come unbound so nothing clashes. They act on the hovered token, else the selected ones, else your character. Players only affect what they own. | Yes |
| Q269 | Elevation: PageUp / PageDown raise / lower by one square's distance (5 ft), Shift for 2 squares; mouse wheel on the HUD's elevation box; below 0 allowed (burrow, swim); "reset to 0" unbound. | Yes, (verify) PageUp / PageDown are free in V14 |
| Q270 | PF2e: Off-Guard on the hovered token on **O** (the current module's key); everything else F is for Flatfooted has, unbound. | All of it |
| Q271 | 4e: the same hovered-token key toggles "grants combat advantage" (if dnd4e has that status, verify); unbound keys for each 4e condition, Second Wind, Spend Action Point. | Yes |
| Q272 | Quick Teleport — `quickTeleport`, all systems, GM only: a tool in the Regions controls; click (one square) or drag (a rectangle) for each end, the second end on any scene; two regions with Foundry's Teleport Token behaviour pointing at each other, named "Stairs N". Two-way; a one-way switch on the tool's bar. | Yes |
| Q273 | Teleports ask the player first (Foundry's "choice"), so a drag or route across the stairs doesn't teleport by surprise; regions seen by the GM only (the map art shows the stairs). | Yes |
| Q274 | Creature Scale — `pf2eCreatureScale`, PF2e Tools, GM only: colours and hover on the NPC sheet, header toggle remembered per GM. The ⚠️ creature-building warnings later, if wanted. | Colours first |
| Q275 | Order: Shortcuts (with elevation) → Effects Halo → Quick Teleport → Creature Scale, one release each. | Yes |

Switch off the originals as each lands (F is for Flatfooted, Token Elevator,
PF2e Effects Halo, PF2e See Simple Scale Statistics). Existing Stairways stay
on their own layer: they aren't converted.

**Built v0.69.0 (phase 59): Shortcuts** (`shortcuts`, Tokens page, world switch,
on by default; `scripts/features/shortcuts.js`, adapters `systems/pf2e/shortcuts.js`
and `systems/dnd4e/shortcuts.mjs`, `test57.js`):
- Keys in Foundry's Configure Controls under the module, as `sc-<id>`. Generic
  ones are registered at `init`, the system's and the status toggles at
  `setup` (they need the system's data and our texts; still before Foundry
  fixes the keybindings). While the feature is off a key does nothing here.
- Who: the hovered token (a hovered token you don't own stops it, with a
  warning, instead of falling through to your own); else the selected tokens
  you own; else your character's token (conditions: your character, even off
  the scene). Actions (PF2e actions, 4e basic actions, alliance, death save):
  your one selected token, else your character; two selected warns.
- Generic: elevation raise / lower (PageUp / PageDown, Shift = large step;
  step and large step in squares of the scene, options 1 and 2), back to 0
  (unbound); the mouse wheel over the Token HUD's elevation (option, on: the
  HUD's token and the other selected ones); hide / reveal (GM only), end turn,
  mark defeated, show token / actor art (shared; a name hidden from players
  is shared as "Unknown creature", without the actor link); outside PF2e a
  toggle for each `CONFIG.statusEffects` entry.
- PF2e: O = Off-Guard; each condition (no attitudes) toggle, + / − for
  valued ones; every `game.pf2e.actions` entry (the Collection's Actions with
  one key per variant, plus the legacy macros), Cover effect, Compendium
  Browser, compendium search, cycle alliance.
- 4e: O = grants combat advantage (`grantingCA`, else a status whose id or
  name says combat advantage; none → no key); each basic action (in combat
  through the Action Tracker, as the HUD; out of combat only Second Wind and
  Action Point, the others warn); death saving throw.
- Moving over: each shortcut names the original action it replaces. Once per
  browser (and with "Copy keys from the old modules" in the card) the keys
  that browser set in F is for Flatfooted / Token Elevator are copied in (Foundry
  keeps them stored even with the module off), or Token Elevator's defaults
  (the key left of Z, IntlBackslash) while it is still on; ours that browser
  already changed are left alone. While an original module is on, the
  shortcuts copied from it stand down (its key answers) and the GM is told
  to switch it off.
- Owner's keybinding export: `tools/export-keybindings.js` (console or macro)
  writes every bound action with its current and default key.
- (verify) in V14 / PF2e 8.7: registering in `setup`;
  `canvas.tokens.hover`; the Token HUD's `#token-hud [name=elevation]`;
  `foundry.applications.apps.ImagePopout` options and `shareImage`;
  `ControlsConfig` path; `game.pf2e.actions` entries and `variants`; the Cover
  effect's UUID; dnd4e's `grantingCA` status.

**v0.69.1 (the owner's keybinding exports, PF2e and 4e):**
- PageUp is Foundry's Zoom In, so elevation now defaults to the owner's
  Token Elevator keys: Shift+= raise, Shift+− lower, − back to 0; the large
  steps are unbound (as the owner had them).
- O is the owner's Focus Chat; their Off-Guard is F. The 4e "grants combat
  advantage" shortcut now takes the key the browser gave Off-Guard in F is
  for Flatfooted (O stays the default for anyone without one).
- Foundry keeps keybindings per browser, shared by every world (the two
  exports had the same stored keys), so "copied already" is kept per
  shortcut (`shortcuts_copiedIds`): a PF2e world opened after a 4e one still
  gets its PF2e keys. Tested with the owner's real keys: Off-Guard F,
  Frightened +1 S, Blinded B, Trip Shift+A, Cover Shift+C, art Shift+Z /
  Shift+X; 4e combat advantage F.
- LucD20 Automations was not on in the owner's PF2e world at the export;
  its F is for Flatfooted keys are copied when it is switched on there.

**Built v0.70.0 (phase 60): Effects Halo** (`effectsHalo`, Tokens page, per
player, on by default; `scripts/features/effects-halo.js`, `test58.js`):
- The icons Foundry drew in `token.effects` (not `bg`, not `overlay`) are
  hidden there (`renderable = false`, the background too) and copied as round
  badges (background + border colour, the icon clipped to a circle; rendered
  once per icon and colours into a texture) on the primary canvas: at the
  token art's elevation and sort layer, sort −1 000 000, so every token at
  that elevation draws over them (a Turn Marker, sorted just under its token,
  also draws over them). The overlay (dead) icon stays on the token.
- Rings as the original: icon radius = square × size / 2 (0.2), ring 1 at
  the footprint's half size × distance (1) + r + 10 %, more rings when full,
  ellipse for non-square tokens, from the top round anticlockwise.
- Kept in step on every `refreshToken` (the icon set) and every frame
  (position, so moves, animation and Token Scatter's offsets are followed;
  visibility: nothing for a token this user can't see; hidden tokens at half
  opacity for the GM). Off: Foundry redraws its own icons (`redrawEffects`).
- Options (per player): icon size, distance from the token, background and
  border colour (the original's PF2e colours).
- Switch off PF2e Effects Halo.
- (verify) in V14: `token.effects.bg` / `.overlay`; the `redrawEffects`
  render flag; primary sorting by elevation → sort layer → sort; PF2e 8.7
  drawing its effects into `token.effects`.

**v0.71.0:**
- Owner: "Put turn marker below it" (the halo): with Effects Halo on, the
  Turn / Next-Turn Markers sort at −1 000 001, under the halo's badges (and so
  under every token at that elevation); with the halo off, as before (just
  under their token).
- **Built (phase 61): Quick Teleport** (`quickTeleport`, Scenes & Windows
  page, GM only, on by default; `scripts/features/quick-teleport.js`,
  `test59.js`): a "Place stairs" tool (fa-stairs) in the Regions controls.
  Click (one square) or drag (a rectangle, snapped to the grid) for the first
  end: a GM-only region "Stairs N · A" is made at once (flag
  `quickTeleport: { pair, end }`, one colour per pair, N counted over every
  scene). A bar says to place the other end, on this scene or after switching
  scenes (the tool keeps listening; the preview is redrawn on the new canvas),
  with a One-way box and Cancel. The second end "Stairs N · B" gets Foundry's
  Teleport Token behaviour to A (`destination` = A's UUID, `choice: true`, so
  the player is asked), and A gets one to B; One-way: only A → B. Cancel, Esc
  or right-click after the first end deletes it.
- Switch off Stairways when its old stairs aren't needed (they aren't
  converted).
- (verify) in V14: the `teleportToken` behaviour's `destination` / `choice`
  fields; a token arriving in B not being sent straight back by B's own
  teleport; `controls.regions.tools`; the `fa-stairs` icon.

**v0.71.1 (owner: "the distance when teleporting gets all messed up", a ruler
label of "85.1 + 4.900000000000006 ft"):** the owner's movement record showed
a walk of one square, then a step to y 2351 (half a square, off the grid: where
the token's centre crossed the stairs region's edge), then the teleport
(`action: "displace"`, cost 0). That half step was charged 5 but measured as a
part of a square, so every later number had a fraction. Fix (Quick Teleport,
on every client): V14's `TokenDocument#segmentizeRegionMovementPath` (meant to
be overridden; its rules are kept) is wrapped so that, for any region with an
enabled Teleport Token behaviour on a square grid, the ENTER point moves
forward along the same path to the first grid square that is inside the
region; what follows starts there and anything skipped over is dropped. If
the token would leave before that square (grazing a corner), Foundry's own
segments are kept. The walk now records whole squares and the teleport 0.
Docs read at foundryvtt.com/api/v14 (reachable from the container now).

**Built v0.72.0 (phase 62): Creature Scale** (`pf2eCreatureScale`, PF2e Core
Rules → Tools, GM only, on by default; `scripts/systems/pf2e/creature-scale.js`,
tables `creature-scale-tables.js` copied unchanged from pF2e See Simple Scale
Statistics with its MIT notice, credited in the README; `test60.js`):
- On `renderActorSheetPF2e` for an NPC (not the simple sheet), for the GM:
  AC, HP, Perception, saves, attribute modifiers (inputs: a coloured glow),
  skills, weaknesses and resistances, each Strike's first attack button and
  damage button, each spellcasting entry's attack and DC (coloured text), by
  the original's selectors. Terrible red, Low orange, Moderate yellow, High
  green, Extreme blue (the original's colours).
- As the original: ties go to the middle; physical / all-damage IWR count
  double; persistent ×1.5, splash ×2; levels clamp to −1…24; Elite / Weak
  sheets are left alone (the switch says why). Average damage is worked out
  by a small arithmetic parser (dice → their average), not `eval`; anything
  else in a formula skips that Strike.
- Hover: "+17 Perception is Extreme." and the table rows for the level
  below, the level and above (HP and Strike damage as the book's ranges).
- A "Scale" switch with a colour legend before the Elite button turns it on
  and off for this GM (client setting `show`), re-drawing open NPC sheets.
- Not included (Q274): the ⚠️ creature-building warnings, the PF2e HUD
  integration, borders for colour-blindness.
- Switch off pF2e See Simple Scale Statistics.
- (verify) in PF2e 8.7: the NPC sheet still fires `renderActorSheetPF2e` with
  the original's selectors; `data-tooltip-html` on inputs and buttons.

---

## 19. Token Reactions (owner, 2026-11-18)

Owner: instead of (only) animations flying from token to token, the hit token
*reacts*, as in Hearthstone / MTG Arena: a lightning bolt hits the card and it
jumps, particles fly, the ground cracks and fades. Not for every attack.
"A simple 3D token" may be needed. The owner has JB2A (Patreon, a few GB);
Sequencer and Automated Animations are on in the PF2e world.

Idea: only the drawing reacts (as Token Scatter / Flying Tokens): the token's
art is lifted like a card (bigger, a shadow under it), tilted in fake 3D (the
art drawn on a subdivided mesh so it can lean in perspective), shaken and
knocked back away from the attacker, then settles. Under it, a ground decal
(cracks, scorch, frost) that fades; around it, particles and a flash in the
damage type's colours. The token document never moves.

| # | Question | Recommendation |
|---|---|---|
| Q276 | When: critical hits, kills (to 0 HP), and big hits (≥ ¼ of max HP); each a world option. | Yes |
| Q277 | Who sees it: everyone who can see the target (never hidden tokens); per player on/off and "less motion". | Yes |
| Q278 | Looks by damage type (PF2e types, 4e keywords): bludgeoning cracks + dust, slashing streak, piercing burst, fire embers + scorch, cold shards + frost, electricity bolt from above + jitter, acid splash, sonic ring, force/mental/spirit/vitality/void glows; strength scales with the hit. | Yes |
| Q279 | JB2A: our own drawn effects always work; if JB2A is installed, a matching JB2A impact clip is played on top (files read directly, no Sequencer needed). | Yes |
| Q280 | Systems: PF2e first (type and crit from the damage message), then 4e; elsewhere, HP drops only. | Yes |
| Q281 | First a mockup: a page with a token and a button per damage type, to tune the feel before building it into Foundry. | Yes |

Q276–Q281: owner, "All yes, start the mockup". Mockup:
`docs/mockups/token-reactions.html` (PIXI 7, also published as a private
artifact): two draggable tokens on a stone floor; a button per damage type;
Critical (hit-stop, camera shake, bigger), Drops it to 0 HP (the card falls
flat in perspective, cracks, greys and fades, then returns), share of max HP
(strength), damage number (optional), Less motion (flash + decal only). The
card is the token art on a 12 × 12 plane mesh tilted with a perspective
projection, on springs (knockback away from the attacker, lift with a
growing shadow, lean, spin, shake); the attacker lunges for weapon types.
Waiting for the owner's tuning notes.
Mockup v2 (owner: "the movement is too similar ... the cards go up, fly to the
sides, move around, like it took a real impact and moved almost like a coin"):
the springs are replaced by a small rigid-body simulation: a push along the
floor with friction, a hop with gravity, a tumble about the axis across the
push while airborne, a spin, bounces on landing (with a little dust), then a
coin-like wobble whose tilt circles faster as it dies down, and a glide back
to the square. Each damage type has its own throw (bludgeoning high hop,
slashing sideways spin-out, piercing flat and fast, electricity straight up,
force far, void pulled toward the attacker, mental twist ...), every throw is
randomised, and a critical hit adds one or two whole flips (the card's back
shows dark while it is upside down).

Owner (2026-11-18): chose the second mockup, `docs/mockups/token-reactions-fable.html`
("coin on the table"), as the look and feel. `token-reactions.html` is the
rejected one.

**Built v0.73.0 (phase 63): Token Reactions** (`tokenReactions`, Tokens page,
every system, on by default; `scripts/features/token-reactions/`
(`token-reactions.js` feature, detection, who sees it; `engine.js` layers,
particles, marks, the coin mesh, the motion model; `reactions.js` the twelve
looks, ported from the mockup with its numbers; `textures.js`; `jb2a.js`),
adapters `scripts/systems/pf2e/token-reactions.js` and
`scripts/systems/dnd4e/token-reactions.mjs`; `test61.js`):
- **When** (world options, Q276): critical hits, hits that drop it to 0 HP,
  hits for ≥ a share of max HP (default 25%).
- **Detection**, on the active GM's client only: an actor's HP (+ temporary HP)
  went down, compared with the last value seen (as the Damage Log does, so it
  works whoever applied it, also unlinked tokens; healing and a falling max HP
  are no hit). The type, the critical and the attacker come from the system's
  last damage roll: adapters turn a chat message into { type, crit, attacker,
  scene, targets, actors } (PF2e: `flags.pf2e.context.type "damage-roll"`,
  `outcome "criticalSuccess"`, the instance that deals the most, the speaker's
  token, the context / Target Helper targets; healing rolls ignored. 4e:
  `roll.options.hitTypeDamage`, `hitType "crit"`, the biggest typed term, our
  damage cards' stored targets). A drop takes the newest roll of the last
  3 minutes, not yet used for that creature, that was aimed at it or at nobody
  (areas); failing that a roll of the last minute nobody took yet (aimed at A,
  applied to B). No roll (any other system, HP typed in by hand): the default
  look, no critical, no attacker.
- **Sent**: `{ scene, token, type, crit, kill, share, amount, attacker }` by
  `broadcast`; nothing is sent for a token hidden from players (the GM's own
  client still plays it). Decision: the damage amount travels with it (as the
  Damage Log's entries do) and each client shows the number only where its
  user can see that token's HP bar (GM; owners; bars set to Always / Hover).
- **Who sees it** (Q277): a client plays it only when the token is on the
  viewed scene and `token.visible` (Foundry's own answer: hidden, out of sight,
  fog) and not hidden for a non-GM; the attacker lunges only if that user sees
  it too. Per player: Show them to me, Less motion (a flash and the ground
  mark only; also with the browser's `prefers-reduced-motion`), Damage number,
  Screen shake, Strength (0.5–1.5), JB2A impact on top.
- **Drawing**: the simulation runs in the mockup's units (a square = 90) and
  the layers are scaled by grid size / 90, so the mockup's tuning carries
  over. A reacting token gets a "coin": its own texture on an 8 × 8 mesh
  (tilt, flips, squash, bend, ripple, jelly, in fake perspective) at the
  size, rotation, mirroring, tint and opacity of its mesh. While it exists
  the token's mesh is `renderable = false` (bars, effects, nameplate and
  elevation text too, unless Less motion), re-applied every frame and on
  `refreshToken`; what was changed is put back exactly when the coin ends.
  The document, the token and its mesh never move; the art returns to the
  mesh's current position (so Token Scatter's offset and Flying Tokens' hover
  are respected; their state isn't touched; the Effects Halo's badges stay
  round the square). Differences from the mockup, because token art isn't a
  round disc: the rim, the flash, the back and the shadow use the art's own
  outline (a white copy of the texture rendered once per reaction); a token
  at 0 HP lands face down with a skull on its back, then fades back onto its
  square; no zoom "punch" on criticals (the stage's scale is Foundry's);
  the art rebounds off the scene's edge and off walls that block movement.
- **Layers**, in the primary group at the token's elevation and the tokens'
  sort layer: ground (marks, ground particles, shadows) at sort
  `HALO_SORT − 0.5` (over the Turn Markers, under the halo and every token),
  each coin at its mesh's sort, or above the other tokens (1e6 + y) while
  airborne, effects at 2e6; damage numbers on the interface group.
- One ticker callback, only while something animates; at most 600 particles;
  layers and outline textures destroyed when idle, effect textures when the
  feature is switched off. Canvas teardown, the feature (or Show them to me /
  Less motion) switched mid-animation, a token deleted or re-drawn: the
  reaction ends and everything is restored.
- Types → looks (Q278): the twelve of the mockup (bludgeoning, slashing,
  piercing, fire, cold, electricity, acid, sonic, force, mental, void,
  vitality); bleed → slashing (red), poison → acid, spirit / holy / radiant /
  positive → vitality, unholy / necrotic / negative → void, lightning →
  electricity, thunder → sonic, psychic → mental, precision → piercing;
  untyped, 4e "physical" and anything unknown → bludgeoning (the default).
- **JB2A** (Q279): with `jb2a_patreon` or `JB2A_DnD5e` active (and the
  player's option on, not Less motion), a .webm from its `Library/` is played
  over the token through a plain video texture (no Sequencer); a file that
  fails to load is remembered and skipped, the next candidate of that look is
  tried on the next hit.
- GM, in the settings window: a preview row (damage type; Preview / Critical /
  To 0 HP) that plays a reaction on the GM's targets (the selected token
  attacks) or on the selected tokens, for everyone, without damage.
- Not done: wall-aware flight is only a rebound (no sliding along walls); a
  critical from a failed save (PF2e basic saves) isn't recognised as critical;
  tokens with Foundry's dynamic ring lose the ring while they react (the coin
  shows the subject texture only).
- **(verify) in Foundry** (it couldn't be run here):
  - Plain `PIXI.Container`s with `elevation` / `sortLayer` / `sort` among
    `canvas.primary`'s children sort with the tokens (as Sequencer does), and
    render there (lighting applies to them like to tokens).
  - `token.mesh.renderable = false` hides the art and Foundry doesn't undo it
    visibly; `token.bars` / `effects` / `nameplate` / `tooltip` likewise.
  - `PIXI.SimpleMesh` and `PIXI.ColorMatrixFilter` exist in Foundry's PIXI;
    `mesh.texture` / `width` / `height` / `rotation` / `tint` / `alpha` /
    `anchor` / `sort` / `sortLayer` / `elevation` read as expected on a
    `PrimarySpriteMesh`.
  - Shaking `canvas.stage.position` (put back exactly) doesn't fight panning.
  - `CONFIG.Canvas.polygonBackends.move.testCollision(a, b, { type: "move",
    mode: "any" })` for the wall rebound (switched off by itself if it throws).
  - Unlinked tokens: `updateActor` / `updateToken` / `updateActorDelta` reach
    the HP check in V14 (the same hooks the Damage Log uses).
  - PF2e 8.7: `DamageRoll#instances[].type` / `.total`, `DamageRoll#kinds`,
    `context.outcome`, `context.target`, `message.speaker.token` on damage
    rolls (also persistent damage and spells).
  - dnd4e 0.9.3: `roll.options.hitType === "crit"`, typed terms' `flavor`.
  - JB2A file paths (all guessed, in `jb2a.js` `CLIPS`, under
    `modules/<jb2a>/Library/`): `Generic/Impact/GroundCrackImpact_01_Regular_Orange_600x600.webm`,
    `Generic/Impact/Impact_NN_Regular_<Colour>_400x400.webm` for NN = 01–08,
    10–12 (Blue as the free module's fallback; Orange, Red, Yellow, Green,
    PinkPurple, Dark_Purple on Patreon),
    `Generic/Impact/FrostImpact_01_Regular_White_600x600.webm`,
    `Generic/Lightning/StaticElectricity_03_Regular_Blue_400x400.webm`.

## 20. Signature Spells (owner, 2026-11-18)

Owner, after Token Reactions ("works pretty much exactly like I wanted"): "Now
we add effects to 'signature' spells, and I would like to merge with Dice So
Nice. One example first, then we go from there: Chain Lightning — the damage
dice have some lightning darting around while rolling; then when the result is
clear, lightning darts around all the dice; then from the last die, it hits
the first target, then the second target, etc., playing the lightning effect
on each token."

**Built v0.74.0 (phase 64): Signature Spells** (`signatureSpells`, Tokens
page, after Token Reactions, on by default; `scripts/features/signature-spells/`;
PF2e reader `scripts/systems/pf2e/signature-spells.js`; test `test62.js`).

- **A spell = one small file** in `signature-spells/spells/`, imported from
  `spells/index.js`, calling `defineSignature({ id, match, look, preview,
  rolling, result, toTargets })` (doc comment in `registry.js`), plus its
  switch's texts under `LUCD20.Feature.signatureSpells.Setting.<id>`:
  - `match`: per system, the item's slug and which roll starts it
    (`{ pf2e: { slug: "chain-lightning", roll: "damage" } }`), or a function.
  - `rolling(fx, dice, dt)`: every frame while the 3D dice roll.
  - `result(fx, dice)`: the dice have landed.
  - `toTargets(fx, ctx)`: from the dice to the tokens; `chain(fx, ctx, { look })`
    in `effects.js` is the ready-made "jump from target to target".
  - `fx` (in `effects.js`): `screenBolt` / `screenGlow` (on the screen, over the
    dice), `worldBolt` / `worldGlow` (on the scene), `strike(from, token)` (a
    bolt that arrives, then the token plays a Token Reactions look), `wait`,
    `less`, `memo`.
- **Systems**: a reader per system (`registerSignatureReader`) says what a chat
  message is: `{ slug, name, roll, caster, scene, targets, ordered }`. PF2e: a
  damage roll (`flags.pf2e.context.type === "damage-roll"`) of an item with
  that slug (`message.item.slug`, else the roll option `item:slug:<slug>`);
  targets = Target Helper's rows in their order, else the roll's own target,
  else the tokens the message's author has targeted (then ordered nearest-next
  from the caster). D&D 4e: no reader yet (no spell asked for).
- **Everything is local**: each client reads the same chat message and plays
  for its own user; nothing is sent (only the GM's preview is).
- **Dice So Nice** (v6.4.5 read from its source; nothing of it is changed,
  wrapped or delayed; `dsn.js`):
  - Hooks: `diceSoNiceMessageProcessed(id, { willTrigger3DRoll })`,
    `diceSoNiceRollStart(id, context)`, `diceSoNiceRollComplete(id)`. A message
    gets the dice part when, after every `createChatMessage` handler has run,
    DSN has started a roll for it (`diceSoNiceRollStart`) or marked it
    (`message._dice3danimating`), and has not said it won't animate it.
  - Dice on the screen: `game.dice3d.getScreenPosition(mesh)` (public) for
    each mesh in `game.dice3d.box.throwEngine.diceList` (the throw in play;
    `box.diceList` in older versions). Meshes not in the scene yet and
    persistent dice are left out. The dice seen while rolling are remembered,
    so the result plays on this throw's dice and not on older ones left on the
    table. Size on screen from the mesh's bounding sphere (else a guess).
  - Our drawing: a transparent full-window `<canvas id="lucd20-signature-overlay">`,
    `pointer-events: none`, z-index one above DSN's `#dice-box-canvas`; made
    with the first bolt on the dice, removed when the spell has ended.
  - No dice points (DSN's canvas hidden, fields renamed …): no dice part, the
    chain still plays.
- **Sequence** (Chain Lightning; times are the design, in ms):
  1. Rolling: every 45 ms a small arc leaps off a die (lives 130), 40% of the
     time also one from die to die (140). Nothing on the scene yet.
  2. Landed (`diceSoNiceRollComplete`): 700 — one bolt through all the dice in
     their order (the i-th link grows in 60·i), a glow on each, small arcs
     around each every 60.
  3. From the last die to the first target: a bolt on the screen overlay that
     grows in 120 and stays 260 more; when it arrives the token plays the
     electricity reaction, hit from the bolt's direction.
  4. 240 later the next bolt, on the scene, from that token to the next
     (120 to arrive): about 360 per target.
- **Who sees what**:
  - A roll this user may not see (`message.isContentVisible` / `visible`
    false: secret, blind, a whisper to others): nothing at all, also when DSN
    shows ghost dice.
  - Targets: only tokens this user sees on the canvas (Token Reactions'
    `canSee`: visible, not hidden unless GM), checked again as each bolt
    leaves. A hidden or unseen target is skipped without a pause; the chain
    jumps to the next.
  - The caster's token is the start only when this user sees it; else the
    first bolt comes from above the top of the view.
- **Without the dice** (decision): DSN not active, off for this user, not
  animating this roll (its own rules: hidden NPC rolls, "only my dice" …), or
  the dice never land (15 s): the reduced version — the chain alone, at once
  (or at the timeout), from the caster's token.
- **Token Reactions**: the reaction on each target is its engine
  (`playOn(token, { type, origin })`, new: a hit from a canvas point, nobody
  lunges), with this user's Token Reactions options (Less motion, strength,
  screen shake, JB2A). With Token Reactions off for the user: the bolts and a
  small burst of arcs on the token, nothing is thrown.
  - **No double reaction** (decision): the chain plays at the damage *roll*;
    the damage is applied later (saves first), which is when Token Reactions
    normally reacts. Each token the chain threw is claimed on that client
    (`claimReaction`, 3 minutes, used once): its next reaction of the same
    look is the quiet one (flash, ground mark, damage number — nothing thrown
    twice). A hit that drops it to 0 HP always plays in full. A preview claims
    nothing.
- **Less motion** (the Token Reactions option, or the system's reduced
  motion): nothing while the dice roll; on landing one still bolt through the
  dice for 320; a plain chain (no forks, no flicker), 160 between targets; the
  tokens only flash.
- **Options**: the feature (world, on); "Show them to me" (per player); one
  GM switch per spell (`chainLightning`). Switching any off ends what plays.
- **GM preview** (settings window): pick the spell, Preview — on the GM's
  targets (cast by the selected token) or on the selected tokens. The GM gets
  a throw of the spell's dice (`game.dice3d.showForRoll(roll, user, false)`,
  8d12) with the dice part; everyone else gets the chain alone
  (`signaturePreview` over the module socket; hidden tokens are never in it).
  Decision: the dice are not synchronised, because other clients couldn't tie
  an un-messaged throw to the effect.
- Not done: sound; a 4e reader; the dice part for other clients in the
  preview; when DSN queues two rolls one after the other, the rolling arcs may
  also play on the roll that is ahead in the queue.
- **(verify) in Foundry** (it couldn't be run here):
  - DSN 6.4.5: `game.dice3d.box.throwEngine.diceList` holds the meshes of the
    throw in play from spawn until the next throw; `mesh.parent.parent` is set
    once the die is in the scene; `getScreenPosition` gives viewport pixels
    that match what is seen; `mesh.geometry.boundingSphere` gives a sensible
    size (arcs start at the die's centre and reach 1.3–2.8 radii).
  - `diceSoNiceRollComplete` fires when the dice have *stopped* (before DSN's
    "time before hide"), so the 700 ms on the dice fit before they fade
    (default 2 s). With DSN's "show chat message immediately" the hook still
    comes at the end of the animation.
  - `message._dice3danimating` / `diceSoNiceRollStart` are set before a
    `setTimeout(0)` after `createChatMessage` (PF2e damage rolls go through
    DSN's normal chat hook).
  - The overlay's z-index (DSN's + 1) is above the dice in DSN's "over" and
    "auto" modes; in "under the interface" mode the bolts are above the
    sidebar while the dice are under it.
  - PF2e 8.7: `message.item` is the spell on its damage roll and
    `item.slug === "chain-lightning"` (remaster and legacy); `item:slug:…` in
    `flags.pf2e.context.options`; `message.speaker.token` is the caster.
  - PF2e Toolbelt: `flags["pf2e-toolbelt"].targetHelper.targets` is on the
    damage message when `createChatMessage` fires, as token uuids in the order
    targeted.
  - `message.author.targets` holds Token objects for another user's targets.
  - `canvas.interface` accepts a plain `PIXI.Graphics` (ADD blend) and draws
    it above tokens; `canvas.stage.worldTransform` ↔ viewport pixels (with
    the board's `getBoundingClientRect`) matches DSN's viewport pixels.
  - A token's reaction reads right when it starts as the bolt arrives while
    the dice are still on screen.

**v0.74.2 (owner):** "The dice going up is way too laggy and didn't look good,
revert back": v0.74.1 (dice jump and vanish) reverted; Chain Lightning is as in
v0.74.0. "When the token is just Subject Texture, it doesn't have a token
border": a dynamic-ring token's texture is only the subject (the ring is drawn
by the mesh's shader), so the coin now takes a snapshot of the token's mesh as
Foundry draws it (unrotated, unmirrored, then the coin's own rotation and
mirroring apply as before) and frees it with the coin; any trouble falls back
to the plain texture. (verify) the ring shader renders through
`renderer.render(mesh, { renderTexture, transform })`.

## 21. Swashbuckler finisher — a signature animation (owner, 2026-11-18)

Owner, after choosing from the mockup (`docs/mockups/swashbuckler-finisher.html`,
the reference for the look, the timing and every part): every part on — **E**
dice flourish, **A** cut-in strip, **D** signature mark with the **S** sigil,
**B** impact frame, **C** screen slash, **F** confetti with the **twirling
hat**; the per-finisher accents as in the mockup. "Damage is rolled, finisher
animation plays": it starts **only** on the damage roll of a Strike made with a
finisher — not on attack rolls, not on gaining panache. Signature animations
are rare and must be flashy.

**Built v0.75.0 (phase 65)**: the second signature of Signature Spells (§20),
`finisher`; `scripts/features/signature-spells/spells/finisher.js` (what starts
it, the options, the screen parts E and A) and `spells/finisher-canvas.js` (the
lunge, D, B, C, F and the throw, on Token Reactions' engine, §19); fonts in
`assets/fonts/`; test `test63.js`.

- **Detection** (the main session's reader, `systems/pf2e/signature-spells.js`,
  contract unchanged): any PF2e damage roll is read as `{ slug, name, options,
  outcome, finisher, roll: "damage", caster, scene, targets, ordered }`;
  `finisher` is `null` unless the roll options include `finisher`, else
  `{ slug }` (`unbalancing`, `confident` … or `null`). The signature matches
  with a function, `match: { pf2e: info => !!info.finisher && info.roll ===
  "damage" }` (and never a spell's damage roll: `item:type:spell` among the
  options).
  - `signatureFor` now looks for a slug match first, then for function matches:
    a spell with its own signature (Chain Lightning) is never taken by the
    finisher, whatever the order of the files.
  - The look: `confident`, `unbalancing`, `bleeding`, `dual`, `lethal`,
    `impaling` (a `-finisher` suffix is dropped). Anything else, or no slug:
    Confident's look and the strip says only "FINISHER!".
  - A critical (`outcome === "criticalSuccess"`): bigger everything, as the
    mockup's Critical option (a "CRITICAL" tag on the strip, a longer freeze,
    the frame starts inverted, the target flips).
- **The parts**, mockup → module:
  - **E dice flourish**, on Dice So Nice's own dice (`rolling` / `result`, as
    Chain Lightning): while they roll, a gold glow and a whirl that spins up
    around each die, throwing off sparks; when they have landed, a ring and
    sparks off each die, a blade glint across them (through the two dice
    furthest apart, left to right; each die flashes as it is cut), then the
    total pops above them with turning rays ("CRITICAL" under it on a
    critical). The total is the message's roll total. No Dice So Nice (or it
    doesn't animate the roll): no E, the strip comes at once.
  - **A cut-in strip**, on the screen overlay (2D canvas): the slanted band in
    the finisher's colour with rushing stripes, dots, streaks, gold edges; the
    portrait; the finisher's name, "FINISHER!" and the name line; a white edge
    wipes it in and out; the window dims under it, flashes and shakes as it
    lands. Sizes are the mockup's at 1280×720, scaled to the window.
  - **D signature mark**, on the canvas (a container of ours on the interface
    group): three blade-shaped strokes (S, X or star), each with sparks off its
    end; the target's art stands in, pinned and trembling; the mark shatters
    into shards as the target flies and stays scorched on the floor for 6 s.
  - **B impact frame**, on the canvas, above everything else on it: a white
    sheet over the view, black speed lines from the target (redrawn every
    0.05 s), one long blade line, and the tokens involved as stark two-tone
    cut-outs with a black outline; the sigil in white; a small zoom punch.
    Because the sheet covers the scene, nothing under it is hidden or changed
    and there is nothing to put back.
  - **C screen slash**: the stage is rendered into a render texture every frame
    for the freeze; two masked halves of it slide apart along the cut over a
    dark gap with a gold line, a glint runs along it, and they rejoin with a
    flash. Meanwhile the stage's other children are not rendered.
  - **F confetti**: the hat goes up from the swashbuckler, twirls and comes
    back (or 46 rose petals / 26 playing cards from the target).
  - **The throw**: Token Reactions' coin. Confident, Bleeding, Dual, Lethal:
    the slashing throw; Impaling: the piercing one and a thrust line out the
    far side; Unbalancing: a hop, then the art teeters on its rim; Bleeding:
    drips and a red trail for 2.6 s; Lethal: a crater, red rays, a red flash.
    Gold bursts on every hit.
  - **Dual**: the hits on `ctx.targets` in order, the first two: a quick first
    hit (0.05 s pause, thrown), the attacker's art spins on, the big hit (B, C,
    F) on the second. Any other finisher: the first target only.
- **Timing** (the mockup's, in seconds): dice land → 0.47 → strip (0.82 long;
  0.9 on a critical) → 0.7 (0.78) → lunge: wind-up 0.09, dash 0.1 → three
  strokes of 0.075 (0.062 for Dual) → the hit: frozen 0.15 with B, 0.2 with C,
  +0.07 on a critical, 0.05 with neither → the throw; the attacker goes home
  in 0.32; the hat takes 1.15.
- **What changed for Foundry** (decisions):
  - The dice are Dice So Nice's (the mockup drew its own); their number,
    kind and place are whatever was rolled.
  - No damage number: the damage is applied later, which is when Token
    Reactions shows it. Each thrown target is claimed (`claimReaction(id,
    null)`: any damage type, since the weapon decides it), so that later
    reaction is the quiet one (flash, mark, number), no second lunge or throw.
    A hit to 0 HP still plays in full. A preview claims nothing.
  - The ink cut-outs: there is no painted canvas to threshold. Each token's
    art (its coin's texture, a snapshot for a dynamic-ring token, else the
    mesh's texture) is rendered once, at most 256 px, through a small
    threshold filter (a fragment shader: luminance ≥ threshold → white, else
    black, alpha kept; a pushed colour matrix where a custom filter can't be
    made). The threshold is the art's own average brightness (read from a
    16×16 copy), so dark and light art both read. The textures are freed with
    the frame.
  - The screen slash only with WebGL 2; any error while preparing it or while
    it plays ends it and the hit goes on without. The stage's children get
    their own `renderable` back exactly, on every path (end, error, stop).
    The halves are re-placed at `prerender`, so a screen shake after our frame
    doesn't show an edge.
  - The freeze: `freezeFor(seconds)` in Token Reactions' engine holds its
    whole simulation still (coins, particles, marks) and lets go by itself.
  - The fonts are the mockup's (Anton, Kaushan Script; SIL OFL, licences
    beside them in `assets/fonts/`), loaded with `FontFace` when a finisher
    first plays; until then, and if they fail, Impact / a script fallback.
  - Engine additions for it: `useLayersAt(elevation)` (particles and marks
    without a coin), `freezeFor`, a particle's `flut` (petals and cards turn
    edge-on), `walls`, `snapshot`, `MARK` and `context` exported;
    `reactionOptions()` also gives `shake` and `intensity`.
  - Signature toolkit additions (`effects.js`, doc comment there):
    `fx.screenPaint` (painters on the overlay), `fx.flash`, `fx.shake`,
    `fx.tween`, `fx.later`, `fx.cleanup`, `fx.worldLayer`, `fx.get`, `fx.info`,
    `fx.total`, `fx.note`; a signature may declare `settings`, `solo`,
    `start`, `previewOptions`, `previewInfo`, `dispose` (`registry.js`).
- **Who sees what** (nothing is sent; every client reads the same message):
  - A roll this user may not see: nothing at all (as §20).
  - The strip and the impact frame only if this user sees the attacker's token
    or owns it (they name and show the attacker). Not seen: no strip, no B,
    nobody lunges, no hat, and the blow comes from a random direction, so the
    attacker's place is not given away; D, C and the throw still play on a
    target they see.
  - The name line: the actor's name for the GM and the actor's owners; for
    everyone else the token's name, and **none** when players can't see that
    name (`token.document.playersCanSeeName === false`).
  - The portrait: the actor's image for the GM and the actor's owners; for
    everyone else the token's art (what they see on the canvas anyway). An
    image that is a video or fails to load is skipped (then the token's art,
    then no portrait).
  - Targets this user doesn't see are skipped; with none left, only the strip
    plays. The frame inks only tokens this user sees.
- **Less motion** (Token Reactions' per-player option, or the system's
  reduced motion; exactly as the mockup): no B, C, F; the dice only glow and
  the total fades in and out; a short still strip (0.54 s, fades); nobody
  lunges; the sigil is drawn without sparks (0.1 s a stroke) and fades; the
  target flashes instead of being thrown; no flash of the window, no shake.
- **Token Reactions off for this user**: no art is moved (no lunge, no
  throw, no claim); the strip, the mark with its sparks, B, C and the confetti
  still play.
- **Options** (GM, world, under the feature; all default to the owner's
  choice): the finisher's switch `finisher`; `finisherDice` (E),
  `finisherStrip` (A), `finisherMark` (D) with `finisherSigil` (S / X / Star),
  `finisherFrame` (B), `finisherSlash` (C), `finisherConfetti` (F) with
  `finisherConfettiKind` (Twirling hat / Rose petals / Playing cards).
- **Cleanup**: the overlays take no pointer events. A run registers what it
  made (`fx.cleanup`); the feature switched off, a part's switch turned off,
  the canvas torn down or another finisher starting (`solo`) ends it at once:
  overlay and containers removed, the stage rendered again, the freeze let
  go, the tokens' own drawings back. Switching the feature off (and a canvas
  teardown) also ends what the Token Reactions engine is drawing.
- **GM preview** (settings window): pick "Swashbuckler finisher", a finisher
  (or "Any other finisher") and Hit / Critical hit; it plays on the selected
  token → the targets, with a throw of `2d8+1d6` when Dice So Nice is active
  (only for the GM, as §20); the others get it without dice.
- Not done: sound; the mockup's own token art and floor (Foundry's are used);
  a number on the hit; the dice part for the other clients in a preview.
- **(verify) in Foundry** (it couldn't be run here):
  - PF2e 8.7: a finisher's damage roll carries the roll option `finisher`, and
    names the finisher as `finisher:<slug>` or `item:slug:<slug>-finisher`
    (the reader's note); if it names none, every finisher gets the general
    look. `context.outcome` is `criticalSuccess` on the damage roll of a
    critical hit. A Strike's damage message has its target
    (`context.target.token`), and for Dual both targets (Target Helper's rows,
    else only the first is animated).
  - `token.document.playersCanSeeName` (PF2e) is false for an NPC whose name
    is hidden from players; `actor.isOwner` / `token.isOwner` for a player's
    own character.
  - The overlay (z-index one above Dice So Nice's canvas) puts the strip above
    the sidebar and the windows, which is meant; the dim under it covers the
    whole window.
  - The fonts load from `modules/lucd20-automations/assets/fonts/` (also with
    a route prefix) and the strip's text reads well; Impact until they are in.
  - `canvas.interface` draws our containers above tokens, lighting and fog
    (the sigil glows in the dark; the impact frame covers the whole view also
    when zoomed or panned); the frame's `zIndex` puts it above everything else
    there.
  - The ink cut-outs look right on real token art (the threshold from the
    average brightness; `renderer.extract.pixels` of a 16×16 render texture),
    also for dynamic-ring tokens and mirrored or rotated tokens.
  - The screen slash: `renderer.render(canvas.stage, { renderTexture })` from
    outside Foundry's own render gives the scene as seen (lighting, fog,
    weather), does no harm to the frame that follows, and is fast enough on
    the owner's machines (two renders of the scene per frame for 0.2 s);
    `renderer.context.webGLVersion === 2`; setting `renderable = false` on
    `canvas.stage`'s children for those frames has no side effect; the
    `prerender` event is emitted.
  - The lunge and the throw read right at real map scale; the hat's size; the
    Unbalancing teeter stays inside walls.
  - The dice flourish on real 3D dice: the whirl and the glint sit on the dice
    (`getScreenPosition`), and the 0.47 s on the dice fits before Dice So Nice
    hides them.
  - After the finisher, applying the damage gives only the quiet Token
    Reaction on the target (and the full one if it drops to 0 HP).

---

## 22. Bug fixes and new requests (owner, 2026-11-19)

The owner's list, checked against the code, then answered (Q282–Q296). No code
yet; build in the order of §22.2. PF2e rules get their rows in
`docs/pf2e-rules.md` (rules 21–24).

### 22.1 Decisions

| # | Item | What was found / decided |
|---|---|---|
| Q282 | Turn marker doesn't fit a scale-2 token | Size is `grid × max(w,h) × (1 + scale) × artScale` (`turn-markers.js:223`). Owner's screenshots: dynamic-ring tokens at Scale 2 (ring subject correction 2) and at 1.2 are both drawn about one square across, but the marker follows the 2 and is ~2.4 squares. Fix: with the dynamic ring enabled, the art scale is ignored (the marker fits the ring = the footprint); without a ring, footprint × art scale, the margin added on top instead of multiplied. (verify) in Foundry that the ring's drawn size is the footprint for any Scale; if not, measure the ring mesh instead. |
| Q283 | "Didn't trigger on Large PCs" | Owner: **Reactive Strike of a PC under Enlarge**. The footprint maths handles 2×2 tokens; suspect the reach: `reachOf` (`reactive-strike.js:61`) may not see Enlarge's +5 ft (the CreatureSize rule element). Fix: reach = the largest of `getReach({action:"attack"})`, `attributes.reach.base` and the melee strikes' reach; a debug log of the reach used; harness test with an enlarged 2×2 PC with 10 ft reach. (verify) what PF2e 8.7 reports for an enlarged PC. |
| — | Right-click drag shows "Describe" | `describe.js:188` only checks that *some* text is selected; an old selection stays, so a right-drag on the map opens the menu. Fix: only when the click is on the selection (its range rects contain the point), never on the canvas board, never after the pointer moved (a drag); the chat-menu entry the same. |
| Q284 | Everyone sees the pick ("All actions show to all"), GM takes over | One core layer for `pickSquare` / `pickSeveral` (and 4e's `movement/picker.mjs`, **pushes, pulls and Shift included**): the chooser's highlights, hover arrow and choice are broadcast; other clients draw **only the indicator** (no bar, no warning, nothing else), read-only; squares / tokens a player can't see are never sent to them. Only the chooser and the GM can act; the GM gets **Take over** (the chooser's picker closes, the GM's opens with the same state). Users: Shove, Demoralizing Charge (and its Drilled Reactions pick), Punishing Shove, 4e forced movement and Shift. |
| Q285 | Shove can't go through creatures | `rules.js:302` tests walls along the push but creatures only on the last square. Fix: every square of the push (the target's whole footprint at each 5 ft step) must be free; **any** creature blocks (allies, the shover). |
| Q286 | Frightened chat | Keep the message; "just write it in a single line" (the note wraps today): one line, smaller text / ellipsis like the compact cards. |
| Q287 | Describe → chat | Right-click → Describe **also posts the text to chat** (public, as narration, speaker the narrator). `/describe` unchanged (no chat message) unless the owner says otherwise. |
| Q288 | Sustain: second cast of a spell already sustained | Keep the new effect, and post one line "Duplicate effect? Yes \| No" (caster's players + GM, privacy as the other sustain lines). Yes deletes the new effect; No keeps both. |
| Q289 | Sustain re-posts the spell | Only **Earth's Bile** for now: on Sustain (card button or the Sustain action), its spell card is posted again at the cast rank, without `casting` flags (so no new effect, no Q288 line). A built-in list in `sustain.js`. |
| Q290 | New automations | Combat Assessment (Commander/Fighter feat 1) and Guardian's Deflection (Swashbuckler feat 4); **not** Slip and Sizzle. Specs in the ledger (rules 21, 22). |
| Q291 | Battle Medicine | A **Token HUD button** (under Riding's), hover shows: on the target, who already used Battle Medicine on it and how long until each can again; on a healer with Battle Medicine, whom they used it on (and time left); both if both. **No PF2e effect** is added; tracked in our flags from the Battle Medicine roll messages, by world time (1 day). Ledger rule 23. |
| Q292 | Flanking overlay | When your token is selected and you have a creature targeted that you flank: a "broken shield" icon on the target and a line from you to the flanking ally. While dragging your token, the same is drawn for where it would end (so you see where you will flank). Only tokens this user sees. Ledger rule 24. |
| Q293 | Damage per turn | A new tab in **Dice Stats**: per encounter, per creature, damage dealt and taken per turn / round. |
| Q294 | Dice per creature in combat | Both: a "This encounter" view per creature in Dice Stats, and a summary card when the encounter ends. Hidden NPC names and GM / blind rolls stay GM-only (as Dice Stats now). |
| Q295 | Sell | Item right-click → **Sell (½ price)**; anyone, no GM approval. The coins go to the seller, the item is removed. One chat line: "Item (compendium link): Sold, price". |
| Q296 | Hero start area | Creating an encounter asks the GM "Click on the map to create the start area \| Cancel". Click or click-and-drag marks squares; the drag is **wall-aware** (only squares reachable from where the drag started without crossing a wall). On the first area, **all PC tokens are teleported into it**, one per free square; with no room left they stack. The GM can keep adding squares. Starting the encounter deletes the area. |

Still to settle while building (proposals):
- Q284: which clients see the indicator: everyone who sees the tokens involved.
- Q295: a stack sells one item, or asks how many (proposal: a number field
  when quantity > 1); "price" is the item's price ÷ 2 (treasure too, as
  asked); PF2e only at first (4e: the same, from its price field).
- Q296: PCs = tokens in the scene whose actor is a player character with a
  player owner; the area is visible to everyone (players can see where they
  start), drawn as our own overlay, not a Region; Cancel / Escape stops
  adding squares; also for 4e (generic feature).

### 22.2 Build order

**Step 1 built v0.75.1** (harness tests 5, 19, 27, 37, 41, 48 updated):
- Describe: the menu only on a right click *on* the selected text (not on
  `#board` / a canvas, not after a right-drag of more than 4 px); Describe
  from the menu (ours or Foundry's chat menu) also posts the text to chat as
  a narration line (speaker "Narrator", public), option `postToChat`
  (default on).
- Shove: every square of the push is checked for creatures; for 10 ft, one of
  the half-way squares (the half of the offset rounded either way) must be
  free and no wall on either leg.
- Reactive Strike: reach = max(`getReach({ action: "attack" })`, base reach).
  PF2e's source: Enlarge sets the base reach (CreatureSize rule element,
  `reach.override` 10 / 15) and `getReach` returns it, and the 2×2 footprint
  maths was already right (new harness checks), so the cause is still
  unknown. `CONFIG.debug.lucd20Rules = true` now logs, for each move, every
  creature with Reactive Strike: footprint, reach, `getReach`, base reach,
  enemy, down, in combat, reaction left, square left. **Owner**: run that
  with the Enlarged PC and send the console line.
- Sustain: the duplicate line ("X: duplicate effect?" Yes / No; card kind
  `dup`).
- Pathfinding: hold **Ctrl** (or Cmd) instead of Q to keep away from
  enemies; the hint says Ctrl. (verify) Ctrl held during a V14 token drag
  does nothing else.
- Rule notes (Frightened, sustain endings, Reactive Strike disruption,
  Demoralizing Charge result, reactions): no message header, one line
  (ellipsis if the chat is too narrow); Frightened's text shortened
  ("Amiri: Frightened 2 → 1", "Amiri: no longer Frightened").
- Turn marker: size = footprint × (art + margin); art = 1 for a token with
  a dynamic ring (`doc.ring.enabled`).

Harness: tests 4, 11 and 13 fail before and after this change (their mocks
no longer match the module); not touched.

1. **Fix release**: Describe right-click (and → chat, Q287), Shove through
   creatures (Q285), Reactive Strike reach under Enlarge (Q283), Sustain
   duplicate line (Q288), the avoid-AoO key Q → **Ctrl** (`pathfinding.js`
   lines 70, 331, 343; (verify) Ctrl during a V14 token drag does nothing
   else), Frightened on one line (Q286), turn marker on ring tokens (Q282).
2. **Shared picks + GM Take over** (Q284): core, before anything else picks.
   **Built v0.76.0** (`core/shared-pick.js`, feature `sharedPicks` under
   Combat, default on; tests 64, 65):
   - The pickers (`pickSquare`, `pickSeveral`, 4e's movement picker) send
     what they draw as plain shapes (rects, the hover arrow, the path) with
     `User#query` to each other active user, throttled to 80 ms; only to the
     GMs when a token involved is hidden. The hint (it may name a creature)
     and the take over data go to the GMs only.
   - Watchers draw them (a little fainter) only on the same scene and while
     they see every token involved; players get nothing else. The GM gets a
     bar "Kyra: <hint> · Take over".
   - Take over: the chooser's picker closes (a notice "GM took over the
     choice"), the GM's opens with the same choices (shared with everyone,
     no second take over); the GM's choice goes back to the chooser's client
     (a square's index, the chosen values, or the 4e path) and the flow goes
     on there exactly as if clicked (Shove asks the GM to move, the 4e
     picker moves, Demoralizing Charge signals). Only the GM who took over
     can answer. The GM cancelling = the chooser cancels.
   - Users: Shove (shover + target), Demoralizing Charge and its Drilled
     Reactions pick (the commander), every 4e `pickMovement` (the moved
     token and the source): push, pull, slide, shift, free shifts, charge.
   - (verify) in Foundry: `User#query` to players (V13+ queries are not
     GM-only), and that the throttle is smooth enough over the network.
3. **Sustain re-post**: Earth's Bile (Q289). **Built v0.76.1**: the Sustain
   button and the Sustain action post the spell's card again
   (`spell.toMessage(null, { create: false, data: { castRank } })`, our flag
   `sustainRepost` so it isn't read as a new cast; GM-only when the caster's
   token is hidden); the end-of-turn "Yes" posts nothing. Matched by slug
   `earths-bile` or the name. (verify) the slug in PF2e 8.7.
4. **Combat Assessment**, **Guardian's Deflection** (Q290); Combat Assessment's
   1-day immunity shares the tracker of step 5. **Built v0.77.0**: rules 21,
   22 in the ledger; `systems/pf2e/immunity.js` is the shared tracker
   (flags on the target actor, world time); a Swashbuckler section under
   Classes.
**Parked (owner, 2026-11-19): steps 5–7 wait until after §23's drafting.**

5. **Battle Medicine HUD** (Q291), **Flanking overlay** (Q292). **Built v0.81.0** (rules 23, 24 in the ledger; test 69).
6. **Dice Stats**: damage per turn tab, dice per creature and the end card
   (Q293–Q294), one per-encounter record for both.
7. **Sell** (Q295; **built v0.82.0**, `systems/pf2e/sell.js`, test 70), **Hero start area** (Q296).

---

## 23. Adventure conversion tools (owner, 2026-11-19, drafting)

The owner converts Paizo adventures (Starfinder 1e → 2e, Pathfinder 1e → 2e)
into Foundry by hand: copy each check from the book, have an AI shorten it and
write the inline codes, convert the DC from a table, then build the folders,
journals, pages, NPCs and token art one at a time, and log fixes found in play
in Discord. Goal: cut the manual steps. **Ideas only, nothing agreed yet.**
The owner will send: the 1e → 2e DC sheets, a world with finished
conversions, and the Discord fix log (sample in the chat of 2026-11-19).
The old GPT conversion instructions are examples of the output wanted, not
rules to copy.

### 23.1 Ideas

**A. Converter (paste → converted HTML).** A GM window: paste a passage,
pick the source (SF1e / PF1e) and the party level, get the `<ul><li><p>`
list with the codes, and a live preview with the buttons working.
- Done by code, no AI, the same every time: `DC N Skill` → `@Check[skill|dc:M]`
  through the owner's skill map and DC table (cap at the table's max);
  the special actions (climb, swim, force open, pick a lock, hack, seek,
  sense motive, gather information, recall knowledge, identify magic) by
  keywords; `N%` → flat check; `XdY type damage` → `@Damage`; `1d4+1 days` →
  `[[/gmr]]`; bonuses / penalties halved (rounded up) as sub-bullets;
  "by 5 or more" / "failed by X" → **Critical Success** / **Critical Failure**;
  break stats → the door presets.
- What code can't decide (Mysticism → arcana / occultism / religion, "search"
  vs plain Perception) is highlighted in the preview with a picker; the
  choice is remembered for the next passage.
- Shortening the prose is the one part that needs an AI. Options: (a) keep
  it outside, the window copies a ready prompt; (b) call the Claude API from
  the browser with the owner's own key (GM-only client setting), the
  converter's codes kept, the AI only shortens the sentences. Proposal: (a)
  first, (b) if the owner wants it.
- An **Audit** button: runs the converter over an existing page and lists
  DCs that don't match the table and leftovers (`DC 26 Computers]`, "intimidate",
  "gp" in a credits book), which covers many of the Discord fixes.

**B. Adventure skeleton.** Paste a chapter's outline (headings as they come
out of the PDF: `Part 1: …`, `A1. Room (Moderate 3)`, `Event 2: …`) or pick
the PDF's bookmarks; preview the tree, then one click creates: a folder per
book / chapter with its colour, a journal per part with an Introduction page
and one page per entry, in the book's order, names cleaned. Each page body
can run through the converter (A). Later: map notes on the scene for each
A1/B2 page.

**C. NPC help.** Paste a 1e stat block → a PF2e NPC draft: level, traits,
senses, languages, AC / HP / saves / skills / Strikes / DCs set from
Building Creatures (the tables of Creature Scale) at the right band, the
1e abilities as action items with the text converted by (A) and a
pick of action cost and traits. Plus a **Quick adjust** on a sheet ("nerf
Lorkin", "reduce HP", "reduce DCs"): shift a creature's HP / AC / attack /
damage / DCs one band down or up in one click.

**D. Token Art Studio** (replaces the Photoshop step). Drop many images at
once; for each: the owner's frame drawn on top, drag / scroll to place and
zoom, the mask applied (circle of the frame, the subject allowed past the
frame's top if wanted), Enter → next. Saved in the browser as WebP
`name-like-this-token.webp` (named from the actor) into a chosen folder via
Foundry's upload, and assigned to the actor's prototype token and its placed
tokens (the old macro's job). Optional automatic background removal (an
in-browser model) if the subject has to be cut out, not just masked.

**E. Fix Log** (replaces Discord). A GM key / button "Log fix": a one-line
box, the context filled in by itself (book, scene, the selected token /
actor, the open journal page, the item clicked, date). A list window:
filter by book / chapter, done tick, click jumps to the thing. In the
adventure template world, sheets, journal pages and scenes with an open fix
show a badge. Both worlds share the log through one JSON file in the user
data folder (same Foundry server), matched by UUID (an Adventure import keeps
ids) or by name. Import of the old Discord text (dates and "Book N"
headings parsed).

### 23.2 Questions for the owner (Q297–)

- Q297: SF2e in Foundry: the PF2e system with the SF2e modules, or the
  separate SF2e system? Which version?
- Q298: The DC sheets: by level (1e DC → 2e DC per level) or one table?
- Q299: The source text: copied from the PDF (and which reader), or can the
  tool read the PDF itself? Are the books' bookmarks usable for (B)?
- Q300: AI for shortening: copy a prompt (no key) or call Claude with your
  own key from Foundry?
- Q301: Tokens: what does the frame look like, is it the dynamic ring or a
  frame painted into the image, and does "cut the mask" mean a circle or
  cutting the subject out of its background? Send one source image and the
  finished token. WebP or WebM (animated)?
- Q302: Fix log: are the play world and the template world on the same
  Foundry server? Is the template world the source of the Adventure you
  import (so ids match)?
- Q303: Which of A–E first? → see §23.4 (files reviewed first).

Answers (2026-11-19): Q297 the separate **SF2e system 1.7.0** (with the
`sf2e-anachronism` compendiums; PF2e for Pathfinder). Q298 by level (§23.3).
Q299 read the **PDF directly**; A / B should also *find* every passage with
a roll (skill, save, attack, flat) and list it per heading for review. Q300
Foundry + Claude is fine if Foundry alone can't. Q301 **dynamic ring**, PSD
template sent. Q302 same server, worlds built with the Adventure importer
(ids match).

### 23.3 What the owner's files show (2026-11-19)

- **DC table** (`DC_Sheets.csv`): perfectly regular. 2e DC = level DC (GM
  Core: 1→15 … 20→40) + an offset that depends only on (1e DC − level):
  ≤−3→−10, −2→−9, −1→−8, 0→−7, 1→−6, 2→−5, 3/4→−4, 5/6→−3, 7/8→−2, 9/10→−1,
  11–13→0, 14/15→+1, 16/17→+2, 18/19→+3, 20/21→+4, 22→+5, 23→+6, 24→+7,
  25→+8, 26→+9, ≥27→+10 (cap). Rows also give the minimum proficiency
  (Untrained … Legendary) and difficulty band. A small function, no AI. The
  second table in the sheet (rows 67–97, "1=9, 2=10 …") is not understood
  yet (Q305).
- **Finished conversions** (`sf2e-adv`: 9 books, 296 pages, 265 actors;
  `2e-cov`: Rise of the Runelords ch. 1–2): one folder per book (one colour
  per AP), sub-folders per Part for Actors / Items / Scenes, one journal per
  Part, one page per heading (`A. Main Floor`, `Event 2: … (Severe 7)`), plus
  a Treasure journal (level pages). Page body: a `<ul>` of checks, then
  `<h2>` Hazard / Creatures (`<h3>@UUID[Actor…]` + During Combat / Morale) /
  Treasure (item links). Codes used: `@Check` (skills, saves, lores,
  `piloting`, `computers`), 21 `[[/act]]` actions (recall-knowledge 105,
  hack 50, identify-magic 37 …), `@Damage`, `[[/gmr]]`, `[[/r]]`.
- **An audit of the finished pages already finds Discord-type bugs**:
  `@Check[intimidate…]` ×7, `@Check[mysticism]`, `[engineering]`,
  `[computer]`, `@Check[computers|dc:26]]` (the "remove ]" log entry),
  ~20 (SF) + 9 (PF) unconverted "DC N Skill" left in text,
  `@Check[crafting] DC 28` (DC outside the code).
- **Token template** (`Dynamic_token.psd`): 1024×1024; portrait group masked
  by a circle Ø 682 px, centred (⅔ of the image, the dynamic ring's subject
  area); a green guide circle layer (Círculo); a 50 % inner shadow arc at the
  lower right (Sombra, drop shadow). Files: `Starfinder/Adventures/<ap-slug>/
  actors/<name>.webp` art, `<name>-token.webp` token = ring subject texture,
  scale 1.

### 23.4 Proposed architecture (owner to confirm, Q304)

One converter (plain ES module; runs in Foundry and in Node, so the numbers
are the same everywhere): DC table, skill maps (SF1e / PF1e), the action
rules, damage / duration / bonus / critical formatting, and the audit.

1. **Reading the PDF: a Claude Code session** (the owner's Claude plan, no
   API key). The owner uploads the book PDF; Claude keeps the heading tree
   (Part → area / event), finds every passage with a roll (skills, saves,
   attacks, flat %, damage, durations, break stats, stat blocks), writes the
   short mechanical sentence and picks skill / action / recall-knowledge
   statistic; **the converter script**, not the AI, turns 1e DCs into 2e at
   that heading's level. Output `book.json` (tree, entries, original quote,
   page number), sent to the owner as a file. **Never committed** (Paizo
   text; the repo is public).
   - All in Foundry instead: pdf.js for the text + the Claude API from the
     browser with the owner's key (GM-only setting; Haiku 5.5 $0.10 / $0.50
     per M tokens, a book well under $1; Sonnet 5.5 $2 / $10 for better
     wording). Possible later; API credits are billed apart from the plan,
     and Paizo's two-column layout is the hard part either way.
2. **Foundry: Conversion Review + Build** (GM window). Load `book.json`: the
   tree on the left, entries on the right with the book quote, the converted
   line (editable, live buttons), the DC maths (1e DC 20 @ L6 → 23, Expert)
   and flags on uncertain picks; tick to accept. **Build** creates the
   book / part folders with the colour, a journal per Part, a page per
   heading in the owner's layout (checks, Hazard, Creatures with During
   Combat / Morale, Treasure), or merges into an existing page. **Audit** on
   any journal (the §23.3 findings).
3. Then on the same rails: NPC drafts from the stat blocks found (C), Token
   Art Studio (D, the PSD's numbers), Fix Log (E).

### 23.5 Questions for the owner (Q304–)

- Q304: OK with the split (a Claude session reads the PDF and writes
  `book.json`; Foundry reviews and builds)? Or all in Foundry (API key and
  credits)?
- Q305: The second table in the sheet (rows 67–97, "1=9, 2=10 …"): what is
  it?
- Q306: Which level converts a heading's DCs: the level in its title
  ("(Moderate 8)"), else the Part's level from the book? Is the party level
  the same as the 1e book's level?
- Q307: Tokens: is the green guide circle hidden on export? Do subjects
  ever go past the circle (head over the ring) or always clipped? Shadow arc
  on every token? `name-token.webp` next to the art, art untouched?
- Q308: First test book: one not converted yet, or one already done so we
  compare with your version?

### 23.6 Owner's answers (Q304–Q308) and what was built (2026-11-19)

- Q304: **split OK**: Claude session first, then Foundry. Owner: turn the PDF
  into Markdown with a script first (agreed: repeatable, strips the
  personalised watermark, Claude then reads clean text with headings).
- Q305: the small "1=9, 2=10" table was a paste helper for the old AI
  prompt; not needed.
- Q306: always the same level (the party level = the book's level).
- Q307 tokens: the green guide circle is hidden on export. Subjects often go
  past the circle; bigger tokens use a **150–200 % canvas** (the worlds show
  ring subject scale 1 / 1.5 / 2 with texture scale to match, so the canvas
  is 1024 × scale and the circle stays 682 px). The shadow arc is on every
  token but **under the parts that stick out** (today masked by hand), so
  the layers are: portrait clipped to the circle → shadow arc → the
  sticking-out part on top. Names: `<name>.webp` art and `<name>-token.webp`
  token, folders as in the worlds (`Starfinder/Adventures/<ap-slug>/actors/`
  or `/art/`). (Owner wrote "webm"; the worlds use **.webp**, Q310.)
- Q308: first test book: **Attack of the Swarm 6, The God Host Ascends**
  (in `sf2e-adv`: 3 parts, 13 pages, 18 actors under
  `ap24-the-god-host-ascends/art/`, tokens not made yet: token = art file).

**The DC workbook** (`DC_Sheets.xlsx`, more than the CSV):
- `DC` (PF1e) and `SF DC` (SF1e): same table; SF1e 1e DCs are **4 higher**
  for the same 2e DC, except at levels 14, 17, 19 where the sheet has a hand
  edit `+4-1` (shift 3; Q309). Proficiency: colour bands end at the label
  row (1e DC − level ≤ 6 untrained, ≤ 11 trained, ≤ 16 expert, ≤ 21 master,
  else legendary; the sheet's example L6 DC 20 → 23 Expert); difficulty
  bands start at the label rows (L+2 very easy … L+27 incredibly hard).
- `CR`: 1e CR → XP and the encounter mapping (APL −1 Easy → Trivial … APL +3
  Epic → Extreme; 40 / 60 / 80 / 120 / 160 XP). `GP`: 1e → 2e treasure by
  level (Paizo's conversion guide; median ratio, 19 % at 17+). For NPC (C)
  and loot conversion later.

**Built** (no Foundry code, no version bump):
- `tools/pdf-to-md/pdf_to_md.py` (PyMuPDF): two-column reading order,
  headings by font size (#–###, bold body lines ####), drops lines repeated
  in the page margins (running headers, page numbers, the buyer watermark),
  `<!-- p. N -->` per page. Tested on a made-up PDF only; tune on Book 6.
- `scripts/conversion/dc.js` (plain ES module, runs in Foundry and Node):
  `convertDc(dc1e, level, "pf1e"|"sf1e")` → `{ dc, proficiency, difficulty,
  capped }`; checked against every cell of both sheets (620 + 620, 0
  mismatches). CLI: `node tools/convert/dc.mjs sf1e 6 24`.

**Found on the way**: the module's PF2e features declare `systems:
["pf2e"]` and `isAvailable` compares with `game.system.id`, so **none of them
run in the SF2e world** (system id `sf2e`) (Q311).

### 23.7 Questions (Q309–)

- Q309: SF DC sheet, levels 14 / 17 / 19 use shift 3 instead of 4: meant,
  or a leftover edit? (The code follows the sheet for now.)
- Q310: tokens are `.webp` (still image) as in the worlds, not `.webm`
  (video)?
- Q311: should the PF2e features also run in SF2e (same engine, a fork)?
  Each would need a check in Foundry; a separate pass.

### 23.8 Owner's answers (Q309–Q311) and SF2e support (v0.79.0)

- Q309: the SF sheet's shift 3 at levels 14 / 17 / 19 is meant (kept).
- Q310: tokens are `.webp`.
- Q311: **everything for PF2e also runs in SF2e.** Built in v0.79.0:
  - `core/constants.js`: `SYSTEM_FAMILY = { sf2e: "pf2e" }`,
    `systemMatches(id)`, `systemFamily()`. Catalog entries, feature
    settings (`system:`), every system adapter (Dice Stats, Damage Log,
    Damage Estimate, Roll Chances, Modifiers Matter, GM Vision, Shortcuts,
    Token Reactions, Locked Door Alert, Loot Pile, Signature Spells) and
    the Token Tooltip preset use them, so a `"pf2e"` declaration applies in
    an `sf2e` world.
  - `systems/pf2e/sys.js`: `sysId()` (settings / flags namespace = the
    active system's id; SF2e worlds store `sf2e.*` settings and
    `flags.sf2e` on messages, checked in the owner's world), `sysApi()`
    (`game.pf2e` / `game.sf2e`), `sysConfig()` (`CONFIG.PF2E` /
    `CONFIG.SF2E`), `sysPack(name)` (the system's pack, else PF2e's),
    `sysSetting()`. Every `flags.pf2e`, `game.pf2e`, `CONFIG.PF2E`,
    `"pf2e.<pack>"` and `pf2e` setting in `systems/pf2e/` goes through them;
    Riding's size-link flags too. Creature Scale also listens to
    `renderActorSheetSF2e`.
  - v0.79.1: 0.79.0 failed to load (two wrong import paths, in Signature
    Spells' registry and Token Tooltip's presets); fixed. Harness test 67
    loads the module as `sf2e`, `pf2e` and `dnd4e` and checks which features
    register, `flags.sf2e`, `CONFIG.SF2E` and `sf2e.gmVision`; the harness
    page mocks SF2e like PF2e under its own id.
  - (verify) in SF2e 1.7: the API / config object names, the sheet class
    name, and each feature in play. If one does nothing in SF2e, check
    `sysApi()` / `sysConfig()` in the console first.

### 23.9 First test: Book 6, The God-Host Ascends (2026-11-19)

Pipeline run end to end on the PDF (book text and conversions kept out of
the repository):
1. `tools/pdf-to-md/pdf_to_md.py` now has style profiles. `paizo-1e` is
   picked by its fonts (Xirod + GoodOT): Xirod 12+ = `#` part, TradeGothic
   14 = `##` event / area group, TradeGothic SC 13 = `###` room (small caps
   rebuilt: "A1. L"+"anding" → "A1. Landing Pads"), Xirod 11 = `###`
   sidebar, GoodOT-CondBold 12 / AxionSSF 14 = `#### Stat:` (name and CR
   merged), map labels and the contents page dropped, bold / italic kept.
   Other books fall back to font sizes.
2. `tools/convert/find_rolls.py`: every sentence with a DC, save, skill
   check, %, attack or damage dice, by heading; stat blocks apart (a run-in
   label such as **Treasure:** ends a stat block); sentences cut by page /
   column breaks are joined. Book 6: 81 passages outside stat blocks in 32
   headings, every "DC N" in the adventure caught.
3. Claude wrote the 2e lines (owner's style and skill choices; 1e DCs as
   placeholders), `scripts/conversion/dc.js` filled the DCs at the party
   level.
4. Compared with the owner's finished Book 6 pages: of 84 lines, 38 have
   the same DCs, 24 are not on the owner's pages (mostly extra checks the
   book has: wreckage fields, the avalanche, acid water, the
   monk beetle…), 18 "differ" (many are wrong pairings by the word
   matcher or extra skill options; real ones: Storm the Spaceport 27 vs
   29, B7 recordings 29 vs 25), 4 skipped (starship placement, rule notes).
   Review page sent to the owner.

Learned:
- **Level changes inside a book.** The owner used 11 through area B and 12
  from C1 (the book: "reach 12th level during the missions"). The review
  needs a "level from this heading" control, defaulting to the book's
  milestones.
- The owner's journals give the condition UUIDs (`pf2e.conditionitems`
  ids), to turn "stunned for 1 round" into links automatically.
- Attack bonuses and SF1e damage dice are not DCs: flagged for the owner
  (attack bonus by hand; damage left as written, as on the owner's pages).

### 23.10 Owner's feedback on Book 6, round 1 (2026-11-19)

Recorded as rules in **`docs/conversion-guide.md`** (the instructions,
built book by book). In short: the misses the owner wants caught (travel
dice, rule consequences, Treasure / Development checks, hazards, sidebars);
skip 1e starship combat, chases, 1-round conditions outside combat; lines
say what the check does with context ("… to determine that …"); review rows
numbered. Round 2 of the Book 6 review sent.

Next (owner): tune on more books before the Foundry side. The owner's books
in conversion order: Attack of the Swarm 1–4, Rise of the Runelords 1–2,
Signal of Screams 1–2, AotS 5, SoS 3, AotS 6 (all in the worlds sent).
Proposed: AotS 5 (recent SF1e, the owner's current style) and RotR 2 (PF1e,
a different layout for the PDF profile).

### 23.11 Owner's answers (2026-11-19)

Doors: convert the Break DC as in Book 6 (no presets). 1e conditions and
ability damage: as proposed. Book 5's Mental Mirage is a **hazard actor**
(level 10, Psychic Lure / Psychic Invitation): events that work like hazards
become hazard actors, skipped in the journal. **Lores are good** (skipped by
hand only for the time): list a matching Lore next to the skill. All in
`docs/conversion-guide.md`.

## 24. Multiple Checks — `pf2eMultiCheck` (owner, 2026-11-19; built v0.80.0)

Owner: "Many times something can use more than one check with different
DCs and it is hard to put it all on the chat. … drag and drop (or create)
the @Check buttons into a Multiple Check window, then send to the chat. In
the chat it doesn't show the DC but the DC differences: DC 20 Athletics or
DC 18 Stealth shows: Athletics; Stealth (DC is 2 lower)."

Proposal (Q312–Q316 for the owner):
- **Window** (GM): a list of checks, each a skill / save / Lore / action
  (Recall Knowledge, Seek, Hack…) and a DC; add by dropping an inline
  check (from a journal, a chat card, an item), by pasting `@Check[...]` /
  `[[/act ...]]` text, or with a "+" row (skill picker + DC). Order by drag.
  An optional title line ("The cracked wall").
- **Journal shortcut**: hovering a journal list item with two or more
  checks shows a small "send as one" icon that fills the window (or posts
  directly, Q313).
- **Chat card**: one button per check, in the order given; the DC hidden
  from players; the first check is the reference and each other one says
  how it compares: "Athletics · Stealth (DC 2 lower)". Equal DCs say
  nothing. The GM sees the DCs. A player clicks a button to roll it with
  their selected token's actor (PF2e's own inline check with
  `showDC:gm`, so the system rolls against the real DC and shows the
  outcome per its "show DCs" setting).
- PF2e and SF2e (systems: pf2e); 4e later if wanted.

Questions:
- Q312: the reference: the first check (the example) or the lowest DC?
- Q313: the journal shortcut: open the window prefilled, or post at once?
- Q314: who can make a card: GM only, or players too (without seeing DCs)?
- Q315: save groups for reuse (a list in the window), or one-off cards?
- Q316: "or" / "and": show the book's word between checks (either check vs
  both needed), or just the list?

Owner's answers: Q312 the reference is the **highest DC** ("Stealth (DC 2
lower)"; the hardest check says nothing). Q313 **edit first**: the window,
opened by **Shift-clicking an inline check's "send to chat" icon** (owner's
idea). Q314 everyone sees the card, only the GM the DCs; the window is GM
only. Q315 one-off cards (the window keeps its list until Clear). Q316 just
a list.

**Built (v0.80.0)**, `systems/pf2e/multi-check.js`, Core Rules → Tools,
GM only, on by default (PF2e and SF2e):
- Shift + PF2e's repost icon (`i[data-pf2-repost]`, caught in the capture
  phase before PF2e's own document listener) adds that check, or every
  check of a check group, to the window; a plain click still reposts.
- The window: title, rows (label, editable DC, "DC n lower", move up,
  remove), a "+" row (Perception, saves, the system's skills, or a Lore by
  name), a paste box (selected journal text: its inline links are read;
  or `@Check[…]` / `[[/act …]]` codes, multi-type checks with adjustments
  included), drop selected text anywhere on the window; Clear, Send. Also a
  chat-controls button.
- The card: a list of PF2e's own links (`data-pf2-check` /
  `data-pf2-action`, `data-pf2-show-dc="gm"`), the DC inside
  `<span data-visibility="gm">`, "(DC n lower)" for players; clicking rolls
  with PF2e's handler against the real DC.
- Harness test 68. (verify) in Foundry: the repost icon and the action
  link's dataset in PF2e 8.7 / SF2e 1.7, that `data-visibility="gm"` hides
  the DC from players in chat, and the click on a posted action link.

v0.80.1 (owner's test: Shift-click, hidden DCs and action buttons work in
Foundry): a GM-only **Reveal DCs** button on the card; it edits the message
so everyone sees the DCs (`data-visibility` and `data-pf2-show-dc` → all)
and removes itself. Harness test 68 covers it.

## 25. Adventure conversion: where we stopped (2026-11-19)

Everything needed to continue the conversion work (§23) in a new session.
Rules for writing lines: **`docs/conversion-guide.md`** (read it first).

### 25.1 The pipeline (all in the repository)

| Step | Tool | Notes |
|---|---|---|
| World zip → JSON | `tools/convert/dump_world.mjs <world> <out>` | needs `npm install classic-level` in a scratch folder (run node from there); for comparing with the owner's finished books |
| PDF → Markdown | `tools/pdf-to-md/pdf_to_md.py book.pdf -o book.md` | PyMuPDF (`pip install pymupdf`); profiles `paizo-1e` (Starfinder 1e APs: Xirod / GoodOT fonts) and `paizo-pf1e` (RotR Anniversary: CartaMarina / NexusSerif; room keys run-in "A1 VERANDA:" or 13.5 pt headings; stat blocks quoted `> `), picked by fonts; else font sizes. A book split over PDFs: join the chapter's pages first (bookmarks via `get_toc()`) |
| Find the rolls | `tools/convert/find_rolls.py book.md --from "PART 1" --to "<first back-matter heading>" -o rolls.json` | stat blocks apart; sentences joined across page / column breaks |
| Party level | `grep` for the book's milestones; `tools/convert/infer_level.py <dump> "<folder>" rolls.json sf1e` | infers the level the owner used from finished DCs |
| Write the lines | Claude (or an agent) → `conv.py` | `C = {index: line or None}`, `"12a"` sub-lines, `NOTES = {index: reason}`; 1e DCs as `{N}` |
| DCs | `scripts/conversion/dc.js` `convertDc(dc, level, "sf1e"\|"pf1e")` | the owner's sheets, exact (620 + 620 cells); SF1e = PF1e + 4, shift 3 at levels 14 / 17 / 19 (owner: intended); CLI `node tools/convert/dc.mjs sf1e 6 24` |
| Review page | `tools/convert/build_review.py <dir> --source sf1e --title "…" --level "PART 1=9" --level "PART 2=10" [--world <dump> --folder "…"] [--round N]` | numbered rows (#1 …), the owner refers to them; compares with the owner's list items, table rows and paragraphs |

Book text, dumps, `rolls.json`, `conv.py` and review pages **never go into
the repository** (public). The working set of 2026-11-19 was given to the
owner as `conversion-work-2026-11-19.zip` (book6 / book5 / rotr: rolls.json,
conv.py, review.html, a README with the levels and compare folders); to
continue, the owner uploads it with the PDFs and world zips. `conv.py` is
keyed by `rolls.json` indexes: keep that exact file (re-running
`find_rolls.py` after a pattern change renumbers).

### 25.2 State of each book

| Book | Lines by | Round | Levels | vs the owner's pages |
|---|---|---|---|---|
| Attack of the Swarm 6, The God-Host Ascends (sf1e) | Claude | 2 (owner's round-1 feedback applied) | 11 from Part 1, 12 from C1 | 84 rows: 38 same DCs, 18 differ, 17 not on the owner's pages, 11 skipped |
| Attack of the Swarm 5, Hive of Minds (sf1e) | agent, guide only | 2 (Mental Mirage = hazard actor) | 9 from Part 1, 10 from Part 2 | 106 rows: 18 same, 33 differ, 46 new, 9 skipped; the owner built the chases as 2e chase tables |
| Rise of the Runelords Ch. 2, The Skinsaw Murders (pf1e) | agent + 16 by Claude | 1 | 4 Parts 1–3, 6 Part 4, 7 Parts 5–7 (owner's DCs; the book says 5th "early") | 125 rows: 50 same, 30 differ, 40 new, 5 skipped; an early conversion (old style) |

Waiting on the owner: corrections by row number on the three review pages
(Book 6 round 2, Book 5 round 2, RotR round 1).

The owner's books (in the worlds sent, conversion order): Attack of the
Swarm 1–4, Rise of the Runelords 1–2, Signal of Screams 1–2 (Diaspora
Strain, Penumbra Protocol), AotS 5, SoS 3 (Heart of Night, partly done),
AotS 6. Worlds: `sf2e-adv` (SF2e 1.7.0: AotS + SoS) and `2e-cov` (PF2e 8.7:
RotR ch. 1–2). Folder layout, journal / page layout and art paths: §23.3.

### 25.3 What the owner decided (all in the guide)

- Convert everything mechanical, especially what is easy to miss (travel
  dice, consequences, Treasure / Development checks, hazards, sidebars).
- Skip: 1e starship combat, chases (built by hand as 2e chase tables),
  1-round conditions outside combat, GM advice, stat blocks; events that
  work like hazards become hazard actors.
- Lines: the check first, then "to …" with enough context to read without
  the book.
- Level: the book's level at that point, set per heading.
- Break DCs converted (no door presets); 1e conditions and ability damage
  mapped as in the guide; Lores are welcome next to the skill.

### 25.4 What the agent test showed

Two agents converted Book 5 and RotR ch. 2 from the guide alone. Output
usable; every gap they reported was turned into a rule (condition ids,
percentages, bonus types, Seek vs Perception, Recall Knowledge vs a check,
basic saves, action costs, 1e conditions, chases, haunts). So a new
session (or agent per book) can do the writing step from the guide.

### 25.5 Left to build, in order (proposal)

1. **Finder: bonus / penalty lines** with no dice or DC ("−2 to attack and
   damage until …", "maximum Stamina −15"): add a pattern at the start of
   the next book. Better: give passages **stable ids** (page + hash of the
   text) so new patterns don't renumber `conv.py`.
2. **Foundry: Conversion Review + Build** (§23.4 step 2): a GM window that
   loads the book's JSON (rows, levels, lines), lets the owner edit and tick
   each line, set "level from here", then builds folders (book / part, the
   AP colour), a journal per Part, a page per heading in the owner's layout
   (`<ul>` of checks, then Hazard / Creatures / Treasure) or merges into an
   existing page. Needs: an export step from `conv.py` + `rolls.json` to that
   JSON (book text: the owner keeps the file), the owner's journal layout
   (§23.3).
3. **Audit** on any journal: codes with 1e skill names (`intimidate`,
   `mysticism`, `engineering`, `computer`), `]]` typos, "DC N" left in text,
   DCs outside the code; listed in §23.3 from the owner's worlds.
4. **NPC drafts** from the stat blocks (`find_rolls` keeps them apart; the
   CR sheet for encounter levels, Creature Scale's tables for numbers).
5. **Token Art Studio** (§23.6 Q307): 1024 × scale canvas, circle Ø 682 px
   centred, shadow arc at the lower right under any part that sticks out
   past the circle, `<name>-token.webp`, ring subject scale = canvas scale,
   assign to the actor and its tokens.
6. **Fix Log** in Foundry (replaces the Discord log; §23.1 E): quick "log
   fix" with context, a list per book, badges in the template world, shared
   between the two worlds through one JSON file (same server; Adventure
   imports keep ids).
7. The GP sheet (treasure by level) and CR sheet (encounter XP) are in
   `DC_Sheets.xlsx`, not yet in code.

Also parked from §22.2: Dice Stats per turn / per creature, Sell, Hero
start area (Battle Medicine HUD and Flanking overlay: built v0.81.0).

### 25.6 After v0.81.0 (owner, 2026-11-20)

Owner's ideas before testing 0.81.0 (built v0.81.1, rules 23–24 in the
ledger): Battle Medicine from the Treat Wounds and Battle Medicine macro and
the feat's action; Medic Dedication; a GM editor; the flanking overlay as
flankable squares, shown with the cover line for 5 s (editable) instead of
the always-on cover preview.

v0.81.2 (owner's test of 0.81.1): feat card known by its title too and a
warning without a target; the editor adds "<this token> treated …"; Battle
Medicine lines in the Token Tooltip for everyone (option under Token
Tooltip); the flanking shield always over the target. Also fixed: since
v0.81.0 the flanking overlay threw when `game.user.targets` was missing
(harness tests 25–26).

v0.81.3: the flanking overlay also threw on token moves when `canvas.tokens.controlled` was missing (harness tests 12, 23); full suite: all pass but the three old failures (4, 11, 13).

Battle Medicine tooltip design (owner: the 0.81.3 line "doesn't look great"): mockups A–E in
`docs/mockups/bm-tooltip.html` / `.png` (compact cell, footer line, token badge, chips, "can I treat
it?" for the selected healer, E + B). Waiting on the owner's pick.
Round 2 (owner: "C is the right direction, not there yet"): `docs/mockups/bm-badge.html` / `.png`:
C1 icon only + time on hover, C2 cooldown arc on the ring, C3 cooldown pie badge, C4 dots only while a
healer is selected (green = can treat, red = immune to you), C5 in the Effects Halo, C3 + C4.

v0.81.4: the owner picked C3 + C4: pie badges on immune creatures for
everyone, green / red badges on allies for the selected healer; the Token
Tooltip lines removed (its extension point stays, unused).
v0.81.5: the badge sits higher, clear of the HP bar (owner).

## 26. Encounter report — damage per creature (owner, 2026-11-20; built v0.84.0 as `encounterReport`)

Owner: "Has to kinda be per system. Damage dealt on turn, if dealt by
allies, counts to your total combat damage, so a commander sees how the
damage happened after he used Demoralizing Charge. Reports at the end of the
encounter: Total damage (dealt only by yourself) | Percentage of damage dealt
to the enemies (all enemies' HP vs the damage dealt by this creature). Some
damage will be placed wrong: a faded 'Missed damage' at the bottom. Later: a
'DPS / tanked the most / healed the most' end screen." (Replaces Q293–Q294.)

### 26.1 Proposal

**Recording (generic core, `features/encounter-report.js`):** per combat, on
the active GM's client, from the Damage Log's HP watcher (it already sees every
HP change, any source): each change → { round, turn (the combatant whose turn
it is), target, amount actually lost (capped at the HP it had: no overkill),
healing, temp HP, **source** (who dealt it, from the system adapter, or
null) }. Stored on the combat document's flags (deleted with it), copied
into a history when the encounter ends.

**Attribution (system adapters):**
- PF2e / SF2e: the "damage applied" message (`flags.pf2e.appliedDamage`)
  is linked to the damage roll it came from; the roll's actor = the source.
  (verify) how PF2e 8.7 links them (the applied message's origin / the
  damage roll message id) and persistent damage (source: the effect's
  origin, else "missed").
- D&D 4e: our own damage application (`dnd4e/damage-apply.mjs`) knows the
  attacker; ongoing damage from the effect's origin.
- No source found → "missed damage".

**Two numbers per creature:**
- **Damage**: dealt by itself, to enemies.
- **On its turn**: dealt to enemies by anyone on its side during its turn
  (the commander case: a Strike granted by a tactic, a reaction).

**End of encounter (a chat card when the combat is deleted / ended):** one
row per PC (and NPC allies): Damage | % of enemy HP (its damage ÷ the sum of
all enemies' max HP) | On its turn. A faded line "Missed damage: 34" at the
bottom. Enemy HP itself is never shown (only percentages). GM-only rows for
hidden NPCs.

**Dice Stats:** a new "Encounters" tab listing past encounters, each opening
the same table; per creature also the dice it rolled in that encounter.

**Later:** awards (most damage, damage taken, healing done) on the same data.

### 26.2 Owner's answers

Q317 damage to allies: counted separately. Q318 "% of enemy HP": of the
HP they had when the combat started. Q319 the end card: everyone by
default. Q320 healing and damage taken: in the card now. Q321 minions /
summons / companions: both (own rows, and added to their master's total).

### 26.3 Questions as asked (Q317–Q321)

- Q317: Damage to allies (friendly fire, splash): not counted, or counted
  separately?
- Q318: "% of enemy HP": of all enemies' max HP (proposal), or of the HP
  they had when the encounter started?
- Q319: Who sees the end card: everyone (proposal), or GM only with a
  "show to players" button?
- Q320: Healing and damage taken in the card now (two more columns), or only
  in the later awards screen?
- Q321: Minions / summons / companions: their damage counts to their
  master's total, or own rows?

## 27. Party bulk (owner, 2026-11-20; built v0.83.0 as `partyLoad`)

Owner: "Total party bulk: the maximum bulk of each creature in the party,
how much they have together, and how much bulk is in the party stash, like a
party encumbrance. Bag of holding / spacious pouch increase this as well.
Also in the 4e party sheet."

Proposal:
- **PF2e / SF2e** (the Party actor sheet, inventory tab, next to PF2e's own
  bulk line): "Party bulk: 23 / 41", where 23 = everything the members carry
  plus the stash's bulk, and 41 = the sum of the members' limits plus the
  capacity of extradimensional containers (Bag of Holding, Spacious Pouch:
  items whose bulk is ignored inside, `system.bulk.capacity`). Hover: per
  member "Amiri 6 / 9 (encumbered at 9, max 14)", the stash, each bag. Over
  the limit: the number turns orange (encumbered) / red (past max).
- **D&D 4e** (our Party Stash window): the same with 4e's encumbrance
  (normal load, heavy load, max drag; the stash's weight); bags of holding
  (4e: 200 lb capacity) add to it.

Questions (Q322–Q324):
- Q322: The members' limit: PF2e's encumbered threshold (5 + Str: carrying
  more slows you) or the maximum (10 + Str)? Proposal: show encumbered as the
  limit, max in the hover.
- Q323: A bag of holding carried by a member: its contents count toward
  that member already (PF2e does it); add only its capacity to the party
  limit? (proposal: yes, every bag in the party, carried or stashed).
- Q324: 4e: weight in pounds as the sheet shows it, or 4e's "bulk" isn't a
  thing so pounds only (proposal: pounds)?

### 22.3 Sell (built v0.82.0)

Owner: "Sell in 2e is half price, no need for anything else. Add a Sell
everything in the Loot sheet, so it sells all equipment (not treasure) for
half price." Built (`pf2eSell`, Core Rules → Tools, PF2e / SF2e, on):
- A Sell icon in each non-treasure, non-coin physical item's row controls
  (before Edit) on character, NPC, familiar, loot and party sheets, for
  owners; tooltip "Sell for 5 sp (half price)". Half price with PF2e's own
  maths (`Coins.fromPrice(price, qty).scale(0.5)`: per-batch prices, coin
  spillover, SF2e credits); coins to the same actor (`addCurrency`); a stack
  asks how many; a container's contents are moved out first. Chat:
  "Longsword: sold for 5 sp" (the compendium link when there is one). No
  confirmation (as PF2e's own sell-treasure). (Q295 said right-click; PF2e's
  item rows have no context menu, so it is an icon.)
- Loot sheets: "Sell all equipment" next to PF2e's "Sell all treasure":
  every priced item but treasure and coins, half price, after a
  confirmation with the count and total; treasure inside a sold container
  is moved out; unpriced items stay. One chat card with the list.

### 27.1 Answers and what was built (v0.83.0)

Q322: "like PF2e does it, with a bar and the two ticks". Q323: only the
containers in the party stash. Q324: pounds (4e).

Built: feature `partyLoad` (Sheets & Windows, PF2e / SF2e and D&D 4e, on),
`features/party-load.js` (the bar: fill = load, ticks at the summed
encumbered and maximum limits, scale to 112 % of max; orange past the first
tick, red past max; hover lists members, stash, bags) with adapters:
- PF2e (`systems/pf2e/party-load.js`): `game.actors.party` members with a
  bulk limit (PF2e's `inventory.bulk`), the stash = the party actor's
  inventory; top-level stash containers with `system.bulk.ignored` > 0 add
  that to both limits, and what they ignore (min(contents, ignored)) is
  added back to the load. Under the party sheet's "Total bulk" line;
  redrawn when a member's or the party's items change.
- 4e (`dnd4e/party-stash.mjs`): player characters' `system.encumbrance`
  (value, normal load = "encumbered", heavy load = "max"), the stash's items
  by weight (contents of containers counted), weightless containers in the
  stash add their capacity; in the Party Stash window under the coins.
Test 71.

### 26.4 Built (v0.84.0)

`features/encounter-report.js` (Combat, GM, on; option "Everyone sees the
card", on) with adapters (`systems/pf2e/encounter-report.js`; 4e in
`dnd4e/damage-apply.mjs`):
- Recording on the active GM's client from combat start (`combatStart`, or
  the first update of a started combat): participants (name, side from the
  token's disposition: friendly 1, hostile −1 / secret −2, HP + temp at the
  start, master), then every HP change (value + temp, the Damage Log's
  reading; linked and unlinked tokens) → { round, turn (the combatant whose
  turn), target, amount, kind, source } on the combat's flags.
- Sources: "hints" `noteSource(target, source, kind)` (from any client; to
  the GM by socket), matched to the change within 4 s before or after:
  PF2e's damage-taken message (`appliedDamage.uuid`; source =
  `origin.actor`; persistent damage: the condition's
  `system.context.origin.actor`), 4e's damage buttons (the damage card's
  speaker, before applying). Settled 2 s after the change.
- The card on `deleteCombat`: rows for the friendly side (not hidden
  combatants), best first: Damage (+ companions', master from PF2e's
  `actor.master`) | % enemy HP (of the enemies' HP at the start) | On turn
  (damage to enemies by its side or by an unknown source during its turns)
  | Allies (friendly fire) | Taken | Healed; "Missed damage: N" faded. A
  world history (`encounterReport_history`, newest 20) for a later tab.
- Test 72. (verify) in Foundry: the damage-taken message's origin in PF2e
  8.7, persistent damage, eidolons / animal companions as masters.

v0.84.1: Battle Medicine "Roll on use" (the owner's console log showed the
action is read and recorded since 0.81.2; what was missing was the roll):
using the feat opens the Workbench macro with Battle Medicine chosen, else
PF2e's Treat Wounds roll; the roll records the use.
v0.84.2: the Battle Medicine badge mirrors the reaction badge (same size, bottom-left corner of the token).

### 26.5 v0.84.3 (owner's test: "should be a window; it didn't track anything")

- The report is a window (`ReportWindow`), opened for everyone at the end
  of the encounter (broadcast; option "Everyone sees the report"), with a
  dropdown of the past encounters (history, newest 20) and a chat-controls
  button to reopen it. No chat card.
- Recording also starts lazily on the first HP change of a started combat
  without a record (a combat already running, or a missed start; Foundry
  fires `combatStart` while still at round 0, so the start comes from the
  `updateCombat` to round 1).
- Debug: `CONFIG.debug.lucd20Report = true` (or `lucd20Rules`) logs the
  start, every HP change seen (with whether it is recorded), hints, events
  and the end.

### 26.6 v0.84.4 (the owner's debug log: why nothing was recorded)

- The log showed recording, HP changes, events and their sources all
  working. The bug was in the saved data: the participants were keyed by
  actor UUID (`Actor.x`, `Scene.y.Token.z.Actor.x`), and Foundry expands
  dotted keys in an update into nested objects, so the report looked up
  nobody (no rows; all damage "missed"). Participants are now an array of
  `{ uuid, … }`; `buildReport` also accepts the old keyed form.
- Lesson for the harness: test 72's mock `setFlag` now expands dotted keys
  like Foundry does (the old code fails it). Never use UUIDs as keys in
  flags or other document data.

### 26.7 v0.84.5 (owner: "Encounter now works. Now the refining, with a better looking window")

- The window uses the Loot Pile look (`lucd20-loot-app` tokens): the
  encounter picker in the header bar; totals tiles (Dealt, Taken, Healing,
  Rounds); one card per creature, best first, with its portrait
  (participants now store `img`, the actor's portrait), name, damage
  (+companions), % of enemy HP, a bar (its share of the best; companions
  in a darker segment), and small stats (On turn, Friendly fire, Taken,
  Healed; zeros faded). The best gets a crown and an accent border.
  "Missed damage" faded at the bottom. Screenshot:
  `docs/mockups/report-sell-0.84.5.png`.
- v0.84.6 (owner: "dont do a crown for most damage nor a 'progress bar'.
  This will cause feels bad. Show just stats"): no crown, no top highlight,
  no bars; cards sorted by name, not by damage.
- v0.84.7 (owner, from the first real report):
  - Pictures were broken (stretched past the circle). The report now uses
    the Loot Pile's portrait helpers (`tokenArt` + `portraitHTML`, exported
    from `loot-pile.js`): the ring subject's art, the token's scale (art
    stands out of its circle as on the map), no videos (webm → the actor's
    picture). Owner: "this has been happening with almost anything that
    uses pictures": the same helpers should be used everywhere (to do:
    list the other places with the owner).
  - The error "Cannot read properties of undefined (reading '_id')" from
    `flushSaves`: a save reached the server after the combat was deleted.
    The recording now lives on the GM's client (`state.local`; the flag is
    only a copy for reloads); the end reads that copy; no saves after the
    end; failed saves are ignored.
  - Scene name: from the combat, else the viewed scene ("No scene" if
    none); "1 round" / "N rounds".
  - Enemies section (owner: "NPCs also need to show there, but
    differently ... more for the 'Oh wow, that NPC barely did anything!'
    or 'We killed that one in a round!'"): per enemy, biggest hit dealt,
    best turn (most damage in one turn), biggest hit taken (and by whom),
    attacks hit / made (+ crits; PF2e `context.type "attack-roll"` +
    `outcome`), "Down in round N" / "Still standing" (an HP change to 0).
    Hidden combatants get no card. A name players can't see
    (`playersCanSeeName === false`) is never stored (the history is a world
    setting all clients read): "Unknown creature" + the placeholder picture.
  - Not yet: D&D 4e attack hits (no outcome on its cards yet).
- Next (owner): stats first, then "Hallmark cards" (name to decide): every
  player always gets one. Was "Title / Combat Role": picture, then the role this combat
  (e.g. "DPS: you dealt X damage", "Meat shield: you took X damage", …).
  To plan with the owner after the window is approved.

### 22.4 Sell (v0.84.3)

Owner: "Ask for confirmation when selling. Add the same icon on PCs' sheet,
next to 'sell all treasure', 'add coin' etc. like 'Sell items', and from
there they can sell in bulk." Every single sale is confirmed (a stack: how
many, in the same dialog, with the price each). Characters / NPCs /
familiars get "Sell items" after "Sell all treasure": a window listing
sellable priced items (checkbox, how many for stacks, half price each),
Select all / none, the total, "Sell selected" (confirmed; one chat card).
v0.84.4: a Cancel button closes the window (owner). v0.84.5 (owner: "I
meant the individual sell window needs a cancel button. The bulk sell
window needs stylizing too"): selling one item uses the Loot Pile's "How
many?" dialog (`LootQuantityWindow.wait(item, null, "Sell", opts)`, now
with title / icon / sub lines / a label function; the number is hidden for
a single item), with Sell N for {price} and Cancel. The Sell items window
has the Loot Pile look: select-all box (some/all), item rows with icons,
how many (changing it picks the row), the price and price each, Total,
Cancel and "Sell N". Test 70.
