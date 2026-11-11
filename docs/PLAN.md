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
- Defaults: rotation speed 0.1 rotations/second (0–3), scale 0.45 (0–3, in
  0.05 steps), follow art scale off.
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
*Replaces Combat Booster's "Body pile".*
- When combat ends, if any NPCs died, the GM gets a **review window**: items
  grouped by NPC (NPCs sorted by level, then name; items alphabetical), with
  checkboxes. Only real gear is listed (weapons, armor, equipment,
  consumables, treasure, coins). NPC attacks, spells, feats and effects are
  ignored.
- Confirming creates a loot token at the **center of the dead NPCs**,
  holding the checked items (moved off the NPCs), still grouped by NPC.
- Players open the pile and use **Take** (to their character) or
  **Party Stash**. Transfers are carried out by the GM's client via socket.
- PF2e: native loot actor + native party actor inventory.
  Other systems: module-provided loot pile and Party Stash (see §1).
- Settings: enable · include coins · pile token name/image.

### 💬 Chat

#### Chat Pins
*Replaces DFreds Chat Pins.* ✅ v0.5.0
- **GM only.** Right-click a message → Pin Message / Unpin Message.
- Pinned messages get a **gold or blue outline** and a pin icon.
- A **pin button next to Export Chat Log** opens Pinned Messages (newest
  first, with "Show in chat" and Unpin).
- "Clear Chat" deletes everything except pinned messages; those leave the
  main log and stay in Pinned Messages. Unpinning one of those deletes it.
- Settings: outline color (gold/blue) · players see pin outlines.

#### Damage Log
*Replaces Damage Log.*
- A separate log of HP changes (damage and healing).
- Generic: actor, old HP → new HP, temp HP, timestamp.
- PF2e: uses PF2e's applied-damage messages for the cause (which roll),
  damage types, resistances / weaknesses / immunities applied, temp HP
  absorbed, shield block, persistent damage, and an undo button (GM).
- **Players only see entries for tokens whose HP bar they can see.**
- Settings: enable · visible to players · PF2e details.

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

*Replaces GM Vision and works alongside PF2e's built-in GM vision.*
- **On by default for the GM.** Selecting a token does **not** switch to
  that token's vision; the GM keeps seeing the **full map**. Darkness is
  dimmed instead of black; walls cast dimmed shadows.
- **Ctrl+G** toggles to real vision (tokens that can't see, can't see;
  walls block normally). The key can be changed in Foundry's controls.
- **Out-of-sight outlines**: tokens no player token can see are drawn with a
  dashed outline.
- PF2e: drive the system's own GM vision toggle instead of competing with it,
  and add the outlines.
- Risk: low-level canvas code; V14's canvas changes (scene levels) need
  careful testing.
- Settings: enable · on at startup · darkness dimming amount ·
  out-of-sight outlines.

### 🗂️ Sheets & Windows

#### Clean Title Bars
*Replaces Cleaner Sheet Title Bar.* ✅ v0.4.0
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
- Promoted items are only hidden inside the ⋮ menu; Foundry's own list is not
  changed, so the ⋮ button stays for the remaining items (fixed in v0.5.0).
- Settings: Prototype Token · Configure Ownership · Other ⋮ items. Per player.

### 📊 Statistics

#### Dice Stats
*Replaces Dice Stats.*
- Generic (all systems): per user, per die type; distribution, natural
  minimum/maximum counts, averages.
- PF2e: split by roll type (attack, saving throw, skill check, Perception,
  damage, flat check) and degree of success (crit success … crit failure).
- **Everyone can view everyone's stats.**
- Two counters per user: **All time** (never reset) and **Session**.
  When the GM joins the world, a prompt asks **"Reset session?"**. Yes clears
  the Session counters only; All time is kept.
- Stored on each User document (survives clearing chat).
- GM blind / secret rolls never appear in player-visible stats.
- Settings: enable · ask to reset session on GM login.

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

*Replaces the Monk's Active Tiles search setup.*

#### Search Automation
- **Who is Searching**: read from the character's exploration activity, as
  set in the PF2e party sheet's Exploration tab. No more "Search-Trained"
  effects or fake skills. *(Verify the exact field in 8.7.)*
- **Proficiency** comes from the character's Perception rank.
- **Search spots** (secret doors, clues, hidden items) are native **Scene
  Regions** with a module behavior: DC, minimum proficiency, GM note.
- The roll is PF2e's own secret Perception roll, flagged as the Search action,
  so feats and items that affect Search apply automatically.
- **On success**:
  1. Pause the game.
  2. Pan and zoom so the searchers and the found thing are in view.
  3. Scrolling text **"Found something..."** on the finder's token, seen by
     all players.
  4. Disable that spot.
- **One failed roll per character per spot.** A **Reset Search** button
  (per spot / per hazard, and scene-wide) clears successes and failures.
- Settings: enable · pause on find · pan camera · scrolling text.

#### Hazard Detection
- A **Detection** section on the hazard sheet: enable · range · DC
  (prefilled from the hazard's Stealth) · minimum proficiency.
- The range is a vision-style area from the hazard: walls block it, and
  opening a door extends it automatically.
- Triggered when a Searching character's token is inside the area (by moving
  in, or by a door opening). Then a secret roll is made for **every**
  Searching character, even those outside the area (a forgotten token
  shouldn't be punished).
- On success: same as Search spots, plus the hazard token is revealed, and
  detection is switched off for that hazard.
- Same one-failure-per-character rule and Reset button.

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
| 7 | Damage Log (generic → PF2e) | Sets the generic + system pattern |
| 8 | Dice Stats (generic → PF2e) | Follows that pattern |
| 9 | GM Vision | Riskiest canvas work |
| 10 | Loot Pile + Party Stash | Needs system adapters + placement |
| 11 | PF2e Search + Hazard Detection | Largest; reuses parts of 9 and 10 |

---

## 5. Open questions

- **Loot / Party Stash outside PF2e**: new actor sub-type vs. flagged
  existing type (decide while testing on 4e).
