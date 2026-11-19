#!/usr/bin/env python3
"""
List every passage of a book's Markdown (tools/pdf-to-md) that asks for a roll, grouped by heading (PLAN §23).

    python3 tools/convert/find_rolls.py book.md [--from "PART 1"] [--to "CONCLUDING"] [-o rolls.json]

A passage = one sentence with a DC, a saving throw, a skill check, a percentage
chance, an attack roll or damage dice. Stat blocks (#### Stat:) are listed
apart: their numbers are converted with the NPC, not in the journal.
Output (JSON): [{ part, heading, page, kind, text, dcs: [..] }]. Keep the
output out of the repository (book text).
"""

import argparse
import json
import re
import sys

SKILLS = (r"Acrobatics|Athletics|Bluff|Computers|Culture|Diplomacy|Disguise|Engineering|Intimidate|Life Science|"
          r"Medicine|Mysticism|Perception|Physical Science|Piloting|Profession|Sense Motive|Sleight of Hand|Stealth|"
          r"Survival|Appraise|Climb|Craft|Disable Device|Escape Artist|Fly|Handle Animal|Heal|Knowledge|Linguistics|"
          r"Perform|Ride|Spellcraft|Swim|Use Magic Device|Fortitude|Reflex|Will|caster level|Strength|Dexterity|"
          r"Constitution|Intelligence|Wisdom|Charisma")
PATTERNS = [
    ("dc", re.compile(r"\bDC\s*\d+")),
    ("save", re.compile(r"\b(Fortitude|Reflex|Will) sav", re.I)),
    ("skill", re.compile(r"\b(" + SKILLS + r")\b[^.]{0,40}\bchecks?\b")),
    ("percent", re.compile(r"\b\d+%\s*(chance|miss)", re.I)),
    ("attack", re.compile(r"\+\d+\s*(?:\(|to hit|attack)|\battack roll", re.I)),
    ("damage", re.compile(r"\b\d+d\d+(?:\s*[+×x]\s*\d+)?\b")),
]


def sentences(text):
    text = re.sub(r"\*\*|\*", "", text)
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z“\"(])", text) if s.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("md")
    ap.add_argument("--from", dest="start", help="first heading (substring) to include")
    ap.add_argument("--to", dest="end", help="heading (substring) to stop at")
    ap.add_argument("-o", "--out")
    args = ap.parse_args()

    part = heading = None
    page = 0
    active = args.start is None
    in_stat = False
    found = []
    para = []

    carry = []  # a sentence cut by a page / column break continues in the next paragraph

    def flush(final=False):
        if not (para or carry) or not active:
            para.clear()
            carry.clear()
            return
        text = " ".join(carry + para)
        carry.clear()
        if not final and not re.search(r"[.!?:”\")]\**\s*$", text):
            carry.append(text)
            para.clear()
            return
        for s in sentences(text):
            kinds = [k for k, rx in PATTERNS if rx.search(s)]
            if kinds:
                found.append({
                    "part": part, "heading": heading, "page": page, "stat": in_stat, "kind": kinds,
                    "text": s, "dcs": [int(n) for n in re.findall(r"\bDC\s*(\d+)", s)]
                })
        para.clear()

    for line in open(args.md, encoding="utf-8"):
        line = line.rstrip("\n")
        m = re.match(r"<!-- p\. (\d+) -->", line)
        if m:
            page = int(m.group(1))
            continue
        h = re.match(r"^(#+) (.*)", line)
        if h:
            flush(final=True)
            level, title = len(h.group(1)), h.group(2)
            if args.start and args.start.lower() in title.lower():
                active = True
            if args.end and args.end.lower() in title.lower():
                active = False
            if title.startswith("Stat: "):
                in_stat = True
                continue
            in_stat = False
            if level == 1:
                part, heading = title, title
            else:
                heading = title
            continue
        if not line.strip():
            flush()
            continue
        # A run-in label ("**Treasure:**", "**Development:**") ends a stat block.
        if in_stat and re.match(r"^\*\*[A-Z][\w ’']+:\*\*", line):
            flush(final=True)
            in_stat = False
        para.append(line)
    flush(final=True)

    data = json.dumps(found, ensure_ascii=False, indent=1)
    if args.out:
        open(args.out, "w", encoding="utf-8").write(data)
        heads = {(f["part"], f["heading"]) for f in found}
        print(f"{args.out}: {len(found)} passages ({sum(not f['stat'] for f in found)} outside stat blocks), "
              f"{len(heads)} headings", file=sys.stderr)
    else:
        print(data)


if __name__ == "__main__":
    main()
