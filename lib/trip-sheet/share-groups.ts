// lib/trip-sheet/share-groups.ts
//
// TRIP SHEETS — PER-GROUP SHARE CHIPS (2026-10-17, Schema v27.71). Which
// WhatsApp group(s) a bill's sheet goes to, and the one-group sheet itself.
//
// A bill's group is decided by the TRIP's stored type (the letter it was
// numbered under — lib/floor/scope.ts, the tab rule), then by the bill:
//
//   IGT / Cross trip          → no group at all (no chips on that trip)
//   project bill              → project   (smu "Decorative Projects", or the
//                                          SO's shareGroup = 'project'; both trip types)
//   UPC trip, anything else   → upc
//   Local trip:
//     SO shareGroup city1     → city1
//     SO shareGroup city2     → city2
//     SO shareGroup city_both → city1 + city2   (the telecaller, Kundan)
//     Telecaller mailbox bill → city1 + city2
//     no salesman at all      → city1 + city2
//     anything else           → other   (shareGroup 'upc', or a named SO with
//                                          no shareGroup / no master match)
//
// The SO is Floor's salesOfficerByOrder (lib/floor/queries.ts) — not re-derived
// here; shareGroup is sales_officer_master."shareGroup" by its id.
//
// PURE — client-safe. No prisma, no server imports.

import { inScope } from "@/lib/floor/scope";
import { summariseStops } from "./totals";
import type { ShareGroupKey, TripSheet, TripSheetStop } from "./types";

/** Chip order, everywhere. */
export const SHARE_GROUP_KEYS: readonly ShareGroupKey[] = ["city1", "city2", "upc", "project", "other"];

export const SHARE_GROUP_LABEL: Record<ShareGroupKey, string> = {
  city1: "City 1",
  city2: "City 2",
  upc: "UPC",
  project: "Project",
  other: "Other",
};

export function isShareGroupKey(v: unknown): v is ShareGroupKey {
  return typeof v === "string" && (SHARE_GROUP_KEYS as readonly string[]).includes(v);
}

/** sales_officer_master."shareGroup" — the live CHECK's vocabulary. */
export type SoShareGroup = "city1" | "city2" | "upc" | "project" | "city_both";

const SO_SHARE_GROUPS: readonly string[] = ["city1", "city2", "upc", "project", "city_both"];

/** A stored value → the vocabulary; anything else (incl. NULL) → null = not mapped. */
export function parseSoShareGroup(v: string | null | undefined): SoShareGroup | null {
  return v && SO_SHARE_GROUPS.includes(v) ? (v as SoShareGroup) : null;
}

const PROJECT_SMU = "Decorative Projects";

/** Which kind of chips a trip gets, by its STORED type; null = none (IGT, Cross, untyped). */
export function tripShareKind(deliveryTypeName: string | null): "local" | "upc" | null {
  if (inScope(deliveryTypeName, "Local")) return "local";
  if (inScope(deliveryTypeName, "Upcountry")) return "upc";
  return null;
}

export interface ShareGroupBillInput {
  /** orders.smu (the SAP division name). */
  smu: string | null;
  /** Floor's SO source: "telecaller" = a depot mailbox; null = no salesman at all. */
  soSource: "master" | "mail" | "telecaller" | null;
  /** sales_officer_master."shareGroup" of the bill's SO, when the SO is a known person. */
  shareGroup: SoShareGroup | null;
}

/** The group key(s) of ONE bill on a trip of `kind`. Never empty unless kind is null. */
export function billShareGroups(kind: "local" | "upc" | null, bill: ShareGroupBillInput): ShareGroupKey[] {
  if (kind === null) return [];
  if (bill.smu === PROJECT_SMU || bill.shareGroup === "project") return ["project"];
  if (kind === "upc") return ["upc"];
  if (bill.shareGroup === "city1") return ["city1"];
  if (bill.shareGroup === "city2") return ["city2"];
  if (bill.shareGroup === "city_both") return ["city1", "city2"];
  if (bill.soSource === "telecaller" || bill.soSource === null) return ["city1", "city2"];
  return ["other"];
}

/** The groups that have at least one bill on this sheet, in chip order. */
export function sheetShareGroups(sheet: TripSheet): ShareGroupKey[] {
  const present = new Set<ShareGroupKey>();
  for (const s of sheet.stops) for (const b of s.bills) for (const k of b.shareGroups) present.add(k);
  return SHARE_GROUP_KEYS.filter((k) => present.has(k));
}

/** The unique order ids of one group's bills — what the share log snapshots. */
export function groupOrderIds(sheet: TripSheet, key: ShareGroupKey): number[] {
  const ids = new Set<number>();
  for (const s of sheet.stops) for (const b of s.bills) if (b.shareGroups.includes(key)) ids.add(b.orderId);
  return Array.from(ids).sort((a, b) => a - b);
}

/**
 * One group's sheet: only that group's bills, empty stops dropped, stops
 * renumbered 1..N in the same printed order, totals / caption areas / SO line
 * recomputed by the ONE summariser the loader uses. The header is unchanged.
 * Never mutates `sheet`.
 */
export function filterSheet(sheet: TripSheet, key: ShareGroupKey): TripSheet {
  const stops: TripSheetStop[] = [];
  for (const s of sheet.stops) {
    const bills = s.bills.filter((b) => b.shareGroups.includes(key));
    if (bills.length > 0) stops.push({ ...s, bills });
  }
  return { header: sheet.header, ...summariseStops(stops) };
}
