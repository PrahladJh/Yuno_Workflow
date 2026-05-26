import sql from 'mssql';

let pool = null;

/* ── Connection ─────────────────────────────────────────────────────── */

export async function initDatabase(cfg = {}) {
  pool = await sql.connect({
    server:   cfg.server   || process.env.DB_SERVER                        || 'localhost',
    database: cfg.database || process.env.DB_DATABASE || process.env.DB_NAME || 'YunoAI',
    user:     cfg.user     || process.env.DB_USER                          || 'sa',
    password: cfg.password || process.env.DB_PASSWORD                      || '',
    port:     Number(cfg.port || process.env.DB_PORT                       || 1433),
    options: {
      encrypt:               cfg.encrypt               ?? (process.env.DB_ENCRYPT === 'true'),
      trustServerCertificate: cfg.trustServerCertificate ?? true
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
  });

  await createTables();
  await seedTemplates();
  console.log('SQL Server connected →', process.env.DB_DATABASE || process.env.DB_NAME || 'YunoAI');
  return pool;
}

/* ── Public db handle ───────────────────────────────────────────────── */

export function getDb() {
  if (!pool) throw new Error('Database not initialized');
  return new DbWrapper(pool);
}

/* ── Thin wrapper (mimics better-sqlite3 but async) ────────────────── */

class DbWrapper {
  constructor(p) { this.pool = p; }

  prepare(sqlStr) { return new Statement(this.pool, sqlStr); }

  async exec(sqlStr) { await this.pool.request().query(sqlStr); }
}

class Statement {
  constructor(pool, sqlStr) {
    this.pool   = pool;
    this.sqlStr = sqlStr;
  }

  _bind(args) {
    const req = this.pool.request();
    let idx = 0;
    const named = this.sqlStr.replace(/\?/g, () => {
      const name = `p${idx}`;
      req.input(name, args[idx]);
      idx++;
      return `@${name}`;
    });
    return { req, named };
  }

  async get(...args) {
    const { req, named } = this._bind(args);
    const res = await req.query(named);
    return res.recordset[0] ?? null;
  }

  async all(...args) {
    const { req, named } = this._bind(args);
    const res = await req.query(named);
    return res.recordset;
  }

  async run(...args) {
    const { req, named } = this._bind(args);
    const res = await req.query(named);
    return { changes: res.rowsAffected[0] ?? 0 };
  }
}

/* ── Schema creation ────────────────────────────────────────────────── */

async function createTables() {
  const req = pool.request();
  await req.query(`
    IF OBJECT_ID('dbo.agents','U') IS NULL
    CREATE TABLE dbo.agents (
      id NVARCHAR(36) NOT NULL PRIMARY KEY, name NVARCHAR(255) NOT NULL,
      description NVARCHAR(MAX) DEFAULT '', role NVARCHAR(100) DEFAULT 'assistant',
      system_prompt NVARCHAR(MAX) DEFAULT '', model NVARCHAR(100) DEFAULT 'gpt-4o',
      tools NVARCHAR(MAX) DEFAULT '[]', memory_enabled BIT DEFAULT 0,
      memory_config NVARCHAR(MAX) DEFAULT '{}', schedule NVARCHAR(255) NULL,
      max_tokens INT DEFAULT 2000, temperature FLOAT DEFAULT 0.7,
      guardrails NVARCHAR(MAX) DEFAULT '{}', channel_id NVARCHAR(36) NULL,
      status NVARCHAR(50) DEFAULT 'idle',
      created_at DATETIME2 DEFAULT GETDATE(), updated_at DATETIME2 DEFAULT GETDATE()
    )`);

  await pool.request().query(`
    IF OBJECT_ID('dbo.workflows','U') IS NULL
    CREATE TABLE dbo.workflows (
      id NVARCHAR(36) NOT NULL PRIMARY KEY, name NVARCHAR(255) NOT NULL,
      description NVARCHAR(MAX) DEFAULT '', nodes NVARCHAR(MAX) DEFAULT '[]',
      edges NVARCHAR(MAX) DEFAULT '[]', trigger_type NVARCHAR(50) DEFAULT 'manual',
      trigger_config NVARCHAR(MAX) DEFAULT '{}', is_template BIT DEFAULT 0,
      template_name NVARCHAR(255) NULL, status NVARCHAR(50) DEFAULT 'inactive',
      created_at DATETIME2 DEFAULT GETDATE(), updated_at DATETIME2 DEFAULT GETDATE()
    )`);

  await pool.request().query(`
    IF OBJECT_ID('dbo.workflow_runs','U') IS NULL
    CREATE TABLE dbo.workflow_runs (
      id NVARCHAR(36) NOT NULL PRIMARY KEY, workflow_id NVARCHAR(36) NOT NULL,
      status NVARCHAR(50) DEFAULT 'pending', input NVARCHAR(MAX) DEFAULT '{}',
      output NVARCHAR(MAX) NULL, started_at DATETIME2 NULL, completed_at DATETIME2 NULL,
      error NVARCHAR(MAX) NULL, token_usage NVARCHAR(MAX) DEFAULT '{}', cost FLOAT DEFAULT 0,
      created_at DATETIME2 DEFAULT GETDATE()
    )`);

  await pool.request().query(`
    IF OBJECT_ID('dbo.run_logs','U') IS NULL
    CREATE TABLE dbo.run_logs (
      id NVARCHAR(36) NOT NULL PRIMARY KEY, run_id NVARCHAR(36) NOT NULL,
      agent_id NVARCHAR(36) NULL, agent_name NVARCHAR(255) NULL,
      level NVARCHAR(20) DEFAULT 'info', type NVARCHAR(50) DEFAULT 'log',
      message NVARCHAR(MAX) NOT NULL, data NVARCHAR(MAX) DEFAULT '{}',
      created_at DATETIME2 DEFAULT GETDATE()
    )`);

  await pool.request().query(`
    IF OBJECT_ID('dbo.messages','U') IS NULL
    CREATE TABLE dbo.messages (
      id NVARCHAR(36) NOT NULL PRIMARY KEY, channel NVARCHAR(50) NOT NULL,
      chat_id NVARCHAR(255) NULL, sender NVARCHAR(255) DEFAULT 'user',
      agent_id NVARCHAR(36) NULL, run_id NVARCHAR(36) NULL,
      direction NVARCHAR(20) DEFAULT 'incoming', content NVARCHAR(MAX) NOT NULL,
      metadata NVARCHAR(MAX) DEFAULT '{}', created_at DATETIME2 DEFAULT GETDATE()
    )`);

  await pool.request().query(`
    IF OBJECT_ID('dbo.channels','U') IS NULL
    CREATE TABLE dbo.channels (
      id NVARCHAR(36) NOT NULL PRIMARY KEY, type NVARCHAR(50) NOT NULL,
      name NVARCHAR(255) NOT NULL, config NVARCHAR(MAX) DEFAULT '{}',
      agent_id NVARCHAR(36) NULL, is_active BIT DEFAULT 1,
      created_at DATETIME2 DEFAULT GETDATE(), updated_at DATETIME2 DEFAULT GETDATE()
    )`);

  await pool.request().query(`
    IF OBJECT_ID('dbo.agent_memory','U') IS NULL
    CREATE TABLE dbo.agent_memory (
      id NVARCHAR(36) NOT NULL PRIMARY KEY, agent_id NVARCHAR(36) NOT NULL,
      memory_key NVARCHAR(255) NOT NULL, value NVARCHAR(MAX) NOT NULL,
      memory_type NVARCHAR(50) DEFAULT 'general',
      created_at DATETIME2 DEFAULT GETDATE(), updated_at DATETIME2 DEFAULT GETDATE(),
      CONSTRAINT UQ_agent_memory UNIQUE (agent_id, memory_key)
    )`);
}

/* ── Seed pre-built templates ───────────────────────────────────────── */

async function seedTemplates() {
  const db = getDb();
  const row = await db.prepare('SELECT COUNT(*) AS c FROM workflows WHERE is_template = 1').get();
  if (row.c > 0) return;

  const insert = db.prepare(`
    INSERT INTO workflows (id,name,description,nodes,edges,trigger_type,is_template,template_name)
    VALUES (?,?,?,?,?,?,1,?)`);

  // Template 1 — Research & Report Pipeline
  await insert.run(
    crypto.randomUUID(),
    'Research & Report Pipeline',
    'A researcher agent finds information and a writer agent creates a structured report',
    JSON.stringify([
      { id: 'node-researcher', type: 'agentNode', position: { x: 100, y: 200 },
        data: { label: 'Research Agent', agentConfig: {
          name: 'Researcher', role: 'researcher',
          system_prompt: 'You are a thorough research agent. Search the web for information on the given topic and return detailed findings with key facts and insights.',
          model: 'gpt-4o', tools: ['web_search', 'calculator'], temperature: 0.3, max_tokens: 2000
        }}},
      { id: 'node-writer', type: 'agentNode', position: { x: 500, y: 200 },
        data: { label: 'Report Writer', agentConfig: {
          name: 'Writer', role: 'writer',
          system_prompt: 'You are a professional report writer. Take research findings and produce a well-structured report with executive summary, key findings, and recommendations.',
          model: 'gpt-4o', tools: [], temperature: 0.7, max_tokens: 2000
        }}}
    ]),
    JSON.stringify([{ id: 'e1', source: 'node-researcher', target: 'node-writer', label: 'findings' }]),
    'manual', 'Research & Report Pipeline'
  );

  // Template 2 — Customer Support Triage
  await insert.run(
    crypto.randomUUID(),
    'Customer Support Triage',
    'Classifier routes customer messages to specialized agents (billing, technical, general)',
    JSON.stringify([
      { id: 'node-classifier', type: 'agentNode', position: { x: 100, y: 200 },
        data: { label: 'Triage Classifier', agentConfig: {
          name: 'Classifier', role: 'classifier',
          system_prompt: 'Classify the customer message as BILLING, TECHNICAL, or GENERAL. Reply with only the category name.',
          model: 'gpt-4o-mini', tools: [], temperature: 0.1, max_tokens: 100
        }}},
      { id: 'node-billing', type: 'agentNode', position: { x: 500, y: 50 },
        data: { label: 'Billing Agent', agentConfig: {
          name: 'BillingAgent', role: 'billing_specialist',
          system_prompt: 'You are a billing specialist. Help with payments, refunds, and subscriptions.',
          model: 'gpt-4o', tools: ['calculator'], temperature: 0.5, max_tokens: 2000
        }}},
      { id: 'node-technical', type: 'agentNode', position: { x: 500, y: 200 },
        data: { label: 'Technical Agent', agentConfig: {
          name: 'TechAgent', role: 'technical_specialist',
          system_prompt: 'You are a technical support specialist. Troubleshoot issues with precision.',
          model: 'gpt-4o', tools: ['web_search'], temperature: 0.4, max_tokens: 2000
        }}},
      { id: 'node-general', type: 'agentNode', position: { x: 500, y: 350 },
        data: { label: 'General Agent', agentConfig: {
          name: 'GeneralAgent', role: 'general_support',
          system_prompt: 'You are a friendly general support agent. Answer any question helpfully.',
          model: 'gpt-4o', tools: [], temperature: 0.7, max_tokens: 2000
        }}}
    ]),
    JSON.stringify([
      { id: 'e1', source: 'node-classifier', target: 'node-billing',   label: 'BILLING',   condition: 'BILLING'   },
      { id: 'e2', source: 'node-classifier', target: 'node-technical', label: 'TECHNICAL', condition: 'TECHNICAL' },
      { id: 'e3', source: 'node-classifier', target: 'node-general',   label: 'GENERAL',  condition: 'GENERAL'   }
    ]),
    'manual', 'Customer Support Triage'
  );

  console.log('Seeded workflow templates');
}
