import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { initDatabase, getDb } from './db/database.js';
import { initSocketServer } from './websocket/socketServer.js';
import agentsRouter    from './routes/agents.js';
import workflowsRouter from './routes/workflows.js';
import runsRouter      from './routes/runs.js';
import channelsRouter  from './routes/channels.js';
import emailRouter     from './routes/email.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { startTelegramBot } from './services/telegramService.js';

const PORT = process.env.PORT || 3001;
const app  = express();
const httpServer = createServer(app);

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.use('/api/agents',    agentsRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/runs',      runsRouter);
app.use('/api/channels',  channelsRouter);
app.use('/api/email',     emailRouter);
app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use(notFound);
app.use(errorHandler);

async function start() {
  await initDatabase();
  initSocketServer(httpServer);

  httpServer.listen(PORT, async () => {
    console.log(`\n🚀 Yuno AI Backend  →  http://localhost:${PORT}`);

    // Auto-start Telegram bot if a channel was saved
    try {
      const db = getDb();
      const ch = await db.prepare(
        "SELECT * FROM channels WHERE type = 'telegram' AND is_active = 1"
      ).get();

      if (ch && process.env.TELEGRAM_BOT_TOKEN) {
        const cfg   = JSON.parse(ch.config || '{}');
        const token = cfg.bot_token || process.env.TELEGRAM_BOT_TOKEN;
        await startTelegramBot(token, ch.agent_id, ch.id);
        console.log('✅ Telegram bot auto-started');
      }
    } catch (err) {
      console.warn('⚠️  Telegram auto-start skipped:', err.message);
    }

  });
}

start().catch(err => { console.error('Startup error:', err); process.exit(1); });

process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));
