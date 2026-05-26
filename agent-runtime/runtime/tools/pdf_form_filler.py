"""
PDF Form Filler
===============
Receives user_data as JSON with keys = exact labels from /pdf/detect-fields.
No AI re-mapping at fill time — labels are already matched by the UI flow.

Detection cascade (for finding fill coordinates):
  1. Geometry script  — AcroForm widgets, drawn underlines, box-grids
  2. GPT-4o Vision    — renders page as image; GPT returns fill (x,y) %
  3. OCR.space        — text fallback if vision unavailable

Fill methods:
  • AcroForm widgets  → widget.field_value API
  • Geometry fields   → insert_text at detected coordinates
  • Flat/vision fields → insert_text at vision-supplied coordinates
  • Checkboxes        → draw vector X at detected position

Requires: pymupdf (pip install pymupdf)
"""
import os
import re
import sys
import json
import subprocess
import base64
from pathlib import Path
from langchain_core.tools import tool

SCRIPT_PATH = Path(__file__).parent.parent.parent / "scripts" / "detect_form_fields.py"
UPLOADS_DIR = Path(__file__).parent.parent.parent / "workspace" / "uploads"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _find_field(label: str, det_list: list) -> dict | None:
    """
    Find a detected field/checkbox by label.
    Priority: exact match → normalized exact → substring.
    """
    nl = _norm(label)
    # 1. Exact
    for f in det_list:
        if f.get("label") == label:
            return f
    # 2. Normalized exact
    for f in det_list:
        if _norm(f.get("label", "")) == nl:
            return f
    # 3. Substring (handles minor label drift between detection and fill)
    for f in det_list:
        nf = _norm(f.get("label", ""))
        if nl and (nl in nf or nf in nl):
            return f
    return None


def _fitz_y_from_bottom(y_bottom: float, page_height: float) -> float:
    return page_height - y_bottom


def _draw_x_mark(page, ox: float, oy_top: float, ow: float, oh: float):
    """Draw a vector X inside a checkbox box."""
    try:
        import fitz
        pad = min(ow, oh) * 0.18
        lw  = max(1.0, min(ow, oh) * 0.13)
        shp = page.new_shape()
        shp.draw_line(fitz.Point(ox + pad,      oy_top + pad),
                      fitz.Point(ox + ow - pad, oy_top + oh - pad))
        shp.draw_line(fitz.Point(ox + ow - pad, oy_top + pad),
                      fitz.Point(ox + pad,       oy_top + oh - pad))
        shp.finish(color=(0, 0, 0), width=lw, closePath=False)
        shp.commit()
    except Exception:
        try:
            import fitz
            pad = min(ow, oh) * 0.25
            page.draw_rect(
                fitz.Rect(ox + pad, oy_top + pad, ox + ow - pad, oy_top + oh - pad),
                color=(0, 0, 0), fill=(0, 0, 0),
            )
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# Detection method 1 — Geometry script
# ─────────────────────────────────────────────────────────────────────────────

def _detect_geometry(pdf_path: str) -> dict:
    result = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), pdf_path],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0 and not result.stdout.strip():
        raise RuntimeError(result.stderr[:500])
    return json.loads(result.stdout)


# ─────────────────────────────────────────────────────────────────────────────
# Detection method 2 — GPT-4o Vision  (flat / scanned PDFs)
# ─────────────────────────────────────────────────────────────────────────────

_VISION_PROMPT = """You are analyzing an image of a printed/scanned form PDF page.

Identify EVERY form field where a person writes or selects information.

Return a JSON array only (no markdown, no explanation):

Text fields:
{"label": "<exact label text>", "type": "text",
 "fill_x": <x% — start of blank writing area, NOT on the label>,
 "fill_y": <y% — baseline of the writing line>}

Checkbox/radio groups:
{"label": "<group label>", "type": "checkbox",
 "options": [{"text": "<option>", "x": <center-x%>, "y": <center-y%>}, ...]}

Rules:
- fill_x/fill_y must point INSIDE the blank area (after colon, on the underline, etc.)
- For multi-column forms: each column's fill coords are independent
- x=0 left edge, x=100 right edge; y=0 top, y=100 bottom
- Include ALL fields including small ones (age, pin, date, city, etc.)
- Skip headings, instructions, footers"""


