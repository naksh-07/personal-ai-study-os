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
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  GOOGLE_TASKS_ACCESS_TOKEN?: string;
  GOOGLE_CALENDAR_ACCESS_TOKEN?: string;
  NOTION_API_KEY?: string;
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
