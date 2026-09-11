import type { MessageBatch, ExecutionContext } from '@cloudflare/workers-types';
import {
  QueueMessageEnvelope,
  computeExponentialBackoffDelaySeconds,
  classifyReliabilityFailure,
} from '@personal-os/domain';
import { Env } from '../types';
import {
  GoogleTasksAdapter,
  GoogleCalendarAdapter,
  NotionAdapter,
  GoogleTokenProvider,
  IGoogleTokenProvider,
} from '@personal-os/adapters';

/**
 * Resolves the Google OAuth token provider from environment configuration.
 * Favors refresh credentials, then falls back to static tokens.
 */
export function getGoogleTokenProvider(
  env: Env,
  preferredStaticToken?: string
): IGoogleTokenProvider | undefined {
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN) {
    return new GoogleTokenProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      refreshToken: env.GOOGLE_REFRESH_TOKEN,
    });
  }
  const staticToken =
    preferredStaticToken || env.GOOGLE_TASKS_ACCESS_TOKEN || env.GOOGLE_CALENDAR_ACCESS_TOKEN;
  if (staticToken) {
    return new GoogleTokenProvider({
      clientId: '',
      clientSecret: '',
      refreshToken: '',
      staticAccessToken: staticToken,
    });
  }
  return undefined;
}

/**
 * Dispatches the mutation to the external provider adapter.
 * Handles provider interactions and throws errors on network/rate-limit/adapter failures.
 */
export async function dispatchToProviderAdapter(
  envelope: QueueMessageEnvelope,
  env: Env
): Promise<void> {
  const { targetSystem, operation, payload, entityId, idempotencyKey } = envelope;

  if (!payload || typeof payload !== 'object') {
    throw new Error(`INVALID_ENTITY: Missing or invalid mutation payload for ${targetSystem}`);
  }

  const p = payload as Record<string, any>;

  switch (targetSystem) {
    case 'notion': {
      const adapter = new NotionAdapter({
        apiKey: env.NOTION_API_KEY,
        webhookSecret: env.NOTION_WEBHOOK_SECRET,
      });
      if (operation === 'create' || operation === 'sync') {
        const databaseId = p.databaseId ?? p.database_id ?? '';
        await adapter.createPage({
          databaseId,
          entityId,
          properties: p.properties,
          children: p.children,
        });
      } else if (operation === 'update') {
        const pageId = p.pageId ?? p.page_id ?? entityId;
        await adapter.updatePage({
          pageId,
          properties: p.properties ?? {},
        });
      }
      break;
    }
    case 'google_tasks': {
      const tokenProvider = getGoogleTokenProvider(env, env.GOOGLE_TASKS_ACCESS_TOKEN);
      const adapter = new GoogleTasksAdapter({
        tokenProvider,
        accessToken: env.GOOGLE_TASKS_ACCESS_TOKEN,
      });
      const tasklistId = p.tasklistId ?? p.tasklist_id ?? '@default';
      if (operation === 'create' || operation === 'sync') {
        await adapter.createTask({
          tasklistId,
          entityType: envelope.entityType,
          entityId,
          idempotencyKey,
          title: p.title ?? 'Untitled Task',
          notes: p.notes,
          due: p.due,
          status: p.status,
          createdAt: envelope.enqueuedAt,
        });
      } else if (operation === 'update') {
        const taskId = p.taskId ?? p.task_id ?? entityId;
        await adapter.updateTask({
          tasklistId,
          taskId,
          title: p.title,
          notes: p.notes,
          due: p.due,
          status: p.status,
        });
      }
      break;
    }
    case 'google_calendar': {
      const tokenProvider = getGoogleTokenProvider(env, env.GOOGLE_CALENDAR_ACCESS_TOKEN);
      const adapter = new GoogleCalendarAdapter({
        tokenProvider,
        accessToken: env.GOOGLE_CALENDAR_ACCESS_TOKEN,
      });
      const calendarId = p.calendarId ?? p.calendar_id ?? 'primary';
      if (operation === 'create' || operation === 'sync') {
        await adapter.createEvent({
          calendarId,
          idempotencyKey,
          summary: p.summary ?? p.title ?? 'Untitled Event',
          description: p.description,
          start: p.start ?? { dateTime: p.startsAt ?? new Date().toISOString() },
          end: p.end ?? { dateTime: p.endsAt ?? new Date(Date.now() + 3600000).toISOString() },
        });
      } else if (operation === 'update') {
        const eventId = p.eventId ?? p.event_id ?? entityId;
        await adapter.updateEvent({
          calendarId,
          eventId,
          etag: p.etag,
          summary: p.summary ?? p.title,
          description: p.description,
          start: p.start,
          end: p.end,
        });
      }
      break;
    }
    default: {
      throw new Error(`PERMANENT_ERROR: Unsupported target system '${targetSystem}'`);
    }
  }
}

/**
 * Cloudflare Queue Consumer conforming strictly to Spec v1.2.3 Section 16.2.
 */
