import { Router } from 'express';
import { getDb } from '../db/database.js';
import { executeWorkflow } from '../services/executionService.js';

const router = Router();

// GET all workflows (optional ?template=true|false)
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const { template } = req.query;
    let q = 'SELECT * FROM workflows';
    if (template === 'true')  q += ' WHERE is_template = 1';
    if (template === 'false') q += ' WHERE is_template = 0';
    q += ' ORDER BY created_at DESC';
    const rows = await db.prepare(q).all();
    res.json(rows.map(parseWorkflow));
  } catch (e) { next(e); }
});

// GET single workflow
router.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const row = await db.prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Workflow not found' });
    res.json(parseWorkflow(row));
  } catch (e) { next(e); }
});

// POST create workflow
router.post('/', async (req, res, next) => {
  try {
    const db = getDb();
    const id = crypto.randomUUID();
    const {
      name, description = '', nodes = [], edges = [],
      trigger_type = 'manual', trigger_config = {},
      is_template = false, template_name = null
    } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    await db.prepare(`
      INSERT INTO workflows (id,name,description,nodes,edges,trigger_type,trigger_config,is_template,template_name)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      id, name, description,
      JSON.stringify(nodes), JSON.stringify(edges),
      trigger_type, JSON.stringify(trigger_config),
      is_template ? 1 : 0, template_name
    );

    const row = await db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    res.status(201).json(parseWorkflow(row));
  } catch (e) { next(e); }
});

// PUT update workflow
router.put('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const existing = await db.prepare('SELECT id FROM workflows WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Workflow not found' });

    const strFields  = ['name','description','trigger_type','status','template_name'];
    const jsonFields = ['nodes','edges','trigger_config'];
    const sets = [];
    const vals = [];

    strFields.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); } });
    jsonFields.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(JSON.stringify(req.body[f])); } });
    if (req.body.is_template !== undefined) { sets.push('is_template = ?'); vals.push(req.body.is_template ? 1 : 0); }

    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    sets.push('updated_at = GETDATE()');
    vals.push(req.params.id);

    await db.prepare(`UPDATE workflows SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const row = await db.prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id);
    res.json(parseWorkflow(row));
  } catch (e) { next(e); }
});

// DELETE workflow
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const result = await db.prepare('DELETE FROM workflows WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Workflow not found' });
    res.json({ success: true });
  } catch (e) { next(e); }
});

// POST run workflow
router.post('/:id/run', async (req, res, next) => {
  try {
    const db = getDb();
    const row = await db.prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Workflow not found' });

    const { input = {} } = req.body;
    const runId = crypto.randomUUID();

    await db.prepare(`
      INSERT INTO workflow_runs (id,workflow_id,status,input,started_at)
      VALUES (?,'${req.params.id}','pending',?,GETDATE())
    `).run(runId, JSON.stringify(input));

    res.status(202).json({ runId, status: 'pending' });

    executeWorkflow(runId, parseWorkflow(row), input).catch(err =>
      console.error('Workflow execution error:', err)
    );
  } catch (e) { next(e); }
});

// GET workflow run history
router.get('/:id/runs', async (req, res, next) => {
  try {
    const db = getDb();
    // SQL Server: OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY
    const rows = await db.prepare(`
      SELECT * FROM workflow_runs WHERE workflow_id = ?
      ORDER BY created_at DESC
      OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY
    `).all(req.params.id);
    res.json(rows.map(parseRun));
  } catch (e) { next(e); }
});

// POST clone from template
router.post('/:id/clone', async (req, res, next) => {
  try {
    const db = getDb();
    const template = await db.prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id);
    if (!template) return res.status(404).json({ error: 'Workflow not found' });

    const id = crypto.randomUUID();
    const { name = `${template.name} (Copy)` } = req.body;

    await db.prepare(`
      INSERT INTO workflows (id,name,description,nodes,edges,trigger_type,trigger_config,is_template)
      VALUES (?,?,?,?,?,?,?,0)
    `).run(id, name, template.description, template.nodes, template.edges, template.trigger_type, template.trigger_config);

    const row = await db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    res.status(201).json(parseWorkflow(row));
  } catch (e) { next(e); }
});

function parseWorkflow(w) {
  return {
    ...w,
    nodes:          JSON.parse(w.nodes          || '[]'),
    edges:          JSON.parse(w.edges          || '[]'),
    trigger_config: JSON.parse(w.trigger_config || '{}'),
    is_template:    w.is_template === 1 || w.is_template === true
  };
}

function parseRun(r) {
  return {
    ...r,
    input:       JSON.parse(r.input       || '{}'),
    output:      r.output ? JSON.parse(r.output) : null,
    token_usage: JSON.parse(r.token_usage || '{}')
  };
}

export default router;
