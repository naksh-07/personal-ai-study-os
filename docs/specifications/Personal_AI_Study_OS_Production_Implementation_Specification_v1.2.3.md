# Personal AI Study OS — Production Implementation Specification v1.2.3

## Document Version History

| Version | Date | Status | Key Changes |
| :--- | :--- | :--- | :--- |
| **v1.0** | September 2026 | Superseded | Initial production implementation specification draft. |
| **v1.1** | September 2026 | Superseded | **Build Readiness Reconciliation (Gate 3):**<br>• Initial 23-table schema enumeration and Kysely database mapping.<br>• Decoupled `idempotency_records` from mandatory queue `job_id`, establishing 5-case deduplication.<br>• Added `sync_jobs` queue persistence model with exponential backoff and DLQ recovery.<br>• Aligned `study_progress` projection model with mathematical bounds ($0 \le questions\_correct \le questions\_attempted$, $accuracy \in [0.0, 1.0]$).<br>• Added user timezone semantics and recursive chapter hierarchy.<br>• Mandated OAuth 2.1 Bearer JWT validation with explicit `aud` (Audience) verification.<br>• Formalized metadata-only source ingestion prohibiting copyrighted book content in D1.<br>• Codified 23 initial acceptance test suites. |
| **v1.2** | September 2026 | Superseded | **Final Build Gate Reconciliation:**<br>• Established normative distinction between `job_id` (queue delivery identity) and `idempotency_key` (canonical mutation identity).<br>• Introduced Transactional Outbox pattern on `sync_jobs` with background cron sweeps.<br>• Introduced provider-specific idempotency models (Calendar base32hex IDs, Tasks metadata tagging, Notion property lookup).<br>• Upgraded Remote MCP transport to Streamable HTTP (MCP 2026-07-28).<br>• Reconciled D1 schema to 24 tables across 8 domains.<br>• Codified single-tenant V1 deployment boundary.<br>• Replaced automatic deploy on merge with multi-stage CI/CD release gate. |
| **v1.2.1** | September 2026 | Superseded | **Final Pre-Build Gate Corrections:**<br>• Added `processing_started_at` column and atomic conditional claim for queue consumer lease management.<br>• Added Notion webhook signature verification and latest-state refetching pipeline.<br>• Expanded test suites covering outbox recovery and provider idempotency. |
| **v1.2.2** | September 2026 | Superseded | **Final Build Authorization Hardening (Authoritative Baseline):**<br>• Fully Deterministic Google Tasks Lost-Ack Recovery (Correction A).<br>• Deterministic PROCESSING Lease & Atomic Stale Recovery (Correction B).<br>• Queue Consumer Execution Logic Hardening.<br>• Acceptance Test Consistency (50 Scenarios).<br>• Preserved for auditability. |
| **v1.2.3** | September 2026 | **FINAL BUILD GATE HARDENED** | **Final Build Authorization Hardening (Attempt Count & Stale Recovery Semantics):**<br>• **Canonical Attempt Count Semantics:** Codified that `attempt_count` strictly represents the total number of execution attempts initiated for a sync job. Enforced the invariant: *exactly one `attempt_count` increment occurs for each actual execution attempt*, executed exclusively at atomic consumer lease acquisition (`status IN ('DISPATCHED', 'PENDING')`).<br>• **Transient Failure Double-Increment Elimination:** Completely eliminated duplicate attempt increments across all transient failure handlers (HTTP 429, 503, network timeouts). Transient handlers record `last_error`, calculate deterministic exponential backoff from the existing `attempt_count`, transition to `FAILED`, and schedule `next_attempt_at` without incrementing `attempt_count`.<br>• **Stale PROCESSING CAS Ownership Preservation:** Codified that stale recovery CAS claims recover ownership of an *already-counted execution attempt* and MUST NOT increment `attempt_count`. Differentiated starting a new execution attempt (+1 at consumer claim) from recovering an existing attempt (+0 at recovery CAS).<br>• **Crash Scenario 7 & Recovery Crash Loop Termination:** Formally specified Crash Scenario 7 and recovery worker crash handling. Codified that repeated recovery crashes transition deterministically: bounded to 1 recovery per attempt; if recovery crashes, the subsequent sweep marks the attempt failed and either schedules a new counted execution attempt ($N+1$) or transitions to `DEAD_LETTER` if max attempts (5) are reached, mathematically preventing infinite crash/recovery loops.<br>• **Strict Bounded Execution & DLQ Rule:** Explicitly established the 5-attempt budget (Claim #1 $\to 1$, Claim #2 $\to 2$, Claim #3 $\to 3$, Claim #4 $\to 4$, Claim #5 $\to 5$). Prohibited Claim #6 (`attempt_count < 5` check). Formally defined exact terminal conditions for `DEAD_LETTER` routing upon transient failure, reconciliation absence, or ambiguous provider state at attempt 5.<br>• **Google Tasks Attempt Tier Reconciliation:** Synchronized Section 10.3.3 A2 search tiers to canonical 1-based `attempt_count` (Tier 1 for $\le 1$, Tier 2 for $2$, Tier 3 for $3$, Tier 4 for $\ge 4$).<br>• **Acceptance Test Matrix Hardening:** Synchronized the 50-test suite to explicitly cover Tests A through J for lease acquisition, retry backoff, stale recovery, crash loops, DLQ termination, and Tasks search tiers.<br>• **Contract Authority Confirmation:** Confirmed that **Technical Contracts v1.1 remains authoritative and unchanged.** |

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
- **Transactional Outbox Engine:** Durable outbox dispatching on `sync_jobs` with automatic dual-sweep background reconciliation via Cloudflare Cron Triggers to guarantee zero lost jobs upon worker crashes or queue enqueue failures.
- **Deterministic Processing Lease Engine:** Atomic 120-second conditional execution leases on `sync_jobs` with CAS-based stale recovery and pre-retry provider state reconciliation.
- **Projection Engine:** Deterministic state projection handlers for `study_progress`, `daily_states`, and temporal memory, with full recomputation capabilities from canonical events.
- **Unified Cloudflare Worker:** Dual-interface service delivering a versioned REST API (`/v1/`) and a Remote Model Context Protocol (MCP) server conforming to **MCP 2026-07-28 Streamable HTTP**.
- **Asynchronous Sync Pipeline:** Cloudflare Queues (`SYNC_QUEUE` and `personal-sync-dlq`) with typed message envelopes and consumer-side mutation deduplication.
- **Provider Adapters:**
  - *Google Tasks Adapter:* Date-only synchronization with cron-based `updatedMin` polling, 4-tier expanding window lost-ack reconciliation, full pagination traversal, and deterministic note metadata tagging.
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
3. **Personal AI Study OS — Production Implementation Specification v1.2.3** (This document — authoritative for database schemas, algorithms, and engineering implementation).
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
│       │   ├── google-tasks.ts     # Polling adapter, updatedMin parser, expanding lost-ack search
│       │   ├── google-calendar.ts  # Deterministic event IDs, ETag extraction, If-Match retry loop
│       │   └── notion.ts           # Webhook receiver, HMAC verification, object refetch, throttler
│       ├── tsconfig.json
│       └── package.json
├── tests/                          # Automated test suites
│   ├── unit/                       # Pure logic: Zod schemas, hash calculation, projection math
│   ├── contract/                   # Event schemas, REST contracts, MCP schemas, migration tests
│   ├── integration/                # Miniflare D1 batch tests, Queue consumer idempotency tests
│   └── e2e/                        # Vitest E2E workflows matching 50 acceptance scenarios
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
    provider TEXT NOT NULL DEFAULT 'google_tasks', -- Provider identifier
    tasklist_id TEXT NOT NULL,                     -- Google Task List ID
    task_id TEXT NOT NULL,                         -- External Google Tasks ID
    entity_type TEXT NOT NULL,                     -- Canonical target type: 'chapter', 'project'
    entity_id TEXT NOT NULL,                       -- ID of linked chapter or project
    title_snapshot TEXT,                           -- Last known task title
    status_snapshot TEXT,                          -- Last known status: 'needsAction', 'completed'
    last_synced_at TEXT,                           -- ISO 8601 UTC timestamp of last sync
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider, tasklist_id, task_id)
);
CREATE INDEX idx_task_links_entity ON task_links(entity_type, entity_id);

