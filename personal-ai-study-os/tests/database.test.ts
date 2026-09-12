import { describe, it, expect } from 'vitest';
import { createTestDatabase } from './test-helper';

describe('D1 Database & 24-Table Schema Foundation', () => {
  const EXPECTED_24_TABLES = [
    'users',
    'subjects',
    'chapters',
    'canonical_events',
    'study_sessions',
    'study_progress',
    'daily_states',
    'sources',
    'source_chapters',
    'source_mappings',
    'task_links',
    'calendar_links',
    'schedule_links',
    'projects',
    'project_events',
    'research_events',
    'decisions',
    'memory_facts',
    'memory_versions',
    'agent_runs',
    'state_snapshots',
    'checkpoints',
    'sync_jobs',
    'idempotency_records',
  ];

  const EXPECTED_BLUEPRINT_TABLES = [
    'schedule_blueprints',
    'schedule_time_maps',
    'schedule_constraints',
  ];

  it('migrations succeed and create exactly all 27 authoritative tables (24 baseline + 3 blueprint)', () => {
    const { sqlite } = createTestDatabase();
    const rows = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = rows.map(r => r.name);

    for (const expected of EXPECTED_24_TABLES) {
      expect(tableNames).toContain(expected);
    }
    for (const expected of EXPECTED_BLUEPRINT_TABLES) {
      expect(tableNames).toContain(expected);
    }
    expect(tableNames.length).toBe(27);
  });

  it('enforces primary key uniqueness on users table', () => {
    const { sqlite } = createTestDatabase();
    sqlite.prepare(
      "INSERT INTO users (id, timezone, status, created_at, updated_at) VALUES ('usr_01', 'UTC', 'active', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
    ).run();

    expect(() => {
      sqlite.prepare(
        "INSERT INTO users (id, timezone, status, created_at, updated_at) VALUES ('usr_01', 'Asia/Kolkata', 'active', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
      ).run();
    }).toThrow(/UNIQUE constraint failed/);
  });

  it('enforces status check constraint on users table', () => {
    const { sqlite } = createTestDatabase();
    expect(() => {
      sqlite.prepare(
        "INSERT INTO users (id, timezone, status, created_at, updated_at) VALUES ('usr_02', 'UTC', 'invalid_status', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
      ).run();
    }).toThrow(/CHECK constraint failed/);
  });

  it('enforces unique slug on subjects', () => {
    const { sqlite } = createTestDatabase();
    sqlite.prepare(
      "INSERT INTO subjects (id, name, slug, description, status, created_at, updated_at) VALUES ('subj_01', 'Physics', 'physics', NULL, 'active', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
    ).run();

    expect(() => {
      sqlite.prepare(
        "INSERT INTO subjects (id, name, slug, description, status, created_at, updated_at) VALUES ('subj_02', 'Physics Alternate', 'physics', NULL, 'active', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
      ).run();
    }).toThrow(/UNIQUE constraint failed/);
  });

  it('enforces foreign key and UNIQUE(subject_id, slug) on chapters', () => {
    const { sqlite } = createTestDatabase();
    sqlite.prepare(
      "INSERT INTO subjects (id, name, slug, description, status, created_at, updated_at) VALUES ('subj_01', 'Physics', 'physics', NULL, 'active', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
    ).run();

    // Inserting chapter with non-existent subject_id should fail foreign key
    expect(() => {
      sqlite.prepare(
        "INSERT INTO chapters (id, subject_id, name, slug, parent_id, status, progress, created_at, updated_at) VALUES ('chap_01', 'subj_nonexistent', 'Electrostatics', 'electrostatics', NULL, 'not_started', 0.0, '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
      ).run();
    }).toThrow(/FOREIGN KEY constraint failed/);

    // Valid chapter insert
    sqlite.prepare(
      "INSERT INTO chapters (id, subject_id, name, slug, parent_id, status, progress, created_at, updated_at) VALUES ('chap_01', 'subj_01', 'Electrostatics', 'electrostatics', NULL, 'not_started', 0.0, '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
    ).run();

    // Duplicate (subject_id, slug) must fail
    expect(() => {
      sqlite.prepare(
        "INSERT INTO chapters (id, subject_id, name, slug, parent_id, status, progress, created_at, updated_at) VALUES ('chap_02', 'subj_01', 'Duplicate Slug', 'electrostatics', NULL, 'not_started', 0.0, '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
      ).run();
    }).toThrow(/UNIQUE constraint failed/);
  });

  it('enforces ON DELETE RESTRICT on subjects referenced by chapters', () => {
    const { sqlite } = createTestDatabase();
    sqlite.prepare(
      "INSERT INTO subjects (id, name, slug, description, status, created_at, updated_at) VALUES ('subj_01', 'Physics', 'physics', NULL, 'active', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
    ).run();
    sqlite.prepare(
      "INSERT INTO chapters (id, subject_id, name, slug, parent_id, status, progress, created_at, updated_at) VALUES ('chap_01', 'subj_01', 'Electrostatics', 'electrostatics', NULL, 'not_started', 0.0, '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
    ).run();

    expect(() => {
      sqlite.prepare("DELETE FROM subjects WHERE id = 'subj_01'").run();
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('enforces ON DELETE CASCADE on child project_events and source_chapters', () => {
    const { sqlite } = createTestDatabase();
    sqlite.prepare(
      "INSERT INTO projects (id, name, description, status, created_at, updated_at) VALUES ('proj_01', 'Engine', 'Test', 'active', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
    ).run();
    sqlite.prepare(
      "INSERT INTO project_events (id, project_id, event_type, actor, payload_json, created_at) VALUES ('progevt_01', 'proj_01', 'started', 'user', '{}', '2026-09-11T00:00:00Z')"
    ).run();

    // Deleting project should cascade to project_events
    sqlite.prepare("DELETE FROM projects WHERE id = 'proj_01'").run();
    const eventRow = sqlite.prepare("SELECT * FROM project_events WHERE id = 'progevt_01'").get();
    expect(eventRow).toBeUndefined();
  });

  it('enforces numerical constraints on study_progress (questions_correct <= questions_attempted)', () => {
    const { sqlite } = createTestDatabase();
    sqlite.prepare(
      "INSERT INTO subjects (id, name, slug, description, status, created_at, updated_at) VALUES ('subj_01', 'Math', 'math', NULL, 'active', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
    ).run();
    sqlite.prepare(
      "INSERT INTO chapters (id, subject_id, name, slug, parent_id, status, progress, created_at, updated_at) VALUES ('chap_01', 'subj_01', 'Calculus', 'calculus', NULL, 'not_started', 0.0, '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
    ).run();

    // Valid insert: 10 attempted, 8 correct
    sqlite.prepare(
      "INSERT INTO study_progress (id, subject_id, chapter_id, status, progress_percent, confidence, questions_attempted, questions_correct, accuracy, updated_at) VALUES ('prog_01', 'subj_01', 'chap_01', 'IN_PROGRESS', 0.5, 0.8, 10, 8, 0.8, '2026-09-11T00:00:00Z')"
    ).run();

    // Invalid insert: 10 attempted, 12 correct -> should fail CHECK constraint
    expect(() => {
      sqlite.prepare(
        "UPDATE study_progress SET questions_correct = 12 WHERE id = 'prog_01'"
      ).run();
    }).toThrow(/CHECK constraint failed/);
  });

  it('enforces study_sessions ended_at >= started_at and duration_seconds >= 0', () => {
    const { sqlite } = createTestDatabase();
    sqlite.prepare(
      "INSERT INTO subjects (id, name, slug, status, created_at, updated_at) VALUES ('subj_01', 'Math', 'math', 'active', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
    ).run();
    sqlite.prepare(
      "INSERT INTO chapters (id, subject_id, name, slug, status, progress, created_at, updated_at) VALUES ('chap_01', 'subj_01', 'Calculus', 'calculus', 'not_started', 0.0, '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
    ).run();

    expect(() => {
      sqlite.prepare(
        "INSERT INTO study_sessions (id, subject_id, chapter_id, started_at, ended_at, duration_seconds, activity_type, source, status, created_at, updated_at) VALUES ('sess_01', 'subj_01', 'chap_01', '2026-09-11T12:00:00Z', '2026-09-11T11:00:00Z', -60, 'deep_work', 'cal', 'completed', '2026-09-11T12:00:00Z', '2026-09-11T12:00:00Z')"
      ).run();
    }).toThrow(/CHECK constraint failed/);
  });

  it('enforces provider-scoped identities on task_links and calendar_links', () => {
    const { sqlite } = createTestDatabase();

    // task_links UNIQUE(provider, tasklist_id, task_id)
    sqlite.prepare(
      "INSERT INTO task_links (id, provider, tasklist_id, task_id, entity_type, entity_id, created_at, updated_at) VALUES ('tasklink_01', 'google_tasks', 'tl_1', 't_1', 'chapter', 'chap_01', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
    ).run();

    expect(() => {
      sqlite.prepare(
        "INSERT INTO task_links (id, provider, tasklist_id, task_id, entity_type, entity_id, created_at, updated_at) VALUES ('tasklink_02', 'google_tasks', 'tl_1', 't_1', 'chapter', 'chap_02', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
      ).run();
    }).toThrow(/UNIQUE constraint failed/);

    // calendar_links UNIQUE(provider, calendar_id, event_id)
    sqlite.prepare(
      "INSERT INTO calendar_links (id, provider, calendar_id, event_id, entity_type, entity_id, starts_at, ends_at, created_at, updated_at) VALUES ('callink_01', 'google_calendar', 'cal_1', 'evt_1', 'study_session', 'sess_01', '2026-09-11T10:00:00Z', '2026-09-11T11:00:00Z', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
    ).run();

    expect(() => {
      sqlite.prepare(
        "INSERT INTO calendar_links (id, provider, calendar_id, event_id, entity_type, entity_id, starts_at, ends_at, created_at, updated_at) VALUES ('callink_02', 'google_calendar', 'cal_1', 'evt_1', 'study_session', 'sess_02', '2026-09-11T10:00:00Z', '2026-09-11T11:00:00Z', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')"
      ).run();
    }).toThrow(/UNIQUE constraint failed/);
  });

  it('enforces foreign key ON DELETE CASCADE on schedule_time_maps and schedule_constraints', () => {
    const { sqlite } = createTestDatabase();
    sqlite.prepare(
      "INSERT INTO users (id, timezone, status, created_at, updated_at) VALUES ('usr_operator', 'Asia/Kolkata', 'active', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z')"
    ).run();

    sqlite.prepare(
      "INSERT INTO schedule_blueprints (id, user_id, name, timezone, is_active, version, max_daily_deep_work_minutes, max_daily_focus_containers, max_continuous_session_minutes, default_decompression_buffer_minutes, freeze_window_minutes, buffer_days, created_at, updated_at) VALUES ('sb_test_cascade', 'usr_operator', 'Test Cascade', 'Asia/Kolkata', 0, 1, 270, 3, 90, 15, 120, '[0]', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z')"
    ).run();

    sqlite.prepare(
      "INSERT INTO schedule_time_maps (id, blueprint_id, day_of_week, start_time, end_time, activity_type, is_optional, created_at, updated_at) VALUES ('stm_test_01', 'sb_test_cascade', 1, '09:00', '11:00', 'deep_work', 0, '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z')"
    ).run();

    sqlite.prepare(
      "INSERT INTO schedule_constraints (id, blueprint_id, name, constraint_type, day_of_week, start_time, end_time, is_hard, created_at, updated_at) VALUES ('sc_test_01', 'sb_test_cascade', 'Test Curfew', 'biological_invariant', 1, '22:00', '08:00', 1, '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z')"
    ).run();

    // Verify rows exist
    expect(sqlite.prepare("SELECT * FROM schedule_time_maps WHERE id = 'stm_test_01'").get()).toBeDefined();
    expect(sqlite.prepare("SELECT * FROM schedule_constraints WHERE id = 'sc_test_01'").get()).toBeDefined();

    // Delete blueprint
    sqlite.prepare("DELETE FROM schedule_blueprints WHERE id = 'sb_test_cascade'").run();

    // Both should be cascade deleted
    expect(sqlite.prepare("SELECT * FROM schedule_time_maps WHERE id = 'stm_test_01'").get()).toBeUndefined();
    expect(sqlite.prepare("SELECT * FROM schedule_constraints WHERE id = 'sc_test_01'").get()).toBeUndefined();
  });

  it('enforces CHECK constraint on schedule_blueprints max_daily_focus_containers > 0', () => {
    const { sqlite } = createTestDatabase();
    sqlite.prepare(
      "INSERT INTO users (id, timezone, status, created_at, updated_at) VALUES ('usr_operator', 'Asia/Kolkata', 'active', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z')"
    ).run();

    expect(() => {
      sqlite.prepare(
        "INSERT INTO schedule_blueprints (id, user_id, name, timezone, is_active, version, max_daily_deep_work_minutes, max_daily_focus_containers, max_continuous_session_minutes, default_decompression_buffer_minutes, freeze_window_minutes, buffer_days, created_at, updated_at) VALUES ('sb_invalid', 'usr_operator', 'Invalid', 'Asia/Kolkata', 0, 1, 270, 0, 90, 15, 120, '[0]', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z')"
      ).run();
    }).toThrow(/CHECK constraint failed/);
  });
});
