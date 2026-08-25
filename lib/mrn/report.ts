// lib/mrn/report.ts
//
// The MRN report's SHAPE — shared by the XLS export, the A4 print sheet and the
// desktop lines table. Pure: no Prisma, no React, no clock read.
//
// 🔴 WHY THIS FILE EXISTS. Three surfaces render the same truck: the table in
// components/mrn/lines-table.tsx, the workbook in lib/mrn/workbook.ts and the
// sheet in components/mrn/print-sheet.tsx. The sub-row rule below is the one
// piece of logic that, got wrong in ONE of them, silently doubles a total — so
// it is written once, here, and imported by all three. It used to live inside
// lines-table.tsx; step 10 lifted it out rather than copy it twice.
//
// ⚠ THIS FILE MUST STAY FREE OF `xlsx`. lines-table.tsx is a CLIENT component
// and imports from here, so anything this module pulls in reaches the browser
// bundle. That is exactly why the workbook writer is a SEPARATE file — see
// lib/mrn/workbook.ts's header. Do not move it back.
//
// ── THE COLUMN ORDER IS NOT NEGOTIABLE AND DOES NOT COME FROM PROSE ─────────
//
// It was read out of `docs/mockups/mrn/MRN TEMP SEET TPW  17.08.2026.xls`,
// sheet `PRINT`, **row 17** — cells A17:Q17:
//
//   Sr No. · Product SKU · Qty as per STI · Cartoon Qty · Qty as per Physical ·
//   Manufacturing Month · Manufacturing Year · Best Before Month ·
//   Best Before Year · SND · Lky · Damage · Empty · QTD · REJ · Short · Excess
//
// ⚠ EVERY PROSE SOURCE IN THIS REPO SAYS "ROW 16". Design §10 says it, OQ-3
// says it, lines-table.tsx says it. They are all off by one and the reason is
// mechanical: the sheet's used range starts at A4, so a 1-based read of the
// PARSED rows lands three short. Row 16 is EMPTY on that sheet apart from
// T16="Poonam", a cell in the packing-vendor legend running down the right-hand
// margin. Verified 2026-08-25 by reading the cells at their true addresses. Do
// not "correct" 17 back to 16.
//
// Two documented departures from that row, both decided before this step:
//
//   • BEST BEFORE IS GONE, both halves. Not collected since 2026-08-22 (schema
//     v27.17, design §11 OQ-9) — every row written since carries NULL, so the
//     columns would print empty on every truck. See lib/mrn/derive.ts's header.
//   • DESCRIPTION and PACK are ADDED, straight after Product SKU. The workbook
//     has neither (its `HELPER - 1` sheet VLOOKUPs them in); MRN resolves both
//     from sku_master_v2 and mockup P7 draws them.
//
// Manufacturing month and year stay TWO columns in the XLS, exactly as the
// workbook has them — an .xlsx is the thing someone sorts and filters, and two
// integers beat one string there. The A4 sheet merges them into a single
// `06/26` cell, matching mockup P7 and the desktop table, because A4 landscape
// has no width to spend on a second column. That is the ONLY difference between
// the two outputs, and it is a rendering choice, not a different column order.

import type { MrnBatchRow, MrnDetail, MrnDetailLine } from "./types";
import { formatDateOnly, formatIstDateTime } from "@/components/mrn/format";

// ── Sub-rows ────────────────────────────────────────────────────────────────

/** One rendered row. A multi-batch line becomes several of these. */
export interface MrnRenderRow {
  key: string;
  /** "6" for a single-batch line, "6a" / "6b" for a split one. */
  label: string;
  line: MrnDetailLine;
  batch: MrnBatchRow | null;
  /**
   * True on the first (or only) row for a line. Everything belonging to the
   * LINE rather than to a batch renders here and nowhere else — see below.
   */
  carriesLineTotals: boolean;
  /** The quantity this row accounts for: the batch's, or the whole line's. */
  qtyForRow: number | null;
}

