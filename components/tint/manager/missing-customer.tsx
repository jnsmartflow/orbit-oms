"use client";

// components/tint/manager/missing-customer.tsx — the missing-customer marks on
// the Tint Manager's rows and rail cards (2026-10-02).
//
// The page computes WHICH bills are missing (lib/tint/customer-missing.ts →
// missingOnBoard) and provides it here once; every table and the rail read it
// through `useMissingCustomer(orderId)`, so no tab grows a prop chain and the
// rule is never re-derived in a component.
//
// Marks: a pale amber row + 4px orange left bar (kept with the filter off), and
// in the Ship To cell / rail card the SAP ship-to code + a solid orange
// "+ Add Ship to" tag that opens CustomerMissingSheet (never the detail panel).
// After a save, the rows of the fixed code flash green for ~2s.

import { createContext, useContext } from "react";
import type { MissingCustomerBill } from "@/lib/tint/customer-missing";
import { cn } from "@/lib/utils";

export interface MissingCustomerContextValue {
  byOrder: Map<number, MissingCustomerBill>;
  /** customers canEdit — the sheet's save gate. */
  canAdd:  boolean;
  onAdd:   (bill: MissingCustomerBill) => void;
  /** Order ids just fixed by a save — flash green. */
  flash:   ReadonlySet<number>;
}

const EMPTY: MissingCustomerContextValue = {
  byOrder: new Map(), canAdd: false, onAdd: () => {}, flash: new Set(),
};

export const MissingCustomerContext = createContext<MissingCustomerContextValue>(EMPTY);

/** The whole context — a table reads it ONCE, then calls missingRowCls per row. */
export function useMissingCustomers(): MissingCustomerContextValue {
  return useContext(MissingCustomerContext);
}

/** Row classes for one bill: green while flashing after a save, else amber +
 *  4px orange bar when missing, else nothing. A SELECTED row keeps its own look
 *  (callers pass the result only when not selected). */
export function missingRowCls(ctx: MissingCustomerContextValue, orderId: number | null | undefined): string {
  if (orderId == null) return "";
  if (ctx.flash.has(orderId)) return "!bg-ok-bg transition-colors duration-500";
  return ctx.byOrder.has(orderId)
    ? "bg-warn-bg hover:!bg-warn-bg [&>td:first-child]:shadow-[inset_4px_0_0_theme(colors.warn.DEFAULT)]"
    : "";
}

/** The rail card's version of the row mark (a card, not a table row). */
export function missingCardCls(bill: MissingCustomerBill | null, flashing: boolean): string {
  if (flashing) return "!bg-ok-bg !border-ok";
  return bill ? "!bg-warn-bg shadow-[inset_4px_0_0_theme(colors.warn.DEFAULT)]" : "";
}

/**
 * The SAP ship-to code + "+ Add Ship to" — rendered under the ship-to name.
 * Renders nothing for a bill that is not missing. Clicking never bubbles to the
 * row (no select, no panel). Without the customers canEdit tick it is greyed,
 * inert, with the reason on hover.
 */
export function MissingShipToLine({ orderId, className }: { orderId: number; className?: string }) {
  const ctx = useContext(MissingCustomerContext);
  const bill = ctx.byOrder.get(orderId);
  if (!bill) return null;
  return (
    <div className={cn("mt-0.5 flex min-w-0 items-center gap-1.5", className)}>
      {bill.shipToCustomerId && (
        <span className="truncate font-mono text-[10.5px] text-[#9ca3af]" title={`SAP ship-to ${bill.shipToCustomerId}`}>
          {bill.shipToCustomerId}
        </span>
      )}
      <AddShipToTag bill={bill} />
    </div>
  );
}

export function AddShipToTag({ bill }: { bill: MissingCustomerBill }) {
  const ctx = useContext(MissingCustomerContext);
  const base = "inline-flex flex-shrink-0 items-center rounded-[5px] px-[7px] py-px text-[10px] font-bold leading-[16px] whitespace-nowrap";
  if (!ctx.canAdd) {
    return (
      <span title="No permission to add customers" onClick={(e) => e.stopPropagation()}>
        <span className={cn(base, "cursor-not-allowed bg-gray-100 text-gray-400")}>+ Add Ship to</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); ctx.onAdd(bill); }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(base, "bg-warn text-white hover:bg-warn-text")}
      title={`Ship-to ${bill.shipToCustomerId ?? ""} is not in the customer master — add it`}
    >
      + Add Ship to
    </button>
  );
}
