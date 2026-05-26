"""
Email Tools  —  powered by Nodemailer (Node.js backend)
=========================================================
send_email            — general-purpose email with optional attachments
send_pdf_by_email     — one-shot: attach a PDF and send
schedule_email        — schedule recurring or one-off emails via cron
list_scheduled_emails — show pending scheduled emails
cancel_scheduled_email— cancel a scheduled email by ID

The backend Express server at BACKEND_URL must be running with
EMAIL_USER and EMAIL_PASS configured in backend/.env.

Supported providers:
  Gmail   — use App Password (Account → Security → App Passwords)
  Outlook — set EMAIL_HOST=smtp.office365.com EMAIL_PORT=587
  SendGrid / others — set EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE as needed
"""
import os
import json
from urllib.parse import unquote
from pathlib import Path
from langchain_core.tools import tool

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3001")
UPLOADS_DIR = Path(__file__).parent.parent.parent / "workspace" / "uploads"


def _resolve_pdf_path(raw_path: str) -> Path:
    """Accept local, URL-encoded, and workspace-style paths for generated PDFs."""
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


def _post(endpoint: str, payload: dict) -> dict:
    import urllib.request
    import urllib.error
    url  = f"{BACKEND_URL}/api/email/{endpoint}"
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            return {"error": json.loads(body).get("error", body)}
        except Exception:
            return {"error": body[:300]}
    except Exception as e:
        return {"error": str(e)}


def _get(endpoint: str) -> dict:
    import urllib.request
    url = f"{BACKEND_URL}/api/email/{endpoint}"
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {"error": str(e)}


def _delete(endpoint: str) -> dict:
    import urllib.request
    url = f"{BACKEND_URL}/api/email/{endpoint}"
    req = urllib.request.Request(url, method="DELETE")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {"error": str(e)}


# ── Tools ─────────────────────────────────────────────────────────────────────

@tool
def send_email(
    to: str,
    subject: str,
    body: str,
    attachment_paths: str = "",
    cc: str = "",
    bcc: str = "",
    reply_to: str = "",
) -> str:
    """
    Send an email to one or more recipients, with optional file attachments.

    to: recipient email address(es) — comma-separated for multiple
        e.g. "alice@example.com" or "alice@example.com, bob@example.com"
    subject: email subject line
    body: email body text. Markdown-style formatting is supported:
          ## for headings, - or • for bullets, --- for horizontal rules
    attachment_paths: comma-separated absolute file paths to attach
                      e.g. "/workspace/uploads/filled_form.pdf"
    cc: CC recipients, comma-separated (optional)
    bcc: BCC recipients, comma-separated (optional)
    reply_to: reply-to address (optional)

    Returns delivery confirmation with message ID.
    """
    attachments = [str(_resolve_pdf_path(p)) for p in attachment_paths.split(",") if p.strip()]

    # Validate attachment paths exist
    missing = [p for p in attachments if not Path(p).exists()]
    if missing:
        return f"Attachment(s) not found: {missing}. Check the file paths."

    payload = {
        "to":          [t.strip() for t in to.split(",") if t.strip()],
        "subject":     subject,
        "body":        body,
        "attachments": attachments,
    }
    if cc:       payload["cc"]       = [c.strip() for c in cc.split(",")  if c.strip()]
    if bcc:      payload["bcc"]      = [b.strip() for b in bcc.split(",") if b.strip()]
    if reply_to: payload["reply_to"] = reply_to

    res = _post("send", payload)

    if "error" in res:
        return f"❌ Email failed: {res['error']}"

    atts = res.get("attachments", [])
    lines = [
        f"✅ Email sent!",
        f"To      : {', '.join(res.get('to', [to]))}",
        f"Subject : {res.get('subject', subject)}",
        f"Msg ID  : {res.get('message_id', 'unknown')}",
    ]
    if atts:
        lines.append(f"Attached: {', '.join(atts)}")
    return "\n".join(lines)


