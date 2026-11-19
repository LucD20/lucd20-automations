#!/usr/bin/env python3
"""
Infer the party level the owner used, per heading (PLAN §23.9, §25).

    python3 tools/convert/infer_level.py <world dump> "<folder substring>" <rolls.json> <pf1e|sf1e>

Pairs the owner's finished journal lines (a dump from dump_world.mjs) with the book's passages (shared
words) and prints, per heading, the levels at which the 1e DC converts to the owner's 2e DC
(scripts/conversion/dc.js). Single-heading outliers are usually wrong pairs.
"""
import json, re, sys, subprocess, collections
W, FOLD, ROLLS, SRC = sys.argv[1:5]
import os
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
R = json.load(open(f"{W}/journal.json"))
F = {f["_id"]: f for f in json.load(open(f"{W}/folders.json"))}
def path(fid):
    p = []
    while fid: p.insert(0, F[fid]["name"]); fid = F[fid].get("folder")
    return "/".join(p)
J = [r for r in R if r["_key"].startswith("!journal!") and FOLD in path(r.get("folder"))]
P = {r["_id"]: r for r in R if r["_key"].startswith("!journal.pages!")}
lines = []
for j in J:
    for pid in j["pages"]:
        p = P.get(pid)
        if p and p.get("text", {}).get("content"):
            for l in re.findall(r"<li><p>(.*?)</p>", p["text"]["content"]):
                t = re.sub(r"<[^>]+>", "", l)
                d = [int(x) for x in re.findall(r"dc[:=](\d+)", t)]
                if d: lines.append((j["name"], p["name"], t, d))
rolls = [r for r in json.load(open(ROLLS)) if not r["stat"] and r["dcs"]]
stop = {"check", "recall", "knowledge", "statistic", "with", "that", "from", "this", "their", "they", "succeeds", "successful", "attempt"}
words = lambda s: {w for w in re.findall(r"[a-z]{4,}", s.lower())} - stop
pairs = []
for jn, pn, t, d in lines:
    best = max(((len(words(t) & words(r["text"])), r) for r in rolls), key=lambda x: x[0])
    if best[0] >= 4: pairs.append((best[1], d, pn))
js = "import {convertDc} from '" + os.path.join(REPO, "scripts/conversion/dc.js") + "'; const out={}; for (let L=0;L<=20;L++) for (let dc=0; dc<=60; dc++) out[L+':'+dc]=convertDc(dc,L,'" + SRC + "').dc; console.log(JSON.stringify(out))"
table = json.loads(subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True).stdout)
byhead = collections.OrderedDict()
order = [r["heading"] for r in json.load(open(ROLLS))]
for r, d, pn in sorted(pairs, key=lambda x: order.index(x[0]["heading"])):
    for dc1 in r["dcs"]:
        ok = {L for L in range(21) if table[f"{L}:{dc1}"] in d}
        byhead.setdefault(r["heading"], []).append((dc1, d, ok))
for h, v in byhead.items():
    common = set.intersection(*[o for _, _, o in v if o]) if any(o for _, _, o in v) else set()
    print(f"{h[:45]:45} levels {sorted(common) or '?'}  " + "; ".join(f"{a}->{b}" for a, b, _ in v[:4]))
