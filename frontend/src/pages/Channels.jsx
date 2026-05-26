import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { channelsApi, agentsApi } from '../services/api.js';
import { Radio, Plus, Trash2, CheckCircle, XCircle, Send, ExternalLink } from 'lucide-react';

export default function Channels() {
  const [channels, setChannels] = useState([]);
  const [agents, setAgents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'telegram', name: '', bot_token: '', agent_id: '' });
  const [statuses, setStatuses] = useState({});

  const load = async () => {
    try {
      const [ch, ag] = await Promise.all([channelsApi.list(), agentsApi.list()]);
      setChannels(ch);
      setAgents(ag);
      for (const c of ch) {
        channelsApi.getStatus(c.id).then(s => {
          setStatuses(prev => ({ ...prev, [c.id]: s }));
        }).catch(() => {});
      }
    } catch (e) {}
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await channelsApi.create({
        type: form.type,
        name: form.name,
        config: { bot_token: form.bot_token },
        agent_id: form.agent_id || null
      });
      toast.success('Channel configured! Bot starting...');
      setShowForm(false);
      setForm({ type: 'telegram', name: '', bot_token: '', agent_id: '' });
      setTimeout(load, 2000);
    } catch (e) { toast.error(e.error || 'Failed to create channel'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Remove channel?')) return;
    try {
      await channelsApi.delete(id);
      toast.success('Channel removed');
      load();
    } catch (e) { toast.error('Failed to remove'); }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Channels</h1>
          <p className="text-gray-500 text-sm mt-1">Connect agents to external messaging platforms</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={16} />Add Channel
        </button>
      </div>

      {showForm && (
        <div className="card p-5 mb-6">
          <h2 className="font-semibold text-gray-900 mb-4">Configure Telegram Bot</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Channel Name</label>
                <input className="input" placeholder="My Telegram Bot" required
                  value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Channel Type</label>
                <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  <option value="telegram">Telegram</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label">Bot Token</label>
              <input className="input" type="password" placeholder="123456:ABCdef..."
                required value={form.bot_token} onChange={e => setForm(f => ({ ...f, bot_token: e.target.value }))} />
              <p className="text-xs text-gray-400 mt-1">
                Get your token from{' '}
                <a href="https://t.me/BotFather" target="_blank" rel="noopener"
                  className="text-brand-500 hover:underline flex inline-flex items-center gap-0.5">
                  @BotFather <ExternalLink size={10} />
                </a>
                {' '}on Telegram
              </p>
            </div>

            <div>
              <label className="label">Agent to handle messages</label>
              <select className="input" value={form.agent_id}
                onChange={e => setForm(f => ({ ...f, agent_id: e.target.value }))}>
                <option value="">Select an agent...</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>

            <div className="flex gap-3 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Configure Bot</button>
            </div>
          </form>
        </div>
      )}

      {/* Setup guide */}
      <div className="card p-5 mb-6 border-blue-200 bg-blue-50">
        <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Send size={16} className="text-blue-500" />
          Telegram Setup Guide
        </h3>
        <ol className="space-y-1.5 text-sm text-gray-700">
          <li>1. Open Telegram and search for <span className="text-brand-500">@BotFather</span></li>
          <li>2. Send <code className="bg-white px-1 rounded text-xs border border-gray-200">/newbot</code> and follow the instructions</li>
          <li>3. Copy the bot token (format: <code className="bg-white px-1 rounded text-xs border border-gray-200">123456789:ABCdef...</code>)</li>
          <li>4. Create an agent above and configure it with your preferred personality</li>
          <li>5. Add the channel here — your bot will start responding immediately</li>
        </ol>
      </div>

      {channels.length === 0 ? (
        <div className="card p-12 text-center">
          <Radio size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No channels configured. Add a Telegram bot to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {channels.map(ch => {
            const status = statuses[ch.id];
            const isRunning = status?.botStatus?.running || status?.is_active;
            return (
              <div key={ch.id} className="card p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
                      <Send size={18} className="text-blue-500" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 text-sm">{ch.name}</h3>
                      <p className="text-xs text-gray-400 capitalize">{ch.type}</p>
                    </div>
                  </div>
                  <button onClick={() => handleDelete(ch.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors p-1">
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  {isRunning ? (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <CheckCircle size={12} />
                      Active{status?.botStatus?.username ? ` · @${status.botStatus.username}` : ''}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-red-500">
                      <XCircle size={12} />
                      {status?.botStatus?.error || 'Inactive'}
                    </span>
                  )}
                </div>

                {ch.agent_id && (
                  <p className="text-xs text-gray-400">
                    Agent: {agents.find(a => a.id === ch.agent_id)?.name || ch.agent_id}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
