import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { agentsApi } from '../services/api.js';
import { Bot, Plus, Trash2, Wrench, Brain, MessageCircle } from 'lucide-react';
import AgentForm from '../components/AgentCard/AgentForm.jsx';
import TestAgentModal from '../components/AgentCard/TestAgentModal.jsx';

const TOOL_LABELS = {
  web_search:   'Web Search',
  calculator:   'Calculator',
  http_request: 'HTTP',
  code_executor:'Code Exec',
  folder_files: 'Files',
  ats_resume:   'ATS',
  datetime:     'DateTime',
  github:       'GitHub',
  sandbox_exec: 'Sandbox',
  pdf_analyzer:     'PDF Fill',
  google_calendar:  'Calendar',
  google_drive:     'Drive',
  email:            'Email',
};

export default function Agents() {
  const [agents, setAgents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [chatAgent, setChatAgent] = useState(null);

  const load = async () => {
    try { setAgents(await agentsApi.list()); } catch (e) {}
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id) => {
    if (!confirm('Delete this agent?')) return;
    try {
      await agentsApi.delete(id);
      toast.success('Agent deleted');
      load();
    } catch (e) { toast.error('Failed to delete'); }
  };

  const handleSave = async (data) => {
    try {
      await agentsApi.create(data);
      toast.success('Agent created');
      setShowForm(false);
      load();
    } catch (e) { toast.error(e.error || 'Failed to save agent'); }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agents</h1>
          <p className="text-gray-500 text-sm mt-1">Create and manage your AI agents</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus size={16} /> New Agent
        </button>
      </div>

      {showForm && (
        <div className="mb-6">
          <AgentForm
            onSave={handleSave}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {agents.length === 0 ? (
        <div className="card p-12 text-center">
          <Bot size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No agents yet. Create your first agent to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map(agent => (
            <div key={agent.id} className="card p-5 hover:border-gray-300 transition-colors">
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 bg-pink-100 rounded-lg flex items-center justify-center">
                    <Bot size={18} className="text-brand-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm">{agent.name}</h3>
                    <p className="text-xs text-gray-400 capitalize">{agent.role}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handleDelete(agent.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    title="Delete agent">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Description */}
              <p className="text-xs text-gray-400 mb-3 line-clamp-2">
                {agent.description || agent.system_prompt?.slice(0, 80) || 'No description'}
              </p>

              {/* Badges */}
              <div className="flex items-center gap-2 flex-wrap mb-4">
                <span className="badge badge-gray">{agent.model || 'gpt-4o'}</span>
                {agent.memory_enabled && (
                  <span className="badge badge-blue flex items-center gap-1">
                    <Brain size={10} />Memory
                  </span>
                )}
                {agent.tools?.map(t => (
                  <span key={t} className="badge badge-gray flex items-center gap-1">
                    <Wrench size={10} />{TOOL_LABELS[t] || t}
                  </span>
                ))}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                <button
                  onClick={() => setChatAgent(agent)}
                  className="btn-primary text-xs py-1.5 flex-1 justify-center"
                >
                  <MessageCircle size={13} /> Chat
                </button>

                <Link
                  to={`/agents/${agent.id}`}
                  className="btn-secondary text-xs py-1.5 flex-1 justify-center"
                >
                  Details
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {chatAgent && (
        <TestAgentModal
          agent={chatAgent}
          onClose={() => setChatAgent(null)}
        />
      )}
    </div>
  );
}
