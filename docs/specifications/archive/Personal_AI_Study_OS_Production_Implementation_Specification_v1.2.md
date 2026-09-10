# Personal AI Study OS — Production Implementation Specification v1.2

## Document Version History

| Version | Date | Status | Key Changes |
| :--- | :--- | :--- | :--- |
| **v1.0** | September 2026 | Superseded | Initial production implementation specification draft. |
| **v1.1** | September 2026 | Superseded | **Build Readiness Reconciliation (Gate 3):**<br>• Initial 23-table schema enumeration and Kysely database mapping.<br>• Decoupled `idempotency_records` from mandatory queue `job_id`, establishing 5-case deduplication.<br>• Added `sync_jobs` queue persistence model with exponential backoff and DLQ recovery.<br>• Aligned `study_progress` projection model with mathematical bounds ($0 \le questions\_correct \le questions\_attempted$, $accuracy \in [0.0, 1.0]$).<br>• Added user timezone semantics and recursive chapter hierarchy.<br>• Mandated OAuth 2.1 Bearer JWT validation with explicit `aud` (Audience) verification.<br>• Formalized metadata-only source ingestion prohibiting copyrighted book content in D1.<br>• Codified 23 initial acceptance test suites. |
| **v1.2** | September 2026 | **FINAL BUILD GATE RECONCILED** | **Final Build Gate Corrections & Authoritative Hardening:**<br>• **Queue Message Identity vs. Idempotency Identity:** Established normative distinction between `job_id` (queue delivery identity) and `idempotency_key` (canonical mutation identity); defined strict typed queue envelope; mandated that consumer redelivery MUST use `idempotency_key` for deduplication.<br>• **Transactional Outbox Reliability Contract:** Resolved D1-to-Queue failure window via durable outbox dispatcher on `sync_jobs` (`status`: `PENDING`, `DISPATCHED`, `PROCESSING`, `COMPLETED`, `FAILED`, `DEAD_LETTER`; `dispatched_at`), closing the worker crash window without introducing external message brokers.<br>• **Provider-Specific External Mutation Idempotency:** Replaced generic ETag statements with verified provider contracts: Google Calendar deterministic base32hex event IDs + ETag/If-Match; Google Tasks deterministic metadata tagging in notes + provider state reconciliation; Notion deterministic entity property lookup + latest-state reconciliation.<br>• **Modernized Remote MCP Transport:** Upgraded MCP protocol from legacy 2024-11-05 SSE to **MCP 2026-07-28 Streamable HTTP** (`POST /mcp` streaming JSON-RPC 2.0) as the primary remote transport, retaining HTTP+SSE strictly as an optional backwards compatibility fallback.<br>• **Authoritative Table Count (24 Tables):** Reconciled D1 schema count to exactly 24 tables across 8 domains (including both `schedule_links` and `idempotency_records`), verifying all foreign keys, indexes, and domain mappings.<br>• **Explicit Single-Tenant V1 Deployment Boundary:** Codified non-negotiable architectural invariant establishing V1 as a single-user, single-tenant deployment anchored by `users`, eliminating premature multi-tenant SaaS schema complexity.<br>• **Multi-Stage CI/CD Production Release Gate:** Replaced automatic deployment on merge to `main` with a strict multi-stage lifecycle: PR → Automated Validation → Merge to `main` → Staging Deployment → Staging Verification → Explicit Release Tag → Production Deployment.<br>• **Strengthened Notion Webhook Pipeline:** Codified 6-stage inbound webhook lifecycle: HMAC signature verification → deduplication against `idempotency_records` → authoritative latest-state refetch → domain reconciliation → canonical event emission → atomic D1 update, with secondary bounded reconciliation polling.<br>• **Expanded Acceptance Test Suites (30 Suites):** Added explicit automated acceptance suites covering queue identity decoupling, outbox recovery, provider-specific lost-ack recovery, Streamable HTTP transport, and staging release gates.<br>• **Contract Authority Confirmation:** Confirmed that **Technical Contracts v1.1 remains authoritative and unchanged.** |

---

## 1. Executive Summary & System Mandate

The **Personal AI Study OS** is a lightweight, edge-native coordination layer that integrates AI agents (**ChatGPT**, **Gemini Spark**, **Antigravity**) with personal productivity platforms (**Google Tasks**, **Google Calendar**, **Notion**) and a shared canonical data store (**Cloudflare D1**).

The system operates on Cloudflare serverless infrastructure (**Cloudflare Workers**, **Cloudflare D1**, **Cloudflare Queues**). It functions as the authoritative machine-readable event ledger, deterministic projection engine, and shared coordination boundary.

The architecture enforces seven fundamental responsibilities:
- **Google Tasks** manages task existence, completion, and date-level task tracking (**WHAT**).
- **Google Calendar** manages time allocation, schedule blocks, and intra-day duration (**WHEN**).
- **Gemini Spark** manages scheduling analysis, trade-off reasoning, and calendar allocation (**SCHEDULING**).
- **Notion** maintains human-readable memory, curated notes, and rich knowledge synthesis (**HUMAN KNOWLEDGE**).
- **Cloudflare D1** maintains machine-readable canonical state, event history, and cross-system linkage (**MACHINE TRUTH**).
- **ChatGPT** provides conversational reasoning, study interaction, and intent generation (**REASONING / THINKING**).
- **Antigravity** executes technical implementation, builds, and source ingestion workflows (**TECHNICAL EXECUTION**).

Custom infrastructure exists solely to facilitate safe, auditable coordination across these components without direct agent-to-agent coupling.

---

## 2. Implementation Scope & Operational Boundaries

### 2.1 In Scope for Version 1
- **Single-Tenant Deployment:** V1 is explicitly designed, deployed, and scoped as a single-user, single-tenant Personal AI Study OS. Multi-tenant SaaS isolation is strictly out of scope for V1.
- **Cloudflare D1 Storage:** Complete 24-table relational schema managing core identity, canonical event ledgers, derived projections, source structures, external links, memory, and sync coordination.
- **Canonical Event Engine:** Append-only event ingestion pipeline operating through Cloudflare D1 `db.batch()` implicit atomic batches.
- **Transactional Outbox Engine:** Durable outbox dispatching on `sync_jobs` with automatic background reconciliation sweeps via Cloudflare Cron Triggers to guarantee zero lost jobs upon worker crashes or queue enqueue failures.
- **Projection Engine:** Deterministic state projection handlers for `study_progress`, `daily_states`, and temporal memory, with full recomputation capabilities from canonical events.
- **Unified Cloudflare Worker:** Dual-interface service delivering a versioned REST API (`/v1/`) and a Remote Model Context Protocol (MCP) server conforming to **MCP 2026-07-28 Streamable HTTP**.
- **Asynchronous Sync Pipeline:** Cloudflare Queues (`SYNC_QUEUE` and `personal-sync-dlq`) with typed message envelopes and consumer-side mutation deduplication.
- **Provider Adapters:**
  - *Google Tasks Adapter:* Date-only synchronization with cron-based `updatedMin` polling and deterministic note metadata tagging.
  - *Google Calendar Adapter:* Precise time-block synchronization with deterministic `base32hex` event IDs for create idempotency and `ETag` + `If-Match` optimistic concurrency control for updates.
  - *Notion Adapter:* Webhook intake (`POST /v1/webhooks/notion`) with HMAC signature verification, deduplication, authoritative latest-state refetching, and rate-limited queue mutation throttled to 3 requests per second.
- **Security & Authorization:** Strict OAuth 2.1 Bearer authentication, JWKS signature verification, and mandatory `aud` (Audience) validation.
- **Multi-Stage CI/CD:** Staging deployment and synthetic verification before explicit production promotion.

### 2.2 Explicitly Out of Scope for Version 1
- **Multi-User SaaS Isolation:** V1 does not implement multi-tenant tenant-ID column scoping, tenant isolation barriers, or organization hierarchy. The `users` table provides identity and timezone context for a single personal operator.
- **Copyrighted Book Storage:** Full text, parsed paragraphs, or PDF binary streams are strictly forbidden from being stored in D1. Only structural metadata, table of contents (TOC), and syllabus mappings are persisted.
- **Intra-Day Scheduling in Tasks:** Google Tasks must never be used for hour-level or minute-level scheduling; intra-day time allocation belongs strictly to Google Calendar.
- **Unattended ChatGPT Execution:** ChatGPT operates exclusively in active user sessions; background mutations and unattended workflows are delegated to Antigravity or dedicated workers.
- **Direct Agent-to-Agent IPC:** Agents never call each other directly; all coordination is mediated via the Personal State Service.

---

## 3. Authoritative Contracts & Precedence Hierarchy

The implementation of the Personal AI Study OS must strictly conform to authoritative project contracts. In the event of conflicting requirements or ambiguous interpretations, resolution must adhere to the following strict order of precedence:

1. **Personal AI Study OS — Technical Contracts & Data Specification v1.1** (Primary contract governing domains, events, invariants, and ownership boundaries). **Technical Contracts v1.1 remains authoritative and unchanged.**
2. **Personal AI Study OS — Integration Reality Audit v1.0** (Authoritative findings governing Cloudflare, Google, Notion, and MCP platform capabilities as of September 2026).
3. **Personal AI Study OS — Production Implementation Specification v1.2** (This document — authoritative for database schemas, algorithms, and engineering implementation).
4. **Foundational Architecture Documents:** `PERSONAL AI STUDY OS.md` (baseline) and `engineering blueprint.md`.

