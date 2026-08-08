import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { splitDeliveryRemarks } from "@/lib/mail-orders/utils";
import { getTagSettings } from "@/lib/hide/tag-settings";
import { buildComboSiblings, type ComboSiblingMaps } from "@/lib/mail-orders/table-c";

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

/* ── Alt-SKU sibling maps — 5-minute in-process cache ──────── */

/**
 * Why this cache exists. The alt-SKU twin maps are built from an UNCONDITIONED
 * read of mo_sku_lookup_v2 (1,743 rows, live count 2026-08-08) — the whole
 * catalog, not the day's rows. The board polls this route every 30s
 * (mail-orders-page.tsx:270 `setInterval(loadOrders, 30_000)`), so the same
 * 1,743 rows were being re-read and re-indexed 120x/hour per open tab to serve
 * informational chips. Everything else in the handler is already day-scoped.
 *
 * The catalog is reference data maintained by one admin via SQL/CSV — it moves
 * a few times a year, not per request. A 5-minute TTL is the accepted trade:
 * a catalog edit surfaces within 5 minutes, never instantly, never not at all.
 *
 * SOFT cache, not a source of truth. Module-level = per warm Vercel instance;
 * a cold start rebuilds it once, which is correct. Deliberately NOT persisted,
 * NOT shared across instances, and NOT invalidated by catalog writes — a stale
 * alt-SKU chip is informational only (the billed skuCode stays primary,
 * lib/mail-orders/table-c.ts:234-236), so the worst case is a missing
 * suggestion for a few minutes.
 *
 * ⚠ SCOPE: this caches the read made by THIS route only. /po and /place-order
 * read the same table through their own routes (CORE §7.7) and are untouched.
 */
const COMBO_CACHE_TTL_MS = 5 * 60 * 1000;

let comboCache: { maps: ComboSiblingMaps; builtAt: number } | null = null;
// Single-flight guard: on a cold start several polls can land at once, and
// without this every one of them would run the same full-table read.
let comboInFlight: Promise<ComboSiblingMaps> | null = null;

async function getComboSiblings(): Promise<ComboSiblingMaps> {
  if (comboCache && Date.now() - comboCache.builtAt < COMBO_CACHE_TTL_MS) {
    return comboCache.maps;
  }
  if (comboInFlight) return comboInFlight;

  // Sequential await inside, never prisma.$transaction (CORE §3).
  const build = (async (): Promise<ComboSiblingMaps> => {
    const comboSkuRows = await prisma.mo_sku_lookup_v2.findMany({
      select: { material: true, product: true, baseColour: true, packCode: true, description: true, isPrimary: true },
    });
    const maps = buildComboSiblings(comboSkuRows);
    // Stamped AFTER the query returns, so a slow read doesn't shorten its own
    // usable window.
    comboCache = { maps, builtAt: Date.now() };
    return maps;
  })();

  comboInFlight = build;
  try {
    return await build;
  } finally {
    // Only the creator clears the slot, and only if it is still its own — a
    // failed build leaves no cache entry and the next request simply retries.
    if (comboInFlight === build) comboInFlight = null;
  }
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
      // Ship-to override dealer, resolved through the FK (2026-07-31).
      //
      // ADDITIVE — nothing below changes. The deliveryRemarks parse (:78-90)
      // and the mo_customer_keywords join (:115-131) stay exactly as they were:
      // they still feed shipToArea/shipToDeliveryType and the OFF path and
      // Table view still read only those. This relation is a NEW key on the
      // payload that only the Billing face consumes.
      //
      // Why the relation and not more text parsing: the billing ✎ pencil writes
      // shipToOverrideCustomerId and NOTHING ELSE — it never touches
      // deliveryRemarks — so the `[→ Name (Code)]` suffix the parse depends on
      // simply does not exist for an operator-set override. Same select shape as
      // Floor's DEALER_SELECT (app/api/floor/order/[orderId]/route.ts:35-46) so
      // the two screens resolve the same dealer the same way.
      //
      // `area` is a REQUIRED relation on delivery_point_master and
      // area.deliveryTypeId is required too, so name/area/deliveryType are
      // always present once the dealer resolves. isKeyCustomer is deliberately
      // NOT selected — Mail Orders already derives its key-dealer flag from the
      // BILL-TO code (:136-145) and a second source would only disagree.
      shipToOverrideCustomer: {
        select: {
          customerName: true,
          customerCode: true,
          area: {
            select: {
              name: true,
              deliveryType: { select: { name: true } },
              primaryRoute: { select: { name: true } },
            },
          },
        },
      },
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

  // Key dealer flag — sourced from delivery_point_master.isKeyCustomer.
  // Reuses the SAME uniqueCodes array built for the bill-to batch above (no
  // new code-collection pass). Sequential await, no $transaction (CORE §3).
  const keyDealerMap = new Map<string, boolean>();
  if (uniqueCodes.length > 0) {
    const keyDealerRows = await prisma.delivery_point_master.findMany({
      where: { customerCode: { in: uniqueCodes } },
      select: { customerCode: true, isKeyCustomer: true },
    });
    for (const row of keyDealerRows) {
      keyDealerMap.set(row.customerCode, row.isKeyCustomer);
    }
  }

  // Alt-SKU twins — every v2 SKU sharing a line's product|baseColour|packCode
  // combo. Served from the 5-minute module cache above (sequential await, no
  // $transaction — CORE §3); only a cold/expired cache hits the DB. Purely
  // additive: the billed skuCode stays primary; altSkus is informational.
  const { materialToCombo, comboToSiblings } = await getComboSiblings();
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
      isKeyCustomer: keyDealerMap.get(o.customerCode ?? "") ?? false,
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