/**
 * Flatten lines into render rows, splitting a multi-batch line into sub-rows.
 *
 * 🔴 `Qty STI` SITS ON THE FIRST SUB-ROW ONLY. Repeating it on 6b would
 * double-count the column and break the TOTAL row — design §6 says so about the
 * report, and the same arithmetic applies to the table and the sheet.
 *
 * ⚠ THE SAME RULE EXTENDS TO THE EIGHT CONDITION COLUMNS, and the mockup does
 * not settle this. It draws SND split across 6a/6b as 9 and 6, which reads as a
 * per-batch count — but the counts are stored on `mrn_lines`, not on
 * `mrn_line_batches`, so there is no per-batch value to render and inventing a
 * split would be fabricating data. They render on the first sub-row only, for
 * exactly the reason Qty STI does. Cartoon Qty rides with them for the same
 * reason: it is a LINE fact off the STI sheet, not a batch fact.
 *
 * Only PHYSICAL and MFG vary per sub-row, which is the entire reason a line
 * splits. (Best before used to vary too, until it stopped being collected.)
 */
export function buildRenderRows(lines: readonly MrnDetailLine[]): MrnRenderRow[] {
  const out: MrnRenderRow[] = [];
  for (const line of lines) {
    if (line.batches.length > 1) {
      line.batches.forEach((batch, i) => {
        out.push({
          key: `${line.id}-${batch.id}`,
          label: `${line.lineNo}${String.fromCharCode(97 + i)}`,
          line,
          batch,
          carriesLineTotals: i === 0,
          qtyForRow: batch.qty,
        });
      });
    } else {
      out.push({
        key: String(line.id),
        label: String(line.lineNo),
        line,
        batch: line.batches[0] ?? null,
        carriesLineTotals: true,
        qtyForRow: line.physicalQty,
      });
    }
  }
  return out;
}

// ── The TOTAL row ───────────────────────────────────────────────────────────

/** Every column the TOTAL row carries. Cartoon Qty and Mfg deliberately have
 *  no total — a sum of carton counts is not a quantity anyone reads, and a sum
 *  of months is nonsense. */
export interface MrnReportTotals {
  qtySti: number;
  physical: number;
  snd: number;
  leaky: number;
  damage: number;
  empty: number;
  qtd: number;
  rej: number;
  short: number;
  excess: number;
}

/**
 * The TOTAL row, off the payload wherever the payload already has it.
 *
 * ⚠ SND IS SUMMED HERE rather than read off `MrnIssueSummary`, which
 * deliberately has no `totalSnd`: SND is the SOUND count — the clean case — and
 * folding it into a type called an ISSUE summary would have made that name a
 * lie. It is still a real column with a real total. lines-table.tsx does the
 * identical sum for the identical reason.
 *
 * Everything else comes from summariseMrn(), applied server-side in
 * getMrnDetail(). Nothing here re-derives Short or Excess (design §11 OQ-2).
 */
export function reportTotals(detail: MrnDetail): MrnReportTotals {
  return {
    qtySti: detail.totalQtySti,
    physical: detail.totalPhysicalQty,
    snd: detail.lines.reduce((s, l) => s + (l.sndQty ?? 0), 0),
    leaky: detail.totalLeaky,
    damage: detail.totalDamage,
    empty: detail.totalEmpty,
    qtd: detail.totalQtd,
    rej: detail.totalRej,
    short: detail.totalShort,
    excess: detail.totalExcess,
  };
}

// ── The header block ────────────────────────────────────────────────────────

export interface MrnReportField {
  label: string;
  value: string;
  /** Render in a monospace face — a code the reader compares character by
   *  character against a paper document. */
  mono?: boolean;
}

