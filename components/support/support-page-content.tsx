"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SupportOrdersTable } from "@/components/support/support-orders-table";
import { SupportHoldTable } from "@/components/support/support-hold-table";
import type { SupportOrder } from "@/components/support/support-orders-table";
import { UniversalHeader } from "@/components/universal-header";
import { useSession } from "next-auth/react";
import type { DispatchWindow } from "@/components/support/dispatch-slot-picker";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SlotNavItem {
  id: number;
  name: string;
  sortOrder: number;
  cutoffTime: string | null;
  deliveryTypeId: number | null;
  slotTime: string;
  isNextDay: boolean;
  pendingCount: number;
  dispatchedCount: number;
  tintingCount: number;
}

interface SlotsResponse {
  slots: SlotNavItem[];
  holdCount: number;
  doneCount: number;
  earlierPendingCount: number;
  date: string;
}

type MainTab = "all" | "hold";
type StatusFilter = "all" | "pending" | "dispatch" | "dispatched";

// ── Helpers ──────────────────────────────────────────────────────────────────

// ── Slot-closed helper ──────────────────────────────────────────────────────

function isSlotClosed(slot: SlotNavItem, historyView: boolean): boolean {
  if (historyView) return false;
  if (slot.isNextDay) return false;
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const [h, m] = slot.slotTime.split(":").map(Number);
  const slotMinutes = h * 60 + m + 15; // 15-min grace
  const nowMinutes = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();
  return nowMinutes > slotMinutes;
}

function pickDefaultSlot(slots: SlotNavItem[], historyView: boolean): SlotNavItem {
  const firstOpen = slots.find((s) => !isSlotClosed(s, historyView));
  return firstOpen ?? slots[slots.length - 1];
}

// ── Component ────────────────────────────────────────────────────────────────

