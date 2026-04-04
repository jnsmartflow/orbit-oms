"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { UnassignedPanel } from "./unassigned-panel";
import { TripsPanel } from "./trips-panel";
import { DetailPanel } from "./detail-panel";
import { UniversalHeader } from "@/components/universal-header";

// ── Shared Types ─────────────────────────────────────────────────────────────

export interface BoardOrder {
  id: number;
  obdNumber: string;
  obdEmailDate: string | null;
  workflowStage: string;
  isPicked: boolean;
  shipToCustomerName: string | null;
  priorityLevel: number;
  slotId: number | null;
  customer: {
    id: number;
    customerName: string;
    customerRating: string | null;
    dispatchDeliveryType: { id: number; name: string } | null;
    area: {
      id: number;
      name: string;
      primaryRoute: { id: number; name: string } | null;
      deliveryType: { id: number; name: string } | null;
    } | null;
  } | null;
  slot: { id: number; name: string; sortOrder: number; slotTime: string; isNextDay: boolean } | null;
  originalSlotId: number | null;
  originalSlot: { name: string } | null;
  querySnapshot: {
    totalUnitQty: number;
    totalWeight: number;
    totalVolume: number;
    hasTinting: boolean;
    articleTag: string | null;
  } | null;
  splits: {
    id: number;
    status: string;
    dispatchStatus: string | null;
    isPicked: boolean;
    pickedAt: string | null;
    totalQty: number;
  }[];
  dispatchPlanOrders: {
    id: number;
    planId: number;
    sequenceOrder: number;
    plan: {
      id: number;
      status: string;
      vehicleId: number | null;
      vehicle: { vehicleNo: string; category: string } | null;
      tripNumber: number;
      slotId: number;
    };
  }[];
  isCarriedOver: boolean;
  daysOverdue: number;
}

export interface BoardPlan {
  id: number;
  status: string;
  tripNumber: number;
  totalOrders: number;
  totalWeightKg: number;
  totalVolume: number;
  slotId: number;
  vehicleId: number | null;
  slot: { id: number; name: string; sortOrder: number };
  vehicle: {
    id: number;
    vehicleNo: string;
    category: string;
    capacityKg: number;
  } | null;
  createdBy: { id: number; name: string };
  orders: {
    id: number;
    orderId: number;
    sequenceOrder: number;
    order: {
      id: number;
      obdNumber: string;
      shipToCustomerName: string | null;
      querySnapshot: {
        totalWeight: number;
        totalVolume: number;
        totalUnitQty: number;
      } | null;
    };
  }[];
}

interface VehicleOption {
  id: number;
  vehicleNo: string;
  category: string;
  capacityKg: number;
}

// ── Component ────────────────────────────────────────────────────────────────

