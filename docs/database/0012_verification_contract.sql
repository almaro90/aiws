-- AIWS v0.7 versioned Verification Contract
-- aiws:migration foreign_keys=off

CREATE TABLE verification_contract_revisions (
    project_id TEXT NOT NULL REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    commands_json TEXT NOT NULL CHECK (
        json_valid(commands_json)
        AND json_type(commands_json) = 'array'
        AND (
            (enabled = 0 AND json_array_length(commands_json) = 0)
            OR
            (enabled = 1 AND json_array_length(commands_json) BETWEEN 1 AND 20)
        )
    ),
    created_at TEXT NOT NULL,
    PRIMARY KEY(project_id, revision)
) STRICT;

CREATE INDEX idx_verification_contract_project_revision
    ON verification_contract_revisions(project_id, revision DESC);

CREATE TRIGGER verification_contract_revisions_immutable_update
BEFORE UPDATE ON verification_contract_revisions
BEGIN
    SELECT RAISE(ABORT, 'verification contract revisions are immutable');
END;

CREATE TRIGGER verification_contract_revisions_immutable_delete
BEFORE DELETE ON verification_contract_revisions
BEGIN
    SELECT RAISE(ABORT, 'verification contract revisions are immutable');
END;

PRAGMA legacy_alter_table = ON;

DROP INDEX idx_runs_cycle_created;
DROP INDEX idx_runs_project_active;
DROP INDEX idx_runs_resume_from;
DROP INDEX idx_runs_task_created;
DROP INDEX idx_runs_task_kind_attempt;

ALTER TABLE runs RENAME TO runs_v011;

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
    verification_contract_revision INTEGER,
    FOREIGN KEY(project_id, verification_contract_revision)
        REFERENCES verification_contract_revisions(project_id, revision)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (
        (kind = 'curation' AND branch_name IS NULL AND ready_policy IS NOT NULL
            AND verification_contract_revision IS NULL)
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
    execution_stage, resume_from_run_id, ready_policy, verification_contract_revision
)
SELECT
    id, task_id, project_id, agent_profile_id, kind, outcome, attempt, status, task_version,
    branch_name, base_sha, head_sha, pr_url, summary, error_code, error_message, logs_storage_key,
    heartbeat_at, started_at, finished_at, created_at, updated_at, cycle_id, delivery_id,
    execution_stage, resume_from_run_id, ready_policy, NULL
FROM runs_v011;

DROP TABLE runs_v011;

CREATE INDEX idx_runs_cycle_created ON runs(cycle_id, created_at DESC, id DESC);
CREATE INDEX idx_runs_project_active ON runs(project_id, status, created_at ASC)
    WHERE status IN ('queued', 'preparing', 'running', 'publishing');
CREATE INDEX idx_runs_resume_from ON runs(resume_from_run_id)
    WHERE resume_from_run_id IS NOT NULL;
CREATE INDEX idx_runs_task_created ON runs(task_id, created_at DESC, id DESC);
CREATE INDEX idx_runs_task_kind_attempt ON runs(task_id, kind, attempt DESC);
