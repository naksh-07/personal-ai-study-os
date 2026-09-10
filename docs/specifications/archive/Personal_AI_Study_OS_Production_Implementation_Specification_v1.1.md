# Personal AI Study OS — Production Implementation Specification v1.1

## Document Version History

| Version | Date | Status | Key Changes |
| :--- | :--- | :--- | :--- |
| **v1.0** | September 2026 | Superseded | Initial production implementation specification draft. |
| **v1.1** | September 2026 | **RECONCILED (Gate 3)** | **Build Readiness Reconciliation:**<br>• Completed D1 SQLite schema (all 23 tables explicitly defined with types, primary keys, foreign keys, cascade rules, constraints, and indexes).<br>• Decoupled `idempotency_records` from mandatory queue `job_id`, resolving HTTP API architectural lockout and establishing the exact 5-case deduplication algorithm.<br>• Completed `sync_jobs` queue persistence model with exponential backoff, retry limits, and dead-letter queue (DLQ) recovery.<br>• Aligned `study_progress` projection model with mathematical bounds ($0 \le questions\_correct \le questions\_attempted$, $accuracy \in [0.0, 1.0]$) and mapped `progress_value` as a decimal alias to `progress_percent`.<br>• Completed User timezone semantics and recursive Chapter hierarchy (`Subject → Unit → Chapter → Topic`).<br>• Removed Basic Auth ambiguity and mandated strict OAuth 2.1 Bearer token JWT validation with explicit `aud` (Audience) verification against the Personal State Service canonical URL.<br>• Formalized the Source Ingestion pipeline (`Source → TOC → Syllabus Mapping → SourceChapter → SourceMapping`) and codified the invariant prohibiting copyrighted book content in D1.<br>• Strengthened migration architecture for forward-only D1 operations using `db.batch()` without interactive transaction control.<br>• Codified all 23 authoritative acceptance test suites.<br>• Conducted deep audit of existing Phase 0–2 implementation and documented compatibility discrepancies. |

---

## 1. Executive Summary & System Mandate

The **Personal AI Study OS** is a lightweight, edge-native coordination layer that integrates AI agents (**ChatGPT**, **Gemini Spark**, **Antigravity**) with personal productivity platforms (**Google Tasks**, **Google Calendar**, **Notion**) and a shared canonical data store (**Cloudflare D1**).

The system operates on Cloudflare serverless infrastructure (**Cloudflare Workers**, **Cloudflare D1**, **Cloudflare Queues**). It functions as the authoritative machine-readable event ledger, deterministic projection engine, and shared coordination boundary.

The architecture enforces six fundamental responsibilities:
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
- **Cloudflare D1 Storage:** Complete 23-table relational schema managing core identity, canonical event ledgers, derived projections, source structures, external links, memory, and sync coordination.
- **Canonical Event Engine:** Append-only event ingestion pipeline operating through Cloudflare D1 `db.batch()` implicit transactions.
- **Projection Engine:** Deterministic state projection handlers for `study_progress`, `daily_states`, and temporal memory, with full recomputation capabilities.
- **Unified Cloudflare Worker:** Dual-interface service delivering a versioned REST API (`/v1/`) and a Remote Model Context Protocol (MCP) server over HTTP/SSE.
- **Asynchronous Sync Pipeline:** Cloudflare Queues (`SYNC_QUEUE` and `personal-sync-dlq`) for reliable, throttled downstream synchronization.
- **Provider Adapters:**
  - *Google Tasks Adapter:* Date-only synchronization with cron-based `updatedMin` polling.
  - *Google Calendar Adapter:* Precise time-block synchronization with optimistic concurrency control (`ETag` and `If-Match`).
  - *Notion Adapter:* Webhook intake (`POST /v1/webhooks/notion`) and rate-limited queue mutation throttled to 3 requests per second.
- **Security & Authorization:** Strict OAuth 2.1 Bearer authentication, JWKS signature verification, and mandatory `aud` (Audience) validation.

### 2.2 Explicitly Out of Scope for Version 1
- **Copyrighted Book Storage:** Full text, parsed paragraphs, or PDF binary streams are strictly forbidden from being stored in D1. Only structural metadata, table of contents (TOC), and syllabus mappings are persisted.
- **Intra-Day Scheduling in Tasks:** Google Tasks must never be used for hour-level or minute-level scheduling; intra-day time allocation belongs strictly to Google Calendar.
- **Unattended ChatGPT Execution:** ChatGPT operates exclusively in active user sessions; background mutations and unattended workflows are delegated to Antigravity or dedicated workers.
- **Direct Agent-to-Agent IPC:** Agents never call each other directly; all coordination is mediated via the Personal State Service.

---

## 3. Authoritative Contracts & Precedence Hierarchy

The implementation of the Personal AI Study OS must strictly conform to authoritative project contracts. In the event of conflicting requirements or ambiguous interpretations, resolution must adhere to the following strict order of precedence:

1. **Personal AI Study OS — Technical Contracts & Data Specification v1.1** (Primary contract governing domains, events, invariants, and ownership boundaries).
2. **Personal AI Study OS — Integration Reality Audit v1.0** (Authoritative findings governing Cloudflare, Google, Notion, and MCP platform capabilities as of September 2026).
3. **Personal AI Study OS — Production Implementation Specification v1.1** (This document — authoritative for database schemas, algorithms, and engineering implementation).
4. **Foundational Architecture Documents:** `PERSONAL AI STUDY OS.md` and `engineering blueprint.md`.

*Contract Integrity Rule:* No software engineer, agent, or provider adapter may unilaterally modify architectural invariants, entity ownership, or database schemas without an approved Architectural Decision Record (ADR) and formal contract revision.

---

## 4. Technology Decisions & Platform Constraints

| Subsystem | Selected Technology | Purpose | Architectural Rationale & Constraints | Rejected Alternatives |
| :--- | :--- | :--- | :--- | :--- |
| **Compute Runtime** | **Cloudflare Workers** | Edge serverless execution | Native low-latency bindings to D1 and Queues. Max CPU time is 30s for HTTP requests (network I/O excluded) and 15m for queue consumers. | AWS Lambda (cold starts), Dedicated VPS (maintenance overhead). |
| **Database Engine** | **Cloudflare D1** | Canonical storage & derived state | Native SQLite at the edge. 10 GB capacity on paid plan. Max query duration 30s. Point-in-time recovery (Time Travel) up to 30 days. | Supabase / RDS Postgres (unnecessary network hops and connection pooling limits). |
| **Async Messaging** | **Cloudflare Queues** | Event-driven background synchronization | Native integration with Workers. Delivers **at-least-once**. Maximum payload size is 128 KB. Supported retry backoff and DLQ routing. | RabbitMQ, Redis BullMQ, Kafka (excessive operational complexity for personal scale). |
| **API & AI Protocol** | **REST + Remote MCP** | Client & agent communication | REST handles webhooks, health checks, and admin commands. MCP (over HTTP/SSE) exposes semantic tools to AI agents. | GraphQL (unnecessary abstraction), gRPC (unsupported in web/MCP clients). |
| **Authentication** | **OAuth 2.1 Bearer (JWT)** | Request authentication | RFC 6750 standard. Validated via JWKS with mandatory `aud` enforcement. | Basic Authentication (insecure, prohibited), Static API keys (no client scoping). |
| **Language & Types** | **TypeScript 5.x** | Implementation language | Strict typing across domain models, database queries, and event envelopes. | Plain JavaScript, Python (lacks compile-time guarantee in CF worker runtime). |
| **Runtime Validation**| **Zod 3.x / 4.x** | Schema & envelope validation | Runtime validation guaranteeing that invalid events or payloads are rejected before database entry. | Joi, JSON Schema validator (less ergonomic TS inference). |
| **Database Access** | **Kysely** | Type-safe SQL query builder | Zero-runtime overhead query construction. Seamless compilation to parameterized SQL compatible with D1 `db.batch()`. | Prisma (heavy binary/bundle size for Workers), Drizzle (less mature batch transaction typing in v1). |
| **Test Framework** | **Vitest** | Unit, contract & integration tests | Fast, native ESM support, direct compatibility with Miniflare and Cloudflare Worker testing pools. | Jest (CommonJS baggage, slow ESM mocking). |
| **Infrastructure** | **Wrangler CLI** | Infrastructure-as-code & deployments | Cloudflare's official toolchain for Workers, D1 migrations, and Queues management. | Terraform (overkill for simple worker bindings). |

