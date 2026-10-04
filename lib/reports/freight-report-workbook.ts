// lib/reports/freight-report-workbook.ts
//
// The FREIGHT REPORT in the NTS "Trip Detail Report" layout — 34 columns
// (2026-10-04). Read by app/api/reports/freight-report/route.ts only.
//
// 🔴 SERVER-ONLY (xlsx). Same library as the Trip Detail workbooks, and the
// same formatting helpers as the Old Format (ddmmyyyy, hhmmss, istStamp, num,
// delType — exported from trip-detail-old-workbook.ts, not copied).
//
// 🔴 EVERY CELL IS TEXT — numbers and dates included, like the old file the
// MIS sheets read — EXCEPT Total Dealer, which NTS writes as a number.
// Unknown = no cell, except Mobile No. and Diesel Amt, which NTS writes as "0".

import * as XLSX from "xlsx";
import type { FreightReportRow } from "./freight-report-data";
import { ddmmyyyy, delType, hhmmss, istStamp, num } from "./trip-detail-old-workbook";

/**
 * The 34 headers, character for character from the real NTS export — INCLUDING
 * the "Deilvery No" typo and the dots / spaces in "Vehicle No.", "Mobile No.",
 * "SO / Customer", "Del. Type". Downstream sheets key off these strings. Do not
 * fix one. Widths are cosmetic.
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
  { header: "SO / Customer", width: 14 },
  { header: "Del. Type", width: 9 },
  { header: "Customer Area", width: 16 },
  { header: "Site Area", width: 16 },
  { header: "Other Delivery Area", width: 18 },
  { header: "Transport Del", width: 12 },
  { header: "No of Article", width: 11 },
  { header: "LT", width: 9 },
  { header: "Dispatch LT", width: 11 },
  { header: "Total LT", width: 10 },
  { header: "Total KG", width: 10 },
  { header: "Total Dealer", width: 11 },
  { header: "Modified Inv", width: 12 },
  { header: "KG", width: 9 },
  { header: "INV TYPE", width: 9 },
  { header: "Remark", width: 30 },
  { header: "Diesel Amt", width: 10 },
  { header: "Entry By", width: 16 },
  { header: "Entry Date", width: 22 },
  { header: "Entry Type", width: 10 },
  { header: "Invoice No", width: 14 },
];

const SHEET_NAME = "Trip Detail";

type Cell = string | number | null;

/** Rows arrive filtered and sorted (getFreightReportRows). An empty range
 *  returns a header-only workbook. */
export function buildFreightReportWorkbook(rows: readonly FreightReportRow[]): ArrayBuffer {
  const sheet: Cell[][] = [COLUMNS.map((c) => c.header)];

  for (const r of rows) {
    sheet.push([
      r.tripNo,
      ddmmyyyy(r.dispatchDay),
      hhmmss(r.dispatchTime),
      r.vehicleNo,
      r.mobile ?? "0", // NTS writes 0 for no mobile — word rows and Hand trips too
      r.driverName,
      r.transporter,
      r.vehicleModel,
      r.route,
      r.obdNo,
      r.billToCode,
      r.billToName,
      r.siteName,
      null, // SO / Customer — not in Orbit
      r.deliveryType !== null ? delType(r.deliveryType) : null,
      r.billToArea,
      r.siteArea,
      r.redirectArea,
      null, // Transport Del — not in Orbit
      num(r.articles),
      num(r.litres),
      num(r.litres), // Dispatch LT — the same value as LT, as NTS has it
      num(r.tripTotalLitres),
      num(r.tripTotalKg),
      r.tripDealerCount, // a NUMBER cell, as NTS writes it
      null, // Modified Inv — not in Orbit
      num(r.kg),
      r.invType,
      r.remark,
      r.diesel !== null ? num(r.diesel) : "0",
      r.entryBy,
      r.entryAt !== null ? istStamp(r.entryAt) : null,
      r.entryType,
      r.invoiceNo,
    ]);
  }

  // Strings write as text (t:"s"); the one number writes as a number (t:"n").
  const ws = XLSX.utils.aoa_to_sheet(sheet);
  ws["!cols"] = COLUMNS.map((c) => ({ wch: c.width }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
