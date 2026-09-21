// lib/trips/vehicle-size.ts — a trip's VEHICLE SIZE (2026-09-21, owner).
//
// trips."vehicleSize" (sql/2026-09-21-trips-vehicle-size.sql): gc | ace | big,
// or null. The planner picks it on the Upcountry trip form (required there,
// New and Edit); Make trip on a load plan card sends the card's own size. The
// admin Load plan check reads it to count actual trucks by type — a trip
// without one (older trips, other delivery types) counts as "unknown".
//
// PURE — shared by the trip routes, the trip form and the check.

export const VEHICLE_SIZES = ["gc", "ace", "big"] as const;
export type VehicleSize = (typeof VEHICLE_SIZES)[number];

export const VEHICLE_SIZE_LABEL: Record<VehicleSize, string> = { gc: "GC", ace: "Ace", big: "Big" };

export const isVehicleSize = (v: unknown): v is VehicleSize =>
  typeof v === "string" && (VEHICLE_SIZES as readonly string[]).includes(v);

/** A request body value → { ok, value }: a size, or null to clear. */
export function parseVehicleSize(v: unknown): { ok: true; value: VehicleSize | null } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, value: null };
  return isVehicleSize(v) ? { ok: true, value: v } : { ok: false };
}

/** The one delivery type the size is asked for. */
export const VEHICLE_SIZE_DELIVERY_TYPE = "Upcountry";
