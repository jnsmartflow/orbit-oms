// lib/ci/workbook.ts
//
// The .xlsx behind billing's CI register — the sheet they keep by hand today as
// "CI DATA NEW FILE2.xlsm", sheet "CI DATA BELOW 10000RS", 17 columns, one row
// per CI. Read by app/api/ci/export/route.ts and nothing else.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 SERVER-ONLY, AND THAT IS STRUCTURAL — NOT A STYLE PREFERENCE.
// ═══════════════════════════════════════════════════════════════════════════
//
// `xlsx` is a ~900KB CommonJS bundle with side effects, so webpack cannot
// tree-shake it out of any module a CLIENT component imports. lib/ci/types.ts
// and lib/ci/derive.ts are both imported by client components
// (components/ci/submitted-detail.tsx imports derive.ts by value), so this
// builder may never move into either of them and neither of them may ever
// import this file. lib/mrn/workbook.ts carries the identical warning after the
// identical split — read its header before merging anything here into anywhere.
//
// lib/ci/queries.ts imports `CiRegisterRow` from this file with `import type`,
// which TypeScript erases entirely (tsconfig sets isolatedModules, so the
// keyword is load-bearing, not decoration). A plain `import` would pull the
// spreadsheet library into every CI route's module graph — not a client-bundle
// leak, but a cold-start cost on five routes that will never write a workbook.
//
// ⚠ `xlsx` 0.18.5 is the version already in the stack — the same one
// lib/mrn/workbook.ts writes with and lib/sap-parser/read-sheet.ts reads with.
// Do not introduce a second library; `exceljs` is a dependency but lives only in
// scripts/ and has never been used by the app.

import * as XLSX from "xlsx";
import type { CiMaterialMoved, CiReturnType } from "./types";

/**
 * One CI as the register needs it — the shape lib/ci/queries.ts's
 * getCiRegisterRows() produces and this file consumes.
 *
 * ⚠ DELIBERATELY NOT IN lib/ci/types.ts. That file holds WIRE shapes: what a
 * route serialises to JSON for a screen. This never crosses the wire (the wire
 * here is a binary workbook) and it carries real `Date` objects, which no wire
 * shape does. Keeping it beside its only consumer is what stops someone
 * "tidying" a Date into an ISO string and silently breaking the UTC-parts rule
 * that ddmmyyyy() depends on.
 */
export interface CiRegisterRow {
  /** Only for the sort tiebreak and for nothing on the sheet — their register
   *  has no column for OrbitOMS's own reference. */
  ciNumber: string;
  /** 🔴 THE CI'S OWN SNAPSHOT, never the master's (owner ruling, 2026-09-03).
   *  A register records what was FILED. The snapshot also survives an
   *  unmastered dealer, where delivery_point_master has no row at all — 1 of
   *  the 13 closed CIs live (KRISHNA TRADING). */
  dealerCode: string | null;
  /** Snapshot too, and for a second reason: it was resolved through
   *  resolveCiDealer(), which prefers the SHIP-TO OVERRIDE. Goods come back
   *  from where they were delivered, not from whoever the master names today. */
  dealerName: string | null;
  /** 🔴 LIVE OFF THE ORDER, snapshot only as fallback — the rule written on
   *  ci_returns.invoiceNo itself. 5% of bills have no invoice number when the
   *  CI is raised and SAP sends it later. */
  invoiceNo: string | null;
  invoiceDate: Date | null;
  sapCiNumber: string | null;
  ciDate: Date | null;
  /** Σ returnedQtyLitres, already through lib/ci/derive.ts's sumLitres() — the
   *  SAME function both detail panes total with, so the register and the screen
   *  cannot disagree about one return. LITRES, not tins: their row 2 reads 2.4
   *  and no tin count is 2.4. */
  totalLitres: number;
  /** Decimal(12,2) carried as a STRING out of Prisma so no scale is lost on the
   *  way here. Converted to a number at the cell — see the H column below. */
  ciValue: string | null;
  reasonLabel: string | null;
  returnType: CiReturnType;
  /** ⚠ NULLABLE HERE EVEN THOUGH THE CHECK MAKES IT UNREACHABLE on a closed CI.
   *  The column is nullable so a DRAFT can exist before the details step; the
   *  query narrows rather than defaults, because "NM" invented for a missing
   *  answer would be a fact nobody stated, on a document that goes upward. */
  materialMoved: CiMaterialMoved | null;
  /** The SAP division code — "70"/"74"/"76"/"77"/"10" — derived from
   *  orders.smu via SMU_CODE_BY_NAME in the query. Null on the 132 bills that
   *  carry no smu at all. */
  division: string | null;
}

