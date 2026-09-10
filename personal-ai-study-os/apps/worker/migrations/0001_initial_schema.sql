-- ============================================================================
-- Personal AI Study OS — Production D1 Initial Schema (v1.2.3 Frozen Baseline)
-- Exactly 24 Authoritative Tables Across 8 Domains
-- Single-Tenant V1 Deployment Boundary (PRAGMA foreign_keys = ON)
-- ============================================================================

-- ============================================================================
-- 1. IDENTITY & CORE DOMAIN (3 Tables)
-- ============================================================================

CREATE TABLE users (
    id TEXT PRIMARY KEY,                           -- usr_01J... Single-tenant anchor
    timezone TEXT NOT NULL DEFAULT 'UTC',          -- IANA timezone identifier, e.g. 'Asia/Kolkata'
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deactivated')),
    created_at TEXT NOT NULL,                      -- ISO 8601 UTC
    updated_at TEXT NOT NULL                       -- ISO 8601 UTC
);

CREATE TABLE subjects (
    id TEXT PRIMARY KEY,                           -- subj_01J...
    name TEXT NOT NULL,                            -- Display name, e.g. 'Physics'
    slug TEXT NOT NULL UNIQUE,                     -- Query-safe unique slug, e.g. 'physics'
    description TEXT,                              -- Syllabus description
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE chapters (
    id TEXT PRIMARY KEY,                           -- chap_01J...
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,                            -- Display name, e.g. 'Current Electricity'
    slug TEXT NOT NULL,                            -- Query-safe slug, e.g. 'current-electricity'
    parent_id TEXT REFERENCES chapters(id) ON DELETE RESTRICT, -- Supports Subject -> Unit -> Chapter -> Topic
    status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
    progress REAL NOT NULL DEFAULT 0.0 CHECK (progress >= 0.0 AND progress <= 1.0),
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
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
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
    ended_at TEXT NOT NULL CHECK (ended_at >= started_at), -- ended_at >= started_at
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
    activity_type TEXT NOT NULL CHECK (activity_type IN ('revision', 'pyq_practice', 'lecture', 'deep_work')),
    source TEXT NOT NULL,                          -- Origin of session data, e.g. 'google_calendar'
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'interrupted')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_study_sessions_chapter ON study_sessions(chapter_id, started_at);

CREATE TABLE study_progress (
    id TEXT PRIMARY KEY,                           -- prog_01J...
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')),
    progress_percent REAL NOT NULL DEFAULT 0.0 CHECK (progress_percent >= 0.0 AND progress_percent <= 1.0),
    confidence REAL NOT NULL DEFAULT 0.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    last_studied_at TEXT,                          -- ISO 8601 UTC of latest study session
    last_completed_at TEXT,                        -- ISO 8601 UTC of chapter completion
    questions_attempted INTEGER NOT NULL DEFAULT 0 CHECK (questions_attempted >= 0),
    questions_correct INTEGER NOT NULL DEFAULT 0 CHECK (questions_correct >= 0 AND questions_correct <= questions_attempted),
    accuracy REAL NOT NULL DEFAULT 0.0 CHECK (accuracy >= 0.0 AND accuracy <= 1.0),
    updated_at TEXT NOT NULL,
    UNIQUE(chapter_id)
);
CREATE INDEX idx_study_progress_subject ON study_progress(subject_id);

CREATE TABLE daily_states (
    id TEXT PRIMARY KEY,                           -- daily_01J...
    date TEXT NOT NULL UNIQUE,                     -- YYYY-MM-DD in user's configured timezone
    study_minutes INTEGER NOT NULL DEFAULT 0 CHECK (study_minutes >= 0),
    completed_chapters INTEGER NOT NULL DEFAULT 0 CHECK (completed_chapters >= 0),
    questions_attempted INTEGER NOT NULL DEFAULT 0 CHECK (questions_attempted >= 0),
    questions_correct INTEGER NOT NULL DEFAULT 0 CHECK (questions_correct >= 0 AND questions_correct <= questions_attempted),
    accuracy REAL NOT NULL DEFAULT 0.0 CHECK (accuracy >= 0.0 AND accuracy <= 1.0),
    missed_sessions INTEGER NOT NULL DEFAULT 0 CHECK (missed_sessions >= 0),
    completed_tasks INTEGER NOT NULL DEFAULT 0 CHECK (completed_tasks >= 0),
    pending_tasks INTEGER NOT NULL DEFAULT 0 CHECK (pending_tasks >= 0),
    state_payload TEXT NOT NULL,                   -- JSON summary for Notion journal & AI context
    updated_at TEXT NOT NULL
);

-- ============================================================================
-- 3. SOURCES DOMAIN (3 Tables)
-- ============================================================================

CREATE TABLE sources (
    id TEXT PRIMARY KEY,                           -- src_01J...
    title TEXT NOT NULL,                           -- Display title, e.g. 'Concepts of Physics'
    source_type TEXT NOT NULL CHECK (source_type IN ('book', 'pdf', 'syllabus', 'notes')),
    author TEXT,                                   -- e.g. 'H.C. Verma'
    publisher TEXT,                                -- Publisher name
    edition TEXT,                                  -- e.g. 'Vol 1, 2024'
    reference_uri TEXT,                            -- File path, URL, or identifier (NO raw text)
    status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'mapped', 'archived')),
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
    mapping_type TEXT NOT NULL DEFAULT 'direct' CHECK (mapping_type IN ('direct', 'partial', 'prerequisite')),
    relevance TEXT NOT NULL DEFAULT 'high' CHECK (relevance IN ('high', 'medium', 'low')),
    confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
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
    entity_type TEXT NOT NULL CHECK (entity_type IN ('chapter', 'project')),
    entity_id TEXT NOT NULL,                       -- ID of linked chapter or project
    title_snapshot TEXT,                           -- Last known task title
    status_snapshot TEXT CHECK (status_snapshot IS NULL OR status_snapshot IN ('needsAction', 'completed')),
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
    entity_type TEXT NOT NULL CHECK (entity_type IN ('study_session', 'task')),
    entity_id TEXT NOT NULL,                       -- ID of linked study session or task
    title_snapshot TEXT,                           -- Event summary snapshot
    starts_at TEXT NOT NULL,                       -- ISO 8601 UTC start time
    ends_at TEXT NOT NULL,                         -- ISO 8601 UTC end time
    status_snapshot TEXT CHECK (status_snapshot IS NULL OR status_snapshot IN ('confirmed', 'tentative', 'cancelled')),
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
    relationship_type TEXT NOT NULL DEFAULT 'session_for_task' CHECK (relationship_type IN ('session_for_task', 'deadline')),
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
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'paused', 'completed', 'cancelled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE project_events (
    id TEXT PRIMARY KEY,                           -- progevt_01J...
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('started', 'milestone_reached', 'completed')),
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
    category TEXT NOT NULL CHECK (category IN ('convention', 'preference', 'constraint', 'pattern')),
    valid_at TEXT NOT NULL,                        -- ISO 8601 UTC when fact became true
    invalid_at TEXT,                               -- ISO 8601 UTC when superseded (NULL = currently valid)
    created_at TEXT NOT NULL
);
CREATE INDEX idx_memory_facts_valid ON memory_facts(valid_at, invalid_at);

