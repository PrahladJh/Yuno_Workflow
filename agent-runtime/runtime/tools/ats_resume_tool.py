import re
from collections import Counter
from pathlib import Path
from urllib.parse import unquote
from langchain_core.tools import tool

UPLOADS_DIR = Path(__file__).parent.parent.parent / "workspace" / "uploads"

STOPWORDS = {
    "and", "the", "for", "with", "you", "your", "are", "from", "that", "this",
    "will", "have", "has", "job", "role", "work", "team", "our", "their", "they",
    "into", "using", "use", "about", "can", "able", "within", "across", "such",
}


def _resolve_path(raw_path: str) -> Path:
    value = unquote((raw_path or "").strip()).replace("\\", "/")
    if value.startswith("file://"):
        value = value[7:]
    if len(value) >= 4 and value[0] == "/" and value[2] == ":" and value[3] == "/":
        value = value[1:]
    candidates = [Path(value), UPLOADS_DIR / Path(value).name]
    marker = "/workspace/uploads/"
    if marker in value:
        candidates.append(UPLOADS_DIR / value.split(marker, 1)[1])
    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()
    return candidates[0]


def _extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        import fitz
        doc = fitz.open(str(path))
        text = "\n".join(page.get_text("text") for page in doc)
        doc.close()
        return text
    if suffix == ".docx":
        from docx import Document
        doc = Document(str(path))
        return "\n".join(p.text for p in doc.paragraphs)
    return path.read_text(encoding="utf-8", errors="replace")


def _tokens(text: str) -> list[str]:
    return [
        w for w in re.findall(r"[a-zA-Z][a-zA-Z0-9+#.\-]{2,}", text.lower())
        if w not in STOPWORDS and not w.isdigit()
    ]


def _section_score(text: str) -> tuple[int, list[str]]:
    checks = {
        "contact details": r"@|phone|mobile|\+?\d[\d\s-]{8,}",
        "skills section": r"\bskills?\b|technical skills|core competencies",
        "experience section": r"\bexperience\b|employment|work history",
        "education section": r"\beducation\b|degree|university|college",
        "measurable achievements": r"\d+%|\$|\b\d+\s*(years|months|users|projects|clients)\b",
    }
    found = [name for name, pat in checks.items() if re.search(pat, text, flags=re.I)]
    return round(len(found) / len(checks) * 100), [name for name in checks if name not in found]


@tool
def calculate_ats_resume_score(resume_path: str, job_description: str = "") -> str:
    """
    Calculate an ATS-style resume match score.

    resume_path: uploaded resume path (.pdf, .docx, .txt).
    job_description: optional target job description. If provided, keyword match
                     is scored against it; otherwise only structure/readability
                     is scored.
    """
    path = _resolve_path(resume_path)
    if not path.exists():
        return f"Resume file not found: {resume_path}"

    try:
        text = _extract_text(path)
    except ImportError as e:
        return f"Missing dependency to read this resume type: {e}"
    except Exception as e:
        return f"Could not read resume: {e}"

    if not text.strip():
        return "Could not extract readable text from the resume."

    resume_words = set(_tokens(text))
    section_pct, missing_sections = _section_score(text)
    length_score = 100 if 350 <= len(text.split()) <= 1200 else 70

    keyword_pct = 70
    matched = []
    missing = []
    if job_description.strip():
        jd_counts = Counter(_tokens(job_description))
        important = [w for w, _ in jd_counts.most_common(35)]
        matched = [w for w in important if w in resume_words]
        missing = [w for w in important if w not in resume_words]
        keyword_pct = round((len(matched) / max(1, len(important))) * 100)

    score = round(keyword_pct * 0.55 + section_pct * 0.30 + length_score * 0.15)

    return (
        f"ATS Score: {score}/100\n"
        f"Keyword match: {keyword_pct}/100\n"
        f"Resume structure: {section_pct}/100\n"
        f"Length/readability: {length_score}/100\n\n"
        f"Matched keywords: {', '.join(matched[:20]) if matched else 'Provide a job description for keyword matching.'}\n"
        f"Missing keywords: {', '.join(missing[:20]) if missing else 'None detected or no job description provided.'}\n"
        f"Missing sections: {', '.join(missing_sections) if missing_sections else 'None'}\n\n"
        "Suggestions:\n"
        "- Add missing job-description keywords naturally where truthful.\n"
        "- Keep clear headings for Skills, Experience, Education, and Projects.\n"
        "- Use measurable impact bullets with numbers, scale, or outcomes."
    )
