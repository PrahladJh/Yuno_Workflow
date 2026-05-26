#!/usr/bin/env python3
"""
detect_form_fields.py  —  v3 (tri-pass detection)
===================================================
Pass 1: Line-intersection  → box-grid forms (HDFC style)
Pass 2: Drawing objects    → forms with drawn underline input areas
Pass 3: Text underscores   → forms that use ____ in text as input placeholders

Checkbox detection via small-square scanning.

Output JSON:
  {
    page_size: {width, height},
    fields: [{label, x, y, box_width, max_chars, type, line_end_x?}, ...],
    checkboxes: [{label, options:[{text,x,y,w,h},...]}]
  }
  type = "box_grid"  → place one char per box (box_width spacing)
  type = "free_text" → draw full string at (x, y)
  All coordinates in pdf-lib space (y from page bottom, x from left).

Usage:  python detect_form_fields.py <pdf_path>
Env:    SAVE_DEBUG_IMG=1  saves <pdf>.debug.png
"""

import sys, os, re, json, traceback
import numpy as np

# ── tunables ──────────────────────────────────────────────────────────────────
DPI            = 300
SCALE          = DPI / 72.0

MIN_H_LINE_PX  = max(30, int(25 * SCALE / 6))
MIN_V_LINE_PX  = max(10, int(8  * SCALE / 6))

Y_CLUSTER_PX   = 8
X_CLUSTER_PX   = 6
MIN_CELLS      = 3
MAX_SPACING_CV = 0.25

BASELINE_FRAC  = 0.60

MIN_UNDERLINE_PT = 15      # minimum drawing line length to count as input underline (was 25)
CHAR_WIDTH_PT    = 5.5     # estimated pt per character for free-text fields
# ─────────────────────────────────────────────────────────────────────────────


# ════════════════════════════════════════════════════════════════════════════════
# PASS 1  —  box-grid (line-intersection)
# ════════════════════════════════════════════════════════════════════════════════

def render_page(pdf_path, page_num=0):
    import fitz
    doc  = fitz.open(pdf_path)
    page = doc[page_num]
    pw, ph = page.rect.width, page.rect.height
    pix  = page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE),
                           colorspace=fitz.csRGB, alpha=False)
    img  = np.frombuffer(pix.samples, dtype='uint8').reshape(pix.height, pix.width, 3)
    doc.close()
    return img, pw, ph


def binary_image(img):
    import cv2
    gray   = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    adapt  = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                                   cv2.THRESH_BINARY_INV, 15, 4)
    _, simple = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    return cv2.bitwise_or(adapt, simple)


def extract_h_lines(binary):
    import cv2
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (MIN_H_LINE_PX, 1))
    return cv2.morphologyEx(binary, cv2.MORPH_OPEN, k)


def extract_v_lines(binary):
    import cv2
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (1, MIN_V_LINE_PX))
    return cv2.morphologyEx(binary, cv2.MORPH_OPEN, k)


def find_intersections(h_lines, v_lines):
    import cv2
    d = cv2.getStructuringElement(cv2.MORPH_RECT, (4, 4))
    cross = cv2.bitwise_and(cv2.dilate(h_lines, d), cv2.dilate(v_lines, d))
    pts   = cv2.findNonZero(cross)
    if pts is None:
        return np.empty((0, 2), dtype=int)
    return pts.reshape(-1, 2)


def cluster_into_rows(pts):
    if len(pts) == 0:
        return []
    pts_s = pts[np.argsort(pts[:, 1])]
    rows, cur = [], [pts_s[0]]
    for pt in pts_s[1:]:
        if abs(int(pt[1]) - int(cur[0][1])) <= Y_CLUSTER_PX:
            cur.append(pt)
        else:
            rows.append(cur); cur = [pt]
    rows.append(cur)
    return rows


