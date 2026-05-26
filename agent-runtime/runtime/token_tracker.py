"""
Token Usage Tracker
===================
Dual-source token cost monitoring for Yuno AI:

  1. LOCAL  — always on. Appends each agent run to
              workspace/token_usage.json (rolling 10 k records).
  2. LANGSMITH — optional. When LANGSMITH_API_KEY is set in .env,
              the /token-stats endpoint also queries the LangSmith API
              for run data, and automatic LangChain tracing is enabled.

Usage
-----
    from runtime.token_tracker import record_usage, get_stats

    # after an agent call:
    record_usage(model="gpt-4o", input_tokens=500, output_tokens=200)

    # in the /token-stats FastAPI endpoint:
    return get_stats()
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ── Storage ───────────────────────────────────────────────────────────────────
TRACKER_FILE = Path(__file__).parent.parent / "workspace" / "token_usage.json"

# ── Model pricing (USD per 1 million tokens) ──────────────────────────────────
MODEL_PRICES: dict[str, dict[str, float]] = {
    "gpt-4o":            {"input":  2.50, "output": 10.00},
    "gpt-4o-mini":       {"input":  0.15, "output":  0.60},
    "gpt-4-turbo":       {"input": 10.00, "output": 30.00},
    "gpt-4":             {"input": 30.00, "output": 60.00},
    "gpt-3.5-turbo":     {"input":  0.50, "output":  1.50},
    "claude-3-5-sonnet": {"input":  3.00, "output": 15.00},
    "claude-3-opus":     {"input": 15.00, "output": 75.00},
    "claude-3-haiku":    {"input":  0.25, "output":  1.25},
}
_DEFAULT_PRICE: dict[str, float] = {"input": 2.50, "output": 10.00}


def _price_for(model: str) -> dict[str, float]:
    m = (model or "").lower()
    for key, price in MODEL_PRICES.items():
        if key in m:
            return price
    return _DEFAULT_PRICE


def compute_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Return estimated USD cost for a single LLM call."""
    p = _price_for(model)
    return (input_tokens * p["input"] + output_tokens * p["output"]) / 1_000_000


# ── Local recording ───────────────────────────────────────────────────────────

def record_usage(
    model: str,
    input_tokens: int,
    output_tokens: int,
    *,
    run_id: str | None = None,
    agent_name: str | None = None,
) -> None:
    """Append one usage record to the local JSON store (fire-and-forget safe)."""
    try:
        TRACKER_FILE.parent.mkdir(parents=True, exist_ok=True)

        record = {
            "ts":            datetime.now(timezone.utc).isoformat(),
            "model":         model or "gpt-4o",
            "input_tokens":  int(input_tokens),
            "output_tokens": int(output_tokens),
            "total_tokens":  int(input_tokens) + int(output_tokens),
            "cost_usd":      round(compute_cost(model, input_tokens, output_tokens), 8),
            "run_id":        run_id,
            "agent":         agent_name,
        }

        records: list = []
        if TRACKER_FILE.exists():
            try:
                records = json.loads(TRACKER_FILE.read_text(encoding="utf-8"))
                if not isinstance(records, list):
                    records = []
            except Exception:
                records = []

        records.append(record)
        if len(records) > 10_000:           # rolling window
            records = records[-10_000:]

        TRACKER_FILE.write_text(json.dumps(records), encoding="utf-8")
    except Exception:
        pass   # never crash the caller


# ── Aggregation helpers ───────────────────────────────────────────────────────

def _agg(records: list[dict]) -> dict:
    return {
        "runs":          len(records),
        "input_tokens":  sum(r.get("input_tokens",  0) for r in records),
        "output_tokens": sum(r.get("output_tokens", 0) for r in records),
        "total_tokens":  sum(r.get("total_tokens",  0) for r in records),
        "cost_usd":      round(sum(r.get("cost_usd", 0.0) for r in records), 6),
    }


