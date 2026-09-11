import { describe, it, expect, vi } from 'vitest';
import {
  GoogleCalendarBridgeAdapter,
  GoogleTasksBridgeAdapter,
  GoogleBridgeClient,
  GoogleCalendarEvent,
  GoogleTask,
  AmbiguousProviderError,
  ProviderRetryableError,
  formatMetadataToken,
} from '@personal-os/adapters';
import { generateDeterministicCalendarEventId } from '@personal-os/domain';

describe('Google Apps Script Bridge: Adapters Implementation Suite', () => {
  const SECRET = 'test_shared_secret_adapters_12345';

  // ==========================================================================
  // 1. GoogleCalendarBridgeAdapter Tests
  // ==========================================================================
  describe('GoogleCalendarBridgeAdapter', () => {
    it('generates deterministic base32hex event ID and creates event', async () => {
      let capturedPayload: any = null;
      const mockFetch = vi.fn(async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        capturedPayload = body.payload;
        return new Response(
          JSON.stringify({
            ok: true,
            statusCode: 200,
            data: { ...capturedPayload.event, etag: '"etag_initial_1"' },
            request_id: body.request_id,
          }),
          { status: 200 }
        );
      });

      const client = new GoogleBridgeClient({
        bridgeUrl: 'https://script.google.com/macros/s/test/exec',
        bridgeSecret: SECRET,
        fetchFn: mockFetch as any,
      });

      const adapter = new GoogleCalendarBridgeAdapter(client);
      const idempotencyKey = 'idemp_cal_test_001';
      const expectedDeterministicId = generateDeterministicCalendarEventId(idempotencyKey);

      const result = await adapter.createEvent({
        calendarId: 'primary',
        idempotencyKey,
        summary: 'Deep Work Session',
        description: 'Study Chapter 4',
        start: { dateTime: '2026-09-15T09:00:00.000Z' },
        end: { dateTime: '2026-09-15T10:30:00.000Z' },
      });

      expect(capturedPayload.calendarId).toBe('primary');
      expect(capturedPayload.event.id).toBe(expectedDeterministicId);
      expect(result.created).toBe(true);
      expect(result.adopted).toBe(false);
      expect(result.event.id).toBe(expectedDeterministicId);
      expect(result.event.summary).toBe('Deep Work Session');
    });

    it('recovers on 409 Conflict by adopting existing event (Scenario 22)', async () => {
      const idempotencyKey = 'idemp_conflict_adopt';
      const deterministicId = generateDeterministicCalendarEventId(idempotencyKey);

      const mockFetch = vi.fn(async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        if (body.operation === 'calendar.create') {
          return new Response(
            JSON.stringify({
              ok: true,
              statusCode: 409,
              error: { code: 'CONFLICT', message: 'Event already exists' },
              request_id: body.request_id,
            }),
            { status: 200 }
          );
        }
        if (body.operation === 'calendar.get') {
          return new Response(
            JSON.stringify({
              ok: true,
              statusCode: 200,
              data: {
                id: deterministicId,
                summary: 'Existing Adopted Event',
                start: { dateTime: '2026-09-15T09:00:00.000Z' },
                end: { dateTime: '2026-09-15T10:30:00.000Z' },
                etag: '"etag_existing"',
              },
              request_id: body.request_id,
            }),
            { status: 200 }
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      const client = new GoogleBridgeClient({
        bridgeUrl: 'https://script.google.com/macros/s/test/exec',
        bridgeSecret: SECRET,
        fetchFn: mockFetch as any,
      });

      const adapter = new GoogleCalendarBridgeAdapter(client);
      const result = await adapter.createEvent({
        calendarId: 'primary',
        idempotencyKey,
        summary: 'New Session Attempt',
        start: { dateTime: '2026-09-15T09:00:00.000Z' },
        end: { dateTime: '2026-09-15T10:30:00.000Z' },
      });

      expect(result.created).toBe(false);
      expect(result.adopted).toBe(true);
      expect(result.event.id).toBe(deterministicId);
      expect(result.event.summary).toBe('Existing Adopted Event');
    });

    it('skips update if remote calendar event already matches target mutation (Lost-Ack)', async () => {
      const existingEvent: GoogleCalendarEvent = {
        id: 'evt_123',
        summary: 'Algorithms Study',
        description: 'Read tree algorithms',
        start: { dateTime: '2026-09-15T14:00:00.000Z' },
        end: { dateTime: '2026-09-15T15:00:00.000Z' },
        etag: '"etag_match_1"',
      };

      let patchCalled = false;
      const mockFetch = vi.fn(async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        if (body.operation === 'calendar.get') {
          return new Response(
            JSON.stringify({
              ok: true,
              statusCode: 200,
              data: existingEvent,
              request_id: body.request_id,
            }),
            { status: 200 }
          );
        }
        if (body.operation === 'calendar.update') {
          patchCalled = true;
          return new Response(JSON.stringify({ ok: true, statusCode: 200 }), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      });

      const client = new GoogleBridgeClient({
        bridgeUrl: 'https://script.google.com/macros/s/test/exec',
        bridgeSecret: SECRET,
        fetchFn: mockFetch as any,
      });

      const adapter = new GoogleCalendarBridgeAdapter(client);
      const result = await adapter.updateEvent({
        calendarId: 'primary',
        eventId: 'evt_123',
        summary: 'Algorithms Study',
        description: 'Read tree algorithms',
        start: { dateTime: '2026-09-15T14:00:00.000Z' },
        end: { dateTime: '2026-09-15T15:00:00.000Z' },
      });

      expect(patchCalled).toBe(false);
      expect(result.updated).toBe(false);
      expect(result.reconciled).toBe(false);
      expect(result.event.etag).toBe('"etag_match_1"');
    });

    it('handles HTTP 412 Precondition Failed, refetches latest event, and reconciles (Scenario 24)', async () => {
      const initialEvent: GoogleCalendarEvent = {
        id: 'evt_concur',
        summary: 'Original Summary',
        start: { dateTime: '2026-09-15T10:00:00.000Z' },
        end: { dateTime: '2026-09-15T11:00:00.000Z' },
        etag: '"etag_v1"',
      };

      const freshRemoteEvent: GoogleCalendarEvent = {
        id: 'evt_concur',
        summary: 'Intercurrently Edited Summary',
        start: { dateTime: '2026-09-15T10:30:00.000Z' },
        end: { dateTime: '2026-09-15T11:30:00.000Z' },
        etag: '"etag_v2"',
      };

      let getCallCount = 0;
      let updateCallCount = 0;
      let lastUpdatePayload: any = null;

      const mockFetch = vi.fn(async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        if (body.operation === 'calendar.get') {
          getCallCount++;
          const data = getCallCount === 1 ? initialEvent : freshRemoteEvent;
          return new Response(
            JSON.stringify({
              ok: true,
              statusCode: 200,
              data,
              request_id: body.request_id,
            }),
            { status: 200 }
          );
        }
        if (body.operation === 'calendar.update') {
          updateCallCount++;
          lastUpdatePayload = body.payload;
          if (updateCallCount === 1) {
            // First update attempt fails with 412 Precondition Failed
            return new Response(
              JSON.stringify({
                ok: false,
                statusCode: 412,
                error: { code: 'PRECONDITION_FAILED', message: 'Stale ETag' },
                request_id: body.request_id,
              }),
              { status: 200 }
            );
          }
          // Second update retry succeeds with reconciled event
          return new Response(
            JSON.stringify({
              ok: true,
              statusCode: 200,
              data: {
                id: 'evt_concur',
                summary: 'Updated Summary',
                start: freshRemoteEvent.start,
                end: freshRemoteEvent.end,
                etag: '"etag_v3"',
              },
              request_id: body.request_id,
            }),
            { status: 200 }
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      const client = new GoogleBridgeClient({
        bridgeUrl: 'https://script.google.com/macros/s/test/exec',
        bridgeSecret: SECRET,
        fetchFn: mockFetch as any,
      });

      const adapter = new GoogleCalendarBridgeAdapter(client);
      const result = await adapter.updateEvent({
        calendarId: 'primary',
        eventId: 'evt_concur',
        summary: 'Updated Summary',
        etag: '"etag_v1"',
      });

      expect(updateCallCount).toBe(2);
      expect(lastUpdatePayload.etag).toBe('"etag_v2"');
      expect(result.updated).toBe(true);
      expect(result.reconciled).toBe(true);
      expect(result.event.etag).toBe('"etag_v3"');
    });
  });

  // ==========================================================================
  // 2. GoogleTasksBridgeAdapter Tests
  // ==========================================================================
  describe('GoogleTasksBridgeAdapter', () => {
    it('performs expanding search, matches token on Page 2, and adopts (Scenario 28 & 36)', async () => {
      const entityId = 'chap_page2_search';
      const idempKey = 'idemp_page2_tasks';
      const targetToken = formatMetadataToken(entityId, idempKey);

      let listCallCount = 0;
      const mockFetch = vi.fn(async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        if (body.operation === 'tasks.list') {
          listCallCount++;
          if (listCallCount === 1) {
            return new Response(
              JSON.stringify({
                ok: true,
                statusCode: 200,
                data: {
                  items: [{ id: 'task_1', title: 'Task 1', notes: 'Unrelated note' }],
                  nextPageToken: 'page_2_token',
                },
                request_id: body.request_id,
              }),
              { status: 200 }
            );
          }
          if (listCallCount === 2) {
            return new Response(
              JSON.stringify({
                ok: true,
                statusCode: 200,
                data: {
                  items: [
                    {
                      id: 'task_matched_page2',
                      title: 'Target Task',
                      notes: `My study notes\n\n${targetToken}`,
                      status: 'needsAction',
                    },
                  ],
                },
                request_id: body.request_id,
              }),
              { status: 200 }
            );
          }
        }
        return new Response('Not Found', { status: 404 });
      });

      const client = new GoogleBridgeClient({
        bridgeUrl: 'https://script.google.com/macros/s/test/exec',
        bridgeSecret: SECRET,
        fetchFn: mockFetch as any,
      });

      const adapter = new GoogleTasksBridgeAdapter(client);
      const result = await adapter.createTask({
        tasklistId: '@default',
        entityType: 'chapter',
        entityId,
        idempotencyKey: idempKey,
        title: 'Target Task',
      });

      expect(listCallCount).toBe(2);
      expect(result.created).toBe(false);
      expect(result.adopted).toBe(true);
      expect(result.task.id).toBe('task_matched_page2');
    });

    it('Safe-Create Gate: blocks tasks.create when search is uncertain (Scenario 30)', async () => {
      const mockFetch = vi.fn(async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        if (body.operation === 'tasks.list') {
          // Always returns nextPageToken without finding token (hits 5 page ceiling)
          return new Response(
            JSON.stringify({
              ok: true,
              statusCode: 200,
              data: {
                items: [{ id: 't_some', title: 'Some task', notes: 'no token' }],
                nextPageToken: 'token_endless',
              },
              request_id: body.request_id,
            }),
            { status: 200 }
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      const client = new GoogleBridgeClient({
        bridgeUrl: 'https://script.google.com/macros/s/test/exec',
        bridgeSecret: SECRET,
        fetchFn: mockFetch as any,
      });

      const adapter = new GoogleTasksBridgeAdapter(client);

      await expect(
        adapter.createTask({
          tasklistId: '@default',
          entityType: 'chapter',
          entityId: 'chap_ceiling_test',
          idempotencyKey: 'idemp_ceiling_test',
          title: 'Ceiling Task',
        })
      ).rejects.toThrow(AmbiguousProviderError);
    });

    it('creates task with UTC midnight due date and preserved metadata token when search succeeds', async () => {
      let createdPayload: any = null;
      const mockFetch = vi.fn(async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        if (body.operation === 'tasks.list') {
          // Exhaustively not found on first page
          return new Response(
            JSON.stringify({
              ok: true,
              statusCode: 200,
              data: {
                items: [{ id: 't_other', title: 'Other' }],
                nextPageToken: undefined,
              },
              request_id: body.request_id,
            }),
            { status: 200 }
          );
        }
        if (body.operation === 'tasks.create') {
          createdPayload = body.payload;
          return new Response(
            JSON.stringify({
              ok: true,
              statusCode: 200,
              data: {
                id: 'task_new_123',
                title: createdPayload.task.title,
                notes: createdPayload.task.notes,
                due: createdPayload.task.due,
                status: 'needsAction',
              },
              request_id: body.request_id,
            }),
            { status: 200 }
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      const client = new GoogleBridgeClient({
        bridgeUrl: 'https://script.google.com/macros/s/test/exec',
        bridgeSecret: SECRET,
        fetchFn: mockFetch as any,
      });

      const adapter = new GoogleTasksBridgeAdapter(client);
      const result = await adapter.createTask({
        tasklistId: '@default',
        entityType: 'chapter',
        entityId: 'chap_new_01',
        idempotencyKey: 'idemp_new_01',
        title: 'Biology Chapter 1',
        notes: 'Read cellular respiration',
        due: '2026-09-20T17:45:00.000Z', // Intraday timestamp
      });

      expect(result.created).toBe(true);
      expect(result.adopted).toBe(false);
      expect(result.task.id).toBe('task_new_123');
      // Verifies WHAT vs WHEN: due date normalized to UTC midnight
      expect(createdPayload.task.due).toBe('2026-09-20T00:00:00.000Z');
      // Verifies metadata token embedded
      expect(createdPayload.task.notes).toContain(
        '[study-os:entity_id:chap_new_01:idempotency_key:idemp_new_01]'
      );
    });

    it('skips task update if remote state matches, updates preserving token if divergent', async () => {
      const existingTask: GoogleTask = {
        id: 'task_existing_1',
        title: 'Physics Chapter 2',
        status: 'needsAction',
        notes: 'Chapter notes\n\n[study-os:entity_id:chap_02:idempotency_key:idemp_02]',
        due: '2026-09-25T00:00:00.000Z',
      };

      let patchCalled = false;
      let lastPatchPayload: any = null;

      const mockFetch = vi.fn(async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        if (body.operation === 'tasks.get') {
          return new Response(
            JSON.stringify({
              ok: true,
              statusCode: 200,
              data: existingTask,
              request_id: body.request_id,
            }),
            { status: 200 }
          );
        }
        if (body.operation === 'tasks.update') {
          patchCalled = true;
          lastPatchPayload = body.payload;
          return new Response(
            JSON.stringify({
              ok: true,
              statusCode: 200,
              data: { ...existingTask, ...lastPatchPayload.task },
              request_id: body.request_id,
            }),
            { status: 200 }
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      const client = new GoogleBridgeClient({
        bridgeUrl: 'https://script.google.com/macros/s/test/exec',
        bridgeSecret: SECRET,
        fetchFn: mockFetch as any,
      });

      const adapter = new GoogleTasksBridgeAdapter(client);

      // 1. Identical mutation -> skip update
      const skipResult = await adapter.updateTask({
        tasklistId: '@default',
        taskId: 'task_existing_1',
        title: 'Physics Chapter 2',
        status: 'needsAction',
        due: '2026-09-25T14:00:00.000Z', // Normalizes to same date
      });

      expect(skipResult.updated).toBe(false);
      expect(patchCalled).toBe(false);

      // 2. Divergent mutation -> performs update preserving token
      const updateResult = await adapter.updateTask({
        tasklistId: '@default',
        taskId: 'task_existing_1',
        status: 'completed',
        notes: 'Revised user notes',
      });

      expect(updateResult.updated).toBe(true);
      expect(patchCalled).toBe(true);
      expect(lastPatchPayload.task.status).toBe('completed');
      expect(lastPatchPayload.task.notes).toContain('Revised user notes');
      expect(lastPatchPayload.task.notes).toContain(
        '[study-os:entity_id:chap_02:idempotency_key:idemp_02]'
      );
    });
  });
});
