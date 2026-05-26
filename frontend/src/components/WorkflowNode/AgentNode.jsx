import { Handle, Position } from '@xyflow/react';
import { Bot, Wrench, Trash2 } from 'lucide-react';

export default function AgentNode({ data, selected }) {
  const agent = data.agentConfig || {};
  return (
    <div className={`bg-white border rounded-xl p-3 min-w-[180px] shadow-md transition-all ${
      selected ? 'border-brand-500 shadow-brand-500/20' : 'border-gray-200'
    }`}>
      <Handle type="target" position={Position.Left} className="!bg-brand-500 !w-3 !h-3 !border-2 !border-white" />

      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 bg-pink-100 rounded-lg flex items-center justify-center shrink-0">
          <Bot size={14} className="text-brand-500" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-900 truncate">{agent.name || data.label || 'Agent'}</p>
          <p className="text-xs text-gray-400 capitalize truncate">{agent.role || 'assistant'}</p>
        </div>
      </div>

      {agent.tools?.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {agent.tools.slice(0, 3).map(t => (
            <span key={t} className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded flex items-center gap-0.5">
              <Wrench size={8} />{t.replace('_', ' ')}
            </span>
          ))}
          {agent.tools.length > 3 && <span className="text-xs text-gray-400">+{agent.tools.length - 3}</span>}
        </div>
      )}

      {agent.model && (
        <p className="text-xs text-gray-400 mt-1.5">{agent.model.split('-').slice(-2).join('-')}</p>
      )}

      {data.onDelete && (
        <button onClick={data.onDelete}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <Trash2 size={10} className="text-white" />
        </button>
      )}

      <Handle type="source" position={Position.Right} className="!bg-brand-500 !w-3 !h-3 !border-2 !border-white" />
    </div>
  );
}
