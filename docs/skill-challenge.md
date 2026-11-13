# Skill Challenge data (D&D 4e)

A skill challenge is a normal journal **text page** with this module's flag.
The page's text is for the GM to read; the flag is what the Skill Challenges
window runs. It works for pages in the world and in journal compendiums.

```json
{
  "name": "Cross the Marsh",
  "type": "text",
  "text": { "content": "<p>What the GM reads.</p>", "format": 1 },
  "flags": {
    "lucd20-automations": {
      "skillChallenge": {
        "level": 1,
        "xp": 100,
        "complexity": 1,
        "successes": 4,
        "failures": 3,
        "visibility": "open",
        "skills": [
          { "skill": "ath", "dc": 10, "max": 1, "note": "Climb the old wall." },
          { "skill": "dip", "dc": 12, "dcStep": 5 },
          { "skill": "prc", "role": "secondary", "dc": 10, "effect": "bonus", "bonus": 2, "penalty": 2 },
          { "skill": "ins", "role": "secondary", "dc": 15, "effect": "bonus", "bonus": 2, "bonusSkills": ["stl"], "max": 1 },
          { "skill": "itm", "role": "secondary", "dc": 12, "effect": "cancelFailure" }
        ],
        "successText": "Shown to the players when the GM reveals a success.",
        "failureText": "Shown to the players when the GM reveals a failure.",
        "note": "GM-only notes, shown in the runner."
      }
    }
  }
}
```

## Challenge

| Field | Meaning | Default |
|---|---|---|
| `level`, `xp` | Shown to the GM. XP is not awarded automatically. | 0 |
| `complexity` | Only used to work out `successes` when that is missing (2 + 2 × complexity). | 0 |
| `successes` | Successes needed. | from `complexity`, else 4 |
| `failures` | Failures that end it. | 3 |
| `visibility` | `"open"`: each result and the tally go to chat for everyone (never a DC). `"secret"`: whispered to the GM. | the card's option |
| `playerRolls` | Players can roll from their window. The GM can switch it per run. | `true` |
| `hints` | Show players the difficulty word. | `true` |
| `successText`, `failureText` | Outcome text. Goes to the GM first; "Show players" makes it public. Plain text. | empty |
| `note` | GM-only notes. Plain text. | empty |

## Skills

| Field | Meaning | Default |
|---|---|---|
| `skill` | The system's skill key: `acr arc ath blu dip dun end hea his ins itm nat prc rel stl stw thi`. | required |
| `role` | `"primary"` or `"secondary"`. | `primary` |
| `dc` | The DC. Never shown to players. | 10 |
| `max` | Maximum successes (primary) or successful uses (secondary) from this skill. 0 = no limit. | 0 |
| `dcStep` | Added to the DC after each use of this skill ("the DC increases by 5 each time"). | 0 |
| `effect` | What a success does: `"success"` (+1 success), `"bonus"` (a bonus to the next check), `"cancelFailure"` (removes 1 failure), `"none"`. | `success` for primary, `none` for secondary |
| `bonus` | Size of the bonus for `"effect": "bonus"`. | 2 |
| `penalty` | A failed check gives this penalty to the next check. | 0 |
| `bonusSkills` | The bonus / penalty only applies to checks with these skills. Empty = the next check, whatever the skill. | empty |
| `countsFailure` | Whether a failed check is a failure in the challenge. | `true` for primary, `false` for secondary |
| `description` | Text for **players**, shown under the skill in their window. Plain text. | empty |
| `hidden` | Kept out of the players' window until the GM reveals it (eye button on its row). | `false` |
| `difficulty` | The word players see instead of the DC: `easier`, `easy`, `medium`, `hard`, `harder`. | worked out from the DC and the challenge's level |
| `note` | GM text shown under the skill in the runner. Plain text. | empty |
| `id` | Only needed when the same skill is listed twice. | the skill key |

## What players get

Only for open challenges that are running: the name, the tally and, per skill
that isn't hidden, its name, `description`, difficulty word and whether it is
used up. Never a DC, a limit, a GM note, a route's note, a stage or a
threshold.

The difficulty word compares the skill's current DC with the easy / moderate /
hard DCs of the challenge's level: below easy = Easier, below moderate = Easy,
up to halfway between moderate and hard = Medium, up to hard = Hard, above =
Harder.

## Routes

Alternative paths the GM picks in the runner (until the first roll). The first
route is the default.

```json
"routes": [
  { "id": "gate", "name": "Front gate", "note": "GM text for this route.",
    "skills": [
      { "skill": "stl", "dc": 15 },
      { "skill": "nat", "dc": 15, "role": "secondary", "note": "Extra skill on this route." },
      { "skill": "blu", "remove": true }
    ] }
]
```

Each entry in a route's `skills` changes the listed skill with the same `id`
(or skill key): only the fields given are replaced. An entry for a skill that
isn't listed adds it; `"remove": true` takes one out.

## Stages

Parts completed in order.

```json
"stages": [
  { "name": "Earn trust", "successes": 3, "penalty": 2, "note": "GM text." },
  { "name": "Make the case", "penalty": 2 }
]
```

| Field | Meaning |
|---|---|
| `successes` | Successes that complete the stage (the last stage takes what is left). |
| `penalty` | Penalty for a check that works on another stage. |
| `skills` | Skill ids that belong to the stage: others get the penalty automatically. Empty: the GM decides per check with the runner's "Wrong stage" button. |

## Failure thresholds

```json
"thresholds": [{ "failures": 2, "text": "Whispered to the GM when failures reach 2." }]
```

## Group checks

Ready-made group checks for the runner's **Group check** button (the GM can
also type one). Every character rolls one of the options. `"rule": "half"`
(default): at least half succeed = 1 success, otherwise 1 failure.
`"rule": "all"`: everyone must succeed, otherwise 1 failure.

```json
"groupChecks": [
  { "name": "Collapse", "note": "GM text.", "options": [{ "skill": "ath", "dc": 12 }, { "skill": "acr", "dc": 17 }] }
]
```

## In the runner, not in the data

- **Modifier for the next check** (bribes, a good idea, a bad approach).
- **Successes needed** (− / +), for rules such as "needs 1 more success".
- **+ Success / + Failure / Undo** and the **Other skill** row.