*Contract Integrity Rule:* No software engineer, agent, or provider adapter may unilaterally modify architectural invariants, entity ownership, or database schemas without an approved Architectural Decision Record (ADR) and formal contract revision.

---

## 4. Technology Decisions & Platform Constraints

| Subsystem | Selected Technology | Purpose | Architectural Rationale & Constraints | Rejected Alternatives |
| :--- | :--- | :--- | :--- | :--- |
| **Compute Runtime** | **Cloudflare Workers** | Edge serverless execution | Native low-latency bindings to D1 and Queues. Max CPU time is 30s for HTTP requests (network I/O excluded) and 15m for queue consumers. | AWS Lambda (cold starts), Dedicated VPS (maintenance overhead). |
| **Database Engine** | **Cloudflare D1** | Canonical storage & derived state | Native SQLite at the edge. 10 GB capacity on paid plan. Max query duration 30s. Point-in-time recovery (Time Travel) up to 30 days. | Supabase / RDS Postgres (unnecessary network hops and connection pooling limits). |
| **Async Messaging** | **Cloudflare Queues** | Event-driven background synchronization | Native integration with Workers. Delivers **at-least-once**. Maximum payload size is 128 KB. Supported retry backoff and DLQ routing. | RabbitMQ, Redis BullMQ, Kafka (excessive operational complexity for personal scale). |
| **API Protocol** | **REST (Hono / Web Standards)** | Client & webhook communication | Semantic REST endpoints for webhooks, health checks, state queries, and admin operations. | GraphQL (unnecessary abstraction), gRPC (unsupported in web/MCP clients). |
| **AI Protocol** | **Remote MCP 2026-07-28** | Agent-to-state communication | **Streamable HTTP** as primary transport (`POST /mcp` streaming JSON-RPC 2.0). Semantic tool surface. Legacy HTTP+SSE retained only as secondary compatibility fallback. | Legacy HTTP+SSE as primary (obsolete connection model), WebSockets (unnecessary connection state overhead). |
| **Authentication** | **OAuth 2.1 Bearer (JWT)** | Request authentication | RFC 6750 standard. Validated via JWKS with mandatory `aud` enforcement. | Basic Authentication (insecure, prohibited), Static API keys (no client scoping). |
| **Language & Types** | **TypeScript 5.x** | Implementation language | Strict typing across domain models, database queries, and event envelopes. | Plain JavaScript, Python (lacks compile-time guarantee in CF worker runtime). |
| **Runtime Validation**| **Zod 3.x / 4.x** | Schema & envelope validation | Runtime validation guaranteeing that invalid events or payloads are rejected before database entry. | Joi, JSON Schema validator (less ergonomic TS inference). |
| **Database Access** | **Kysely** | Type-safe SQL query builder | Zero-runtime overhead query construction. Seamless compilation to parameterized SQL compatible with D1 `db.batch()`. | Prisma (heavy binary/bundle size for Workers), Drizzle (less mature batch transaction typing in v1). |
| **Test Framework** | **Vitest** | Unit, contract & integration tests | Fast, native ESM support, direct compatibility with Miniflare and Cloudflare Worker testing pools. | Jest (CommonJS baggage, slow ESM mocking). |
| **Infrastructure** | **Wrangler CLI** | Infrastructure-as-code & deployments | Cloudflare's official toolchain for Workers, D1 migrations, and Queues management. | Terraform (overkill for simple worker bindings). |

---

## 5. Repository Architecture & Monorepo Boundaries

The codebase is organized as a clean TypeScript monorepo using npm workspaces:

```text
personal-ai-study-os/
├── apps/
│   └── worker/                     # Cloudflare Worker deployment target
│       ├── src/
│       │   ├── index.ts            # Entrypoint routing REST, Streamable HTTP MCP, and Queues
│       │   ├── routes/             # REST endpoints (/v1/state, /v1/events, /v1/webhooks)
│       │   ├── mcp/                # Remote MCP Server (Streamable HTTP primary, SSE fallback)
│       │   ├── queue/              # Cloudflare Queue consumer, outbox dispatcher, DLQ router
│       │   └── middleware/         # OAuth 2.1 JWT validation, Audience check, Error formatting
│       ├── migrations/             # Numbered SQL migrations applied via wrangler d1 migrations
│       │   ├── 0001_initial_schema.sql
│       │   └── 0002_reconciled_v1_2_schema.sql
│       ├── wrangler.toml           # Worker bindings: DB (D1), SYNC_QUEUE, DLQ, Cron triggers
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   ├── domain/                     # Pure TypeScript domain models, Zod schemas, event envelopes
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── entities.ts         # User, Subject, Chapter, StudyProgress, QueueEnvelope, SyncJob
│   │   │   ├── events.ts           # 30+ Canonical Event schemas and discriminated unions
│   │   │   └── errors.ts           # Standard machine-readable error codes
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── db/                         # Kysely database layer, table interfaces, and D1 repositories
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── tables.ts           # Kysely Database interface mapping all 24 tables
│   │   │   └── client.ts           # D1 Kysely dialect and batch executor
│   │   │   └── repositories/       # Query helpers for events, projections, outbox, idempotency
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── core/                       # Canonical Event Engine, Projection Engine, Outbox Dispatcher
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── event-engine.ts     # Atomic validation, resolution, and batch construction
│   │   │   ├── projection-engine.ts# Handlers updating study_progress, daily_states
│   │   │   ├── outbox-dispatcher.ts# Durable dispatcher querying undispatched sync jobs
│   │   │   └── idempotency.ts      # Multi-step deduplication and SHA-256 request hashing
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── adapters/                   # External provider integrations (Google Tasks, Calendar, Notion)
│       ├── src/
│       │   ├── index.ts
│       │   ├── google-tasks.ts     # Polling adapter, updatedMin parser, note metadata tagging
│       │   ├── google-calendar.ts  # Deterministic event IDs, ETag extraction, If-Match retry loop
│       │   └── notion.ts           # Webhook receiver, HMAC verification, object refetch, throttler
│       ├── tsconfig.json
│       └── package.json
├── tests/                          # Automated test suites
│   ├── unit/                       # Pure logic: Zod schemas, hash calculation, projection math
│   ├── contract/                   # Event schemas, REST contracts, MCP schemas, migration tests
│   ├── integration/                # Miniflare D1 batch tests, Queue consumer idempotency tests
│   └── e2e/                        # Vitest E2E workflows matching 30 acceptance scenarios
├── package.json                    # Workspace root scripts: build, test, lint, typecheck
└── tsconfig.base.json              # Shared TypeScript compiler options (ES2022, Strict)
```

---

## 6. Dependency Architecture & Direction Rules

### 6.1 Architectural Layers & Data Flow
The dependency structure adheres strictly to Clean Architecture:

```text
               ┌────────────────────────┐
               │      apps/worker       │  (Entrypoint, HTTP, Streamable MCP, Queue)
               └───────────┬────────────┘
                           │ depends on
               ┌───────────▼────────────┐
               │    packages/adapters   │  (Google Tasks, Google Calendar, Notion)
               └───────────┬────────────┘
                           │ depends on
               ┌───────────▼────────────┐
               │     packages/core      │  (Event Engine, Projections, Outbox Dispatcher)
               └───────────┬────────────┘
                           │ depends on
               ┌───────────▼────────────┐
               │      packages/db       │  (Kysely Schema, Repositories, D1 Batch)
               └───────────┬────────────┘
                           │ depends on
               ┌───────────▼────────────┐
               │    packages/domain     │  (Pure Types, Zod Schemas, Error Enums)
               └────────────────────────┘
```

### 6.2 Forbidden Couplings & Dependency Enforcement
- `packages/domain` has **zero external runtime dependencies** beyond Zod. It must never import from `db`, `core`, `adapters`, or Cloudflare Worker APIs.
- `packages/db` depends strictly on `packages/domain`. It contains zero external API clients or HTTP logic.
- `packages/core` depends on `packages/domain` and `packages/db`. It does not make direct external HTTP calls to Google or Notion; all external side-effects are scheduled as `sync_jobs`.
- `packages/adapters` depends on `packages/domain` and implements isolated provider interfaces. It never executes direct D1 queries.
- `apps/worker` wires dependencies together.

---

## 7. Complete Cloudflare D1 Database Schema (24 Tables)

The Cloudflare D1 SQLite database contains exactly **24 authoritative tables** organized into 8 distinct functional domains.

### 7.1 Single-Tenant V1 Deployment Boundary
**Architectural Invariant:** V1 is explicitly a single-user, single-tenant Personal AI Study OS deployment.
- The `users` table acts as the canonical anchor for operator identity, default timezone, and system status.
- Global domain tables (`subjects`, `chapters`, `canonical_events`, `study_progress`, `daily_states`) are keyed globally and do not contain redundant `user_id` foreign keys.
- Multi-user data isolation is explicitly not a V1 requirement. Any future transition to multi-tenancy will require a formal contract revision and schema migration.

### 7.2 SQLite Runtime Conventions
- **Timestamps:** Persisted as `TEXT` containing ISO 8601 UTC strings formatted as `YYYY-MM-DDTHH:MM:SS.SSSZ`.
- **Booleans:** Persisted as `INTEGER` (`0` for false, `1` for true).
- **JSON Payloads:** Persisted as `TEXT` containing validated JSON strings.
- **Foreign Key Constraints:** All foreign keys explicitly specify `ON DELETE RESTRICT` (preventing orphan creation) or `ON DELETE CASCADE` (for child records such as `project_events`, `source_chapters`, `schedule_links`).
- **Atomic Batches:** All coordinated multi-table writes execute within `db.batch()` implicit atomic batches. Interactive `BEGIN`, `COMMIT`, or `ROLLBACK` SQL statements are strictly forbidden.

