import type { Pool, PoolClient } from "pg";

import { AGENT_SCHEMA_SQL } from "./schema.ts";

export interface AgentMigration {
  version: number;
  sql: string;
}

const SHARD_LEGACY_STATE_SQL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_run_creator_session_fk') THEN
    ALTER TABLE agent_run ADD CONSTRAINT agent_run_creator_session_fk FOREIGN KEY (creator_session_id) REFERENCES creator_session(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_message_run_fk') THEN
    ALTER TABLE agent_message ADD CONSTRAINT agent_message_run_fk FOREIGN KEY (run_id) REFERENCES agent_run(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_candidate_run_fk') THEN
    ALTER TABLE agent_candidate ADD CONSTRAINT agent_candidate_run_fk FOREIGN KEY (run_id) REFERENCES agent_run(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_tool_call_run_fk') THEN
    ALTER TABLE agent_tool_call ADD CONSTRAINT agent_tool_call_run_fk FOREIGN KEY (run_id) REFERENCES agent_run(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_approval_run_fk') THEN
    ALTER TABLE agent_approval ADD CONSTRAINT agent_approval_run_fk FOREIGN KEY (run_id) REFERENCES agent_run(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creator_memory_session_fk') THEN
    ALTER TABLE creator_memory ADD CONSTRAINT creator_memory_session_fk FOREIGN KEY (creator_session_id) REFERENCES creator_session(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

WITH legacy AS (
  SELECT payload FROM agent_state WHERE id = 'default'
), sessions AS (
  SELECT session
  FROM legacy, jsonb_array_elements(COALESCE(payload->'creatorSessions', '[]'::jsonb)) AS session
)
INSERT INTO agent_state (id, schema_version, payload)
SELECT
  'session:' || (session->>'tokenDigest'),
  1,
  jsonb_build_object(
    'schemaVersion', 1,
    'creatorSessions', jsonb_build_array(session),
    'runs', COALESCE((SELECT jsonb_agg(run) FROM legacy, jsonb_array_elements(COALESCE(payload->'runs', '[]'::jsonb)) run WHERE run->>'creatorSessionId' = session->>'id'), '[]'::jsonb),
    'memories', COALESCE((SELECT jsonb_agg(memory) FROM legacy, jsonb_array_elements(COALESCE(payload->'memories', '[]'::jsonb)) memory WHERE memory->>'creatorSessionId' = session->>'id'), '[]'::jsonb),
    'usage', COALESCE((SELECT jsonb_agg(usage) FROM legacy, jsonb_array_elements(COALESCE(payload->'usage', '[]'::jsonb)) usage WHERE usage->>'scopeType' = 'session' AND usage->>'scopeId' = session->>'tokenDigest'), '[]'::jsonb)
  )
FROM sessions
ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW();

WITH legacy AS (
  SELECT payload FROM agent_state WHERE id = 'default'
), ip_usage AS (
  SELECT usage
  FROM legacy, jsonb_array_elements(COALESCE(payload->'usage', '[]'::jsonb)) AS usage
  WHERE usage->>'scopeType' = 'ip'
)
INSERT INTO agent_state (id, schema_version, payload)
SELECT
  'ip:' || (usage->>'scopeId'),
  1,
  jsonb_build_object('schemaVersion', 1, 'creatorSessions', '[]'::jsonb, 'runs', '[]'::jsonb, 'memories', '[]'::jsonb, 'usage', jsonb_agg(usage))
FROM ip_usage
GROUP BY usage->>'scopeId'
ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW();

DELETE FROM agent_state WHERE id = 'default';
`;

export const AGENT_MIGRATIONS: readonly AgentMigration[] = Object.freeze([
  { version: 1, sql: AGENT_SCHEMA_SQL },
  { version: 2, sql: SHARD_LEGACY_STATE_SQL },
]);

interface MigrationPool {
  connect(): Promise<PoolClient>;
}

export async function runAgentMigrations(pool: Pool | MigrationPool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ai-hook-lab-agent-migrations'))");
    // Migration 1 creates agent_state, so its marker can only be read after it.
    await client.query(AGENT_MIGRATIONS[0]!.sql);
    const marker = await client.query<{ payload: { databaseVersion?: number } }>("SELECT payload FROM agent_state WHERE id = '__schema__' FOR UPDATE");
    let current = Number(marker.rows[0]?.payload?.databaseVersion ?? 1);
    for (const migration of AGENT_MIGRATIONS) {
      if (migration.version <= current) continue;
      await client.query(migration.sql);
      current = migration.version;
    }
    await client.query(
      "INSERT INTO agent_state (id, schema_version, payload, updated_at) VALUES ('__schema__', 1, $1::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()",
      [JSON.stringify({ databaseVersion: current })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
