// lib/ship-to/access.ts
//
// The READ gate for the typed ship-to routes (areas, copies list, signed URL):
// mail_orders canView OR floor canView. Two desks use the one modal, and
// neither may depend on the other's permission — billing_operator holds no
// `floor` row (app/api/billing/ship-to-search/route.ts header), and a Floor
// user need not hold mail_orders. Per-user ticks via checkAnyPermission; no new
// page key (design §2 Access).
//
// Server-only.

import { checkAnyPermission } from "@/lib/permissions";

export async function canViewShipTo(roles: string[]): Promise<boolean> {
  if (await checkAnyPermission(roles, "mail_orders", "canView")) return true;
  return checkAnyPermission(roles, "floor", "canView");
}

/** Billing's ship-to WRITE gate — both must pass (CLAUDE_BILLING §5). */
export async function canEditBillingShipTo(roles: string[]): Promise<boolean> {
  if (!(await checkAnyPermission(roles, "mail_orders", "canEdit"))) return false;
  return checkAnyPermission(roles, "billing_ship_to", "canEdit");
}
