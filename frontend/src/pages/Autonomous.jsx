import { useState, useEffect, useRef } from 'react';
import { agentsApi } from '../services/api.js';
import { Brain, Send, Loader, CheckCircle, ChevronRight, Zap, Bot, Wrench, Eye } from 'lucide-react';

const EVENT_STYLES = {
  orchestrator_start:       { icon: Brain,         color: 'text-brand-500', label: 'Goal received'     },
  orchestrator_action:      { icon: ChevronRight,  color: 'text-blue-500',  label: 'Action'            },
  orchestrator_observation: { icon: Eye,           color: 'text-purple-500',label: 'Observation'       },
  orchestrator_complete:    { icon: CheckCircle,   color: 'text-green-500', label: 'Complete'          },
  agent_start:              { icon: Bot,           color: 'text-pink-500',  label: 'Agent started'     },
  agent_end:                { icon: CheckCircle,   color: 'text-green-600', label: 'Agent finished'    },
  tool_call:                { icon: Wrench,        color: 'text-orange-500',label: 'Tool called'       },
  tool_result:              { icon: Zap,           color: 'text-yellow-600',label: 'Tool result'       },
  autonomous_complete:      { icon: CheckCircle,   color: 'text-green-600', label: 'Done'              },
  autonomous_error:         { icon: Brain,         color: 'text-red-500',   label: 'Error'             },
};

