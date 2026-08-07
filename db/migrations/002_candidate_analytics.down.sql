-- Roll back only candidate-level analytics objects. Existing dashboard events are preserved.

DROP VIEW IF EXISTS hook_candidate_funnel;
DROP TABLE IF EXISTS hook_candidate;
DROP TABLE IF EXISTS hook_generation_task;
DROP INDEX IF EXISTS dashboard_event_hook_task_idx;
