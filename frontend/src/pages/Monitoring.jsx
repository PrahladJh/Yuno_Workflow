import { useState, useEffect, useRef } from 'react';
import { runsApi } from '../services/api.js';
import { getSocket, subscribeToRun, unsubscribeFromRun } from '../services/socket.js';
import { Activity, RefreshCw, ChevronDown, ChevronRight, Cpu, MessageSquare } from 'lucide-react';

const STATUS_COLORS = {
  completed: 'badge-green', failed: 'badge-red',
  running: 'badge-blue', pending: 'badge-yellow'
};

const LOG_ICONS = {
  agent_start: '▶', agent_end: '■', agent_message: '💬',
  tool_call: '🔧', tool_result: '✓', agent_to_agent: '↔',
  system: '⚙', log: '·'
};

export default function Monitoring() {
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [logs, setLogs] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef(null);
  const prevRunId = useRef(null);

  const loadRuns = async () => {
    try { setRuns(await runsApi.list({ limit: 30 })); } catch (e) {}
  };

  const loadLogs = async (runId) => {
    try {
      const data = await runsApi.getLogs(runId, { limit: 500 });
      setLogs(data);
    } catch (e) {}
  };

  useEffect(() => {
    loadRuns();
    const socket = getSocket();
    socket.on('runs:refresh', loadRuns);
    socket.on('run:update', () => loadRuns());
    return () => { socket.off('runs:refresh'); socket.off('run:update'); };
  }, []);

  useEffect(() => {
    if (!selected) return;
    if (prevRunId.current && prevRunId.current !== selected.id) {
      unsubscribeFromRun(prevRunId.current);
    }
    prevRunId.current = selected.id;
    loadLogs(selected.id);
    subscribeToRun(selected.id);

    const socket = getSocket();
    const onLog = (log) => {
      setLogs(prev => [...prev, log]);
    };
    const onUpdate = (upd) => {
      if (upd.runId === selected.id) {
        setSelected(s => s ? { ...s, status: upd.status } : s);
        loadRuns();
      }
    };
    socket.on('run:log', onLog);
    socket.on('run:update', onUpdate);

    return () => {
      socket.off('run:log', onLog);
      socket.off('run:update', onUpdate);
    };
  }, [selected?.id]);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  return (
    <div className="h-screen flex flex-col">
      <div className="px-6 py-4 border-b border-gray-200 shrink-0 flex items-center justify-between bg-white">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Monitoring</h1>
          <p className="text-gray-500 text-sm">Real-time workflow execution logs</p>
        </div>
        <button onClick={loadRuns} className="btn-secondary text-sm py-1.5">
          <RefreshCw size={14} />Refresh
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Run list */}
        <div className="w-72 border-r border-gray-200 overflow-y-auto shrink-0 bg-white">
          <div className="p-3 space-y-1">
            {runs.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">No runs yet</p>
            )}
            {runs.map(run => (
              <button key={run.id} onClick={() => setSelected(run)}
                className={`w-full text-left p-3 rounded-lg transition-colors ${
                  selected?.id === run.id ? 'bg-pink-50 border border-pink-200' : 'hover:bg-gray-100'
                }`}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-gray-800 truncate">{run.workflow_name || 'Workflow'}</p>
                  <span className={`badge text-xs ${STATUS_COLORS[run.status] || 'badge-gray'}`}>{run.status}</span>
                </div>
                <p className="text-xs text-gray-400">{new Date(run.created_at).toLocaleString()}</p>
                {run.status === 'running' && (
                  <div className="mt-1.5 h-0.5 bg-gray-200 rounded overflow-hidden">
                    <div className="h-full bg-brand-500 animate-pulse" style={{ width: '60%' }} />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Log viewer */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selected ? (
            <>
              {/* Run header */}
              <div className="p-4 border-b border-gray-200 flex items-center justify-between shrink-0 bg-white">
                <div className="flex items-center gap-3">
                  <Activity size={16} className="text-brand-500" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{selected.workflow_name}</p>
                    <p className="text-xs text-gray-400">{selected.id}</p>
                  </div>
                  <span className={`badge ${STATUS_COLORS[selected.status] || 'badge-gray'}`}>{selected.status}</span>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                    <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)}
                      className="accent-brand-500" />
                    Auto-scroll
                  </label>
                </div>
              </div>

              {/* Input/output */}
              {(selected.input?.message || selected.output) && (
                <div className="p-4 border-b border-gray-200 grid grid-cols-2 gap-4 shrink-0 bg-white">
                  {selected.input?.message && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">Input</p>
                      <p className="text-xs text-gray-700 bg-gray-50 rounded p-2 border border-gray-200">{selected.input.message}</p>
                    </div>
                  )}
                  {selected.output && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">Output</p>
                      <div className="text-xs text-gray-700 bg-gray-50 rounded p-2 border border-gray-200 max-h-20 overflow-y-auto">
                        {typeof selected.output === 'object'
                          ? Object.entries(selected.output).map(([k, v]) => (
                            <p key={k}><span className="text-gray-400">{k}:</span> {String(v).slice(0, 100)}</p>
                          ))
                          : String(selected.output).slice(0, 200)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Log stream */}
              <div ref={logRef} className="flex-1 overflow-y-auto p-4 log-terminal font-mono text-xs">
                {logs.length === 0 && <p className="text-gray-500">No logs yet...</p>}
                {logs.map((log, i) => (
                  <LogEntry key={i} log={log} />
                ))}
              </div>

              {/* Token usage */}
              {selected.token_usage && Object.keys(selected.token_usage).length > 0 && (
                <div className="p-3 border-t border-gray-200 flex gap-4 text-xs text-gray-500 shrink-0 bg-white">
                  <span className="flex items-center gap-1"><Cpu size={10} />
                    In: {selected.token_usage.input_tokens || 0}
                  </span>
                  <span>Out: {selected.token_usage.output_tokens || 0}</span>
                  <span>Total: {selected.token_usage.total_tokens || 0}</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Activity size={40} className="text-gray-300 mx-auto mb-3" />
                <p className="text-gray-400">Select a run to view logs</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LogEntry({ log }) {
  const [expanded, setExpanded] = useState(false);
  const icon = LOG_ICONS[log.type] || '·';
  const hasData = log.data && Object.keys(log.data).length > 0 && log.type !== 'system';

  return (
    <div className={`mb-0.5 log-${log.type || log.level}`}>
      <div className="flex items-start gap-2 hover:bg-white/5 px-1 py-0.5 rounded cursor-pointer"
        onClick={() => hasData && setExpanded(e => !e)}>
        <span className="text-gray-500 shrink-0 w-16">{new Date(log.created_at).toLocaleTimeString()}</span>
        <span className="shrink-0">{icon}</span>
        {log.agent_name && <span className="text-brand-400 shrink-0">[{log.agent_name}]</span>}
        <span className="flex-1">{log.message}</span>
        {hasData && (
          <span className="text-gray-500 shrink-0">
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </span>
        )}
      </div>
      {expanded && hasData && (
        <div className="ml-20 bg-gray-800 rounded p-2 mt-0.5 text-gray-400">
          <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(log.data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
