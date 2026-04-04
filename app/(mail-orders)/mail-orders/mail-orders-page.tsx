"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { fetchMailOrders, punchOrder, saveSoNumber, saveCustomer, getTodayIST } from "@/lib/mail-orders/api";
import { getSlotFromTime, groupOrdersBySlot, buildClipboardText } from "@/lib/mail-orders/utils";
import type { MoOrder, MoOrderLine } from "@/lib/mail-orders/types";
import { MailOrdersTable } from "./mail-orders-table";
import { UniversalHeader } from "@/components/universal-header";

export default function MailOrdersPage() {
  // ── State ────────────────────────────────────────────────────────────────────
  const [orders, setOrders] = useState<MoOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [headerFilters, setHeaderFilters] = useState<Record<string, string[]>>({ status: [], matchStatus: [], dispatch: [] });
  const [flaggedIds, setFlaggedIds] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copiedCodeId, setCopiedCodeId] = useState<number | null>(null);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => getTodayIST());
  const [openCodePopoverId, setOpenCodePopoverId] = useState<number | null>(null);

  // ── Data fetch ───────────────────────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    try {
      const data = await fetchMailOrders(selectedDate);
      setOrders(data.orders);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    setLoading(true);
    setOrders([]);
    loadOrders();
    const interval = setInterval(loadOrders, error ? 30_000 : 60_000);
    return () => clearInterval(interval);
  }, [loadOrders, error]);

  // ── Derived stats ────────────────────────────────────────────────────────────
  const totalOrders = orders.length;
  const totalLines = useMemo(() => orders.reduce((s, o) => s + o.totalLines, 0), [orders]);
  const matchedLines = useMemo(() => orders.reduce((s, o) => s + o.matchedLines, 0), [orders]);
  const punchedOrders = useMemo(() => orders.filter((o) => o.status === "punched").length, [orders]);

  // ── Filtered orders ──────────────────────────────────────────────────────────
  const filteredOrders = useMemo(() => {
    let result = orders;

    const statusArr = headerFilters.status ?? [];
    if (statusArr.length > 0) {
      result = result.filter((o) => statusArr.includes(o.status));
    }

    const matchArr = headerFilters.matchStatus ?? [];
    if (matchArr.length > 0) {
      result = result.filter((o) => matchArr.includes(o.customerMatchStatus ?? "unmatched"));
    }

    const dispatchArr = headerFilters.dispatch ?? [];
    if (dispatchArr.length > 0) {
      result = result.filter((o) => dispatchArr.includes(o.dispatchStatus ?? "Dispatch"));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (o) =>
          o.soName.toLowerCase().includes(q) ||
          o.customerName?.toLowerCase().includes(q) ||
          o.subject.toLowerCase().includes(q),
      );
    }

    if (activeSlot) {
      result = result.filter((o) => getSlotFromTime(o.receivedAt) === activeSlot);
    }

    return result;
  }, [orders, headerFilters, searchQuery, activeSlot]);

  const groupedOrders = useMemo(() => groupOrdersBySlot(filteredOrders), [filteredOrders]);

  // ── Slot counts (from all orders, before slot filter) ───────────────────────
  const slotCounts = useMemo(() => {
    const counts: Record<string, number> = { Morning: 0, Afternoon: 0, Evening: 0, Night: 0 };
    for (const o of orders) {
      const slot = getSlotFromTime(o.receivedAt);
      counts[slot]++;
    }
    return counts;
  }, [orders]);

  // ── Focus first pending order after fetch ─────────────────────────────────────
  useEffect(() => {
    if (orders.length > 0 && focusedId === null) {
      const firstPending = orders.find((o) => o.status === "pending");
      if (firstPending) setFocusedId(firstPending.id);
    }
  }, [orders, focusedId]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleFlag = useCallback(
    (id: number) => {
      setFlaggedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      if (expandedId === id) setExpandedId(null);
    },
    [expandedId],
  );

  const handleExpand = useCallback((id: number | null) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handlePunch = useCallback(
    async (id: number) => {
      // Optimistic update
      setOrders((prev) =>
        prev.map((o) =>
          o.id === id
            ? { ...o, status: "punched" as const, punchedAt: new Date().toISOString() }
            : o,
        ),
      );
      try {
        await punchOrder(id);
      } catch {
        // Revert on error
        const data = await fetchMailOrders(selectedDate);
        setOrders(data.orders);
      }
    },
    [selectedDate],
  );

  const handleCopy = useCallback((id: number, lines: MoOrderLine[]) => {
    const text = buildClipboardText(lines);
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleSaveSoNumber = useCallback(async (orderId: number, value: string) => {
    if (!/^\d{10}$/.test(value)) return false;
    // Optimistic update — set soNumber + auto-punch
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? {
        ...o,
        soNumber: value,
        status: "punched" as const,
        punchedAt: new Date().toISOString(),
      } : o)),
    );
    try {
      await saveSoNumber(orderId, value);
      return true;
    } catch {
      const data = await fetchMailOrders(selectedDate);
      setOrders(data.orders);
      return false;
    }
  }, [selectedDate]);

  const handleSaveCustomer = useCallback(async (
    orderId: number,
    data: { customerCode: string; customerName: string; saveKeyword?: boolean; keyword?: string; area?: string; deliveryType?: string; route?: string },
  ) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? { ...o, customerCode: data.customerCode, customerName: data.customerName, customerMatchStatus: "exact" as const, customerCandidates: null, customerArea: data.area ?? null, customerDeliveryType: data.deliveryType ?? null, customerRoute: data.route ?? null }
          : o,
      ),
    );
    try {
      await saveCustomer(orderId, data);
    } catch {
      const d = await fetchMailOrders(selectedDate);
      setOrders(d.orders);
    }
  }, [selectedDate]);

  // ── Flat order list for keyboard navigation ──────────────────────────────────
  const flatOrders = useMemo(() => {
    const result: MoOrder[] = [];
    for (const slot of ["Morning", "Afternoon", "Evening", "Night"] as const) {
      const group = groupedOrders[slot];
      if (group) result.push(...group);
    }
    return result;
  }, [groupedOrders]);

  // ── Keyboard navigation ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Esc closes any open popover regardless of focus
      if (e.key === "Escape") {
        if (openCodePopoverId !== null) {
          setOpenCodePopoverId(null);
          return;
        }
      }

      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const key = e.key;

      if (key === "ArrowDown" || key === "j" || key === "J") {
        e.preventDefault();
        setFocusedId((prev) => {
          const idx = flatOrders.findIndex((o) => o.id === prev);
          if (idx < flatOrders.length - 1) return flatOrders[idx + 1].id;
          return prev;
        });
        return;
      }

      if (key === "ArrowUp" || key === "k" || key === "K") {
        e.preventDefault();
        setFocusedId((prev) => {
          const idx = flatOrders.findIndex((o) => o.id === prev);
          if (idx > 0) return flatOrders[idx - 1].id;
          return prev;
        });
        return;
      }

      if (key === "Enter") {
        if (focusedId !== null) handleExpand(focusedId);
        return;
      }

      if (key === "c" || key === "C") {
        if (focusedId !== null) {
          const order = flatOrders.find((o) => o.id === focusedId);
          if (order?.customerMatchStatus === "exact" && order.customerCode) {
            navigator.clipboard.writeText(order.customerCode);
            setCopiedCodeId(focusedId);
            setTimeout(() => setCopiedCodeId(null), 1500);
          }
        }
        return;
      }

      if (key === "s" || key === "S") {
        if (focusedId !== null) {
          const order = flatOrders.find((o) => o.id === focusedId);
          if (order) handleCopy(focusedId, order.lines);
        }
        return;
      }

      if (key === "p" || key === "P") {
        if (focusedId !== null) {
          setOpenCodePopoverId(openCodePopoverId === focusedId ? null : focusedId);
        }
        return;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [flatOrders, focusedId, handleExpand, handleCopy, openCodePopoverId]);

  // ── Auto-scroll focused row into view ───────────────────────────────────────
  useEffect(() => {
    if (focusedId !== null) {
      document
        .querySelector(`tr[data-order-id="${focusedId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [focusedId]);

  // ── Header props ─────────────────────────────────────────────────────────────
  const headerSegments = useMemo(() => [
    { id: "Morning", label: "Morning", count: slotCounts.Morning },
    { id: "Afternoon", label: "Afternoon", count: slotCounts.Afternoon },
    { id: "Evening", label: "Evening", count: slotCounts.Evening },
    { id: "Night", label: "Night", count: slotCounts.Night },
  ], [slotCounts]);

  const headerDate = useMemo(() => new Date(selectedDate + "T00:00:00+05:30"), [selectedDate]);
  const handleHeaderDateChange = useCallback((d: Date) => {
    setSelectedDate(d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  }, []);

  // ── Urgent/Hold counts (from filtered orders, unpunched only) ───────────────
  const urgentCount = useMemo(() =>
    filteredOrders.filter((o) => o.status !== "punched" && o.dispatchPriority === "Urgent").length,
    [filteredOrders],
  );
  const holdCount = useMemo(() =>
    filteredOrders.filter((o) => o.status !== "punched" && o.dispatchStatus === "Hold").length,
    [filteredOrders],
  );
  const hasUrgentOrHold = urgentCount > 0 || holdCount > 0;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <UniversalHeader
        title="Mail Orders"
        stats={[
          { label: "orders", value: totalOrders },
          { label: `/${totalLines} lines`, value: matchedLines },
          { label: `/${totalOrders} punched`, value: punchedOrders },
        ]}
        segments={headerSegments}
        activeSegment={activeSlot}
        onSegmentChange={(id) => setActiveSlot(id as string | null)}
        filterGroups={[
          { label: "Status", key: "status", options: [{ value: "pending", label: "Pending" }, { value: "punched", label: "Punched" }] },
          { label: "Match", key: "matchStatus", options: [{ value: "exact", label: "Matched" }, { value: "multiple", label: "Multiple" }, { value: "unmatched", label: "Unmatched" }] },
          { label: "Dispatch", key: "dispatch", options: [{ value: "Hold", label: "Hold" }, { value: "Dispatch", label: "Dispatch" }] },
        ]}
        activeFilters={headerFilters}
        onFilterChange={setHeaderFilters}
        currentDate={headerDate}
        onDateChange={handleHeaderDateChange}
        searchPlaceholder="Search orders..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        shortcuts={[
          { key: "C", label: "Copy customer code" },
          { key: "S", label: "Copy SKU lines" },
          { key: "P", label: "Pick customer" },
        ]}
      />

      {/* ── Content area ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!loading && hasUrgentOrHold && (
          <div className="sticky top-0 z-20 mb-2 -mx-0">
            <div className="flex items-center justify-between px-3 py-2 rounded-lg border bg-red-50 border-red-200">
              <div className="flex items-center gap-2">
                <span className="text-red-600 text-[12px]">⚠</span>
                <span className="text-[11px] font-medium text-red-700">
                  {urgentCount > 0 && `${urgentCount} Urgent`}
                  {urgentCount > 0 && holdCount > 0 && " \u00b7 "}
                  {holdCount > 0 && `${holdCount} Hold`}
                </span>
              </div>
              <button
                onClick={() => {
                  const el = document.querySelector('tr[data-urgent="true"]');
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                className="text-[10px] font-medium text-red-600 hover:text-red-800 underline"
              >
                Jump to first ↓
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse h-[52px] bg-gray-100 rounded" />
            ))}
          </div>
        )}

        {!loading && error && (
          <p className="text-center text-gray-400 mt-12 text-[13px]">
            Could not load orders. Retrying&hellip;
          </p>
        )}

        {!loading && !error && orders.length === 0 && (
          <p className="text-center text-gray-400 mt-12 text-[13px]">
            No mail orders received today. Orders appear here automatically as emails arrive.
          </p>
        )}

        {!loading && !error && orders.length > 0 && (
          <MailOrdersTable
            groupedOrders={groupedOrders}
            flaggedIds={flaggedIds}
            expandedId={expandedId}
            focusedId={focusedId}
            copiedId={copiedId}
            copiedCodeId={copiedCodeId}
            onFlag={handleFlag}
            onExpand={handleExpand}
            onPunch={handlePunch}
            onCopy={handleCopy}
            onSaveSoNumber={handleSaveSoNumber}
            onSaveCustomer={handleSaveCustomer}
            openCodePopoverId={openCodePopoverId}
            setOpenCodePopoverId={setOpenCodePopoverId}
          />
        )}
      </div>
    </div>
  );
}
