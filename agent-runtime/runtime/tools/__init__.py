from .web_search import web_search_tool
from .calculator import calculator_tool
from .http_request import http_request_tool
from .code_executor import code_executor_tool
from .datetime_tool import datetime_tool
from .email_tool import (
    send_email,
    send_pdf_by_email,
    schedule_email,
    list_scheduled_emails,
    cancel_scheduled_email,
)
from .github_tool import (
    clone_github_repo,
    list_repo_files,
    read_repo_file,
    run_shell_in_workspace,
)
from .sandbox_executor import (
    create_python_sandbox,
    install_packages_in_sandbox,
    run_python_code_in_sandbox,
    run_file_in_sandbox,
    write_file_in_workspace,
)
from .pdf_form_detector import detect_pdf_form_fields
from .pdf_form_filler import fill_pdf_form
from .google_calendar_tool import (
    list_calendar_events,
    create_calendar_event,
    update_calendar_event,
    delete_calendar_event,
    find_free_time_slots,
    get_calendar_event,
    list_calendars,
)
from .google_drive_tool import upload_file_to_drive
from .file_folder_tool import list_uploaded_files, read_uploaded_file
from .ats_resume_tool import calculate_ats_resume_score

# Each key maps to a single tool OR a list of related tools.
# get_tools_for_agent() handles both cases.
AVAILABLE_TOOLS = {
    # ── Core ──────────────────────────────────────────────────────────────────
    "web_search":    web_search_tool,
    "calculator":    calculator_tool,
    "http_request":  http_request_tool,
    "code_executor": code_executor_tool,
    "datetime":      datetime_tool,

    # ── GitHub / Repository ───────────────────────────────────────────────────
    "github": [
        clone_github_repo,
        list_repo_files,
        read_repo_file,
        run_shell_in_workspace,
    ],

    # ── Sandbox (isolated Python environment) ─────────────────────────────────
    "sandbox_exec": [
        create_python_sandbox,
        install_packages_in_sandbox,
        run_python_code_in_sandbox,
        run_file_in_sandbox,
        write_file_in_workspace,
    ],

    # ── PDF Analysis & Form Filling ───────────────────────────────────────────
    "pdf_analyzer": [detect_pdf_form_fields, fill_pdf_form],

    # ── Email (Nodemailer) ────────────────────────────────────────────────────
    "email": [
        send_email,
        send_pdf_by_email,
        schedule_email,
        list_scheduled_emails,
        cancel_scheduled_email,
    ],

    # ── Google Calendar ────────────────────────────────────────────────────────
    "google_calendar": [
        list_calendars,
        list_calendar_events,
        get_calendar_event,
        create_calendar_event,
        update_calendar_event,
        delete_calendar_event,
        find_free_time_slots,
    ],

    # Google Drive
    "google_drive": upload_file_to_drive,

    # Uploaded folders/files
    "folder_files": [list_uploaded_files, read_uploaded_file],

    # Resume scoring
    "ats_resume": calculate_ats_resume_score,
}


def get_tools_for_agent(tool_names: list) -> list:
    """Return a flat list of LangChain tool objects for the given tool names."""
    tools = []
    for name in tool_names:
        if name not in AVAILABLE_TOOLS:
            continue
        item = AVAILABLE_TOOLS[name]
        if isinstance(item, list):
            tools.extend(item)
        else:
            tools.append(item)
    return tools
