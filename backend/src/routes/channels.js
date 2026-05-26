import { Router } from 'express';
import { getDb } from '../db/database.js';
import { startTelegramBot, stopTelegramBot, getTelegramStatus } from '../services/telegramService.js';

const router = Router();

// GET all channels
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const rows = await db.prepare('SELECT * FROM channels ORDER BY created_at DESC').all();
    res.json(rows.map(parseChannel));
  } catch (e) { next(e); }
});

// GET channel with live bot status
router.get('/:id/status', async (req, res, next) => {
  try {
    const db = getDb();
    const row = await db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Channel not found' });
    const parsed = parseChannel(row);
    if (parsed.type === 'telegram') parsed.botStatus = getTelegramStatus();
    res.json(parsed);
  } catch (e) { next(e); }
});

// POST create channel
router.post('/', async (req, res, next) => {
  try {
    const db = getDb();
    const { type, name, config = {}, agent_id = null } = req.body;
    if (!type || !name) return res.status(400).json({ error: 'type and name are required' });

    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO channels (id,type,name,config,agent_id) VALUES (?,?,?,?,?)
    `).run(id, type, name, JSON.stringify(config), agent_id);

    const row = await db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
    const parsed = parseChannel(row);

    if (type === 'telegram' && config.bot_token) {
      try {
        await startTelegramBot(config.bot_token, agent_id, id);
        parsed.botStatus = getTelegramStatus();
      } catch (err) {
        console.error('Failed to start Telegram bot:', err.message);
        parsed.botError = err.message;
      }
    }

    res.status(201).json(parsed);
  } catch (e) { next(e); }
});

// PUT update channel
router.put('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const existing = await db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Channel not found' });

    const sets = ['updated_at = GETDATE()'];
    const vals = [];
    const { name, config, agent_id, is_active } = req.body;

    if (name      !== undefined) { sets.push('name = ?');      vals.push(name); }
    if (config    !== undefined) { sets.push('config = ?');    vals.push(JSON.stringify(config)); }
    if (agent_id  !== undefined) { sets.push('agent_id = ?');  vals.push(agent_id); }
    if (is_active !== undefined) { sets.push('is_active = ?'); vals.push(is_active ? 1 : 0); }
    vals.push(req.params.id);

    await db.prepare(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const row = await db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
    const parsed = parseChannel(row);

    if (parsed.type === 'telegram' && config?.bot_token) {
      stopTelegramBot();
      if (parsed.is_active) await startTelegramBot(config.bot_token, parsed.agent_id, req.params.id);
    }

    res.json(parsed);
  } catch (e) { next(e); }
});

// DELETE channel
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const row = await db.prepare('SELECT type FROM channels WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Channel not found' });
    if (row.type === 'telegram') stopTelegramBot();
    await db.prepare('DELETE FROM channels WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// GET messages for a channel
router.get('/:id/messages', async (req, res, next) => {
  try {
    const db = getDb();
    const { limit = 50, offset = 0 } = req.query;
    const channel = await db.prepare('SELECT type FROM channels WHERE id = ?').get(req.params.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const rows = await db.prepare(`
      SELECT * FROM messages WHERE channel = ?
      ORDER BY created_at DESC
      OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
    `).all(channel.type, Number(offset), Number(limit));

    res.json(rows.map(m => ({ ...m, metadata: JSON.parse(m.metadata || '{}') })));
  } catch (e) { next(e); }
});

// GET all messages across channels
router.get('/messages/all', async (req, res, next) => {
  try {
    const db = getDb();
    const { limit = 50, channel } = req.query;
    let q = 'SELECT * FROM messages';
    const params = [];
    if (channel) { q += ' WHERE channel = ?'; params.push(channel); }
    q += ' ORDER BY created_at DESC OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY';
    params.push(Number(limit));
    const rows = await db.prepare(q).all(...params);
    res.json(rows.map(m => ({ ...m, metadata: JSON.parse(m.metadata || '{}') })));
  } catch (e) { next(e); }
});

function parseChannel(c) {
  return {
    ...c,
    config:    JSON.parse(c.config || '{}'),
    is_active: c.is_active === 1 || c.is_active === true
  };
}

export default router;
