import { Hono, Context } from 'hono';
import { createKyselyD1 } from '@personal-os/db';
import { PersonalStateService } from '@personal-os/core';
import { requireAuth } from '../middleware/auth';
import { AppContext } from '../types';

export const mutationsRoutes = new Hono<AppContext>();

mutationsRoutes.use('/study/sessions', requireAuth('write'));
mutationsRoutes.use('/study/progress', requireAuth('write'));
mutationsRoutes.use('/study/chapters/*', requireAuth('write'));
mutationsRoutes.use('/chapters/*', requireAuth('write'));
mutationsRoutes.use('/research', requireAuth('write'));
mutationsRoutes.use('/decisions', requireAuth('write'));
mutationsRoutes.use('/links/*', requireAuth('write'));

function formatMutationResponse(c: Context<AppContext>, result: unknown, status = 201) {
  const finalStatus = (result as any)?.replayed ? 200 : status;
  return c.json(
    {
      data: result,
      meta: {
        requestId: c.get('requestId'),
        correlationId: c.get('correlationId'),
        generatedAt: new Date().toISOString(),
      },
    },
    finalStatus as any
  );
}

// 1. Study Sessions
mutationsRoutes.post('/study/sessions', async (c) => {
  const idempotencyKey = c.req.header('idempotency-key') || c.req.header('Idempotency-Key');
  const body = await c.req.json();
  const correlationId = c.get('correlationId');

  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const result = await service.recordStudySession(
    { ...body, correlationId: body.correlationId || correlationId },
    { key: idempotencyKey, sourceSystem: 'rest', requestPayload: body }
  );

  return formatMutationResponse(c, result, 201);
});

// 2. Study Progress
mutationsRoutes.post('/study/progress', async (c) => {
  const idempotencyKey = c.req.header('idempotency-key') || c.req.header('Idempotency-Key');
  const body = await c.req.json();
  const correlationId = c.get('correlationId');

  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const result = await service.updateProgress(
    { ...body, correlationId: body.correlationId || correlationId },
    { key: idempotencyKey, sourceSystem: 'rest', requestPayload: body }
  );

  return formatMutationResponse(c, result, 200);
});

// 3. Complete Chapter (Dual routes: /study/chapters/:chapterId/complete and /chapters/:chapterId/complete)
const handleCompleteChapter = async (c: Context<AppContext>) => {
  const chapterId = c.req.param('chapterId');
  const idempotencyKey = c.req.header('idempotency-key') || c.req.header('Idempotency-Key');
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const correlationId = c.get('correlationId');

  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const result = await service.completeChapter(
    { ...body, chapterId, correlationId: body.correlationId || correlationId },
    { key: idempotencyKey, sourceSystem: 'rest', requestPayload: { ...body, chapterId } }
  );

  return formatMutationResponse(c, result, 200);
};

mutationsRoutes.post('/study/chapters/:chapterId/complete', handleCompleteChapter);
mutationsRoutes.post('/chapters/:chapterId/complete', handleCompleteChapter);

// 4. Research
mutationsRoutes.post('/research', async (c) => {
  const idempotencyKey = c.req.header('idempotency-key') || c.req.header('Idempotency-Key');
  const body = await c.req.json();
  const correlationId = c.get('correlationId');

  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const result = await service.recordResearch(
    { ...body, correlationId: body.correlationId || correlationId },
    { key: idempotencyKey, sourceSystem: 'rest', requestPayload: body }
  );

  return formatMutationResponse(c, result, 201);
});

// 5. Decisions
mutationsRoutes.post('/decisions', async (c) => {
  const idempotencyKey = c.req.header('idempotency-key') || c.req.header('Idempotency-Key');
  const body = await c.req.json();
  const correlationId = c.get('correlationId');

  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const result = await service.recordDecision(
    { ...body, correlationId: body.correlationId || correlationId },
    { key: idempotencyKey, sourceSystem: 'rest', requestPayload: body }
  );

  return formatMutationResponse(c, result, 201);
});

// 6. Link Tasks
mutationsRoutes.post('/links/tasks', async (c) => {
  const idempotencyKey = c.req.header('idempotency-key') || c.req.header('Idempotency-Key');
  const body = await c.req.json();
  const correlationId = c.get('correlationId');

  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const result = await service.linkTask(
    { ...body, correlationId: body.correlationId || correlationId },
    { key: idempotencyKey, sourceSystem: 'rest', requestPayload: body }
  );

  return formatMutationResponse(c, result, 201);
});

// 7. Link Calendar
mutationsRoutes.post('/links/calendar', async (c) => {
  const idempotencyKey = c.req.header('idempotency-key') || c.req.header('Idempotency-Key');
  const body = await c.req.json();
  const correlationId = c.get('correlationId');

  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const result = await service.linkCalendarEvent(
    { ...body, correlationId: body.correlationId || correlationId },
    { key: idempotencyKey, sourceSystem: 'rest', requestPayload: body }
  );

  return formatMutationResponse(c, result, 201);
});
