-- Yuno AI Orchestration Platform Database Schema

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  role TEXT DEFAULT 'assistant',
  system_prompt TEXT DEFAULT '',
  model TEXT DEFAULT 'claude-sonnet-4-6',
  tools TEXT DEFAULT '[]',
  memory_enabled INTEGER DEFAULT 0,
  memory_config TEXT DEFAULT '{}',
  max_tokens INTEGER DEFAULT 2000,
  temperature REAL DEFAULT 0.7,
  guardrails TEXT DEFAULT '{}',
  channel_id TEXT DEFAULT NULL,
  status TEXT DEFAULT 'idle',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  nodes TEXT DEFAULT '[]',
  edges TEXT DEFAULT '[]',
  trigger_type TEXT DEFAULT 'manual',
  trigger_config TEXT DEFAULT '{}',
  is_template INTEGER DEFAULT 0,
  template_name TEXT DEFAULT NULL,
  status TEXT DEFAULT 'inactive',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  input TEXT DEFAULT '{}',
  output TEXT DEFAULT NULL,
  started_at DATETIME DEFAULT NULL,
  completed_at DATETIME DEFAULT NULL,
  error TEXT DEFAULT NULL,
  token_usage TEXT DEFAULT '{}',
  cost REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id)
);

CREATE TABLE IF NOT EXISTS run_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT DEFAULT NULL,
  agent_name TEXT DEFAULT NULL,
  level TEXT DEFAULT 'info',
  type TEXT DEFAULT 'log',
  message TEXT NOT NULL,
  data TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  chat_id TEXT DEFAULT NULL,
  sender TEXT DEFAULT 'user',
  agent_id TEXT DEFAULT NULL,
  run_id TEXT DEFAULT NULL,
  direction TEXT DEFAULT 'incoming',
  content TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT DEFAULT '{}',
  agent_id TEXT DEFAULT NULL,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_memory (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  memory_type TEXT DEFAULT 'general',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(agent_id, key)
);

CREATE INDEX IF NOT EXISTS idx_run_logs_run_id ON run_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_run_logs_created ON run_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent_id);
