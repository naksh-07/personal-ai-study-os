/**
 * Canonical JSON serializer and HMAC-SHA256 signer/verifier.
 * Ensures deterministic string representation across Node, Cloudflare Workers, and Google Apps Script (V8).
 */

/**
 * Deterministically serializes a value into canonical JSON by sorting object keys alphabetically.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalJson(item));
    return `[${items.join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();

  const pairs = sortedKeys.map((k) => {
    const serializedVal = canonicalJson(obj[k]);
    return `${JSON.stringify(k)}:${serializedVal}`;
  });

  return `{${pairs.join(',')}}`;
}

/**
 * Builds the canonical string representation to be signed.
 * Format: v1:{timestamp}:{request_id}:{operation}:{canonical_payload_json}
 */
export function buildCanonicalStringToSign(
  timestamp: number,
  requestId: string,
  operation: string,
  payload: unknown
): string {
  const payloadStr = canonicalJson(payload);
  return `v1:${timestamp}:${requestId}:${operation}:${payloadStr}`;
}

/**
 * Converts an ArrayBuffer to a lowercase hex string.
 */
export function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Converts a hex string to a Uint8Array.
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Computes an HMAC-SHA256 signature using Web Crypto API.
 */
export async function computeHmacSignature(
  secret: string,
  timestamp: number,
  requestId: string,
  operation: string,
  payload: unknown
): Promise<string> {
  const data = buildCanonicalStringToSign(timestamp, requestId, operation, payload);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return bufferToHex(signatureBuffer);
}

/**
 * Verifies an HMAC-SHA256 signature timing-safely using Web Crypto API.
 */
export async function verifyHmacSignature(
  secret: string,
  timestamp: number,
  requestId: string,
  operation: string,
  payload: unknown,
  providedSignatureHex: string
): Promise<boolean> {
  try {
    const data = buildCanonicalStringToSign(timestamp, requestId, operation, payload);
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signatureBytes = hexToBytes(providedSignatureHex);
    return await crypto.subtle.verify('HMAC', key, signatureBytes, enc.encode(data));
  } catch {
    return false;
  }
}