---

```sql
-- ============================================================================
-- 1. IDENTITY & CORE DOMAIN (3 Tables)
-- ============================================================================

CREATE TABLE users (
    id TEXT PRIMARY KEY,                           -- usr_01J... Single-tenant anchor
    timezone TEXT NOT NULL DEFAULT 'UTC',          -- IANA timezone identifier, e.g. 'Asia/Kolkata'
    status TEXT NOT NULL DEFAULT 'active',         -- 'active', 'suspended', 'deactivated'
    created_at TEXT NOT NULL,                      -- ISO 8601 UTC
    updated_at TEXT NOT NULL                       -- ISO 8601 UTC
);

CREATE TABLE subjects (
    id TEXT PRIMARY KEY,                           -- subj_01J...
    name TEXT NOT NULL,                            -- Display name, e.g. 'Physics'
    slug TEXT NOT NULL UNIQUE,                     -- Query-safe unique slug, e.g. 'physics'
    description TEXT,                              -- Syllabus description
    status TEXT NOT NULL DEFAULT 'active',         -- 'active', 'archived'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE chapters (
    id TEXT PRIMARY KEY,                           -- chap_01J...
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,                            -- Display name, e.g. 'Current Electricity'
    slug TEXT NOT NULL,                            -- Query-safe slug, e.g. 'current-electricity'
    parent_id TEXT REFERENCES chapters(id) ON DELETE RESTRICT, -- Supports Subject -> Unit -> Chapter -> Topic
    status TEXT NOT NULL DEFAULT 'not_started',    -- 'not_started', 'in_progress', 'completed'
    progress REAL NOT NULL DEFAULT 0.0,            -- 0.0 to 1.0
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(subject_id, slug)
);
CREATE INDEX idx_chapters_subject ON chapters(subject_id);
CREATE INDEX idx_chapters_parent ON chapters(parent_id);

-- ============================================================================
-- 2. STUDY DOMAIN (4 Tables)
-- ============================================================================

CREATE TABLE canonical_events (
    event_id TEXT PRIMARY KEY,                     -- evt_01J...
    event_type TEXT NOT NULL,                      -- e.g. 'study_completed', 'questions_attempted'
    schema_version INTEGER NOT NULL DEFAULT 1,     -- Version of event payload schema
    occurred_at TEXT NOT NULL,                     -- ISO 8601 UTC when activity occurred
    recorded_at TEXT NOT NULL,                     -- ISO 8601 UTC when event was ingested
    actor_type TEXT NOT NULL,                      -- 'user', 'agent', 'system'
    actor_id TEXT NOT NULL,                        -- usr_..., agent_..., or system identifier
    source_system TEXT NOT NULL,                   -- 'chatgpt', 'spark', 'antigravity', 'notion'
    source_interface TEXT NOT NULL,                -- 'natural_language', 'mcp', 'rest', 'webhook'
    payload TEXT NOT NULL,                         -- Validated JSON payload
    correlation_id TEXT,                           -- Request correlation ID for tracing
    causation_id TEXT                              -- Prior event or command ID that triggered this event
);
CREATE INDEX idx_events_type_occurred ON canonical_events(event_type, occurred_at);
CREATE INDEX idx_events_occurred_at ON canonical_events(occurred_at);
CREATE INDEX idx_events_correlation ON canonical_events(correlation_id);

CREATE TABLE study_sessions (
    id TEXT PRIMARY KEY,                           -- sess_01J...
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
    started_at TEXT NOT NULL,                      -- ISO 8601 UTC
    ended_at TEXT NOT NULL,                        -- ISO 8601 UTC, constraint: ended_at >= started_at
    duration_seconds INTEGER NOT NULL,             -- Non-negative duration
    activity_type TEXT NOT NULL,                   -- 'revision', 'pyq_practice', 'lecture', 'deep_work'
    source TEXT NOT NULL,                          -- Origin of session data, e.g. 'google_calendar'
    status TEXT NOT NULL DEFAULT 'completed',      -- 'completed', 'interrupted'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_study_sessions_chapter ON study_sessions(chapter_id, started_at);

CREATE TABLE study_progress (
    id TEXT PRIMARY KEY,                           -- prog_01J...
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'NOT_STARTED',    -- 'NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'
    progress_percent REAL NOT NULL DEFAULT 0.0,    -- 0.0 to 1.0 (alias of progress_value)
    confidence REAL NOT NULL DEFAULT 0.0,          -- Subjective mastery score: 0.0 to 1.0
    last_studied_at TEXT,                          -- ISO 8601 UTC of latest study session
    last_completed_at TEXT,                        -- ISO 8601 UTC of chapter completion
    questions_attempted INTEGER NOT NULL DEFAULT 0,-- Non-negative integer count
    questions_correct INTEGER NOT NULL DEFAULT 0,  -- Non-negative integer count <= questions_attempted
    accuracy REAL NOT NULL DEFAULT 0.0,            -- Derived ratio: questions_correct / questions_attempted
    updated_at TEXT NOT NULL,
    UNIQUE(chapter_id)
);
CREATE INDEX idx_study_progress_subject ON study_progress(subject_id);

CREATE TABLE daily_states (
    id TEXT PRIMARY KEY,                           -- daily_01J...
    date TEXT NOT NULL UNIQUE,                     -- YYYY-MM-DD in user's configured timezone
    study_minutes INTEGER NOT NULL DEFAULT 0,      -- Accumulated daily study minutes
    completed_chapters INTEGER NOT NULL DEFAULT 0, -- Count of chapters completed on this date
    questions_attempted INTEGER NOT NULL DEFAULT 0,-- Count of practice questions attempted
    questions_correct INTEGER NOT NULL DEFAULT 0,  -- Count of practice questions correct
    accuracy REAL NOT NULL DEFAULT 0.0,            -- Daily aggregate accuracy (0.0 to 1.0)
    missed_sessions INTEGER NOT NULL DEFAULT 0,    -- Count of scheduled sessions marked missed
    completed_tasks INTEGER NOT NULL DEFAULT 0,    -- Count of tasks completed
    pending_tasks INTEGER NOT NULL DEFAULT 0,      -- Count of tasks still pending
    state_payload TEXT NOT NULL,                   -- JSON summary for Notion journal & AI context
    updated_at TEXT NOT NULL
);

-- ============================================================================
-- 3. SOURCES DOMAIN (3 Tables)
-- ============================================================================

CREATE TABLE sources (
    id TEXT PRIMARY KEY,                           -- src_01J...
    title TEXT NOT NULL,                           -- Display title, e.g. 'Concepts of Physics'
    source_type TEXT NOT NULL,                     -- 'book', 'pdf', 'syllabus', 'notes'
    author TEXT,                                   -- e.g. 'H.C. Verma'
    publisher TEXT,                                -- Publisher name
    edition TEXT,                                  -- e.g. 'Vol 1, 2024'
    reference_uri TEXT,                            -- File path, URL, or identifier (NO raw text)
    status TEXT NOT NULL DEFAULT 'registered',     -- 'registered', 'mapped', 'archived'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE source_chapters (
    id TEXT PRIMARY KEY,                           -- srcchap_01J...
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    title TEXT NOT NULL,                           -- e.g. 'Electric Field and Potential'
    chapter_number INTEGER,                        -- Chapter index in table of contents
    location_reference TEXT,                       -- Page range or section, e.g. 'pp. 112-145'
    parent_chapter_id TEXT REFERENCES source_chapters(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_source_chapters_source ON source_chapters(source_id);

CREATE TABLE source_mappings (
    id TEXT PRIMARY KEY,                           -- map_01J...
    source_chapter_id TEXT NOT NULL REFERENCES source_chapters(id) ON DELETE CASCADE,
    canonical_chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
    subject_id TEXT REFERENCES subjects(id) ON DELETE RESTRICT,
    mapping_type TEXT NOT NULL DEFAULT 'direct',   -- 'direct', 'partial', 'prerequisite'
    relevance TEXT NOT NULL DEFAULT 'high',        -- 'high', 'medium', 'low'
    confidence REAL NOT NULL DEFAULT 1.0,          -- Algorithm confidence: 0.0 to 1.0
    notes TEXT,                                    -- Context regarding coverage
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source_chapter_id, canonical_chapter_id)
);
CREATE INDEX idx_source_mappings_canonical ON source_mappings(canonical_chapter_id);

-- ============================================================================
-- 4. TASKS & CALENDAR EXTERNAL COORDINATION DOMAIN (3 Tables)
-- ============================================================================

CREATE TABLE task_links (
    id TEXT PRIMARY KEY,                           -- tasklink_01J...
    task_id TEXT NOT NULL UNIQUE,                  -- External Google Tasks ID
    provider TEXT NOT NULL DEFAULT 'google_tasks', -- Provider identifier
    entity_type TEXT NOT NULL,                     -- Canonical target type: 'chapter', 'project'
    entity_id TEXT NOT NULL,                       -- ID of linked chapter or project
    title_snapshot TEXT,                           -- Last known task title
    status_snapshot TEXT,                          -- Last known status: 'needsAction', 'completed'
    last_synced_at TEXT,                           -- ISO 8601 UTC timestamp of last sync
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_task_links_entity ON task_links(entity_type, entity_id);

CREATE TABLE calendar_links (
    id TEXT PRIMARY KEY,                           -- callink_01J...
    event_id TEXT NOT NULL UNIQUE,                 -- External Google Calendar Event ID
    provider TEXT NOT NULL DEFAULT 'google_calendar',
    entity_type TEXT NOT NULL,                     -- 'study_session', 'task'
    entity_id TEXT NOT NULL,                       -- ID of linked study session or task
    title_snapshot TEXT,                           -- Event summary snapshot
    starts_at TEXT NOT NULL,                       -- ISO 8601 UTC start time
    ends_at TEXT NOT NULL,                         -- ISO 8601 UTC end time
    status_snapshot TEXT,                          -- 'confirmed', 'tentative', 'cancelled'
    last_synced_at TEXT,                           -- ISO 8601 UTC timestamp of last sync
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_calendar_links_entity ON calendar_links(entity_type, entity_id);

CREATE TABLE schedule_links (
    id TEXT PRIMARY KEY,                           -- schedlink_01J...
    task_id TEXT NOT NULL REFERENCES task_links(id) ON DELETE CASCADE,
    calendar_event_id TEXT NOT NULL REFERENCES calendar_links(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL DEFAULT 'session_for_task', -- 'session_for_task', 'deadline'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_schedule_links_task ON schedule_links(task_id);
CREATE INDEX idx_schedule_links_calendar ON schedule_links(calendar_event_id);

-- ============================================================================
-- 5. RESEARCH & PROJECTS DOMAIN (4 Tables)
-- ============================================================================

CREATE TABLE projects (
    id TEXT PRIMARY KEY,                           -- proj_01J...
    name TEXT NOT NULL,                            -- Project title, e.g. 'StudySourceCore Engine'
    description TEXT,                              -- Scope description
    status TEXT NOT NULL DEFAULT 'planned',        -- 'planned', 'active', 'paused', 'completed', 'cancelled'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE project_events (
    id TEXT PRIMARY KEY,                           -- progevt_01J...
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,                      -- 'started', 'milestone_reached', 'completed'
    actor TEXT NOT NULL,                           -- 'antigravity', 'user'
    payload_json TEXT NOT NULL,                    -- JSON details (curated summaries, NO raw logs)
    created_at TEXT NOT NULL
);
CREATE INDEX idx_project_events_project ON project_events(project_id, created_at);

CREATE TABLE research_events (
    id TEXT PRIMARY KEY,                           -- resevt_01J...
    topic TEXT NOT NULL,                           -- Research subject or problem statement
    source TEXT NOT NULL,                          -- e.g. 'arxiv', 'syllabus_guide', 'doc'
    summary TEXT NOT NULL,                         -- High-level curated takeaway
    payload_json TEXT,                             -- Structured findings metadata
    created_at TEXT NOT NULL
);

CREATE TABLE decisions (
    id TEXT PRIMARY KEY,                           -- dec_01J...
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    title TEXT NOT NULL,                           -- Decision summary
    context TEXT NOT NULL,                         -- Problem statement and background
    decision TEXT NOT NULL,                        -- Chosen option
    consequences TEXT,                             -- Architectural impact and trade-offs
    created_at TEXT NOT NULL
);

-- ============================================================================
-- 6. MEMORY DOMAIN (2 Tables)
-- ============================================================================

CREATE TABLE memory_facts (
    id TEXT PRIMARY KEY,                           -- mem_01J...
    fact TEXT NOT NULL,                            -- Semantic fact statement
    category TEXT NOT NULL,                        -- 'convention', 'preference', 'constraint', 'pattern'
    valid_at TEXT NOT NULL,                        -- ISO 8601 UTC when fact became true
    invalid_at TEXT,                               -- ISO 8601 UTC when superseded (NULL = currently valid)
    created_at TEXT NOT NULL
);
CREATE INDEX idx_memory_facts_valid ON memory_facts(valid_at, invalid_at);

CREATE TABLE memory_versions (
    id TEXT PRIMARY KEY,                           -- memver_01J...
    memory_fact_id TEXT NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
    operation TEXT NOT NULL,                       -- 'ADD', 'UPDATE', 'INVALIDATE', 'NONE'
    previous_fact TEXT,                            -- Snapshot of prior fact value if updated
    new_fact TEXT,                                 -- Snapshot of new fact value
    actor_id TEXT NOT NULL,                        -- Identity of user or agent authoring mutation
    created_at TEXT NOT NULL
);

-- ============================================================================
-- 7. AGENT & OPERATIONS DOMAIN (3 Tables)
-- ============================================================================

CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY,                           -- agentrun_01J...
    agent_name TEXT NOT NULL,                      -- 'chatgpt', 'spark', 'antigravity'
    run_type TEXT NOT NULL,                        -- 'source_ingestion', 'scheduler', 'sync'
    status TEXT NOT NULL,                          -- 'started', 'running', 'completed', 'failed'
    started_at TEXT NOT NULL,                      -- ISO 8601 UTC
    completed_at TEXT,                             -- ISO 8601 UTC
    result_summary TEXT,                           -- High-level outcome description
    error_code TEXT,                               -- Machine-readable error code if failed
    payload TEXT,                                  -- JSON metadata (NO private thinking/traces)
    created_at TEXT NOT NULL
);

CREATE TABLE state_snapshots (
    id TEXT PRIMARY KEY,                           -- snap_01J...
    snapshot_type TEXT NOT NULL,                   -- 'daily', 'milestone', 'pre_migration'
    state_json TEXT NOT NULL,                      -- Complete serialized machine state
    schema_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE checkpoints (
    id TEXT PRIMARY KEY,                           -- chk_01J...
    checkpoint_name TEXT NOT NULL,                 -- Identifier, e.g. 'antigravity_ingest_source_01J'
    checkpoint_type TEXT NOT NULL,                 -- 'workflow', 'ingestion', 'sync'
    state_data TEXT NOT NULL,                      -- Resumption token or cursor
    created_at TEXT NOT NULL
);

-- ============================================================================
-- 8. SYNCHRONIZATION & RELIABILITY DOMAIN (2 Tables)
-- ============================================================================

CREATE TABLE sync_jobs (
    job_id TEXT PRIMARY KEY,                       -- sync_01J... Stable queue delivery/job identity
    idempotency_key TEXT NOT NULL,                 -- Mutation identity linking to idempotency_records
    target_system TEXT NOT NULL,                   -- 'notion', 'google_tasks', 'google_calendar'
    entity_type TEXT NOT NULL,                     -- 'study_progress', 'daily_state', 'task', 'chapter'
    entity_id TEXT NOT NULL,                       -- Target canonical domain entity ID
    operation TEXT NOT NULL,                       -- 'create', 'update', 'delete', 'sync'
    payload_json TEXT NOT NULL,                    -- Self-contained serialized mutation payload
    status TEXT NOT NULL DEFAULT 'PENDING',        -- 'PENDING', 'DISPATCHED', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER'
    attempt_count INTEGER NOT NULL DEFAULT 0,      -- Delivery attempts counter
    next_attempt_at TEXT,                          -- ISO 8601 UTC after which retry is permitted
    dispatched_at TEXT,                            -- ISO 8601 UTC timestamp when enqueued to Queue
    last_error TEXT,                               -- Last caught exception or HTTP status snippet
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT                              -- ISO 8601 UTC timestamp of completion
);
CREATE INDEX idx_sync_jobs_status ON sync_jobs(status, next_attempt_at);
CREATE INDEX idx_sync_jobs_idempotency ON sync_jobs(idempotency_key);
CREATE INDEX idx_sync_jobs_outbox ON sync_jobs(status, dispatched_at);

CREATE TABLE idempotency_records (
    idempotency_key TEXT PRIMARY KEY,              -- Client-provided UUID or internal mutation key
    job_id TEXT,                                   -- Scoped job ID (NULL for direct HTTP API calls)
    operation TEXT NOT NULL,                       -- Endpoint or action name, e.g. 'POST /v1/events'
    source_system TEXT NOT NULL,                   -- 'chatgpt', 'spark', 'antigravity', 'queue_consumer'
    request_hash TEXT NOT NULL,                    -- SHA-256 hex digest of canonicalized request payload
    result_hash TEXT,                              -- SHA-256 hex digest of returned payload
    status TEXT NOT NULL,                          -- 'PENDING', 'COMPLETED', 'FAILED'
    result_payload TEXT,                           -- Cached JSON response body for replay
    created_at TEXT NOT NULL,                      -- ISO 8601 UTC
    updated_at TEXT NOT NULL,                      -- ISO 8601 UTC
    expires_at TEXT NOT NULL                       -- ISO 8601 UTC expiration timestamp (now + 24h)
);
CREATE INDEX idx_idempotency_records_expires ON idempotency_records(expires_at);
```

