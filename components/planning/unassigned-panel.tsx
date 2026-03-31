"use client";

import { useState, useMemo } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { CustomerCard } from "./customer-card";
import type { BoardOrder, BoardPlan } from "./planning-page";

type Grouping = "none" | "route" | "area" | "priority";

interface UnassignedPanelProps {
  orders: BoardOrder[];
  plans: BoardPlan[];
  selectedOrders: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
  onOrderClick: (order: BoardOrder) => void;
  onCreateTrip: (orderIds: number[]) => Promise<void>;
  onAddToTrip: (planId: number, orderIds: number[]) => Promise<void>;
  onAutoDraft: () => Promise<void>;
  canManagePlan: boolean;
  isHistoryView?: boolean;
}

const GROUP_LABELS: Record<Grouping, string> = {
  none: "None",
  route: "Route",
  area: "Area",
  priority: "Priority",
};

export function UnassignedPanel({
  orders,
  plans,
  selectedOrders,
  onSelectionChange,
  onOrderClick,
  onCreateTrip,
  onAddToTrip,
  onAutoDraft,
  canManagePlan,
  isHistoryView = false,
}: UnassignedPanelProps) {
  const [grouping, setGrouping] = useState<Grouping>("route");
  const [creating, setCreating] = useState(false);
  const [autoDrafting, setAutoDrafting] = useState(false);

  const totalWeight = useMemo(
    () => orders.reduce((sum, o) => sum + (o.querySnapshot?.totalWeight ?? 0), 0),
    [orders],
  );

  const selectedWeight = useMemo(() => {
    return orders
      .filter((o) => selectedOrders.has(o.id))
      .reduce((sum, o) => sum + (o.querySnapshot?.totalWeight ?? 0), 0);
  }, [orders, selectedOrders]);

  // Group orders
  const groups = useMemo(() => {
    if (grouping === "none") return [{ label: "", orders }];

    const map = new Map<string, BoardOrder[]>();
    for (const o of orders) {
      let key: string;
      switch (grouping) {
        case "route":
          key = o.customer?.area?.primaryRoute?.name ?? "No Route";
          break;
        case "area":
          key = o.customer?.area?.name ?? "No Area";
          break;
        case "priority":
          key = o.priorityLevel === 1 ? "P1 Urgent" : o.priorityLevel === 2 ? "P2 High" : "P3 Normal";
          break;
        default:
          key = "";
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }

    return Array.from(map.entries())
      .map(([label, orders]) => ({ label, orders }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [orders, grouping]);

  function toggleSelect(id: number) {
    const next = new Set(selectedOrders);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  async function handleCreateTrip() {
    if (selectedOrders.size === 0) return;
    setCreating(true);
    try {
      await onCreateTrip(Array.from(selectedOrders));
    } finally {
      setCreating(false);
    }
  }

  async function handleAutoDraft() {
    setAutoDrafting(true);
    try {
      await onAutoDraft();
    } finally {
      setAutoDrafting(false);
    }
  }

  // Eligible plans for "Add to" dropdown
  const draftPlans = plans.filter((p) => p.status === "draft");

  return (
    <div className="w-[300px] border-r border-gray-200 bg-white flex flex-col flex-shrink-0">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-700">Unassigned</span>
        <span className="text-[10px] text-gray-400">
          {orders.length} customer{orders.length !== 1 ? "s" : ""} · {totalWeight.toFixed(0)} kg
        </span>
      </div>

      {/* Auto Draft */}
      {canManagePlan && !isHistoryView && (
        <div className="px-3 py-3 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-white">
          <button
            type="button"
            onClick={handleAutoDraft}
            disabled={autoDrafting || orders.length === 0}
            className="w-full h-10 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium rounded-lg flex items-center justify-center gap-2 shadow-sm transition-colors disabled:opacity-50"
          >
            {autoDrafting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Auto Draft All
          </button>
          <p className="text-[9px] text-gray-500 mt-2 text-center">
            Groups by route · Max 1,500 kg per trip
          </p>
        </div>
      )}

      {/* Grouping filters */}
      <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
        <span className="text-[9px] text-gray-400">Group:</span>
        {(Object.keys(GROUP_LABELS) as Grouping[])
          .filter((g) => g !== "none")
          .map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGrouping(g)}
              className={cn(
                "text-[9px] px-2 py-1 rounded transition-colors",
                grouping === g
                  ? "bg-gray-800 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200",
              )}
            >
              {GROUP_LABELS[g]}
            </button>
          ))}
      </div>

      {/* Customer list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {orders.length === 0 ? (
          <p className="text-[11px] text-gray-400 text-center py-8">
            No unassigned orders
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label || "__all"}>
              {group.label && (
                <div className="px-2 py-1.5 text-[9px] font-medium text-gray-500 uppercase tracking-wide bg-gray-50 rounded flex items-center justify-between mt-1 first:mt-0">
                  <span>{group.label}</span>
                  <span className="text-gray-400 font-normal">
                    {group.orders.length} ·{" "}
                    {group.orders
                      .reduce((s, o) => s + (o.querySnapshot?.totalWeight ?? 0), 0)
                      .toFixed(0)}{" "}
                    kg
                  </span>
                </div>
              )}
              {group.orders.map((order) => (
                <CustomerCard
                  key={order.id}
                  order={order}
                  selected={selectedOrders.has(order.id)}
                  onToggle={() => toggleSelect(order.id)}
                  onClick={() => onOrderClick(order)}
                  isHistoryView={isHistoryView}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* Selection footer */}
      {canManagePlan && !isHistoryView && selectedOrders.size > 0 && (
        <div className="px-3 py-3 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between text-[10px] text-gray-500 mb-2">
            <span>
              <span className="font-medium text-gray-700">{selectedOrders.size}</span> selected
            </span>
            <span className="font-medium text-gray-700">{selectedWeight.toFixed(0)} kg</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCreateTrip}
              disabled={creating}
              className="flex-1 h-8 bg-gray-800 hover:bg-gray-900 text-white text-[10px] font-medium rounded-lg flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
            >
              {creating && <Loader2 size={11} className="animate-spin" />}
              + Create Trip
            </button>
            {draftPlans.length > 0 && (
              <select
                defaultValue=""
                onChange={(e) => {
                  const planId = parseInt(e.target.value, 10);
                  if (!isNaN(planId)) {
                    void onAddToTrip(planId, Array.from(selectedOrders));
                  }
                  e.target.value = "";
                }}
                className="h-8 px-3 text-gray-600 text-[10px] font-medium border border-gray-300 rounded-lg bg-white hover:bg-gray-50 cursor-pointer focus:outline-none"
              >
                <option value="">Add to ▾</option>
                {draftPlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    Trip {p.tripNumber}
                    {p.vehicle ? ` · ${p.vehicle.vehicleNo}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
