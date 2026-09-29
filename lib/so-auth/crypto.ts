import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { CODE_LENGTH } from "./constants";

// Hashing for SO login codes and session tokens. Node crypto only.
// Nothing here ever stores or logs a plaintext code or token.

/** The one email normaliser — must match chk_so_login_codes_email_normalised
 *  (email = lower(btrim(email))). */
export function normaliseEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/** A uniformly random 6-digit code, zero-padded ("004217"). */
export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

// Key derived from AUTH_SECRET with a fixed label, so no new env var is needed
// and the OTP key can never be confused with NextAuth's own use of the secret.
let otpKey: Buffer | null = null;
function getOtpKey(): Buffer {
  if (otpKey) return otpKey;
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set — SO login cannot hash codes");
  otpKey = createHmac("sha256", secret).update("orbit-so-otp:v1").digest();
  return otpKey;
}

/** HMAC-SHA256 of the code, bound to the SO it was issued to. 64 hex chars. */
export function hashCode(salesOfficerId: number, code: string): string {
  return createHmac("sha256", getOtpKey()).update(`${salesOfficerId}:${code}`).digest("hex");
}

/** Constant-time compare of a typed code against a stored hash. */
export function codeMatches(salesOfficerId: number, code: string, storedHash: string): boolean {
  const a = Buffer.from(hashCode(salesOfficerId, code), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** A new session token for the cookie: 32 random bytes, base64url. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What is stored in so_sessions.tokenHash — SHA-256 hex of the cookie token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
