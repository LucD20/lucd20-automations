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
| 10 | Animist: Roaring Heart | built v0.49.2 | `pf2eRoaringHeart` |
| 11 | Guardian: Punishing Shove | built v0.50.1 | `pf2ePunishingShove` |
| 12 | Flat checks (replaces PF2e Flat Check) | built v0.51.1 | `pf2eFlatCheck` |
| 13 | Ctrl-click effects (replaces PF2e Ctrl Click Effects) | built v0.53.0 | `pf2eCtrlClick` |
| 14 | Sustained spells (replaces PF2e Sustain Reminder) | built v0.54.0 | `pf2eSustain` |
| 15 | Hand reminders (replaces PF2e Hands Management) | built v0.54.0 | `pf2eHands` |
| 16 | Roll chances, PF2e and 4e (replaces PF2e Chances) | built v0.57.1 | `rollChances` |
| 17 | Modifiers Matter, PF2e and 4e (replaces PF2e Modifiers Matter) | built v0.56.0 | `modifiersMatter` |
| 18 | Damage Estimate, PF2e and 4e (replaces PF2e Damage Estimate) | built v0.57.0 | `damageEstimate` |
| 19 | Cover for attack rolls and area saves; areas reach past wall ends | built v0.61.0 | `pf2eCover` |
| 20 | Effect areas: targeting window, hover cover, exact reach | built v0.61.3 | `pf2eAreas` |

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

## 10. Animist: Roaring Heart

- Owner: "next Roaring Heart" (AoN Feats.aspx?ID=7134).
- The feat (animist 6, apparition, divine, wandering; War of Immortals p. 25;
  2 actions): "You Stride twice. At any point during this movement, you can
  Shove up to two creatures you pass adjacent to. When you end the movement,
  [...] you and each ally in a 30-foot emanation gain temporary Hit Points
  equal to half your level if you successfully Shoved at least one enemy, or
  equal to your level if you succeeded at Shoving both. These temporary Hit
  Points last until the beginning of your next turn."
- Decided (Q177–Q179, as recommended): the movement ends after the animist's
  **second token move, or Finish, or the end of their turn**; **successes on
  enemies** count, of the first two Shoves; the temporary HP through **an
  effect that ends by itself**.
