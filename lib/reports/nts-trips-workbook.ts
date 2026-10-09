// lib/reports/nts-trips-workbook.ts
//
// The NTS TRIPS report in Smart Flow's "Tempo Report" layout (2026-10-09).
// Read by app/api/reports/nts-trips/route.ts only.
//
// 🔴 SERVER-ONLY (xlsx). Same library as the other trip workbooks.
//
// 🔴 LAYOUT IS COPIED, NOT DESIGNED: rows 1–9 empty, headers on row 10, data
// from row 11, one sheet "NTS Trips". Unlike the Freight Report, cells are
// REAL values: Month / Dispatch Date / Dispatch Time are Excel dates and times
// with a number format, Total Dealer / Ltr / Total KG are numbers.

import * as XLSX from "xlsx";
import type { NtsTripRow } from "./nts-trips-data";

/** Headers character for character from the Tempo Report, plus the owner's
 *  "Remarks" (2026-10-09). Widths copied from the same sheet. */
const COLUMNS: { header: string; width: number }[] = [
  { header: "Trip No", width: 9.7 },
  { header: "Month", width: 10.1 },
  { header: "Total Dealer", width: 7.4 },
  { header: "Dispatch Date", width: 10.1 },
  { header: "Dispatch Time", width: 8.3 },
  { header: "Place", width: 81.1 },
  { header: "Ltr", width: 9.9 },
  { header: "Total KG", width: 10.7 },
  { header: "Vehicle No.", width: 14.7 },
  { header: "Driver Name", width: 24.3 },
  { header: "Vehicle Model", width: 12 },
  { header: "Delivery Type", width: 9.3 },
  { header: "L / U", width: 6.9 },
  { header: "Remarks", width: 40 },
];

const SHEET_NAME = "NTS Trips";
/** 0-based row index of the header row — Excel row 10. */
const HEADER_ROW = 9;

const IST_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Excel's day 0 (1899-12-30, the 1900 leap-year bug included). */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/** An instant → its IST day and IST time-of-day (to the minute) as Excel serials. */
function istSerials(d: Date): { day: number; time: number } {
  const s = new Date(d.getTime() + IST_MS);
  const dayMs = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  return {
    day: Math.round((dayMs - EXCEL_EPOCH_MS) / DAY_MS),
    time: (s.getUTCHours() * 60 + s.getUTCMinutes()) / 1440,
  };
}

const text = (v: string | null): XLSX.CellObject | null => (v === null || v === "" ? null : { t: "s", v });
const num = (v: number, z?: string): XLSX.CellObject => (z ? { t: "n", v, z } : { t: "n", v });

/** Rows arrive filtered and sorted (getNtsTripsRows). An empty range returns
 *  the header row alone. */
export function buildNtsTripsWorkbook(rows: readonly NtsTripRow[]): ArrayBuffer {
  const ws: XLSX.WorkSheet = {};
  const put = (r: number, c: number, cell: XLSX.CellObject | null) => {
    if (cell !== null) ws[XLSX.utils.encode_cell({ r, c })] = cell;
  };

  COLUMNS.forEach((col, c) => put(HEADER_ROW, c, { t: "s", v: col.header }));

  rows.forEach((row, i) => {
    const r = HEADER_ROW + 1 + i;
    const { day, time } = istSerials(row.createdAt);
    put(r, 0, text(row.tripNo));
    put(r, 1, num(day, "mmm-yy"));
    put(r, 2, num(row.dealerCount, "0"));
    put(r, 3, num(day, "dd/mm/yyyy"));
    put(r, 4, num(time, "hh:mm"));
    put(r, 5, text(row.place));
    put(r, 6, num(row.litres, "0"));
    put(r, 7, num(row.kg)); // General — already rounded to 3 decimals; "0.###" would print "2901."
    put(r, 8, text(row.vehicleNo));
    put(r, 9, text(row.driverName));
    put(r, 10, text(row.vehicleModel));
    put(r, 11, text(row.deliveryTypes));
    put(r, 12, text(row.typeLetter));
    put(r, 13, text(row.remarks));
  });

  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: HEADER_ROW + rows.length, c: COLUMNS.length - 1 },
  });
  ws["!cols"] = COLUMNS.map((c) => ({ wch: c.width }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
