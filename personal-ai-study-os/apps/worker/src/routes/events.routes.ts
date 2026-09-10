import { Hono } from 'hono';
import { createKyselyD1 } from '@personal-os/db';
import { PersonalStateService } from '@personal-os/core';
import { requireAuth } from '../middleware/auth';
import { AppContext } from '../types';

export const eventsRoutes = new Hono<AppContext>();

eventsRoutes.use('/events', requireAuth('write'));

eventsRoutes.post('/events', async (c) => {
  const idempotencyKey = c.req.header('idempotency-key') || c.req.header('Idempotency-Key');
  const body = await c.req.json();
  const user = c.get('user');

  const defaultActor = { type: 'user', id: user?.id ?? 'usr_operator' };
  const defaultSource = { system: 'chatgpt', interface: 'rest' };

  const eventInput = {
    ...body,
    actor: body.actor ?? defaultActor,
    source: body.source ?? defaultSource,
  };

  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const result = await service.recordEvent(eventInput, {
    key: idempotencyKey,
    sourceSystem: 'rest',
    requestPayload: body,
  });

  const status = (result as any)?.replayed ? 200 : 201;
  return c.json(
    {
      data: result,
      meta: {
        requestId: c.get('requestId'),
        correlationId: c.get('correlationId'),
        generatedAt: new Date().toISOString(),
      },
    },
    status as any
  );
});
