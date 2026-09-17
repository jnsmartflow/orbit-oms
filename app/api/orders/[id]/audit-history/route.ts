import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

/**
 * Returns up to the most recent PAGE_SIZE order_status_logs rows for one
 * order, joined to the actor's user row. Used by the order detail panel's
 * History section. When more than PAGE_SIZE rows exist, the response
 * includes `totalCount` so the UI can render "Showing recent 100 of N".
 *
 * Gate (2026-09-17): the `tint_panel_details` canView tick — the Details tab of
 * the Tint Manager job panel, which is this route's ONLY live caller (via
 * components/shared/order-audit-history.tsx). It replaced a job-title
 * requireRole([support, dispatcher, admin, operations, tint_manager]) that
 * (a) ignored ACCESS_SOURCE and (b) called redirect() INSIDE the try below,
 * where the catch swallowed it into a 500 — which is what operation_manager
 * holders got. The check now sits OUTSIDE the try and answers with JSON.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_panel_details", "canView");
  if (!allowed) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const orderId = parseInt(params.id, 10);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
    }

    const [rows, total] = await Promise.all([
      prisma.order_status_logs.findMany({
        where:   { orderId },
        orderBy: { createdAt: "desc" },
        take:    PAGE_SIZE,
        select: {
          id:          true,
          createdAt:   true,
          fromStage:   true,
          toStage:     true,
          note:        true,
          changedBy:   { select: { id: true, name: true } },
        },
      }),
      prisma.order_status_logs.count({ where: { orderId } }),
    ]);

    const entries = rows.map((r) => {
      const note = r.note ?? "";
      const m = note.match(/^\[([a-z_]+)\]/);
      return {
        id:         r.id,
        createdAt:  r.createdAt.toISOString(),
        fromStage:  r.fromStage,
        toStage:    r.toStage,
        note:       r.note,
        changeType: m ? m[1] : "other",
        changedBy:  r.changedBy ? { id: r.changedBy.id, name: r.changedBy.name } : null,
      };
    });

    return NextResponse.json({
      entries,
      ...(total > PAGE_SIZE ? { totalCount: total } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load audit history" },
      { status: 500 },
    );
  }
}
