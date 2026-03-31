"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, AlertTriangle, CalendarDays, Pause } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SupportOrdersTable } from "@/components/support/support-orders-table";
import type { SupportOrder } from "@/components/support/support-orders-table";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SlotNavItem {
  id: number;
  name: string;
  sortOrder: number;
  cutoffTime: string | null;
  deliveryTypeId: number | null;
  pendingCount: number;
  dispatchedCount: number;
  tintingCount: number;
}

interface SlotsResponse {
  slots: SlotNavItem[];
  overdueCount: number;
  holdCount: number;
  date: string;
}

type MainTab = "overdue" | "today" | "hold";

// ── Helpers ─────────────────────────────────────────────────────────────────

function getSlotColor(sortOrder: number): string {
  if (sortOrder === 1) return "#f97316";
  if (sortOrder === 2) return "#3b82f6";
  if (sortOrder === 3) return "#8b5cf6";
  return "#10b981";
}

function computeCountdown(
  cutoffTime: string | null,
  dateStr: string,
): { label: string; color: string; pulse: boolean } {
  if (!cutoffTime) return { label: "", color: "text-gray-400", pulse: false };

  const [hh, mm] = cutoffTime.split(":").map(Number);
  const target = new Date(dateStr + "T00:00:00");
  target.setHours(hh, mm, 0, 0);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();

  if (diffMs <= 0) {
    return { label: "✓ Done", color: "text-gray-400", pulse: false };
  }

  const totalMin = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;

  if (hours >= 3) {
    return { label: `${hours}h ${mins}m`, color: "text-green-600", pulse: false };
  }
  if (hours >= 1) {
    return { label: `${hours}h ${mins}m`, color: "text-amber-600", pulse: false };
  }
  const secs = Math.floor((diffMs % 60000) / 1000);
  const mmStr = String(mins).padStart(2, "0");
  const ssStr = String(secs).padStart(2, "0");
  return { label: `${mmStr}:${ssStr}`, color: "text-red-600", pulse: true };
}

// ── Component ───────────────────────────────────────────────────────────────

