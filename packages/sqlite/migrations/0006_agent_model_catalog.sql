-- AIWS live Codex model catalog and reasoning effort

ALTER TABLE agent_profiles ADD COLUMN reasoning_effort TEXT
    CHECK (reasoning_effort IS NULL OR length(trim(reasoning_effort)) BETWEEN 1 AND 120);
