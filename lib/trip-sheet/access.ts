// lib/trip-sheet/access.ts
//
// WHO MAY OPEN A TRIP SHEET — the one rule every /trip-sheets page and
// /api/trip-sheets route asks (2026-10-09): canView on `trip_sheet` OR `floor`
// (per-user ticks, CORE §5). `floor` is in the OR so the desk users who plan
// the trips can open their sheets before anyone is granted `trip_sheet`.
//
// SERVER-ONLY (lib/permissions resolves the session).

import { checkAnyPermission } from "@/lib/permissions";

export async function canViewTripSheets(roles: string[]): Promise<boolean> {
  if (await checkAnyPermission(roles, "trip_sheet", "canView")) return true;
  return checkAnyPermission(roles, "floor", "canView");
}
