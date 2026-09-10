import { Hono } from 'hono';
import { createKyselyD1 } from '@personal-os/db';
import { requestContextMiddleware } from './middleware/request-context';
import { errorHandler } from './middleware/error-handler';
import { stateRoutes } from './routes/state.routes';
import { eventsRoutes } from './routes/events.routes';
import { mutationsRoutes } from './routes/mutations.routes';
import { adminRoutes } from './routes/admin.routes';
import { AppContext, Env } from './types';

export type { Env, AppContext };

const app = new Hono<AppContext>();

// Global Middlewares
app.use('*', requestContextMiddleware);
app.onError(errorHandler);

// Root & Health
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

// Mount /v1 Routes
app.route('/v1', stateRoutes);
app.route('/v1', eventsRoutes);
app.route('/v1', mutationsRoutes);
app.route('/v1', adminRoutes);

// 404 Handler
app.notFound((c) => {
  const requestId = c.get('requestId') || 'req_unknown';
  const correlationId = c.get('correlationId') || 'corr_unknown';
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        category: 'not_found',
        message: `Endpoint '${c.req.method} ${c.req.path}' not found`,
        details: null,
      },
      meta: {
        requestId,
        correlationId,
        timestamp: new Date().toISOString(),
      },
    },
    404
  );
});

export default app;