- Built (v0.49.0): using it posts a small card (Finish) to the player and the
  GM, which counts "Enemies Shoved: n (of m Shoves)". At the end: half the
  level (rounded down) for one enemy, the level for two, nothing for none;
  an effect "Roaring Heart (N temp HP)" (PF2e's TempHP rule) on the animist
  and each ally within 30 ft of their final square, lasting until the start
  of the animist's next turn (and removed then by the module); a second use
  replaces the first. Chat: "Lini and 2 allies gain 3 temporary Hit Points
  until the start of Lini's next turn". The card shrinks to the feat's name.
  Shove's own push is forced movement and doesn't count as a move.
- Owner (v0.49.1): "It applied after i moved after shoving. Put a button
  fixed on the chat [...] to shove (the athletics check with action:shove) or
  cancel, after two shoves has been done, two buttons cancel or confirm,
  confirm gives the temp HP to all within 30 ft, cancel doesnt."
  Now: the card has **Shove** (the system's Shove action for the clicking
  user's target; a warning with no target) and **Cancel**; after one Shove
  also **Confirm** (so one enemy Shoved can still be confirmed); after two,
  only Confirm and Cancel. Moving and the end of the turn no longer end it;
  Confirm gives the temp HP from where the animist stands then; Cancel gives
  none ("Cancelled."). Shoves rolled from the sheet still count.
- Owner (v0.49.2): "the message goes all the way up, you need to reprint
  after each shove. and make all buttons side by side, less vertical clutter.
  We should focus on the smallest amount of vertical chat clutter." Now: the
  card is reprinted at the bottom after each Shove (after the dice); it is
  only the header and one row of buttons, with "Shoves: 1 of 2. Enemies
  Shoved: 1." once a Shove is rolled; Cancel (or a new use) deletes it;
  Confirm leaves one message: the feat's name and the result under it. All
  our PF2e cards' buttons are one short row now.
- (verify) `game.pf2e.actions.get("shove").use({actors})` (legacy
  `game.pf2e.actions.shove` as a fallback).
- (verify) in PF2e 8.7: the TempHP rule element granting on creation, taking
  them back when the effect is deleted, and keeping the higher of two.

## 11. Guardian: Punishing Shove

- Owner: "next punishing shove feat".
- The feat (guardian 1, trained in Athletics, passive): "When you
  successfully Shove a creature, that creature takes an amount of bludgeoning
  damage equal to your Strength modifier (or double that amount on a critical
  success). This damage increases by 2 when you become an expert in Athletics,
  6 when you become a master, and 12 when you become legendary." The system
  only adds a Note with a damage link to the Shove roll.
- Decided (Q180–Q184, "as recommended"): after the Shove's dice, **a normal
  PF2e damage roll** on the shoved creature, **applied with PF2e's own
  buttons** (Target Helper rows), not by itself; **every successful Shove**
  counts (Roaring Heart, Double Team...); **no target, no roll** (the Note
  stays); **independent of the push**.
- Built (v0.50.0): Strength modifier + 0 / 2 / 6 / 12 (trained / expert /
  master / legendary Athletics), doubled on a critical success; nothing if
  it comes to 0. The roll is as secret as the Shove (its whisper list; the GM
  only for a hidden shover); a hidden NPC name reads "the creature". Trip's
  critical damage line now hides a hidden NPC's name the same way.
- (verify) `actor.abilities.str.mod`, `actor.skills.athletics.rank`; Target
  Helper reading `flags["pf2e-toolbelt"].targetHelper.targets` on our roll.

## Compact cards (all PF2e rules, v0.50.1)

- Owner: "Remove the header from reaction messages to decrease size, and
  make the reactive strike and shield block more compact as well, similar to
  roaring heart. 'punishing shove etc' text above damage roll for shove dont
  need to be long; remember, it needs to be compact."
- Now, on every card of these rules (Reactive Strike, Shield Block,
  Demoralizing Charge, Roaring Heart): the chat message's own header
  (speaker, time) is hidden; the creature's name sits small in the card's
  header, after the feat's name. Reactive Strike: one short line ("Amiri left
  your reach (not if a Step).", "Ogre: ranged attack (Javelin).") and the
  buttons. Shield Block: "12 physical (Bite). Hardness 5, HP 18/20." and the
  buttons. Skip / not blocked / not answered / replaced: the card is deleted
  (no trace). Damage lines: "Punishing Shove", "Punishing Shove (critical)",
  "Trip (critical)".
- (verify) the hidden header in V14's chat log (`.chat-message >
  .message-header`), and that the GM can still delete these messages (the
  message's right-click menu).

## Module merges (owner, 2026-11-17)

- Owner: "more module stuff that I want to merge [...] organize in the best
  order": PF2e Flat Check ("a few problems of triggering when it shouldnt"),
  PF2e Ctrl-click effects, PF2e Hands Management (notification), PF2e
  Sustain Reminder; then, for all systems, one by one: PF2e Chances, PF2e
  Damage Estimate, PF2e Modifiers Matter. Q194: "Cover calculation should be
  added to the list."
- Order (Q185, as recommended): 1. Flat checks, 2. Ctrl-click effects,
  3. Sustain reminder, 4. Hands reminder, 5. Chances, 6. Modifiers Matter,
  7. Damage Estimate; Cover calculation (PF2e) added after them.

## 12. Flat checks

- The original's false triggers found in its code: a second flat check on a
  reroll; Dazzled checked with no target (Shield, healing yourself); a spell
  only posted from the sheet; the user's current targets instead of the
  roll's; Hidden / Invisible shown to players; 3D dice shown to everyone on a
  GM-only card; one d20 for all targets.
- Decided (Q186–Q195, as recommended; Q194: no Visioner or darkness module):
  - When: Strikes (Reactive Strike too) and spell attack rolls (the roll's own
    target); spells actually cast (`flags.pf2e.casting`; the targets from
    Target Helper, else the caster's targets; a spell with an attack roll
    waits for it); skill actions with the attack trait (Shove, Trip,
    Grapple, Disarm); actions / consumables with manipulate (Grabbed). Not
    areas or auras (target checks), not rerolls, not passive actions.
  - No target: only Grabbed (manipulate, DC 5) and Stupefied (spells, 5 + N).
  - Target: Concealed 5; Hidden, Invisible, Undetected, Unnoticed 11;
    Dazzled makes targets concealed, Blinded hidden. The highest DC that
    applies, one d20 per target, one card.
  - Blind-Fight (no check for concealed; hidden / invisible 5; undetected 5 if
    adjacent and not higher level), Keen Eyes / Liminal Fetchling (3 / 9),
    Sure Strike / True Strike (no check for concealed or hidden), See the
    Unseen (invisible counts as concealed).
  - Who sees it: everyone, except a hidden token, Hidden / Invisible /
    Undetected / Unnoticed, a hidden attacker, or a secret roll: GM only
    (blind; the 3D dice follow). Hidden NPC names: "a creature".
  - Card: compact, one line per target; nothing is blocked. v0.51.1 (owner:
    "can just be a single line, with the dice number and green or red
    background, literally just like the flat check module. remember, chat
    space."): no header, "[14] Flat check DC 5 (concealed)" on green or
    red; the target's name only when there are several.
  - Settings: Ignore Concealed, Ignore Grabbed, Hide the number.
- Switch off the "PF2e Flat Check" module (both would roll).
- (verify) `context.traits` / options carrying "attack" on Shove etc.;
  `flags.pf2e.casting` only on a real cast; the spell effects' slugs
  (`spell-effect-sure-strike`, `spell-effect-see-the-unseen`); the caster's
  targets readable on the GM's client.

## 13. Ctrl-click effects

- The original: Ctrl-click a condition / effect / persistent damage link in
  chat to apply it to the selected tokens; a hand icon after each. Its gaps:
  no way to reach creatures you don't own, an uncaught error on a link that
  isn't persistent, the link's number written into a field effects don't use.
- Decided (Q196–Q201 as recommended; Q200: "do the hand icon, here its
  fine"): to the selected tokens, else the targets, else the character;
  through the GM for creatures not owned; conditions with the link's number,
  effects with the cast rank, origin (caster, item, spellcasting) and roll
  (and a counter badge set to the link's number), persistent damage as its
  condition at DC 15; the hand icon (a client setting); a notice to the
  clicker ("Frightened 2 → Goblin, Orc"; hidden NPC names: "a creature"),
  nothing in chat. A plain click still opens the link.
- Switch off "PF2e Ctrl Click Effects" (both would apply).
- v0.53.0 (owner: "Make the whole right side a button, so I dont have to
  actually aim for the hand. And it can likely be a bit smaller too"): the
  hand is a small split button at the link's right end, the whole end
  clickable.
- (verify) `increaseCondition(slug, { value })` setting the value; the
  compendium index carrying `type` for the links; Ctrl-click on Foundry's
  links not also opening the sheet.

## 14. Sustained spells

- The original: an effect "Sustaining: X" on any message of a sustained
  spell (posted ones too), a reminder at turn start, never removed; wrong
  durations (always unlimited), duplicate reminders, the cast rank ignored.
- Decided (Q202–Q206 as recommended; Q205 changed: "Before removing it, at
  the end of the turn if they didnt sustain it, ask 'was X sustained?', just
  in case"):
  - Only a real cast (`flags.pf2e.casting`) of a spell with
    `duration.sustained`: an effect "Sustaining: X" on the caster (the
    spell's icon and text, the cast rank), one per cast; its limit from the
    duration ("1 minute" = 10 rounds, "10 minutes" = 100) or none.
  - The turn it was cast needs no Sustain. At the start of each of the
    caster's turns: a compact card, one line per spell, Sustain / End, to the
    caster's players and the GM (the GM only for an NPC or a hidden token).
  - At the end of the caster's turn, each spell not sustained: "Was X
    sustained?" Yes / No; No ends it. An unanswered question goes at the next
    turn start (the spell kept). The Sustain action used from the sheet
    sustains the only spell waiting (several: use the card).
  - The limit reached (at the caster's turn start): it ends. A short line
    says each ending ("X ended.", "(not sustained)", "(its duration ran out)").
  - Answered lines go; a card with none left is deleted.
- Switch off "PF2e Sustain Reminder".
- v0.54.0 (owner: "Text need to have font reduced, or fit two lines in that
  same size. or one line and two thin buttons"): the line's text smaller, on
  up to two lines; thin buttons.
- (verify) `flags.pf2e.casting` and `system.duration.sustained` in 8.7; the
  Sustain action's slug "sustain"; PF2e removing the effect by its own
  duration at the same moment (harmless).

## 15. Hand reminders

- The original: notices for more than two hands, Strikes with a weapon not
  held or held wrong, manipulate spells while Restrained, a material
  component check (dead since the remaster), concentrate actions while
  raging, impulses without a free hand, Raise a Shield with a buckler; its
  turn-start hand check never ran (its condition was inverted).
- Decided (Q207, Q209–Q211 as recommended; Q208: "no, no free handed needed
  for that"): warnings only, as a notice (no chat) to whoever acted and the
  GMs:
  - more than two hands in use, whenever a grip changes (a buckler on the arm
    and shield-attached weapons take none);
  - in an encounter: a Strike with a weapon not held, or a two-hand weapon
    in one hand (characters; not unarmed, not rerolls); a manipulate spell
    cast while Restrained; a concentrate action while raging (not Seek, not
    rage actions); Raise a Shield with a buckler while both hands are busy
    and neither holds a light item.
  - No free-hand check for spells or impulses.
- Switch off "PF2e Hands Management".
- (verify) "Effect: Rage" found by its compendium source; `handsHeld`,
  `hands`, `isHeld` on 8.7 weapons.

## 16. Roll chances (PF2e and D&D 4e)

- The original (PF2e only): a four-colour bar on check cards and in the roll
  window; it counted modifiers the user unticked, ignored fortune /
  misfortune and degree adjustments.
- Decided (Q212–Q217, as recommended): a generic feature `rollChances`
  (chat category; `scripts/features/roll-chances.js` holds the maths and the
  bar, each system an adapter):
  - A thin bar under the result, the % inside each segment (when 9% or
    more); in PF2e also in the roll window, before Roll.
  - PF2e: critical failure / failure / success / critical success, worked
    out as PF2e does (±10, natural 20 / 1, then the roll's
    `dosAdjustments`), over 1d20 or 2d20 kept (fortune / misfortune). Not on
    flat checks or rolls without a DC. Players see it where they could see
    the DC: PF2e's "show DCs" setting, a DC shown on the card, or a DC
    belonging to a player's character (an attack on a PC, a save against a
    PC's spell); never a blind roll. The roll window: no degree adjustments
    (they depend on the roll).
  - 4e: Miss / Hit / Crit per target against the defense the system compared
    (from `dnd4e.rollAttack`, with the weapon's or implement's crit range from
    `dnd4e.preAttackRoll`; a natural 1 misses), kept on the message; the GM
    only unless "Show 4e attack chances to players". Saving throws (a d20 with
    a target number): Fail / Save, to everyone.
  - No GM click to toggle per card (the setting instead).
- Switch off "PF2e Chances".
- v0.56.0 (owner: "Chance doesnt work on 4e."): not reproduced in the
  harness; the 4e side no longer depends on one path: the rows are read from
  the message's stored data whatever Roll class it gets, the d20 found by
  faces or formula, the rows by `.hit-prediction` else `.dice-result`, and
  with no numbers kept on the message the target's defense now (crit 20).
  `CONFIG.debug.lucd20Chances = true` logs each step in the console.
  The owner's first log showed only the power's card (no attack roll in it)
  and an unrelated error: Damage Log read its PF2e-only "details" setting in
  4e on every chat message (fixed in v0.57.0).
- v0.57.1: the owner's second log showed the attack message without
  `multirollData`: dnd4e 0.9.3's `MultiAttackRoll.toMessage` posts one roll
  per target (`message.rolls = rollArray`), each with its row in
  `roll.options.multirollData`. Both Chances and Modifiers Matter now read
  the rows that way (`scripts/systems/dnd4e/attack-rows.mjs`; the older
  shapes still read).
- (verify) PF2e 8.7's roll window: `renderCheckModifiersDialog`,
  `app.check.totalModifier`, `app.context.dc`, `rollTwice`, and that it
  re-renders when a modifier is toggled; 4e: the multiroll card's
  `.hit-prediction` rows, `weaponUuid` in `targetOptions`, save rolls' d20
  `options.target`. The defenses sit in the message's flags (a player who
  reads message data could see them).

## 17. Modifiers Matter (PF2e and D&D 4e)

- The original (PF2e): highlights the modifier tags that changed a check's
  degree, a line for the opponent's DC modifiers read live when the card is
  shown, "potentials", fail ↔ crit fail on attacks optional.
- Decided (Q218–Q223, as recommended): a generic feature `modifiersMatter`
  (chat; `scripts/features/modifiers-matter.js`, adapters per system):
  - A modifier matters if removing it changes the outcome; failing any, all
    the modifiers pushing the same way matter together if removing them all
    does. Green: it helped the roller; red: it hurt.
  - PF2e: the roll's enabled modifiers (not proficiency, attributes, the
    multiple attack penalty or potency runes) are highlighted on the card's
    tags (seen by whoever sees the tags); the target's AC / DC modifiers
    (conditions, cover, raised shield; not its armor's item bonus or Dex),
    read when the roll is created, plus Off-Guard from the roll's options,
    get one line "Target: Off-Guard −2" before the result, where the DC may
    be seen (as Chances). Failure ↔ critical failure on attacks doesn't count.
    Saves: the roll's side only. No potentials.
  - 4e: per target, the common attack bonuses the system applied
    (`commonAttackBonuses` of `dnd4e.preAttackRoll`, after the attack window:
    combat advantage, cover, concealment, long range, prone...) that turned a
    miss into a hit or back, one line "Mattered: Combat Advantage +2" under
    the target's Hit / Miss; not on a natural crit or 1. A power's own
    bonuses are not named by the system, so they are not listed. GM only
    unless Roll Chances' "Show 4e attack chances to players".
- Switch off "PF2e Modifiers Matter".
- (verify) PF2e: `target.armorClass.modifiers`, `getStatistic(slug).dc`,
  the tags' `data-slug`; 4e: `commonAttackBonuses` in the preAttackRoll
  config.

## 18. Damage Estimate (PF2e and D&D 4e)

- The original (PF2e): avg and min~max appended to the damage window's Roll
  button; ignored the crit doubling notation; GM-only option, per-user
  average / range.
- Decided (Q224–Q227, as recommended): a generic feature `damageEstimate`
  (chat; `scripts/features/damage-estimate.js` with a small dice-formula
  estimator; adapters per system): one small line above the Roll button,
  "Average 14 (6–22)", on the roller's screen only (each user: average and
  range / average / range); not on the card.
  - PF2e: each damage instance on the Roll button ("2 × (1d8 + 4)" on a
    critical), persistent damage (hourglass, bleed) apart, at least 1.
  - 4e: the power's parts and its critical parts from the window's
    `rollConfig`, with the Bonus field as it is typed: "Average 9.5 (5–14)
    Crit: Average 17.5 (15–20)".
- Switch off "PF2e Damage Estimate".
- (verify) PF2e: `renderDamageModifierDialog` re-rendering when a modifier is
  toggled; 4e: `rollConfig.parts` / `partsCrit`, the `bonus` input and
  `.dialog-buttons`.

## 19. Cover (attack rolls)

- Owner (Q228–Q232, with a diagram): "If the target is more than 50%
  covered from the origin's PoV, greater cover should apply." Q229: attacks
  now, areas next. Q230: "On the roll dialog, it should show four icons
  right above the roll [...]: No cover | Lesser Cover | Standard Cover |
  Greater Cover. so anyone can override. If overriden, show so on the attack
  roll." "Prone is a GM call." The diagram: a wall hiding most of the target:
  greater; a line passing beside a wall's end: none; a line through the
  wall's end: standard; a line through another creature: lesser; dead and
  prone creatures on the line: nothing.
- Built (v0.58.0):
  - From the attacker's center: the share of the target's silhouette walls
    hide (rays spread over the angle the target takes, each to where it
    enters the target): more than half, greater (+4); else the line center to
    center crossing a wall (its very end counts), standard (+2); else the
    line through another creature's space, lesser (+1). Not dead creatures,
    not prone ones (the GM's call: the buttons), never hidden tokens. Walls
    that block movement; open doors don't. The diagram gives 79% (greater),
    exactly 50% (standard), 19% (none).
  - Per roll: PF2e's `Check.roll` is wrapped; for an attack roll with a
    target (not a reroll) the DC (the target's AC) goes up by the bonus,
    minus a Cover circumstance bonus the target already has (the higher
    wins). The context keeps `lucd20Cover {auto, chosen, applied, existing}`
    (it rides into the message's flags).
  - The roll window: four buttons above Roll (and above the Chances bar),
    the automatic one chosen; a click changes the DC and redraws the window.
  - The card: "Standard cover (+2)", or "Lesser cover (+1), set by hand
    (auto: Standard cover)"; nothing when there is none.
  - Map preview (client setting, on): while targeting, the line from your
    token to each target in the cover's color, with its name.
- (verify) `game.pf2e.Check.roll` being the path every attack takes (Strike
  and spell attacks), `context.dc.statistic.modifiers`, the window's
  re-render keeping our DC change.
- v0.59.0 (owner: "Cover text on the map is below tokens"; "Increase the
  size of the roll dialog, so people dont have to scroll"): the preview is
  drawn in the controls layer (above tokens); the roll window grows to fit
  what Cover and Chances add (`setPosition({ height: "auto" })`).
- Areas (Q233–Q236, as recommended), v0.59.0: a Reflex save whose roll
  options have "area-effect": from the area's origin (the template placed
  for the spell, matched by its PF2e origin, else the latest template over
  the saver; its x / y), walls only (creatures don't shield from areas), the
  same thresholds. It goes in as a circumstance modifier "Greater cover +4"
  on the save, so PF2e's stacking keeps the higher of it and a Cover effect
  the saver has. Same four buttons in the save's window (they replace the
  modifier), same note on the card. No template: none, buttons still there.
  (verify) the template's `flags.pf2e.origin` fields; "area-effect" and the
  check's slug "reflex" on the save.
- v0.60.0 (owner, with a picture: a burst on a corner, a creature whose square
  center sits just behind a wall's end: "it doesnt even target, even though
  it should be standard (or greater) cover. This is a core pf2e problem [...]
  not RAW. We need to find a way around it."): PF2e 8.7 counts an effect
  area's square only if the line from the origin to the square's center is
  clear (`RegionDocumentPF2e#getCoverage`, move-wall collision), and a token
  is in the area only through those squares. Setting "Areas reach past wall
  ends" (world, on): `getCoverage` is wrapped; a square PF2e walled off counts
  when a clear line reaches any part of it (center, corners and edge
  midpoints, a hair inside), using the same collision backend; the region is
  redrawn. Cover then applies. Also: in V14 effect areas are Regions, so the
  area's origin is now read from the region (`flags.pf2e.areaShape`,
  `flags.pf2e.origin`, `shapes[0].x / y`), templates kept as a fallback.
  (verify) the targeting and the save prompts following the region's
  coverage; the region redrawing at once.
- v0.61.0 (owner: a 6% sliver of a square counted; "how much is the square
  actually covered?"; Q237 as recommended): a square PF2e walled off counts
  when at least 25% of it is reached, inside the area's shape and with a
  clear line from the origin (10 × 10 sample points; the earlier case 35–37%
  counts, the sliver 6% doesn't).

## 20. Effect areas

- Owner: "you will need to rewrite the target button from PF2e Toolbelt,
  since it uses PF2e default targeting"; hover an area to see the cover
  toward each creature; "Show exactly which parts of the square the areas
  fill". Toolbelt's template helper (on `createRegion`) takes `region.tokens`
  and drops any token whose center line to the origin hits a wall.
- Decided (Q238–Q240, as recommended), built v0.61.0 (`pf2eAreas`,
  `scripts/systems/pf2e/area.js`):
  - Placing an area (by this user, with a PF2e origin): a window with
    Enemies / Allies / All / None and Include me / Include neutral / Remove
    the area after (remembered per browser). The creatures whose squares the
    area covers (PF2e's coverage, widened as above), not hidden, dead,
    non-creatures, by the caster's alliance (Toolbelt's rules), are
    targeted, and the spell message's `flags.pf2e-toolbelt.targetHelper.
    targets` set. Switch off Toolbelt's template targeting.
  - Hover (client setting): on `hoverRegion`, a line from the origin to each
    creature in the area the user can see, labelled with its cover.
  - Exact reach (client setting): a light overlay of the area's polygon
    intersected with Foundry's movement sweep from the origin.
- (verify) `hoverRegion` firing for effect areas outside the Regions tool;
  `canvas.regions._highlights` as the overlay's parent; the sweep polygon's
  `intersectPolygon`; `canvas.tokens.setTargets`; the message update by the
  caster's player.
- v0.61.1 (owner: "Make the window similar to the one on the left"
  (Toolbelt's)): Enemies / Allies / Both as radio buttons, Include me /
  Include neutral / Remove the area after beside them, Target and Cancel
  below; all remembered. Owner: "Without the targeting helper, there is no
  target button on the chat and no way to know if cover is applying [...]
  You need to copy the target helper." Answer given: Toolbelt's Target Helper
  has separate options; keep it enabled with "Add Targets to Messages" on and
  only "Template Helper" off; our window then fills the message's targets and
  Toolbelt shows its rows. A full copy of Target Helper only if the owner
  still wants it.
- v0.61.2 (owner: "hovering over the area doesnt show the lines of cover"):
  Foundry's `hoverRegion` only fires with the Regions tool active; the
  pointer is now followed on the canvas (pointermove, throttled): the topmost
  effect area under `canvas.mousePosition` (its shape) gets the lines, which
  follow tokens moving and walls changing; leaving it clears them.
- v0.61.3 (owner: "Make the area the area is actually covering more clear on
  a hover, currently its difficult to see since its under the token"): on
  hover, the exact reach (the area's shape minus what walls cut off) is drawn
  above the tokens, amber fill and outline, with the cover lines on top; if
  the shape can't be worked out, the covered squares are outlined instead.

## Settings window and two small additions (v0.62.0)

- Owner: "reorganize the settings [...] collapsed by default, organize so more
  fits per row; for automation, divide between Core Rules, Classes (divide
  per class)". Mockups A, B, C; Q241: "C is best"; Q242–Q243 defaults. See
  PLAN §2.
- Owner: "The cover calculation lines for 4e are under the token": the 4e
  cover preview is drawn in the controls layer (above tokens).
- Owner: "Another necessary addition: settings-markers": `settingsMarkers`
  (Players & Presets page, per player): in Foundry's Configure Settings, a
  mark before each setting: world / user / this device (the same icons as
  our window). Switch off "Settings Markers".
- Owner: "include a new module: instant-range [...] available to all
  systems"; Q244–Q248 as recommended; "Remember that some texts appear
  above the token as well". Built v0.63.0 (`instantRange`, Tokens page,
  `scripts/features/instant-range.js`): the distance from your token
  (selected, else your character's) to a hovered token, to every token
  while Alt is held, and to your targets; the scene grid's `measurePath`
  between the nearest occupied squares, with elevation, in the scene's
  units; a label just above the token, in the controls layer; above Health
  Estimate's text when that sits on top (the original module's offset);
  never for a token the user can't see; a GM setting for combat only. The
  PF2e cover preview's label reads "25 ft · Standard cover"; the 4e cover
  preview's label (above the target) starts with the distance and Instant
  Range leaves that target to it (`claimed`), so the two never overlap.
  Switch off "Instant Range".