CREATE TABLE calendar_links (
    id TEXT PRIMARY KEY,                           -- callink_01J...
    provider TEXT NOT NULL DEFAULT 'google_calendar',
    calendar_id TEXT NOT NULL,                     -- Google Calendar ID
    event_id TEXT NOT NULL,                        -- External Google Calendar Event ID
    entity_type TEXT NOT NULL,                     -- 'study_session', 'task'
    entity_id TEXT NOT NULL,                       -- ID of linked study session or task
    title_snapshot TEXT,                           -- Event summary snapshot
    starts_at TEXT NOT NULL,                       -- ISO 8601 UTC start time
    ends_at TEXT NOT NULL,                         -- ISO 8601 UTC end time
    status_snapshot TEXT,                          -- 'confirmed', 'tentative', 'cancelled'
    last_synced_at TEXT,                           -- ISO 8601 UTC timestamp of last sync
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider, calendar_id, event_id)
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
    attempt_count INTEGER NOT NULL DEFAULT 0,      -- Total number of execution attempts initiated (incremented once at consumer claim)
    next_attempt_at TEXT,                          -- ISO 8601 UTC after which retry is permitted
    dispatched_at TEXT,                            -- ISO 8601 UTC timestamp when enqueued to Queue
    processing_started_at TEXT,                    -- ISO 8601 UTC timestamp when processing lease was claimed
    last_error TEXT,                               -- Last caught exception or HTTP status snippet
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT                              -- ISO 8601 UTC timestamp of completion
);
CREATE INDEX idx_sync_jobs_status ON sync_jobs(status, next_attempt_at);
CREATE INDEX idx_sync_jobs_idempotency ON sync_jobs(idempotency_key);
CREATE INDEX idx_sync_jobs_outbox ON sync_jobs(status, dispatched_at);
CREATE INDEX idx_sync_jobs_stale_processing ON sync_jobs(status, processing_started_at);

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

## 9. Transactional-Outbox & Deterministic Processing Lease Contract

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

### 9.2 Durable Dispatcher & Dual-Sweep Reconciliation Mechanism
The architecture employs a **Transactional Outbox / Durable Dispatcher pattern** built entirely on existing infrastructure (**Cloudflare D1 + Cloudflare Cron Triggers + Cloudflare Queues**), requiring zero external message brokers.

A Cloudflare Cron Trigger executes every 60 seconds (`* * * * *`) running two deterministic, bounded queries:

```text
[ Periodic Cron Trigger (Every 60 Seconds) ]
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
  [ Sweep Query 1:        [ Sweep Query 2:
   Undispatched Outbox]    Stale PROCESSING Recovery]
         │                       │
         ▼                       ▼
  SELECT * FROM           SELECT * FROM
  sync_jobs WHERE         sync_jobs WHERE
  (status='PENDING'       status='PROCESSING'
   AND dispatched_at      AND processing_started_at
   IS NULL AND            <= datetime('now', '-120 seconds')
   created_at <=          ORDER BY
   datetime('now',        processing_started_at ASC
   '-30 seconds'))        LIMIT 50;
  OR (status='FAILED'            │
   AND next_attempt_at           ▼
   <= datetime('now'))    [ Atomic CAS Recovery Claim ]
  ORDER BY created_at     UPDATE sync_jobs SET
  ASC LIMIT 50;           processing_started_at = now(),
         │                last_error = 'RECOVERY_IN_PROGRESS'
         ▼                WHERE job_id = ? AND status = 'PROCESSING'
  SYNC_QUEUE.send(...)    AND processing_started_at = :orig_ts;
         │                (attempt_count remains N, NOT incremented)
         ▼                       │
  UPDATE sync_jobs        ┌──────┴──────┐
  SET status=             ▼ (changes=1) ▼ (changes=0)
  'DISPATCHED',           [ Execute     [ Yield: Another
  dispatched_at=now()     Provider      Worker Claimed ]
                          Reconciliation]
```

#### Sweep Query 1: Undispatched Outbox & Retry Candidates
```sql
SELECT * FROM sync_jobs
WHERE (status = 'PENDING' AND dispatched_at IS NULL AND created_at <= datetime('now', '-30 seconds'))
   OR (status = 'FAILED' AND next_attempt_at <= datetime('now'))
ORDER BY created_at ASC LIMIT 50;
```

#### Sweep Query 2: Stale PROCESSING Recovery Candidates
```sql
SELECT * FROM sync_jobs
WHERE status = 'PROCESSING'
  AND processing_started_at <= datetime('now', '-120 seconds')
ORDER BY processing_started_at ASC LIMIT 50;
```

---

### 9.3 Deterministic Processing Lease Protocol

To prevent multiple queue consumers or recovery workers from simultaneously executing duplicate mutations on external providers, execution ownership is governed by a strict, deterministic processing lease protocol:

#### B0. Canonical `attempt_count` Definition & Single-Increment Invariant
- **Definition:** `attempt_count` represents **the total number of execution attempts initiated for a sync job**.
- **The Invariant:** **Exactly one `attempt_count` increment occurs for each actual execution attempt.**
- **The Exclusive Increment Point:** This increment occurs atomically and exclusively when a consumer successfully acquires the execution lease via the conditional claim query (`status IN ('DISPATCHED', 'PENDING')`).
- **The Zero-Increment Invariant:** No provider error handler (HTTP 429, 503, network timeout), reconciliation handler, or recovery CAS query may increment `attempt_count`.
- **Canonical Execution Flow:**
  ```text
  Consumer Claim   → attempt_count + 1 (Initiates and counts NEW execution attempt)
  429/503/Timeout  → attempt_count + 0 (Calculates backoff from existing count, transitions to FAILED)
  Recovery CAS     → attempt_count + 0 (Recovers ownership of ALREADY-COUNTED execution attempt)
  Future Claim     → attempt_count + 1 (Initiates and counts subsequent execution attempt)
  ```