/**
 * The eight header facts, in one order, for both outputs.
 *
 * ⚠ FOUR OF THE WORKBOOK'S HEADER FIELDS ARE NOT HERE, and three of them
 * CANNOT be: `Transportation Mode`, `Total Nags as per LR` and `Total Nags
 * physically received` have no column on `mrn` and nothing collects them. The
 * fourth, `OTR no`, IS held (`mrn.otrNo`) but is absent from the step-10 spec's
 * field list and from mockup P7, so it is omitted deliberately rather than
 * forgotten. Restoring it is one entry in this array plus one cell of A4 width.
 *
 * The workbook's single `Truck Unloading Date` becomes the START and END
 * timestamps, which is strictly more than the paper carried.
 *
 * 🔴 TWO DATE SHAPES, TWO FORMATTERS, AND THEY ARE NOT INTERCHANGEABLE.
 * `truckReportingDate` is @db.Date and MUST go through formatDateOnly (UTC
 * getters); the unloading timestamps are timestamptz and MUST go through
 * formatIstDateTime. Swapping them prints the wrong day for half of every night
 * shift. components/mrn/format.ts's header carries the full rule.
 */
export function reportHeaderFields(detail: MrnDetail): MrnReportField[] {
  return [
    { label: "MRN No.", value: detail.mrnNumber, mono: true },
    { label: "Truck reporting date", value: formatDateOnly(detail.truckReportingDate) ?? "—" },
    { label: "Received from", value: detail.receivedFrom },
    { label: "Receiving warehouse", value: detail.receivingWarehouse },
    { label: "STI / PO ref no.", value: detail.stiRefNo ?? "—", mono: true },
    { label: "Delivery no", value: detail.deliveryNo ?? "—", mono: true },
    { label: "Unloading start", value: formatIstDateTime(detail.unloadingStartAt) ?? "—" },
    { label: "Unloading end", value: formatIstDateTime(detail.unloadingEndAt) ?? "—" },
  ];
}

// ── Signatures ──────────────────────────────────────────────────────────────

/**
 * The three signature lines, per design §8. The first two are pre-filled from
 * the row wherever a name is known — the supervisor who ENDED the unloading
 * (the one who actually counted) and the operator who raised the MRN. The third
 * is ALWAYS blank: no warehouse in-charge touches this system, so printing a
 * name over that rule would be inventing an approval nobody gave.
 */
export function reportSignatures(detail: MrnDetail): MrnReportField[] {
  const checkedBy = detail.unloadingEndByName ?? detail.unloadingStartByName;
  return [
    { label: "Checked by", value: checkedBy ?? "" },
    { label: "Billing", value: detail.createdByName ?? "" },
    { label: "Warehouse In-charge", value: "" },
  ];
}

// ── Filename ────────────────────────────────────────────────────────────────

/**
 * `MRN-2026-00042-TPW-2026-08-22.xlsx`.
 *
 * The MRN NUMBER leads, because that is what the file gets searched by once it
 * is sitting in a folder of forty of them. The date is the TRUCK REPORTING
 * date, not today and not `mrnDate` — the same convention as everything else
 * labelled "reported" (design §11 OQ-5).
 *
 * ⚠ UTC getters on `truckReportingDate`. It is @db.Date, so its UTC parts ARE
 * its calendar parts; local getters would name yesterday's file for any viewer
 * west of UTC. Same rule as formatDateOnly.
 *
 * Everything outside [A-Za-z0-9-] becomes a dash. `mrnNumber` is generated and
 * `receivedFrom` is CHECK-constrained, so neither can currently carry a quote
 * or a newline — but this string ends up in a `Content-Disposition` header, and
 * a filename builder that trusts its inputs is a header-injection hole waiting
 * for the day one of those fields becomes operator-typed.
 */
export function reportFilename(detail: MrnDetail, ext: string): string {
  const d = new Date(detail.truckReportingDate);
  const day = Number.isNaN(d.getTime())
    ? "unknown-date"
    : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
        d.getUTCDate(),
      ).padStart(2, "0")}`;
  const safe = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safe(detail.mrnNumber)}-${safe(detail.receivedFrom)}-${day}.${ext}`;
}
