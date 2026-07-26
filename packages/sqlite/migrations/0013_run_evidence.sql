-- AIWS v0.7 immutable Run verification evidence and provenance
-- aiws:migration foreign_keys=off

PRAGMA legacy_alter_table = ON;

DROP INDEX idx_runs_cycle_created;
DROP INDEX idx_runs_project_active;
DROP INDEX idx_runs_resume_from;
DROP INDEX idx_runs_task_created;
DROP INDEX idx_runs_task_kind_attempt;

ALTER TABLE runs RENAME TO runs_v012;

CREATE TABLE runs (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'run_'),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (kind IN ('curation', 'implementation')),
    outcome TEXT CHECK (outcome IS NULL OR outcome IN ('ready', 'blocked', 'approval_required')),
    attempt INTEGER NOT NULL CHECK (attempt >= 1),
    status TEXT NOT NULL CHECK (
        status IN ('queued', 'preparing', 'running', 'verifying', 'publishing',
                   'succeeded', 'failed', 'cancelled')
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
    verification_waiver_run_id TEXT REFERENCES runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    verification_waiver_reason TEXT,
    FOREIGN KEY(project_id, verification_contract_revision)
        REFERENCES verification_contract_revisions(project_id, revision)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (
        (kind = 'curation' AND branch_name IS NULL AND ready_policy IS NOT NULL
            AND verification_contract_revision IS NULL)
        OR
        (kind = 'implementation' AND branch_name IS NOT NULL AND ready_policy IS NULL)
    ),
    CHECK (kind = 'implementation' OR status NOT IN ('verifying', 'publishing')),
    CHECK (outcome IS NULL OR (kind = 'curation' AND status = 'succeeded')),
    CHECK (
        (verification_waiver_run_id IS NULL AND verification_waiver_reason IS NULL)
        OR
        (kind = 'implementation' AND verification_waiver_run_id IS NOT NULL
            AND length(trim(verification_waiver_reason)) BETWEEN 1 AND 2000)
    ),
    UNIQUE(task_id, kind, attempt)
) STRICT;

INSERT INTO runs(
    id, task_id, project_id, agent_profile_id, kind, outcome, attempt, status, task_version,
    branch_name, base_sha, head_sha, pr_url, summary, error_code, error_message, logs_storage_key,
    heartbeat_at, started_at, finished_at, created_at, updated_at, cycle_id, delivery_id,
    execution_stage, resume_from_run_id, ready_policy, verification_contract_revision,
    verification_waiver_run_id, verification_waiver_reason
)
SELECT
    id, task_id, project_id, agent_profile_id, kind, outcome, attempt, status, task_version,
    branch_name, base_sha, head_sha, pr_url, summary, error_code, error_message, logs_storage_key,
    heartbeat_at, started_at, finished_at, created_at, updated_at, cycle_id, delivery_id,
    execution_stage, resume_from_run_id, ready_policy, verification_contract_revision, NULL, NULL
FROM runs_v012;

DROP TABLE runs_v012;

CREATE INDEX idx_runs_cycle_created ON runs(cycle_id, created_at DESC, id DESC);
CREATE INDEX idx_runs_project_active ON runs(project_id, status, created_at ASC)
    WHERE status IN ('queued', 'preparing', 'running', 'verifying', 'publishing');
CREATE INDEX idx_runs_resume_from ON runs(resume_from_run_id)
    WHERE resume_from_run_id IS NOT NULL;
CREATE INDEX idx_runs_task_created ON runs(task_id, created_at DESC, id DESC);
CREATE INDEX idx_runs_task_kind_attempt ON runs(task_id, kind, attempt DESC);

CREATE TABLE verification_results (
    run_id TEXT NOT NULL REFERENCES runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 19),
    name TEXT NOT NULL,
    executable TEXT NOT NULL,
    args_json TEXT NOT NULL CHECK (json_valid(args_json) AND json_type(args_json) = 'array'),
    required INTEGER NOT NULL CHECK (required IN (0, 1)),
    status TEXT NOT NULL CHECK (
        status IN ('passed', 'failed', 'timed_out', 'spawn_error', 'cancelled')
    ),
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
    exit_code INTEGER,
    stdout_excerpt TEXT NOT NULL CHECK (length(stdout_excerpt) <= 16384),
    stderr_excerpt TEXT NOT NULL CHECK (length(stderr_excerpt) <= 16384),
    image_digest TEXT NOT NULL,
    toolchain_identity TEXT NOT NULL,
    PRIMARY KEY(run_id, position)
) STRICT;

CREATE TRIGGER verification_results_immutable_update
BEFORE UPDATE ON verification_results BEGIN
    SELECT RAISE(ABORT, 'verification results are immutable');
END;
CREATE TRIGGER verification_results_immutable_delete
BEFORE DELETE ON verification_results BEGIN
    SELECT RAISE(ABORT, 'verification results are immutable');
END;

CREATE TABLE run_provenance (
    run_id TEXT PRIMARY KEY REFERENCES runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
    created_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER run_provenance_immutable_update
BEFORE UPDATE ON run_provenance BEGIN
    SELECT RAISE(ABORT, 'run provenance is immutable');
END;
CREATE TRIGGER run_provenance_immutable_delete
BEFORE DELETE ON run_provenance BEGIN
    SELECT RAISE(ABORT, 'run provenance is immutable');
END;
