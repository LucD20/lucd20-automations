#!/usr/bin/env python3
"""
Build the owner's review page for a converted book (PLAN §23, docs/conversion-guide.md).

    python3 tools/convert/build_review.py <dir> --source sf1e --title "Book 5: Hive of Minds" \
        --level "PART 1=9" --level "PART 2=10" [--world <world dump dir> --folder "5# - Hive"]

<dir> holds rolls.json (find_rolls.py) and conv.py (the 2e lines: dict C keyed by the rolls index, "12a" for a
sub-bullet, None = skipped; dict NOTES with reasons). --level "heading substring=N": the party level from that
heading on (in book order). DCs written {N} are converted with scripts/conversion/dc.js at that level.
--world: a folder with journal.json and folders.json (a world's LevelDB dumped to JSON) to compare with the
owner's finished pages (journals in folders whose path contains --folder).

Writes <dir>/review.json and <dir>/review.html (rows numbered #1, #2 …). Both contain book text: keep them out
of the repository.
"""

import argparse
import collections
import html as H
import json
import os
import re
import runpy
import subprocess

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def dc_table(source):
    js = ("import {convertDc} from '" + os.path.join(REPO, "scripts/conversion/dc.js") + "';"
          "const out={}; for (let L=0;L<=25;L++) for (let dc=-5; dc<=80; dc++) { const c=convertDc(dc,L,'" + source + "');"
          "out[L+':'+dc]=[c.dc,c.proficiency]; } console.log(JSON.stringify(out))")
    return json.loads(subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, check=True).stdout)


def owner_lines(world, folder):
    R = json.load(open(os.path.join(world, "journal.json")))
    F = {f["_id"]: f for f in json.load(open(os.path.join(world, "folders.json")))}

    def path(fid):
        p = []
        while fid:
            p.insert(0, F[fid]["name"])
            fid = F[fid].get("folder")
        return "/".join(p)
    P = {r["_id"]: r for r in R if r["_key"].startswith("!journal.pages!")}
    pages = collections.OrderedDict()
    for j in R:
        if not j["_key"].startswith("!journal!") or folder not in path(j.get("folder")):
            continue
        for pid in j["pages"]:
            p = P.get(pid)
            if p and p.get("text", {}).get("content"):
                # One line per list item, table row or paragraph (the owner also puts checks in tables).
                text = re.sub(r"</(p|li|tr|h\d)>|<br\s*/?>", "\n", p["text"]["content"])
                text = re.sub(r"</t[dh]>", " | ", text)
                lis = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", l)).strip(" |") for l in text.split("\n")]
                lis = [l for l in lis if re.search(r"@Check|\[\[/|@Damage", l)]
                if lis:
                    pages[f'{j["name"]} / {p["name"]}'] = lis
    return pages


STOP = {"check", "recall", "knowledge", "statistic", "with", "that", "from", "this", "their", "they", "succeeds",
        "successful", "attempt", "seek", "hack"}


def words(s):
    return {w for w in re.findall(r"[a-z]{4,}", (s or "").lower())} - STOP


def chips(s):
    if s is None:
        return '<em class="muted">—</em>'
    s = H.escape(s)
    s = re.sub(r"@Check\[(?:type:)?([a-z-]+)\|dc:(\d+)[^\]]*\]", r'<span class="chip check">\1 DC \2</span>', s)
    s = re.sub(r"@Check\[(?:type:)?([a-z-]+)\]", r'<span class="chip check">\1</span>', s)
    s = re.sub(r"\[\[/act ([a-z-]+)(?: statistic=([a-z-]+))? dc=(\d+)\]\]",
               lambda m: f'<span class="chip act">{m.group(1).replace("-", " ")}{" (" + m.group(2) + ")" if m.group(2) else ""} DC {m.group(3)}</span>', s)
    s = re.sub(r"@Damage\[(.+?\]?)\]", r'<span class="chip dmg">\1</span>', s)
    s = re.sub(r"\[\[/gmr ([^\]]+)\]\]\{([^}]+)\}", r'<span class="chip roll">\2</span>', s)
    s = re.sub(r"\[\[/r ([^\]]+)\]\](?:\{([^}]+)\})?", lambda m: f'<span class="chip roll">{m.group(2) or m.group(1)}</span>', s)
    s = re.sub(r"@UUID\[[^\]]+\]\{([^}]+)\}", r'<span class="chip cond">\1</span>', s)
    return s.replace("&lt;strong&gt;", "<strong>").replace("&lt;/strong&gt;", "</strong>")


