import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)

import os
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from langgraph.prebuilt import create_react_agent
from .tools import get_tools_for_agent
from .tools.google_calendar_tool import set_calendar_credentials
from .tools.google_drive_tool import set_drive_credentials


# ── Tool display names (shown in scope-lock) ──────────────────────────────────
_TOOL_LABELS = {
    "web_search":      "Web Search — find information on the internet",
    "calculator":      "Calculator — evaluate mathematical expressions",
    "http_request":    "HTTP Request — call external APIs and web services",
    "code_executor":   "Code Executor — run code snippets",
    "datetime":        "Date & Time — get current date/time info",
    "github":          "GitHub — clone repos, read files, run shell commands",
    "sandbox_exec":    "Python Sandbox — create isolated env, install packages, run code",
    "pdf_analyzer":    "PDF Analyzer & Filler — detect and fill PDF form fields",
    "email":           "Email — send emails with optional attachments",
    "google_calendar": "Google Calendar — list, create, update, delete calendar events",
    "google_drive":    "Google Drive — upload files to Drive folders",
    "folder_files":    "File Reader — list and read uploaded files",
    "ats_resume":      "ATS Resume Scorer — score resumes against job descriptions",
}


def _build_scope_lock(agent_config: dict) -> str:
    """
    Build a strict scope-lock block injected at the END of every system prompt.
    Tells the agent exactly what it can and cannot do — prevents tool/role bleed.
    """
    name       = agent_config.get("name", "Agent")
    role       = agent_config.get("role", "assistant")
    tool_names = agent_config.get("tools", [])

    if not tool_names:
        return (
            f"\n\n## STRICT SCOPE — {name.upper()}\n"
            f"You are configured as: {role}.\n"
            f"You have NO tools. Answer using only your built-in knowledge.\n"
            f"Do NOT pretend to browse the web, run code, or access external systems.\n"
            f"If asked for something requiring a tool, say: \"I don't have that capability configured.\""
        )

    tool_lines = "\n".join(
        f"  • {_TOOL_LABELS.get(t, t)}" for t in tool_names
    )

    return (
        f"\n\n## STRICT SCOPE — {name.upper()}\n"
        f"You are exclusively configured as: **{role}**.\n"
        f"Your ONLY permitted tools are:\n{tool_lines}\n\n"
        f"HARD RULES — follow these without exception:\n"
        f"1. Use ONLY the tools listed above. Never call a tool not on this list.\n"
        f"2. Stay within your role ({role}). Do not attempt tasks meant for other agents.\n"
        f"3. Complete the task fully using your tools. Do not stop halfway.\n"
        f"4. Only decline with \"This task is outside my scope\" when a request is COMPLETELY "
        f"unrelated to your role — e.g. you are a PDF tool and someone asks you to book a flight. "
        f"NEVER decline a follow-up, a user reply, or data the user provides for your current task. "
        f"If the user provides fill data, names, dates, or any values — use them immediately.\n"
        f"5. Never make up tool results. If a tool fails, report the error honestly."
    )


def build_agent(agent_config: dict, api_key: str, extra_tools: list = None):
    model = ChatOpenAI(
        model=agent_config.get("model", "gpt-4o"),
        api_key=api_key or os.getenv("OPENAI_API_KEY", ""),
        max_tokens=agent_config.get("max_tokens", 2000),
        temperature=agent_config.get("temperature", 0.7),
    )

    tool_names = agent_config.get("tools", [])
    tools = get_tools_for_agent(tool_names) + (extra_tools or [])

    # Base system prompt + strict scope lock appended at the end
    base_prompt   = agent_config.get("system_prompt", "You are a helpful AI assistant.")
    scope_lock    = _build_scope_lock(agent_config)
    system_prompt = base_prompt + scope_lock

    agent = create_react_agent(model, tools, prompt=system_prompt) if tools else None
    return model, tools, system_prompt, agent


