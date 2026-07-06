import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTodayIST } from "@/lib/dates";
import { resolveDeliveryArea, isPromoRow } from "@/lib/trip-report/display";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/trips — read-only NTS trip report, grouped into trips by tripNo.
// Standalone: reads only trip_report, never touches orders/OBD tables.
//
// Query params:
//   date=YYYY-MM-DD   IST calendar date (default = today IST)
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

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? getTodayIST();
  const disDate = new Date(date);

  const rows = await prisma.tripReport.findMany({
    where: {
      disDate,
      tripNo: { not: null },
      NOT: { tripNo: "0" },
    },
    orderBy: [{ disTime: "asc" }, { tripNo: "asc" }],
  });

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.tripNo as string;
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  const trips = Array.from(groups.entries()).map(([tripNo, group]) => {
    const first = group[0];

    const disTimes = group
      .map((r) => r.disTime)
      .filter((t): t is string => !!t && t.trim() !== "");
    const minDisTime = disTimes.length > 0 ? disTimes.reduce((a, b) => (a < b ? a : b)) : null;

    // RULE A delivery locations, unique, in deliveryNo order (dlRoute ignored).
    // deliveryNo is the deterministic order shared with the WhatsApp caption —
    // disTime is constant within a trip, so the raw fetch order is a tie.
    const orderedForAreas = [...group].sort((a, b) =>
      (a.deliveryNo ?? "").localeCompare(b.deliveryNo ?? ""),
    );
    const seenAreas = new Set<string>();
    const areas: string[] = [];
    for (const r of orderedForAreas) {
      const area = resolveDeliveryArea(r);
      if (area && !seenAreas.has(area)) {
        seenAreas.add(area);
        areas.push(area);
      }
    }

    return {
      tripNo,
      deliveryType: first.deliveryType,
      disDate: date,
      disTime: minDisTime,
      vehicleNo: first.vehicleNo,
      vehType: first.vehType,
      vModal: first.vModal,
      driverName: first.driverName,
      driverMobile: first.driverMobile,
      transporter: first.transporter,
      dieselAmt: first.dieselAmt,
      dropCount: countDrops(group),
      // LT/KG totals are INV-only by design — PROMO rows still show in the trip
      // but are NOT added to the litre/weight totals. Drops count ALL rows.
      totalQty: group.reduce((sum, r) => (isPromoRow(r) ? sum : sum + toNum(r.disQty)), 0),
      totalWeight: group.reduce((sum, r) => (isPromoRow(r) ? sum : sum + toNum(r.netWeight)), 0),
      deliveryAreas: areas.join(", "),
    };
  });

  // SORT 1 — newest trip first: dispatch time DESC (nulls last), tiebreak by the
  // trip-no NUMBER part DESC (L42 above L41), then the full tripNo for stability
  // (letter prefix stays a last-resort grouping — it never overrides the time).
  const tripNoNumeric = (t: string): number => {
    const m = t.match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  };
  trips.sort((a, b) => {
    if (a.disTime !== b.disTime) {
      if (a.disTime === null) return 1;
      if (b.disTime === null) return -1;
      return b.disTime.localeCompare(a.disTime);
    }
    const na = tripNoNumeric(a.tripNo);
    const nb = tripNoNumeric(b.tripNo);
    if (na !== nb) return nb - na;
    return a.tripNo.localeCompare(b.tripNo);
  });

  return NextResponse.json({ date, tripCount: trips.length, trips });
}
