-- AIWS v0.4 Run recovery and observable publishing checkpoints

ALTER TABLE runs ADD COLUMN execution_stage TEXT NOT NULL DEFAULT 'agent'
    CHECK (execution_stage IN ('agent', 'publishing'));
ALTER TABLE runs ADD COLUMN resume_from_run_id TEXT
    REFERENCES runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

UPDATE runs
SET execution_stage = 'publishing'
WHERE kind = 'implementation'
  AND (
    status IN ('publishing', 'succeeded')
    OR (
      status IN ('failed', 'cancelled')
      AND base_sha IS NOT NULL
      AND logs_storage_key IS NOT NULL
      AND (
        lower(coalesce(error_message, '')) LIKE '%git command failed%'
        OR lower(coalesce(error_message, '')) LIKE '%pull request%'
        OR lower(coalesce(error_message, '')) LIKE '%github%token%'
        OR lower(coalesce(error_message, '')) LIKE '%credential%expired%'
      )
    )
  );

CREATE INDEX idx_runs_resume_from ON runs(resume_from_run_id)
    WHERE resume_from_run_id IS NOT NULL;
