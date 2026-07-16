-- AI Hook Lab offline evaluation schema. Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS evaluation_state (id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS evaluation_user (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, payload JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS evaluation_session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS evaluation_case (id TEXT PRIMARY KEY, case_id TEXT UNIQUE NOT NULL, topic_id TEXT NOT NULL, platform TEXT NOT NULL, data_origin TEXT NOT NULL, payload JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS prompt_version (id TEXT PRIMARY KEY, version TEXT UNIQUE NOT NULL, role TEXT NOT NULL, content_hash TEXT NOT NULL, payload JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS evaluation_run (id TEXT PRIMARY KEY, status TEXT NOT NULL, execution_mode TEXT NOT NULL, data_origin TEXT NOT NULL, payload JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS evaluation_generation (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, case_id TEXT NOT NULL, prompt_role TEXT NOT NULL, status TEXT NOT NULL, payload JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS human_evaluation (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, evaluator_id TEXT NOT NULL, formal_result_id TEXT NOT NULL, payload JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS pairwise_evaluation (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, evaluator_id TEXT NOT NULL, case_id TEXT NOT NULL, payload JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS bad_case (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, formal_result_id TEXT NOT NULL, type TEXT NOT NULL, severity TEXT NOT NULL, payload JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS evaluation_audit (id TEXT PRIMARY KEY, action TEXT NOT NULL, actor_id TEXT, created_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL);