---

## 5. Repository Architecture & Monorepo Boundaries

The codebase is organized as a clean TypeScript monorepo using npm/pnpm workspaces:

```text
personal-ai-study-os/
├── apps/
│   └── worker/                     # Cloudflare Worker deployment target
│       ├── src/
│       │   ├── index.ts            # Entrypoint routing HTTP REST, MCP, and Queue consumer
│       │   ├── routes/             # REST endpoints (/v1/state, /v1/events, /v1/webhooks)
│       │   ├── mcp/                # Remote MCP Server tools, resources, and SSE handlers
│       │   ├── queue/              # Cloudflare Queue consumer and dispatch router
│       │   └── middleware/         # OAuth 2.1 JWT validation, Audience check, Error formatting
│       ├── migrations/             # Numbered SQL migrations applied via wrangler d1 migrations
│       │   ├── 0001_initial_schema.sql
│       │   └── 0002_reconciled_v1_1_schema.sql
│       ├── wrangler.toml           # Worker bindings: DB (D1), SYNC_QUEUE, DLQ, Cron triggers
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   ├── domain/                     # Pure TypeScript domain models, Zod schemas, event envelopes
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── entities.ts         # User, Subject, Chapter, StudyProgress, etc.
│   │   │   ├── events.ts           # 30+ Canonical Event schemas and discriminated unions
│   │   │   └── errors.ts           # Standard machine-readable error codes
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── db/                         # Kysely database layer, table interfaces, and D1 repositories
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── tables.ts           # Kysely Database interface mapping all 23 tables
│   │   │   └── client.ts           # D1 Kysely dialect and batch executor
│   │   │   └── repositories/       # Query helpers for events, projections, and idempotency
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── core/                       # Canonical Event Engine, Projection Engine, Idempotency Logic
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── event-engine.ts     # Atomic validation, resolution, and batch construction
│   │   │   ├── projection-engine.ts# Handlers updating study_progress, daily_states
│   │   │   └── idempotency.ts      # Multi-step deduplication and SHA-256 request hashing
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── adapters/                   # External provider integrations (Google Tasks, Calendar, Notion)
│       ├── src/
│       │   ├── index.ts
│       │   ├── google-tasks.ts     # Polling adapter, updatedMin parser, date-only mapping
│       │   ├── google-calendar.ts  # Concurrency adapter, ETag extraction, If-Match retry loop
│       │   └── notion.ts           # Webhook receiver, block mapper, 3 req/sec rate throttler
│       ├── tsconfig.json
│       └── package.json
├── tests/                          # Automated test suites
│   ├── unit/                       # Pure logic: Zod schemas, hash calculation, projection math
│   ├── contract/                   # Event schemas, REST contracts, MCP schemas, migration tests
│   ├── integration/                # Miniflare D1 batch tests, Queue consumer idempotency tests
│   └── e2e/                        # Vitest E2E workflows matching 23 acceptance scenarios
├── package.json                    # Workspace root scripts: build, test, lint, typecheck
└── tsconfig.base.json              # Shared TypeScript compiler options (ES2022, Strict)
```

---

## 6. Dependency Architecture & Direction Rules

### 6.1 Architectural Layers & Data Flow
The dependency structure adheres strictly to Clean Architecture / Hexagonal Architecture:

```text
       [ apps/worker (HTTP / MCP / Queue Transport) ]
                              │
                              ▼
           [ packages/core (Application & Engines) ]
                    │                   │
                    ▼                   ▼
    [ packages/db (Persistence) ]    [ packages/adapters (External APIs) ]
                    │                   │
                    └─────────┬─────────┘
                              ▼
                 [ packages/domain (Core) ]
```

### 6.2 Forbidden Couplings & Dependency Enforcement
1. **`packages/domain` has ZERO runtime dependencies** (except Zod for schema validation). It must never import from `db`, `core`, `adapters`, or `worker`.
2. **`packages/adapters` must only depend on `packages/domain`**. Adapters must never import from `apps/worker` or `packages/db`. All external API response structures must be translated into pure domain entities before leaving the adapter boundary.
3. **`packages/db` knows about SQLite and Kysely**. It translates database rows into `domain` types and compiles typed Kysely queries into SQL statements for D1. It must never import adapters or worker routing.
4. **`packages/core` orchestrates business logic**. It imports `domain` and depends on abstract interfaces for database execution and adapter calls, enabling 100% in-memory mocking during unit testing.
5. **`apps/worker` wires dependencies**. It binds the Cloudflare runtime (`env.DB`, `env.SYNC_QUEUE`), instantiates adapters with secrets, and handles HTTP routing.

---

## 7. Complete Cloudflare D1 Database Schema (23 Tables)

The Cloudflare D1 SQLite database contains 23 authoritative tables organized into 8 distinct functional domains.

### 7.1 SQLite Runtime Conventions
- **Timestamps:** Persisted as `TEXT` containing ISO 8601 UTC strings formatted as `YYYY-MM-DDTHH:MM:SS.SSSZ`.
- **Booleans:** Persisted as `INTEGER` (`0` for false, `1` for true).
- **JSON Payloads:** Persisted as `TEXT` containing validated JSON strings.
- **Foreign Key Constraints:** All foreign keys explicitly specify `ON DELETE RESTRICT` (preventing orphan creation) or `ON DELETE CASCADE` (for child records like `project_events`).

---

