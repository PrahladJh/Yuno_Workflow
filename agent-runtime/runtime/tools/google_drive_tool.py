"""
Google Drive Tools
==================
Upload generated files, especially filled PDFs, into a configured Drive folder.

Authentication uses the same per-request Service Account JSON mechanism as the
Google Calendar tools. Share the destination Drive folder with the service
account email before running the tool.
"""
import os
import json
import re
from contextvars import ContextVar
from pathlib import Path
from urllib.parse import unquote, urlparse, parse_qs
from langchain_core.tools import tool

UPLOADS_DIR = Path(__file__).parent.parent.parent / "workspace" / "uploads"
SCOPES = ["https://www.googleapis.com/auth/drive.file"]
DEFAULT_FOLDER_ID = "1r15kyCWIjrkOOb0_WwgYMY3WkbSEpZrh"

_creds_var: ContextVar[dict | None] = ContextVar("_gdrive_creds", default=None)


def set_drive_credentials(service_account_json: dict | None):
    """Called by the API layer to inject per-request credentials."""
    _creds_var.set(service_account_json)


def _get_service():
    try:
        from googleapiclient.discovery import build
        from google.oauth2 import service_account
    except ImportError:
        raise RuntimeError(
            "Google libraries not installed. Run: "
            "pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib"
        )

    sa_info = _creds_var.get()
    if not sa_info:
        raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "")
        if raw:
            sa_info = json.loads(raw)

    if not sa_info:
        raise RuntimeError(
            "Google Drive credentials not connected. Paste a Service Account JSON "
            "in the agent test modal, or set GOOGLE_SERVICE_ACCOUNT_JSON."
        )

    creds = service_account.Credentials.from_service_account_info(sa_info, scopes=SCOPES)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _resolve_local_file(raw_path: str) -> Path:
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


def _folder_id(folder: str) -> str:
    value = (folder or DEFAULT_FOLDER_ID).strip()
    if not value:
        return DEFAULT_FOLDER_ID
    if "drive.google.com" not in value:
        return value

    match = re.search(r"/folders/([^/?#]+)", value)
    if match:
        return match.group(1)

    query = parse_qs(urlparse(value).query)
    if query.get("id"):
        return query["id"][0]
    return value


@tool
def upload_file_to_drive(
    file_path: str,
    folder_id_or_url: str = DEFAULT_FOLDER_ID,
    drive_filename: str = "",
) -> str:
    """
    Upload a local file to Google Drive.

    file_path: local path to upload. For filled PDFs, use the exact DOWNLOAD_PATH
               returned by fill_pdf_form.
    folder_id_or_url: Drive folder ID or full folder URL. Defaults to the Yuno
                      configured folder.
    drive_filename: optional name to use in Drive. Defaults to the local filename.

    Returns the Drive file ID, web link, folder path, and local DOWNLOAD_PATH.
    """
    try:
        from googleapiclient.http import MediaFileUpload
    except ImportError:
        return (
            "Google upload library not installed. Run: "
            "pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib"
        )

    local = _resolve_local_file(file_path)
    if not local.exists():
        return f"File not found: {file_path}"

    try:
        service = _get_service()
        folder_id = _folder_id(folder_id_or_url)
        name = drive_filename.strip() or local.name
        media = MediaFileUpload(str(local), mimetype="application/pdf", resumable=False)
        metadata = {"name": name, "parents": [folder_id]}
        created = service.files().create(
            body=metadata,
            media_body=media,
            fields="id,name,webViewLink,parents",
            supportsAllDrives=True,
        ).execute()

        return (
            "File uploaded to Google Drive.\n"
            f"Drive file name : {created.get('name', name)}\n"
            f"Drive file ID   : {created.get('id')}\n"
            f"Drive folder ID : {folder_id}\n"
            f"DRIVE_PATH      : https://drive.google.com/drive/folders/{folder_id}/{created.get('name', name)}\n"
            f"DRIVE_LINK      : {created.get('webViewLink', '')}\n"
            f"DOWNLOAD_PATH   : {local}"
        )
    except Exception as e:
        return f"Google Drive upload failed: {e}"
