import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPromoRow, sortTripDropRows } from "@/lib/trip-report/display";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/trips/[tripNo] — read-only drop list for one trip on one date.
// Standalone: reads only trip_report, never touches orders/OBD tables.
//
// Query params:
//   date=YYYY-MM-DD   required (tripNo repeats across days)
// ─────────────────────────────────────────────────────────────────────────────

function toNum(value: string | null | undefined): number {
  if (!value) return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** 1 drop = 1 unique customer (by custCode). Null/blank custCode rows each count as 1. */
function countDrops(rows: { custCode: string | null }[]): number {
  const seen = new Set<string>();
  let count = 0;
  for (const r of rows) {
    const code = (r.custCode ?? "").trim();
    if (!code) {
      count++;
    } else if (!seen.has(code)) {
      seen.add(code);
      count++;
    }
  }
  return count;
}

export async function GET(
  req: Request,
  { params }: { params: { tripNo: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  if (!date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  const disDate = new Date(date);

  const rows = await prisma.tripReport.findMany({
    where: {
      tripNo: params.tripNo,
      disDate,
    },
    orderBy: [{ deliveryNo: "asc" }, { sourceId: "asc" }],
  });

  if (rows.length === 0) {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }

  const first = rows[0];

  // SORT 2 — group same-customer rows adjacent (shared helper; totals/dropCount
  // below stay order-independent so they read from the unsorted `rows`).
  const drops = sortTripDropRows(rows).map((r) => ({
    deliveryNo: r.deliveryNo,
    custName: r.custName,
    custCode: r.custCode,
    custAreaName: r.custAreaName,
    dlRoute: r.dlRoute,
    siteName: r.siteName,
    siteArea: r.siteArea,
    otherDelAreaName: r.otherDelAreaName,
    promoType: r.promoType,
    noArticle: r.noArticle,
    disQty: r.disQty,
    netWeight: r.netWeight,
  }));

  // Articles + drops count ALL rows. LT (qty) + KG (weight) totals are INV-only
  // by design — PROMO rows still appear in the table but aren't summed.
  const totals = rows.reduce(
    (acc, r) => ({
      articles: acc.articles + toNum(r.noArticle),
      qty: acc.qty + (isPromoRow(r) ? 0 : toNum(r.disQty)),
      weight: acc.weight + (isPromoRow(r) ? 0 : toNum(r.netWeight)),
    }),
    { articles: 0, qty: 0, weight: 0 },
  );

  return NextResponse.json({
    tripNo: params.tripNo,
    disDate: date,
    header: {
      deliveryType: first.deliveryType,
      disTime: first.disTime,
      vehicleNo: first.vehicleNo,
      vehType: first.vehType,
      vModal: first.vModal,
      driverName: first.driverName,
      driverMobile: first.driverMobile,
      transporter: first.transporter,
      dieselAmt: first.dieselAmt,
    },
    drops,
    dropCount: countDrops(rows),
    totals,
  });
}
