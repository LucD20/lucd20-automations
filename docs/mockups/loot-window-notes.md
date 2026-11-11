# Loot window mockup: notes

Files: `loot-window.html` (the mockup, open it straight from disk) and
`loot-window.png` (1440px-wide full-page screenshot at 2×).

The mockup is static. Real `:hover` / `:focus-visible` work everywhere; the
checkboxes in frame 6 and the stepper in frame 4 are wired with ~40 lines of
JS so the tri-state and counters can be tried. Nothing was tested in Foundry.

## What is on the page

| # | Frame | Shows |
|---|-------|-------|
| 1 | Loot Pile, player | "Taking for" as a static chip (one character) |
| 2 | Loot Pile, GM | "Taking for" dropdown, *Open sheet*, *Delete pile*; list scrolls |
| 3 | Hover / pressed / focus | Forced with `.is-hover`, `.is-active`, `.is-focus` |
| 4 | "How many?" | Small dialog over the dimmed pile window |
| 5 | Empty pile | GM view, *Send all* disabled |
| 6 | Loot the fallen | Leather Armor unchecked, per-NPC select all / none |
| 7 | 360px wide | Player with no character + NPC with hidden name |
| 8 | 600px wide | GM view, single-row footer |

Frames 7 and 8 are extras to prove the 360–600px range.

## Design decisions

- **Row layout**: icon · name · quantity pill · `Take` · `Party Stash`. The
  name takes all spare width and wraps to a second line instead of being cut
  off ("Healing Potion (Minor)" wraps at 420px; it fits on one line from about
  450px).
- **Quantity** is a pill right before the buttons, so quantities line up in a
  column down the right side. Hidden when the quantity is 1.
- **Take is the accent action** (orange outline, bold); Party Stash is a
  neutral button. Eight filled buttons in a column looked heavy, so only the
  single primary button of a window is filled (*Create loot pile*, *Take 2*).
- **Delete pile** has a red outline, red text and a trash icon at rest, and
  turns solid red on hover. It sits at the far right, away from *Open sheet*.
  I'd still keep a confirmation in the real thing.
- **Group headers** are a full-width raised strip and `position: sticky`, so
  the NPC stays visible while its items scroll.
- **Narrow windows** (< 400px, container query): the label "Party Stash"
  shortens to "Stash" (full text stays in `title` / `aria-label`).
  **Wide windows** (≥ 540px): the GM footer becomes one row.
- **Loot the fallen**: the select all / none toggle is a tri-state checkbox in
  the NPC header, in the same column as the item checkboxes (checked, dash for
  "some", empty), with an "x of y" count on the right. Unchecked rows are also
  struck through and dimmed, so the state isn't carried by color alone. The
  footer shows "7 of 8 items selected"; *Create loot pile* disables at 0.

## Choices I made where the brief was open

- **Player "Taking for"**: static chip with portrait when the player has one
  character; use the GM-style dropdown when they have several.
- **No character**: the hint replaces the "Taking for" bar and *Take* is
  disabled (with a tooltip) rather than hidden, so rows keep their shape.
- **"How many?" defaults to the whole stack**, on the guess that taking all the
  gold or arrows is more common than splitting. Flip to 1 if you prefer. The
  button label repeats the number ("Take 2"). I added −/+ steppers; the field
  alone is enough if you want it simpler.
- **Empty pile** is shown as GM so *Delete pile* stays reachable, which is
  when the GM most wants it. Subtitle "Everything has been taken or stashed."
  is my addition.
- **Two NPCs with the same name** are simply listed twice. If that is
  confusing in play, the token name or a "(2)" suffix could go in the header.
- **Hidden NPC name** uses a neutral silhouette portrait too. Showing the real
  token art next to "Unknown creature" may give the creature away; your call.
- Level is written "Level -1" as in the brief.

## Colors

All defined once as `--ll-*` custom properties on `.lucd20-loot-app`.

| Token | Value | Used for | Contrast |
|-------|-------|----------|----------|
| `--ll-bg` | `#1b1a21` | window body | |
| `--ll-bg-header` | `#121117` | title bar, taker bar, footer | |
| `--ll-bg-raised` | `#26252e` | group headers, neutral buttons | |
| `--ll-bg-sunken` | `#131217` | inputs, icon tiles, pressed buttons | |
| `--ll-bg-hover` | `#2d2b36` | hovered row | |
| `--ll-border` | `#3b3945` | hairlines (decorative) | |
| `--ll-border-strong` | `#5c596a` | button / input outlines | 2.5:1 on body |
| `--ll-text` | `#efe6d8` | main text | 14.0:1 body, 11.2:1 hovered row |
| `--ll-text-muted` | `#b5ab9d` | labels, level, hints | 7.6:1 body, 6.7:1 raised |
| `--ll-accent` | `#ee9b3a` | focus ring, checked boxes | check mark 7.7:1 |
| `--ll-accent-text` | `#f3b469` | Take label | 8.0:1 |
| `--ll-accent-border` | `#a8702f` | Take outline | 4.1:1 |
| `--ll-primary` | `#b34a32` | primary button fill, white text | 5.3:1 (hover `#bf5238` 4.7:1) |
| `--ll-danger-text` | `#ff9a8f` | Delete label at rest | 8.5:1 |
| `--ll-danger-fill` | `#a3302b` | Delete hover fill, white text | 7.0:1 |