---

## 8. Queue Message Identity vs. Idempotency Identity

### 8.1 Normative Distinction: Job Identity vs. Mutation Identity
To guarantee that queue redeliveries, retries, and outbox sweeps never produce duplicate database events or duplicate external API mutations, the system strictly decouples the **queue delivery identity** from the **canonical mutation identity**:

- **`job_id` = Queue Delivery / Job Identity:** A unique opaque identifier (`sync_01J...`) assigned to each individual asynchronous job record in `sync_jobs`. `job_id` identifies the dispatch envelope and Cloudflare Queue message lifecycle. `job_id` **MUST NOT** be treated as the canonical mutation identity.
- **`idempotency_key` = Canonical Mutation Identity:** A stable UUID (`idemp_01J...` or client-supplied key) representing the unique logical state mutation. All queue redeliveries, consumer retries, and outbox sweeps for the same logical mutation share the exact same `idempotency_key`.

### 8.2 Strict Invariant for Queue Consumers
```text
Queue consumer redelivery MUST use the message's idempotency_key (NOT job_id) for idempotency lookup.
```
When a Cloudflare Queue consumer receives a message:
1. It extracts `idempotency_key` from the queue message envelope.
2. It queries `idempotency_records` using `idempotency_key`.
3. If `idempotency_records.status === 'COMPLETED'`, the consumer **immediately acknowledges (`msg.ack()`) and terminates execution**. The external provider API is **never called a second time**.

