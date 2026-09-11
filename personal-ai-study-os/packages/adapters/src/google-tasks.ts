import {
  GoogleTask,
  GoogleTasksListResponse,
  TaskSearchReconciliationResult,
  CreateTaskParams,
  UpdateTaskParams,
  GoogleTasksAdapterConfig,
  IGoogleTasksAdapter,
  AmbiguousProviderError,
  ProviderRetryableError,
} from './types';

// ============================================================================
// Constants & Regular Expressions
// ============================================================================

export const METADATA_TOKEN_REGEX =
  /\[study-os:entity_id:([a-zA-Z0-9_\-]+):idempotency_key:([a-zA-Z0-9_\-]+)\]/;

export const MAX_RECONCILIATION_HORIZON_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_PAGINATION_CEILING = 5; // 5 pages (500 tasks)
export const PAGE_SIZE = 100;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Strict WHAT vs WHEN separation: Normalizes due dates to RFC 3339 date-only format
 * at UTC midnight: YYYY-MM-DDT00:00:00.000Z. Strips any intraday hours/minutes.
 */
export function normalizeDueDate(due: string | Date | undefined): string | undefined {
  if (!due) return undefined;
  const d = typeof due === 'string' ? new Date(due) : due;
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid due date format: ${due}`);
  }
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}T00:00:00.000Z`;
}

/**
 * Formats the deterministic metadata token for embedding into task notes.
 */
export function formatMetadataToken(entityId: string, idempotencyKey: string): string {
  return `[study-os:entity_id:${entityId}:idempotency_key:${idempotencyKey}]`;
}

/**
 * Appends the deterministic metadata token with double newline, or sets it as notes.
 */
export function appendMetadataToken(
  notes: string | undefined,
  entityId: string,
  idempotencyKey: string
): string {
  const token = formatMetadataToken(entityId, idempotencyKey);
  if (!notes || notes.trim().length === 0) {
    return token;
  }
  return `${notes.trimEnd()}\n\n${token}`;
}

/**
 * Extracts entityId and idempotencyKey from a task notes string if present.
 */
export function extractMetadataToken(
  notes: string | undefined
): { entityId: string; idempotencyKey: string } | null {
  if (!notes) return null;
  const match = notes.match(METADATA_TOKEN_REGEX);
  if (!match) return null;
  return {
    entityId: match[1],
    idempotencyKey: match[2],
  };
}

/**
 * Verifies if the notes contains the exact matching deterministic token.
 */
export function hasMatchingMetadataToken(
  notes: string | undefined,
  entityId: string,
  idempotencyKey: string
): boolean {
  const extracted = extractMetadataToken(notes);
  if (!extracted) return false;
  return extracted.entityId === entityId && extracted.idempotencyKey === idempotencyKey;
}

/**
 * Preserves the deterministic metadata token from the existing notes into updated notes.
 */
export function preserveMetadataToken(
  existingNotes: string | undefined,
  updatedNotes: string | undefined
): string | undefined {
  const token = extractMetadataToken(existingNotes);
  if (!token) return updatedNotes;

  const currentTokenInUpdated = extractMetadataToken(updatedNotes);
  if (
    currentTokenInUpdated &&
    currentTokenInUpdated.entityId === token.entityId &&
    currentTokenInUpdated.idempotencyKey === token.idempotencyKey
  ) {
    return updatedNotes;
  }

  const cleanNotes = updatedNotes ? updatedNotes.replace(METADATA_TOKEN_REGEX, '').trimEnd() : '';
  return appendMetadataToken(cleanNotes || undefined, token.entityId, token.idempotencyKey);
}

/**
 * Calculates updatedMin for 4-Tier Expanding Reconciliation Search anchored to job.created_at.
 * Tier 1 (attempt_count <= 1): updatedMin = created_at - 5 minutes
 * Tier 2 (attempt_count == 2): updatedMin = created_at - 30 minutes
 * Tier 3 (attempt_count == 3): updatedMin = created_at - 2 hours
 * Tier 4 (attempt_count >= 4): updatedMin = created_at - 24 hours
 * Maximum horizon: 24 hours. Rejects any search beyond 24 hours.
 */
export function calculateExpandingUpdatedMin(
  createdAt: string | Date,
  attemptCount: number
): string {
  const createdTime = typeof createdAt === 'string' ? new Date(createdAt).getTime() : createdAt.getTime();
  if (isNaN(createdTime)) {
    throw new Error(`Invalid createdAt timestamp: ${createdAt}`);
  }

  let deltaMs: number;
  if (attemptCount <= 1) {
    deltaMs = 5 * 60 * 1000; // 5 mins
  } else if (attemptCount === 2) {
    deltaMs = 30 * 60 * 1000; // 30 mins
  } else if (attemptCount === 3) {
    deltaMs = 2 * 60 * 60 * 1000; // 2 hours
  } else {
    deltaMs = 24 * 60 * 60 * 1000; // 24 hours
  }

  if (deltaMs > MAX_RECONCILIATION_HORIZON_MS) {
    throw new Error('Search horizon exceeds 24-hour maximum limit');
  }

  return new Date(createdTime - deltaMs).toISOString();
}

