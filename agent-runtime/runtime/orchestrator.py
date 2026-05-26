"""
Autonomous LLM Orchestrator
===========================
The LLM IS the orchestrator. It receives a high-level goal and autonomously:
  1. Plans what agents/tools are needed
  2. Delegates tasks to specialist agents
  3. Evaluates the results
  4. Retries or adjusts strategy if results are unsatisfactory
  5. Decides when the goal is fully achieved

This is true agentic AI — no human-designed workflow, no fixed pipeline.
The LLM makes every routing decision at runtime.
"""
import os
import json
import asyncio
from typing import Callable, Awaitable, Any
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from .tools import get_tools_for_agent


# ── Orchestrator system prompt ────────────────────────────────────────────────

ORCHESTRATOR_PROMPT = """You are an autonomous AI orchestrator. Your job is to achieve goals by intelligently planning and delegating work to specialist agents and tools.

When given a goal:
1. THINK: Break the goal into concrete steps. What information do you need first?
2. ACT: Use your tools — call agents, search the web, run code, read files.
3. OBSERVE: Evaluate the results. Did they fully answer the need?
4. ADAPT: If results are insufficient, try a different approach. Don't give up after one failure.
5. SYNTHESIZE: When you have enough information, produce a final comprehensive answer.

Key principles:
- You are fully autonomous. Do not ask the user for clarification — make reasonable assumptions.
- Use agents in the right sequence: gather information first, then process, then report.
- If an agent fails, try again with a different prompt or try an alternative approach.
- Pass context between agents — earlier results should inform later agents.
- Always end with a complete, self-contained answer that directly addresses the original goal.

Available specialist agents and tools are listed below. Choose wisely based on what the task requires."""


# ── Orchestrator tools (these ARE the agents) ─────────────────────────────────

def build_orchestrator_tools(
    registered_agents: list[dict],
    api_key: str,
    event_callback: Callable,
    call_results: dict,
):
    """
    Dynamically build orchestrator tools from the registered agents + built-in tools.
    Each agent becomes a callable tool the orchestrator LLM can invoke.
    """
    tools = []

    # ── Tool 1: List available agents ─────────────────────────────────────────
    agent_registry = [
        {
            "id": a.get("id"),
            "name": a.get("name"),
            "role": a.get("role"),
            "description": a.get("description") or a.get("system_prompt", "")[:120],
            "tools": a.get("tools", []),
            "model": a.get("model", "gpt-4o"),
        }
        for a in registered_agents
    ]

    @tool
    def list_available_agents() -> str:
        """List all specialist agents available for delegation. Call this first to understand what capabilities exist."""
        if not agent_registry:
            return "No agents registered. Use built-in tools directly."
        lines = []
        for a in agent_registry:
            tools_str = ", ".join(a["tools"]) if a["tools"] else "no tools"
            lines.append(
                f"• [{a['name']}] (id={a['id']})\n"
                f"  Role: {a['role']} | Tools: {tools_str}\n"
                f"  Description: {a['description']}"
            )
        return "AVAILABLE AGENTS:\n\n" + "\n\n".join(lines)

    tools.append(list_available_agents)

    # ── Tool 2: Delegate task to a registered agent ────────────────────────────
    @tool
    def delegate_to_agent(agent_id: str, task: str, context: str = "") -> str:
        """
        Delegate a specific task to a registered specialist agent and get its output.
        agent_id: the agent's ID from list_available_agents
        task: clear, specific instruction for what this agent should do
        context: optional context from previous steps to pass to this agent
        The agent will use all its configured tools autonomously to complete the task.
        """
        agent = next((a for a in registered_agents if a.get("id") == agent_id), None)
        if not agent:
            return f"Agent '{agent_id}' not found. Use list_available_agents to see valid IDs."

        # Run in the event loop — we're already in an async context via asyncio.run_coroutine_threadsafe
        result = asyncio.get_event_loop().run_until_complete(
            _run_agent_sync(agent, task, context, api_key, event_callback)
        )
        call_results[agent_id] = result
        return result

    tools.append(delegate_to_agent)

    # ── Tool 3: Run an on-the-fly agent (no registration needed) ─────────────
    @tool
    def spawn_agent(
        name: str,
        role: str,
        system_prompt: str,
        task: str,
        tool_names: str = "",
        context: str = "",
    ) -> str:
        """
        Spawn a temporary specialist agent with a custom prompt and run it immediately.
        Use this when no registered agent exactly fits the need.
        name: descriptive name (e.g. 'DataParser', 'ErrorAnalyzer')
        role: agent role (e.g. 'analyst', 'writer', 'researcher')
        system_prompt: detailed instructions for this agent's behavior
        task: the specific task to execute right now
        tool_names: comma-separated tool names (web_search, calculator, github, sandbox_exec, etc.)
        context: optional context from previous steps
        """
        tool_list = [t.strip() for t in tool_names.split(",") if t.strip()]
        agent_cfg = {
            "name": name,
            "role": role,
            "system_prompt": system_prompt,
            "model": "gpt-4o",
            "tools": tool_list,
            "temperature": 0.3,
            "max_tokens": 3000,
        }
        result = asyncio.get_event_loop().run_until_complete(
            _run_agent_sync(agent_cfg, task, context, api_key, event_callback)
        )
        return result

    tools.append(spawn_agent)

    # ── Tool 4: Evaluate if goal is achieved ──────────────────────────────────
    @tool
    def evaluate_goal_completion(goal: str, results_so_far: str) -> str:
        """
        Critically evaluate whether the original goal has been fully achieved.
        Use this before giving a final answer to check you haven't missed anything.
        goal: the original goal
        results_so_far: summary of what has been accomplished
        Returns: COMPLETE (with reason) or INCOMPLETE (with what's missing)
        """
        evaluation_prompt = f"""
Original goal: {goal}

Results achieved so far:
{results_so_far}

Evaluate critically:
1. Is the goal fully achieved? What specifically was accomplished?
2. What's missing or incomplete?
3. Are the results accurate and reliable?

Respond with:
COMPLETE: [what was accomplished and why it fully satisfies the goal]
or
INCOMPLETE: [what specific aspects are still missing and need more work]
"""
        # This runs a quick GPT call for self-evaluation
        result = asyncio.get_event_loop().run_until_complete(
            _quick_llm_call(evaluation_prompt, api_key)
        )
        return result

    tools.append(evaluate_goal_completion)

    # ── Also give orchestrator direct access to core tools ────────────────────
    core_tools = get_tools_for_agent(
        ["web_search", "calculator", "datetime", "github", "sandbox_exec", "pdf_analyzer"]
    )
    tools.extend(core_tools)

    return tools