```sql
-- ============================================================================
-- 1. IDENTITY & CORE DOMAIN
-- ============================================================================

CREATE TABLE users (
    id TEXT PRIMARY KEY,                           -- usr_01J...
    timezone TEXT NOT NULL DEFAULT 'UTC',          -- IANA timezone identifier, e.g. 'Asia/Kolkata'
    status TEXT NOT NULL DEFAULT 'active',         -- 'active', 'suspended', 'deactivated'
    created_at TEXT NOT NULL,                      -- ISO 8601 UTC
    updated_at TEXT NOT NULL                       -- ISO 8601 UTC
);

CREATE TABLE subjects (
    id TEXT PRIMARY KEY,                           -- subj_01J...
    name TEXT NOT NULL,                            -- Display name, e.g. 'Physics'
    slug TEXT NOT NULL UNIQUE,                     -- Query-safe unique slug, e.g. 'physics'
    description TEXT,                              -- Optional syllabus description
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
-- 2. STUDY DOMAIN
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
-- 3. SOURCES DOMAIN
-- ============================================================================

CREATE TABLE sources (
    id TEXT PRIMARY KEY,                           -- src_01J...
    title TEXT NOT NULL,                           -- Display title, e.g. 'Concepts of Physics'
    source_type TEXT NOT NULL,                     -- 'book', 'pdf', 'syllabus', 'notes'
    author TEXT,                                   -- e.g. 'H.C. Verma'
    publisher TEXT,                                -- Optional publisher name
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
-- 4. TASKS & CALENDAR EXTERNAL COORDINATION DOMAIN
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

-- ============================================================================
-- 5. RESEARCH & PROJECTS DOMAIN
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
-- 6. MEMORY DOMAIN
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
-- 7. AGENT & OPERATIONS DOMAIN
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
-- 8. SYNCHRONIZATION & RELIABILITY DOMAIN
-- ============================================================================

CREATE TABLE sync_jobs (
    job_id TEXT PRIMARY KEY,                       -- sync_01J...
    target_system TEXT NOT NULL,                   -- 'notion', 'google_tasks', 'google_calendar'
    entity_type TEXT NOT NULL,                     -- 'study_progress', 'daily_state', 'task'
    entity_id TEXT NOT NULL,                       -- Target entity ID
    operation TEXT NOT NULL,                       -- 'create', 'update', 'delete', 'sync'
    payload_json TEXT,                             -- Serialized mutation payload
    status TEXT NOT NULL DEFAULT 'PENDING',        -- 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER'
    attempt_count INTEGER NOT NULL DEFAULT 0,      -- Number of execution attempts
    next_attempt_at TEXT,                          -- ISO 8601 UTC after which retry is permitted
    last_error TEXT,                               -- Last caught exception or HTTP status code
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT                              -- ISO 8601 UTC timestamp of completion
);
CREATE INDEX idx_sync_jobs_status ON sync_jobs(status, next_attempt_at);

CREATE TABLE idempotency_records (
    idempotency_key TEXT PRIMARY KEY,              -- Provided by client or generated for sync job
    job_id TEXT,                                   -- Scoped job ID (NULL for direct HTTP API calls)
    operation TEXT NOT NULL,                       -- Endpoint or action name, e.g. 'POST /v1/events'
    source_system TEXT NOT NULL,                   -- 'chatgpt', 'spark', 'antigravity', 'queue_consumer'
    request_hash TEXT NOT NULL,                    -- SHA-256 hex digest of canonicalized request payload
    result_hash TEXT,                              -- SHA-256 hex digest of returned payload
    status TEXT NOT NULL,                          -- 'PENDING', 'COMPLETED', 'FAILED'
    result_payload TEXT,                           -- Cached JSON response body for replay
    created_at TEXT NOT NULL,                      -- ISO 8601 UTC
    updated_at TEXT NOT NULL,                      -- ISO 8601 UTC
    expires_at TEXT                                -- ISO 8601 UTC expiration timestamp (e.g. now + 24h)
);
CREATE INDEX idx_idempotency_records_expires ON idempotency_records(expires_at);
```

---

## 8. Idempotency Contract & Deduplication Algorithm

### 8.1 Architectural Principle
To guarantee that network retries, client reconnection attempts, and queue duplicate deliveries never result in duplicate database events or duplicate external API mutations, every state-changing operation is governed by an **Idempotency Contract**.

The system strictly enforces:
$$\text{Same Idempotency Identity} + \text{Same Request Payload} = \text{Exactly One Canonical Mutation \& Replayed Result}$$
$$\text{Same Idempotency Identity} + \text{Different Request Payload} = \text{HTTP 409 IDEMPOTENCY\_CONFLICT}$$

### 8.2 Decoupling HTTP Mutations from Queue Job IDs
In v1.0 and initial drafts, `idempotency_records` defined `job_id TEXT NOT NULL`. This introduced an architectural defect: HTTP requests (such as `POST /v1/events` or MCP tool calls) arrive before any background queue job exists. In v1.1, `idempotency_records` uses `idempotency_key` as the primary key. `job_id` is nullable and populated only when the deduplication scope is a background queue consumer.

### 8.3 The Multi-Step Deduplication Algorithm

```text
Incoming Request (Idempotency-Key Header: K, Body: B)
                      │
                      ▼
            Compute Request Hash:
       H = SHA-256(canonicalize_json(B))
                      │
                      ▼
         Query idempotency_records WHERE key = K
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
[ Record Not Found ]       [ Record Found ]
        │                           │
        │                           ├─ If status == 'COMPLETED':
        │                           │    ├─ If record.request_hash == H:
        │                           │    │    └── Return cached result_payload (HTTP 200 OK)
        │                           │    └─ If record.request_hash != H:
        │                           │         └── Reject: HTTP 409 IDEMPOTENCY_CONFLICT
        │                           │
        │                           └─ If status == 'PENDING':
        │                                └── Reject: HTTP 409 Conflict (Concurrent in-flight)
        ▼
Execute db.batch([
  INSERT INTO idempotency_records (key=K, status='PENDING', request_hash=H, ...),
  INSERT INTO canonical_events (...),
  UPDATE study_progress / daily_states (...),
  INSERT INTO sync_jobs (...)
])
        │
        ▼
Execute side-effects (e.g., enqueue Cloudflare Queue message)
        │
        ▼
UPDATE idempotency_records SET status='COMPLETED', result_payload=R, updated_at=now()
        │
        ▼
Return Response (HTTP 201 Created / HTTP 200 OK)
```

### 8.4 Queue Duplicate Delivery Protection
Cloudflare Queues provides **at-least-once delivery**. If a message is redelivered to the consumer:
1. **Pre-Mutation Check:** The consumer retrieves `idempotency_records` using the message's internal mutation key prior to calling any external provider API.
2. **Already Completed:** If the record exists and `status === 'COMPLETED'`, the consumer **immediately acknowledges (ACKs) the message and terminates execution**. The external provider (Notion, Google) is **never called a second time**.
3. **Lost ACK Recovery:** If the worker crashed after calling the external API but before acknowledging the queue message:
   - On retry, the adapter queries the provider using external idempotency tokens or `ETag` matching to verify that the entity was already updated.
   - If already applied, the consumer updates `idempotency_records` to `COMPLETED` and ACKs the message.

---

## 9. Complete `sync_jobs` Queue Persistence Model

### 9.1 Job Envelope & Field Semantics
Every asynchronous task scheduled for an external provider is persisted in the `sync_jobs` table before message dispatch:
- `job_id`: Stable opaque identifier (`sync_01J...`).
- `target_system`: Target external service (`'notion'`, `'google_tasks'`, `'google_calendar'`).
- `entity_type`: Canonical domain entity being synchronized (`'study_progress'`, `'daily_state'`, `'task_link'`).
- `entity_id`: Opaque internal identifier of the domain entity.
- `operation`: Action to be executed (`'create'`, `'update'`, `'delete'`, `'sync'`).
- `payload_json`: Self-contained JSON payload required by the external adapter.
- `status`: Lifecycle state:
  - `PENDING`: Initial state upon creation in D1.
  - `PROCESSING`: Picked up by the Queue consumer.
  - `COMPLETED`: Successfully delivered and acknowledged by the external API.
  - `FAILED`: Encountered a transient retryable error (e.g. HTTP 429, 503).
  - `DEAD_LETTER`: Exhausted all retries; moved to DLQ.
