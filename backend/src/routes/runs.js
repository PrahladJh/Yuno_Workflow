import { Router } from 'express';
import { getDb } from '../db/database.js';
import { getIO } from '../websocket/socketServer.js';

const router = Router();

// POST create a run record (used by RunModal for frontend-driven executions)
router.post('/', async (req, res, next) => {
  try {
    const db = getDb();
    const io = getIO();
    const { workflow_id = null, input = {} } = req.body;
    const runId = crypto.randomUUID();

    await db.prepare(`
      INSERT INTO workflow_runs (id, workflow_id, status, input, started_at)
      VALUES (?, ?, 'running', ?, GETDATE())
    `).run(runId, workflow_id, JSON.stringify(input));

    io.emit('runs:refresh');
    res.status(201).json({ id: runId, status: 'running' });
  } catch (e) { next(e); }
});

// POST add a log entry to a run
router.post('/:id/log', async (req, res, next) => {
  try {
    const db = getDb();
    const io = getIO();
    const { level = 'info', type = 'log', message = '', data = {}, agent_name = null, agent_id = null } = req.body;
    const logId = crypto.randomUUID();

    await db.prepare(`
      INSERT INTO run_logs (id, run_id, agent_id, agent_name, level, type, message, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(logId, req.params.id, agent_id, agent_name, level, type, message, JSON.stringify(data));

    const log = {
      id: logId, run_id: req.params.id, agent_id, agent_name,
      level, type, message, data, created_at: new Date().toISOString()
    };
    io.to(`run:${req.params.id}`).emit('run:log', log);
    io.emit('run:log:global', log);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// PATCH update run status / output / token_usage
router.patch('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const io = getIO();
    const { status, output, token_usage, error } = req.body;
    const sets = [];
    const vals = [];

    if (status      !== undefined) { sets.push('status = ?');      vals.push(status); }
    if (output      !== undefined) { sets.push('output = ?');      vals.push(JSON.stringify(output)); }
    if (token_usage !== undefined) { sets.push('token_usage = ?'); vals.push(JSON.stringify(token_usage)); }
    if (error       !== undefined) { sets.push('error = ?');       vals.push(error); }
    if (status === 'completed' || status === 'failed') sets.push('completed_at = GETDATE()');

    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    await db.prepare(`UPDATE workflow_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

    io.to(`run:${req.params.id}`).emit('run:update', { runId: req.params.id, status, output, token_usage });
    io.emit('runs:refresh');
    res.json({ success: true });
  } catch (e) { next(e); }
});

// GET all runs — paginated (SQL Server: OFFSET/FETCH)
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const { limit = 20, offset = 0, status } = req.query;

    let q = `
      SELECT wr.*, w.name AS workflow_name
      FROM workflow_runs wr
      LEFT JOIN workflows w ON wr.workflow_id = w.id
    `;
    const params = [];

    if (status) { q += ' WHERE wr.status = ?'; params.push(status); }

    // T-SQL pagination requires ORDER BY before OFFSET/FETCH
    q += ` ORDER BY wr.created_at DESC
           OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`;
    params.push(Number(offset), Number(limit));

    const rows = await db.prepare(q).all(...params);
    res.json(rows.map(parseRun));
  } catch (e) { next(e); }
});

// GET single run
router.get('/:id', async (req, res, next) => {
  try {
    if (req.params.id === 'stats') return next(); // pass to stats route
    const db = getDb();
    const row = await db.prepare(`
      SELECT wr.*, w.name AS workflow_name
      FROM workflow_runs wr
      LEFT JOIN workflows w ON wr.workflow_id = w.id
      WHERE wr.id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Run not found' });
    res.json(parseRun(row));
  } catch (e) { next(e); }
});

// GET run logs
router.get('/:id/logs', async (req, res, next) => {
  try {
    const db = getDb();
    const { since, limit = 200 } = req.query;
    let q = 'SELECT * FROM run_logs WHERE run_id = ?';
    const params = [req.params.id];

    if (since) { q += ' AND created_at > ?'; params.push(since); }

    q += ` ORDER BY created_at ASC
           OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY`;
    params.push(Number(limit));

    const rows = await db.prepare(q).all(...params);
    res.json(rows.map(l => ({ ...l, data: JSON.parse(l.data || '{}') })));
  } catch (e) { next(e); }
});

// GET stats summary
router.get('/stats/summary', async (req, res, next) => {
  try {
    const db = getDb();
    const [total, completed, failed, running, agents, workflows, messages] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS c FROM workflow_runs').get(),
      db.prepare("SELECT COUNT(*) AS c FROM workflow_runs WHERE status = 'completed'").get(),
      db.prepare("SELECT COUNT(*) AS c FROM workflow_runs WHERE status = 'failed'").get(),
      db.prepare("SELECT COUNT(*) AS c FROM workflow_runs WHERE status = 'running'").get(),
      db.prepare('SELECT COUNT(*) AS c FROM agents').get(),
      db.prepare('SELECT COUNT(*) AS c FROM workflows WHERE is_template = 0').get(),
      db.prepare('SELECT COUNT(*) AS c FROM messages').get()
    ]);

    const recent = await db.prepare(`
      SELECT wr.*, w.name AS workflow_name
      FROM workflow_runs wr
      LEFT JOIN workflows w ON wr.workflow_id = w.id
      ORDER BY wr.created_at DESC
      OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY
    `).all();

    res.json({
      total_runs:       total.c,
      completed:        completed.c,
      failed:           failed.c,
      running:          running.c,
      total_agents:     agents.c,
      total_workflows:  workflows.c,
      total_messages:   messages.c,
      recent_runs:      recent.map(parseRun)
    });
  } catch (e) { next(e); }
});

function parseRun(r) {
  return {
    ...r,
    input:       JSON.parse(r.input       || '{}'),
    output:      r.output ? JSON.parse(r.output) : null,
    token_usage: JSON.parse(r.token_usage || '{}')
  };
}

export default router;
