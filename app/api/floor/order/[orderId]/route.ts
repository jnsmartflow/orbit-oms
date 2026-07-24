import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatPack } from "@/lib/place-order/pack";
import type { FloorDetail, FloorActivityEntry, FloorDetailLine } from "@/lib/floor/types";

export const dynamic = "force-dynamic";

// GET /api/floor/order/[orderId] — the whole detail payload for one bill (design
// §10): header + Details groups + Items + Activity, in ONE call. Read-only.
//
// Sequential awaits only, never prisma.$transaction (CORE §3). The catalog is
// resolved via sku_master_v2 by `material` === skuCodeRaw — NEVER via a sku id
// (CORE §13 id-space landmine); raw-text fallback preserved.

const PROJECT_SMUS = new Set(["Retail Offtake", "Decorative Projects"]);

export async function GET(
  _req: Request,
  { params }: { params: { orderId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const orderId = Number(params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  }

  const DEALER_SELECT = {
    customerName: true,
    customerCode: true,
    isKeyCustomer: true,
    area: {
      select: {
        name: true,
        primaryRoute: { select: { name: true } },
        deliveryType: { select: { name: true } },
      },
    },
  } as const;

  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    include: {
      customer: { select: DEALER_SELECT },
      shipToOverrideCustomer: { select: DEALER_SELECT },
      dispatchWindow: { select: { id: true, windowTime: true } },
      pickAssignment: {
        select: { picker: { select: { name: true } }, checkedBy: { select: { name: true } } },
      },
      statusLogs: {
        orderBy: { createdAt: "desc" },
        include: { changedBy: { select: { name: true } } },
      },
    },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Bill-to name/code from the latest import_raw_summary row for this OBD.
  const summary = await prisma.import_raw_summary.findFirst({
    where: { obdNumber: order.obdNumber },
    orderBy: { createdAt: "desc" },
    select: { billToCustomerId: true, billToCustomerName: true },
  });

  // ── Line items — raw lines matched on obdNumber (no FK), resolved via v2 ────
  const rawLines = await prisma.import_raw_line_items.findMany({
    where: { obdNumber: order.obdNumber, lineStatus: "active" },
    select: { id: true, skuCodeRaw: true, skuDescriptionRaw: true, unitQty: true, volumeLine: true, isTinting: true },
    orderBy: { lineId: "asc" },
  });

  const codes = Array.from(new Set(rawLines.map((l) => l.skuCodeRaw).filter((c): c is string => Boolean(c))));
  // Resolve by `material` (the SAP code), NOT the enrichedLineItem.sku relation —
  // that FK rides skuId, still pointing at the OLD sku_master with a disjoint id
  // space, so following it renders a confidently WRONG name/pack (CORE §13). No
  // isPrimary filter — a duplicate twin is still a real SAP code.
  const catalogRows =
    codes.length > 0
      ? await prisma.sku_master_v2.findMany({
          where: { material: { in: codes } },
          select: { material: true, description: true, packCode: true, unit: true },
        })
      : [];
  const catalogByCode = new Map(catalogRows.map((r) => [r.material, r]));

  const lines: FloorDetailLine[] = rawLines.map((l) => {
    const cat = catalogByCode.get(l.skuCodeRaw);
    return {
      id: l.id,
      sku: l.skuCodeRaw,
      name: cat?.description ?? l.skuDescriptionRaw ?? null,
      // Blank pack stays blank rather than guessing (CLAUDE_PICKING §7).
      pack: cat ? formatPack(cat.packCode, cat.unit) : null,
      qty: l.unitQty,
      litres: l.volumeLine ?? 0,
      isTint: l.isTinting,
    };
  });
  // Gift lines OUT OF SCOPE — plain sum, no gift exclusion.
  const totalLitres = lines.reduce((s, l) => s + l.litres, 0);

  // ── Activity — real logs, newest first ─────────────────────────────────────
  const activity: FloorActivityEntry[] = order.statusLogs.map((log) => ({
    at: log.createdAt.toISOString(),
    note: log.note,
    fromStage: log.fromStage,
    toStage: log.toStage,
    actorName: log.changedBy?.name ?? null,
  }));

  // The dispatch engine's auto-slot assignment writes NO log row (adding one
  // would fire a second orders.update and break the live-sync marker). Derive a
  // single synthetic entry from dispatchSlotSource + dispatchSlotRuleId; the
  // Activity component labels it as coming from enrichment. `at` is null — there
  // is no real timestamp for it — so it renders at the bottom without a clock.
  if (order.dispatchSlotSource === "auto" && order.dispatchSlotRuleId) {
    activity.push({
      at: null,
      note: null,
      fromStage: null,
      toStage: null,
      actorName: null,
      synthetic: true,
    });
  }

  const dealer = order.shipToOverrideCustomer ?? order.customer;
  const isSite = order.smu !== null && PROJECT_SMUS.has(order.smu) && order.shipToOverrideCustomerId === null;

  const detail: FloorDetail = {
    orderId: order.id,
    obdNumber: order.obdNumber,
    obdDateTime: (order.orderDateTime ?? order.obdEmailDate)?.toISOString() ?? null,
    orderType: order.orderType,
    workflowStage: order.workflowStage,
    dispatchStatus: order.dispatchStatus,

    shipToName: dealer?.customerName ?? order.shipToCustomerName ?? "(Unmatched)",
    shipToCode: dealer?.customerCode ?? order.shipToCustomerId ?? null,
    isShipToOverride: order.shipToOverrideCustomerId !== null,
    isKeyCustomer: dealer?.isKeyCustomer ?? false,
    priorityLevel: order.priorityLevel,
    isTint: order.orderType === "tint",
    isSite,

    isAssigned: order.workflowStage === "pick_assigned",
    isDone: order.workflowStage === "pick_done",
    isChecked: order.workflowStage === "pick_checked",
    pickerName: order.pickAssignment?.picker?.name ?? null,
    checkedByName: order.pickAssignment?.checkedBy?.name ?? null,

    billToName: summary?.billToCustomerName ?? null,
    billToCode: summary?.billToCustomerId ?? null,
    overrideName: order.shipToOverrideCustomer?.customerName ?? null,
    overrideCode: order.shipToOverrideCustomer?.customerCode ?? null,
    customerName: order.customer?.customerName ?? order.shipToCustomerName ?? null,
    customerCode: order.customer?.customerCode ?? order.shipToCustomerId ?? null,

    soNumber: order.soNumber,
    invoiceNo: order.invoiceNo,
    invoiceDate: order.invoiceDate?.toISOString() ?? null,

    deliveryType: dealer?.area?.deliveryType?.name ?? null,
    smu: order.smu,
    route: dealer?.area?.primaryRoute?.name ?? null,
    area: dealer?.area?.name ?? null,

    dispatchTargetDate: order.dispatchTargetDate ? order.dispatchTargetDate.toISOString().slice(0, 10) : null,
    dispatchWindowTime: order.dispatchWindow?.windowTime ?? null,
    dispatchWindowId: order.dispatchWindow?.id ?? null,
    materialType: order.materialType,

    dispatchSlotSource: order.dispatchSlotSource,
    dispatchSlotRuleId: order.dispatchSlotRuleId,

    lines,
    totalLitres,
    activity,
  };

  return NextResponse.json({ detail });
}
