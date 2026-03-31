"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { CarriedOverBadge } from "@/components/shared/carried-over-badge";
import type { CustomerGroup } from "./warehouse-page";

interface UnassignedCardProps {
  group: CustomerGroup;
  selected: boolean;
  onToggle: () => void;
  slotUrgent: boolean;
  isHistoryView?: boolean;
}

function buildWhyHint(group: CustomerGroup, slotUrgent: boolean): string {
  const parts: string[] = [];
  if (slotUrgent) parts.push("Slot closing");
  if (group.tripInfo) parts.push("Vehicle");
  parts.push(group.priority);
  if (group.customerRating === "A") parts.push("★");
  return parts.join(" · ");
}

export function UnassignedCard({ group, selected, onToggle, slotUrgent, isHistoryView = false }: UnassignedCardProps) {
  const [expanded, setExpanded] = useState(false);

  const whyHint = buildWhyHint(group, slotUrgent);
  const maxDaysOverdue = Math.max(...group.orders.map((o) => o.daysOverdue), 0);

  return (
    <div
      className={cn(
        "rounded-lg border transition-colors",
        selected ? "border-gray-300 bg-gray-50" : "border-gray-200 bg-white hover:border-gray-300",
      )}
    >
      {/* Main card area */}
      <div className="p-2.5 cursor-pointer" onClick={onToggle}>
        {/* Row 1: checkbox + priority + star + name + chevron */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            {/* Checkbox */}
            {!isHistoryView && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle();
                }}
                className={cn(
                  "w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors",
                  selected ? "bg-gray-700" : "border border-gray-300 hover:border-gray-400",
                )}
              >
                {selected && (
                  <svg width="10" height="10" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            )}

            {/* Priority dot */}
            {group.priority === "P1" && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
            )}
            {group.priority === "P2" && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
            )}
            {group.priority === "P3" && (
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" />
            )}

            {/* Key star */}
            {group.customerRating === "A" && (
              <span className="text-[10px] text-amber-500 flex-shrink-0">★</span>
            )}

            {/* Name */}
            <span className="text-[11px] font-medium text-gray-800 truncate">
              {group.customerName}
            </span>
          </div>

          {/* Expand chevron */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="text-gray-400 hover:text-gray-600 transition-colors p-0.5"
          >
            <ChevronDown
              size={12}
              className={cn("transition-transform", expanded && "rotate-180")}
            />
          </button>
        </div>

        {/* Row 2: area · OBD count + carried over + weight */}
        <div className="flex items-center justify-between mt-1">
          <span className="text-[9px] text-gray-400 flex items-center gap-1.5">
            {group.area ? `${group.area} · ` : ""}
            {group.orders.length} OBD{group.orders.length !== 1 ? "s" : ""}
            <CarriedOverBadge daysOverdue={maxDaysOverdue} />
          </span>
          <span className="text-[11px] font-medium text-gray-600">
            {group.totalKg.toFixed(0)} kg
          </span>
        </div>

        {/* Row 3: Vehicle tag + Tinting badge */}
        {(group.tripInfo || group.hasTinting) && (
          <div className="flex items-center gap-2 mt-1 text-[9px]">
            {group.tripInfo && (
              <span className="text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                🚚 Trip {group.tripInfo.tripNumber} · {group.tripInfo.vehicleType}
              </span>
            )}
            {group.hasTinting && group.tintingPendingCount > 0 && (
              <span className="text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                🎨 {group.tintingPendingCount}
              </span>
            )}
            {group.hasTinting && group.tintingPendingCount === 0 && (
              <span className="text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                🎨 Done
              </span>
            )}
          </div>
        )}

        {/* Row 4: WHY hint */}
        <div className="mt-1">
          <span className="text-[8px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
            {whyHint}
          </span>
        </div>
      </div>

      {/* Expanded: OBD rows */}
      {expanded && group.orders.length > 0 && (
        <div className="border-t border-gray-100 px-2.5 py-2 space-y-1.5">
          {group.orders.map((order) => (
            <div
              key={order.id}
              className="flex items-center gap-2 text-[10px]"
            >
              {order.isPicked ? (
                <svg width="10" height="10" fill="none" stroke="#9ca3af" strokeWidth="2" viewBox="0 0 24 24" className="flex-shrink-0">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
              )}
              <span className="font-mono text-gray-600">{order.obdNumber}</span>
              {order.hasTinting && order.tintingStatus === "pending" && (
                <span className="text-[8px] text-purple-600 bg-purple-50 px-1 py-0.5 rounded">
                  🎨 Tint
                </span>
              )}
              <div className="flex-1" />
              <span className="text-gray-500">{order.weightKg.toFixed(0)} kg</span>
              <span className="text-gray-400">{order.units}u</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
