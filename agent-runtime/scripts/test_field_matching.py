"""
Simulate the _nearest_text_box / _nearest_cb_box matching used in detect_pdf_fields.
Shows exactly where each label would be filled — without needing OCR/GPT.
Run: python scripts/test_field_matching.py
"""
import sys
import fitz

pdf_path = r"d:\Yuno AI Agentic\agent-runtime\workspace\uploads\Beige Gold Modern Corporate Business Membership Form A4 Document_20260526_010101_0000 (1).PDF"

doc = fitz.open(pdf_path)
page = doc[0]
pw, ph = page.rect.width, page.rect.height

# ── Extract words ─────────────────────────────────────────────────────────────
fitz_words = []
for w in page.get_text("words"):
    t = (w[4] or "").strip()
    if t:
        fitz_words.append({"text": t, "left_pt": w[0], "top_pt": w[1],
                           "right_pt": w[2], "bottom_pt": w[3]})

# ── Extract drawings ──────────────────────────────────────────────────────────
raw_text_boxes = []
raw_cb_boxes   = []
for drw in page.get_drawings():
    r = drw.get("rect")
    if r is None or r.is_empty:
        continue
    rw, rh = r.width, r.height
    if rw <= 0 or rh <= 0:
        continue
    entry = {"x0": r.x0, "y0": r.y0, "x1": r.x1, "y1": r.y1,
             "w": rw, "h": rh,
             "cx": (r.x0+r.x1)/2, "cy": (r.y0+r.y1)/2,
             "fill_x": r.x0+4, "fill_y": r.y0+rh*0.72,
             "color": drw.get("color"), "fill": drw.get("fill")}
    if 5 <= rw <= 28 and 5 <= rh <= 28 and abs(rw-rh) <= 5:
        raw_cb_boxes.append(entry)
    elif rw >= 40 and 8 <= rh <= 50:
        raw_text_boxes.append(entry)

# ── Dedup ─────────────────────────────────────────────────────────────────────
def _dedup(boxes):
    orange = (0.686, 0.298, 0.059)
    def is_orange(c):
        return bool(c and abs(c[0]-orange[0])<0.05 and abs(c[1]-orange[1])<0.05 and abs(c[2]-orange[2])<0.05)
    seen = []
    for box in boxes:
        dup = False
        for i, s in enumerate(seen):
            if (abs(box["x0"]-s["x0"]) < 2 and abs(box["y0"]-s["y0"]) < 2
                    and abs(box["w"]-s["w"]) < 3 and abs(box["h"]-s["h"]) < 3):
                dup = True
                if is_orange(box.get("color")):
                    seen[i] = box
                break
        if not dup:
            seen.append(box)
    return seen

text_boxes = _dedup(raw_text_boxes)
cb_boxes   = _dedup(raw_cb_boxes)

print(f"\nPage: {pw:.1f} x {ph:.1f} pt")
print(f"Words: {len(fitz_words)}  |  Text boxes (deduped): {len(text_boxes)}  |  CB boxes (deduped): {len(cb_boxes)}")

# ── Match helpers ─────────────────────────────────────────────────────────────
import re
def _norm(t):
    return re.sub(r"[^a-z0-9]", "", t.lower())

def _label_bbox(label, wlist):
    nl = _norm(label)
    if not nl: return None
    nw = [_norm(w["text"]) for w in wlist]
    best_score, best = 0.0, None
    for i in range(len(wlist)):
        running = ""
        for j in range(i, min(i+10, len(wlist))):
            running += nw[j]
            if nl in running:
                score = len(nl) / len(running)
                if score > best_score:
                    best_score = score
                    best = {"left_pt": min(wlist[k]["left_pt"] for k in range(i,j+1)),
                            "top_pt": min(wlist[k]["top_pt"] for k in range(i,j+1)),
                            "right_pt": max(wlist[k]["right_pt"] for k in range(i,j+1)),
                            "bottom_pt": max(wlist[k]["bottom_pt"] for k in range(i,j+1))}
                break
    return best

