#!/usr/bin/env python3
"""
PDF -> Markdown for adventure books (PLAN §23).

    python3 tools/pdf-to-md/pdf_to_md.py book.pdf [-o book.md] [--pages 5-41] [--profile auto|paizo-1e|size]

- Reads text with font, size, weight and position (PyMuPDF: pip install pymupdf).
- Two-column pages: left column top to bottom, then right; full-width blocks
  split the page into bands.
- Headings come from a style profile: Paizo's 1e Adventure Path layout
  (fonts Xirod / TradeGothic / GoodOT, picked automatically) maps each
  heading font to a level and drops map labels; other books fall back to
  font sizes (larger than the body text = #, ##, ###).
- Small-caps titles ("A1. L" + "anding" in a smaller size) are rebuilt in
  normal case; bold and italic runs are kept as **bold** / *italic*.
- Lines repeated in the page margins on many pages (running headers, page
  numbers, the personalised watermark with the buyer's name / order) are
  dropped.
- Every page starts with <!-- p. N --> so entries can cite their page.

The output contains the book's text: keep it out of the repository.
"""

import argparse
import collections
import re
import sys

import pymupdf

# A profile: rules tried in order, (font regex, min size, max size, role).
# Roles: h1..h4 (heading levels), stat (stat block name: ####, "Stat:"),
# label (bold run-in label kept as **text**), drop (map labels, TOC), text.
PROFILES = {
    "paizo-1e": [
        (r"^Xirod", 11.5, 30, "h1"),             # PART 1: THE BEST-LAID PLANS, back-matter chapters
        (r"^TradeGothic.*BdCn20$", 13.5, 15, "h2"),  # EVENT 1: … (CR 12), A. BRINNOA STARPORT
        (r"^TradeGothic.*SC700", 12, 14, "h3"),   # A1. Landing Pads
        (r"^TradeGothic", 0, 13.5, "drop"),       # map labels, compass, scale
        (r"^Xirod", 10.5, 11.5, "h3"),            # sidebars: MISSION UPDATES, SETTING THE CHARGES
        (r"^Xirod", 0, 10.5, "drop"),             # contents page, page numbers
        (r"^GoodOT-CondBold", 11, 13, "stat"),    # SWARM CORROVOX GUERRILLAS (4) / CR 7
        (r"^AxionSSF", 13, 15, "stat"),           # Alien Archive entries
        (r"^GoodOT-Bold", 10.5, 12, "h4"),        # rules sub-headings
        (r"^GoodOT-Bold", 8.8, 9.5, "label"),     # XP / DEFENSE / OFFENSE / STATISTICS / CREW
    ],
    # Pathfinder 1e Adventure Path (Rise of the Runelords Anniversary Edition).
    "paizo-pf1e": [
        (r"^CartaMarinaBold$", 20, 40, "h1"),     # PART ONE: MURDER MOST FOUL
        (r"^CartaMarinaBold$", 14.5, 16, "h2"),   # Sandpoint Lumber Mill, Meeting the Doctor
        (r"^CartaMarina", 0, 100, "drop"),        # running headers, page numbers, map labels, drop caps
        (r"^TradeGothic.*BdCn20$", 13, 14.5, "room"),  # B1 RUINED SERVANTS’ QUARTERS (CR 5)
        (r"^TradeGothic.*BdCn20$", 11.5, 13, "stat"),  # GORTUS AND GURNAK / ERIN HABE
        (r"^TradeGothic.*BdCn20$", 9.5, 11, "runin"),  # A1 VERANDA: The old floorboards… (room keys)
        (r"^TradeGothic.*BdCn20$", 0, 8, "drop"),      # side tabs, contents
        (r"^NexusSansOT", 12, 20, "drop"),        # the chapter's contents page
        (r"^Dax-Black", 0, 100, "label"),         # DEFENSE / OFFENSE / TACTICS / STATISTICS
        (r"^(Gene|P22DaVinci|BibleScript|BakerScript|CCTreacherous)", 0, 100, "handout"),  # handouts, letters
    ],
}
FONT_SIGNS = {"paizo-1e": ("Xirod", "GoodOT"), "paizo-pf1e": ("CartaMarina", "NexusSerif")}


def parse_pages(spec, count):
    if not spec:
        return range(count)
    a, _, b = spec.partition("-")
    return range(int(a) - 1, int(b or a))


def norm(text):
    """Key for repeated-line detection: digits removed, spaces collapsed."""
    return re.sub(r"\s+", " ", re.sub(r"\d+", "#", text)).strip().lower()


def is_bold(span):
    return bool(span["flags"] & 16) or any(w in span["font"] for w in ("Bold", "Black", "Semibold"))


