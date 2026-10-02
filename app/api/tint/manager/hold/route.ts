import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getFloorHold } from "@/lib/floor/queries";
import { BASE_BILL_WHERE } from "@/lib/tint/manager-bill";
import type { TintHoldRow } from "@/components/tint/manager/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/tint/manager/hold — every held TINT bill, any stage (waiting,
 * mid-tint, or finished and parked at pending_support), for the Tint Manager's
 * Hold tab (2026-10-01, tabs build step 7 — plan §A/§C).
 *
 * The rows are Floor's (lib/floor/queries.ts getFloorHold with extraWhere
 * { orderType: "tint" } — the same held set, held-since rule and party fields
 * Floor's Hold tab shows), plus ONE batched read for what the tint tab adds:
 * stage, the Floor dispatch window, the original site, and the latest operator.
 * READ-ONLY, sequential awaits (CORE §3).
 *
 * Since 2026-10-01 the held set is tint ∪ BASE bills (non-tint SMU 74/77, owner
 * §I decision 7): a held Base bill leaves Floor's board — and so the Base tab —
 * and this tab is where the Tint Manager releases it.
 *
 * Gate: tint_manager canView AND tint_hold canView.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (
    !(await checkAnyPermission(roles, "tint_manager", "canView")) ||
    !(await checkAnyPermission(roles, "tint_hold", "canView"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const held = await getFloorHold("All", undefined, undefined, { OR: [{ orderType: "tint" }, BASE_BILL_WHERE] });
  const ids = held.map((r) => r.orderId);

  const extras = ids.length > 0
    ? await prisma.orders.findMany({
        where:  { id: { in: ids } },
        select: {
          id: true,
          workflowStage: true,
          shipToOverrideCustomerId: true,
          shipToCustomerName: true,
          customer: { select: { customerName: true } },
          dispatchTargetDate: true,
          dispatchWindowId: true,
          dispatchWindow: { select: { windowTime: true } },
          tintAssignments: {
            where:   { splitId: null },
            orderBy: { createdAt: "desc" },
            take:    1,
            select:  { status: true, assignedTo: { select: { name: true } } },
          },
        },
      })
    : [];
  const byId = new Map(extras.map((e) => [e.id, e]));

  const rows: TintHoldRow[] = held.map((r) => {
    const e = byId.get(r.orderId);
    const own = e?.customer?.customerName ?? e?.shipToCustomerName ?? null;
    return {
      ...r,
      workflowStage:      e?.workflowStage ?? "",
      originalSiteName:   e && e.shipToOverrideCustomerId !== null ? own : null,
      dispatchTargetDate: e?.dispatchTargetDate ? e.dispatchTargetDate.toISOString().slice(0, 10) : null,
      dispatchWindowId:   e?.dispatchWindowId ?? null,
      dispatchWindowTime: e?.dispatchWindow?.windowTime ?? null,
      operatorName:       e?.tintAssignments[0]?.assignedTo?.name ?? null,
      assignmentStatus:   e?.tintAssignments[0]?.status ?? null,
    };
  });

  return NextResponse.json({ rows, count: rows.length }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
