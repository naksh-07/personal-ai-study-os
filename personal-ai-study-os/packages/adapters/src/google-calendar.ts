import { generateDeterministicCalendarEventId } from '@personal-os/domain';
import {
  GoogleCalendarEvent,
  CreateCalendarEventParams,
  UpdateCalendarEventParams,
  CalendarGetResult,
  GoogleCalendarAdapterConfig,
  IGoogleCalendarAdapter,
  IGoogleTokenProvider,
  AmbiguousProviderError,
  ProviderRetryableError,
} from './types';

// ============================================================================
// Google Calendar Adapter Class (Strict WHEN Management)
// ============================================================================

export class GoogleCalendarAdapter implements IGoogleCalendarAdapter {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly accessToken?: string;
  private readonly tokenProvider?: IGoogleTokenProvider;

  constructor(config: GoogleCalendarAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://www.googleapis.com/calendar/v3';
    this.fetchFn = config.fetchFn ?? fetch.bind(globalThis);
    this.accessToken = config.accessToken;
    this.tokenProvider = config.tokenProvider;
  }

  private async getHeaders(etag?: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.tokenProvider) {
      const t = await this.tokenProvider.getAccessToken();
      headers['Authorization'] = `Bearer ${t}`;
    } else if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    if (etag) {
      // Ensure ETag is enclosed in quotes per HTTP specification
      const formattedEtag = etag.startsWith('"') && etag.endsWith('"') ? etag : `"${etag}"`;
      headers['If-Match'] = formattedEtag;
    }
    return headers;
  }

  /**
   * Fetches an individual calendar event by ID.
   * Returns status code and data for unified reconciliation.
   */
  async getEvent(calendarId: string, eventId: string): Promise<CalendarGetResult> {
    let res: Response;
    try {
      res = await this.fetchFn(
        `${this.baseUrl}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        {
          method: 'GET',
          headers: await this.getHeaders(),
        }
      );
    } catch (netErr: any) {
      return {
        status: 503,
        error: netErr?.message ?? 'Network timeout connecting to Google Calendar',
      };
    }

    if (res.status === 401 && this.tokenProvider) {
      this.tokenProvider.invalidate();
      throw new ProviderRetryableError('Google Calendar API token expired or rejected (HTTP 401)');
    }

    if (res.status === 404) {
      return { status: 404 };
    }

    if (res.status === 429 || res.status >= 500) {
      return {
        status: res.status,
        error: `Google Calendar returned HTTP ${res.status}`,
      };
    }

    if (!res.ok) {
      return {
        status: res.status,
        error: `Google Calendar GET failed with HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as GoogleCalendarEvent;
    return {
      status: 200,
      data,
    };
  }

  /**
   * CREATE Idempotency:
   * Uses deterministic base32hex ID derived from sha256(idempotencyKey).
   * On HTTP 409 Conflict ("identifier already exists"), fetches event by deterministic ID,
   * verifies payload, adopts and resolves.
   */
  async createEvent(
    params: CreateCalendarEventParams
  ): Promise<{ created: boolean; adopted: boolean; event: GoogleCalendarEvent }> {
    const deterministicId = generateDeterministicCalendarEventId(params.idempotencyKey);

    const payload = {
      id: deterministicId,
      summary: params.summary,
      description: params.description,
      start: params.start,
      end: params.end,
    };

    let res: Response;
    try {
      res = await this.fetchFn(
        `${this.baseUrl}/calendars/${encodeURIComponent(params.calendarId)}/events`,
        {
          method: 'POST',
          headers: await this.getHeaders(),
          body: JSON.stringify(payload),
        }
      );
    } catch (netErr) {
      throw new AmbiguousProviderError('Network timeout during Google Calendar event creation', {
        cause: netErr,
      });
    }

    if (res.status === 401 && this.tokenProvider) {
      this.tokenProvider.invalidate();
      throw new ProviderRetryableError('Google Calendar API token expired or rejected (HTTP 401)');
    }

    // HTTP 409 Conflict: Identifier already exists -> CREATE Idempotency recovery
    if (res.status === 409) {
      const existing = await this.getEvent(params.calendarId, deterministicId);
      if (existing.status === 200 && existing.data) {
        return {
          created: false,
          adopted: true,
          event: existing.data,
        };
      }
      throw new AmbiguousProviderError(
        `Google Calendar returned 409 Conflict, but lookup of deterministic ID ${deterministicId} returned HTTP ${existing.status}`,
        { status: existing.status }
      );
    }

    if (res.status === 429 || res.status >= 500) {
      throw new ProviderRetryableError(`Google Calendar POST returned HTTP ${res.status}`, {
        status: res.status,
      });
    }

    if (!res.ok) {
      throw new Error(`Google Calendar POST failed with HTTP ${res.status}`);
    }

    const createdEvent = (await res.json()) as GoogleCalendarEvent;
    return {
      created: true,
      adopted: false,
      event: createdEvent,
    };
  }

  /**
   * UPDATE Concurrency & Lost-Ack Recovery:
   * 1. Lost-Ack Recovery: Pre-update GET check. If remote start/end/summary match target mutation, skip PATCH.
   * 2. UPDATE Concurrency: Passes ETag in 'If-Match: "<etag>"'.
   * 3. On HTTP 412 Precondition Failed: Re-fetches latest event via GET, reconciles time block, and retries.
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
        `Failed to fetch current event before update: HTTP ${existingResult.status}`,
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

    // Step 2: Attempt PATCH with ETag in If-Match header
    const targetPayload: Record<string, any> = {};
    if (params.summary !== undefined) targetPayload.summary = params.summary;
    if (params.description !== undefined) targetPayload.description = params.description;
    if (params.start !== undefined) targetPayload.start = params.start;
    if (params.end !== undefined) targetPayload.end = params.end;

    const etagToUse = params.etag ?? existing.etag;
    let res: Response;
    try {
      res = await this.fetchFn(
        `${this.baseUrl}/calendars/${encodeURIComponent(params.calendarId)}/events/${encodeURIComponent(params.eventId)}`,
        {
          method: 'PATCH',
          headers: await this.getHeaders(etagToUse),
          body: JSON.stringify(targetPayload),
        }
      );
    } catch (netErr) {
      throw new AmbiguousProviderError('Network timeout during Google Calendar event PATCH', {
        cause: netErr,
      });
    }

    if (res.status === 401 && this.tokenProvider) {
      this.tokenProvider.invalidate();
      throw new ProviderRetryableError('Google Calendar API token expired or rejected (HTTP 401)');
    }

    // Step 3: Handle HTTP 412 Precondition Failed (Concurrent Modification)
    if (res.status === 412) {
      const latestResult = await this.getEvent(params.calendarId, params.eventId);
      if (latestResult.status !== 200 || !latestResult.data) {
        throw new ProviderRetryableError(
          `Google Calendar GET after 412 Precondition Failed returned HTTP ${latestResult.status}`,
          { status: latestResult.status }
        );
      }

      const latest = latestResult.data;

      // Reconcile time block: apply requested mutation over latest event
      const reconciledPayload: Record<string, any> = {
        summary: params.summary !== undefined ? params.summary : latest.summary,
        description: params.description !== undefined ? params.description : latest.description,
        start: params.start !== undefined ? params.start : latest.start,
        end: params.end !== undefined ? params.end : latest.end,
      };

      let retryRes: Response;
      try {
        retryRes = await this.fetchFn(
          `${this.baseUrl}/calendars/${encodeURIComponent(params.calendarId)}/events/${encodeURIComponent(params.eventId)}`,
          {
            method: 'PATCH',
            headers: await this.getHeaders(latest.etag),
            body: JSON.stringify(reconciledPayload),
          }
        );
      } catch (retryErr) {
        throw new AmbiguousProviderError(
          'Network timeout during Google Calendar retry PATCH after 412 reconciliation',
          { cause: retryErr }
        );
      }

      if (retryRes.status === 401 && this.tokenProvider) {
        this.tokenProvider.invalidate();
        throw new ProviderRetryableError('Google Calendar API token expired or rejected (HTTP 401)');
      }

      if (retryRes.status === 429 || retryRes.status >= 500) {
        throw new ProviderRetryableError(
          `Google Calendar retry PATCH returned HTTP ${retryRes.status}`,
          { status: retryRes.status }
        );
      }

      if (!retryRes.ok) {
        throw new Error(`Google Calendar retry PATCH failed with HTTP ${retryRes.status}`);
      }

      const reconciledEvent = (await retryRes.json()) as GoogleCalendarEvent;
      return {
        updated: true,
        reconciled: true,
        event: reconciledEvent,
      };
    }

    if (res.status === 429 || res.status >= 500) {
      throw new ProviderRetryableError(`Google Calendar PATCH returned HTTP ${res.status}`, {
        status: res.status,
      });
    }

    if (!res.ok) {
      throw new Error(`Google Calendar PATCH failed with HTTP ${res.status}`);
    }

    const updatedEvent = (await res.json()) as GoogleCalendarEvent;
    return {
      updated: true,
      reconciled: false,
      event: updatedEvent,
    };
  }
}
