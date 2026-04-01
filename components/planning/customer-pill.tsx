"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { CarriedOverBadge } from "@/components/shared/carried-over-badge";
import { CascadeBadge, shouldShowCascadeBadge } from "@/components/shared/cascade-badge";
import type { BoardOrder } from "./planning-page";

interface CustomerPillProps {
  order: BoardOrder;
  onClick?: () => void;
}

export function CustomerPill({ order, onClick }: CustomerPillProps) {
  const isPicked =
    order.splits.length > 0
      ? order.splits.every((s) => s.isPicked)
      : order.isPicked;

  const weight = order.querySnapshot?.totalWeight ?? 0;
  const qty = order.querySnapshot?.totalUnitQty ?? 0;
  const obdCount = 1; // each order = 1 OBD
  const hasTinting = order.querySnapshot?.hasTinting ?? false;
  const area = order.customer?.area?.name ?? "";
  const name = order.customer?.customerName ?? order.shipToCustomerName ?? "—";
  const rating = order.customer?.customerRating;
  const pri = order.priorityLevel;

  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-lg border p-3 min-w-[180px] flex-1 max-w-[220px] transition-all",
        isPicked
          ? "border-gray-100 bg-gray-50"
          : "border-gray-200 bg-white cursor-pointer hover:border-gray-300 hover:shadow-sm",
      )}
    >
      {/* Row 1: priority + name + star + pick status */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {pri <= 2 && (
            <span
              className={cn(
                "w-2 h-2 rounded-full flex-shrink-0",
                pri === 1 ? "bg-red-400" : "bg-amber-400",
              )}
            />
          )}
          {pri > 2 && (
            <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
          )}
          <span
            className={cn(
              "text-[11px] font-medium truncate",
              isPicked ? "text-gray-500" : "text-gray-800",
            )}
          >
            {name}
          </span>
          {rating === "A" && (
            <span className="text-[10px] text-amber-500 flex-shrink-0">★</span>
          )}
        </div>
        {isPicked ? (
          <Check size={12} className="text-gray-400 flex-shrink-0" />
        ) : (
          <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
        )}
      </div>

      {/* Row 2: OBDs · Weight · Units */}
      <div
        className={cn(
          "text-[10px] mb-1.5",
          isPicked ? "text-gray-400" : "text-gray-500",
        )}
      >
        {obdCount} OBD{obdCount !== 1 ? "s" : ""} ·{" "}
        <span
          className={cn(
            "font-medium",
            isPicked ? "text-gray-500" : "text-gray-700",
          )}
        >
          {weight.toFixed(0)} kg
        </span>{" "}
        · {qty} units
      </div>

      {/* Row 3: Area + Carried Over + Tinting */}
      <div className="flex items-center gap-2 text-[9px]">
        <span className="text-gray-400">{area || "—"}</span>
        <CarriedOverBadge daysOverdue={order.daysOverdue} />
        {shouldShowCascadeBadge(order.slotId, order.originalSlotId) && order.originalSlot && (
          <CascadeBadge originalSlotName={order.originalSlot.name} />
        )}
        {hasTinting && (
          <span className="text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded flex items-center gap-0.5">
            🎨 Tinting
          </span>
        )}
      </div>
    </div>
  );
}
