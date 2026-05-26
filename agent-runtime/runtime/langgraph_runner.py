"""
LangGraph multi-agent workflow orchestrator.
Supports: sequential, conditional routing, and parallel fan-out/fan-in.

Key improvements:
  - Structured inputs (pdf_path, recipient_emails, github_repo, etc.) are
    passed as context to the right agents based on their tools.
  - Full agent-to-agent conversation is recorded in the state.
  - Upstream outputs are injected explicitly so downstream agents know
    exactly what data is available (file paths, results, etc.).
"""
import time
import operator
from typing import TypedDict, Annotated, Any, Callable, Awaitable
from langchain_core.messages import HumanMessage, AIMessage
from langgraph.graph import StateGraph, END
from .agent_executor import run_agent


# ── State ─────────────────────────────────────────────────────────────────────

def _merge(a: dict, b: dict) -> dict:
    return {**a, **b}

class WorkflowState(TypedDict):
    messages:      list[dict]
    current_input: str
    agent_outputs: Annotated[dict[str, str],   _merge]   # parallel-safe
    token_usage:   Annotated[dict[str, dict],  _merge]   # parallel-safe
    conversation:  Annotated[list[dict],       operator.add]  # full log
    context:       dict[str, Any]


# ── Tool → context key mapping ────────────────────────────────────────────────
# When an agent has one of these tools, inject the corresponding structured
# input as explicit context so the LLM doesn't have to guess.

TOOL_CONTEXT_HINTS = {
    "pdf_analyzer":    lambda inp: _pdf_hint(inp),
    "email":           lambda inp: _email_hint(inp),
    "github":          lambda inp: _github_hint(inp),
    "sandbox_exec":    lambda inp: _sandbox_hint(inp),
    "google_calendar": lambda inp: _calendar_hint(inp),
    "google_drive":    lambda inp: _drive_hint(inp),
    "web_search":      lambda inp: _search_hint(inp),
}

def _pdf_hint(inp: dict) -> str:
    path = inp.get("pdf_path", "")
    name = inp.get("pdf_filename", "")
    if not path:
        return ""
    return (
        f"A PDF file has been provided for you to work with.\n"
        f"  File name : {name}\n"
        f"  File path : {path}\n"
        f"Use detect_pdf_form_fields to detect fields, then fill_pdf_form to fill it."
    )

def _email_hint(inp: dict) -> str:
    recipients = inp.get("recipient_emails", "")
    if not recipients:
        return ""
    return (
        f"Email recipient(s) provided: {recipients}\n"
        f"After completing your task, send the results or any generated files "
        f"to this address using the email tool."
    )

def _github_hint(inp: dict) -> str:
    repo = inp.get("github_repo", "")
    if not repo:
        return ""
    return f"GitHub repository to work with: {repo}\nUse clone_github_repo to clone it first."

def _sandbox_hint(inp: dict) -> str:
    ws = inp.get("workspace_name", "")
    if not ws:
        return ""
    return f"Use workspace name '{ws}' for the Python sandbox environment."

def _calendar_hint(inp: dict) -> str:
    creds = inp.get("google_credentials")
    if not creds:
        return ""
    return "Google Calendar credentials have been provided for this session."

def _drive_hint(inp: dict) -> str:
    creds = inp.get("google_credentials")
    if not creds:
        return ""
    return (
        "Google Drive credentials have been provided for this session.\n"
        "Default folder: https://drive.google.com/drive/folders/"
        "1r15kyCWIjrkOOb0_WwgYMY3WkbSEpZrh?dmr=1&ec=wgc-drive-%5Bmodule%5D-goto\n"
        "When a generated file is available, upload it with upload_file_to_drive "
        "using the exact DOWNLOAD_PATH as file_path."
    )

def _search_hint(inp: dict) -> str:
    topic = inp.get("search_topic", "")
    if not topic:
        return ""
    return f"Search topic: {topic}"


def _build_tool_context(agent_tools: list, initial_input: dict) -> str:
    """Build a structured context block for an agent based on its tools."""
    parts = []
    for tool in agent_tools:
        if tool in TOOL_CONTEXT_HINTS:
            hint = TOOL_CONTEXT_HINTS[tool](initial_input)
            if hint:
                parts.append(hint)
    return "\n\n".join(parts)


def _build_upstream_context(
    agent_outputs: dict, node_map: dict, current_node_id: str
) -> str:
    """Build a readable summary of all upstream agent outputs."""
    parts = []
    for prev_id, prev_output in agent_outputs.items():
        if prev_id == current_node_id or not prev_output:
            continue
        prev_name = (
            node_map.get(prev_id, {})
            .get("data", {})
            .get("agentConfig", {})
            .get("name", prev_id)
        )
        parts.append(f"── Output from [{prev_name}] ──\n{prev_output}")
    return "\n\n".join(parts)


# ── Main entry point ──────────────────────────────────────────────────────────

