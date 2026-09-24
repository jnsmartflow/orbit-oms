// lib/push/hand.ts
//
// Web push when a bill is marked HAND — the dealer collects from the depot, so
// the floor must plan it on a Hand trip, not a truck (design
// docs/prompts/drafts/web-update-2026-09-24-billing-mo-actions.md §4, Notify).
//
// Copied from the "Pick completed" trigger (app/api/picking/done/route.ts):
//   • recipients = getPickingSupervisorUserIds() — floor_supervisor, operations,
//     admin (primary or secondary role), active users only
//   • the actor is never notified about their own press
//   • AWAITED by the caller (Vercel freezes the function after the response,
//     so an un-awaited push is unreliable) and FULLY SWALLOWED — a failed push
//     never changes the action's response (CLAUDE_NOTIFICATIONS.md §2, §8 #5)
//   • READS ONLY — no orders.update here, or every board's live-sync marker
//     would see a false change (CLAUDE_NOTIFICATIONS.md §8 #2)
//   • no time-of-day gate (quiet hours were removed 2026-08-12)
//
// Callers: POST /api/floor/actions (action "hand"). Exported for the billing
// actions route (build step 7), which will call it the same way.

import { prisma } from "@/lib/prisma";
import { getPickingSupervisorUserIds } from "@/lib/push/recipients";
import { sendToUser } from "@/lib/push/send";

/**
 * Notify the supervisors that these bills were just marked Hand. One push per
 * bill (its own tag, so two bills do not replace each other on a phone).
 * NEVER THROWS.
 */
export async function notifyHandSet(orderIds: readonly number[], actorId: number): Promise<void> {
  if (orderIds.length === 0) return;
  try {
    const orders = await prisma.orders.findMany({
      where: { id: { in: Array.from(orderIds) } },
      select: {
        id: true,
        obdNumber: true,
        shipToCustomerName: true,
        customer: { select: { customerName: true } },
        shipToOverrideCustomer: { select: { customerName: true } },
      },
    });
    const recipients = await getPickingSupervisorUserIds();
    for (const order of orders) {
      // Same three-step fallback the boards and the other push bodies use.
      const dealerName =
        order.shipToOverrideCustomer?.customerName ??
        order.customer?.customerName ??
        order.shipToCustomerName ??
        "(Unmatched)";
      for (const userId of recipients) {
        if (userId === actorId) continue; // never notify the actor
        await sendToUser(userId, {
          title: "Hand — dealer collects",
          body: `${dealerName} · ${order.obdNumber} — Dealer collects — plan on a Hand trip`,
          tag: `hand-${order.id}`,
          url: "/floor",
        });
      }
    }
  } catch (err) {
    console.error("[push/hand] notify failed (non-fatal):", err);
  }
}