#### B1. Authoritative Lease Duration
```text
PROCESSING_LEASE_SECONDS = 120 (2 minutes)
```
The lease duration is **exactly 120 seconds**. This value provides a guaranteed 4x buffer over the strict 30-second subrequest abort timeout enforced on all outbound provider HTTP calls (`AbortController`), ensuring that an active worker will always terminate or time out well before its lease expires.

#### B2. Single Authoritative Stale Predicate
A job in `sync_jobs` is defined as stale if and only if it satisfies:
```sql
status = 'PROCESSING' AND processing_started_at <= datetime('now', '-120 seconds')
```
This single definition is authoritative across the entire system.

#### B3. Atomic Consumer Lease Claim
When a queue consumer pulls a message from `SYNC_QUEUE` and verifies that `idempotency_records` is not already `COMPLETED`, it MUST execute an atomic conditional claim before invoking any provider adapter:

```sql
UPDATE sync_jobs
SET
    status = 'PROCESSING',
    processing_started_at = CURRENT_TIMESTAMP,
    attempt_count = attempt_count + 1,
    last_error = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE
    job_id = ?
    AND status IN ('DISPATCHED', 'PENDING');
```

- **Ownership Invariant:** The consumer acquires processing ownership **if and only if** `changes === 1`.
- **Atomic Counting:** This transition increments `attempt_count` exactly once for this execution attempt.
- **Claim Failure:** If `changes === 0`, another consumer claimed the job or it was completed concurrently; the consumer calls `msg.ack()` and terminates immediately without calling any external API.
- **No Subsequent Increments:** No later step in this same execution attempt may increment `attempt_count`.

#### B4. Atomic Compare-And-Set (CAS) Recovery Ownership
When the Cron Dispatcher (Sweep Query 2) discovers a stale job, it MUST NOT blindly retry the mutation. It claims exclusive recovery ownership of the **already-counted execution attempt** via an atomic compare-and-set query:

```sql
UPDATE sync_jobs
SET
    processing_started_at = CURRENT_TIMESTAMP,
    last_error = 'RECOVERY_IN_PROGRESS',
    updated_at = CURRENT_TIMESTAMP
WHERE
    job_id = ?
    AND status = 'PROCESSING'
    AND processing_started_at = :original_processing_started_at;
```

- **Zero-Increment Recovery:** Stale PROCESSING recovery is recovering ownership of an execution attempt that was already counted when the original consumer claim occurred. Therefore, the CAS recovery query **MUST NOT** increment `attempt_count`. `attempt_count` remains $N$.
- **Race Elimination:** If two recovery workers or an active consumer race to recover the same stale job, only the worker whose query matches `:original_processing_started_at` obtains `changes === 1`.
- **Yield on Conflict:** If `changes === 0`: The worker yields immediately. Application-level "check then update" logic is strictly forbidden.

#### B5. Mandatory Provider Reconciliation Before Retry
A stale job that has been claimed for recovery **MUST NEVER** blindly re-execute the provider mutation. The recovery runner must execute provider-specific reconciliation to inspect remote reality first:

```text
STALE PROCESSING (Claimed via CAS, attempt_count = N unchanged)
               │
               ▼
[ Provider Reconciliation Check ]
(Calendar GET deterministic ID / Tasks updatedMin list / Notion OS_Entity_ID query)
               │
      ┌────────┼────────┐
      ▼        ▼        ▼
  [APPLIED] [ABSENT] [UNCERTAIN]
      │        │        │
      │        │        └─── Check attempt_count:
      │        │               ├── If attempt_count >= 5: Mark DEAD_LETTER, route to DLQ
      │        │               └── If attempt_count < 5: Mark FAILED, next_attempt_at = now + backoff, yield
      │        │
      │        └─── Check attempt_count:
      │               ├── If attempt_count >= 5: Mark DEAD_LETTER, route to DLQ
      │               └── If attempt_count < 5: Schedule new attempt -> Mark DISPATCHED, re-enqueue SYNC_QUEUE
      │
      └─── Mark sync_jobs & idempotency_records COMPLETED, update links, ack job
```

- **Mutation Applied Remotely:** If reconciliation verifies that the external mutation succeeded, the recovery runner marks `sync_jobs` and `idempotency_records` as `COMPLETED`, updates links, and acknowledges the job. No additional attempt increment occurs.
- **Mutation Absent Remotely:** The already-counted attempt has concluded with zero side-effects.
  - If `attempt_count < 5`: The recovered job may be scheduled for a **new execution attempt**. It transitions to `status = 'DISPATCHED'`, `dispatched_at = CURRENT_TIMESTAMP`, and is re-enqueued into `SYNC_QUEUE`. When a future consumer claims this job, `attempt_count` increments from $N$ to $N+1$.
  - If `attempt_count >= 5`: The execution attempt budget is exhausted. The job transitions directly to `DEAD_LETTER` and is routed to `personal-sync-dlq`.
- **Provider Reconciliation Uncertain (HTTP 429 / 5xx / Timeout):** The recovery runner cannot confirm whether the mutation happened:
  - If `attempt_count < 5`: Mark `status = 'FAILED'`, `last_error = 'RECONCILIATION_UNCERTAIN: ' || err.message`, calculate exponential backoff from existing `attempt_count`, and set `next_attempt_at = datetime('now', '+' || backoff || ' seconds')`. When backoff elapses, Sweep Query 1 redispatches it, and the next consumer claim will be Attempt $N+1$.
  - If `attempt_count >= 5`: Mark `status = 'DEAD_LETTER'`, `last_error = 'AMBIGUOUS_PROVIDER_STATE_MAX_ATTEMPTS_EXHAUSTED'`, and route to DLQ. Blind creation is strictly forbidden.

#### B6. Lease Renewal Stance
```text
INVARIANT: Lease renewal is STRICTLY NOT SUPPORTED in Version 1.
```
In serverless Cloudflare Workers, long-lived background heartbeat threads do not exist. Outbound provider requests are strictly bounded by a 30-second `AbortSignal`. Because `PROCESSING_LEASE_SECONDS = 120`, every running worker is guaranteed to conclude or fail within 30 seconds. Fixed, non-renewable leases prevent orphaned heartbeat loops. If a worker crashes hard (isolate termination or OOM), the job remains in `PROCESSING` until the full 120-second lease expires, after which Sweep Query 2 recovers it safely.

#### B7. Terminal-State Safety Invariant & Recovery Crash Loop Elimination
The execution lifecycle is strictly bounded by a mathematical budget of **at most 5 execution attempts**:

```text
Job Created:      attempt_count = 0
Claim #1:         attempt_count = 1
Claim #2:         attempt_count = 2
Claim #3:         attempt_count = 3
Claim #4:         attempt_count = 4
Claim #5:         attempt_count = 5

No Claim #6 is permitted. (attempt_count < 5 evaluates to false)
If Attempt #5 fails or cannot safely complete: DEAD_LETTER.
```

