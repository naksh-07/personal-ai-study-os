# Personal AI Study OS — Production Implementation Specification v1.0

## 1. Executive Summary

This document provides the final, implementation-ready engineering blueprint for the Personal AI Study OS. It translates the domain contracts (v1.1) and the platform reality audit into a concrete technical design. The system runs on Cloudflare infrastructure (Workers, D1, Queues) and serves as the authoritative canonical event ledger, projection engine, and shared coordination boundary across AI agents (ChatGPT, Spark, Antigravity) and human interfaces (Notion, Google Tasks, Google Calendar).

## 2. Implementation Scope

**In Scope for V1:**
- Core D1 Database schema and migration system.
- Canonical Event Engine and Projection Engine.
- Cloudflare Worker providing REST API and Remote MCP server.
- Cloudflare Queues for asynchronous external synchronization.
- Provider adapters for Google Tasks, Google Calendar, and Notion.
- Secure Authentication/Authorization enforcing Audience scopes and Least Privilege.

**Out of Scope for V1:**
- Full text search over copyrighted source material in D1 (delegated to Antigravity/vector stores).
- Precise intra-day scheduling in Google Tasks (restricted to Google Calendar).
- Unattended ChatGPT background execution (must be mediated by an execution client).

## 3. Authoritative Contracts

This specification strictly adheres to:
1. **Personal AI Study OS — Technical Contracts & Data Specification v1.1**
2. **Personal AI Study OS — Integration Reality Audit v1.0**

Any discrepancies discovered during coding must be resolved against these two documents. No architectural facts have been altered.

## 4. Technology Decisions

| Area | Selected Technology | Purpose | Reason | Alternatives Rejected |
| ---- | ------------------- | ------- | ------ | --------------------- |
| Runtime | Cloudflare Workers | Serverless execution | Minimal latency, native D1/Queues binding | AWS Lambda (higher latency/cold start), Node VPS (maintenance) |
| Database | Cloudflare D1 | Canonical event/state storage | Native SQLite edge database, 10GB capacity | Postgres/Supabase (unnecessary network hop) |
| Async Sync | Cloudflare Queues | At-least-once message delivery | Native integration, reliable retry and DLQ | Kafka/RabbitMQ (overkill for personal OS) |
| API Layer | REST + Remote MCP | Client communication | REST for sync/webhooks, MCP for AI agents | GraphQL (unnecessary complexity) |
| Authentication | OAuth 2.1 Bearer | Secure access | Industry standard, required by MCP | Basic Auth, Custom tokens |
| Language | TypeScript | Type safety | Strict domain modeling | JavaScript, Python |
| Schema Validation | Zod | Runtime type checking | Guarantees event/payload integrity | Joi, JSON Schema |
| DB Access Layer | Kysely | Type-safe SQL query builder | Perfect fit for D1 `db.batch()`, no ORM overhead | Prisma (heavy CF Worker size), Drizzle |
| Testing | Vitest | Unit/Integration testing | Fast, ES modules support, CF environment testing | Jest (slower, CJS focus) |
| CI/CD | GitHub Actions | Automation | Native ecosystem, wrangler integration | GitLab CI, Jenkins |
| Deployment | Wrangler | CF Infrastructure as Code | Official CF toolchain | Terraform (too complex for V1 Workers) |

## 5. Repository Architecture

Using a monorepo structure (e.g., npm workspaces / Turborepo):

```text
/
├── apps/
│   └── worker/         # CF Worker entry points (REST, MCP, Queue Consumer, Webhooks)
├── packages/
│   ├── domain/         # Pure TS types, Zod schemas, Invariants, Entities
│   ├── db/             # Kysely schema, migrations, D1 repositories
│   ├── core/           # Canonical Event Engine, Projection Engine
│   └── adapters/       # Google Tasks, Google Calendar, Notion integration logic
├── tests/              # E2E acceptance tests, Contract tests
├── scripts/            # Deployment scripts, seed scripts
├── wrangler.toml       # Cloudflare infrastructure config
└── package.json
```

