import { redirect } from "next/navigation";
import type { Session } from "next-auth";

// ── Role constants ─────────────────────────────────────────────────────────────
export const ROLES = {
  ADMIN: "admin",
  DISPATCHER: "dispatcher",
  SUPPORT: "support",
  TINT_MANAGER: "tint_manager",
  TINT_OPERATOR: "tint_operator",
  OPERATIONS: "operations",
  OPS_ADMIN: "ops_admin",
  FLOOR_SUPERVISOR: "floor_supervisor",
  PICKER: "picker",
  BILLING_OPERATOR: "billing_operator",
  OPERATION_MANAGER: "operation_manager",
} as const;

// ── Login redirect map ────────────────────────────────────────────────────────
// Single source for role → landing route. Imported by app/page.tsx (post-login
// root redirect) and app/login/page.tsx (already-authenticated guard). Falls
// back to /unauthorized at the call site if the role isn't in this map.
export const ROLE_REDIRECTS: Record<string, string> = {
  admin: "/admin",
  dispatcher: "/place-order",
  support: "/place-order",
  tint_manager: "/tint/manager",
  tint_operator: "/tint/operator",
  operations: "/floor",
  // Repointed 2026-07-28 from "/warehouse/supervisor" and "/warehouse/picker".
  // Those were 4-line stubs that redirected to /warehouse — a board filtering on
  // workflowStage 'dispatch_confirmation', of which the live count is 0, so both
  // roles landed on a permanently empty screen. /picking is their real board:
  // floor_supervisor gets the supervisor face, picker gets his own "My Picks"
  // face (app/picking/page.tsx branches on primaryRole). Both roles hold
  // picking.canView live (SELECT 2026-07-27, re-confirmed 2026-08-04).
  // /warehouse and its stubs were RETIRED 2026-07-28 —
  // archive/2026-07-warehouse-board/ owns the story.
  floor_supervisor: "/picking",
  picker: "/picking",
  billing_operator: "/mail-orders",
  ops_admin: "/admin/attendance",
  operation_manager: "/tint/manager",
  logistics: "/trips",
};

// ── Guards ─────────────────────────────────────────────────────────────────────

/**
 * Server-side role guard for Server Components and API routes.
 * Redirects to /unauthorized if session is null or role is not in allowed[].
 * Call AFTER awaiting auth().
 *
 * Usage:
 *   const session = await auth();
 *   requireRole(session, [ROLES.ADMIN]);
 */
export function requireRole(session: Session | null, allowed: string[]): void {
  if (!session?.user) {
    redirect("/unauthorized");
  }
  const userRoles = session.user.roles ?? [session.user.role];
  if (!userRoles.some(r => allowed.includes(r))) {
    redirect("/unauthorized");
  }
}

// ── Superuser ─────────────────────────────────────────────────────────────────
//
// "May administer OrbitOMS." Step 5 of the role → user access conversion: the
// last thing that still treated a JOB TITLE as authority becomes a flag on the
// person, `users.isSuperuser`.
//
// 🔴 THE SAFETY RULE — BOTH ARMS, ALWAYS.
//
//     isSuperuser === true   OR   roles includes "admin"
//
// Never the flag alone. If the flag fails to reach the session for ANY reason —
// a token minted before this deploy and not yet refreshed, a session callback
// that stops copying the claim, a bad edit to auth.config.ts, a botched
// migration — the role arm still admits the owner.
//
// There is exactly ONE superuser account. He is the only person who can reach
// the ACCESS_SOURCE panic switch and the only person who can grant the flag
// back. Locking him out is the single unrecoverable failure in this whole
// project: every other mistake is undone from the admin panel, and that one
// takes the admin panel away.
//
// ⚠ THE ROLE ARM COMES OUT IN A LATER PASS, ONCE THE FLAG IS PROVEN IN
// PRODUCTION. NOT NOW. Do not "tidy" it away, do not collapse this to a single
// condition because the flag "obviously works" — that is precisely the change
// that cannot be undone from inside the app if it is wrong.
//
// A flag change does NOT need a re-login: lib/auth.ts re-reads isSuperuser on
// the same 5-minute stale window as the attendance claims, so granting or
// revoking lands within that window on its own.

/**
 * Non-throwing superuser check. Safe in conditionals and in render.
 *
 * Usage:
 *   if (isSuperuser(session)) { ... }
 */
export function isSuperuser(session: Session | null): boolean {
  if (!session?.user) return false;
  // Arm 1 — the flag.
  if (session.user.isSuperuser === true) return true;
  // Arm 2 — the legacy role. Deliberate. Read the block above before removing.
  const userRoles = session.user.roles ?? (session.user.role ? [session.user.role] : []);
  return userRoles.includes(ROLES.ADMIN);
}

/**
 * Server-side superuser guard for Server Components and API routes.
 * Redirects to /unauthorized if the session is null or the user is neither
 * flagged nor holding the admin role. Call AFTER awaiting auth().
 *
 * Drop-in replacement for `requireRole(session, [ROLES.ADMIN])` — same
 * behaviour for anyone holding the admin role, plus the flag.
 *
 * Usage:
 *   const session = await auth();
 *   requireSuperuser(session);
 */
export function requireSuperuser(session: Session | null): void {
  if (!isSuperuser(session)) {
    redirect("/unauthorized");
  }
}

/**
 * Non-throwing role check. Safe to use in conditionals.
 *
 * Usage:
 *   if (hasRole(session, [ROLES.ADMIN, ROLES.DISPATCHER])) { ... }
 */
export function hasRole(session: Session | null, allowed: string[]): boolean {
  if (!session?.user) return false;
  const userRoles = session.user.roles ?? (session.user.role ? [session.user.role] : []);
  return userRoles.some(r => allowed.includes(r));
}
