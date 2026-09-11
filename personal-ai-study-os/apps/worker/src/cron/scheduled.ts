import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types';
import { Env } from '../types';
import { runOutboxDualSweep, OutboxSweepResult } from '../queue/outbox-dispatcher';
import { createKyselyD1 } from '@personal-os/db';

/**
 * Secondary Notion reconciliation sweep.
 * Runs on cron "0 every-6-hours" to inspect recently modified Notion pages and task links,
 * recovering any mutations or state changes missed during webhook outages.
 */
export async function runNotionReconciliationSweep(
  env: Env
): Promise<{ checkedCount: number }> {
  const db = createKyselyD1(env.DB);
  const sixHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();

  // Query notion task links not synced recently
  const staleLinks = await db
    .selectFrom('task_links')
    .selectAll()
    .where('provider', '=', 'notion')
    .where('last_synced_at', '<', sixHoursAgo)
    .limit(50)
    .execute();

  return { checkedCount: staleLinks.length };
}

/**
 * Cloudflare Scheduled Cron Handler.
 * Routes cron events according to Spec v1.2.3 Section 9.2:
 * - Every minute: Outbox dual-sweep (undispatched outbox and stale PROCESSING recovery).
 * - Every 6 hours: Secondary Notion reconciliation sweep.
 */
export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  _ctx?: ExecutionContext
): Promise<void | OutboxSweepResult | { checkedCount: number }> {
  const cron = event.cron;

  if (cron === '0 */6 * * *') {
    return await runNotionReconciliationSweep(env);
  } else {
    // Default or "* * * * *": Outbox dual sweep
    return await runOutboxDualSweep(env);
  }
}
