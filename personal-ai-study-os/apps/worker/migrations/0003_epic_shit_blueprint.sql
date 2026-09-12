-- ============================================================================
-- Personal AI Study OS — Migration 0003: Epic Shit OG Personal Timetable Blueprint Seed
-- Authoritative Machine-Readable Schedule Blueprint for THE EPIC SHIT v0.1
-- (PRAGMA foreign_keys = ON)
-- ============================================================================

-- Seed OG Timetable Blueprint (bp_epic_shit_og)
INSERT OR IGNORE INTO schedule_blueprints (
    id, user_id, name, timezone, is_active, version,
    max_daily_deep_work_minutes, max_daily_focus_containers,
    max_continuous_session_minutes, default_decompression_buffer_minutes,
    freeze_window_minutes, buffer_days, created_at, updated_at
)
SELECT
    'bp_epic_shit_og', 'usr_operator', 'The Epic Shit — OG Personal Timetable Blueprint v0.1', 'Asia/Kolkata', 0, 1,
    270, 7, 90, 15, 120, '[0]', '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'usr_operator');

-- Seed 7 OG Timetable time maps
INSERT OR IGNORE INTO schedule_time_maps (
    id, blueprint_id, day_of_week, start_time, end_time, subject_id, activity_type, container_id, is_optional, created_at, updated_at
)
SELECT 'tm_og_maths_anchor', 'bp_epic_shit_og', NULL, '08:30', '10:15', NULL, 'deep_work', 'maths_anchor', 0, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_epic_shit_og');

INSERT OR IGNORE INTO schedule_time_maps (
    id, blueprint_id, day_of_week, start_time, end_time, subject_id, activity_type, container_id, is_optional, created_at, updated_at
)
SELECT 'tm_og_reasoning_anchor', 'bp_epic_shit_og', NULL, '10:30', '12:00', NULL, 'pyq_practice', 'reasoning_anchor', 0, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_epic_shit_og');

INSERT OR IGNORE INTO schedule_time_maps (
    id, blueprint_id, day_of_week, start_time, end_time, subject_id, activity_type, container_id, is_optional, created_at, updated_at
)
SELECT 'tm_og_rotation_a', 'bp_epic_shit_og', NULL, '13:30', '15:00', NULL, 'deep_work', 'academic_rotation_a', 0, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_epic_shit_og');

INSERT OR IGNORE INTO schedule_time_maps (
    id, blueprint_id, day_of_week, start_time, end_time, subject_id, activity_type, container_id, is_optional, created_at, updated_at
)
SELECT 'tm_og_rotation_b', 'bp_epic_shit_og', NULL, '15:20', '16:50', NULL, 'deep_work', 'academic_rotation_b', 0, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_epic_shit_og');

INSERT OR IGNORE INTO schedule_time_maps (
    id, blueprint_id, day_of_week, start_time, end_time, subject_id, activity_type, container_id, is_optional, created_at, updated_at
)
SELECT 'tm_og_consolidation', 'bp_epic_shit_og', NULL, '17:30', '18:15', NULL, 'revision', 'consolidation', 0, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_epic_shit_og');

INSERT OR IGNORE INTO schedule_time_maps (
    id, blueprint_id, day_of_week, start_time, end_time, subject_id, activity_type, container_id, is_optional, created_at, updated_at
)
SELECT 'tm_og_secondary', 'bp_epic_shit_og', NULL, '19:30', '20:30', NULL, 'deep_work', 'secondary_activity', 1, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_epic_shit_og');

INSERT OR IGNORE INTO schedule_time_maps (
    id, blueprint_id, day_of_week, start_time, end_time, subject_id, activity_type, container_id, is_optional, created_at, updated_at
)
SELECT 'tm_og_night_retrieval', 'bp_epic_shit_og', NULL, '21:15', '22:00', NULL, 'revision', 'night_retrieval', 0, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_epic_shit_og');

-- Seed 6 OG biological and routine constraints
INSERT OR IGNORE INTO schedule_constraints (
    id, blueprint_id, name, constraint_type, day_of_week, start_time, end_time, is_hard, created_at, updated_at
)
SELECT 'sc_og_sleep_curfew', 'bp_epic_shit_og', 'Sleep & Biological Curfew', 'biological_invariant', NULL, '22:20', '07:00', 1, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_epic_shit_og');

INSERT OR IGNORE INTO schedule_constraints (
    id, blueprint_id, name, constraint_type, day_of_week, start_time, end_time, is_hard, created_at, updated_at
)
SELECT 'sc_og_morning_routine', 'bp_epic_shit_og', 'Morning Routine & Readiness', 'personal_routine', NULL, '07:00', '08:30', 0, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_epic_shit_og');

INSERT OR IGNORE INTO schedule_constraints (
    id, blueprint_id, name, constraint_type, day_of_week, start_time, end_time, is_hard, created_at, updated_at
)
SELECT 'sc_og_lunch_break', 'bp_epic_shit_og', 'Lunch, Reset & Digestion', 'biological_invariant', NULL, '12:00', '13:30', 1, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_epic_shit_og');

INSERT OR IGNORE INTO schedule_constraints (
    id, blueprint_id, name, constraint_type, day_of_week, start_time, end_time, is_hard, created_at, updated_at
)
SELECT 'sc_og_physical_tea', 'bp_epic_shit_og', 'Physical Movement, Tea & Mental Reset', 'personal_routine', NULL, '16:50', '17:30', 0, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_epic_shit_og');

INSERT OR IGNORE INTO schedule_constraints (
    id, blueprint_id, name, constraint_type, day_of_week, start_time, end_time, is_hard, created_at, updated_at
)
SELECT 'sc_og_dinner_break', 'bp_epic_shit_og', 'Dinner & Evening Break', 'biological_invariant', NULL, '20:30', '21:15', 1, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_epic_shit_og');

INSERT OR IGNORE INTO schedule_constraints (
    id, blueprint_id, name, constraint_type, day_of_week, start_time, end_time, is_hard, created_at, updated_at
)
SELECT 'sc_og_shutdown_routine', 'bp_epic_shit_og', 'Night Shutdown Routine & Wind-Down', 'personal_routine', NULL, '22:00', '22:20', 0, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM schedule_blueprints WHERE id = 'bp_epic_shit_og');
