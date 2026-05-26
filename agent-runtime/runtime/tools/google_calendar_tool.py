"""
Google Calendar Tools
=====================
List events, create meetings (with Google Meet links), update, delete,
find free time slots, and check attendee availability.

Authentication (choose one):
  Option A — Service Account (recommended for server use):
    1. Go to console.cloud.google.com → Create project → Enable Calendar API
    2. IAM & Admin → Service Accounts → Create → Download JSON key
    3. Share your Google Calendar with the service account email (give "Make changes to events" permission)
    4. Set env var:  GOOGLE_SERVICE_ACCOUNT_FILE=/path/to/service-account.json
       OR:          GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}  (the full JSON as string)

  Option B — OAuth2 (for personal calendar):
    1. console.cloud.google.com → OAuth 2.0 Client ID → Desktop app → Download JSON
    2. Set env var:  GOOGLE_OAUTH_CREDENTIALS_FILE=/path/to/credentials.json
    3. First run will open a browser for authorization; token saved to token.json

Default calendar ID: "primary" (the signed-in account's main calendar)
Timezone: set CALENDAR_TIMEZONE env var (default: UTC). Example: "Asia/Kolkata", "America/New_York"
"""
import os
import json
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from langchain_core.tools import tool

DEFAULT_CAL   = "primary"
SCOPES        = ["https://www.googleapis.com/auth/calendar"]

# Per-request credentials injected from the API layer (no env vars needed)
_creds_var: ContextVar[dict | None] = ContextVar("_gcal_creds", default=None)
_tz_var:    ContextVar[str]         = ContextVar("_gcal_tz",    default="UTC")


def set_calendar_credentials(service_account_json: dict | None, timezone: str = "UTC"):
    """Called by the API layer to inject per-request credentials."""
    _creds_var.set(service_account_json)
    _tz_var.set(timezone or "UTC")


def _get_tz() -> str:
    return _tz_var.get()


# ── Authentication ─────────────────────────────────────────────────────────────

def _get_service():
    """Return an authenticated Google Calendar service object."""
    try:
        from googleapiclient.discovery import build
        from google.oauth2 import service_account
    except ImportError:
        raise RuntimeError(
            "Google libraries not installed. Run:\n"
            "pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib"
        )

    # Per-request credentials (from UI prompt) take priority
    sa_info = _creds_var.get()
    if sa_info:
        creds = service_account.Credentials.from_service_account_info(sa_info, scopes=SCOPES)
        return build("calendar", "v3", credentials=creds, cache_discovery=False)

    raise RuntimeError(
        "Google Calendar credentials not connected. "
        "Please click 'Connect Google Calendar' and paste your Service Account JSON."
    )


def _parse_dt(dt_str: str, tz: str) -> datetime:
    """Parse flexible datetime strings into aware datetime objects."""
    tzinfo = ZoneInfo(tz)
    now    = datetime.now(tzinfo)

    if not dt_str or dt_str.lower() in ("now", "today"):
        return now

    # Relative: "tomorrow 10am", "in 2 hours", "next monday 3pm"
    lower = dt_str.lower().strip()
    if lower.startswith("in "):
        parts = lower[3:].split()
        n, unit = int(parts[0]), parts[1] if len(parts) > 1 else "hours"
        delta = {"hour": 1, "hours": 1, "day": 24, "days": 24, "minute": 1/60, "minutes": 1/60}
        return now + timedelta(hours=delta.get(unit, 1) * n)

    # Try ISO / common formats
    fmts = [
        "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M",    "%Y-%m-%d %H:%M",
        "%Y-%m-%d",          "%d/%m/%Y %H:%M",
        "%d/%m/%Y",          "%B %d %Y %H:%M",
        "%B %d %Y",
    ]
    for fmt in fmts:
        try:
            return datetime.strptime(dt_str, fmt).replace(tzinfo=tzinfo)
        except ValueError:
            continue

    raise ValueError(
        f"Cannot parse datetime '{dt_str}'. "
        "Use ISO format like '2025-06-15 14:30' or '2025-06-15T14:30:00'."
    )