async def execute_langgraph_workflow(
    workflow: dict,
    initial_input: dict,
    api_key: str,
    agent_memories: dict,
    event_callback: Callable[[str, dict], Awaitable[None]],
    google_credentials: dict | None = None,
    calendar_timezone: str = "UTC",
) -> dict:
    nodes = workflow.get("nodes", [])
    edges = workflow.get("edges", [])

    if not nodes:
        raise ValueError("Workflow has no nodes")

    # ── Build topology maps ───────────────────────────────────────────────────
    adjacency: dict[str, list[dict]] = {n["id"]: [] for n in nodes}
    in_degree:  dict[str, int]       = {n["id"]: 0  for n in nodes}

    for edge in edges:
        src, tgt, cond = edge.get("source"), edge.get("target"), edge.get("condition")
        if src and tgt:
            adjacency[src].append({"target": tgt, "condition": cond})
            in_degree[tgt] = in_degree.get(tgt, 0) + 1

    node_map    = {n["id"]: n for n in nodes}
    start_nodes = [n["id"] for n in nodes if in_degree.get(n["id"], 0) == 0] or [nodes[0]["id"]]

    # ── Build LangGraph ───────────────────────────────────────────────────────
    builder = StateGraph(WorkflowState)

    for node in nodes:
        node_id   = node["id"]
        agent_cfg = node.get("data", {}).get("agentConfig", {})

        async def _make_node(nid=node_id, cfg=agent_cfg):
            async def node_fn(state: WorkflowState) -> dict:
                agent_name  = cfg.get("name", nid)
                agent_tools = cfg.get("tools", [])
                memory      = agent_memories.get(cfg.get("agent_id"), {})

                await event_callback("agent_start", {
                    "agent_id": nid, "agent_name": agent_name
                })

                # ── Build the message for this agent ──────────────────────
                # 1. Start with the user's goal / structured initial input
                goal = initial_input.get("goal", "").strip()
                base_task = initial_input.get("message", goal or str(initial_input))

                # 2. Build tool-specific context from structured inputs
                tool_ctx = _build_tool_context(agent_tools, initial_input)

                # 3. Upstream agent outputs
                upstream_ctx = _build_upstream_context(
                    state.get("agent_outputs", {}), node_map, nid
                )

                # Compose the full message
                sections = []
                if base_task:
                    sections.append(f"## Your Task\n{base_task}")
                if tool_ctx:
                    sections.append(f"## Available Inputs for Your Tools\n{tool_ctx}")
                if upstream_ctx:
                    sections.append(
                        f"## Outputs from Previous Agents\n"
                        f"Use the data below directly — do not ask for it again.\n\n"
                        f"{upstream_ctx}"
                    )
                if upstream_ctx and "email" in agent_tools:
                    recipient = initial_input.get("recipient_emails", "")
                    sections.append(
                        f"## Action Required\n"
                        f"Based on the above outputs, send an email"
                        + (f" to {recipient}" if recipient else "")
                        + ". If a previous output contains a DOWNLOAD_PATH line, pass that exact path unchanged to send_pdf_by_email as pdf_path. Do not URL-encode it and do not rewrite it to /workspace."
                    )

                full_message = "\n\n".join(sections) or base_task

                messages = [{"role": "user", "content": full_message}]

                # ── Calendar credentials per-request ───────────────────────
                gcal_creds = (
                    initial_input.get("google_credentials") or google_credentials
                )
                tz = initial_input.get("calendar_timezone", calendar_timezone)

                # ── Run agent ──────────────────────────────────────────────
                async def _cb(event_type: str, data: dict):
                    data["agent_id"] = nid
                    await event_callback(event_type, data)

                result = await run_agent(
                    cfg, messages, api_key, memory, _cb,
                    google_credentials=gcal_creds,
                    calendar_timezone=tz,
                )
                output = result.get("output", "")
                usage  = result.get("token_usage", {})

                await event_callback("agent_end", {
                    "agent_id": nid, "agent_name": agent_name,
                    "output": output[:500], "token_usage": usage
                })

                return {
                    "agent_outputs": {nid: output},
                    "token_usage":   {nid: usage},
                    "current_input": output,
                    "conversation": [{
                        "agent":   agent_name,
                        "node_id": nid,
                        "input":   full_message[:400],
                        "output":  output,
                        "tools":   agent_tools,
                        "ts":      time.time(),
                    }],
                }
            return node_fn

        builder.add_node(node_id, await _make_node())

    # ── Wire edges ────────────────────────────────────────────────────────────
    for src_id, targets in adjacency.items():
        if not targets:
            builder.add_edge(src_id, END)
        else:
            unconditional = [t for t in targets if not t.get("condition")]
            conditional   = [t for t in targets if t.get("condition")]

            if conditional:
                cond_map = {t["condition"]: t["target"] for t in conditional}
                default  = unconditional[0]["target"] if unconditional else targets[0]["target"]

                def _router(state: WorkflowState, conds=cond_map, dflt=default) -> str:
                    last = state.get("current_input", "")
                    for keyword, target in conds.items():
                        if keyword and keyword.upper() in last.upper():
                            return target
                    return dflt

                all_targets = list({t["target"] for t in targets})
                builder.add_conditional_edges(src_id, _router, {t: t for t in all_targets})

            elif len(unconditional) == 1:
                builder.add_edge(src_id, unconditional[0]["target"])
            else:
                # Parallel fan-out
                for t in unconditional:
                    builder.add_edge(src_id, t["target"])

    # ── Entry point ───────────────────────────────────────────────────────────
    builder.set_entry_point(start_nodes[0])
    graph = builder.compile()

    # ── Execute ───────────────────────────────────────────────────────────────
    initial_state: WorkflowState = {
        "messages":      [],
        "current_input": initial_input.get("message", str(initial_input)),
        "agent_outputs": {},
        "token_usage":   {},
        "conversation":  [],
        "context":       initial_input,
    }

    final_state = await graph.ainvoke(initial_state)

    # Aggregate token usage
    total = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    for usage in final_state.get("token_usage", {}).values():
        total["input_tokens"]  += usage.get("input_tokens",  0)
        total["output_tokens"] += usage.get("output_tokens", 0)
        total["total_tokens"]  += usage.get("total_tokens",  0)

    return {
        "agent_outputs": final_state.get("agent_outputs", {}),
        "token_usage":   total,
        "final_output":  final_state.get("current_input", ""),
        "conversation":  final_state.get("conversation",  []),
    }
