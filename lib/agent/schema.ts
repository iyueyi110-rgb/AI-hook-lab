export const AGENT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agent_state (
  id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS creator_session (
  id TEXT PRIMARY KEY, token_digest TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_run (
  id TEXT PRIMARY KEY, creator_session_id TEXT NOT NULL, revision INTEGER NOT NULL,
  status TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_message (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_candidate (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, payload JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_tool_call (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, tool TEXT NOT NULL,
  status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_approval (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, tool TEXT NOT NULL,
  status TEXT NOT NULL, requested_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS creator_memory (
  creator_session_id TEXT NOT NULL, memory_key TEXT NOT NULL, memory_value TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL, payload JSONB NOT NULL,
  PRIMARY KEY (creator_session_id, memory_key, memory_value)
);
CREATE INDEX IF NOT EXISTS creator_session_expiry_idx ON creator_session(expires_at);
CREATE INDEX IF NOT EXISTS agent_run_owner_updated_idx ON agent_run(creator_session_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS agent_message_run_created_idx ON agent_message(run_id, created_at);
CREATE INDEX IF NOT EXISTS agent_candidate_run_idx ON agent_candidate(run_id);
CREATE INDEX IF NOT EXISTS agent_tool_call_run_idx ON agent_tool_call(run_id);
CREATE INDEX IF NOT EXISTS agent_approval_run_idx ON agent_approval(run_id);
CREATE INDEX IF NOT EXISTS creator_memory_session_idx ON creator_memory(creator_session_id);
`;
