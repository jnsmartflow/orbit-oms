"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { fetchMailOrders, punchOrder, saveSoNumber, saveCustomer, getTodayIST, toggleLock } from "@/lib/mail-orders/api";
import { getSlotFromTime, groupOrdersBySlot, buildClipboardText, buildBatchClipboardText, BATCH_COPY_LIMIT, buildReplyTemplate, getOrderFlags, smartTitleCase, cleanSubject, isOdCiFlagged, getOrderVolume } from "@/lib/mail-orders/utils";
import type { MoOrder, MoOrderLine } from "@/lib/mail-orders/types";
import { MailOrdersTable, ALL_COLUMNS } from "./mail-orders-table";
import type { ColumnConfig } from "./mail-orders-table";
import { UniversalHeader } from "@/components/universal-header";
import { SoSummaryPanel } from "./so-summary-panel";
import { SlotCompletionModal } from "./slot-completion-modal";
import { FocusModeView } from "./focus-mode-view";
import { Check, Users } from "lucide-react";

// ── Column Picker ──────────────────────────────────────────────────────────

function ColumnPicker({
  columns,
  visible,
  onChange,
}: {
  columns: ColumnConfig[];
  visible: Set<string>;
  onChange: (v: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const toggleColumn = (key: string) => {
    const next = new Set(visible);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  const hiddenCount = columns.filter(
    c => !c.alwaysVisible && !visible.has(c.key),
  ).length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 text-[11px] font-medium border rounded-md px-2.5 h-[28px] transition-colors ${
          hiddenCount > 0
            ? "text-teal-700 border-teal-300 bg-teal-50 hover:bg-teal-100"
            : "text-gray-600 border-gray-200 hover:bg-gray-50"
        }`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="21" y1="4" x2="14" y2="4"/>
          <line x1="10" y1="4" x2="3" y2="4"/>
          <line x1="21" y1="12" x2="12" y2="12"/>
          <line x1="8" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="20" x2="16" y2="20"/>
          <line x1="12" y1="20" x2="3" y2="20"/>
          <circle cx="12" cy="4" r="2"/>
          <circle cx="10" cy="12" r="2"/>
          <circle cx="14" cy="20" r="2"/>
        </svg>
        Columns
        {hiddenCount > 0 && (
          <span className="text-[9px] bg-teal-600 text-white rounded-full w-[16px] h-[16px] flex items-center justify-center">
            {hiddenCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1.5 w-[180px]">
          {columns.map((col) => (
            <label
              key={col.key}
              className={`flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-gray-50 text-[11px] ${
                col.alwaysVisible ? "text-gray-400 cursor-default" : "text-gray-700"
              }`}
            >
              <input
                type="checkbox"
                checked={visible.has(col.key)}
                disabled={col.alwaysVisible}
                onChange={() => !col.alwaysVisible && toggleColumn(col.key)}
                className="accent-teal-600 w-3.5 h-3.5"
              />
              {col.label}
              {col.alwaysVisible && (
                <span className="text-[9px] text-gray-300 ml-auto">always</span>
              )}
            </label>
          ))}
          <div className="border-t border-gray-100 mt-1.5 pt-1.5 px-3">
            <button
              onClick={() => onChange(new Set(columns.map(c => c.key)))}
              className="text-[10px] text-gray-500 hover:text-gray-700"
            >
              Show all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function MailOrdersPage() {
  // ── State ────────────────────────────────────────────────────────────────────
  const [orders, setOrders] = useState<MoOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [headerFilters, setHeaderFilters] = useState<Record<string, string[]>>({ status: [], matchStatus: [], dispatch: [], priority: [], lock: [] });
  const flaggedIds = useMemo(
    () => new Set(orders.filter(o => o.isLocked).map(o => o.id)),
    [orders],
  );
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copiedCodeId, setCopiedCodeId] = useState<number | null>(null);
  const [copiedReplyId, setCopiedReplyId] = useState<number | null>(null);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [recentlyPunchedIds, setRecentlyPunchedIds] = useState<Set<number>>(new Set());
  const [selectedDate, setSelectedDate] = useState(() => getTodayIST());
  const [openCodePopoverId, setOpenCodePopoverId] = useState<number | null>(null);
  const [batchStates, setBatchStates] = useState<Record<number, number>>({});
  const [soSummaryOpen, setSoSummaryOpen] = useState(false);
  const [punchedVisible, setPunchedVisible] = useState(false);
  const [autoComplete, setAutoComplete] = useState(true);
  const [dismissedSlots, setDismissedSlots] = useState<Set<string>>(new Set());
  const [completedSlot, setCompletedSlot] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "focus">("table");
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    if (typeof window === "undefined") {
      return new Set(ALL_COLUMNS.map(c => c.key));
    }
    try {
      const saved = localStorage.getItem("mo-column-visibility");
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        const set = new Set(parsed);
        for (const c of ALL_COLUMNS) {
          if (c.alwaysVisible) set.add(c.key);
        }
        return set;
      }
    } catch { /* ignore */ }
    return new Set(ALL_COLUMNS.map(c => c.key));
  });

  useEffect(() => {
    localStorage.setItem(
      "mo-column-visibility",
      JSON.stringify(Array.from(visibleColumns)),
    );
  }, [visibleColumns]);

  // ── Data fetch ───────────────────────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    try {
      const data = await fetchMailOrders(selectedDate);
      setOrders(data.orders);
      setError(false);
      // Re-enable dismissed slots if new unpunched orders arrived
      setDismissedSlots(prev => {
        const next = new Set(prev);
        let changed = false;
        for (const slot of Array.from(prev)) {
          const slotOrders = data.orders.filter(
            (o: MoOrder) => getSlotFromTime(o.receivedAt) === slot
          );
          if (slotOrders.some((o: MoOrder) => o.status !== "punched")) {
            next.delete(slot);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
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
    const interval = setInterval(loadOrders, 30_000);

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        loadOrders();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadOrders]);

  // ── Slot completion detection ───────────────────────────────────────────────
  useEffect(() => {
    if (!autoComplete) return;
    if (orders.length === 0) return;

    const slots = ["Morning", "Afternoon", "Evening", "Night"];
    for (const slot of slots) {
      if (dismissedSlots.has(slot)) continue;
      if (completedSlot) continue;

      const slotOrders = orders.filter(
        o => getSlotFromTime(o.receivedAt) === slot
      );
      if (slotOrders.length === 0) continue;

      if (slotOrders.every(o => o.status === "punched")) {
        setCompletedSlot(slot);
        break;
      }
    }
  }, [orders, autoComplete, dismissedSlots, completedSlot]);

  // Reset dismissed slots on date change
  useEffect(() => {
    setDismissedSlots(new Set());
    setCompletedSlot(null);
  }, [selectedDate]);

  const handleDismissCompletion = useCallback(() => {
    if (completedSlot) {
      setDismissedSlots(prev => {
        const next = new Set(prev);
        next.add(completedSlot);
        return next;
      });
      setCompletedSlot(null);
    }
  }, [completedSlot]);

  // ── Focus mode: auto-select first slot with orders ──────────────────────────
  useEffect(() => {
    if (viewMode === "focus" && activeSlot === null && orders.length > 0) {
      const slots = ["Morning", "Afternoon", "Evening", "Night"] as const;
      for (const slot of slots) {
        if (orders.some(o => getSlotFromTime(o.receivedAt) === slot)) {
          setActiveSlot(slot);
          break;
        }
      }
    }
  }, [viewMode, activeSlot, orders]);

  // ── Derived stats ────────────────────────────────────────────────────────────
  const totalOrders = orders.length;
  const totalLines = useMemo(() => orders.reduce((s, o) => s + o.totalLines, 0), [orders]);
  const matchedLines = useMemo(() => orders.reduce((s, o) => s + o.matchedLines, 0), [orders]);
  const punchedOrders = useMemo(() => orders.filter((o) => o.status === "punched").length, [orders]);
  const totalVolume = useMemo(
    () => Math.round(orders.reduce((sum, o) => sum + getOrderVolume(o.lines), 0)),
    [orders],
  );

  // Stats-level flag counts (from ALL orders, not filtered)
  const statsUrgentCount = useMemo(
    () => orders.filter(o => o.status !== "punched" && o.dispatchPriority === "Urgent").length,
    [orders],
  );
  const statsHoldCount = useMemo(
    () => orders.filter(o => o.status !== "punched" && o.dispatchStatus === "Hold").length,
    [orders],
  );
  const blockedCount = useMemo(
    () => orders.filter(o => {
      if (o.status === "punched") return false;
      const combined = [o.remarks, o.billRemarks, o.deliveryRemarks]
        .filter(Boolean).join(' ').toLowerCase();
      return /\b(od|overdue)\b/.test(combined) ||
             /\b(ci|credit\s*(hold|block|issue))\b/.test(combined) ||
             /\bbounce\b/.test(combined);
    }).length,
    [orders],
  );

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

    // Priority filter
    const priorityArr = headerFilters.priority ?? [];
    if (priorityArr.length > 0) {
      result = result.filter((o) => {
        const p = o.dispatchPriority ?? "Normal";
        return priorityArr.includes(p);
      });
    }

    // Lock filter
    const lockArr = headerFilters.lock ?? [];
    if (lockArr.length > 0) {
      result = result.filter((o) => {
        const locked = isOdCiFlagged(o) || !!o.isLocked;
        const val = locked ? "locked" : "unlocked";
        return lockArr.includes(val);
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((o) => {
        // Order-level fields
        if (o.soName.toLowerCase().includes(q)) return true;
        if (o.soEmail?.toLowerCase().includes(q)) return true;
        if (o.customerName?.toLowerCase().includes(q)) return true;
        if (o.customerCode?.toLowerCase().includes(q)) return true;
        if (o.subject.toLowerCase().includes(q)) return true;
        if (o.soNumber?.toLowerCase().includes(q)) return true;
        if (o.remarks?.toLowerCase().includes(q)) return true;
        if (o.billRemarks?.toLowerCase().includes(q)) return true;
        if (o.deliveryRemarks?.toLowerCase().includes(q)) return true;
        if (o.customerArea?.toLowerCase().includes(q)) return true;
        if (o.customerRoute?.toLowerCase().includes(q)) return true;
        if (o.splitLabel?.toLowerCase().includes(q)) return true;
        if (o.punchedBy?.name?.toLowerCase().includes(q)) return true;

        // Line-level fields
        if (o.lines.some((l) =>
          l.rawText.toLowerCase().includes(q) ||
          l.skuCode?.toLowerCase().includes(q) ||
          l.skuDescription?.toLowerCase().includes(q) ||
          l.productName?.toLowerCase().includes(q) ||
          l.baseColour?.toLowerCase().includes(q)
        )) return true;

        // Remark-level fields
        if ((o.remarks_list ?? []).some((r) =>
          r.rawText.toLowerCase().includes(q)
        )) return true;

        return false;
      });
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
    async (id: number) => {
      const order = orders.find(o => o.id === id);
      if (!order) return;
      const newLocked = !order.isLocked;

      // Optimistic update
      setOrders(prev =>
        prev.map(o => o.id === id ? { ...o, isLocked: newLocked } : o),
      );

      if (expandedId === id) setExpandedId(null);

      try {
        await toggleLock(id, newLocked);
      } catch {
        const data = await fetchMailOrders(selectedDate);
        setOrders(data.orders);
      }
    },
    [orders, expandedId, selectedDate],
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

      // Grace period — keep in pending section for 8s
      setRecentlyPunchedIds(prev => { const next = new Set(prev); next.add(id); return next; });
      setTimeout(() => {
        setRecentlyPunchedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
      }, 8000);

      try {
        await punchOrder(id);
      } catch {
        const data = await fetchMailOrders(selectedDate);
        setOrders(data.orders);
      }
    },
    [selectedDate],
  );

  const handleCopy = useCallback((id: number, lines: MoOrderLine[], batchIndex?: number) => {
    const { text } = batchIndex !== undefined
      ? buildBatchClipboardText(lines, batchIndex)
      : { text: buildClipboardText(lines) };
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleAdvanceBatch = useCallback((orderId: number) => {
    setBatchStates(prev => {
      const current = prev[orderId] ?? 0;
      const order = orders.find(o => o.id === orderId);
      if (!order) return prev;
      const matched = order.lines.filter(l => l.matchStatus === "matched" && l.skuCode != null);
      const totalBatches = Math.ceil(matched.length / BATCH_COPY_LIMIT);
      return { ...prev, [orderId]: (current + 1) % totalBatches };
    });
  }, [orders]);

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

    // Grace period — keep in pending section for 8s
    setRecentlyPunchedIds(prev => { const next = new Set(prev); next.add(orderId); return next; });
    setTimeout(() => {
      setRecentlyPunchedIds(prev => { const next = new Set(prev); next.delete(orderId); return next; });
    }, 8000);

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
    const targetOrder = orders.find(o => o.id === orderId);
    const customerUpdate = {
      customerCode: data.customerCode,
      customerName: data.customerName,
      customerMatchStatus: "exact" as const,
      customerCandidates: null,
      customerArea: data.area ?? null,
      customerDeliveryType: data.deliveryType ?? null,
      customerRoute: data.route ?? null,
    };
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id === orderId) return { ...o, ...customerUpdate };
        // Propagate to split siblings
        if (targetOrder && (targetOrder.splitFromId || targetOrder.splitLabel) &&
            o.emailEntryId === targetOrder.emailEntryId && o.id !== orderId) {
          return { ...o, ...customerUpdate };
        }
        return o;
      }),
    );
    try {
      await saveCustomer(orderId, data);
    } catch {
      const d = await fetchMailOrders(selectedDate);
      setOrders(d.orders);
    }
  }, [selectedDate, orders]);

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
      // Esc — cascading close (works even when input focused)
      if (e.key === "Escape") {
        if (completedSlot) {
          handleDismissCompletion();
          return;
        }
        if (soSummaryOpen) {
          setSoSummaryOpen(false);
          return;
        }
        if (openCodePopoverId !== null) {
          setOpenCodePopoverId(null);
          return;
        }
        const active = document.activeElement as HTMLElement | null;
        if (active?.tagName === "INPUT") {
          active.blur();
          return;
        }
        if (expandedId !== null) {
          setExpandedId(null);
          return;
        }
        return;
      }

      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const key = e.key;

      if (key === "ArrowDown") {
        e.preventDefault();
        setFocusedId((prev) => {
          const idx = flatOrders.findIndex((o) => o.id === prev);
          if (idx < flatOrders.length - 1) return flatOrders[idx + 1].id;
          return prev;
        });
        return;
      }

      if (key === "ArrowUp") {
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

      // Q — Copy customer code
      if (key === "q" || key === "Q") {
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

      // W — Copy SKU lines
      if (key === "w" || key === "W") {
        if (focusedId !== null) {
          const order = flatOrders.find((o) => o.id === focusedId);
          if (order) {
            const matched = order.lines.filter(l => l.matchStatus === "matched" && l.skuCode != null);
            const needsBatching = matched.length > BATCH_COPY_LIMIT;
            if (needsBatching) {
              const currentBatch = batchStates[order.id] ?? 0;
              handleCopy(order.id, order.lines, currentBatch);
              handleAdvanceBatch(order.id);
            } else {
              handleCopy(order.id, order.lines);
            }
          }
        }
        return;
      }

      // E — Focus SO number input
      if (key === "e" || key === "E") {
        if (focusedId !== null) {
          const row = document.querySelector(`tr[data-order-id="${focusedId}"]`);
          if (row) {
            const input = row.querySelector('input[placeholder="SO Number"]') as HTMLInputElement | null;
            if (input) {
              e.preventDefault();
              input.focus();
              input.select();
            }
          }
        }
        return;
      }

      // R — Copy reply template
      if (key === "r" || key === "R") {
        if (focusedId !== null) {
          const order = flatOrders.find(o => o.id === focusedId);
          if (order && order.status === "punched" && order.soNumber) {
            const name = smartTitleCase(
              order.customerMatchStatus === "exact" && order.customerName
                ? order.customerName
                : cleanSubject(order.subject)
            ) + (order.splitLabel ? ` (${order.splitLabel})` : "");

            const template = buildReplyTemplate(
              order.soName,
              [{
                customerName: name,
                customerCode: order.customerCode ?? null,
                area: order.customerArea ?? null,
                soNumber: order.soNumber,
                flags: getOrderFlags(order),
              }]
            );

            navigator.clipboard.writeText(template);
            setCopiedReplyId(focusedId);
            setTimeout(() => setCopiedReplyId(null), 2000);
          }
        }
        return;
      }

      // F — Toggle flag/lock
      if (key === "f" || key === "F") {
        if (focusedId !== null) {
          handleFlag(focusedId);
        }
        return;
      }

      // A — Open SO Summary panel
      if (key === "a" || key === "A") {
        e.preventDefault();
        setSoSummaryOpen(true);
        return;
      }

      // / — Focus search box
      if (key === "/") {
        e.preventDefault();
        const searchInput = document.querySelector(
          'input[placeholder="Search orders..."]',
        ) as HTMLInputElement | null;
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // N — Jump to next unmatched order
      if (key === "n" || key === "N") {
        e.preventDefault();
        const currentIdx = flatOrders.findIndex(o => o.id === focusedId);
        const startIdx = currentIdx >= 0 ? currentIdx + 1 : 0;
        for (let i = 0; i < flatOrders.length; i++) {
          const idx = (startIdx + i) % flatOrders.length;
          const order = flatOrders[idx];
          if (order.matchedLines < order.totalLines) {
            setFocusedId(order.id);
            setExpandedId(order.id);
            break;
          }
        }
        return;
      }

      // P — Pick customer / open code popover
      if (key === "p" || key === "P") {
        if (focusedId !== null) {
          setOpenCodePopoverId(openCodePopoverId === focusedId ? null : focusedId);
        }
        return;
      }

      // T — Toggle punched visibility
      if (key === "t" || key === "T") {
        e.preventDefault();
        setPunchedVisible(prev => !prev);
        return;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [flatOrders, focusedId, expandedId, handleExpand, handleCopy, handleAdvanceBatch, handleFlag, batchStates, openCodePopoverId, soSummaryOpen, copiedReplyId, completedSlot, handleDismissCompletion]);

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
          { label: "punched", value: punchedOrders },
          { label: "pending", value: totalOrders - punchedOrders },
        ]}
        segments={headerSegments}
        activeSegment={activeSlot}
        onSegmentChange={(id) => setActiveSlot(id as string | null)}
        filterGroups={[
          { label: "Status", key: "status", options: [{ value: "pending", label: "Pending" }, { value: "punched", label: "Punched" }] },
          { label: "Match", key: "matchStatus", options: [{ value: "exact", label: "Matched" }, { value: "multiple", label: "Multiple" }, { value: "unmatched", label: "Unmatched" }] },
          { label: "Dispatch", key: "dispatch", options: [{ value: "Hold", label: "Hold" }, { value: "Dispatch", label: "Dispatch" }] },
          { label: "Priority", key: "priority", options: [{ value: "Urgent", label: "Urgent" }, { value: "Normal", label: "Normal" }] },
          { label: "Lock", key: "lock", options: [{ value: "locked", label: "Locked" }, { value: "unlocked", label: "Unlocked" }] },
        ]}
        activeFilters={headerFilters}
        onFilterChange={setHeaderFilters}
        currentDate={headerDate}
        onDateChange={handleHeaderDateChange}
        searchPlaceholder="Search orders..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        rightExtra={
          <div className="flex items-center gap-1.5">
            <div className="flex border border-gray-200 rounded-md overflow-hidden">
              <button
                onClick={() => setViewMode("table")}
                className={`text-[10px] font-medium px-2 h-[28px] transition-colors ${
                  viewMode === "table"
                    ? "bg-teal-600 text-white"
                    : "bg-white text-gray-500 hover:bg-gray-50"
                }`}
              >
                Table
              </button>
              <button
                onClick={() => setViewMode("focus")}
                className={`text-[10px] font-medium px-2 h-[28px] transition-colors ${
                  viewMode === "focus"
                    ? "bg-teal-600 text-white"
                    : "bg-white text-gray-500 hover:bg-gray-50"
                }`}
              >
                Focus
              </button>
            </div>
            <button
              onClick={() => setAutoComplete(prev => !prev)}
              className={`text-[10px] font-medium border rounded-md px-2 h-[28px] transition-colors ${
                autoComplete
                  ? "text-teal-700 border-teal-300 bg-teal-50"
                  : "text-gray-500 border-gray-200 hover:bg-gray-50"
              }`}
              title={autoComplete
                ? "Auto-popup on slot completion (click to disable)"
                : "Manual mode (click to enable auto-popup)"
              }
            >
              {autoComplete ? "Auto \u2713" : "Auto"}
            </button>
            <ColumnPicker
              columns={ALL_COLUMNS}
              visible={visibleColumns}
              onChange={setVisibleColumns}
            />
            <button
              onClick={() => setSoSummaryOpen(true)}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-600 border border-gray-200 rounded-md px-2.5 h-[28px] hover:bg-gray-50 transition-colors"
            >
              <Users size={12} />
              SO Summary
            </button>
          </div>
        }
        shortcuts={[
          { key: "Q", label: "Copy code" },
          { key: "W", label: "Copy SKUs" },
          { key: "E", label: "Enter SO no." },
          { key: "R", label: "Copy reply" },
          { key: "F", label: "Flag/lock" },
          { key: "N", label: "Next unmatched" },
          { key: "P", label: "Pick customer" },
          { key: "T", label: "Toggle punched" },
          { key: "/", label: "Search" },
          { key: "A", label: "SO Summary" },
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

        {!loading && !error && orders.length > 0 && viewMode === "table" && (
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
            batchStates={batchStates}
            onAdvanceBatch={handleAdvanceBatch}
            onSplitComplete={loadOrders}
            visibleColumns={visibleColumns}
            recentlyPunchedIds={recentlyPunchedIds}
            separatePunched={activeSlot !== null}
            punchedVisible={punchedVisible}
            onTogglePunched={() => setPunchedVisible(prev => !prev)}
          />
        )}

        {!loading && !error && orders.length > 0 && viewMode === "focus" && (
          <FocusModeView
            orders={orders}
            activeSlot={activeSlot}
            flaggedIds={flaggedIds}
            onFlag={handleFlag}
            onSaveSoNumber={handleSaveSoNumber}
            onCopy={handleCopy}
            batchStates={batchStates}
            onAdvanceBatch={handleAdvanceBatch}
          />
        )}
      </div>

      <SoSummaryPanel
        orders={filteredOrders}
        open={soSummaryOpen}
        onClose={() => setSoSummaryOpen(false)}
      />

      {completedSlot && (
        <SlotCompletionModal
          slot={completedSlot}
          orders={orders.filter(
            o => getSlotFromTime(o.receivedAt) === completedSlot
          )}
          onDismiss={handleDismissCompletion}
        />
      )}

      {copiedReplyId !== null && (() => {
        const order = orders.find(o => o.id === copiedReplyId);
        if (!order) return null;
        const name = smartTitleCase(
          order.customerMatchStatus === "exact" && order.customerName
            ? order.customerName
            : cleanSubject(order.subject)
        );
        return (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-gray-800 text-white text-[12px] px-4 py-2 rounded-lg shadow-lg">
            <Check size={13} className="text-green-400" />
            <span>Reply copied — <strong>{name} · SO {order.soNumber}</strong></span>
          </div>
        );
      })()}
    </div>
  );
}
