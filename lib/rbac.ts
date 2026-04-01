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
  FLOOR_SUPERVISOR: "floor_supervisor",
  PICKER: "picker",
} as const;

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
  if (!allowed.includes(session.user.role)) {
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
  if (!session?.user?.role) return false;
  return allowed.includes(session.user.role);
}
