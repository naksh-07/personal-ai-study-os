import {
  GoogleTask,
  GoogleTasksListResponse,
  TaskSearchReconciliationResult,
  CreateTaskParams,
  UpdateTaskParams,
  IGoogleTasksAdapter,
  AmbiguousProviderError,
} from '../types';
import {
  normalizeDueDate,
  appendMetadataToken,
  hasMatchingMetadataToken,
  preserveMetadataToken,
  calculateExpandingUpdatedMin,
  assertValidReconciliationHorizon,
  MAX_PAGINATION_CEILING,
  PAGE_SIZE,
} from '../google-tasks';
import { GoogleBridgeClient } from './client';
import {
  BridgeResponseEnvelope,
  BridgeTasksCreatePayload,
  BridgeTasksGetPayload,
  BridgeTasksListPayload,
  BridgeTasksUpdatePayload,
} from './types';

export class GoogleTasksBridgeAdapter implements IGoogleTasksAdapter {
  private readonly client: GoogleBridgeClient;

  constructor(client: GoogleBridgeClient) {
    this.client = client;
  }

  /**
   * 4-Tier Expanding Horizon Reconciliation Search & Safe-Create Gate:
   * Traverses up to 5 pages (500 tasks) searching for deterministic metadata token.
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

      let res: BridgeResponseEnvelope<GoogleTasksListResponse>;
      try {
        res = await this.client.execute<BridgeTasksListPayload, GoogleTasksListResponse>(
          'tasks.list',
          {
            tasklistId,
            updatedMin,
            showCompleted: true,
            showHidden: true,
            showDeleted: false,
            maxResults: PAGE_SIZE,
            pageToken,
          }
        );
      } catch (err) {
        return {
          matchedTask: undefined,
          exhaustivelyNotFound: false,
          uncertain: true,
          pagesScanned,
          tasksScanned,
        };
      }

      if (!res.ok || res.statusCode !== 200 || !res.data) {
        return {
          matchedTask: undefined,
          exhaustivelyNotFound: false,
          uncertain: true,
          pagesScanned,
          tasksScanned,
        };
      }

      const body = res.data;
      const items = body.items ?? [];
      tasksScanned += items.length;

      for (const item of items) {
        if (hasMatchingMetadataToken(item.notes, entityId, idempotencyKey)) {
          return {
            matchedTask: item,
            exhaustivelyNotFound: false,
            pagesScanned,
            tasksScanned,
          };
        }
      }

      if (!body.nextPageToken) {
        return {
          matchedTask: undefined,
          exhaustivelyNotFound: true,
          pagesScanned,
          tasksScanned,
        };
      }

      pageToken = body.nextPageToken;
    }

    return {
      matchedTask: undefined,
      exhaustivelyNotFound: false,
      uncertain: true,
      pagesScanned,
      tasksScanned,
    };
  }

  /**
   * Retrieves an individual task by ID via the bridge.
   */
  async getTask(tasklistId: string, taskId: string): Promise<GoogleTask | null> {
    const res = await this.client.execute<BridgeTasksGetPayload, GoogleTask>('tasks.get', {
      tasklistId,
      taskId,
    });

    if (res.statusCode === 404) {
      return null;
    }

    if (!res.ok || res.statusCode !== 200) {
      throw new Error(
        `Google Tasks bridge GET failed with HTTP ${res.statusCode}: ${res.error?.message ?? 'Unknown'}`
      );
    }

    return res.data ?? null;
  }

  /**
   * Safe-Create Gate (A7) & Existing-Task Adoption (A8) via bridge.
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

    // Step 3: Ambiguous Provider State Check (A6)
    if (search.uncertain || !search.exhaustivelyNotFound) {
      throw new AmbiguousProviderError(
        'Safe-Create Gate failed: provider state is uncertain (pagination ceiling reached, rate limited, or transient error). tasks.insert is prohibited.',
        { code: 'AMBIGUOUS_PROVIDER_STATE' }
      );
    }

    // Step 4: Safe-Create Gate Passed -> Perform Create via Bridge
    const normalizedDue = normalizeDueDate(params.due);
    const finalNotes = appendMetadataToken(params.notes, params.entityId, params.idempotencyKey);

    const taskPayload: BridgeTasksCreatePayload['task'] = {
      title: params.title,
      notes: finalNotes,
      status: params.status ?? 'needsAction',
      ...(normalizedDue ? { due: normalizedDue } : {}),
    };

    const res = await this.client.execute<BridgeTasksCreatePayload, GoogleTask>('tasks.create', {
      tasklistId: params.tasklistId,
      task: taskPayload,
    });

    if (!res.ok || res.statusCode !== 200) {
      throw new Error(
        `Google Tasks bridge POST failed with HTTP ${res.statusCode}: ${res.error?.message ?? 'Unknown'}`
      );
    }

    return {
      created: true,
      adopted: false,
      task: res.data!,
    };
  }

  /**
   * Provider State Reconciliation (A9) via bridge:
   * Skips update if state is identical; otherwise updates preserving metadata token.
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

    // If identical, skip update
    if (isTitleIdentical && isStatusIdentical && isDueIdentical && isNotesIdentical) {
      return {
        updated: false,
        task: existing,
      };
    }

    const patchPayload: BridgeTasksUpdatePayload['task'] = {
      title: targetTitle,
      status: targetStatus,
      notes: targetNotes,
    };
    if (targetDue !== undefined) {
      patchPayload.due = targetDue;
    }

    const res = await this.client.execute<BridgeTasksUpdatePayload, GoogleTask>('tasks.update', {
      tasklistId: params.tasklistId,
      taskId: params.taskId,
      task: patchPayload,
    });

    if (!res.ok || res.statusCode !== 200) {
      throw new Error(
        `Google Tasks bridge PATCH failed with HTTP ${res.statusCode}: ${res.error?.message ?? 'Unknown'}`
      );
    }

    return {
      updated: true,
      task: res.data!,
    };
  }
}
