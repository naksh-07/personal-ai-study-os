import { D1Database } from '@personal-os/db';

export interface Env {
  DB: D1Database;
  SYNC_QUEUE?: unknown;
  DLQ?: unknown;
  ENVIRONMENT?: string;
  NOTION_WEBHOOK_SECRET?: string;
  SKIP_AUTH?: string;
  JWT_SECRET?: string;
  AUTH_ISSUER?: string;
  JWKS_URL?: string;
}

export interface AppVariables {
  requestId: string;
  correlationId: string;
  user?: {
    id: string;
    scopes: string[];
    claims?: any;
  };
}

export interface AppContext {
  Bindings: Env;
  Variables: AppVariables;
}
