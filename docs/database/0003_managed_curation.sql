-- AIWS v0.3 managed curation

PRAGMA legacy_alter_table = ON;

DROP TRIGGER tasks_user_request_immutable;
DROP INDEX idx_tasks_active_updated;
DROP INDEX idx_tasks_active_status_created;
DROP INDEX idx_tasks_project_active_status;
DROP INDEX idx_tasks_archived_at;
DROP INDEX idx_tasks_automation_ready;

ALTER TABLE tasks RENAME TO tasks_v02;

CREATE TABLE tasks (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'tsk_'),
    project_id TEXT NOT NULL REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
    user_request TEXT NOT NULL CHECK (length(trim(user_request)) BETWEEN 1 AND 100000),
    curator_spec TEXT NOT NULL DEFAULT '' CHECK (length(CAST(curator_spec AS BLOB)) <= 1048576),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'curating', 'blocked', 'ready', 'implementing', 'done')),
    pr_url TEXT CHECK (pr_url IS NULL OR length(pr_url) <= 2048),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    automation_paused INTEGER NOT NULL DEFAULT 0 CHECK (automation_paused IN (0, 1))
) STRICT;

INSERT INTO tasks
SELECT id, project_id, title, user_request, curator_spec, status, pr_url, version,
       created_at, updated_at, archived_at, automation_paused
FROM tasks_v02;

DROP INDEX idx_questions_task_status;
ALTER TABLE questions RENAME TO questions_v02;
CREATE TABLE questions (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'qst_'),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    text TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 5000),
    type TEXT NOT NULL CHECK (type IN ('text', 'single_choice', 'multiple_choice')),
    options_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(options_json)),
    allow_other INTEGER NOT NULL DEFAULT 0 CHECK (allow_other IN (0, 1)),
    answer_text TEXT,
    selected_option_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(selected_option_ids_json)),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'dismissed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    answered_at TEXT,
    dismissed_at TEXT,
    CHECK ((type = 'text' AND json_array_length(options_json) = 0) OR
           (type IN ('single_choice', 'multiple_choice') AND json_array_length(options_json) BETWEEN 2 AND 20)),
    CHECK (status <> 'answered' OR answered_at IS NOT NULL),
    CHECK (status <> 'dismissed' OR dismissed_at IS NOT NULL)
) STRICT;
INSERT INTO questions SELECT * FROM questions_v02;
DROP TABLE questions_v02;
CREATE INDEX idx_questions_task_status ON questions(task_id, status, created_at ASC, id ASC);

DROP INDEX idx_attachments_task_created;
ALTER TABLE attachments RENAME TO attachments_v02;
CREATE TABLE attachments (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'att_'),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    original_name TEXT NOT NULL CHECK (length(trim(original_name)) BETWEEN 1 AND 255),
    storage_key TEXT NOT NULL UNIQUE CHECK (length(trim(storage_key)) BETWEEN 1 AND 512),
    mime_type TEXT NOT NULL CHECK (length(trim(mime_type)) BETWEEN 1 AND 255),
    size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 26214400),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 = lower(sha256)),
    created_at TEXT NOT NULL
) STRICT;
INSERT INTO attachments SELECT * FROM attachments_v02;
DROP TABLE attachments_v02;
CREATE INDEX idx_attachments_task_created ON attachments(task_id, created_at ASC, id ASC);

DROP INDEX idx_task_events_task_created;
ALTER TABLE task_events RENAME TO task_events_v02;
CREATE TABLE task_events (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'evt_'),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    type TEXT NOT NULL CHECK (length(trim(type)) BETWEEN 1 AND 100),
    actor_type TEXT NOT NULL CHECK (actor_type IN ('web', 'cli', 'system')),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL
) STRICT;
INSERT INTO task_events SELECT * FROM task_events_v02;
DROP TABLE task_events_v02;
CREATE INDEX idx_task_events_task_created ON task_events(task_id, created_at DESC, id DESC);

CREATE TRIGGER tasks_user_request_immutable
BEFORE UPDATE OF user_request ON tasks
FOR EACH ROW
WHEN NEW.user_request IS NOT OLD.user_request
 AND NOT (OLD.status = 'draft' AND NEW.status = 'draft')
BEGIN
    SELECT RAISE(ABORT, 'user_request is immutable after Draft');
END;

CREATE INDEX idx_tasks_active_updated
    ON tasks(updated_at DESC, id DESC) WHERE archived_at IS NULL;
CREATE INDEX idx_tasks_active_status_created
    ON tasks(status, created_at ASC, id ASC) WHERE archived_at IS NULL;
CREATE INDEX idx_tasks_project_active_status
    ON tasks(project_id, status, updated_at DESC, id DESC) WHERE archived_at IS NULL;
CREATE INDEX idx_tasks_archived_at
    ON tasks(archived_at DESC, id DESC) WHERE archived_at IS NOT NULL;
CREATE INDEX idx_tasks_automation_ready
    ON tasks(created_at ASC, id ASC)
    WHERE status = 'ready' AND archived_at IS NULL AND automation_paused = 0;
CREATE INDEX idx_tasks_curation_candidates
    ON tasks(created_at ASC, id ASC)
    WHERE status = 'curating' AND archived_at IS NULL AND automation_paused = 0;

DROP INDEX idx_runs_task_created;
DROP INDEX idx_runs_project_active;
ALTER TABLE runs RENAME TO runs_v02;

CREATE TABLE runs (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'run_'),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (kind IN ('curation', 'implementation')),
    outcome TEXT CHECK (outcome IS NULL OR outcome IN ('ready', 'blocked')),
    attempt INTEGER NOT NULL CHECK (attempt >= 1),
    status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'running', 'publishing', 'succeeded', 'failed', 'cancelled')),
    task_version INTEGER NOT NULL CHECK (task_version >= 1),
    branch_name TEXT CHECK (branch_name IS NULL OR length(trim(branch_name)) BETWEEN 1 AND 255),
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
    CHECK ((kind = 'curation' AND branch_name IS NULL) OR (kind = 'implementation' AND branch_name IS NOT NULL)),
    CHECK (kind = 'implementation' OR status <> 'publishing'),
    CHECK (outcome IS NULL OR (kind = 'curation' AND status = 'succeeded')),
    UNIQUE(task_id, kind, attempt),
    UNIQUE(branch_name)
) STRICT;

INSERT INTO runs(
    id, task_id, project_id, agent_profile_id, kind, outcome, attempt, status,
    task_version, branch_name, base_sha, head_sha, pr_url, summary, error_code,
    error_message, logs_storage_key, heartbeat_at, started_at, finished_at, created_at, updated_at
)
SELECT id, task_id, project_id, agent_profile_id, 'implementation', NULL, attempt, status,
       task_version, branch_name, base_sha, head_sha, pr_url, summary, error_code,
       error_message, logs_storage_key, heartbeat_at, started_at, finished_at, created_at, updated_at
FROM runs_v02;

DROP TABLE runs_v02;
DROP TABLE tasks_v02;

CREATE INDEX idx_runs_task_created ON runs(task_id, created_at DESC, id DESC);
CREATE INDEX idx_runs_task_kind_attempt ON runs(task_id, kind, attempt DESC);
CREATE INDEX idx_runs_project_active ON runs(project_id, status, created_at ASC)
    WHERE status IN ('queued', 'preparing', 'running', 'publishing');

PRAGMA legacy_alter_table = OFF;
