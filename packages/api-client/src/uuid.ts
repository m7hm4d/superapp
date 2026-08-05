/**
 * UUID v4 generator without expo-crypto.
 * Prefers the platform's crypto.randomUUID / crypto.getRandomValues when
 * available (Hermes, browsers, Node >= 19); otherwise falls back to a
 * Math.random-based implementation (idempotency keys only — not security
 * sensitive).
 */

interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

function getCrypto(): CryptoLike | undefined {
  const g = globalThis as { crypto?: CryptoLike };
  return g.crypto;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (let i = 0; i < 256; i++) {
    hex.push((i + 0x100).toString(16).slice(1));
  }
  const b = (i: number): string => hex[bytes[i] ?? 0] as string;
  return (
    b(0) + b(1) + b(2) + b(3) + '-' +
    b(4) + b(5) + '-' +
    b(6) + b(7) + '-' +
    b(8) + b(9) + '-' +
    b(10) + b(11) + b(12) + b(13) + b(14) + b(15)
  );
}

export function uuid(): string {
  const c = getCrypto();
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // RFC 4122 version 4 + variant bits.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}