- `attempt_count`: Counter tracking delivery attempts (starts at `0`).
- `next_attempt_at`: ISO 8601 UTC timestamp defining the earliest valid retry time.
- `last_error`: Diagnostic snippet containing HTTP status codes or error messages.
- `created_at`, `updated_at`, `completed_at`: Timestamps for SLA tracking.

### 9.2 Retry Policy & Exponential Backoff
When an external API call fails due to a transient issue (such as Notion rate limiting or network timeout):
1. The consumer increments `attempt_count`.
2. The consumer calculates the exponential backoff delay:
   $$t_{\text{delay}} = \min\left(\text{initial\_backoff} \times 2^{\text{attempt\_count} - 1}, \text{max\_backoff}\right)$$
   where $\text{initial\_backoff} = 5\text{ seconds}$ and $\text{max\_backoff} = 300\text{ seconds}$ (5 minutes).
3. The job in D1 is updated: `status = 'FAILED'`, `next_attempt_at = now() + delay`, `last_error = error_message`.
4. The queue message is rejected (`msg.retry({ delaySeconds: delay })`).

### 9.3 Dead-Letter Queue (DLQ) Transition
- If a message fails **5 consecutive attempts** (`attempt_count >= 5`), Cloudflare Queues automatically routes the message to `personal-sync-dlq`.
- In D1, the worker sets `status = 'DEAD_LETTER'` and logs an operational alert.
- Canonical state in D1 remains completely safe, consistent, and uncorrupted. Downstream sync failures **never roll back canonical event history**.

### 9.4 DLQ Recovery Runbook
1. Inspect the failed job: `GET /v1/admin/sync-jobs?status=DEAD_LETTER`.
2. Resolve the underlying external failure (e.g., refresh expired Notion integration token, clear external rate limits).
3. Trigger replay via admin endpoint: `POST /v1/admin/requeue-dlq` with `{ job_id: "sync_01J..." }`.
4. The system resets `attempt_count = 0`, `status = 'PENDING'`, and re-enqueues the job into `SYNC_QUEUE`.

---

## 10. Complete Study Progress Model

### 10.1 Metric Integrity & Mathematical Invariants
The `study_progress` projection tracks domain mastery. It is derived entirely from the stream of canonical events (`study_completed`, `questions_attempted`, `chapter_completed`).

The fields and their strict mathematical invariants are:
- `progress_percent`: Real number constrained to $0.0 \le progress\_percent \le 1.0$. Represents syllabus completion percentage.
- `progress_value`: **Semantic equivalence rule:** Existing Phase 0–2 code references `progress_value`. In this specification, `progress_value` is defined as mathematically identical to `progress_percent` ($0.0 \dots 1.0$).
- `confidence`: Real number constrained to $0.0 \le confidence \le 1.0$. Represents user-reported or algorithmically-assessed mastery.
- `questions_attempted`: Non-negative integer ($\ge 0$).
- `questions_correct`: Non-negative integer ($\ge 0$), strictly constrained by:
  $$\text{questions\_correct} \le \text{questions\_attempted}$$
- `accuracy`: Real number derived strictly as:
  $$\text{accuracy} = \begin{cases} \frac{\text{questions\_correct}}{\text{questions\_attempted}} & \text{if } \text{questions\_attempted} > 0 \\ 0.0 & \text{if } \text{questions\_attempted} = 0 \end{cases}$$
  Constrained strictly to $0.0 \le accuracy \le 1.0$.
- `last_studied_at`: ISO 8601 UTC timestamp of the most recent study event.
- `last_completed_at`: ISO 8601 UTC timestamp when `status` transitioned to `'COMPLETED'`.

### 10.2 Cumulative Aggregation Rules
- **Study Completion Event:** Logging a study session does **not** assume practice questions unless question counts are explicitly present in the event payload.
- **Question Practice Event:** Emitting `questions_attempted` causes atomic additive accumulation:
  ```sql
  UPDATE study_progress SET
      questions_attempted = questions_attempted + :attempted,
      questions_correct = questions_correct + :correct,
      accuracy = CAST(questions_correct + :correct AS REAL) / (questions_attempted + :attempted),
      last_studied_at = :occurred_at,
      updated_at = :recorded_at
  WHERE chapter_id = :chapter_id;
  ```

---

## 11. Complete User and Chapter Models

### 11.1 User Model & Timezone Semantics
The `users` entity models identity and local context:
- `id`: Stable opaque identifier (`usr_01J...`).
- `timezone`: Mandatory IANA Timezone string (e.g. `'Asia/Kolkata'`, `'America/New_York'`). Default: `'UTC'`.
- `status`: Lifecycle indicator (`'active'`, `'suspended'`, `'deactivated'`).

**Timezone Consistency Rules:**
1. **"Today" Determination:** The boundary of what constitutes "today" for `daily_states` is evaluated using the user's configured `timezone`. A study session completed at 01:30 UTC on September 11 is attributed to September 11 in `Asia/Kolkata` (UTC+5:30) but September 10 in `America/New_York` (UTC-4:00).
2. **Calendar Interaction:** External calendar scheduling requests generated by Spark or the user evaluate time slots against the user's localized timezone context before persisting UTC timestamps in D1.

### 11.2 Recursive Chapter Hierarchy Model
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

## 12. Production Authentication & Security Model

### 12.1 Authentication Architecture
The Personal State Service enforces **OAuth 2.1 Bearer Authentication** (RFC 6750) over HTTPS across all REST endpoints and Remote MCP server connections.

**Basic Authentication is strictly prohibited and removed from all specifications.**

### 12.2 JWT Verification Pipeline
Every incoming HTTP request must supply a valid JWT in the `Authorization` header:
`Authorization: Bearer <JWT_TOKEN>`

The Cloudflare Worker executes a mandatory 5-step verification pipeline:
1. **Signature Verification:** Validates token signature against the trusted Identity Provider's JSON Web Key Set (JWKS) public keys.
2. **Expiration Validation (`exp`):** Validates that `current_time_utc < exp` (with a maximum 30-second clock skew allowance).
3. **Issuer Validation (`iss`):** Validates that `iss` matches the designated authorization server issuer URI.
4. **MANDATORY AUDIENCE VALIDATION (`aud`):**
   - **Confused Deputy Prevention:** Generic tokens minted for other MCP servers or general APIs are strictly rejected.
   - The token's `aud` claim must explicitly contain the Personal State Service canonical URL or registered client identifier (e.g. `https://api.personal-os.com/` or `personal-study-os-api`).
   - If `aud` does not match, the worker immediately rejects the request with `403 Forbidden` (`AUDIENCE_MISMATCH`).
5. **Scope Authorization:** Evaluates the token's `scope` claim against the requested operation class.

### 12.3 Authorization Scope Matrix

