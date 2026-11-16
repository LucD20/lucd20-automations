# PF2e automation: the rules ledger

The owner is replacing several PF2e automation modules with this one. Each rule
is written here **as the owner gave it**, with where it stands, so that "is X
automated?" has one place to look.

Status: **planned** (noted, not built) · **built** (released, version given) ·
**system** (the PF2e system already does it; nothing built) · **dropped**.

| # | Rule | Status | Where |
|---|------|--------|-------|
| 1 | Frightened goes down by 1 at the end of the creature's turn | planned | |
| 2 | Sickened gets a DC when applied; reminder to retch at the start of the turn | planned | |
| 3 | Shove: choose where the target is pushed | planned | |
| 4 | Trip: conditions and damage by degree of success | planned | |

## 1. Frightened

- At the end of a creature's turn, its Frightened value goes down by 1.

## 2. Sickened

- When Sickened is applied from a chat card it gets a **DC** to remove it:
  - from a **spell** card: the origin's spell DC;
  - from an **ability** card that has a DC (a save): that DC;
  - otherwise: the **level-based DC** of the origin.
- The DC is shown on the effect (a label on the PF2e effect).
- At the **start of the sickened creature's turn**, chat says
  "Sickened X: Roll Fortitude DC Y to retch." with a button to roll. The DC
  may be public.

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

## 4. Trip

- **Success:** the target becomes Prone.
- **Critical success:** the target becomes Prone and takes 1d6 bludgeoning
  damage.
- **Critical failure:** the one who tripped becomes Prone.
