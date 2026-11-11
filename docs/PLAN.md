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

System-only features get their own category, shown only in that system.
System-specific extras of a generic feature appear inside that feature's card
under a labelled sub-section (e.g. "PF2e").

```
⚔️ Combat               Turn Marker · Next-Turn Marker · Turn Announcer · Loot Pile
💬 Chat                 Chat Pins · Damage Log
🗺️ Tokens & Placement   Multi-Token Edit · Folder Drop
👁️ GM Vision            GM Vision Mode · Out-of-Sight Outlines
🗂️ Sheets & Windows     Clean Title Bars · Always Show Prototype Token
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
*Replaces part of Combat Booster.*
- An image under the token of the active combatant, rotating.
- Size follows the token: marker size = token size × scale (a 2×2 token gets
  a 2×2-sized marker).
- Settings: enable · image · rotation speed · scale · opacity.

#### Next-Turn Marker
*Replaces part of Combat Booster.*
- Same idea, shown on the combatant who acts next.
- Skips defeated combatants. Never shown to players on tokens they can't see.
- Settings: enable · image · rotation speed · scale · opacity.

#### Turn Announcer
*Replaces Turn Announcer.*
- On each turn change, posts a **chat card**: token image, name, owning
  player's name.
- Hidden combatants: **skipped** (no card). Respects the system's
  hidden-NPC-name setting.
- **"You're up next" heads-up**: the owner(s) of the next combatant get a
  private notification.
- Settings: enable · show player name · heads-up (per player, default on).

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
*Replaces DFreds Chat Pins.*
- **GM only.** Right-click a message → Pin / Unpin.
- A Pins view lists all pinned messages.
- "Clear chat" deletes everything except pinned messages; those leave the
  main log and remain in the Pins view until unpinned.
- Settings: enable.

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
*Replaces the token part of Multi Token Edit.*
- **Tokens only.** With several tokens selected, the right-click menu (token
  HUD) shows a "multiple gears" button.
- It opens the normal token configuration for one token. On save, **only
  the fields that were changed** are applied to every selected token.
  Changed fields are highlighted.
- Settings: enable.

#### Folder Drop
*Replaces DFreds Droppables.*
- Dropping an actor folder on the map opens a window:
  - **Random**: scatter around the drop point. Never inside walls or on the
    other side of a wall from the drop point; no overlapping tokens.
  - **Select places**: a list of the actors (alphabetical). Click on the map
    to place the highlighted one; the list moves to the next. Click another
    actor in the list to place it instead.
  - Option: drop as hidden.
- PF2e: dropping a Party places its members. Hold **Alt** to drop the Party
  token itself.
- Settings: enable · default mode (ask / random / select) · hidden by default.

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
*Replaces Cleaner Sheet Title Bar.*
- Window title-bar buttons become icons with tooltips (labels removed).
- Supports Foundry's new and old window styles (4e may use the old one).
- Settings: enable (per player).

#### Always Show Prototype Token
- If a system hides "Prototype Token" in the "⋮" menu, promote it to the
  title bar as an icon. PF2e already shows it; test on 4e.
- Settings: enable.

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

*Replaces Force Client Settings.*
- From the 🔒 button on any per-player setting (ours, other modules',
  Foundry's own), the GM chooses:
  - **Default**: set the value once; players can still change it.
  - **Locked**: players' input is disabled and the GM's value is enforced.
- Settings: enable · list of forced settings (managed in the window).

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
| 2 | Player Settings (force/lock) | Part of the settings window |
| 3 | Clean Title Bars, Always Show Prototype Token | Small; first 4e test |
| 4 | Chat Pins, Turn Announcer | Small, self-contained |
| 5 | Turn Marker, Next-Turn Marker | First canvas drawing |
| 6 | Multi-Token Edit, Folder Drop | Token placement reused by Loot Pile |
| 7 | Damage Log (generic → PF2e) | Sets the generic + system pattern |
| 8 | Dice Stats (generic → PF2e) | Follows that pattern |
| 9 | GM Vision | Riskiest canvas work |
| 10 | Loot Pile + Party Stash | Needs system adapters + placement |
| 11 | PF2e Search + Hazard Detection | Largest; reuses parts of 9 and 10 |

---

## 5. Open questions

- **Loot / Party Stash outside PF2e**: new actor sub-type vs. flagged
  existing type (decide while testing on 4e).