export function PlanningPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? "";
  const canManagePlan = ["dispatcher", "admin"].includes(role);
  const canPick = ["floor_supervisor", "admin"].includes(role);

  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
  );
  const [deliveryType, setDeliveryType] = useState("Local");
  const [headerFilters, setHeaderFilters] = useState<Record<string, string[]>>({ deliveryType: [], dispatchStatus: [] });
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<number>>(new Set());
  const [detailOrder, setDetailOrder] = useState<BoardOrder | null>(null);

  const [orders, setOrders] = useState<BoardOrder[]>([]);
  const [plans, setPlans] = useState<BoardPlan[]>([]);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchBoard = useCallback(async (d: string) => {
    try {
      const res = await fetch(`/api/planning/board?date=${d}`);
      if (!res.ok) throw new Error("Failed to fetch board");
      const data = (await res.json()) as {
        orders: BoardOrder[];
        plans: BoardPlan[];
      };
      setOrders(data.orders);
      setPlans(data.plans);
    } catch {
      toast.error("Failed to load planning board");
    }
  }, []);

  const fetchVehicles = useCallback(async () => {
    try {
      const res = await fetch("/api/planning/vehicles");
      if (!res.ok) throw new Error("Failed to fetch vehicles");
      const data = (await res.json()) as { vehicles: VehicleOption[] };
      setVehicles(data.vehicles);
    } catch {
      toast.error("Failed to load vehicles");
    }
  }, []);

  const refresh = useCallback(async () => {
    setSelectedOrders(new Set());
    await fetchBoard(date);
  }, [fetchBoard, date]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchBoard(date), fetchVehicles()]);
      setLoading(false);
    })();
  }, [date, fetchBoard, fetchVehicles]);

  // Sync headerFilters → deliveryType
  useEffect(() => {
    const dt = headerFilters.deliveryType ?? [];
    if (dt.length === 1) {
      const map: Record<string, string> = { LOCAL: "Local", UPC: "Upcountry", IGT: "IGT", CROSS: "Cross" };
      setDeliveryType(map[dt[0]] ?? "Local");
    } else {
      setDeliveryType("Local");
    }
  }, [headerFilters]);

  // Header date conversion
  const headerDate = useMemo(() => new Date(date + "T00:00:00+05:30"), [date]);
  const handleHeaderDateChange = useCallback((d: Date) => {
    setDate(d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  }, []);

  // ── Filtered data ──────────────────────────────────────────────────────────
  const filteredOrders = useMemo(() => {
    let list = orders;

    // Filter by delivery type
    list = list.filter((o) => {
      const dt =
        o.customer?.dispatchDeliveryType?.name ??
        o.customer?.area?.deliveryType?.name ??
        "Local";
      return dt.toLowerCase().includes(deliveryType.toLowerCase());
    });

    // Filter by slot if selected
    if (selectedSlot !== null) {
      list = list.filter((o) => o.slotId === selectedSlot);
    }

    return list;
  }, [orders, deliveryType, selectedSlot]);

  const unassignedOrders = useMemo(
    () =>
      filteredOrders
        .filter((o) => o.dispatchPlanOrders.length === 0)
        .sort((a, b) => {
          // Carried-over first (highest daysOverdue first)
          if (a.daysOverdue !== b.daysOverdue) return b.daysOverdue - a.daysOverdue;
          // Then priority
          if (a.priorityLevel !== b.priorityLevel) return a.priorityLevel - b.priorityLevel;
          // Then key customer
          const aKey = a.customer?.customerRating === "A" ? 0 : 1;
          const bKey = b.customer?.customerRating === "A" ? 0 : 1;
          return aKey - bKey;
        }),
    [filteredOrders],
  );

  // Delivery type counts
  const dtCounts = useMemo(() => {
    const counts: Record<string, number> = { Local: 0, Upcountry: 0, IGT: 0, Cross: 0 };
    for (const o of orders) {
      const dt =
        o.customer?.dispatchDeliveryType?.name ??
        o.customer?.area?.deliveryType?.name ??
        "Local";
      const lower = dt.toLowerCase();
      if (lower.includes("local")) counts.Local++;
      else if (lower.includes("upcountry")) counts.Upcountry++;
      else if (lower.includes("igt")) counts.IGT++;
      else if (lower.includes("cross")) counts.Cross++;
      else counts.Local++;
    }
    return counts;
  }, [orders]);

  // Slot bar data
  const slotData = useMemo(() => {
    const slotMap = new Map<
      number,
      { id: number; name: string; sortOrder: number; slotTime: string; isNextDay: boolean; total: number; picked: number }
    >();
    for (const o of filteredOrders) {
      if (!o.slot) continue;
      if (!slotMap.has(o.slot.id)) {
        slotMap.set(o.slot.id, {
          id: o.slot.id,
          name: o.slot.name,
          sortOrder: o.slot.sortOrder,
          slotTime: o.slot.slotTime,
          isNextDay: o.slot.isNextDay,
          total: 0,
          picked: 0,
        });
      }
      const s = slotMap.get(o.slot.id)!;
      s.total++;
      const isPicked =
        o.splits.length > 0 ? o.splits.every((sp) => sp.isPicked) : o.isPicked;
      if (isPicked) s.picked++;
    }

    return Array.from(slotMap.values())
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({
        id: s.id,
        name: s.name,
        sortOrder: s.sortOrder,
        slotTime: s.slotTime,
        isNextDay: s.isNextDay,
        countdown: "",
        isUrgent: false,
        isDone: s.total > 0 && s.picked === s.total,
        pickedCount: s.picked,
        totalCount: s.total,
      }));
  }, [filteredOrders]);

  // Stats
  const stats = useMemo(() => {
    const customerIds = new Set(orders.map((o) => o.customer?.id).filter(Boolean));
    return { customers: customerIds.size, obds: orders.length, trips: plans.length };
  }, [orders, plans]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleCreateTrip = useCallback(
    async (orderIds: number[]) => {
      // Find the slot from the first order
      const firstOrder = orders.find((o) => orderIds.includes(o.id));
      const slotId = firstOrder?.slotId;
      if (!slotId) {
        toast.error("Orders must have a slot assigned");
        return;
      }

      try {
        const res = await fetch("/api/planning/plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slotId, orderIds }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? "Failed to create trip");
        }
        toast.success("Trip created");
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to create trip");
      }
    },
    [orders, refresh],
  );

  const handleAddToTrip = useCallback(
    async (planId: number, orderIds: number[]) => {
      try {
        const res = await fetch(`/api/planning/plans/${planId}/add-orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderIds }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? "Failed to add to trip");
        }
        toast.success("Orders added to trip");
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to add to trip");
      }
    },
    [refresh],
  );

  const handleAutoDraft = useCallback(async () => {
    // Group unassigned by route, create trips with max 1500kg
    const routeGroups = new Map<string, BoardOrder[]>();
    for (const o of unassignedOrders) {
      const route = o.customer?.area?.primaryRoute?.name ?? "No Route";
      if (!routeGroups.has(route)) routeGroups.set(route, []);
      routeGroups.get(route)!.push(o);
    }

    let created = 0;
    for (const [, routeOrders] of Array.from(routeGroups.entries())) {
      let batch: number[] = [];
      let batchWeight = 0;

      for (const o of routeOrders) {
        const w = o.querySnapshot?.totalWeight ?? 0;
        if (batchWeight + w > 1500 && batch.length > 0) {
          const slotId = routeOrders[0]?.slotId;
          if (slotId) {
            try {
              await fetch("/api/planning/plans", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ slotId, orderIds: batch }),
              });
              created++;
            } catch { /* skip */ }
          }
          batch = [];
          batchWeight = 0;
        }
        batch.push(o.id);
        batchWeight += w;
      }

      if (batch.length > 0) {
        const slotId = routeOrders[0]?.slotId;
        if (slotId) {
          try {
            await fetch("/api/planning/plans", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slotId, orderIds: batch }),
            });
            created++;
          } catch { /* skip */ }
        }
      }
    }

    if (created > 0) {
      toast.success(`${created} trip${created !== 1 ? "s" : ""} created`);
      await refresh();
    } else {
      toast.info("No trips to create");
    }
  }, [unassignedOrders, refresh]);

  const handleUpdateVehicle = useCallback(
    async (planId: number, vehicleId: number) => {
      try {
        const res = await fetch(`/api/planning/plans/${planId}/assign-vehicle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vehicleId }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? "Failed to update vehicle");
        }
        toast.success("Vehicle updated");
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to update vehicle");
      }
    },
    [refresh],
  );

  const handleConfirm = useCallback(
    async (planId: number, vehicleId: number | null) => {
      try {
        if (vehicleId) {
          const res = await fetch(`/api/planning/plans/${planId}/assign-vehicle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vehicleId }),
          });
          if (!res.ok) {
            const err = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(err.error ?? "Failed to assign vehicle");
          }
        }
        toast.success("Trip confirmed");
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to confirm trip");
      }
    },
    [refresh],
  );

  const handleDispatch = useCallback(
    async (planId: number) => {
      try {
        const res = await fetch(`/api/planning/plans/${planId}/loading-complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? "Failed to dispatch");
        }
        toast.success("Loading complete — orders dispatched");
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to dispatch");
      }
    },
    [refresh],
  );

  const handleRemoveFromTrip = useCallback(
    async (planId: number, orderId: number) => {
      try {
        const res = await fetch(`/api/planning/plans/${planId}/remove-order`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? "Failed to remove");
        }
        toast.success("Order removed from trip");
        setDetailOrder(null);
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to remove");
      }
    },
    [refresh],
  );

  const handleMarkPicked = useCallback(
    async (orderId: number, picked: boolean) => {
      try {
        const res = await fetch(`/api/planning/orders/${orderId}/mark-picked`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ picked }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? "Failed to update pick status");
        }
        toast.success(picked ? "Marked as picked" : "Unmarked");
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to update pick status");
      }
    },
    [refresh],
  );

  // ── History view ───────────────────────────────────────────────────────────
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const isHistoryView = date < today;
  const formattedDate = new Date(date + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#f8f9fa]">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-[13px] text-gray-600">
      <UniversalHeader
        title="Planning Board"
        stats={[
          { label: "customers", value: stats.customers },
          { label: "OBDs", value: stats.obds },
          { label: "trips", value: stats.trips },
        ]}
        segments={slotData.filter((s) => !s.isNextDay).map((s) => ({ id: s.id, label: s.name, count: s.totalCount }))}
        activeSegment={selectedSlot}
        onSegmentChange={(id) => setSelectedSlot(id as number | null)}
        filterGroups={[
          { label: "Delivery Type", key: "deliveryType", options: [{ value: "LOCAL", label: "Local" }, { value: "UPC", label: "Upcountry" }, { value: "IGT", label: "IGT" }, { value: "CROSS", label: "Cross Depot" }] },
          { label: "Dispatch Status", key: "dispatchStatus", options: [{ value: "dispatch", label: "Dispatch" }, { value: "hold", label: "Hold" }] },
        ]}
        activeFilters={headerFilters}
        onFilterChange={setHeaderFilters}
        currentDate={headerDate}
        onDateChange={handleHeaderDateChange}
        searchPlaceholder="Search OBD, customer..."
        shortcuts={[
          { key: "\u2191\u2193", label: "Navigate" },
          { key: "\u21B5", label: "Order details" },
        ]}
      />

      {isHistoryView && (
        <div className="bg-gray-100 border-b border-gray-200 px-5 py-2 text-[11px] text-gray-500">
          Viewing {formattedDate} — Read Only
        </div>
      )}

      <div className="flex h-[calc(100vh-140px)]">
        <UnassignedPanel
          orders={unassignedOrders}
          plans={plans}
          selectedOrders={selectedOrders}
          onSelectionChange={setSelectedOrders}
          onOrderClick={setDetailOrder}
          onCreateTrip={handleCreateTrip}
          onAddToTrip={handleAddToTrip}
          onAutoDraft={handleAutoDraft}
          canManagePlan={canManagePlan}
          isHistoryView={isHistoryView}
        />

        <TripsPanel
          plans={plans}
          orders={filteredOrders}
          vehicles={vehicles}
          onOrderClick={setDetailOrder}
          onConfirm={handleConfirm}
          onUpdateVehicle={handleUpdateVehicle}
          onDispatch={handleDispatch}
          canManagePlan={canManagePlan}
          canPick={canPick}
          isHistoryView={isHistoryView}
        />
      </div>

      {detailOrder && (
        <DetailPanel
          order={detailOrder}
          onClose={() => setDetailOrder(null)}
          onRemoveFromTrip={handleRemoveFromTrip}
          onMarkPicked={handleMarkPicked}
          canPick={canPick}
          canManagePlan={canManagePlan}
          isHistoryView={isHistoryView}
        />
      )}
    </div>
  );
}
