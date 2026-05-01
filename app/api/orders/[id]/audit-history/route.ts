import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

/**
 * Returns up to the most recent PAGE_SIZE order_status_logs rows for one
 * order, joined to the actor's user row. Used by the order detail panel's
 * History section. When more than PAGE_SIZE rows exist, the response
 * includes `totalCount` so the UI can render "Showing recent 100 of N".
 *
 * Auth list mirrors /api/orders/[id]/detail (same panel surface).
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const session = await auth();
    requireRole(session, [
      ROLES.SUPPORT, ROLES.DISPATCHER, ROLES.ADMIN,
      ROLES.OPERATIONS, ROLES.TINT_MANAGER,
    ]);

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
