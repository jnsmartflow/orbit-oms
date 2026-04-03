"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Search, SlidersHorizontal, Keyboard } from "lucide-react";
import { fetchMailOrders, punchOrder, saveSoNumber, getTodayIST } from "@/lib/mail-orders/api";
import { getSlotFromTime, groupOrdersBySlot, buildClipboardText } from "@/lib/mail-orders/utils";
import type { MoOrder, MoOrderLine } from "@/lib/mail-orders/types";
import { MailOrdersTable } from "./mail-orders-table";

const SLOTS = ["All", "Morning", "Afternoon", "Evening", "Night"] as const;
type SlotFilter = (typeof SLOTS)[number];

export default function MailOrdersPage() {
  // ── State ────────────────────────────────────────────────────────────────────
  const [orders, setOrders] = useState<MoOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeSlot, setActiveSlot] = useState<SlotFilter>("All");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "punched">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" }),
  );
  const [flaggedIds, setFlaggedIds] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => getTodayIST());
  const [showDateDropdown, setShowDateDropdown] = useState(false);

  const shortcutsRef = useRef<HTMLDivElement>(null);
  const datePickerRef = useRef<HTMLDivElement>(null);

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

  // ── Clock ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // ── Close shortcuts on outside click ─────────────────────────────────────────
  useEffect(() => {
    if (!showShortcuts) return;
    function handleClick(e: MouseEvent) {
      if (shortcutsRef.current && !shortcutsRef.current.contains(e.target as Node)) {
        setShowShortcuts(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showShortcuts]);

  // ── Close date dropdown on outside click ──────────────────────────────────────
  useEffect(() => {
    if (!showDateDropdown) return;
    function handleClick(e: MouseEvent) {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setShowDateDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDateDropdown]);

  // ── Date helpers ─────────────────────────────────────────────────────────────
  const todayIST = getTodayIST();

  function shiftDate(dateStr: string, days: number): string {
    const d = new Date(dateStr + "T00:00:00+05:30");
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  }

  const yesterdayIST = shiftDate(todayIST, -1);

  function formatDateLabel(dateStr: string): string {
    if (dateStr === todayIST) return "Today";
    if (dateStr === yesterdayIST) return "Yesterday";
    return new Date(dateStr + "T00:00:00+05:30").toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      timeZone: "Asia/Kolkata",
    });
  }

  const isToday = selectedDate === todayIST;
  const dateLabel = formatDateLabel(selectedDate);

  // ── Derived stats ────────────────────────────────────────────────────────────
  const totalOrders = orders.length;
  const totalLines = useMemo(() => orders.reduce((s, o) => s + o.totalLines, 0), [orders]);
  const matchedLines = useMemo(() => orders.reduce((s, o) => s + o.matchedLines, 0), [orders]);
  const punchedOrders = useMemo(() => orders.filter((o) => o.status === "punched").length, [orders]);

  // ── Filtered orders ──────────────────────────────────────────────────────────
  const filteredOrders = useMemo(() => {
    let result = orders;

    if (statusFilter !== "all") {
      result = result.filter((o) => o.status === statusFilter);
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

    if (activeSlot !== "All") {
      result = result.filter((o) => getSlotFromTime(o.receivedAt) === activeSlot);
    }

    return result;
  }, [orders, statusFilter, searchQuery, activeSlot]);

  const groupedOrders = useMemo(() => groupOrdersBySlot(filteredOrders), [filteredOrders]);

  // ── Slot counts (from filtered-by-status-and-search, before slot filter) ────
  const slotCounts = useMemo(() => {
    let base = orders;
    if (statusFilter !== "all") {
      base = base.filter((o) => o.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      base = base.filter(
        (o) =>
          o.soName.toLowerCase().includes(q) ||
          o.customerName?.toLowerCase().includes(q) ||
          o.subject.toLowerCase().includes(q),
      );
    }
    const counts: Record<string, number> = {
      Morning: 0,
      Afternoon: 0,
      Evening: 0,
      Night: 0,
    };
    for (const o of base) {
      const slot = getSlotFromTime(o.receivedAt);
      counts[slot]++;
    }
    return counts;
  }, [orders, statusFilter, searchQuery]);

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
          if (order) handleCopy(focusedId, order.lines);
        }
        return;
      }

      if (key === "d" || key === "D") {
        if (focusedId !== null) {
          const order = flatOrders.find((o) => o.id === focusedId);
          if (order && !flaggedIds.has(focusedId) && order.status !== "punched") {
            handlePunch(focusedId);
          }
        }
        return;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [flatOrders, focusedId, flaggedIds, handleExpand, handleCopy, handlePunch]);

  // ── Auto-scroll focused row into view ───────────────────────────────────────
  useEffect(() => {
    if (focusedId !== null) {
      document
        .querySelector(`tr[data-order-id="${focusedId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [focusedId]);

  // ── Match rate warning threshold ─────────────────────────────────────────────
  const matchRateWarn = totalLines > 0 && matchedLines < totalLines * 0.95;

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
      {/* ── Row 1 ──────────────────────────────────────────────────────────────── */}
      <div className="h-[42px] min-h-[42px] sticky top-0 z-40 bg-white border-b border-gray-200 flex items-center justify-between px-4">
        {/* Left: title + stats */}
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-[14px] font-semibold text-gray-900">
            Mail Orders{!isToday && ` · ${new Date(selectedDate + "T00:00:00+05:30").toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })}`}
          </span>
          <span className="text-gray-400 ml-1">
            <span className="text-gray-900 font-semibold">{totalOrders}</span> orders
            <span className="text-gray-400 mx-1">&middot;</span>
            <span className={matchRateWarn ? "text-amber-600 font-semibold" : "text-gray-900 font-semibold"}>
              {matchedLines}
            </span>
            <span className={matchRateWarn ? "text-amber-600" : "text-gray-400"}>/{totalLines} lines</span>
            <span className="text-gray-400 mx-1">&middot;</span>
            <span className="text-gray-900 font-semibold">{punchedOrders}</span>
            /{totalOrders} punched
          </span>
        </div>

        {/* Right: shortcuts + clock */}
        <div className="flex items-center gap-3">
          <div className="relative" ref={shortcutsRef}>
            <button
              onClick={() => setShowShortcuts((v) => !v)}
              className="inline-flex items-center gap-1 border border-gray-200 rounded px-2 h-[22px] text-[10.5px] text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-colors"
            >
              <Keyboard className="w-3 h-3" />
              Shortcuts
            </button>
            {showShortcuts && (
              <div className="absolute right-0 top-[30px] z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-[196px]">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                  Keyboard shortcuts
                </p>
                {[
                  ["C", "Copy to clipboard"],
                  ["D", "Mark punched"],
                  ["\u2193", "Next order"],
                  ["\u2191", "Previous order"],
                  ["\u21B5", "Expand / collapse"],
                ].map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between py-1">
                    <span className="text-[11px] text-gray-500">{label}</span>
                    <kbd className="text-[10px] font-mono bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 text-gray-500">
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
            )}
          </div>
          <span suppressHydrationWarning className="font-mono text-[12px] text-gray-400">{clock}</span>
        </div>
      </div>

      {/* ── Row 2 ──────────────────────────────────────────────────────────────── */}
      <div className="h-[36px] min-h-[36px] sticky top-[42px] z-40 bg-white border-b border-gray-200 flex items-center justify-between px-4">
        {/* Left: slot pills */}
        <div className="flex items-center gap-1.5">
          {SLOTS.map((slot) => {
            const isActive = activeSlot === slot;
            const count = slot === "All"
              ? (slotCounts.Morning + slotCounts.Afternoon + slotCounts.Evening + slotCounts.Night)
              : (slotCounts[slot] ?? 0);
            return (
              <button
                key={slot}
                onClick={() => setActiveSlot(slot)}
                className={`inline-flex items-center gap-1 border rounded-md text-[11px] px-2.5 h-[26px] transition-colors ${
                  isActive
                    ? "border-gray-900 text-gray-900 font-medium"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                {slot}
                <span className={isActive ? "text-gray-900" : "text-gray-400"}>({count})</span>
              </button>
            );
          })}
        </div>

        {/* Right: search + filter */}
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center border border-gray-200 rounded-md h-[26px] px-2 gap-1.5">
            <Search className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <input
              type="text"
              placeholder="Search orders\u2026"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border-none outline-none bg-transparent text-[11px] text-gray-700 placeholder:text-gray-400 w-[120px]"
            />
          </div>
          {/* Date picker */}
          <div className="relative inline-flex items-center gap-1" ref={datePickerRef}>
            <button
              onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
              className="inline-flex items-center justify-center border border-gray-200 rounded-md h-[26px] w-[24px] text-gray-400 hover:text-gray-700 hover:border-gray-300 transition-colors text-[13px]"
            >
              ‹
            </button>
            <button
              onClick={() => setShowDateDropdown((v) => !v)}
              className={`inline-flex items-center border rounded-md text-[11px] font-medium px-2.5 h-[26px] transition-colors ${
                isToday
                  ? "border-gray-200 text-gray-600"
                  : "border-gray-900 text-gray-900"
              }`}
            >
              {dateLabel} ▾
            </button>
            <button
              disabled={isToday}
              onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}
              className={`inline-flex items-center justify-center border rounded-md h-[26px] w-[24px] transition-colors text-[13px] ${
                isToday
                  ? "border-gray-100 text-gray-200 cursor-not-allowed"
                  : "border-gray-200 text-gray-400 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              ›
            </button>
            {showDateDropdown && (
              <div className="absolute right-0 top-[30px] z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-[130px]">
                <button
                  onClick={() => { setSelectedDate(todayIST); setShowDateDropdown(false); }}
                  className={`block w-full text-left text-[11px] px-3 py-1.5 rounded hover:bg-gray-50 ${
                    isToday ? "font-semibold text-gray-900" : "text-gray-600"
                  }`}
                >
                  Today
                </button>
                <button
                  onClick={() => { setSelectedDate(yesterdayIST); setShowDateDropdown(false); }}
                  className={`block w-full text-left text-[11px] px-3 py-1.5 rounded hover:bg-gray-50 ${
                    selectedDate === yesterdayIST ? "font-semibold text-gray-900" : "text-gray-600"
                  }`}
                >
                  Yesterday
                </button>
              </div>
            )}
          </div>

          <button className="inline-flex items-center gap-1 border border-gray-200 rounded-md text-[11px] text-gray-600 px-2 h-[26px] hover:border-gray-300 transition-colors">
            <SlidersHorizontal className="w-3 h-3" />
            Filter
          </button>
        </div>
      </div>

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
            onFlag={handleFlag}
            onExpand={handleExpand}
            onPunch={handlePunch}
            onCopy={handleCopy}
            onSaveSoNumber={handleSaveSoNumber}
          />
        )}
      </div>
    </div>
  );
}