def _nearest_text_box(bb):
    if not bb or not text_boxes: return None
    lright = bb["right_pt"]; lcy = (bb["top_pt"]+bb["bottom_pt"])/2
    best, best_d = None, float("inf")
    for tb in text_boxes:
        if abs(tb["cy"]-lcy) <= 20 and tb["x0"] >= lright-5:
            d = (tb["x0"]-lright) + abs(tb["cy"]-lcy)*1.5
            if d < best_d: best_d, best = d, tb
    return best if best_d < 350 else None

def _nearest_cb_box(bb):
    if not bb or not cb_boxes: return None
    oleft = bb["left_pt"]; ocy = (bb["top_pt"]+bb["bottom_pt"])/2
    best, best_d = None, float("inf")
    for cb in cb_boxes:
        if cb["cx"] > oleft+10: continue
        if abs(cb["cy"]-ocy) > 20: continue
        d = (oleft-cb["cx"]) + abs(cb["cy"]-ocy)*2
        if d < best_d: best_d, best = d, cb
    return best if best_d < 120 else None

# ── Test all labels ───────────────────────────────────────────────────────────
TEXT_LABELS = [
    "First Name", "Place Of Birth", "Phone Number",
    "Nationality", "Religion", "Home Address", "Email Address",
    "Purpose of Registration", "Preferred Activation Date",
]
CB_LABELS = {
    "Gender":              ["Male", "Female"],
    "Status":              ["Single", "Married", "Divorce", "Others"],
    "Membership Type":     ["Basic", "Standard", "Premium"],
    "Subscription Duration": ["6 Months", "12 Months", "24 Months"],
}

print("\n=== TEXT FIELD FILL POSITIONS ===")
for label in TEXT_LABELS:
    bb = _label_bbox(label, fitz_words)
    if not bb:
        print(f"  [{label}]  NOT FOUND in fitz_words")
        continue
    drw = _nearest_text_box(bb)
    if drw:
        print(f"  [{label}]")
        print(f"     label ends at x={bb['right_pt']:.1f}, y={bb['top_pt']:.1f}-{bb['bottom_pt']:.1f}")
        print(f"     drawn box: ({drw['x0']:.1f},{drw['y0']:.1f})-({drw['x1']:.1f},{drw['y1']:.1f})")
        print(f"     FILL at: ({drw['fill_x']:.1f}, {drw['fill_y']:.1f})  [INSIDE DRAWN BOX] <--")
    else:
        gap = 20.0
        fx = bb["right_pt"] + gap
        fy = bb["top_pt"] + (bb["bottom_pt"]-bb["top_pt"])*0.75
        print(f"  [{label}]  no drawn box found -> FALLBACK fill at ({fx:.1f}, {fy:.1f})")

print("\n=== CHECKBOX FILL POSITIONS ===")
for group, opts in CB_LABELS.items():
    print(f"\n  [{group}]")
    for opt in opts:
        bb = _label_bbox(opt, fitz_words)
        if not bb:
            print(f"    [{opt}]  NOT FOUND")
            continue
        cb = _nearest_cb_box(bb)
        if cb:
            print(f"    [{opt}]  text@({bb['left_pt']:.1f},{bb['top_pt']:.1f})"
                  f"  -> checkbox box: ({cb['x0']:.1f},{cb['y0']:.1f}) w={cb['w']:.1f} h={cb['h']:.1f}  [DRAWN BOX] <--")
        else:
            bs = max(bb["bottom_pt"]-bb["top_pt"], 8.0)
            fx = max(0.0, bb["left_pt"]-bs-3)
            print(f"    [{opt}]  no drawn cb -> FALLBACK: ({fx:.1f},{bb['top_pt']:.1f})")

doc.close()
print("\n=== Deduplicated drawn text boxes ===")
for tb in sorted(text_boxes, key=lambda t: t["y0"]):
    print(f"  ({tb['x0']:.0f},{tb['y0']:.0f})-({tb['x1']:.0f},{tb['y1']:.0f}) "
          f"fill_x={tb['fill_x']:.0f} fill_y={tb['fill_y']:.0f}")
