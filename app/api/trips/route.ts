import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTodayIST } from "@/lib/dates";

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

    const areas = Array.from(
      new Set(group.map((r) => r.dlRoute).filter((v): v is string => !!v && v.trim() !== "")),
    );

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
      dropCount: group.length,
      totalQty: group.reduce((sum, r) => sum + toNum(r.disQty), 0),
      totalWeight: group.reduce((sum, r) => sum + toNum(r.netWeight), 0),
      deliveryAreas: areas.join(", "),
    };
  });

  trips.sort((a, b) => {
    if (a.disTime === null && b.disTime === null) return 0;
    if (a.disTime === null) return 1;
    if (b.disTime === null) return -1;
    return b.disTime.localeCompare(a.disTime);
  });

  return NextResponse.json({ date, tripCount: trips.length, trips });
}
