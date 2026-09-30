import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { CODE_LENGTH } from "./constants";

// One-time codes — channel-neutral (2026-09-30, split out of the sales-officer login).
// Generation, HMAC hashing and constant-time compare. Node crypto only.
// Nothing here ever stores or logs a plaintext code.
//
// Every caller passes its OWN fixed HMAC label, so two login channels can
// never verify each other's codes. 🔴 A label must never change once codes
// exist: a changed label invalidates every live code.

/** Email normaliser — lower + trim. */
export function normaliseEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/** A uniformly random 6-digit code, zero-padded ("004217"). */
export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

// Key per label, derived from AUTH_SECRET, so no new env var is needed and the
// OTP key can never be confused with NextAuth's own use of the secret.
const keys = new Map<string, Buffer>();
function getKey(label: string): Buffer {
  const cached = keys.get(label);
  if (cached) return cached;
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set — cannot hash one-time codes");
  const key = createHmac("sha256", secret).update(label).digest();
  keys.set(label, key);
  return key;
}

/** HMAC-SHA256 of "{subject}:{code}" under the label's key. 64 hex chars.
 *  `subject` binds the code to whoever it was issued to (e.g. a row id). */
export function hashCode(label: string, subject: string, code: string): string {
  return createHmac("sha256", getKey(label)).update(`${subject}:${code}`).digest("hex");
}

/** Constant-time compare of a typed code against a stored hash. */
export function codeMatches(label: string, subject: string, code: string, storedHash: string): boolean {
  const a = Buffer.from(hashCode(label, subject, code), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
