import { Router } from 'express';
import cron from 'node-cron';
import { getDb } from '../db/database.js';
import { refreshAgentSchedules } from '../services/agentSchedulerService.js';

const router = Router();

// GET all agents
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const agents = await db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all();
    res.json(agents.map(parseAgent));
  } catch (e) { next(e); }
});

// GET single agent
router.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const agent = await db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(parseAgent(agent));
  } catch (e) { next(e); }
});

// POST create agent
router.post('/', async (req, res, next) => {
  try {
    const db = getDb();
    const id = crypto.randomUUID();
    const {
      name, description = '', role = 'assistant', system_prompt = '',
      model = 'gpt-4o', tools = [], memory_enabled = false,
      memory_config = {}, schedule = null, max_tokens = 2000,
      temperature = 0.7, guardrails = {}, channel_id = null
    } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (schedule && !cron.validate(schedule)) {
      return res.status(400).json({ error: 'Invalid cron expression for schedule' });
    }

    await db.prepare(`
      INSERT INTO agents
        (id,name,description,role,system_prompt,model,tools,memory_enabled,
         memory_config,schedule,max_tokens,temperature,guardrails,channel_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, name, description, role, system_prompt, model,
      JSON.stringify(tools), memory_enabled ? 1 : 0, JSON.stringify(memory_config),
      schedule, max_tokens, temperature, JSON.stringify(guardrails), channel_id
    );

    const agent = await db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
    await refreshAgentSchedules();
    res.status(201).json(parseAgent(agent));
  } catch (e) { next(e); }
});

// PUT update agent
router.put('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const existing = await db.prepare('SELECT id FROM agents WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Agent not found' });
    if (req.body.schedule && !cron.validate(req.body.schedule)) {
      return res.status(400).json({ error: 'Invalid cron expression for schedule' });
    }

    const strFields  = ['name','description','role','system_prompt','model','schedule','channel_id','status'];
    const numFields  = ['max_tokens'];
    const floatFields = ['temperature'];
    const jsonFields = ['tools','memory_config','guardrails'];

    const sets = [];
    const vals = [];

    strFields.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); } });
    numFields.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(Number(req.body[f])); } });
    floatFields.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(Number(req.body[f])); } });
    jsonFields.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(JSON.stringify(req.body[f])); } });
    if (req.body.memory_enabled !== undefined) { sets.push('memory_enabled = ?'); vals.push(req.body.memory_enabled ? 1 : 0); }

    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

    sets.push('updated_at = GETDATE()');
    vals.push(req.params.id);
    await db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

    const agent = await db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    await refreshAgentSchedules();
    res.json(parseAgent(agent));
  } catch (e) { next(e); }
});

// DELETE agent
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const result = await db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Agent not found' });
    await refreshAgentSchedules();
    res.json({ success: true });
  } catch (e) { next(e); }
});

// GET agent memory
router.get('/:id/memory', async (req, res, next) => {
  try {
    const db = getDb();
    const rows = await db.prepare(
      'SELECT * FROM agent_memory WHERE agent_id = ? ORDER BY updated_at DESC'
    ).all(req.params.id);
    res.json(rows);
  } catch (e) { next(e); }
});

// POST set a memory key
router.post('/:id/memory', async (req, res, next) => {
  try {
    const db = getDb();
    const { key, value, memory_type = 'general' } = req.body;
    if (!key || !value) return res.status(400).json({ error: 'key and value required' });

    // SQL Server MERGE upsert
    await pool_upsertMemory(db, req.params.id, key, value, memory_type);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// DELETE memory entry
router.delete('/:id/memory/:key', async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare('DELETE FROM agent_memory WHERE agent_id = ? AND memory_key = ?')
      .run(req.params.id, req.params.key);
    res.json({ success: true });
  } catch (e) { next(e); }
});

/* helpers */
async function pool_upsertMemory(db, agentId, key, value, memoryType) {
  // Use raw pool for MERGE (mssql named params)
  const { default: sql } = await import('mssql');
  const p = db.pool;
  await p.request()
    .input('id',         sql.NVarChar, crypto.randomUUID())
    .input('agent_id',   sql.NVarChar, agentId)
    .input('mkey',       sql.NVarChar, key)
    .input('value',      sql.NVarChar, value)
    .input('mem_type',   sql.NVarChar, memoryType)
    .query(`
      MERGE INTO agent_memory WITH (HOLDLOCK) AS t
      USING (VALUES (@agent_id, @mkey)) AS s(agent_id, memory_key)
        ON t.agent_id = s.agent_id AND t.memory_key = s.memory_key
      WHEN MATCHED THEN
        UPDATE SET value = @value, updated_at = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (id, agent_id, memory_key, value, memory_type)
        VALUES (@id, @agent_id, @mkey, @value, @mem_type);
    `);
}

function parseAgent(a) {
  return {
    ...a,
    tools:         JSON.parse(a.tools         || '[]'),
    memory_config: JSON.parse(a.memory_config  || '{}'),
    guardrails:    JSON.parse(a.guardrails     || '{}'),
    memory_enabled: a.memory_enabled === 1 || a.memory_enabled === true
  };
}

export default router;