1. **Transient Failure Handling:** The execution attempt has already been counted atomically at lease acquisition (`Step B3`). Transient failure handling (HTTP 429, 503, timeout) **MUST NOT** increment `attempt_count`. If `attempt_count < 5`, it records `last_error`, computes deterministic exponential backoff ($5s, 10s, 20s, 40s$) based on `attempt_count`, updates `status = 'FAILED'`, and schedules `next_attempt_at`. If `attempt_count >= 5`, it transitions directly to `DEAD_LETTER`.
2. **Terminal DLQ Transition:** When `attempt_count >= 5`, no further execution attempts may be scheduled or claimed. The job is routed to `personal-sync-dlq` and updated in D1:
   ```sql
   UPDATE sync_jobs
   SET status = 'DEAD_LETTER',
       last_error = :terminal_error_reason,
       completed_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
   WHERE job_id = ?;
   ```
3. **Recovery Crash Loop Elimination Protocol:**
   To prevent an infinite crash loop where a recovery worker repeatedly claims a stale job and crashes before completing reconciliation, the system enforces a strict **one-recovery-per-attempt** limit:
   - When a recovery worker claims CAS ownership, it sets `processing_started_at = CURRENT_TIMESTAMP` and records `last_error = 'RECOVERY_IN_PROGRESS'`.
   - If the recovery worker crashes mid-reconciliation, the job remains in `status = 'PROCESSING'` until the 120-second lease expires.
   - When Sweep Query 2 discovers a stale job that satisfies `status = 'PROCESSING'` and `processing_started_at <= now - 120s`, it inspects `last_error`:
     - If `last_error = 'RECOVERY_IN_PROGRESS'`, a prior recovery worker crashed during this attempt's recovery.
     - The recovery sweep runner declares Attempt $N$ definitively failed.
     - If `attempt_count >= 5`: The sweep runner immediately updates `status = 'DEAD_LETTER'`, `last_error = 'RECOVERY_CRASH_LOOP_MAX_ATTEMPTS'`, `completed_at = CURRENT_TIMESTAMP` and routes the job to `personal-sync-dlq`.
     - If `attempt_count < 5`: The sweep runner breaks the crash loop by transitioning the job to `status = 'FAILED'`, `last_error = 'RECOVERY_WORKER_CRASHED'`, `next_attempt_at = datetime('now', '+30 seconds')`.
     - When `next_attempt_at` arrives, Sweep Query 1 redispatches the job (`status = 'DISPATCHED'`), and a consumer claim will initiate and count a **new execution attempt** ($N+1$).
   - This protocol mathematically guarantees that repeated worker crashes cannot loop indefinitely without consuming the execution attempt budget.

---

### 9.4 Outbox State Lifecycle Overview

| State | Definition & Ownership | Next Permitted States |
| :--- | :--- | :--- |
| **`PENDING`** | Durably written to D1; awaits in-line dispatch or cron sweep pickup. `attempt_count = 0`. | `DISPATCHED`, `PROCESSING` (fast path) |
| **`DISPATCHED`** | Accepted by `SYNC_QUEUE`; awaits consumer pull. | `PROCESSING` |
| **`PROCESSING`** | Claimed by an active consumer (`attempt_count = N`) or recovery worker under a 120-second lease. | `COMPLETED`, `FAILED`, `DEAD_LETTER`, `DISPATCHED` (via recovery) |
| **`COMPLETED`** | External mutation verified and acknowledged; `idempotency_records` updated. | *Terminal state* |
| **`FAILED`** | Transient error encountered (429, 5xx); backoff scheduled in `next_attempt_at`. `attempt_count` unchanged. | `DISPATCHED` (via sweep) |
| **`DEAD_LETTER`**| Exceeded 5 execution attempts; routed to `personal-sync-dlq` for human operator inspection. | *Terminal state* |

---

### 9.5 Normative 7 Crash Scenarios Matrix

| Scenario # | Crash Point Description | D1 State at Crash | External Provider State | Detection Mechanism | Recovery Action & State Transition | Terminal Guarantee |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Worker crash after D1 batch commit, before Queue enqueue** | `status = 'PENDING'`, `dispatched_at IS NULL` (`attempt_count = 0`) | Nothing invoked | Sweep Query 1 discovers `PENDING` with `created_at <= now - 30s` | Dispatcher sends message to `SYNC_QUEUE`, updates `status = 'DISPATCHED'`, `dispatched_at = now()` | Enqueued for processing; reaches `COMPLETED` or `DEAD_LETTER` |
| **2** | **Worker crash after Queue enqueue, before D1 `DISPATCHED` update** | `status = 'PENDING'`, `dispatched_at IS NULL` (message in Queue) | Nothing invoked | Message delivered to consumer; or discovered by Sweep Query 1 | Consumer claims lease using `status IN ('DISPATCHED', 'PENDING')`; dual dispatch deduplicated by consumer | Consumer claims exactly once; second delivery deduplicated via idempotency records |
| **3** | **Consumer crash immediately after claiming lease, before provider API call** | `status = 'PROCESSING'`, `attempt_count = N`, `processing_started_at = T0` | Nothing invoked | Sweep Query 2 discovers `status = 'PROCESSING'` and `now >= T0 + 120s` | CAS recovery claim preserves `attempt_count = N`; reconciliation confirms remote entity absent; if `attempt_count < 5` transitions to `DISPATCHED` (or `FAILED` retry candidate) where next claim increments to $N+1$; if `attempt_count >= 5` transitions to `DEAD_LETTER` | Guaranteed terminal state via strict `attempt_count` bound ($\le 5$) |
| **4** | **Consumer crash while external provider API call is in-flight** | `status = 'PROCESSING'`, `attempt_count = N`, `processing_started_at = T0` | Unknown (may have executed, timed out, or dropped) | Sweep Query 2 discovers `status = 'PROCESSING'` and `now >= T0 + 120s` | CAS recovery claim preserves `attempt_count = N`; executes provider reconciliation: if found $\to$ `COMPLETED`; if absent $\to$ if `attempt_count < 5` schedules retry (next claim becomes $N+1$), else `DEAD_LETTER` | No duplicate external mutation; reaches `COMPLETED` or `DEAD_LETTER` |
| **5** | **Consumer crash after provider mutation succeeds, before D1 `COMPLETED` update** | `status = 'PROCESSING'`, `attempt_count = N`, `idempotency_records = 'PENDING'` | Successfully executed in provider | Sweep Query 2 discovers `status = 'PROCESSING'` and `now >= T0 + 120s` | CAS recovery claim preserves `attempt_count = N`; reconciliation verifies remote presence; marks `sync_jobs` and `idempotency_records` as `COMPLETED` | Successfully resolved to `COMPLETED` without repeating provider call |
| **6** | **Consumer crash after D1 updated to `COMPLETED`, before `msg.ack()`** | `status = 'COMPLETED'`, `idempotency_records = 'COMPLETED'` | Successfully executed | Cloudflare Queue redelivers un-acked message | Consumer Step 3 checks `idempotency_records`, finds `COMPLETED`, calls `msg.ack()` and exits | Zero duplicate provider calls; message acknowledged |
| **7** | **Crash of recovery worker during stale recovery / reconciliation** | `status = 'PROCESSING'`, `attempt_count = N`, `processing_started_at = T1`, `last_error = 'RECOVERY_IN_PROGRESS'` | Remote state remains static | Subsequent Sweep Query 2 discovers `status = 'PROCESSING'`, `now >= T1 + 120s`, and `last_error = 'RECOVERY_IN_PROGRESS'` | Recovery crash detected. Single recovery per attempt enforced. If `attempt_count < 5`: transitions to `FAILED` with backoff; Sweep Query 1 redispatches for a new counted attempt ($N+1$ on next claim). If `attempt_count >= 5`: transitions to `DEAD_LETTER` | Handled deterministically; bounded by $\le 5$ execution attempts; infinite recovery loop mathematically prevented |

