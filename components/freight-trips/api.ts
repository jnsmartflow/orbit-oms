// components/freight-trips/api.ts — the screen's ONLY network calls.
//
// 🔴 EVERY call goes to /api/freight-trips/* — never /api/floor/*. A freight
// screen writes freight tables only (lib/freight-trips/bills.ts header).
// Types are imported TYPE-ONLY from the server modules (erased at build).

import type { FloorRouteClub, FloorScope } from "@/lib/floor/types";
import type { FreightPoolRow } from "@/lib/freight-trips/pool";
import type { FreightTripDetail, FreightTripSummary } from "@/lib/freight-trips/queries";
import type { FreightOptions } from "@/lib/freight-trips/options";
import type { BillSkip } from "@/lib/freight-trips/bills";

export type { FreightTripDetail, FreightTripSummary, FreightOptions, BillSkip, FreightPoolRow };
export type { FreightBillRow, FreightStop } from "@/lib/freight-trips/queries";

const BASE = "/api/freight-trips";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

function json(method: string, payload: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

/** No date: every freight trip, any date (the rail). With a date: that day only. */
export function fetchTrips(date?: string) {
  return call<{ date: string | null; trips: FreightTripSummary[] }>(
    date ? `${BASE}?date=${encodeURIComponent(date)}` : BASE,
  );
}

/** "2026-10-02" → "02 Oct" (the trip's @db.Date, read as UTC — no IST shift). */
export function shortDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00.000Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}

/** The pool with route ids + stop keys, and Floor's route clubs (for the route cards). */
export function fetchPool(scope: FloorScope) {
  return call<{ rows: FreightPoolRow[]; count: number; clubs: FloorRouteClub[] }>(
    `${BASE}/pool?scope=${encodeURIComponent(scope)}`,
  );
}

export function fetchTrip(id: number) {
  return call<{ trip: FreightTripDetail }>(`${BASE}/${id}`);
}

export function fetchOptions() {
  return call<FreightOptions>(`${BASE}/options`);
}

export interface TripFields {
  vehicleId: number | null;
  adhocVehicleNo: string | null;
  transporterId: number | null;
  driverName: string | null;
  driverPhone: string | null;
  note: string | null;
  /** ISO WITH an offset (`…+05:30`, manualDispatchIso) — required by both routes (2026-10-04). */
  manualDispatchAt: string;
}

export function createTrip(tripDate: string, fields: TripFields, orderIds: number[]) {
  return call<{ trip: FreightTripDetail; added: number[]; skipped: BillSkip[] }>(
    BASE,
    json("POST", { tripDate, ...fields, orderIds }),
  );
}

export function patchTrip(id: number, fields: Partial<TripFields>) {
  return call<{ trip: FreightTripDetail; changed: boolean }>(`${BASE}/${id}`, json("PATCH", fields));
}

export function addBills(id: number, orderIds: number[]) {
  return call<{ added: number[]; skipped: BillSkip[] }>(`${BASE}/${id}/bills`, json("POST", { action: "add", orderIds }));
}

export function removeBills(id: number, orderIds: number[]) {
  return call<{ removed: number[]; skipped: BillSkip[] }>(`${BASE}/${id}/bills`, json("POST", { action: "remove", orderIds }));
}

export function cancelTrip(id: number) {
  return call<{ trip: FreightTripDetail | null; alreadyCancelled?: boolean }>(`${BASE}/${id}/cancel`, { method: "POST" });
}

/** "2026-10-02" — today's date in IST. */
export function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** A Date (from the header stepper) as its IST calendar day. */
export function istDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
