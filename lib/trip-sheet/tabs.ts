// lib/trip-sheet/tabs.ts
//
// The /trip-sheets delivery-type tabs (2026-10-10): Local · UPC · IGT / Cross.
// Each maps to a Floor scope, so a trip lands on the tab Floor would list it
// under (lib/floor/scope.ts tripInScope — the type it was NUMBERED under; I- and
// C- trips share "IGT / Cross"). `?type=` carries the key in the URL.
//
// PURE — imported by the server pages AND the client list (a function exported
// from a "use client" file cannot be called on the server).

import type { FloorScope } from "@/lib/floor/types";

export type TripSheetTab = "local" | "upc" | "igt";

export const TRIP_SHEET_TABS: { key: TripSheetTab; label: string; scope: Exclude<FloorScope, "All"> }[] = [
  { key: "local", label: "Local", scope: "Local" },
  { key: "upc", label: "UPC", scope: "Upcountry" },
  { key: "igt", label: "IGT / Cross", scope: "IGT / Cross" },
];

/** `?type=` → a tab; anything unknown or missing → Local (the default). */
export function parseTripSheetTab(v: string | undefined | null): TripSheetTab {
  return v === "upc" || v === "igt" ? v : "local";
}

export function scopeOfTab(tab: TripSheetTab): Exclude<FloorScope, "All"> {
  return TRIP_SHEET_TABS.find((t) => t.key === tab)!.scope;
}
