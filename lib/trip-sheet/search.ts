// lib/trip-sheet/search.ts
//
// TRIP SHEETS SEARCH (2026-10-10) — find a trip from the last 14 days by
// anything a person on the phone remembers: trip number, vehicle, driver, stop
// (ship-to), billed dealer (bill-to), SO name, invoice or OBD.
//
// 🔴 READ-ONLY, SERVER-ONLY. Batched: a fixed set of IN-list reads for the
// whole window, the match in JS, then ONE summary batch + ONE sheet-core batch
// for the hits — never a query per trip or per date.
//
// Bills follow the sheet's rules: removed and held bills are out (a held bill
// is not on the truck). A re-delivered bill is found on its OWN first trip.

import { prisma } from "@/lib/prisma";
import { getTodayIST } from "@/lib/dates";
import { getTripSummariesByIds, parseTripDate } from "@/lib/trips/queries";
import { salesOfficerByOrder } from "@/lib/floor/queries";
import { loadBillToByObd } from "@/lib/reports/bill-facts";
import { displaySoName } from "@/lib/mail-orders/utils";
import { blank, listRowsFor, vehicleNoFor } from "./load";
import type { TripSheetMatchField, TripSheetSearchHit } from "./types";

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_WINDOW_DAYS = 14;
export const SEARCH_MAX_RESULTS = 50;

const TRIP_CANCELLED = "cancelled";

/** Lower-cased, and for numbers spaces / dashes dropped, so "gj05 ct 4488" finds GJ05CT4488. */
const norm = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "");

export async function searchTripSheets(q: string): Promise<TripSheetSearchHit[]> {
  const term = norm(q.trim());
  if (term.length < SEARCH_MIN_CHARS) return [];

  const today = parseTripDate(getTodayIST());
  const from = new Date(today.getTime() - (SEARCH_WINDOW_DAYS - 1) * 86_400_000);

  // 1. The window's trips. (No upper bound: a trip dated tomorrow is findable too.)
  const trips = await prisma.trips.findMany({
    where: { tripDate: { gte: from }, status: { not: TRIP_CANCELLED } },
    select: {
      id: true,
      tripNumber: true,
      tripDate: true,
      adhocVehicleNo: true,
      driverName: true,
      vehicle: { select: { vehicleNo: true } },
    },
  });
  if (trips.length === 0) return [];

  // 2. Their stops. 3. Their bills (sheet rules: not removed, not held).
  const drops = await prisma.trip_drops.findMany({
    where: { tripId: { in: trips.map((t) => t.id) } },
    select: { id: true, tripId: true, customerName: true },
  });
  const tripIdByDrop = new Map(drops.map((d) => [d.id, d.tripId]));
  const orders = drops.length
    ? await prisma.orders.findMany({
        where: {
          tripDropId: { in: drops.map((d) => d.id) },
          isRemoved: false,
          OR: [{ dispatchStatus: null }, { dispatchStatus: { not: "hold" } }],
        },
        select: {
          id: true,
          tripDropId: true,
          obdNumber: true,
          invoiceNo: true,
          smu: true,
          soNumber: true,
          customerId: true,
          shipToOverrideCustomerId: true,
        },
      })
    : [];

  // 4. Billed dealer. 5–6. SO names (Floor's rule, at most two reads).
  const billToByObd = await loadBillToByObd(orders.map((o) => o.obdNumber));
  const soByOrder = await salesOfficerByOrder(orders);

  // ── Match: the FIRST field that hits, in this order, per trip ─────────────
  const hit = new Map<number, { field: TripSheetMatchField; value: string }>();
  const consider = (tripId: number | undefined, field: TripSheetMatchField, value: string | null | undefined) => {
    if (tripId === undefined || hit.has(tripId)) return;
    const v = blank(value);
    if (v !== null && norm(v).includes(term)) hit.set(tripId, { field, value: v });
  };
  for (const t of trips) consider(t.id, "trip", t.tripNumber);
  for (const t of trips) consider(t.id, "vehicle", vehicleNoFor({ vehicleNo: t.vehicle?.vehicleNo ?? null, adhocVehicleNo: t.adhocVehicleNo }));
  for (const t of trips) consider(t.id, "driver", t.driverName);
  for (const d of drops) consider(d.tripId, "stop", d.customerName);
  const tripOf = (o: { tripDropId: number | null }) => (o.tripDropId !== null ? tripIdByDrop.get(o.tripDropId) : undefined);
  for (const o of orders) consider(tripOf(o), "dealer", billToByObd.get(o.obdNumber)?.name);
  for (const o of orders) consider(tripOf(o), "so", soByOrder.get(o.id)?.name);
  // The SO's long name too (2026-10-10): a bill shown as "Roopesh" is still found
  // by "Jha". The hit shows that long name, title-cased, "(JSW)" dropped.
  for (const o of orders) {
    const raw = soByOrder.get(o.id)?.rawName;
    consider(tripOf(o), "so", raw ? displaySoName(raw) : null);
  }
  for (const o of orders) consider(tripOf(o), "invoice", o.invoiceNo);
  for (const o of orders) consider(tripOf(o), "obd", o.obdNumber);
  if (hit.size === 0) return [];

  // Newest trip date first, then the newest created — the first 50.
  const dateById = new Map(trips.map((t) => [t.id, t.tripDate.getTime()]));
  const ids = Array.from(hit.keys())
    .sort((a, b) => (dateById.get(b) ?? 0) - (dateById.get(a) ?? 0) || b - a)
    .slice(0, SEARCH_MAX_RESULTS);

  // ONE summary batch + ONE sheet-core batch for the hits.
  const rows = await listRowsFor(await getTripSummariesByIds(ids));
  const rowById = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => {
      const r = rowById.get(id);
      const m = hit.get(id);
      return r && m ? { ...r, match: m } : null;
    })
    .filter((h): h is TripSheetSearchHit => h !== null);
}
