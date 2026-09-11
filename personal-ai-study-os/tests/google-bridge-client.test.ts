import { describe, it, expect, vi } from 'vitest';
import {
  canonicalJson,
  buildCanonicalStringToSign,
  computeHmacSignature,
  verifyHmacSignature,
  GoogleBridgeClient,
  AmbiguousProviderError,
  ProviderRetryableError,
} from '@personal-os/adapters';

describe('Google Apps Script Bridge: Client & Canonical Signing Suite', () => {
  const SECRET = 'test_shared_secret_1234567890abcdef';

  // ==========================================================================
  // 1. Canonical JSON Serialization & Signing
  // ==========================================================================
  describe('Canonical JSON & HMAC-SHA256 Signing', () => {
    it('deterministically sorts object keys regardless of original insertion order', () => {
      const objA = { z: 1, a: 2, m: { y: 'bar', b: 'foo' } };
      const objB = { a: 2, m: { b: 'foo', y: 'bar' }, z: 1 };

      const canonA = canonicalJson(objA);
      const canonB = canonicalJson(objB);

      expect(canonA).toBe(canonB);
      expect(canonA).toBe('{"a":2,"m":{"b":"foo","y":"bar"},"z":1}');
    });

    it('filters out undefined properties and handles arrays and primitives', () => {
      const obj = {
        title: 'Study Session',
        extra: undefined,
        tags: ['math', 'physics'],
        count: 42,
        active: true,
        nested: null,
      };

      const canon = canonicalJson(obj);
      expect(canon).toBe(
        '{"active":true,"count":42,"nested":null,"tags":["math","physics"],"title":"Study Session"}'
      );
    });

    it('builds canonical string to sign using standard format', () => {
      const timestamp = 1726056000;
      const requestId = 'req_test_01';
      const operation = 'calendar.create';
      const payload = { calendarId: 'primary', summary: 'Math 101' };

      const stringToSign = buildCanonicalStringToSign(timestamp, requestId, operation, payload);
      expect(stringToSign).toBe(
        'v1:1726056000:req_test_01:calendar.create:{"calendarId":"primary","summary":"Math 101"}'
      );
    });

    it('computes and verifies valid HMAC-SHA256 signature', async () => {
      const timestamp = 1726056000;
      const requestId = 'req_test_01';
      const operation = 'calendar.create';
      const payload = { calendarId: 'primary', summary: 'Math 101' };

      const signature = await computeHmacSignature(SECRET, timestamp, requestId, operation, payload);
      expect(typeof signature).toBe('string');
      expect(signature.length).toBe(64); // 256 bits = 64 hex characters

      const isValid = await verifyHmacSignature(
        SECRET,
        timestamp,
        requestId,
        operation,
        payload,
        signature
      );
      expect(isValid).toBe(true);
    });

    it('rejects tampered signature, payload, timestamp, or operation', async () => {
      const timestamp = 1726056000;
      const requestId = 'req_test_01';
      const operation = 'calendar.create';
      const payload = { calendarId: 'primary', summary: 'Math 101' };

      const signature = await computeHmacSignature(SECRET, timestamp, requestId, operation, payload);

      // Tampered payload
      const tamperedPayload = { calendarId: 'primary', summary: 'Hacked Title' };
      const isValidPayload = await verifyHmacSignature(
        SECRET,
        timestamp,
        requestId,
        operation,
        tamperedPayload,
        signature
      );
      expect(isValidPayload).toBe(false);

      // Tampered timestamp
      const isValidTimestamp = await verifyHmacSignature(
        SECRET,
        timestamp + 10,
        requestId,
        operation,
        payload,
        signature
      );
      expect(isValidTimestamp).toBe(false);

      // Tampered operation
      const isValidOp = await verifyHmacSignature(
        SECRET,
        timestamp,
        requestId,
        'calendar.delete',
        payload,
        signature
      );
      expect(isValidOp).toBe(false);

      // Tampered signature hex
      const corruptedSig = signature.substring(0, 63) + (signature[63] === 'a' ? 'b' : 'a');
      const isValidSig = await verifyHmacSignature(
        SECRET,
        timestamp,
        requestId,
        operation,
        payload,
        corruptedSig
      );
      expect(isValidSig).toBe(false);
    });
  });

  // ==========================================================================
  // 2. GoogleBridgeClient Transport & Error Normalization
  // ==========================================================================
  describe('GoogleBridgeClient Transport', () => {
    it('throws configuration error when URL or secret is missing', () => {
      expect(() => new GoogleBridgeClient({ bridgeUrl: '', bridgeSecret: 'sec' })).toThrow(
        /requires bridgeUrl/
      );
      expect(
        () => new GoogleBridgeClient({ bridgeUrl: 'https://script.google.com', bridgeSecret: '' })
      ).toThrow(/requires bridgeSecret/);
    });

    it('sends POST request with canonical envelope and parses 200 OK success', async () => {
      let capturedUrl = '';
      let capturedBody: any = null;

      const mockFetch = vi.fn(async (url: string, init: any) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            ok: true,
            statusCode: 200,
            data: { id: 'created_123', summary: 'Session' },
            request_id: capturedBody.request_id,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const client = new GoogleBridgeClient({
        bridgeUrl: 'https://script.google.com/macros/s/test/exec',
        bridgeSecret: SECRET,
        fetchFn: mockFetch as any,
      });

      const res = await client.execute('calendar.create', {
        calendarId: 'primary',
        summary: 'Session',
      });

      expect(capturedUrl).toBe('https://script.google.com/macros/s/test/exec');
      expect(capturedBody.version).toBe('1');
      expect(capturedBody.operation).toBe('calendar.create');
      expect(capturedBody.signature).toBeDefined();
      expect(res.ok).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(res.data).toEqual({ id: 'created_123', summary: 'Session' });
    });

    it('translates application-level 401 into ProviderRetryableError', async () => {
      const mockFetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            ok: false,
            statusCode: 401,
            error: { code: 'INVALID_SIGNATURE', message: 'Signature rejected' },
            request_id: 'req_123',
          }),
          { status: 200 }
        );
      });

      const client = new GoogleBridgeClient({
        bridgeUrl: 'https://script.google.com/macros/s/test/exec',
        bridgeSecret: SECRET,
        fetchFn: mockFetch as any,
      });

      await expect(client.execute('calendar.get', { calendarId: 'primary', eventId: 'evt' })).rejects.toThrow(
        ProviderRetryableError
      );
    });

    it('surfaces application-level 404, 409, and 412 directly to adapter', async () => {
      const mockFetch409 = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            ok: true,
            statusCode: 409,
            data: { id: 'existing_event' },
            request_id: 'req_409',
          }),
          { status: 200 }
        );
      });

      const client409 = new GoogleBridgeClient({
        bridgeUrl: 'https://script.google.com/macros/s/test/exec',
        bridgeSecret: SECRET,
        fetchFn: mockFetch409 as any,
      });

      const res409 = await client409.execute('calendar.create', { calendarId: 'primary', event: { id: 'existing_event' } });
      expect(res409.statusCode).toBe(409);
      expect(res409.data).toEqual({ id: 'existing_event' });

      const mockFetch412 = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            ok: false,
            statusCode: 412,
            error: { code: 'PRECONDITION_FAILED', message: 'ETag mismatch' },
            request_id: 'req_412',
          }),
          { status: 200 }
        );
      });

      const client412 = new GoogleBridgeClient({
        bridgeUrl: 'https://script.google.com/macros/s/test/exec',
        bridgeSecret: SECRET,
        fetchFn: mockFetch412 as any,
      });

      const res412 = await client412.execute('calendar.update', { calendarId: 'primary', eventId: 'evt' });
      expect(res412.statusCode).toBe(412);
    });

    it('translates application-level 429 and 5xx into ProviderRetryableError', async () => {
      const mockFetch429 = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            ok: false,
            statusCode: 429,
            error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit' },
            request_id: 'req_429',
          }),
          { status: 200 }
        );
      });

      const client429 = new GoogleBridgeClient({
        bridgeUrl: 'https://script.google.com/macros/s/test/exec',
        bridgeSecret: SECRET,
        fetchFn: mockFetch429 as any,
      });

      await expect(client429.execute('tasks.list', { tasklistId: '@default' })).rejects.toThrow(
        ProviderRetryableError
      );

      const mockFetch500 = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            ok: false,
            statusCode: 500,
            error: { code: 'INTERNAL_ERROR', message: 'GAS internal failure' },
            request_id: 'req_500',
          }),
          { status: 200 }
        );
      });

      const client500 = new GoogleBridgeClient({
        bridgeUrl: 'https://script.google.com/macros/s/test/exec',
        bridgeSecret: SECRET,
        fetchFn: mockFetch500 as any,
      });

      await expect(client500.execute('tasks.list', { tasklistId: '@default' })).rejects.toThrow(
        ProviderRetryableError
      );
    });

    it('throws AmbiguousProviderError on network timeout or abort', async () => {
      const mockFetchTimeout = vi.fn(async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      });

      const clientTimeout = new GoogleBridgeClient({
        bridgeUrl: 'https://script.google.com/macros/s/test/exec',
        bridgeSecret: SECRET,
        timeoutMs: 100,
        fetchFn: mockFetchTimeout as any,
      });

      await expect(
        clientTimeout.execute('calendar.create', { calendarId: 'primary' })
      ).rejects.toThrow(AmbiguousProviderError);
    });

    it('throws ProviderRetryableError on outer gateway 502/503 HTTP responses', async () => {
      const mockFetch502 = vi.fn(async () => {
        return new Response('Bad Gateway', { status: 502 });
      });

      const client502 = new GoogleBridgeClient({
        bridgeUrl: 'https://script.google.com/macros/s/test/exec',
        bridgeSecret: SECRET,
        fetchFn: mockFetch502 as any,
      });

      await expect(client502.execute('calendar.get', { calendarId: 'primary', eventId: 'evt' })).rejects.toThrow(
        ProviderRetryableError
      );
    });
  });
});
