import { Context } from 'hono';
import { ZodError } from 'zod';
import { classifyError } from '@personal-os/domain';

export function errorHandler(err: Error, c: Context) {
  const requestId = (c.get('requestId') as string) ?? 'req_unknown';
  const correlationId = (c.get('correlationId') as string) ?? 'corr_unknown';

  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          category: 'validation',
          message: 'Request schema validation failed',
          details: err.issues.map(i => `${i.path.join('.')}: ${i.message}`),
        },
        meta: {
          requestId,
          correlationId,
          timestamp: new Date().toISOString(),
        },
      },
      400
    );
  }

  const classified = classifyError(err);

  let message = classified.message;
  let details = classified.details ?? null;

  if (classified.status >= 500 || classified.category === 'internal') {
    console.error(`[ERROR] [${requestId}] [${correlationId}]`, err);
    if (c.env?.ENVIRONMENT !== 'test') {
      message = 'An internal error occurred.';
      details = null;
    }
  }

  return c.json(
    {
      error: {
        code: classified.code,
        category: classified.category,
        message,
        details,
      },
      meta: {
        requestId,
        correlationId,
        timestamp: new Date().toISOString(),
      },
    },
    classified.status as any
  );
}