/** A cell: a number, a string, or genuinely empty. `null` makes aoa_to_sheet
 *  write NO CELL AT ALL, which is what billing needs — they TYPE into the five
 *  blank columns, and a "-" or an "N/A" is something they would have to delete
 *  first. */
type Cell = string | number | null;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE 17 HEADERS ARE COPIED CHARACTER FOR CHARACTER FROM BILLING'S WORKBOOK,
 *    TYPOS AND ALL. DO NOT "FIX" ONE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * They paste these rows into a sheet whose named table CI_DATA keys off the
 * header strings. Two of them are wrong as English and MUST stay wrong:
 *
 *   B  'DELAR NAME'        — sic. Not DEALER.
 *   H  'CI Order value '   — sic. TRAILING SPACE. If your editor strips it on
 *                            save, the paste stops matching their table.
 *
 * Five columns are deliberately EMPTY in v1 and are not oversights: I NON
 * TINTED, J REASON, L Mtrl in Depo Y/N, M MATERIAL STATUS, Q remark2. Billing
 * types into them. ⚠ NON TINTED is a one-line rollup off
 * import_raw_line_items.isTinting and STILL stays blank — that was an explicit
 * ruling (2026-09-03), not something nobody noticed. The other four have no
 * source in this schema at all and would need new columns and new form fields.
 *
 * Widths are Excel character units and are cosmetic only; the header strings
 * are the contract.
 */
const REGISTER_COLUMNS: { header: string; width: number }[] = [
  { header: "DEALER CODE", width: 12 },
  { header: "DELAR NAME", width: 30 },
  { header: "Inv No", width: 13 },
  { header: "Inv Date", width: 11 },
  { header: "CI Order no", width: 13 },
  { header: "CI Date", width: 11 },
  { header: "CI Qty", width: 9 },
  { header: "CI Order value ", width: 14 },
  { header: "NON TINTED", width: 12 },
  { header: "REASON", width: 12 },
  { header: "REMARK", width: 26 },
  { header: "Mtrl in Depo Y/N", width: 16 },
  { header: "MATERIAL STATUS", width: 16 },
  { header: "FULL INVOICE/PARTIAL INVOICE", width: 28 },
  { header: "N/NM", width: 7 },
  { header: "DIV", width: 6 },
  { header: "remark2", width: 12 },
];

/** Their sheet name, exactly. 21 characters, inside Excel's 31 cap, and it
 *  contains none of : \ / ? * [ ] — so it needs no sanitising.
 *
 *  ⚠ THE NAME SAYS "BELOW 10000RS" AND THIS EXPORT APPLIES NO VALUE FILTER.
 *  That is the owner's ruling (2026-09-03): every closed CI in the range goes
 *  in, whatever it is worth. Whether a second register exists for larger CIs is
 *  still an open question — if it turns out one does, that is one WHERE clause
 *  in getCiRegisterRows(), not a threshold guessed here. */
const SHEET_NAME = "CI DATA BELOW 10000RS";

/**
 * "06.08.2026" — TEXT, from the UTC parts.
 *
 * 🔴 A STRING, NOT A DATE, AND NOT AN EXCEL SERIAL. Their file stores these as
 * strings and their macro reads them as strings; handing Excel a real date
 * would let the cell re-format itself by the opening machine's locale and
 * break the paste.
 *
 * ⚠ UTC GETTERS, ALWAYS. Both `invoiceDate` and `ciDate` are `@db.Date` — a
 * calendar day anchored at UTC midnight, not an instant — so its UTC parts ARE
 * its calendar parts. Local getters would print yesterday for any host west of
 * UTC. Same rule lib/mrn/report.ts's formatDateOnly and lib/ci/queries.ts's
 * isoDate() already follow.
 */
