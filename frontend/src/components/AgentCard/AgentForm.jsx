import { useState } from 'react';
import { X } from 'lucide-react';

const MODELS = [
  'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'
];

const TOOLS = [
  { id: 'web_search',   label: 'Web Search',    desc: 'Search the internet via DuckDuckGo' },
  { id: 'calculator',   label: 'Calculator',     desc: 'Evaluate math expressions' },
  { id: 'http_request', label: 'HTTP Request',   desc: 'Call any REST API' },
  { id: 'code_executor',label: 'Code Executor',  desc: 'Run sandboxed Python snippets' },
  { id: 'folder_files', label: 'Folder Files',   desc: 'Upload folders/files and let agents list or read them' },
  { id: 'ats_resume',   label: 'ATS Resume Score', desc: 'Score a resume against a job description' },
  { id: 'datetime',     label: 'Date & Time',    desc: 'Get current date/time/timezone' },
  { id: 'github',       label: 'GitHub',         desc: 'Clone repos, read files, run shell commands' },
  { id: 'sandbox_exec', label: 'Sandbox Exec',   desc: 'Full Python env — install packages, run files, see errors' },
  { id: 'pdf_analyzer',      label: 'PDF Analyzer & Filler', desc: 'Detect form fields in any PDF and fill them with your data — download completed PDF' },
  { id: 'google_calendar',  label: 'Google Calendar', desc: 'List events, create meetings with Meet links, find free slots' },
  { id: 'google_drive',     label: 'Google Drive', desc: 'Upload generated files such as filled PDFs to Drive folders' },
  { id: 'email',            label: 'Email (Mailer)',  desc: 'Send emails, attach filled PDFs, schedule recurring emails via cron' },
];

const ROLES = ['assistant', 'researcher', 'writer', 'analyst', 'classifier', 'coordinator', 'specialist'];

const DEFAULT = {
  name: '', description: '', role: 'assistant',
  system_prompt: '', model: 'gpt-4o', tools: [],
  memory_enabled: false, max_tokens: 2000, temperature: 0.7,
  guardrails: { max_message_length: 4000, profanity_filter: false }
};

export default function AgentForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({ ...DEFAULT, ...initial });

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const toggleTool = (tool) => {
    set('tools', form.tools.includes(tool)
      ? form.tools.filter(t => t !== tool)
      : [...form.tools, tool]
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave(form);
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold text-gray-900">{initial ? 'Edit Agent' : 'Create Agent'}</h2>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-900 transition-colors">
          <X size={18} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Name *</label>
            <input className="input" placeholder="My Agent" value={form.name}
              onChange={e => set('name', e.target.value)} required />
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={e => set('role', e.target.value)}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Description</label>
          <input className="input" placeholder="Brief description of what this agent does"
            value={form.description} onChange={e => set('description', e.target.value)} />
        </div>

        <div>
          <label className="label">System Prompt</label>
          <textarea className="input" rows={4}
            placeholder="You are a helpful AI assistant that..."
            value={form.system_prompt} onChange={e => set('system_prompt', e.target.value)} />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Model</label>
            <select className="input" value={form.model} onChange={e => set('model', e.target.value)}>
              {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Max Tokens</label>
            <input type="number" className="input" min={100} max={8000} value={form.max_tokens}
              onChange={e => set('max_tokens', Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Temperature: {form.temperature}</label>
            <input type="range" className="w-full accent-brand-500 mt-2" min={0} max={1} step={0.1}
              value={form.temperature} onChange={e => set('temperature', Number(e.target.value))} />
          </div>
        </div>

        <div>
          <label className="label">Tools</label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {TOOLS.map(tool => (
              <label key={tool.id}
                className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  form.tools.includes(tool.id)
                    ? 'border-brand-500 bg-pink-50'
                    : 'border-gray-200 bg-gray-50 hover:border-gray-400'
                }`}>
                <input type="checkbox" className="mt-0.5 accent-brand-500"
                  checked={form.tools.includes(tool.id)}
                  onChange={() => toggleTool(tool.id)} />
                <div>
                  <p className="text-xs font-medium text-gray-800">{tool.label}</p>
                  <p className="text-xs text-gray-400">{tool.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <div className={`w-10 h-5 rounded-full transition-colors relative ${form.memory_enabled ? 'bg-brand-500' : 'bg-gray-300'}`}
              onClick={() => set('memory_enabled', !form.memory_enabled)}>
              <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform shadow-sm ${form.memory_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-sm text-gray-700">Enable Memory</span>
          </label>
        </div>

        <div className="flex gap-3 justify-end pt-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn-primary">{initial ? 'Save Changes' : 'Create Agent'}</button>
        </div>
      </form>
    </div>
  );
}
