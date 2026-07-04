import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  const drops = rows.map((r) => ({
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

  const totals = rows.reduce(
    (acc, r) => ({
      articles: acc.articles + toNum(r.noArticle),
      qty: acc.qty + toNum(r.disQty),
      weight: acc.weight + toNum(r.netWeight),
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
    totals,
  });
}
