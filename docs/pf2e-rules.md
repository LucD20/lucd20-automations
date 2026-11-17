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
| 6 | Reactions: track their use, as the PF2e Reaction module does | built v0.45.0 | `pf2eReactions` |
| 7 | Reactive Strike: prompt when it can be used | built v0.46.0 | `pf2eReactiveStrike` |
| 8 | Shield Block: prompt when it can be used | built v0.47.0 | `pf2eShieldBlock` |
| 9 | Commander: Demoralizing Charge | built v0.48.0 | `pf2eDemoralizingCharge` |

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

## 6. Reactions

- Owner: before Demoralizing Charge, "automate uses like PF2e Reactions
  module does it". Asked whether an action tracker or only reactions, and
  how to show it: an overlay on the token rather than an effect item (effects
  pile up at higher levels).
- Decided (Q160–Q163): **reactions only** (a 3-action tracker would miss too
  much in PF2e); a **badge on the token, seen by everyone** who can see the
  token, plus a mark in the Combat Tracker; spent by **reaction cards**,
  **off-turn Strikes** and **tactic reactions**; the trigger **prompts**
  ("X can use Reactive Strike") come later, as their own rules (keep the PF2e
  Reaction module for those until then, with its tracking off).
- Built (v0.45.0):
  - One reaction per creature, refilled at the start of its turn and when the
    encounter starts; stored on the combatant.
  - Spent by the card of anything whose cost is a reaction (actions and feats
    with `actionType: reaction`, spells cast as a reaction), and by a Strike or
    spell attack outside the creature's own turn. A reaction card followed by
    its Strike (within 30 s) counts once. Rerolls don't count.
  - With none left: a note to the GMs and the owners; nothing is blocked.
  - Badge: bottom-right of the token, gold = available, grey with a red slash
    = spent. Combat Tracker: an "R" mark beside the name. Owners and the GM
    click either to toggle.
  - For tactics (next, with Demoralizing Charge): `spendReaction(combatant)`;
    Drilled Reactions' extra reaction is still to do.
- v0.45.1 (owner): "Creatures don't have reaction until their first turn
  (except guardians)". When the encounter starts, everyone but the creature
  whose turn it is waits for its first turn (badge grey, a dashed "not yet"
  mark in the tracker); a creature added during combat waits too. Guardians
  (the guardian class) have it from the start.
- (verify) in PF2e 8.7: `actor.class.slug === "guardian"`; the card's item (`message.item`) and its
  `actionType` for Shield Block / Reactive Strike; a spell's
  `system.time.value === "reaction"`; the "R" of the `Pathfinder2eActions`
  font drawing the reaction symbol on the badge; the Combat Tracker row
  (`[data-combatant-id]` with `.token-name`).

## 7. Reactive Strike

- Owner: "Start with Reactive Strike, then Shield Block" (the PF2e prompts
  the PF2e Reaction module gives; 4e had them, PF2e did not).
- The rule (PF2e system / AoN): trigger "a creature within your reach uses a
  manipulate action or a move action, makes a ranged attack, or leaves a
  square during a move action it's using"; a melee Strike with no multiple
  attack penalty; a critical hit against a manipulate action disrupts it.
  Step never triggers it.