export function SupportPageContent() {
  const { data: session } = useSession();
  const canImportOBDs = ["admin", "dispatcher", "support", "billing_operator", "tint_manager"]
    .includes(session?.user?.role ?? "");

  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  const [slots, setSlots] = useState<SlotNavItem[]>([]);
  const [holdCount, setHoldCount] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [earlierPendingCount, setEarlierPendingCount] = useState(0);
  const [orders, setOrders] = useState<SupportOrder[]>([]);
  const [activeSection, setActiveSection] = useState("");
  const [activeSlotId, setActiveSlotId] = useState<number | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [allTabOrderCount, setAllTabOrderCount] = useState(0);
  const [dispatchWindows, setDispatchWindows] = useState<DispatchWindow[]>([]);
  const [headerFilters, setHeaderFilters] = useState<Record<string, string[]>>({ view: [], status: [], deliveryType: [], priority: [] });
  const [searchQuery, setSearchQuery] = useState("");

  // Sync header filters → existing state
  useEffect(() => {
    const v = headerFilters.view ?? [];
    if (v.includes("hold")) { if (mainTab !== "hold") handleMainTabChange("hold"); }
    else { if (mainTab !== "all") handleMainTabChange("all"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerFilters.view]);

  useEffect(() => {
    const s = headerFilters.status ?? [];
    setStatusFilter(s.length === 1 ? (s[0] as StatusFilter) : "all");
  }, [headerFilters.status]);

  // Re-fetch slots + orders when date changes; reset hold tab when switching to history
  useEffect(() => {
    if (!activeSection) return;
    const nowIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const histView = date < nowIST;
    (async () => {
      const data = await fetchSlots();
      if (histView && mainTab === "hold") {
        setMainTab("all");
        setStatusFilter("pending");
      }
      if (data?.slots.length) {
        const defaultSlot = pickDefaultSlot(data.slots, histView);
        const sec = `slot-${defaultSlot.id}`;
        setActiveSection(sec);
        setActiveSlotId(defaultSlot.id);
        await fetchOrders(sec, defaultSlot.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Fetch dispatch windows once — they don't change by date
  useEffect(() => {
    fetch("/api/support/dispatch-windows")
      .then((r) => r.json())
      .then((d) => {
        const data = d as { windows: DispatchWindow[] };
        setDispatchWindows(data.windows);
      })
      .catch(() => {});
  }, []);

  // Track all-tab order count so it persists when switching to hold tab
  useEffect(() => {
    if (mainTab === "all") {
      setAllTabOrderCount(orders.length);
    }
  }, [orders.length, mainTab]);

  // ── Fetch slots ──────────────────────────────────────────────────────────
  const fetchSlots = useCallback(async () => {
    try {
      const res = await fetch(`/api/support/slots?date=${date}`);
      if (!res.ok) throw new Error("Failed to fetch slots");
      const data = (await res.json()) as SlotsResponse;
      setSlots(data.slots);
      setHoldCount(data.holdCount);
      setDoneCount(data.doneCount);
      setEarlierPendingCount(data.earlierPendingCount ?? 0);
      return data;
    } catch {
      toast.error("Failed to load slots");
      return null;
    }
  }, [date]);

  // ── Fetch orders ─────────────────────────────────────────────────────────
  const fetchOrders = useCallback(
    async (section: string, slotId?: number) => {
      setOrders([]);
      setOrdersLoading(true);
      try {
        const qs = new URLSearchParams({ date });
        if (section === "hold") {
          qs.set("section", "hold");
        } else if (section === "earlier") {
          qs.set("section", "earlier");
        } else if (section.startsWith("slot-")) {
          qs.set("section", "slot");
          if (slotId) qs.set("slotId", String(slotId));
        } else {
          setOrders([]);
          setOrdersLoading(false);
          return;
        }
        const res = await fetch(`/api/support/orders?${qs.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch orders");
        const data = (await res.json()) as { orders: SupportOrder[] };
        setOrders(data.orders);
      } catch {
        toast.error("Failed to load orders");
        setOrders([]);
      } finally {
        setOrdersLoading(false);
      }
    },
    [date],
  );

  // ── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setSlotsLoading(true);
      const data = await fetchSlots();
      setSlotsLoading(false);
      if (data?.slots.length) {
        const nowIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        const histView = date < nowIST;
        const defaultSlot = pickDefaultSlot(data.slots, histView);
        const sec = `slot-${defaultSlot.id}`;
        setActiveSection(sec);
        setActiveSlotId(defaultSlot.id);
        await fetchOrders(sec, defaultSlot.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Section change ───────────────────────────────────────────────────────
  function handleSelectSection(section: string, slotId?: number) {
    setActiveSection(section);
    setActiveSlotId(slotId ?? null);
    setStatusFilter("all");
    void fetchOrders(section, slotId);
  }

  // ── Main tab change ──────────────────────────────────────────────────────
  function handleMainTabChange(tab: MainTab) {
    setMainTab(tab);
    setStatusFilter("all");
    if (tab === "all") {
      if (activeSlotId && slots.find((s) => s.id === activeSlotId)) {
        void fetchOrders(`slot-${activeSlotId}`, activeSlotId);
      } else if (slots.length > 0) {
        const first = slots[0];
        setActiveSection(`slot-${first.id}`);
        setActiveSlotId(first.id);
        void fetchOrders(`slot-${first.id}`, first.id);
      }
    } else if (tab === "hold") {
      setActiveSection("hold");
      void fetchOrders("hold");
    }
  }

  // ── Refresh ───────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    await fetchSlots();
    await fetchOrders(activeSection, activeSlotId ?? undefined);
  }, [fetchSlots, fetchOrders, activeSection, activeSlotId]);

  // ── Action handlers ──────────────────────────────────────────────────────
  const handleDispatch = useCallback(async (orderId: number, target: { dispatchTargetDate: string; dispatchWindowId: number }) => {
    const res = await fetch(`/api/support/orders/${orderId}/dispatch`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dispatchTargetDate: target.dispatchTargetDate, dispatchWindowId: target.dispatchWindowId }),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? "Dispatch failed");
    }
    toast.success("Order dispatched");
    await refresh();
  }, [refresh]);

  const handleShipToOverride = useCallback(async (orderId: number, customerId: number | null) => {
    const res = await fetch(`/api/support/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shipToOverrideCustomerId: customerId }),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(e.error ?? "Ship-to override failed");
      throw new Error(e.error ?? "Ship-to override failed");
    }
    toast.success(customerId ? "Ship-to override set" : "Ship-to override cleared");
    await refresh();
  }, [refresh]);

  const handlePresetSlot = useCallback(async (orderId: number, target: { dispatchTargetDate: string; dispatchWindowId: number }) => {
    const res = await fetch(`/api/support/orders/${orderId}/preset-slot`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dispatchTargetDate: target.dispatchTargetDate, dispatchWindowId: target.dispatchWindowId }),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? "Pre-set slot failed");
    }
    toast.success("Dispatch slot saved");
    await refresh();
  }, [refresh]);

  const handleHold = useCallback(async (orderId: number) => {
    const res = await fetch(`/api/support/orders/${orderId}/hold`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? "Hold failed");
    }
    toast.success("Order placed on hold");
    await refresh();
  }, [refresh]);

  const handleRelease = useCallback(async (orderId: number) => {
    const res = await fetch(`/api/support/orders/${orderId}/release`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? "Release failed");
    }
    toast.success("Order released from hold");
    await refresh();
  }, [refresh]);

  const handleHoldRelease = useCallback(
    async (orderId: number, target: { dispatchTargetDate: string; dispatchWindowId: number }) => {
      const res = await fetch(`/api/support/orders/${orderId}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error ?? "Release failed");
      }
      toast.success("Order released from hold");
      await refresh();
    },
    [refresh],
  );

  const handleCancel = useCallback(async (orderId: number, reason: string, note?: string) => {
    const res = await fetch(`/api/support/orders/${orderId}/cancel`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, note }),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? "Cancel failed");
    }
    toast.success("Order cancelled");
    await refresh();
  }, [refresh]);

  const handleAssignSlot = useCallback(async (orderId: number, slotId: number) => {
    const res = await fetch(`/api/support/orders/${orderId}/assign-slot`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? "Assign slot failed");
    }
    toast.success("Slot assigned");
    await refresh();
  }, [refresh]);

  const handleBulkDispatch = useCallback(async (orderIds: number[], target: { dispatchTargetDate: string; dispatchWindowId: number }) => {
    const res = await fetch("/api/support/bulk", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds, action: "dispatch", dispatchTargetDate: target.dispatchTargetDate, dispatchWindowId: target.dispatchWindowId }),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? "Bulk dispatch failed");
    }
    const data = (await res.json().catch(() => ({}))) as { processed?: number; skipped?: number };
    toast.success(`${data.processed ?? 0} dispatched, ${data.skipped ?? 0} skipped`);
    await refresh();
  }, [refresh]);

  const handleBulkHold = useCallback(async (orderIds: number[]) => {
    const res = await fetch("/api/support/bulk", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds, action: "hold" }),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? "Bulk hold failed");
    }
    const data = (await res.json().catch(() => ({}))) as { processed?: number; skipped?: number };
    toast.success(`${data.processed ?? 0} placed on hold, ${data.skipped ?? 0} skipped`);
    await refresh();
  }, [refresh]);

  // ── Derived values ────────────────────────────────────────────────────────
  const headerPending    = slots.reduce((s, sl) => s + sl.pendingCount, 0);
  const headerDispatched = slots.reduce((s, sl) => s + sl.dispatchedCount, 0);
  const headerTinting    = slots.reduce((s, sl) => s + sl.tintingCount, 0);
  const todayTotal    = headerPending + headerTinting + headerDispatched + doneCount;
  const todayDonePct  = todayTotal > 0 ? Math.round((doneCount / todayTotal) * 100) : 0;

  const statusCounts = useMemo(() => ({
    all:        orders.length,
    pending:    orders.filter((o) => !o.dispatchStatus).length,
    dispatch:   orders.filter((o) => o.dispatchStatus === "dispatch").length,
    dispatched: orders.filter((o) => o.workflowStage === "dispatched" || o.dispatchStatus === "dispatched").length,
  }), [orders]);

  const filteredOrders = useMemo(() => {
    // Done orders (closed stage) always pass through — they render in the done section
    // regardless of which status filter is active. Only non-done orders are filtered.
    const done = orders.filter((o) => o.isDone);
    const work = orders.filter((o) => !o.isDone);
    let active: SupportOrder[];
    if (statusFilter === "all")             active = work;
    else if (statusFilter === "pending")    active = work.filter((o) => !o.dispatchStatus);
    else if (statusFilter === "dispatch")   active = work.filter((o) => o.dispatchStatus === "dispatch");
    else if (statusFilter === "dispatched") active = work.filter((o) => o.workflowStage === "dispatched" || o.dispatchStatus === "dispatched");
    else active = work;

    const byTime = (a: SupportOrder, b: SupportOrder): number => {
      const tA = a.orderDateTime ?? a.obdEmailDate;
      const tB = b.orderDateTime ?? b.obdEmailDate;
      const msA = tA ? new Date(tA).getTime() : Infinity;
      const msB = tB ? new Date(tB).getTime() : Infinity;
      if (msA !== msB) return msA - msB;
      return a.obdNumber < b.obdNumber ? -1 : a.obdNumber > b.obdNumber ? 1 : 0;
    };

    return [...active.sort(byTime), ...done.sort(byTime)];
  }, [orders, statusFilter]);

  // Apply search filter on top of status filter
  const displayOrders = useMemo(() => {
    if (!searchQuery.trim()) return filteredOrders;
    const q = searchQuery.trim().toLowerCase();
    return filteredOrders.filter((o) =>
      o.obdNumber.toLowerCase().includes(q) ||
      o.shipToCustomerName?.toLowerCase().includes(q) ||
      o.customer?.customerName?.toLowerCase().includes(q),
    );
  }, [filteredOrders, searchQuery]);

  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const isHistoryView = date < todayIST;
  const isEarlierView = activeSection === "earlier";

  // Header props
  const headerDate = useMemo(() => new Date(date + "T00:00:00+05:30"), [date]);
  const handleHeaderDateChange = useCallback((d: Date) => {
    setDate(d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  }, []);

  const headerSegments = useMemo(() =>
    slots.filter((s) => !s.isNextDay).map((s) => ({
      id: s.id,
      label: s.name,
      count: s.pendingCount + s.tintingCount,
    })),
  [slots]);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (slotsLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 size={28} className="animate-spin text-gray-400" />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">

      <UniversalHeader
        title="Support Queue"
        showImport={canImportOBDs}
        stats={isHistoryView ? [
          { label: "pending", value: headerPending },
          { label: "done", value: doneCount },
          { label: "tinting", value: headerTinting },
          { label: "OBDs", value: headerPending + doneCount + headerTinting },
        ] : [
          { label: "done", value: `${todayDonePct}%`, tone: "success" as const },
          { label: "OBDs", value: todayTotal },
        ]}
        segments={headerSegments}
        activeSegment={activeSlotId}
        segmentsDisabled={mainTab === "hold" || isEarlierView}
        onSegmentChange={(id) => {
          if (mainTab === "hold") return;
          if (isEarlierView) return;
          if (id === null) {
            // Active segment clicked again → ALL view (deselect)
            setActiveSection("slot-all");
            setActiveSlotId(null);
            setStatusFilter("all");
            void fetchOrders("slot-all", undefined);
          } else {
            handleSelectSection(`slot-${id}`, id as number);
          }
        }}
        filterGroups={[
          { label: "View", key: "view", options: [{ value: "hold", label: "Hold Only" }] },
          { label: "Status", key: "status", options: [{ value: "pending", label: "Pending" }, { value: "dispatch", label: "Dispatch" }, { value: "dispatched", label: "Dispatched" }] },
          { label: "Delivery Type", key: "deliveryType", options: [{ value: "LOCAL", label: "Local" }, { value: "UPC", label: "UPC" }, { value: "IGT", label: "IGT" }] },
        ]}
        activeFilters={headerFilters}
        onFilterChange={setHeaderFilters}
        currentDate={headerDate}
        onDateChange={handleHeaderDateChange}
        searchPlaceholder="Search OBD, customer..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        shortcuts={[
          { key: "\u2191\u2193", label: "Navigate rows" },
          { key: "\u21B5", label: "Expand order" },
        ]}
      />

{/* ── Earlier pending badge — toggle (tap in / tap out) ───────────── */}
      {!isHistoryView && earlierPendingCount > 0 && (
        <button
          type="button"
          onClick={() => {
            if (isEarlierView) {
              handleMainTabChange("all");   // lands on Morning (activeSlotId=null → slots[0])
            } else {
              setMainTab("all");
              handleSelectSection("earlier");
            }
          }}
          style={{ background: "#fdf6e7", borderTop: "none", borderRight: "none", borderLeft: "none", borderBottom: "0.5px solid #f0d79a", color: "#854f0b" }}
          className="flex items-center justify-between px-5 py-2.5 text-xs font-medium w-full text-left flex-shrink-0 transition-colors"
        >
          <span className="flex items-center gap-2">
            <span>⚠</span>
            <span>{earlierPendingCount} pending from earlier</span>
          </span>
          <span className="text-[11px] font-medium" style={{ opacity: isEarlierView ? 1 : 0.8 }}>
            {isEarlierView ? "← back to today" : "tap to view"}
          </span>
        </button>
      )}

{/* ── All Tab Content ───────────────────────────────────────────────── */}
      {mainTab === "all" && (
        <>
          {/* Orders table */}
          <div className="flex-1 overflow-hidden">
            <SupportOrdersTable
              orders={displayOrders}
              section={activeSection}
              onDispatch={handleDispatch}
              onShipToOverride={handleShipToOverride}
              onPresetSlot={handlePresetSlot}
              onHold={handleHold}
              onRelease={handleRelease}
              onCancel={handleCancel}
              onAssignSlot={handleAssignSlot}
              onBulkDispatch={handleBulkDispatch}
              onBulkHold={handleBulkHold}
              dispatchWindows={dispatchWindows}
              loading={ordersLoading}
              slots={slots}
              date={date}
              onOrdersChanged={refresh}
              isHistoryView={isHistoryView}
              activeSlotId={activeSlotId}
            />
          </div>
        </>
      )}

      {/* ── Hold Tab Content ─────────────────────────────────────────────── */}
      {mainTab === "hold" && (
        <SupportHoldTable
          orders={orders}
          dispatchWindows={dispatchWindows}
          loading={ordersLoading}
          onRelease={handleHoldRelease}
          onCancel={handleCancel}
          onShipToOverride={handleShipToOverride}
        />
      )}
    </div>
  );
}
