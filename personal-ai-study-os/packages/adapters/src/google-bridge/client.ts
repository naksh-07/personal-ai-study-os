import { AmbiguousProviderError, ProviderRetryableError } from '../types';
import {
  BridgeOperation,
  BridgeRequestEnvelope,
  BridgeResponseEnvelope,
  GoogleBridgeClientConfig,
} from './types';
import { computeHmacSignature } from './canonical';

export class GoogleBridgeClient {
  private readonly bridgeUrl: string;
  private readonly bridgeSecret: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: GoogleBridgeClientConfig) {
    if (!config.bridgeUrl) {
      throw new Error('CONFIG_ERROR: GoogleBridgeClient requires bridgeUrl');
    }
    if (!config.bridgeSecret) {
      throw new Error('CONFIG_ERROR: GoogleBridgeClient requires bridgeSecret');
    }
    this.bridgeUrl = config.bridgeUrl;
    this.bridgeSecret = config.bridgeSecret;
    this.fetchFn = config.fetchFn ?? fetch.bind(globalThis);
    this.timeoutMs = config.timeoutMs ?? 30000;
  }

  /**
   * Generates a unique request ID.
   */
  private generateRequestId(): string {
    const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `req_bridge_${Date.now()}_${randomHex}`;
  }

  /**
   * Executes an operation via the Google Apps Script Web App bridge.
   * Handles canonical HMAC signing, redirects, timeouts, and status normalization.
   */
  async execute<TPayload extends Record<string, any>, TResult = any>(
    operation: BridgeOperation,
    payload: TPayload,
    customRequestId?: string
  ): Promise<BridgeResponseEnvelope<TResult>> {
    const timestamp = Math.floor(Date.now() / 1000);
    const requestId = customRequestId || this.generateRequestId();

    const signature = await computeHmacSignature(
      this.bridgeSecret,
      timestamp,
      requestId,
      operation,
      payload
    );

    const envelope: BridgeRequestEnvelope<TPayload> = {
      version: '1',
      timestamp,
      request_id: requestId,
      operation,
      payload,
      signature,
    };

    const startTime = Date.now();
    let res: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      res = await this.fetchFn(this.bridgeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(envelope),
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (netErr: any) {
      const isTimeout = netErr?.name === 'AbortError' || controller.signal.aborted;
      const message = isTimeout
        ? `Timeout after ${this.timeoutMs}ms communicating with Google Apps Script bridge`
        : `Network error connecting to Google Apps Script bridge: ${netErr?.message ?? 'unknown'}`;
      throw new AmbiguousProviderError(message, { cause: netErr });
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startTime;

    // Handle outer HTTP transport errors (e.g. 502/503 from Google edge before Apps Script executes)
    if (!res.ok && res.status !== 200) {
      if (res.status === 401 || res.status === 403) {
        throw new ProviderRetryableError(
          `Google Apps Script bridge outer HTTP rejected (HTTP ${res.status})`,
          { status: res.status }
        );
      }
      if (res.status === 429 || res.status >= 500) {
        throw new ProviderRetryableError(
          `Google Apps Script bridge outer gateway failure (HTTP ${res.status})`,
          { status: res.status }
        );
      }
      throw new Error(`Google Apps Script bridge outer HTTP error: HTTP ${res.status}`);
    }

    let responseData: BridgeResponseEnvelope<TResult>;
    try {
      responseData = (await res.json()) as BridgeResponseEnvelope<TResult>;
    } catch (parseErr: any) {
      throw new AmbiguousProviderError(
        `Failed to parse Google Apps Script bridge JSON response (latency: ${latencyMs}ms)`,
        { cause: parseErr }
      );
    }

    // Validate expected envelope structure
    if (typeof responseData.statusCode !== 'number') {
      throw new AmbiguousProviderError(
        'Malformed Google Apps Script bridge response: missing statusCode in envelope'
      );
    }

    const statusCode = responseData.statusCode;

    // Map application-level status codes
    if (statusCode === 401) {
      throw new ProviderRetryableError(
        `Google Apps Script bridge authentication failed (HTTP 401): ${responseData.error?.message ?? 'Unauthorized'}`
      );
    }

    if (statusCode === 429) {
      throw new ProviderRetryableError(
        `Google Apps Script bridge upstream rate limited (HTTP 429): ${responseData.error?.message ?? 'Too Many Requests'}`,
        { status: 429 }
      );
    }

    if (statusCode >= 500) {
      throw new ProviderRetryableError(
        `Google Apps Script bridge upstream failure (HTTP ${statusCode}): ${responseData.error?.message ?? 'Server Error'}`,
        { status: statusCode }
      );
    }

    return responseData;
  }
}