function ddmmyyyy(d: Date | null): string | null {
  if (d === null) return null;
  const t = d.getTime();
  if (Number.isNaN(t)) return null;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${d.getUTCFullYear()}`;
}

/**
 * A digit string as the cell type their file uses — a NUMBER — EXCEPT when it
 * carries a leading zero, where it stays TEXT.
 *
 * 🔴 DO NOT "SIMPLIFY" THIS BACK TO Number(). THE BRANCH IS THE POINT.
 * (Owner ruling, 2026-09-03, overriding the original spec line that said these
 * columns are plainly numeric.)
 *
 * A live closed CI carries sapCiNumber "0000000". `Number("0000000")` is `0`,
 * and the seven digits are gone from a document that goes UPWARD out of this
 * depot. A register that silently drops the padding on a reference number is
 * worse than one column that holds mixed types — Excel will show both, and only
 * one of them is the number SAP issued.
 *
 * Non-digit and empty strings return null (an empty cell), never NaN: writing
 * NaN into a spreadsheet produces a cell that reads as a value and is not one.
 */
function digitsCell(value: string | null): Cell {
  if (value === null) return null;
  const s = value.trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return s;
  // Leading zero ⇒ the padding is part of the identifier. Keep it as text.
  if (s.length > 1 && s.startsWith("0")) return s;
  if (s === "0") return s;
  const n = Number(s);
  // 16+ digits would lose precision as an IEEE double. No live code is close
  // (the longest customerCode is 10 digits), but a silently-wrong number on a
  // register is exactly the failure this whole function exists to avoid.
  return Number.isSafeInteger(n) ? n : s;
}

/**
 * The register, as one worksheet: the header row, then one row per CI.
 *
 * 🔴 AN EMPTY RANGE IS A VALID WORKBOOK WITH THE HEADER ROW AND NO DATA ROWS.
 * Never an error and never a 404 — billing asking for a quiet month must get
 * the same file they always get, with nothing in it. That falls out of this
 * function naturally; the guard is that nobody adds an early return above.
 *
 * ⚠ NO STYLING, NO FROZEN HEADER. This build of `xlsx` writes neither — an
 * `!freeze` key here would read as a working feature while doing nothing at
 * all (components/tint/ti-report-content.tsx sets one; it has never done
 * anything). Irrelevant here anyway: billing pastes these VALUES into their own
 * macro workbook, which owns the presentation.
 */
export function buildCiRegisterWorkbook(rows: readonly CiRegisterRow[]): ArrayBuffer {
  const sheet: Cell[][] = [REGISTER_COLUMNS.map((c) => c.header)];

  for (const r of rows) {
    sheet.push([
      // A — dealer code. Numeric like their file; digitsCell keeps a
      // hypothetical zero-padded code intact rather than shortening it.
      digitsCell(r.dealerCode),
      // B — DELAR NAME (sic).
      r.dealerName,
      // C, D — the bill. Blank when SAP has not invoiced it yet, which is a
      // real state (5% of dispatched bills) and not a gap to fill.
      r.invoiceNo,
      ddmmyyyy(r.invoiceDate),
      // E — SAP's own CI number. See digitsCell for why this is not Number().
      digitsCell(r.sapCiNumber),
      // F
      ddmmyyyy(r.ciDate),
      // G — LITRES. A real 0 writes as 0 and stays visible; only a genuinely
      // unknown value would be blank, and totalLitres is always a number.
      r.totalLitres,
      // H — 'CI Order value ' (sic, trailing space in the header above).
      // A NUMBER, so the column sums in Excel. ⚠ This is deliberately NOT what
      // CiDetail.ciValue does — that keeps a string, because a signed form must
      // print the exact scale the column stores. A spreadsheet cell is the one
      // place the number is more useful than the string.
      r.ciValue === null ? null : Number(r.ciValue),
      // I — NON TINTED. BLANK BY RULING, though derivable. See the header.
      null,
      // J — REASON (their SAP reason code). No source; billing types it.
      null,
      // K — REMARK: our reason label, uppercased to match their register
      // ("Physically Cross" → "PHYSICALLY CROSS").
      r.reasonLabel === null ? null : r.reasonLabel.toUpperCase(),
      // L, M — no source in this schema.
      null,
      null,
      // N — ⚠ "PARTIAL", not "PART". The CI screens say Part; their register
      // says PARTIAL, and the register is theirs.
      r.returnType === "full" ? "FULL" : "PARTIAL",
      // O — empty rather than guessed if the answer is somehow missing.
      r.materialMoved === null ? null : r.materialMoved === "moved" ? "M" : "NM",
      // P — the division code. Numeric, like every other bare code in their
      // file; blank when the bill carries no smu at all.
      digitsCell(r.division),
      // Q — remark2.
      null,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(sheet);
  ws["!cols"] = REGISTER_COLUMNS.map((c) => ({ wch: c.width }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);

  // `array`, not `buffer`: it hands back a plain ArrayBuffer, which IS a
  // BodyInit. A Node Buffer is not, and casting round that would hide the fact
  // that this route has no reason to touch a Node-only type.
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
