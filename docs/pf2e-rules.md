# PF2e automation: the rules ledger

The owner is replacing several PF2e automation modules with this one. Each rule
is written here **as the owner gave it**, with where it stands, so that "is X
automated?" has one place to look.

Status: **planned** (noted, not built) · **built** (released, version given) ·
**system** (the PF2e system already does it; nothing built) · **dropped**.

| # | Rule | Status | Where |
|---|------|--------|-------|
| 1 | Frightened goes down by 1 at the end of the creature's turn | built v0.41.0 | `pf2eFrightened` |
| 2 | Sickened gets a DC when applied; reminder to retch at the start of the turn | built v0.41.0 | `pf2eSickened` |
| 3 | Shove: choose where the target is pushed | built v0.41.0 | `pf2eShove` |
| 4 | Trip: conditions and damage by degree of success | built v0.41.0 | `pf2eTrip` |
| 5 | Temporal Distortion: d4 for the condition after the save | built v0.42.0 | `pf2eTemporalDistortion` |

Commander (Battlecry!): research notes in `docs/pf2e-commander.md`; rules to
automate come from the owner, one at a time.

Code: `scripts/systems/pf2e/rules.js`; tests `tools/harness/tests/test37.js` (1–4), `test38.js` (5).
Each rule has its own switch under **Pathfinder 2e** in the module's settings.

Standing decisions:
- **Always wait for Dice So Nice** before showing or applying what follows a
  roll (owner).
- What a roll was, against whom and how it went is read from the roll's chat
  message (`flags.pf2e.context`: `options` such as `action:shove`, `outcome`,
  `origin.token`, `target.token`, `dc.value`), as the owner's world showed.
- Conditions and moves on creatures a player does not own are done by the
  active GM's client.

## 1. Frightened

- At the end of a creature's turn, its Frightened value goes down by 1.
- Built: the owner checked that PF2e 8.7 does not do this by itself. Only when
  the encounter moves forward (not when the GM steps a turn back).
- v0.41.1: the first build listened to Foundry's `combatTurnChange` hook and
  nothing happened in the owner's world (the Sickened reminder used it too).
  Turn ends and starts are now worked out from the encounter's own updates
  (`updateCombat`), remembering each encounter's last position.
  `CONFIG.debug.lucd20Rules = true` logs every update as it is read.
- v0.41.2 (owner): the change is said in chat ("Amiri: Frightened 2 → 1 (end
  of turn)"), to the GMs only when the creature or its name is hidden from
  players.

## 2. Sickened

- When Sickened is applied from a chat card it gets a **DC** to remove it:
  - from a **spell** card: the origin's spell DC;
  - from an **ability** card that has a DC (a save): that DC;
  - otherwise: the **level-based DC** of the origin.
- The DC is shown on the effect (a label on the PF2e effect).
- At the **start of the sickened creature's turn**, chat says
  "Sickened X: Roll Fortitude DC Y to retch." with a button to roll. The DC
  may be public.
