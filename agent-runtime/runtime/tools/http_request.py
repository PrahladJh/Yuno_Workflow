from langchain_core.tools import tool
import httpx
import json


@tool
def http_request_tool(url: str, method: str = "GET", body: str = "") -> str:
    """Make an HTTP request to a URL. method can be GET or POST. body is optional JSON string for POST."""
    try:
        method = method.upper()
        headers = {"User-Agent": "Yuno-AI-Agent/1.0"}
        with httpx.Client(timeout=15, follow_redirects=True) as client:
            if method == "GET":
                resp = client.get(url, headers=headers)
            elif method == "POST":
                payload = json.loads(body) if body else {}
                resp = client.post(url, json=payload, headers=headers)
            else:
                return f"Unsupported method: {method}"

        content = resp.text[:2000]
        return f"Status: {resp.status_code}\nResponse:\n{content}"
    except Exception as e:
        return f"HTTP request error: {str(e)}"