**Rules:**
- **domain**: No dependencies. Pure TypeScript.
- **adapters**: Cannot import from `apps/worker`. Must only depend on `domain`.
- **db**: Knows about D1. Translates DB rows to `domain` types.
- **worker**: Wires everything together. Handles HTTP requests, auth, and queue bindings.

## 6. Dependency Architecture

**Direction:**
`Transport (worker)` → `Application (core)` → `Domain`
`Infrastructure (db, adapters)` → `Domain`

**Forbidden Dependencies:**
- `domain` must not import `db` or `adapters`.
- `adapters` must not leak Google/Notion API types into `domain`.
- `core` must use interfaces for adapters, allowing mocked testing without network calls.

## 7. D1 Schema

**IMPLEMENTATION DECISION:** Timestamps will be stored as `TEXT` in ISO 8601 format to simplify SQLite serialization.

```sql
-- Core Entities
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE subjects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE chapters (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL REFERENCES subjects(id),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Event Ledger (Append-only)
CREATE TABLE canonical_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    source_system TEXT NOT NULL,
    source_interface TEXT NOT NULL,
    payload TEXT NOT NULL, -- JSON
    correlation_id TEXT,
    causation_id TEXT
);
CREATE INDEX idx_events_type_occurred ON canonical_events(event_type, occurred_at);

-- Derived Projections
CREATE TABLE study_progress (
    id TEXT PRIMARY KEY,
    subject_id TEXT REFERENCES subjects(id),
    chapter_id TEXT REFERENCES chapters(id),
    status TEXT NOT NULL,
    progress_value REAL NOT NULL,
    questions_attempted INTEGER NOT NULL DEFAULT 0,
    questions_correct INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE daily_states (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    state_payload TEXT NOT NULL, -- JSON
    updated_at TEXT NOT NULL
);

-- External Links
CREATE TABLE task_links (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE calendar_links (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Coordination State
CREATE TABLE idempotency_records (
    idempotency_key TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    status TEXT NOT NULL, -- PENDING, COMPLETED, FAILED
    result_payload TEXT, -- JSON
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE sync_jobs (
    job_id TEXT PRIMARY KEY,
    target_system TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Memory
CREATE TABLE memory_facts (
    id TEXT PRIMARY KEY,
    fact TEXT NOT NULL,
    valid_at TEXT NOT NULL,
    invalid_at TEXT,
    created_at TEXT NOT NULL
);
```

*(Note: Sources, SourceMappings, Projects, AgentRuns added similarly as required by V1.1)*

## 8. Migration Architecture

- **Tooling:** Wrangler migrations (`wrangler d1 migrations`).
- **Naming:** `XXXX_description.sql` (e.g., `0001_initial_schema.sql`).
- **Execution:** Automated via CI/CD to production.
- **Rollback:** **IMPLEMENTATION DECISION:** Because database rollback deletes data, we strictly use **forward-fix migrations**. Rollbacks of code are safe, but database schemas must remain backward-compatible (e.g., add column, never rename/drop immediately).

## 9. Domain Model

**Example TypeScript Interface:**
```typescript
interface CanonicalEvent<T> {
  eventId: string; // evt_...
  eventType: string;
  schemaVersion: number;
  occurredAt: string; // ISO8601
  recordedAt: string;
  actor: { type: 'user' | 'agent'; id: string };
  source: { system: string; interface: string };
  payload: T;
  correlationId?: string;
  causationId?: string;
}

interface StudyProgress {
  id: string;
  subjectId: string;
  chapterId: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  progressValue: number;
  questionsAttempted: number;
  questionsCorrect: number;
  updatedAt: string;
}
```

## 10. Event Engine

**Pipeline:**
1. **Input:** Command/Intent received.
2. **Validation:** Zod schema validation.
3. **Entity Resolution:** Map external IDs/names to internal canonical IDs.
4. **Authorization:** Verify actor scopes.
5. **Idempotency:** Check if event is duplicate.
6. **Creation:** Construct `CanonicalEvent`.
7. **Persistence:** `db.batch([insertEvent, updateProjection, insertSyncJob])`.
8. **Side-effect:** Enqueue Cloudflare Queue message `sync_job`.

