import { generateDeterministicCalendarEventId } from '@personal-os/domain';
import {
  GoogleCalendarEvent,
  CreateCalendarEventParams,
  UpdateCalendarEventParams,
  CalendarGetResult,
  IGoogleCalendarAdapter,
  AmbiguousProviderError,
  ProviderRetryableError,
} from '../types';
import { GoogleBridgeClient } from './client';
import {
  BridgeCalendarCreatePayload,
  BridgeCalendarGetPayload,
  BridgeCalendarUpdatePayload,
} from './types';

export class GoogleCalendarBridgeAdapter implements IGoogleCalendarAdapter {
  private readonly client: GoogleBridgeClient;

  constructor(client: GoogleBridgeClient) {
    this.client = client;
  }

  /**
   * Fetches an individual calendar event by ID via the bridge.
   */
  async getEvent(calendarId: string, eventId: string): Promise<CalendarGetResult> {
    try {
      const res = await this.client.execute<BridgeCalendarGetPayload, GoogleCalendarEvent>(
        'calendar.get',
        { calendarId, eventId }
      );

      if (res.statusCode === 404) {
        return { status: 404 };
      }

      if (res.statusCode === 200 && res.data) {
        return {
          status: 200,
          data: res.data,
        };
      }

      return {
        status: res.statusCode,
        error: res.error?.message ?? `Bridge returned HTTP ${res.statusCode}`,
      };
    } catch (err: any) {
      if (err instanceof ProviderRetryableError || err instanceof AmbiguousProviderError) {
        throw err;
      }
      return {
        status: 503,
        error: err?.message ?? 'Failed to connect to Google Calendar bridge',
      };
    }
  }

  /**
   * CREATE Idempotency via deterministic event ID:
   * Passes client-assigned base32hex ID to Google Calendar.
   * On HTTP 409 Conflict, fetches existing event and adopts it.
   */
  async createEvent(
    params: CreateCalendarEventParams
  ): Promise<{ created: boolean; adopted: boolean; event: GoogleCalendarEvent }> {
    const deterministicId = generateDeterministicCalendarEventId(params.idempotencyKey);

    const payload: BridgeCalendarCreatePayload = {
      calendarId: params.calendarId,
      event: {
        id: deterministicId,
        summary: params.summary,
        description: params.description,
        start: params.start,
        end: params.end,
      },
    };

    const res = await this.client.execute<BridgeCalendarCreatePayload, GoogleCalendarEvent>(
      'calendar.create',
      payload
    );

    // HTTP 409 Conflict: identifier already exists -> adopt existing event
    if (res.statusCode === 409) {
      const existing = await this.getEvent(params.calendarId, deterministicId);
      if (existing.status === 200 && existing.data) {
        return {
          created: false,
          adopted: true,
          event: existing.data,
        };
      }
      throw new AmbiguousProviderError(
        `Google Calendar bridge returned 409 Conflict, but lookup of deterministic ID ${deterministicId} returned HTTP ${existing.status}`,
        { status: existing.status }
      );
    }

    if (!res.ok || res.statusCode !== 200) {
      throw new Error(
        `Google Calendar bridge event create failed with HTTP ${res.statusCode}: ${res.error?.message ?? 'Unknown'}`
      );
    }

    return {
      created: true,
      adopted: false,
      event: res.data!,
    };
  }

  /**
   * UPDATE Concurrency & Lost-Ack Recovery:
   * 1. Pre-update GET check: if remote state already matches target mutation, skip update.
   * 2. Optimistic concurrency with ETag.
   * 3. On HTTP 412 Precondition Failed: re-fetch latest event, reconcile time block, and retry.
   */
  async updateEvent(
    params: UpdateCalendarEventParams
  ): Promise<{ updated: boolean; reconciled: boolean; event: GoogleCalendarEvent }> {
    // Step 1: Pre-update GET check for lost-ack recovery
    const existingResult = await this.getEvent(params.calendarId, params.eventId);
    if (existingResult.status === 404) {
      throw new Error(`Google Calendar event ${params.eventId} not found (external deleted)`);
    }
    if (existingResult.status !== 200 || !existingResult.data) {
      throw new ProviderRetryableError(
        `Failed to fetch current event before bridge update: HTTP ${existingResult.status}`,
        { status: existingResult.status }
      );
    }

    const existing = existingResult.data;

    // Check if remote state already matches target mutation
    const isSummaryEqual = params.summary === undefined || params.summary === existing.summary;
    const isDescriptionEqual =
      params.description === undefined || params.description === existing.description;
    const isStartEqual =
      params.start === undefined ||
      (params.start.dateTime === existing.start?.dateTime &&
        params.start.date === existing.start?.date &&
        params.start.timeZone === existing.start?.timeZone);
    const isEndEqual =
      params.end === undefined ||
      (params.end.dateTime === existing.end?.dateTime &&
        params.end.date === existing.end?.date &&
        params.end.timeZone === existing.end?.timeZone);

    if (isSummaryEqual && isDescriptionEqual && isStartEqual && isEndEqual) {
      return {
        updated: false,
        reconciled: false,
        event: existing,
      };
    }

    // Step 2: Attempt update with ETag
    const targetPayload: BridgeCalendarUpdatePayload['event'] = {};
    if (params.summary !== undefined) targetPayload.summary = params.summary;
    if (params.description !== undefined) targetPayload.description = params.description;
    if (params.start !== undefined) targetPayload.start = params.start;
    if (params.end !== undefined) targetPayload.end = params.end;

    const etagToUse = params.etag ?? existing.etag;
    const res = await this.client.execute<BridgeCalendarUpdatePayload, GoogleCalendarEvent>(
      'calendar.update',
      {
        calendarId: params.calendarId,
        eventId: params.eventId,
        etag: etagToUse,
        event: targetPayload,
      }
    );

    // Step 3: Handle HTTP 412 Precondition Failed (Concurrent Modification)
    if (res.statusCode === 412) {
      const latestResult = await this.getEvent(params.calendarId, params.eventId);
      if (latestResult.status !== 200 || !latestResult.data) {
        throw new ProviderRetryableError(
          `Google Calendar bridge GET after 412 Precondition Failed returned HTTP ${latestResult.status}`,
          { status: latestResult.status }
        );
      }

      const latest = latestResult.data;
      const reconciledPayload: BridgeCalendarUpdatePayload['event'] = {
        summary: params.summary !== undefined ? params.summary : latest.summary,
        description: params.description !== undefined ? params.description : latest.description,
        start: params.start !== undefined ? params.start : latest.start,
        end: params.end !== undefined ? params.end : latest.end,
      };

      const retryRes = await this.client.execute<BridgeCalendarUpdatePayload, GoogleCalendarEvent>(
        'calendar.update',
        {
          calendarId: params.calendarId,
          eventId: params.eventId,
          etag: latest.etag,
          event: reconciledPayload,
        }
      );

      if (!retryRes.ok || retryRes.statusCode !== 200) {
        throw new Error(
          `Google Calendar bridge retry update after 412 failed with HTTP ${retryRes.statusCode}: ${retryRes.error?.message ?? 'Unknown'}`
        );
      }

      return {
        updated: true,
        reconciled: true,
        event: retryRes.data!,
      };
    }

    if (!res.ok || res.statusCode !== 200) {
      throw new Error(
        `Google Calendar bridge event update failed with HTTP ${res.statusCode}: ${res.error?.message ?? 'Unknown'}`
      );
    }

    return {
      updated: true,
      reconciled: false,
      event: res.data!,
    };
  }
}