---

## 10. Provider-Specific External Mutation Idempotency

Generic statements such as "ETags make mutations idempotent" are architecturally insufficient. Each external provider exhibits distinct API capabilities, concurrency models, and lost-acknowledgement behaviors.

### 10.1 Master Provider Idempotency Matrix

| Provider | Provider Identity Key | Create Idempotency | Update Concurrency | Lost-Ack Recovery |
| :--- | :--- | :--- | :--- | :--- |
| **Google Calendar** | `provider` + `calendar_id` + `event_id` | Deterministic external event ID (`base32hex`) | `ETag` + `If-Match` header | Lookup existing event by deterministic ID via `GET` |
| **Google Tasks** | `provider` + `tasklist_id` + `task_id` | Deterministic metadata token in notes + 4-tier expanding window search | Provider state reconciliation (GET & compare) | Exhaustive paginated search for metadata token |
| **Notion** | `provider` + `page_id` / `database_id` | Deterministic `OS_Entity_ID` property lookup via database query | Latest-state reconciliation (fetch properties & `last_edited_time`) | Lookup existing page by stored Notion page ID or entity property filter |

---

### 10.2 Google Calendar Integration Contract
- **Identity Scope:** Calendar events are uniquely identified across the system by `(provider, calendar_id, event_id)`.
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

---

### 10.3 Google Tasks Integration Contract (Authoritative v1.2.3 Hardened)

#### 10.3.1 Identity Scope & Server-Assigned ID Constraint
- **Identity Scope:** Google Tasks entities are uniquely identified by `(provider, tasklist_id, task_id)`.
- **Server-Assigned IDs:** Google Tasks `POST /tasks/v1/lists/{tasklist}/tasks` does **not** allow client-assigned task IDs or HTTP idempotency keys. All IDs are generated server-side.
- **Normative Rule:** There is **no fixed 5-minute search rule anywhere in the normative implementation specification**. Lost-acknowledgement recovery is governed strictly by the deterministic expanding-horizon algorithm defined below.

#### 10.3.2 Deterministic Metadata Token Standard
Because client-specified IDs are not supported, every task creation MUST embed a deterministic, machine-parseable metadata token within the task `notes` string:

```text
[study-os:entity_id:<entity_id>:idempotency_key:<idempotency_key>]
```

- **Formal Regular Expression:**
  ```regex
  /\[study-os:entity_id:([a-zA-Z0-9_\-]+):idempotency_key:([a-zA-Z0-9_\-]+)\]/
  ```
- **Token Positioning:** The token MUST be appended to the end of user-facing notes, separated from user content by a double newline (`\n\n`). If user notes are empty, the token constitutes the entire `notes` field.
- **Token Preservation:** Any subsequent `PATCH` or update modifying task notes MUST retain this exact token unchanged.

#### 10.3.3 Deterministic Expanding Reconciliation Horizon Algorithm
If a `tasks.insert` call fails due to a network timeout, worker crash, or connection drop, the queue consumer on redelivery MUST execute an exhaustive reconciliation query against `GET /tasks/v1/lists/{tasklist}/tasks` before attempting creation:

##### A1. Search Horizon Anchor ($T_{\text{origin}}$)
The reconciliation horizon is strictly anchored to the job's canonical creation timestamp (`sync_jobs.created_at`), **NEVER** to the floating current execution time (`now()`). Anchoring to `created_at` guarantees that even if a job is delayed in the queue for hours, its creation window is never missed.

##### A2. Deterministic 4-Tier Expansion Schedule
The `updatedMin` parameter expands deterministically based on `sync_jobs.attempt_count` (the canonical 1-based execution attempt number):

```text
Tier 1 (attempt_count <= 1): updatedMin = ISO8601(sync_jobs.created_at - 5 minutes)
Tier 2 (attempt_count = 2):  updatedMin = ISO8601(sync_jobs.created_at - 30 minutes)
Tier 3 (attempt_count = 3):  updatedMin = ISO8601(sync_jobs.created_at - 2 hours)
Tier 4 (attempt_count >= 4): updatedMin = ISO8601(sync_jobs.created_at - 24 hours)
```

- *Canonical Attempt Alignment:* There is zero discrepancy between zero-based and one-based models: `attempt_count` in D1 represents the exact execution attempt number (1 for the first execution attempt, 2 for the second, up to 5 for the fifth). An unexecuted job has `attempt_count = 0` and falls into Tier 1.
- *Rationale for Tier 1 (5 minutes):* Provides immediate, high-efficiency coverage for 99% of lost-ack scenarios caused by network blips or subrequest timeouts immediately following job creation, absorbing normal clock skew between Cloudflare edge workers and Google servers without scanning irrelevant history.
- *Rationale for Expansion:* Accommodates prolonged queue delays, DLQ replays, or temporary provider rate limiting where the task was created during an earlier attempt.

##### A3. Maximum Reconciliation Horizon
```text
MAX_RECONCILIATION_HORIZON = 24 hours
```
Queries with `updatedMin` earlier than `sync_jobs.created_at - 24 hours` are strictly prohibited. This aligns directly with `idempotency_records.expires_at` TTL (24 hours). Unbounded historical searches are strictly forbidden.

##### A4. Complete Pagination Traversal Loop
The adapter MUST exhaustively traverse all returned pages:
```text
while nextPageToken exists:
    call tasks.list(tasklistId, pageToken, updatedMin, maxResults=100)
```
- Query parameters MUST include:
  - `maxResults = 100` (minimizes subrequest count).
  - `showCompleted = true` (ensures completed tasks are visible).
  - `showHidden = true` (ensures hidden tasks are visible).
  - `showDeleted = false` (ignores deleted tombstones).
- The adapter MUST inspect every returned task across all pages within the current reconciliation window. It must never stop after the first page unless a matching token is found.
- **Safety Ceiling:** Pagination is bounded at a maximum of 5 pages (500 tasks). If 5 pages are consumed without reaching `nextPageToken === undefined` or finding the token, the search halts and triggers the Ambiguous Provider State protocol.