| Operation Class | Permitted Scopes | ChatGPT | Gemini Spark | Antigravity | User / Admin |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Read State** (`GET /v1/state/*`, MCP `get_*`) | `read`, `admin` | Allowed | Allowed | Allowed | Allowed |
| **Record Event** (`POST /v1/events`, MCP `record_*`) | `write`, `admin` | Prohibited* | Allowed | Allowed | Allowed |
| **Modify Calendar** (External Calendar sync) | `external_mutation`, `admin` | Prohibited | Allowed | Prohibited | Allowed |
| **Modify Tasks** (External Task sync) | `external_mutation`, `admin` | Prohibited | Allowed | Prohibited | Allowed |
| **Destructive / Admin** (Truncate, Rebuild) | `admin` | Prohibited | Prohibited | Prohibited | Allowed |

*\*Note: ChatGPT operates in active user sessions and emits intent proposals; actual mutations are executed by authorized execution clients (Antigravity/User).*

### 12.4 Standard Error Responses
- `401 Unauthorized`:
  - `AUTH_MISSING`: No `Authorization: Bearer` header present.
  - `INVALID_TOKEN`: Token expired, invalid signature, or malformed JWT.
- `403 Forbidden`:
  - `AUDIENCE_MISMATCH`: Token `aud` does not match the Personal State Service.
  - `INSUFFICIENT_SCOPE`: Token lacks required scope for the requested endpoint.

---

## 13. Source Ingestion Model

### 13.1 Conceptual Ingestion Pipeline
Antigravity ingests external academic material (textbooks, reference guides, lecture notes, syllabus documents) through an automated, structured pipeline:

```text
External Physical Source (PDF / Book)
                 │
                 ▼
     [ TOC / Structure Inspection ]  (Extract Table of Contents, Chapters, Page Ranges)
                 │
                 ▼
         [ Syllabus Mapping ]        (Map source sections against canonical syllabus)
                 │
                 ▼
    [ Register Source in D1 ]        (Insert into sources table via MCP tool)
                 │
                 ▼
  [ Register SourceChapters in D1 ]  (Insert into source_chapters table)
                 │
                 ▼
  [ Register SourceMappings in D1 ]  (Connect source chapters to canonical chapters)
                 │
                 ▼
[ Structured Study Knowledge Layer ] (Curated summaries synchronized to Notion)
```

### 13.2 Database Storage Invariant: NO COPYRIGHTED CONTENT
**CRITICAL INVARIANT:** Cloudflare D1 must **NEVER** store complete copyrighted book texts, full PDF paragraph dumps, or raw textbook chapters.
- **Stored in D1:** Source metadata (`title`, `author`, `edition`, `reference_uri`), structural chapter hierarchy (`title`, `chapter_number`, `location_reference`), and mapping relationships (`confidence`, `relevance`, `canonical_chapter_id`).
- **Kept Local / Outside D1:** Full PDF binaries, vector embeddings, and full-text indexes reside locally with Antigravity or dedicated blob storage (Cloudflare R2), never in the SQLite database.

---

## 14. Migration Architecture & Operational Policy

### 14.1 Wrangler Migration Standard
- **Tooling:** Managed via Cloudflare Wrangler's native migration engine (`wrangler d1 migrations`).
- **File Naming:** Strictly sequential, numeric prefixing: `apps/worker/migrations/XXXX_description.sql` (e.g. `0001_initial_schema.sql`, `0002_reconciled_v1_1_schema.sql`).
- **Dependency Ordering:** Tables must be created in foreign-key dependency order (e.g. `subjects` before `chapters`, `sources` before `source_chapters`).

### 14.2 Forward-Only Migration Policy (No Interactive Rollbacks)
- **Non-Transactional D1 Reality:** Cloudflare D1 does **NOT** support interactive SQL transactions (`BEGIN`, `COMMIT`, `ROLLBACK`). Automated schema rollbacks that drop columns or tables cause permanent data loss.
- **Policy:** All database schema changes in staging and production are strictly **forward-only**. If an error is introduced in migration `0002`, it must be remediated via a new forward migration `0003_fix_...sql`.
- **Application Rollbacks:** Application worker code can be rolled back safely via `wrangler rollback`, provided all database migrations remain backward-compatible (e.g. add nullable columns, never delete or rename columns in the same release).

### 14.3 Projection Rebuild Strategy
Derived projection tables (`study_progress`, `daily_states`) must be 100% deterministically rebuildable from canonical events:
1. Truncate derived projection tables: `DELETE FROM study_progress; DELETE FROM daily_states;`.
2. Stream all records from `canonical_events` ordered chronologically: `SELECT * FROM canonical_events ORDER BY occurred_at ASC;`.
3. Pass each event through the Projection Engine handler in memory.
4. Co-insert reconstructed projection states in batches.

---

## 15. Canonical Event Engine

### 15.1 Atomic Ingestion Pipeline
When an event mutation is submitted via REST (`POST /v1/events`) or MCP (`record_study_session`):
1. **Zod Validation:** The incoming payload is validated against the typed schema for that `event_type`.
2. **Entity Resolution:** Display names (e.g. "Physics") are resolved to stable opaque identifiers (`subj_01J...`).
3. **Authorization Check:** The actor's token scopes are validated.
4. **Idempotency Verification:** The request hash is verified against `idempotency_records`.
5. **Envelope Construction:** A `CanonicalEvent` envelope is assembled with unique `event_id`, timestamps, and actor provenance.
6. **Atomic Persistence (`db.batch()`):** The event insertion, projection updates, and downstream sync job are executed as an atomic prepared statement batch:
   ```typescript
   await db.batch([
     insertCanonicalEventQuery,
     updateStudyProgressProjectionQuery,
     updateDailyStateProjectionQuery,
     insertSyncJobQuery,
     insertIdempotencyRecordQuery
   ]);
   ```
7. **Queue Enqueue:** Upon successful batch completion, the background synchronization job is enqueued to `SYNC_QUEUE`.

### 15.2 Canonical Event Envelope Schema
```typescript
interface CanonicalEventEnvelope<T = Record<string, unknown>> {
  eventId: string;             // evt_01J...
  eventType: string;           // e.g. 'study_completed'
  schemaVersion: number;       // e.g. 1
  occurredAt: string;          // ISO 8601 UTC
  recordedAt: string;          // ISO 8601 UTC
  actor: {
    type: 'user' | 'agent' | 'system';
    id: string;                // usr_..., agent_...
  };
  source: {
    system: 'chatgpt' | 'spark' | 'antigravity' | 'notion';
    interface: 'natural_language' | 'mcp' | 'rest' | 'webhook';
  };
  payload: T;
  correlationId?: string;      // req_01J...
  causationId?: string;        // cmd_01J... or evt_01J...
}
```

---

## 16. Projection Engine

### 16.1 Projection Handler Registry
The Projection Engine maintains a registry mapping canonical event types to SQL mutation queries executed inside the same `db.batch()`:

| Event Type | Target Projection Table | Projection Query Logic |
| :--- | :--- | :--- |
| `study_completed` | `study_progress`, `daily_states` | Update `last_studied_at`, aggregate `study_minutes` in `daily_states`. |
| `questions_attempted` | `study_progress`, `daily_states` | Increment `questions_attempted`, `questions_correct`, recalculate `accuracy`. |
| `chapter_completed` | `chapters`, `study_progress`, `daily_states` | Set `status = 'COMPLETED'`, `progress_percent = 1.0`, increment `completed_chapters`. |
| `schedule_missed` | `daily_states` | Increment `missed_sessions` in `daily_states`. |
| `task_completed` | `task_links`, `daily_states` | Update `status_snapshot = 'completed'`, increment `completed_tasks`. |

---

## 17. REST API Specification

**Base URL:** `https://api.personal-os.com/v1/`

### 17.1 Endpoints
1. `GET /v1/state/today`
   - *Description:* Retrieves the user's localized daily state summary.
   - *Query Parameters:* `timezone` (optional, falls back to user default).
   - *Response:* `200 OK` with JSON `DailyState` object.
2. `GET /v1/study/progress`
   - *Description:* Retrieves current progress across all subjects and chapters.
   - *Response:* `200 OK` with array of `StudyProgress` objects.
3. `POST /v1/events`
   - *Description:* Ingests a canonical event with atomic projection updates.
   - *Headers:* `Authorization: Bearer <JWT>`, `Idempotency-Key: <UUID>`.
   - *Body:* `CanonicalEventEnvelope`.
   - *Response:* `201 Created` with ingested event metadata, or `200 OK` if replaying idempotent request.
4. `POST /v1/webhooks/notion`
   - *Description:* Webhook receiver for Notion workspace updates.
   - *Headers:* `X-Notion-Signature: <HMAC_SHA256>`.
   - *Response:* `202 Accepted`.
5. `POST /v1/admin/rebuild-projections`
   - *Description:* Administrative endpoint to replay all events and rebuild projection tables.
   - *Headers:* `Authorization: Bearer <ADMIN_JWT>`.
   - *Response:* `200 OK` with replayed event count.

---

## 18. Remote MCP Server Specification

### 18.1 Protocol & Transport
- **Protocol:** Model Context Protocol (MCP) 2024-11-05 specification.
- **Transport:** Server-Sent Events (SSE) over HTTP at endpoint `https://api.personal-os.com/mcp`.
- **Authentication:** OAuth 2.1 Bearer Token evaluated per connection and tool request.

### 18.2 Registered Semantic Tools
1. `get_today_state`
   - *Input:* `{}`
   - *Scope Required:* `read`
   - *Description:* Returns today's active study goals, completed tasks, and schedule blocks.
2. `record_study_session`
   - *Input:* `{ chapter_id: string, duration_seconds: number, activity_type: string }`
   - *Scope Required:* `write`
   - *Description:* Emits `study_session_recorded` event, updates progress, and queues Notion sync.
3. `update_study_progress`
   - *Input:* `{ chapter_id: string, progress_percent: number, questions_attempted?: number, questions_correct?: number }`
   - *Scope Required:* `write`
   - *Description:* Emits `questions_attempted` and/or `chapter_progress_updated` events.
4. `register_source`
   - *Input:* `{ title: string, source_type: string, author?: string, reference_uri?: string }`
   - *Scope Required:* `write`
   - *Description:* Registers textbook/syllabus metadata in D1 (NO raw text).
5. `map_source_chapter`
   - *Input:* `{ source_chapter_id: string, canonical_chapter_id: string, confidence: number }`
   - *Scope Required:* `write`
   - *Description:* Links an external textbook section to a canonical chapter.

**Strict Prohibition:** Under no circumstances does MCP accept raw SQL strings or execute arbitrary DDL/DML.

---

## 19. Queue Architecture & Consumer Implementation

### 19.1 Cloudflare Queue Configuration (`wrangler.toml`)
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
```

### 19.2 Consumer Execution Logic
The worker's `queue` handler processes batches with deduplication and concurrency control:
1. Iterates over messages in `batch.messages`.
2. Checks `idempotency_records` using `job_id`. If `COMPLETED`, calls `msg.ack()` and skips processing.
3. Dispatches message to provider adapter (`NotionAdapter`, `GoogleTasksAdapter`, `GoogleCalendarAdapter`).
4. On success: Updates `sync_jobs` to `COMPLETED`, updates `idempotency_records` to `COMPLETED`, and calls `msg.ack()`.
5. On transient failure (HTTP 429/503): Increments `attempt_count`, calculates exponential backoff delay, and calls `msg.retry({ delaySeconds })`.

---

## 20. Google Tasks Adapter Specification

- **Role:** Authoritative for task existence, completion, and date-level task state (**WHAT**).
- **Constraints:** Google Tasks API discards the time portion of due dates. **Time-of-day is ignored.**
- **Sync Architecture:** Polling using `tasks.list` with `updatedMin` executed via a Cloudflare Cron Trigger (every 15 minutes).
- **Mapping:**
  - Tasks linked to Chapters create or update `task_links` in D1.
  - Task completion events emit `task_completed` canonical events.

---

## 21. Google Calendar Adapter Specification

- **Role:** Authoritative for time allocation, start/end times, and schedule blocks (**WHEN**).
- **Optimistic Concurrency Control:**
  1. Retrieve calendar event, capturing HTTP `ETag`.
  2. Apply proposed schedule adjustment.
  3. Send update with `If-Match: "<ETag>"`.
  4. If Google returns `412 Precondition Failed`: Refetch latest event state, reconcile conflicting time blocks, and retry.

---

## 22. Notion Adapter Specification

- **Role:** Human-readable knowledge repository, journal, and study library.
- **Sync Architecture:** Real-time Webhooks for inbound changes (`POST /v1/webhooks/notion`) combined with rate-limited queue consumption for outbound updates.
- **Rate Limit Throttling:** Strict enforcement of Notion's 3 requests per second limit per integration token using token-bucket rate limiting in the queue worker.
- **Information Boundary:** Notion receives curated summaries, daily aggregates, and syllabus structures. It **never** receives raw event streams or private AI chain-of-thought traces.

---

## 23. Gemini Spark Integration Contract

- **Role:** Scheduling reasoning and calendar optimization client.
- **Operation:**
  1. Calls MCP `get_today_state` to review daily progress and pending tasks.
  2. Queries Google Calendar for available time blocks.
  3. Formulates minimal, scoped schedule adjustments.
- **Safety Invariants:** Spark must follow minimal-mutation rules. Large unattended calendar mutations (> 5 events modified in a single run) are halted, requiring human confirmation.

---

## 24. Antigravity Integration Contract

- **Role:** Technical execution and source ingestion client.
- **Operation:** Executes local code builds, runs acceptance tests, extracts TOC structures from physical source PDFs, and calls MCP tools to persist metadata in D1. Does not act as a permanent database.

---

## 25. ChatGPT Integration Contract

- **Role:** Conversational reasoning, intent extraction, and planning assistant.
- **Operation:** Interacts with the user in active sessions. Emits structured intents. Does not perform unattended background mutations.

---

## 26. Memory Architecture

- **Temporal Fact Tracking:** Facts in `memory_facts` are tagged with `valid_at` and `invalid_at` ISO 8601 timestamps.
- **Mutation Operations:**
  - `ADD`: Inserts fact with `valid_at = now()`, `invalid_at = NULL`.
  - `UPDATE`: Sets `invalid_at = now()` on existing fact, inserts new fact version, logs to `memory_versions`.
  - `INVALIDATE`: Sets `invalid_at = now()`, marks fact superseded.
  - `NONE`: No-op confirmation.

---

## 27. Observability & Audit Trail

- **Structured Logging:** Cloudflare Logpush streams JSON logs to external storage (e.g. Cloudflare R2).
- **Trace Context:** Every log entry contains `trace_id`, `request_id`, and `correlation_id`.
- **Secret Redaction:** Bearer tokens, OAuth secrets, and user PII are sanitized before log output.

---

## 28. Rate Limiting & Throttling Architecture

- **Public REST & MCP APIs:** Cloudflare Rate Limiting rules enforce a maximum of 100 requests per minute per IP / client token.
- **Notion External API:** Queue consumer concurrency is capped at 1 worker with a 350ms inter-request delay to strictly comply with the 3 req/sec platform limit.

---

## 29. Testing Architecture & Quality Assurance

```text
               /\
              /E2E\             (23 Authoritative Acceptance Scenarios)
             /-----\
            / Integ \           (Miniflare D1 batch, Queue consumer idempotency)
           /---------\
          /  Contract \         (Zod schemas, MCP schemas, D1 migration verification)
         /-------------\
        /  Unit Tests   \       (Projection math, SHA-256 hashing, Timezone calculations)
       /-----------------\