## 11. Projection Engine

- **Registry:** Maps `event_type` to handler functions.
- **Mechanism:** Handlers receive the event and return the Kysely SQL query for updating the projection tables (e.g., `study_progress`).
- **Atomicity:** The generated projection queries are executed in the exact same `db.batch()` as the event insertion.
- **Rebuild:** A background script can truncate projection tables and stream all canonical events through the projection engine to rebuild state deterministically.

## 12. REST API Specification

**Base URL:** `https://api.personal-os.com/v1/`

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/state/today` | Retrieves daily state projection. |
| GET | `/study/progress` | Retrieves study progress. |
| POST | `/events` | Ingests canonical events (Atomic). |
| POST | `/webhooks/notion` | Receives Notion webhook events. |

**Error Contract:**
- `400 Bad Request` -> `VALIDATION_ERROR`
- `401 Unauthorized` -> `AUTH_MISSING`
- `403 Forbidden` -> `INSUFFICIENT_SCOPE`
- `409 Conflict` -> `IDEMPOTENCY_CONFLICT`
- `429 Too Many Requests` -> `RATE_LIMITED`
- `500 Internal Server Error` -> `SYSTEM_ERROR`

## 13. Authentication

- **Token Type:** OAuth 2.1 Bearer Tokens (JWT).
- **Validation:** 
  - Verify signature (JWKS).
  - Verify `exp` (not expired).
  - **CRITICAL:** Verify `aud` (Audience). The token must explicitly list the Personal State Service URL or canonical ID as the audience. Generic MCP tokens are rejected.

## 14. Authorization Matrix

| Operation | ChatGPT | Spark | Antigravity | User | System |
| --------- | ------: | ----: | ----------: | ---: | -----: |
| Read State | read | read | read | admin | admin |
| Generate Intent | N/A | N/A | N/A | N/A | N/A |
| Record Event | none | write | write | admin | write |
| Mod Calendar | none | external | none | admin | external |
| Destructive | none | none | none | admin | admin |

## 15. MCP Server Specification

- **Transport:** HTTP / SSE (Remote MCP).
- **Endpoint:** `https://api.personal-os.com/mcp`
- **Authentication:** Bearer token evaluated per request.
- **Tools (Subset):**
  - `get_today_state` (Input: `{}`, Scope: `read`)
  - `record_study_session` (Input: `{ chapter_id, duration_seconds }`, Scope: `write`)
  - `update_progress` (Input: `{ chapter_id, status, ... }`, Scope: `write`)
- **No SQL:** Absolutely no raw SQL queries are accepted.

## 16. Queue Architecture

**Cloudflare Queues** provide async delivery.
**Message Schema:**
```json
{
  "job_id": "sync_01J...",
  "target": "notion",
  "entity_type": "study_progress",
  "entity_id": "prog_01J..."
}
```
**Settings:**
- Max Retries: 5 (with exponential backoff).
- Dead-Letter Queue (DLQ): Configured for messages failing 5 times.
- Delivery: At-least-once.

## 17. Google Tasks Adapter

- **Scopes:** `https://www.googleapis.com/auth/tasks`
- **Responsibilities:** Create, Read, Update, Complete.
- **Constraints:** Maps date-only information. **Time-of-day is ignored.**
- **Integration:** Polling using `updatedMin` via a CF Worker Cron Trigger (e.g., every 5 mins). Updates update D1 canonical events if external changes occurred.

## 18. Google Calendar Adapter

- **Scopes:** `https://www.googleapis.com/auth/calendar.events`
- **Concurrency:** 
  1. Read event (capture `etag`).
  2. Modify locally.
  3. Send PATCH with `If-Match: etag`.
  4. If `412 Precondition Failed`, refetch and reconcile.

## 19. Notion Adapter