### 8.3 Exact Queue Message Envelope Schema
Every message transmitted via Cloudflare Queues (`SYNC_QUEUE` and `personal-sync-dlq`) must strictly conform to the following typed envelope:

```typescript
export interface QueueMessageEnvelope<T = Record<string, unknown>> {
  jobId: string;               // sync_01J... Queue delivery identity
  idempotencyKey: string;      // idemp_01J... Canonical mutation identity
  targetSystem: 'notion' | 'google_tasks' | 'google_calendar';
  entityType: 'study_progress' | 'daily_state' | 'task' | 'chapter';
  entityId: string;            // Target canonical domain entity ID
  operation: 'create' | 'update' | 'delete' | 'sync';
  schemaVersion: number;       // Version of envelope and payload (currently 1)
  payload: T;                  // Self-contained mutation payload required by adapter
  enqueuedAt: string;          // ISO 8601 UTC timestamp of dispatch
}
```

---

## 9. Transactional-Outbox Reliability Contract

### 9.1 The D1-to-Queue Failure Window
In distributed edge architectures, coordinating database transactions with message queue dispatching introduces an asynchronous failure window:

```text
Step 1: D1 batch commit succeeds (canonical event + projections + sync_job written)
Step 2: Cloudflare Queue enqueue is attempted
        └── Failure Mode A: Network timeout to Queue service
        └── Failure Mode B: Cloudflare Queue throws transient error
        └── Failure Mode C: Worker execution environment crashes / CPU limit exceeded
Result: Committed sync job is permanently stranded in D1 without an outbox dispatcher.
```

The Personal AI Study OS guarantees that **no committed sync job can ever be permanently lost** due to queue enqueue failure or worker crashes.

### 9.2 Durable Dispatcher & Outbox Reconciliation Mechanism
The architecture employs a **Transactional Outbox / Durable Dispatcher pattern** built entirely on existing infrastructure (**Cloudflare D1 + Cloudflare Cron Triggers + Cloudflare Queues**), requiring zero external message brokers:

```text
[ Incoming Request / Command ]
             │
             ▼
Execute D1 Atomic Batch: db.batch([
  INSERT INTO canonical_events (...),
  UPDATE study_progress / daily_states (...),
  INSERT INTO idempotency_records (idempotency_key=K, status='PENDING', ...),
  INSERT INTO sync_jobs (job_id=J, idempotency_key=K, status='PENDING', dispatched_at=NULL, ...)
])
             │
             ▼
[ D1 Commit Confirmed ]
             │
             ├──────────────────────────────────────────────────────┐
             │ Fast Path (In-Line Dispatch)                         │ Worker Crash / Enqueue Error
             ▼                                                      ▼
Attempt SYNC_QUEUE.send(envelope)                              Stranded in D1:
             │                                                 status='PENDING', dispatched_at=NULL
    ┌────────┴────────┐                                             │
    ▼                 ▼                                             ▼
[ Enqueue OK ]   [ Enqueue Failed ]                    [ Periodic Cron Dispatcher Sweep ]
    │                 │                                (Runs every 60 seconds)
    │                 └─── Log error & leave PENDING                │
    ▼                                                               ▼
UPDATE sync_jobs                                        SELECT * FROM sync_jobs
SET status='DISPATCHED',                                WHERE (status='PENDING' AND dispatched_at IS NULL
    dispatched_at=now()                                       AND created_at <= datetime('now', '-30 seconds'))
                                                           OR (status='FAILED' AND next_attempt_at <= datetime('now'))
                                                        ORDER BY created_at ASC LIMIT 50;
                                                                    │
                                                                    ▼
                                                        SYNC_QUEUE.send(envelope)
                                                                    │
                                                                    ▼
                                                        UPDATE sync_jobs
                                                        SET status='DISPATCHED', dispatched_at=now()
```

### 9.3 Outbox State Lifecycle
The `sync_jobs.status` field transitions through an explicit, deterministic state machine:

1. **`PENDING`:** The job is durably committed in D1. If `dispatched_at IS NULL`, it awaits in-line dispatch or dispatcher pickup.
2. **`DISPATCHED`:** The message envelope has been successfully accepted by `SYNC_QUEUE`.
3. **`PROCESSING`:** The Cloudflare Queue consumer has pulled the message and is actively executing provider calls.
4. **`COMPLETED`:** The external provider mutation succeeded and was acknowledged.
5. **`FAILED`:** A transient error occurred (e.g. HTTP 429, network timeout). `attempt_count` is incremented, `next_attempt_at` is set with exponential backoff, and the job awaits retry.
6. **`DEAD_LETTER`:** The job failed 5 consecutive attempts. The message is routed to `personal-sync-dlq` and marked `DEAD_LETTER` in D1 for manual recovery.

### 9.4 Duplicate Enqueue Safety
Because the periodic dispatcher runs concurrently with in-line dispatching, a job may occasionally be enqueued twice if a network delay occurs during in-line dispatch confirmation. This is **provably safe** because:
- The queue consumer performs an atomic lookup against `idempotency_records` using `idempotency_key`.
- If the first execution completed, the second execution encounters `status === 'COMPLETED'`, calls `msg.ack()`, and terminates without repeating the external mutation.

---

## 10. Provider-Specific External Mutation Idempotency

Generic statements such as "ETags make mutations idempotent" are architecturally insufficient. Each external provider exhibits distinct API capabilities, concurrency models, and lost-acknowledgement behaviors.

### 10.1 Master Provider Idempotency Matrix

| Provider | Create Idempotency | Update Concurrency | Lost-Ack Recovery |
| :--- | :--- | :--- | :--- |
| **Google Calendar** | Deterministic external event ID (`base32hex`) | `ETag` + `If-Match` header | Lookup existing event by deterministic ID via `GET` |
| **Google Tasks** | Deterministic metadata tag in task notes + window search | Provider state reconciliation (fetch & compare) | Lookup existing task by stored `task_id` or metadata tag search |
| **Notion** | Deterministic `OS_Entity_ID` property lookup via database query | Latest-state reconciliation (fetch properties & `last_edited_time`) | Lookup existing page by stored Notion page ID or entity property filter |

### 10.2 Google Calendar Integration Contract
- **CREATE Idempotency:** The Google Calendar API v3 (`POST /calendars/{calendarId}/events`) accepts a client-assigned `id` conforming to the `base32hex` character set `[a-v0-9]` with a length between 5 and 1024 characters.
  - The adapter generates a deterministic event ID: `base32hex(sha256(idempotency_key)).substring(0, 32)`.
  - If a network failure occurs after Google creates the event but before the worker receives the response:
    - On retry, the adapter sends the identical deterministic `id`.
    - Google Calendar returns **HTTP 409 Conflict** ("The requested identifier already exists").
    - The adapter catches 409, executes `GET /calendars/{calendarId}/events/{deterministic_id}`, verifies that the remote event matches the target payload, updates `calendar_links` with the confirmed event, updates `idempotency_records` to `COMPLETED`, and considers the mutation successful.
- **UPDATE Concurrency:** Google Calendar returns an `etag` string on every event resource.
  - When updating (`PATCH /calendars/{calendarId}/events/{eventId}`), the adapter supplies the stored ETag in the `If-Match: "<etag>"` HTTP header.
  - If the event was modified concurrently, Google returns **HTTP 412 Precondition Failed**.
  - On 412: The adapter catches the error, fetches the latest event state via `GET`, reconciles the time block, computes a new diff, and retries with the new ETag.
- **Lost-Ack Recovery:** Prior to executing an update, or upon consumer redelivery, the adapter calls `GET /calendars/{calendarId}/events/{eventId}`. If the event's remote start/end times already match the target mutation, the update is skipped and acknowledged.

### 10.3 Google Tasks Integration Contract
- **CREATE Idempotency & Lost-Ack Reconciliation:** Google Tasks `POST /tasks/v1/lists/{tasklist}/tasks` does **not** allow client-assigned IDs; IDs are assigned server-side.
  - To prevent duplicate task creation upon lost acknowledgement:
    - The adapter embeds a deterministic metadata token in the task notes: `[study-os:entity_id:idempotency_key]`.
    - If a task creation fails with a network timeout or connection reset:
      - On retry, prior to calling `tasks.insert`, the adapter queries `tasks.list` with `updatedMin` set to 5 minutes prior to `job.created_at`.
      - It inspects the retrieved tasks for notes containing the exact deterministic token `[study-os:entity_id:idempotency_key]`.
      - If a matching task is found: The adapter adopts the existing Google Task ID, writes it to `task_links`, updates `idempotency_records` to `COMPLETED`, and avoids creating a duplicate.
      - If no matching task is found: The adapter proceeds with `tasks.insert`.
- **UPDATE Concurrency:** Google Tasks does not support `If-Match` ETags. Concurrency control is achieved via **Provider State Reconciliation**:
  - The adapter fetches the remote task via `GET /tasks/v1/lists/{tasklist}/tasks/{taskId}`.
  - It compares the current remote `status`, `title`, and `due` date against the desired mutation.
  - If the remote task already matches the target state (e.g. `status === 'completed'`), the update is skipped.
  - Only if the remote state diverges does the adapter issue `PATCH /tasks/v1/lists/{tasklist}/tasks/{taskId}`.