CSS = """:root{--bg:#f7f7f5;--fg:#1d1d1b;--mut:#6b6b66;--card:#fff;--line:#e3e3de;--check:#dbeafe;--act:#dcfce7;--dmg:#fee2e2;--roll:#ede9fe;--cond:#fef3c7;--same:#16a34a;--diff:#d97706;--new:#2563eb;--skip:#6b7280}
@media (prefers-color-scheme:dark){:root{--bg:#171716;--fg:#ececea;--mut:#9b9b95;--card:#20201e;--line:#33332f;--check:#1e3a5f;--act:#14532d;--dmg:#5f1e1e;--roll:#3b2f63;--cond:#5a4510}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif} main{max-width:1400px;margin:0 auto;padding:20px 16px}
h1{font-size:22px;margin:0 0 4px} p{color:var(--mut);margin:0 0 16px} .sum span{margin-right:14px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line)} td,th{padding:8px 10px;border-top:1px solid var(--line);vertical-align:top;text-align:left}
thead th{position:sticky;top:0;background:var(--card);z-index:1;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
tr.h th{background:var(--bg);font-size:15px;padding-top:16px} td.quote{color:var(--mut);width:31%} td{width:29%} td.tag{width:8%;white-space:nowrap} td.num{width:3%;font-weight:600;color:var(--mut);white-space:nowrap}
.chip{display:inline-block;padding:0 6px;border-radius:4px;font-size:13px;white-space:nowrap} .check{background:var(--check)} .act{background:var(--act)} .dmg{background:var(--dmg)} .roll{background:var(--roll)} .cond{background:var(--cond)}
.math{font-size:12px;color:var(--mut);margin-top:4px} .muted{color:var(--mut);font-weight:400}
.t{font-size:12px;font-weight:600} .t.same{color:var(--same)} .t.diff{color:var(--diff)} .t.new{color:var(--new)} .t.skip{color:var(--skip)}
@media (max-width:800px){table,tbody,tr,td,th{display:block;width:auto!important} thead{display:none} td.quote{border-top:none}}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--source", required=True, choices=["sf1e", "pf1e"])
    ap.add_argument("--title", required=True)
    ap.add_argument("--level", action="append", required=True, help='"heading substring=N", in book order')
    ap.add_argument("--world")
    ap.add_argument("--folder")
    ap.add_argument("--round", default="")
    args = ap.parse_args()

    rolls = json.load(open(os.path.join(args.dir, "rolls.json")))
    conv = runpy.run_path(os.path.join(args.dir, "conv.py"))
    C = {str(k): v for k, v in conv["C"].items()}
    NOTES = {str(k): v for k, v in conv.get("NOTES", {}).items()}
    table = dc_table(args.source)

    marks = [(s.rsplit("=", 1)[0].lower(), int(s.rsplit("=", 1)[1])) for s in args.level]
    level, pending = marks[0][1], list(marks)
    rows = []
    for i, r in enumerate(rolls):
        while pending and pending[0][0] in f'{r.get("part") or ""} | {r["heading"] or ""}'.lower():
            level = pending.pop(0)[1]
        if r["stat"]:
            continue
        for key in (str(i), f"{i}a", f"{i}b"):
            if key not in C:
                continue
            src, math = C[key], []

            def fill(m):
                dc2, prof = table[f"{level}:{int(m.group(1))}"]
                math.append(f"{m.group(1)}→{dc2} ({prof})")
                return str(dc2)
            line = None if src is None else re.sub(r"\{(\d+)\}", fill, src)
            rows.append({"key": key, "heading": r["heading"], "page": r["page"], "level": level,
                         "quote": "" if key != str(i) else r["text"], "html": line, "math": math, "note": NOTES.get(key)})
        if str(i) not in C:
            rows.append({"key": str(i), "heading": r["heading"], "page": r["page"], "level": level, "quote": r["text"],
                         "html": None, "math": [], "note": "not converted yet"})

    leftover = {}
    if args.world:
        pages = owner_lines(args.world, args.folder or "")
        used = collections.defaultdict(set)
        for row in rows:
            row["yours"] = row["yours_page"] = None
            if not row["html"]:
                continue
            best = None
            for pg, lines in pages.items():
                for k, l in enumerate(lines):
                    if k in used[pg]:
                        continue
                    score = len(words(row["html"]) & words(l))
                    if score >= 3 and (best is None or score > best[0]):
                        best = (score, pg, k, l)
            if best:
                used[best[1]].add(best[2])
                row["yours"], row["yours_page"] = best[3], best[1]
        leftover = {pg: [l for k, l in enumerate(ls) if k not in used[pg]] for pg, ls in pages.items()}
    dcs = lambda s: sorted(int(x) for x in re.findall(r"dc[:=](\d+)", s or ""))
    for row in rows:
        row["status"] = ("skip" if not row["html"] else "new" if not row.get("yours") else
                         "same" if dcs(row["html"]) == dcs(row["yours"]) else "diff") if args.world else ("skip" if not row["html"] else "")
    json.dump({"rows": rows, "leftover": leftover}, open(os.path.join(args.dir, "review.json"), "w"), ensure_ascii=False, indent=1)

    label = {"same": "Same DCs", "diff": "Differs", "new": "Not in yours", "skip": "Skipped", "": ""}
    out, cur = [], None
    cols = 5 if args.world else 4
    for n, r in enumerate(rows, 1):
        if r["heading"] != cur:
            cur = r["heading"]
            name = cur.title() if cur and cur.isupper() else cur
            out.append(f'<tr class="h"><th colspan="{cols}">{H.escape(name or "")} <span class="muted">· level {r["level"]} · p. {r["page"]}</span></th></tr>')
        mine = chips(r["html"]) if r["html"] else f'<em class="muted">Not converted: {H.escape(r["note"] or "")}</em>'
        if r["html"] and r["note"]:
            mine += f'<div class="math">⚠ {H.escape(r["note"])}</div>'
        if r["math"]:
            mine += f'<div class="math">{" · ".join(r["math"])}</div>'
        yours = (f'<td>{chips(r.get("yours"))}' + (f'<div class="math">{H.escape(r["yours_page"])}</div>' if r.get("yours_page") else "") + "</td>") if args.world else ""
        quote = H.escape(r["quote"]) or '<em class="muted">(sub-line of the row above)</em>'
        out.append(f'<tr id="r{n}"><td class="num">#{n}</td><td class="quote">{quote}</td><td>{mine}</td>{yours}<td class="tag"><span class="t {r["status"]}">{label[r["status"]]}</span></td></tr>')
    c = collections.Counter(r["status"] for r in rows)
    summary = " ".join(f'<span><b class="t {k}">{v}</b> {label[k].lower()}</span>' for k, v in c.items() if k)
    left = "".join(f"<li><strong>{H.escape(pg)}</strong>: {chips(l)}</li>" for pg, ls in leftover.items() for l in ls)
    levels = ", ".join(f"{n} from “{h}”" for h, n in marks)
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{H.escape(args.title)} review</title><style>{CSS}</style></head><body><main>
<h1>{H.escape(args.title)}: conversion review {f'<span class="muted">(round {H.escape(args.round)})</span>' if args.round else ''}</h1>
<p>Every roll found in the book outside stat blocks, the 2e line (DCs from your {args.source.upper()} DC sheet; party level {H.escape(levels)}){", and the closest line on your finished pages (paired by shared words, so a “Differs” can be a wrong pair)" if args.world else ""}. Refer to a line by its number (#12).</p>
<p class="sum">{summary}</p>
<table><thead><tr><th>#</th><th>Book</th><th>2e line</th>{"<th>Your line</th>" if args.world else ""}<th></th></tr></thead><tbody>{"".join(out)}</tbody></table>
{f'<h2 style="font-size:17px;margin-top:24px">Your lines with no match in the book</h2><ul>{left}</ul>' if left else ""}
</main></body></html>"""
    open(os.path.join(args.dir, "review.html"), "w").write(page)
    print(f"{args.dir}/review.html: {len(rows)} rows, {dict(c)}")


if __name__ == "__main__":
    main()
