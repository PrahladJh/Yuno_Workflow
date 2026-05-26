from langchain_core.tools import tool
from datetime import datetime, timezone


@tool
def datetime_tool(query: str = "now") -> str:
    """Get the current date and time. query can be 'now', 'date', 'time', or 'utc'."""
    now = datetime.now()
    utc = datetime.now(timezone.utc)
    q = query.lower().strip()
    if q == "date":
        return f"Current date: {now.strftime('%Y-%m-%d (%A, %B %d, %Y)')}"
    if q == "time":
        return f"Current time: {now.strftime('%H:%M:%S')}"
    if q == "utc":
        return f"UTC: {utc.strftime('%Y-%m-%d %H:%M:%S UTC')}"
    return f"Current datetime: {now.strftime('%Y-%m-%d %H:%M:%S')} (local) / {utc.strftime('%Y-%m-%d %H:%M:%S')} UTC"
