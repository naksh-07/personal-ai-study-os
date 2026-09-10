import { Hono } from 'hono';
import crypto from 'node:crypto';
import { createKyselyD1, ReliabilityRepository } from '@personal-os/db';
import {
  ProjectionEngine,
  ReliabilityEngine,
  ConfigurableReconciliationHandler,
} from '@personal-os/core';
import { requireAuth } from '../middleware/auth';
import { UnauthorizedError } from '@personal-os/domain';
import { AppContext } from '../types';

export const adminRoutes = new Hono<AppContext>();

// Webhooks do not use OAuth bearer tokens; they use HMAC signatures
adminRoutes.post('/webhooks/notion', async (c) => {
  const signature = c.req.header('x-notion-signature') || c.req.header('X-Notion-Signature');
  const secret = c.env.NOTION_WEBHOOK_SECRET;

  const rawBody = await c.req.text();

  if (secret && signature) {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (signature !== expected) {
      throw new UnauthorizedError('Unauthorized: Invalid Notion webhook signature');
    }
  }

  let parsed: any = {};
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    parsed = {};
  }

  const webhookId = parsed.id || parsed.entity_id || crypto.createHash('sha256').update(rawBody).digest('hex');
  const db = createKyselyD1(c.env.DB);
  const idempotencyKey = `webhook_notion_${webhookId}`;
  const requestHash = crypto.createHash('sha256').update(rawBody).digest('hex');

  const claim = await ReliabilityRepository.claimIdempotency(db, {
    idempotencyKey,
    operation: 'webhook_notion',
    sourceSystem: 'notion',
    requestHash,
  });

  if (claim.state === 'COMPLETED') {
    return c.json({ status: 'deduplicated', message: 'Webhook already processed' }, 200);
  }

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

  const dispatchedCount = await ReliabilityEngine.sweepUndispatchedAndFailedJobs(
    db,
    async (_job) => {
      // Dispatch to queue if binding exists
      if (c.env.SYNC_QUEUE && typeof (c.env.SYNC_QUEUE as any).send === 'function') {
        await (c.env.SYNC_QUEUE as any).send(_job);
      }
    }
  );

  const staleResults = await ReliabilityEngine.sweepStaleProcessingJobs(db, handler);
  const recoveredCount = staleResults.filter(r => r.outcome.startsWith('RECOVERED')).length;
  const terminalFailuresCount = staleResults.filter(r => r.outcome === 'TERMINAL_DEAD_LETTER').length;

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
