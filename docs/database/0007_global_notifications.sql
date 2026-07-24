-- AIWS v0.5 global ntfy notifications

CREATE TABLE notification_settings (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    base_url TEXT NOT NULL DEFAULT 'https://ntfy.sh',
    topic TEXT NOT NULL DEFAULT '',
    token_ciphertext BLOB,
    token_iv BLOB,
    token_auth_tag BLOB,
    generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
    updated_at TEXT NOT NULL,
    CHECK (
        (token_ciphertext IS NULL AND token_iv IS NULL AND token_auth_tag IS NULL)
        OR
        (token_ciphertext IS NOT NULL AND token_iv IS NOT NULL AND token_auth_tag IS NOT NULL)
    )
) STRICT;

INSERT INTO notification_settings(
    singleton_id, enabled, base_url, topic, generation, updated_at
) VALUES (
    1, 0, 'https://ntfy.sh', '', 1, '1970-01-01T00:00:00.000Z'
);

CREATE TABLE notification_outbox (
    event_id TEXT PRIMARY KEY
        REFERENCES task_events(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    generation INTEGER NOT NULL CHECK (generation >= 1),
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    task_id TEXT NOT NULL,
    task_title TEXT NOT NULL,
    from_status TEXT NOT NULL
        CHECK (from_status IN ('draft', 'curating', 'blocked', 'ready', 'implementing', 'done')),
    to_status TEXT NOT NULL
        CHECK (to_status IN ('draft', 'curating', 'blocked', 'ready', 'implementing', 'done')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TEXT NOT NULL,
    last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 500),
    created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_notification_outbox_due
    ON notification_outbox(next_attempt_at ASC, event_id ASC);
