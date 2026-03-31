"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CarriedOverBadge } from "@/components/shared/carried-over-badge";
import type { CustomerGroup } from "./warehouse-page";

interface PickCardProps {
  group: CustomerGroup;
  sequence: number;
  onMarkPicked: (orderId: number) => Promise<void>;
  isHistoryView?: boolean;
}

export function PickCard({ group, sequence, onMarkPicked, isHistoryView = false }: PickCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [loadingOrderId, setLoadingOrderId] = useState<number | null>(null);

  const pickedCount = group.orders.filter((o) => o.isPicked).length;
  const totalCount = group.orders.length;
  const allPicked = totalCount > 0 && pickedCount === totalCount;

  async function handlePick(orderId: number) {
    setLoadingOrderId(orderId);
    try {
      await onMarkPicked(orderId);
    } finally {
      setLoadingOrderId(null);
    }
  }

  return (
    <div
      className={cn(
        "w-[320px] rounded-lg border bg-white p-3 transition-all cursor-pointer",
        allPicked ? "border-gray-100 opacity-60" : "border-gray-200 hover:border-gray-300 hover:shadow-sm",
      )}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Row 1: sequence + name + pick progress */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-5 h-5 bg-gray-800 text-white text-[9px] font-bold rounded-full flex items-center justify-center flex-shrink-0">
            {sequence}
          </span>
          <span className={cn("text-[11px] font-medium truncate", allPicked ? "text-gray-500" : "text-gray-800")}>
            {group.customerName}
          </span>
        </div>
        {!allPicked && (
          <span className="text-[9px] font-medium text-amber-600 flex-shrink-0">
            {pickedCount}/{totalCount}
          </span>
        )}
        {allPicked && (
          <Check size={12} className="text-green-500 flex-shrink-0" />
        )}
      </div>

      {/* Row 2: OBD count · weight · units */}
      <div className={cn("text-[10px] mb-1", allPicked ? "text-gray-400" : "text-gray-500")}>
        {totalCount} OBD{totalCount !== 1 ? "s" : ""} ·{" "}
        <span className={cn("font-medium", allPicked ? "text-gray-500" : "text-gray-700")}>
          {group.totalKg.toFixed(0)} kg
        </span>{" "}
        · {group.totalUnits} units
      </div>

      {/* Row 3: area + carried over */}
      <div className="text-[9px] text-gray-400 mb-1 flex items-center gap-1.5">
        {group.area || "—"}
        <CarriedOverBadge daysOverdue={Math.max(...group.orders.map((o) => o.daysOverdue), 0)} />
      </div>

      {/* Row 4: vehicle + tinting */}
      {(group.tripInfo || group.hasTinting) && (
        <div className="flex items-center gap-2 text-[8px]">
          {group.tripInfo && (
            <span className="text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
              🚚 Trip {group.tripInfo.tripNumber}
            </span>
          )}
          {group.hasTinting && group.tintingPendingCount > 0 && (
            <span className="text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
              🎨 {group.tintingPendingCount}
            </span>
          )}
        </div>
      )}

      {/* Expanded: OBD rows */}
      {expanded && (
        <div className="border-t border-gray-100 mt-2 pt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          {group.orders.map((order) => (
            <div
              key={order.id}
              className={cn(
                "rounded px-2 py-1.5 flex items-center gap-2 text-[10px]",
                order.isPicked ? "bg-gray-50" : "bg-white border border-gray-200",
              )}
            >
              {order.isPicked ? (
                <Check size={10} className="text-green-500 flex-shrink-0" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
              )}
              <span className={cn("font-mono", order.isPicked ? "text-gray-500" : "text-gray-700")}>
                {order.obdNumber}
              </span>
              {order.hasTinting && order.tintingStatus === "pending" && (
                <span className="text-[8px] text-purple-600 bg-purple-50 px-1 py-0.5 rounded">🎨</span>
              )}
              <div className="flex-1" />
              <span className="text-gray-500">{order.weightKg.toFixed(0)} kg</span>
              {order.isPicked ? (
                <span className="text-[8px] text-gray-400">Picked</span>
              ) : !isHistoryView && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handlePick(order.id);
                  }}
                  disabled={loadingOrderId === order.id}
                  className="h-5 px-1.5 text-[8px] font-medium bg-gray-100 hover:bg-gray-200 text-gray-600 rounded transition-colors disabled:opacity-50 flex items-center gap-0.5"
                >
                  {loadingOrderId === order.id ? (
                    <Loader2 size={8} className="animate-spin" />
                  ) : (
                    "Pick"
                  )}
                </button>
              )}
            </div>
          ))}
          {/* SKU detail area — future iteration */}
        </div>
      )}
    </div>
  );
}