def _fmt_event(e: dict, tz: str) -> str:
    """Format a calendar event dict into a readable string."""
    tzinfo = ZoneInfo(tz)
    start  = e.get("start", {})
    end    = e.get("end", {})

    def _dt(d):
        if "dateTime" in d:
            return datetime.fromisoformat(d["dateTime"]).astimezone(tzinfo).strftime("%a %b %d %H:%M")
        return d.get("date", "?")

    attendees = [a["email"] for a in e.get("attendees", [])]
    meet_link = (e.get("conferenceData", {})
                  .get("entryPoints", [{}])[0]
                  .get("uri", ""))
    location  = e.get("location", "")

    lines = [
        f"📅 {e.get('summary', '(no title)')}",
        f"   ID: {e.get('id')}",
        f"   Time: {_dt(start)} → {_dt(end)}",
    ]
    if location:  lines.append(f"   Location: {location}")
    if attendees: lines.append(f"   Attendees: {', '.join(attendees)}")
    if meet_link: lines.append(f"   Meet: {meet_link}")
    if e.get("description"): lines.append(f"   Note: {e['description'][:100]}")
    return "\n".join(lines)


# ── Tools ──────────────────────────────────────────────────────────────────────

@tool
def list_calendar_events(
    days_ahead: int = 7,
    calendar_id: str = DEFAULT_CAL,
    max_results: int = 20,
) -> str:
    """
    List upcoming events from Google Calendar.
    days_ahead: how many days into the future to look (default 7)
    calendar_id: calendar ID (default 'primary' = main calendar)
    max_results: maximum events to return (default 20)
    Returns a list of events with times, attendees, and Meet links.
    """
    try:
        service = _get_service()
        tz      = _get_tz()
        tzinfo  = ZoneInfo(tz)
        now     = datetime.now(tzinfo)
        end_dt  = now + timedelta(days=days_ahead)

        result = service.events().list(
            calendarId=calendar_id,
            timeMin=now.isoformat(),
            timeMax=end_dt.isoformat(),
            maxResults=max_results,
            singleEvents=True,
            orderBy="startTime",
        ).execute()

        events = result.get("items", [])
        if not events:
            return f"No events found in the next {days_ahead} days."

        lines = [f"📆 Next {days_ahead} days — {len(events)} event(s) in timezone {tz}:\n"]
        for e in events:
            lines.append(_fmt_event(e, tz))
        return "\n\n".join(lines)

    except RuntimeError as e:
        return f"Auth error: {e}"
    except Exception as e:
        return f"Error listing events: {e}"


@tool
def create_calendar_event(
    title: str,
    start_datetime: str,
    end_datetime: str = "",
    duration_minutes: int = 60,
    description: str = "",
    attendees: str = "",
    location: str = "",
    add_google_meet: bool = True,
    calendar_id: str = DEFAULT_CAL,
) -> str:
    """
    Create a Google Calendar event / meeting.
    title: event title (e.g. 'Team Standup')
    start_datetime: when to start — ISO format '2025-06-15 14:30' or relative like 'tomorrow 10am'
    end_datetime: when to end (optional — uses duration_minutes if not provided)
    duration_minutes: duration in minutes if end_datetime is not given (default 60)
    description: optional event description / agenda
    attendees: comma-separated email addresses to invite (e.g. 'alice@gmail.com, bob@company.com')
    location: physical location or video URL (optional)
    add_google_meet: whether to auto-generate a Google Meet link (default True)
    calendar_id: calendar to create on (default 'primary')
    Returns the created event ID, link, and Meet URL.
    """
    try:
        service = _get_service()
        tz      = _get_tz()
        tzinfo  = ZoneInfo(tz)

        start = _parse_dt(start_datetime, tz)
        if end_datetime:
            end = _parse_dt(end_datetime, tz)
        else:
            end = start + timedelta(minutes=duration_minutes)

        body: dict = {
            "summary": title,
            "start":   {"dateTime": start.isoformat(), "timeZone": tz},
            "end":     {"dateTime": end.isoformat(),   "timeZone": tz},
        }
        if description: body["description"] = description
        if location:    body["location"]    = location

        if attendees:
            body["attendees"] = [
                {"email": e.strip()} for e in attendees.split(",") if e.strip()
            ]
            body["guestsCanModifyEvent"] = False

        if add_google_meet:
            body["conferenceData"] = {
                "createRequest": {
                    "requestId": f"yuno-{int(start.timestamp())}",
                    "conferenceSolutionKey": {"type": "hangoutsMeet"},
                }
            }

        event = service.events().insert(
            calendarId=calendar_id,
            body=body,
            conferenceDataVersion=1 if add_google_meet else 0,
            sendUpdates="all" if attendees else "none",
        ).execute()

        meet_link = (event.get("conferenceData", {})
                          .get("entryPoints", [{}])[0]
                          .get("uri", "No Meet link"))
        cal_link  = event.get("htmlLink", "")

        return (
            f"✅ Event created!\n"
            f"Title:    {event['summary']}\n"
            f"Start:    {start.strftime('%a %B %d, %Y at %H:%M')} ({tz})\n"
            f"End:      {end.strftime('%H:%M')}\n"
            f"ID:       {event['id']}\n"
            f"Calendar: {cal_link}\n"
            f"Meet:     {meet_link}\n"
            + (f"Invites sent to: {attendees}" if attendees else "")
        )

    except RuntimeError as e:
        return f"Auth error: {e}"
    except ValueError as e:
        return f"Date error: {e}"
    except Exception as e:
        return f"Error creating event: {e}"


