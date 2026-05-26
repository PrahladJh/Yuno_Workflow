import cron from 'node-cron';
import { getDb } from '../db/database.js';
import { getIO } from '../websocket/socketServer.js';
import { executeAgentDirect } from './executionService.js';

const scheduledAgents = new Map();

function parseAgent(a) {
  return {
    ...a,
    tools: JSON.parse(a.tools || '[]'),
    memory_config: JSON.parse(a.memory_config || '{}'),
    guardrails: JSON.parse(a.guardrails || '{}'),
    memory_enabled: a.memory_enabled === 1 || a.memory_enabled === true,
  };
}

async function addLog(db, io, runId, level, type, message, data = {}, agent = null) {
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO run_logs (id, run_id, agent_id, agent_name, level, type, message, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    runId,
    agent?.id || null,
    agent?.name || null,
    level,
    type,
    message,
    JSON.stringify(data)
  );
  io.emit('run:log:global', {
    id, run_id: runId, agent_id: agent?.id || null, agent_name: agent?.name || null,
    level, type, message, data, created_at: new Date().toISOString(),
  });
}

async function runScheduledAgent(agent) {
  const db = getDb();
  const io = getIO();
  const runId = crypto.randomUUID();
  const input = {
    agent_id: agent.id,
    agent_name: agent.name,
    schedule: agent.schedule,
    message: agent.schedule_prompt || agent.description || agent.system_prompt || `Scheduled run for ${agent.name}`,
  };

  await db.prepare(`
    INSERT INTO workflow_runs (id, workflow_id, status, input, started_at)
    VALUES (?, ?, 'running', ?, GETDATE())
  `).run(runId, null, JSON.stringify(input));
  io.emit('runs:refresh');
  await addLog(db, io, runId, 'info', 'system', `Scheduled agent "${agent.name}" started`, input, agent);

  try {
    const message = [
      `## Scheduled Agent Run`,
      `Run the agent according to its system prompt, description, and configured tools.`,
      agent.description ? `## Agent Description\n${agent.description}` : '',
      `## Schedule\n${agent.schedule}`,
      `## Task\n${input.message}`,
    ].filter(Boolean).join('\n\n');

    const result = await executeAgentDirect(agent, message, `scheduled:${agent.id}`);
    await db.prepare(`
      UPDATE workflow_runs
      SET status = 'completed', output = ?, token_usage = ?, completed_at = GETDATE()
      WHERE id = ?
    `).run(JSON.stringify(result), JSON.stringify(result.token_usage || {}), runId);
    await addLog(db, io, runId, 'info', 'agent_message', result.output || 'Scheduled run completed', result, agent);
  } catch (err) {
    await db.prepare(`
      UPDATE workflow_runs
      SET status = 'failed', error = ?, completed_at = GETDATE()
      WHERE id = ?
    `).run(err.message || String(err), runId);
    await addLog(db, io, runId, 'error', 'system', `Scheduled agent failed: ${err.message || err}`, {}, agent);
  } finally {
    io.emit('runs:refresh');
  }
}

export async function refreshAgentSchedules() {
  const db = getDb();
  const rows = await db.prepare(`
    SELECT * FROM agents
    WHERE schedule IS NOT NULL AND LTRIM(RTRIM(schedule)) <> ''
  `).all();

  const activeIds = new Set(rows.map(a => a.id));
  for (const [id, entry] of scheduledAgents.entries()) {
    if (!activeIds.has(id)) {
      entry.task.stop();
      scheduledAgents.delete(id);
    }
  }

  for (const row of rows) {
    const agent = parseAgent(row);
    if (!cron.validate(agent.schedule)) {
      console.warn(`Skipping invalid schedule for agent ${agent.name}: ${agent.schedule}`);
      continue;
    }

    const existing = scheduledAgents.get(agent.id);
    if (existing?.schedule === agent.schedule) continue;
    if (existing) existing.task.stop();

    const task = cron.schedule(agent.schedule, () => {
      runScheduledAgent(agent).catch(err => {
        console.error(`Scheduled agent ${agent.name} failed:`, err.message);
      });
    });
    scheduledAgents.set(agent.id, { schedule: agent.schedule, task });
    console.log(`Scheduled agent "${agent.name}" with cron: ${agent.schedule}`);
  }
}

export async function startAgentScheduler() {
  await refreshAgentSchedules();
}