- Decided (Q164–Q168):
  - **Q164** every move that leaves a square in reach prompts; the card says
    "not if it was a Step" (Foundry can't tell a Step from a 5-ft Stride).
  - **Q165** the card goes to the reactor's player(s) and the GM; a monster's
    card to the GM only (players never learn which monsters have it).
  - **Q166** while a token is dragged in combat, **everyone** sees which
    enemies' reach the move leaves, **any enemy** (reach only, no ability).
  - **Q167–168** one button per melee Strike + Skip; all four triggers.
- Built (v0.46.0):
  - Reactors: creatures with the Reactive Strike action (or the old Attack of
    Opportunity), their reaction left (rule 6), hostile to the trigger, not
    unconscious / dying / paralysed / stunned / restrained.
  - Reach: `actor.getReach({ action: "attack" })`, else 5 ft; PF2e counting,
    and a 10-ft reach takes two squares diagonally.
  - Moves: every square left during the move (teleports and forced movement,
    such as Shove's push, don't count; undo doesn't either).
  - Chat: a ranged attack roll; the card of an action or spell with the
    manipulate trait; the card of a move action other than Step and Stride.
  - One card per reactor, trigger and kind within 15 s.
  - The button targets the trigger, rolls the Strike's first variant (no
    multiple attack penalty), marks the card answered; the off-turn Strike
    spends the reaction (rule 6). A critical hit on a manipulate trigger:
    a GM-only note "X's <action> is disrupted".
  - The drag marks: an arrow from each enemy to the square left and a "!" on
    it; players only see enemies they can see; cleared when the drag ends.
- (verify) in PF2e 8.7: `actor.getReach`; `actor.system.actions` strikes
  with `item.isMelee` and `variants[0].roll()` returning the degree; spells
  carrying the manipulate trait; `Token#setTarget`; the movement action names
  ("blink", "displace") for teleport and forced movement.

## 8. Shield Block

- Owner: after Reactive Strike, "then Shield Block".
- Decided (Q169–Q172): damage is applied at the table with **PF2e Toolbelt's
  Target Helper** (target rows on the damage card, a shield toggle per row);
  **a card, then Block applies the damage with PF2e's shield block**; only
  creatures that **have the Shield Block reaction**; the card **shows the
  damage**, except to a player when the damage roll was secret.
- Built (v0.47.0):
  - Trigger: a damage roll (`context.type: damage-roll`) with physical damage
    (bludgeoning, piercing, slashing) on a target (Target Helper's rows via
    its API `getMessageTargets`, else the roll's own target) that has Shield
    Block (feat or action), its shield raised and not broken / destroyed, and
    its reaction left (rule 6). Targets added later with "Set Target" count.
  - Card: to the player(s) and the GM (a monster's to the GM only): "Valeros
    is about to take 12 physical damage (Bite). Steel Shield: Hardness 5,
    HP 18/20." Block / Skip. A secret damage roll: the player's copy has no
    amount, the GM's has it.
  - Block (owner's client): `actor.applyDamage({ damage, shieldBlockRequest:
    true, rollOptions, outcome })`, the reaction spent, the Target Helper row
    marked applied, both copies of the card answered. Skip: nothing applied.
- (verify) in PF2e 8.7 / Toolbelt: `DamageRoll#instances[].type`;
  `actor.attributes.shield.raised`; Target Helper's applied rows at
  `flags["pf2e-toolbelt"].targetHelper.applied[tokenId][rollIndex]` (the row
  should show as applied after Block).

**Cards, v0.47.1 (owner):** "It needs to fit PF2e sheet style, buttons side by
side, clicking somewhere on the card should open the compendium entry". The
Reactive Strike and Shield Block cards now use PF2e's own action-card markup
(`pf2e chat-card action-card`: header with the item's image, name and reaction
glyph; the text; buttons in one row), from one helper
(`scripts/systems/pf2e/card.js`) that later cards reuse. A click anywhere on
the card but a button opens the item's compendium entry
(`_stats.compendiumSource`, else the actor's own item).

**v0.47.2 (owner):** "After confirming the Reaction, reveal the message and
make it show the name of the reaction + symbol, no descriptions, to not take
a lot of the chat." Used (Strike / Block): the card becomes only the
reaction's image, name and symbol, shown to everyone, its speaker named as
players may see the creature (a hidden token's card stays with the GM). Shield
Block's second copy (the player's or the GM's) is deleted. Skipped: "Not used"
/ "Not blocked", still private. "Moving away overlay works, but not the
noise": the Reactive Strike drag warning plays the same "shing" as 4e (per
player option Sound, on); the sound is now shared (`scripts/core/sound.js`).

**v0.47.3 (owner):** no action symbol after the title on the cards ("it
already has an image"). Pathfinding picks, of routes of the same length, the
one that leaves fewer squares next to enemies (see PLAN).

## 9. Commander: Demoralizing Charge

- Owner: "one main automation, and go from there: Demoralizing Charge. Take
  a look at it and suggest the automation"; reactions first (rules 6–8),
  then "good, with dem charge" (the proposal as it was).
- The tactic (PF2e / AoN): expert tactic, 2 actions, brandish. Up to two
  squadmates in the banner's aura Stride toward an enemy (free), then Strike
  it (reaction); each successful Strike: Will vs class DC or Frightened 1
  (2 on a critical failure). Both Strikes on one enemy: one save after the
  last, −1 (both struck), −2 (both hit), −3 (both hit, one critical).
- Built (v0.48.0):
  1. The commander's own card of the tactic starts it on their client.
     Banner toggle off: a warning (brandish), the tactic goes on.
  2. Allies within 30 ft (not the commander: brandish; not hidden) are
     highlighted; click up to two, **Signal**; Cancel / Escape stops. "Any
     ally in the aura" stands for "squadmate" (no squadmate roster yet).
     Allies who answered a tactic this round aren't offered.
  3. A card per ally (their player and the GM): Stride, then Strike as a
     reaction; Skip. **Drilled Reactions**: once a round, an ally whose
     reaction is spent gets the extra one (their Strike then doesn't spend
     theirs; rule 6).
  4. The GM's client reads each ally's next Strike (target, outcome). Their
     card then shows only the tactic's name, to everyone.
  5. When both answered (or the commander's turn ends): per enemy hit, a
     GM-only card "Will save against DC N (−2)…"; **Roll** after Dice So
     Nice: Frightened 1 / 2 (`increaseCondition`), a chat line (GM only if
     hidden). Missed and skipped Strikes: no save.
- The Stride and Strike are made by hand.
- v0.48.1 (owner): "Save the last selection the player made if they are
  still in range (it's normal to always target the same); after selecting
  two, it automatically signals." The commander's last squadmates start
  chosen when still within 30 ft and free to answer (Enter or Signal sends
  them); a second click signals at once. "The commander grants a reaction when
  using these actions, so it needs to give the commander a choice of which
  gains the reaction": after the signal, once a round, the commander clicks
  the ally who gets Drilled Reactions' extra reaction (Escape: no one).
- (verify) in PF2e 8.7: the commander's class DC (`actor.classDC.dc.value`);
  the banner toggle (`actor.rollOptions.all["commanders-banner"]`);
  `saves.will.roll({ dc, modifiers })` taking a circumstance Modifier;
  `increaseCondition("frightened", { value })`.
- v0.48.2 (owner, bug): "if I already used it in my turn, I can't target if I
  use it again; we need to still keep it allowed in case of misclicks". Using
  it again is always allowed: the same commander's earlier signal still open
  is cancelled ("Replaced by a new signal", its extra reaction taken back) and
  Drilled Reactions may be chosen again; allies who answered another
  commander's tactic this round are shown grey but can be picked.
