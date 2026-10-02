// lib/freight-trips/status.ts — THE vocabulary of the Freight Trips module.
//
// CLIENT-SAFE: no Prisma, no I/O. Every route, query and (later) screen imports
// these; a hand-typed literal in a `where` is a defect waiting to match nothing
// (CORE §3, the status-string rule). Each list mirrors a LIVE CHECK in
// sql/2026-10-02-freight-trips.sql — change the CHECK first, then this file.

/** freight_trips.status — chk_freight_trips_status. */
export const FREIGHT_TRIP_STATUS = {
  active: "active",
  cancelled: "cancelled",
} as const;
export type FreightTripStatus = (typeof FREIGHT_TRIP_STATUS)[keyof typeof FREIGHT_TRIP_STATUS];

/** freight_trip_activity.action — chk_freight_trip_activity_action, all six. */
export const FREIGHT_ACTIONS = {
  created: "created",
  billsAdded: "bills_added",
  billsRemoved: "bills_removed",
  vehicleChanged: "vehicle_changed",
  detailsChanged: "details_changed",
  cancelled: "cancelled",
} as const;
export type FreightAction = (typeof FREIGHT_ACTIONS)[keyof typeof FREIGHT_ACTIONS];

/** freight_trip_bills.removedReason — chk_freight_trip_bills_removed_reason. */
export const REMOVED_REASON = {
  removed: "removed",
  tripCancelled: "trip_cancelled",
} as const;
export type RemovedReason = (typeof REMOVED_REASON)[keyof typeof REMOVED_REASON];
