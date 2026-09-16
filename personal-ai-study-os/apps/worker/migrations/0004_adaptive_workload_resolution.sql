-- ============================================================================
-- Personal AI Study OS — Migration 0004: Adaptive Workload Resolution
-- Level 0–4 Workload Hierarchy & Flexible Session Model
-- (PRAGMA foreign_keys = ON)
-- ============================================================================

-- 1. Create new study_sessions table with nullable chapter_id and resolution metadata
CREATE TABLE study_sessions_new (
    id TEXT PRIMARY KEY,                           -- sess_01J...
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    chapter_id TEXT REFERENCES chapters(id) ON DELETE RESTRICT, -- Nullable for Level 1 (Subject-only)
    topic_id TEXT,                                 -- Optional topic identifier (Level 3/4)
    task_id TEXT,                                  -- Optional task link identifier (Level 4)
    resolution TEXT NOT NULL DEFAULT 'chapter' CHECK (resolution IN ('subject', 'chapter', 'topic', 'task')),
    started_at TEXT NOT NULL,                      -- ISO 8601 UTC
    ended_at TEXT NOT NULL CHECK (ended_at >= started_at),
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
    activity_type TEXT NOT NULL CHECK (activity_type IN ('revision', 'pyq_practice', 'lecture', 'deep_work')),
    source TEXT NOT NULL,                          -- Origin of session data, e.g. 'rest', 'mcp', 'google_calendar'
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'interrupted')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 2. Migrate existing records preserving historical integrity with resolution='chapter'
INSERT INTO study_sessions_new (
    id,
    subject_id,
    chapter_id,
    topic_id,
    task_id,
    resolution,
    started_at,
    ended_at,
    duration_seconds,
    activity_type,
    source,
    status,
    created_at,
    updated_at
)
SELECT
    id,
    subject_id,
    chapter_id,
    NULL AS topic_id,
    NULL AS task_id,
    'chapter' AS resolution,
    started_at,
    ended_at,
    duration_seconds,
    activity_type,
    source,
    status,
    created_at,
    updated_at
FROM study_sessions;

-- 3. Replace old table with new table
DROP TABLE study_sessions;
ALTER TABLE study_sessions_new RENAME TO study_sessions;

-- 4. Recreate indices including subject-level and resolution queries
CREATE INDEX idx_study_sessions_chapter ON study_sessions(chapter_id, started_at);
CREATE INDEX idx_study_sessions_subject ON study_sessions(subject_id, started_at);
CREATE INDEX idx_study_sessions_resolution ON study_sessions(resolution, started_at);
