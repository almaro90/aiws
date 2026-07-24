-- AIWS v0.4 incremental delivery cycles

CREATE TABLE task_cycles (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'cyc_'),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    number INTEGER NOT NULL CHECK (number >= 1),
    delivery_id TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE(task_id, number)
) STRICT;
CREATE TABLE task_messages (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'msg_'),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    cycle_id TEXT NOT NULL REFERENCES task_cycles(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    type TEXT NOT NULL CHECK (type IN ('initial_request', 'change', 'context')),
    text TEXT CHECK (text IS NULL OR length(trim(text)) BETWEEN 1 AND 100000),
    created_at TEXT NOT NULL
) STRICT;
CREATE TABLE spec_revisions (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'spc_'),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    cycle_id TEXT NOT NULL REFERENCES task_cycles(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    revision INTEGER NOT NULL CHECK (revision >= 1), content TEXT NOT NULL CHECK (length(CAST(content AS BLOB)) <= 1048576),
    created_at TEXT NOT NULL, UNIQUE(task_id, cycle_id, revision)
) STRICT;
CREATE TABLE question_answers (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'ans_'),
    question_id TEXT NOT NULL REFERENCES questions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    cycle_id TEXT NOT NULL REFERENCES task_cycles(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    revision INTEGER NOT NULL CHECK (revision >= 1), answer_text TEXT,
    selected_option_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(selected_option_ids_json)),
    created_at TEXT NOT NULL, UNIQUE(question_id, revision)
) STRICT;
CREATE TABLE deliveries (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'dlv_'),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    branch_name TEXT, pr_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
ALTER TABLE tasks ADD COLUMN current_cycle_id TEXT;
ALTER TABLE tasks ADD COLUMN current_delivery_id TEXT;
ALTER TABLE questions ADD COLUMN cycle_id TEXT REFERENCES task_cycles(id);
ALTER TABLE attachments ADD COLUMN cycle_id TEXT REFERENCES task_cycles(id);
ALTER TABLE attachments ADD COLUMN message_id TEXT REFERENCES task_messages(id);
ALTER TABLE runs ADD COLUMN cycle_id TEXT REFERENCES task_cycles(id);
ALTER TABLE runs ADD COLUMN delivery_id TEXT REFERENCES deliveries(id);
ALTER TABLE task_events ADD COLUMN cycle_id TEXT REFERENCES task_cycles(id);
INSERT INTO task_cycles(id, task_id, number, created_at, completed_at) SELECT 'cyc_' || substr(id, 5), id, 1, created_at, CASE WHEN status = 'done' THEN updated_at ELSE NULL END FROM tasks;
INSERT INTO task_messages(id, task_id, cycle_id, type, text, created_at) SELECT 'msg_' || substr(id, 5), id, 'cyc_' || substr(id, 5), 'initial_request', user_request, created_at FROM tasks;
INSERT INTO spec_revisions(id, task_id, cycle_id, revision, content, created_at) SELECT 'spc_' || substr(id, 5), id, 'cyc_' || substr(id, 5), 1, curator_spec, updated_at FROM tasks WHERE trim(curator_spec) <> '';
UPDATE questions SET cycle_id = 'cyc_' || substr(task_id, 5);
UPDATE attachments SET cycle_id = 'cyc_' || substr(task_id, 5);
UPDATE runs SET cycle_id = 'cyc_' || substr(task_id, 5);
UPDATE tasks SET current_cycle_id = 'cyc_' || substr(id, 5);
UPDATE task_events SET cycle_id = 'cyc_' || substr(task_id, 5);
INSERT INTO question_answers(id, question_id, cycle_id, revision, answer_text, selected_option_ids_json, created_at) SELECT 'ans_' || substr(id, 5), id, cycle_id, 1, answer_text, selected_option_ids_json, answered_at FROM questions WHERE answered_at IS NOT NULL;
INSERT INTO deliveries(id, task_id, branch_name, pr_url, created_at, updated_at)
SELECT 'dlv_' || substr(t.id, 5), t.id, (SELECT r.branch_name FROM runs r WHERE r.task_id = t.id AND r.branch_name IS NOT NULL ORDER BY r.created_at DESC, r.id DESC LIMIT 1), coalesce(t.pr_url, (SELECT r.pr_url FROM runs r WHERE r.task_id = t.id AND r.pr_url IS NOT NULL ORDER BY r.created_at DESC, r.id DESC LIMIT 1)), t.created_at, t.updated_at FROM tasks t WHERE t.pr_url IS NOT NULL OR EXISTS (SELECT 1 FROM runs r WHERE r.task_id = t.id AND r.branch_name IS NOT NULL);
UPDATE tasks SET current_delivery_id = 'dlv_' || substr(id, 5) WHERE EXISTS (SELECT 1 FROM deliveries d WHERE d.id = 'dlv_' || substr(tasks.id, 5));
UPDATE task_cycles SET delivery_id = (SELECT current_delivery_id FROM tasks WHERE tasks.id = task_cycles.task_id);
UPDATE runs SET delivery_id = (SELECT current_delivery_id FROM tasks WHERE tasks.id = runs.task_id) WHERE kind = 'implementation';
CREATE INDEX idx_task_cycles_task_number ON task_cycles(task_id, number DESC);
CREATE INDEX idx_task_messages_task_created ON task_messages(task_id, created_at DESC, id DESC);
CREATE INDEX idx_spec_revisions_task_created ON spec_revisions(task_id, created_at DESC, id DESC);
CREATE INDEX idx_question_answers_question_revision ON question_answers(question_id, revision DESC);
CREATE INDEX idx_deliveries_task_created ON deliveries(task_id, created_at DESC, id DESC);
CREATE INDEX idx_questions_cycle_status ON questions(cycle_id, status, created_at ASC, id ASC);
CREATE INDEX idx_attachments_cycle_created ON attachments(cycle_id, created_at ASC, id ASC);
DROP INDEX idx_runs_task_created;
DROP INDEX idx_runs_task_kind_attempt;
DROP INDEX idx_runs_project_active;
ALTER TABLE runs RENAME TO runs_v03;
CREATE TABLE runs (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'run_'),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (kind IN ('curation', 'implementation')),
    outcome TEXT CHECK (outcome IS NULL OR outcome IN ('ready', 'blocked')),
    attempt INTEGER NOT NULL CHECK (attempt >= 1),
    status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'running', 'publishing', 'succeeded', 'failed', 'cancelled')),
    task_version INTEGER NOT NULL CHECK (task_version >= 1), branch_name TEXT,
    base_sha TEXT, head_sha TEXT, pr_url TEXT, summary TEXT, error_code TEXT, error_message TEXT,
    logs_storage_key TEXT, heartbeat_at TEXT, started_at TEXT, finished_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    cycle_id TEXT REFERENCES task_cycles(id), delivery_id TEXT REFERENCES deliveries(id),
    CHECK ((kind = 'curation' AND branch_name IS NULL) OR (kind = 'implementation' AND branch_name IS NOT NULL)),
    CHECK (kind = 'implementation' OR status <> 'publishing'),
    CHECK (outcome IS NULL OR (kind = 'curation' AND status = 'succeeded')),
    UNIQUE(task_id, kind, attempt)
) STRICT;
INSERT INTO runs SELECT id,task_id,project_id,agent_profile_id,kind,outcome,attempt,status,task_version,branch_name,base_sha,head_sha,pr_url,summary,error_code,error_message,logs_storage_key,heartbeat_at,started_at,finished_at,created_at,updated_at,cycle_id,delivery_id FROM runs_v03;
DROP TABLE runs_v03;
CREATE INDEX idx_runs_task_created ON runs(task_id, created_at DESC, id DESC);
CREATE INDEX idx_runs_task_kind_attempt ON runs(task_id, kind, attempt DESC);
CREATE INDEX idx_runs_project_active ON runs(project_id, status, created_at ASC) WHERE status IN ('queued', 'preparing', 'running', 'publishing');
CREATE INDEX idx_runs_cycle_created ON runs(cycle_id, created_at DESC, id DESC);
