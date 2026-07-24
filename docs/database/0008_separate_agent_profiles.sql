-- AIWS Hito 21 separate Curation and Implementation Agent Profiles

ALTER TABLE projects RENAME COLUMN agent_profile_id TO implementation_agent_profile_id;
ALTER TABLE projects ADD COLUMN curation_agent_profile_id TEXT
    REFERENCES agent_profiles(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

UPDATE projects
SET curation_agent_profile_id = implementation_agent_profile_id;