##### A5. Search Matching Semantics
For each retrieved task, the adapter inspects `task.notes`:
1. **Exact Token Match:** `task.notes` contains the exact token `[study-os:entity_id:<entity_id>:idempotency_key:<idempotency_key>]`. $\to$ Trigger Existing-Task Adoption (A8).
2. **No Match:** All pages traversed, zero matching tokens found. $\to$ Safe-Create Gate (A7).
3. **Provider Query Failure:** HTTP 429, 5xx, or network timeout. $\to$ Ambiguous Provider State (A6).
4. **Incomplete Search Result:** Pagination halted by safety ceiling before reaching end. $\to$ Ambiguous Provider State (A6).

##### A6. Ambiguous Provider State Protocol (Fail-Safe Yielding)
```text
CRITICAL INVARIANT: UNCERTAIN -> NO BLIND CREATE -> RETRY/RECONCILE LATER
```
If the adapter cannot definitively verify whether the task was created:
- **HTTP 429 (Rate Limit):** The execution attempt has already been counted atomically at lease acquisition. The adapter aborts immediately **without incrementing `attempt_count`**.
  - If `attempt_count < 5`: The adapter records `sync_jobs.last_error`, calculates deterministic exponential backoff from the existing `attempt_count` ($5s, 10s, 20s, 40s$), sets `next_attempt_at`, updates `sync_jobs.status = 'FAILED'`, and calls `msg.retry({ delaySeconds })`. `tasks.insert` is **NEVER** called.
  - If `attempt_count >= 5`: The adapter transitions the job directly to `DEAD_LETTER`, records `last_error = 'RATE_LIMIT_MAX_ATTEMPTS_EXHAUSTED'`, and routes to `personal-sync-dlq`.
- **HTTP 5xx / Network Timeout:** The execution attempt has already been counted. The adapter captures the error, records `sync_jobs.last_error`, and throws a retryable exception **without incrementing `attempt_count`**. If `attempt_count >= 5`, transitions to `DEAD_LETTER`. `tasks.insert` is **NEVER** called.
- **Pagination Ceiling Reached (500 tasks):** The adapter yields with a retryable error without incrementing `attempt_count`, preventing a catastrophic duplicate creation storm. If `attempt_count >= 5`, routes to DLQ.
- **Uncertainty Conversion Forbidden:** The adapter must **NEVER** convert an error, timeout, or incomplete search into a "no match" outcome.

##### A7. Safe-Create Condition
`tasks.insert` is permitted **IF AND ONLY IF** all of the following conditions evaluate to TRUE:
```text
1. tasks.list completed successfully with HTTP 200 OK across all queried pages.
AND
2. All pages were exhaustively consumed (nextPageToken reached undefined).
AND
3. Every retrieved task's notes were scanned, and ZERO matching deterministic tokens exist.
AND
4. task_links in D1 does not already contain an active row for (provider, tasklist_id, entity_type, entity_id).
AND
5. Provider state is considered authoritative and known.
```
If any condition is false: **DO NOT CREATE.**

##### A8. Existing-Task Adoption Protocol
When a matching deterministic token is found:
1. Extract the remote task's `id`, `title`, and `status` (`needsAction` or `completed`).
2. Execute an atomic D1 batch updating machine truth:
   ```sql
   INSERT INTO task_links (
       id, provider, tasklist_id, task_id, entity_type, entity_id,
       title_snapshot, status_snapshot, last_synced_at, created_at, updated_at
   ) VALUES (?, 'google_tasks', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
   ON CONFLICT(provider, tasklist_id, task_id) DO UPDATE SET
       title_snapshot = excluded.title_snapshot,
       status_snapshot = excluded.status_snapshot,
       last_synced_at = datetime('now'),
       updated_at = datetime('now');

   UPDATE idempotency_records
   SET status = 'COMPLETED', result_payload = ?, updated_at = datetime('now')
   WHERE idempotency_key = ?;

   UPDATE sync_jobs
   SET status = 'COMPLETED', completed_at = datetime('now'), updated_at = datetime('now')
   WHERE job_id = ?;
   ```
3. Acknowledge the queue message (`msg.ack()`) and exit immediately. **Never create another task.**

##### A9. UPDATE Concurrency & State Reconciliation
Google Tasks does not support `If-Match` ETags. Concurrency control for mutations is achieved via **Provider State Reconciliation**:
1. Call `GET /tasks/v1/lists/{tasklist}/tasks/{taskId}`.
   - On **HTTP 404:** The task was deleted externally. Mark `task_links.status_snapshot = 'deleted'`, complete `sync_jobs`, emit `task_external_deleted` event.
   - On **HTTP 429/5xx:** Yield and retry with backoff.
2. Compare remote `status`, `title`, and `due` date with requested mutation:
   - If already equal: Skip PATCH, update `task_links.last_synced_at`, acknowledge message.
   - If divergent: Apply `PATCH /tasks/v1/lists/{tasklist}/tasks/{taskId}` preserving the deterministic metadata token in `notes` and normalizing `due` to date-only format (`YYYY-MM-DDT00:00:00.000Z`).

---

### 10.4 Notion Integration Contract
- **Identity Scope:** Notion entities are scoped by `(provider, page_id)` or `(provider, database_id)`.
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

### 10.5 Cross-Provider Stale Recovery Reconciliation Workflow

When a stale job is claimed for recovery under Section 9.3, the recovery runner invokes provider-specific reconciliation according to the following unified contract:

```typescript
export async function reconcileStaleJob(
  job: SyncJob,
  adapters: ProviderAdapters,
  db: DatabaseClient
): Promise<'COMPLETED' | 'RETRY' | 'UNCERTAIN'> {
  switch (job.target_system) {
    case 'google_calendar': {
      const deterministicId = generateDeterministicCalendarId(job.idempotency_key);
      const result = await adapters.calendar.getEvent(job.payload.calendarId, deterministicId);
      if (result.status === 200) {
        await markJobCompleted(db, job, result.data);
        return 'COMPLETED';
      }
      if (result.status === 404) return 'RETRY';
      return 'UNCERTAIN';
    }

    case 'google_tasks': {
      const result = await adapters.tasks.reconcileTaskSearch(
        job.payload.tasklistId,
        job.entity_id,
        job.idempotency_key,
        job.created_at,
        job.attempt_count
      );
      if (result.matchedTask) {
        await markJobCompleted(db, job, result.matchedTask);
        return 'COMPLETED';
      }
      if (result.exhaustivelyNotFound) return 'RETRY';
      return 'UNCERTAIN';
    }

    case 'notion': {
      const result = await adapters.notion.queryByEntityId(job.payload.databaseId, job.entity_id);
      if (result.foundPage) {
        await markJobCompleted(db, job, result.foundPage);
        return 'COMPLETED';
      }
      if (result.exhaustivelyNotFound) return 'RETRY';
      return 'UNCERTAIN';
    }
  }
}
```

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
   - *Description:* Manually triggers the outbox dispatcher to sweep undispatched `sync_jobs` and recover stale processing jobs.
   - *Headers:* `Authorization: Bearer <ADMIN_JWT>`.
   - *Response:* `200 OK` with `{ dispatched_count: number, recovered_count: number }`.

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