@tool
def update_calendar_event(
    event_id: str,
    title: str = "",
    start_datetime: str = "",
    end_datetime: str = "",
    description: str = "",
    location: str = "",
    add_attendees: str = "",
    calendar_id: str = DEFAULT_CAL,
) -> str:
    """
    Update an existing calendar event. Only fields provided will be changed.
    event_id: the event ID (from list_calendar_events or create_calendar_event)
    title: new title (leave blank to keep existing)
    start_datetime: new start time in ISO format (leave blank to keep existing)
    end_datetime: new end time (leave blank to keep existing)
    description: new description
    location: new location
    add_attendees: comma-separated emails to add as new attendees
    calendar_id: calendar ID
    """
    try:
        service = _get_service()
        tz      = _get_tz()

        event = service.events().get(
            calendarId=calendar_id, eventId=event_id
        ).execute()

        if title:           event["summary"]     = title
        if description:     event["description"] = description
        if location:        event["location"]    = location

        if start_datetime:
            start = _parse_dt(start_datetime, tz)
            event["start"] = {"dateTime": start.isoformat(), "timeZone": tz}
        if end_datetime:
            end = _parse_dt(end_datetime, tz)
            event["end"]   = {"dateTime": end.isoformat(), "timeZone": tz}

        if add_attendees:
            existing = event.get("attendees", [])
            new_list = [{"email": e.strip()} for e in add_attendees.split(",") if e.strip()]
            event["attendees"] = existing + new_list

        updated = service.events().update(
            calendarId=calendar_id,
            eventId=event_id,
            body=event,
            sendUpdates="all",
        ).execute()

        return f"✅ Event updated: {updated.get('summary')}\nLink: {updated.get('htmlLink')}"

    except RuntimeError as e:
        return f"Auth error: {e}"
    except Exception as e:
        return f"Error updating event: {e}"


@tool
def delete_calendar_event(
    event_id: str,
    calendar_id: str = DEFAULT_CAL,
    notify_attendees: bool = True,
) -> str:
    """
    Delete / cancel a calendar event.
    event_id: the event ID to delete
    calendar_id: calendar ID (default 'primary')
    notify_attendees: whether to send cancellation emails (default True)
    """
    try:
        service = _get_service()

        # Fetch title first for confirmation message
        event = service.events().get(
            calendarId=calendar_id, eventId=event_id
        ).execute()
        title = event.get("summary", "Unknown event")

        service.events().delete(
            calendarId=calendar_id,
            eventId=event_id,
            sendUpdates="all" if notify_attendees else "none",
        ).execute()

        return f"✅ Event '{title}' (ID: {event_id}) deleted successfully."

    except RuntimeError as e:
        return f"Auth error: {e}"
    except Exception as e:
        return f"Error deleting event: {e}"


