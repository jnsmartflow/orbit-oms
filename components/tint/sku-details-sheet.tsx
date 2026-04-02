"use client";

import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LineItem {
  id?:               number;
  skuCodeRaw:        string;
  skuDescriptionRaw: string | null;
  unitQty:           number;
  volumeLine:        number | null;
  isTinting:         boolean;
}

interface SkuDetailsSheetProps {
  open:         boolean;
  onClose:      () => void;
  obdNumber:    string;
  customerName: string;
  lineItems:    LineItem[];
  splits?: {
    lineItems: {
      rawLineItemId: number;
      assignedQty:   number;
    }[];
  }[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SkuDetailsSheet({
  open,
  onClose,
  obdNumber,
  customerName,
  lineItems,
  splits,
}: SkuDetailsSheetProps) {
  function getAssignedQty(rawLineItemId: number | undefined): number {
    if (!splits || rawLineItemId === undefined) return 0;
    return splits
      .flatMap((s) => s.lineItems)
      .filter((l) => l.rawLineItemId === rawLineItemId)
      .reduce((sum, l) => sum + l.assignedQty, 0);
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-[420px] p-0 flex flex-col" showCloseButton>

        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-200">
          <p className="text-[11px] font-bold uppercase tracking-[.6px] text-gray-400 mb-1">
            SKU Line Items
          </p>
          <h2 className="text-[15px] font-bold text-gray-900">{customerName}</h2>
          <p className="text-[11.5px] font-mono text-gray-400 mt-0.5">{obdNumber}</p>
        </div>

        {/* Body */}
        <div className="px-6 py-4 flex flex-col gap-3 overflow-y-auto flex-1">

          {/* Summary pill */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-semibold text-gray-400">
              {lineItems.length} line{lineItems.length !== 1 ? "s" : ""}
            </span>
            <span className="text-[11px] text-gray-300">·</span>
            <span className="text-[11px] font-semibold text-violet-600">
              {lineItems.filter((l) => l.isTinting).length} tint
            </span>
          </div>

          {/* Line item cards */}
          {lineItems.map((line, idx) => {
            const assigned  = getAssignedQty(line.id);
            const remaining = line.unitQty - assigned;
            return (
              <div
                key={idx}
                className={cn(
                  "rounded-xl border p-3.5",
                  line.isTinting
                    ? "bg-violet-50/60 border-violet-200"
                    : "bg-gray-50 border-gray-200",
                )}
              >
                {/* SKU code + tinting badge */}
                <div className="flex items-center justify-between mb-1.5">
                  <span className={cn(
                    "font-mono text-[11.5px] font-semibold",
                    line.isTinting ? "text-violet-700" : "text-gray-700",
                  )}>
                    {line.skuCodeRaw}
                  </span>
                  {line.isTinting && (
                    <span className="bg-violet-100 text-violet-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-violet-200">
                      TINT
                    </span>
                  )}
                </div>

                {/* Description — full wrap, no truncation */}
                <p className="text-[12.5px] text-gray-700 font-medium leading-snug mb-2.5">
                  {line.skuDescriptionRaw ?? "—"}
                </p>

                {/* Qty + Volume */}
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400 mb-0.5">Qty</p>
                    <p className="text-[12px] font-semibold text-gray-900">{line.unitQty}</p>
                  </div>
                  <div>
                    <p className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400 mb-0.5">Volume</p>
                    <p className="text-[12px] font-semibold text-gray-900">{line.volumeLine ?? "—"}</p>
                  </div>
                </div>

                {/* Per-line assigned / remaining — only shown when splits data is present */}
                {assigned > 0 && (
                  <div className="mt-2 pt-2 border-t border-[#f0f1f8] flex items-center justify-between text-[11px]">
                    <span className="text-gray-400">Assigned</span>
                    <span className="font-semibold text-gray-700">{assigned}</span>
                    <span className="text-gray-400 mx-1">·</span>
                    <span className="text-gray-400">Remaining</span>
                    <span className={cn(
                      "font-semibold",
                      remaining > 0 ? "text-amber-600" : "text-green-600",
                    )}>
                      {remaining > 0 ? remaining : "Done"}
                    </span>
                  </div>
                )}
              </div>
            );
          })}

        </div>
      </SheetContent>
    </Sheet>
  );
}
