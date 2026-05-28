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
  operations: "/operations/support",
  floor_supervisor: "/warehouse/supervisor",
  picker: "/warehouse/picker",
  billing_operator: "/mail-orders",
  ops_admin: "/admin/attendance",
  operation_manager: "/tint/manager",
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