- Built, with one difference from the rule as given: a dragged (or
  button-applied) Sickened carries **no origin** (owner's check), so the DC is
  taken from the recent chat, newest first (15 messages, 3 minutes):
  the creature's own **saving throw** → that save's DC (this covers spells and
  abilities with a save); a **spell card** → the caster's spell DC; another
  item's card → the level-based DC of its owner; nothing → the creature's own
  level-based DC. The DC is stored on the condition and added to the end of
  its description. The button rolls Fortitude; success −1, critical success
  −2. The line is public and names the DC.
- v0.41.2 (owner): with the Turn Announcer on, the retch line waits for the
  "X's turn" card and is posted under it, so it is not forgotten. To the GMs
  only when the creature or its name is hidden from players.

## 3. Shove

- Using the Shove action gives a choice of where to push the target: squares
  are highlighted on the map, as with a push in D&D 4e.
- A Shove is always **away from the shover**.
- Owner's diagram (success = green, critical success = blue):
  - shover directly below the target: green = the three squares in the row
    beyond the target; blue = the three squares in the row beyond that, plus
    the square at each end of the green row;
  - shover diagonally below-right of the target: green = the three squares on
    the far corner (above, above-left, left); blue = the two squares above the
    green ones and the two to their left (not the far corner square).
- Reading of the diagram used for the code: a square qualifies when it is
  exactly 5 ft (success) or 10 ft (critical success) from the target by PF2e
  counting, and lies on the far side from the shover (its direction from the
  target is within about 65° of straight away). This gives exactly the
  squares in both pictures.
- Built: after a successful Shove (and the dice), the one who rolled gets the
  squares highlighted (green 5 ft; on a critical success blue 10 ft as well)
  and clicks one; right-click or Escape cancels. Squares behind a wall or
  under another creature are not offered. The GM's client checks the choice
  and moves the target, once per Shove. Following the target with a Stride is
  not automated.
- v0.41.1 (owner): a right click no longer cancels (it drags the map); the
  bar sits near the bottom, above the macro bar, with a Cancel button; Escape
  cancels; hovering a square draws an arrow from the target to it.

## 4. Trip

- **Success:** the target becomes Prone.
- **Critical success:** the target becomes Prone and takes 1d6 bludgeoning
  damage.
- **Critical failure:** the one who tripped becomes Prone.
- Built: applied automatically after the dice. The 1d6 bludgeoning is posted
  as a normal damage roll, applied with PF2e's own buttons (so resistances and
  weaknesses are the system's). A creature already Prone is left as it is.

## 5. Temporal Distortion

- After the spell is used and the NPC rolls its save: on anything but a
  critical success, the PC's player (the GM if the player is not connected)
  gets a "roll d4" for Clumsy 1, Enfeebled 1 or Stupefied 1. The d4 is rolled
  in chat, the game waits for Dice So Nice, then the condition rolled is
  applied; on a 4 a window lets the player choose the condition.
- On a critical failure the condition's value is 3.
- The duration is automated too.
- The spell (owner, Q134–Q136): *Temporal Distortion*, oracle focus spell 1,
  Dark Archive (Remastered) p. 189 / Divine Mysteries p. 287; PF2e item
  `temporal-distortion` (`Compendium.pf2e.spells-srd.Item.UbHK19RYbxRXWgWX`);
  1 action, range 30 feet, 1 creature, **Will**.
  - Critical success: unaffected.
  - Success: the condition (value 1) for **1 round**.
  - Failure: the condition (value 1) for **4 rounds**.
  - Critical failure: value **3** for **2 rounds**.
  - d4: 1 Clumsy, 2 Enfeebled, 3 Stupefied, 4 the caster chooses.
- Single target only. Nothing appears until the save has been rolled (the
  owner may change who rolls it first).
- Built (v0.42.0), the other questions (Q137–Q143) as recommended:
  - Read from the target's saving-throw message: `context.type`
    `saving-throw` with `item:slug:temporal-distortion` in `context.options`
    (owner's console check); the caster is `flags.pf2e.origin.actor`.
  - After the save's dice, the GM's client posts a card "Temporal Distortion
    on X: Pat rolls the d4" with a **Roll d4** button. The roller is the
    connected player whose character the caster is (else a connected owner,
    else the GMs). Other players' clicks are refused; a GM may always roll.
  - The d4 is a normal roll in chat; after its dice, a 4 opens a window with
    the three conditions (it re-opens until one is chosen).
  - A PF2e **effect** "Temporal Distortion (Clumsy 3)" grants the condition
    (GrantItem with the badge value) and lasts the rounds above from the
    caster's turn (`expiry: turn-start`, start initiative = the caster's).
    A new one on the same creature replaces the old. At the start of each
    turn, an expired one is removed with its condition if PF2e has not
    removed it. The effect has no token icon of its own (the condition has).
  - Chat: "Ogre is Enfeebled 1 for 4 rounds (d4: 2)." The card then says
    "Rolled: 2."
  - A secret save (whispered or blind) or a hidden token: the card and the
    d4 go to the roller and the GMs only; the roller's result line leaves out
    the value and duration (they would tell the save's result); the GMs get
    the full line. A name PF2e hides from players shows as "the target".
  - A new save against it on the same creature (a reroll) replaces a card
    nobody has rolled yet.
- Checked by the owner in V14 / PF2e 8.7 (v0.42.0): it all works, including
  the condition's value and the effect ending with its condition after the
  rounds above.
