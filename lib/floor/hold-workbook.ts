// lib/floor/hold-workbook.ts
//
// The On hold tab's Export XLS (2026-10-30, owner; mockup
// docs/mockups/floor-hold/hold-dealer-groups.html "Export XLS — preview").
// Read by app/api/floor/hold/export/route.ts and nothing else.
//
// 🔴 SERVER-ONLY. `xlsx` is a ~900KB CommonJS bundle webpack cannot tree-shake
// out of a module a client component imports (CLAUDE_MRN, lib/mrn/workbook.ts).
// Never import this file from components/.
//
// THE SAME LIST AS THE SCREEN. The rows are getFloorHold's (with floorExtras —
// stopKey + SO), filtered by the SAME Today rule and ordered by the SAME dealer
// grouping the tab uses (lib/floor/hold-groups.ts isHeldToday /
// groupHoldByDealer), so the file and the screen cannot disagree about which
// bills are "today" or which dealer comes first.
//
// Two sheets:
//   Summary  Customer name · Total invoices · Total litres — one row per dealer,
//            then a Total row.
//   Details  one row per bill (OBD), in screen order.
//
// ⚠ NO BOLD AND NO FROZEN HEADER. This build of `xlsx` (0.18.5, community)
// writes neither cell styles nor pane splits — a `!freeze` key would look like
// a working feature while doing nothing (lib/mrn/workbook.ts, lib/ci/workbook.ts
// record the same). It DOES write number formats, so dates are real Excel dates
// shown dd-mm-yyyy.
//
// Litres / KG follow the screen's load rule (lib/orders/gift.ts): a GIFT is 0 L
// / 0 kg; a missing weight is a blank KG cell, never 0.

import * as XLSX from "xlsx";
import { groupHoldByDealer, isHeldToday } from "@/lib/floor/hold-groups";
import { loadKg, loadLitres } from "@/lib/orders/gift";
import { formatArticleTag } from "@/lib/floor/format";
import type { FloorHoldRow } from "@/lib/floor/types";

export type HoldExportView = "all" | "today";

const DATE_FMT = "dd-mm-yyyy";

/** The IST calendar day of an instant, as [y, m, d]. */
function istYmd(iso: string): [number, number, number] {
  const [y, m, d] = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).split("-").map(Number);
  return [y, m, d];
}

/** An Excel date serial for the IST day of `iso` (no time part), or null. */
function excelDate(iso: string | null): number | null {
  if (!iso) return null;
  const [y, m, d] = istYmd(iso);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/** dd-mm-yyyy (IST) as TEXT — the approximate held date, and the file name. */
export function istDateText(iso: string | Date): string {
  const [y, m, d] = istYmd(typeof iso === "string" ? iso : iso.toISOString());
  return `${String(d).padStart(2, "0")}-${String(m).padStart(2, "0")}-${y}`;
}

/**
 * A bill's SAP invoice numbers and how many invoices it really carries.
 *   split OBD (drawn per invoice) → its HELD invoices' numbers, one each;
 *   one OBD row                  → orders.invoiceNo (an ODB import has none → 0);
 *   a split OBD held whole before per-invoice hold (no invoice rows on the hold
 *   row) → orders.invoiceNo and the OBD's own invoice count.
 */
function invoicesOf(row: FloorHoldRow): { numbers: string[]; count: number } {
  if (row.invoiceRows.length > 0) {
    const numbers = row.invoiceRows.map((i) => i.invoiceNo).filter((n): n is string => !!n);
    return { numbers, count: numbers.length };
  }
  if (!row.invoiceNo) return { numbers: [], count: 0 };
  return { numbers: [row.invoiceNo], count: Math.max(1, row.invoiceCount) };
}

const SUMMARY_COLUMNS = [
  { header: "Customer name", width: 38 },
  { header: "Total invoices", width: 14 },
  { header: "Total litres", width: 13 },
];

const DETAIL_COLUMNS = [
  { header: "Customer", width: 34 },
  { header: "OBD", width: 13 },
  { header: "OBD date", width: 11 },
  { header: "Invoice(s)", width: 24 },
  { header: "Invoice date", width: 12 },
  { header: "SO", width: 18 },
  { header: "Area", width: 16 },
  { header: "Route", width: 16 },
  { header: "Litres", width: 9 },
  { header: "KG", width: 9 },
  { header: "Article", width: 16 },
  { header: "Held since", width: 12 },
  { header: "Held by", width: 18 },
];
/** Details columns that hold a date serial (0-based). */
const DETAIL_DATE_COLS = [2, 4, 11];

type Cell = string | number | null;

/** Litres to one decimal, as a number (float sums leak, status-pill formatLitres). */
const round1 = (n: number) => Math.round(n * 10) / 10;

function sheetOf(rows: Cell[][], widths: number[], dateCols: number[] = []): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((c) => (c === null ? "" : c))));
  ws["!cols"] = widths.map((wch) => ({ wch }));
  // A date column's NUMBER cells (header and "~" text skipped) get the date format.
  for (let r = 1; r < rows.length; r++) {
    for (const c of dateCols) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "n") cell.z = DATE_FMT;
    }
  }
  return ws;
}