### 10.4 Notion Integration Contract
- **CREATE Idempotency:** Notion's `POST /v1/pages` generates server-assigned UUIDs and does not support client-specified IDs or HTTP idempotency keys.
  - Every Notion database configured for Study OS synchronization includes a text property named `OS_Entity_ID`.
  - Prior to calling `POST /v1/pages`, or upon consumer redelivery:
    - The adapter queries the target database via `POST /v1/databases/{database_id}/query` with a filter:
      `{ "property": "OS_Entity_ID", "rich_text": { "equals": entity_id } }`.
    - If an entry is returned: The adapter extracts the existing Notion page ID, links it in D1, marks `idempotency_records` as `COMPLETED`, and skips page creation.
    - If no entry is returned: The adapter executes `POST /v1/pages` with `OS_Entity_ID` populated.
- **UPDATE Concurrency & Lost-Ack:** Notion does not support HTTP `If-Match` ETags.
  - The adapter fetches the page via `GET /v1/pages/{page_id}` and inspects `last_edited_time` and current property values.
  - If the properties already reflect the desired state, the mutation is acknowledged without calling `PATCH`.
  - If properties differ, the adapter applies `PATCH /v1/pages/{page_id}`.
- **Rate Limit Throttling:** Strict enforcement of Notion's 3 requests per second per integration token via token-bucket rate limiting in the queue worker.

---

## 11. Modernized Remote MCP Server Specification (MCP 2026-07-28)

### 11.1 Protocol & Primary Remote Transport
- **Protocol Specification:** **Model Context Protocol (MCP) 2026-07-28 specification**.
- **Primary Remote Transport:** **Streamable HTTP** over HTTP/2 or HTTP/3 at endpoint `https://api.personal-os.com/mcp`.
  - Handles bidirectional, streaming JSON-RPC 2.0 messages via standard HTTP POST with chunked streaming responses.
  - Eliminates long-lived hanging GET connections and complex dual-channel synchronization inherent in legacy SSE.
- **Optional Backwards Compatibility Transport:** Legacy HTTP+SSE (`GET /mcp/sse` + `POST /mcp/messages`) is retained strictly as an optional backward compatibility fallback for legacy AI clients. It is **never** the primary production architecture.

### 11.2 MCP Authentication & Audience Validation Flow
Every MCP connection and tool execution must supply a valid OAuth 2.1 Bearer token:
```text
POST /mcp HTTP/1.1
Host: api.personal-os.com
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
Accept: application/json, text/event-stream
```
The Cloudflare Worker validates:
1. `iss`: Must match designated Identity Provider.
2. `aud`: **MANDATORY AUDIENCE CHECK.** Must explicitly equal `https://api.personal-os.com/mcp` or `personal-study-os-api`. Tokens minted for generic MCP hosts are rejected with HTTP 403 (`AUDIENCE_MISMATCH`).
3. `exp`: Validates token is unexpired.
4. `scope`: Validates tool permissions (`read`, `write`, `admin`).

### 11.3 Registered Semantic Tools
The MCP server exposes a focused semantic surface. Under no circumstances does MCP accept raw SQL strings or execute arbitrary DDL/DML.

1. `get_today_state`
   - *Input Schema:* `{ timezone?: string }`
   - *Scope Required:* `read`
   - *Description:* Returns today's active study goals, completed tasks, and schedule blocks in the operator's timezone.
2. `record_study_session`
   - *Input Schema:* `{ chapter_id: string, duration_seconds: number, activity_type: 'revision' | 'pyq_practice' | 'lecture' | 'deep_work', idempotency_key: string }`
   - *Scope Required:* `write`
   - *Description:* Emits `study_session_recorded` event, updates progress projection, writes outbox sync job for Notion, and updates daily state.
3. `update_study_progress`
   - *Input Schema:* `{ chapter_id: string, progress_percent: number, questions_attempted?: number, questions_correct?: number, idempotency_key: string }`
   - *Scope Required:* `write`
   - *Description:* Emits `questions_attempted` and/or `chapter_progress_updated` events with mathematical bounds checking.
4. `register_source`
   - *Input Schema:* `{ title: string, source_type: 'book' | 'pdf' | 'syllabus' | 'notes', author?: string, reference_uri?: string, idempotency_key: string }`
   - *Scope Required:* `write`
   - *Description:* Registers textbook or syllabus metadata in D1 (NO raw text).
5. `map_source_chapter`
   - *Input Schema:* `{ source_chapter_id: string, canonical_chapter_id: string, confidence: number, idempotency_key: string }`
   - *Scope Required:* `write`
   - *Description:* Links an external syllabus or TOC section to a canonical chapter.

---

## 12. Notion Webhook Reconciliation Pipeline

The Notion integration is **webhook-first**. Polling is strictly a secondary recovery mechanism.

### 12.1 Webhook Processing Lifecycle
Inbound Notion webhooks are processed through a strict 6-stage pipeline:

```text
Notion Webhook POST /v1/webhooks/notion
                   │
                   ▼
       [ Stage 1: Signature Verification ]
       Validate X-Notion-Signature using HMAC-SHA256(secret, rawBody)
       Invalid -> HTTP 401 Unauthorized
                   │
                   ▼
       [ Stage 2: Webhook Event Deduplication ]
       Derive dedup key: webhook_notion_<event_id>
       Check idempotency_records WHERE key = dedup_key
       Already processed -> HTTP 200 OK (Immediate Return)
                   │
                   ▼
       [ Stage 3: Retrieve Authoritative Latest State ]
       Do NOT trust thin payload delta.
       Call Notion API: GET /v1/pages/{page_id} or GET /v1/blocks/{id}
                   │
                   ▼
       [ Stage 4: Domain Reconciliation ]
       Compare Notion last_edited_time and properties with D1 machine state.
       If identical or older -> Record dedup & HTTP 200 OK
                   │
                   ▼
       [ Stage 5: Emit Canonical Event ]
       If human operator changed study notes, completion status, or syllabus:
       Construct CanonicalEvent (e.g. chapter_progress_updated, research_completed)
                   │
                   ▼
       [ Stage 6: Update Machine State ]
       Execute db.batch([
         insertCanonicalEventQuery,
         updateStudyProgressQuery,
         insertIdempotencyRecordQuery (key = dedup_key, status = 'COMPLETED')
       ])
```

### 12.2 Handling Webhook Edge Cases
- **Duplicate Delivery:** Handled by Stage 2 deduplication against `idempotency_records`.
- **Aggregated / Delayed Events:** Handled by Stage 3 (authoritative latest-state retrieval). Regardless of how many block edits Notion aggregates into one webhook, the worker fetches the complete latest page object.
- **Out-of-Order Delivery:** Handled by comparing Notion's `last_edited_time` against D1's `task_links.last_synced_at` or `canonical_events.recorded_at`. If an incoming webhook represents an edit older than the persisted machine state, it is safely discarded.
- **Secondary Bounded Reconciliation Polling:** A Cloudflare Cron Trigger executes every 6 hours to query Notion pages updated since `now() - 7 hours`. This catches any events dropped during prolonged webhook endpoint outages.

---

## 13. Complete Study Progress & Chapter Models

### 13.1 Metric Integrity & Mathematical Invariants
The `study_progress` projection model strictly enforces mathematical consistency:

$$\forall \text{ records in } study\_progress:$$
$$0 \le questions\_attempted \in \mathbb{Z}_{\ge 0}$$
$$0 \le questions\_correct \le questions\_attempted$$
$$accuracy = \begin{cases} \frac{questions\_correct}{questions\_attempted} & \text{if } questions\_attempted > 0 \\ 0.0 & \text{if } questions\_attempted = 0 \end{cases}$$
$$progress\_percent \in [0.0, 1.0]$$
$$confidence \in [0.0, 1.0]$$

### 13.2 Recursive Chapter Hierarchy Model
The system supports nested study syllabi through a self-referencing hierarchy on `chapters`:

```text
Subject (e.g. Physics)
  └── Unit (e.g. Mechanics) [parent_id = NULL]
        └── Chapter (e.g. Rotational Dynamics) [parent_id = unit_id]
              └── Topic (e.g. Moment of Inertia) [parent_id = chapter_id]
```

**Schema & Integrity Rules:**
- `subject_id REFERENCES subjects(id) ON DELETE RESTRICT`: Every node in the tree belongs to a canonical subject.
- `parent_id REFERENCES chapters(id) ON DELETE RESTRICT`: Top-level Units have `parent_id IS NULL`. Sub-chapters and Topics reference their immediate parent.
- `slug`: Lowercase, alphanumeric hyphenated string unique within the subject scope (`UNIQUE(subject_id, slug)`).
- **Cycle Prevention:** Application validation prevents cyclic parent references ($A \rightarrow B \rightarrow A$).
- **No Flat Reduction:** The database model must never be flattened into a simple non-hierarchical chapter list.

---

## 14. Canonical Event Engine & Projection Engine