@tool
def send_pdf_by_email(
    to: str,
    pdf_path: str,
    subject: str = "",
    message: str = "",
    cc: str = "",
) -> str:
    """
    Send a PDF file as an email attachment — ideal for mailing a filled form.

    Use this right after fill_pdf_form: copy the output path directly into pdf_path.

    to: recipient email address(es), comma-separated
    pdf_path: absolute path to the PDF to attach
              (copy the DOWNLOAD_PATH value from fill_pdf_form output)
    subject: email subject (auto-generated from the PDF filename if blank)
    message: email body text (auto-generated if blank)
    cc: CC recipients, comma-separated (optional)
    """
    pdf = _resolve_pdf_path(pdf_path)
    if not pdf.exists():
        return f"PDF not found: {pdf_path}. Make sure fill_pdf_form ran successfully."

    auto_subject = subject.strip() or f"Filled Form: {pdf.stem.replace('_', ' ').replace('-', ' ').title()}"
    auto_body    = message.strip() or (
        f"Please find the completed form '{pdf.name}' attached.\n\n"
        "This document was filled and sent automatically by Yuno AI.\n\n"
        "---\n"
        "If you have any questions, please reply to this email."
    )

    payload = {
        "to":          [t.strip() for t in to.split(",") if t.strip()],
        "subject":     auto_subject,
        "body":        auto_body,
        "attachments": [str(pdf)],
    }
    if cc:
        payload["cc"] = [c.strip() for c in cc.split(",") if c.strip()]

    res = _post("send", payload)

    if "error" in res:
        return f"❌ Email failed: {res['error']}"

    return (
        f"✅ PDF emailed successfully!\n"
        f"To      : {', '.join(res.get('to', [to]))}\n"
        f"Subject : {res.get('subject', auto_subject)}\n"
        f"File    : {pdf.name}\n"
        f"Msg ID  : {res.get('message_id', 'unknown')}"
    )


@tool
def schedule_email(
    cron_expression: str,
    to: str,
    subject: str,
    body: str,
    attachment_paths: str = "",
) -> str:
    """
    Schedule a recurring or one-time email using a cron expression.

    cron_expression: standard 5-part cron string:
      "0 9 * * 1"   → every Monday at 9:00 AM
      "0 8 * * 1-5" → weekdays at 8:00 AM
      "0 18 * * 5"  → every Friday at 6:00 PM
      "0 9 1 * *"   → 1st of every month at 9:00 AM
      "*/30 * * * *"→ every 30 minutes

    to: recipient email(s), comma-separated
    subject: email subject
    body: email body text
    attachment_paths: comma-separated file paths to attach (optional)

    Returns a schedule_id you can use to cancel with cancel_scheduled_email.
    """
    attachments = [p.strip() for p in attachment_paths.split(",") if p.strip()]

    payload = {
        "cron_expression": cron_expression,
        "email": {
            "to":          [t.strip() for t in to.split(",") if t.strip()],
            "subject":     subject,
            "body":        body,
            "attachments": attachments,
        },
    }

    res = _post("schedule", payload)

    if "error" in res:
        return f"❌ Scheduling failed: {res['error']}"

    return (
        f"✅ Email scheduled!\n"
        f"Schedule ID : {res.get('schedule_id')}\n"
        f"Cron        : {cron_expression}\n"
        f"To          : {to}\n"
        f"Subject     : {subject}\n"
        f"Message     : {res.get('message')}\n\n"
        f"Use cancel_scheduled_email with the Schedule ID to stop it."
    )


@tool
def list_scheduled_emails() -> str:
    """
    List all currently scheduled emails (pending/recurring).
    Returns schedule IDs, cron expressions, recipients, and subjects.
    Use the ID with cancel_scheduled_email to cancel any of them.
    """
    res = _get("scheduled")

    if "error" in res:
        return f"❌ Error: {res['error']}"

    items = res.get("scheduled", [])
    if not items:
        return "No emails are currently scheduled."

    lines = [f"📅 {res.get('count', len(items))} scheduled email(s):\n"]
    for s in items:
        lines.append(
            f"• ID      : {s.get('id')}\n"
            f"  Cron    : {s.get('cron_expression')}\n"
            f"  To      : {s.get('to')}\n"
            f"  Subject : {s.get('subject')}\n"
            f"  Created : {s.get('created')}\n"
        )
    return "\n".join(lines)


@tool
def cancel_scheduled_email(schedule_id: str) -> str:
    """
    Cancel a previously scheduled email by its ID.
    Get the ID from schedule_email or list_scheduled_emails.

    schedule_id: the UUID returned by schedule_email
    """
    res = _delete(f"scheduled/{schedule_id.strip()}")

    if "error" in res:
        return f"❌ Cancel failed: {res['error']}"

    return f"✅ {res.get('message', f'Schedule {schedule_id} cancelled')}"