def deduplicate_xs(row_pts):
    xs = sorted(int(p[0]) for p in row_pts)
    merged = [xs[0]]
    for x in xs[1:]:
        if x - merged[-1] <= X_CLUSTER_PX:
            merged[-1] = (merged[-1] + x) // 2
        else:
            merged.append(x)
    return merged


def row_cell_stats(xs):
    if len(xs) < MIN_CELLS + 1:
        return None
    gaps = [xs[i+1] - xs[i] for i in range(len(xs) - 1)]
    med  = float(np.median(gaps))
    if med < 1:
        return None
    if med / SCALE > 19:
        return None
    cv = float(np.std(gaps)) / med
    if cv > MAX_SPACING_CV:
        return None
    good = [xs[0]]
    for x in xs[1:]:
        if abs((x - good[-1]) - med) / med < 0.35:
            good.append(x)
    if len(good) < MIN_CELLS + 1:
        return None
    return good[0], med, len(good) - 1


def estimate_cell_height(row_pts, h_lines, img_h):
    y_top = int(np.mean([p[1] for p in row_pts]))
    col   = np.max(h_lines[y_top:y_top+100, :], axis=1)
    idxs  = np.where(col > 0)[0]
    idxs  = idxs[idxs > 2]
    return int(idxs[0]) if len(idxs) > 0 else 40