def is_italic(span):
    return bool(span["flags"] & 2) or "Italic" in span["font"]


def line_text(spans, markup=True):
    """A line's text: small caps rebuilt, bold / italic runs marked."""
    top = max(s["size"] for s in spans if s["text"].strip())
    parts = []
    for s in spans:
        t = s["text"]
        if "SC" in s["font"] and s["size"] < top * 0.85:
            t = t.lower()  # small caps: the smaller letters are lowercase
        if markup and t.strip():
            lead, core, trail = re.match(r"^(\s*)(.*?)(\s*)$", t).groups()
            if is_bold(s):
                core = f"**{core}**"
            elif is_italic(s):
                core = f"*{core}*"
            t = lead + core + trail
        parts.append(t)
    text = "".join(parts).strip()
    return re.sub(r"\*\*\s*\*\*|\*\*(\s+)\*\*", lambda m: m.group(1) or "", text).replace("****", "")


SMALL_WORDS = {"a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"}


def title_case(text):
    """Small-caps titles: "c1. front drive (cr 12)" → "C1. Front Drive (CR 12)"."""
    words = text.split(" ")
    out = []
    for i, w in enumerate(words):
        if i == 0 or re.fullmatch(r"[a-z]\d+\.?", w):
            out.append(w.upper())
        elif w.lower() in SMALL_WORDS and i > 1:
            out.append(w.lower())
        else:
            out.append(w[:1].upper() + w[1:])
    return " ".join(out)


def fix_cr(text):
    return re.sub(r"\((cr|tier) ([\d+/]+)\)", lambda m: f"({m.group(1).upper()} {m.group(2)})", text, flags=re.I)


def room_title(code, name):
    """"A5", "ORDERLIES’ ROOMS (CR 1)" → "A5. Orderlies’ Rooms (CR 1)"."""
    words = name.lower().split()
    out = [w if i and w in SMALL_WORDS else w[:1].upper() + w[1:] for i, w in enumerate(words)]
    return f"{code}. " + " ".join(out)


def page_blocks(page):
    """[(block_bbox, [line dict]) ] for the text blocks of a page."""
    data = page.get_text("dict")
    out = []
    for block in data["blocks"]:
        if block.get("type") != 0:
            continue
        lines = []
        for line in block["lines"]:
            spans = [s for s in line["spans"] if s["text"].strip()]
            if not spans:
                continue
            first = spans[0]
            lines.append({
                "spans": line["spans"], "bbox": line["bbox"],
                "font": first["font"], "size": round(max(s["size"] for s in spans), 1),
                "bold": all(is_bold(s) for s in spans),
                "plain": line_text(line["spans"], markup=False),
            })
        if lines:
            out.append((block["bbox"], lines))
    return out


def in_margin(bbox, rect, share=0.08):
    """Running headers, footers, page numbers and watermarks sit near an edge."""
    x0, y0, x1, y1 = bbox
    return y1 < rect.height * share or y0 > rect.height * (1 - share) \
        or x1 < rect.width * share or x0 > rect.width * (1 - share)


def column_order(blocks, width):
    """Full-width blocks keep their place; others: left column, then right, band by band."""
    mid = width / 2
    full = [b for b in blocks if b[0][0] < mid - width * 0.05 and b[0][2] > mid + width * 0.05]
    rest = [b for b in blocks if b not in full]
    left = sorted([b for b in rest if (b[0][0] + b[0][2]) / 2 < mid], key=lambda b: (b[0][1], b[0][0]))
    right = sorted([b for b in rest if (b[0][0] + b[0][2]) / 2 >= mid], key=lambda b: (b[0][1], b[0][0]))
    out, top = [], -1
    for f in sorted(full, key=lambda b: b[0][1]) + [None]:
        bottom = f[0][1] if f else 1e9
        out += [b for b in left if top <= b[0][1] < bottom] + [b for b in right if top <= b[0][1] < bottom]
        if f:
            out.append(f)
            top = f[0][1]
    return out


def pick_profile(doc, wanted):
    if wanted != "auto":
        return wanted
    fonts = set()
    for n in range(min(doc.page_count, 12)):
        for f in doc[n].get_fonts():
            fonts.add(f[3])
    for name, signs in FONT_SIGNS.items():
        if all(any(sign in f for f in fonts) for sign in signs):
            return name
    return "size"


