from pathlib import Path
from urllib.parse import unquote
from langchain_core.tools import tool

UPLOADS_DIR = Path(__file__).parent.parent.parent / "workspace" / "uploads"


def _resolve_upload_path(raw_path: str) -> Path:
    value = unquote((raw_path or "").strip()).replace("\\", "/")
    if value.startswith("file://"):
        value = value[7:]
    if len(value) >= 4 and value[0] == "/" and value[2] == ":" and value[3] == "/":
        value = value[1:]

    candidates = [Path(value)]
    marker = "/workspace/uploads/"
    if marker in value:
        candidates.append(UPLOADS_DIR / value.split(marker, 1)[1])
    if value.startswith("workspace/uploads/"):
        candidates.append(UPLOADS_DIR / value.removeprefix("workspace/uploads/"))
    if value.startswith("/workspace/uploads/"):
        candidates.append(UPLOADS_DIR / value.removeprefix("/workspace/uploads/"))
    if value:
        candidates.append(UPLOADS_DIR / Path(value).name)

    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()
    return candidates[0]


@tool
def list_uploaded_files(folder: str = "") -> str:
    """
    List files uploaded into the runtime uploads workspace.

    folder: optional subfolder name/path inside uploads. Leave blank to list all
            uploaded files recursively.
    """
    root = _resolve_upload_path(folder) if folder else UPLOADS_DIR.resolve()
    allowed = UPLOADS_DIR.resolve()
    try:
        root.relative_to(allowed)
    except ValueError:
        return "Access denied: folder must be inside the uploads workspace."
    if not root.exists():
        return f"Folder not found: {folder}"

    files = [p for p in root.rglob("*") if p.is_file()]
    if not files:
        return f"No files found in {root}"

    lines = [f"Uploaded files in {root}:"]
    for p in files[:200]:
        rel = p.relative_to(allowed)
        lines.append(f"- {rel} ({p.stat().st_size} bytes)\n  PATH: {p}")
    if len(files) > 200:
        lines.append(f"...and {len(files) - 200} more files")
    return "\n".join(lines)


@tool
def read_uploaded_file(file_path: str, max_chars: int = 6000) -> str:
    """
    Read text from an uploaded TXT, CSV, JSON, PDF, or DOCX file.

    file_path: path returned by upload/list tools.
    max_chars: maximum characters to return.
    """
    path = _resolve_upload_path(file_path)
    allowed = UPLOADS_DIR.resolve()
    try:
        path.relative_to(allowed)
    except ValueError:
        return "Access denied: file must be inside the uploads workspace."
    if not path.exists() or not path.is_file():
        return f"File not found: {file_path}"

    suffix = path.suffix.lower()
    try:
        if suffix == ".pdf":
            import fitz
            doc = fitz.open(str(path))
            text = "\n".join(page.get_text("text") for page in doc)
            doc.close()
        elif suffix == ".docx":
            from docx import Document
            doc = Document(str(path))
            text = "\n".join(p.text for p in doc.paragraphs)
        else:
            text = path.read_text(encoding="utf-8", errors="replace")
    except ImportError as e:
        return f"Missing dependency for {suffix} files: {e}"
    except Exception as e:
        return f"Could not read file: {e}"

    return text[:max_chars]
