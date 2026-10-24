"use client";

// The two REFERENCE cells of a bill row — the OBD cell's date line and the
// Invoice cell's two lines — extracted VERBATIM from components/floor/floor-table.tsx
// (2026-10-02) so the Tint Manager's Tint and Base tables render them with
// Floor's own markup and formatter instead of a second copy (owner: "reuse
// Floor's, never retype"). Floor's table imports them back; its output is
// byte-identical. Owned by CLAUDE_FLOOR (§4.9 the bill table).

import { Mail } from "lucide-react";
// formatDateIST is the SHARED date-only formatter — the same one the detail
// panel's "Invoice date" cell reads. One formatter, so the surfaces cannot disagree.
import { formatDateIST } from "@/lib/floor/format";
import { loadPartText } from "@/lib/order-invoices/load-plan";

/** "01 Oct 14:05" in IST — the OBD cell's date line (and Floor's other day+time reads). */
export function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso)
    .toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
    .replace(",", "");
}

/**
 * The muted second line under an OBD number: the bill's display date + time
 * (lib/floor/format.ts resolveFloorDisplayDate decides which clock), with the
 * ✉ mark when it is the EMAIL time rather than SAP's punch time.
 */
// `iso` takes a Date too: PickingQueueRow types obdDateTime as string | Date | null
// (a server-built row holds a Date; the JSON a client receives holds a string).
//
// `trailing` (2026-10-07, Challan orders M2): something to sit AFTER the date on
// this line — Floor puts an ORB row's trip tag here, because the 14-character ORB
// number leaves no room for it beside the number. Absent = the line is unchanged.
export function ObdDateLine({
  iso,
  isEmailTime,
  trailing,
}: {
  iso: string | Date | null;
  isEmailTime: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 text-[10px] text-[#9ca3af]">
      {fmtDateTime(iso instanceof Date ? iso.toISOString() : iso)}
      {isEmailTime && (
        <span title="Email time" className="inline-flex shrink-0">
          <Mail size={9.5} />
        </span>
      )}
      {trailing}
    </div>
  );
}

/**
 * The Invoice cell's contents — SAP's own invoiceNo over invoiceDate.
 *
 * ⚠ EMPTY WHEN EMPTY — no em dash, no placeholder (owner call 2026-08-31, see the
 * long note in floor-table.tsx): a bill still being picked simply has no invoice
 * yet, and a dash would read as "we looked and found nothing". The two lines are
 * independent — patch-headers fills the two fields with separate fill-if-null tests.
 */
//
// ADD INVOICES (Phase 4 commit 2, 2026-10-13 — replaced the "+n" chip):
//   `part`         — this row is ONE invoice of a split OBD drawn as one row per
//                    invoice (floor-table.tsx): a "k/n" chip after the number.
//   `invoiceCount` — a split OBD drawn as ONE row anyway (On hold, Cancel & CI,
//                    a re-delivery row): "n invoices" after SAP's number.
// Both omitted (every other caller, and every unsplit bill) → exactly as before.
//   `load`         — SPLIT LOAD (phase 3, 2026-10-24): this row is a truck part
//                    of its invoice — "part k of n" (LoadPartChip) after the
//                    number. With no number yet the caller puts the tag beside
//                    the OBD number instead (this component draws nothing then).
export function InvoiceLines({
  invoiceNo,
  invoiceDate,
  part,
  invoiceCount,
  load,
}: {
  invoiceNo: string | null;
  invoiceDate: string | null;
  part?: { k: number; n: number } | null;
  invoiceCount?: number;
  load?: { k: number; n: number } | null;
}) {
  const many = invoiceCount !== undefined && invoiceCount > 1 ? invoiceCount : null;
  return (
    <>
      {invoiceNo && (
        <span className="font-mono text-[11.5px] font-medium text-[#111827]">
          {invoiceNo}
          {part && <InvoicePartChip k={part.k} n={part.n} />}
          {load && <LoadPartChip k={load.k} n={load.n} />}
          {many !== null && <InvoiceCountChip n={many} />}
        </span>
      )}
      {invoiceDate && (
        <div className="text-[10px] text-[#9ca3af]">
          {formatDateIST(invoiceDate)}
        </div>
      )}
    </>
  );
}

/** "2/4" — the 2nd of this OBD's 4 invoices (Add invoices Phase 4). Ink, like
 *  the pair's "k of n"; the slash form keeps the two apart on one row. */
export function InvoicePartChip({ k, n }: { k: number; n: number }) {
  return (
    <span
      title={`Invoice ${k} of this OBD's ${n}`}
      className="ml-1 rounded-[4px] bg-ink-100 px-1 py-px font-sans text-[10px] font-semibold tabular-nums text-ink-700"
    >
      {k}/{n}
    </span>
  );
}

/** "part 1 of 2" — a truck PART of one SAP invoice (Split load, owner
 *  2026-10-24): grey ink and the WORD "part", so it is never read as Add
 *  invoices' "1/2" (a second paper) or a pair's "1 of 2". Not violet — violet
 *  means "selected" on Floor (CLAUDE_UI §2.1). Text from loadPartText only. */
export function LoadPartChip({ k, n, className = "ml-1" }: { k: number; n: number; className?: string }) {
  return (
    <span
      title={`Truck load ${loadPartText(k, n)} of this invoice — every part carries the same invoice number`}
      className={`${className} whitespace-nowrap rounded-[4px] bg-ink-100 px-1 py-px font-sans text-[10px] font-semibold tabular-nums text-ink-700`}
    >
      {loadPartText(k, n)}
    </span>
  );
}

/**
 * "4 invoices" — a split OBD drawn as one row (Add invoices Phase 4). `of` =
 * the OBD's own count when only `n` of them are in this place (P5-3, owner
 * decision 1: a stop says how many invoices are ON it) — then "2 invoices"
 * reads "2 of this OBD's 4 invoices are here" on hover.
 */
export function InvoiceCountChip({ n, of, className = "ml-1" }: { n: number; of?: number; className?: string }) {
  return (
    <span
      title={of !== undefined && of !== n ? `${n} of this OBD's ${of} SAP invoices are here` : `This OBD was billed as ${n} SAP invoices`}
      className={`${className} rounded-[4px] bg-ink-100 px-1 py-px font-sans text-[10px] font-semibold text-ink-700`}
    >
      {/* Two arms so the n ≥ 2 markup is exactly what it always was. */}
      {n === 1 ? <>{n} invoice</> : <>{n} invoices</>}
    </span>
  );
}