def role_of(line, rules, size_levels):
    if rules is not None:
        for font, lo, hi, role in rules:
            if re.search(font, line["font"]) and lo <= line["size"] < hi:
                return role
        return "text"
    return f"h{size_levels[line['size']]}" if line["size"] in size_levels else "text"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("-o", "--out")
    ap.add_argument("--pages", help="e.g. 5-41 (1-based, inclusive)")
    ap.add_argument("--profile", default="auto", choices=["auto", "size", *PROFILES])
    ap.add_argument("--repeat", type=float, default=0.3, help="drop margin lines found on this share of pages")
    args = ap.parse_args()

    doc = pymupdf.open(args.pdf)
    pages = list(parse_pages(args.pages, doc.page_count))
    profile = pick_profile(doc, args.profile)
    rules = PROFILES.get(profile)

    raw, sizes, seen = [], collections.Counter(), collections.Counter()
    for n in pages:
        page = doc[n]
        blocks = column_order(page_blocks(page), page.rect.width)
        raw.append((n, blocks))
        keys = set()
        for _, lines in blocks:
            for line in lines:
                sizes[line["size"]] += len(line["plain"])
                if in_margin(line["bbox"], page.rect):
                    keys.add(norm(line["plain"]))
        seen.update(keys)
    repeated = {k for k, c in seen.items() if c >= max(3, args.repeat * len(pages))}
    body = sizes.most_common(1)[0][0] if sizes else 10
    heading_sizes = sorted({s for s in sizes if s >= body + 1.5}, reverse=True)
    size_levels = {s: min(i + 1, 3) for i, s in enumerate(heading_sizes)}

    out = []
    last = None  # (role, y1) of the previous heading line, to merge titles broken over lines

    def emit_heading(role, text, y0, y1):
        nonlocal last
        marks = {"h1": "#", "h2": "##", "h3": "###", "h4": "####", "stat": "####"}[role]
        if last and last[0] == role and -25 <= y0 - last[1] < 30 and out and out[-1].lstrip("\n").startswith(marks + " "):
            out[-1] = out[-1].rstrip("\n") + " " + text + "\n"  # same heading continued (or a stat block's CR)
        else:
            prefix = "Stat: " if role == "stat" else ""
            out.append(f"\n{marks} {prefix}{text}\n")
        last = (role, y1)

    for n, blocks in raw:
        rect = doc[n].rect
        out.append(f"\n<!-- p. {n + 1} -->\n")
        last = None
        for _, lines in blocks:
            para = []

            def flush():
                if para:
                    text = re.sub(r"(\w)- (\w)", r"\1\2", " ".join(para))  # hyphenated line breaks
                    out.append(text + "\n")
                    para.clear()

            for line in lines:
                plain = line["plain"]
                if in_margin(line["bbox"], rect) and (norm(plain) in repeated or re.fullmatch(r"\d{1,3}", plain)):
                    continue
                role = role_of(line, rules, size_levels)
                if role == "drop":
                    continue
                m = re.match(r"^([A-Z]\d+[a-z]?)\.?\s+([^:]{2,60}):\s*(.*)$", plain) if role == "runin" else None
                if m:
                    flush()
                    emit_heading("h3", fix_cr(room_title(m.group(1), m.group(2))), line["bbox"][1], line["bbox"][3])
                    last = None
                    if m.group(3):
                        para.append(m.group(3))
                    continue
                if role == "room":
                    r = re.match(r"^([A-Z]\d+[a-z]?)\.?\s+(.+)$", plain)
                    flush()
                    emit_heading("h3", fix_cr(room_title(r.group(1), r.group(2)) if r else plain), line["bbox"][1], line["bbox"][3])
                    continue
                if role == "runin" and re.fullmatch(r"(?:[A-Z]\d*[a-z]?\s*)+", plain):
                    continue  # map labels: only room codes
                if role == "runin":
                    flush()
                    emit_heading("h4", plain, line["bbox"][1], line["bbox"][3])
                    continue
                if role == "handout":
                    para.append(f"*{plain}*")
                    continue
                if role in ("h1", "h2", "h3", "h4", "stat"):
                    flush()
                    text = plain if role != "h1" else plain.upper()
                    if any("SC" in sp["font"] for sp in line["spans"]):
                        text = title_case(text)
                    text = fix_cr(text)
                    emit_heading(role, text, line["bbox"][1], line["bbox"][3])
                    continue
                last = None
                text = line_text(line["spans"])
                if role == "label" or (rules is None and line["bold"] and abs(line["size"] - body) < 1 and len(plain) < 80 and not para):
                    flush()
                    out.append(f"**{plain}**\n")
                else:
                    para.append(text)
            flush()

    md = re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip() + "\n"
    md = re.sub(r"\*\*([^*\n]+?)\*\* \*\*([^*\n]+?)\*\*", r"**\1 \2**", md)  # adjacent bold runs
    if args.out:
        open(args.out, "w", encoding="utf-8").write(md)
        print(f"{args.out}: {len(pages)} pages, profile {profile}, body {body}pt", file=sys.stderr)
    else:
        sys.stdout.write(md)


if __name__ == "__main__":
    main()
