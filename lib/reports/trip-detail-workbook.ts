// lib/reports/trip-detail-workbook.ts
//
// The .xlsx behind the Trip Detail report. Read by
// app/api/reports/trip-detail/route.ts and nothing else.
//
// 🔴 SERVER-ONLY, for the reason lib/ci/workbook.ts gives at length: `xlsx` is
// a ~900KB CommonJS bundle with side effects that webpack cannot tree-shake out
// of anything a client component imports. Never import this from a
// "use client" file. Same library and version (0.18.5) as lib/ci/workbook.ts
// and lib/mrn/workbook.ts — do not introduce a second one.
//
// Unlike the CI register (which billing pastes into their own macro workbook,
// so its dates are TEXT), this sheet is built for Excel lookup and pivot:
// numbers are numbers and dates are REAL Excel dates, so a pivot can group by
// day and a filter offers a calendar.

import * as XLSX from "xlsx";
import type { TripDetailRow } from "./trip-detail-data";

type Cell = string | number | null;

/** The 28 headers, in order. The header strings are the contract — a
 *  VLOOKUP or pivot someone builds keys off them. Widths are cosmetic. */
const COLUMNS: { header: string; width: number }[] = [
  { header: "Trip Date", width: 11 },
  { header: "Trip No", width: 14 },
  { header: "Delivery Type", width: 12 },
  { header: "Dispatch Slot", width: 12 },
  { header: "Trip Status", width: 11 },
  { header: "Vehicle No", width: 14 },
  { header: "Vehicle Type", width: 12 },
  { header: "Driver Name", width: 18 },
  { header: "Driver Mobile", width: 13 },
  { header: "Transporter", width: 20 },
  { header: "Bill To Code", width: 12 },
  { header: "Bill To Name", width: 30 },
  { header: "Ship To Code", width: 12 },
  { header: "Ship To Name", width: 30 },
  { header: "Site", width: 6 },
  { header: "Area", width: 16 },
  { header: "Route", width: 16 },
  { header: "OBD No", width: 12 },
  { header: "SO No", width: 12 },
  { header: "Invoice No", width: 12 },
  { header: "Invoice Date", width: 12 },
  { header: "SMU", width: 18 },
  { header: "Tint", width: 6 },
  { header: "Articles", width: 9 },
  { header: "Litres", width: 9 },
  { header: "KG", width: 9 },
  { header: "Bill Stage", width: 11 },
  { header: "Trip Note", width: 30 },
];

const SHEET_NAME = "Trip Detail";
const DATE_FORMAT = "dd-mm-yyyy";

/**
 * 🔴 THE DATE FORMAT MUST SIT AT numFmtId ≥ 164. Left to itself, xlsx 0.18.5
 * files a new custom format under id 60 — inside Excel's RESERVED built-in
 * range (0-163; 50-81 are locale-specific East-Asian date formats). Excel then
 * ignores the formatCode we wrote and applies its own idea of id 60, which is
 * how a plain whole-day serial came out as "2026-09-21 00:00:00" (fixed
 * 2026-10-01). Registering the pattern at 164 — the first id Excel leaves to
 * the file — makes the writer emit `<numFmt numFmtId="164" …>`. The cell
 * values were always date-only (whole-day serials); only the format was wrong.
 * SSF's table is module-global; loading the same pattern twice is harmless.
 */
XLSX.SSF.load(DATE_FORMAT, 164);
/** 0-based column indexes that hold dates (Trip Date, Invoice Date). */
const DATE_COLS = [0, 20];

/**
 * A @db.Date (UTC midnight) → its Excel serial day number. Computed from the
 * UTC parts by hand rather than handing XLSX a JS Date, because SheetJS
 * converts a Date through the HOST's local timezone — the same day would come
 * out differently on Vercel (UTC) and on a depot PC (IST).
 * 25569 = days from Excel's epoch (1899-12-30) to 1970-01-01.
 */
function excelSerial(d: Date | null): number | null {
  if (d === null) return null;
  const t = d.getTime();
  if (Number.isNaN(t)) return null;
  return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000) + 25569;
}

