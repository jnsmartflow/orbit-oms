// One-time code rules shared by every login channel (2026-09-30, split out of
// the sales-officer login constants — values unchanged). Channel-specific rules
// (session length, cookie, IP limit, HMAC label) stay with the channel.

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;   // a code is valid 10 min
export const MAX_ATTEMPTS = 5;               // wrong tries per code
// 2026-10-01: 60 s → 30 s. Read by the server cooldown (request-code) AND the
// /so-lab login screen's Resend countdown — one constant, both places. This file
// has no imports, so the client component can import it.
export const RESEND_COOLDOWN_MS = 30 * 1000; // one code per person per 30 s
