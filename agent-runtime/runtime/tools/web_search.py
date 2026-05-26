from langchain_core.tools import tool
from duckduckgo_search import DDGS
from urllib.parse import quote_plus
from urllib.request import Request, urlopen
import re


def _format_results(results: list[dict]) -> str:
    formatted = []
    for i, r in enumerate(results, 1):
        title = r.get("title") or r.get("text") or "No title"
        href = r.get("href") or r.get("url") or ""
        body = r.get("body") or r.get("snippet") or ""
        formatted.append(f"{i}. **{title}**\n   URL: {href}\n   {body[:300]}")
    return "\n\n".join(formatted)


def _search_duckduckgo(query: str) -> list[dict]:
    attempts = [
        {"region": "in-en", "safesearch": "moderate", "backend": "auto"},
        {"region": "wt-wt", "safesearch": "off", "backend": "html"},
        {"region": "wt-wt", "safesearch": "off", "backend": "lite"},
    ]
    with DDGS() as ddgs:
        for opts in attempts:
            try:
                results = list(ddgs.text(query, max_results=5, **opts))
                if results:
                    return results
            except Exception:
                continue
    return []


def _search_duckduckgo_html(query: str) -> list[dict]:
    """Small HTML fallback for cases where the package backend returns empty."""
    url = f"https://duckduckgo.com/html/?q={quote_plus(query)}"
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=15) as resp:
        html = resp.read().decode("utf-8", errors="replace")

    rows = re.findall(
        r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>.*?'
        r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>',
        html,
        flags=re.S,
    )
    clean = lambda s: re.sub(r"<[^>]+>", "", s).replace("&amp;", "&").strip()
    return [{"title": clean(t), "href": clean(h), "body": clean(b)} for h, t, b in rows[:5]]


@tool
def web_search_tool(query: str) -> str:
    """Search the web for current information on a topic. Returns top search results with titles, URLs, and snippets."""
    try:
        cleaned = (query or "").strip()
        if not cleaned:
            return "Search query is empty."

        results = _search_duckduckgo(cleaned)
        if not results:
            results = _search_duckduckgo_html(cleaned)
        if not results:
            return (
                f"No results found for '{cleaned}'. Try a more specific query, "
                f"for example: {cleaned} official website, {cleaned} latest news, or {cleaned} India."
            )
        return _format_results(results)
    except Exception as e:
        return f"Search error: {str(e)}"