async def run_agent(
    agent_config: dict,
    messages: list,
    api_key: str,
    memory: dict = None,
    event_callback=None,
    google_credentials: dict = None,
    calendar_timezone: str = "UTC",
) -> dict:
    agent_name = agent_config.get("name", "Agent")

    # Inject Google Calendar credentials for this request if provided
    tool_names = agent_config.get("tools", [])
    if "google_calendar" in tool_names:
        set_calendar_credentials(google_credentials, calendar_timezone)
    if "google_drive" in tool_names:
        set_drive_credentials(google_credentials)

    model, tools, system_prompt, react_agent = build_agent(agent_config, api_key)

    # Inject memory into system prompt if present
    if memory:
        memory_context = "\n\nYour memory:\n" + "\n".join(f"- {k}: {v}" for k, v in memory.items())
        system_prompt = system_prompt + memory_context

    human_ai_messages = []
    for msg in messages:
        if msg["role"] == "user":
            human_ai_messages.append(HumanMessage(content=msg["content"]))
        elif msg["role"] == "assistant":
            human_ai_messages.append(AIMessage(content=msg["content"]))

    total_input_tokens  = 0
    total_output_tokens = 0
    final_output        = ""
    tool_outputs        = []

    try:
        if react_agent and tools:
            if memory:
                react_agent = create_react_agent(model, tools, prompt=system_prompt)

            state = {"messages": human_ai_messages}

            # Stream events for real-time callbacks; capture final text from last AI turn.
            # Do NOT call ainvoke after this — that would execute the agent (and all tools) twice.
            last_ai_text = ""
            async for event in react_agent.astream_events(state, version="v2"):
                kind = event.get("event", "")

                if kind == "on_tool_start" and event_callback:
                    await event_callback("tool_call", {
                        "agent_name": agent_name,
                        "tool_name":  event.get("name", "unknown"),
                        "tool_input": event.get("data", {}).get("input", {})
                    })
                elif kind == "on_tool_end" and event_callback:
                    tool_output = str(event.get("data", {}).get("output", ""))
                    tool_outputs.append(tool_output)
                    await event_callback("tool_result", {
                        "agent_name":  agent_name,
                        "tool_name":   event.get("name", "unknown"),
                        "tool_output": tool_output[:500]
                    })
                elif kind == "on_chat_model_end":
                    output = event.get("data", {}).get("output")
                    if output:
                        usage = getattr(output, "usage_metadata", None)
                        if usage:
                            total_input_tokens  += usage.get("input_tokens", 0)
                            total_output_tokens += usage.get("output_tokens", 0)
                        # Capture final text — only non-empty, non-tool-call responses
                        content = getattr(output, "content", "")
                        if isinstance(content, str) and content.strip():
                            last_ai_text = content
                        elif isinstance(content, list):
                            for part in content:
                                if isinstance(part, dict) and part.get("type") == "text":
                                    t = part.get("text", "")
                                    if t.strip():
                                        last_ai_text = t

            final_output = last_ai_text
            download_lines = []
            for tool_output in tool_outputs:
                for line in tool_output.splitlines():
                    upper = line.upper()
                    if (
                        upper.startswith("DOWNLOAD_PATH")
                        or upper.startswith("DRIVE_PATH")
                        or upper.startswith("DRIVE_LINK")
                    ) and line not in download_lines:
                        download_lines.append(line)
            if download_lines and not any(tag in final_output for tag in ("DOWNLOAD_PATH", "DRIVE_PATH", "DRIVE_LINK")):
                suffix = "\n".join(download_lines)
                final_output = f"{final_output.rstrip()}\n\nGenerated file:\n{suffix}".strip()

        else:
            lc_messages = [SystemMessage(content=system_prompt)] + human_ai_messages
            response = await model.ainvoke(lc_messages)
            final_output = response.content
            usage = getattr(response, "usage_metadata", None)
            if usage:
                total_input_tokens  = usage.get("input_tokens", 0)
                total_output_tokens = usage.get("output_tokens", 0)

        if event_callback:
            await event_callback("agent_message", {"agent_name": agent_name, "content": final_output})

        # ── Persist token usage for the cost-monitoring panel ─────────────────
        try:
            from .token_tracker import record_usage
            record_usage(
                model=agent_config.get("model", "gpt-4o"),
                input_tokens=total_input_tokens,
                output_tokens=total_output_tokens,
                agent_name=agent_name,
            )
        except Exception:
            pass   # tracking must never block execution

        return {
            "output": final_output,
            "token_usage": {
                "input_tokens":  total_input_tokens,
                "output_tokens": total_output_tokens,
                "total_tokens":  total_input_tokens + total_output_tokens
            }
        }

    except Exception as e:
        if event_callback:
            await event_callback("agent_error", {"agent_name": agent_name, "error": str(e)})
        raise