/**
 * Validates that an arbitrary updatedMin does not violate the 24-hour maximum horizon limit.
 */
export function assertValidReconciliationHorizon(
  createdAt: string | Date,
  updatedMin: string | Date
): void {
  const createdTime = typeof createdAt === 'string' ? new Date(createdAt).getTime() : createdAt.getTime();
  const minTime = typeof updatedMin === 'string' ? new Date(updatedMin).getTime() : updatedMin.getTime();
  const diff = createdTime - minTime;

  if (diff > MAX_RECONCILIATION_HORIZON_MS) {
    throw new Error(`Search horizon exceeds 24-hour maximum limit (diff: ${diff}ms > ${MAX_RECONCILIATION_HORIZON_MS}ms)`);
  }
}

// ============================================================================
// Google Tasks Adapter Class
// ============================================================================

export class GoogleTasksAdapter implements IGoogleTasksAdapter {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly accessToken?: string;

  constructor(config: GoogleTasksAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://tasks.googleapis.com';
    this.fetchFn = config.fetchFn ?? fetch.bind(globalThis);
    this.accessToken = config.accessToken;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  /**
   * 4-Tier Expanding Reconciliation Search & Exhaustive Paginated Traversal.
   * Traverses up to 5 pages (500 tasks) with showCompleted=true, showHidden=true, showDeleted=false.
   */
  async reconcileTaskSearch(
    tasklistId: string,
    entityId: string,
    idempotencyKey: string,
    createdAt: string,
    attemptCount: number
  ): Promise<TaskSearchReconciliationResult> {
    const updatedMin = calculateExpandingUpdatedMin(createdAt, attemptCount);
    assertValidReconciliationHorizon(createdAt, updatedMin);

    let pageToken: string | undefined = undefined;
    let pagesScanned = 0;
    let tasksScanned = 0;

    while (pagesScanned < MAX_PAGINATION_CEILING) {
      pagesScanned++;
      const params = new URLSearchParams({
        maxResults: String(PAGE_SIZE),
        showCompleted: 'true',
        showHidden: 'true',
        showDeleted: 'false',
        updatedMin,
      });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      let res: Response;
      try {
        res = await this.fetchFn(
          `${this.baseUrl}/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks?${params.toString()}`,
          {
            method: 'GET',
            headers: this.getHeaders(),
          }
        );
      } catch (networkError) {
        // A6: Ambiguous Provider State on network failure/timeout
        return {
          matchedTask: undefined,
          exhaustivelyNotFound: false,
          uncertain: true,
          pagesScanned,
          tasksScanned,
        };
      }

      // A6: Ambiguous Provider State on 429, 5xx
      if (res.status === 429 || res.status >= 500) {
        return {
          matchedTask: undefined,
          exhaustivelyNotFound: false,
          uncertain: true,
          pagesScanned,
          tasksScanned,
        };
      }

      if (!res.ok) {
        return {
          matchedTask: undefined,
          exhaustivelyNotFound: false,
          uncertain: true,
          pagesScanned,
          tasksScanned,
        };
      }

      const body = (await res.json()) as GoogleTasksListResponse;
      const items = body.items ?? [];
      tasksScanned += items.length;

      for (const item of items) {
        if (hasMatchingMetadataToken(item.notes, entityId, idempotencyKey)) {
          // A8: Token found -> Return matched task immediately
          return {
            matchedTask: item,
            exhaustivelyNotFound: false,
            uncertain: false,
            pagesScanned,
            tasksScanned,
          };
        }
      }

      if (!body.nextPageToken) {
        // Exhaustive traversal completed naturally with 0 matching tokens
        return {
          matchedTask: undefined,
          exhaustivelyNotFound: true,
          uncertain: false,
          pagesScanned,
          tasksScanned,
        };
      }

      pageToken = body.nextPageToken;
    }

    // Safety ceiling of 5 pages (500 tasks) reached without reaching end of pages
    return {
      matchedTask: undefined,
      exhaustivelyNotFound: false,
      uncertain: true,
      pagesScanned,
      tasksScanned,
    };
  }

  /**
   * Retrieves an individual task by ID.
   */
  async getTask(tasklistId: string, taskId: string): Promise<GoogleTask | null> {
    let res: Response;
    try {
      res = await this.fetchFn(
        `${this.baseUrl}/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        }
      );
    } catch (err) {
      throw new AmbiguousProviderError(`Network timeout fetching task ${taskId}`, { cause: err });
    }

    if (res.status === 404) {
      return null;
    }

    if (res.status === 429 || res.status >= 500) {
      throw new ProviderRetryableError(`Google Tasks GET returned HTTP ${res.status}`, {
        status: res.status,
      });
    }

    if (!res.ok) {
      throw new Error(`Google Tasks GET failed with HTTP ${res.status}`);
    }

    return (await res.json()) as GoogleTask;
  }

  /**
   * Safe-Create Gate (A7) & Existing-Task Adoption (A8).
   * Creates a task only if search succeeded with HTTP 200, all pages traversed,
   * zero matching tokens found, and provider state is authoritative.
   */
  async createTask(
    params: CreateTaskParams
  ): Promise<{ created: boolean; adopted: boolean; task: GoogleTask }> {
    const createdAt = params.createdAt ?? new Date().toISOString();
    const attemptCount = params.attemptCount ?? 1;

    // Step 1: Execute Expanding Reconciliation Search
    const search = await this.reconcileTaskSearch(
      params.tasklistId,
      params.entityId,
      params.idempotencyKey,
      createdAt,
      attemptCount
    );

    // Step 2: Existing-Task Adoption (A8)
    if (search.matchedTask) {
      return {
        created: false,
        adopted: true,
        task: search.matchedTask,
      };
    }

    // Step 3: Ambiguous Provider State check (A6)
    if (search.uncertain || !search.exhaustivelyNotFound) {
      throw new AmbiguousProviderError(
        'Safe-Create Gate failed: provider state is uncertain (pagination ceiling reached, rate limited, or transient error). tasks.insert is prohibited.',
        { code: 'AMBIGUOUS_PROVIDER_STATE' }
      );
    }

    // Step 4: Safe-Create Gate Passed (A7) -> Perform POST
    const normalizedDue = normalizeDueDate(params.due);
    const finalNotes = appendMetadataToken(params.notes, params.entityId, params.idempotencyKey);

    const taskPayload = {
      title: params.title,
      notes: finalNotes,
      status: params.status ?? 'needsAction',
      ...(normalizedDue ? { due: normalizedDue } : {}),
    };

    let res: Response;
    try {
      res = await this.fetchFn(
        `${this.baseUrl}/tasks/v1/lists/${encodeURIComponent(params.tasklistId)}/tasks`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(taskPayload),
        }
      );
    } catch (netErr) {
      throw new AmbiguousProviderError(`Google Tasks POST timed out or network error`, {
        cause: netErr,
      });
    }

    if (res.status === 429 || res.status >= 500) {
      throw new AmbiguousProviderError(`Google Tasks POST failed with HTTP ${res.status}`, {
        status: res.status,
      });
    }

    if (!res.ok) {
      throw new Error(`Google Tasks POST failed with HTTP ${res.status}`);
    }

    const createdTask = (await res.json()) as GoogleTask;
    return {
      created: true,
      adopted: false,
      task: createdTask,
    };
  }

  /**
   * Provider State Reconciliation (A9):
   * Before PATCH, GET existing task. Compare status, title, due date.
   * If identical, skip PATCH. If divergent, PATCH preserving deterministic token.
   */
  async updateTask(
    params: UpdateTaskParams
  ): Promise<{ updated: boolean; task: GoogleTask }> {
    const existing = await this.getTask(params.tasklistId, params.taskId);
    if (!existing) {
      throw new Error(`Task ${params.taskId} not found on Google Tasks (external deleted)`);
    }

    const targetTitle = params.title !== undefined ? params.title : existing.title;
    const targetStatus = params.status !== undefined ? params.status : existing.status;
    const targetDue = params.due !== undefined ? normalizeDueDate(params.due) : normalizeDueDate(existing.due);
    const targetNotes = preserveMetadataToken(existing.notes, params.notes !== undefined ? params.notes : existing.notes);

    const existingDue = normalizeDueDate(existing.due);

    const isTitleIdentical = existing.title === targetTitle;
    const isStatusIdentical = existing.status === targetStatus;
    const isDueIdentical = existingDue === targetDue;
    const isNotesIdentical = existing.notes === targetNotes;

    // If identical, skip PATCH
    if (isTitleIdentical && isStatusIdentical && isDueIdentical && isNotesIdentical) {
      return {
        updated: false,
        task: existing,
      };
    }

    // If divergent, PATCH preserving the deterministic token
    const patchPayload: Record<string, any> = {
      title: targetTitle,
      status: targetStatus,
      notes: targetNotes,
    };
    if (targetDue !== undefined) {
      patchPayload.due = targetDue;
    }

    let res: Response;
    try {
      res = await this.fetchFn(
        `${this.baseUrl}/tasks/v1/lists/${encodeURIComponent(params.tasklistId)}/tasks/${encodeURIComponent(params.taskId)}`,
        {
          method: 'PATCH',
          headers: this.getHeaders(),
          body: JSON.stringify(patchPayload),
        }
      );
    } catch (netErr) {
      throw new AmbiguousProviderError(`Google Tasks PATCH failed with network error`, {
        cause: netErr,
      });
    }

    if (res.status === 429 || res.status >= 500) {
      throw new AmbiguousProviderError(`Google Tasks PATCH failed with HTTP ${res.status}`, {
        status: res.status,
      });
    }

    if (!res.ok) {
      throw new Error(`Google Tasks PATCH failed with HTTP ${res.status}`);
    }

    const updatedTask = (await res.json()) as GoogleTask;
    return {
      updated: true,
      task: updatedTask,
    };
  }
}
