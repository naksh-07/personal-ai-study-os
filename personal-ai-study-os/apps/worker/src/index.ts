import { Hono } from 'hono';
import { createKyselyD1, D1Database } from '@personal-os/db';

export interface Env {
  DB: D1Database;
  SYNC_QUEUE: unknown;
  ENVIRONMENT: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT || 'development',
  });
});

app.get('/v1/status', async (c) => {
  const db = createKyselyD1(c.env.DB);
  const user = await db.selectFrom('users').selectAll().executeTakeFirst();
  const eventCount = await db
    .selectFrom('canonical_events')
    .select(db.fn.countAll<number>().as('count'))
    .executeTakeFirst();

  return c.json({
    system: 'Personal AI Study OS',
    version: '1.2.3',
    status: 'online',
    operatorConfigured: !!user,
    eventsRecorded: Number(eventCount?.count ?? 0),
  });
});

export default app;
