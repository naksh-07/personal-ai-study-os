export interface RateLimiter {
  acquire(): Promise<void>;
}

// ============================================================================
// Errors
// ============================================================================

export class ProviderRetryableError extends Error {
  public readonly isRetryable: boolean = true;
  public readonly status?: number;
  public readonly code?: string;

  constructor(message: string, options?: { status?: number; code?: string; cause?: unknown }) {
    super(message);
    this.name = 'ProviderRetryableError';
    this.status = options?.status;
    this.code = options?.code;
    if (options?.cause) {
      (this as any).cause = options.cause;
    }
  }
}

export class AmbiguousProviderError extends ProviderRetryableError {
  public readonly isAmbiguous: boolean = true;

  constructor(message: string, options?: { status?: number; code?: string; cause?: unknown }) {
    super(message, options);
    this.name = 'AmbiguousProviderError';
  }
}

// ============================================================================
// Google Tasks Types
// ============================================================================

export interface GoogleTask {
  id: string;
  title: string;
  status: 'needsAction' | 'completed';
  notes?: string;
  due?: string; // Normalized to YYYY-MM-DDT00:00:00.000Z
  updated?: string;
  completed?: string;
  deleted?: boolean;
  hidden?: boolean;
}

export interface GoogleTasksListResponse {
  items?: GoogleTask[];
  nextPageToken?: string;
}

export interface TaskSearchReconciliationResult {
  matchedTask?: GoogleTask;
  exhaustivelyNotFound: boolean;
  uncertain?: boolean;
  pagesScanned: number;
  tasksScanned: number;
}

export interface CreateTaskParams {
  tasklistId: string;
  entityType: string;
  entityId: string;
  idempotencyKey: string;
  title: string;
  notes?: string;
  due?: string | Date;
  status?: 'needsAction' | 'completed';
  createdAt?: string;
  attemptCount?: number;
}

export interface UpdateTaskParams {
  tasklistId: string;
  taskId: string;
  title?: string;
  notes?: string;
  due?: string | Date;
  status?: 'needsAction' | 'completed';
}

// ============================================================================
// Google Auth Types
// ============================================================================

export interface GoogleTokenProviderConfig {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  staticAccessToken?: string;
  tokenEndpoint?: string;
  fetchFn?: typeof fetch;
  expiryBufferSeconds?: number;
}

export interface IGoogleTokenProvider {
  getAccessToken(): Promise<string>;
  invalidate(): void;
}

export interface GoogleTasksAdapterConfig {
  accessToken?: string;
  tokenProvider?: IGoogleTokenProvider;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export interface IGoogleTasksAdapter {
  reconcileTaskSearch(
    tasklistId: string,
    entityId: string,
    idempotencyKey: string,
    createdAt: string,
    attemptCount: number
  ): Promise<TaskSearchReconciliationResult>;
  getTask(tasklistId: string, taskId: string): Promise<GoogleTask | null>;
  createTask(params: CreateTaskParams): Promise<{ created: boolean; adopted: boolean; task: GoogleTask }>;
  updateTask(params: UpdateTaskParams): Promise<{ updated: boolean; task: GoogleTask }>;
}

// ============================================================================
// Google Calendar Types
// ============================================================================

export interface GoogleCalendarTime {
  date?: string;
  dateTime?: string; // ISO 8601 with offset
  timeZone?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start: GoogleCalendarTime;
  end: GoogleCalendarTime;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  etag?: string;
  updated?: string;
}

export interface CreateCalendarEventParams {
  calendarId: string;
  idempotencyKey: string;
  summary: string;
  description?: string;
  start: GoogleCalendarTime;
  end: GoogleCalendarTime;
}

export interface UpdateCalendarEventParams {
  calendarId: string;
  eventId: string;
  etag?: string;
  summary?: string;
  description?: string;
  start?: GoogleCalendarTime;
  end?: GoogleCalendarTime;
}

export interface CalendarGetResult {
  status: number;
  data?: GoogleCalendarEvent;
  error?: string;
}

export interface GoogleCalendarAdapterConfig {
  accessToken?: string;
  tokenProvider?: IGoogleTokenProvider;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export interface IGoogleCalendarAdapter {
  getEvent(calendarId: string, eventId: string): Promise<CalendarGetResult>;
  createEvent(params: CreateCalendarEventParams): Promise<{ created: boolean; adopted: boolean; event: GoogleCalendarEvent }>;
  updateEvent(params: UpdateCalendarEventParams): Promise<{ updated: boolean; reconciled: boolean; event: GoogleCalendarEvent }>;
}

// ============================================================================
// Notion Types
// ============================================================================

export interface NotionPage {
  id: string;
  last_edited_time: string;
  properties: Record<string, any>;
  archived?: boolean;
  url?: string;
}

export interface NotionDatabaseQueryResult {
  results: NotionPage[];
  has_more: boolean;
  next_cursor?: string | null;
}

export interface NotionQueryResult {
  foundPage?: NotionPage;
  exhaustivelyNotFound: boolean;
  uncertain?: boolean;
}

export interface CreateNotionPageParams {
  databaseId: string;
  entityId: string;
  properties?: Record<string, any>;
  children?: any[];
}

export interface UpdateNotionPageParams {
  pageId: string;
  properties: Record<string, any>;
}

export interface NotionAdapterConfig {
  apiKey?: string;
  webhookSecret?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  rateLimiter?: RateLimiter;
}

export interface INotionAdapter {
  queryByEntityId(databaseId: string, entityId: string): Promise<NotionQueryResult>;
  getPage(pageId: string): Promise<NotionPage | null>;
  createPage(params: CreateNotionPageParams): Promise<{ created: boolean; adopted: boolean; page: NotionPage }>;
  updatePage(params: UpdateNotionPageParams): Promise<{ updated: boolean; page: NotionPage }>;
  verifyWebhookSignature(rawBody: string | Uint8Array, signatureHeader: string, webhookSecret?: string): boolean;
}

// ============================================================================
// Unified Provider Adapters
// ============================================================================

export interface ProviderAdapters {
  tasks: IGoogleTasksAdapter;
  calendar: IGoogleCalendarAdapter;
  notion: INotionAdapter;
}