### 14.1 Atomic Ingestion Pipeline
When an event mutation is submitted via REST (`POST /v1/events`) or MCP (`record_study_session`):
1. **Zod Validation:** Incoming payload validated against typed schema for `event_type`.
2. **Entity Resolution:** Display names resolved to stable opaque identifiers (`subj_01J...`).
3. **Authorization Check:** Actor's token scopes and `aud` validated.
4. **Idempotency Verification:** Request hash verified against `idempotency_records`.
5. **Envelope Construction:** `CanonicalEvent` envelope assembled with unique `event_id`, timestamps, and actor provenance.
6. **Atomic Persistence (`db.batch()`):** Event insertion, projection updates, outbox sync job, and idempotency record committed in a single atomic batch:
   ```typescript
   await db.batch([
     insertCanonicalEventQuery,
     updateStudyProgressProjectionQuery,
     updateDailyStateProjectionQuery,
     insertSyncJobOutboxQuery,
     insertIdempotencyRecordQuery
   ]);
   ```
7. **In-Line Dispatch Attempt:** Worker attempts immediate enqueue to `SYNC_QUEUE`. If successful, marks `sync_jobs.status = 'DISPATCHED'`, `dispatched_at = now()`. If failed, leaves `PENDING` for cron dispatcher.

### 14.2 Projection Handler Registry

| Event Type | Target Projection Table | Projection Query Logic |
| :--- | :--- | :--- |
| `study_completed` | `study_progress`, `daily_states` | Update `last_studied_at`, aggregate `study_minutes` in `daily_states`. |
| `questions_attempted` | `study_progress`, `daily_states` | Increment `questions_attempted`, `questions_correct`, recalculate `accuracy`. |
| `chapter_completed` | `chapters`, `study_progress`, `daily_states` | Set `status = 'COMPLETED'`, `progress_percent = 1.0`, increment `completed_chapters`. |
| `schedule_missed` | `daily_states` | Increment `missed_sessions` in `daily_states`. |
| `task_completed` | `task_links`, `daily_states` | Update `status_snapshot = 'completed'`, increment `completed_tasks`. |

---

## 15. REST API Specification

**Base URL:** `https://api.personal-os.com/v1/`

### 15.1 Endpoints
1. `GET /v1/state/today`
   - *Description:* Retrieves the operator's localized daily state summary.
   - *Query Parameters:* `timezone` (optional, falls back to user default).
   - *Response:* `200 OK` with JSON `DailyState` object.
2. `GET /v1/study/progress`
   - *Description:* Retrieves current progress across all subjects and chapters.
   - *Response:* `200 OK` with array of `StudyProgress` objects.
3. `POST /v1/events`
   - *Description:* Ingests a canonical event with atomic projection updates and outbox dispatch.
   - *Headers:* `Authorization: Bearer <JWT>`, `Idempotency-Key: <UUID>`.
   - *Body:* `CanonicalEventEnvelope`.
   - *Response:* `201 Created` with ingested event metadata, or `200 OK` if replaying idempotent request.
4. `POST /v1/webhooks/notion`
   - *Description:* Webhook receiver for Notion workspace updates.
   - *Headers:* `X-Notion-Signature: <HMAC_SHA256>`.
   - *Response:* `200 OK` with `{ status: "processed" | "deduplicated" }`.
5. `POST /v1/admin/rebuild-projections`
   - *Description:* Administrative endpoint to replay all events and rebuild projection tables.
   - *Headers:* `Authorization: Bearer <ADMIN_JWT>`.
   - *Response:* `200 OK` with replayed event count.
6. `POST /v1/admin/dispatch-outbox`
   - *Description:* Manually triggers the outbox dispatcher to sweep undispatched `sync_jobs`.
   - *Headers:* `Authorization: Bearer <ADMIN_JWT>`.
   - *Response:* `200 OK` with `{ dispatched_count: number }`.

---

## 16. Queue Architecture & Consumer Implementation

### 16.1 Cloudflare Queue Configuration (`wrangler.toml`)
```toml
[[queues.producers]]
queue = "personal-sync-queue"
binding = "SYNC_QUEUE"

[[queues.consumers]]
queue = "personal-sync-queue"
max_batch_size = 10
max_batch_timeout = 5
max_retries = 5
dead_letter_queue = "personal-sync-dlq"

[triggers]
crons = ["* * * * *", "0 */6 * * *"] # Every minute for Outbox Dispatcher, every 6h for Notion reconciliation
```

### 16.2 Consumer Execution Logic
The worker's `queue` handler processes batches with deduplication and concurrency control:
1. Iterates over messages in `batch.messages`.
2. Extracts typed `QueueMessageEnvelope` containing `jobId` and `idempotencyKey`.
3. **Idempotency Check:** Queries `idempotency_records` using `idempotencyKey` (NOT `jobId`). If `status === 'COMPLETED'`, calls `msg.ack()` and skips processing.
4. Dispatches message to provider adapter (`NotionAdapter`, `GoogleTasksAdapter`, `GoogleCalendarAdapter`).
5. On success: Updates `sync_jobs` to `COMPLETED`, updates `idempotency_records` to `COMPLETED`, and calls `msg.ack()`.
6. On transient failure (HTTP 429/503): Increments `attempt_count`, calculates exponential backoff delay, and calls `msg.retry({ delaySeconds })`.
7. On terminal failure (after 5 retries): Message routed to `personal-sync-dlq`; updates `sync_jobs.status = 'DEAD_LETTER'`.

---

## 17. Multi-Stage CI/CD & Production Promotion Specification

### 17.1 Staged Lifecycle Pipeline
Production deployment **MUST NOT** be an automatic consequence of an ordinary merge to `main`. The system mandates an explicit multi-stage promotion pipeline:

```text
Pull Request (Feature Branch)
      │
      ▼
Automated PR Gates:
  ├─ 1. ESLint & Prettier formatting
  ├─ 2. TypeScript compilation (tsc --build)
  ├─ 3. Unit & Contract tests (vitest)
  └─ 4. Local Miniflare D1 migrations apply test
      │
      ▼
Merge to 'main'
      │
      ▼
Automated Staging Deployment:
  ├─ Apply migrations: wrangler d1 migrations apply DB --env staging
  └─ Deploy Worker: wrangler deploy --env staging
      │
      ▼
Automated & Synthetic Staging Verification:
  ├─ Staging health check & OAuth audience verification
  ├─ End-to-end synthetic study event ingestion
  └─ Outbox dispatcher & queue processing verification
      │
      ▼
Explicit Release Creation:
  Create Git Release Tag (e.g. 'v1.2.0') via manual GitHub Release workflow
      │
      ▼
Production Deployment Gate (Triggered ONLY by Release Tag):
  ├─ Apply migrations: wrangler d1 migrations apply DB --remote --env production
  ├─ Deploy Worker: wrangler deploy --env production
  └─ Production smoke test
```

### 17.2 Rollback & Forward-Only Migration Policy
- **Worker Code Rollback:** Execute `wrangler rollback [deployment-id]` to immediately revert worker application code.
- **Database Schema Recovery:** In accordance with the forward-only migration policy, interactive database rollbacks (`DOWN` migrations) are strictly prohibited on Cloudflare D1. All schema corrections are applied via forward-fix migrations (`XXXX_remedy.sql`).
- **Corrupted Projection Recovery:** Trigger `POST /v1/admin/rebuild-projections` to replay immutable events and restore derived tables.

---

## 18. Authoritative Acceptance Test Suites (30 Suites)

The test suite must implement and pass all **30 explicit acceptance tests**:

### Idempotency & Queue Identity Suite
1. **Same Request + Same Idempotency Key:** Submitting an identical mutation with an existing key returns the cached response with zero duplicate events created.
2. **Different Request + Same Idempotency Key:** Submitting a modified payload with an existing key rejects immediately with `409 IDEMPOTENCY_CONFLICT`.
3. **Queue Message Identity vs. Mutation Identity Decoupling:** Queue redelivery uses `envelope.idempotencyKey` (not `jobId`) for idempotency record lookup, ensuring distinct delivery attempts for the same mutation are deduplicated.
4. **Duplicate Queue Delivery Acknowledgment:** Redelivery of an already-processed queue message is detected via `idempotency_records` and silently acknowledged without calling external APIs.
5. **Retry After Partial Atomic Batch Failure:** When an atomic batch fails mid-pipeline, the entire transaction rolls back, leaving no orphan idempotency records or partial state.

### Transactional Outbox Suite
6. **Outbox In-Line Fast Path:** Successful D1 batch and immediate queue enqueue transitions `sync_jobs.status` from `PENDING` to `DISPATCHED` with `dispatched_at` populated.
7. **Outbox Worker Crash Recovery:** Simulating worker crash after D1 commit leaves `sync_jobs.status = 'PENDING'` with `dispatched_at IS NULL`; periodic dispatcher sweep discovers, enqueues to `SYNC_QUEUE`, and marks `DISPATCHED`.
8. **Outbox Re-Dispatch Idempotency:** If the dispatcher enqueues a job that was already processed inline, consumer detects `idempotency_records.status = 'COMPLETED'` and ACKs without re-executing.

### Google Calendar Suite
9. **Deterministic Event ID Create Idempotency:** Submitting calendar create generates deterministic `base32hex` ID; simulated lost-ack retry catches HTTP 409 Conflict, fetches event, and completes safely.
10. **Successful ETag Update:** Updating a calendar session passes the correct `If-Match` ETag and succeeds with HTTP 200.
11. **HTTP 412 Conflict & Reconcile:** Concurrently modifying a calendar event triggers HTTP 412 Precondition Failed; adapter catches 412, refetches latest event, reconciles time blocks, and successfully updates.

### Google Tasks Suite
12. **Deterministic Note Metadata Create Reconciliation:** Simulating lost ack after `tasks.insert` triggers `tasks.list` window search matching `[study-os:...]` metadata token, adopting existing ID without duplicate task creation.
13. **Provider State Reconciliation on Update:** Adapter fetches remote task before calling patch; if remote status is already completed, skips patch and marks completed.
14. **Date-Only Boundary Enforcement:** Verifies that time portions in study tasks are stripped, persisting strictly RFC 3339 date strings.