### 16.2 Consumer Execution Logic (v1.2.3 Hardened)
The worker's `queue` handler processes batches with deduplication, atomic lease claims, and strict attempt count governance:
1. Iterates over messages in `batch.messages`.
2. Extracts typed `QueueMessageEnvelope` containing `jobId` and `idempotencyKey`.
3. **Idempotency Check:** Queries `idempotency_records` using `idempotencyKey` (NOT `jobId`). If `status === 'COMPLETED'`, calls `msg.ack()` and skips processing.
4. **Atomic Processing Lease Claim:** Executes atomic conditional update to claim execution lease and initiate a NEW execution attempt:
   ```sql
   UPDATE sync_jobs
   SET status = 'PROCESSING',
       processing_started_at = CURRENT_TIMESTAMP,
       attempt_count = attempt_count + 1,
       last_error = NULL,
       updated_at = CURRENT_TIMESTAMP
   WHERE job_id = ? AND status IN ('DISPATCHED', 'PENDING');
   ```
   - **Successful Acquisition (`changes === 1`):** Execution lease acquired; `attempt_count` is incremented exactly once for this execution attempt. No subsequent step in this execution attempt may increment `attempt_count`.
   - **Yield on Conflict (`changes === 0`):** Another consumer claimed or completed the job; call `msg.ack()` and terminate execution immediately.
5. **Provider Adapter Dispatch:** Calls target provider adapter (`GoogleTasksAdapter`, `GoogleCalendarAdapter`, `NotionAdapter`).
6. **Success Branch:** Updates `sync_jobs.status = 'COMPLETED'`, `idempotency_records.status = 'COMPLETED'`, `completed_at = CURRENT_TIMESTAMP`, and calls `msg.ack()`.
7. **Transient Failure Branch (HTTP 429/503/Timeout):** The execution attempt has already been counted at Step 4. Transient failure handling **MUST NOT increment `attempt_count` again**.
   - If `attempt_count < 5`: Calculates deterministic exponential backoff delay from the existing `attempt_count` ($5s, 10s, 20s, 40s$), updates `sync_jobs.status = 'FAILED'`, records `sync_jobs.last_error`, sets `next_attempt_at = datetime('now', '+' || delaySeconds || ' seconds')`, and calls `msg.retry({ delaySeconds })`.
   - If `attempt_count >= 5`: Max execution attempts exhausted. Proceeds immediately to Step 8.
8. **Terminal Failure Branch (Attempt 5 Exhausted):** If `attempt_count >= 5` and execution cannot complete, the message is routed to `personal-sync-dlq`; updates `sync_jobs.status = 'DEAD_LETTER'`, `completed_at = CURRENT_TIMESTAMP`, and records `last_error`.

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
  Create Git Release Tag (e.g. 'v1.2.3.0') via manual GitHub Release workflow
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

## 18. Authoritative Acceptance Test Suites (50 Scenarios)

The automated test matrix must implement and pass all **50 explicit acceptance test scenarios**:

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

