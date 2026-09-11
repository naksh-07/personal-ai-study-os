import { GoogleCalendarEvent, GoogleTask } from '../types';

export type BridgeCalendarOperation =
  | 'calendar.get'
  | 'calendar.create'
  | 'calendar.update'
  | 'calendar.delete';

export type BridgeTasksOperation =
  | 'tasks.list'
  | 'tasks.get'
  | 'tasks.create'
  | 'tasks.update'
  | 'tasks.delete';

export type BridgeOperation = BridgeCalendarOperation | BridgeTasksOperation;

export interface BridgeRequestEnvelope<T = Record<string, any>> {
  version: '1';
  timestamp: number;
  request_id: string;
  operation: BridgeOperation;
  payload: T;
  signature: string;
}

export interface BridgeErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface BridgeResponseEnvelope<T = unknown> {
  ok: boolean;
  statusCode: number;
  data?: T;
  error?: BridgeErrorPayload;
  request_id: string;
}

export interface GoogleBridgeClientConfig {
  bridgeUrl: string;
  bridgeSecret: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxSkewSeconds?: number;
}

// Payload definitions for bridge operations

export interface BridgeCalendarGetPayload {
  calendarId: string;
  eventId: string;
}

export interface BridgeCalendarCreatePayload {
  calendarId: string;
  event: {
    id: string;
    summary: string;
    description?: string;
    start: { date?: string; dateTime?: string; timeZone?: string };
    end: { date?: string; dateTime?: string; timeZone?: string };
  };
}

export interface BridgeCalendarUpdatePayload {
  calendarId: string;
  eventId: string;
  etag?: string;
  event: {
    summary?: string;
    description?: string;
    start?: { date?: string; dateTime?: string; timeZone?: string };
    end?: { date?: string; dateTime?: string; timeZone?: string };
  };
}

export interface BridgeCalendarDeletePayload {
  calendarId: string;
  eventId: string;
}

export interface BridgeTasksListPayload {
  tasklistId: string;
  updatedMin?: string;
  showCompleted?: boolean;
  showHidden?: boolean;
  showDeleted?: boolean;
  maxResults?: number;
  pageToken?: string;
}

export interface BridgeTasksGetPayload {
  tasklistId: string;
  taskId: string;
}

export interface BridgeTasksCreatePayload {
  tasklistId: string;
  task: {
    title: string;
    notes?: string;
    status?: 'needsAction' | 'completed';
    due?: string;
  };
}

export interface BridgeTasksUpdatePayload {
  tasklistId: string;
  taskId: string;
  task: {
    title?: string;
    notes?: string;
    status?: 'needsAction' | 'completed';
    due?: string;
  };
}

export interface BridgeTasksDeletePayload {
  tasklistId: string;
  taskId: string;
}
