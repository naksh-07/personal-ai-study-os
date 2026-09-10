import { Context, Next } from 'hono';
import { generateId } from '@personal-os/domain';
import { AppContext } from '../types';

export async function requestContextMiddleware(c: Context<AppContext>, next: Next) {
  const requestId = generateId('req');
  const correlationId = c.req.header('x-correlation-id') || c.req.header('correlation-id') || generateId('corr');

  c.set('requestId', requestId);
  c.set('correlationId', correlationId);

  await next();

  c.header('X-Request-ID', requestId);
  c.header('X-Correlation-ID', correlationId);
}