### Stale PROCESSING & Lease Semantics Suite (13 Tests — Tests A through I)
9. **Exact Lease Expiry:** Processing lease expires precisely after 120 seconds; job is not considered stale at 119 seconds.
10. **Stale Detection via Sweep Query:** Stale recovery query correctly discovers jobs with `status = 'PROCESSING'` and `processing_started_at <= now - 120s`.
11. **Atomic Consumer Lease Claim Increments Once (Test A):** Consumer lease claim atomically transitions status from `DISPATCHED`/`PENDING` to `PROCESSING` and increments `attempt_count` from 0 to 1 (`changes === 1`); verified that no subsequent step in this execution attempt increments `attempt_count`.
12. **Transient Failure Preserves Attempt Count (Test B):** Simulating HTTP 429/503/timeout during execution captures error, records `last_error`, calculates exponential backoff from existing `attempt_count`, and transitions to `FAILED` with `attempt_count` remaining strictly at 1 without double-increment.
13. **Retry Claim Increments on Next Execution (Test C):** After transient failure, cron sweep redispatches job to `DISPATCHED`; subsequent consumer lease claim acquires lease and increments `attempt_count` from 1 to 2.
14. **Stale Recovery CAS Preserves Counted Attempt (Test D):** Consumer crashes during attempt 1 (`attempt_count = 1`); after 120s lease expiry, recovery runner claims stale job via atomic CAS; verified that CAS claim preserves `attempt_count = 1` without incrementing.
15. **Absent Mutation Recovery Schedules New Counted Attempt (Test E):** Stale recovery of attempt 1 confirms remote provider mutation was absent; runner re-schedules job (`status = 'DISPATCHED'`); subsequent consumer lease claim increments `attempt_count` to 2.
16. **Remote Mutation Applied Completes Without Increment:** Consumer crashes after remote mutation succeeded; stale recovery verifies presence of remote entity and transitions job and idempotency record directly to `COMPLETED` with `attempt_count` unchanged.
17. **Reconciliation Uncertainty Yields Without Increment:** Stale recovery encounters 429 or timeout during provider reconciliation; job transitions to `FAILED` with backoff; `attempt_count` is not incremented in the error handler.
18. **Recovery Worker Crash Loop Termination (Test F):** Recovery worker crashes during reconciliation (`last_error = 'RECOVERY_IN_PROGRESS'`); subsequent stale sweep detects previous recovery crash and terminates loop by transitioning to `FAILED` with retry backoff for a new counted attempt (or `DEAD_LETTER` if max attempts reached), preventing infinite loops.
19. **Concurrent Stale Recovery Race:** Two recovery runners simultaneously attempt to claim the same stale job; conditional CAS ensures exactly one succeeds (`changes === 1`) and the other yields (`changes === 0`).
20. **Bounded Execution Attempts (Tests G & H):** System strictly enforces a maximum of 5 execution attempts (Claim #1 through Claim #5); Claim #6 is mathematically prohibited; attempt 5 failure cannot create attempt 6.
21. **Deterministic DLQ Transition (Test I):** When attempt 5 encounters a transient failure or recovery confirms mutation absence/uncertainty at `attempt_count = 5`, job transitions immediately to `DEAD_LETTER` and is routed to `personal-sync-dlq`.

### Google Calendar Suite
22. **Deterministic Event ID Create Idempotency:** Submitting calendar create generates deterministic `base32hex` ID; simulated lost-ack retry catches HTTP 409 Conflict, fetches event, and completes safely.
23. **Successful ETag Update:** Updating a calendar session passes the correct `If-Match` ETag and succeeds with HTTP 200.
24. **HTTP 412 Conflict & Reconcile:** Concurrently modifying a calendar event triggers HTTP 412 Precondition Failed; adapter catches 412, refetches latest event, reconciles time blocks, and successfully updates.

### Google Tasks Suite (13 Tests — Test J)
25. **Initial Reconciliation Window Search (Tier 1) (Test J):** Simulating lost ack under `attempt_count <= 1` uses `updatedMin = job.created_at - 5 minutes` and retrieves task without duplicating.
26. **Second Execution Attempt Window Search (Tier 2) (Test J):** Simulating lost ack at `attempt_count = 2` uses expanded window `updatedMin = job.created_at - 30 minutes` and retrieves task.
27. **Horizon Expansion & Safety Ceiling (Tiers 3 & 4) (Test J):** Simulating lost ack at `attempt_count = 3` uses 2-hour window; at `attempt_count >= 4` uses maximum 24-hour window; search beyond 24 hours is rejected.
28. **Matching Task Found on Page 2+:** Reconciliation loop follows `nextPageToken` and successfully matches the deterministic token on subsequent pages.
29. **Complete Pagination Traversal:** Complete pagination loop executes until `nextPageToken` is undefined before concluding task does not exist.
30. **No-Match Safe Creation:** After full pagination traversal confirms zero matching tokens, `tasks.insert` executes safely.
31. **Timeout During Reconciliation:** Network timeout during `tasks.list` aborts execution, retains retryable state, and skips `tasks.insert`.
32. **Rate-Limit 429 During Reconciliation:** HTTP 429 during `tasks.list` defers message with exponential backoff without calling `tasks.insert` and without incrementing `attempt_count`.
33. **Provider 5xx Error During Reconciliation:** HTTP 500/503 during `tasks.list` prevents task creation and defers job without incrementing `attempt_count`.
34. **Ambiguous Provider State Prevents Blind Creation:** When provider state is uncertain, adapter never converts uncertainty into a create action.
35. **Duplicate Deterministic Token Prevention:** System correctly rejects creating multiple tasks with identical `[study-os:entity_id:...:idempotency_key:...]` tokens.
36. **Existing Task Adoption on Match:** Finding matching token adopts external ID, updates `task_links`, marks `idempotency_records` and `sync_jobs` `COMPLETED`, and acknowledges job.
37. **Update-State Reconciliation:** Adapter fetches remote task before calling PATCH; if remote status already matches desired state, PATCH is skipped.

### Notion Suite
38. **Deterministic Property Create Reconciliation:** Database query for `OS_Entity_ID` detects existing page on retry, linking existing ID without creating duplicate page.
39. **HMAC Webhook Signature Verification:** Incoming webhook with invalid HMAC signature is rejected with HTTP 401 Unauthorized.
40. **Webhook Deduplication:** Duplicate Notion webhook deliveries are deduplicated against `idempotency_records` using `webhook_notion_<event_id>`.
41. **Latest-State Object Refetch:** Webhook processing fetches complete latest page state via `GET /v1/pages/{id}` before reconciling changes.
42. **Rate-Limit 429 & Backoff:** When Notion returns HTTP 429, consumer captures error and defers message retry following exponential backoff ($5s, 10s, 20s \dots$) without double-incrementing `attempt_count`.

### Remote MCP Suite (MCP 2026-07-28)
43. **Streamable HTTP Transport Connection:** Client connects to `POST /mcp` via Streamable HTTP, transmitting JSON-RPC 2.0 requests and receiving streaming responses.
44. **Legacy SSE Fallback Compatibility:** Legacy clients connecting via `GET /mcp/sse` receive backward-compatible SSE streams.
45. **Raw SQL Execution Rejection:** MCP tool requests attempting raw SQL or arbitrary table drops are strictly rejected.

### Authentication Suite
46. **Expired Token Rejection:** Requests with tokens past their `exp` timestamp return `401 Unauthorized` (`INVALID_TOKEN`).
47. **Invalid Signature Rejection:** Tokens signed with untrusted keys return `401 Unauthorized`.
48. **Mandatory Audience Validation:** Valid JWTs with mismatched `aud` return `403 Forbidden` (`AUDIENCE_MISMATCH`).
49. **Insufficient Scope Rejection:** Read-only tokens attempting `POST /v1/events` return `403 Forbidden` (`INSUFFICIENT_SCOPE`).

### State & Release Gate Suite
50. **CI/CD Staging Gate & Production Promotion:** Verifies that production deployment is blocked on merge to `main` until staging verification succeeds and an explicit release tag is pushed.

---

## 19. Implementation Sequence (12 Ordered Phases)

The production build must proceed in strict dependency order:

```text
Phase 0: Foundation & Tooling (Monorepo, Zod, TypeScript, Vitest)
  ↓
Phase 1: D1 Database & Migrations (Kysely Schema, 24 Tables, Stale Index)
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
Phase 7: Queue & Outbox Engine (Transactional Outbox Dispatcher, 120s Lease, CAS Stale Recovery, DLQ)
  ↓
Phase 8: Google Calendar Adapter (Deterministic Base32hex IDs, ETag, If-Match Concurrency)
  ↓
Phase 9: Google Tasks Adapter (4-Tier Expanding Window, Full Pagination, Token Grammar, Adoption)
  ↓
Phase 10: Notion Adapter (HMAC Webhooks, Latest-State Refetch, 3 req/sec Rate Limiter)
  ↓
Phase 11: Observability, Acceptance Testing & CI/CD (50 Scenarios Suite, Staging Release Gate)
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
- **ADR-015: Fully Deterministic Google Tasks Expanding Window & Safe-Create Gate:** Codified 4-tier expanding reconciliation window ($5\text{m} \to 30\text{m} \to 2\text{h} \to 24\text{h}$) anchored to `job.created_at`, mandatory full pagination traversal (`nextPageToken`), strict metadata token grammar, fail-safe yielding on ambiguous state, and safe-create preconditions.
- **ADR-016: Deterministic 120-Second Outbox Processing Lease, Single-Increment Attempt Semantics & Atomic CAS Stale Recovery:** Mandated fixed non-renewable 120-second lease duration, atomic single-increment `attempt_count` exclusively at consumer lease claim, zero-increment transient failure handling, attempt-preserving atomic compare-and-set stale recovery claim, pre-retry provider reconciliation across all adapters, recovery worker crash loop termination, and bounded 5-attempt terminal progression to `DEAD_LETTER`.

---

## 22. Build Readiness Status & Gate 3 Sign-off

```text
IMPLEMENTATION SPECIFICATION STATUS

Version: 1.2.3
Gate 3: ATTEMPT COUNT & RECOVERY CONTRACT HARDENED
Architecture: GREEN
Contract Alignment: GREEN
Reliability Contract: GREEN
Provider Identity Model: GREEN
Google Tasks Lost-Ack Contract: GREEN
PROCESSING Lease & Recovery Contract: GREEN
Attempt Count Semantics: GREEN
Retry & DLQ Semantics: GREEN
Cross-Document Consistency: GREEN
Implementation Specification: READY FOR FINAL BUILD AUTHORIZATION REVIEW
Production Build: NOT YET AUTHORIZED
```
