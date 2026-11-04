// lib/stock-audit/client-id.ts — the per-entry id a counter's phone gives each
// count before it is sent (the offline queue, Schema v27.80).
//
// stock_audit_lines."clientId" uuid NULL + UNIQUE stock_audit_lines_clientId_key.
// The phone makes the id ONCE, when the counter taps Submit, and sends it on
// every retry; POST /api/stock-count/audits/[id]/lines answers a repeat id with
// the line it already holds (lib/stock-audit/replay.ts) — so a send whose reply
// was lost can be retried without a second line.
//
// 🔴 PURE — no Prisma, no server imports, no React. The phone imports it by
// value; so does the POST route.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A UUID in the canonical 8-4-4-4-12 hex shape (any version), any case. */
export function isClientId(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.toLowerCase());
}

/** Lower-cased canonical id, or null when `v` is not a UUID. */
export function normaliseClientId(v: unknown): string | null {
  return isClientId(v) ? v.toLowerCase() : null;
}

/** The slice of Web Crypto this file uses — injectable for the tests. */
export interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T;
}

/** A v4 UUID from 16 random bytes (RFC 4122 §4.4). */
export function uuidFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error("uuidFromBytes needs 16 bytes");
  const b = Uint8Array.from(bytes);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A new lower-case v4 UUID. crypto.randomUUID when the browser has it; it is
 * missing on iOS Safari < 15.4 and in an insecure context (plain-http LAN dev),
 * so fall back to crypto.getRandomValues (iOS 11+, every secure or insecure
 * page). Math.random only as the last resort — the server's UNIQUE is the
 * backstop either way.
 */
export function newClientId(c: CryptoLike | undefined = globalThis.crypto as CryptoLike | undefined): string {
  if (c && typeof c.randomUUID === "function") {
    try {
      const id = c.randomUUID().toLowerCase();
      if (isClientId(id)) return id;
    } catch {
      // Insecure context throws on some browsers — fall through.
    }
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return uuidFromBytes(bytes);
}