```

---

## 30. The 23 Authoritative Acceptance Test Suites

The test suite must implement and pass all 23 explicit acceptance tests:

### Idempotency Suite
1. **Same Request + Same Idempotency Key:** Submitting an identical mutation with an existing key returns the cached response with zero duplicate events created.
2. **Different Request + Same Idempotency Key:** Submitting a modified payload with an existing key rejects immediately with `409 IDEMPOTENCY_CONFLICT`.
3. **Duplicate Queue Delivery:** Redelivery of an already-processed queue message is detected via `idempotency_records` and silently acknowledged without calling external APIs.
4. **External Mutation Followed by Lost Acknowledgement:** When a worker crashes after an external API mutation, redelivery checks external state (ETag/ID) and completes safely.
5. **Retry After Partial Failure:** When an atomic batch fails mid-pipeline, the entire transaction rolls back, leaving no orphan idempotency records.

### Calendar Suite
6. **Successful ETag Update:** Updating a calendar session passes the correct `If-Match` ETag and succeeds with HTTP 200.
7. **HTTP 412 Conflict:** Concurrently modifying a calendar event triggers an HTTP 412 Precondition Failed.
8. **Refetch + Reconcile:** Catching an HTTP 412 refetches the latest event, reconciles time blocks, and successfully updates.

### Notion Suite
9. **Successful Webhook Processing:** Valid Notion webhook payloads are ingested and trigger corresponding sync events.
10. **Rate-Limit 429:** When Notion returns HTTP 429, the consumer captures the error and defers message retry.
11. **Retry / Backoff:** Verify that repeated Notion failures follow exponential backoff delays ($5s, 10s, 20s \dots$).

### Authentication Suite
12. **Expired Token:** Requests with tokens past their `exp` timestamp return `401 Unauthorized` (`INVALID_TOKEN`).
13. **Invalid Signature:** Tokens signed with untrusted keys return `401 Unauthorized`.
14. **Invalid Issuer:** Tokens with mismatched `iss` return `401 Unauthorized`.
15. **Invalid Audience:** Valid JWTs with an incorrect `aud` return `403 Forbidden` (`AUDIENCE_MISMATCH`).
16. **Insufficient Scope:** Read-only tokens attempting `POST /v1/events` return `403 Forbidden` (`INSUFFICIENT_SCOPE`).

### State & Projection Suite
17. **Canonical Event Creation:** Ingesting an event persists immutable rows in `canonical_events`.
18. **Projection Update:** `questions_attempted` events update `questions_attempted`, `questions_correct`, and `accuracy` in `study_progress`.
19. **Projection Rebuild from Canonical Events:** Truncating `study_progress` and replaying canonical events restores 100% state accuracy.
20. **Daily-State Reconstruction:** Daily state accurately aggregates minutes, questions, and completed tasks according to user timezone.

### Migration Suite
21. **Fresh Database Migration:** Applying all migrations to an empty D1 SQLite database succeeds cleanly.
22. **Upgrade Migration:** Applying incremental migrations preserves existing event history and table records.
23. **Migration Integrity Validation:** Validates that all foreign key constraints and unique indexes are enforced.

---

## 31. CI/CD Pipeline Specification

GitHub Actions workflow executing on every push and pull request:
1. **Lint & Format:** `eslint .` and `prettier --check .`
2. **Typecheck:** `tsc --build` verifying full monorepo type safety.
3. **Unit & Contract Tests:** `vitest run tests/unit tests/contract`.
4. **Local D1 Migration Test:** Executes `wrangler d1 migrations apply DB --local` against Miniflare.
5. **Integration & E2E Tests:** `vitest run tests/integration tests/e2e`.
6. **Deployment:** On merge to `main`, deploys worker via `wrangler deploy`.

---

## 32. Environments Architecture

- **Local:** Miniflare local runtime with in-memory SQLite D1 and simulated Cloudflare Queues.
- **Staging:** Cloudflare preview worker bound to staging D1 database and sandbox Google/Notion test accounts.
- **Production:** Cloudflare production worker bound to production D1 database (`personal-ai-study-os-db`) and live production queues.

---

## 33. Deployment & Secrets Management

- **Deployment Tool:** Cloudflare Wrangler (`wrangler deploy`).
- **Secrets Management:** External API keys and OAuth secrets are injected via `wrangler secret put` and stored securely in Cloudflare's encrypted secret store:
  - `NOTION_API_KEY`
  - `NOTION_WEBHOOK_SECRET`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `JWT_JWKS_URI`
- **Zero Secrets in D1:** No secrets or private authentication tokens are ever stored in D1 database tables.

---

## 34. Rollback & Recovery Runbooks

- **Worker Code Rollback:** Execute `wrangler rollback [deployment-id]` to instantly revert worker application code.
- **Database Schema Recovery:** In accordance with the forward-only migration policy, execute a forward-fix migration (`XXXX_remedy.sql`).
- **Corrupted Projection Recovery:** Trigger `POST /v1/admin/rebuild-projections` to replay immutable events and recreate derived tables.

---

## 35. Operational Runbooks

### 35.1 Notion 429 Rate Limit Storm
1. Detect: Monitor worker logs for elevated rates of HTTP 429 from `api.notion.com`.
2. Contain: Temporarily pause queue consumer processing: `wrangler queues pause personal-sync-queue`.
3. Resolve: Adjust consumer concurrency settings in `wrangler.toml` and verify token-bucket delays.
4. Resume: Unpause queue and allow messages to drain with backoff: `wrangler queues resume personal-sync-queue`.

### 35.2 Calendar 412 Precondition Failed Spikes
1. Detect: Alerts trigger on multiple `412 Precondition Failed` responses from Google Calendar.
2. Contain: Verify if concurrent clients (Spark vs. User) are modifying overlapping events.
3. Resolve: Ensure adapter ETag refetch-reconcile loop is functioning properly.

---

## 36. Implementation Sequence (12 Ordered Phases)

The production build must proceed in strict dependency order:

```text
Phase 0: Foundation & Tooling (Monorepo, Zod, TypeScript, Vitest)
  ↓
