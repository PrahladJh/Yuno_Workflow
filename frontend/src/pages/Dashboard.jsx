import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { runsApi } from '../services/api.js';
import { getSocket } from '../services/socket.js';
import { Bot, GitBranch, Activity, MessageSquare, CheckCircle, XCircle, Clock, Zap } from 'lucide-react';

const STATUS_COLORS = {
  completed: 'badge-green',
  failed: 'badge-red',
  running: 'badge-blue',
  pending: 'badge-yellow'
};

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [recentLogs, setRecentLogs] = useState([]);

  const loadStats = async () => {
    try {
      const data = await runsApi.getStats();
      setStats(data);
    } catch (e) {}
  };

  useEffect(() => {
    loadStats();
    const socket = getSocket();
    const refresh = () => loadStats();
    socket.on('runs:refresh', refresh);

    socket.on('run:log:global', log => {
      setRecentLogs(prev => [log, ...prev].slice(0, 20));
    });

    return () => {
      socket.off('runs:refresh', refresh);
      socket.off('run:log:global');
    };
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Real-time overview of your AI agent platform</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Bot} label="Agents" value={stats?.total_agents ?? '–'} color="blue" />
        <StatCard icon={GitBranch} label="Workflows" value={stats?.total_workflows ?? '–'} color="purple" />
        <StatCard icon={Activity} label="Total Runs" value={stats?.total_runs ?? '–'} color="brand" />
        <StatCard icon={MessageSquare} label="Messages" value={stats?.total_messages ?? '–'} color="green" />
      </div>

      {/* Run status breakdown */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4 flex items-center gap-3">
          <CheckCircle size={20} className="text-green-500 shrink-0" />
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats?.completed ?? 0}</p>
            <p className="text-sm text-gray-500">Completed</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <XCircle size={20} className="text-red-500 shrink-0" />
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats?.failed ?? 0}</p>
            <p className="text-sm text-gray-500">Failed</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <Clock size={20} className="text-blue-500 shrink-0" />
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats?.running ?? 0}</p>
            <p className="text-sm text-gray-500">Running</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent runs */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Recent Runs</h2>
            <Link to="/monitoring" className="text-sm text-brand-500 hover:text-brand-600">View all</Link>
          </div>
          <div className="space-y-2">
            {stats?.recent_runs?.length > 0 ? stats.recent_runs.map(run => (
              <Link to={`/monitoring`} key={run.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                <div>
                  <p className="text-sm font-medium text-gray-800">{run.workflow_name || 'Unnamed'}</p>
                  <p className="text-xs text-gray-400">{new Date(run.created_at).toLocaleString()}</p>
                </div>
                <span className={`badge ${STATUS_COLORS[run.status] || 'badge-gray'}`}>{run.status}</span>
              </Link>
            )) : (
              <p className="text-sm text-gray-400 text-center py-4">No runs yet. Execute a workflow to get started.</p>
            )}
          </div>
        </div>

        {/* Live activity log */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <h2 className="font-semibold text-gray-900">Live Activity</h2>
          </div>
          <div className="log-terminal">
            {recentLogs.length > 0 ? recentLogs.map((log, i) => (
              <div key={i} className={`mb-1 log-${log.type || log.level}`}>
                <span className="text-gray-500">{new Date(log.created_at).toLocaleTimeString()} </span>
                {log.agent_name && <span className="text-brand-400">[{log.agent_name}] </span>}
                <span>{log.message}</span>
              </div>
            )) : (
              <p className="text-gray-500">Waiting for activity...</p>
            )}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link to="/agents" className="btn-primary"><Bot size={16} />New Agent</Link>
          <Link to="/workflows/new" className="btn-primary"><GitBranch size={16} />New Workflow</Link>
          <Link to="/channels" className="btn-secondary"><Zap size={16} />Setup Channel</Link>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  const colors = {
    blue: 'bg-blue-100 text-blue-600',
    purple: 'bg-purple-100 text-purple-600',
    brand: 'bg-pink-100 text-brand-600',
    green: 'bg-green-100 text-green-600'
  };
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colors[color]}`}>
          <Icon size={18} />
        </div>
      </div>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500 mt-1">{label}</p>
    </div>
  );
}
