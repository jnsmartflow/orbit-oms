import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/floor/tint-operators — who holds each bill in the tint room.
 *
 * 🔴 IT EXISTS SO THE BOARD QUERY NEVER HAS TO. `/floor`'s board call does not
 * touch `tint_assignments` and must not: the rail feed that used to was deleted
 * on 2026-09-13 for costing 772 ms and 25 of the call's 84 statements on a
 * payload nothing rendered, and that cut took the board from 3,909 ms to
 * 1,958 ms. Putting an operator name on the row would have spent it straight
 * back — on every board load, and on every 30-second rail poll.
 *
 * So the name lives here, on its own route, and the CLIENT decides when to ask.
 * `floor-page.tsx` mounts it only while the Tinting tab is open and refetches
 * only on an explicit refresh. The Floor tab pays nothing. The 30s poll pays
 * nothing. The 15s marker pays nothing — it goes through
 * `getFloorLiveMarkerWhere` and is untouched.
 *
 * ⚠ DELIBERATELY NOT FOLLOWING THE POLL. An operator name changes when a
 * manager assigns, which is a handful of times a day; a name 30 seconds stale
 * is not worth a recurring read on the depot's link. Owner decision 2026-09-14.
 *
 * ⚠ `tint_assigned` ONLY, AND THAT IS THE WHOLE SET THAT CAN HAVE AN ANSWER. A
 * bill at `pending_tint_assignment` has no assignment row by definition — the
 * column renders a dash for it — and a bill at `tinting_in_progress` has left
 * the Tinting tab for the Floor tab (it wears the solid pink pill there). One
 * stage, one bounded read, no ids in the URL.
 *
 * ⚠ NO HIDE EXCLUSION, AND IT CANNOT LEAK. This returns a lookup keyed by
 * orderId, joined client-side against rows the client already holds — and those
 * came through the board query, which applies the hide. An id with no row on
 * screen matches nothing and renders nowhere.
 *
 * ⚠ `splitId: null` — the WHOLE-ORDER assignment. A split's operator lives per
 * split and there is no single name for the bill; the detail panel draws the
 * same boundary. Latest row wins, so a reassigned bill reports who has it now.
 *
 * SELECT-only. Sequential awaits, never prisma.$transaction (CORE §3). No
 * `orders.update` anywhere near it — the live marker keys on
 * MAX(orders.updatedAt) (FLOOR §10).
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await prisma.tint_assignments.findMany({
    where: {
      splitId: null,
      order: { workflowStage: "tint_assigned", isRemoved: false },
    },
    orderBy: { createdAt: "desc" },
    select: { orderId: true, assignedTo: { select: { name: true } } },
  });

  // Latest row per order wins — `orderBy` desc above plus first-write-wins here.
  // A bill reassigned to a second operator keeps its earlier row, and the most
  // recent one describes who is holding it.
  const seen = new Set<number>();
  const operators: Array<{ orderId: number; name: string | null }> = [];
  for (const r of rows) {
    if (seen.has(r.orderId)) continue;
    seen.add(r.orderId);
    operators.push({ orderId: r.orderId, name: r.assignedTo?.name ?? null });
  }

  return NextResponse.json(
    { operators },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
