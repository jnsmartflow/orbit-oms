"use client";

import { TripCard } from "./trip-card";
import type { BoardOrder, BoardPlan } from "./planning-page";

interface VehicleOption {
  id: number;
  vehicleNo: string;
  category: string;
  capacityKg: number;
}

interface TripsPanelProps {
  plans: BoardPlan[];
  orders: BoardOrder[];
  vehicles: VehicleOption[];
  onOrderClick: (order: BoardOrder) => void;
  onConfirm: (planId: number, vehicleId: number | null) => Promise<void>;
  onUpdateVehicle: (planId: number, vehicleId: number) => Promise<void>;
  onDispatch: (planId: number) => Promise<void>;
  canManagePlan: boolean;
  canPick: boolean;
  isHistoryView?: boolean;
}

export function TripsPanel({
  plans,
  orders,
  vehicles,
  onOrderClick,
  onConfirm,
  onUpdateVehicle,
  onDispatch,
  canManagePlan,
  canPick,
  isHistoryView = false,
}: TripsPanelProps) {
  // Build a map of planId -> orders
  const ordersByPlan = new Map<number, BoardOrder[]>();
  for (const order of orders) {
    if (order.dispatchPlanOrders.length > 0) {
      const planId = order.dispatchPlanOrders[0].planId;
      if (!ordersByPlan.has(planId)) ordersByPlan.set(planId, []);
      ordersByPlan.get(planId)!.push(order);
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-4 py-2.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-700">
          Trips <span className="text-gray-400 font-normal">{plans.length}</span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {plans.length === 0 ? (
          <p className="text-[11px] text-gray-400 text-center py-12">
            No trips yet. Select customers and create a trip.
          </p>
        ) : (
          plans.map((plan) => (
            <TripCard
              key={plan.id}
              plan={plan}
              ordersInPlan={ordersByPlan.get(plan.id) ?? []}
              vehicles={vehicles}
              onOrderClick={onOrderClick}
              onConfirm={onConfirm}
              onUpdateVehicle={onUpdateVehicle}
              onDispatch={onDispatch}
              canManagePlan={canManagePlan}
              canPick={canPick}
              isHistoryView={isHistoryView}
            />
          ))
        )}
      </div>
    </div>
  );
}
