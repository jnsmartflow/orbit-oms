import type { MrnDetail } from "@/lib/mrn/types";
import {
  buildRenderRows,
  reportHeaderFields,
  reportSignatures,
  reportTotals,
} from "@/lib/mrn/report";
import { formatBatchNo } from "@/lib/mrn/derive";
import { isMrnReceivedFrom } from "@/lib/mrn/types";
import { formatCount } from "./format";

// The A4 LANDSCAPE print sheet — mockup P7.
//
// 🔴 BLACK AND WHITE. NO TEAL, NO COLOUR, on any element. This is the Delivery
// Challan's precedent (UI §32) and it is not a stylistic preference: the depot
// prints on a mono laser, so a teal action button rendered here comes out a
// muddy grey box that reads as a printing fault. The only palette permitted is
// #111827 / #374151 / #6b7280 / #9ca3af / #d1d5db / #e5e7eb / #f3f4f6 / #f9fafb
// / #fff, exactly as §32 lists for the challan document.
//
// ⚠ THE AMBER ISSUE HIGHLIGHT FROM THE DESKTOP TABLE IS DELIBERATELY ABSENT.
// lines-table.tsx tints an issue row `bg-amber-50/60`; here the Short and Excess
// COLUMNS carry that information in ink, which survives a mono printer. Do not
// port the tint over — it prints as a grey band across the row that looks like
// toner streaking.
//
// ⚠ SERVER COMPONENT. No "use client", no hooks, no window. The print TRIGGER
// is a separate one-line client component (print-sheet-button.tsx) for exactly
// the reason the trip sheet splits them the same way: nothing on the document
// itself needs to be interactive, so nothing on it ships JS.
//
// 🔴 PRINT ISOLATION IS NOT DEFINED IN THIS FILE. `#mrn-print-area` is revealed
// by a `@media print` block in app/globals.css using `visibility: hidden` on
// body plus `visibility: visible` on the area — NEVER `display: none`, which
// collapses the layout before the print pass measures it — and the landscape
// `@page mrn-sheet` sits TOP-LEVEL at the head of that file, never nested inside
// `@media print` (CORE §3, UI §32). Both rules have bitten this repo before.
// Do not add a <style> tag here to "keep it together".
//
// The column order and the sub-row rule come from lib/mrn/report.ts. Read its
// header — including the row-17-not-row-16 correction — before touching either.

/** 16 columns: the workbook's order, minus best before, plus Description,
 *  Pack and Batch No. Widths sum to 100.
 *
 *  ⚠ Batch No REPLACED Mfg m/y here rather than joining it — still 16 columns,
 *  no width added. "T082026" already CONTAINS 08/2026, so nothing is lost and
 *  A4 landscape gains no column. The XLS keeps Manufacturing Month and Year as
 *  two sortable integers ALONGSIDE Batch No because a spreadsheet is filtered
 *  and a sheet of paper is not; see lib/mrn/workbook.ts. The 1 point Batch No
 *  costs over the old Mfg cell came out of Description (24 → 23). */
const COLUMNS: { key: string; label: string; width: number; left?: boolean }[] = [
  { key: "no", label: "Sr", width: 3 },
  { key: "sku", label: "Product SKU", width: 9 },
  { key: "desc", label: "Description", width: 23, left: true },
  { key: "pack", label: "Pack", width: 5 },
  { key: "sti", label: "Qty STI", width: 6 },
  { key: "ctn", label: "Ctn", width: 4 },
  { key: "phy", label: "Physical", width: 6 },
  { key: "batch", label: "Batch No", width: 7 },
  { key: "snd", label: "SND", width: 4.5 },
  { key: "lky", label: "Lky", width: 4.5 },
  { key: "dmg", label: "Damage", width: 5 },
  { key: "emp", label: "Empty", width: 5 },
  { key: "qtd", label: "QTD", width: 4.5 },
  { key: "rej", label: "REJ", width: 4.5 },
  { key: "sht", label: "Short", width: 4.5 },
  { key: "exc", label: "Excess", width: 4.5 },
];

