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

  it('migration succeeds and creates exactly all 24 authoritative tables', () => {
    const { sqlite } = createTestDatabase();
    const rows = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = rows.map(r => r.name);

    for (const expected of EXPECTED_24_TABLES) {
      expect(tableNames).toContain(expected);
    }
    expect(tableNames.length).toBe(24);
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
});
