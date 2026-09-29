// Sales-officer OTP login — the rules in one place (server-only; no client imports).
//
// 🔴 SO login is deliberately SEPARATE from staff NextAuth (2026-09-29). It has
// its own cookie, its own tables (so_order_access / so_login_codes / so_sessions,
// Schema v27.43) and never touches lib/auth.ts or auth.config.ts. Do not merge it
// into lib/auth.ts: NextAuth's jwt callback reads token.id as a users.id, so an
// SO id there would pick up a staff user's flags, and any NextAuth session passes
// middleware into every staff route. docs/prompts/drafts/code-discovery-2026-09-29-po2-so-login.md §A.

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;          // a code is valid 10 min
export const MAX_ATTEMPTS = 5;                      // wrong tries per code
export const RESEND_COOLDOWN_MS = 60 * 1000;        // one code per SO per 60 s
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const IP_LIMIT = 10;                         // code requests per IP …
export const IP_WINDOW_MS = 60 * 60 * 1000;         // … per hour

export const SO_SESSION_COOKIE = "orbit_so_session";

// TEST PHASE ONLY — must become false when real email sending ships (step 7).
// Only safe because every /api/so-lab route is superuser-gated.
export const TEST_MODE_SHOW_CODE = true;

/** The one generic answer to a code request — identical whether or not the
 *  email is allowed, so the response never reveals eligibility. */
export const REQUEST_CODE_MESSAGE = "If this email is allowed, a code has been sent.";
