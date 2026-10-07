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
export function InvoiceLines({ invoiceNo, invoiceDate }: { invoiceNo: string | null; invoiceDate: string | null }) {
  return (
    <>
      {invoiceNo && (
        <span className="font-mono text-[11.5px] font-medium text-[#111827]">
          {invoiceNo}
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
