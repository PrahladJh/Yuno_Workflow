"""
PDF Form Field Detector tool — wraps detect_form_fields.py (tri-pass detection).
Detects box-grid fields, drawn-underline fields, text-underscore fields, and checkboxes.
"""
import subprocess
import sys
import json
import os
from pathlib import Path
from langchain_core.tools import tool

SCRIPT_PATH = Path(__file__).parent.parent.parent / "scripts" / "detect_form_fields.py"


@tool
def detect_pdf_form_fields(pdf_path: str) -> str:
    """
    Analyze a PDF file and detect all form fields and checkboxes across ALL pages.
    Works with any PDF — box-grid (bank/government forms), drawn underlines,
    text underscore placeholders, checkboxes, and multi-page documents.

    pdf_path: absolute or relative path to the PDF file.

    Returns a summary of detected fields plus raw JSON with:
      - page_size / page_sizes: dimensions per page
      - fields: [{label, x, y, box_width, max_chars, type, page, page_height}]
        type = 'box_grid' (char-by-char boxes) or 'free_text' (underline/underscore)
      - checkboxes: [{label, options:[{text,x,y,w,h}], page, page_height}]

    Use fill_pdf_form after this to fill the detected fields with your data.
    """
    if not SCRIPT_PATH.exists():
        return f"Detection script not found at {SCRIPT_PATH}"

    pdf = Path(pdf_path)
    if not pdf.exists():
        return f"PDF file not found: {pdf_path}"

    try:
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), str(pdf.resolve())],
            capture_output=True, text=True, timeout=120
        )

        if result.returncode != 0 and not result.stdout:
            return f"Detection failed:\n{result.stderr}"

        # Parse JSON output
        data = json.loads(result.stdout)

        if "error" in data:
            return f"Detection error: {data['error']}"

        fields = data.get("fields", [])
        checkboxes = data.get("checkboxes", [])
        page = data.get("page_size", {})

        summary = [
            f"✅ PDF Analysis Complete",
            f"Page size: {page.get('width', '?')} × {page.get('height', '?')} pts",
            f"Form fields detected: {len(fields)}",
            f"Checkbox groups detected: {len(checkboxes)}",
            "",
            "FIELDS:",
        ]

        for i, f in enumerate(fields, 1):
            field_type = f.get("type", "unknown")
            label = f.get("label", "(no label)")
            chars = f.get("max_chars", "?")
            x, y  = f.get("x", 0), f.get("y", 0)
            pg    = f.get("page", 0)
            summary.append(
                f"  {i}. [p{pg+1}][{field_type}] '{label}' — {chars} chars at ({x}, {y})"
            )

        if checkboxes:
            summary.append("\nCHECKBOXES:")
            for cb in checkboxes:
                opts = [o["text"] for o in cb.get("options", [])]
                summary.append(f"  • {cb.get('label', '(no label)')}: {' | '.join(opts)}")

        summary.append("\nRAW JSON:")
        summary.append(result.stdout)

        return "\n".join(summary)

    except subprocess.TimeoutExpired:
        return "Detection timed out (>120s). The PDF may be too large or complex."
    except json.JSONDecodeError as e:
        return f"Failed to parse detection output:\n{result.stdout[:500]}\nError: {e}"
    except Exception as e:
        return f"Unexpected error: {e}"
