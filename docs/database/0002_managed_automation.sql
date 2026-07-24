-- AIWS post-MVP managed repositories and automated Runs

CREATE TABLE connections (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'con_'),
    provider TEXT NOT NULL CHECK (provider = 'github'),
    host TEXT NOT NULL,
    external_account_id TEXT NOT NULL,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 255),
    installation_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider, host, installation_id)
) STRICT;

CREATE TABLE agent_profiles (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'agp_'),
    name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 120),
    runtime TEXT NOT NULL CHECK (runtime = 'codex'),
    auth_mode TEXT NOT NULL CHECK (auth_mode IN ('api_key', 'chatgpt_session')),
    credential_reference TEXT NOT NULL CHECK (length(trim(credential_reference)) BETWEEN 1 AND 255),
    model TEXT CHECK (model IS NULL OR length(model) <= 120),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

ALTER TABLE projects ADD COLUMN repository_mode TEXT NOT NULL DEFAULT 'local'
    CHECK (repository_mode IN ('local', 'managed'));
ALTER TABLE projects ADD COLUMN connection_id TEXT REFERENCES connections(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE projects ADD COLUMN remote_repository_id TEXT;
ALTER TABLE projects ADD COLUMN remote_full_name TEXT;
ALTER TABLE projects ADD COLUMN remote_web_url TEXT;
ALTER TABLE projects ADD COLUMN default_branch TEXT;
ALTER TABLE projects ADD COLUMN automation_enabled INTEGER NOT NULL DEFAULT 0 CHECK (automation_enabled IN (0, 1));
ALTER TABLE projects ADD COLUMN agent_profile_id TEXT REFERENCES agent_profiles(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE projects ADD COLUMN schedule_cron TEXT;
ALTER TABLE projects ADD COLUMN schedule_timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE projects ADD COLUMN max_concurrency INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrency BETWEEN 1 AND 16);

ALTER TABLE tasks ADD COLUMN automation_paused INTEGER NOT NULL DEFAULT 0 CHECK (automation_paused IN (0, 1));

CREATE TABLE runs (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'run_'),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    attempt INTEGER NOT NULL CHECK (attempt >= 1),
    status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'running', 'publishing', 'succeeded', 'failed', 'cancelled')),
    task_version INTEGER NOT NULL CHECK (task_version >= 1),
    branch_name TEXT NOT NULL CHECK (length(trim(branch_name)) BETWEEN 1 AND 255),
    base_sha TEXT,
    head_sha TEXT,
    pr_url TEXT,
    summary TEXT CHECK (summary IS NULL OR length(summary) <= 10000),
    error_code TEXT,
    error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 5000),
    logs_storage_key TEXT,
    heartbeat_at TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(task_id, attempt),
    UNIQUE(branch_name)
) STRICT;

CREATE UNIQUE INDEX idx_projects_remote_repository
    ON projects(connection_id, remote_repository_id)
    WHERE connection_id IS NOT NULL;
CREATE INDEX idx_tasks_automation_ready
    ON tasks(created_at ASC, id ASC)
    WHERE status = 'ready' AND archived_at IS NULL AND automation_paused = 0;
CREATE INDEX idx_runs_task_created ON runs(task_id, created_at DESC, id DESC);
CREATE INDEX idx_runs_project_active ON runs(project_id, status, created_at ASC)
    WHERE status IN ('queued', 'preparing', 'running', 'publishing');