export default function Autonomous() {
  const [goal, setGoal] = useState('');
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState([]);
  const [finalAnswer, setFinalAnswer] = useState('');
  const [agents, setAgents] = useState([]);
  const [tokenUsage, setTokenUsage] = useState(null);
  const logRef = useRef(null);
  const esRef  = useRef(null);

  useEffect(() => {
    agentsApi.list().then(setAgents).catch(() => {});
    return () => esRef.current?.close();
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events]);

  const run = () => {
    if (!goal.trim() || running) return;

    setRunning(true);
    setEvents([]);
    setFinalAnswer('');
    setTokenUsage(null);

    esRef.current?.close();

    // POST via fetch then read SSE stream
    fetch('http://localhost:8000/execute/autonomous', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: goal.trim(),
        agents: agents,
        openai_api_key: ''
      })
    }).then(res => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const read = () => {
        reader.read().then(({ done, value }) => {
          if (done) { setRunning(false); return; }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === 'keepalive') continue;

              if (evt.type === 'autonomous_complete' || evt.type === 'orchestrator_complete') {
                if (evt.output) setFinalAnswer(evt.output);
                if (evt.token_usage) setTokenUsage(evt.token_usage);
              }
              if (evt.type === 'autonomous_error') {
                setFinalAnswer(`Error: ${evt.error}`);
                setRunning(false);
              }

              setEvents(prev => [...prev, { ...evt, ts: Date.now() }]);
            } catch {}
          }
          read();
        });
      };
      read();
    }).catch(err => {
      setEvents(prev => [...prev, {
        type: 'autonomous_error',
        message: `Connection failed: ${err.message}`,
        ts: Date.now()
      }]);
      setRunning(false);
    });
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run();
  };

  const exampleGoals = [
    'Clone https://github.com/pallets/flask, find all route definitions, and explain the URL structure',
    'Search for the top 5 AI agent frameworks in 2024, compare them, and recommend the best one for a Python developer',
    'Calculate compound interest for $10,000 invested at 7% annually for 20 years, show year-by-year breakdown',
  ];

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 bg-pink-100 rounded-lg flex items-center justify-center">
            <Brain size={18} className="text-brand-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Autonomous Agent</h1>
          <span className="badge badge-blue text-xs">LLM Orchestrator</span>
        </div>
        <p className="text-sm text-gray-500 ml-11">
          Give a high-level goal. The orchestrator plans and executes autonomously — no workflow needed.
        </p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: goal input + live thought stream */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Goal input */}
          <div className="p-4 bg-white border-b border-gray-200 shrink-0">
            <div className="flex gap-3">
              <textarea
                className="input resize-none text-sm flex-1"
                rows={3}
                placeholder="What do you want to accomplish? Be specific about the goal, not the steps..."
                value={goal}
                onChange={e => setGoal(e.target.value)}
                onKeyDown={onKey}
                disabled={running}
              />
              <button
                onClick={run}
                disabled={!goal.trim() || running}
                className="btn-primary px-4 self-end shrink-0"
              >
                {running
                  ? <><Loader size={16} className="animate-spin" />Running</>
                  : <><Send size={16} />Run</>}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">Ctrl+Enter to run</p>

            {/* Example goals */}
            {!running && events.length === 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-gray-500 mb-2">Try an example:</p>
                <div className="flex flex-col gap-1.5">
                  {exampleGoals.map((eg, i) => (
                    <button key={i} onClick={() => setGoal(eg)}
                      className="text-left text-xs text-gray-600 hover:text-brand-600 bg-gray-50 hover:bg-pink-50 px-3 py-2 rounded-lg border border-gray-200 hover:border-brand-300 transition-colors">
                      {eg}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Live thought stream */}
          <div ref={logRef} className="flex-1 overflow-y-auto p-4 space-y-1.5 bg-gray-50">
            {events.length === 0 && !running && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Brain size={48} className="text-gray-200 mb-4" />
                <p className="text-gray-400 font-medium">Orchestrator is ready</p>
                <p className="text-gray-400 text-sm mt-1">Enter a goal above and watch the AI plan and execute autonomously</p>
              </div>
            )}

            {events.map((evt, i) => {
              const style = EVENT_STYLES[evt.type] || { icon: ChevronRight, color: 'text-gray-400', label: evt.type };
              const Icon = style.icon;
              const msg  = evt.message || evt.action || evt.output || evt.error || '';

              return (
                <div key={i} className="flex gap-2.5 items-start group">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    evt.type.includes('complete') ? 'bg-green-100' :
                    evt.type.includes('error')    ? 'bg-red-100' :
                    evt.type.includes('orchestrator') ? 'bg-pink-100' :
                    evt.type === 'agent_start'    ? 'bg-blue-100' :
                    evt.type === 'tool_call'      ? 'bg-orange-100' :
                    'bg-gray-100'
                  }`}>
                    <Icon size={11} className={style.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${style.color}`}>{style.label}</span>
                      {(evt.agent_name || evt.tool_name) && (
                        <span className="text-xs text-gray-400">
                          {evt.agent_name && `[${evt.agent_name}]`}
                          {evt.tool_name  && ` → ${evt.tool_name}`}
                        </span>
                      )}
                      <span className="text-xs text-gray-300 ml-auto">
                        {new Date(evt.ts).toLocaleTimeString()}
                      </span>
                    </div>
                    {msg && (
                      <p className="text-xs text-gray-700 mt-0.5 leading-relaxed whitespace-pre-wrap break-words">
                        {msg.length > 300 ? msg.slice(0, 300) + '…' : msg}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}

            {running && (
              <div className="flex gap-2.5 items-center">
                <div className="w-5 h-5 bg-pink-100 rounded-full flex items-center justify-center shrink-0">
                  <Loader size={11} className="text-brand-500 animate-spin" />
                </div>
                <span className="text-xs text-gray-400">Orchestrator is thinking…</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: final answer + agent context */}
        <div className="w-96 border-l border-gray-200 flex flex-col bg-white shrink-0">
          {/* Available agents */}
          <div className="p-4 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Available Agents ({agents.length})
            </p>
            {agents.length === 0 ? (
              <p className="text-xs text-gray-400">No agents. Create some in the Agents page — the orchestrator will use them.</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {agents.map(a => (
                  <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded-lg">
                    <div className="w-5 h-5 bg-pink-100 rounded flex items-center justify-center shrink-0">
                      <Bot size={10} className="text-brand-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{a.name}</p>
                      <p className="text-xs text-gray-400 truncate capitalize">{a.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Final answer */}
          <div className="flex-1 flex flex-col overflow-hidden p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Final Answer
            </p>
            {finalAnswer ? (
              <div className="flex-1 overflow-y-auto">
                <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-lg p-3 border border-gray-200">
                  {finalAnswer}
                </div>
                {tokenUsage && (
                  <div className="mt-3 flex gap-3 text-xs text-gray-400">
                    <span>In: {tokenUsage.input_tokens}</span>
                    <span>Out: {tokenUsage.output_tokens}</span>
                    <span className="font-medium text-gray-600">Total: {tokenUsage.total_tokens}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-xs text-gray-400 text-center">
                  {running ? 'Orchestrator is working…' : 'Answer will appear here when complete'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
