// Sales-officer OTP login — the SO-specific rules (server-only; no client imports).
// The channel-neutral code rules (6 digits, 10 min, 5 tries, 60 s cooldown)
// live in lib/otp/constants.ts since 2026-09-30.
//
// 🔴 SO login is deliberately SEPARATE from staff NextAuth (2026-09-29). It has
// its own cookie, its own tables (so_order_access / so_login_codes / so_sessions,
// Schema v27.43) and never touches lib/auth.ts or auth.config.ts. Do not merge it
// into lib/auth.ts: NextAuth's jwt callback reads token.id as a users.id, so an
// SO id there would pick up a staff user's flags, and any NextAuth session passes
// middleware into every staff route. docs/prompts/drafts/code-discovery-2026-09-29-po2-so-login.md §A.

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const IP_LIMIT = 10;                         // code requests per IP …
export const IP_WINDOW_MS = 60 * 60 * 1000;         // … per hour

export const SO_SESSION_COOKIE = "orbit_so_session";

// 🔴 The HMAC label for SO codes (lib/otp/code.ts takes it as a parameter).
// FROZEN: changing it invalidates every live SO code. A future staff channel
// gets its OWN label, never this one.
export const SO_OTP_HMAC_LABEL = "orbit-so-otp:v1";

// Switched OFF 2026-09-30, when email sending shipped (ZeptoMail,
// lib/otp/send-code-email.ts). While it was true the code was returned to
// the page for testing — safe ONLY because every /api/so-lab route is
// superuser-gated. 🔴 Never turn it back on outside a superuser-only page.
export const TEST_MODE_SHOW_CODE = false;

// Every request-code answer takes at least this long (plus jitter), whatever
// the outcome, so an allowed email (DB insert + email send) cannot be told
// from a disallowed one by timing. A send slower than this still shows; the
// floor covers the typical case.
export const REQUEST_CODE_MIN_MS = 1500;
export const REQUEST_CODE_JITTER_MS = 300;

/** The one generic answer to a code request — identical whether or not the
 *  email is allowed, so the response never reveals eligibility. */
export const REQUEST_CODE_MESSAGE = "If this email is allowed, a code has been sent.";
