/**
 * WorkflowChatRunner — Full-screen conversational workflow orchestrator.
 *
 * Phases: intro → qa → confirm → running → done | error
 *
 * The orchestrator asks one question at a time for each agent's required inputs
 * (in topological order), shows a plan, then streams execution events from the
 * Python runtime directly via SSE. Live events appear in the right terminal panel.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Send, Bot, User, Play, Paperclip, Loader,
  Terminal, Download, FileText, Zap,
} from 'lucide-react';
import axios from 'axios';
import { runsApi } from '../../services/api.js';

const PYTHON_API   = 'http://localhost:8000';
const BACKEND_API  = 'http://localhost:3001';

// ── Tool registry — label, description (mirrors Python tool), required inputs ──
//
// Each `inputs` entry has:
//   key        – stored in `collected` state
//   inputType  – 'text' | 'textarea' | 'file'
//   question   – fn(agentName, agentSystemPrompt) → string shown in chat
//   optional   – if true, user may skip

const TOOL_META = {
  pdf_analyzer: {
    label: 'PDF Analyzer & Filler',
    description: 'Detects form fields in PDF documents (any PDF — bank forms, applications, contracts) and fills them with the data you provide.',
    inputs: [
      {
        key: 'pdf_path',
        inputType: 'file',
        question: (agentName) =>
          `${agentName} is using the PDF Analyzer & Filler tool.\n\nTool purpose: Scans the PDF for all form fields across every page, then fills each field with the data you provide — works with any PDF.\n\nStep 1 of 2 — Please upload the PDF file:`,
        required: true,
      },
      {
        key: 'pdf_fill_data',
        inputType: 'textarea',
        question: () =>
          `Step 2 of 2 — What information should I fill into the PDF?\n\nPaste the data as JSON key-value pairs:\n  {"Name": "John Doe", "Account No": "123456", "Date": "2024-01-15"}\n\nOr describe it in plain text — the AI will automatically map your values to the correct form fields.`,
        required: true,
      },
    ],
  },

  email: {
    label: 'Email Sender',
    description: 'Sends emails with optional file attachments (filled PDFs, Excel reports, etc.) using the configured SMTP server.',
    inputs: [
      {
        key: 'recipient_emails',
        inputType: 'text',
        question: (agentName) =>
          `${agentName} is using the Email Sender tool.\n\nTool purpose: Delivers the workflow results via email and can automatically attach generated files like filled PDFs.\n\nWho should receive the email?\n(Enter one address or multiple separated by commas)`,
        required: true,
      },
    ],
  },

  calculator: {
    label: 'Calculator',
    description: 'Evaluates mathematical expressions — arithmetic, percentages, powers, modulo, and more.',
    inputs: [
      {
        key: 'goal',
        inputType: 'text',
        question: (agentName) =>
          `${agentName} is using the Calculator tool.\n\nTool purpose: Evaluates mathematical expressions safely (e.g. 2 ** 10, 15% of 3500, (120 * 5) / 4).\n\nWhat would you like me to calculate?`,
        required: true,
      },
    ],
  },

  web_search: {
    label: 'Web Search',
    description: 'Searches the internet for real-time information and returns titles, URLs, and summaries of top results.',
    inputs: [
      {
        key: 'search_topic',
        inputType: 'text',
        question: (agentName) =>
          `${agentName} is using the Web Search tool.\n\nTool purpose: Finds current information from the web — news, documentation, market data, anything publicly available.\n\nWhat topic or keywords should I search for?`,
        required: true,
      },
    ],
  },

  google_calendar: {
    label: 'Google Calendar',
    description: 'Lists, creates, updates, and deletes Google Calendar events using a service account with secure per-request credentials.',
    inputs: [
      {
        key: 'calendar_credentials',
        inputType: 'textarea',
        question: (agentName) =>
          `${agentName} is using the Google Calendar tool.\n\nTool purpose: Reads and manages your Google Calendar — create meetings, find free slots, update or cancel events.\n\nThis tool requires a Service Account JSON key (credentials never stored on the server).\n\nPaste your Service Account JSON:`,
        required: true,
      },
      {
        key: 'calendar_task',
        inputType: 'text',
        question: () =>
          `What calendar operation would you like to perform?\n\nExamples:\n  • "Show my meetings this week"\n  • "Schedule a team standup tomorrow at 10am for 30 minutes"\n  • "Find free slots for a 1-hour meeting next Monday"\n  • "Cancel the meeting titled Project Review"`,
        required: true,
      },
    ],
  },

  google_drive: {
    label: 'Google Drive',
    description: 'Uploads generated files such as filled PDFs to a Google Drive folder.',
    inputs: [
      {
        key: 'calendar_credentials',
        inputType: 'textarea',
        question: (agentName) =>
          `${agentName} is using the Google Drive tool.\n\nTool purpose: Uploads generated files to Google Drive folders.\n\nThis tool requires a Service Account JSON key. Share the destination Drive folder with the service account email as Editor.\n\nPaste your Service Account JSON:`,
        required: true,
      },
    ],
  },

  github: {
    label: 'GitHub Integration',
    description: 'Clones GitHub repositories, browses files, reads code, and runs shell commands inside the workspace.',
    inputs: [
      {
        key: 'github_task',
        inputType: 'text',
        question: (agentName) =>
          `${agentName} is using the GitHub Integration tool.\n\nTool purpose: Clones any public or private repository and lets the agent read files, analyze code, and run shell commands inside it.\n\nWhat would you like me to do with the repository?\n(e.g. "Analyze code quality", "Find all TODO comments", "List all Python files and their line counts")`,
        required: true,
      },
      {
        key: 'github_repo',
        inputType: 'text',
        question: () =>
          `What repository should I work with?\n(e.g. https://github.com/user/repo — optional if the URL is in your task above, press Enter to skip)`,
        required: false,
        optional: true,
      },
    ],
  },

  sandbox_exec: {
    label: 'Python Sandbox',
    description: 'Creates an isolated Python environment, installs packages, and runs code safely without affecting the host system.',
    inputs: [
      {
        key: 'sandbox_task',
        inputType: 'textarea',
        question: (agentName) =>
          `${agentName} is using the Python Sandbox tool.\n\nTool purpose: Creates an isolated Python environment, installs any needed packages, and runs your code safely.\n\nWhat should I code or compute?\n(Describe the task or paste code directly. Examples: "Calculate prime numbers up to 1000", "Parse a CSV and find the top 10 values", "Create a Fibonacci sequence up to the 20th term")`,
        required: true,
      },
      {
        key: 'workspace_name',
        inputType: 'text',
        question: () =>
          `What should I name the sandbox workspace? (optional — press Enter to use a generated name)`,
        required: false,
        optional: true,
      },
    ],
  },

  http_request: {
    label: 'HTTP Request',
    description: 'Makes HTTP calls to external APIs and web services — GET, POST, PUT, DELETE with custom headers and body.',
    inputs: [
      {
        key: 'http_task',
        inputType: 'text',
        question: (agentName) =>
          `${agentName} is using the HTTP Request tool.\n\nTool purpose: Makes HTTP requests to any URL or API and processes the response.\n\nWhat URL or API should I call, and what should I do with the response?\n(e.g. "GET https://api.github.com/users/octocat and summarize the profile" — optional, press Enter to skip)`,
        required: false,
        optional: true,
      },
    ],
  },

  code_executor: {
    label: 'Code Executor',
    description: 'Executes code snippets in a sandboxed runtime environment.',
    inputs: [
      {
        key: 'code_task',
        inputType: 'textarea',
        question: (agentName) =>
          `${agentName} is using the Code Executor tool.\n\nTool purpose: Executes code snippets and returns results — useful for data processing, calculations, and transformations.\n\nWhat should I execute or compute?\n(Paste code directly, or describe the computation you need)`,
        required: true,
      },
    ],
  },

  // Fully autonomous — no user input needed
  datetime: { label: 'Date & Time', description: 'Provides the current date, time, and timezone information.', inputs: [] },
};

// ── Topology helpers ──────────────────────────────────────────────────────────

function topoSort(nodes, edges) {
  const deg = {}; const adj = {};
  nodes.forEach(n => { deg[n.id] = 0; adj[n.id] = []; });
  edges.forEach(e => {
    if (e.source && e.target) {
      adj[e.source].push(e.target);
      deg[e.target] = (deg[e.target] || 0) + 1;
    }
  });
  const queue = nodes.filter(n => !deg[n.id]).map(n => n.id);
  const out = []; const seen = new Set();
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    const node = nodes.find(n => n.id === cur);
    if (node) { out.push(node); (adj[cur] || []).forEach(t => queue.push(t)); }
  }
  return out;
}

function buildPlan(workflow) {
  const nodes = workflow.nodes || [];
  const edges = workflow.edges || [];
  const agentOrder = topoSort(nodes, edges);
  const seenKeys = new Set();
  const questions = [];

  for (const node of agentOrder) {
    const cfg       = node.data?.agentConfig || {};
    const tools     = cfg.tools || [];
    const agentName = cfg.name || 'Agent';
    const sysprompt = cfg.system_prompt || '';

    for (const tool of tools) {
      const meta = TOOL_META[tool];
      if (!meta) continue;

      for (const inp of meta.inputs) {
        if (seenKeys.has(inp.key)) continue;
        seenKeys.add(inp.key);
        questions.push({
          agentName,
          tool,
          toolLabel: meta.label,
          key:        inp.key,
          inputType:  inp.inputType,
          q:          inp.question(agentName, sysprompt),
          optional:   inp.optional || false,
        });
      }
    }
  }

  return { agentOrder, questions };
}

// ── Email draft parser ────────────────────────────────────────────────────────
// Tries to extract Subject + Body from the drafter agent's text output.
// Falls back gracefully when the agent didn't use strict "Subject:" formatting.

function parseEmailDraft(text = '', recipientEmails = '') {
  const lines = text.split('\n');
  let subject = '';
  let bodyStartIdx = 0;

  // Scan first 15 lines for a "Subject: ..." header
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const m = lines[i].match(/^Subject:\s*(.+)$/i);
    if (m) {
      subject = m[1].trim();
      bodyStartIdx = i + 1;
      // Skip a blank separator line after the subject
      if (bodyStartIdx < lines.length && !lines[bodyStartIdx].trim()) bodyStartIdx++;
      break;
    }
  }

  // Strip leading "Body:" label if the agent included one
  let body = lines.slice(bodyStartIdx).join('\n').trim();
  body = body.replace(/^Body:\s*/i, '').trim();

  // Auto-generate a short subject from the first sentence if agent didn't include one
  if (!subject) {
    const firstSentence = text.split(/[.\n]/)[0].trim();
    subject = firstSentence.length > 8 && firstSentence.length <= 80
      ? firstSentence
      : 'Message from Yuno AI';
    body = text.trim();
  }

  return {
    to:      recipientEmails || '',
    subject,
    body,
  };
}