- **Sync Model:** Event-driven via Webhooks.
- **Rate Limit:** 3 req/sec enforced inside Queue Consumer. Batch requests where possible.
- **Mapping:** Translates `daily_state` and `study_progress` projections into Notion blocks/database properties.

## 20. Spark Integration

Spark acts as a scheduling client, not the database.
**Workflow:**
1. Spark calls MCP `get_today_state`, `get_pending_work`.
2. Spark calculates changes.
3. Spark calls `update_calendar` (which safely uses `If-Match`).
4. If changes are massive, the CF Worker enforces a limit (e.g., max 5 event modifications per run) and rejects the rest, returning a safety warning.

## 21. Antigravity Integration

Antigravity executes technical workflows (source ingestion, coding).
It uses the MCP tools to log `project_updated` and `source_mapped` events into D1. It never accesses D1 directly.

## 22. ChatGPT Integration

ChatGPT operates only in active user sessions. It emits intents via function calling. The UI/execution client translates these intents into REST/MCP calls to the Personal State Service.

## 23. Source Ingestion

Antigravity extracts TOC from a PDF, maps it, and sends `source_registered` and `source_mapped` canonical events via MCP. D1 stores the hierarchy (Source -> Chapters).

## 24. Memory Architecture

`memory_facts` support explicit temporal operations.
- **ADD:** Inserts fact with `valid_at = now()`.
- **UPDATE:** Sets `invalid_at = now()` on old fact, inserts new fact.
- **INVALIDATE:** Sets `invalid_at = now()`.

## 25. Observability

- **Logs:** Cloudflare Logpush to R2 / Datadog.
- **Traceability:** Every log includes `request_id`, `event_id` (if applicable), and `job_id`.
- **Secret Redaction:** PII and Secrets are scrubbed before logging.

## 26. Rate Limiting

- **Personal API:** CF Rate Limiting rules (e.g., 100 req/min per client).
- **Notion API:** Enforced by Queue consumer concurrency limits + internal sleep/backoff.

## 27. Testing

- **Unit:** Test projection handlers, Zod schemas, idempotency state machine.
- **Integration:** D1 local testing via Miniflare (`env.DB`). Queue consumer testing.
- **Contract:** Validate MCP schemas against Zod models.
- **Failure:** Inject `412` errors in Calendar mock to test `If-Match` retry loop.

## 28. Acceptance Tests

E2E tests using Vitest interacting with a locally spun-up Worker via Wrangler:
- **Study Completion Flow:** Send `POST /events` -> verify `canonical_events` -> verify `study_progress` projection -> verify `sync_job` enqueued.
- **Duplicate Delivery:** Send the same `sync_job` directly to the consumer twice. Verify mock Notion API is only called once.

## 29. CI/CD

**GitHub Actions:**
1. Lint (`eslint`) & Typecheck (`tsc`).
2. Run Unit/Integration Tests.
3. Run `wrangler d1 migrations apply --local` to verify schema.
4. On `main` merge: Deploy to staging.
5. On Tag: Deploy to production.

## 30. Environments

- **Local:** Miniflare (Wrangler). Local SQLite file.
- **Staging:** CF D1 preview database. Sandbox Notion/Google integration.
- **Production:** Production D1. Real integrations.

## 31. Deployment

- **Tool:** Wrangler
- **Command:** `wrangler deploy`
- **Secrets:** Injected via Cloudflare Dashboard / `wrangler secret put`.

## 32. Rollback & Recovery

- **Application Rollback:** `wrangler rollback`. Safe.
- **Database Rollback:** Prohibited. Write forward-fix migrations.
- **Queue Backlog:** Purge DLQ, or run a script to requeue DLQ messages after fixing the bug.
- **Corrupted Projection:** Call `/admin/rebuild-projections` to truncate and replay events.

## 33. Security Review

- **Least Privilege:** Validated. Tokens have explicit scopes.
- **Audience Validation:** Validated. Prevents token reuse.
- **Secrets:** Stored in CF Secrets, never in Git or D1.
- **SQL Injection:** Mitigated via Kysely parameterized queries.