def ocr_label(img, x_start, y_top, cell_h):
    import cv2
    try:
        import pytesseract
        if sys.platform == 'win32':
            pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
    except ImportError:
        return ''
    pad   = max(4, cell_h // 4)
    y1    = max(0, y_top - pad)
    y2    = min(img.shape[0], y_top + cell_h + pad)
    x_end = max(0, x_start - 2)
    if x_end < 20:
        return ''
    region = img[y1:y2, 0:x_end]
    if region.size == 0:
        return ''
    rh = region.shape[0]
    if rh < 40:
        sf = max(2, 40 // rh)
        region = cv2.resize(region, None, fx=sf, fy=sf, interpolation=cv2.INTER_CUBIC)
    try:
        text = pytesseract.image_to_string(region, config='--psm 7 --oem 3')
        return ' '.join(text.split())
    except Exception:
        return ''


def px_to_pdf(x_px, y_top_px, cell_h_px, page_h_pt):
    x_pt      = (x_px + 1) / SCALE
    y_base_px = y_top_px + cell_h_px * BASELINE_FRAC
    y_pt      = page_h_pt - (y_base_px / SCALE)
    return round(x_pt, 1), round(y_pt, 1)


def pass1_detect(img, page_w_pt, page_h_pt):
    binary  = binary_image(img)
    h_lines = extract_h_lines(binary)
    v_lines = extract_v_lines(binary)
    pts     = find_intersections(h_lines, v_lines)
    rows    = cluster_into_rows(pts)

    detected = []
    for cluster in rows:
        xs    = deduplicate_xs(cluster)
        stats = row_cell_stats(xs)
        if stats is None:
            continue
        x_start, cell_w, num_cells = stats
        y_top  = int(np.mean([p[1] for p in cluster]))
        cell_h = estimate_cell_height(cluster, h_lines, img.shape[0])
        label  = ocr_label(img, x_start, y_top, cell_h)
        x_pt, y_pt = px_to_pdf(x_start, y_top, cell_h, page_h_pt)
        detected.append({
            'label'    : label,
            'x'        : x_pt,
            'y'        : y_pt,
            'box_width': round(cell_w / SCALE, 2),
            'max_chars': num_cells,
            'type'     : 'box_grid',
        })
    return detected


# ════════════════════════════════════════════════════════════════════════════════
# Shared text helpers
# ════════════════════════════════════════════════════════════════════════════════

def _get_spans(page):
    import fitz
    spans = []
    for block in page.get_text('dict', flags=fitz.TEXT_PRESERVE_WHITESPACE)['blocks']:
        if block.get('type') != 0:
            continue
        for line in block.get('lines', []):
            for span in line.get('spans', []):
                t = span.get('text', '').strip()
                if t:
                    b = span['bbox']
                    spans.append({
                        'text': t,
                        'x0': b[0], 'y0': b[1],
                        'x1': b[2], 'y1': b[3],
                        'ymid': (b[1] + b[3]) / 2,
                    })
    return spans


def _get_drawing_hlines(page):
    lines = []
    for d in page.get_drawings():
        for item in d.get('items', []):
            if item[0] == 'l':
                p1, p2 = item[1], item[2]
                if abs(p2.y - p1.y) < 2:
                    x0 = min(p1.x, p2.x); x1 = max(p1.x, p2.x)
                    if x1 - x0 >= MIN_UNDERLINE_PT:
                        lines.append({'x0': x0, 'y0': (p1.y + p2.y) / 2, 'x1': x1})
            elif item[0] == 're':
                r = item[1]
                if r.width >= MIN_UNDERLINE_PT and r.height < 5:
                    lines.append({'x0': r.x0, 'y0': r.y0, 'x1': r.x1})
    return lines


# ════════════════════════════════════════════════════════════════════════════════
# PASS 2  —  drawn underlines
# ════════════════════════════════════════════════════════════════════════════════

def pass2_detect(page, page_h_pt):
    spans  = _get_spans(page)
    hlines = _get_drawing_hlines(page)
    fields = []
    seen_ys = set()

    for span in spans:
        ymid  = span['ymid']
        y_key = round(ymid)
        if any(abs(y_key - sy) <= 5 for sy in seen_ys):
            continue

        same_row = [l for l in hlines
                    if abs(l['y0'] - ymid) < 15 and l['x0'] >= span['x1'] - 5]
        if same_row:
            best = min(same_row, key=lambda l: l['x0'])
            w    = best['x1'] - best['x0']
            fields.append({
                'label'     : span['text'],
                'x'         : round(best['x0'] + 2, 1),
                'y'         : round(page_h_pt - ymid, 1),
                'box_width' : 0,
                'max_chars' : max(1, int(w / CHAR_WIDTH_PT)),
                'type'      : 'free_text',
                'line_end_x': round(best['x1'], 1),
            })
            seen_ys.add(y_key)
            continue

        below = [l for l in hlines
                 if l['y0'] > span['y1'] and l['y0'] < span['y1'] + 20
                 and l['x0'] >= span['x0'] - 10]
        if below:
            best = min(below, key=lambda l: l['y0'])
            w    = best['x1'] - best['x0']
            fields.append({
                'label'     : span['text'],
                'x'         : round(best['x0'] + 2, 1),
                'y'         : round(page_h_pt - (best['y0'] + 2), 1),
                'box_width' : 0,
                'max_chars' : max(1, int(w / CHAR_WIDTH_PT)),
                'type'      : 'free_text',
                'line_end_x': round(best['x1'], 1),
            })
            seen_ys.add(y_key)

    return fields


# ════════════════════════════════════════════════════════════════════════════════
# PASS 3  —  text underscores
# ════════════════════════════════════════════════════════════════════════════════

def pass3_detect(page, page_h_pt):
    plain_spans = _get_spans(page)
    fields  = []
    seen_ys = set()

    try:
        rawdict = page.get_text('rawdict', flags=0)
    except Exception:
        return fields

    for block in rawdict.get('blocks', []):
        if block.get('type') != 0:
            continue
        for line in block.get('lines', []):
            all_chars = []
            for span in line.get('spans', []):
                for ch in span.get('chars', []):
                    b = ch.get('bbox') or ch.get('origin')
                    if isinstance(b, (list, tuple)) and len(b) >= 4:
                        all_chars.append({
                            'c'   : ch.get('c', ''),
                            'x0'  : b[0], 'y0': b[1],
                            'x1'  : b[2], 'y1': b[3],
                            'ymid': (b[1] + b[3]) / 2,
                        })

            if not all_chars:
                continue

            full_text = ''.join(c['c'] for c in all_chars)
            ymid      = float(np.mean([c['ymid'] for c in all_chars]))
            y_key     = round(ymid)

            if any(abs(y_key - sy) <= 5 for sy in seen_ys):
                continue

            m = re.search(r'_{3,}', full_text)
            if not m:
                continue

            start_i = m.start()
            end_i   = m.end() - 1

            label = full_text[:start_i].strip().rstrip(':').strip()

            if not label:
                x_of_first_char = all_chars[0]['x0'] if all_chars else 0
                left_candidates = [s for s in plain_spans
                                   if abs(s['ymid'] - ymid) < 6
                                   and s['x1'] <= x_of_first_char + 10
                                   and not re.match(r'^_+$', s['text'])]
                if left_candidates:
                    best = max(left_candidates, key=lambda s: s['x1'])
                    label = best['text'].rstrip(':').strip()

            x_start = all_chars[start_i]['x0'] if start_i < len(all_chars) else all_chars[-1]['x1']
            x_end   = all_chars[min(end_i, len(all_chars)-1)]['x1']
            w       = max(10.0, x_end - x_start)

            fields.append({
                'label'     : label,
                'x'         : round(x_start + 1, 1),
                'y'         : round(page_h_pt - ymid, 1),
                'box_width' : 0,
                'max_chars' : max(1, int(w / CHAR_WIDTH_PT)),
                'type'      : 'free_text',
                'line_end_x': round(x_end, 1),
            })
            seen_ys.add(y_key)

    return fields


# ════════════════════════════════════════════════════════════════════════════════
# CHECKBOX DETECTION
# ════════════════════════════════════════════════════════════════════════════════

def detect_checkboxes(page, page_h_pt):
    spans = _get_spans(page)

    cb_list = []
    for d in page.get_drawings():
        for item in d.get('items', []):
            if item[0] == 're':
                r = item[1]
                if 5 <= r.width <= 30 and 5 <= r.height <= 30:
                    cb_list.append({
                        'cx': (r.x0 + r.x1) / 2,
                        'cy': (r.y0 + r.y1) / 2,
                        'x' : round(r.x0, 1),
                        'y' : round(page_h_pt - r.y1, 1),
                        'w' : round(r.width,  1),
                        'h' : round(r.height, 1),
                    })

    if not cb_list:
        return []

    labeled = []
    for cb in cb_list:
        near = [s for s in spans
                if abs(s['ymid'] - cb['cy']) < 12
                and s['x0'] >= cb['cx'] - 8
                and s['x0'] <= cb['cx'] + 70]
        if not near:
            continue
        closest = min(near, key=lambda s: abs(s['x0'] - cb['cx']))
        labeled.append({**cb, 'option_text': closest['text']})

    if not labeled:
        return []

    labeled.sort(key=lambda b: b['cy'])
    groups, cur = [], [labeled[0]]
    for b in labeled[1:]:
        if abs(b['cy'] - cur[0]['cy']) <= 12:
            cur.append(b)
        else:
            if len(cur) >= 2:
                groups.append(cur)
            cur = [b]
    if len(cur) >= 2:
        groups.append(cur)

    result = []
    for group in groups:
        first = min(group, key=lambda b: b['cx'])
        left_spans = [s for s in spans
                      if abs(s['ymid'] - first['cy']) < 10
                      and s['x1'] <= first['cx'] + 5]
        group_label = left_spans[-1]['text'].rstrip(':').strip() if left_spans else ''
        result.append({
            'label'  : group_label,
            'options': [{
                'text': b['option_text'],
                'x': b['x'], 'y': b['y'],
                'w': b['w'], 'h': b['h'],
            } for b in group],
        })

    return result


# ════════════════════════════════════════════════════════════════════════════════
# PASS 0  —  AcroForm / interactive widget fields (highest priority)
# ════════════════════════════════════════════════════════════════════════════════
#
# Modern fillable PDFs (bank, insurance, government) embed field metadata as
# PDF widget annotations.  PyMuPDF exposes them via page.widgets().  Reading
# them directly is the most reliable approach — no image processing or OCR
# needed, and the label is the exact field name stored in the PDF.
#
# Strategy:
#  • Text / Multiline / ComboBox / ListBox  → text fields
#  • CheckBox / RadioButton                 → grouped into checkbox records
#    Radio buttons that share the same field_name form one checkbox group;
#    each button's "on" export value becomes one option.
#
# Returns (text_fields, checkbox_groups) using the same dict shape as passes 1-3
# so combine_passes / the filler can consume them without changes.

def pass0_acroform(page, page_h_pt):
    text_fields   = []
    cb_groups     = {}   # field_name → {label, options:[{text,x,y,w,h}]}

    try:
        widgets = list(page.widgets())
    except Exception:
        return [], []

    if not widgets:
        return [], []

    _TEXT_TYPES  = {'Text', 'Multiline', 'ComboBox', 'ListBox'}
    _BTN_TYPES   = {'CheckBox', 'RadioButton'}

    for widget in widgets:
        try:
            ftype = widget.field_type_string or ''
            # Prefer field_label (tooltip) over field_name; both may be None
            fname = (
                getattr(widget, 'field_label', None)
                or widget.field_name
                or ''
            ).strip()
            if not fname:
                continue
            # Skip push-buttons (Submit, Reset etc.) — not data fields
            if ftype == 'PushButton':
                continue

            rect = widget.rect

            if ftype in _TEXT_TYPES:
                text_fields.append({
                    'label'     : fname,
                    'x'         : round(rect.x0, 1),
                    'y'         : round(page_h_pt - rect.y1, 1),
                    'box_width' : 0,
                    'max_chars' : max(1, int(rect.width / CHAR_WIDTH_PT)),
                    'type'      : 'free_text',
                    'line_end_x': round(rect.x1, 1),
                    'acroform'  : True,
                })

            elif ftype in _BTN_TYPES:
                # Use the raw field_name as the group key (radio buttons share it)
                group_key = (widget.field_name or fname).strip()
                if group_key not in cb_groups:
                    cb_groups[group_key] = {
                        'label'  : fname,
                        'options': [],
                    }
                # Retrieve the "on" export value — the human-readable option text
                try:
                    states = widget.button_states()           # {'on': 'Male', 'off': 'Off'}
                    opt_text = (states or {}).get('on', '') or group_key
                except Exception:
                    opt_text = group_key

                cb_groups[group_key]['options'].append({
                    'text': opt_text,
                    'x'   : round(rect.x0, 1),
                    'y'   : round(page_h_pt - rect.y1, 1),
                    'w'   : round(rect.width,  1),
                    'h'   : round(rect.height, 1),
                })
        except Exception:
            continue

    # Only keep checkbox groups with ≥ 1 option (standalone checkboxes kept too)
    checkboxes = list(cb_groups.values())
    return text_fields, checkboxes


# ════════════════════════════════════════════════════════════════════════════════
# Combine passes
# ════════════════════════════════════════════════════════════════════════════════

def _y_overlap(fields, y, tol=8):
    return any(abs(f['y'] - y) < tol for f in fields)


def combine_passes(p1, p2, p3):
    combined = list(p1)

    for f in p2:
        if not _y_overlap(combined, f['y']):
            combined.append(f)

    for f in p3:
        if not _y_overlap(combined, f['y']):
            combined.append(f)

    return combined


# ════════════════════════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════════════════════════

def main():
    # fitz (PyMuPDF) is required for everything — AcroForm + visual passes
    try:
        __import__('fitz')
    except ImportError:
        print(json.dumps({'error': 'PyMuPDF not installed. Run: pip install pymupdf'}))
        sys.exit(1)

    # cv2 / pytesseract / numpy are only needed for visual passes 1-3.
    # If they're missing, Pass 0 (AcroForm) still runs — warn but don't abort.
    _vision_missing = []
    for mod, pkg in [('cv2','opencv-python'),('pytesseract','pytesseract'),('numpy','numpy')]:
        try: __import__(mod)
        except ImportError: _vision_missing.append(pkg)
    if _vision_missing:
        sys.stderr.write(
            f'[warn] Visual passes (1-3) disabled — missing: {", ".join(_vision_missing)}. '
            f'Run: pip install {" ".join(_vision_missing)}\n'
        )

    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: python detect_form_fields.py <pdf_path>'}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    debug    = os.environ.get('SAVE_DEBUG_IMG') == '1'

    try:
        import fitz

        doc        = fitz.open(pdf_path)
        all_fields = []
        all_cbs    = []
        page_sizes = []

        for page_idx in range(len(doc)):
            page       = doc[page_idx]
            pw, ph     = page.rect.width, page.rect.height
            page_sizes.append({'width': round(pw, 1), 'height': round(ph, 1)})

            # ── Pass 0: AcroForm interactive fields (highest priority) ─────────
            # Most modern fillable PDFs store field metadata as widget annotations.
            # Reading them directly is more accurate than any visual/OCR method.
            p0_fields, p0_cbs = pass0_acroform(page, ph)

            if p0_fields or p0_cbs:
                # AcroForm data found — tag with page info and skip visual passes
                # (running vision passes on an AcroForm PDF returns noise / duplicates)
                for f in p0_fields:
                    f['page'] = page_idx
                    f['page_height'] = round(ph, 1)
                for c in p0_cbs:
                    c['page'] = page_idx
                    c['page_height'] = round(ph, 1)
                all_fields.extend(p0_fields)
                all_cbs.extend(p0_cbs)
                if debug:
                    sys.stderr.write(
                        f'[debug] page={page_idx} AcroForm: '
                        f'fields={len(p0_fields)} cb_groups={len(p0_cbs)}\n'
                    )
                continue   # ← skip passes 1-3 for this page

            # ── Passes 1-3: visual / vector detection (no AcroForm metadata) ───
            p1 = p2 = p3 = []
            checkboxes = []

            try:
                import cv2, numpy as _np  # noqa — just checking availability
                # Render to numpy for Pass 1 (vision-based grid detection)
                pix = page.get_pixmap(
                    matrix=fitz.Matrix(SCALE, SCALE), colorspace=fitz.csRGB, alpha=False
                )
                img = np.frombuffer(pix.samples, dtype='uint8').reshape(pix.height, pix.width, 3)
                p1 = pass1_detect(img, pw, ph)
            except Exception:
                pass   # cv2/numpy unavailable or pass failed — skip

            try:
                p2 = pass2_detect(page, ph)
                p3 = pass3_detect(page, ph)
                checkboxes = detect_checkboxes(page, ph)
            except Exception:
                pass

            combined   = combine_passes(p1, p2, p3)

            # Tag every result with its page index and page height (needed by filler)
            for f in combined:
                f['page'] = page_idx
                f['page_height'] = round(ph, 1)
            for c in checkboxes:
                c['page'] = page_idx
                c['page_height'] = round(ph, 1)

            all_fields.extend(combined)
            all_cbs.extend(checkboxes)

            if debug:
                sys.stderr.write(
                    f'[debug] page={page_idx} p1={len(p1)} p2={len(p2)} '
                    f'p3={len(p3)} combined={len(combined)} cb={len(checkboxes)}\n'
                )

        doc.close()

        first = page_sizes[0] if page_sizes else {'width': 595.0, 'height': 842.0}

        print(json.dumps({
            'page_size' : first,          # kept for backward compat
            'page_sizes': page_sizes,     # per-page sizes
            'fields'    : all_fields,
            'checkboxes': all_cbs,
        }))

    except Exception as exc:
        print(json.dumps({'error': str(exc), 'trace': traceback.format_exc()}))
        sys.exit(1)


if __name__ == '__main__':
    main()