// ── Intro message — shows workflow overview + what inputs are needed ──────────

function buildIntroMessage(workflow, agentOrder, questions) {
  const wfDesc = workflow.description
    ? `\n\n📋 ${workflow.description}`
    : '';

  // Agent steps — numbered, with each tool listed
  const agentLines = agentOrder.map((node, i) => {
    const cfg   = node.data?.agentConfig || {};
    const name  = cfg.name || 'Agent';
    const tools = (cfg.tools || []).map(t => {
      const meta = TOOL_META[t];
      return meta
        ? `    • ${meta.label} — ${meta.description}`
        : `    • ${t}`;
    });
    return [`${i + 1}. ${name}`, ...tools].join('\n');
  }).join('\n\n');

  // Summarise what the user will need to provide
  const toolsSeen = new Set();
  const needLines = [];
  for (const q of questions) {
    if (!toolsSeen.has(q.tool)) {
      toolsSeen.add(q.tool);
      const meta = TOOL_META[q.tool];
      if (meta) needLines.push(`  • ${meta.label}`);
    }
  }

  const header = `🤖 Workflow: "${workflow.name}"${wfDesc}\n\n━━━ Steps ━━━\n${agentLines}`;

  if (questions.length === 0) {
    return `${header}\n\n✅ No inputs needed — the agents will run automatically.`;
  }

  const needStr = needLines.length
    ? `\n\n📥 I'll collect the following inputs:\n${needLines.join('\n')}`
    : '';

  return `${header}${needStr}\n\nLet me ask you a few questions to get started.`;
}

// ── Terminal line builder ─────────────────────────────────────────────────────

const TERM_STYLE = {
  agent_start:       { color: 'text-emerald-400', icon: '▶' },
  agent_end:         { color: 'text-green-300',   icon: '✓' },
  tool_call:         { color: 'text-yellow-400',  icon: '⚡' },
  tool_result:       { color: 'text-sky-300',     icon: ' └' },
  agent_message:     { color: 'text-gray-200',    icon: '💬' },
  workflow_complete: { color: 'text-green-200',   icon: '🎉' },
  workflow_error:    { color: 'text-red-400',     icon: '✗' },
};

function buildTermLine(event) {
  const s = TERM_STYLE[event.type];
  if (!s || event.type === 'keepalive') return null;
  let text = '';
  switch (event.type) {
    case 'agent_start':
      text = `[${event.agent_name || event.agent_id}] Starting...`; break;
    case 'agent_end':
      text = `[${event.agent_name || event.agent_id}] Done`; break;
    case 'tool_call':
      text = `  ⚡ ${event.agent_name || ''} → ${event.tool_name || event.tool || '?'}` +
             (event.tool_input ? `  ${JSON.stringify(event.tool_input).slice(0, 80)}` : '');
      break;
    case 'tool_result':
      text = `  └ ${String(event.tool_output || event.result || event.output || '').slice(0, 160)}`; break;
    case 'agent_message':
      text = `  [${event.agent_name || 'Agent'}]: ${String(event.content || '').slice(0, 200)}`; break;
    case 'workflow_complete': text = 'Workflow completed successfully'; break;
    case 'workflow_error':    text = `Error: ${event.error}`; break;
    default:                  text = JSON.stringify(event).slice(0, 120);
  }
  return { icon: s.icon, text, color: s.color };
}

function extractFilledPath(text = '') {
  const m = text.match(/DOWNLOAD_PATH\s*:\s*(.+?\.pdf)/i);
  return m ? m[1].trim() : null;
}

