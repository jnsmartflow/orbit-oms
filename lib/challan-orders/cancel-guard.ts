// lib/challan-orders/cancel-guard.ts
//
// THE TWO RULES EVERY CANCEL / REMOVE PATH APPLIES TO A CHALLAN (ORB) ORDER
// (Challan orders slice 5, 2026-10-07 — owner decisions S5-3 and S5-4,
// web-update-2026-10-06-challan-orders.md §4d). One owner; every path imports it.
//
//   S5-4  ONLY ADMIN cancels or removes an ORB order. "Admin" is the app's own
//         check — lib/rbac.ts isSuperuser(session): the admin role OR the
//         superuser flag. The route resolves it and passes `actorIsAdmin` down;
//         every core DEFAULTS IT TO FALSE, so a caller that forgets to pass it
//         refuses an ORB order (fail closed) and changes nothing for any other
//         bill. Admin still obeys each path's own stage rules.
//   S5-3  When an ORB order IS cancelled / removed, its 'waiting' SO links become
//         'unlinked' (unlinkedById = the canceller). The goods never left, so a
//         later SAP bill for that SO must flow as a normal order — and the SO is
//         freed from challan_order_so_links_soNumber_live_key.
//
// Paths that call these (code-update-2026-10-07-challan-slice5.md §3 lists them):
//   lib/floor/bill-actions.ts applyBillAction("cancel")  ← /api/floor/actions, /api/tint/manager/cancel
//   lib/floor/raise-ci.ts raiseFullBillCi                ← /api/floor/ci, /api/tint/manager/ci
//   lib/billing/pick-delete.ts pickDelete                ← /api/billing/pick-delete/delete, /api/tint/manager/pick-delete/delete
//   app/api/picking/cancel/route.ts                      (inline)
//   app/api/tint/manager/orders/[id]/remove/route.ts     (inline)

import { prisma } from "@/lib/prisma";

/** The refusal every path shows a non-admin. */
export const CHALLAN_ADMIN_ONLY = "Only admin can cancel a challan order.";

/** null = allowed; else the refusal text. Pure. */
export function challanCancelRefusal(isChallanOrder: boolean, actorIsAdmin: boolean): string | null {
  return isChallanOrder && !actorIsAdmin ? CHALLAN_ADMIN_ONLY : null;
}

/**
 * S5-3 — after an ORB order's cancel / remove write. Every 'waiting' link on it
 * becomes 'unlinked' in one guarded updateMany (only rows still 'waiting', so a
 * row that turned 'linked' meanwhile is untouched). A 'linked' row is left as
 * it is — its SAP OBD is real and already in Orbit (slice 6 owns that case).
 * The link table's live_changes trigger announces it. Returns the count.
 */
export async function unlinkWaitingOnCancel(orbOrderId: number, actorId: number): Promise<number> {
  const res = await prisma.challan_order_so_links.updateMany({
    where: { orbOrderId, status: "waiting" },
    data: { status: "unlinked", unlinkedById: actorId, unlinkedAt: new Date() },
  });
  return res.count;
}
