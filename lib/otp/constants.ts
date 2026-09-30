// One-time code rules shared by every login channel (2026-09-30, split out of
// the sales-officer login constants — values unchanged). Channel-specific rules
// (session length, cookie, IP limit, HMAC label) stay with the channel.

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;   // a code is valid 10 min
export const MAX_ATTEMPTS = 5;               // wrong tries per code
export const RESEND_COOLDOWN_MS = 60 * 1000; // one code per person per 60 s
