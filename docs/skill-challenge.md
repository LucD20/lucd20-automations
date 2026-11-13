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
| `note` | GM text shown under the skill in the runner. Plain text. | empty |
| `id` | Only needed when the same skill is listed twice. | the skill key |

Anything the data can't express (group checks, routes, stages) is handled
with the runner's **+ Success**, **+ Failure**, **Undo** and **Other skill**
until phase 30 (see `docs/PLAN.md` §9).
