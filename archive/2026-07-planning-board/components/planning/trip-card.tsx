"use client";

import { useState } from "react";
import { ChevronDown, Loader2, Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CustomerPill } from "./customer-pill";
import type { BoardOrder, BoardPlan } from "./planning-page";

interface VehicleOption {
  id: number;
  vehicleNo: string;
  category: string;
  capacityKg: number;
}

interface TripCardProps {
  plan: BoardPlan;
  ordersInPlan: BoardOrder[];
  vehicles: VehicleOption[];
  onOrderClick: (order: BoardOrder) => void;
  onConfirm: (planId: number, vehicleId: number | null) => Promise<void>;
  onUpdateVehicle: (planId: number, vehicleId: number) => Promise<void>;
  onDispatch: (planId: number) => Promise<void>;
  onDeletePlan?: (planId: number) => Promise<void>;
  canManagePlan: boolean;
  canPick: boolean;
  isHistoryView?: boolean;
}

export function TripCard({
  plan,
  ordersInPlan,
  vehicles,
  onOrderClick,
  onConfirm,
  onUpdateVehicle,
  onDispatch,
  onDeletePlan,
  canManagePlan,
  canPick,
  isHistoryView = false,
}: TripCardProps) {
  const isDraft = plan.status === "draft";
  const canEdit = ["draft", "confirmed"].includes(plan.status);
  const [expanded, setExpanded] = useState(isDraft);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [pendingVehicleId, setPendingVehicleId] = useState<string>(
    plan.vehicleId ? String(plan.vehicleId) : "",
  );

  const pickedCount = ordersInPlan.filter((o) =>
    o.splits.length > 0 ? o.splits.every((s) => s.isPicked) : o.isPicked,
  ).length;
  const totalCount = ordersInPlan.length;
  const allPicked = totalCount > 0 && pickedCount === totalCount;

  // Determine primary route from orders
  const routeCounts = new Map<string, number>();
  for (const o of ordersInPlan) {
    const r = o.customer?.area?.primaryRoute?.name ?? "No Route";
    routeCounts.set(r, (routeCounts.get(r) ?? 0) + 1);
  }
  let primaryRoute = "No Route";
  let maxCount = 0;
  routeCounts.forEach((count, route) => {
    if (count > maxCount) {
      maxCount = count;
      primaryRoute = route;
    }
  });

  async function handleConfirm() {
    const vid = pendingVehicleId ? parseInt(pendingVehicleId, 10) : null;
    setConfirmLoading(true);
    try {
      await onConfirm(plan.id, vid);
    } finally {
      setConfirmLoading(false);
    }
  }

  async function handleUpdateVehicle() {
    const vid = pendingVehicleId ? parseInt(pendingVehicleId, 10) : null;
    if (!vid) return;
    setUpdateLoading(true);
    try {
      await onUpdateVehicle(plan.id, vid);
    } finally {
      setUpdateLoading(false);
    }
  }

  async function handleDispatch() {
    setDispatchLoading(true);
    try {
      await onDispatch(plan.id);
    } finally {
      setDispatchLoading(false);
    }
  }

  // Empty trip
  if (totalCount === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 px-3 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-[14px] opacity-30">🚚</span>
          <span className="text-[11px] text-gray-400">
            Trip {plan.tripNumber} · Empty
          </span>
        </div>
        {canManagePlan && onDeletePlan && (
          <button
            type="button"
            onClick={() => void onDeletePlan(plan.id)}
            className="text-[9px] text-gray-400 hover:text-red-500 transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    );
  }

  // "All Picked" + confirmed = show dispatch button inline (no expand)
  if (allPicked && plan.status === "confirmed" && plan.vehicleId) {
    return (
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-3 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-[14px]">🚚</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-gray-800">
                  Trip {plan.tripNumber}
                </span>
                <span className="text-[9px] text-gray-500">All Picked</span>
                <span className="text-[9px] text-gray-400">·</span>
                <span className="text-[9px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                  {primaryRoute}
                </span>
              </div>
              <span className="text-[9px] text-gray-400">
                {plan.vehicle ? `${plan.vehicle.vehicleNo} · ${plan.vehicle.category}` : "No vehicle"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-[12px] font-medium text-gray-700">
                {plan.totalWeightKg.toFixed(0)} kg
              </span>
              <span className="text-[9px] text-gray-400 ml-1">{totalCount} cust</span>
            </div>
            {(canPick || canManagePlan) && !isHistoryView && (
              <button
                type="button"
                onClick={handleDispatch}
                disabled={dispatchLoading}
                className="h-7 px-3 bg-green-600 hover:bg-green-700 text-white text-[10px] font-medium rounded flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                {dispatchLoading ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <Check size={10} />
                )}
                Dispatch
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Standard collapsible trip
  return (
    <div className="bg-white rounded-lg border border-gray-200">
      {/* Header */}
      <div
        className="px-3 py-2.5 flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[14px]">🚚</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-gray-800">
                Trip {plan.tripNumber}
              </span>
              <span className="text-[9px] text-gray-400">{plan.status === "draft" ? "Draft" : "Confirmed"}</span>
              <span className="text-[9px] text-gray-400">·</span>
              <span className="text-[9px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                {primaryRoute}
              </span>
            </div>
            <span className="text-[9px] text-gray-400">
              {plan.vehicle
                ? `${plan.vehicle.vehicleNo} · ${plan.vehicle.category}`
                : "No vehicle assigned"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[12px] font-medium text-gray-700">
              {plan.totalWeightKg.toFixed(0)} kg
            </span>
            {!expanded && !isDraft ? (
              <div className="flex items-center gap-1 justify-end">
                <span className="text-[9px] text-gray-400">
                  {pickedCount}/{totalCount}
                </span>
                {allPicked ? (
                  <Check size={10} className="text-gray-400" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                )}
              </div>
            ) : (
              <span className="text-[9px] text-gray-400 block text-right">
                {totalCount} cust
              </span>
            )}
          </div>
          <ChevronDown
            size={14}
            className={cn(
              "text-gray-400 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <>
          {/* Customer pills */}
          <div className="px-3 py-3 border-t border-gray-100 flex flex-wrap gap-2">
            {ordersInPlan.map((order) => (
              <CustomerPill
                key={order.id}
                order={order}
                onClick={() => onOrderClick(order)}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="px-3 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            <span className="text-[9px] text-gray-400">
              {pickedCount} of {totalCount} picked
            </span>
            <div className="flex items-center gap-2">
              {/* Vehicle selection + Confirm (editable statuses only) */}
              {canManagePlan && canEdit && !isHistoryView && (
                <>
                  <select
                    value={pendingVehicleId}
                    onChange={(e) => setPendingVehicleId(e.target.value)}
                    className="h-7 px-2 text-[9px] border border-gray-300 rounded bg-white text-gray-600 focus:outline-none"
                  >
                    <option value="">Select vehicle…</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.vehicleNo} · {v.category} ({v.capacityKg}kg)
                      </option>
                    ))}
                  </select>
                  {isDraft && (
                    <button
                      type="button"
                      onClick={handleConfirm}
                      disabled={confirmLoading || !pendingVehicleId}
                      className={cn(
                        "h-7 px-4 text-[10px] font-medium rounded flex items-center gap-1 transition-colors disabled:opacity-50",
                        pendingVehicleId
                          ? "bg-gray-800 hover:bg-gray-900 text-white"
                          : "bg-gray-300 text-gray-500 cursor-not-allowed",
                      )}
                    >
                      {confirmLoading && <Loader2 size={10} className="animate-spin" />}
                      Confirm
                    </button>
                  )}
                  {plan.status === "confirmed" && (
                    <button
                      type="button"
                      onClick={handleUpdateVehicle}
                      disabled={updateLoading || !pendingVehicleId || pendingVehicleId === String(plan.vehicleId)}
                      className={cn(
                        "h-7 px-4 text-[10px] font-medium rounded flex items-center gap-1 transition-colors disabled:opacity-50",
                        pendingVehicleId && pendingVehicleId !== String(plan.vehicleId)
                          ? "bg-gray-800 hover:bg-gray-900 text-white"
                          : "bg-gray-300 text-gray-500 cursor-not-allowed",
                      )}
                    >
                      {updateLoading && <Loader2 size={10} className="animate-spin" />}
                      Update
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
