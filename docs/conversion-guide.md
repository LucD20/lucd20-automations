# Converting a 1e adventure to 2e: the guide

How Claude converts a Paizo 1e book (Starfinder 1e → SF2e, Pathfinder 1e →
PF2e) for the owner (PLAN §23). Built from the owner's feedback, one book at
a time; every rule here is the owner's unless marked *(proposal)*. Book text
and conversions never go into this repository (it is public).

## Steps

1. **PDF → Markdown**: `python3 tools/pdf-to-md/pdf_to_md.py book.pdf -o book.md`
   (Paizo 1e AP layout detected by its fonts; check the `#`/`##`/`###`
   headings with `grep -n "^#" book.md`).
2. **Find the rolls**: `python3 tools/convert/find_rolls.py book.md --from "PART 1" --to "CONTINUING THE CAMPAIGN" -o rolls.json`
   (adjust `--from`/`--to` to the adventure's first part and the first
   back-matter article).
3. **Write the 2e lines** for each passage (rules below). Write 1e DCs as
   `{N}`; the converter fills them in.
4. **DCs**: `scripts/conversion/dc.js` `convertDc(dc1e, level, "sf1e"|"pf1e")`
   (the owner's DC sheets, exact). Never pick a DC by hand.
5. **Review page** for the owner: `python3 tools/convert/build_review.py <dir> --source sf1e --title "…" --level "PART 1=9" --level "PART 2=10"`
   (`<dir>` holds `rolls.json` and `conv.py`; add `--world <dump> --folder "…"`
   to compare with a finished world). Every row is numbered (#1, #2 …) so
   the owner can refer to lines.

A book split over several PDFs (Rise of the Runelords Anniversary Edition):
join the chapter's pages into one PDF first (PyMuPDF `insert_pdf`); the
PDF's bookmarks (`get_toc()`) give the chapter's page range.

## Party level

- Look for the book's milestones: `grep -n -iE "begin this adventure at|should (reach|be) [0-9]+th level|[0-9]TH LEVEL:" book.md`.
- The party level is the book's level at that point ("always the same
  level"). Levels change inside a book: Book 6 (The God-Host Ascends) was
  converted at 11 through area B and 12 from C1, where the book only says
  "reach 12th level during the missions". So the level is set **per
  heading** ("from here on"), defaulting to the book's milestones; ask the
  owner where a level-up falls when the book is vague.

## What to convert, what to skip

Convert every mechanical interaction, including the ones easy to miss (the
reason for this tool): travel and downtime dice ("1d6 days"), rule
consequences ("the psychovox gains +1 to Acrobatics"), checks inside
**Treasure** / **Development** paragraphs, hazards in the room text (acid
water, vents), conditions with lasting effect, critical thresholds, sidebar
checks (Firewatch Station, Temple of Hylax).

Haunts and hazards: their own stat blocks are skipped (they become hazard
actors), but rolls written in the room text around them are converted. An
**event that works like a hazard** (repeated saves, damage each round: Book
5's Mental Mirage) becomes a hazard actor too: skip its rolls in the journal
with the note "hazard actor".

Skip, with the reason on the review page:
- **1e starship combat** mechanics (placement, wreckage fields, gunnery):
  the owner builds SF2e starship encounters separately.
- **Chase** rules and obstacles: the owner builds chases as 2e chase tables
  by hand (Book 5: Connection Storm, Desert of the Mind, Connection Rift).
  List a chase's passages under one "chase: build separately" note instead
  of converting them one by one.
- **Short conditions outside combat** ("stunned for 1 round" in a room):
  not worth converting; convert them when they last.
- GM advice and rule notes with no roll ("you can roll these in secret":
  becomes the `secret` trait on the checks instead).
- Stat blocks: converted with the NPC, not in the journal.

## Writing the line

- One `<li><p>` per interaction. The check comes first, then **"to" + what
  it does, with enough context to understand without the book** (the owner
  reads the page with the book open, but the line must still say what is
  found, who rolls and when):
  `[[/act recall-knowledge statistic=crafting dc=30]] or [[/act recall-knowledge statistic=nature dc=29]] while examining the pit to determine that wide digging tools, like a Swarm molitera's, excavated the stone.`
- Short and mechanical; no flavour, no GM advice. Keep names (NPCs, items,
  areas) so the line can be found again.
- Bonuses / penalties: half, rounded up, as a sub-bullet (−4 → −2). Morale
  bonuses become status bonuses.
- "Exceeds the DC by 5 or more" → a sub-bullet **Critical Success**;
  "fails by 5 or more" → **Critical Failure**.
- Durations / counts with dice: `[[/gmr 1d4+1]]{1d4+1 days}`.
- Damage: `@Damage[6d6[bludgeoning]]`; SF1e damage dice stay as written
  (the owner adjusts them in play). Attack bonuses are not DCs: flag them
  for the owner.
- Conditions: link them, `@UUID[Compendium.pf2e.conditionitems.Item.<id>]{Name}`
  (add the value: `{Frightened 1}`). Ids from the owner's journals:

  | Condition | id | Condition | id |
  |---|---|---|---|
  | Blinded | XgEqL1kFApUbl5Z2 | Friendly | v66R7FdOf11l94im |
  | Broken | 6dNUvdb1dhToNDj3 | Frightened | TBSHQspnbcqxsmjL |
  | Clumsy | i3OJZU2nk64Df3xm | Grabbed | kWc1fhmv9LBiTuei |
  | Concealed | DmAIPqOBomZ7H95W | Helpful | v44P3WUcU1j0115l |
  | Confused | yblD8fOR1J8rDwEQ | Hidden | iU0fEDdBp3rXpTMC |
  | Controlled | 9qGBRpbX9NEwtAAr | Immobilized | eIcWbB5o3pP6OIMe |
  | Dazzled | TkIyaNPgTZFBCCuh | Invisible | zJxUflt9np0q4yML |
  | Deafened | 9PR9y0bi4JPKnHPR | Off-Guard | AJh5ex99aV6VTggg |
  | Doomed | 3uh1r86TzbQvosxv | Paralyzed | 6uEgoh53GbXuHpTF |
  | Drained | 4D2KBtexWXa6oUMR | Petrified | dTwPJuKgBQCMxixg |
  | Dying | yZRUzMqrMmfLu0V1 | Prone | j91X7x0XSomq8d60 |
  | Encumbered | D5mg6Tc7Jzrj6ro7 | Quickened | nlCjDvLMf2EkV2dl |
  | Enfeebled | MIRkyAjyBeXivMa7 | Restrained | VcDeM8A5oI6VqhbM |
  | Fascinated | AdPVz7rbaVSRxHFg | Sickened | fesd1n5eVhpCSS18 |
  | Fatigued | HL2l2VRSaQHu9lUw | Slowed | xYTAsEpcJE1Ccni3 |
  | Fleeing | sDPxOjQ9kx2RZE8D | Stunned | dfCMdR4wnpbYNTix |
  | Stupefied | e1XGnhKNSQIm5IXg | Unconscious | fBnFDH2MTzgFijKf |
  | Undetected | VRSef5y1LmL2Hkjf | Wounded | Yl48xTdMh3aeQYL2 |

  1e conditions without a value (sickened, frightened…) become value 1.
- Percent chances: flat check with DC = 21 − X/5 (`50%` → `@Check[flat|dc:11]`,
  `25%` → 16, `20%` → 17, `75%` → 6).
- Bonuses and penalties without a type, and morale / profane / sacred /
  luck ones: halved (rounded up), as circumstance (untyped) or status
  (morale, profane, sacred, luck).
- "Exceeds the DC by 5 / by 10 or more" → **Critical Success** either way.
- A check with no DC in the book (1e attitude DCs come from Charisma, a
  Perform check "against" nothing): write it without a DC
  (`@Check[diplomacy]`) and note "no DC in the book: set by hand".
- Checks a creature rolls (a ghoul's Perception, a rat escaping a tub):
  the same codes.
- Ability damage / drain → the matching condition at value 1 (owner:
  agreed): Str → enfeebled, Dex → clumsy, Con → drained, Int / Wis / Cha →
  stupefied.
- Doors and objects to break: keep the 1e hardness and HP as written and
  convert the Break DC (owner, as in Book 6; the older presets are not used).
- Leave 1e hit point amounts and falling damage as written; flag them.
- "Save for half" → a basic save: `@Check[reflex|dc:N|basic]`.
- 1e action costs: standard action → 2 actions, move action → 1 action,
  full-round → 3 actions, swift / immediate → 1 action or a reaction.
- A DC given as a formula ("DC 10 + the creature's CR", "identify the
  creature") → Recall Knowledge without a DC (the creature's own DC applies).
- 1e conditions with no 2e match (owner: agreed): shaken →
  frightened 1; entangled → immobilized (or clumsy 1 when it can still
  move); staggered → slowed 1; exhausted → fatigued (note "exhausted");
  sickened / nauseated for rounds → sickened 1; stunned 1 round in combat →
  stunned 1.
- Starfinder Stamina Points have no SF2e equivalent: fold them into HP.
- 1e AC, EAC / KAC and save-bonus targets are not DCs: flag them, like
  attack bonuses.
- Break stats: `hardness X, HP Y, [[/act force-open dc=…]]` (Break DC
  converted like any DC).

## Codes

`@Check[skill|dc:N]` (lower case), `[[/act <action> dc=N]]`:

| Book says | Code |
|---|---|
| search / notice something hidden (Perception) | `[[/act seek dc=N]]` |
| Sense Motive | `[[/act sense-motive dc=N]]` |
| recognise / identify / know / realise (a knowledge check) | `[[/act recall-knowledge statistic=<skill> dc=N]]` |
| Computers to access / bypass / crack / hack | `[[/act hack dc=N]]` |
| climb | `[[/act climb dc=N]]` |
| swim | `[[/act swim dc=N]]` |
| Strength check / break / force a door | `[[/act force-open dc=N]]` |
| pick a lock | `[[/act pick-a-lock dc=N]]` |
| gather information | `[[/act gather-information dc=N]]` |
| Spellcraft / identify magic | `[[/act identify-magic statistic=<arcana|nature|occultism|religion> dc=N]]` |
| saving throws | `@Check[fortitude|dc:N]`, `reflex`, `will` |
| balance on a ledge / slope (Acrobatics) | `[[/act balance dc=N]]` |
| escape bonds / a grapple (Escape Artist) | `[[/act escape dc=N]]` |
| follow tracks (Survival) | `[[/act track dc=N]]` |
| Bluff to lie / Intimidate to coerce | `[[/act lie dc=N]]`, `[[/act coerce dc=N]]` (the owner used both) |

**Seek or Perception?** Seek (`[[/act seek]]`) when the PCs search for
something hidden (a loose brick, a keyhole, a datapad under a table). A plain
`@Check[perception|dc:N]` for noticing, hearing, watching or spotting a clue
in something already in view (a recording, a sound upstairs).

**Recall Knowledge or a plain check?** Recall Knowledge when the PC *knows,
recognises or identifies* something from what they know. A plain `@Check`
(e.g. `@Check[medicine]`) when the PC *examines* something hands-on to learn
from it (a corpse, a wound).

## Skills (1e → 2e)

From the owner's DC sheets, plus the owner's choices in finished books.

**Starfinder 1e → SF2e**: Acrobatics → acrobatics; Athletics → athletics;
Bluff / Disguise → deception; Computers → computers (hack when accessing);
Culture → society; Diplomacy → diplomacy; Engineering → crafting (Thievery
for disabling devices, *(proposal)* when it is a trap or lock); Intimidate →
intimidation; Life Science → medicine for bodies and biology, nature for
creatures and ecology (often both); Medicine → medicine; Mysticism →
arcana / occultism / religion by context (magic theory → arcana; the
planes and psychic → occultism; gods, temples, faith → religion; elementals
→ arcana or nature); Perception → perception / seek; Physical Science →
crafting or nature; Piloting → piloting; Profession (soldier, mercenary) →
society or a matching Lore (`mercenary-lore`, `warfare-lore`); Sense Motive → sense-motive;
Sleight of Hand → thievery; Stealth → stealth; Survival → survival.

**Pathfinder 1e → PF2e**: the owner's sheet: Acrobatics, Fly → acrobatics;
Knowledge (arcana), Knowledge (planes), Spellcraft, Use Magic Device →
arcana; Climb, Swim → athletics; Appraise, Craft, Knowledge (engineering),
Profession → crafting; Bluff, Disguise, Sleight of Hand → deception;
Diplomacy → diplomacy; Intimidate → intimidation; Heal → medicine; Handle Animal, Knowledge (geography / nature / planes),
Ride → nature; Knowledge (dungeoneering / planes), Spellcraft → occultism;
Perception, Sense Motive → perception; Perform → performance; Knowledge
(planes / religion) → religion; Appraise, Knowledge (history / local /
nobility), Linguistics → society; Stealth → stealth; Survival → survival;
Disable Device, Escape Artist, Sleight of Hand → thievery.

Where the table lists a 1e skill under several 2e skills (Knowledge
[planes], Spellcraft, Appraise, Sleight of Hand, Mysticism), pick by the
subject (next section) and list every one that fits. **Knowledge checks are
Recall Knowledge with the subject's skill, plus a matching Lore when one
fits** (owner: "Lores are good", skipped by hand only because they took
time): Profession (sailor) → `statistic=sailing-lore`, Knowledge (local)
about Sandpoint → society or `sandpoint-lore`. Lore slugs: lower case, ending
in `-lore`. Linguistics to decipher → `[[/act decipher-writing statistic=society dc=N]]`
*(proposal; the agent used @Check[society])*.

## Recall Knowledge statistic by subject

Arcana: arcane theory, constructs, beasts, elementals. Nature: fauna, flora,
geography, weather, animals, fey, plants, elemental planes. Occultism:
mysteries, philosophy, aberrations, spirits, oozes, esoteric planes.
Religion: divine agents, theology, celestials, fiends, undead. Medicine:
bodies, wounds, diseases, biology. Crafting: devices, machines, structures.
Computers: code, data. List every one that applies.

## Known gaps in the tools

- `find_rolls.py` misses lines with a bonus / penalty and no dice or DC
  ("−2 to attack and damage until …", "maximum Stamina −15", "ability DCs
  +1"). Add a pattern for them when starting a new book (it changes the
  passage numbers, so not in the middle of a book's review).

## Owner's feedback log

- Book 6, round 1 (2026-11-19): convert the travel / downtime dice, rule
  consequences, Treasure / Development checks and hazards (they were missed
  by hand: the point of the tool); skip 1e starship combat, chase
  obstacles, 1-round conditions outside combat; write lines with context
  ("to determine that …"); number the review rows.
- Books 5 and RotR 2, written by agents from this guide alone (2026-11-19):
  the gaps they reported are filled above (conditions, percentages, bonus
  types, Seek vs Perception, Recall Knowledge vs a check, basic saves,
  action costs, 1e conditions, chases). Owner's RotR pages used door
  presets; Book 6 converted the Break DC (owner to choose).
