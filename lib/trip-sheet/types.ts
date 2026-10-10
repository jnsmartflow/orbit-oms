// lib/trip-sheet/types.ts
//
// THE ORBIT TRIP SHEET — view model (2026-10-09). One A4 sheet + a WhatsApp
// image, built from Orbit's own trips (trips / trip_drops / orders). Spec:
// docs/prompts/drafts/web-update-2026-10-09-trip-sheet.md §3–§4; mockup:
// docs/mockups/trip-sheet/trip-sheet-mockup.html.
//
// 🔴 NOT the NTS trip sheet. Nothing here may import lib/trip-report/* or
// components/trip-report/* — that mirror is due for retirement, and this module
// must survive it. Trip rules stay owned by CLAUDE_FLOOR_TRIPS.md.
//
// PURE — types only, safe to import from a client component.

/** Where a bill's article count came from. */
export type ArticleSource =
  /** pick_assignments.articleCount — the supervisor's typed count. */
  | "typed"
  /** import_obd_query_summary.totalArticle — SAP's count (or none at all). */
  | "sap";

export type TripSheetPending = null | "picking" | "vehicle" | "both";

export interface TripSheetHeader {
  id: number;
  tripNumber: string;
  /** YYYY-MM-DD (the @db.Date, read UTC-anchored). */
  tripDate: string;
  /** manualDispatchAt as IST "HH:MM", else the dispatch window's time, else null. */
  timeLabel: string | null;
  /** The stored delivery type, or the mix label ("Local + Upcountry") on a mixed trip. */
  typeLabel: string;
  /** vehicle_master.vehicleNo, else adhocVehicleNo, else null. */
  vehicleNo: string | null;
  /** Trip SNAPSHOTS (CLAUDE_FLOOR_TRIPS §15.9) — never read through vehicleId. */
  driverName: string | null;
  driverPhone: string | null;
  /** transporter_master.name, or null when the trip has none. */
  transporterName: string | null;
  /** A Hand trip (dealer collects) — spec §3: no sheet, no Share. The UI decides; the loader still answers. */
  isHand: boolean;
  /**
   * What the trip is still waiting on — DATA ONLY, displayed nowhere (owner,
   * 2026-10-10: the PROVISIONAL mark was removed from the sheet and the phone).
   * "vehicle" = no vehicleId and no typed plate; "picking" = not isReady;
   * "both"; null = neither.
   */
  pending: TripSheetPending;
  /** The trip's own isReady (lib/trips/queries.ts), exposed for the list chip. */
  isReady: boolean;
}

export interface TripSheetBill {
  orderId: number;
  /** THE number shown: invoiceNo, else the OBD. Never both (spec §3). */
  number: string;
  obd: string;
  invoiceNo: string | null;
  /** SAP GIFTS (lib/orders/gift.ts) — shown, adds 0 to the L/KG totals. */
  gift: boolean;
  /** A re-delivery carried on THIS truck (trip_redeliveries), not one of the trip's own bills. */
  redel: boolean;
  articles: number | null;
  articleSource: ArticleSource;
  /** The bill's own litres / kg (bill-facts billQuantities). kg null = unknown. */
  litres: number | null;
  kg: number | null;
  /**
   * The billed dealer is not the place the truck delivers to — decided on CODES:
   * SAP's bill-to code vs the effective delivery point's code (drop-key's
   * effectiveCustomerId → delivery_point_master.customerCode, else SAP's ship-to
   * code). False when the bill-to code is unknown.
   */
  shipToChanged: boolean;
  /** SAP's bill-to name (import_raw_summary), or null when the import has none. */
  billToName: string | null;

  // ── PHONE ONLY (2026-10-10). Never printed on the A4 sheet, never in the caption. ──
  /** Sales Officer — Floor's own rule, salesOfficerByOrder (lib/floor/queries.ts). */
  soName: string | null;
  /** pick_assignments.picker_id → users.name. Null on a Direct Loaded bill (no picker). */
  pickerName: string | null;
  /** Who checked it: pick_assignments.checked_by_id → users.name, or the Direct Loading
   *  supervisor (orders.directLoadedById). Null = not checked yet. */
  checkerName: string | null;
  /** Sent to pick_checked with no picker (Schema v27.52). */
  directLoaded: boolean;
}

export interface TripSheetStop {
  /** 1..N in PRINTED order — not dropSeq, which is the order stops were added. */
  no: number;
  dropId: number;
  dropSeq: number;
  /** trip_drops.customerName — the delivery point (snapshot). */
  name: string;
  /** trip_drops.areaName (snapshot). */
  area: string | null;
  bills: TripSheetBill[];
}

export interface TripSheetTotals {
  stops: number;
  bills: number;
  /** All shown bills (typed count, else SAP). */
  articles: number;
  /** Gifts add 0; a bill with no litres adds 0. */
  litres: number;
  /** Gifts add 0; an unknown kg adds nothing and is counted below. */
  kg: number;
  kgUnknownCount: number;
}

export interface TripSheet {
  header: TripSheetHeader;
  stops: TripSheetStop[];
  totals: TripSheetTotals;
  /** Unique stop areas in printed order — the caption's last line. */
  captionAreas: string[];
  /** Unique SO names over the shown bills, in printed order — phone only. */
  soNames: string[];
}

/** One row of the phone list (/trip-sheets). Same numbers as the trip's sheet. */
export interface TripSheetListRow {
  id: number;
  tripNumber: string;
  /** YYYY-MM-DD — search groups its results by it. */
  tripDate: string;
  /** The type the trip was NUMBERED under — what the tabs read (lib/floor/scope.ts tripInScope). */
  deliveryTypeName: string | null;
  /** Its stored type ∪ its bills' types — the mix label. Kept for tripInScope's shape. */
  deliveryTypes: string[];
  /** Gifts excluded; unknown kg adds nothing (sheet totals rule). */
  kg: number;
  /** Unique SO names over the trip's shown bills (phone only). */
  soNames: string[];
  vehicleNo: string | null;
  driverFirstName: string | null;
  timeLabel: string | null;
  /** TripSummary.areaLabel (lib/trips/queries.ts deriveAreaLabel) — e.g. "Pandesara +5"; null when no stop has an area. */
  areaLabel: string | null;
  stops: number;
  bills: number;
  litres: number;
  isReady: boolean;
  isHand: boolean;
  typeLabel: string;
}

/** Which field a search hit came from — shown as "matched: {label} {value}". */
export type TripSheetMatchField = "trip" | "vehicle" | "driver" | "stop" | "dealer" | "so" | "invoice" | "obd";

/** One search hit: the trip's list row plus what matched. */
export interface TripSheetSearchHit extends TripSheetListRow {
  match: { field: TripSheetMatchField; value: string };
}
