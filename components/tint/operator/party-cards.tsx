"use client";

import { cn } from "@/lib/utils";

// The Bill To / Ship To pair that sits under Row 2 on Tint Operator.
//
// EXTRACTED VERBATIM from components/tint/tint-operator-content.tsx (the
// "Row 3: Bill To / Ship To Cards" block) so the History face reuses the real
// thing instead of cloning it. A MOVE, not a rewrite: every className, every
// label string, the delivery dot and the `·`-joined meta line are unchanged,
// and `deliveryDotClass` came across with it (it had exactly one call site,
// inside this block).
//
// ⚠ POSITIONING IS THE CALLER'S. The original block's outer wrapper carried
// `position: sticky; top: 96` — that stayed behind in tint-operator-content
// because it belongs to the Jobs layout, not to the cards. History renders
// these in a normally-flowing detail pane. Do not add positioning here.

/** Delivery-type dot colours — CLAUDE_UI.md §3. */
export function deliveryDotClass(type: string | null | undefined): string {
  if (type === "Local") return "bg-blue-600";
  if (type === "Upcountry") return "bg-orange-600";
  if (type === "IGT") return "bg-teal-600";
  if (type === "Cross Depot") return "bg-rose-600";
  return "bg-gray-400";
}

export function OperatorPartyCards({
  billToCustomerName,
  billToCustomerId,
  shipToName,
  deliveryTypeName,
  areaName,
  routeName,
  shipToBadge,
}: {
  billToCustomerName: string | null;
  billToCustomerId: string | null;
  shipToName: string | null;
  deliveryTypeName: string | null;
  areaName: string | null;
  routeName: string | null;
  /**
   * Optional pill rendered inline after the ship-to name. The Jobs face passes
   * its New site / Repeat site badge here; History passes nothing.
   */
  shipToBadge?: React.ReactNode;
}) {
  return (
    <>
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-3">
        <div className="text-[9px] font-semibold uppercase tracking-[.4px] text-gray-400 mb-1">Bill to (customer)</div>
        <div className="text-[13px] font-semibold text-gray-900">{billToCustomerName ?? "—"}</div>
        <div className="font-mono text-[11px] text-gray-400 mt-0.5">{billToCustomerId ?? "—"}</div>
      </div>
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-3">
        <div className="text-[9px] font-semibold uppercase tracking-[.4px] text-gray-400 mb-1">Ship to (site)</div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-[13px] font-semibold text-gray-900">{shipToName ?? "—"}</div>
          {shipToBadge}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-0.5">
          {deliveryTypeName && <span className={cn("w-[5px] h-[5px] rounded-full flex-shrink-0", deliveryDotClass(deliveryTypeName))} />}
          {[deliveryTypeName, areaName, routeName].filter(Boolean).join(" · ")}
        </div>
      </div>
    </>
  );
}
