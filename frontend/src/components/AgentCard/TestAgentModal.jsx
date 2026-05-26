import { useState, useRef, useEffect } from 'react';
import {
  X, Send, Bot, User, Loader, Calendar, CheckCircle, AlertCircle,
  ChevronDown, ChevronUp, Paperclip, FileText, Download,
  File as FileIcon,
} from 'lucide-react';
import axios from 'axios';

const API = 'http://localhost:8000';
const HAS_CALENDAR = (agent) => agent.tools?.includes('google_calendar');
const HAS_PDF      = (agent) => agent.tools?.includes('pdf_analyzer');
const HAS_DRIVE    = (agent) => agent.tools?.includes('google_drive');
const HAS_FILES    = (agent) => agent.tools?.includes('folder_files') || agent.tools?.includes('ats_resume');
const DRIVE_FOLDER_URL = 'https://drive.google.com/drive/folders/1r15kyCWIjrkOOb0_WwgYMY3WkbSEpZrh?dmr=1&ec=wgc-drive-%5Bmodule%5D-goto';

// ── Google Calendar / Drive credential gate ───────────────────────────────────

function GoogleConnectScreen({ onConnect, needsCalendar, needsDrive }) {
  const [json, setJson]         = useState('');
  const [tz, setTz]             = useState('UTC');
  const [error, setError]       = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const connect = () => {
    setError('');
    if (!json.trim()) { setError('Paste your Service Account JSON first.'); return; }
    try {
      const parsed = JSON.parse(json.trim());
      if (parsed.type !== 'service_account') {
        setError('Not a Service Account JSON — make sure "type" is "service_account".');
        return;
      }
      if (!parsed.client_email || !parsed.private_key) {
        setError('JSON is missing required fields (client_email or private_key).');
        return;
      }
      onConnect(parsed, tz);
    } catch {
      setError('Invalid JSON — could not parse. Double-check the pasted content.');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            {needsCalendar ? <Calendar size={20} className="text-blue-600" /> : <FileIcon size={20} className="text-blue-600" />}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Connect Google</h3>
            <p className="text-xs text-gray-400">Paste your Service Account JSON to enable Google tools</p>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <p className="text-xs font-semibold text-blue-700 mb-2">You need a Service Account JSON key</p>
          <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
            <li>Go to <span className="font-mono bg-blue-100 px-1 rounded">console.cloud.google.com</span></li>
            <li>
              Create a project and enable {needsCalendar && <b>Google Calendar API</b>}
              {needsCalendar && needsDrive && ' and '}
              {needsDrive && <b>Google Drive API</b>}
            </li>
            <li>IAM &amp; Admin → Service Accounts → <b>Create Service Account</b></li>
            <li>Click the account → Keys → <b>Add Key → JSON</b> → Download the file</li>
            {needsCalendar && (
              <li>Open Google Calendar settings and share the calendar with the <span className="font-mono">client_email</span> as an editor.</li>
            )}
            {needsDrive && (
              <li>Share the destination Drive folder with the <span className="font-mono">client_email</span> as Editor.</li>
            )}
          </ol>
        </div>

        <button onClick={() => setShowHelp(h => !h)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 mb-3">
          {showHelp ? <ChevronUp size={13}/> : <ChevronDown size={13}/>} What does the JSON look like?
        </button>
        {showHelp && (
          <pre className="text-xs bg-gray-900 text-green-400 rounded-lg p-3 mb-4 overflow-x-auto leading-relaxed">
{`{
  "type": "service_account",
  "project_id": "my-project-123",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\\n...",
  "client_email": "agent@my-project.iam.gserviceaccount.com",
  ...
}`}
          </pre>
        )}

        <div className="mb-3">
          <label className="label">Service Account JSON *</label>
          <textarea className="input font-mono text-xs resize-none" rows={7}
            placeholder="Paste the full contents of your downloaded .json key file here..."
            value={json} onChange={e => { setJson(e.target.value); setError(''); }} />
        </div>

        {needsCalendar && (
          <div className="mb-4">
            <label className="label">Your Timezone</label>
            <input className="input text-sm"
              placeholder="e.g. Asia/Kolkata, America/New_York, Europe/London"
              value={tz} onChange={e => setTz(e.target.value)} />
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
            <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        <button onClick={connect} className="btn-primary w-full justify-center">
          <CheckCircle size={15} /> Connect &amp; Start Chat
        </button>
      </div>
    </div>
  );
}

// ── Download helpers ──────────────────────────────────────────────────────────

async function downloadAs(content, format, label) {
  try {
    const res = await axios.post(`${API}/export`, {
      content, format, filename: label, title: label,
    }, { responseType: 'blob' });

    const ext  = format === 'pdf' ? 'pdf' : 'xlsx';
    const mime = format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const url = window.URL.createObjectURL(new Blob([res.data], { type: mime }));
    const a   = document.createElement('a');
    a.href = url; a.download = `${label}.${ext}`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); window.URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export failed: ' + (e.message || 'Unknown error'));
  }
}

function extractFilledPath(text) {
  const m = text.match(/DOWNLOAD_PATH\s*:\s*(.+\.pdf)/i);
  return m ? m[1].trim() : null;
}

async function downloadFilledPdf(filePath) {
  try {
    const res = await axios.get(`${API}/download`, {
      params: { path: filePath },
      responseType: 'blob',
    });
    const filename = filePath.split(/[\\/]/).pop();
    const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a   = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); window.URL.revokeObjectURL(url);
  } catch (e) {
    alert('Download failed: ' + (e.message || 'Unknown error'));
  }
}

// ── Agent message builder ─────────────────────────────────────────────────────
// fillDataJson — when provided (after UI field collection) the agent is told
// to fill immediately without asking the user for any more data.

function buildStandaloneAgentMessage(agent, userText, pendingFile, uploadedFiles = [], fillDataJson = null) {
  const tools = agent.tools || [];
  const sections = [
    `## User Request\n${userText || 'Complete the task using your configured tools.'}`,
  ];

  if (agent.description) {
    sections.push(`## Agent Description\n${agent.description}`);
  }

  if (tools.length) {
    sections.push(
      `## Configured Tools\n${tools.join(', ')}\nUse these tools when they are relevant. Follow the agent system prompt first, then the user's request.`
    );
  }

  if (pendingFile && tools.includes('pdf_analyzer')) {
    if (fillDataJson) {
      // Fill data already collected by the UI — forbid the agent from asking
      sections.push(
        `## PDF Fill Task — Execute Immediately\n` +
        `A PDF file has been uploaded AND all fill data has been collected by the UI.\n` +
        `File name: ${pendingFile.filename}\n` +
        `File path: ${pendingFile.path}\n\n` +
        `CRITICAL INSTRUCTIONS — follow exactly:\n` +
        `1. Do NOT ask the user for any data. Do NOT say "please provide data".\n` +
        `2. Run detect_pdf_form_fields first to get field positions.\n` +
        `3. Immediately call fill_pdf_form using the EXACT file path above and the fill data below.\n` +
        `4. Return the exact DOWNLOAD_PATH line from fill_pdf_form so the UI can show the download button.\n\n` +
        `Fill data (JSON):\n${fillDataJson}`
      );
    } else {
      sections.push(
        `## PDF Input\nA PDF file has been uploaded.\n` +
        `File name: ${pendingFile.filename}\n` +
        `File path: ${pendingFile.path}\n\n` +
        `If the user provided field data, run detect_pdf_form_fields first, then fill_pdf_form with this exact file path and the user's data. ` +
        `Return the exact DOWNLOAD_PATH from fill_pdf_form so the UI can show the completed PDF download.`
      );
    }
  }

  if (uploadedFiles.length && tools.includes('folder_files')) {
    sections.push(
      `## Uploaded Files\nThe user uploaded these files/folder items. Use list_uploaded_files or read_uploaded_file as needed.\n` +
      uploadedFiles.map(f => `- ${f.filename}\n  PATH: ${f.path}`).join('\n')
    );
  }

  if (uploadedFiles.length && tools.includes('ats_resume')) {
    const firstResume = uploadedFiles.find(f => /\.(pdf|docx|txt)$/i.test(f.filename)) || uploadedFiles[0];
    sections.push(
      `## ATS Resume Scoring\nIf the request is about ATS or resume scoring, call calculate_ats_resume_score.\n` +
      `Resume path: ${firstResume.path}\n` +
      `Use the user's message as the job_description when it contains a job description.`
    );
  }

  if (tools.includes('google_drive')) {
    sections.push(
      `## Google Drive Output\nWhen a generated file is available, upload it to this Drive folder using upload_file_to_drive:\n` +
      `${DRIVE_FOLDER_URL}\n` +
      `Use the exact DOWNLOAD_PATH from the file-generation tool as file_path. After uploading, include DRIVE_PATH, DRIVE_LINK, and DOWNLOAD_PATH in your final response.`
    );
  }

  if (tools.includes('email')) {
    sections.push(
      `## Email Tool\nIf the user asks to send a generated file, pass the exact DOWNLOAD_PATH unchanged to send_pdf_by_email.`
    );
  }

  return sections.join('\n\n');
}

// ── Message bubble ────────────────────────────────────────────────────────────
// isGreeting — set on the initial "Hello! I'm …" message so export buttons
// are not shown on it (they only make sense on task-output responses).

function MessageBubble({ msg, index }) {
  const [downloading, setDownloading] = useState('');
  const label      = `yuno_response_${index + 1}`;
  const filledPath = msg.role === 'assistant' ? extractFilledPath(msg.content) : null;

  const displayContent = msg.content
    .replace(/DOWNLOAD_PATH\s*:.+/gi, '')
    .trim();

  const dl = async (fmt) => {
    setDownloading(fmt);
    await downloadAs(displayContent, fmt, label);
    setDownloading('');
  };

  const dlFilled = async () => {
    setDownloading('filled');
    await downloadFilledPdf(filledPath);
    setDownloading('');
  };

  if (msg.role === 'user') {
    return (
      <div className="flex gap-3 justify-end">
        <div className="max-w-[75%] flex flex-col items-end gap-1">
          {msg.attachment && (
            <div className="flex items-center gap-2 bg-brand-100 border border-brand-300 rounded-xl px-3 py-1.5">
              <FileText size={13} className="text-brand-600" />
              <span className="text-xs text-brand-700 font-medium">{msg.attachment}</span>
            </div>
          )}
          <div className="bg-brand-500 text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed">
            {msg.content}
          </div>
        </div>
        <div className="w-7 h-7 bg-gray-200 rounded-full flex items-center justify-center shrink-0 mt-0.5">
          <User size={14} className="text-gray-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 justify-start">
      <div className="w-7 h-7 bg-pink-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
        <Bot size={14} className="text-brand-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="bg-gray-100 text-gray-800 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed">
          {displayContent}
        </div>

        {/* Filled PDF download — shown when agent fills a form */}
        {filledPath && (
          <button
            onClick={dlFilled}
            disabled={!!downloading}
            className="mt-2 ml-1 flex items-center gap-1.5 text-xs font-semibold text-white bg-brand-500 hover:bg-brand-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            {downloading === 'filled'
              ? <Loader size={12} className="animate-spin" />
              : <FileText size={12} />}
            Download Filled PDF
          </button>
        )}

        {/* Export toolbar — hidden on greeting messages and when a filled PDF
            is already available (it has its own "Download Filled PDF" button) */}
        {!msg.isGreeting && !filledPath && (
          <div className="flex items-center gap-2 mt-1.5 ml-1">
            <button onClick={() => dl('pdf')} disabled={!!downloading}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 hover:bg-red-50 px-2 py-0.5 rounded transition-colors">
              {downloading === 'pdf' ? <Loader size={11} className="animate-spin" /> : <FileText size={11} />}
              Export PDF
            </button>
            <span className="text-gray-200">|</span>
            <button onClick={() => dl('excel')} disabled={!!downloading}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-green-600 hover:bg-green-50 px-2 py-0.5 rounded transition-colors">
              {downloading === 'excel' ? <Loader size={11} className="animate-spin" /> : <Download size={11} />}
              Export Excel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Label quality filters (same as RunModal) ──────────────────────────────────
// Removes section headings, parenthetical instructions, single-char bullets.

function isRealLabel(lbl) {
  const s = (lbl || '').trim();
  if (!s || s.length <= 2) return false;
  if (s.startsWith('(') && s.endsWith(')')) return false;
  const alpha = s.replace(/[^a-zA-Z]/g, '');
  if (alpha.length > 5 && alpha === alpha.toUpperCase()) return false;
  return true;
}
const isRealOption = (t) => (t || '').trim().length > 1;

// ── Main modal ────────────────────────────────────────────────────────────────

export default function TestAgentModal({ agent, onClose }) {
  const needsCalendar = HAS_CALENDAR(agent);
  const needsDrive    = HAS_DRIVE(agent);
  const needsGoogle   = needsCalendar || needsDrive;

  const [calCreds, setCalCreds]   = useState(null);
  const [calTz, setCalTz]         = useState('UTC');
  const [connected, setConnected] = useState(!needsGoogle);

  const [messages, setMessages]       = useState([]);
  const [introLoading, setIntroLoading] = useState(true);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(false);

  // PDF upload state
  const [uploading, setUploading]     = useState(false);
  const [pendingFile, setPendingFile] = useState(null);   // { filename, path }
  const [uploadedFiles, setUploadedFiles] = useState([]);

  // ── PDF field-detection state ─────────────────────────────────────────────
  const [pdfDetecting,       setPdfDetecting]       = useState(false);   // OCR in progress
  const [pdfPendingQuestions, setPdfPendingQuestions] = useState(null);  // builtQuestions waiting for mode choice
  const [pdfInputMode,       setPdfInputMode]       = useState(null);    // null | 'one-by-one' | 'all-at-once'
  const [pdfFieldQuestions,  setPdfFieldQuestions]  = useState([]);
  const [pdfFieldQIdx,       setPdfFieldQIdx]       = useState(0);
  const [fieldValues,        setFieldValues]        = useState({});
  const fieldValuesRef = useRef({});
  // ref to the pending file at time of field collection (pendingFile may be cleared)
  const pendingFileForFill = useRef(null);

  const fileRef    = useRef(null);
  const folderRef  = useRef(null);
  const bottomRef  = useRef(null);
  const textRef    = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Dynamic greeting on mount ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setIntroLoading(true);

    axios.post(`${API}/agent/intro`, {
      agent: {
        name:          agent.name,
        role:          agent.role,
        system_prompt: agent.system_prompt,
        description:   agent.description,
        tools:         agent.tools || [],
      },
      openai_api_key: '',
    })
      .then(res => {
        if (!cancelled) {
          const greeting = res.data?.greeting
            || `Hi! I'm ${agent.name}. ${agent.description || 'How can I help you?'}`;
          // isGreeting=true hides Export buttons on this message
          setMessages([{ role: 'assistant', content: greeting, isGreeting: true }]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessages([{
            role: 'assistant',
            content: `Hi! I'm ${agent.name}. ${agent.description || 'How can I help you?'}`,
            isGreeting: true,
          }]);
        }
      })
      .finally(() => { if (!cancelled) setIntroLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = (parsed, tz) => {
    setCalCreds(parsed);
    setCalTz(tz);
    setConnected(true);
  };

  // ── PDF upload + automatic field detection ───────────────────────────────
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post(`${API}/upload/pdf`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const fileData = { filename: res.data.filename || file.name, path: res.data.path };
      setPendingFile(fileData);
      pendingFileForFill.current = fileData;

      // ── Auto-detect form fields ──────────────────────────────────────────
      if (HAS_PDF(agent)) {
        setPdfDetecting(true);
        try {
          const { data: fieldsData } = await axios.post(`${API}/pdf/detect-fields`, { path: res.data.path });
          const rawFields     = fieldsData.fields     || [];
          const rawCheckboxes = fieldsData.checkboxes || [];

          const fields = rawFields.filter(f => isRealLabel(f.label));
          const checkboxes = rawCheckboxes
            .filter(cb => isRealLabel(cb.label))
            .map(cb => ({ ...cb, options: cb.options.filter(o => isRealOption(o.text)) }))
            .filter(cb => cb.options.length >= 2);

          const total = fields.length + checkboxes.length;

          if (total > 0) {
            const builtQuestions = [
              ...fields.map(f => ({
                key:      f.label,
                type:     'text',
                question: `What should I enter for **${f.label}**?`,
              })),
              ...checkboxes.map(cb => ({
                key:      cb.label,
                type:     'checkbox',
                options:  cb.options.map(o => o.text),
                question: `For **${cb.label}**, which option applies?`,
              })),
            ];

            setPdfPendingQuestions(builtQuestions);
            setFieldValues({});
            fieldValuesRef.current = {};

            // Show field overview in chat
            let overview = `✅ Found **${total} fillable field${total !== 1 ? 's' : ''}** in **${file.name}**:\n\n`;
            if (fields.length) {
              overview += `📝 **Text Fields (${fields.length}):**\n`;
              overview += fields.map(f => `  • ${f.label}`).join('\n');
              overview += '\n\n';
            }
            if (checkboxes.length) {
              overview += `☑ **Choice Fields (${checkboxes.length}):**\n`;
              overview += checkboxes.map(cb =>
                `  • ${cb.label}: ${cb.options.map(o => o.text).join(' / ')}`
              ).join('\n');
              overview += '\n\n';
            }
            overview += `👇 **Choose how you'd like to fill the fields in the panel below.**`;
            setMessages(prev => [...prev, { role: 'assistant', content: overview }]);
          }
        } catch (_) {
          // Detect endpoint unavailable — normal chat continues without field UI
        } finally {
          setPdfDetecting(false);
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Could not upload PDF: ${err.response?.data?.detail || err.message}`,
      }]);
    } finally {
      setUploading(false);
    }
  };

  const handleFilesChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = '';
    setUploading(true);
    try {
      const formData = new FormData();
      files.forEach(file => {
        const rel = file.webkitRelativePath || file.name;
        formData.append('files', file, rel);
      });
      const res = await axios.post(`${API}/upload/files`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploadedFiles(res.data.files || []);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Uploaded ${res.data.count || files.length} file(s). You can now ask me to read, summarize, upload, or score them.`,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Could not upload files: ${err.response?.data?.detail || err.message}`,
      }]);
    } finally {
      setUploading(false);
    }
  };

  // ── PDF one-by-one field answer ──────────────────────────────────────────
  const handleFieldAnswer = (rawAnswer) => {
    const currentField = pdfFieldQuestions[pdfFieldQIdx];
    if (!currentField) return;

    const answer = rawAnswer.trim();
    if (answer) {
      setMessages(prev => [...prev, { role: 'user', content: answer }]);
      fieldValuesRef.current = { ...fieldValuesRef.current, [currentField.key]: answer };
      setFieldValues({ ...fieldValuesRef.current });
    } else {
      setMessages(prev => [...prev, { role: 'user', content: '(skip)' }]);
    }

    setInput('');
    const nextIdx = pdfFieldQIdx + 1;

    if (nextIdx < pdfFieldQuestions.length) {
      setPdfFieldQIdx(nextIdx);
      const next = pdfFieldQuestions[nextIdx];
      setTimeout(() => {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: next.type === 'checkbox'
            ? `${next.question}\n\nChoose: ${next.options.join(' · ')}`
            : next.question,
        }]);
      }, 150);
    } else {
      _submitPdfFields();
    }
  };

  // ── Submit all collected PDF field values → send to agent ────────────────
  const _submitPdfFields = () => {
    const filled = Object.entries(fieldValuesRef.current).filter(([, v]) => v);

    if (filled.length === 0) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠ No fields were filled. Please provide at least one value to fill the PDF.',
      }]);
      if (pdfInputMode === 'one-by-one' && pdfFieldQuestions.length > 0) {
        setPdfFieldQIdx(0);
        const first = pdfFieldQuestions[0];
        setTimeout(() => {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: first.type === 'checkbox'
              ? `${first.question}\n\nChoose: ${first.options.join(' · ')}`
              : first.question,
          }]);
        }, 250);
      }
      return;
    }

    const jsonStr = JSON.stringify(Object.fromEntries(filled), null, 2);
    const summary = filled.map(([k, v]) => `  • ${k}: ${v}`).join('\n');

    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `✅ Collected **${filled.length}** value${filled.length !== 1 ? 's' : ''}:\n\n${summary}\n\nGenerating your filled PDF now…`,
    }]);

    // Capture the pending file before clearing state
    const fileToFill = pendingFileForFill.current;

    // Clear all PDF field state
    setPdfPendingQuestions(null);
    setPdfInputMode(null);
    setPdfFieldQuestions([]);
    setPdfFieldQIdx(0);
    setFieldValues({});
    fieldValuesRef.current = {};
    setPendingFile(null);

    // Auto-send to agent with fill data
    _sendFillRequest(jsonStr, fileToFill);
  };

  const _sendFillRequest = async (fillDataJson, fileForFill) => {
    setLoading(true);
    setMessages(prev => [...prev, {
      role: 'user',
      content: 'Fill the PDF with the collected data.',
      attachment: fileForFill?.filename,
    }]);

    try {
      const agentMsg = buildStandaloneAgentMessage(agent, null, fileForFill, uploadedFiles, fillDataJson);
      const body = {
        agent: {
          name:          agent.name,
          role:          agent.role,
          system_prompt: agent.system_prompt,
          model:         agent.model,
          tools:         agent.tools || [],
          temperature:   agent.temperature,
          max_tokens:    agent.max_tokens,
        },
        message:        agentMsg,
        openai_api_key: '',
        ...(calCreds ? { google_credentials: calCreds, calendar_timezone: calTz } : {}),
      };
      const res   = await axios.post(`${API}/execute/agent`, body);
      const reply = res.data?.output || 'No response.';
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      if (uploadedFiles.length) setUploadedFiles([]);
    } catch (err) {
      const detail = err.response?.data?.detail || err.message;
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${detail}` }]);
    } finally {
      setLoading(false);
    }
  };

  // ── Normal send (non-PDF or PDF without field collection) ────────────────
  const send = async () => {
    if (loading) return;

    let text = input.trim();
    const attachment = pendingFile ? pendingFile.filename : null;

    if (!text && !pendingFile && uploadedFiles.length === 0) return;

    const fileForRequest = pendingFile;
    if (fileForRequest && !text) {
      text = 'Analyze the uploaded PDF. If field data is available in this chat, fill the PDF form.';
    }
    if (fileForRequest) setPendingFile(null);

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: input.trim() || 'Analyze the uploaded PDF.', attachment }]);
    setLoading(true);

    try {
      const body = {
        agent: {
          name:          agent.name,
          role:          agent.role,
          system_prompt: agent.system_prompt,
          model:         agent.model,
          tools:         agent.tools || [],
          temperature:   agent.temperature,
          max_tokens:    agent.max_tokens,
        },
        message:        buildStandaloneAgentMessage(agent, text, fileForRequest, uploadedFiles),
        openai_api_key: '',
        ...(calCreds ? { google_credentials: calCreds, calendar_timezone: calTz } : {}),
      };

      const res   = await axios.post(`${API}/execute/agent`, body);
      const reply = res.data?.output || 'No response.';
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      if (uploadedFiles.length) setUploadedFiles([]);
    } catch (err) {
      const detail = err.response?.data?.detail || err.message;
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${detail}` }]);
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // Whether any PDF field panel is active (hides the normal textarea)
  const pdfPanelActive =
    pdfDetecting ||
    (pdfPendingQuestions !== null && pdfInputMode === null) ||
    pdfInputMode === 'one-by-one' ||
    pdfInputMode === 'all-at-once';

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-2xl flex flex-col" style={{ height: '78vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-8 h-8 bg-pink-100 rounded-lg flex items-center justify-center">
              <Bot size={16} className="text-brand-500" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">{agent.name}</p>
              <p className="text-xs text-gray-400 capitalize">{agent.role} · {agent.model}</p>
            </div>
            {needsCalendar && connected && (
              <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                <CheckCircle size={10} /> Calendar
              </span>
            )}
            {needsDrive && connected && (
              <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                <CheckCircle size={10} /> Drive
              </span>
            )}
            {HAS_PDF(agent) && (
              <span className="flex items-center gap-1 text-xs text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
                <FileText size={10} /> PDF Analyzer
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        {!connected ? (
          <GoogleConnectScreen onConnect={handleConnect} needsCalendar={needsCalendar} needsDrive={needsDrive} />
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {introLoading && (
                <div className="flex gap-3 justify-start">
                  <div className="w-7 h-7 bg-pink-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                    <Bot size={14} className="text-brand-500" />
                  </div>
                  <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2">
                    <Loader size={14} className="text-gray-400 animate-spin" />
                    <span className="text-xs text-gray-400">Initializing {agent.name}…</span>
                  </div>
                </div>
              )}

              {!introLoading && messages.map((msg, i) => (
                <MessageBubble key={i} msg={msg} index={i} />
              ))}

              {loading && (
                <div className="flex gap-3 justify-start">
                  <div className="w-7 h-7 bg-pink-100 rounded-full flex items-center justify-center shrink-0">
                    <Bot size={14} className="text-brand-500" />
                  </div>
                  <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3">
                    <Loader size={14} className="text-gray-400 animate-spin" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* ── OCR scan in-progress ──────────────────────────────────────── */}
            {pdfDetecting && (
              <div className="border-t border-gray-200 bg-white px-5 py-3 flex items-center gap-2.5 text-sm text-gray-500 shrink-0">
                <Loader size={14} className="animate-spin text-pink-500 shrink-0" />
                <span>Scanning PDF for form fields…</span>
              </div>
            )}

            {/* ── Fill-mode choice panel ────────────────────────────────────── */}
            {!pdfDetecting && pdfPendingQuestions !== null && pdfInputMode === null && (
              <div className="border-t-2 border-pink-200 bg-white px-5 py-4 shrink-0">
                <p className="text-sm font-semibold text-gray-700 mb-0.5">
                  {pdfPendingQuestions.length} field{pdfPendingQuestions.length !== 1 ? 's' : ''} detected — how would you like to fill them?
                </p>
                <p className="text-xs text-gray-400 mb-3">Choose your preferred fill mode:</p>
                <div className="flex gap-3">

                  {/* One by one */}
                  <button
                    onClick={() => {
                      const qs = pdfPendingQuestions;
                      setPdfInputMode('one-by-one');
                      setPdfFieldQuestions(qs);
                      setPdfPendingQuestions(null);
                      const first = qs[0];
                      setTimeout(() => {
                        setMessages(prev => [...prev, {
                          role: 'assistant',
                          content: first.type === 'checkbox'
                            ? `${first.question}\n\nChoose: ${first.options.join(' · ')}`
                            : first.question,
                        }]);
                      }, 150);
                    }}
                    className="flex-1 flex flex-col items-center gap-1.5
                               bg-green-50 hover:bg-green-100 border border-green-300 hover:border-green-400
                               text-green-700 rounded-xl py-4 px-3 transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <span className="text-xl">📝</span>
                    <span className="text-sm font-semibold">One by one</span>
                    <span className="text-xs text-green-600/80 text-center leading-snug">Answer each field question by question</span>
                  </button>

                  {/* All at once */}
                  <button
                    onClick={() => {
                      const qs = pdfPendingQuestions;
                      setPdfInputMode('all-at-once');
                      setPdfFieldQuestions(qs);
                      setPdfPendingQuestions(null);
                      setTimeout(() => {
                        setMessages(prev => [...prev, {
                          role: 'assistant',
                          content: `Fill in the fields in the panel below, then click **Fill PDF with these values** when ready.`,
                        }]);
                      }, 150);
                    }}
                    className="flex-1 flex flex-col items-center gap-1.5
                               bg-blue-50 hover:bg-blue-100 border border-blue-300 hover:border-blue-400
                               text-blue-700 rounded-xl py-4 px-3 transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <span className="text-xl">📋</span>
                    <span className="text-sm font-semibold">All at once</span>
                    <span className="text-xs text-blue-600/80 text-center leading-snug">Fill all fields in one scrollable form</span>
                  </button>

                </div>
              </div>
            )}

            {/* ── All-at-once bulk form ─────────────────────────────────────── */}
            {!pdfDetecting && pdfInputMode === 'all-at-once' && pdfFieldQuestions.length > 0 && (
              <div className="border-t border-gray-200 bg-white px-4 py-3 shrink-0" style={{ maxHeight: '22rem', overflowY: 'auto' }}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-gray-600">Fill in the fields below</span>
                  <span className="text-[11px] text-gray-400">
                    {pdfFieldQuestions.length} fields · leave blank to skip
                  </span>
                </div>
                <div className="space-y-2">
                  {pdfFieldQuestions.map((field) => (
                    <div key={field.key} className="flex items-center gap-2 min-w-0">
                      <label className="text-[11px] text-gray-500 w-36 shrink-0 truncate" title={field.key}>
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
                                     focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-400 transition-all"
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

            {/* ── One-by-one input ──────────────────────────────────────────── */}
            {!pdfDetecting && pdfInputMode === 'one-by-one' && pdfFieldQuestions.length > 0 && (
              <div className="border-t border-gray-200 bg-white px-4 py-3 shrink-0">
                {/* Progress */}
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
                <div className="w-full h-0.5 bg-gray-100 rounded-full mb-3">
                  <div
                    className="h-full bg-pink-400 rounded-full transition-all"
                    style={{ width: `${(pdfFieldQIdx / pdfFieldQuestions.length) * 100}%` }}
                  />
                </div>

                {pdfFieldQuestions[pdfFieldQIdx]?.type === 'checkbox' ? (
                  <div className="flex flex-wrap gap-2">
                    {pdfFieldQuestions[pdfFieldQIdx].options.map(opt => (
                      <button key={opt} onClick={() => handleFieldAnswer(opt)}
                        className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700
                                   hover:border-pink-400 hover:bg-pink-50 hover:text-pink-600
                                   transition-all active:scale-95">
                        {opt}
                      </button>
                    ))}
                    <button onClick={() => handleFieldAnswer('')}
                      className="px-4 py-2 rounded-lg border border-dashed border-gray-200 text-sm
                                 text-gray-400 hover:border-gray-400 transition-all">
                      Skip
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      autoFocus
                      ref={textRef}
                      className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm
                                 focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-400 transition-all"
                      placeholder="Type value, or press Enter to skip…"
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleFieldAnswer(input);
                          setInput('');
                        }
                      }}
                    />
                    <button
                      onClick={() => { handleFieldAnswer(input); setInput(''); }}
                      className="btn-primary py-2.5 px-4 shrink-0"
                    >
                      <Send size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Staged PDF indicator ──────────────────────────────────────── */}
            {pendingFile && !pdfPanelActive && (
              <div className="px-5 py-2 border-t border-gray-100 bg-orange-50 flex items-center gap-2">
                <FileText size={14} className="text-orange-500 shrink-0" />
                <span className="text-xs text-orange-700 font-medium flex-1 truncate">
                  {pendingFile.filename}
                </span>
                <span className="text-xs text-orange-500">PDF ready</span>
                <button onClick={() => setPendingFile(null)} className="text-orange-400 hover:text-orange-700 ml-1">
                  <X size={13} />
                </button>
              </div>
            )}

            {uploadedFiles.length > 0 && (
              <div className="px-5 py-2 border-t border-gray-100 bg-blue-50 flex items-center gap-2">
                <FileIcon size={14} className="text-blue-500 shrink-0" />
                <span className="text-xs text-blue-700 font-medium flex-1 truncate">
                  {uploadedFiles.length} uploaded file{uploadedFiles.length !== 1 ? 's' : ''} ready
                </span>
                <button onClick={() => setUploadedFiles([])} className="text-blue-400 hover:text-blue-700 ml-1">
                  <X size={13} />
                </button>
              </div>
            )}

            {/* ── Normal input bar (hidden while PDF panels are active) ─────── */}
            {!pdfPanelActive && (
              <div className="px-5 py-4 border-t border-gray-200 shrink-0">
                <div className="flex gap-2 items-end">

                  <input
                    ref={fileRef}
                    type="file"
                    accept={HAS_PDF(agent) ? '.pdf' : '.pdf,.docx,.txt,.csv,.json'}
                    className="hidden"
                    onChange={HAS_PDF(agent) && !HAS_FILES(agent) ? handleFileChange : handleFilesChange}
                  />
                  <input
                    ref={folderRef}
                    type="file"
                    className="hidden"
                    multiple
                    webkitdirectory=""
                    onChange={handleFilesChange}
                  />

                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading || loading}
                    title="Upload PDF"
                    className={`shrink-0 self-end p-2.5 rounded-lg border transition-colors ${
                      pendingFile
                        ? 'border-orange-400 bg-orange-50 text-orange-500'
                        : 'border-gray-200 bg-gray-50 text-gray-400 hover:border-brand-400 hover:text-brand-500 hover:bg-pink-50'
                    }`}
                  >
                    {uploading
                      ? <Loader size={16} className="animate-spin" />
                      : <Paperclip size={16} />}
                  </button>

                  {HAS_FILES(agent) && (
                    <button
                      onClick={() => folderRef.current?.click()}
                      disabled={uploading || loading}
                      title="Upload folder"
                      className="shrink-0 self-end p-2.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                    >
                      {uploading ? <Loader size={16} className="animate-spin" /> : <FileIcon size={16} />}
                    </button>
                  )}

                  <textarea
                    className="input resize-none text-sm flex-1"
                    rows={2}
                    placeholder={
                      pendingFile
                        ? `Add a message or press Send to analyze ${pendingFile.filename}…`
                        : `Message ${agent.name}…`
                    }
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={onKey}
                    disabled={loading}
                  />

                  <button
                    onClick={send}
                    disabled={(!input.trim() && !pendingFile && uploadedFiles.length === 0) || loading}
                    className="btn-primary px-3 self-end shrink-0"
                  >
                    <Send size={16} />
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  Enter to send · Shift+Enter for new line
                  {HAS_PDF(agent) && ' · 📎 Upload PDF to auto-detect and fill form fields'}
                  {HAS_DRIVE(agent) && ' · saves generated files to Drive'}
                  {HAS_FILES(agent) && ' · upload files/folders for analysis'}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
