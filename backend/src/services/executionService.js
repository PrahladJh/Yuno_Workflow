import axios from 'axios';
import { getDb } from '../db/database.js';
import { getIO } from '../websocket/socketServer.js';

const RUNTIME_URL = process.env.PYTHON_RUNTIME_URL || 'http://localhost:8000';

export async function executeWorkflow(runId, workflow, input) {
  const db  = getDb();
  const io  = getIO();

  const updateRun = async (status, extra = {}) => {
    const sets = ['status = ?'];
    const vals = [status];
    if (extra.output      !== undefined) { sets.push('output = ?');      vals.push(JSON.stringify(extra.output)); }
    if (extra.error       !== undefined) { sets.push('error = ?');       vals.push(extra.error); }
    if (extra.token_usage !== undefined) { sets.push('token_usage = ?'); vals.push(JSON.stringify(extra.token_usage)); }
    if (status === 'running')                  sets.push('started_at = GETDATE()');
    if (['completed','failed'].includes(status)) sets.push('completed_at = GETDATE()');
    vals.push(runId);
    await db.prepare(`UPDATE workflow_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    io.to(`run:${runId}`).emit('run:update', { runId, status, ...extra });
    io.emit('runs:refresh');
  };

  const addLog = async (level, type, message, data = {}, agentId = null, agentName = null) => {
    const logId = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO run_logs (id,run_id,agent_id,agent_name,level,type,message,data)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(logId, runId, agentId, agentName, level, type, message, JSON.stringify(data));

    const log = { id: logId, run_id: runId, agent_id: agentId, agent_name: agentName,
                  level, type, message, data, created_at: new Date().toISOString() };
    io.to(`run:${runId}`).emit('run:log', log);
    io.emit('run:log:global', log);
  };

  try {
    await updateRun('running');
    await addLog('info', 'system', `Starting workflow: ${workflow.name}`);

    // Gather agent memory
    const agentMemories = {};
    for (const node of workflow.nodes) {
      const agentId = node.data?.agentId || node.data?.agentConfig?.agent_id;
      if (agentId) {
        const mems = await db.prepare(
          'SELECT memory_key, value FROM agent_memory WHERE agent_id = ?'
        ).all(agentId);
        agentMemories[agentId] = mems.reduce((acc, m) => ({ ...acc, [m.memory_key]: m.value }), {});
      }
    }

    const payload = {
      run_id: runId,
      workflow: { id: workflow.id, name: workflow.name, nodes: workflow.nodes, edges: workflow.edges },
      input,
      agent_memories: agentMemories,
      openai_api_key: process.env.OPENAI_API_KEY
    };

    await addLog('info', 'system', 'Sending workflow to execution runtime');

    const response = await axios.post(`${RUNTIME_URL}/execute/workflow`, payload, {
      timeout: 300000,
      responseType: 'stream'
    });

    let buffer = '';
    let finalResult = null;

    await new Promise((resolve, reject) => {
      response.data.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            handleRuntimeEvent(event, addLog, io);
            if (event.type === 'workflow_complete') finalResult = event;
            if (event.type === 'workflow_error')    reject(new Error(event.error));
          } catch (_) {}
        }
      });
      response.data.on('end', resolve);
      response.data.on('error', reject);
    });

    const output     = finalResult?.output      || {};
    const tokenUsage = finalResult?.token_usage || {};
    await updateRun('completed', { output, token_usage: tokenUsage });
    await addLog('info', 'system', 'Workflow completed', { output, token_usage: tokenUsage });

  } catch (err) {
    const msg = err.message || 'Unknown error';
    await updateRun('failed', { error: msg });
    await addLog('error', 'system', `Workflow failed: ${msg}`);
    console.error(`[Run ${runId}] Error:`, msg);
  }
}

function handleRuntimeEvent(event, addLog, io) {
  switch (event.type) {
    case 'agent_start':    addLog('info',  'agent_start',    `Agent "${event.agent_name}" started`,   event, event.agent_id, event.agent_name); break;
    case 'agent_end':      addLog('info',  'agent_end',      `Agent "${event.agent_name}" completed`, event, event.agent_id, event.agent_name); break;
    case 'agent_message':  addLog('info',  'agent_message',  event.content,                           event, event.agent_id, event.agent_name); break;
    case 'tool_call':      addLog('info',  'tool_call',      `Tool "${event.tool_name}" called`,      event, event.agent_id, event.agent_name); break;
    case 'tool_result':    addLog('info',  'tool_result',    `Tool "${event.tool_name}" returned`,    event, event.agent_id, event.agent_name); break;
    case 'agent_to_agent': addLog('info',  'agent_to_agent', `${event.from_agent} → ${event.to_agent}`, event); break;
    case 'log':            addLog(event.level || 'info', 'log', event.message, event); break;
  }
}

export async function executeAgentDirect(agentConfig, message, chatId = null) {
  const payload = {
    agent:          agentConfig,
    message,
    chat_id:        chatId,
    openai_api_key: process.env.OPENAI_API_KEY
  };

  try {
    const res = await axios.post(`${RUNTIME_URL}/execute/agent`, payload, { timeout: 120000 });
    return res.data;
  } catch (err) {
    throw new Error(`Runtime error: ${err.response?.data?.detail || err.message}`);
  }
}
