import { Hono } from 'hono';
import crypto from 'node:crypto';
import { createKyselyD1, ReliabilityRepository } from '@personal-os/db';
import {
  ProjectionEngine,
  ReliabilityEngine,
  ConfigurableReconciliationHandler,
  CanonicalEventEngine,
} from '@personal-os/core';
import { requireAuth } from '../middleware/auth';
import { UnauthorizedError, generateId } from '@personal-os/domain';
import { AppContext } from '../types';
import { wrapJobInQueueEnvelope } from '../queue/outbox-dispatcher';

export const adminRoutes = new Hono<AppContext>();

/**
 * Constant-time comparison of two hex strings using fixed 32-byte buffers to prevent timing attacks.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== 32 || bufB.length !== 32) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// ============================================================================
// Notion Webhook 6-Stage Pipeline (Spec v1.2.3 Section 12)
// ============================================================================
adminRoutes.post('/webhooks/notion', async (c) => {
  const signature = c.req.header('x-notion-signature') || c.req.header('X-Notion-Signature');
  const secret = c.env?.NOTION_WEBHOOK_SECRET;

  if (!secret || typeof secret !== 'string' || secret.trim() === '') {
    throw new UnauthorizedError('Unauthorized: Notion webhook secret is unconfigured');
  }

  if (!signature) {
    throw new UnauthorizedError('Unauthorized: Missing Notion webhook signature (X-Notion-Signature)');
  }

  const rawBody = await c.req.text();

  // Stage 1: Constant-time HMAC-SHA256 signature check against X-Notion-Signature
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (!constantTimeCompare(signature, expected)) {
    throw new UnauthorizedError('Unauthorized: Invalid Notion webhook signature');
  }


  let parsed: any = {};
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    parsed = {};
  }

  // Stage 2: Deduplicate against idempotency_records using key 'webhook_notion_' + event.id
  const eventId =
    parsed.id ||
    parsed.event_id ||
    parsed.entity_id ||
    crypto.createHash('sha256').update(rawBody).digest('hex');
  const idempotencyKey = `webhook_notion_${eventId}`;
  const requestHash = crypto.createHash('sha256').update(rawBody).digest('hex');

  const db = createKyselyD1(c.env.DB);
  const claim = await ReliabilityRepository.claimIdempotency(db, {
    idempotencyKey,
    operation: 'webhook_notion',
    sourceSystem: 'notion',
    requestHash,
  });

  if (claim.state === 'COMPLETED') {
    return c.json({ status: 'deduplicated', message: 'Webhook already processed' }, 200);
  }

  // Stage 3: Retrieve Authoritative Latest Page State
  const pageId = parsed.page_id || parsed.page?.id || parsed.id;
  const remoteLastEditedTime =
    parsed.last_edited_time || parsed.page?.last_edited_time || new Date().toISOString();

  // Stage 4: Domain Reconciliation
  let isStale = false;
  if (pageId) {
    const existingLink = await db
      .selectFrom('task_links')
      .select(['last_synced_at'])
      .where('task_id', '=', pageId)
      .executeTakeFirst();

    if (
      existingLink?.last_synced_at &&
      new Date(existingLink.last_synced_at).getTime() >= new Date(remoteLastEditedTime).getTime()
    ) {
      isStale = true;
    }
  }

  if (isStale) {
    await ReliabilityRepository.finalizeIdempotency(db, {
      idempotencyKey,
      status: 'COMPLETED',
      resultPayload: JSON.stringify({ status: 'dropped_stale' }),
      resultHash: requestHash,
    });
    return c.json({ status: 'deduplicated', message: 'Stale webhook update dropped safely' }, 200);
  }

  // Stage 5 & 6: Emit Canonical Event and persist atomically if chapter is identified
  const now = new Date().toISOString();
  const rawChapterId =
    parsed.chapter_id ||
    (typeof parsed.page_id === 'string' && parsed.page_id.startsWith('chap_') ? parsed.page_id : undefined) ||
    parsed.properties?.ChapterId?.string;

  if (rawChapterId && typeof rawChapterId === 'string' && rawChapterId.startsWith('chap_')) {
    const progressVal = Number(parsed.progress ?? parsed.properties?.Progress?.number ?? 1.0);
    const canonicalEvent = CanonicalEventEngine.createEvent({
      eventType: 'chapter_progress_updated',
      occurredAt: remoteLastEditedTime,
      actor: { type: 'user', id: 'usr_operator' },
      source: { system: 'notion', interface: 'webhook' },
      payload: {
        chapterId: rawChapterId,
        progress: Math.min(1.0, Math.max(0.0, progressVal)),
      },
    });

    const eventPayloadJson = JSON.stringify(canonicalEvent.payload);

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO canonical_events (
           event_id, event_type, schema_version, occurred_at, recorded_at,
           actor_type, actor_id, source_system, source_interface, payload, correlation_id, causation_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        canonicalEvent.eventId,
        canonicalEvent.eventType,
        canonicalEvent.schemaVersion,
        canonicalEvent.occurredAt,
        now,
        canonicalEvent.actor.type,
        canonicalEvent.actor.id,
        canonicalEvent.source.system,
        canonicalEvent.source.interface,
        eventPayloadJson,
        canonicalEvent.correlationId ?? null,
        canonicalEvent.causationId ?? null
      ),
      c.env.DB.prepare(
        `INSERT INTO idempotency_records (
           idempotency_key, job_id, operation, source_system, request_hash, status, result_payload, created_at, updated_at, expires_at
         ) VALUES (?, NULL, 'webhook_notion', 'notion', ?, 'COMPLETED', ?, ?, ?, datetime(?, '+24 hours'))
         ON CONFLICT(idempotency_key) DO UPDATE SET
           status = 'COMPLETED',
           updated_at = CURRENT_TIMESTAMP`
      ).bind(
        idempotencyKey,
        requestHash,
        JSON.stringify({ status: 'processed', eventId: canonicalEvent.eventId }),
        now,
        now,
        now
      ),
    ]);

    return c.json({ status: 'processed', eventId: canonicalEvent.eventId }, 200);
  }

  // Generic webhook / non-chapter update: finalize idempotency and acknowledge
  await ReliabilityRepository.finalizeIdempotency(db, {
    idempotencyKey,
    status: 'COMPLETED',
    resultPayload: JSON.stringify({ status: 'processed' }),
    resultHash: requestHash,
  });

  return c.json({ status: 'processed' }, 200);
});

// Admin endpoints require 'admin' scope
adminRoutes.use('/admin/*', requireAuth('admin'));

adminRoutes.post('/admin/rebuild-projections', async (c) => {
  const db = createKyselyD1(c.env.DB);
  const user = await db.selectFrom('users').select('timezone').executeTakeFirst();
  const timezone = user?.timezone ?? 'UTC';

  const rebuildResult = await ProjectionEngine.rebuildProjections(c.env.DB, db, timezone);

  return c.json({
    data: {
      status: 'success',
      eventsProcessed: rebuildResult.eventsProcessed,
      progressCount: rebuildResult.progressCount,
      dailyCount: rebuildResult.dailyCount,
      rebuiltAt: new Date().toISOString(),
    },
    meta: {
      requestId: c.get('requestId'),
      correlationId: c.get('correlationId'),
      generatedAt: new Date().toISOString(),
    },
  });
});

adminRoutes.post('/admin/dispatch-outbox', async (c) => {
  const db = createKyselyD1(c.env.DB);
  const handler = new ConfigurableReconciliationHandler('ABSENT');

  // Sweep 1: wrap dispatched jobs in QueueMessageEnvelope before sending to SYNC_QUEUE
  const dispatchedCount = await ReliabilityEngine.sweepUndispatchedAndFailedJobs(
    db,
    async (job) => {
      const envelope = wrapJobInQueueEnvelope(job);
      if (c.env.SYNC_QUEUE && typeof (c.env.SYNC_QUEUE as any).send === 'function') {
        await (c.env.SYNC_QUEUE as any).send(envelope);
      }
    }
  );

  // Sweep 2: Recover stale PROCESSING jobs
  const staleResults = await ReliabilityEngine.sweepStaleProcessingJobs(db, handler);
  const recoveredCount = staleResults.filter((r) => r.outcome.startsWith('RECOVERED')).length;
  const terminalFailuresCount = staleResults.filter(
    (r) => r.outcome === 'TERMINAL_DEAD_LETTER'
  ).length;

  return c.json({
    data: {
      dispatchedCount,
      recoveredCount,
      terminalFailuresCount,
    },
    meta: {
      requestId: c.get('requestId'),
      correlationId: c.get('correlationId'),
      generatedAt: new Date().toISOString(),
    },
  });
});