Ratios are computed from the hex values (WCAG formula), not measured in
Foundry. One known shortfall: the neutral button outline is 2.5:1 against the
body, under the 3:1 guideline for control boundaries. The buttons also have a
lighter fill and a text label, so I left it subtle to match Foundry; raise it
to `#77748a` (about 4:1) if you want it strict. Disabled controls are 45%
opacity and intentionally below 4.5:1.

## Sizes

- Window 420×560 default; frames at 360 and 600 wide. Radius 6px (window),
  4px (controls, rows), 3px (icon tiles, checkboxes).
- Text: 14px base, item names 14px/600, NPC names 15px/700, labels and
  hints 12px, row buttons 13px.
- Row buttons 28px tall, footer buttons 32px, select and number field 30px,
  title-bar close 28×28.
- Item row 34px min (wraps taller), review row 32px, group header 43px,
  NPC portrait 32px round, item icon 28px square, checkbox 18px.
- Spacing: 8px gaps in rows, 4px between the two row buttons, 8–10px panel
  padding.

At 420×560 the full sample (8 items) fits the player view without scrolling;
the GM view scrolls by one row because of the second footer row.

## Turning it into the real thing

- **Class names** reuse what is already in `styles/lucd20.css`
  (`lucd20-loot-window`, `-body`, `-taker`, `-list`, `-group`, `-item`,
  `-footer`, `-empty`, `-check`, `-review`, `-qty`). New ones:
  `lucd20-loot-app` (token root, put it on both windows and the dialog),
  `lucd20-loot-group-header`, `-portrait`, `-icon`, `-taker-chip`, `-hint`,
  and the `ll-btn*`, `ll-select`, `ll-check`, `ll-i` helpers. Everything
  prefixed `mock-` is page chrome and should not be ported. The CSS in the
  HTML is split into numbered sections along the same line.
- **Foundry's own styles will fight some of this.** Foundry styles `button`,
  `select`, `input[type=checkbox]` and `h1–h4` inside windows (buttons default
  to full width, for one). Expect to need the `.lucd20-loot-app` prefix for
  specificity and a few resets (`width: auto`, `margin: 0`). It may be less
  work to keep Foundry's native checkbox and select and drop `ll-check` /
  `ll-select`; they were drawn here only because there is no Foundry on the
  page.
- **Theme variables**: the hex values approximate the V14 dark theme by eye.
  In Foundry, inspect a core window and swap the tokens for its CSS variables
  where they match (background, text, border, the orange highlight), so the
  window follows the user's theme. The mockup is dark only; if anyone uses
  the light theme the tokens need a second set.
- **Font**: Foundry uses Signika. The mockup asks for it first and falls back
  to a system sans (the screenshot was rendered with the fallback), so widths
  in Foundry will be slightly narrower than in the PNG.
- **Icons**: use Font Awesome in the module rather than the inline SVGs.
  Suggested: Take `fa-hand-holding` or `fa-download`, Party Stash
  `fa-box-archive` or `fa-treasure-chest`, Open sheet
  `fa-arrow-up-right-from-square`, Delete `fa-trash`, window `fa-sack`,
  Loot the fallen `fa-skull`. Check each exists in the Font Awesome build
  V14 ships. Item and NPC art are placeholders for `item.img` and the token
  or actor image; `object-fit: cover` for portraits, `contain` for item icons.
- **Container queries** (`container-type: inline-size` on
  `.lucd20-loot-body`) and `:has()` (unchecked-row styling) are used; both
  are fine in the Chromium that V14 runs on.
- **Sticky group headers** need the header's negative side margin to match
  the list's side padding (8px), or a gap shows when rows scroll under it.
- **Hover/pressed helper classes** (`.is-hover`, `.is-active`, `.is-focus`)
  exist only so the screenshot can show those states; drop them from the
  selectors when porting.
- **Text**: every string here would go in `lang/en.json`. New or changed
  strings versus what I'd guess exists: "Everything has been taken or
  stashed.", "You have no character, so you can't take items yourself. You
  can still send them to the Party Stash.", "{n} of {total} items selected",
  "{n} of {total}", "Take {n}", "of {max}", "Select all / none".
- **Hidden information**: the "Unknown creature" header must be decided on the
  GM side (or from data players may already see), and the portrait swapped
  with it, so the real name and art never reach a player's client.
