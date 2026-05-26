import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { agentsApi } from '../services/api.js';
import { ArrowLeft, Plus, Trash2, Brain, Wrench } from 'lucide-react';
import AgentForm from '../components/AgentCard/AgentForm.jsx';

export default function AgentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [agent, setAgent] = useState(null);
  const [memory, setMemory] = useState([]);
  const [editing, setEditing] = useState(false);
  const [newMem, setNewMem] = useState({ key: '', value: '' });

  const load = async () => {
    try {
      const [a, m] = await Promise.all([agentsApi.get(id), agentsApi.getMemory(id)]);
      setAgent(a);
      setMemory(m);
    } catch (e) { navigate('/agents'); }
  };

  useEffect(() => { load(); }, [id]);

  const handleUpdate = async (data) => {
    try {
      await agentsApi.update(id, data);
      toast.success('Agent updated');
      setEditing(false);
      load();
    } catch (e) { toast.error('Failed to update'); }
  };

  const addMemory = async () => {
    if (!newMem.key || !newMem.value) return;
    try {
      await agentsApi.setMemory(id, newMem);
      setNewMem({ key: '', value: '' });
      load();
    } catch (e) { toast.error('Failed to add memory'); }
  };

  const deleteMemory = async (key) => {
    try {
      await agentsApi.deleteMemory(id, key);
      load();
    } catch (e) { toast.error('Failed to delete'); }
  };

  if (!agent) return <div className="p-6 text-gray-400">Loading...</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/agents')}
          className="text-gray-400 hover:text-gray-900 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{agent.name}</h1>
        <span className="badge badge-gray capitalize">{agent.role}</span>
      </div>

      {editing ? (
        <AgentForm initial={agent} onSave={handleUpdate} onCancel={() => setEditing(false)} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Configuration</h2>
              <button onClick={() => setEditing(true)} className="btn-secondary text-sm py-1.5">Edit</button>
            </div>
            <Field label="Model" value={agent.model} />
            <Field label="Max Tokens" value={agent.max_tokens} />
            <Field label="Temperature" value={agent.temperature} />
            <Field label="Memory" value={agent.memory_enabled ? 'Enabled' : 'Disabled'} />

            <div>
              <p className="label">System Prompt</p>
              <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3 whitespace-pre-wrap">
                {agent.system_prompt || <span className="text-gray-400">No system prompt</span>}
              </p>
            </div>

            <div>
              <p className="label flex items-center gap-1"><Wrench size={12} />Tools</p>
              <div className="flex flex-wrap gap-2">
                {agent.tools?.length > 0
                  ? agent.tools.map(t => <span key={t} className="badge badge-blue">{t}</span>)
                  : <span className="text-sm text-gray-400">No tools</span>}
              </div>
            </div>
          </div>

          {/* Memory */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Brain size={16} className="text-brand-500" />
              <h2 className="font-semibold text-gray-900">Agent Memory</h2>
            </div>

            <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
              {memory.length > 0 ? memory.map(m => (
                <div key={m.id} className="flex items-start gap-2 bg-gray-50 border border-gray-200 rounded-lg p-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700">{m.key}</p>
                    <p className="text-xs text-gray-400 truncate">{m.value}</p>
                  </div>
                  <button onClick={() => deleteMemory(m.key)}
                    className="text-gray-400 hover:text-red-500 transition-colors shrink-0">
                    <Trash2 size={12} />
                  </button>
                </div>
              )) : (
                <p className="text-sm text-gray-400">No memories stored</p>
              )}
            </div>

            <div className="space-y-2">
              <input className="input text-sm" placeholder="Key" value={newMem.key}
                onChange={e => setNewMem(n => ({ ...n, key: e.target.value }))} />
              <input className="input text-sm" placeholder="Value" value={newMem.value}
                onChange={e => setNewMem(n => ({ ...n, value: e.target.value }))} />
              <button onClick={addMemory} className="btn-primary text-sm w-full justify-center">
                <Plus size={14} />Add Memory
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="text-sm text-gray-800">{value}</p>
    </div>
  );
}