Phase 1: D1 Database & Migrations (Kysely Schema, 23 Tables, Initial Migrations)
  ↓
Phase 2: Domain Model & Validation (Typed Entities, 30+ Event Schemas, Errors)
  ↓
Phase 3: Canonical Event Engine (Atomic Ingestion Pipeline, db.batch)
  ↓
Phase 4: Projection Engine (Derived State Handlers, Rebuild Routines)
  ↓
Phase 5: REST API & Authentication (OAuth 2.1, JWT JWKS, Audience Validation)
  ↓
Phase 6: Remote MCP Server (SSE Transport, Semantic Tools, No Raw SQL)
  ↓
Phase 7: Queue & Idempotency Engine (Cloudflare Queues Consumer, DLQ, Deduplication)
  ↓
Phase 8: Google Calendar Adapter (ETag, If-Match Concurrency, Reconciliation)
  ↓
Phase 9: Google Tasks Adapter (Date-Only Polling, updatedMin, Task Links)
  ↓
Phase 10: Notion Adapter (Webhook Receiver, 3 req/sec Rate Limiter, Mappings)
  ↓
Phase 11: Observability, E2E Acceptance Testing & CI/CD (23 Tests Suite, Final Verification)
```

---

## 37. Existing Implementation Compatibility Audit

An exhaustive audit of the existing codebase located at `c:\Users\Suraj\Documents\Antigravity\Personal\personal-ai-study-os` was conducted to benchmark current files against this specification:

| Subsystem / File | Current State | Classification | Required Remediation for Implementation |
| :--- | :--- | :--- | :--- |
| `apps/worker/wrangler.toml` | References `src/index.ts` (does not exist). Queue & DLQ bindings defined. | **Partially Aligned** | Create `apps/worker/src/index.ts` routing REST, MCP, and Queue consumers. |
| `apps/worker/migrations/0001_initial_schema.sql` | 16 tables defined. Lacks 7 tables (`study_sessions`, `state_snapshots`, `checkpoints`, `project_events`, `research_events`, `decisions`, `memory_versions`, `schedule_links`). | **Needs Replacement / Extension** | Replace or supersede with complete 23-table schema in migration `0002_reconciled_v1_1_schema.sql`. |
| `packages/domain/src/entities.ts` | 6 entity schemas (`User`, `Subject`, `Chapter`, `StudyProgress`, `SyncJob`, `IdempotencyRecord`). `IdempotencyRecord` has `jobId: z.string()`. | **Inconsistent / Needs Extension** | Decouple `jobId` in `IdempotencyRecordSchema` (make optional). Add missing domain schemas. |
| `packages/domain/src/events.ts` | 3 event schemas defined (`study_completed`, `questions_attempted`, `chapter_completed`). | **Needs Extension** | Expand to full 30+ canonical event schemas defined in Technical Contracts v1.1. |
| `packages/db` | `package.json` contains Kysely dependency. Zero source files. | **Needs Implementation** | Implement Kysely table interfaces, D1 batch client, and repositories. |
| `packages/core` | `package.json` exists. Zero source files. | **Needs Implementation** | Implement Event Engine (`event-engine.ts`) and Projection Engine (`projection-engine.ts`). |
| `packages/adapters` | `package.json` exists. Zero source files. | **Needs Implementation** | Implement `google-tasks.ts`, `google-calendar.ts`, and `notion.ts`. |
| `apps/worker/src/` | Directory does not exist. | **Needs Implementation** | Implement Worker application, REST routes, MCP server, and auth middleware. |

*Architectural Lockout Finding:* In existing code, `idempotency_records.job_id` is declared `TEXT NOT NULL`. This prevents any REST API or MCP tool from recording idempotency keys prior to background queue dispatch. This specification explicitly corrects `job_id` to be nullable in D1 and optional in Zod.

---

## 38. Architecture Invariants & Ownership Matrix

### 38.1 Non-Negotiable Ownership Matrix

| System | Primary Responsibility | Authoritative Data | Strictly Forbidden Operations |
| :--- | :--- | :--- | :--- |
| **Google Tasks** | Task existence & completion (**WHAT**) | Task status, task completion, date-level work | Cannot manage intra-day hours or precise time blocks. |
| **Google Calendar** | Time allocation & scheduling (**WHEN**) | Start/end times, schedule blocks, study sessions | Cannot act as the task checklist source of truth. |
| **Gemini Spark** | Scheduling optimization | Proposed calendar adjustments | Cannot perform mass unattended deletions or overwrite history. |
| **Notion** | Human memory & knowledge plane | Curated notes, journal entries, study library | Cannot receive raw telemetry or machine event dumps. |
| **Cloudflare D1** | Machine truth & event history | Canonical events, derived projections, cross-system links | Cannot store copyrighted book texts or user secrets. |
| **ChatGPT** | Reasoning & intent generation | Structured intent proposals in active sessions | Cannot execute unattended background mutations. |
| **Antigravity** | Technical execution & ingestion | Code execution, build validation, source TOC extraction | Cannot act as permanent state store. |

### 38.2 Core Architectural Principles
1. **Canonical events are append-only and immutable.** Historical events are never updated or deleted.
2. **Derived state is 100% rebuildable.** Loss of projection tables can be restored by replaying canonical events.
3. **External mutations are idempotent.** Duplicate queue deliveries or API retries never produce duplicate side-effects.
4. **No direct agent-to-agent coupling.** All coordination is mediated via the Personal State Service.

---

## 39. Architectural Decision Records (ADR Register)

- **ADR-001: Cloudflare D1 with Batch API for Atomic Mutations:** Adopted D1 `db.batch()` implicit transactions; rejected explicit `BEGIN`/`COMMIT`.
- **ADR-002: At-Least-Once Messaging with Consumer-Side Idempotency:** Mandated pre-mutation checks against `idempotency_records` before external API calls.
- **ADR-003: Optimistic Concurrency Control for Google Calendar:** Mandated `ETag` and `If-Match` headers for calendar updates with automatic HTTP 412 reconciliation.
- **ADR-004: Webhooks with Rate-Limited Queue Throttling for Notion:** Replaced expensive polling with real-time webhooks, throttled to 3 req/sec in queue consumers.
- **ADR-005: Forward-Only Database Migrations:** Prohibited database rollbacks on D1; mandated forward-fix migrations and backward-compatible schema changes.
- **ADR-006: Reallocation of Precise Scheduling from Tasks to Calendar:** Reallocated all time-of-day tracking strictly to Google Calendar due to Tasks API constraints.
- **ADR-007: Mandatory OAuth 2.1 Audience Validation:** Enforced strict `aud` verification on incoming JWTs to prevent confused deputy attacks.
- **ADR-008: Metadata-Only Source Ingestion:** Prohibited storage of copyrighted book text in D1, restricting storage to TOC structures and syllabus mappings.

---

## 40. Build Readiness Status & Gate 3 Sign-off

```text
IMPLEMENTATION SPECIFICATION STATUS

Version: 1.1
Gate 3: RECONCILED
Architecture: GREEN
Contract Alignment: GREEN
Implementation Specification: READY FOR FINAL BUILD READINESS REVIEW
Production Build: NOT YET AUTHORIZED
```