async function downloadFilledPdf(filePath) {
  const res = await axios.get(`${PYTHON_API}/download`, {
    params: { path: filePath },
    responseType: 'blob',
  });
  const filename = filePath.split(/[\\/]/).pop() || 'filled.pdf';
  const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

// ── Confirm message builder ───────────────────────────────────────────────────

function buildConfirmText(questions, col, workflowName) {
  const parts = [];
  if (col.goal)               parts.push(`🎯 Task: ${col.goal}`);
  if (col.search_topic)       parts.push(`🔍 Search: ${col.search_topic}`);
  if (col.pdf_filename)       parts.push(`📄 PDF: ${col.pdf_filename}`);
  if (col.pdf_fill_data) {
    const preview = col.pdf_fill_data.slice(0, 80);
    parts.push(`📝 Fill data: ${preview}${col.pdf_fill_data.length > 80 ? '...' : ''}`);
  }
  if (col.recipient_emails)   parts.push(`📧 Email to: ${col.recipient_emails}`);
  if (col.github_task)        parts.push(`🐙 GitHub task: ${col.github_task.slice(0, 80)}${col.github_task.length > 80 ? '...' : ''}`);
  if (col.github_repo)        parts.push(`   Repo: ${col.github_repo}`);
  if (col.sandbox_task)       parts.push(`🐍 Sandbox: ${col.sandbox_task.slice(0, 80)}${col.sandbox_task.length > 80 ? '...' : ''}`);
  if (col.workspace_name)     parts.push(`   Workspace: ${col.workspace_name}`);
  if (col.calendar_task)      parts.push(`📅 Calendar: ${col.calendar_task}`);
  if (col.google_credentials) parts.push(`   Google Calendar: credentials connected`);
  if (col.http_task)          parts.push(`🌐 HTTP: ${col.http_task.slice(0, 80)}${col.http_task.length > 80 ? '...' : ''}`);
  if (col.code_task)          parts.push(`💻 Code: ${col.code_task.slice(0, 80)}${col.code_task.length > 80 ? '...' : ''}`);

  return parts.length
    ? `Here's what I'll do:\n\n${parts.join('\n')}\n\nReady to start?`
    : `Ready to run "${workflowName}" — the agents will work autonomously.\n\nStart now?`;
}

// ── Per-agent message builder (mirrors langgraph_runner.py context injection) ──
//
// Builds the full message each individual agent receives:
//   ## Your Task        – derived from collected user inputs
//   ## Available Inputs – tool-specific hints (pdf path, emails, etc.)
//   ## Outputs from Previous Agents – upstream results injected verbatim

// Maps each tool to the input key that holds its primary task description.
// Only used when THIS agent has that tool — prevents task keys from bleeding
// across agents (e.g. calculator's `goal` must not become the email agent's task).
const TOOL_TASK_KEY = {
  pdf_analyzer:    { key: 'pdf_fill_data', fmt: v => `Analyze and fill the PDF form with the following information:\n${v}` },
  web_search:      { key: 'search_topic',  fmt: v => `Search for information about: ${v}` },
  calculator:      { key: 'goal',          fmt: v => v },
  github:          { key: 'github_task',   fmt: v => v },
  sandbox_exec:    { key: 'sandbox_task',  fmt: v => v },
  google_calendar: { key: 'calendar_task', fmt: v => v },
  google_drive:    { key: 'message',       fmt: v => v },
  http_request:    { key: 'http_task',     fmt: v => v },
  code_executor:   { key: 'code_task',     fmt: v => v },
};

function buildAgentMessage(agent, inputs, agentOutputs, agentOrder) {
  const cfg   = agent.data?.agentConfig || {};
  const tools = cfg.tools || [];

  // ── Base task: look up by THIS agent's tools only ──────────────────────────
  let baseTask = '';
  for (const tool of tools) {
    const meta = TOOL_TASK_KEY[tool];
    if (!meta) continue;
    const val = inputs[meta.key];
    if (val) { baseTask = meta.fmt(val); break; }
  }
  if (!baseTask) baseTask = inputs.message || 'Complete your task using the available tools.';

  const sections = [`## Your Task\n${baseTask}`];

  // ── Tool-specific context hints ──
  const hints = [];
  if (tools.includes('pdf_analyzer') && inputs.pdf_path) {
    if (inputs.pdf_fill_data) {
      // Fill data already collected by the UI — tell the agent to skip asking and go straight to filling
      hints.push(
        `A PDF file and all fill data have been provided — proceed immediately:\n` +
        `  File path : ${inputs.pdf_path}\n` +
        `  Fill data : already supplied in the "Your Task" section above.\n\n` +
        `IMPORTANT: Do NOT ask the user for any more data. Do NOT say "please provide data".\n` +
        `Run detect_pdf_form_fields first (to get field positions), then call fill_pdf_form with the fill data above.`
      );
    } else {
      hints.push(
        `A PDF file has been provided for you to work with.\n` +
        `  File name : ${inputs.pdf_filename || ''}\n` +
        `  File path : ${inputs.pdf_path}\n` +
        `Use detect_pdf_form_fields to detect fields, then fill_pdf_form to fill them.`
      );
    }
  }
  if (tools.includes('email') && inputs.recipient_emails) {
    hints.push(
      `Email recipient(s) provided: ${inputs.recipient_emails}\n` +
      `After completing your task, send the results or any generated files to this address using the email tool.`
    );
  }
  if (tools.includes('web_search') && inputs.search_topic) {
    hints.push(`Search topic: ${inputs.search_topic}`);
  }
  if (tools.includes('github')) {
    if (inputs.github_repo) hints.push(`GitHub repository to work with: ${inputs.github_repo}\nUse clone_github_repo to clone it first.`);
  }
  if (tools.includes('sandbox_exec')) {
    if (inputs.workspace_name) hints.push(`Use workspace name '${inputs.workspace_name}' for the Python sandbox environment.`);
  }
  if (tools.includes('google_calendar') && inputs.google_credentials) {
    hints.push(`Google Calendar credentials have been provided for this session.`);
    if (inputs.calendar_task) hints.push(`Calendar task: ${inputs.calendar_task}`);
  }
  if (tools.includes('google_drive') && inputs.google_credentials) {
    hints.push(
      `Google Drive credentials have been provided for this session.\n` +
      `Default folder: https://drive.google.com/drive/folders/1r15kyCWIjrkOOb0_WwgYMY3WkbSEpZrh?dmr=1&ec=wgc-drive-%5Bmodule%5D-goto`
    );
  }
  if (tools.includes('http_request') && inputs.http_task) {
    hints.push(`HTTP task: ${inputs.http_task}`);
  }
  if (tools.includes('code_executor') && inputs.code_task) {
    hints.push(`Code task: ${inputs.code_task}`);
  }
  if (hints.length) {
    sections.push(`## Available Inputs for Your Tools\n${hints.join('\n\n')}`);
  }

  // ── Upstream agent outputs ──
  const upstream = [];
  for (const prev of agentOrder) {
    if (prev.id === agent.id) break;
    const out = agentOutputs[prev.id];
    if (!out) continue;
    const prevName = prev.data?.agentConfig?.name || prev.id;
    upstream.push(`── Output from [${prevName}] ──\n${out}`);
  }
  if (upstream.length) {
    sections.push(
      `## Outputs from Previous Agents\nUse the data below directly — do not ask for it again.\n\n${upstream.join('\n\n')}`
    );
    if (tools.includes('email') && inputs.recipient_emails) {
      sections.push(
        `## Action Required\nBased on the above outputs, send an email to ${inputs.recipient_emails}. If a previous output contains a DOWNLOAD_PATH line, pass that exact path unchanged to send_pdf_by_email as pdf_path. Do not URL-encode it and do not rewrite it to /workspace.`
      );
    }
  }

  return sections.join('\n\n');
}

// ── Email draft review panel ──────────────────────────────────────────────────
// Rendered in the bottom input area when a mailer agent is next in the workflow.
// The user can edit To / Subject / Body and send directly from the browser,
// or cancel to stop the workflow.

function EmailDraftPanel({ draft, onSend, onCancel }) {
  const [to,       setTo]       = useState(draft.to);
  const [subject,  setSubject]  = useState(draft.subject);
  const [body,     setBody]     = useState(draft.body);
  const [sending,  setSending]  = useState(false);
  const [sendError,setSendError]= useState('');
  const [sent,     setSent]     = useState(false);

  const handleSend = async () => {
    if (!to.trim())      { setSendError('Recipient email is required.'); return; }
    if (!subject.trim()) { setSendError('Subject is required.');          return; }
    setSending(true);
    setSendError('');
    try {
      const recipients = to.split(',').map(t => t.trim()).filter(Boolean);
      const res = await fetch(`${BACKEND_API}/api/email/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:          recipients,
          subject:     subject.trim(),
          body:        body.trim(),
          attachments: draft.attachmentPaths || [],
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSent(true);
        setTimeout(() => onSend({ to, subject, body }), 800);
      } else {
        setSendError(data.error || 'Email send failed — check backend SMTP config.');
        setSending(false);
      }
    } catch (e) {
      setSendError(`Connection error: ${e.message}`);
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="bg-green-50 border-t-2 border-green-300 px-4 py-4 shrink-0 flex items-center gap-2.5 text-sm text-green-700">
        <span className="text-lg">✅</span>
        <span>Email sent successfully! Closing…</span>
      </div>
    );
  }

  return (
    <div
      className="bg-white border-t-2 border-pink-200 px-4 py-4 shrink-0"
      style={{ maxHeight: '30rem', overflowY: 'auto' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">✉️</span>
          <span className="text-sm font-semibold text-gray-700">Review &amp; Edit Email Draft</span>
        </div>
        <span className="text-xs bg-pink-50 text-pink-600 border border-pink-200 rounded px-2 py-0.5">
          Draft ready for review
        </span>
      </div>

      {/* To */}
      <div className="mb-3">
        <label className="text-xs font-medium text-gray-500 mb-1 block">To</label>
        <input
          type="text"
          value={to}
          onChange={e => setTo(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
                     focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-400 transition-all"
          placeholder="recipient@example.com, another@example.com"
        />
      </div>

      {/* Subject */}
      <div className="mb-3">
        <label className="text-xs font-medium text-gray-500 mb-1 block">Subject</label>
        <input
          type="text"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
                     focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-400 transition-all"
          placeholder="Email subject"
        />
      </div>

      {/* Body */}
      <div className="mb-3">
        <label className="text-xs font-medium text-gray-500 mb-1 block">Body</label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={7}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono
                     resize-none focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-400 transition-all"
          placeholder="Email body…"
        />
      </div>

      {/* Attachments */}
      {draft.attachmentPaths && draft.attachmentPaths.length > 0 && (
        <div className="mb-3">
          <label className="text-xs font-medium text-gray-500 mb-1 block">Attachments (from workflow)</label>
          <div className="flex flex-wrap gap-2">
            {draft.attachmentPaths.map((p, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1.5 bg-pink-50 text-pink-700
                           border border-pink-200 rounded-lg px-2.5 py-1 text-xs"
              >
                📎 {(p.split('/').pop() || p.split('\\').pop() || p)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {sendError && (
        <p className="text-xs text-red-600 mb-2.5">❌ {sendError}</p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleSend}
          disabled={sending}
          className="btn-primary text-sm py-2 px-5 disabled:opacity-60 flex items-center gap-1.5"
        >
          {sending
            ? <><Loader size={13} className="animate-spin" /> Sending…</>
            : <>✉️ Send Email</>
          }
        </button>
        <button
          onClick={onCancel}
          disabled={sending}
          className="btn-secondary text-sm py-2 px-4"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Chat bubble components ────────────────────────────────────────────────────

function OrchestratorBubble({ msg, onRun, onClose }) {
  const [downloading, setDownloading] = useState(false);
  const filledPath = extractFilledPath(msg.content);

  const handleDownloadFilled = async () => {
    if (!filledPath) return;
    setDownloading(true);
    try {
      await downloadFilledPdf(filledPath);
    } catch (e) {
      alert('Download failed: ' + (e.message || 'Unknown error'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex items-start gap-2.5">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
        <Bot size={13} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`inline-block bg-white border rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm max-w-[85%] ${
          msg.isFinal ? 'border-green-300 bg-green-50' : 'border-gray-200'
        }`}>
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        </div>

        {filledPath && (
          <button
            onClick={handleDownloadFilled}
            disabled={downloading}
            className="flex items-center gap-1.5 mt-2 ml-1 text-xs font-semibold text-white bg-pink-500 hover:bg-pink-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
          >
            {downloading ? <Loader size={12} className="animate-spin" /> : <FileText size={12} />}
            Download Filled PDF
          </button>
        )}

        {/* Workflow start confirmation */}
        {msg.isConfirm && (
          <div className="flex gap-2 mt-2">
            <button onClick={() => onRun(msg.snapshot)} className="btn-primary text-sm py-1.5 px-4">
              <Play size={13} /> Run Workflow
            </button>
            <button onClick={onClose} className="btn-secondary text-sm py-1.5 px-4">
              Cancel
            </button>
          </div>
        )}

        {/* Human-in-the-loop: approval between agents */}
        {msg.isApproval && (
          <div className="flex gap-2 mt-2 flex-wrap">
            <button
              onClick={msg.onApprove}
              className="btn-primary text-sm py-1.5 px-4"
            >
              <Play size={13} /> {msg.approveLabel || 'Continue'}
            </button>
            <button
              onClick={msg.onStop}
              className="btn-secondary text-sm py-1.5 px-4"
            >
              Stop here
            </button>
          </div>
        )}

        {/* Show decision after approval (buttons replaced by status label) */}
        {msg.approvalDecision === 'approved' && (
          <p className="text-xs text-green-600 mt-1.5 ml-1">✓ Approved — continuing...</p>
        )}
        {msg.approvalDecision === 'stopped' && (
          <p className="text-xs text-gray-500 mt-1.5 ml-1">⏹ Stopped here</p>
        )}

        {/* PDF fill-mode status (set after user picks from the input-area panel) */}
        {msg.choiceSelected === 'one-by-one' && (
          <p className="text-xs text-green-600 mt-1.5 ml-1">✓ Filling one field at a time</p>
        )}
        {msg.choiceSelected === 'all-at-once' && (
          <p className="text-xs text-blue-600 mt-1.5 ml-1">✓ Filling all at once</p>
        )}
      </div>
    </div>
  );
}

function UserBubble({ msg }) {
  return (
    <div className="flex items-end gap-2 justify-end">
      <div className="bg-pink-500 text-white rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[80%] shadow-sm">
        {msg.fileInfo && (
          <div className="flex items-center gap-1.5 mb-1.5 bg-pink-400/40 rounded px-2 py-0.5 text-xs">
            <FileText size={11} />
            <span>{msg.fileInfo.name}</span>
            <span className="opacity-70">({(msg.fileInfo.size / 1024).toFixed(1)} KB)</span>
          </div>
        )}
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
      </div>
      <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
        <User size={13} className="text-gray-500" />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RunModal({ workflow, onClose }) {
  const { agentOrder, questions } = buildPlan(workflow);

  const [messages, setMessages]   = useState([]);
  const [termLines, setTermLines] = useState([]);
  const [phase, setPhase]         = useState('intro');
  const [qIdx, setQIdx]           = useState(0);
  const [collected, setCollected] = useState({});
  const [textInput, setTextInput] = useState('');
  const [pdfFile, setPdfFile]     = useState(null);
  const [uploading, setUploading] = useState(false);
  const [finalOutput, setFinalOutput] = useState('');

  // ── PDF field detection + input-mode state ──────────────────────────────────
  const [pdfDetectedFields,     setPdfDetectedFields]     = useState([]); // filtered field list (for textarea guard)
  const [pdfDetectedCheckboxes, setPdfDetectedCheckboxes] = useState([]); // filtered checkbox list
  const [pdfPendingQuestions,   setPdfPendingQuestions]   = useState(null); // built questions waiting for mode choice
  const [pdfInputMode,          setPdfInputMode]          = useState(null); // null | 'one-by-one' | 'all-at-once'
  const [pdfFieldQuestions,     setPdfFieldQuestions]     = useState([]); // active questions for the chosen mode
  const [pdfFieldQIdx,          setPdfFieldQIdx]          = useState(0);  // current Q index in one-by-one mode
  const [fieldValues,           setFieldValues]           = useState({}); // accumulated label → value (both modes)
  const [fieldsLoading,         setFieldsLoading]         = useState(false); // OCR scan in progress
  // msgId of the last "fields detected" message — lets us stamp it with the chosen mode
  const pdfChoiceMsgRef = useRef(null);

  // ── Email draft panel state ──────────────────────────────────────────────────
  // Set when a mailer agent is next in the workflow; null = panel hidden.
  // Shape: { to, subject, body, attachmentPaths[], resolve, msgId }
  const [emailDraftPanel, setEmailDraftPanel] = useState(null);

  const chatEndRef        = useRef(null);
  const termEndRef        = useRef(null);
  const fileInputRef      = useRef(null);
  const textInputRef      = useRef(null);
  const initRef           = useRef(false);        // guard against React 18 double-fire
  const approvalResolverRef = useRef(null);       // resolves the human-in-the-loop Promise
  const fieldValuesRef    = useRef({});           // stable accumulator — avoids stale closure on fieldValues

  // ── Stable helpers ───────────────────────────────────────────────────────────

  const pushMsg = useCallback((role, content, extras = {}) => {
    setMessages(ms => [...ms, { id: Date.now() + Math.random(), role, content, ...extras }]);
  }, []);

  const pushTerm = useCallback((event) => {
    const line = buildTermLine(event);
    if (line) setTermLines(ts => [...ts, { id: Date.now() + Math.random(), ...line }]);
  }, []);

  // Auto-scroll
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { termEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [termLines]);

  // ── Intro (runs once on mount) ───────────────────────────────────────────────

  useEffect(() => {
    // React 18 Strict Mode fires effects twice in dev — guard against it
    if (initRef.current) return;
    initRef.current = true;

    const greeting = buildIntroMessage(workflow, agentOrder, questions);
    setTimeout(() => {
      pushMsg('orchestrator', greeting);
      if (questions.length === 0) {
        setPhase('confirm');
        const confirmText = buildConfirmText(questions, {}, workflow.name);
        setTimeout(() => pushMsg('orchestrator', confirmText, { isConfirm: true, snapshot: {} }), 350);
      } else {
        setPhase('qa');
        setTimeout(() => pushMsg('orchestrator', questions[0].q, { qIdx: 0 }), 350);
      }
    }, 200);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Advance to next question or confirm ──────────────────────────────────────

  const advance = useCallback((nextIdx, col) => {
    // Auto-skip any question whose key was already collected — most importantly
    // pdf_fill_data, which is populated via OCR field-collection and must not be
    // asked a second time as a manual "Step 2 of 2" textarea.
    let idx = nextIdx;
    while (idx < questions.length && col[questions[idx].key]) {
      idx++;
    }

    if (idx < questions.length) {
      setQIdx(idx);
      setTimeout(() => {
        pushMsg('orchestrator', questions[idx].q, { qIdx: idx });
      }, 150);
    } else {
      setPhase('confirm');
      const confirmText = buildConfirmText(questions, col, workflow.name);
      setTimeout(() => {
        pushMsg('orchestrator', confirmText, { isConfirm: true, snapshot: col });
      }, 150);
    }
  }, [questions, workflow.name, pushMsg]);

  // ── Handle user send ─────────────────────────────────────────────────────────

  const handleSend = async () => {
  if (phase !== 'qa') return;
  const q = questions[qIdx];
  if (!q) return;

  // ── 1. FILE UPLOAD & OCR FIELD DETECTION ──
  if (q.inputType === 'file') {
    if (!pdfFile) return;
    setUploading(true);
    pushMsg('user', `📎 ${pdfFile.name}`, { fileInfo: { name: pdfFile.name, size: pdfFile.size } });

    try {
      const fd = new FormData();
      fd.append('file', pdfFile);
      const { data } = await axios.post(`${PYTHON_API}/upload/pdf`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      
      const newCol = { ...collected, pdf_path: data.path, pdf_filename: pdfFile.name };
      setCollected(newCol);
      setPdfFile(null);
      setUploading(false);

      // Trigger scanning state
      setFieldsLoading(true);
      pushMsg('orchestrator', `🔍 Scanning **${pdfFile.name}** for form fields using OCR…`);

      try {
        const { data: fieldsData } = await axios.post(`${PYTHON_API}/pdf/detect-fields`, {
          path: data.path,
        });
        const rawFields     = fieldsData.fields     || [];
        const rawCheckboxes = fieldsData.checkboxes || [];

        // Balanced filter: removes extreme artifacts but keeps standard alphanumeric field names
        const isRealLabel = (lbl) => {
          const s = (lbl || '').trim();
          if (!s || s.length < 2) return false;
          if (s.startsWith('(') && s.endsWith(')')) return false;
          return true;
        };

        const fields = rawFields.filter(f => isRealLabel(f.label));
        const checkboxes = rawCheckboxes
          .filter(cb => isRealLabel(cb.label))
          .map(cb => ({ ...cb, options: cb.options.filter(o => (o.text || '').trim().length > 0) }))
          .filter(cb => cb.options.length >= 1);

        const total = fields.length + checkboxes.length;

        if (total > 0) {
          const builtQuestions = [
            ...fields.map(f => ({
              key:      f.label,
              type:     'text',
              question: `What should I enter for **${f.label}**?`,
            })),
            ...checkboxes.map(cb => ({
              key:     cb.label,
              type:    'checkbox',
              options: cb.options.map(o => o.text),
              question: `For **${cb.label}**, which option applies?`,
            })),
          ];

          // Set structural state first to block regular text-areas from mounting
          setPdfDetectedFields(fields);
          setPdfDetectedCheckboxes(checkboxes);
          setPdfPendingQuestions(builtQuestions);
          setFieldValues({});
          fieldValuesRef.current = {};

          // Print the explicit column directory layout to chat
          let overview = `✅ Found **${total} fillable field${total !== 1 ? 's' : ''}** in your document:\n\n`;
          if (fields.length) {
            overview += `📝 **Text Fields (${fields.length}):**\n`;
            overview += fields.map(f => `  • ${f.label}`).join('\n') + '\n\n';
          }
          if (checkboxes.length) {
            overview += `☑ **Choice Fields (${checkboxes.length}):**\n`;
            overview += checkboxes.map(cb => `  • ${cb.label}: ${cb.options.join(' / ')}`).join('\n') + '\n\n';
          }
          overview += `👇 **Choose a fill mode in the panel below to begin entry.**`;

          const choiceMsgId = Date.now() + Math.random();
          pdfChoiceMsgRef.current = choiceMsgId;
          pushMsg('orchestrator', overview);

        } else {
          // Absolute fallback case: advanced to next layout phase safely
          pushMsg('orchestrator', `⚠ Document fields parsed implicitly. Please specify values in plain text:`);
          advance(qIdx + 1, newCol);
        }
      } catch (err) {
        pushMsg('orchestrator', `⚠ Structured field analysis bypassed. Moving to description-based filling.`);
        advance(qIdx + 1, newCol);
      } finally {
        setFieldsLoading(false);
      }

    } catch (e) {
      setUploading(false);
      pushMsg('orchestrator', `Upload framework failed: ${e.message}. Please try again.`);
    }
    return;
  }

  // ── 2. STANDARD STEP TEXT / TEXTAREA QUESTIONS ──
  const val = textInput.trim();
  const isSkip = q.optional && (!val || val.toLowerCase() === 'skip');
  if (!val && !isSkip) return;

  pushMsg('user', isSkip ? '(skipped)' : val);
  setTextInput('');

  let newCol = { ...collected };
  if (!isSkip) {
    if (q.key === 'calendar_credentials') {
      try {
        newCol.google_credentials = JSON.parse(val);
        newCol.calendar_credentials = val;
      } catch {
        pushMsg('orchestrator', "Invalid JSON layout. Please paste complete credentials.");
        return;
      }
    } else {
      newCol[q.key] = val;
    }
  }
  setCollected(newCol);
  advance(qIdx + 1, newCol);
};

  // ── PDF field-by-field answer handler ───────────────────────────────────────
  //
  // Called when the user types an answer (or skips) for one of the OCR-detected
  // PDF fields.  Advances through pdfFieldQuestions one at a time; after the last
  // field it serialises all collected values to JSON and advances the main Q&A.

  const handleFieldAnswer = (rawAnswer) => {
    const currentField = pdfFieldQuestions[pdfFieldQIdx];
    if (!currentField) return;

    const answer = rawAnswer.trim();

    if (answer) {
      pushMsg('user', answer);
      fieldValuesRef.current = { ...fieldValuesRef.current, [currentField.key]: answer };
      setFieldValues({ ...fieldValuesRef.current });
    } else {
      pushMsg('user', '(skip)');
    }

    setTextInput('');
    const nextIdx = pdfFieldQIdx + 1;

    if (nextIdx < pdfFieldQuestions.length) {
      // Ask the next field
      setPdfFieldQIdx(nextIdx);
      const next = pdfFieldQuestions[nextIdx];
      setTimeout(() => {
        pushMsg('orchestrator',
          next.type === 'checkbox'
            ? `${next.question}\n\nChoose: ${next.options.join(' · ')}`
            : next.question
        );
      }, 150);
    } else {
      // All fields done — submit
      _submitPdfFields();
    }
  };

  const _submitPdfFields = () => {
    const filled = Object.entries(fieldValuesRef.current).filter(([, v]) => v);

    if (filled.length > 0) {
      const summary = filled.map(([k, v]) => `  • ${k}: ${v}`).join('\n');
      pushMsg('orchestrator',
        `✅ All fields collected — **${filled.length} filled** out of ${pdfFieldQuestions.length}:\n\n${summary}\n\nGenerating your filled PDF now…`
      );
    } else {
      pushMsg('orchestrator', '⚠ No fields were filled. Please provide at least one value to fill the PDF.');
      // Reset to let user try again
      setPdfFieldQIdx(0);
      fieldValuesRef.current = {};
      setFieldValues({});
      // In one-by-one mode: re-ask the first field.
      // In all-at-once mode: the form is still visible — just show the warning above.
      if (pdfInputMode === 'one-by-one' && pdfFieldQuestions.length > 0) {
        const first = pdfFieldQuestions[0];
        setTimeout(() => pushMsg('orchestrator',
          first.type === 'checkbox'
            ? `${first.question}\n\nChoose: ${first.options.join(' · ')}`
            : first.question
        ), 250);
      }
      return;
    }

    const jsonStr = JSON.stringify(Object.fromEntries(filled), null, 2);
    const newCol  = { ...collected, pdf_fill_data: jsonStr };
    setCollected(newCol);
    // Clear ALL PDF field state so the standard Q&A textarea can show again
    // for any subsequent questions in the workflow.
    setPdfPendingQuestions(null);
    setPdfInputMode(null);
    setPdfDetectedFields([]);
    setPdfDetectedCheckboxes([]);
    setPdfFieldQuestions([]);
    setPdfFieldQIdx(0);
    setFieldValues({});
    fieldValuesRef.current = {};
    advance(qIdx + 1, newCol);
  };

  // ── Sequential per-agent execution — SSE streaming + backend logging ──────────
  //
  // Each agent is executed via /execute/agent/stream (SSE), so tool_call /
  // tool_result / agent_message events appear live in the terminal panel.
  // A run record is created in the backend at the start so the run appears in
  // the Monitoring page.  After each agent (except the last) the user must
  // approve before the next one runs.

  const startRun = useCallback(async (snapshot) => {
    // ── Pre-flight validation ──────────────────────────────────────────────────
    // Ask the Python runtime to validate all collected inputs before any agent runs.
    pushMsg('orchestrator', '🔍 Validating inputs…');
    try {
      const { data: vResult } = await axios.post(`${PYTHON_API}/workflow/validate`, {
        workflow:  { nodes: workflow.nodes || [], edges: workflow.edges || [] },
        collected: snapshot,
      });

      if (!vResult.valid) {
        // Group errors by agent for a readable summary
        const byAgent = {};
        for (const err of vResult.errors) {
          if (!byAgent[err.agent_name]) byAgent[err.agent_name] = [];
          byAgent[err.agent_name].push(`  • ${err.label}: ${err.message}`);
        }
        const lines = Object.entries(byAgent)
          .map(([agent, msgs]) => `**${agent}**\n${msgs.join('\n')}`)
          .join('\n\n');

        pushMsg('orchestrator',
          `❌ Validation failed — please fix the following before running:\n\n${lines}\n\n` +
          `Click "Run Again" to restart and provide the correct inputs.`
        );
        setPhase('error');
        return;
      }
    } catch (e) {
      // If the validator endpoint is unreachable, warn but continue (non-blocking)
      pushMsg('orchestrator', `⚠ Could not reach the validator (${e.message}). Proceeding anyway…`);
    }

    setPhase('running');
    pushMsg('orchestrator', '✅ All inputs valid — starting workflow. I will pause after each agent for your review.');

    // ── Create run record in DB so it appears in Monitoring ───────────────────
    let runId = null;
    try {
      const run = await runsApi.create({
        workflow_id: workflow.id || null,
        input: { message: snapshot.goal || snapshot.search_topic || snapshot.message || '' },
      });
      runId = run.id;
      await runsApi.addLog(runId, {
        type: 'system', message: `Starting workflow: ${workflow.name}`,
      });
    } catch (_) {}

    const agentOutputs = {};
    const totalUsage   = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    let lastOutput     = '';

    for (let i = 0; i < agentOrder.length; i++) {
      const agent     = agentOrder[i];
      const agentName = agent.data?.agentConfig?.name || 'Agent';
      const agentCfg  = agent.data?.agentConfig || {};

      pushTerm({ type: 'agent_start', agent_name: agentName, agent_id: agent.id });
      if (runId) runsApi.addLog(runId, { type: 'agent_start', agent_name: agentName, message: `Agent "${agentName}" started` }).catch(() => {});

      const thinkingId = Date.now() + Math.random();
      setTermLines(ts => [...ts, { id: thinkingId, color: 'text-gray-500', icon: '⟳', text: `  ${agentName}: thinking...` }]);

      const message = buildAgentMessage(agent, snapshot, agentOutputs, agentOrder);

      try {
        // ── Stream this agent's execution ──────────────────────────────────
        const output = await new Promise(async (resolve, reject) => {
          let resp;
          try {
            resp = await fetch(`${PYTHON_API}/execute/agent/stream`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({
                agent:              agentCfg,
                message,
                openai_api_key:     '',
                google_credentials: snapshot.google_credentials || null,
                calendar_timezone:  'UTC',
              }),
            });
          } catch (e) { reject(e); return; }

          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            reject(new Error(err.detail || `HTTP ${resp.status}`));
            return;
          }

          const reader  = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let finalOutput = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop();

              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                  const ev = JSON.parse(line.slice(6));
                  if (ev.type === 'keepalive') continue;

                  if (ev.type === 'agent_complete') {
                    finalOutput = ev.output || '';
                    // Accumulate token usage
                    const u = ev.token_usage || {};
                    totalUsage.input_tokens  += u.input_tokens  || 0;
                    totalUsage.output_tokens += u.output_tokens || 0;
                    totalUsage.total_tokens  += u.total_tokens  || 0;
                    // Log final message to monitoring
                    if (runId) {
                      runsApi.addLog(runId, {
                        type: 'agent_message', agent_name: agentName,
                        message: finalOutput.slice(0, 500),
                        data: { full_output: finalOutput },
                      }).catch(() => {});
                    }
                  } else if (ev.type === 'agent_error') {
                    reject(new Error(ev.error || 'Agent error'));
                    return;
                  } else {
                    // tool_call, tool_result, agent_message — push to terminal live
                    pushTerm({ ...ev, agent_name: agentName });
                    if (runId && (ev.type === 'tool_call' || ev.type === 'tool_result' || ev.type === 'agent_message')) {
                      const logMsg = ev.type === 'tool_call'
                        ? `Tool "${ev.tool_name}" called`
                        : ev.type === 'tool_result'
                          ? `Tool "${ev.tool_name}" returned`
                          : ev.content?.slice(0, 300) || '';
                      runsApi.addLog(runId, { type: ev.type, agent_name: agentName, message: logMsg, data: ev }).catch(() => {});
                    }
                  }
                } catch (_) {}
              }
            }
          } catch (e) { reject(e); return; }

          resolve(finalOutput);
        });

        agentOutputs[agent.id] = output;
        lastOutput = output;

        setTermLines(ts => ts.filter(l => l.id !== thinkingId));
        pushTerm({ type: 'agent_end', agent_name: agentName, agent_id: agent.id });
        if (runId) runsApi.addLog(runId, { type: 'agent_end', agent_name: agentName, message: `Agent "${agentName}" completed` }).catch(() => {});

        const isLast = i === agentOrder.length - 1;

        if (isLast) {
          // ── Workflow complete ────────────────────────────────────────────
          setPhase('done');
          setFinalOutput(output);
          pushTerm({ type: 'workflow_complete' });
          const text = output
            ? `✅ Workflow complete!\n\n${output.slice(0, 800)}${output.length > 800 ? '\n\n...' : ''}`
            : '✅ Workflow complete!';
          pushMsg('orchestrator', text, { isFinal: true });
          if (runId) runsApi.update(runId, { status: 'completed', output: agentOutputs, token_usage: totalUsage }).catch(() => {});
        } else {
          // ── Human-in-the-loop: show output + wait for approval ───────────
          const nextAgent = agentOrder[i + 1];
          const nextName  = nextAgent.data?.agentConfig?.name || 'Agent';
          const nextTools = nextAgent.data?.agentConfig?.tools || [];

          const preview = output.slice(0, 600) + (output.length > 600 ? '\n\n...' : '');
          const msgId   = Date.now() + Math.random();

          // ── Email draft review path ──────────────────────────────────────
          // When the next agent is a mailer, open the draft editor instead of
          // the plain approve/stop buttons.  The user edits To / Subject / Body
          // and clicks "Send Email" — we POST directly to the backend and skip
          // running the mailer agent entirely.
          if (nextTools.includes('email')) {
            const parsedDraft = parseEmailDraft(output, snapshot.recipient_emails || '');

            // Collect attachment paths from the current workflow output
            const attachmentPaths = [];
            if (snapshot.pdf_path) attachmentPaths.push(snapshot.pdf_path);
            // Also check tool outputs captured in agentOutputs for DOWNLOAD_PATH lines
            for (const [, agOut] of Object.entries(agentOutputs)) {
              const m = (agOut || '').match(/DOWNLOAD_PATH\s*:\s*(.+\.pdf)/i);
              if (m) attachmentPaths.push(m[1].trim());
            }

            const draftPreviewText =
              `✅ ${agentName} has drafted an email.\n\n` +
              `📧 **Draft preview**\n` +
              `To: ${parsedDraft.to || '(set below)'}\n` +
              `Subject: ${parsedDraft.subject}\n\n` +
              `Review, edit, and send the draft in the panel below.\n` +
              `You can modify the recipient, subject, and body before sending.`;

            const decision = await new Promise((resolve) => {
              approvalResolverRef.current = resolve;

              // Open the editable draft panel at the bottom of the chat area
              setEmailDraftPanel({
                to:              parsedDraft.to,
                subject:         parsedDraft.subject,
                body:            parsedDraft.body,
                attachmentPaths,
                msgId,
                resolve,
              });

              setMessages(ms => [...ms, {
                id: msgId, role: 'orchestrator', content: draftPreviewText,
                isEmailDraft: true,
              }]);
            });

            // Always close the panel after a decision
            setEmailDraftPanel(null);

            if (decision === 'email_sent') {
              // Email was sent directly from the draft panel — skip the mailer agent
              setMessages(ms2 => ms2.map(m =>
                m.id === msgId ? { ...m, isEmailDraft: false, approvalDecision: 'approved' } : m
              ));

              const mailerIsLast = (i + 1) === agentOrder.length - 1;
              i++; // advance past the mailer agent index

              if (mailerIsLast) {
                setPhase('done');
                setFinalOutput(output);
                pushMsg('orchestrator',
                  `✅ Email sent! Workflow complete.`,
                  { isFinal: true }
                );
                if (runId) runsApi.update(runId, { status: 'completed', output: agentOutputs, token_usage: totalUsage }).catch(() => {});
                break;
              }
              // Otherwise the for-loop's i++ will move us past the mailer to the next agent
              continue;
            }

            if (decision === 'stop') {
              setMessages(ms2 => ms2.map(m =>
                m.id === msgId ? { ...m, isEmailDraft: false, approvalDecision: 'stopped' } : m
              ));
              setPhase('done');
              setFinalOutput(output);
              pushMsg('orchestrator', `⏹ Stopped after ${agentName}. Email was not sent.`);
              if (runId) runsApi.update(runId, { status: 'completed', output: agentOutputs, token_usage: totalUsage }).catch(() => {});
              break;
            }

            // decision === 'continue' — fall through to run the mailer agent normally
            setMessages(ms2 => ms2.map(m =>
              m.id === msgId ? { ...m, isEmailDraft: false, approvalDecision: 'approved' } : m
            ));

          } else {
            // ── Standard approval (non-email next agent) ─────────────────
            let approvalText = `✅ ${agentName} completed.\n\nOutput:\n${preview}\n\nProceed to run ${nextName}?`;

            const decision = await new Promise((resolve) => {
              approvalResolverRef.current = resolve;
              setMessages(ms => [...ms, {
                id: msgId, role: 'orchestrator', content: approvalText,
                isApproval: true, approveLabel: `Continue → ${nextName}`,
                onApprove: () => {
                  approvalResolverRef.current?.('continue');
                  approvalResolverRef.current = null;
                  setMessages(ms2 => ms2.map(m =>
                    m.id === msgId ? { ...m, isApproval: false, approvalDecision: 'approved' } : m
                  ));
                },
                onStop: () => {
                  approvalResolverRef.current?.('stop');
                  approvalResolverRef.current = null;
                  setMessages(ms2 => ms2.map(m =>
                    m.id === msgId ? { ...m, isApproval: false, approvalDecision: 'stopped' } : m
                  ));
                },
              }]);
            });

            if (decision === 'stop') {
              setPhase('done');
              setFinalOutput(output);
              pushMsg('orchestrator', `⏹ Stopped after ${agentName}. Workflow partially completed.`);
              if (runId) runsApi.update(runId, { status: 'completed', output: agentOutputs, token_usage: totalUsage }).catch(() => {});
              break;
            }
          }
        }
      } catch (e) {
        setTermLines(ts => ts.filter(l => l.id !== thinkingId));
        setPhase('error');
        pushMsg('orchestrator', `❌ ${agentName} failed: ${e.message}`);
        pushTerm({ type: 'workflow_error', error: e.message });
        if (runId) runsApi.update(runId, { status: 'failed', error: e.message }).catch(() => {});
        break;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentOrder, workflow, pushMsg, pushTerm]);

  // ── Restart ──────────────────────────────────────────────────────────────────

  const handleRestart = useCallback(() => {
    setPhase('intro');
    setMessages([]);
    setTermLines([]);
    setQIdx(0);
    setCollected({});
    setTextInput('');
    setPdfFile(null);
    setFinalOutput('');
    setPdfPendingQuestions(null);
    setPdfDetectedFields([]);
    setPdfDetectedCheckboxes([]);
    setPdfInputMode(null);
    setPdfFieldQuestions([]);
    setPdfFieldQIdx(0);
    setFieldValues({});
    setFieldsLoading(false);
    setEmailDraftPanel(null);
    fieldValuesRef.current = {};

    setTimeout(() => {
      const greeting = buildIntroMessage(workflow, agentOrder, questions);
      pushMsg('orchestrator', greeting);
      if (questions.length === 0) {
        setPhase('confirm');
        setTimeout(() => pushMsg('orchestrator', buildConfirmText(questions, {}, workflow.name), { isConfirm: true, snapshot: {} }), 350);
      } else {
        setPhase('qa');
        setTimeout(() => pushMsg('orchestrator', questions[0].q, { qIdx: 0 }), 350);
      }
    }, 200);
  }, [agentOrder, questions, workflow, pushMsg]);

  // ── Export helpers ───────────────────────────────────────────────────────────

  const downloadAs = async (format) => {
    if (!finalOutput) return;
    try {
      const res = await fetch(`${PYTHON_API}/export`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          content:  finalOutput,
          filename: workflow.name || 'output',
          format,
          title:    workflow.name || 'Agent Response',
        }),
      });
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const ext  = format === 'pdf' ? 'pdf' : 'xlsx';
      Object.assign(document.createElement('a'), { href: url, download: `${workflow.name || 'output'}.${ext}` }).click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  // ── Render helpers ───────────────────────────────────────────────────────────

  const curQ    = phase === 'qa' ? questions[qIdx] : null;
  const showInput = phase === 'qa' && curQ;

  return (
    <div className="fixed inset-0 bg-gray-50 flex flex-col" style={{ zIndex: 1300 }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-pink-500 to-purple-600 rounded-lg flex items-center justify-center shadow-sm">
            <Zap size={15} className="text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900 text-sm leading-tight">{workflow.name}</h2>
            <p className="text-xs text-gray-400">
              {agentOrder.length} agent{agentOrder.length !== 1 ? 's' : ''} ·{' '}
              {phase === 'running' ? '⚡ Running' : phase === 'done' ? '✅ Complete' : phase === 'error' ? '❌ Error' : 'Orchestrating'}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
          <X size={18} />
        </button>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: Chat panel ─────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col bg-gray-50 min-w-0">

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
            {messages.map(msg =>
              msg.role === 'user'
                ? <UserBubble key={msg.id} msg={msg} />
                : <OrchestratorBubble key={msg.id} msg={msg} onRun={startRun} onClose={onClose} />
            )}

            {/* Export buttons — text output only.
                Generated files (filled PDFs, Drive uploads) already have their own
                "Download Filled PDF" button rendered inside the chat bubble, so we
                must NOT show these buttons when the agent produced a file. */}
            {phase === 'done' && finalOutput &&
              !finalOutput.includes('DOWNLOAD_PATH') &&
              !finalOutput.includes('DRIVE_PATH') &&
              !finalOutput.includes('DRIVE_LINK') && (
              <div className="flex gap-2 pl-10">
                <button onClick={() => downloadAs('pdf')} className="btn-secondary text-xs py-1.5">
                  <FileText size={12} /> Export PDF
                </button>
                <button onClick={() => downloadAs('excel')} className="btn-secondary text-xs py-1.5">
                  <Download size={12} /> Export Excel
                </button>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Done / error footer bar */}
          {(phase === 'done' || phase === 'error') && (
            <div className="bg-white border-t border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
              <p className="text-xs text-gray-400">
                {phase === 'done'
                  ? 'Workflow complete. If the agent asked follow-up questions, click "Run Again" to restart with updated inputs.'
                  : 'Workflow failed. Click "Run Again" to retry.'}
              </p>
              <div className="flex gap-2">
                <button onClick={handleRestart} className="btn-secondary text-xs py-1.5 px-3">
                  Run Again
                </button>
                <button onClick={onClose} className="btn-primary text-xs py-1.5 px-3">
                  Close
                </button>
              </div>
            </div>
          )}

          {/* ── OCR scan in-progress bar ────────────────────────────────────── */}
          {fieldsLoading && (
            <div className="bg-white border-t border-gray-200 px-4 py-3 flex items-center gap-2.5 text-sm text-gray-500 shrink-0">
              <Loader size={15} className="animate-spin text-pink-500 shrink-0" />
              <span>Scanning PDF for form fields with OCR…</span>
            </div>
          )}

          {/* ── Email draft review panel ──────────────────────────────────── */}
          {/* Shown when a mailer agent is next — lets user review & edit     */}
          {/* the drafted email (To / Subject / Body) before it is sent.      */}
          {emailDraftPanel && (
            <EmailDraftPanel
              draft={emailDraftPanel}
              onSend={(editedDraft) => {
                // User clicked "Send Email" — resolve the approval Promise
                approvalResolverRef.current?.('email_sent');
                approvalResolverRef.current = null;
              }}
              onCancel={() => {
                // User cancelled — stop the workflow
                approvalResolverRef.current?.('stop');
                approvalResolverRef.current = null;
              }}
            />
          )}

          {/* ── PDF fill-mode choice panel ────────────────────────────────── */}
          {/* Appears in the fixed input area the moment fields are detected so   */}
          {/* the user can't miss the two buttons — no scrolling needed.           */}
          {!fieldsLoading && pdfPendingQuestions !== null &&
 pdfInputMode === null &&
 pdfFieldQuestions.length === 0 &&
 showInput && (
            <div className="bg-white border-t-2 border-pink-200 px-4 py-4 shrink-0">
              <p className="text-sm font-semibold text-gray-700 mb-0.5">
                {pdfPendingQuestions.length} field{pdfPendingQuestions.length !== 1 ? 's' : ''} detected — how would you like to fill them?
              </p>
              <p className="text-xs text-gray-400 mb-3">Choose your preferred fill mode:</p>
              <div className="flex gap-3">

                {/* ── One by one ── */}
                <button
                  onClick={() => {
                    // Stamp the overview chat message with chosen mode (shows status label)
                    if (pdfChoiceMsgRef.current !== null) {
                      setMessages(ms => ms.map(m =>
                        m.id === pdfChoiceMsgRef.current
                          ? { ...m, choiceSelected: 'one-by-one' }
                          : m
                      ));
                    }
                    const qs = pdfPendingQuestions;
                    setPdfInputMode('one-by-one');
                    setPdfFieldQuestions(qs);
                    setPdfPendingQuestions(null);
                    // Ask the very first field question in chat
                    const first = qs[0];
                    setTimeout(() => pushMsg('orchestrator',
                      first.type === 'checkbox'
                        ? `${first.question}\n\nChoose: ${first.options.join(' · ')}`
                        : first.question
                    ), 150);
                  }}
                  className="flex-1 flex flex-col items-center gap-1.5
                             bg-green-50 hover:bg-green-100
                             border border-green-300 hover:border-green-400
                             text-green-700 rounded-xl py-4 px-3
                             transition-all active:scale-[0.98] cursor-pointer"
                >
                  <span className="text-xl">📝</span>
                  <span className="text-sm font-semibold">One by one</span>
                  <span className="text-xs text-green-600/80 text-center leading-snug">
                    Answer each field question by question
                  </span>
                </button>

                {/* ── All at once ── */}
                <button
                  onClick={() => {
                    if (pdfChoiceMsgRef.current !== null) {
                      setMessages(ms => ms.map(m =>
                        m.id === pdfChoiceMsgRef.current
                          ? { ...m, choiceSelected: 'all-at-once' }
                          : m
                      ));
                    }
                    const qs = pdfPendingQuestions;
                    setPdfInputMode('all-at-once');
                    setPdfFieldQuestions(qs);
                    setPdfPendingQuestions(null);
                    setTimeout(() => pushMsg('orchestrator',
                      `Fill in the fields in the panel below, then click **Fill PDF with these values** when ready.`
                    ), 150);
                  }}
                  className="flex-1 flex flex-col items-center gap-1.5
                             bg-blue-50 hover:bg-blue-100
                             border border-blue-300 hover:border-blue-400
                             text-blue-700 rounded-xl py-4 px-3
                             transition-all active:scale-[0.98] cursor-pointer"
                >
                  <span className="text-xl">📋</span>
                  <span className="text-sm font-semibold">All at once</span>
                  <span className="text-xs text-blue-600/80 text-center leading-snug">
                    Fill all fields in one scrollable form
                  </span>
                </button>

              </div>
            </div>
          )}

          {/* ── PDF all-at-once bulk form ─────────────────────────────────── */}
          {!fieldsLoading && pdfInputMode === 'all-at-once' && pdfFieldQuestions.length > 0 && (
            <div className="bg-white border-t border-gray-200 p-3 shrink-0" style={{ maxHeight: '22rem', overflowY: 'auto' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-gray-600">Fill in the fields below</span>
                <span className="text-[11px] text-gray-400">
                  {pdfFieldQuestions.length} fields · leave blank to skip
                </span>
              </div>

              <div className="space-y-2">
                {pdfFieldQuestions.map((field) => (
                  <div key={field.key} className="flex items-center gap-2 min-w-0">
                    <label
                      className="text-[11px] text-gray-500 w-36 shrink-0 truncate"
                      title={field.key}
                    >
                      {field.key}
                    </label>
                    {field.type === 'checkbox' ? (
                      <div className="flex flex-wrap gap-1.5 flex-1">
                        {field.options.map(opt => (
                          <button
                            key={opt}
                            onClick={() => {
                              const val = fieldValues[field.key] === opt ? '' : opt;
                              setFieldValues(prev => ({ ...prev, [field.key]: val }));
                              fieldValuesRef.current = { ...fieldValuesRef.current, [field.key]: val };
                            }}
                            className={`px-2.5 py-1 rounded-lg border text-xs transition-all ${
                              fieldValues[field.key] === opt
                                ? 'border-pink-400 bg-pink-50 text-pink-600 font-medium'
                                : 'border-gray-200 text-gray-600 hover:border-pink-300 hover:bg-pink-50'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <input
                        type="text"
                        className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs
                                   focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-400
                                   transition-all"
                        placeholder="Leave blank to skip"
                        value={fieldValues[field.key] || ''}
                        onChange={e => {
                          const val = e.target.value;
                          setFieldValues(prev => ({ ...prev, [field.key]: val }));
                          fieldValuesRef.current = { ...fieldValuesRef.current, [field.key]: val };
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>

              <button
                onClick={_submitPdfFields}
                className="btn-primary w-full mt-3 text-sm py-2 flex items-center justify-center gap-1.5"
              >
                <Send size={13} /> Fill PDF with these values
              </button>
            </div>
          )}

          {/* ── PDF field-by-field input (one-by-one mode only) ───────────── */}
          {!fieldsLoading && pdfInputMode === 'one-by-one' && pdfFieldQuestions.length > 0 && (
            <div className="bg-white border-t border-gray-200 p-3 shrink-0">

              {/* Progress bar */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-gray-500">
                  Field {pdfFieldQIdx + 1} of {pdfFieldQuestions.length}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-gray-400">
                    {Object.values(fieldValues).filter(Boolean).length} filled
                  </span>
                  <button
                    onClick={_submitPdfFields}
                    disabled={Object.values(fieldValuesRef.current).filter(Boolean).length === 0}
                    className="text-[11px] text-pink-500 hover:text-pink-700 font-medium
                               disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Skip remaining & Fill PDF →
                  </button>
                </div>
              </div>

              {/* Thin progress track */}
              <div className="w-full h-0.5 bg-gray-100 rounded-full mb-3">
                <div
                  className="h-full bg-pink-400 rounded-full transition-all"
                  style={{ width: `${((pdfFieldQIdx) / pdfFieldQuestions.length) * 100}%` }}
                />
              </div>

              {/* Checkbox field: clickable option buttons */}
              {pdfFieldQuestions[pdfFieldQIdx]?.type === 'checkbox' ? (
                <div className="flex flex-wrap gap-2">
                  {pdfFieldQuestions[pdfFieldQIdx].options.map(opt => (
                    <button
                      key={opt}
                      onClick={() => handleFieldAnswer(opt)}
                      className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700
                                 hover:border-pink-400 hover:bg-pink-50 hover:text-pink-600
                                 transition-all active:scale-95"
                    >
                      {opt}
                    </button>
                  ))}
                  <button
                    onClick={() => handleFieldAnswer('')}
                    className="px-4 py-2 rounded-lg border border-dashed border-gray-200 text-sm
                               text-gray-400 hover:border-gray-400 transition-all"
                  >
                    Skip
                  </button>
                </div>
              ) : (
                /* Text field: inline input */
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    autoFocus
                    className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm
                               focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-400
                               transition-all"
                    placeholder="Type value, or press Enter to skip…"
                    value={textInput}
                    onChange={e => setTextInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleFieldAnswer(textInput);
                        setTextInput('');
                      }
                    }}
                  />
                  <button
                    onClick={() => { handleFieldAnswer(textInput); setTextInput(''); }}
                    className="btn-primary py-2.5 px-4 shrink-0"
                  >
                    <Send size={14} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Standard Q&A input (text / textarea / file upload) ─────────── */}
          {/* Hidden while waiting for a PDF mode choice (fields detected but
              user hasn't picked one-by-one vs all-at-once yet). Without this
              guard the textarea is visible alongside the choice buttons and
              users bypass the field-collection flow entirely. */}
          {!fieldsLoading && pdfFieldQuestions.length === 0 &&
            pdfDetectedFields.length === 0 && pdfDetectedCheckboxes.length === 0 &&
            showInput && (
            <div className="bg-white border-t border-gray-200 p-3 shrink-0">
              {curQ.inputType === 'file' ? (
                <div className="flex gap-2 items-center">
                  <input ref={fileInputRef} type="file" accept=".pdf" className="hidden"
                    onChange={e => setPdfFile(e.target.files?.[0] || null)} />
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className={`flex-1 flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed transition-all ${
                      pdfFile ? 'border-pink-400 bg-pink-50' : 'border-gray-300 hover:border-pink-400 hover:bg-pink-50'
                    }`}>
                    {uploading
                      ? <Loader size={15} className="animate-spin text-pink-500" />
                      : <Paperclip size={15} className={pdfFile ? 'text-pink-500' : 'text-gray-400'} />}
                    <span className={`text-sm ${pdfFile ? 'text-pink-600 font-medium' : 'text-gray-500'}`}>
                      {pdfFile
                        ? `${pdfFile.name} (${(pdfFile.size / 1024).toFixed(1)} KB)`
                        : 'Click to choose PDF...'}
                    </span>
                  </button>
                  <button onClick={handleSend} disabled={!pdfFile || uploading} className="btn-primary py-2.5 px-4 shrink-0">
                    {uploading ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2 items-end">
                  <textarea
                    ref={textInputRef}
                    rows={curQ.inputType === 'textarea' ? 3 : 1}
                    className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-400 transition-all"
                    placeholder={curQ.optional ? 'Type answer, or "skip" to continue...' : 'Type your answer...'}
                    value={textInput}
                    onChange={e => setTextInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey && curQ.inputType !== 'textarea') {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    autoFocus
                  />
                  <button onClick={handleSend} className="btn-primary py-2.5 px-4 shrink-0">
                    <Send size={14} />
                  </button>
                </div>
              )}
              {curQ.optional && (
                <p className="text-xs text-gray-400 mt-1.5 text-right">
                  Optional — type "skip" or press Enter to continue without answering.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Right: Terminal panel ─────────────────────────────────────────── */}
        <div className="hidden md:flex w-96 flex-col border-l border-gray-200">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 border-b border-gray-800 shrink-0">
            <Terminal size={13} className="text-gray-500" />
            <span className="text-xs font-medium text-gray-400 tracking-wide">Live Execution</span>
            <div className="ml-auto flex items-center gap-1.5">
              {phase === 'running' && (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs text-emerald-400">Running</span>
                </>
              )}
              {phase === 'done'  && <span className="text-xs text-green-400">✓ Done</span>}
              {phase === 'error' && <span className="text-xs text-red-400">✗ Error</span>}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-gray-950 p-3 font-mono text-xs leading-5 space-y-0.5">
            {termLines.length === 0 ? (
              <p className="text-gray-700 text-center mt-16">
                Execution events will appear here once the workflow starts...
              </p>
            ) : (
              termLines.map(line => (
                <div key={line.id} className={`flex gap-2 ${line.color}`}>
                  <span className="shrink-0 w-4 text-center">{line.icon}</span>
                  <span className="break-all">{line.text}</span>
                </div>
              ))
            )}
            <div ref={termEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