CREATE TABLE memory_versions (
    id TEXT PRIMARY KEY,                           -- memver_01J...
    memory_fact_id TEXT NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
    operation TEXT NOT NULL CHECK (operation IN ('ADD', 'UPDATE', 'INVALIDATE', 'NONE')),
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
    status TEXT NOT NULL CHECK (status IN ('started', 'running', 'completed', 'failed')),
    started_at TEXT NOT NULL,                      -- ISO 8601 UTC
    completed_at TEXT,                             -- ISO 8601 UTC
    result_summary TEXT,                           -- High-level outcome description
    error_code TEXT,                               -- Machine-readable error code if failed
    payload TEXT,                                  -- JSON metadata (NO private thinking/traces)
    created_at TEXT NOT NULL
);

CREATE TABLE state_snapshots (
    id TEXT PRIMARY KEY,                           -- snap_01J...
    snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('daily', 'milestone', 'pre_migration')),
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
    target_system TEXT NOT NULL CHECK (target_system IN ('notion', 'google_tasks', 'google_calendar')),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('study_progress', 'daily_state', 'task', 'chapter')),
    entity_id TEXT NOT NULL,                       -- Target canonical domain entity ID
    operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete', 'sync')),
    payload_json TEXT NOT NULL,                    -- Self-contained serialized mutation payload
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DISPATCHED', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
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
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
    result_payload TEXT,                           -- Cached JSON response body for replay
    created_at TEXT NOT NULL,                      -- ISO 8601 UTC
    updated_at TEXT NOT NULL,                      -- ISO 8601 UTC
    expires_at TEXT NOT NULL                       -- ISO 8601 UTC expiration timestamp (now + 24h)
);
CREATE INDEX idx_idempotency_records_expires ON idempotency_records(expires_at);