@tool
def find_free_time_slots(
    attendee_emails: str,
    duration_minutes: int = 60,
    days_ahead: int = 5,
    working_hours_start: int = 9,
    working_hours_end: int = 18,
    calendar_id: str = DEFAULT_CAL,
) -> str:
    """
    Find available (free) time slots for a meeting, respecting busy times.
    attendee_emails: comma-separated emails to check availability for
    duration_minutes: desired meeting length in minutes (default 60)
    days_ahead: how many days to look ahead (default 5)
    working_hours_start: start of working day, 24h format (default 9 = 9am)
    working_hours_end: end of working day, 24h format (default 18 = 6pm)
    calendar_id: your calendar ID (default 'primary')
    Returns a list of available time windows.
    """
    try:
        service = _get_service()
        tz      = _get_tz()
        tzinfo  = ZoneInfo(tz)
        now     = datetime.now(tzinfo)
        end_dt  = now + timedelta(days=days_ahead)

        emails = [e.strip() for e in attendee_emails.split(",") if e.strip()]
        items  = [{"id": cal_id} for cal_id in ([calendar_id] + emails)]

        freebusy = service.freebusy().query(body={
            "timeMin":  now.isoformat(),
            "timeMax":  end_dt.isoformat(),
            "timeZone": tz,
            "items":    items,
        }).execute()

        # Collect all busy intervals
        busy_intervals = []
        for cal_data in freebusy.get("calendars", {}).values():
            for busy in cal_data.get("busy", []):
                s = datetime.fromisoformat(busy["start"]).astimezone(tzinfo)
                e = datetime.fromisoformat(busy["end"]).astimezone(tzinfo)
                busy_intervals.append((s, e))

        busy_intervals.sort(key=lambda x: x[0])

        # Find free slots within working hours
        free_slots = []
        current = now.replace(
            hour=working_hours_start, minute=0, second=0, microsecond=0
        )
        if current < now:
            current = now

        for day_offset in range(days_ahead):
            day = (now + timedelta(days=day_offset)).date()
            if day.weekday() >= 5:  # skip weekends
                continue

            slot_start = datetime(day.year, day.month, day.day,
                                  working_hours_start, 0, tzinfo=tzinfo)
            slot_end   = datetime(day.year, day.month, day.day,
                                  working_hours_end,   0, tzinfo=tzinfo)

            cursor = max(slot_start, now)
            while cursor + timedelta(minutes=duration_minutes) <= slot_end:
                proposed_end = cursor + timedelta(minutes=duration_minutes)
                conflict = any(
                    bs < proposed_end and be > cursor
                    for bs, be in busy_intervals
                )
                if not conflict:
                    free_slots.append((cursor, proposed_end))
                    if len(free_slots) >= 8:
                        break
                    cursor = proposed_end
                else:
                    # Skip past the conflict
                    blocking = next(
                        (be for bs, be in busy_intervals if bs < proposed_end and be > cursor),
                        proposed_end
                    )
                    cursor = blocking

            if len(free_slots) >= 8:
                break

        if not free_slots:
            return f"No free {duration_minutes}-minute slots found in the next {days_ahead} working days."

        lines = [
            f"✅ Free {duration_minutes}-min slots for {attendee_emails} "
            f"(next {days_ahead} days, {working_hours_start}:00–{working_hours_end}:00 {tz}):\n"
        ]
        for i, (s, e) in enumerate(free_slots, 1):
            lines.append(
                f"  {i}. {s.strftime('%A %B %d')} — "
                f"{s.strftime('%H:%M')} to {e.strftime('%H:%M')}"
            )
        lines.append(
            "\nTo book: use create_calendar_event with the chosen start/end time."
        )
        return "\n".join(lines)

    except RuntimeError as e:
        return f"Auth error: {e}"
    except Exception as e:
        return f"Error finding free slots: {e}"


@tool
def get_calendar_event(
    event_id: str,
    calendar_id: str = DEFAULT_CAL,
) -> str:
    """
    Get full details of a specific calendar event by its ID.
    event_id: the event ID (from list_calendar_events or create_calendar_event)
    calendar_id: calendar ID (default 'primary')
    """
    try:
        service = _get_service()
        event   = service.events().get(
            calendarId=calendar_id, eventId=event_id
        ).execute()
        return _fmt_event(event, _get_tz())
    except RuntimeError as e:
        return f"Auth error: {e}"
    except Exception as e:
        return f"Error getting event: {e}"


@tool
def list_calendars() -> str:
    """
    List all Google Calendars accessible to this account.
    Useful for finding calendar IDs to use in other tools.
    """
    try:
        service = _get_service()
        result  = service.calendarList().list().execute()
        cals    = result.get("items", [])
        if not cals:
            return "No calendars found."
        lines = ["Your calendars:\n"]
        for c in cals:
            lines.append(
                f"• {c.get('summary', 'Unnamed')} "
                f"(id={c.get('id')}, "
                f"role={c.get('accessRole')})"
            )
        return "\n".join(lines)
    except RuntimeError as e:
        return f"Auth error: {e}"
    except Exception as e:
        return f"Error listing calendars: {e}"