def _render_page_b64(pdf_path: str, page_idx: int, zoom: float = 2.0) -> tuple[str, float, float]:
    import fitz
    doc  = fitz.open(pdf_path)
    page = doc[page_idx]
    pw, ph = page.rect.width, page.rect.height
    pix  = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csGRAY)
    img  = base64.b64encode(pix.tobytes("png")).decode()
    doc.close()
    return img, pw, ph


def _detect_via_vision(pdf_path: str) -> tuple[list, list]:
    gpt_key = os.getenv("OPENAI_API_KEY", "")
    if not gpt_key:
        return [], []
    try:
        import fitz                              # noqa
        from langchain_openai import ChatOpenAI
    except ImportError:
        return [], []

    model = ChatOpenAI(model="gpt-4o", api_key=gpt_key, temperature=0, max_tokens=4000)

    try:
        n_pages = fitz.open(pdf_path).page_count
    except Exception:
        n_pages = 1

    all_fields:     list[dict] = []
    all_checkboxes: list[dict] = []
    seen:           set[str]   = set()

    for page_idx in range(min(n_pages, 4)):
        try:
            img_b64, pw, ph = _render_page_b64(pdf_path, page_idx)
        except Exception:
            continue
        try:
            resp = model.invoke([{
                "role": "user",
                "content": [
                    {"type": "image_url",
                     "image_url": {"url": f"data:image/png;base64,{img_b64}", "detail": "high"}},
                    {"type": "text", "text": _VISION_PROMPT},
                ],
            }])
            raw = resp.content.strip()
            if raw.startswith("```"):
                raw = re.sub(r"^```[a-z]*\n?", "", raw)
                raw = re.sub(r"\n?```$",        "", raw)
            items = json.loads(raw)
        except Exception:
            continue

        for item in items:
            label = (item.get("label") or "").strip()
            if not label or label in seen:
                continue
            seen.add(label)

            if (item.get("type") or "text").lower() == "checkbox":
                opts = []
                for opt in item.get("options", []):
                    cx = (float(opt.get("x", 0)) / 100) * pw
                    cy = (float(opt.get("y", 0)) / 100) * ph
                    bs = 10.0
                    opts.append({
                        "text":     (opt.get("text") or "").strip(),
                        "x":        cx - bs / 2,
                        "y":        cy - bs / 2,   # fitz: from top
                        "w":        bs, "h": bs,
                        "ocr_flat": True,
                    })
                if opts:
                    all_checkboxes.append({
                        "label": label, "options": opts,
                        "page": page_idx, "page_height": ph,
                    })
            else:
                fx = (float(item.get("fill_x", 0)) / 100) * pw
                fy = (float(item.get("fill_y", 0)) / 100) * ph
                all_fields.append({
                    "label":       label,
                    "type":        "free_text",
                    "x":           fx,
                    "y":           fy,            # fitz: from top
                    "line_end_x":  pw - 10,
                    "max_chars":   max(1, int((pw - fx - 10) / 5.5)),
                    "page":        page_idx,
                    "page_height": ph,
                    "ocr_flat":    True,
                })

    return all_fields, all_checkboxes


# ─────────────────────────────────────────────────────────────────────────────
# Detection method 3 — OCR.space text fallback
# ─────────────────────────────────────────────────────────────────────────────

