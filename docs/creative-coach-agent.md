# Creative Coach Agent

Creative Coach is an optional, single-Agent workflow layered on top of the existing Hook generator. The classic one-request/10-Hook mode remains available and keeps its original API and UI behavior.

## Enablement and storage

- Set `NEXT_PUBLIC_AGENT_COACH_ENABLED=true` to expose the coach UI and Agent APIs. It defaults to `false` for gradual rollout.
- Anonymous ownership uses the HttpOnly `ai-hook-creator-session` cookie. The cookie is `SameSite=Lax`, `Secure` in production, and expires after 180 days; storage contains only its SHA-256 digest.
- Local development uses `data/agent-store.json` (or `AGENT_STORE_PATH`) when `DATABASE_URL` is empty. Production fails closed unless PostgreSQL is configured.
- Terminal runs, including their messages and final candidates, are removed after 30 days by lazy cleanup. Creator preference memory is separate and can be deleted immediately from the UI/API.
- Original images are never persisted. Tool audit records contain only safe metadata such as MIME type and byte count.

Image analysis requires both `ARK_API_KEY` and `ARK_MODEL_ID`. `ARK_MODEL_ID` is the Ark model or endpoint ID enabled for the account. Keep real credentials only in ignored `.env.local`; never commit them.

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

Stopping conditions are explicit: at most two format/count retries, two clarification questions, and three user-visible revision rounds. An optimization loop stops when its score does not improve; the application does not perform hidden unlimited rewriting.

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
3. Repeat against PostgreSQL and verify ownership/revision conflicts and 30-day cleanup.
4. Enable for a small production cohort, monitor aggregate events only, then expand gradually.
5. Disable the flag to return users to classic mode without migrating or deleting classic history/favorites.
