"""
Quick diagnostic: show what PyMuPDF finds in the membership form PDF.
Prints:
  1. All text words with coordinates (from get_text)
  2. All drawn rectangles (from get_drawings) categorised as text-input or checkbox
  3. Summary of matching quality

Run:  python scripts/test_pdf_coords.py "<pdf path>"
"""
import sys
import json

try:
    import fitz
except ImportError:
    print("ERROR: pymupdf not installed")
    sys.exit(1)

pdf_path = sys.argv[1] if len(sys.argv) > 1 else ""
if not pdf_path:
    import glob, os
    pdfs = glob.glob(r"d:\Yuno AI Agentic\agent-runtime\workspace\uploads\*.PDF")
    pdfs += glob.glob(r"d:\Yuno AI Agentic\agent-runtime\workspace\uploads\*.pdf")
    pdf_path = pdfs[0] if pdfs else ""

if not pdf_path:
    print("No PDF found")
    sys.exit(1)

print(f"\n=== PDF: {pdf_path} ===\n")

doc = fitz.open(pdf_path)
page = doc[0]
pw, ph = page.rect.width, page.rect.height
print(f"Page size: {pw:.1f} x {ph:.1f} pt\n")

# ── 1. Text words ──────────────────────────────────────────────────────────────
words = page.get_text("words")
print(f"=== TEXT WORDS ({len(words)} total) ===")
for w in words:
    x0, y0, x1, y1, text = w[0], w[1], w[2], w[3], w[4]
    print(f"  [{x0:6.1f},{y0:6.1f} -> {x1:6.1f},{y1:6.1f}]  {text!r}")

# ── 2. Drawings ────────────────────────────────────────────────────────────────
drawings = page.get_drawings()
text_boxes = []
cb_boxes   = []
other_rects = []

for drw in drawings:
    r = drw.get("rect")
    if r is None or r.is_empty:
        continue
    rw, rh = r.width, r.height
    if rw <= 0 or rh <= 0:
        continue
    color   = drw.get("color")
    fill    = drw.get("fill")
    entry   = {"x0": r.x0, "y0": r.y0, "x1": r.x1, "y1": r.y1,
               "w": rw, "h": rh, "color": color, "fill": fill}
    if 5 <= rw <= 28 and 5 <= rh <= 28 and abs(rw - rh) <= 5:
        cb_boxes.append(entry)
    elif rw >= 40 and 8 <= rh <= 50:
        text_boxes.append(entry)
    else:
        other_rects.append(entry)

print(f"\n=== DRAWN TEXT BOXES ({len(text_boxes)} found) ===")
for tb in sorted(text_boxes, key=lambda t: (t["y0"], t["x0"])):
    print(f"  [{tb['x0']:6.1f},{tb['y0']:6.1f} -> {tb['x1']:6.1f},{tb['y1']:6.1f}]  "
          f"w={tb['w']:.1f} h={tb['h']:.1f}  "
          f"fill_x={tb['x0']+4:.1f}  fill_y={tb['y0']+tb['h']*0.72:.1f}  "
          f"color={tb['color']}  fill={tb['fill']}")

print(f"\n=== DRAWN CHECKBOX SQUARES ({len(cb_boxes)} found) ===")
for cb in sorted(cb_boxes, key=lambda c: (c["y0"], c["x0"])):
    print(f"  [{cb['x0']:6.1f},{cb['y0']:6.1f} -> {cb['x1']:6.1f},{cb['y1']:6.1f}]  "
          f"w={cb['w']:.1f} h={cb['h']:.1f}  color={cb['color']}")

print(f"\n=== OTHER RECTS ({len(other_rects)} found, first 15) ===")
for r in other_rects[:15]:
    print(f"  [{r['x0']:6.1f},{r['y0']:6.1f} -> {r['x1']:6.1f},{r['y1']:6.1f}]  "
          f"w={r['w']:.1f} h={r['h']:.1f}  color={r['color']}  fill={r['fill']}")

print(f"\nTotal drawings: {len(drawings)}")
doc.close()