def _detect_via_ocr(pdf_path: str, pdf_w: float, pdf_h: float) -> tuple[list, list]:
    try:
        import requests as _req
        from langchain_openai import ChatOpenAI
    except ImportError:
        return [], []

    ocr_key = os.getenv("OCR_SPACE_API_KEY", "")
    gpt_key = os.getenv("OPENAI_API_KEY", "")
    if not ocr_key or not gpt_key:
        return [], []

    # Two-call strategy (mirrors /pdf/detect-fields in main.py):
    #   Call A: Engine 2 (no overlay) — best text quality for GPT label extraction
    #   Call B: Engine 1 (overlay=true) — word bounding boxes for coordinates
    #   (Engine 2 does NOT support overlay; Engine 1 is the classic engine that does)
    raw_text  = ""
    all_words: list[dict] = []

    pdf_bytes = Path(pdf_path).read_bytes()
    pdf_name  = Path(pdf_path).name

    # Call A — labels
    try:
        resp_a = _req.post(
            "https://api.ocr.space/parse/image",
            files={"file": (pdf_name, pdf_bytes, "application/pdf")},
            data={
                "apikey": ocr_key, "language": "eng", "OCREngine": "2",
                "isOverlayRequired": "false", "detectOrientation": "true",
                "scale": "true", "isTable": "true",
            },
            timeout=60,
        )
        for parsed in resp_a.json().get("ParsedResults", []):
            raw_text += parsed.get("ParsedText", "") + "\n"
    except Exception:
        pass

    # Call B — word bounding boxes
    try:
        resp_b = _req.post(
            "https://api.ocr.space/parse/image",
            files={"file": (pdf_name, pdf_bytes, "application/pdf")},
            data={
                "apikey": ocr_key, "language": "eng", "OCREngine": "1",
                "isOverlayRequired": "true", "detectOrientation": "true",
                "scale": "true",
            },
            timeout=60,
        )
        for parsed in resp_b.json().get("ParsedResults", []):
            overlay = parsed.get("TextOverlay", {})
            img_w   = overlay.get("OriginalPageWidth",  1240) or 1240
            img_h   = overlay.get("OriginalPageHeight", 1754) or 1754
            sx, sy  = pdf_w / img_w, pdf_h / img_h
            for line in overlay.get("Lines", []):
                for word in line.get("Words", []):
                    wt = (word.get("WordText") or "").strip()
                    if not wt:
                        continue
                    wl  = float(word.get("Left",   0))
                    wtp = float(word.get("Top",    0))
                    ww  = float(word.get("Width",  30))
                    wh  = float(word.get("Height", 12))
                    all_words.append({
                        "text":      wt,
                        "left_pt":   wl        * sx,
                        "top_pt":    wtp       * sy,
                        "right_pt":  (wl + ww) * sx,
                        "bottom_pt": (wtp + wh) * sy,
                    })
    except Exception:
        pass

    if not raw_text.strip():
        return [], []

    # GPT: extract field labels from raw OCR text
    try:
        model = ChatOpenAI(model="gpt-4o-mini", api_key=gpt_key, temperature=0)
        r = model.invoke([{"role": "user", "content":
            f"Extract every FORM FIELD label from this OCR text. "
            f"Text fields → one per line. Checkboxes → CHECKBOX: Group | Opt1 | Opt2. "
            f"No headings, no duplicates.\n\n{raw_text[:3500]}"}])
        gpt_lines = r.content.strip().split("\n")
    except Exception:
        return [], []

    def _phrase_bbox(phrase: str) -> dict | None:
        np2 = _norm(phrase)
        if not np2:
            return None
        nw = [_norm(w["text"]) for w in all_words]
        best_score, best_bb = 0.0, None
        for i in range(len(all_words)):
            running = ""
            for j in range(i, min(i + 10, len(all_words))):
                running += nw[j]
                # Only fire when the full phrase is covered by the window
                if np2 in running:
                    score = len(np2) / len(running)  # 1.0 for exact
                    if score > best_score:
                        best_score = score
                        best_bb = {
                            "left_pt":   min(all_words[k]["left_pt"]   for k in range(i, j+1)),
                            "top_pt":    min(all_words[k]["top_pt"]    for k in range(i, j+1)),
                            "right_pt":  max(all_words[k]["right_pt"]  for k in range(i, j+1)),
                            "bottom_pt": max(all_words[k]["bottom_pt"] for k in range(i, j+1)),
                        }
                    break   # extending further only lowers the score
        return best_bb

    fields:     list[dict] = []
    checkboxes: list[dict] = []
    seen:       set[str]   = set()

    for line in gpt_lines:
        line = line.strip(" -•*")
        if not line:
            continue
        if line.upper().startswith("CHECKBOX:"):
            parts = [p.strip() for p in line[9:].split("|") if p.strip()]
            if len(parts) < 2 or parts[0] in seen:
                continue
            seen.add(parts[0])
            opts = []
            for opt_t in parts[1:]:
                bb = _phrase_bbox(opt_t)
                if bb:
                    oh = bb["bottom_pt"] - bb["top_pt"]
                    bs = max(oh, 8.0)
                    opts.append({
                        "text": opt_t,
                        "x": max(0.0, bb["left_pt"] - bs - 3),
                        "y": bb["top_pt"], "w": bs, "h": bs,
                        "ocr_flat": True,
                    })
            if opts:
                checkboxes.append({"label": parts[0], "options": opts,
                                   "page": 0, "page_height": pdf_h})
        elif line not in seen and len(line) <= 80:
            seen.add(line)
            bb = _phrase_bbox(line)
            if bb:
                lh  = bb["bottom_pt"] - bb["top_pt"]
                gap = 20.0   # accounts for colon + space before fill box
                fx  = bb["right_pt"] + gap
                fy  = bb["top_pt"] + lh * 0.75
                fields.append({
                    "label": line, "type": "free_text",
                    "x": fx, "y": fy,
                    "line_end_x": pdf_w - 10,
                    "max_chars": max(1, int((pdf_w - fx - 10) / 6.0)),
                    "page": 0, "page_height": pdf_h, "ocr_flat": True,
                })

    return fields, checkboxes


