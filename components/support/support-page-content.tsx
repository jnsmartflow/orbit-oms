"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SupportOrdersTable } from "@/components/support/support-orders-table";
import { SupportHoldTable } from "@/components/support/support-hold-table";
import type { SupportOrder } from "@/components/support/support-orders-table";
import { getPriLabel } from "@/components/support/shared/table-cells";
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
  const [allTabOrderCount, setAllTabOrderCount] = useState(0);
  const [dispatchWindows, setDispatchWindows] = useState<DispatchWindow[]>([]);
  const [headerFilters, setHeaderFilters] = useState<Record<string, string[]>>({ view: [], smu: [], deliveryType: [], priority: [] });
  const [searchQuery, setSearchQuery] = useState("");

  // Sync header filters → existing state
  useEffect(() => {
    const v = headerFilters.view ?? [];
    if (v.includes("hold")) { if (mainTab !== "hold") handleMainTabChange("hold"); }
    else { if (mainTab !== "all") handleMainTabChange("all"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerFilters.view]);

  // Re-fetch slots + orders when date changes; reset hold tab when switching to history
  useEffect(() => {
    if (!activeSection) return;
    const nowIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const histView = date < nowIST;
    (async () => {
      const data = await fetchSlots();
      if (histView && mainTab === "hold") {
        setMainTab("all");
        // Clear the View filter's "Hold Only" selection in the same beat as the
        // tab reset — otherwise the Filter pill keeps showing Hold Only active
        // (and its badge count) while the board silently renders the all-tab.
        setHeaderFilters((prev) => ({ ...prev, view: [] }));
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
    void fetchOrders(section, slotId);
  }

  // ── Main tab change ──────────────────────────────────────────────────────
  function handleMainTabChange(tab: MainTab) {
    setMainTab(tab);
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

  // Distinct SMU values present in the currently-loaded list — mirrors
  // getSmuGroup()'s "Unknown SMU" fallback so the filter options never
  // disagree with the Group-by-SMU bucket names.
  const smuOptions = useMemo(() => {
    const set = new Set(orders.map((o) => o.smu || "Unknown SMU"));
    return Array.from(set).sort();
  }, [orders]);

  // SMU / Delivery Type / Priority — groups AND together, options within a
  // group OR together. Applies uniformly regardless of which section is
  // loaded (slot / hold / earlier), so Hold-tab and carry-over lists filter
  // the same way as the main board.
  const passesGroupFilters = useCallback((o: SupportOrder): boolean => {
    const smuSel = headerFilters.smu ?? [];
    if (smuSel.length > 0 && !smuSel.includes(o.smu || "Unknown SMU")) return false;

    const dtSel = headerFilters.deliveryType ?? [];
    if (dtSel.length > 0) {
      const dtName = (o.customer?.dispatchDeliveryType?.name ?? o.customer?.area?.deliveryType?.name ?? "").toLowerCase();
      const dtCodeToName: Record<string, string> = { LOCAL: "local", UPC: "upcountry", IGT: "igt" };
      const matches = dtSel.some((v) => dtName.includes(dtCodeToName[v] ?? v.toLowerCase()));
      if (!matches) return false;
    }

    const priSel = headerFilters.priority ?? [];
    if (priSel.length > 0 && !priSel.includes(getPriLabel(String(o.priorityLevel)))) return false;

    return true;
  }, [headerFilters]);

  const filteredOrders = useMemo(() => {
    // SMU/Delivery Type/Priority apply to done AND pending rows alike, before
    // Group by runs — so group headers (and the done-section count) always
    // reflect the same scoped set the operator is looking at.
    const scoped = orders.filter(passesGroupFilters);
    const done = scoped.filter((o) => o.isDone);
    const work = scoped.filter((o) => !o.isDone);

    const byTime = (a: SupportOrder, b: SupportOrder): number => {
      const tA = a.orderDateTime ?? a.obdEmailDate;
      const tB = b.orderDateTime ?? b.obdEmailDate;
      const msA = tA ? new Date(tA).getTime() : Infinity;
      const msB = tB ? new Date(tB).getTime() : Infinity;
      if (msA !== msB) return msA - msB;
      return a.obdNumber < b.obdNumber ? -1 : a.obdNumber > b.obdNumber ? 1 : 0;
    };

    return [...work.sort(byTime), ...done.sort(byTime)];
  }, [orders, passesGroupFilters]);

  // Single header search box — strict superset of the old toolbar search
  // (adds shipToCustomerId, customer.customerCode, keeps route name). Every
  // field is null-guarded; feeds both the "all" tab table and the Hold tab.
  const displayOrders = useMemo(() => {
    if (!searchQuery.trim()) return filteredOrders;
    const q = searchQuery.trim().toLowerCase();
    return filteredOrders.filter((o) => {
      const obd      = o.obdNumber?.toLowerCase() ?? "";
      const custName = o.customer?.customerName?.toLowerCase() ?? "";
      const shipName = o.shipToCustomerName?.toLowerCase() ?? "";
      const shipId   = o.shipToCustomerId?.toLowerCase() ?? "";
      const custCode = o.customer?.customerCode?.toLowerCase() ?? "";
      const route    = o.customer?.area?.primaryRoute?.name?.toLowerCase() ?? "";
      return (
        obd.includes(q) ||
        custName.includes(q) ||
        shipName.includes(q) ||
        shipId.includes(q) ||
        custCode.includes(q) ||
        route.includes(q)
      );
    });
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
            void fetchOrders("slot-all", undefined);
          } else {
            handleSelectSection(`slot-${id}`, id as number);
          }
        }}
        filterGroups={[
          { label: "View", key: "view", options: [{ value: "hold", label: "Hold Only" }] },
          { label: "SMU", key: "smu", options: smuOptions.map((s) => ({ value: s, label: s })) },
          { label: "Delivery Type", key: "deliveryType", options: [{ value: "LOCAL", label: "Local" }, { value: "UPC", label: "UPC" }, { value: "IGT", label: "IGT" }] },
          { label: "Priority", key: "priority", options: [
            { value: getPriLabel("1"), label: getPriLabel("1") },
            { value: getPriLabel("2"), label: getPriLabel("2") },
            { value: getPriLabel("4"), label: getPriLabel("4") },
            { value: getPriLabel("3"), label: getPriLabel("3") },
          ] },
        ]}
        activeFilters={headerFilters}
        onFilterChange={setHeaderFilters}
        currentDate={headerDate}
        onDateChange={handleHeaderDateChange}
        searchPlaceholder="Search OBD, customer, code, route..."
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
          orders={displayOrders}
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
