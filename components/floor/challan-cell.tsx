"use client";

// The DC column's cell (2026-10-09, owner): the DELIVERY challan of one OBD —
// not a challan ORDER (that is the "Challan" tab and the CHALLAN pill).
//
//   📎        challan exists → click prints it on top of Floor
//             (use-challan-print.ts); hover reads "Delivery Challan · CHN-…"
//   spinner   this row's challan is loading for print; clicks ignored
//   faded 📎  voided → not clickable (the print page refuses one anyway)
//   —         no challan (only Retail Offtake / Decorative Projects get one)
//
// 🔴 EVERY CLICK STOPS HERE. A ship-to block row is ticked by clicking it
// (floor-table.tsx blockRowProps), so a 📎 click that bubbled would also
// select the bill. Its Enter/Space keydown is already ignored by the row
// (`e.target !== e.currentTarget`).
//
// Rendered per OBD, never row-spanned: rows 2..n of a merged invoice pair each
// draw their own (the challan belongs to the OBD, not the invoice).

import { Loader2, Paperclip } from "lucide-react";
import { useChallanPrint } from "./use-challan-print";

export function ChallanCell({
  orderId,
  challanNumber,
  voided,
}: {
  orderId: number;
  challanNumber: string | null;
  voided: boolean;
}) {
  const printer = useChallanPrint();

  if (challanNumber === null) return <span className="text-ink-400">—</span>;

  const title = `Delivery Challan · ${challanNumber}`;

  if (voided) {
    return (
      <span
        className="inline-flex h-6 w-6 cursor-not-allowed items-center justify-center text-ink-200"
        title={`${title} · voided`}
        onClick={(e) => e.stopPropagation()}
      >
        <Paperclip size={14} aria-hidden="true" />
      </span>
    );
  }

  const loading = printer?.printingOrderId === orderId;

  return (
    <button
      type="button"
      title={title}
      aria-label={`Print ${title}`}
      aria-busy={loading || undefined}
      disabled={!printer}
      onClick={(e) => {
        e.stopPropagation();
        if (!loading) printer?.print(orderId, challanNumber);
      }}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-600 hover:bg-ink-100 hover:text-brand-700 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-ink-600"
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin text-brand-600" aria-hidden="true" />
      ) : (
        <Paperclip size={14} aria-hidden="true" />
      )}
    </button>
  );
}
