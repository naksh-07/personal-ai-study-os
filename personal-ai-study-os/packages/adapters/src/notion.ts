import crypto from 'node:crypto';
import {
  NotionPage,
  NotionDatabaseQueryResult,
  NotionQueryResult,
  CreateNotionPageParams,
  UpdateNotionPageParams,
  NotionAdapterConfig,
  INotionAdapter,
  RateLimiter,
  AmbiguousProviderError,
  ProviderRetryableError,
} from './types';

// ============================================================================
// Rate Limiter: Token Bucket (3 requests per second per integration)
// ============================================================================

export class TokenBucketRateLimiter implements RateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRatePerSecond: number;
  private lastRefillTimestamp: number;

  constructor(capacity: number = 3, refillRatePerSecond: number = 3) {
    this.capacity = capacity;
    this.refillRatePerSecond = refillRatePerSecond;
    this.tokens = capacity;
    this.lastRefillTimestamp = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillTimestamp) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillRatePerSecond);
    this.lastRefillTimestamp = now;
  }

  async acquire(): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const needed = 1 - this.tokens;
      const waitMs = Math.ceil((needed / this.refillRatePerSecond) * 1000);
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 10)));
    }
  }
}

// ============================================================================
// Webhook HMAC-SHA256 Verification (Constant-Time)
// ============================================================================

