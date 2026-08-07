-- Candidate-level telemetry for auditable funnel analysis.
-- Raw topic, Hook text, reasoning and free-form comments are intentionally excluded.

CREATE TABLE IF NOT EXISTS dashboard_event (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  data_origin TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS hook_generation_task (
  task_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  content_type TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  prompt_variant TEXT NOT NULL,
  model TEXT NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS hook_candidate (
  task_id TEXT NOT NULL REFERENCES hook_generation_task(task_id) ON DELETE CASCADE,
  hook_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  platform TEXT NOT NULL,
  content_type TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  prompt_variant TEXT NOT NULL,
  model TEXT NOT NULL,
  click_score NUMERIC(5,1) NOT NULL DEFAULT 0,
  overall_score NUMERIC(5,1) NOT NULL DEFAULT 0,
  badcase_tags TEXT[] NOT NULL DEFAULT '{}',
  data_origin TEXT NOT NULL DEFAULT 'real_user' CHECK (data_origin = 'real_user'),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (task_id, hook_id)
);

CREATE INDEX IF NOT EXISTS hook_candidate_platform_version_idx
  ON hook_candidate (platform, prompt_version, created_at);

CREATE INDEX IF NOT EXISTS dashboard_event_hook_task_idx
  ON dashboard_event ((payload->>'hookId'), (payload->>'taskId'), timestamp);

CREATE OR REPLACE VIEW hook_candidate_funnel AS
SELECT
  c.task_id,
  c.hook_id,
  c.position,
  c.platform,
  c.content_type,
  c.prompt_version,
  c.prompt_variant,
  c.model,
  c.click_score,
  c.overall_score,
  c.badcase_tags,
  c.data_origin,
  t.status AS task_status,
  COALESCE((
    SELECT e.type = 'hook_favorited'
    FROM dashboard_event e
    WHERE e.data_origin = c.data_origin
      AND e.type IN ('hook_favorited', 'hook_unfavorited')
      AND e.payload->>'hookId' = c.hook_id
      AND e.payload->>'taskId' = c.task_id
    ORDER BY e.timestamp DESC
    LIMIT 1
  ), FALSE) AS favorited,
  COALESCE((
    SELECT e.type = 'hook_adopted'
    FROM dashboard_event e
    WHERE e.data_origin = c.data_origin
      AND e.type IN ('hook_adopted', 'hook_unadopted')
      AND e.payload->>'hookId' = c.hook_id
      AND e.payload->>'taskId' = c.task_id
    ORDER BY e.timestamp DESC
    LIMIT 1
  ), FALSE) AS adopted,
  COALESCE((
    SELECT e.payload->>'usageOutcome'
    FROM dashboard_event e
    WHERE e.data_origin = c.data_origin
      AND e.type = 'creator_feedback'
      AND e.payload->>'status' = 'submitted'
      AND e.payload->>'hookId' = c.hook_id
      AND e.payload->>'taskId' = c.task_id
    ORDER BY e.timestamp DESC
    LIMIT 1
  ), '') AS usage_outcome,
  COALESCE((
    SELECT e.payload->>'usageOutcome' IN ('direct_use', 'light_edit', 'heavy_rewrite')
    FROM dashboard_event e
    WHERE e.data_origin = c.data_origin
      AND e.type = 'creator_feedback'
      AND e.payload->>'status' = 'submitted'
      AND e.payload->>'hookId' = c.hook_id
      AND e.payload->>'taskId' = c.task_id
    ORDER BY e.timestamp DESC
    LIMIT 1
  ), FALSE) AS final_confirmed
FROM hook_candidate c
JOIN hook_generation_task t ON t.task_id = c.task_id;