/**
 * A digit-only identifier (OBD, SO, invoice, customer code) as a NUMBER, so a
 * VLOOKUP against SAP's own export (which stores them as numbers) matches.
 * Kept as TEXT when it has a leading zero or would lose precision — the same
 * rule, for the same reason, as lib/ci/workbook.ts's digitsCell().
 */
function idCell(value: string | null): Cell {
  if (value === null) return null;
  const s = value.trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return s;
  if (s.length > 1 && s.startsWith("0")) return s;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : s;
}

/** Excel's own "freeze top row", written into the sheet XML after the fact.
 *  ⚠ xlsx 0.18.5 (community build) silently ignores `!freeze` / `!views` on
 *  write — verified 2026-10-01: it always emits a bare
 *  `<sheetView workbookViewId="0"/>`. So the workbook is written, re-opened as
 *  a zip with the CFB helper the same library ships, and that one element is
 *  replaced with one carrying a frozen pane. If the replace finds nothing (a
 *  future xlsx version writes the element differently) the file is returned
 *  unfrozen rather than broken. */
function freezeHeaderRow(file: ArrayBuffer): ArrayBuffer {
  const cfb = XLSX.CFB.read(new Uint8Array(file), { type: "array" });
  const idx = cfb.FullPaths.findIndex((p: string) => p.endsWith("/xl/worksheets/sheet1.xml"));
  if (idx < 0) return file;
  const entry = cfb.FileIndex[idx];
  const xml = new TextDecoder().decode(entry.content as Uint8Array);
  const bare = '<sheetView workbookViewId="0"/>';
  if (!xml.includes(bare)) return file;
  const frozen =
    '<sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>';
  const content = new TextEncoder().encode(xml.replace(bare, frozen));
  entry.content = content;
  entry.size = content.length;
  const out = XLSX.CFB.write(cfb, { fileType: "zip", type: "array" }) as Uint8Array;
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/**
 * The report as one worksheet: the header row, then one row per bill.
 *
 * 🔴 AN EMPTY RANGE IS A VALID WORKBOOK WITH THE HEADER ROW ONLY — never an
 * error. Do not add an early return above the write.
 *
 * Unknown = NO CELL (`null` → aoa_to_sheet writes nothing), never 0, "—" or
 * "N/A": a blank sums as nothing in a pivot, a fake 0 sums as a real one.
 */
export function buildTripDetailWorkbook(rows: readonly TripDetailRow[]): ArrayBuffer {
  const sheet: Cell[][] = [COLUMNS.map((c) => c.header)];

  for (const r of rows) {
    sheet.push([
      excelSerial(r.tripDate),
      r.tripNo,
      r.deliveryType,
      r.dispatchSlot,
      r.tripStatus,
      r.vehicleNo,
      r.vehicleType,
      r.driverName,
      // A phone number stays TEXT — it is not a quantity, and Excel would
      // print a 10-digit number in scientific form in a narrow column.
      r.driverMobile,
      r.transporter,
      idCell(r.billToCode),
      r.billToName,
      idCell(r.shipToCode),
      r.shipToName,
      r.site,
      r.area,
      r.route,
      idCell(r.obdNo),
      idCell(r.soNo),
      idCell(r.invoiceNo),
      excelSerial(r.invoiceDate),
      r.smu,
      r.tint,
      r.articles,
      r.litres,
      r.kg,
      r.billStage,
      r.tripNote,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(sheet);
  ws["!cols"] = COLUMNS.map((c) => ({ wch: c.width }));

  // The two date columns hold serial numbers; give those cells a date format
  // so Excel shows (and filters, and pivots) them as dates.
  for (let i = 1; i < sheet.length; i++) {
    for (const c of DATE_COLS) {
      const addr = XLSX.utils.encode_cell({ r: i, c });
      const cell = ws[addr] as XLSX.CellObject | undefined;
      if (cell && cell.t === "n") cell.z = DATE_FORMAT;
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);

  const file = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return freezeHeaderRow(file);
}
