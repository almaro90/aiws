-- AIWS v0.7 configurable Ready approval
-- aiws:migration foreign_keys=off

ALTER TABLE projects ADD COLUMN ready_policy TEXT NOT NULL DEFAULT 'curator_decides'
    CHECK (ready_policy IN ('curator_decides', 'manual_approval_required'));

ALTER TABLE tasks ADD COLUMN ready_approval_pending INTEGER NOT NULL DEFAULT 0
    CHECK (
        ready_approval_pending IN (0, 1)
        AND (ready_approval_pending = 0 OR status = 'curating')
    );

PRAGMA legacy_alter_table = ON;

DROP INDEX idx_runs_cycle_created;
DROP INDEX idx_runs_project_active;
DROP INDEX idx_runs_resume_from;
DROP INDEX idx_runs_task_created;
DROP INDEX idx_runs_task_kind_attempt;

ALTER TABLE runs RENAME TO runs_v010;

CREATE TABLE runs (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'run_'),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (kind IN ('curation', 'implementation')),
    outcome TEXT CHECK (
        outcome IS NULL OR outcome IN ('ready', 'blocked', 'approval_required')
    ),
    attempt INTEGER NOT NULL CHECK (attempt >= 1),
    status TEXT NOT NULL CHECK (
        status IN ('queued', 'preparing', 'running', 'publishing', 'succeeded', 'failed', 'cancelled')
    ),
    task_version INTEGER NOT NULL CHECK (task_version >= 1),
    branch_name TEXT,
    base_sha TEXT,
    head_sha TEXT,
    pr_url TEXT,
    summary TEXT,
    error_code TEXT,
    error_message TEXT,
    logs_storage_key TEXT,
    heartbeat_at TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    cycle_id TEXT REFERENCES task_cycles(id),
    delivery_id TEXT REFERENCES deliveries(id),
    execution_stage TEXT NOT NULL DEFAULT 'agent'
        CHECK (execution_stage IN ('agent', 'publishing')),
    resume_from_run_id TEXT REFERENCES runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    ready_policy TEXT CHECK (
        ready_policy IS NULL OR ready_policy IN ('curator_decides', 'manual_approval_required')
    ),
    CHECK (
        (kind = 'curation' AND branch_name IS NULL AND ready_policy IS NOT NULL)
        OR
        (kind = 'implementation' AND branch_name IS NOT NULL AND ready_policy IS NULL)
    ),
    CHECK (kind = 'implementation' OR status <> 'publishing'),
    CHECK (outcome IS NULL OR (kind = 'curation' AND status = 'succeeded')),
    UNIQUE(task_id, kind, attempt)
) STRICT;

INSERT INTO runs(
    id, task_id, project_id, agent_profile_id, kind, outcome, attempt, status, task_version,
    branch_name, base_sha, head_sha, pr_url, summary, error_code, error_message, logs_storage_key,
    heartbeat_at, started_at, finished_at, created_at, updated_at, cycle_id, delivery_id,
    execution_stage, resume_from_run_id, ready_policy
)
SELECT
    id, task_id, project_id, agent_profile_id, kind, outcome, attempt, status, task_version,
    branch_name, base_sha, head_sha, pr_url, summary, error_code, error_message, logs_storage_key,
    heartbeat_at, started_at, finished_at, created_at, updated_at, cycle_id, delivery_id,
    execution_stage, resume_from_run_id,
    CASE WHEN kind = 'curation' THEN 'curator_decides' ELSE NULL END
FROM runs_v010;

DROP TABLE runs_v010;

CREATE INDEX idx_runs_cycle_created ON runs(cycle_id, created_at DESC, id DESC);
CREATE INDEX idx_runs_project_active ON runs(project_id, status, created_at ASC)
    WHERE status IN ('queued', 'preparing', 'running', 'publishing');
CREATE INDEX idx_runs_resume_from ON runs(resume_from_run_id)
    WHERE resume_from_run_id IS NOT NULL;
CREATE INDEX idx_runs_task_created ON runs(task_id, created_at DESC, id DESC);
CREATE INDEX idx_runs_task_kind_attempt ON runs(task_id, kind, attempt DESC);

DROP INDEX idx_tasks_curation_candidates;
CREATE INDEX idx_tasks_curation_candidates
    ON tasks(created_at ASC, id ASC)
    WHERE status = 'curating' AND archived_at IS NULL AND automation_paused = 0
      AND ready_approval_pending = 0;
