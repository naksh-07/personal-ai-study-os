import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getGoogleTasksAdapter,
  getGoogleCalendarAdapter,
  dispatchToProviderAdapter,
} from '../apps/worker/src/queue/consumer';
import {
  GoogleTasksBridgeAdapter,
  GoogleCalendarBridgeAdapter,
  GoogleTasksAdapter,
  GoogleCalendarAdapter,
} from '@personal-os/adapters';
import { QueueMessageEnvelope } from '@personal-os/domain';
import { createTestDatabase } from './test-helper';

describe('Google Apps Script Bridge: Integration & Consumer Dispatch Suite', () => {
  let db: any;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.d1;
  });

  it('resolves bridge adapters when bridge URL and secret are present in Env', () => {
    const bridgeEnv = {
      DB: db,
      GOOGLE_APPS_SCRIPT_BRIDGE_URL: 'https://script.google.com/macros/s/test/exec',
      GOOGLE_APPS_SCRIPT_BRIDGE_SECRET: 'test_secret_integration',
    };

    const tasksAdapter = getGoogleTasksAdapter(bridgeEnv);
    const calendarAdapter = getGoogleCalendarAdapter(bridgeEnv);

    expect(tasksAdapter).toBeInstanceOf(GoogleTasksBridgeAdapter);
    expect(calendarAdapter).toBeInstanceOf(GoogleCalendarBridgeAdapter);
  });

  it('falls back to direct OAuth adapters when bridge configuration is absent (Zero-Downtime Rollback)', () => {
    const directEnv = {
      DB: db,
      GOOGLE_CLIENT_ID: 'test_client_id',
      GOOGLE_CLIENT_SECRET: 'test_client_secret',
      GOOGLE_REFRESH_TOKEN: 'test_refresh_token',
    };

    const tasksAdapter = getGoogleTasksAdapter(directEnv);
    const calendarAdapter = getGoogleCalendarAdapter(directEnv);

    expect(tasksAdapter).toBeInstanceOf(GoogleTasksAdapter);
    expect(calendarAdapter).toBeInstanceOf(GoogleCalendarAdapter);
  });

  it('dispatches google_tasks create through bridge adapter and writes task_links in D1', async () => {
    const mockFetch = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.operation === 'tasks.list') {
        return new Response(
          JSON.stringify({
            ok: true,
            statusCode: 200,
            data: { items: [], nextPageToken: undefined },
            request_id: body.request_id,
          }),
          { status: 200 }
        );
      }
      if (body.operation === 'tasks.create') {
        return new Response(
          JSON.stringify({
            ok: true,
            statusCode: 200,
            data: {
              id: 'task_bridge_created_01',
              title: body.payload.task.title,
              notes: body.payload.task.notes,
              status: 'needsAction',
            },
            request_id: body.request_id,
          }),
          { status: 200 }
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    // Provide global fetch mock for bridge client in this test
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const env = {
        DB: db,
        GOOGLE_APPS_SCRIPT_BRIDGE_URL: 'https://script.google.com/macros/s/test/exec',
        GOOGLE_APPS_SCRIPT_BRIDGE_SECRET: 'test_bridge_secret_123',
      };

      const envelope: QueueMessageEnvelope = {
        jobId: 'sync_job_task_01',
        idempotencyKey: 'idemp_key_task_01',
        targetSystem: 'google_tasks',
        entityType: 'chapter',
        entityId: 'chap_integration_01',
        operation: 'create',
        schemaVersion: 1,
        payload: {
          tasklistId: '@default',
          title: 'Integrate Calculus Chapter 1',
          notes: 'Integration study',
          due: '2026-09-30T10:00:00.000Z',
        },
        enqueuedAt: '2026-09-11T12:00:00.000Z',
      };

      await dispatchToProviderAdapter(envelope, env as any);

      // Verify task_links record was written to D1 machine truth
      const link = await db
        .prepare('SELECT * FROM task_links WHERE provider = ? AND task_id = ?')
        .bind('google_tasks', 'task_bridge_created_01')
        .first();

      expect(link).toBeDefined();
      expect(link.entity_id).toBe('chap_integration_01');
      expect(link.title_snapshot).toBe('Integrate Calculus Chapter 1');
      expect(link.status_snapshot).toBe('needsAction');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('dispatches google_calendar create through bridge adapter and writes calendar_links in D1', async () => {
    const mockFetch = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.operation === 'calendar.create') {
        return new Response(
          JSON.stringify({
            ok: true,
            statusCode: 200,
            data: {
              id: body.payload.event.id,
              summary: body.payload.event.summary,
              start: body.payload.event.start,
              end: body.payload.event.end,
              status: 'confirmed',
            },
            request_id: body.request_id,
          }),
          { status: 200 }
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const env = {
        DB: db,
        GOOGLE_APPS_SCRIPT_BRIDGE_URL: 'https://script.google.com/macros/s/test/exec',
        GOOGLE_APPS_SCRIPT_BRIDGE_SECRET: 'test_bridge_secret_123',
      };

      const envelope: QueueMessageEnvelope = {
        jobId: 'sync_job_cal_01',
        idempotencyKey: 'idemp_key_cal_01',
        targetSystem: 'google_calendar',
        entityType: 'study_session',
        entityId: 'sess_integration_01',
        operation: 'create',
        schemaVersion: 1,
        payload: {
          calendarId: 'primary',
          summary: 'Study Session Calculus',
          startsAt: '2026-09-30T14:00:00.000Z',
          endsAt: '2026-09-30T16:00:00.000Z',
        },
        enqueuedAt: '2026-09-11T12:00:00.000Z',
      };

      await dispatchToProviderAdapter(envelope, env as any);

      // Verify calendar_links record was written to D1 machine truth
      const link = await db
        .prepare('SELECT * FROM calendar_links WHERE provider = ? AND entity_id = ?')
        .bind('google_calendar', 'sess_integration_01')
        .first();

      expect(link).toBeDefined();
      expect(link.entity_id).toBe('sess_integration_01');
      expect(link.title_snapshot).toBe('Study Session Calculus');
      expect(link.status_snapshot).toBe('confirmed');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
