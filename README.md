# Yuno AI — Agent Orchestration Platform

A full-stack platform for creating, configuring, and orchestrating AI agents in collaborative multi-agent workflows. Agents run on a real LangGraph runtime, execute real tools, stream live events, and can be reached through Telegram.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           YUNO AI PLATFORM                                  │
│                                                                             │
│   ┌─────────────────┐    REST + Socket.IO    ┌─────────────────┐            │
│   │   FRONTEND       │ ◄───────────────────► │    BACKEND       │            │
│   │  React + Vite    │                       │  Node.js/Express │            │
│   │  MUI + Tailwind  │                       │  :3001           │            │
│   │  :5173           │                       └────────┬────────┘            │
│   └─────────────────┘                                │ HTTP + SSE           │
│                                                       ▼                     │
│                                            ┌─────────────────┐              │
│                                            │  AGENT RUNTIME   │              │
│                                            │  Python/FastAPI  │              │
│                                            │  LangGraph       │              │
│                                            │  :8000           │              │
│                                            └─────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
yuno-ai-agentic/
├── frontend/                      # React 18 + Vite + Tailwind + MUI
├── backend/                       # Node.js + Express + Socket.IO
├── agent-runtime/                 # Python + FastAPI + LangGraph
├── setup.sh / setup.ps1           # One-command dependency install
└── start.sh  / start.ps1          # One-command start (all 3 services)
```

---

## Three-Tier Stack

### 1. Frontend — React + Vite + Tailwind + Material UI (`:5173`)

```
frontend/
├── index.html
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── package.json
└── src/
    ├── App.jsx                        ← Router (React Router v6)
    ├── main.jsx                       ← MUI ThemeProvider + CssBaseline
    ├── index.css
    ├── components/
    │   ├── Layout/
    │   │   └── Layout.jsx             ← Responsive MUI sidebar
    │   │         • Mobile  (<600px)  → hamburger ☰ → slide-in Drawer
    │   │         • Tablet  (600–900px) → permanent 64px icon rail + tooltips
    │   │         • Desktop (≥900px)   → permanent 224px full sidebar
    │   ├── AgentCard/
    │   │   ├── AgentForm.jsx          ← Create / Edit agent
    │   │   └── TestAgentModal.jsx     ← Single-agent chat UI
    │   │         ├── POST /agent/intro   → dynamic greeting from orchestrator
    │   │         ├── POST /execute/agent → send message, stream response
    │   │         ├── Upload PDF / folder
    │   │         └── Export PDF / Excel
    │   ├── LogViewer/                 ← Scrollable live event log component
    │   └── WorkflowNode/
    │       ├── AgentNode.jsx          ← React Flow drag-drop node
    │       └── RunModal.jsx           ← Full-screen workflow chat runner
    │             ├── buildPlan()         topological sort → Q&A per tool
    │             ├── POST /workflow/validate → pre-flight input check
    │             ├── startRun()          sequential SSE per agent
    │             └── Human-in-the-loop   approve / stop between agents
    ├── pages/
    │   ├── Dashboard.jsx              ← Stats, recent runs, quick actions
    │   ├── Agents.jsx                 ← Agent list (CRUD)
    │   ├── AgentDetail.jsx            ← Agent detail + memory manager
    │   ├── Workflows.jsx              ← Workflow list + clone / delete
    │   ├── WorkflowBuilder.jsx        ← React Flow canvas (nodes + edges)
    │   ├── Monitoring.jsx             ← Live run logs + token usage
    │   ├── Autonomous.jsx             ← Autonomous orchestrator chat UI
    │   │         ├── POST /execute/autonomous → ReAct plan-act-observe loop
    │   │         └── Streams: goal → actions → observations → result
    │   ├── Channels.jsx               ← Telegram channel setup
    │   └── Messages.jsx               ← Full message inbox
    └── services/
        ├── api.js                     ← Axios → /api/* (backend :3001)
        └── socket.js                  ← Socket.IO client
```

---

### 2. Backend — Node.js + Express (`:3001`)

```
backend/
├── package.json
├── .env / .env.example
└── src/
    ├── index.js                       ← Express + HTTP server + Socket.IO
    │                                    auto-starts Telegram bot & cron scheduler
    ├── db/
    │   ├── database.js                ← SQLite / MSSQL connection + seed templates
    │   ├── schema.sql                 ← SQLite schema (7 tables)
    │   └── schema.mssql.sql           ← MSSQL-compatible schema
    ├── routes/
    │   ├── agents.js     /api/agents       ← Full CRUD + memory endpoints
    │   ├── workflows.js  /api/workflows    ← CRUD + run trigger + clone
    │   ├── runs.js       /api/runs         ← Run records, logs, stats
    │   ├── channels.js   /api/channels     ← Telegram / channel config
    │   └── email.js      /api/email        ← SMTP config
    ├── services/
    │   ├── executionService.js        ← Proxy: SSE stream → Python runtime
    │   ├── telegramService.js         ← Telegram bot (node-telegram-bot-api)
    │   └── agentSchedulerService.js   ← Cron scheduler (node-cron)
    ├── websocket/
    │   └── socketServer.js            ← Socket.IO: run:update, run:log, message:new
    └── middleware/
        └── errorHandler.js            ← Global error + 404
```

---

### 3. Agent Runtime — Python + FastAPI (`:8000`)

```
agent-runtime/
├── main.py                        ← FastAPI server — all HTTP endpoints
│   │
│   ├── POST /agent/intro             ← Dynamic agent greeting from orchestrator
│   ├── POST /workflow/validate       ← Pre-flight input validator
│   ├── POST /execute/agent           ← Direct agent call (sync JSON)
│   ├── POST /execute/agent/stream    ← Agent call with SSE streaming
│   ├── POST /execute/workflow        ← Multi-agent LangGraph workflow (SSE)
│   ├── POST /execute/autonomous      ← Autonomous ReAct orchestrator (SSE)
│   ├── GET  /tools                   ← List all registered tools
│   ├── GET  /download                ← Serve generated files from workspace
│   ├── POST /upload/pdf              ← Upload PDF to workspace
│   ├── POST /upload/files            ← Upload files / folder to workspace
│   ├── POST /export                  ← Export content → PDF or Excel
│   ├── POST /pdf/detect-fields       ← Detect form fields in a PDF
│   │         1. PyMuPDF native text + drawing extraction (exact coords)
│   │         2. OCR.space Engine 2 (labels) + Engine 1 (word bboxes)
│   │         3. GPT-4o-mini extracts field labels + CHECKBOX groups
│   │         4. Matches labels → drawn rectangles (fill boxes) via
│   │            _nearest_text_box / _nearest_cb_box helpers
│   │         5. Saves cache: {pdf}.yuno_fields.json (labels + fill coords)
│   │         6. Falls back to geometry script if OCR+GPT fails
│   ├── POST /pdf/debug-fields        ← Return cached field coordinates (debug)
│   └── GET  /health                  ← Health check
│
├── requirements.txt
├── .env / .env.example
│
├── runtime/
│   ├── __init__.py
│   ├── agent_executor.py
│   │   ├── _build_scope_lock()       ← Strict role/tool constraint injected into
│   │   │                               every system prompt at build time
│   │   ├── build_agent()             ← ChatOpenAI + tools + scope-locked prompt
│   │   └── run_agent()               ← Streams: tool_call → tool_result → agent_message
│   │
│   ├── orchestrator.py
│   │   ├── generate_agent_intro()    ← Reads system_prompt+tools → LLM greeting
│   │   ├── list_available_agents()
│   │   ├── delegate_to_agent()       ← Calls run_agent() on a registered agent
│   │   ├── spawn_agent()             ← Creates temporary agents on-the-fly
│   │   ├── evaluate_goal_completion()
│   │   └── run_autonomous()          ← ReactAgent: plan → act → observe → adapt
│   │
│   ├── langgraph_runner.py
│   │   ├── WorkflowState             ← TypedDict shared across all nodes
│   │   ├── TOOL_CONTEXT_HINTS        ← Injects structured inputs per tool
│   │   ├── _build_upstream_context() ← Passes prev agent output to next
│   │   └── execute_langgraph_workflow()
│   │         sequential | conditional routing | parallel fan-out
│   │
│   ├── workflow_validator.py
│   │   ├── TOOL_VALIDATORS           ← per-tool required fields map
│   │   └── validate_workflow_inputs() ← returns list of validation errors
│   │
│   ├── memory/                       ← Agent memory store (runtime)
│   │   └── __init__.py
│   │
│   └── tools/
│       ├── __init__.py               ← AVAILABLE_TOOLS registry
│       ├── web_search.py             ← DuckDuckGo (no API key needed)
│       ├── calculator.py             ← Safe AST math evaluation
│       ├── http_request.py           ← GET / POST / PUT / DELETE
│       ├── code_executor.py          ← Sandboxed code runner
│       ├── datetime_tool.py          ← Current date / time / timezone
│       ├── github_tool.py            ← Clone repos, read files, run shell
│       ├── sandbox_executor.py       ← Isolated Python venv + pip + run
│       ├── pdf_form_detector.py      ← Detect PDF form fields (tool wrapper)
│       ├── pdf_form_filler.py        ← Fill PDF form fields (coordinate-based)
│       │       ├── Reads {pdf}.yuno_fields.json cache written by detect-fields
│       │       ├── Pass 0: AcroForm widget fill (fillable PDFs)
│       │       ├── Pass 1: Drawn-rect coordinate fill (flat/designed PDFs)
│       │       ├── Checkboxes: vector X drawn via _draw_x_mark()
│       │       └── Fallback chain: cache → geometry → GPT-4o vision → OCR
│       ├── email_tool.py             ← send, send_pdf, schedule email
│       ├── google_calendar_tool.py   ← list / create / update / delete events
│       ├── google_drive_tool.py      ← upload files to Drive folders
│       ├── file_folder_tool.py       ← list / read uploaded files
│       └── ats_resume_tool.py        ← ATS resume scorer
│
├── scripts/
│   ├── detect_form_fields.py         ← Geometry-based field detection
│   │       Pass 0: AcroForm widgets  (fillable PDFs)
│   │       Pass 1: Box-grid via OpenCV + pytesseract
│   │       Pass 2: Drawn underlines  (PyMuPDF vector data)
│   │       Pass 3: Text underscores
│   ├── test_pdf_coords.py            ← Diagnostic: print all words + drawings
│   └── test_field_matching.py        ← Simulate label→rect matching + show fill pos
│
└── workspace/
    ├── uploads/                      ← Uploaded PDFs + generated filled forms
    │   └── *.yuno_fields.json        ← Cached field-detection results (per PDF)
    └── small_projects/
        └── repo/                     ← Cloned GitHub repos (github_tool)
```

---

## PDF Form Pipeline

The PDF form workflow uses two linked tools with a shared coordinate cache:

```
UI uploads PDF
      │
      ▼
POST /pdf/detect-fields
      │  1. PyMuPDF page.get_text("words")   ← exact label positions
      │  2. PyMuPDF page.get_drawings()       ← drawn fill boxes + checkboxes
      │  3. OCR.space Engine 2 (text quality) → GPT-4o-mini → field labels
      │  4. _label_bbox(label, fitz_words)    ← locate each label in PDF coords
      │  5. _nearest_text_box(label_bb)       ← snap fill pos to drawn rectangle
      │  6. _nearest_cb_box(option_bb)        ← snap checkbox to drawn square
      │  7. Save {pdf}.yuno_fields.json       ← labels + exact fill coordinates
      │
      ▼
UI shows field labels → user fills values
      │
      ▼
fill_pdf_form(pdf_path, user_data)
      │  Pass 0: AcroForm widget API         (fillable PDFs)
      │  Pass 1-3: insert_text at cached x,y (flat/designed PDFs)
      │  Checkboxes: _draw_x_mark() vector X
      │
      ▼
Filled PDF saved to workspace/uploads/filled_*.pdf
```

**Supported PDF types:**
| Type | Detection | Fill method |
|------|-----------|-------------|
| AcroForm (fillable) | widget API | `widget.field_value` |
| Flat / designed (Canva, Word-to-PDF) | PyMuPDF drawings + OCR | `page.insert_text()` at drawn-rect coords |
| Scanned / image PDF | OCR.space overlay coords | `page.insert_text()` at scaled coords |

---

## Database Schema

```
agents              workflows           workflow_runs
──────────          ──────────────      ──────────────
id (PK)             id (PK)             id (PK)
name                name                workflow_id (FK)
role                nodes (JSON)        status
system_prompt       edges (JSON)        input  (JSON)
model               trigger_type        output (JSON)
tools (JSON)        trigger_config      token_usage
schedule (cron)     is_template         started_at
temperature         status              completed_at
max_tokens
guardrails (JSON)   run_logs            agent_memory
channel_id          ──────────────      ──────────────
memory_enabled      run_id (FK)         agent_id (FK)
                    agent_name          key
channels            level / type        value
──────────────      message             memory_type
type                data (JSON)
config (JSON)       messages
agent_id (FK)       ──────────
is_active           channel / chat_id
                    direction
                    content / metadata
```

---

## Execution Modes

| Mode | Entry point | Engine | When to use |
|------|------------|--------|-------------|
| **Single Agent** | TestAgentModal | `agent_executor.run_agent()` | Test / use one agent directly |
| **Workflow** | RunModal → Play | `langgraph_runner` StateGraph | Fixed multi-agent pipeline |
| **Autonomous** | Autonomous page | `orchestrator.run_autonomous()` | LLM plans the entire execution itself |

---

## Agent Scope Lock

Every agent automatically receives a **strict scope constraint** appended to its system prompt at runtime:

```
## STRICT SCOPE — MY AGENT
You are exclusively configured as: github_assistant.
Your ONLY permitted tools are:
  • GitHub — clone repos, read files, run shell commands

HARD RULES:
1. Use ONLY the tools listed above.
2. Stay within your role. Do not do work meant for other agents.
3. If out-of-scope → reply: "I am <name>, configured only for <role>.
   This is outside my scope."
4. Never fabricate tool results. Report errors honestly.
```

---

## Workflow Validation

Before any agent runs, `POST /workflow/validate` checks all collected inputs:

| Tool | Validated fields |
|------|-----------------|
| `pdf_analyzer` | PDF uploaded, fill data present |
| `email` | Valid email format (regex) |
| `github` | Task present, URL format if provided |
| `google_calendar` | Valid service-account JSON (type + client_email + private_key) |
| `google_drive` | Same JSON check |
| `web_search` | Topic present |
| `calculator` | Expression present |
| `sandbox_exec` | Task / code present |

Errors are grouped by agent and shown in the chat before execution starts.

---

## Agent Tools

| Tool key | File | Capability |
|----------|------|-----------|
| `web_search` | `web_search.py` | DuckDuckGo — real-time web results |
| `calculator` | `calculator.py` | Safe AST math (arithmetic, %, powers) |
| `http_request` | `http_request.py` | GET / POST / PUT / DELETE to any URL |
| `code_executor` | `code_executor.py` | Sandboxed code snippets |
| `datetime` | `datetime_tool.py` | Current date, time, timezone |
| `github` | `github_tool.py` | Clone repos, browse files, run shell in workspace |
| `sandbox_exec` | `sandbox_executor.py` | Isolated Python venv — pip install + run code |
| `pdf_form_detect` | `pdf_form_detector.py` | Detect form fields (AcroForm + flat PDF via OCR) |
| `pdf_form_fill` | `pdf_form_filler.py` | Fill PDF forms using cached coordinate data |
| `email` | `email_tool.py` | Send email with optional PDF attachment |
| `google_calendar` | `google_calendar_tool.py` | List / create / update / delete calendar events |
| `google_drive` | `google_drive_tool.py` | Upload generated files to Drive folder |
| `folder_files` | `file_folder_tool.py` | List and read uploaded files / folders |
| `ats_resume` | `ats_resume_tool.py` | Score a resume against a job description |

---

## API Reference

### Backend (`http://localhost:3001`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List all agents |
| `POST` | `/api/agents` | Create agent |
| `PUT` | `/api/agents/:id` | Update agent |
| `DELETE` | `/api/agents/:id` | Delete agent |
| `GET` | `/api/agents/:id/memory` | Get agent memory |
| `POST` | `/api/agents/:id/memory` | Set memory key |
| `GET` | `/api/workflows` | List workflows |
| `POST` | `/api/workflows` | Create workflow |
| `PUT` | `/api/workflows/:id` | Update workflow |
| `DELETE` | `/api/workflows/:id` | Delete workflow |
| `POST` | `/api/workflows/:id/run` | Trigger workflow run |
| `GET` | `/api/runs` | List runs |
| `GET` | `/api/runs/:id/logs` | Get run logs |
| `GET` | `/api/runs/stats/summary` | Token usage stats |
| `GET` | `/api/channels` | List channels |
| `POST` | `/api/channels` | Create channel |
| `GET` | `/api/messages` | List messages |

### Agent Runtime (`http://localhost:8000`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/agent/intro` | Generate dynamic agent greeting |
| `POST` | `/workflow/validate` | Validate workflow inputs |
| `POST` | `/execute/agent` | Run agent (sync JSON) |
| `POST` | `/execute/agent/stream` | Run agent (SSE) |
| `POST` | `/execute/workflow` | Run multi-agent workflow (SSE) |
| `POST` | `/execute/autonomous` | Autonomous ReAct orchestrator (SSE) |
| `GET` | `/tools` | List available tools |
| `POST` | `/upload/pdf` | Upload PDF to workspace |
| `POST` | `/upload/files` | Upload files / folder |
| `GET` | `/download` | Download generated file |
| `POST` | `/export` | Export content → PDF or Excel |
| `POST` | `/pdf/detect-fields` | Detect + cache form fields (OCR + PyMuPDF) |
| `POST` | `/pdf/debug-fields` | Return cached field coordinates (debug) |
| `GET` | `/health` | Health check |

---

## End-to-End Walkthrough

### Multi-agent workflow
1. **Create agents** → Agents → New Agent
   - Create a **"Researcher"** with `web_search` + `calculator` tools
   - Create a **"Report Writer"** with no tools

2. **Build a workflow** → Workflows → New Workflow
   - Add Researcher node → Add Report Writer node
   - Draw edge: Researcher → Report Writer → Save

3. **Run it** → click ▶ Run on the workflow
   - Orchestrator collects required inputs (search topic, etc.)
   - Validates all inputs via `/workflow/validate`
   - Streams live events in the terminal panel
   - Pauses between agents for human-in-the-loop approval
   - Final output can be exported as PDF or Excel

### Single agent
4. **Test a single agent** → Agents → click Test
   - Orchestrator calls `/agent/intro` → generates a tool-aware greeting
   - Chat with the agent directly; upload PDFs, export responses

### Autonomous mode
5. **Run autonomously** → Autonomous page
   - Type a high-level goal ("Research X and email me a summary")
   - The ReAct orchestrator plans steps, selects agents, executes them in sequence
   - Streams each plan → action → observation loop live

### Messaging & scheduling
6. **Set up Telegram** → Channels → Add Channel
   - Paste bot token, assign an agent
   - Messages from Telegram appear in the Messages tab

7. **Schedule an agent** → Agents → Edit → set a cron schedule
   - e.g. `0 9 * * 1-5` runs every weekday at 9 AM
   - Run records appear in Monitoring automatically

---

## Extending the Platform

### Add a new tool
1. Create `agent-runtime/runtime/tools/my_tool.py` with a `@tool` decorated function
2. Import and register it in `agent-runtime/runtime/tools/__init__.py` under `AVAILABLE_TOOLS`
3. Optionally add an entry to `TOOL_VALIDATORS` in `workflow_validator.py` for input validation
4. The tool name appears automatically in the agent form UI

### Add a new messaging channel
1. Create a service in `backend/src/services/` (e.g. `slackService.js`)
2. Add routes in `backend/src/routes/channels.js`
3. Add a UI form case in `frontend/src/pages/Channels.jsx`
4. The Python runtime is channel-agnostic — it only receives and returns text

### Add a workflow template
Edit `backend/src/db/database.js` → `seedTemplates()`. Add a `db.prepare(...).run(...)` block with `nodes`, `edges`, and `is_template: 1`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 5, Tailwind CSS 3, Material UI 9, React Flow (@xyflow/react), Recharts, Lucide Icons, Axios, Socket.IO client, react-hot-toast |
| Backend | Node.js, Express 4, Socket.IO 4, node-cron, node-telegram-bot-api, nodemailer, SQLite / MSSQL |
| Agent Runtime | Python 3.10+, FastAPI, uvicorn, LangChain 0.3, LangGraph 0.2, OpenAI SDK |
| LLM | OpenAI GPT-4o / GPT-4o-mini (via LangChain) |
| PDF Pipeline | PyMuPDF (fitz) — native text + drawing extraction; OCR.space API (Engine 1 + 2); GPT-4o-mini label parsing; GPT-4o vision fallback |
| Tools | DuckDuckGo Search, GitPython, fpdf2, openpyxl, google-api-python-client, httpx |
| Streaming | Server-Sent Events (SSE) — Python → Node.js → WebSocket → Browser |
| Real-time | Socket.IO — run logs, status updates, message inbox |

---

## Environment Variables

### `agent-runtime/.env`
```env
OPENAI_API_KEY=sk-...
OCR_SPACE_API_KEY=...          # Required for PDF form detection on flat/designed PDFs
```

### `backend/.env`
```env
PORT=3001
RUNTIME_URL=http://localhost:8000
DB_TYPE=sqlite                  # or mssql
SQLITE_PATH=./yuno_ai.db
# MSSQL settings (if DB_TYPE=mssql):
# DB_HOST=...  DB_PORT=...  DB_USER=...  DB_PASSWORD=...  DB_NAME=...
```

### `frontend` (configured in `vite.config.js`)
- Dev proxy: `/api` → `http://localhost:3001`
- Dev proxy: `/runtime` → `http://localhost:8000`