# ── Async helpers ─────────────────────────────────────────────────────────────

async def _run_agent_sync(
    agent_cfg: dict,
    task: str,
    context: str,
    api_key: str,
    event_callback: Callable,
) -> str:
    from .agent_executor import run_agent

    messages = [{"role": "user", "content": task}]
    if context:
        messages.insert(0, {
            "role": "user",
            "content": f"Context from previous steps:\n{context}\n\n"
        })

    async def cb(event_type: str, data: dict):
        data["delegated_from"] = "orchestrator"
        await event_callback(event_type, data)

    try:
        result = await run_agent(agent_cfg, messages, api_key, None, cb)
        return result.get("output", "No output produced.")
    except Exception as e:
        return f"Agent execution failed: {e}"


async def _quick_llm_call(prompt: str, api_key: str) -> str:
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage
    model = ChatOpenAI(model="gpt-4o-mini", api_key=api_key, temperature=0.1)
    response = await model.ainvoke([HumanMessage(content=prompt)])
    return response.content


# ── Agent intro generator ─────────────────────────────────────────────────────

async def generate_agent_intro(agent_config: dict, api_key: str) -> str:
    """
    Called by the orchestrator when an agent starts.
    Reads the agent's system_prompt and tools[], then uses the LLM to
    generate a dynamic, context-aware greeting instead of a hardcoded one.
    """
    name        = agent_config.get("name", "Agent")
    role        = agent_config.get("role", "assistant")
    system_prompt = agent_config.get("system_prompt", "")
    tools       = agent_config.get("tools", [])

    tool_summary = ", ".join(tools) if tools else "no special tools"

    prompt = f"""You are generating the FIRST greeting message for an AI agent when a user opens a chat with it.

Agent details:
- Name: {name}
- Role: {role}
- System prompt: {system_prompt[:600]}
- Connected tools: {tool_summary}

Write a SHORT (2-3 sentence) friendly greeting that:
1. Introduces the agent by name
2. Briefly states what it can do based on its system prompt and tools
3. Invites the user to get started with a relevant prompt hint

Be specific to the actual tools and purpose — NOT generic. Do not say "How can I help you?" alone.
Return ONLY the greeting text, no quotes, no labels."""

    try:
        greeting = await _quick_llm_call(prompt, api_key)
        return greeting.strip()
    except Exception:
        # Fallback: build a decent greeting from the config without LLM
        if tools:
            tool_labels = {
                "github": "clone & explore GitHub repos",
                "web_search": "search the web",
                "calculator": "do math",
                "email": "send emails",
                "google_calendar": "manage your calendar",
                "google_drive": "work with Google Drive",
                "sandbox_exec": "run code safely",
                "pdf_analyzer": "read & fill PDF forms",
                "datetime": "handle dates and times",
            }
            caps = [tool_labels.get(t, t) for t in tools]
            cap_str = ", ".join(caps)
            return f"Hi! I'm {name}. I can {cap_str}. What would you like to do?"
        return f"Hi! I'm {name}. {system_prompt[:120] or 'How can I help you?'}"