## 34. Performance Targets

- **API Latency:** < 100ms for event ingestion (DB local to CF edge).
- **Queue Processing:** < 2s per message.
- **Notion Sync:** Within 5 seconds of canonical event (subject to API limits).

## 35. Operational Runbooks

**Runbook: Notion 429 Storm**
- **Detect:** High rate of `Notion 429` in logs. DLQ fills up.
- **Diagnose:** Consumer concurrency too high or batch logic failing.
- **Contain:** Pause Queue consumption (`wrangler queues pause`).
- **Recover:** Fix concurrency limits, unpause queue, let retries clear.

## 36. Implementation Sequence

1. **Phase 0:** Repository init, Zod, Vitest setup.
2. **Phase 1:** Kysely D1 schema + migrations.
3. **Phase 2:** Domain types + Zod validation.
4. **Phase 3:** Canonical Event Engine (`db.batch()`).
5. **Phase 4:** Projection Engine.
6. **Phase 5:** Cloudflare Worker REST API + Auth/Audience validation.
7. **Phase 6:** MCP Server endpoint.
8. **Phase 7:** Queue Consumer + Idempotency logic.
9. **Phase 8:** Google Calendar adapter (Etag).
10. **Phase 9:** Google Tasks adapter (Polling).
11. **Phase 10:** Notion adapter.
12. **Phase 11:** Observability & Testing.

## 37. Definition of Done

- [ ] All migrations apply cleanly.
- [ ] Zod schemas match API contracts.
- [ ] Event ingestion is atomic using `db.batch()`.
- [ ] Queue idempotency test passes.
- [ ] MCP token `aud` rejection test passes.
- [ ] Google Calendar `412` reconciliation test passes.

## 38. Risk Register

| Risk | Probability | Impact | Mitigation | Owner |
| ---- | ----------- | ------ | ---------- | ----- |
| Duplicate queue msg causes duplicate Calendar event | Low | High | Strict `IdempotencyRecord` check in consumer before API call. | Arch |
| Calendar Etag race condition | Medium | Low | Catch `412`, refetch, reconcile, retry. | Eng |
| D1 query limit exceeded (30s) | Low | High | Ensure projections update via targeted SQL, not massive reads. | Eng |

## 39. ADR Register

- **ADR-001:** Cloudflare D1 for Canonical State (`db.batch()`).
- **ADR-002:** At-Least-Once Idempotency via CF Queues.
- **ADR-003:** Optimistic Concurrency for Calendar.
- **ADR-004:** Webhooks over Polling for Notion.
- **ADR-005:** Forward-Fix Database Migrations.

## 40. Final Build Readiness Gate

```text
CONTRACTS
[x] Technical Contracts v1.1 consumed
[x] No contract contradiction remains

DATABASE
[x] Exact schema defined
[x] Migrations defined
[x] Indexes defined
[x] Constraints defined

BACKEND
[x] Worker architecture defined
[x] REST API defined
[x] Event engine defined
[x] Projection engine defined

MCP
[x] Tool schemas defined
[x] Authentication defined
[x] Authorization defined

SYNC
[x] Queue architecture defined
[x] Idempotency defined
[x] Retry defined
[x] DLQ defined

INTEGRATIONS
[x] Tasks adapter defined
[x] Calendar adapter defined
[x] Notion adapter defined
[x] Spark boundary defined
[x] Antigravity boundary defined
[x] ChatGPT boundary defined

SECURITY
[x] OAuth defined
[x] Audience validation defined
[x] Least privilege defined
[x] Secrets strategy defined

OPERATIONS
[x] Observability defined
[x] CI/CD defined
[x] Deployment defined
[x] Rollback defined
[x] Recovery defined

TESTING
[x] Unit tests defined
[x] Integration tests defined
[x] Contract tests defined
[x] Failure tests defined
[x] Recovery tests defined
[x] E2E acceptance tests defined
```

**BUILD READINESS**

**GREEN**
Ready to begin implementation.
