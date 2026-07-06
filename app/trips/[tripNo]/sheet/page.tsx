import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TripSheetDocument } from "@/components/trip-report/trip-sheet-document";
import { TripSheetPrintButton } from "@/components/trip-report/trip-sheet-print-button";
import { isPromoRow, sortTripDropRows } from "@/lib/trip-report/display";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /trips/[tripNo]/sheet — printable A4 trip sheet (read-only).
// Standalone: reads only trip_report, never touches orders/OBD tables.
// Fetches via Prisma + auth, then renders the shared, prop-driven
// <TripSheetDocument> (components/trip-report/trip-sheet-document.tsx) — the
// SAME component the "Share WhatsApp" image-capture path uses, so the sheet
// stays pixel-identical between print and the shared PNG.
//
// Query params:
//   date=YYYY-MM-DD   required (tripNo repeats across days)
// ─────────────────────────────────────────────────────────────────────────────

function toNum(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = parseFloat(raw);
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

export default async function TripSheetPage({
  params,
  searchParams,
}: {
  params: { tripNo: string };
  searchParams: { date?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const date = searchParams.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[13px] text-gray-500">
        A valid ?date=YYYY-MM-DD query parameter is required.
      </div>
    );
  }

  const disDate = new Date(date);

  const rows = await prisma.tripReport.findMany({
    where: { tripNo: params.tripNo, disDate },
    orderBy: [{ deliveryNo: "asc" }, { sourceId: "asc" }],
  });

  if (rows.length === 0) notFound();

  const first = rows[0];
  // Articles counts ALL rows; LT (qty) + KG (weight) totals are INV-only by
  // design — PROMO rows still print in the table but aren't summed.
  const totals = rows.reduce(
    (acc, r) => ({
      articles: acc.articles + toNum(r.noArticle),
      qty: acc.qty + (isPromoRow(r) ? 0 : toNum(r.disQty)),
      weight: acc.weight + (isPromoRow(r) ? 0 : toNum(r.netWeight)),
    }),
    { articles: 0, qty: 0, weight: 0 },
  );

  return (
    <div className="min-h-screen bg-[#e5e7eb] py-6">
      {/* Screen-only action bar (.noprint) — lives outside #trip-sheet-print-area,
          so the global `body * { visibility: hidden }` print rule hides it automatically. */}
      <div className="max-w-[800px] mx-auto mb-3 flex items-center gap-2 px-4">
        <a
          href={`/trips/${encodeURIComponent(params.tripNo)}?date=${date}`}
          className="text-[12px] text-teal-600 hover:text-teal-700"
        >
          &larr; Back
        </a>
        <div className="flex-1" />
        <TripSheetPrintButton />
      </div>

      <TripSheetDocument
        printAreaId="trip-sheet-print-area"
        tripNo={params.tripNo}
        date={date}
        header={{
          deliveryType: first.deliveryType,
          disTime: first.disTime,
          vehicleNo: first.vehicleNo,
          driverName: first.driverName,
          driverMobile: first.driverMobile,
        }}
        drops={sortTripDropRows(rows).map((r) => ({
          deliveryNo: r.deliveryNo,
          custName: r.custName,
          siteName: r.siteName,
          siteArea: r.siteArea,
          otherDelAreaName: r.otherDelAreaName,
          custAreaName: r.custAreaName,
          remark: r.remark,
          noArticle: r.noArticle,
          disQty: r.disQty,
          netWeight: r.netWeight,
        }))}
        dropCount={countDrops(rows)}
        totals={totals}
      />
    </div>
  );
}
