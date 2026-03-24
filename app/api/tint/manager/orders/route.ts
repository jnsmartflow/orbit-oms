import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "tint_manager", "canView");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const now          = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    // ── All five queries in parallel ──────────────────────────────────────────
    const [activeOrders, completedTodayOrders, activeSplits, completedSplits, completedAssignments] = await Promise.all([

      // Set A — pending orders (Pending Assignment column)
      prisma.orders.findMany({
        where: {
          orderType:     "tint",
          workflowStage: { in: ["pending_tint_assignment", "tint_assigned", "tinting_in_progress"] },
        },
        orderBy: [{ sequenceOrder: "asc" }],
        include: {
          customer: {
            include: {
              area: { select: { name: true } },
              salesOfficerGroup: {
                include: {
                  salesOfficer: { select: { name: true } },
                },
              },
            },
          },
          querySnapshot: {
            select: { totalVolume: true, totalArticle: true, articleTag: true, hasTinting: true, totalLines: true },
          },
          tintAssignments: {
            where:   { status: { not: "done" } },
            include: { assignedTo: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" },
            take:    1,
          },
          splits: {
            where:  { status: { not: "cancelled" } },
            select: {
              id:             true,
              splitNumber:    true,
              totalQty:       true,
              status:         true,
              articleTag:     true,
              dispatchStatus: true,
              createdAt:      true,
              assignedTo:     { select: { name: true } },
              lineItems: {
                select: {
                  rawLineItemId: true,
                  assignedQty:   true,
                  rawLineItem: {
                    select: {
                      skuCodeRaw:        true,
                      skuDescriptionRaw: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),

      // Set B — completed today (legacy, kept for split-builder existingSplits)
      prisma.orders.findMany({
        where: {
          orderType:     "tint",
          workflowStage: "pending_support",
          tintAssignments: {
            some: {
              status:      "tinting_done",
              completedAt: { gte: startOfToday },
            },
          },
        },
        include: {
          customer: {
            include: {
              area: { select: { name: true } },
              salesOfficerGroup: {
                include: {
                  salesOfficer: { select: { name: true } },
                },
              },
            },
          },
          querySnapshot: {
            select: { totalVolume: true, totalArticle: true, articleTag: true, hasTinting: true, totalLines: true },
          },
          tintAssignments: {
            where: {
              status:      "tinting_done",
              completedAt: { gte: startOfToday },
            },
            include: { assignedTo: { select: { id: true, name: true } } },
            orderBy: { completedAt: "desc" },
            take:    1,
          },
        },
        orderBy: { createdAt: "asc" },
      }),

      // Set C — active splits (Assigned + In Progress columns)
      prisma.order_splits.findMany({
        where:   { status: { in: ["tint_assigned", "tinting_in_progress"] } },
        orderBy: [{ sequenceOrder: "asc" }],
        include: {
          order: {
            include: {
              customer: {
                include: {
                  salesOfficerGroup: {
                    include: {
                      salesOfficer: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
          assignedTo: { select: { id: true, name: true } },
          lineItems: {
            include: {
              rawLineItem: {
                select: {
                  skuCodeRaw:        true,
                  skuDescriptionRaw: true,
                  unitQty:           true,
                  volumeLine:        true,
                  isTinting:         true,
                },
              },
            },
          },
        },
      }),

      // Set D — completed splits today (Completed column)
      prisma.order_splits.findMany({
        where: {
          status:      "tinting_done",
          completedAt: { gte: startOfToday },
        },
        include: {
          order: {
            include: {
              customer: {
                include: {
                  salesOfficerGroup: {
                    include: {
                      salesOfficer: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
          assignedTo: { select: { id: true, name: true } },
          lineItems: {
            include: {
              rawLineItem: {
                select: {
                  skuCodeRaw:        true,
                  skuDescriptionRaw: true,
                  unitQty:           true,
                  volumeLine:        true,
                  isTinting:         true,
                },
              },
            },
          },
        },
        orderBy: { completedAt: "desc" },
      }),

      // Set E — completed tint_assignments today (whole-OBD Completed column)
      prisma.tint_assignments.findMany({
        where: {
          status:      "tinting_done",
          completedAt: { gte: startOfToday },
        },
        include: {
          order: {
            include: {
              customer: {
                include: {
                  area:              { select: { name: true } },
                  salesOfficerGroup: {
                    include: { salesOfficer: { select: { name: true } } },
                  },
                },
              },
              querySnapshot: {
                select: { totalVolume: true, totalArticle: true, articleTag: true, totalLines: true },
              },
            },
          },
          assignedTo: { select: { id: true, name: true } },
        },
        orderBy: { completedAt: "desc" },
      }),
    ]);

    const orders = [...activeOrders, ...completedTodayOrders];

    // ── Unified SMU map (orders + splits share import_raw_summary) ────────────
    const allObdNumbers = Array.from(new Set([
      ...orders.map((o) => o.obdNumber),
      ...activeSplits.map((s) => s.order.obdNumber),
      ...completedSplits.map((s) => s.order.obdNumber),
      ...completedAssignments.map((a) => a.order.obdNumber),
    ]));

    const rawSummaries = allObdNumbers.length > 0
      ? await prisma.import_raw_summary.findMany({
          where:  { obdNumber: { in: allObdNumbers } },
          select: { obdNumber: true, smu: true, obdEmailDate: true, obdEmailTime: true },
        })
      : [];
    const smuMap     = new Map(rawSummaries.map((s) => [s.obdNumber, s.smu]));
    const obdDateMap = new Map(rawSummaries.map((s) => [s.obdNumber, { date: s.obdEmailDate, time: s.obdEmailTime }]));

    // ── Line items for orders (split builder modal needs these) ───────────────
    const orderObdNumbers = orders.map((o) => o.obdNumber);
    const rawLineItems = orderObdNumbers.length > 0
      ? await prisma.import_raw_line_items.findMany({
          where: { obdNumber: { in: orderObdNumbers } },
          select: {
            id:                true,
            lineId:            true,
            obdNumber:         true,
            skuCodeRaw:        true,
            skuDescriptionRaw: true,
            unitQty:           true,
            volumeLine:        true,
            isTinting:         true,
            article:           true,
            articleTag:        true,
          },
        })
      : [];
    const linesByObd = new Map<string, typeof rawLineItems>();
    for (const line of rawLineItems) {
      if (!linesByObd.has(line.obdNumber)) linesByObd.set(line.obdNumber, []);
      linesByObd.get(line.obdNumber)!.push(line);
    }

    // ── Existing split line items per order (for split builder existingSplits) ─
    const allOrderIds = orders.map((o) => o.id);
    const splitLineItems = allOrderIds.length > 0
      ? await prisma.split_line_items.findMany({
          where:  { split: { orderId: { in: allOrderIds } } },
          select: {
            rawLineItemId: true,
            assignedQty:   true,
            split:         { select: { orderId: true } },
          },
        })
      : [];
    const existingSplitsByOrderId = new Map<number, { rawLineItemId: number; assignedQty: number }[]>();
    for (const item of splitLineItems) {
      const oid = item.split.orderId;
      if (!existingSplitsByOrderId.has(oid)) existingSplitsByOrderId.set(oid, []);
      existingSplitsByOrderId.get(oid)!.push({
        rawLineItemId: item.rawLineItemId,
        assignedQty:   item.assignedQty,
      });
    }

    // ── Assemble final payloads ────────────────────────────────────────────────
    const ordersWithLines = orders.map((o) => {
      // Compute remainingQty: total raw-line unitQty minus qty assigned to non-cancelled splits.
      // o.splits is present on activeOrders (filtered to non-cancelled); absent on completedTodayOrders.
      type SplitWithItems = { lineItems: { rawLineItemId: number; assignedQty: number }[] };
      const splitsData = ((o as { splits?: SplitWithItems[] }).splits) ?? [];
      const assignedQtyByLine = new Map<number, number>();
      for (const split of splitsData) {
        for (const item of split.lineItems) {
          assignedQtyByLine.set(
            item.rawLineItemId,
            (assignedQtyByLine.get(item.rawLineItemId) ?? 0) + item.assignedQty,
          );
        }
      }
      const lines = linesByObd.get(o.obdNumber) ?? [];
      const remainingQty = lines.reduce((sum, line) => {
        const assigned = assignedQtyByLine.get(line.id) ?? 0;
        return sum + Math.max(0, line.unitQty - assigned);
      }, 0);

      // Whole-OBD assignments (tint_assignments table) do not create split_line_items,
      // so remainingQty from splits always equals the full line total for such orders.
      // This would incorrectly place them in the Pending column instead of Assigned.
      // Fix: if there is an active tint_assignment (not cancelled, not done), the whole
      // OBD is assigned to one operator — treat effectiveRemainingQty as 0.
      type AnyAssignment = { status: string };
      const assignmentList = ((o as { tintAssignments?: AnyAssignment[] }).tintAssignments) ?? [];
      const hasActiveWholeOBDAssignment = assignmentList.some(
        (a) => a.status !== "cancelled" && a.status !== "done",
      );
      const effectiveRemainingQty = hasActiveWholeOBDAssignment ? 0 : remainingQty;

      return {
        ...o,
        smu:            smuMap.get(o.obdNumber) ?? null,
        obdEmailDate:   obdDateMap.get(o.obdNumber)?.date ?? null,
        obdEmailTime:   obdDateMap.get(o.obdNumber)?.time ?? null,
        lineItems:      linesByObd.get(o.obdNumber) ?? [],
        existingSplits: existingSplitsByOrderId.get(o.id) ?? [],
        remainingQty:   effectiveRemainingQty,
      };
    });

    const activeSplitsWithSmu    = activeSplits.map((s) => ({
      ...s,
      smu:          smuMap.get(s.order.obdNumber) ?? null,
      obdEmailDate: obdDateMap.get(s.order.obdNumber)?.date ?? null,
      obdEmailTime: obdDateMap.get(s.order.obdNumber)?.time ?? null,
    }));
    const completedSplitsWithSmu = completedSplits.map((s) => ({
      ...s,
      smu:          smuMap.get(s.order.obdNumber) ?? null,
      obdEmailDate: obdDateMap.get(s.order.obdNumber)?.date ?? null,
      obdEmailTime: obdDateMap.get(s.order.obdNumber)?.time ?? null,
    }));

    const completedAssignmentsWithSmu = completedAssignments.map((a) => ({
      ...a,
      smu:          smuMap.get(a.order.obdNumber) ?? null,
      obdEmailDate: obdDateMap.get(a.order.obdNumber)?.date ?? null,
      obdEmailTime: obdDateMap.get(a.order.obdNumber)?.time ?? null,
    }));

    return NextResponse.json({
      orders:               ordersWithLines,
      activeSplits:         activeSplitsWithSmu,
      completedSplits:      completedSplitsWithSmu,
      completedAssignments: completedAssignmentsWithSmu,
    });

  } catch (err) {
    console.error("[tint/manager/orders] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
