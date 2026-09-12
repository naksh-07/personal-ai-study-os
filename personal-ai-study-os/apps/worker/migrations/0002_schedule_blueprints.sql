-- ============================================================================
-- Personal AI Study OS — Migration 0002: Schedule Blueprints, Time Maps & Constraints
-- Authoritative Runtime Policy & Schedule Blueprint Layer
-- (PRAGMA foreign_keys = ON)
-- ============================================================================

-- 1. Schedule Blueprints
CREATE TABLE schedule_blueprints (
    id TEXT PRIMARY KEY,                           -- bp_01J...
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                            -- Display name, e.g. 'Standard Academic Blueprint'
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata', -- Authoritative scheduling timezone
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 1,
    max_daily_deep_work_minutes INTEGER NOT NULL DEFAULT 270 CHECK (max_daily_deep_work_minutes > 0),
    max_daily_focus_containers INTEGER NOT NULL DEFAULT 3 CHECK (max_daily_focus_containers > 0),
    max_continuous_session_minutes INTEGER NOT NULL DEFAULT 90 CHECK (max_continuous_session_minutes > 0),
    default_decompression_buffer_minutes INTEGER NOT NULL DEFAULT 15 CHECK (default_decompression_buffer_minutes >= 0),
    freeze_window_minutes INTEGER NOT NULL DEFAULT 120 CHECK (freeze_window_minutes >= 0),
    buffer_days TEXT NOT NULL DEFAULT '[0]',       -- JSON array of day indices (0=Sun, 6=Sat)
    created_at TEXT NOT NULL,                      -- ISO 8601 UTC
    updated_at TEXT NOT NULL                       -- ISO 8601 UTC
);
CREATE INDEX idx_blueprints_user_active ON schedule_blueprints(user_id, is_active);

-- 2. Schedule Time Maps
CREATE TABLE schedule_time_maps (
    id TEXT PRIMARY KEY,                           -- tm_01J...
    blueprint_id TEXT NOT NULL REFERENCES schedule_blueprints(id) ON DELETE CASCADE,
    day_of_week INTEGER CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)), -- NULL = all days
    start_time TEXT NOT NULL,                      -- 'HH:MM' in blueprint timezone, e.g. '09:00'
    end_time TEXT NOT NULL,                        -- 'HH:MM' in blueprint timezone, e.g. '11:30'
    subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
    activity_type TEXT NOT NULL CHECK (activity_type IN ('deep_work', 'pyq_practice', 'revision', 'lecture')),
    container_id TEXT,                             -- e.g. 'morning_focus', 'afternoon_practice', 'evening_consolidation'
    is_optional INTEGER NOT NULL DEFAULT 0 CHECK (is_optional IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_time_maps_blueprint_day ON schedule_time_maps(blueprint_id, day_of_week);

-- 3. Schedule Constraints
CREATE TABLE schedule_constraints (
    id TEXT PRIMARY KEY,                           -- sc_01J...
    blueprint_id TEXT NOT NULL REFERENCES schedule_blueprints(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                            -- e.g. 'Sleep Window', 'Lunch Routine', 'Gym / Health'
    constraint_type TEXT NOT NULL CHECK (constraint_type IN ('biological_invariant', 'fixed_commitment', 'personal_routine', 'curriculum_buffer')),
    day_of_week INTEGER CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)), -- NULL = every day
    start_time TEXT NOT NULL,                      -- 'HH:MM' in blueprint timezone, e.g. '23:00'
    end_time TEXT NOT NULL,                        -- 'HH:MM' in blueprint timezone, e.g. '07:00'
    is_hard INTEGER NOT NULL DEFAULT 1 CHECK (is_hard IN (0, 1)), -- 1 = Inviolable hard constraint, 0 = Flexible preference
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_constraints_blueprint_day ON schedule_constraints(blueprint_id, day_of_week);

-- ============================================================================
-- Baseline Seed Data: Active Blueprint & Biological Invariants for usr_operator
-- (Conditionally applied if usr_operator exists in database)
-- ============================================================================

-- Ensure operator timezone is Asia/Kolkata if operator exists
UPDATE users SET timezone = 'Asia/Kolkata', updated_at = '2026-09-12T00:00:00.000Z'
WHERE id = 'usr_operator' AND timezone = 'UTC';

-- Seed active blueprint
INSERT OR IGNORE INTO schedule_blueprints (
    id, user_id, name, timezone, is_active, version,
    max_daily_deep_work_minutes, max_daily_focus_containers,
    max_continuous_session_minutes, default_decompression_buffer_minutes,
    freeze_window_minutes, buffer_days, created_at, updated_at
)
SELECT
    'bp_default_academic', 'usr_operator', 'Standard Academic Blueprint', 'Asia/Kolkata', 1, 1,
    270, 3, 90, 15, 120, '[0]', '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'usr_operator');

-- Seed standard weekly time maps
INSERT OR IGNORE INTO schedule_time_maps (
    id, blueprint_id, day_of_week, start_time, end_time, subject_id, activity_type, container_id, is_optional, created_at, updated_at
)
SELECT 'tm_morning_focus', 'bp_default_academic', NULL, '09:00', '11:30', NULL, 'deep_work', 'morning_focus', 0, '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_default_academic');

INSERT OR IGNORE INTO schedule_time_maps (
    id, blueprint_id, day_of_week, start_time, end_time, subject_id, activity_type, container_id, is_optional, created_at, updated_at
)
SELECT 'tm_afternoon_practice', 'bp_default_academic', NULL, '14:30', '17:00', NULL, 'pyq_practice', 'afternoon_practice', 0, '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_default_academic');

INSERT OR IGNORE INTO schedule_time_maps (
    id, blueprint_id, day_of_week, start_time, end_time, subject_id, activity_type, container_id, is_optional, created_at, updated_at
)
SELECT 'tm_evening_consolidation', 'bp_default_academic', NULL, '19:30', '21:30', NULL, 'revision', 'evening_consolidation', 1, '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_default_academic');

-- Seed biological invariants and personal constraints
INSERT OR IGNORE INTO schedule_constraints (
    id, blueprint_id, name, constraint_type, day_of_week, start_time, end_time, is_hard, created_at, updated_at
)
SELECT 'sc_sleep_window', 'bp_default_academic', 'Sleep & Recovery Window', 'biological_invariant', NULL, '23:00', '07:00', 1, '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_default_academic');

INSERT OR IGNORE INTO schedule_constraints (
    id, blueprint_id, name, constraint_type, day_of_week, start_time, end_time, is_hard, created_at, updated_at
)
SELECT 'sc_lunch_routine', 'bp_default_academic', 'Lunch & Mental Break', 'biological_invariant', NULL, '12:30', '13:30', 1, '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_default_academic');

INSERT OR IGNORE INTO schedule_constraints (
    id, blueprint_id, name, constraint_type, day_of_week, start_time, end_time, is_hard, created_at, updated_at
)
SELECT 'sc_dinner_routine', 'bp_default_academic', 'Dinner & Evening Break', 'biological_invariant', NULL, '20:30', '21:30', 1, '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_default_academic');

INSERT OR IGNORE INTO schedule_constraints (
    id, blueprint_id, name, constraint_type, day_of_week, start_time, end_time, is_hard, created_at, updated_at
)
SELECT 'sc_physical_exercise', 'bp_default_academic', 'Physical Exercise / Health', 'personal_routine', NULL, '17:30', '18:30', 0, '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_default_academic');
