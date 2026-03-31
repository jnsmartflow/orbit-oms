"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { PickerLanePicking, PickerLaneAvailable } from "./picker-lane";
import type { PickerLane, PickerInfo } from "./warehouse-page";

type DtFilter = "all" | "local" | "upcountry" | "igt" | "cross";

const FILTER_OPTIONS: { key: DtFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "local", label: "Local" },
  { key: "upcountry", label: "Upcountry" },
  { key: "igt", label: "IGT" },
  { key: "cross", label: "Cross" },
];

function laneHasDeliveryType(lane: PickerLane, dt: DtFilter): boolean {
  if (dt === "all") return true;
  return lane.assignments.some(
    (g) => g.deliveryType.toLowerCase().includes(dt) && g.orders.some((o) => !o.isPicked),
  );
}

interface PickersPanelProps {
  lanes: PickerLane[];
  availablePickers: PickerInfo[];
  onMarkPicked: (orderId: number) => Promise<void>;
  isHistoryView?: boolean;
}

export function PickersPanel({ lanes, availablePickers, onMarkPicked, isHistoryView = false }: PickersPanelProps) {
  const [dtFilter, setDtFilter] = useState<DtFilter>("all");

  const filteredLanes = useMemo(
    () => lanes.filter((lane) => laneHasDeliveryType(lane, dtFilter)),
    [lanes, dtFilter],
  );

  const pickingCount = filteredLanes.length;
  const availableCount = availablePickers.length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-medium text-gray-700">Pickers</span>
          <div className="flex items-center gap-1">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setDtFilter(opt.key)}
                className={cn(
                  "text-[9px] px-2 py-1 rounded transition-colors",
                  dtFilter === opt.key
                    ? "bg-gray-800 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <span className="text-[10px] text-gray-400">
          {pickingCount} picking · {availableCount} available
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">
        {pickingCount === 0 && availableCount === 0 ? (
          <p className="text-[11px] text-gray-400 text-center py-12">
            No pickers available
          </p>
        ) : (
          <>
            {/* Picking lanes */}
            {filteredLanes.map((lane, i) => (
              <PickerLanePicking
                key={lane.picker.id}
                lane={lane}
                index={i}
                onMarkPicked={onMarkPicked}
                isHistoryView={isHistoryView}
              />
            ))}

            {/* Available section — always shown regardless of filter */}
            {availableCount > 0 && (
              <>
                <div className="px-2 pt-3 pb-1">
                  <span className="text-[9px] font-medium text-gray-400 uppercase tracking-wide">
                    Available
                  </span>
                </div>
                {availablePickers.map((p, i) => (
                  <PickerLaneAvailable
                    key={p.id}
                    picker={p}
                    index={filteredLanes.length + i}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
