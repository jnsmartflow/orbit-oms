"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { UnassignedPanel } from "./unassigned-panel";
import { PickersPanel } from "./pickers-panel";
import { UniversalHeader } from "@/components/universal-header";

// ── Shared Types ─────────────────────────────────────────────────────────────

export interface OrderItem {
  id: number;
  obdNumber: string;
  weightKg: number;
  units: number;
  isPicked: boolean;
  pickedAt: string | null;
  hasTinting: boolean;
  tintingStatus: string | null;
  pickAssignment: { id: number; sequence: number; pickerId: number } | null;
  isCarriedOver: boolean;
  daysOverdue: number;
  originalSlotId: number | null;
  originalSlotName: string | null;
}

export interface CustomerGroup {
  customerId: string;
  customerName: string;
  area: string;
  route: string;
  priority: string;
  customerRating: string;
  deliveryType: string;
  slotId: number;
  slotName: string;
  slotSortOrder: number;
  slotTime: string;
  slotIsNextDay: boolean;
  totalKg: number;
  totalUnits: number;
  hasTinting: boolean;
  tintingPendingCount: number;
  tintingCompleteCount: number;
  tripInfo: { tripNumber: number; vehicleNo: string; vehicleType: string } | null;
  orders: OrderItem[];
}

export interface PickerInfo {
  id: number;
  name: string;
  avatarInitial: string;
  status: "picking" | "available";
  assignedCount: number;
  pickedCount: number;
  pendingCount: number;
  totalKg: number;
}

export interface PickerLane {
  picker: { id: number; name: string; avatarInitial: string };
  assignments: CustomerGroup[];
  stats: { total: number; picked: number; pending: number; totalKg: number };
}

interface BoardResponse {
  unassigned: CustomerGroup[];
  assigned: PickerLane[];
  stats: { unassigned: number; picking: number; picked: number; totalOBDs: number };
}

interface PickersResponse {
  pickers: PickerInfo[];
}

// ── Component ────────────────────────────────────────────────────────────────