export async function processQueueBatch(
  batch: MessageBatch<QueueMessageEnvelope>,
  env: Env,
  _ctx?: ExecutionContext
): Promise<void> {
  for (const msg of batch.messages) {
    // Step 1: Extract QueueMessageEnvelope
    const envelope = msg.body;
    if (!envelope || !envelope.jobId || !envelope.idempotencyKey) {
      if (typeof msg.ack === 'function') msg.ack();
      continue;
    }

    try {
      // Step 2: Idempotency Check
      // Query idempotency_records WHERE idempotency_key = envelope.idempotencyKey
      const idempRecord = await env.DB.prepare(
        'SELECT status FROM idempotency_records WHERE idempotency_key = ?'
      )
        .bind(envelope.idempotencyKey)
        .first<{ status: string }>();

      if (idempRecord?.status === 'COMPLETED') {
        // Idempotent: already completed, call msg.ack() and terminate immediately
        if (typeof msg.ack === 'function') msg.ack();
        continue;
      }

      // Step 3: Atomic Processing Lease Claim
      // Conditional update to claim execution lease and initiate a NEW execution attempt
      const claimResult = await env.DB.prepare(
        `UPDATE sync_jobs
         SET status = 'PROCESSING',
             processing_started_at = CURRENT_TIMESTAMP,
             attempt_count = attempt_count + 1,
             last_error = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE job_id = ? AND status IN ('DISPATCHED', 'PENDING')`
      )
        .bind(envelope.jobId)
        .run();

      const changes = claimResult.meta?.changes ?? (claimResult as any).changes ?? 0;
      if (changes === 0) {
        // Lease acquisition yielded: another consumer claimed or completed the job
        if (typeof msg.ack === 'function') msg.ack();
        continue;
      }

      // Lease acquired: attempt_count incremented EXACTLY ONCE for this execution attempt.
      // No subsequent step in this attempt may increment attempt_count.
      const jobRow = await env.DB.prepare(
        'SELECT attempt_count FROM sync_jobs WHERE job_id = ?'
      )
        .bind(envelope.jobId)
        .first<{ attempt_count: number }>();

      const attemptCount = jobRow?.attempt_count ?? 1;

      try {
        // Step 4: Dispatch to target ProviderAdapter (GoogleTasksAdapter, GoogleCalendarAdapter, NotionAdapter)
        await dispatchToProviderAdapter(envelope, env);

        // Step 5: Success Branch
        const now = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE sync_jobs
             SET status = 'COMPLETED',
                 completed_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE job_id = ?`
          ).bind(envelope.jobId),
          env.DB.prepare(
            `INSERT INTO idempotency_records (
               idempotency_key, job_id, operation, source_system, request_hash, status, result_payload, created_at, updated_at, expires_at
             ) VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, datetime(?, '+24 hours'))
             ON CONFLICT(idempotency_key) DO UPDATE SET
               status = 'COMPLETED',
               updated_at = CURRENT_TIMESTAMP`
          ).bind(
            envelope.idempotencyKey,
            envelope.jobId,
            `${envelope.targetSystem}.${envelope.entityType}.${envelope.operation}`,
            'queue_consumer',
            'queue_payload_hash',
            JSON.stringify({ status: 'COMPLETED' }),
            now,
            now,
            now
          ),
        ]);

        if (typeof msg.ack === 'function') msg.ack();
      } catch (err: unknown) {
        // Failure handling
        const failure = classifyReliabilityFailure(err);
        const errMessage = failure.message;

        // Step 6: Transient/Ambiguous Failure Branch (HTTP 429, 503, timeout, ambiguous)
        // attempt_count is NOT incremented
        if (failure.isRetryable && attemptCount < 5) {
          const delaySeconds = computeExponentialBackoffDelaySeconds(attemptCount);
          const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();

          await env.DB.prepare(
            `UPDATE sync_jobs
             SET status = 'FAILED',
                 last_error = ?,
                 next_attempt_at = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE job_id = ?`
          )
            .bind(errMessage, nextAttemptAt, envelope.jobId)
            .run();

          if (typeof msg.retry === 'function') {
            msg.retry({ delaySeconds });
          }
        } else {
          // Step 7: Terminal Failure Branch (attempt_count >= 5 or permanent error)
          const terminalReason =
            attemptCount >= 5
              ? `MAX_ATTEMPTS_EXHAUSTED: ${errMessage}`
              : errMessage;

          // Route message to personal-sync-dlq (if env.DLQ exists)
          const dlq = (env as any).DLQ || (env as any).SYNC_DLQ;
          if (dlq && typeof dlq.send === 'function') {
            await dlq.send({
              ...envelope,
              terminalError: terminalReason,
              terminalAttemptCount: attemptCount,
            });
          }

          const now = new Date().toISOString();
          await env.DB.batch([
            env.DB.prepare(
              `UPDATE sync_jobs
               SET status = 'DEAD_LETTER',
                   last_error = ?,
                   completed_at = CURRENT_TIMESTAMP,
                   updated_at = CURRENT_TIMESTAMP
               WHERE job_id = ?`
            ).bind(terminalReason, envelope.jobId),
            env.DB.prepare(
              `INSERT INTO idempotency_records (
                 idempotency_key, job_id, operation, source_system, request_hash, status, result_payload, created_at, updated_at, expires_at
               ) VALUES (?, ?, ?, ?, ?, 'FAILED', ?, ?, ?, datetime(?, '+24 hours'))
               ON CONFLICT(idempotency_key) DO UPDATE SET
                 status = 'FAILED',
                 updated_at = CURRENT_TIMESTAMP`
            ).bind(
              envelope.idempotencyKey,
              envelope.jobId,
              `${envelope.targetSystem}.${envelope.entityType}.${envelope.operation}`,
              'queue_consumer',
              'queue_payload_hash',
              JSON.stringify({ error: terminalReason }),
              now,
              now,
              now
            ),
          ]);

          // Call msg.ack() to remove from primary queue
          if (typeof msg.ack === 'function') msg.ack();
        }
      }
    } catch {
      // Prevent unhandled queue crash
      if (typeof msg.ack === 'function') msg.ack();
    }
  }
}
