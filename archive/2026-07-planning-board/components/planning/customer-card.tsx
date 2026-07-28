"use client";

import { cn } from "@/lib/utils";
import { CarriedOverBadge } from "@/components/shared/carried-over-badge";
import { CascadeBadge, shouldShowCascadeBadge } from "@/components/shared/cascade-badge";
import type { BoardOrder } from "./planning-page";

interface CustomerCardProps {
  order: BoardOrder;
  selected: boolean;
  onToggle: () => void;
  onClick: () => void;
  isHistoryView?: boolean;
}

export function CustomerCard({ order, selected, onToggle, onClick, isHistoryView = false }: CustomerCardProps) {
  const weight = order.querySnapshot?.totalWeight ?? 0;
  const area = order.customer?.area?.name ?? "";
  const name = order.customer?.customerName ?? order.shipToCustomerName ?? "—";
  const rating = order.customer?.customerRating;
  const pri = order.priorityLevel;

  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 cursor-pointer transition-colors",
        selected
          ? "border-gray-300 bg-gray-50"
          : "border-gray-200 bg-white hover:border-gray-300",
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          {pri <= 2 && (
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full flex-shrink-0",
                pri === 1 ? "bg-red-400" : "bg-amber-400",
              )}
            />
          )}
          {rating === "A" && (
            <span className="text-[10px] text-amber-500 flex-shrink-0">★</span>
          )}
          <span className="text-[11px] font-medium text-gray-800 truncate">
            {name}
          </span>
        </div>
        {!isHistoryView && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className={cn(
              "w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors",
              selected
                ? "bg-teal-600"
                : "border border-gray-300 hover:border-gray-400",
            )}
          >
            {selected && (
              <svg width="10" height="10" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        )}
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[9px] text-gray-400 flex items-center gap-1.5">
          {area ? `${area} · ` : ""}1 OBD
          <CarriedOverBadge daysOverdue={order.daysOverdue} />
          {shouldShowCascadeBadge(order.slotId, order.originalSlotId) && order.originalSlot && (
            <CascadeBadge originalSlotName={order.originalSlot.name} />
          )}
        </span>
        <span className="text-[11px] font-medium text-gray-600">
          {weight.toFixed(0)} kg
        </span>
      </div>
    </div>
  );
}
