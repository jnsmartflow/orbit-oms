// lib/reports/trip-detail-old-workbook.ts
//
// The Trip Detail rows in the OLD NTS layout — the 26-column sheet the depot's
// existing workbooks were built against. Read by
// app/api/reports/trip-detail-old/route.ts and nothing else.
//
// 🔴 SERVER-ONLY (xlsx — see lib/ci/workbook.ts's header). Same library and
// version as trip-detail-workbook.ts.
//
// 🔴 EVERY CELL IS TEXT — numbers and dates included. The old file was all
// text and the sheets that read it depend on that; a real number or date here
// would change how their lookups match. Do not "improve" a column into a
// number. Unknown = no cell, except Mobile No., where the old file wrote "0".

import * as XLSX from "xlsx";
import type { TripDetailRow } from "./trip-detail-data";

/**
 * The 26 headers, character for character from the old file — INCLUDING the
 * "Deilvery No" typo and the trailing dots on "Vehicle No." / "Mobile No." /
 * "Del. Type". Downstream sheets key off these strings. Do not fix one.
 * Widths are cosmetic.
 */
const COLUMNS: { header: string; width: number }[] = [
  { header: "Trip No", width: 14 },
  { header: "Dispatch Date", width: 12 },
  { header: "Dispatch Time", width: 11 },
  { header: "Vehicle No.", width: 14 },
  { header: "Mobile No.", width: 13 },
  { header: "Driver Name", width: 18 },
  { header: "Transporter Name", width: 20 },
  { header: "Vehicle Model", width: 14 },
  { header: "Delivery Route", width: 16 },
  { header: "Deilvery No", width: 12 },
  { header: "Customer Code", width: 13 },
  { header: "Customer Name", width: 30 },
  { header: "Site Name", width: 30 },
  { header: "Del. Type", width: 9 },
  { header: "Customer Area", width: 16 },
  { header: "Site Area", width: 16 },
  { header: "No of Article", width: 11 },
  { header: "LT", width: 9 },
  { header: "Dispatch LT", width: 11 },
  { header: "Total LT", width: 10 },
  { header: "Total KG", width: 10 },
  { header: "Total Dealer", width: 11 },
  { header: "KG", width: 9 },
  { header: "INV TYPE", width: 9 },
  { header: "Entry By", width: 16 },
  { header: "Entry Date", width: 22 },
];

const SHEET_NAME = "Trip Detail";

type Cell = string | null;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** @db.Date (UTC midnight) → "21-09-2026", from the UTC parts. */
function ddmmyyyy(d: Date): string {
  return `${pad2(d.getUTCDate())}-${pad2(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

/** "10:30" → "10:30:00"; "10:30:15" kept; anything else → blank. */
function hhmmss(t: string | null): Cell {
  if (t === null) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t.trim());
  if (!m) return null;
  return `${pad2(Number(m[1]))}:${m[2]}:${m[3] ?? "00"}`;
}

/** An instant → "21-09-2026 03:42:07 pm" in IST, the old file's Entry Date. */
function istStamp(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const h24 = ist.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return (
    `${pad2(ist.getUTCDate())}-${pad2(ist.getUTCMonth() + 1)}-${ist.getUTCFullYear()} ` +
    `${pad2(h12)}:${pad2(ist.getUTCMinutes())}:${pad2(ist.getUTCSeconds())} ${h24 < 12 ? "am" : "pm"}`
  );
}

/** A number as text, rounded to 3 places so a float sum never prints
 *  0.30000000000000004. null → blank. */
function num(n: number | null): Cell {
  if (n === null || !Number.isFinite(n)) return null;
  return String(Math.round(n * 1000) / 1000);
}

/** Orbit's delivery-type names → the old file's codes. Upcountry is "UPC". */
function delType(name: string): string {
  const n = name.trim().toLowerCase();
  if (n === "upcountry") return "UPC";
  if (n.startsWith("cross")) return "Cross";
  if (n === "igt") return "IGT";
  if (n === "local") return "Local";
  return name;
}

/**
 * The old layout. Rows arrive already sorted by trip date, trip, the trip's
 * stop order, then OBD (getTripDetailRows) — i.e. by trip, then as the
 * trip's stops run.
 *
 * Site = the ship-to is a DIFFERENT party from the bill-to (codes differ).
 * When they are the same party, Site Name and Site Area are blank.
 *
 * An empty range returns a header-only workbook.
 */
export function buildTripDetailOldWorkbook(rows: readonly TripDetailRow[]): ArrayBuffer {
  const sheet: Cell[][] = [COLUMNS.map((c) => c.header)];

  for (const r of rows) {
    const hasSite =
      r.shipToCode !== null && (r.billToCode === null || r.shipToCode !== r.billToCode);
    sheet.push([
      r.tripNo,
      ddmmyyyy(r.tripDate),
      hhmmss(r.dispatchWindowTime),
      r.vehicleNo,
      r.driverMobile ?? "0",
      r.driverName,
      r.transporter,
      r.vehicleCategory,
      r.route,
      r.obdNo,
      r.billToCode,
      r.billToName,
      hasSite ? r.shipToName : null,
      delType(r.deliveryType),
      r.billToArea,
      hasSite ? r.area : null,
      num(r.articles),
      num(r.litres),
      num(r.litres), // Dispatch LT — the same value as LT, as the old file had it
      num(r.tripTotalLitres),
      num(r.tripTotalKg),
      String(r.tripDealerCount),
      num(r.kg),
      r.invType === "PROMO" ? "PROMO" : "INV",
      r.entryBy,
      istStamp(r.entryAt),
    ]);
  }

  // Strings only, so aoa_to_sheet writes every cell as text (t:"s").
  const ws = XLSX.utils.aoa_to_sheet(sheet);
  ws["!cols"] = COLUMNS.map((c) => ({ wch: c.width }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
