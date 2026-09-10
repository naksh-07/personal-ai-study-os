import { D1Database } from '@personal-os/db';

export interface Env {
  DB: D1Database;
  SYNC_QUEUE?: unknown;
  ENVIRONMENT?: string;
  NOTION_WEBHOOK_SECRET?: string;
  SKIP_AUTH?: string;
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