# ─────────────────────────────────────────────────────────────────────────────
# Main tool
# ─────────────────────────────────────────────────────────────────────────────

@tool
def fill_pdf_form(pdf_path: str, user_data: str, output_filename: str = "") -> str:
    """
    Fill a PDF form with data the user already provided against detected labels.

    user_data MUST be a JSON object whose keys are the EXACT labels returned by
    detect_pdf_form_fields / /pdf/detect-fields — e.g.:
        {"Name of Patient": "Prahlad Jha", "Gender": "Male", "Age": "27"}

    No AI re-mapping is performed at fill time because the labels are already
    matched by the UI flow that collected the data.

    pdf_path        : absolute path to the blank / template PDF.
    user_data       : JSON string with {label: value} pairs.
    output_filename : optional output name (auto-generated if blank).

    Returns path to the filled PDF with a DOWNLOAD_PATH tag.
    """
    try:
        import fitz
    except ImportError:
        return "PyMuPDF not installed. Run: pip install pymupdf"

    pdf = Path(pdf_path)
    if not pdf.exists():
        return f"PDF not found: {pdf_path}"

    # ── Parse user data ───────────────────────────────────────────────────────
    try:
        fill_data: dict = json.loads(user_data)
    except Exception:
        return "user_data must be a valid JSON object: {\"Label\": \"value\", ...}"

    if not isinstance(fill_data, dict) or not fill_data:
        return "user_data JSON must be a non-empty object."

    # ── Get page dimensions ───────────────────────────────────────────────────
    try:
        _d    = fitz.open(str(pdf.resolve()))
        pdf_w = _d[0].rect.width
        pdf_h = _d[0].rect.height
        _d.close()
    except Exception:
        pdf_w, pdf_h = 595.0, 842.0

    # ── Detection cascade ─────────────────────────────────────────────────────
    # Priority 0: Read the cache written by /pdf/detect-fields.
    #   This guarantees the exact same labels the user saw in the UI — no mismatches.
    det_fields: list[dict] = []
    det_cbs:    list[dict] = []
    first_ph    = pdf_h
    det_mode    = "none"

    cache_path = Path(str(pdf.resolve()) + ".yuno_fields.json")
    if cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            det_fields = cached.get("fields",     [])
            det_cbs    = cached.get("checkboxes", [])
            first_ph   = cached.get("page_size",  {}).get("height", pdf_h)
            if det_fields or det_cbs:
                det_mode = f"cached({cached.get('source','?')})"
        except Exception:
            pass

    # Fallback 1: Geometry (AcroForm + vector geometry)
    if det_mode == "none" and SCRIPT_PATH.exists():
        try:
            geo = _detect_geometry(str(pdf.resolve()))
            if not geo.get("error"):
                det_fields = geo.get("fields",     [])
                det_cbs    = geo.get("checkboxes", [])
                first_ph   = geo.get("page_size",  {}).get("height", pdf_h)
                if det_fields or det_cbs:
                    det_mode = "geometry"
        except Exception:
            pass

    # Fallback 2: GPT-4o Vision (flat / scanned PDFs)
    if det_mode == "none":
        try:
            det_fields, det_cbs = _detect_via_vision(str(pdf.resolve()))
            if det_fields or det_cbs:
                det_mode = "vision"
        except Exception:
            pass

    # Fallback 3: OCR.space text
    if det_mode == "none":
        try:
            det_fields, det_cbs = _detect_via_ocr(str(pdf.resolve()), pdf_w, pdf_h)
            if det_fields or det_cbs:
                det_mode = "ocr"
        except Exception:
            pass

    if det_mode == "none":
        return (
            "No form fields detected. Upload the PDF through the UI first so "
            "/pdf/detect-fields can build the field cache, then run fill again."
        )

    # ── Open PDF for writing ──────────────────────────────────────────────────
    doc            = fitz.open(str(pdf.resolve()))
    filled_fields: list[str] = []
    skipped:       list[str] = []
    acroform_done: set[str]  = set()

    # ── Pass 0: AcroForm widgets ──────────────────────────────────────────────
    # Always try widget-based fill first — works for any fillable PDF regardless
    # of which detection method was used.
    if True:
        for page_idx, page in enumerate(doc):
            try:
                widgets = list(page.widgets())
            except Exception:
                continue
            for widget in widgets:
                wt = widget.field_type
                if wt == fitz.PDF_WIDGET_TYPE_BUTTON:
                    continue
                w_name  = (widget.field_name  or "").strip()
                w_label = (getattr(widget, "field_label", None) or w_name).strip()

                # Find which user-data key matches this widget
                matched_key = None
                for user_label in fill_data:
                    if (user_label == w_label or user_label == w_name
                            or _norm(user_label) == _norm(w_label)
                            or _norm(user_label) == _norm(w_name)):
                        matched_key = user_label
                        break
                if not matched_key:
                    # Substring fallback
                    nu = {_norm(k): k for k in fill_data}
                    for nk, orig_k in nu.items():
                        nl = _norm(w_label)
                        nn = _norm(w_name)
                        if nk and (nk in nl or nl in nk or nk in nn or nn in nk):
                            matched_key = orig_k
                            break

                if not matched_key:
                    continue

                val = str(fill_data[matched_key])
                try:
                    if wt == fitz.PDF_WIDGET_TYPE_TEXT:
                        widget.field_value = val
                        widget.update()
                        filled_fields.append(f'"{matched_key}" ← "{val}" (widget)')
                        acroform_done.add(matched_key)

                    elif wt == fitz.PDF_WIDGET_TYPE_CHECKBOX:
                        try:
                            st      = widget.button_states() or {}
                            on_name = st.get("on", "Yes") or "Yes"
                        except Exception:
                            on_name = "Yes"
                        is_on = val.lower() in (
                            "yes", "true", "1", "on", "checked", on_name.lower()
                        )
                        widget.field_value = on_name if is_on else "Off"
                        widget.update()
                        filled_fields.append(
                            f'"{matched_key}" [{"X" if is_on else " "}] (widget checkbox)'
                        )
                        acroform_done.add(matched_key)

                    elif wt == fitz.PDF_WIDGET_TYPE_RADIOBUTTON:
                        try:
                            st      = widget.button_states() or {}
                            on_name = st.get("on", val) or val
                        except Exception:
                            on_name = val
                        if _norm(on_name) == _norm(val) or _norm(val) in _norm(on_name):
                            widget.field_value = on_name
                            widget.update()
                            filled_fields.append(
                                f'"{matched_key}" ← "{val}" (widget radio)'
                            )
                            acroform_done.add(matched_key)

                    elif wt in (fitz.PDF_WIDGET_TYPE_COMBOBOX, fitz.PDF_WIDGET_TYPE_LISTBOX):
                        widget.field_value = val
                        widget.update()
                        filled_fields.append(f'"{matched_key}" ← "{val}" (widget combo)')
                        acroform_done.add(matched_key)

                except Exception as exc:
                    skipped.append(f'"{matched_key}" widget error: {exc}')

    # ── Pass 1-3: Coordinate-based fill (geometry + vision + OCR) ────────────
    for user_label, value in fill_data.items():
        if user_label in acroform_done:
            continue
        value = str(value)

        # ── Text field ────────────────────────────────────────────────────────
        mf = _find_field(user_label, det_fields)
        if mf:
            # Guard: skip fields that were cached without position data
            if mf.get("no_pos") or ("x" not in mf and not mf.get("acroform")):
                skipped.append(
                    f'"{user_label}" — label detected but fill coordinates missing '
                    f'(OCR overlay may not have returned word positions)'
                )
                continue

            page_idx = mf.get("page", 0)
            target   = doc[page_idx] if page_idx < len(doc) else doc[0]

            if mf.get("ocr_flat"):
                # OCR/cached mode: x,y already in fitz coords (from top)
                fx = float(mf.get("x", 0))
                fy = float(mf.get("y", 0))
                fs = 9.5
            else:
                # Geometry mode: y stored from bottom → flip
                ph = mf.get("page_height", first_ph)
                fx = float(mf.get("x", 0))
                fy = _fitz_y_from_bottom(float(mf.get("y", 0)), ph) + 2.5
                fs = 10.0

            if mf.get("type") == "box_grid" and not mf.get("ocr_flat"):
                bw  = mf.get("box_width", 10.0)
                fsb = max(6.0, min(14.0, bw * 0.65))
                mc  = mf.get("max_chars", 100)
                for i, ch in enumerate(value[:mc]):
                    target.insert_text(
                        (fx + i * bw + bw * 0.18, fy), ch,
                        fontname="helv", fontsize=fsb, color=(0, 0, 0),
                    )
            else:
                mc = mf.get("max_chars", 80)
                target.insert_text(
                    (fx, fy), value[:mc],
                    fontname="helv", fontsize=fs, color=(0, 0, 0),
                )
            filled_fields.append(f'"{user_label}" ← "{value}" [{det_mode}]')
            continue

        # ── Checkbox / radio group ────────────────────────────────────────────
        mc_cb = _find_field(user_label, det_cbs)
        if mc_cb:
            opts   = mc_cb.get("options", [])
            # Find the chosen option by matching user's value to option text
            chosen = next((o for o in opts if _norm(o["text"]) == _norm(value)), None)
            if not chosen:
                chosen = next(
                    (o for o in opts
                     if _norm(value) in _norm(o["text"])
                     or _norm(o["text"]) in _norm(value)),
                    None,
                )
            if not chosen:
                skipped.append(
                    f'"{user_label}": option "{value}" not found '
                    f'(available: {[o["text"] for o in opts]})'
                )
                continue

            # Guard: skip if option has no coordinates
            if "x" not in chosen or "y" not in chosen:
                skipped.append(
                    f'"{user_label}" [{chosen["text"]}] — no checkbox coordinates in cache'
                )
                continue

            page_idx = mc_cb.get("page", 0)
            target   = doc[page_idx] if page_idx < len(doc) else doc[0]
            ox = float(chosen["x"])
            ow = float(chosen.get("w", 10.0))
            oh = float(chosen.get("h", 10.0))

            if chosen.get("ocr_flat"):
                oy_top = float(chosen["y"])           # fitz: from top
            else:
                ph     = mc_cb.get("page_height", first_ph)
                oy_top = ph - float(chosen["y"]) - oh  # flip from bottom

            _draw_x_mark(target, ox, oy_top, ow, oh)
            filled_fields.append(f'"{user_label}" [X] "{chosen["text"]}" [{det_mode}]')
            continue

        skipped.append(f'"{user_label}" — not found in detected fields')

    # ── Save ──────────────────────────────────────────────────────────────────
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    out_name = output_filename.strip() or f"filled_{pdf.name}"
    if not out_name.lower().endswith(".pdf"):
        out_name += ".pdf"
    out_path = UPLOADS_DIR / out_name
    doc.save(str(out_path), garbage=4, deflate=True, clean=True)
    doc.close()

    # ── Summary ───────────────────────────────────────────────────────────────
    fills_txt = "\n".join(f"  {f}" for f in filled_fields) or "  (none)"
    skip_txt  = (
        "\n\nSkipped:\n" + "\n".join(f"  ⚠ {s}" for s in skipped)
        if skipped else ""
    )
    return (
        f"✅ PDF filled! [mode: {det_mode}]\n"
        f"Fields filled : {len(filled_fields)} / {len(fill_data)}\n"
        f"Output file   : {out_path}\n"
        f"DOWNLOAD_PATH : {out_path}\n"
        f"\nFilled:\n{fills_txt}"
        f"{skip_txt}"
    )
