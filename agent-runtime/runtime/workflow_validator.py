"""
Workflow Input Validator
========================
Validates all collected user inputs against the tools each agent requires
BEFORE the workflow starts executing.  Returns a structured list of errors
so the UI can show exactly what is wrong and where.
"""
import re
import json


# ── Per-tool validation rules ─────────────────────────────────────────────────

def _validate_email_address(value: str) -> str | None:
    """Returns an error string if value is not a valid comma-separated email list."""
    pattern = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    for addr in [a.strip() for a in value.split(",") if a.strip()]:
        if not pattern.match(addr):
            return f"'{addr}' is not a valid email address."
    return None


def _validate_github_url(value: str) -> str | None:
    """Returns an error string if value is not a GitHub URL (loosely validated)."""
    if not value:
        return None  # optional field — handled separately
    if not re.match(r"https?://(www\.)?github\.com/[\w.\-]+/[\w.\-]+(\.git)?/?$", value):
        return f"'{value}' doesn't look like a valid GitHub repository URL (e.g. https://github.com/user/repo)."
    return None


def _validate_json_credentials(value: str) -> str | None:
    """Returns an error string if value is not valid service-account JSON."""
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, ValueError):
        return "Service Account JSON is not valid JSON — check for missing quotes or brackets."
    if parsed.get("type") != "service_account":
        return "JSON must be a Service Account key (\"type\": \"service_account\")."
    if not parsed.get("client_email"):
        return "Service Account JSON is missing 'client_email'."
    if not parsed.get("private_key"):
        return "Service Account JSON is missing 'private_key'."
    return None


def _validate_pdf_path(value: str) -> str | None:
    """Returns an error string if no PDF path is present."""
    if not value or not value.strip():
        return "A PDF file must be uploaded before running the PDF Analyzer."
    return None


# ── Tool → required fields + validators ──────────────────────────────────────

TOOL_VALIDATORS = {
    "pdf_analyzer": [
        {
            "key":     "pdf_path",
            "label":   "PDF File",
            "required": True,
            "fn":      _validate_pdf_path,
        },
        {
            "key":     "pdf_fill_data",
            "label":   "PDF Fill Data",
            "required": True,
            "fn":      lambda v: None if v and v.strip() else "Fill data is required — paste JSON key-values or plain text describing what to fill.",
        },
    ],
    "email": [
        {
            "key":     "recipient_emails",
            "label":   "Recipient Email(s)",
            "required": True,
            "fn":      lambda v: _validate_email_address(v) if v else "At least one recipient email is required.",
        },
    ],
    "web_search": [
        {
            "key":     "search_topic",
            "label":   "Search Topic",
            "required": True,
            "fn":      lambda v: None if v and v.strip() else "A search topic is required.",
        },
    ],
    "calculator": [
        {
            "key":     "goal",
            "label":   "Calculation Task",
            "required": True,
            "fn":      lambda v: None if v and v.strip() else "A calculation task or expression is required.",
        },
    ],
    "github": [
        {
            "key":     "github_task",
            "label":   "GitHub Task",
            "required": True,
            "fn":      lambda v: None if v and v.strip() else "Describe what the GitHub agent should do (e.g. 'Analyze code quality').",
        },
        {
            "key":     "github_repo",
            "label":   "Repository URL",
            "required": False,   # optional — task may contain the URL
            "fn":      _validate_github_url,
        },
    ],
    "sandbox_exec": [
        {
            "key":     "sandbox_task",
            "label":   "Sandbox Task",
            "required": True,
            "fn":      lambda v: None if v and v.strip() else "Describe or paste the code/task for the Python Sandbox.",
        },
    ],
    "google_calendar": [
        {
            "key":     "calendar_credentials",
            "label":   "Google Service Account JSON",
            "required": True,
            "fn":      _validate_json_credentials,
        },
        {
            "key":     "calendar_task",
            "label":   "Calendar Task",
            "required": True,
            "fn":      lambda v: None if v and v.strip() else "Describe the calendar operation (e.g. 'Show my meetings this week').",
        },
    ],
    "google_drive": [
        {
            "key":     "calendar_credentials",   # reuses same credential key
            "label":   "Google Service Account JSON",
            "required": True,
            "fn":      _validate_json_credentials,
        },
    ],
    "http_request": [],   # optional tool — no required inputs
    "code_executor": [
        {
            "key":     "code_task",
            "label":   "Code Task",
            "required": True,
            "fn":      lambda v: None if v and v.strip() else "Describe or paste the code to execute.",
        },
    ],
    "datetime":      [],   # autonomous — no inputs
    "folder_files":  [],   # file is uploaded via UI separately
    "ats_resume":    [],   # file is uploaded via UI separately
}


# ── Main validator ────────────────────────────────────────────────────────────

def validate_workflow_inputs(workflow: dict, collected: dict) -> list[dict]:
    """
    Validate all collected inputs against the tools used in the workflow.

    Returns a list of error dicts:
    [
      {
        "agent_name": "PDF Agent",
        "tool":       "pdf_analyzer",
        "field":      "pdf_fill_data",
        "label":      "PDF Fill Data",
        "message":    "Fill data is required..."
      },
      ...
    ]
    An empty list means all inputs are valid.
    """
    errors = []
    seen_keys: set[str] = set()   # avoid duplicate errors for shared keys (e.g. calendar creds)

    nodes = workflow.get("nodes", [])

    for node in nodes:
        cfg        = node.get("data", {}).get("agentConfig", {})
        agent_name = cfg.get("name", "Unknown Agent")
        tools      = cfg.get("tools", [])

        for tool_name in tools:
            rules = TOOL_VALIDATORS.get(tool_name, [])
            for rule in rules:
                key = rule["key"]
                if key in seen_keys:
                    continue                    # already validated (shared input key)
                seen_keys.add(key)

                value = collected.get(key, "")

                # Required field missing entirely
                if rule["required"] and not value:
                    errors.append({
                        "agent_name": agent_name,
                        "tool":       tool_name,
                        "field":      key,
                        "label":      rule["label"],
                        "message":    rule["fn"]("") or f"{rule['label']} is required.",
                    })
                    continue

                # Field present — run format validator
                if value:
                    err = rule["fn"](value)
                    if err:
                        errors.append({
                            "agent_name": agent_name,
                            "tool":       tool_name,
                            "field":      key,
                            "label":      rule["label"],
                            "message":    err,
                        })

    return errors