def _daily(records: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for r in records:
        day = (r.get("ts") or "")[:10]
        if not day:
            continue
        if day not in out:
            out[day] = {
                "input_tokens": 0, "output_tokens": 0,
                "total_tokens": 0, "cost_usd": 0.0, "runs": 0,
            }
        out[day]["input_tokens"]  += r.get("input_tokens",  0)
        out[day]["output_tokens"] += r.get("output_tokens", 0)
        out[day]["total_tokens"]  += r.get("total_tokens",  0)
        out[day]["cost_usd"]      += r.get("cost_usd", 0.0)
        out[day]["runs"]          += 1
    return out


def _by_model(records: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for r in records:
        m = r.get("model") or "unknown"
        if m not in out:
            out[m] = {
                "input_tokens": 0, "output_tokens": 0,
                "total_tokens": 0, "cost_usd": 0.0, "runs": 0,
            }
        out[m]["input_tokens"]  += r.get("input_tokens",  0)
        out[m]["output_tokens"] += r.get("output_tokens", 0)
        out[m]["total_tokens"]  += r.get("total_tokens",  0)
        out[m]["cost_usd"]      += r.get("cost_usd", 0.0)
        out[m]["runs"]          += 1
    return out


def _empty() -> dict:
    z = {"runs": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "cost_usd": 0.0}
    return {
        "today": z.copy(), "week": z.copy(), "month": z.copy(),
        "daily": {}, "models": {}, "source": "local", "langsmith_project": None,
    }


# ── Local stats ───────────────────────────────────────────────────────────────

def get_local_stats() -> dict:
    """Aggregate workspace/token_usage.json into today / week / month buckets."""
    if not TRACKER_FILE.exists():
        return _empty()
    try:
        records: list[dict] = json.loads(TRACKER_FILE.read_text(encoding="utf-8"))
        if not isinstance(records, list):
            return _empty()
    except Exception:
        return _empty()

    now       = datetime.now(timezone.utc)
    today_iso = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    week_iso  = (now - timedelta(days=7)).isoformat()
    month_iso = (now - timedelta(days=30)).isoformat()

    today_r = [r for r in records if r.get("ts", "") >= today_iso]
    week_r  = [r for r in records if r.get("ts", "") >= week_iso]
    month_r = [r for r in records if r.get("ts", "") >= month_iso]

    return {
        "today":  _agg(today_r),
        "week":   _agg(week_r),
        "month":  _agg(month_r),
        "daily":  _daily(week_r),
        "models": _by_model(month_r),
        "source": "local",
        "langsmith_project": None,
    }


# ── LangSmith stats ───────────────────────────────────────────────────────────

def get_langsmith_stats() -> dict | None:
    """
    Query the LangSmith API for LLM run data.
    Returns None when:
      - LANGSMITH_API_KEY is not set
      - langsmith package is not installed
      - any network / API error occurs
    """
    api_key = os.getenv("LANGSMITH_API_KEY", "").strip()
    if not api_key:
        return None

    try:
        from langsmith import Client  # type: ignore
    except ImportError:
        return None

    try:
        client  = Client(api_key=api_key)
        project = os.getenv("LANGCHAIN_PROJECT", "yuno-ai")
        now     = datetime.now(timezone.utc)
        start   = now - timedelta(days=30)

        raw_runs = list(client.list_runs(
            project_name=project,
            start_time=start,
            run_type="llm",
            limit=5000,
        ))

        def _si(v) -> int:
            try: return max(0, int(v or 0))
            except Exception: return 0

        def _sf(v) -> float:
            try: return max(0.0, float(v or 0))
            except Exception: return 0.0

        def _ts(run) -> str:
            try:
                t = run.start_time
                return t.isoformat() if hasattr(t, "isoformat") else str(t)
            except Exception:
                return ""

        records: list[dict] = []
        for r in raw_runs:
            in_tok  = _si(getattr(r, "prompt_tokens",     None)) or \
                      _si(getattr(r, "input_token_count",  None))
            out_tok = _si(getattr(r, "completion_tokens",  None)) or \
                      _si(getattr(r, "output_token_count", None))
            total   = _si(getattr(r, "total_tokens",       None)) or (in_tok + out_tok)

            cost = _sf(getattr(r, "total_cost", None))
            if cost == 0.0 and (in_tok + out_tok) > 0:
                try:
                    extra = getattr(r, "extra", {}) or {}
                    mdl   = (extra.get("invocation_params") or {}).get("model_name", "gpt-4o")
                except Exception:
                    mdl = "gpt-4o"
                cost = compute_cost(mdl, in_tok, out_tok)

            records.append({
                "ts":            _ts(r),
                "model":         "langsmith-run",
                "input_tokens":  in_tok,
                "output_tokens": out_tok,
                "total_tokens":  total,
                "cost_usd":      round(cost, 8),
            })

        today_iso = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        week_iso  = (now - timedelta(days=7)).isoformat()

        today_r = [r for r in records if r.get("ts", "") >= today_iso]
        week_r  = [r for r in records if r.get("ts", "") >= week_iso]

        return {
            "today":  _agg(today_r),
            "week":   _agg(week_r),
            "month":  _agg(records),
            "daily":  _daily(week_r),
            "models": _by_model(records),
            "source": "langsmith",
            "langsmith_project": project,
        }

    except Exception:
        return None


# ── Public API ────────────────────────────────────────────────────────────────

def get_stats() -> dict:
    """
    Return the best available stats.
    Prefers LangSmith when configured; falls back to local JSON store.
    """
    ls = get_langsmith_stats()
    return ls if ls is not None else get_local_stats()
