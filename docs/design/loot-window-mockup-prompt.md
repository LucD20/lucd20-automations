# Prompt: Loot Pile window mockup

Paste everything below the line into a new Claude Code chat on the
`LucD20/lucd20-automations` repository.

---

I need a **visual mockup** (not working module code) of two windows for my
personal Foundry VTT module `lucd20-automations` (Foundry V14, game system
Pathfinder 2e). I'm the GM; my players use the same windows. The current
versions work but look plain. I want them to look polished and feel like part
of Foundry's own dark UI, not like a web page.

## Deliverable

1. One self-contained HTML file: `docs/mockups/loot-window.html`.
   - Plain HTML + CSS (a little JS only for hover/toggle states is fine).
   - No external requests: no CDNs, no web fonts, no remote images. Use
     inline SVG for icons and for placeholder item/NPC art (simple shapes are
     fine).
   - Show all the states listed below side by side on one page, each inside a
     fake Foundry window frame (title bar with title + close ✕, dark body).
2. A screenshot of that page: `docs/mockups/loot-window.png` (Chromium and
   Playwright are pre-installed: `require('playwright')`, `chromium.launch()`;
   use deviceScaleFactor 2).
3. A short `docs/mockups/loot-window-notes.md`: the design decisions, the
   colors and sizes used, and anything you'd want me to know when turning it
   into the real thing.
4. Commit only those three files and push them to a **new branch named
   `mockup/loot-window`** (create it from the default branch). Do not change
   any other file and do not open a pull request. Tell me when it's pushed.

## Look and feel

- Foundry V14 dark theme: dark slate/charcoal panels, light text, subtle
  1px borders, small radii (4–8px), compact spacing. Match the feel of a
  Foundry sheet/dialog, not a website. Base font ~14px, labels 12px.
- Defaults: window 420×560 px (resizable in the real thing, so the layout
  must work from ~360px to ~600px wide and scroll when long).
- Readable at a glance during a game: item names prominent, actions easy to
  hit, quantities clear.
- Accessible: text contrast ≥ 4.5:1, buttons ≥ 28px tall, never rely on color
  alone (icons + labels).

## Window 1: Loot Pile (the main one)

Opened by double-clicking the loot pile token after combat. Title: the pile's
name (e.g. "Loot Pile").

Content, top to bottom:
- **"Taking for"** selector: which character receives items taken with
  *Take* (a player sees their own characters; the GM can pick any player
  character). If the player has no character: a short hint instead.
- **Groups, one per defeated NPC**, ordered highest level first. Group header:
  NPC portrait (round or square token art), NPC name, "Level 3". For players,
  an NPC whose name is hidden shows "Unknown creature".
- **Items in each group** (alphabetical): item icon, name, quantity if more
  than 1 (e.g. "×3"), and two actions per item:
  - **Take** → to the "Taking for" character (stacks ask "How many?").
  - **Party Stash** → to the party's shared inventory.
- **Footer actions**:
  - Everyone: **Send all to Party Stash**.
  - GM only: **Open sheet** (opens the system's normal loot sheet) and
    **Delete pile** (destructive — make it look like one).

Sample data to show (PF2e):
- Goblin Boss — Level 1: Healing Potion (Minor) ×2, Ring of Climbing,
  Scimitar
- Goblin Warrior — Level -1: Dogslicer, Gold Pieces ×3, Leather Armor
- Goblin Warrior — Level -1 (a second one): Shortbow, Arrows ×20

States to show:
1. **Player view** (Taking for: Amiri) with the sample data.
2. **GM view** (Taking for: dropdown, plus the GM-only footer buttons).
3. **Hover/pressed** look of an item row and its buttons.
4. **"How many?" prompt** for a stack (Healing Potion ×2): a small dialog
   with a number field (1–2) and Take/Cancel.
5. **Empty pile**: a friendly empty state ("The pile is empty.").

## Window 2: "Loot the fallen" (GM only, end of combat)

Shown to the GM when combat ends, before the pile is created. Title:
"Loot the fallen". A hint: "Uncheck anything that shouldn't be in the pile.
Checked items are moved off the NPCs." Then the same groups as above (NPC
portrait, name, level), each item with a **checkbox** (checked by default),
icon, name and quantity. Footer buttons: **Create loot pile** (primary) and
**Skip**. Bonus: a "select all / none" toggle per NPC group.

Show it with the sample data and one item unchecked.

## Out of scope

No Foundry code, no module changes — only the mockup files above. If anything
is ambiguous, make a sensible choice and note it in the notes file.
