-- AIWS MVP v0.1
-- Migration: 0001_initial
-- SQLite STRICT schema

CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    checksum_sha256 TEXT NOT NULL CHECK (length(checksum_sha256) = 64),
    applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE projects (
    id TEXT PRIMARY KEY
        CHECK (length(id) = 30 AND substr(id, 1, 4) = 'prj_'),
    name TEXT NOT NULL
        CHECK (length(trim(name)) BETWEEN 1 AND 120),
    description TEXT NOT NULL DEFAULT ''
        CHECK (length(description) <= 10000),
    repository_path TEXT NOT NULL UNIQUE
        CHECK (substr(repository_path, 1, 1) = '/'),
    git_provider TEXT NOT NULL
        CHECK (git_provider IN ('github', 'azure_devops', 'gitlab', 'other')),
    account_scope TEXT NOT NULL
        CHECK (account_scope IN ('personal', 'work')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
) STRICT;

CREATE TABLE tasks (
    id TEXT PRIMARY KEY
        CHECK (length(id) = 30 AND substr(id, 1, 4) = 'tsk_'),
    project_id TEXT NOT NULL
        REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    title TEXT NOT NULL
        CHECK (length(trim(title)) BETWEEN 1 AND 200),
    user_request TEXT NOT NULL
        CHECK (length(trim(user_request)) BETWEEN 1 AND 100000),
    curator_spec TEXT NOT NULL DEFAULT ''
        CHECK (length(CAST(curator_spec AS BLOB)) <= 1048576),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'blocked', 'ready', 'implementing', 'done')),
    pr_url TEXT
        CHECK (pr_url IS NULL OR length(pr_url) <= 2048),
    version INTEGER NOT NULL DEFAULT 1
        CHECK (version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
) STRICT;

CREATE TRIGGER tasks_user_request_immutable
BEFORE UPDATE OF user_request ON tasks
FOR EACH ROW
WHEN NEW.user_request IS NOT OLD.user_request
BEGIN
    SELECT RAISE(ABORT, 'user_request is immutable');
END;

CREATE TABLE questions (
    id TEXT PRIMARY KEY
        CHECK (length(id) = 30 AND substr(id, 1, 4) = 'qst_'),
    task_id TEXT NOT NULL
        REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    text TEXT NOT NULL
        CHECK (length(trim(text)) BETWEEN 1 AND 5000),
    type TEXT NOT NULL
        CHECK (type IN ('text', 'single_choice', 'multiple_choice')),
    options_json TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(options_json)),
    allow_other INTEGER NOT NULL DEFAULT 0
        CHECK (allow_other IN (0, 1)),
    answer_text TEXT,
    selected_option_ids_json TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(selected_option_ids_json)),
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'answered', 'dismissed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    answered_at TEXT,
    dismissed_at TEXT,
    CHECK (
        (type = 'text' AND json_array_length(options_json) = 0)
        OR
        (
            type IN ('single_choice', 'multiple_choice')
            AND json_array_length(options_json) BETWEEN 2 AND 20
        )
    ),
    CHECK (status <> 'answered' OR answered_at IS NOT NULL),
    CHECK (status <> 'dismissed' OR dismissed_at IS NOT NULL)
) STRICT;

CREATE TABLE attachments (
    id TEXT PRIMARY KEY
        CHECK (length(id) = 30 AND substr(id, 1, 4) = 'att_'),
    task_id TEXT NOT NULL
        REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    original_name TEXT NOT NULL
        CHECK (length(trim(original_name)) BETWEEN 1 AND 255),
    storage_key TEXT NOT NULL UNIQUE
        CHECK (length(trim(storage_key)) BETWEEN 1 AND 512),
    mime_type TEXT NOT NULL
        CHECK (length(trim(mime_type)) BETWEEN 1 AND 255),
    size_bytes INTEGER NOT NULL
        CHECK (size_bytes BETWEEN 1 AND 26214400),
    sha256 TEXT NOT NULL
        CHECK (length(sha256) = 64 AND sha256 = lower(sha256)),
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE task_events (
    id TEXT PRIMARY KEY
        CHECK (length(id) = 30 AND substr(id, 1, 4) = 'evt_'),
    task_id TEXT NOT NULL
        REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    type TEXT NOT NULL
        CHECK (length(trim(type)) BETWEEN 1 AND 100),
    actor_type TEXT NOT NULL
        CHECK (actor_type IN ('web', 'cli', 'system')),
    metadata_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_projects_active_updated
    ON projects(updated_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX idx_projects_provider_scope
    ON projects(git_provider, account_scope, updated_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX idx_tasks_active_updated
    ON tasks(updated_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX idx_tasks_active_status_created
    ON tasks(status, created_at ASC, id ASC)
    WHERE archived_at IS NULL;

CREATE INDEX idx_tasks_project_active_status
    ON tasks(project_id, status, updated_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX idx_tasks_archived_at
    ON tasks(archived_at DESC, id DESC)
    WHERE archived_at IS NOT NULL;

CREATE INDEX idx_questions_task_status
    ON questions(task_id, status, created_at ASC, id ASC);

CREATE INDEX idx_attachments_task_created
    ON attachments(task_id, created_at ASC, id ASC);

CREATE INDEX idx_task_events_task_created
    ON task_events(task_id, created_at DESC, id DESC);

