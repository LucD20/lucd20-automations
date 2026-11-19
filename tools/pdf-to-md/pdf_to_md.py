#!/usr/bin/env python3
"""
PDF -> Markdown for adventure books (PLAN §23).

    python3 tools/pdf-to-md/pdf_to_md.py book.pdf [-o book.md] [--pages 3-70]

- Reads text with font size / weight / position (PyMuPDF: pip install pymupdf).
- Two-column pages: blocks are read left column top to bottom, then right.
- Headings: the font sizes larger than the body text become #, ##, ### ...
  (largest first); bold body-size lines that stand alone become ####.
- Lines repeated on many pages (running headers, page numbers, the
  personalised watermark with the buyer's name / order) are dropped.
- Every page starts with an HTML comment <!-- p. N --> so entries can cite
  their page.

The output contains the book's text: keep it out of the repository.
"""

import argparse
import collections
import re
import sys

import pymupdf


def parse_pages(spec, count):
    if not spec:
        return range(count)
    a, _, b = spec.partition("-")
    return range(int(a) - 1, int(b or a))


def norm(text):
    """Key for repeated-line detection: digits removed, spaces collapsed."""
    return re.sub(r"\s+", " ", re.sub(r"\d+", "#", text)).strip().lower()


def page_lines(page):
    """Yield (block_bbox, [ (text, size, bold) per line ]) for text blocks."""
    data = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE)
    for block in data["blocks"]:
        if block.get("type") != 0:
            continue
        lines = []
        for line in block["lines"]:
            spans = [s for s in line["spans"] if s["text"].strip()]
            if not spans:
                continue
            text = "".join(s["text"] for s in line["spans"]).strip()
            size = round(max(s["size"] for s in spans), 1)
            bold = all((s["flags"] & 16) or "Bold" in s["font"] or "Black" in s["font"] for s in spans)
            lines.append((text, size, bold, line["bbox"]))
        if lines:
            yield block["bbox"], lines


def in_margin(bbox, rect, share=0.08):
    """Running headers, footers, page numbers and watermarks sit near an edge."""
    x0, y0, x1, y1 = bbox
    return y1 < rect.height * share or y0 > rect.height * (1 - share) \
        or x1 < rect.width * share or x0 > rect.width * (1 - share)


def column_order(blocks, width):
    """Full-width blocks keep their place; others: left column, then right."""
    mid = width / 2
    full = [b for b in blocks if b[0][0] < mid and b[0][2] > mid + width * 0.1]
    left = sorted([b for b in blocks if b not in full and b[0][2] <= mid + width * 0.1 and b[0][0] < mid], key=lambda b: (b[0][1], b[0][0]))
    right = sorted([b for b in blocks if b not in full and b not in left], key=lambda b: (b[0][1], b[0][0]))
    if not full:
        return left + right
    # Split at full-width blocks: each band is read left then right.
    out, full = [], sorted(full, key=lambda b: b[0][1])
    top = -1
    for f in full + [None]:
        bottom = f[0][1] if f else 1e9
        out += [b for b in left if top <= b[0][1] < bottom] + [b for b in right if top <= b[0][1] < bottom]
        if f:
            out.append(f)
            top = f[0][1]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("-o", "--out")
    ap.add_argument("--pages", help="e.g. 3-70 (1-based, inclusive)")
    ap.add_argument("--repeat", type=float, default=0.3, help="drop lines found on this share of pages")
    args = ap.parse_args()

    doc = pymupdf.open(args.pdf)
    pages = list(parse_pages(args.pages, doc.page_count))
    raw = []
    sizes = collections.Counter()
    seen = collections.Counter()
    for n in pages:
        page = doc[n]
        blocks = column_order(list(page_lines(page)), page.rect.width)
        raw.append((n + 1, blocks))
        keys = set()
        for _, lines in blocks:
            for text, size, bold, bbox in lines:
                sizes[size] += len(text)
                if in_margin(bbox, page.rect):
                    keys.add(norm(text))
        seen.update(keys)

    repeated = {k for k, c in seen.items() if c >= max(3, args.repeat * len(pages))}
    body = sizes.most_common(1)[0][0] if sizes else 10
    heading_sizes = sorted({s for s in sizes if s >= body + 1.5}, reverse=True)
    level = {s: min(i + 1, 3) for i, s in enumerate(heading_sizes)}

    out = []
    for (pno, blocks), n in zip(raw, pages):
        rect = doc[n].rect
        out.append(f"\n<!-- p. {pno} -->\n")
        for _, lines in blocks:
            para = []
            def flush():
                if para:
                    text = " ".join(para)
                    text = re.sub(r"(\w)- (\w)", r"\1\2", text)  # hyphenated line breaks
                    out.append(text + "\n")
                    para.clear()
            for text, size, bold, bbox in lines:
                if in_margin(bbox, rect) and (norm(text) in repeated or re.fullmatch(r"\d{1,3}", text)):
                    continue
                if size in level:
                    flush()
                    out.append(f"\n{'#' * level[size]} {text}\n")
                elif bold and abs(size - body) < 1 and len(text) < 80 and not para:
                    out.append(f"\n#### {text}\n")
                else:
                    para.append(text)
            flush()
            out.append("")

    md = re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip() + "\n"
    # Merge headings broken over two lines ("# Part 2:" + "# Sand in the Gears").
    md = re.sub(r"^(#+) (.+)\n\n\1 (.+)$", r"\1 \2 \3", md, flags=re.M)
    if args.out:
        open(args.out, "w", encoding="utf-8").write(md)
        print(f"{args.out}: {len(pages)} pages, body {body}pt, headings {heading_sizes[:6]}", file=sys.stderr)
    else:
        sys.stdout.write(md)


if __name__ == "__main__":
    main()
