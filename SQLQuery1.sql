USE [YunoAI]
GO

/****** Object:  Table [dbo].[agent_memory]    Script Date: 27-05-2026 00:06:36 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[agent_memory](
	[id] [nvarchar](36) NOT NULL,
	[agent_id] [nvarchar](36) NOT NULL,
	[memory_key] [nvarchar](255) NOT NULL,
	[value] [nvarchar](max) NOT NULL,
	[memory_type] [nvarchar](50) NULL,
	[created_at] [datetime2](7) NULL,
	[updated_at] [datetime2](7) NULL,
PRIMARY KEY CLUSTERED 
(
	[id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_agent_memory] UNIQUE NONCLUSTERED 
(
	[agent_id] ASC,
	[memory_key] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

ALTER TABLE [dbo].[agent_memory] ADD  DEFAULT ('general') FOR [memory_type]
GO

ALTER TABLE [dbo].[agent_memory] ADD  DEFAULT (getdate()) FOR [created_at]
GO

ALTER TABLE [dbo].[agent_memory] ADD  DEFAULT (getdate()) FOR [updated_at]
GO




USE [YunoAI]
GO

/****** Object:  Table [dbo].[agents]    Script Date: 27-05-2026 00:07:06 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[agents](
	[id] [nvarchar](36) NOT NULL,
	[name] [nvarchar](255) NOT NULL,
	[description] [nvarchar](max) NULL,
	[role] [nvarchar](100) NULL,
	[system_prompt] [nvarchar](max) NULL,
	[model] [nvarchar](100) NULL,
	[tools] [nvarchar](max) NULL,
	[memory_enabled] [bit] NULL,
	[memory_config] [nvarchar](max) NULL,
	[schedule] [nvarchar](255) NULL,
	[max_tokens] [int] NULL,
	[temperature] [float] NULL,
	[guardrails] [nvarchar](max) NULL,
	[channel_id] [nvarchar](36) NULL,
	[status] [nvarchar](50) NULL,
	[created_at] [datetime2](7) NULL,
	[updated_at] [datetime2](7) NULL,
PRIMARY KEY CLUSTERED 
(
	[id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

ALTER TABLE [dbo].[agents] ADD  DEFAULT ('') FOR [description]
GO

ALTER TABLE [dbo].[agents] ADD  DEFAULT ('assistant') FOR [role]
GO

ALTER TABLE [dbo].[agents] ADD  DEFAULT ('') FOR [system_prompt]
GO

ALTER TABLE [dbo].[agents] ADD  DEFAULT ('gpt-4o') FOR [model]
GO

ALTER TABLE [dbo].[agents] ADD  DEFAULT ('[]') FOR [tools]
GO

ALTER TABLE [dbo].[agents] ADD  DEFAULT ((0)) FOR [memory_enabled]
GO

ALTER TABLE [dbo].[agents] ADD  DEFAULT ('{}') FOR [memory_config]
GO

ALTER TABLE [dbo].[agents] ADD  DEFAULT ((2000)) FOR [max_tokens]
GO

ALTER TABLE [dbo].[agents] ADD  DEFAULT ((0.7)) FOR [temperature]
GO

ALTER TABLE [dbo].[agents] ADD  DEFAULT ('{}') FOR [guardrails]
GO

ALTER TABLE [dbo].[agents] ADD  DEFAULT ('idle') FOR [status]
GO

ALTER TABLE [dbo].[agents] ADD  DEFAULT (getdate()) FOR [created_at]
GO

ALTER TABLE [dbo].[agents] ADD  DEFAULT (getdate()) FOR [updated_at]
GO




USE [YunoAI]
GO

/****** Object:  Table [dbo].[channels]    Script Date: 27-05-2026 00:07:47 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[channels](
	[id] [nvarchar](36) NOT NULL,
	[type] [nvarchar](50) NOT NULL,
	[name] [nvarchar](255) NOT NULL,
	[config] [nvarchar](max) NULL,
	[agent_id] [nvarchar](36) NULL,
	[is_active] [bit] NULL,
	[created_at] [datetime2](7) NULL,
	[updated_at] [datetime2](7) NULL,
PRIMARY KEY CLUSTERED 
(
	[id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

ALTER TABLE [dbo].[channels] ADD  DEFAULT ('{}') FOR [config]
GO

ALTER TABLE [dbo].[channels] ADD  DEFAULT ((1)) FOR [is_active]
GO

ALTER TABLE [dbo].[channels] ADD  DEFAULT (getdate()) FOR [created_at]
GO

ALTER TABLE [dbo].[channels] ADD  DEFAULT (getdate()) FOR [updated_at]
GO



USE [YunoAI]
GO

/****** Object:  Table [dbo].[messages]    Script Date: 27-05-2026 00:08:01 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[messages](
	[id] [nvarchar](36) NOT NULL,
	[channel] [nvarchar](50) NOT NULL,
	[chat_id] [nvarchar](255) NULL,
	[sender] [nvarchar](255) NULL,
	[agent_id] [nvarchar](36) NULL,
	[run_id] [nvarchar](36) NULL,
	[direction] [nvarchar](20) NULL,
	[content] [nvarchar](max) NOT NULL,
	[metadata] [nvarchar](max) NULL,
	[created_at] [datetime2](7) NULL,
PRIMARY KEY CLUSTERED 
(
	[id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

ALTER TABLE [dbo].[messages] ADD  DEFAULT ('user') FOR [sender]
GO

ALTER TABLE [dbo].[messages] ADD  DEFAULT ('incoming') FOR [direction]
GO

ALTER TABLE [dbo].[messages] ADD  DEFAULT ('{}') FOR [metadata]
GO

ALTER TABLE [dbo].[messages] ADD  DEFAULT (getdate()) FOR [created_at]
GO




USE [YunoAI]
GO

/****** Object:  Table [dbo].[run_logs]    Script Date: 27-05-2026 00:08:25 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[run_logs](
	[id] [nvarchar](36) NOT NULL,
	[run_id] [nvarchar](36) NOT NULL,
	[agent_id] [nvarchar](36) NULL,
	[agent_name] [nvarchar](255) NULL,
	[level] [nvarchar](20) NULL,
	[type] [nvarchar](50) NULL,
	[message] [nvarchar](max) NOT NULL,
	[data] [nvarchar](max) NULL,
	[created_at] [datetime2](7) NULL,
PRIMARY KEY CLUSTERED 
(
	[id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

ALTER TABLE [dbo].[run_logs] ADD  DEFAULT ('info') FOR [level]
GO

ALTER TABLE [dbo].[run_logs] ADD  DEFAULT ('log') FOR [type]
GO

ALTER TABLE [dbo].[run_logs] ADD  DEFAULT ('{}') FOR [data]
GO

ALTER TABLE [dbo].[run_logs] ADD  DEFAULT (getdate()) FOR [created_at]
GO

ALTER TABLE [dbo].[run_logs]  WITH CHECK ADD  CONSTRAINT [FK_logs_run] FOREIGN KEY([run_id])
REFERENCES [dbo].[workflow_runs] ([id])
GO

ALTER TABLE [dbo].[run_logs] CHECK CONSTRAINT [FK_logs_run]
GO



USE [YunoAI]
GO

/****** Object:  Table [dbo].[workflow_runs]    Script Date: 27-05-2026 00:21:49 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[workflow_runs](
	[id] [nvarchar](36) NOT NULL,
	[workflow_id] [nvarchar](36) NOT NULL,
	[status] [nvarchar](50) NULL,
	[input] [nvarchar](max) NULL,
	[output] [nvarchar](max) NULL,
	[started_at] [datetime2](7) NULL,
	[completed_at] [datetime2](7) NULL,
	[error] [nvarchar](max) NULL,
	[token_usage] [nvarchar](max) NULL,
	[cost] [float] NULL,
	[created_at] [datetime2](7) NULL,
PRIMARY KEY CLUSTERED 
(
	[id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

ALTER TABLE [dbo].[workflow_runs] ADD  DEFAULT ('pending') FOR [status]
GO

ALTER TABLE [dbo].[workflow_runs] ADD  DEFAULT ('{}') FOR [input]
GO

ALTER TABLE [dbo].[workflow_runs] ADD  DEFAULT ('{}') FOR [token_usage]
GO

ALTER TABLE [dbo].[workflow_runs] ADD  DEFAULT ((0)) FOR [cost]
GO

ALTER TABLE [dbo].[workflow_runs] ADD  DEFAULT (getdate()) FOR [created_at]
GO



USE [YunoAI]
GO

/****** Object:  Table [dbo].[workflows]    Script Date: 27-05-2026 00:22:23 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[workflows](
	[id] [nvarchar](36) NOT NULL,
	[name] [nvarchar](255) NOT NULL,
	[description] [nvarchar](max) NULL,
	[nodes] [nvarchar](max) NULL,
	[edges] [nvarchar](max) NULL,
	[trigger_type] [nvarchar](50) NULL,
	[trigger_config] [nvarchar](max) NULL,
	[is_template] [bit] NULL,
	[template_name] [nvarchar](255) NULL,
	[status] [nvarchar](50) NULL,
	[created_at] [datetime2](7) NULL,
	[updated_at] [datetime2](7) NULL,
PRIMARY KEY CLUSTERED 
(
	[id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

ALTER TABLE [dbo].[workflows] ADD  DEFAULT ('') FOR [description]
GO

ALTER TABLE [dbo].[workflows] ADD  DEFAULT ('[]') FOR [nodes]
GO

ALTER TABLE [dbo].[workflows] ADD  DEFAULT ('[]') FOR [edges]
GO

ALTER TABLE [dbo].[workflows] ADD  DEFAULT ('manual') FOR [trigger_type]
GO

ALTER TABLE [dbo].[workflows] ADD  DEFAULT ('{}') FOR [trigger_config]
GO

ALTER TABLE [dbo].[workflows] ADD  DEFAULT ((0)) FOR [is_template]
GO

ALTER TABLE [dbo].[workflows] ADD  DEFAULT ('inactive') FOR [status]
GO

ALTER TABLE [dbo].[workflows] ADD  DEFAULT (getdate()) FOR [created_at]
GO

ALTER TABLE [dbo].[workflows] ADD  DEFAULT (getdate()) FOR [updated_at]
GO