export function holdExportFilename(view: HoldExportView, now: Date): string {
  return `OnHold_${view === "today" ? "Today" : "All"}_${istDateText(now)}.xlsx`;
}

export function buildHoldWorkbook(rows: readonly FloorHoldRow[], view: HoldExportView, now: Date): ArrayBuffer {
  const shown = view === "today" ? rows.filter((r) => isHeldToday(r, now)) : rows;
  const groups = groupHoldByDealer(shown);

  // ── Summary ──
  const summary: Cell[][] = [SUMMARY_COLUMNS.map((c) => c.header)];
  let totalInvoices = 0;
  let totalLitres = 0;
  for (const g of groups) {
    const invoices = g.rows.reduce((s, r) => s + invoicesOf(r).count, 0);
    const litres = g.rows.reduce((s, r) => s + loadLitres(r.volumeLitres, r.isGift), 0);
    totalInvoices += invoices;
    totalLitres += litres;
    summary.push([g.name, invoices, round1(litres)]);
  }
  summary.push(["Total", totalInvoices, round1(totalLitres)]);

  // ── Details ──
  const details: Cell[][] = [DETAIL_COLUMNS.map((c) => c.header)];
  for (const g of groups) {
    for (const r of g.rows) {
      const inv = invoicesOf(r);
      const invoiceDate = r.invoiceDate ?? r.invoiceRows.find((i) => i.invoiceDate)?.invoiceDate ?? null;
      const kg = loadKg(r.weightKg, r.isGift);
      const held =
        r.heldSinceSource === "unknown" || !r.heldSince
          ? null
          : r.heldSinceSource === "approx"
            ? `~ ${istDateText(r.heldSince)}`
            : excelDate(r.heldSince);
      details.push([
        r.dealerName,
        r.obdNumber,
        excelDate(r.obdDateTime),
        inv.numbers.join(", ") || null,
        inv.numbers.length > 0 ? excelDate(invoiceDate) : null,
        r.salesOfficerName ?? null,
        r.area,
        r.route,
        round1(loadLitres(r.volumeLitres, r.isGift)),
        kg === null ? null : round1(kg),
        r.articleTag ? formatArticleTag(r.articleTag) : null,
        held,
        r.heldByName,
      ]);
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetOf(summary, SUMMARY_COLUMNS.map((c) => c.width)), "Summary");
  XLSX.utils.book_append_sheet(wb, sheetOf(details, DETAIL_COLUMNS.map((c) => c.width), DETAIL_DATE_COLS), "Details");
  // `array`: a plain ArrayBuffer is a BodyInit (lib/mrn/workbook.ts).
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