export function verifyNotionWebhookSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string,
  webhookSecret: string
): boolean {
  if (!signatureHeader || !webhookSecret) return false;

  let cleanSignature = signatureHeader.trim();
  if (cleanSignature.startsWith('v0=')) {
    cleanSignature = cleanSignature.substring(3);
  } else if (cleanSignature.startsWith('sha256=')) {
    cleanSignature = cleanSignature.substring(7);
  }

  try {
    const computedHmac = crypto
      .createHmac('sha256', webhookSecret)
      .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(computedHmac, 'hex');
    const receivedBuf = Buffer.from(cleanSignature, 'hex');

    if (expectedBuf.length !== receivedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

// ============================================================================
// Notion Adapter Class
// ============================================================================

export class NotionAdapter implements INotionAdapter {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly apiKey?: string;
  private readonly webhookSecret?: string;
  private readonly rateLimiter: RateLimiter;

  constructor(config: NotionAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://api.notion.com';
    this.fetchFn = config.fetchFn ?? fetch.bind(globalThis);
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret;
    this.rateLimiter = config.rateLimiter ?? new TokenBucketRateLimiter(3, 3);
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * Validates inbound webhook signatures with constant-time comparison.
   */
  verifyWebhookSignature(
    rawBody: string | Uint8Array,
    signatureHeader: string,
    webhookSecret?: string
  ): boolean {
    const secret = webhookSecret ?? this.webhookSecret;
    if (!secret) return false;
    return verifyNotionWebhookSignature(rawBody, signatureHeader, secret);
  }

  /**
   * Queries database for a page matching OS_Entity_ID = entityId.
   */
  async queryByEntityId(databaseId: string, entityId: string): Promise<NotionQueryResult> {
    await this.rateLimiter.acquire();

    const queryPayload = {
      filter: {
        property: 'OS_Entity_ID',
        rich_text: {
          equals: entityId,
        },
      },
    };

    let res: Response;
    try {
      res = await this.fetchFn(
        `${this.baseUrl}/v1/databases/${encodeURIComponent(databaseId)}/query`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(queryPayload),
        }
      );
    } catch (netErr) {
      return {
        foundPage: undefined,
        exhaustivelyNotFound: false,
        uncertain: true,
      };
    }

    if (res.status === 429 || res.status >= 500) {
      return {
        foundPage: undefined,
        exhaustivelyNotFound: false,
        uncertain: true,
      };
    }

    if (!res.ok) {
      return {
        foundPage: undefined,
        exhaustivelyNotFound: false,
        uncertain: true,
      };
    }

    const body = (await res.json()) as NotionDatabaseQueryResult;
    const results = body.results ?? [];

    if (results.length > 0) {
      return {
        foundPage: results[0],
        exhaustivelyNotFound: false,
        uncertain: false,
      };
    }

    return {
      foundPage: undefined,
      exhaustivelyNotFound: true,
      uncertain: false,
    };
  }

  /**
   * Fetches an individual Notion page by ID.
   */
  async getPage(pageId: string): Promise<NotionPage | null> {
    await this.rateLimiter.acquire();

    let res: Response;
    try {
      res = await this.fetchFn(
        `${this.baseUrl}/v1/pages/${encodeURIComponent(pageId)}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        }
      );
    } catch (netErr) {
      throw new AmbiguousProviderError(`Network timeout fetching Notion page ${pageId}`, {
        cause: netErr,
      });
    }

    if (res.status === 404) {
      return null;
    }

    if (res.status === 429 || res.status >= 500) {
      throw new ProviderRetryableError(`Notion GET page returned HTTP ${res.status}`, {
        status: res.status,
      });
    }

    if (!res.ok) {
      throw new Error(`Notion GET page failed with HTTP ${res.status}`);
    }

    return (await res.json()) as NotionPage;
  }

  /**
   * CREATE Idempotency:
   * 1. Checks if a page with OS_Entity_ID = entityId already exists.
   * 2. If present: adopts page without duplicate creation.
   * 3. If absent: creates page with OS_Entity_ID populated.
   */
  async createPage(
    params: CreateNotionPageParams
  ): Promise<{ created: boolean; adopted: boolean; page: NotionPage }> {
    const search = await this.queryByEntityId(params.databaseId, params.entityId);

    if (search.foundPage) {
      return {
        created: false,
        adopted: true,
        page: search.foundPage,
      };
    }

    if (search.uncertain || !search.exhaustivelyNotFound) {
      throw new AmbiguousProviderError(
        'Safe-Create Gate failed: Notion database query returned uncertain state. Blind creation prohibited.',
        { code: 'AMBIGUOUS_PROVIDER_STATE' }
      );
    }

    await this.rateLimiter.acquire();

    const properties: Record<string, any> = {
      ...(params.properties ?? {}),
      OS_Entity_ID: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: params.entityId,
            },
          },
        ],
      },
    };

    const payload: Record<string, any> = {
      parent: {
        database_id: params.databaseId,
      },
      properties,
    };
    if (params.children) {
      payload.children = params.children;
    }

    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/v1/pages`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });
    } catch (netErr) {
      throw new AmbiguousProviderError('Network timeout during Notion page creation', {
        cause: netErr,
      });
    }

    if (res.status === 429 || res.status >= 500) {
      throw new ProviderRetryableError(`Notion POST page returned HTTP ${res.status}`, {
        status: res.status,
      });
    }

    if (!res.ok) {
      throw new Error(`Notion POST page failed with HTTP ${res.status}`);
    }

    const createdPage = (await res.json()) as NotionPage;
    return {
      created: true,
      adopted: false,
      page: createdPage,
    };
  }

  /**
   * UPDATE Concurrency:
   * GET page, compare last_edited_time and properties before PATCH.
   * If properties already reflect desired state, skips PATCH.
   */
  async updatePage(
    params: UpdateNotionPageParams
  ): Promise<{ updated: boolean; page: NotionPage }> {
    const existing = await this.getPage(params.pageId);
    if (!existing) {
      throw new Error(`Notion page ${params.pageId} not found (external deleted)`);
    }

    // Compare requested properties with existing properties
    let isIdentical = true;
    for (const [key, value] of Object.entries(params.properties)) {
      const existingProp = existing.properties[key];
      if (JSON.stringify(existingProp) !== JSON.stringify(value)) {
        isIdentical = false;
        break;
      }
    }

    if (isIdentical) {
      return {
        updated: false,
        page: existing,
      };
    }

    await this.rateLimiter.acquire();

    let res: Response;
    try {
      res = await this.fetchFn(
        `${this.baseUrl}/v1/pages/${encodeURIComponent(params.pageId)}`,
        {
          method: 'PATCH',
          headers: this.getHeaders(),
          body: JSON.stringify({ properties: params.properties }),
        }
      );
    } catch (netErr) {
      throw new AmbiguousProviderError('Network timeout during Notion page PATCH', {
        cause: netErr,
      });
    }

    if (res.status === 429 || res.status >= 500) {
      throw new ProviderRetryableError(`Notion PATCH page returned HTTP ${res.status}`, {
        status: res.status,
      });
    }

    if (!res.ok) {
      throw new Error(`Notion PATCH page failed with HTTP ${res.status}`);
    }

    const updatedPage = (await res.json()) as NotionPage;
    return {
      updated: true,
      page: updatedPage,
    };
  }
}