export function SupportPageContent() {
  const [date] = useState(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<SlotNavItem[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [holdCount, setHoldCount] = useState(0);
  const [orders, setOrders] = useState<SupportOrder[]>([]);
  const [activeSection, setActiveSection] = useState("");
  const [activeSlotId, setActiveSlotId] = useState<number | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>("today");
  const [, setTick] = useState(0);

  // Countdown timer tick (every second)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Fetch slots ──────────────────────────────────────────────────────────
  const fetchSlots = useCallback(async () => {
    try {
      const res = await fetch("/api/support/slots");
      if (!res.ok) throw new Error("Failed to fetch slots");
      const data = (await res.json()) as SlotsResponse;
      setSlots(data.slots);
      setOverdueCount(data.overdueCount);
      setHoldCount(data.holdCount);
      return data;
    } catch {
      toast.error("Failed to load slots");
      return null;
    }
  }, []);

  // ── Fetch orders ─────────────────────────────────────────────────────────
  const fetchOrders = useCallback(
    async (section: string, slotId?: number) => {
      setOrdersLoading(true);
      try {
        const qs = new URLSearchParams({ date });
        if (section === "overdue") {
          qs.set("section", "overdue");
        } else if (section === "hold") {
          qs.set("section", "hold");
        } else if (section.startsWith("slot-") && slotId) {
          qs.set("section", "slot");
          qs.set("slotId", String(slotId));
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
      if (data && data.slots.length > 0) {
        const first = data.slots[0];
        const sec = `slot-${first.id}`;
        setActiveSection(sec);
        setActiveSlotId(first.id);
        await fetchOrders(sec, first.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Section change (sub-tab click) ───────────────────────────────────────
  function handleSelectSection(section: string, slotId?: number) {
    setActiveSection(section);
    setActiveSlotId(slotId ?? null);
    void fetchOrders(section, slotId);
  }

  // ── Main tab change ──────────────────────────────────────────────────────
  function handleMainTabChange(tab: MainTab) {
    setMainTab(tab);
    if (tab === "overdue") {
      setActiveSection("overdue");
      setActiveSlotId(null);
      void fetchOrders("overdue");
    } else if (tab === "hold") {
      setActiveSection("hold");
      setActiveSlotId(null);
      void fetchOrders("hold");
    } else {
      // today — select first slot or current active slot
      if (activeSlotId && slots.find((s) => s.id === activeSlotId)) {
        void fetchOrders(`slot-${activeSlotId}`, activeSlotId);
      } else if (slots.length > 0) {
        const first = slots[0];
        setActiveSection(`slot-${first.id}`);
        setActiveSlotId(first.id);
        void fetchOrders(`slot-${first.id}`, first.id);
      }
    }
  }

  // ── Refresh helper ─────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    await fetchSlots();
    await fetchOrders(activeSection, activeSlotId ?? undefined);
  }, [fetchSlots, fetchOrders, activeSection, activeSlotId]);

  // ── Action handlers ──────────────────────────────────────────────────────
  const handleDispatch = useCallback(
    async (orderId: number) => {
      const res = await fetch(`/api/support/orders/${orderId}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Dispatch failed");
      }
      toast.success("Order dispatched");
      await refresh();
    },
    [refresh],
  );

  const handleHold = useCallback(
    async (orderId: number) => {
      const res = await fetch(`/api/support/orders/${orderId}/hold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Hold failed");
      }
      toast.success("Order placed on hold");
      await refresh();
    },
    [refresh],
  );

  const handleRelease = useCallback(
    async (orderId: number) => {
      const res = await fetch(`/api/support/orders/${orderId}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Release failed");
      }
      toast.success("Order released from hold");
      await refresh();
    },
    [refresh],
  );

  const handleCancel = useCallback(
    async (orderId: number, reason: string, note?: string) => {
      const res = await fetch(`/api/support/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, note }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Cancel failed");
      }
      toast.success("Order cancelled");
      await refresh();
    },
    [refresh],
  );

  const handleAssignSlot = useCallback(
    async (orderId: number, slotId: number) => {
      const res = await fetch(`/api/support/orders/${orderId}/assign-slot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Assign slot failed");
      }
      toast.success("Slot assigned");
      await refresh();
    },
    [refresh],
  );

  const handleBulkDispatch = useCallback(
    async (orderIds: number[]) => {
      const res = await fetch("/api/support/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds, action: "dispatch" }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Bulk dispatch failed");
      }
      const data = (await res.json().catch(() => ({}))) as {
        processed?: number;
        skipped?: number;
      };
      toast.success(
        `${data.processed ?? 0} dispatched, ${data.skipped ?? 0} skipped`,
      );
      await refresh();
    },
    [refresh],
  );

  const handleBulkHold = useCallback(
    async (orderIds: number[]) => {
      const res = await fetch("/api/support/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds, action: "hold" }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Bulk hold failed");
      }
      const data = (await res.json().catch(() => ({}))) as {
        processed?: number;
        skipped?: number;
      };
      toast.success(
        `${data.processed ?? 0} placed on hold, ${data.skipped ?? 0} skipped`,
      );
      await refresh();
    },
    [refresh],
  );

  // ── Derived values ───────────────────────────────────────────────────────
  const activeSlot = slots.find((s) => s.id === activeSlotId);
  const slotName = activeSlot?.name;
  const cutoffTime = activeSlot?.cutoffTime ?? undefined;
  const slotColor = activeSlot
    ? getSlotColor(activeSlot.sortOrder)
    : undefined;

  const totalTodayOrders = slots.reduce(
    (sum, s) => sum + s.pendingCount + s.dispatchedCount + s.tintingCount,
    0,
  );

  // ── Main tab config ──────────────────────────────────────────────────────
  const mainTabs: {
    key: MainTab;
    label: string;
    icon: typeof AlertTriangle;
    count: number;
    activeColor: string;
    badgeBg: string;
    badgeText: string;
    borderColor: string;
  }[] = [
    {
      key: "overdue",
      label: "Overdue",
      icon: AlertTriangle,
      count: overdueCount,
      activeColor: "text-red-700",
      badgeBg: "bg-red-100",
      badgeText: "text-red-700",
      borderColor: "border-red-500",
    },
    {
      key: "today",
      label: "Today",
      icon: CalendarDays,
      count: totalTodayOrders,
      activeColor: "text-indigo-700",
      badgeBg: "bg-indigo-100",
      badgeText: "text-indigo-700",
      borderColor: "border-indigo-500",
    },
    {
      key: "hold",
      label: "Hold",
      icon: Pause,
      count: holdCount,
      activeColor: "text-amber-700",
      badgeBg: "bg-amber-100",
      badgeText: "text-amber-700",
      borderColor: "border-amber-500",
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  if (slotsLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 size={28} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] bg-[#f5f6fa]">
      {/* ── Main Tab Bar ─────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-[#ededf3] px-6 flex items-end gap-0">
        {mainTabs.map((tab) => {
          const isActive = mainTab === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleMainTabChange(tab.key)}
              className={cn(
                "flex items-center gap-2 px-5 py-3 text-[13px] font-bold transition-colors border-b-[2.5px] -mb-px",
                isActive
                  ? `${tab.activeColor} ${tab.borderColor}`
                  : "text-[#5a5d74] border-transparent hover:text-[#1c1e30]",
              )}
            >
              <Icon size={15} className={isActive ? tab.activeColor : "text-[#8e91a7]"} />
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={cn(
                    "text-[10.5px] font-bold px-2 py-0.5 rounded-full",
                    isActive
                      ? `${tab.badgeBg} ${tab.badgeText}`
                      : "bg-gray-100 text-[#5a5d74]",
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Sub Tab Bar (Today only) ─────────────────────────────────────── */}
      {mainTab === "today" && (
        <div className="bg-white border-b border-[#ededf3] px-6 flex items-end gap-0">
          {slots.map((slot) => {
            const isActive = activeSlotId === slot.id;
            const color = getSlotColor(slot.sortOrder);
            const countdown = computeCountdown(slot.cutoffTime, date);

            return (
              <button
                key={slot.id}
                type="button"
                onClick={() => handleSelectSection(`slot-${slot.id}`, slot.id)}
                className={cn(
                  "flex items-center gap-2.5 px-4 py-2.5 text-[12px] font-semibold transition-colors border-b-[2.5px] -mb-px",
                  isActive
                    ? "text-[#1c1e30]"
                    : "text-[#5a5d74] border-transparent hover:text-[#1c1e30]",
                )}
                style={isActive ? { borderBottomColor: color } : undefined}
              >
                {/* Colored dot */}
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />

                {/* Slot name */}
                {slot.name}

                {/* Countdown timer */}
                {countdown.label && (
                  <span
                    className={cn(
                      "text-[10.5px] font-mono font-bold",
                      countdown.color,
                      countdown.pulse && "animate-pulse",
                    )}
                  >
                    {countdown.label}
                  </span>
                )}

                {/* Pending/done meta */}
                <span className="text-[10px] text-[#8e91a7] font-normal">
                  {slot.pendingCount} pend · {slot.dispatchedCount} done
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Orders Table ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <SupportOrdersTable
          orders={orders}
          section={activeSection}
          mainTab={mainTab}
          slotName={slotName}
          cutoffTime={cutoffTime}
          slotColor={slotColor}
          onDispatch={handleDispatch}
          onHold={handleHold}
          onRelease={handleRelease}
          onCancel={handleCancel}
          onAssignSlot={handleAssignSlot}
          onBulkDispatch={handleBulkDispatch}
          onBulkHold={handleBulkHold}
          loading={ordersLoading}
          slots={slots}
          date={date}
          onOrdersChanged={refresh}
        />
      </div>
    </div>
  );
}
