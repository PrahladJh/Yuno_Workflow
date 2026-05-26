-- ============================================================
-- Yuno AI Orchestration Platform — SQL Server Schema
-- Run once in SSMS or: sqlcmd -S <server> -d <db> -i schema.mssql.sql
-- ============================================================

IF OBJECT_ID('dbo.agents', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.agents (
    id            NVARCHAR(36)  NOT NULL PRIMARY KEY,
    name          NVARCHAR(255) NOT NULL,
    description   NVARCHAR(MAX) DEFAULT '',
    role          NVARCHAR(100) DEFAULT 'assistant',
    system_prompt NVARCHAR(MAX) DEFAULT '',
    model         NVARCHAR(100) DEFAULT 'gpt-4o',
    tools         NVARCHAR(MAX) DEFAULT '[]',
    memory_enabled BIT          DEFAULT 0,
    memory_config NVARCHAR(MAX) DEFAULT '{}',
    schedule      NVARCHAR(255) NULL,
    max_tokens    INT           DEFAULT 2000,
    temperature   FLOAT         DEFAULT 0.7,
    guardrails    NVARCHAR(MAX) DEFAULT '{}',
    channel_id    NVARCHAR(36)  NULL,
    status        NVARCHAR(50)  DEFAULT 'idle',
    created_at    DATETIME2     DEFAULT GETDATE(),
    updated_at    DATETIME2     DEFAULT GETDATE()
  )
END
GO

IF OBJECT_ID('dbo.workflows', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.workflows (
    id             NVARCHAR(36)  NOT NULL PRIMARY KEY,
    name           NVARCHAR(255) NOT NULL,
    description    NVARCHAR(MAX) DEFAULT '',
    nodes          NVARCHAR(MAX) DEFAULT '[]',
    edges          NVARCHAR(MAX) DEFAULT '[]',
    trigger_type   NVARCHAR(50)  DEFAULT 'manual',
    trigger_config NVARCHAR(MAX) DEFAULT '{}',
    is_template    BIT           DEFAULT 0,
    template_name  NVARCHAR(255) NULL,
    status         NVARCHAR(50)  DEFAULT 'inactive',
    created_at     DATETIME2     DEFAULT GETDATE(),
    updated_at     DATETIME2     DEFAULT GETDATE()
  )
END
GO

IF OBJECT_ID('dbo.workflow_runs', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.workflow_runs (
    id           NVARCHAR(36)  NOT NULL PRIMARY KEY,
    workflow_id  NVARCHAR(36)  NOT NULL,
    status       NVARCHAR(50)  DEFAULT 'pending',
    input        NVARCHAR(MAX) DEFAULT '{}',
    output       NVARCHAR(MAX) NULL,
    started_at   DATETIME2     NULL,
    completed_at DATETIME2     NULL,
    error        NVARCHAR(MAX) NULL,
    token_usage  NVARCHAR(MAX) DEFAULT '{}',
    cost         FLOAT         DEFAULT 0,
    created_at   DATETIME2     DEFAULT GETDATE(),
    CONSTRAINT FK_runs_workflow FOREIGN KEY (workflow_id) REFERENCES dbo.workflows(id)
  )
END
GO

IF OBJECT_ID('dbo.run_logs', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.run_logs (
    id         NVARCHAR(36)  NOT NULL PRIMARY KEY,
    run_id     NVARCHAR(36)  NOT NULL,
    agent_id   NVARCHAR(36)  NULL,
    agent_name NVARCHAR(255) NULL,
    level      NVARCHAR(20)  DEFAULT 'info',
    type       NVARCHAR(50)  DEFAULT 'log',
    message    NVARCHAR(MAX) NOT NULL,
    data       NVARCHAR(MAX) DEFAULT '{}',
    created_at DATETIME2     DEFAULT GETDATE(),
    CONSTRAINT FK_logs_run FOREIGN KEY (run_id) REFERENCES dbo.workflow_runs(id)
  )
END
GO

IF OBJECT_ID('dbo.messages', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.messages (
    id         NVARCHAR(36)  NOT NULL PRIMARY KEY,
    channel    NVARCHAR(50)  NOT NULL,
    chat_id    NVARCHAR(255) NULL,
    sender     NVARCHAR(255) DEFAULT 'user',
    agent_id   NVARCHAR(36)  NULL,
    run_id     NVARCHAR(36)  NULL,
    direction  NVARCHAR(20)  DEFAULT 'incoming',
    content    NVARCHAR(MAX) NOT NULL,
    metadata   NVARCHAR(MAX) DEFAULT '{}',
    created_at DATETIME2     DEFAULT GETDATE()
  )
END
GO

IF OBJECT_ID('dbo.channels', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.channels (
    id         NVARCHAR(36)  NOT NULL PRIMARY KEY,
    type       NVARCHAR(50)  NOT NULL,
    name       NVARCHAR(255) NOT NULL,
    config     NVARCHAR(MAX) DEFAULT '{}',
    agent_id   NVARCHAR(36)  NULL,
    is_active  BIT           DEFAULT 1,
    created_at DATETIME2     DEFAULT GETDATE(),
    updated_at DATETIME2     DEFAULT GETDATE()
  )
END
GO

IF OBJECT_ID('dbo.agent_memory', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.agent_memory (
    id          NVARCHAR(36)  NOT NULL PRIMARY KEY,
    agent_id    NVARCHAR(36)  NOT NULL,
    memory_key  NVARCHAR(255) NOT NULL,
    value       NVARCHAR(MAX) NOT NULL,
    memory_type NVARCHAR(50)  DEFAULT 'general',
    created_at  DATETIME2     DEFAULT GETDATE(),
    updated_at  DATETIME2     DEFAULT GETDATE(),
    CONSTRAINT UQ_agent_memory UNIQUE (agent_id, memory_key)
  )
END
GO

-- Indexes
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_run_logs_run_id' AND object_id = OBJECT_ID('run_logs'))
  CREATE INDEX idx_run_logs_run_id ON dbo.run_logs(run_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_run_logs_created' AND object_id = OBJECT_ID('run_logs'))
  CREATE INDEX idx_run_logs_created ON dbo.run_logs(created_at);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_messages_channel' AND object_id = OBJECT_ID('messages'))
  CREATE INDEX idx_messages_channel ON dbo.messages(channel);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_messages_created' AND object_id = OBJECT_ID('messages'))
  CREATE INDEX idx_messages_created ON dbo.messages(created_at);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_workflow_runs_workflow' AND object_id = OBJECT_ID('workflow_runs'))
  CREATE INDEX idx_workflow_runs_workflow ON dbo.workflow_runs(workflow_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_agent_memory_agent' AND object_id = OBJECT_ID('agent_memory'))
  CREATE INDEX idx_agent_memory_agent ON dbo.agent_memory(agent_id);
GO
