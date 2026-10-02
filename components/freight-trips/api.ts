// components/freight-trips/api.ts — the screen's ONLY network calls.
//
// 🔴 EVERY call goes to /api/freight-trips/* — never /api/floor/*. A freight
// screen writes freight tables only (lib/freight-trips/bills.ts header).
// Types are imported TYPE-ONLY from the server modules (erased at build).

import type { FloorHoldRow, FloorScope } from "@/lib/floor/types";
import type { FreightTripDetail, FreightTripSummary } from "@/lib/freight-trips/queries";
import type { FreightOptions } from "@/lib/freight-trips/options";
import type { BillSkip } from "@/lib/freight-trips/bills";

export type { FreightTripDetail, FreightTripSummary, FreightOptions, BillSkip };
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

export function fetchTrips(date: string) {
  return call<{ date: string; trips: FreightTripSummary[] }>(`${BASE}?date=${encodeURIComponent(date)}`);
}

export function fetchPool(scope: FloorScope) {
  return call<{ rows: FloorHoldRow[]; count: number }>(`${BASE}/pool?scope=${encodeURIComponent(scope)}`);
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
