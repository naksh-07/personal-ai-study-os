import {
  IGoogleTokenProvider,
  GoogleTokenProviderConfig,
  ProviderRetryableError,
} from './types';

/**
 * Google OAuth Token Refresh Provider.
 * Implements token retrieval with in-memory caching, buffer-based expiration,
 * mutex-based in-flight request deduplication, and classified error handling.
 */
export class GoogleTokenProvider implements IGoogleTokenProvider {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly refreshToken: string;
  private readonly staticAccessToken?: string;
  private readonly tokenEndpoint: string;
  private readonly fetchFn: typeof fetch;
  private readonly expiryBufferSeconds: number;

  private cachedToken: string | null = null;
  private cachedExpiresAtMs: number = 0;
  private inFlightRefresh: Promise<string> | null = null;

  constructor(config: GoogleTokenProviderConfig) {
    this.clientId = config.clientId ?? '';
    this.clientSecret = config.clientSecret ?? '';
    this.refreshToken = config.refreshToken ?? '';
    this.staticAccessToken = config.staticAccessToken;
    this.tokenEndpoint = config.tokenEndpoint ?? 'https://oauth2.googleapis.com/token';
    this.fetchFn = config.fetchFn ?? fetch.bind(globalThis);
    this.expiryBufferSeconds = config.expiryBufferSeconds ?? 300;
  }

  /**
   * Retrieves an access token.
   * - If staticAccessToken and no refreshToken, returns staticAccessToken.
   * - If cached and unexpired (considering expiryBufferSeconds), returns cached token.
   * - Deduplicates concurrent calls via in-flight refresh promise.
   */
  async getAccessToken(): Promise<string> {
    // If staticAccessToken and no refreshToken, return staticAccessToken (for tests/dev)
    if (this.staticAccessToken && !this.refreshToken) {
      return this.staticAccessToken;
    }

    // In-memory cache: if cachedToken && Date.now() < cachedExpiresAtMs, return cachedToken
    if (this.cachedToken && Date.now() < this.cachedExpiresAtMs) {
      return this.cachedToken;
    }

    // Mutex / inFlightRefresh promise deduplication: prevent concurrent refresh stampedes
    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
    }

    this.inFlightRefresh = this.refreshAccessToken().finally(() => {
      this.inFlightRefresh = null;
    });

    return this.inFlightRefresh;
  }

  /**
   * Clears cached token and expiration timestamp.
   */
  invalidate(): void {
    this.cachedToken = null;
    this.cachedExpiresAtMs = 0;
  }

  private async refreshAccessToken(): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
      grant_type: 'refresh_token',
    });

    let res: Response;
    try {
      res = await this.fetchFn(this.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
    } catch (netErr: any) {
      throw new ProviderRetryableError(
        `Google OAuth transient error: ${netErr?.message ?? 'Network error'}`,
        { cause: netErr }
      );
    }

    // Transient errors: 429 Too Many Requests, 5xx Server Errors
    if (res.status === 429 || res.status >= 500) {
      const errorText = await res.text().catch(() => '');
      throw new ProviderRetryableError(
        `Google OAuth transient error: HTTP ${res.status}${errorText ? ` - ${errorText}` : ''}`,
        { status: res.status }
      );
    }

    let data: any;
    try {
      data = await res.json();
    } catch (jsonErr) {
      if (!res.ok) {
        this.invalidate();
        throw new Error(
          `PERMANENT_ERROR: Google OAuth refresh failed with HTTP ${res.status}`
        );
      }
      throw new ProviderRetryableError(
        `Google OAuth transient error: Failed to parse response JSON`,
        { cause: jsonErr }
      );
    }

    // Error classification:
    // 400, 401, 'invalid_grant', 'invalid_client' -> Permanent error (throw Error('PERMANENT_ERROR: ...') and invalidate cache)
    const isPermanent =
      res.status === 400 ||
      res.status === 401 ||
      data?.error === 'invalid_grant' ||
      data?.error === 'invalid_client';

    if (isPermanent) {
      this.invalidate();
      const errCode = data?.error ?? `HTTP_${res.status}`;
      const errDesc = data?.error_description ? `: ${data.error_description}` : '';
      throw new Error(`PERMANENT_ERROR: Google OAuth refresh failed (${errCode}${errDesc})`);
    }

    if (!res.ok || data?.error) {
      const errCode = data?.error ?? `HTTP_${res.status}`;
      const errDesc = data?.error_description ? `: ${data.error_description}` : '';
      throw new ProviderRetryableError(
        `Google OAuth transient error: ${errCode}${errDesc}`,
        { status: res.status }
      );
    }

    if (!data?.access_token) {
      this.invalidate();
      throw new Error('PERMANENT_ERROR: Google OAuth response missing access_token');
    }

    const expiresInSeconds = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    const lifetimeSeconds = Math.max(0, expiresInSeconds - this.expiryBufferSeconds);

    const accessToken: string = data.access_token;
    this.cachedToken = accessToken;
    this.cachedExpiresAtMs = Date.now() + lifetimeSeconds * 1000;

    return accessToken;
  }
}
