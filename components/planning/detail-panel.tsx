"use client";

import { X, Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { BoardOrder } from "./planning-page";

interface DetailPanelProps {
  order: BoardOrder;
  onClose: () => void;
  onRemoveFromTrip: (planId: number, orderId: number) => Promise<void>;
  onMarkPicked: (orderId: number, picked: boolean) => Promise<void>;
  canPick: boolean;
  canManagePlan: boolean;
  isHistoryView?: boolean;
}

export function DetailPanel({
  order,
  onClose,
  onRemoveFromTrip,
  onMarkPicked,
  canPick,
  canManagePlan,
  isHistoryView = false,
}: DetailPanelProps) {
  const [removeLoading, setRemoveLoading] = useState(false);
  const [pickLoading, setPickLoading] = useState(false);

  const name = order.customer?.customerName ?? order.shipToCustomerName ?? "—";
  const area = order.customer?.area?.name ?? "";
  const route = order.customer?.area?.primaryRoute?.name ?? "";
  const rating = order.customer?.customerRating;
  const pri = order.priorityLevel;
  const weight = order.querySnapshot?.totalWeight ?? 0;
  const qty = order.querySnapshot?.totalUnitQty ?? 0;
  const hasTinting = order.querySnapshot?.hasTinting ?? false;
  const planOrder = order.dispatchPlanOrders[0];
  const isPicked =
    order.splits.length > 0
      ? order.splits.every((s) => s.isPicked)
      : order.isPicked;

  async function handleRemove() {
    if (!planOrder) return;
    setRemoveLoading(true);
    try {
      await onRemoveFromTrip(planOrder.planId, order.id);
    } finally {
      setRemoveLoading(false);
    }
  }

  async function handleTogglePick() {
    setPickLoading(true);
    try {
      await onMarkPicked(order.id, !isPicked);
    } finally {
      setPickLoading(false);
    }
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/10 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-[340px] bg-white shadow-xl border-l border-gray-200 z-50 flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <span className="text-[12px] font-medium text-gray-800">
            Customer Details
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Customer info */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              {pri <= 2 && (
                <span
                  className={cn(
                    "w-2 h-2 rounded-full",
                    pri === 1 ? "bg-red-400" : "bg-amber-400",
                  )}
                />
              )}
              {rating === "A" && (
                <span className="text-[10px] text-amber-500">★ Key Customer</span>
              )}
            </div>
            <h2 className="text-[14px] font-semibold text-gray-800">{name}</h2>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {[area, route].filter(Boolean).join(", ") || "—"}
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-50 rounded p-2.5 text-center">
              <div className="text-[15px] font-semibold text-gray-700">
                {weight.toFixed(0)}
              </div>
              <div className="text-[9px] text-gray-400">kg</div>
            </div>
            <div className="bg-gray-50 rounded p-2.5 text-center">
              <div className="text-[15px] font-semibold text-gray-700">1</div>
              <div className="text-[9px] text-gray-400">OBDs</div>
            </div>
            <div className="bg-gray-50 rounded p-2.5 text-center">
              <div className="text-[15px] font-semibold text-gray-700">{qty}</div>
              <div className="text-[9px] text-gray-400">Units</div>
            </div>
          </div>

          {/* Tinting alert */}
          {hasTinting && (
            <div className="bg-purple-50 border border-purple-100 rounded-lg p-3">
              <div className="flex items-center gap-2 text-[10px] text-purple-700">
                <span>🎨</span>
                <span className="font-medium">Tinting Required</span>
              </div>
              <div className="text-[9px] text-purple-600 mt-1">
                Has tinting items in this order
              </div>
            </div>
          )}

          {/* OBD detail */}
          <div>
            <div className="text-[9px] font-medium text-gray-500 uppercase tracking-wide mb-2">
              OBD
            </div>
            <div className="space-y-2">
              <div
                className={cn(
                  "rounded border p-3",
                  isPicked ? "border-gray-100 bg-gray-50" : "border-gray-200 bg-white",
                )}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-[10px] text-gray-600">
                    {order.obdNumber}
                  </span>
                  {isPicked ? (
                    <span className="text-[8px] text-gray-400">✓ Picked</span>
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                  )}
                </div>
                <div className="flex gap-3 text-[9px] text-gray-500">
                  <span>{weight.toFixed(0)} kg</span>
                  <span>{qty} units</span>
                  {order.querySnapshot?.articleTag && (
                    <span>{order.querySnapshot.articleTag}</span>
                  )}
                </div>
                {canPick && !isPicked && (
                  <button
                    type="button"
                    onClick={handleTogglePick}
                    disabled={pickLoading}
                    className="mt-2 text-[9px] text-gray-600 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded flex items-center gap-1 transition-colors disabled:opacity-50"
                  >
                    {pickLoading ? <Loader2 size={9} className="animate-spin" /> : <Check size={9} />}
                    Mark Picked
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        {planOrder && (
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex-shrink-0">
            <div className="text-[9px] text-gray-400 mb-2">
              In: Trip {planOrder.plan.tripNumber} · {planOrder.plan.status}
              {planOrder.plan.vehicle ? ` · ${planOrder.plan.vehicle.vehicleNo}` : ""}
            </div>
            {canManagePlan && !isHistoryView && ["draft", "confirmed"].includes(planOrder.plan.status) && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={removeLoading}
                className="w-full h-7 text-red-500 text-[10px] border border-gray-200 rounded hover:bg-red-50 hover:border-red-200 flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
              >
                {removeLoading && <Loader2 size={10} className="animate-spin" />}
                Remove from Trip
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
