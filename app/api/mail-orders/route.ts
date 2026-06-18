import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { splitDeliveryRemarks } from "@/lib/mail-orders/utils";
import { getTagSettings } from "@/lib/hide/tag-settings";
import { buildComboSiblings } from "@/lib/mail-orders/table-c";

export const dynamic = "force-dynamic";

/* ── IST day-range helper ──────────────────────────────────── */

function getISTDayRange(dateStr?: string): { start: Date; end: Date } {
  const istOffset = 5.5 * 60 * 60 * 1000; // IST = UTC+5:30

  let year: number, month: number, day: number;
  if (dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    year = y;
    month = m;
    day = d;
  } else {
    const istNow = new Date(Date.now() + istOffset);
    year = istNow.getUTCFullYear();
    month = istNow.getUTCMonth() + 1;
    day = istNow.getUTCDate();
  }

  // Midnight IST → UTC
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - istOffset);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/* ── GET handler ───────────────────────────────────────────── */

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date") ?? undefined;
  const statusParam = searchParams.get("status") ?? "all";

  const { start, end } = getISTDayRange(dateParam);

  const where: Record<string, unknown> = {
    receivedAt: { gte: start, lt: end },
  };
  if (statusParam !== "all") {
    where.status = statusParam;
  }

  const orders = await prisma.mo_orders.findMany({
    where,
    include: {
      lines: {
        include: {
          lineStatus: {
            select: {
              found: true,
              reason: true,
              altSkuCode: true,
              altSkuDescription: true,
              note: true,
            },
          },
        },
        orderBy: { lineNumber: "asc" },
      },
      remarks_list: { orderBy: { lineNumber: "asc" } },
      punchedBy: { select: { id: true, name: true } },
    },
    orderBy: { receivedAt: "desc" },
  });

  // Ship-to code collection — parse deliveryRemarks once per order with
  // shipToOverride. Result cached so the response-build step does not re-parse.
  const shipToCodeByOrderId = new Map<number, string | null>();
  const uniqueShipToCodes = new Set<string>();
  for (const order of orders) {
    if (!order.shipToOverride) {
      shipToCodeByOrderId.set(order.id, null);
      continue;
    }
    const parsed = splitDeliveryRemarks(order.deliveryRemarks, true);
    shipToCodeByOrderId.set(order.id, parsed.shipToCode);
    if (parsed.shipToCode) uniqueShipToCodes.add(parsed.shipToCode);
  }

  // Batch lookup: area + deliveryType + route for exact-matched customers
  const customerCodes = orders
    .filter((o) => o.customerMatchStatus === "exact" && o.customerCode)
    .map((o) => o.customerCode!);
  const uniqueCodes = Array.from(new Set(customerCodes));

  const customerLookupMap = new Map<string, { area: string | null; deliveryType: string | null; route: string | null }>();
  if (uniqueCodes.length > 0) {
    const kwRows = await prisma.mo_customer_keywords.findMany({
      where: { customerCode: { in: uniqueCodes } },
      select: { customerCode: true, area: true, deliveryType: true, route: true },
    });
    for (const row of kwRows) {
      if (!customerLookupMap.has(row.customerCode)) {
        customerLookupMap.set(row.customerCode, {
          area: row.area,
          deliveryType: row.deliveryType,
          route: row.route,
        });
      }
    }
  }

  // Ship-to lookup — sibling batch to bill-to. Sequential await (no $transaction).
  // Skipped entirely when no ship-to codes were collected.
  const shipToLookupMap = new Map<string, { area: string | null; deliveryType: string | null }>();
  if (uniqueShipToCodes.size > 0) {
    const shipToKwRows = await prisma.mo_customer_keywords.findMany({
      where: { customerCode: { in: Array.from(uniqueShipToCodes) } },
      select: { customerCode: true, area: true, deliveryType: true },
    });
    for (const row of shipToKwRows) {
      if (!shipToLookupMap.has(row.customerCode)) {
        shipToLookupMap.set(row.customerCode, {
          area: row.area,
          deliveryType: row.deliveryType,
        });
      }
    }
  }

  // Alt-SKU twins — every v2 SKU sharing a line's product|baseColour|packCode
  // combo. Built ONCE per request from v2 stock (sequential await, no
  // $transaction — CORE §3), same batch shape as customerLookupMap above.
  // Purely additive: the billed skuCode stays primary; altSkus is informational.
  const comboSkuRows = await prisma.mo_sku_lookup_v2.findMany({
    select: { material: true, product: true, baseColour: true, packCode: true, description: true, isPrimary: true },
  });
  const { materialToCombo, comboToSiblings } = buildComboSiblings(comboSkuRows);
  const siblingsFor = (skuCode: string | null): { code: string; description: string }[] => {
    if (!skuCode) return [];
    const combo = materialToCombo.get(skuCode);
    if (!combo) return [];
    return (comboToSiblings.get(combo) ?? []).filter((s) => s.code !== skuCode);
  };

  const enrichedOrders = orders.map((o) => {
    const lookup = o.customerCode ? customerLookupMap.get(o.customerCode) : undefined;
    const shipToCode = shipToCodeByOrderId.get(o.id) ?? null;
    const shipToLookup = shipToCode ? shipToLookupMap.get(shipToCode) : undefined;
    return {
      ...o,
      customerArea: lookup?.area ?? null,
      customerDeliveryType: lookup?.deliveryType ?? null,
      customerRoute: lookup?.route ?? null,
      shipToArea: shipToLookup?.area ?? null,
      shipToDeliveryType: shipToLookup?.deliveryType ?? null,
      // Additive: append altSkus per line; every existing line field preserved.
      lines: o.lines.map((l) => ({ ...l, altSkus: siblingsFor(l.skuCode) })),
    };
  });

  // Tag visibility (Feature B) — disabled tag keys (isEnabled === false) so the
  // client can suppress the matching badges. Sequential await, no $transaction.
  const tagSettings = await getTagSettings();
  const disabledTags = Object.entries(tagSettings)
    .filter(([, enabled]) => enabled === false)
    .map(([key]) => key);

  return NextResponse.json({ orders: enrichedOrders, disabledTags });
}
