import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow, Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState, MarkerType, Panel,
  BaseEdge, EdgeLabelRenderer, getBezierPath,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import toast from 'react-hot-toast';
import { workflowsApi, agentsApi } from '../services/api.js';
import AgentNode from '../components/WorkflowNode/AgentNode.jsx';
import { Save, Plus, ArrowLeft, Play, Trash2, Edit2, GitBranch } from 'lucide-react';
import RunModal from '../components/WorkflowNode/RunModal.jsx';

const nodeTypes = { agentNode: AgentNode };

const EDGE_STYLE = {
  style: { stroke: '#ec4899', strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: '#ec4899' },
  animated: false,
  type: 'conditionEdge',
};

const MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
const TOOLS = [
  'web_search', 'calculator', 'http_request', 'code_executor', 'datetime',
  'pdf_analyzer', 'email', 'google_calendar', 'google_drive', 'github', 'sandbox_exec',
];
const ROLES = ['assistant', 'researcher', 'writer', 'analyst', 'classifier', 'coordinator'];

// ── Clickable condition edge ──────────────────────────────────────────────────

function ConditionEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, style }) {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const label = data?.condition || '';

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }}
          className="absolute nodrag nopan"
        >
          {label && (
            <span className="bg-pink-100 border border-pink-300 text-pink-700 text-xs px-2 py-0.5 rounded-full font-medium shadow-sm">
              {label}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { conditionEdge: ConditionEdge };

export default function WorkflowBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [workflow, setWorkflow] = useState({ name: 'New Workflow', description: '' });
  const [agents, setAgents] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [showPanel, setShowPanel] = useState(false);
  const [runModal, setRunModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingMeta, setEditingMeta] = useState(!id);
  const [edgeModal, setEdgeModal] = useState(null); // { edgeId, condition }
  const reactFlowWrapper = useRef(null);

  useEffect(() => {
    agentsApi.list().then(setAgents).catch(() => {});
    if (id) {
      workflowsApi.get(id).then(wf => {
        setWorkflow({ name: wf.name, description: wf.description });
        setNodes(wf.nodes.map(n => ({ ...n, type: n.type || 'agentNode' })));
        setEdges(wf.edges.map(e => ({ ...e, ...EDGE_STYLE, label: e.label })));
      }).catch(() => navigate('/workflows'));
    }
  }, [id]);

  const onConnect = useCallback(params => {
    setEdges(eds => addEdge({ ...params, ...EDGE_STYLE, data: { condition: '' } }, eds));
  }, []);

  const onEdgeClick = useCallback((_, edge) => {
    setEdgeModal({ edgeId: edge.id, condition: edge.data?.condition || '' });
  }, []);

  const saveEdgeCondition = (edgeId, condition) => {
    setEdges(es => es.map(e =>
      e.id === edgeId ? { ...e, label: condition, data: { ...e.data, condition } } : e
    ));
    setEdgeModal(null);
  };

  const addAgentNode = (agentConfig = null) => {
    const nodeId = `node-${Date.now()}`;
    const cfg = agentConfig || {
      name: 'New Agent', role: 'assistant', system_prompt: '',
      model: 'gpt-4o', tools: [], temperature: 0.7, max_tokens: 2000
    };
    const newNode = {
      id: nodeId,
      type: 'agentNode',
      position: { x: 100 + nodes.length * 220, y: 200 },
      data: { label: cfg.name, agentConfig: cfg }
    };
    setNodes(ns => [...ns, newNode]);
    setSelectedNode(newNode);
    setShowPanel(true);
  };

  const addFromExistingAgent = (agent) => {
    addAgentNode({
      agent_id: agent.id,
      name: agent.name,
      role: agent.role,
      system_prompt: agent.system_prompt,
      model: agent.model,
      tools: agent.tools || [],
      temperature: agent.temperature,
      max_tokens: agent.max_tokens
    });
  };

  const deleteNode = (nodeId) => {
    setNodes(ns => ns.filter(n => n.id !== nodeId));
    setEdges(es => es.filter(e => e.source !== nodeId && e.target !== nodeId));
    if (selectedNode?.id === nodeId) { setSelectedNode(null); setShowPanel(false); }
  };

  const updateNodeConfig = (nodeId, cfg) => {
    setNodes(ns => ns.map(n => n.id === nodeId
      ? { ...n, data: { ...n.data, label: cfg.name, agentConfig: cfg } }
      : n
    ));
    setSelectedNode(sn => sn?.id === nodeId ? { ...sn, data: { ...sn.data, agentConfig: cfg } } : sn);
  };

  const handleSave = async () => {
    if (!workflow.name.trim()) { toast.error('Workflow needs a name'); return; }
    setSaving(true);
    try {
      const data = {
        ...workflow,
        nodes: nodes.map(n => ({
          id: n.id, type: n.type, position: n.position, data: n.data
        })),
        edges: edges.map(e => ({
          id: e.id, source: e.source, target: e.target,
          label: e.data?.condition || e.label || '',
          condition: e.data?.condition || e.label || '',
        }))
      };
      if (id) {
        await workflowsApi.update(id, data);
        toast.success('Workflow saved');
        setSaving(false);
        return data;
      } else {
        const wf = await workflowsApi.create(data);
        toast.success('Workflow created');
        setSaving(false);
        navigate(`/workflows/${wf.id}/edit`, { replace: true });
        return { ...data, id: wf.id };
      }
    } catch (e) { toast.error('Failed to save'); setSaving(false); }
  };

  const onNodeClick = (_, node) => {
    setSelectedNode(node);
    setShowPanel(true);
  };

  const cfg = selectedNode?.data?.agentConfig || {};

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 shrink-0">
        <button onClick={() => navigate('/workflows')} className="text-gray-400 hover:text-gray-900 transition-colors">
          <ArrowLeft size={18} />
        </button>
        {editingMeta ? (
          <div className="flex items-center gap-2 flex-1">
            <input className="input text-sm py-1.5 max-w-xs"
              value={workflow.name} onChange={e => setWorkflow(w => ({ ...w, name: e.target.value }))}
              placeholder="Workflow name" />
            <input className="input text-sm py-1.5 flex-1"
              value={workflow.description} onChange={e => setWorkflow(w => ({ ...w, description: e.target.value }))}
              placeholder="Description (optional)" />
            <button onClick={() => setEditingMeta(false)} className="btn-secondary text-xs py-1.5">Done</button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1">
            <h1 className="font-semibold text-gray-900">{workflow.name}</h1>
            {workflow.description && <span className="text-sm text-gray-400">— {workflow.description}</span>}
            <button onClick={() => setEditingMeta(true)} className="text-gray-400 hover:text-gray-700 transition-colors">
              <Edit2 size={12} />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={() => addAgentNode()} className="btn-secondary text-sm py-1.5">
            <Plus size={14} />Add Node
          </button>
          {id && (
            <button onClick={() => setRunModal(true)} className="btn-primary text-sm py-1.5">
              <Play size={14} />Run
            </button>
          )}
          <button onClick={handleSave} disabled={saving} className="btn-primary text-sm py-1.5">
            <Save size={14} />{saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div className="flex-1" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            defaultEdgeOptions={EDGE_STYLE}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#e5e7eb" gap={24} />
            <Controls />
            <MiniMap
              nodeColor="#ec4899"
              maskColor="rgba(0,0,0,0.1)"
              style={{ background: '#f9fafb' }}
            />
            <Panel position="bottom-center">
              <p className="text-xs text-gray-500 bg-white/90 shadow-sm border border-gray-200 px-3 py-1 rounded-full">
                Drag handles to connect · Click node to edit · Click edge to set condition
              </p>
            </Panel>
          </ReactFlow>
        </div>

        {/* Right panel — node editor */}
        {showPanel && selectedNode && (
          <div className="w-80 bg-white border-l border-gray-200 overflow-y-auto shrink-0">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 text-sm">Node Config</h2>
              <button onClick={() => { setShowPanel(false); setSelectedNode(null); }}
                className="text-gray-400 hover:text-gray-900 transition-colors text-xs">✕</button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="label text-xs">Name</label>
                <input className="input text-sm" value={cfg.name || ''}
                  onChange={e => updateNodeConfig(selectedNode.id, { ...cfg, name: e.target.value })} />
              </div>
              <div>
                <label className="label text-xs">Role</label>
                <select className="input text-sm" value={cfg.role || 'assistant'}
                  onChange={e => updateNodeConfig(selectedNode.id, { ...cfg, role: e.target.value })}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="label text-xs">System Prompt</label>
                <textarea className="input text-sm" rows={4} value={cfg.system_prompt || ''}
                  onChange={e => updateNodeConfig(selectedNode.id, { ...cfg, system_prompt: e.target.value })}
                  placeholder="You are a..." />
              </div>
              <div>
                <label className="label text-xs">Model</label>
                <select className="input text-sm" value={cfg.model || 'gpt-4o'}
                  onChange={e => updateNodeConfig(selectedNode.id, { ...cfg, model: e.target.value })}>
                  {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="label text-xs">Temperature: {cfg.temperature ?? 0.7}</label>
                <input type="range" className="w-full accent-brand-500" min={0} max={1} step={0.1}
                  value={cfg.temperature ?? 0.7}
                  onChange={e => updateNodeConfig(selectedNode.id, { ...cfg, temperature: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label text-xs">Tools</label>
                <div className="space-y-1">
                  {TOOLS.map(t => (
                    <label key={t} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer hover:text-gray-900 transition-colors">
                      <input type="checkbox" className="accent-brand-500"
                        checked={(cfg.tools || []).includes(t)}
                        onChange={() => {
                          const tools = cfg.tools || [];
                          updateNodeConfig(selectedNode.id, {
                            ...cfg,
                            tools: tools.includes(t) ? tools.filter(x => x !== t) : [...tools, t]
                          });
                        }} />
                      {t}
                    </label>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-gray-200">
                <p className="label text-xs mb-2">Or pick existing agent:</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {agents.map(a => (
                    <button key={a.id} onClick={() => updateNodeConfig(selectedNode.id, {
                      agent_id: a.id, name: a.name, role: a.role,
                      system_prompt: a.system_prompt, model: a.model,
                      tools: a.tools, temperature: a.temperature, max_tokens: a.max_tokens
                    })}
                      className="w-full text-left text-xs bg-gray-50 hover:bg-gray-100 px-2 py-1.5 rounded border border-gray-200 transition-colors text-gray-700">
                      {a.name}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={() => deleteNode(selectedNode.id)}
                className="btn-danger w-full justify-center text-sm mt-2">
                <Trash2 size={14} />Delete Node
              </button>
            </div>
          </div>
        )}

        {/* Left panel — agent library (when no node selected) */}
        {!showPanel && (
          <div className="w-56 bg-white border-l border-gray-200 overflow-y-auto shrink-0">
            <div className="p-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900 text-sm">Agent Library</h2>
              <p className="text-xs text-gray-400 mt-0.5">Click to add to canvas</p>
            </div>
            <div className="p-3 space-y-2">
              <button onClick={() => addAgentNode()}
                className="w-full btn-primary text-xs py-2 justify-center">
                <Plus size={12} />Blank Agent
              </button>
              {agents.map(a => (
                <button key={a.id} onClick={() => addFromExistingAgent(a)}
                  className="w-full text-left bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg p-2.5 transition-colors">
                  <p className="text-xs font-medium text-gray-800">{a.name}</p>
                  <p className="text-xs text-gray-400 capitalize">{a.role}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {runModal && (
        <RunModal
          workflow={{
            id,
            name: workflow.name,
            description: workflow.description,
            nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
            edges: edges.map(e => ({
              id: e.id, source: e.source, target: e.target,
              label: e.data?.condition || '', condition: e.data?.condition || '',
            })),
          }}
          onClose={() => setRunModal(false)}
        />
      )}

      {/* Edge condition modal */}
      {edgeModal && (
        <EdgeConditionModal
          condition={edgeModal.condition}
          onSave={cond => saveEdgeCondition(edgeModal.edgeId, cond)}
          onClose={() => setEdgeModal(null)}
        />
      )}
    </div>
  );
}

// ── Edge condition editor modal ────────────────────────────────────────────────

function EdgeConditionModal({ condition, onSave, onClose }) {
  const [val, setVal] = useState(condition);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-96">
        <div className="flex items-center gap-2 mb-4">
          <GitBranch size={16} className="text-pink-500" />
          <h3 className="font-semibold text-gray-900">Conditional Routing</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          If the previous agent's output <strong>contains this keyword</strong>, the workflow
          will follow this edge. Leave blank to always follow this edge (unconditional).
        </p>
        <input
          className="input text-sm mb-1"
          placeholder="e.g. APPROVED, ERROR, YES, success"
          value={val}
          onChange={e => setVal(e.target.value)}
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter') onSave(val.trim()); if (e.key === 'Escape') onClose(); }}
        />
        <p className="text-xs text-gray-400 mb-4">Case-insensitive. The router checks if the output contains this word.</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary text-sm py-1.5">Cancel</button>
          <button onClick={() => onSave(val.trim())} className="btn-primary text-sm py-1.5">Save Condition</button>
        </div>
      </div>
    </div>
  );
}
