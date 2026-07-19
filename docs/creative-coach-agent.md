# Creative Coach Agent

Creative Coach is an optional, single-Agent workflow layered on top of the existing Hook generator. The classic one-request/10-Hook mode remains available and keeps its original API and UI behavior.

## Enablement and storage

- Set `NEXT_PUBLIC_AGENT_COACH_ENABLED=true` to expose the coach UI and Agent APIs. It defaults to `false` for gradual rollout.
- Anonymous ownership uses the HttpOnly `ai-hook-creator-session` cookie. The cookie is `SameSite=Lax`, `Secure` in production, and expires after 180 days; storage contains only its SHA-256 digest.
- Local development uses `data/agent-store.json` (or `AGENT_STORE_PATH`) when `DATABASE_URL` is empty. Production fails closed unless PostgreSQL is configured.
- Every inactive run, including abandoned non-terminal and orphaned runs, messages and candidates, is removed after 30 days. A non-expired operation lease is preserved; expired 180-day sessions cascade their runs, preference memory and quota usage. Production must schedule the authenticated cleanup endpoint; retention work is deliberately kept off interactive request latency.
- The original image file and its binary/base64 bytes are never persisted. The resulting structured understanding (for example `topic`, `imageDescription`, suggested platform/content type/tone) may be stored in the run brief and structured tool result for the same maximum 30-day run lifetime. The tool-call input audit contains only safe upload metadata such as MIME type and byte count.
- Long-term creator memory is a strict enum/value whitelist (platform, existing style preference/avoidance, tone, word-limit band and avoided Bad Case tag). It never stores an image, image description, topic, Hook, free-form message or personal identity data.

Image analysis requires both `ARK_API_KEY` and `ARK_MODEL_ID`. `ARK_MODEL_ID` is the Ark model or endpoint ID enabled for the account. Keep real credentials only in ignored `.env.local`; never commit them.

Production PostgreSQL stores one `agent_state` shard per session digest and separate IP-HMAC quota shards. Transactions lock only the sorted shards involved in a request and update projection rows for that session; the eight-table design is preserved. Versioned migrations split the legacy singleton state and add cascade foreign keys. A live PostgreSQL parity/concurrency job is still required in deployment CI because the local test suite validates migration/query contracts without a database server.

Anonymous paid operations are protected by persistent session and HMAC-IP quotas. Set a dedicated high-entropy `AGENT_IP_HASH_SECRET` (at least 32 characters) in production; raw IP addresses are never stored. `AGENT_TRUSTED_IP_HEADER` must name a header overwritten by the deployment proxy (`x-vercel-forwarded-for` by default), rather than trusting caller-controlled forwarding data. Optional `AGENT_QUOTA_*` environment variables tune the safe defaults. Validation, ownership, revision and authorization failures do not consume provider quota; a provider request that has already started does.

## API surface

| Endpoint | Purpose |
| --- | --- |
| `POST /api/agent/runs` | Create a run and anonymous session if needed |
| `GET /api/agent/runs/[runId]` | Restore an owned run |
| `DELETE /api/agent/runs/[runId]` | Cancel an owned run with revision checking |
| `POST /api/agent/runs/[runId]/image` | Upload one image for transient analysis |
| `POST /api/agent/runs/[runId]/turns` | Submit one typed message or command |
| `GET /api/agent/memory` | List whitelisted preferences for this browser |
| `DELETE /api/agent/memory/[memoryId]` | Delete one preference immediately |
| `DELETE /api/agent/memory` | Delete all preferences immediately |
| `POST /api/agent/cleanup` | Run a bounded retention batch with a high-entropy `Bearer AGENT_CLEANUP_TOKEN`; repeat while `nextCursor` is present (server-side progress is authoritative) |

Every mutation uses `expectedRevision`; stale updates return `409`. Run IDs are also checked against the anonymous session, so another browser receives `404` rather than run details. Final saving requires candidate selection followed by a separate `confirm_final` command.

## Evaluation contract

Run the deterministic Agent acceptance suite with:

```bash
npm run eval:agent
```

The suite executes actual in-memory service/repository flows. Its report is explicitly an **offline fixture measurement**, not online production telemetry:

| Objective metric | Offline gate |
| --- | ---: |
| Invalid clarification for complete briefs | <= 10% |
| Correct single-field clarification for missing required fields | >= 90% |
| Illegal state/tool blocking | 100% |
| Candidate count accuracy (10/3/10) | 100% |
| Refresh recovery | 100% |
| Sensitive Agent dashboard event leakage | 0 |
| Long-term memory misuse | <= 5% |
| Immediate memory deletion | 100% |

State transitions, schemas, candidate counts, tool authorization, retry ceilings and sensitive-data guards are deterministic assertions. Hook quality and Top 3 explanation quality remain subjective: use blinded human pairwise comparison, swap A/B positions, and treat disagreement as a tie or human adjudication. Model scores explain ranking only and must not be presented as measured CTR or real click performance.

Stopping conditions are explicit: at most one format/count repair after the initial model call (two model calls total), two clarification questions, and three user-visible revision rounds. An optimization loop stops when its score does not improve; the application does not perform hidden unlimited rewriting.

The original 60-case evaluation corpus remains unchanged. Agent fixtures live separately in `eval/agent-fixtures.json`.

## Safety checks and rollout

Run the non-printing tracked-file credential scan with:

```bash
npm run security:scan
```

The scan reports only file, line and rule; it never prints matched values.

Recommended rollout:

1. Keep the flag off and run unit, Agent evaluation, lint, typecheck, build and credential scan.
2. Enable locally with JSON storage and exercise text/image, revision, recovery and memory deletion flows.
3. Repeat against a live PostgreSQL instance and verify migrations, shard concurrency, ownership/revision conflicts, quotas and scheduled 30-day cleanup.
4. Enable for a small production cohort, monitor aggregate events only, then expand gradually.
5. Disable the flag to return users to classic mode without migrating or deleting classic history/favorites.
