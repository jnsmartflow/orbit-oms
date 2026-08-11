"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

/**
 * The app's ONE NextAuth session provider (mounted once, app/layout.tsx).
 *
 * ── WHY IT IS CONFIGURED THE WAY IT IS (2026-08-10) ─────────────────────────
 *
 * This provider took NO props until now, which meant every NextAuth default
 * applied. Two of them made `/api/auth/[...nextauth]` the single most expensive
 * route in the app: ~1,900 invocations and ~23s Active CPU in a 12-hour window,
 * of which ~97% were background "are you still logged in?" checks rather than
 * real sign-ins.
 *
 * 1. `session` — NOW PASSED IN. Without it the provider has nothing to start
 *    from, so it fetches GET /api/auth/session on EVERY mount, i.e. once per
 *    full page load, immediately re-asking a question the server had already
 *    answered during the same render. The layout resolves it with auth() and
 *    hands it over.
 *
 * 2. `refetchOnWindowFocus` — NOW FALSE. The default is true: every phone
 *    unlock, every PWA foreground, every tab focus fired a fresh check. On a
 *    depot floor where 10 pickers and 6 supervisors pocket and re-open phones
 *    all shift, that alone was the bulk of the volume.
 *
 *    🔴 THE ACCEPTED TRADE — read this before switching it back on. With focus
 *    refetch off, a user whose ROLE OR PERMISSIONS change while they are logged
 *    in may not see it until they sign out and back in. That is a deliberate
 *    owner decision (2026-08-10): this is an internal depot tool, access
 *    changes are rare, and a manual relogin is an acceptable workaround. Do NOT
 *    "fix" this by adding a periodic refresh — that just recreates the same
 *    problem on a different clock, which is why `refetchInterval` is also left
 *    at its default of 0 (off).
 *
 *    ⚠ THIS IS NOT A SECURITY GATE, and turning it off does not weaken one.
 *    Whether an account is still ACTIVE is enforced at login and independently
 *    re-verified at each sensitive write route (e.g.
 *    app/api/picking/done/route.ts re-checks isActive on every call —
 *    CLAUDE_PICKING.md §7). None of that depends on this client-side timer.
 *    Token expiry is likewise unaffected: an expired or invalidated token still
 *    fails at the next server request, and middleware.ts still redirects to
 *    /login. All this timer ever did was notice slightly sooner.
 */
export function SessionProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  /** Server-resolved session from the root layout. `null` for anonymous
   *  visitors (the public /po, /demo and /login pages mount this too). */
  session: Session | null;
}) {
  return (
    <NextAuthSessionProvider session={session} refetchOnWindowFocus={false}>
      {children}
    </NextAuthSessionProvider>
  );
}
