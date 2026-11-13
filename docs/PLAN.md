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
- **Per-player toggle** in Token controls (route icon), on by default (Q26).
- **Cost** (owner, Q29): steps per the scene's diagonal rule (PF2e 5/10/5
  with the parity carried from the movement history); **difficult terrain**
  (regions with a movement-cost behaviour; system behaviours that mark
  difficult terrain) costs its multiplier (+0.25 so equal routes avoid it) —
  **hold T** while dragging to ignore terrain; squares **next to a visible
  enemy** (opposite disposition, not defeated; no reach/reaction logic, on
  purpose) cost +4 squares to pass through, except the destination —
  **hold Q** to ignore. Only tokens this user can see count, so nothing
  leaks. Note: T is also Foundry's target key.
- **Players only route through explored or visible areas** (Q28):
  `canvas.fog.isPointExplored` if V14 has it, else the explored fog texture is
  read once per drag (Wayfinder's approach), plus what's visible now. The GM
  routes anywhere.
- Plain-JS A* with a binary heap on grid cells (state = cell + diagonal
  parity), token footprint, walls in a bucket grid (a wall end on the move
  blocks too, so diagonals can't slip through corners), collinear points
  dropped. Cached per drag; rebuilt on wall/region/token changes. 60 × 60
  maze ≈ 50 ms in the harness.
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

---

## 5. Open questions

- Next pass: see §6.3 (all answered).
- Third pass: see §7.3. Each question has a recommended default; build with
  the default only if the owner says so.

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
