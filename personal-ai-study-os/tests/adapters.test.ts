import { describe, it, expect, vi } from 'vitest';
import {
  GoogleTasksAdapter,
  normalizeDueDate,
  formatMetadataToken,
  extractMetadataToken,
  appendMetadataToken,
  hasMatchingMetadataToken,
  preserveMetadataToken,
  calculateExpandingUpdatedMin,
  assertValidReconciliationHorizon,
  METADATA_TOKEN_REGEX,
  GoogleCalendarAdapter,
  NotionAdapter,
  verifyNotionWebhookSignature,
  TokenBucketRateLimiter,
} from '@personal-os/adapters';
import { generateDeterministicCalendarEventId } from '@personal-os/domain';
import crypto from 'crypto';

describe('Slice 4: Provider Adapters Test Suite', () => {
  // ==========================================================================
  // 1. Google Tasks Adapter: WHAT vs WHEN & 4-Tier Expanding Horizon
  // ==========================================================================
  describe('Google Tasks Adapter', () => {
    it('normalizes due dates to UTC midnight YYYY-MM-DDT00:00:00.000Z', () => {
      const normalized = normalizeDueDate('2026-09-15T14:30:00.000Z');
      expect(normalized).toBe('2026-09-15T00:00:00.000Z');

      const dateObj = new Date('2026-10-01T08:00:00Z');
      expect(normalizeDueDate(dateObj)).toBe('2026-10-01T00:00:00.000Z');
      expect(normalizeDueDate(undefined)).toBeUndefined();
    });

    it('formats and extracts deterministic metadata tokens', () => {
      const entityId = 'chap_01J85G46';
      const idempKey = 'idemp_unique_123';
      const token = formatMetadataToken(entityId, idempKey);

      expect(token).toBe('[study-os:entity_id:chap_01J85G46:idempotency_key:idemp_unique_123]');
      expect(METADATA_TOKEN_REGEX.test(token)).toBe(true);

      const extracted = extractMetadataToken(token);
      expect(extracted).toEqual({ entityId, idempotencyKey: idempKey });

      const notes = appendMetadataToken('User notes for task', entityId, idempKey);
      expect(notes).toBe(`User notes for task\n\n${token}`);
      expect(hasMatchingMetadataToken(notes, entityId, idempKey)).toBe(true);
      expect(hasMatchingMetadataToken(notes, entityId, 'different_key')).toBe(false);
    });

    it('preserves existing metadata tokens when updating notes', () => {
      const entityId = 'chap_01J85G46';
      const idempKey = 'idemp_unique_123';
      const originalNotes = appendMetadataToken('Original notes', entityId, idempKey);

      const preserved = preserveMetadataToken(originalNotes, 'New updated notes');
      expect(preserved).toContain('New updated notes');
      expect(preserved).toContain(`[study-os:entity_id:${entityId}:idempotency_key:${idempKey}]`);
    });

    it('calculates 4-Tier expanding updatedMin schedule anchored to created_at (Test J)', () => {
      const createdAt = '2026-09-15T12:00:00.000Z';
      const createdMs = new Date(createdAt).getTime();

      // Tier 1: attempt_count <= 1 -> created_at - 5 minutes
      const tier1 = calculateExpandingUpdatedMin(createdAt, 0);
      expect(new Date(tier1).getTime()).toBe(createdMs - 5 * 60 * 1000);

      const tier1Attempt1 = calculateExpandingUpdatedMin(createdAt, 1);
      expect(new Date(tier1Attempt1).getTime()).toBe(createdMs - 5 * 60 * 1000);

      // Tier 2: attempt_count == 2 -> created_at - 30 minutes
      const tier2 = calculateExpandingUpdatedMin(createdAt, 2);
      expect(new Date(tier2).getTime()).toBe(createdMs - 30 * 60 * 1000);

      // Tier 3: attempt_count == 3 -> created_at - 2 hours
      const tier3 = calculateExpandingUpdatedMin(createdAt, 3);
      expect(new Date(tier3).getTime()).toBe(createdMs - 2 * 60 * 60 * 1000);

      // Tier 4: attempt_count >= 4 -> created_at - 24 hours (max horizon)
      const tier4 = calculateExpandingUpdatedMin(createdAt, 4);
      expect(new Date(tier4).getTime()).toBe(createdMs - 24 * 60 * 60 * 1000);

      const tier5 = calculateExpandingUpdatedMin(createdAt, 5);
      expect(new Date(tier5).getTime()).toBe(createdMs - 24 * 60 * 60 * 1000);
    });

    it('rejects reconciliation horizon searches beyond 24 hours', () => {
      const createdAt = '2026-09-15T12:00:00.000Z';
      const validHorizon = new Date(new Date(createdAt).getTime() - 24 * 60 * 60 * 1000).toISOString();
      expect(() => assertValidReconciliationHorizon(createdAt, validHorizon)).not.toThrow();

      const invalidHorizon = new Date(new Date(createdAt).getTime() - 25 * 60 * 60 * 1000).toISOString();
      expect(() => assertValidReconciliationHorizon(createdAt, invalidHorizon)).toThrow(
        /exceeds 24-hour maximum limit/
      );
    });

    it('traverses pagination loop and matches token on Page 2 (Scenario 28 & 29)', async () => {
      const entityId = 'chap_target';
      const idempKey = 'idemp_page2';
      const targetToken = formatMetadataToken(entityId, idempKey);

      let callCount = 0;
      const mockFetch = vi.fn(async (url: string) => {
        callCount++;
        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              items: [
                { id: 'task_1', title: 'Task 1', status: 'needsAction', notes: 'Other notes' },
              ],
              nextPageToken: 'page_2_token',
            }),
            { status: 200 }
          );
        } else {
          return new Response(
            JSON.stringify({
              items: [
                { id: 'task_target_id', title: 'Target Task', status: 'needsAction', notes: `Target note\n\n${targetToken}` },
              ],
            }),
            { status: 200 }
          );
        }
      });

      const adapter = new GoogleTasksAdapter({ fetchFn: mockFetch as any });
      const result = await adapter.reconcileTaskSearch(
        'tasklist_1',
        entityId,
        idempKey,
        '2026-09-15T12:00:00.000Z',
        1
      );

      expect(result.matchedTask).toBeDefined();
      expect(result.matchedTask?.id).toBe('task_target_id');
      expect(result.exhaustivelyNotFound).toBe(false);
      expect(result.pagesScanned).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('adopts existing task on match without duplicate creation (Scenario 36)', async () => {
      const entityId = 'chap_adopt';
      const idempKey = 'idemp_adopt';
      const token = formatMetadataToken(entityId, idempKey);

      const mockFetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            items: [{ id: 'existing_task_id', title: 'Existing Task', status: 'needsAction', notes: token }],
          }),
          { status: 200 }
        );
      });

      const adapter = new GoogleTasksAdapter({ fetchFn: mockFetch as any });
      const result = await adapter.createTask({
        tasklistId: 'tasklist_1',
        entityType: 'chapter',
        entityId,
        idempotencyKey: idempKey,
        title: 'New Title',
      });

      expect(result.created).toBe(false);
      expect(result.adopted).toBe(true);
      expect(result.task.id).toBe('existing_task_id');
    });

    it('performs safe creation when all pages traversed with zero matching tokens (Scenario 30)', async () => {
      const entityId = 'chap_new';
      const idempKey = 'idemp_new';

      let fetchCount = 0;
      const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
        fetchCount++;
        if (init?.method === 'GET' || !init?.method) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        if (init?.method === 'POST') {
          const body = JSON.parse(init.body as string);
          return new Response(
            JSON.stringify({
              id: 'new_task_created_id',
              title: body.title,
              status: body.status,
              notes: body.notes,
            }),
            { status: 200 }
          );
        }
        return new Response(null, { status: 404 });
      });

      const adapter = new GoogleTasksAdapter({ fetchFn: mockFetch as any });
      const result = await adapter.createTask({
        tasklistId: 'tasklist_1',
        entityType: 'chapter',
        entityId,
        idempotencyKey: idempKey,
        title: 'Fresh Task',
      });

      expect(result.created).toBe(true);
      expect(result.adopted).toBe(false);
      expect(result.task.id).toBe('new_task_created_id');
      expect(result.task.notes).toContain(`[study-os:entity_id:${entityId}:idempotency_key:${idempKey}]`);
    });

    it('throws retryable AmbiguousProviderError on HTTP 429 without blind create (Scenario 32)', async () => {
      const mockFetch = vi.fn(async () => {
        return new Response(JSON.stringify({ error: { message: 'Rate Limit Exceeded' } }), { status: 429 });
      });

      const adapter = new GoogleTasksAdapter({ fetchFn: mockFetch as any });
      await expect(
        adapter.createTask({
          tasklistId: 'tasklist_1',
          entityType: 'chapter',
          entityId: 'chap_1',
          idempotencyKey: 'idemp_429',
          title: 'Task 429',
        })
      ).rejects.toThrow(/Safe-Create Gate failed: provider state is uncertain/);
    });

    it('skips PATCH when remote task already reflects desired state (Scenario 37)', async () => {
      const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          throw new Error('PATCH should have been skipped');
        }
        return new Response(
          JSON.stringify({
            id: 'task_1',
            title: 'Exact Title',
            status: 'completed',
            due: '2026-09-20T00:00:00.000Z',
          }),
          { status: 200 }
        );
      });

      const adapter = new GoogleTasksAdapter({ fetchFn: mockFetch as any });
      const result = await adapter.updateTask({
        tasklistId: 'tasklist_1',
        taskId: 'task_1',
        title: 'Exact Title',
        status: 'completed',
        due: '2026-09-20T00:00:00.000Z',
      });

      expect(result.updated).toBe(false);
      expect(result.task.id).toBe('task_1');
    });
  });

  // ==========================================================================
  // 2. Google Calendar Adapter: Deterministic IDs & ETag / If-Match Concurrency
  // ==========================================================================
  describe('Google Calendar Adapter', () => {
    it('generates 32-character lowercase base32hex event ID from idempotency key', () => {
      const idempKey = 'study_session_unique_456';
      const eventId = generateDeterministicCalendarEventId(idempKey);

      expect(eventId).toHaveLength(32);
      expect(/^[0-9a-v]{32}$/.test(eventId)).toBe(true);

      // Deterministic: same key produces identical event ID
      const eventId2 = generateDeterministicCalendarEventId(idempKey);
      expect(eventId2).toBe(eventId);
    });

    it('catches HTTP 409 Conflict on create and adopts existing event (Scenario 22)', async () => {
      const idempKey = 'session_conflict_idemp';
      const deterministicId = generateDeterministicCalendarEventId(idempKey);

      let fetchCall = 0;
      const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
        fetchCall++;
        if (init?.method === 'POST') {
          return new Response(
            JSON.stringify({ error: { message: 'The requested identifier already exists' } }),
            { status: 409 }
          );
        }
        if (init?.method === 'GET' && url.includes(deterministicId)) {
          return new Response(
            JSON.stringify({
              id: deterministicId,
              summary: 'Physics Deep Work',
              start: { dateTime: '2026-09-15T10:00:00Z' },
              end: { dateTime: '2026-09-15T12:00:00Z' },
              etag: '"etag_cal_123"',
            }),
            { status: 200 }
          );
        }
        return new Response(null, { status: 404 });
      });

      const adapter = new GoogleCalendarAdapter({ fetchFn: mockFetch as any });
      const result = await adapter.createEvent({
        calendarId: 'primary',
        idempotencyKey: idempKey,
        summary: 'Physics Deep Work',
        start: { dateTime: '2026-09-15T10:00:00Z' },
        end: { dateTime: '2026-09-15T12:00:00Z' },
      });

      expect(result.created).toBe(false);
      expect(result.adopted).toBe(true);
      expect(result.event.id).toBe(deterministicId);
    });

    it('passes If-Match ETag header during update (Scenario 23)', async () => {
      let passedIfMatchHeader = '';
      const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return new Response(
            JSON.stringify({
              id: 'cal_event_1',
              etag: '"initial_etag"',
              summary: 'Old Summary',
              start: { dateTime: '2026-09-15T10:00:00Z' },
              end: { dateTime: '2026-09-15T12:00:00Z' },
            }),
            { status: 200 }
          );
        }
        if (init?.method === 'PATCH') {
          passedIfMatchHeader = (init.headers as any)['If-Match'];
          return new Response(
            JSON.stringify({
              id: 'cal_event_1',
              etag: '"new_etag"',
              summary: 'Updated Summary',
              start: { dateTime: '2026-09-15T10:00:00Z' },
              end: { dateTime: '2026-09-15T12:00:00Z' },
            }),
            { status: 200 }
          );
        }
        return new Response(null, { status: 404 });
      });

      const adapter = new GoogleCalendarAdapter({ fetchFn: mockFetch as any });
      const result = await adapter.updateEvent({
        calendarId: 'primary',
        eventId: 'cal_event_1',
        etag: '"initial_etag"',
        summary: 'Updated Summary',
      });

      expect(passedIfMatchHeader).toBe('"initial_etag"');
      expect(result.updated).toBe(true);
      expect(result.reconciled).toBe(false);
    });

    it('handles HTTP 412 Precondition Failed, refetches latest ETag and retries (Scenario 24)', async () => {
      let patchCount = 0;
      const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return new Response(
            JSON.stringify({
              id: 'cal_event_race',
              etag: '"fresh_etag_after_412"',
              summary: 'Concurrent change',
              start: { dateTime: '2026-09-15T10:00:00Z' },
              end: { dateTime: '2026-09-15T12:00:00Z' },
            }),
            { status: 200 }
          );
        }
        if (init?.method === 'PATCH') {
          patchCount++;
          if (patchCount === 1) {
            return new Response(
              JSON.stringify({ error: { message: 'Precondition Failed' } }),
              { status: 412 }
            );
          }
          return new Response(
            JSON.stringify({
              id: 'cal_event_race',
              etag: '"final_etag"',
              summary: 'Final Summary',
              start: { dateTime: '2026-09-15T10:00:00Z' },
              end: { dateTime: '2026-09-15T12:00:00Z' },
            }),
            { status: 200 }
          );
        }
        return new Response(null, { status: 404 });
      });

      const adapter = new GoogleCalendarAdapter({ fetchFn: mockFetch as any });
      const result = await adapter.updateEvent({
        calendarId: 'primary',
        eventId: 'cal_event_race',
        etag: '"stale_etag"',
        summary: 'Final Summary',
      });

      expect(patchCount).toBe(2);
      expect(result.updated).toBe(true);
      expect(result.reconciled).toBe(true);
    });
  });

  // ==========================================================================
  // 3. Notion Adapter: HMAC Verification & Rate Limiting
  // ==========================================================================
  describe('Notion Adapter', () => {
    it('verifies valid HMAC-SHA256 signature using constant-time comparison (Scenario 39)', () => {
      const secret = 'notion_secret_xyz123';
      const rawBody = JSON.stringify({ event: 'page_updated', page_id: 'page_123' });
      const validSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

      expect(verifyNotionWebhookSignature(rawBody, validSignature, secret)).toBe(true);
      expect(verifyNotionWebhookSignature(rawBody, `v0=${validSignature}`, secret)).toBe(true);
      expect(verifyNotionWebhookSignature(rawBody, `sha256=${validSignature}`, secret)).toBe(true);

      const invalidSignature = crypto.createHmac('sha256', 'wrong_secret').update(rawBody).digest('hex');
      expect(verifyNotionWebhookSignature(rawBody, invalidSignature, secret)).toBe(false);
      expect(verifyNotionWebhookSignature(rawBody, '', secret)).toBe(false);
    });

    it('enforces 3 requests per second token-bucket rate limiter (Scenario 42)', async () => {
      const limiter = new TokenBucketRateLimiter(3, 3);
      // First 3 tokens consumed immediately
      await limiter.acquire();
      await limiter.acquire();
      await limiter.acquire();

      const start = Date.now();
      // 4th token requires waiting for refill (~333ms)
      await limiter.acquire();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(250);
    });

    it('detects existing page via OS_Entity_ID query during create idempotency (Scenario 38)', async () => {
      const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && _url.includes('/query')) {
          return new Response(
            JSON.stringify({
              results: [
                {
                  id: 'notion_existing_page_id',
                  last_edited_time: '2026-09-15T12:00:00.000Z',
                  properties: { OS_Entity_ID: { rich_text: [{ plain_text: 'chap_101' }] } },
                },
              ],
              has_more: false,
            }),
            { status: 200 }
          );
        }
        return new Response(null, { status: 404 });
      });

      const adapter = new NotionAdapter({ fetchFn: mockFetch as any, apiKey: 'secret_key' });
      const result = await adapter.createPage({
        databaseId: 'db_notion_1',
        entityId: 'chap_101',
      });

      expect(result.created).toBe(false);
      expect(result.adopted).toBe(true);
      expect(result.page.id).toBe('notion_existing_page_id');
    });
  });
});