interface PrintSheetProps {
  detail: MrnDetail;
  /**
   * The moment this sheet was rendered, already formatted in IST by the server
   * page. Passed IN rather than read here so the component stays pure and the
   * footer cannot say one thing on the server and another after hydration.
   */
  printedAt: string;
}

export function PrintSheet({ detail, printedAt }: PrintSheetProps): React.JSX.Element {
  const rows = buildRenderRows(detail.lines);
  const t = reportTotals(detail);
  // Narrowed once for the sheet — see lib/mrn/workbook.ts for the same two
  // lines and the reason the fallback prints EMPTY rather than a wrong prefix.
  const receivedFrom = isMrnReceivedFrom(detail.receivedFrom) ? detail.receivedFrom : null;

  return (
    <div
      id="mrn-print-area"
      className="mx-auto bg-white px-[34px] py-[28px] text-[11px] text-[#111827]"
      /* 1120px ≈ A4 landscape's 297mm printable width at 96dpi, so what billing
         sees on screen is the shape that comes out of the tray. The print rules
         override the width to 100% — the page box governs there, not this. */
      style={{ width: "1120px", maxWidth: "100%" }}
    >
      <h1 className="text-center text-[15px] font-bold tracking-[0.06em]">
        MATERIAL RECEIPT NOTE
      </h1>
      <p className="mb-3 text-center text-[10.5px] text-[#6b7280]">
        JSW Dulux Limited · Surat Depot
      </p>

      {/* The header block — four across, two down, the eight facts from
          reportHeaderFields(). It is `break-inside: avoid` in print so it can
          never be sliced in half by a page break. */}
      <div className="mrn-sheet-meta mb-3 grid grid-cols-4 gap-x-[18px] gap-y-[9px] border border-[#d1d5db] px-[13px] py-[11px]">
        {reportHeaderFields(detail).map((f) => (
          <div key={f.label}>
            <div className="text-[9.5px] font-semibold uppercase tracking-[0.05em] text-[#6b7280]">
              {f.label}
            </div>
            <div
              className={
                "mt-[3px] text-[12px] font-medium text-[#111827] " +
                (f.mono ? "font-mono" : "")
              }
            >
              {f.value}
            </div>
          </div>
        ))}
      </div>

      <table className="w-full table-fixed border-collapse border border-[#d1d5db]">
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.key} style={{ width: `${c.width}%` }} />
          ))}
        </colgroup>

        {/* 🔴 A REAL <thead>, AND IT MUST STAY ONE. A 40-line truck runs to two
            pages, and the browser repeats a thead on every printed page only
            while it is `display: table-header-group` — which is its default and
            which globals.css re-asserts, because page 2 arriving with sixteen
            unlabelled number columns is a useless document. Do not flatten this
            into a <tr> in <tbody>. */}
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className={
                  "h-[26px] border border-[#d1d5db] bg-[#f3f4f6] px-1 text-[9px] font-semibold text-[#374151] " +
                  (c.left ? "text-left" : "text-center")
                }
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => {
            const l = r.line;
            // Everything the LINE owns prints on the first sub-row only. See
            // lib/mrn/report.ts — this is the rule that stops a split line
            // double-counting itself against the TOTAL row below.
            const first = r.carriesLineTotals;
            return (
              <tr key={r.key}>
                <Cell center>{r.label}</Cell>
                <Cell center mono>{l.skuCode}</Cell>
                <Cell left>
                  {first
                    ? (l.description ?? "Not in catalog")
                    : "↳ second mfg batch"}
                </Cell>
                <Cell center>{first ? (l.pack ?? "") : ""}</Cell>
                <Cell center>{first ? l.qtySti : ""}</Cell>
                <Cell center>{first ? (l.cartonQty ?? "") : ""}</Cell>
                {/* Physical and Batch No are the two that VARY down a split
                    line — the entire reason a line splits at all. The batch
                    number is derived from THIS sub-row’s mfg month and year, so
                    6a and 6b print two different ones and neither is gated by
                    `first`. */}
                <Cell center>{r.qtyForRow ?? ""}</Cell>
                <Cell center mono>
                  {r.batch && receivedFrom
                    ? formatBatchNo(receivedFrom, r.batch.mfgMonth, r.batch.mfgYear)
                    : ""}
                </Cell>
                <Cell center>{first ? blank(l.sndQty) : ""}</Cell>
                <Cell center>{first ? blank(l.leakyQty) : ""}</Cell>
                <Cell center>{first ? blank(l.damageQty) : ""}</Cell>
                <Cell center>{first ? blank(l.emptyQty) : ""}</Cell>
                <Cell center>{first ? blank(l.qtdQty) : ""}</Cell>
                <Cell center>{first ? blank(l.rejQty) : ""}</Cell>
                {/* Derived server-side (design §11 OQ-2). Never recomputed here. */}
                <Cell center>{first ? blank(l.shortQty) : ""}</Cell>
                <Cell center>{first ? blank(l.excessQty) : ""}</Cell>
              </tr>
            );
          })}

          {/* TOTAL. Totals the WHOLE MRN — there is no view filter on a printed
              document, and there must never be one: a paper total that reflected
              a filter would be a different number wearing the same label. */}
          {detail.lines.length > 0 && (
            <tr className="mrn-sheet-total bg-[#f9fafb] font-bold">
              <Cell center>{""}</Cell>
              <Cell center>{""}</Cell>
              <Cell left>TOTAL</Cell>
              <Cell center>{""}</Cell>
              <Cell center>{formatCount(t.qtySti)}</Cell>
              <Cell center>{""}</Cell>
              <Cell center>{formatCount(t.physical)}</Cell>
              <Cell center>{""}</Cell>
              <Cell center>{blank(t.snd)}</Cell>
              <Cell center>{blank(t.leaky)}</Cell>
              <Cell center>{blank(t.damage)}</Cell>
              <Cell center>{blank(t.empty)}</Cell>
              <Cell center>{blank(t.qtd)}</Cell>
              <Cell center>{blank(t.rej)}</Cell>
              <Cell center>{blank(t.short)}</Cell>
              <Cell center>{blank(t.excess)}</Cell>
            </tr>
          )}

          {detail.lines.length === 0 && (
            <tr>
              <td
                colSpan={COLUMNS.length}
                className="border border-[#e5e7eb] px-2 py-4 text-[10px] text-[#6b7280]"
              >
                This MRN has no lines.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* The three signature lines. `break-inside: avoid` in print, and they are
          the reason this document is worth printing at all — a screen cannot be
          signed. */}
      <div className="mrn-sheet-foot mt-[26px] flex justify-between text-[10px] text-[#6b7280]">
        {reportSignatures(detail).map((s) => (
          <div key={s.label} className="w-[190px] border-t border-[#9ca3af] pt-[5px] text-center">
            {s.label}
            {s.value && ` — ${s.value}`}
          </div>
        ))}
      </div>

      <p className="mrn-sheet-foot mt-[18px] text-center text-[9px] text-[#9ca3af]">
        OrbitOMS · JSW Dulux Surat Depot · printed {printedAt}
      </p>
    </div>
  );
}

/**
 * A zero prints as an EMPTY CELL, not as "0".
 *
 * ⚠ This is the one place the sheet deliberately loses a distinction the screen
 * keeps. A grid of forty zeroes down eight condition columns buries the three
 * numbers that actually matter, and on paper — where nobody can hover, filter or
 * scroll — that is the difference between a document someone reads and one they
 * put down. Null and 0 mean the same thing to a reader of a condition column.
 *
 * ⚠ IT IS NOT APPLIED TO Physical. A line confirmed at ZERO is a real receipt of
 * nothing (design §11 OQ-4) and must print its 0, which is why r.qtyForRow goes
 * straight into its cell above and does not pass through here.
 */
function blank(n: number | null): string {
  return n === null || n === 0 ? "" : String(n);
}

function Cell({
  children,
  center,
  left,
  mono,
}: {
  children?: React.ReactNode;
  center?: boolean;
  left?: boolean;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <td
      className={
        "h-[24px] overflow-hidden text-ellipsis whitespace-nowrap border border-[#e5e7eb] px-1 text-[10px] " +
        (left ? "text-left " : center ? "text-center " : "") +
        (mono ? "font-mono" : "")
      }
    >
      {children}
    </td>
  );
}
