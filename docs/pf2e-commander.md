# PF2e Commander: research notes

Background for automating parts of the Commander (Battlecry!). Summarised in
our own words from the PF2e system's data (`foundryvtt/pf2e`, packs
`classes/commander.json`, `class-features/`, `actions/class/commander/`,
checked 2026-11-17). Archives of Nethys could not be reached from the dev
container (its host is not in the session's network allowlist). What we
automate is decided rule by rule by the owner and goes in `pf2e-rules.md`.

## The class in short

- Key attribute Intelligence, 8 HP per level. Warfare Lore from level 3
  (Recall Knowledge on most creatures; can roll it for initiative).
- **Commander's Banner** (1): carried or affixed; while visible and in your
  possession it is a **30-foot emanation** giving you and allies **+1 status
  to Will saves and DCs against fear**. Pausing / resuming happens with the
  actions that stow / retrieve it. Destroyed or stolen: allies benefiting
  become **Frightened 1**. Aura, emotion, mental, visual. Some feats place it
  elsewhere (Plant Banner, Commander's Companion).
  - The system already does: a toggle `commanders-banner` and an **Aura** rule
    (radius 30, allies) applying "Effect: Commander's Banner".
- **Tactics** (1): a **folio** of tactics (5 at level 1); **prepare 3** each
  day (4 at 7, 5 at 15, 6 at 19); changing them takes 10 minutes of drilling.
  Drilling makes **2 + Int modifier allies your squadmates**; you also count
  as a squadmate. A squadmate may always decline to respond. Some tactics are
  limited (once per 10 minutes / per day) and that limit holds even if
  re-prepared. More tactics at Expert (7), Master (15), Legendary (19)
  Tactician; Tactical Expansion adds to the folio only.
  - The system already does: ChoiceSet + GrantItem picks for the folio. It
    does not track prepared tactics or squadmates.
- **Drilled Reactions** (1): once per round, when you use a tactic, one ally
  benefiting from it gets an **extra reaction**, usable only for that tactic.
- **Shield Block** (1). Later: Weapon / Armor / Perception proficiencies;
  **Commanding Will** (11) and **Battlefield Intuition** (15) turn a success
  into a critical success on Will / Reflex saves (the system already does).

## Tactics: the pattern

Almost every tactic is "**signal squadmates** (often only those **within the
banner's aura**), who then **move / Strike / maneuver as a reaction or a free
action**", sometimes followed by a **save against your class DC** that
inflicts a condition. Many have the **brandish** trait (meaning not checked
here: (verify) on AoN before relying on it).

| Tier | Tactic | Actions | What squadmates do | Then |
|---|---|---|---|---|
| Mobility | Coordinating Maneuvers | 1 | one in aura Steps (free) | may Reposition an adjacent foe (reaction) |
| Mobility | Defensive Retreat | 2 | all in aura Step up to 3× away from foes (free) | |
| Mobility | Gather to Me! | 1 | all Stride (reaction), ending in / near the aura | |
| Mobility | Mountaineering / Naval Training | 1 | all gain climb / swim 20 ft until end of next turn | effect item exists |
| Mobility | Passage of Lines | 1 | all in aura may swap places with an adjacent willing ally | |
| Mobility | Protective Screen | 1 | one Strides toward another squadmate in aura | the second doesn't trigger reactions when casting / shooting |
| Mobility | Shadows in the Moonlight | 1–2 | all in aura Follow the Expert for Hide / Sneak | 2 actions: two may Hide / Sneak (free) |
| Offensive | Double Team | 2 | one Shoves / Repositions (free) | landed next to another squadmate: that one Strikes (reaction) |
| Offensive | End It! | 2 | all in aura Step toward a foe (free) | foes nearby: Will vs class DC or Fleeing (needs a recent kill and outnumbering) |
| Offensive | Pincer Attack | 1 | all Step (reaction) | a foe next to one is Off-Guard to the responders' melee until your next turn |
| Offensive | Reload! | 1 | all reload (reaction) | |
| Offensive | Shields Up! | 1 | all in aura Raise a Shield (reaction) | or cast *shield* |
| Offensive | Strike Hard! | 2 | one in aura Strikes (reaction) | |
| Offensive | Tactical Takedown | 2 | two in aura Stride half Speed (reaction) | both next to the foe: Reflex vs class DC or Prone |
| Expert | Alley-Oop | 1 | one tosses a consumable to another, who activates it (reaction) | |
| Expert | Buckle-Cut Blitz | 2 | two Stride (reaction) | each foe passed: Reflex or Clumsy 1 for 1 round |
| Expert | Demoralizing Charge | 2 | two Stride toward a foe (free), Strike (reaction) | each hit: Will or Frightened |
| Expert | Seek and Destroy | 2 | two Seek (free), then Point Out / Stride / Strike (reaction) | + precision damage = half your level on their next hit |
| Expert | Slip and Sizzle | 2 | one Trips (reaction) | on a success the other casts a damaging ranged spell at it |
| Expert | Stupefying Raid | 2 | two Stride (reaction) | each foe passed: Will or Stupefied 1 for 1 round |
| Expert | Take the High Ground | 1 | one Strides to another squadmate (free) | then Leaps far (reaction) |
| Expert | Wait For It... | 1 | two in aura: +1 AC and saves while Delaying / Readying | |
| Master | Bloody Guillotine, Corpse Crenellation, Mirrored Wall, Piranha Assault, Pop Drop and Lock, Ready Aim Fire!, Roaring Charge, The Bigger They Are | 1–2 | (once per 10 minutes or per day) coordinated Strikes / maneuvers | |
| Legendary | Cry Havoc!, Executioner's Volley, For Talmandor! For Freedom!, Insta-Ballista, Sanguine Revitalization, Valkyrie's Charge | 1–3 | once per day | |

## What could be automated (to choose from)

1. **Squadmates**: who they are (2 + Int, chosen at drilling), kept on the
   commander and shown on their tokens; who is inside the banner's 30 ft.
2. **The banner's aura on the map** (the system applies its bonus already):
   a ring showing the 30 ft, so "within the aura" is visible.
3. **Tactic cards**: when a tactic is used, chat lists the eligible squadmates
   (in the aura when required) with the action each may take as a button
   (Strike, Step / Stride with the square picker, Raise a Shield, reload).
4. **Drilled Reactions**: once per round, pick the ally who gets the extra
   reaction for that tactic; tracked until used or the round ends.
5. **Saves against the class DC** (Tactical Takedown, Buckle-Cut Blitz,
   Stupefying Raid, Demoralizing Charge, End It!): apply the condition by
   degree after the dice, as Trip does.
6. **Lasting effects**: Pincer Attack's Off-Guard (to the responders, until
   your next turn), Wait For It...'s +1, Seek and Destroy's precision damage.
7. **Banner lost**: one click makes the allies in its aura Frightened 1.
