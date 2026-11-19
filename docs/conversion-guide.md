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

Skip, with the reason on the review page:
- **1e starship combat** mechanics (placement, wreckage fields, gunnery):
  the owner builds SF2e starship encounters separately.
- **Chase** rules and obstacles (the owner runs chases separately).
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
- Conditions: link them (`@UUID[Compendium.pf2e.conditionitems.Item.j91X7x0XSomq8d60]{Prone}`;
  ids as in the owner's journals).
- Percent chances: flat check, `50%` → `@Check[flat|dc:11]`.
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
society *(proposal: or a matching Lore)*; Sense Motive → sense-motive;
Sleight of Hand → thievery; Stealth → stealth; Survival → survival.

**Pathfinder 1e → PF2e**: the owner's sheet: Acrobatics, Fly → acrobatics;
Knowledge (arcana), Knowledge (planes), Spellcraft, Use Magic Device →
arcana; Climb, Swim → athletics; Appraise, Craft, Knowledge (engineering),
Profession → crafting; Bluff, Disguise, Sleight of Hand → deception;
Diplomacy → diplomacy; Intimidate → intimidation; any Knowledge → a Lore;
Heal → medicine; Handle Animal, Knowledge (geography / nature / planes),
Ride → nature; Knowledge (dungeoneering / planes), Spellcraft → occultism;
Perception, Sense Motive → perception; Perform → performance; Knowledge
(planes / religion) → religion; Appraise, Knowledge (history / local /
nobility), Linguistics → society; Stealth → stealth; Survival → survival;
Disable Device, Escape Artist, Sleight of Hand → thievery.

## Recall Knowledge statistic by subject

Arcana: arcane theory, constructs, beasts, elementals. Nature: fauna, flora,
geography, weather, animals, fey, plants, elemental planes. Occultism:
mysteries, philosophy, aberrations, spirits, oozes, esoteric planes.
Religion: divine agents, theology, celestials, fiends, undead. Medicine:
bodies, wounds, diseases, biology. Crafting: devices, machines, structures.
Computers: code, data. List every one that applies.

## Owner's feedback log

- Book 6, round 1 (2026-11-19): convert the travel / downtime dice, rule
  consequences, Treasure / Development checks and hazards (they were missed
  by hand: the point of the tool); skip 1e starship combat, chase
  obstacles, 1-round conditions outside combat; write lines with context
  ("to determine that …"); number the review rows.