export function WarehousePage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? "";
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
  );
  const [deliveryType, setDeliveryType] = useState("Local");
  const [headerFilters, setHeaderFilters] = useState<Record<string, string[]>>({ deliveryType: [], pickStatus: [] });
  const [activeSlotId, setActiveSlotId] = useState<number | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<number>>(new Set());

  const [boardData, setBoardData] = useState<BoardResponse | null>(null);
  const [pickers, setPickers] = useState<PickerInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchBoard = useCallback(
    async (d: string, dt: string) => {
      try {
        const qs = new URLSearchParams({ date: d, deliveryType: dt });
        const res = await fetch(`/api/warehouse/board?${qs.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch board");
        const data = (await res.json()) as BoardResponse;
        setBoardData(data);
      } catch {
        toast.error("Failed to load warehouse board");
      }
    },
    [],
  );

  const fetchPickers = useCallback(async () => {
    try {
      const res = await fetch("/api/warehouse/pickers");
      if (!res.ok) throw new Error("Failed to fetch pickers");
      const data = (await res.json()) as PickersResponse;
      setPickers(data.pickers);
    } catch {
      toast.error("Failed to load pickers");
    }
  }, []);

  const refresh = useCallback(async () => {
    setSelectedOrderIds(new Set());
    await Promise.all([fetchBoard(date, deliveryType), fetchPickers()]);
  }, [fetchBoard, fetchPickers, date, deliveryType]);

  // Initial load
  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchBoard(date, deliveryType), fetchPickers()]);
      setLoading(false);
    })();
  }, [date, deliveryType, fetchBoard, fetchPickers]);

  // Auto-refresh every 30s
  useEffect(() => {
    refreshTimerRef.current = setInterval(() => {
      void fetchBoard(date, deliveryType);
      void fetchPickers();
    }, 30000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [date, deliveryType, fetchBoard, fetchPickers]);

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

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleAssign = useCallback(
    async (orderIds: number[], pickerId: number) => {
      try {
        const res = await fetch("/api/warehouse/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderIds, pickerId }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? "Failed to assign");
        }
        toast.success(`${orderIds.length} order${orderIds.length !== 1 ? "s" : ""} assigned`);
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to assign");
      }
    },
    [refresh],
  );

  const handleMarkPicked = useCallback(
    async (orderId: number) => {
      // Find current picked state
      let currentlyPicked = false;
      if (boardData) {
        const allGroups = [...boardData.unassigned, ...boardData.assigned.flatMap((a) => a.assignments)];
        for (const g of allGroups) {
          const order = g.orders.find((o) => o.id === orderId);
          if (order) {
            currentlyPicked = order.isPicked;
            break;
          }
        }
      }
      const newPicked = !currentlyPicked;

      // Optimistic update
      setBoardData((prev) => {
        if (!prev) return prev;
        const update = (groups: CustomerGroup[]) =>
          groups.map((g) => ({
            ...g,
            orders: g.orders.map((o) =>
              o.id === orderId ? { ...o, isPicked: newPicked } : o,
            ),
          }));
        return {
          ...prev,
          unassigned: update(prev.unassigned),
          assigned: prev.assigned.map((lane) => ({
            ...lane,
            assignments: update(lane.assignments),
            stats: {
              ...lane.stats,
              picked: lane.stats.picked + (newPicked ? 1 : -1),
              pending: lane.stats.pending + (newPicked ? -1 : 1),
            },
          })),
        };
      });

      try {
        const res = await fetch(`/api/planning/orders/${orderId}/mark-picked`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ picked: newPicked }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? "Failed to update pick status");
        }
        toast.success(newPicked ? "Marked as picked" : "Unmarked");
        // Full refresh to sync all derived data
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to update pick status");
        // Revert optimistic update
        await refresh();
      }
    },
    [refresh, boardData],
  );

  // ── Derived data ───────────────────────────────────────────────────────────
  const dtCounts = useMemo(() => {
    if (!boardData) return { Local: 0, Upcountry: 0, IGT: 0, Cross: 0 };
    const counts: Record<string, number> = { Local: 0, Upcountry: 0, IGT: 0, Cross: 0 };
    const allGroups = [...boardData.unassigned, ...boardData.assigned.flatMap((a) => a.assignments)];
    for (const g of allGroups) {
      const lower = g.deliveryType.toLowerCase();
      if (lower.includes("local")) counts.Local += g.orders.length;
      else if (lower.includes("upcountry")) counts.Upcountry += g.orders.length;
      else if (lower.includes("igt")) counts.IGT += g.orders.length;
      else if (lower.includes("cross")) counts.Cross += g.orders.length;
      else counts.Local += g.orders.length;
    }
    return counts;
  }, [boardData]);

  const slotTabs = useMemo(() => {
    if (!boardData) return [];
    const allGroups = [...boardData.unassigned, ...boardData.assigned.flatMap((a) => a.assignments)];
    const slotMap = new Map<number, { id: number; name: string; sortOrder: number; slotTime: string; isNextDay: boolean; picked: number; total: number }>();
    for (const g of allGroups) {
      if (!slotMap.has(g.slotId)) {
        slotMap.set(g.slotId, { id: g.slotId, name: g.slotName, sortOrder: g.slotSortOrder, slotTime: g.slotTime, isNextDay: g.slotIsNextDay, picked: 0, total: 0 });
      }
      const s = slotMap.get(g.slotId)!;
      for (const o of g.orders) {
        s.total++;
        if (o.isPicked) s.picked++;
      }
    }
    return Array.from(slotMap.values())
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({
        id: s.id,
        name: s.name,
        sortOrder: s.sortOrder,
        slotTime: s.slotTime,
        isNextDay: s.isNextDay,
        isUrgent: false,
        pickedCount: s.picked,
        totalCount: s.total,
      }));
  }, [boardData]);

  // Auto-select first non-closed slot if none active
  useEffect(() => {
    if (activeSlotId === null && slotTabs.length > 0) {
      const now = new Date(
        new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
      );
      const firstOpen = slotTabs.find((s) => {
        if (s.isNextDay) return true;
        const [h, m] = s.slotTime.split(":").map(Number);
        const deadline = new Date(now);
        deadline.setHours(h, m + 15, 0, 0);
        return now <= deadline;
      });
      setActiveSlotId((firstOpen ?? slotTabs[0]).id);
    }
  }, [slotTabs, activeSlotId]);

  // Client-side slot filter for unassigned panel
  const filteredUnassigned = useMemo(() => {
    if (!boardData) return [];
    if (activeSlotId === null) return boardData.unassigned;
    return boardData.unassigned.filter((g) => g.slotId === activeSlotId);
  }, [boardData, activeSlotId]);

  const stats = boardData?.stats ?? { unassigned: 0, picking: 0, picked: 0, totalOBDs: 0 };

  // ── Selection helpers ──────────────────────────────────────────────────────
  function toggleCustomerSelection(orderIds: number[]) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      const allSelected = orderIds.every((id) => prev.has(id));
      if (allSelected) {
        orderIds.forEach((id) => next.delete(id));
      } else {
        orderIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

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
        title="Warehouse"
        stats={[
          { label: "unassigned", value: stats.unassigned },
          { label: "picking", value: stats.picking },
          { label: "picked", value: stats.picked },
          { label: "OBDs", value: stats.totalOBDs },
        ]}
        segments={slotTabs.filter((s) => !s.isNextDay).map((s) => ({ id: s.id, label: s.name, count: s.totalCount }))}
        activeSegment={activeSlotId}
        onSegmentChange={(id) => setActiveSlotId(id as number | null)}
        filterGroups={[
          { label: "Delivery Type", key: "deliveryType", options: [{ value: "LOCAL", label: "Local" }, { value: "UPC", label: "Upcountry" }, { value: "IGT", label: "IGT" }, { value: "CROSS", label: "Cross Depot" }] },
          { label: "Pick Status", key: "pickStatus", options: [{ value: "unassigned", label: "Unassigned" }, { value: "assigned", label: "Assigned" }, { value: "picked", label: "Picked" }] },
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

      <div className="flex h-[calc(100vh-155px)]">
        <UnassignedPanel
          groups={filteredUnassigned}
          pickers={pickers}
          selectedOrderIds={selectedOrderIds}
          onToggleCustomer={toggleCustomerSelection}
          onAssign={handleAssign}
          isHistoryView={isHistoryView}
        />

        <PickersPanel
          lanes={boardData?.assigned ?? []}
          availablePickers={pickers.filter(
            (p) => p.status === "available" && !boardData?.assigned.some((a) => a.picker.id === p.id),
          )}
          onMarkPicked={handleMarkPicked}
          isHistoryView={isHistoryView}
        />
      </div>
    </div>
  );
}
