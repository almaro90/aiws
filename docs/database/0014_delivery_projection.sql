-- AIWS v0.8 persisted Delivery Projection

ALTER TABLE deliveries ADD COLUMN pr_state TEXT
    CHECK (pr_state IS NULL OR pr_state IN ('draft', 'open', 'closed', 'merged'));
ALTER TABLE deliveries ADD COLUMN checks_state TEXT
    CHECK (checks_state IS NULL OR checks_state IN ('pending', 'passed', 'failed', 'unknown'));
ALTER TABLE deliveries ADD COLUMN checks_passed INTEGER NOT NULL DEFAULT 0 CHECK (checks_passed >= 0);
ALTER TABLE deliveries ADD COLUMN checks_failed INTEGER NOT NULL DEFAULT 0 CHECK (checks_failed >= 0);
ALTER TABLE deliveries ADD COLUMN checks_pending INTEGER NOT NULL DEFAULT 0 CHECK (checks_pending >= 0);
ALTER TABLE deliveries ADD COLUMN external_updated_at TEXT;
ALTER TABLE deliveries ADD COLUMN last_synchronized_at TEXT;
ALTER TABLE deliveries ADD COLUMN synchronization_error TEXT;

CREATE INDEX idx_deliveries_checks_attention
    ON deliveries(checks_state, last_synchronized_at DESC)
    WHERE checks_state = 'failed';
