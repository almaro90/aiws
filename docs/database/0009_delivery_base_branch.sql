-- AIWS Hito 22 Delivery Base Branch

ALTER TABLE deliveries ADD COLUMN base_branch TEXT
    CHECK (base_branch IS NULL OR length(trim(base_branch)) BETWEEN 1 AND 255);

UPDATE deliveries
SET base_branch = (
    SELECT p.default_branch
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    WHERE t.id = deliveries.task_id
);