### Notion Suite
15. **Deterministic Property Create Reconciliation:** Database query for `OS_Entity_ID` detects existing page on retry, linking existing ID without creating duplicate page.
16. **HMAC Webhook Signature Verification:** Incoming webhook with invalid HMAC signature is rejected with HTTP 401 Unauthorized.
17. **Webhook Deduplication:** Duplicate Notion webhook deliveries are deduplicated against `idempotency_records` using `webhook_notion_<event_id>`.
18. **Latest-State Object Refetch:** Webhook processing fetches complete latest page state via `GET /v1/pages/{id}` before reconciling changes.
19. **Rate-Limit 429 & Backoff:** When Notion returns HTTP 429, consumer captures error and defers message retry following exponential backoff ($5s, 10s, 20s \dots$).

### Remote MCP Suite (MCP 2026-07-28)
20. **Streamable HTTP Transport Connection:** Client connects to `POST /mcp` via Streamable HTTP, transmitting JSON-RPC 2.0 requests and receiving streaming responses.
21. **Legacy SSE Fallback Compatibility:** Legacy clients connecting via `GET /mcp/sse` receive backward-compatible SSE streams.
22. **Raw SQL Execution Rejection:** MCP tool requests attempting raw SQL or arbitrary table drops are strictly rejected.

### Authentication Suite
23. **Expired Token Rejection:** Requests with tokens past their `exp` timestamp return `401 Unauthorized` (`INVALID_TOKEN`).
24. **Invalid Signature Rejection:** Tokens signed with untrusted keys return `401 Unauthorized`.
25. **Mandatory Audience Validation:** Valid JWTs with mismatched `aud` return `403 Forbidden` (`AUDIENCE_MISMATCH`).
26. **Insufficient Scope Rejection:** Read-only tokens attempting `POST /v1/events` return `403 Forbidden` (`INSUFFICIENT_SCOPE`).

### State & Projection Suite
27. **Canonical Event Immutability:** Ingesting an event persists immutable rows in `canonical_events`.
28. **Projection Mathematical Invariants:** `questions_attempted` events maintain $0 \le questions\_correct \le questions\_attempted$ and calculate $accuracy \in [0.0, 1.0]$.
29. **Projection Rebuild from Canonical Events:** Truncating `study_progress` and replaying canonical events restores 100% state accuracy.

### Migration & Release Gate Suite
30. **CI/CD Staging Gate & Production Promotion:** Verifies that production deployment is blocked on merge to `main` until staging verification succeeds and an explicit release tag is pushed.

---

## 19. Implementation Sequence (12 Ordered Phases)

The production build must proceed in strict dependency order:

```text
Phase 0: Foundation & Tooling (Monorepo, Zod, TypeScript, Vitest)
  ↓
Phase 1: D1 Database & Migrations (Kysely Schema, 24 Tables, Initial Migrations)
  ↓
Phase 2: Domain Model & Validation (Typed Entities, 30+ Event Schemas, Queue Envelopes)
  ↓
Phase 3: Canonical Event Engine (Atomic Ingestion Pipeline, db.batch)
  ↓
Phase 4: Projection Engine (Derived State Handlers, Mathematical Invariants, Rebuild Routines)
  ↓
Phase 5: REST API & Authentication (OAuth 2.1, JWT JWKS, Audience Validation)
  ↓
Phase 6: Remote MCP Server (MCP 2026-07-28 Streamable HTTP, Semantic Tools, No Raw SQL)
  ↓
Phase 7: Queue & Outbox Engine (Transactional Outbox Dispatcher, Deduplication, DLQ)
  ↓
Phase 8: Google Calendar Adapter (Deterministic Base32hex IDs, ETag, If-Match Concurrency)
  ↓
Phase 9: Google Tasks Adapter (Date-Only Polling, Deterministic Note Tags, Reconciliation)
  ↓
Phase 10: Notion Adapter (HMAC Webhooks, Latest-State Refetch, 3 req/sec Rate Limiter)
  ↓
Phase 11: Observability, Acceptance Testing & CI/CD (30 Tests Suite, Staging Release Gate)
```

---

## 20. Architecture Invariants & Ownership Matrix

### 20.1 Non-Negotiable Ownership Matrix

| System | Primary Responsibility | Authoritative Data | Strictly Forbidden Operations |
| :--- | :--- | :--- | :--- |
| **Google Tasks** | Task existence & completion (**WHAT**) | Task status, task completion, date-level work | Cannot manage intra-day hours or precise time blocks. |
| **Google Calendar** | Time allocation & scheduling (**WHEN**) | Start/end times, schedule blocks, study sessions | Cannot act as the task checklist source of truth. |
| **Gemini Spark** | Scheduling optimization | Proposed calendar adjustments | Cannot perform mass unattended deletions or overwrite history. |
| **Notion** | Human memory & knowledge plane | Curated notes, journal entries, study library | Cannot receive raw telemetry or machine event dumps. |
| **Cloudflare D1** | Machine truth & event history | Canonical events, derived projections, cross-system links | Cannot store copyrighted book texts or user secrets. |
| **ChatGPT** | Reasoning & intent generation | Structured intent proposals in active sessions | Cannot execute unattended background mutations. |
| **Antigravity** | Technical execution & ingestion | Code execution, build validation, source TOC extraction | Cannot act as permanent state store. |

### 20.2 Core Architectural Principles
1. **V1 is a single-user, single-tenant Personal AI Study OS deployment.** Multi-user isolation is explicitly not a V1 requirement. The `users` table provides identity and timezone context.
2. **Canonical events are append-only and immutable.** Historical events are never updated or deleted.
3. **Derived state is 100% rebuildable.** Loss of projection tables can be restored by replaying canonical events.
4. **The Transactional Outbox guarantees at-least-once downstream dispatch.** Committed D1 state cannot be lost due to worker crashes.
5. **Queue consumers enforce idempotency via mutation keys.** Redeliveries verify `idempotency_key`, preventing duplicate external mutations.
6. **External systems retain ownership of their domains.** Google Tasks owns WHAT, Calendar owns WHEN, Notion owns human notes, D1 owns machine truth.
7. **No direct agent-to-agent coupling.** All coordination is mediated via the Personal State Service.

---

## 21. Architectural Decision Records (ADR Register)

- **ADR-001: Cloudflare D1 with Batch API for Atomic Mutations:** Adopted D1 `db.batch()` implicit transactions; rejected explicit `BEGIN`/`COMMIT`.
- **ADR-002: At-Least-Once Messaging with Consumer-Side Idempotency:** Mandated pre-mutation checks against `idempotency_records` using `idempotency_key` before external API calls.
- **ADR-003: Optimistic Concurrency Control for Google Calendar:** Mandated `ETag` and `If-Match` headers for calendar updates with automatic HTTP 412 reconciliation.
- **ADR-004: Webhooks with Rate-Limited Queue Throttling for Notion:** Replaced expensive polling with real-time webhooks, throttled to 3 req/sec in queue consumers.
- **ADR-005: Forward-Only Database Migrations:** Prohibited database rollbacks on D1; mandated forward-fix migrations and backward-compatible schema changes.
- **ADR-006: Reallocation of Precise Scheduling from Tasks to Calendar:** Reallocated all time-of-day tracking strictly to Google Calendar due to Tasks API constraints.
- **ADR-007: Mandatory OAuth 2.1 Audience Validation:** Enforced strict `aud` verification on incoming JWTs to prevent confused deputy attacks.
- **ADR-008: Metadata-Only Source Ingestion:** Prohibited storage of copyrighted book text in D1, restricting storage to TOC structures and syllabus mappings.
- **ADR-009: Streamable HTTP Transport for MCP 2026-07-28:** Adopted Streamable HTTP as the primary transport for the Remote MCP Server, relegating HTTP+SSE to optional legacy fallback.
- **ADR-010: Transactional Outbox Pattern for Cloudflare Queues:** Mandated a durable dispatcher pattern using the `sync_jobs` persistence model in D1 to close the D1-commit-to-queue-enqueue failure window without external broker infrastructure.
- **ADR-011: Provider-Specific External Idempotency & Lost-Ack Reconciliation:** Mandated deterministic event identities for Google Calendar, deterministic metadata tagging for Google Tasks, and entity property lookup for Notion to guarantee safe lost-acknowledgement recovery.
- **ADR-012: Explicit Single-Tenant Deployment Boundary for V1:** Mandated single-user/single-tenant architecture for V1, avoiding premature multi-tenant SaaS schema complexity while retaining `users` as the identity anchor.
- **ADR-013: Multi-Stage Staging Verification & Explicit Production Release Gate:** Replaced automatic deployment on merge with a staged pipeline requiring staging deployment, synthetic verification, and explicit release tagging before production deployment.
- **ADR-014: Notion Webhook Signature Verification & Latest-State Reconciliation:** Established HMAC signature verification, deduplication against `idempotency_records`, and authoritative object refetching before applying Notion updates.

---

## 22. Build Readiness Status & Gate 3 Sign-off

```text
IMPLEMENTATION SPECIFICATION STATUS

Version: 1.2
Gate 3: FINAL BUILD GATE RECONCILED
Architecture: GREEN
Contract Alignment: GREEN
Reliability Contract: GREEN
Implementation Specification: READY FOR FINAL BUILD AUTHORIZATION REVIEW
Production Build: NOT YET AUTHORIZED
```
