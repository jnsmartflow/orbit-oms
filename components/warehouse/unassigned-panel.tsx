"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import { UnassignedCard } from "./unassigned-card";
import type { CustomerGroup, PickerInfo } from "./warehouse-page";

interface UnassignedPanelProps {
  groups: CustomerGroup[];
  pickers: PickerInfo[];
  selectedOrderIds: Set<number>;
  onToggleCustomer: (orderIds: number[]) => void;
  onAssign: (orderIds: number[], pickerId: number) => Promise<void>;
  isHistoryView?: boolean;
}

export function UnassignedPanel({
  groups,
  pickers,
  selectedOrderIds,
  onToggleCustomer,
  onAssign,
  isHistoryView = false,
}: UnassignedPanelProps) {
  const totalOrders = useMemo(
    () => groups.reduce((s, g) => s + g.orders.length, 0),
    [groups],
  );

  const totalKg = useMemo(
    () => groups.reduce((s, g) => s + g.totalKg, 0),
    [groups],
  );

  const selectedKg = useMemo(() => {
    let kg = 0;
    for (const g of groups) {
      for (const o of g.orders) {
        if (selectedOrderIds.has(o.id)) kg += o.weightKg;
      }
    }
    return kg;
  }, [groups, selectedOrderIds]);

  function handleAssignClick() {
    const sel = document.getElementById("wh-picker-select") as HTMLSelectElement | null;
    const pickerId = sel ? parseInt(sel.value, 10) : NaN;
    if (isNaN(pickerId) || !pickerId) {
      toast.error("Select a picker first");
      return;
    }
    void onAssign(Array.from(selectedOrderIds), pickerId);
  }

  return (
    <div className="w-[300px] border-r border-gray-200 bg-white flex flex-col flex-shrink-0">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-700">Unassigned</span>
        <span className="text-[10px] text-gray-400">
          {groups.length} customer{groups.length !== 1 ? "s" : ""} · {totalKg.toFixed(0)} kg · {totalOrders} OBD{totalOrders !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Sort indicator */}
      <div className="px-3 py-1.5 border-b border-gray-100">
        <span className="text-[9px] text-gray-400">Auto-sorted: Slot → Vehicle → Priority</span>
      </div>

      {/* Card list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {groups.length === 0 ? (
          <p className="text-[11px] text-gray-400 text-center py-8">All orders assigned</p>
        ) : (
          groups.map((group) => {
            const groupOrderIds = group.orders.map((o) => o.id);
            const allSelected = groupOrderIds.length > 0 && groupOrderIds.every((id) => selectedOrderIds.has(id));
            // Slot urgent: sortOrder 1 is Morning = most urgent by default
            const slotUrgent = group.slotSortOrder === 1;

            return (
              <UnassignedCard
                key={group.customerId}
                group={group}
                selected={allSelected}
                onToggle={() => onToggleCustomer(groupOrderIds)}
                slotUrgent={slotUrgent}
                isHistoryView={isHistoryView}
              />
            );
          })
        )}
      </div>

      {/* Assign footer */}
      {!isHistoryView && selectedOrderIds.size > 0 && (
        <div className="px-3 py-3 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between text-[10px] text-gray-500 mb-2">
            <span>
              <span className="font-medium text-gray-700">{selectedOrderIds.size}</span> selected
            </span>
            <span className="font-medium text-gray-700">{selectedKg.toFixed(0)} kg</span>
          </div>
          <div className="flex gap-2">
            <select
              id="wh-picker-select"
              defaultValue=""
              className="flex-1 h-8 px-2 text-[10px] border border-gray-300 rounded-lg bg-white text-gray-600 focus:outline-none"
            >
              <option value="">Picker…</option>
              {pickers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.pendingCount > 0 ? ` (${p.pendingCount} pending)` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAssignClick}
              className="h-8 px-4 bg-gray-800 hover:bg-gray-900 text-white text-[10px] font-medium rounded-lg transition-colors"
            >
              Assign
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