# ── Main orchestrator entry point ─────────────────────────────────────────────

async def run_autonomous(
    goal: str,
    registered_agents: list[dict],
    api_key: str,
    event_callback: Callable[[str, dict], Awaitable[None]],
    max_iterations: int = 20,
) -> dict:
    """
    Run the autonomous orchestrator on a high-level goal.
    The LLM decides the entire plan and execution autonomously.

    goal: high-level objective (e.g. "Find and fix bugs in this GitHub repo")
    registered_agents: list of available specialist agents from the database
    api_key: OpenAI API key
    event_callback: streaming callback for UI updates
    """
    await event_callback("orchestrator_start", {
        "goal": goal,
        "available_agents": len(registered_agents),
        "message": f"Orchestrator started. Goal: {goal[:100]}"
    })

    call_results: dict[str, str] = {}

    # Build the orchestrator's tool set
    tools = build_orchestrator_tools(
        registered_agents=registered_agents,
        api_key=api_key,
        event_callback=event_callback,
        call_results=call_results,
    )

    # Build the system prompt with agent registry summary
    agent_summary = ""
    if registered_agents:
        names = [a.get("name", "?") for a in registered_agents]
        agent_summary = f"\n\nYou have {len(registered_agents)} registered agents: {', '.join(names)}. Use list_available_agents for details."

    full_prompt = ORCHESTRATOR_PROMPT + agent_summary

    model = ChatOpenAI(
        model="gpt-4o",
        api_key=api_key,
        temperature=0.1,   # low temperature = more deterministic planning
        max_tokens=4000,
    )

    orchestrator_agent = create_react_agent(model, tools, prompt=full_prompt)

    # Stream events
    total_input  = 0
    total_output = 0

    state = {"messages": [{"role": "user", "content": goal}]}

    async for event in orchestrator_agent.astream_events(state, version="v2"):
        kind = event.get("event", "")

        if kind == "on_tool_start":
            tool_name  = event.get("name", "unknown")
            tool_input = event.get("data", {}).get("input", {})
            await event_callback("orchestrator_action", {
                "action":     tool_name,
                "input":      str(tool_input)[:300],
                "agent_name": "Orchestrator",
                "message":    f"→ {tool_name}({str(tool_input)[:200]})"
            })

        elif kind == "on_tool_end":
            tool_name   = event.get("name", "unknown")
            tool_output = str(event.get("data", {}).get("output", ""))[:400]
            await event_callback("orchestrator_observation", {
                "tool":       tool_name,
                "output":     tool_output,
                "agent_name": "Orchestrator",
                "message":    f"← {tool_name} returned: {tool_output[:150]}"
            })

        elif kind == "on_chat_model_end":
            usage = getattr(event.get("data", {}).get("output"), "usage_metadata", None)
            if usage:
                total_input  += usage.get("input_tokens",  0)
                total_output += usage.get("output_tokens", 0)

    # Get final answer
    result = await orchestrator_agent.ainvoke(state)
    msgs = result.get("messages", [])
    final_answer = msgs[-1].content if msgs else "No answer produced."

    await event_callback("orchestrator_complete", {
        "answer":     final_answer[:500],
        "agent_name": "Orchestrator",
        "message":    "Goal achieved. Orchestrator complete."
    })

    return {
        "output":  final_answer,
        "results_by_agent": call_results,
        "token_usage": {
            "input_tokens":  total_input,
            "output_tokens": total_output,
            "total_tokens":  total_input + total_output,
        }
    }
