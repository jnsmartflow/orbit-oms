"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
// `fetchSlotCutoffs` is NO LONGER IMPORTED (2026-08-10) — the call left the 30s
// cycle. The helper stays exported in lib/mail-orders/api.ts with no caller.
import { fetchMailOrders, punchOrder, saveSoNumber, saveCustomer, getTodayIST, toggleLock, learnCustomer } from "@/lib/mail-orders/api";
import { getSlotFromTime, groupOrdersBySlot, buildClipboardText, buildBatchClipboardText, BATCH_COPY_LIMIT, buildReplyTemplate, getOrderFlags, getBillLabel, getSplitDisplayLabel, smartTitleCase, cleanSubject, isOdCiFlagged, getOrderVolume } from "@/lib/mail-orders/utils";
import type { SlotCutoffs } from "@/lib/mail-orders/utils";
import type { MoOrder, MoOrderLine } from "@/lib/mail-orders/types";
import { MailOrdersTable, ALL_COLUMNS } from "./mail-orders-table";
import type { ColumnConfig } from "./mail-orders-table";
import { UniversalHeader } from "@/components/universal-header";
import { useSession } from "next-auth/react";
import { ReviewView } from "./review-view";
import { TutorialOverlay } from "./tutorial-overlay";
import { Check, Copy } from "lucide-react";
import { useBillingV2 } from "@/components/billing/billing-v2-provider";
import { useInitialNotesFontSize } from "@/components/mail-orders/notes-font-size-provider";
import type { BillingTab } from "@/components/billing/billing-tab-bar";
import { HeaderFilter } from "@/components/header-filter";
import { HeaderDateStepper } from "@/components/header-date-stepper";
import { HeaderShortcuts } from "@/components/header-shortcuts";

// The six header filter groups. Hoisted out of the JSX 2026-07-31 so the header
// and the Billing tab row render the SAME array rather than two literals that
// drift. Values are unchanged from the inline version.
const MO_FILTER_GROUPS = [
  { label: "Status", key: "status", options: [{ value: "pending", label: "Pending" }, { value: "punched", label: "Punched" }] },
  { label: "Match", key: "matchStatus", options: [{ value: "exact", label: "Matched" }, { value: "multiple", label: "Multiple" }, { value: "unmatched", label: "Unmatched" }] },
  { label: "Dispatch", key: "dispatch", options: [{ value: "Hold", label: "Hold" }, { value: "Dispatch", label: "Dispatch" }] },
  { label: "Priority", key: "priority", options: [{ value: "Urgent", label: "Urgent" }, { value: "Normal", label: "Normal" }] },
  { label: "Lock", key: "lock", options: [{ value: "locked", label: "Locked" }, { value: "unlocked", label: "Unlocked" }] },
  { label: "Dealer", key: "keyDealer", options: [{ value: "key", label: "Key" }] },
];

// This page's extra shortcut rows. Hoisted out of the JSX 2026-08-01 for the
// same reason MO_FILTER_GROUPS was: the header's shortcuts popover and the
// Billing tab row's copy render the SAME array rather than two literals that
// drift. Values unchanged from the inline version.
const MO_SHORTCUTS = [
  { key: "Ctrl+C", label: "Smart copy" },
  { key: "Ctrl+V", label: "Paste SO" },
  { key: "E", label: "Slot email" },
  { key: "R", label: "Reply" },
  { key: "F", label: "Flag" },
  { key: "N", label: "Next unmatched" },
];

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
  const { data: session } = useSession();
  const canImportOBDs = ["admin", "dispatcher", "support", "billing_operator", "tint_manager", "operation_manager", "operations"]
    .includes(session?.user?.role ?? "");

  // ── State ────────────────────────────────────────────────────────────────────
  const [orders, setOrders] = useState<MoOrder[]>([]);
  // Tag visibility (Feature B) — keys turned OFF; threaded into signal builders.
  const [disabledTagKeys, setDisabledTagKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [headerFilters, setHeaderFilters] = useState<Record<string, string[]>>({ status: [], matchStatus: [], dispatch: [], priority: [], lock: [], keyDealer: [] });
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
  const [punchedVisible, setPunchedVisible] = useState(false);
  const [skuPanelOrderId, setSkuPanelOrderId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "focus">("focus");
  // ⚠ DELIBERATELY NEVER POPULATED (2026-08-10). The /api/system-config/slot-cutoffs
  // fetch was removed from the 30s cycle once the last live reader outside the
  // legacy 5-slot paths went (the `E` shortcut + the slot modal).
  //
  // The declaration STAYS so every legacy-path line below is byte-identical and
  // still restorable by flipping billing_settings.rolloutStage. Those lines call
  // getSlotFromTime(receivedAt, slotCutoffs) with `undefined`, which takes the
  // hardcoded fallbacks in lib/mail-orders/utils.ts:100-103 (630/750/1020/1200
  // = 10:30 / 12:30 / 17:00 / 20:00).
  //
  // Verified 2026-08-10 by read-only SELECT: all four live `system_config` rows
  // hold EXACTLY those values, so restoring the legacy view today behaves
  // identically. ⚠ The one real consequence: a FUTURE edit to a cutoff in admin
  // settings would no longer reach this page. Re-add the fetch if that path is
  // ever brought back into use.
  const [slotCutoffs] = useState<SlotCutoffs | undefined>(undefined);
  // ── Billing v2 rollout ──────────────────────────────────────────────────────
  // Flag resolved server-side once (layout.tsx) and couriered down. The tab bar
  // itself lives at the top of ReviewView's RIGHT PANE — Floor Control's
  // structure — so this page only OWNS the state and hands it down; it renders
  // no billing chrome of its own. State lives here rather than inside
  // ReviewView so the chosen tab survives that component re-mounting.
  // `billingTab` is not persisted: a reload lands back on Orders.
  const billingV2 = useBillingV2();
  const [billingTab, setBillingTab] = useState<BillingTab>("orders");
  // ── Notes-band text size (per user, px) ─────────────────────────────────────
  // Seeded from the value the layout resolved server-side for THIS user, so the
  // band paints at the stored size on first frame — no default-then-snap flash.
  // Owned here rather than in ReviewView so it survives that component
  // re-mounting, same reason billingTab lives here.
  const initialNotesFontSize = useInitialNotesFontSize();
  const [notesFontSize, setNotesFontSize] = useState<number>(initialNotesFontSize);
  // ── Smart copy state (Ctrl+C workflow for SAP) ──────────────────────────────
  const [smartCopyOrderId, setSmartCopyOrderId] = useState<number | null>(null);
  const [smartCopyLineIdx, setSmartCopyLineIdx] = useState(0);
  const [copyToast, setCopyToast] = useState<{ text: string; type: "customer" | "sku" | "error" } | null>(null);
  const copyToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
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
      // ONE request per cycle now. `fetchSlotCutoffs()` rode this same
      // Promise.all — 393 calls on 2026-08-09, exactly matching this route's
      // count — and was REMOVED 2026-08-10 once its last live reader went (see
      // the `slotCutoffs` declaration for the full reasoning and the caveat).
      const data = await fetchMailOrders(selectedDate);
      setOrders(data.orders);
      setDisabledTagKeys(new Set(data.disabledTags ?? []));
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

  // ── Auto logout at midnight IST ───────────────────────────────────────────
  useEffect(() => {
    function getMillisToMidnightIST(): number {
      const now = new Date();
      const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const midnight = new Date(istNow);
      midnight.setHours(24, 0, 0, 0);
      return midnight.getTime() - istNow.getTime();
    }

    const timeout = setTimeout(() => {
      window.location.href = "/api/auth/signout?callbackUrl=/login";
    }, getMillisToMidnightIST());

    return () => clearTimeout(timeout);
  }, []);

  // ── Slot summary email — FULLY REMOVED FROM THIS PAGE ───────────────────────
  //
  // Two passes, both 2026-08-10:
  //   1. The timed AUTO-trigger went — a 60s client-side interval that opened the
  //      slot-summary modal by itself ~15 min past each cutoff. With it went
  //      `autoComplete` (a `useState(true)` that never had a writer) and
  //      `dismissedSlots` (which only stopped a dismissed pop-up returning).
  //   2. The MANUAL path went too — the `E` shortcut, the <SlotCompletionModal>
  //      render, `completedSlot`, `handleDismissCompletion`, and the Esc branch
  //      that closed it.
  //
  // Nothing was ever SENT by any of this. The modal made zero network calls; its
  // "Send" button copied HTML to the clipboard and opened a `mailto:` with an
  // EMPTY To: field, so a human addressed and sent every summary by hand. No
  // outgoing email stopped when this was removed, and no data changed.
  //
  // The write-only localStorage key `mo-slot-email-sent-{date}-{slot}` has no
  // reader left either; existing keys in operators' browsers are inert orphans.
  //
  // ORPHANED, left on disk per CORE §3: slot-completion-modal.tsx, and
  // lib/mail-orders/email-template.ts's buildSlotSummaryHTML — whose only other
  // caller, components/mail-orders/so-email-panel.tsx, was already orphaned.

  // ── Focus mode: auto-select first slot with orders ──────────────────────────
  useEffect(() => {
    // Billing face: never auto-pick a slot. Without this the list would still be
    // narrowed to one slot on load even though the slot row is not rendered —
    // a filter the operator can see the effect of but not the control for.
    // `activeSlot` stays null, which is what makes the list flat.
    if (billingV2) return;
    if (viewMode === "focus" && activeSlot === null && orders.length > 0) {
      const slots = ["Morning", "Afternoon", "Evening", "Late Evening", "Night"] as const;
      for (const slot of slots) {
        if (orders.some(o => getSlotFromTime(o.receivedAt, slotCutoffs) === slot)) {
          setActiveSlot(slot);
          break;
        }
      }
    }
  }, [viewMode, activeSlot, orders, slotCutoffs, billingV2]);

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

    // Key dealer filter
    if (headerFilters.keyDealer?.includes("key")) {
      result = result.filter((o) => o.isKeyCustomer);
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

    // Billing face: one flat list for the whole date — the slot narrowing is
    // bypassed, not removed. Belt to the auto-select guard's braces: even if
    // something set `activeSlot`, this keeps the list flat while the slot row is
    // hidden. Header filters and the 19-field search above are UNAFFECTED.
    if (!billingV2 && activeSlot) {
      result = result.filter((o) => getSlotFromTime(o.receivedAt, slotCutoffs) === activeSlot);
    }

    return result;
  }, [orders, headerFilters, searchQuery, activeSlot, slotCutoffs, billingV2]);

  const groupedOrders = useMemo(() => groupOrdersBySlot(filteredOrders, slotCutoffs), [filteredOrders, slotCutoffs]);

  // Is any header filter narrowing the list? Read-only derivation over the
  // SAME `headerFilters` object the filter block above consumes, so the two
  // cannot disagree about whether a filter is on. Sent to ReviewView, which
  // uses it (with `searchQuery`, which it already has) to tell "nothing came
  // in" apart from "your filter hid it" in the billing empty states.
  // `activeSlot` is deliberately NOT counted: on the billing face it is always
  // null and its row is not rendered, so it can never be the cause.
  const hasHeaderFilter = useMemo(
    () => Object.values(headerFilters).some((vals) => (vals?.length ?? 0) > 0),
    [headerFilters],
  );

  // ── Slot counts (from all orders, before slot filter) ───────────────────────
  const slotCounts = useMemo(() => {
    const counts: Record<string, number> = { Morning: 0, Afternoon: 0, Evening: 0, "Late Evening": 0, Night: 0 };
    for (const o of orders) {
      const slot = getSlotFromTime(o.receivedAt, slotCutoffs);
      counts[slot]++;
    }
    return counts;
  }, [orders, slotCutoffs]);

  // ── Focus first pending order after fetch ─────────────────────────────────────
  useEffect(() => {
    if (orders.length > 0 && focusedId === null) {
      const firstPending = orders.find((o) => o.status === "pending");
      if (firstPending) setFocusedId(firstPending.id);
    }
  }, [orders, focusedId]);

  // ── Smart copy: reset when focus moves to a different order ──────────────────
  useEffect(() => {
    if (focusedId !== null && smartCopyOrderId !== null && focusedId !== smartCopyOrderId) {
      setSmartCopyOrderId(null);
      setSmartCopyLineIdx(0);
    }
  }, [focusedId, smartCopyOrderId]);

  const showCopyToast = useCallback((text: string, type: "customer" | "sku" | "error") => {
    if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
    setCopyToast({ text, type });
    copyToastTimer.current = setTimeout(() => setCopyToast(null), 1500);
  }, []);

  // ── Notes-band size: optimistic write ───────────────────────────────────────
  // The band repaints on the click, then the POST follows. A stepper that waited
  // for a round trip before moving would feel broken on a depot connection, and
  // the operator is already looking at the text they are resizing.
  //
  // On failure the state goes BACK to the value it had before this click — not
  // to the default — and the existing copy-toast channel reports it, so a
  // silent no-save is impossible. `prev` is captured from state rather than
  // inside a setState updater on purpose: an updater runs twice under StrictMode
  // in dev, which would capture the already-updated value and make the revert a
  // no-op.
  const handleNotesFontSizeChange = useCallback(async (size: number) => {
    const prev = notesFontSize;
    setNotesFontSize(size);
    try {
      const res = await fetch("/api/user/notes-font-size", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setNotesFontSize(prev);
      showCopyToast("Couldn't save text size", "error");
    }
  }, [notesFontSize, showCopyToast]);

  // ── Smart copy: flash cell helper ───────────────────────────────────────────
  const flashCell = useCallback((orderId: number, cellType: "code" | "sku") => {
    const row = document.querySelector(`tr[data-order-id="${orderId}"]`);
    if (!row) return;
    // Code cell is the td containing font-mono code span, SKU cell contains the copy button
    const selector = cellType === "code"
      ? 'td[data-cell="code"]'
      : 'td[data-cell="sku"]';
    const td = row.querySelector(selector);
    if (!td) return;
    const cls = cellType === "code" ? "smart-copy-flash-green" : "smart-copy-flash-blue";
    td.classList.add(cls);
    setTimeout(() => td.classList.remove(cls), 400);
  }, []);

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

  // `opts.isEdit` — correcting the number on an ALREADY-PUNCHED order, rather
  // than punching it for the first time. Optional and default-false, so every
  // existing caller (Table view included) keeps today's exact behaviour.
  //
  // Two things are skipped on an edit, and both are the SAME bug seen twice:
  //
  //   1. The status/punchedAt write. `status: "punched"` is a no-op — the order
  //      already is — but `punchedAt: now` is NOT: it would silently restamp the
  //      punch time to the moment of the correction, so the ribbon's "punched by
  //      X HH:MM" would start lying about when the work was done.
  //
  //   2. The grace add. That 8-second window exists so a row does not vanish
  //      from under the operator as it moves pending → done. An edit moves
  //      nothing — the row is already in the done group — so adding the id here
  //      YANKS IT BACK into the pending list for 8s and then drops it again.
  //      That bounce was the reported bug. On the billing face it also made
  //      `pendingOrders` briefly non-empty, which tripped the effect that clears
  //      `reopenedPunchedId` and flipped the right pane to "All caught up"
  //      mid-edit.
  //
  // The SERVER call below is identical on both paths: an edit still writes the
  // number through the same `saveSoNumber`. Only the local optimism differs.
  const handleSaveSoNumber = useCallback(async (
    orderId: number,
    value: string,
    opts?: { isEdit?: boolean },
  ) => {
    if (!/^\d{10}$/.test(value)) return false;
    const isEdit = opts?.isEdit === true;

    // Optimistic update — set soNumber, and on a FRESH punch also auto-punch
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? {
        ...o,
        soNumber: value,
        ...(isEdit ? {} : {
          status: "punched" as const,
          punchedAt: new Date().toISOString(),
        }),
      } : o)),
    );

    // Grace period — keep in pending section for 8s. FRESH PUNCH ONLY.
    if (!isEdit) {
      setRecentlyPunchedIds(prev => { const next = new Set(prev); next.add(orderId); return next; });
      setTimeout(() => {
        setRecentlyPunchedIds(prev => { const next = new Set(prev); next.delete(orderId); return next; });
      }, 8000);
    }

    try {
      await saveSoNumber(orderId, value);
      return true;
    } catch {
      const data = await fetchMailOrders(selectedDate);
      setOrders(data.orders);
      return false;
    }
  }, [selectedDate]);

  const handleSplitComplete = useCallback(async (orderAId: number) => {
    // Optimistically focus Group A immediately so the user sees
    // the split has happened (ReviewView will render it once data
    // arrives)
    setFocusedId(orderAId);

    // Poll for the split to become visible — Supabase pooler
    // eventual consistency. Max 5 attempts × 400ms = 2s worst case.
    const MAX_ATTEMPTS = 5;
    const DELAY_MS = 400;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const data = await fetchMailOrders(selectedDate);
        // Check if Group B exists yet (splitFromId === orderAId)
        // OR if Group A is now labelled "A"
        const groupA = data.orders.find(
          (o: MoOrder) => o.id === orderAId && o.splitLabel === "A",
        );
        const groupB = data.orders.find(
          (o: MoOrder) => o.splitFromId === orderAId && o.splitLabel === "B",
        );

        if (groupA && groupB) {
          // Split is visible. Update state and stop polling.
          setOrders(data.orders);
          return;
        }
      } catch (err) {
        console.error("[mail-orders] split refresh poll error:", err);
      }

      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }

    // Fallback: if split never appeared after 2s, fall back to
    // regular loadOrders which will eventually settle.
    console.warn("[mail-orders] split not visible after retries, falling back to loadOrders");
    await loadOrders();
  }, [selectedDate, loadOrders]);

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
      // Fire-and-forget: teach the learned customer engine
      if (
        targetOrder &&
        (targetOrder.customerMatchStatus === "unmatched" ||
          targetOrder.customerMatchStatus === "multiple")
      ) {
        learnCustomer(orderId, data.customerCode);
      }
    } catch {
      const d = await fetchMailOrders(selectedDate);
      setOrders(d.orders);
    }
  }, [selectedDate, orders]);

  // ── Flat order list for keyboard navigation ──────────────────────────────────
  // Walks `filteredOrders` in ITS OWN order — the list the page already has,
  // after the header filters and the 19-field search. No slot input, no sort.
  //
  // It used to walk `groupedOrders` slot-by-slot, which made the cursor order a
  // function of the slot cutoffs (a network value) rather than of the list on
  // screen. That coupling is gone: `slotCutoffs` is no longer an input here.
  //
  // Only VISIBLE rows — punched orders hidden behind the collapsed divider are
  // skipped, exactly as before (same predicate, unchanged).
  //
  // ⚠ ONE BEHAVIOUR CHANGE, and it lands only on the legacy 5-slot Table view:
  // there the rows are still RENDERED as slot sections (MailOrdersTable reads
  // `groupedOrders`), so ↑/↓ and `N` now step in list order rather than in
  // section order. That path is unreachable while billing_settings.rolloutStage
  // is ALL_USERS. Flagged rather than branched — say the word and this becomes a
  // one-line ternary on `viewMode`.
  const separatePunched = activeSlot !== null;
  const flatOrders = useMemo(
    () =>
      filteredOrders.filter(
        (o) =>
          !(
            separatePunched &&
            !punchedVisible &&
            o.status === "punched" &&
            !recentlyPunchedIds.has(o.id)
          ),
      ),
    [filteredOrders, separatePunched, punchedVisible, recentlyPunchedIds],
  );

  // ── Keyboard: Ctrl+ shortcuts (separate effect — fires first, minimal deps) ──
  // Registered on document capture phase with stopImmediatePropagation to ensure
  // no other capture listener (sidebar, header, etc.) can swallow Ctrl+ events.
  useEffect(() => {
    function onCtrlKey(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      if (viewMode !== "table" && viewMode !== "focus") return;

      const key = e.key.toLowerCase();
      const tag = (document.activeElement?.tagName ?? "").toUpperCase();

      // ── Ctrl+V — Auto-paste into SO Number input ─────────────────────────
      if (key === "v") {
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (focusedId === null) return;
        e.stopImmediatePropagation();
        // Try table mode selector first
        let input = document.querySelector(
          `tr[data-order-id="${focusedId}"] input[placeholder="SO Number"]`,
        ) as HTMLInputElement | null;
        // Fallback for focus mode — Order No. input in detail header
        if (!input) {
          input = document.querySelector('input[placeholder="Enter number"]') as HTMLInputElement | null;
        }
        if (input) {
          input.focus();
          input.select();
          // Don't preventDefault — let the native paste go through
        }
        return;
      }

      // ── Ctrl+C — Smart copy for SAP workflow ─────────────────────────────
      if (key === "c") {
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

        // Don't intercept if user has text selected (normal copy)
        const selection = window.getSelection();
        if (selection && selection.toString().trim().length > 0) return;

        if (focusedId === null) return;
        const order = flatOrders.find(o => o.id === focusedId);
        if (!order) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        // State 1: copy customer code first
        if (smartCopyOrderId !== focusedId) {
          if (!order.customerCode || order.customerMatchStatus !== "exact") {
            showCopyToast("No customer — resolve first", "error");
            return;
          }
          navigator.clipboard.writeText(order.customerCode);
          setSmartCopyOrderId(focusedId);
          setSmartCopyLineIdx(0);
          showCopyToast(`Customer: ${order.customerCode} copied`, "customer");
          flashCell(focusedId, "code");
          return;
        }

        // State 2: copy all SKU codes (batch of 20)
        const matchedLines = order.lines.filter(
          l => l.matchStatus === "matched" && l.skuCode != null
        );
        if (matchedLines.length === 0) {
          showCopyToast("No SKU — resolve first", "error");
          return;
        }
        const needsBatching = matchedLines.length > BATCH_COPY_LIMIT;
        if (needsBatching) {
          const batchIdx = smartCopyLineIdx;
          const totalBatches = Math.ceil(matchedLines.length / BATCH_COPY_LIMIT);
          handleCopy(order.id, order.lines, batchIdx);
          flashCell(focusedId, "sku");
          const nextBatch = batchIdx + 1;
          if (nextBatch >= totalBatches) {
            showCopyToast(`SKUs batch ${batchIdx + 1}/${totalBatches} copied — done`, "sku");
            setSmartCopyOrderId(null);
            setSmartCopyLineIdx(0);
          } else {
            showCopyToast(`SKUs batch ${batchIdx + 1}/${totalBatches} copied`, "sku");
            setSmartCopyLineIdx(nextBatch);
          }
          handleAdvanceBatch(order.id);
        } else {
          handleCopy(order.id, order.lines);
          flashCell(focusedId, "sku");
          showCopyToast(`${matchedLines.length} SKUs copied`, "sku");
          setSmartCopyOrderId(null);
          setSmartCopyLineIdx(0);
        }
        return;
      }
    }

    document.addEventListener("keydown", onCtrlKey, { capture: true });
    return () => document.removeEventListener("keydown", onCtrlKey, { capture: true });
  }, [viewMode, focusedId, flatOrders, smartCopyOrderId, smartCopyLineIdx, showCopyToast, flashCell, handleCopy, handleAdvanceBatch]);

  // ── Keyboard: single-key navigation (table mode only) ───────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ctrl/Meta combos handled by separate effect above
      if (e.ctrlKey || e.metaKey) return;

      // Esc — cascading close (works even when input focused)
      // (The first rung used to be `completedSlot` → close the slot modal. Both
      //  went 2026-08-10; the popover is now the highest rung.)
      if (e.key === "Escape") {
        if (openCodePopoverId !== null) {
          setOpenCodePopoverId(null);
          return;
        }
        // Reset smart copy state
        if (smartCopyOrderId !== null) {
          setSmartCopyOrderId(null);
          setSmartCopyLineIdx(0);
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

      // (The `E` shortcut — "open slot completion / email modal" — was REMOVED
      //  2026-08-10 along with the modal's render call. It was the last writer of
      //  `completedSlot` and, via its target-slot inference, the last live reader
      //  of `slotCutoffs` outside the legacy 5-slot paths. Removing it is what
      //  allowed the /api/system-config/slot-cutoffs fetch to leave the 30s
      //  cycle. The modal component file is still on disk, now orphaned.)

      if (viewMode !== "table" && viewMode !== "focus") return;

      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const key = e.key;

      if (key === "ArrowDown") {
        if (viewMode === "focus") return; // handled by review-view.tsx (line nav)
        e.preventDefault();
        setFocusedId((prev) => {
          const idx = flatOrders.findIndex((o) => o.id === prev);
          if (idx < flatOrders.length - 1) return flatOrders[idx + 1].id;
          return prev;
        });
        return;
      }

      if (key === "ArrowUp") {
        if (viewMode === "focus") return; // handled by review-view.tsx (line nav)
        e.preventDefault();
        setFocusedId((prev) => {
          const idx = flatOrders.findIndex((o) => o.id === prev);
          if (idx > 0) return flatOrders[idx - 1].id;
          return prev;
        });
        return;
      }

      if (key === "Enter") {
        if (viewMode === "table" && focusedId !== null) handleExpand(focusedId);
        return;
      }

      // R — Copy reply template
      if (key === "r" || key === "R") {
        if (focusedId !== null) {
          const order = flatOrders.find(o => o.id === focusedId);
          if (order && order.status === "punched" && order.soNumber) {
            const billLabel = getBillLabel(order);
            const name = smartTitleCase(
              order.customerMatchStatus === "exact" && order.customerName
                ? order.customerName
                : cleanSubject(order.subject)
            ) + (order.splitLabel ? ` (${getSplitDisplayLabel(order)})` : "")
              + (billLabel ? ` · ${billLabel}` : "");

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

      // ? — Show tutorial
      if (key === "?" || (e.shiftKey && key === "/")) {
        e.preventDefault();
        setShowTutorial(true);
        return;
      }

      // / — Focus search box (focus mode focuses left panel filter)
      if (key === "/") {
        e.preventDefault();
        const selector = viewMode === "focus"
          ? 'input[placeholder="Filter orders..."]'
          : 'input[placeholder="Search orders..."]';
        const searchInput = document.querySelector(selector) as HTMLInputElement | null;
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

      // S — Open SKU panel for focused order
      if (key === "s" || key === "S") {
        if (focusedId !== null) {
          setSkuPanelOrderId(focusedId);
        }
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
    // `completedSlot` / `handleDismissCompletion` / `slotCutoffs` left this list
    // with the `E` shortcut and the Esc rung above (2026-08-10). `activeSlot` and
    // `orders` stay — other branches still read them.
  }, [flatOrders, focusedId, expandedId, handleExpand, handleFlag, openCodePopoverId, viewMode, smartCopyOrderId, smartCopyLineIdx, activeSlot, orders]);

  // ── Auto-scroll focused row into view ───────────────────────────────────────
  useEffect(() => {
    if (focusedId !== null) {
      // Use rAF to ensure DOM has settled after expand/collapse changes
      requestAnimationFrame(() => {
        document
          .querySelector(`tr[data-order-id="${focusedId}"]`)
          ?.scrollIntoView({ block: "nearest" });
      });
    }
  }, [focusedId]);

  // ── Header props ─────────────────────────────────────────────────────────────
  const slotPunchStatus = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const slot of ["Morning", "Afternoon", "Evening", "Late Evening", "Night"]) {
      const slotOrders = orders.filter(
        (o) => getSlotFromTime(o.receivedAt, slotCutoffs) === slot
      );
      result[slot] = slotOrders.length > 0 &&
        slotOrders.every((o) => o.status === "punched");
    }
    return result;
  }, [orders, slotCutoffs]);

  const headerSegments = useMemo(() => [
    { id: "Morning", label: slotPunchStatus.Morning ? "\u2713 Morning" : "Morning", count: slotCounts.Morning },
    { id: "Afternoon", label: slotPunchStatus.Afternoon ? "\u2713 Afternoon" : "Afternoon", count: slotCounts.Afternoon },
    { id: "Evening", label: slotPunchStatus.Evening ? "\u2713 Evening" : "Evening", count: slotCounts.Evening },
    { id: "Late Evening", label: slotPunchStatus["Late Evening"] ? "\u2713 Late Evening" : "Late Evening", count: slotCounts["Late Evening"] },
    { id: "Night", label: slotPunchStatus.Night ? "\u2713 Night" : "Night", count: slotCounts.Night },
  ], [slotCounts, slotPunchStatus]);

  const headerDate = useMemo(() => new Date(selectedDate + "T00:00:00+05:30"), [selectedDate]);
  const handleHeaderDateChange = useCallback((d: Date) => {
    setSelectedDate(d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  }, []);

  // Billing face: the date stepper + Filter move OFF the header's Row 2 and onto
  // the Orders|Picking tab row, mirroring where Floor puts its row controls.
  // These are the SAME components the header renders — not lookalikes — so the
  // two surfaces cannot drift. Built only when the flag is on; `undefined`
  // otherwise, leaving ReviewView and BillingTabBar exactly as they were.
  //
  // ⚠ Declared here, AFTER headerDate/handleHeaderDateChange — they are const
  // bindings, so building this any earlier is a temporal-dead-zone error.
  //
  // ⚠ The tab row lives inside ReviewView, which renders in FOCUS MODE ONLY.
  // See the suppressFilterBar wiring for why that matters.
  const billingHeaderSlot = billingV2 ? (
    <>
      <HeaderDateStepper currentDate={headerDate} onDateChange={handleHeaderDateChange} />
      <div className="w-px h-4 bg-gray-200" />
      <HeaderFilter
        groups={MO_FILTER_GROUPS}
        activeFilters={headerFilters}
        onFilterChange={setHeaderFilters}
      />
      <div className="w-px h-4 bg-gray-200" />
      {/* The shortcuts popover the header no longer shows on this face. SAME
          component, UNCONTROLLED: no `open`/`onOpenChange`, so it manages its
          own state and installs its own Escape listener — safe here because
          this row has no Escape priority chain to order. `segmentCount` is
          deliberately omitted: the billing face passes `segments={undefined}`
          to the header, so there is no slot row and no "Jump to slot" to list. */}
      <HeaderShortcuts shortcuts={MO_SHORTCUTS} variant="row" />
    </>
  ) : undefined;

  const punchPct = totalOrders > 0
    ? Math.round((punchedOrders / totalOrders) * 100) : 0;

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
      {/* Smart copy flash animations */}
      <style>{`
        @keyframes flash-green { 0% { background-color: #dcfce7; } 100% { background-color: transparent; } }
        @keyframes flash-blue { 0% { background-color: #dbeafe; } 100% { background-color: transparent; } }
        .smart-copy-flash-green { animation: flash-green 0.4s ease-out; }
        .smart-copy-flash-blue { animation: flash-blue 0.4s ease-out; }
      `}</style>
      <UniversalHeader
        showImport={canImportOBDs}
        // Billing face: Import is the row's one filled call to action, sized to
        // match the search box beside it. The OFF path keeps the grey chip, so
        // the non-billing Mail Orders header is unchanged.
        importVariant={billingV2 ? "primary" : "default"}
        // Billing face: the title is JUST the word. The Table/Focus toggle, the
        // divider, the "% punched" chip and the `stats` "N orders" are all gone
        // from the header — the Orders tab badge already carries the count that
        // matters, and two differently-defined numbers in one eyeline is worse
        // than one.
        //
        // Hiding the toggle is what pins the billing face to Focus: `viewMode`
        // defaults to "focus" (:169) and those two buttons are its ONLY writers,
        // so with them gone it can never leave. Table view is NOT archived —
        // MailOrdersTable, ColumnPicker and every viewMode branch stay live and
        // reachable for non-billing users.
        //
        // The OFF branch below is the original block, unchanged. Do not delete.
        title={billingV2 ? (
          <span className="text-[14px] font-semibold text-gray-900">Billing</span>
        ) : (
          <div className="flex items-center gap-2.5">
            <span>Mail Orders</span>
            <div data-tutorial="view-toggle" className="flex border border-gray-300 rounded-[5px] overflow-hidden">
              <button
                onClick={() => setViewMode("table")}
                className={`text-[10px] px-2.5 py-[3px] font-medium transition-colors ${
                  viewMode === "table"
                    ? "bg-gray-800 text-white"
                    : "bg-white text-gray-500 hover:bg-gray-50"
                }`}
              >
                Table
              </button>
              <button
                onClick={() => setViewMode("focus")}
                className={`text-[10px] px-2.5 py-[3px] font-medium transition-colors ${
                  viewMode === "focus"
                    ? "bg-gray-800 text-white"
                    : "bg-white text-gray-500 hover:bg-gray-50"
                }`}
              >
                Focus
              </button>
            </div>
            <span className="w-px h-[18px] bg-gray-200" />
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              punchPct >= 50
                ? "bg-green-50 text-green-600"
                : "bg-amber-50 text-amber-600"
            }`}>
              {punchPct}% punched
            </span>
          </div>
        )}
        // `stats` renders inside Row 1's left cluster beside the title. Dropped
        // on the billing face for the same reason as the % chip above.
        stats={billingV2 ? undefined : [
          { label: "orders", value: totalOrders },
        ]}
        // Billing face: no slot row. Passing `segments` as undefined hides it via
        // UniversalHeader's own `segments && segments.length > 0` guard — NOT
        // `segmentsDisabled`, which only greys it out. The header's 1-9 slot jumps
        // and its "Jump to slot" shortcut line key off the same prop, so both fall
        // away with it. Intended.
        segments={billingV2 ? undefined : headerSegments}
        activeSegment={activeSlot}
        onSegmentChange={(id) => setActiveSlot(id as string | null)}
        // Billing face in FOCUS mode only: Row 2's controls now live on the tab
        // row, so the row itself would be an empty 40px strip with a stray
        // bottom rule — suppress it.
        //
        // ⚠ NOT in table mode, and that is not a nicety. Row 2 also carries
        // `rightExtra`, which on this page is the ColumnPicker — and the
        // ColumnPicker only exists when viewMode === "table". Table mode also
        // has no tab row (ReviewView renders in focus mode only), so it still
        // needs the header's own Filter and date. Suppressing unconditionally
        // would silently delete the column picker AND both controls from Table
        // view. Flagged before building rather than dropped.
        suppressFilterBar={billingV2 && viewMode === "focus"}
        filterGroups={MO_FILTER_GROUPS}
        activeFilters={headerFilters}
        onFilterChange={setHeaderFilters}
        currentDate={headerDate}
        onDateChange={handleHeaderDateChange}
        searchPlaceholder="Search orders..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        // Billing face: Import + search move to the far RIGHT corner (Import to
        // the left of search), and the clock goes with its interval. Same
        // `searchQuery` state and the same 19-field matcher (:438-472) either
        // way — no new search logic, and the rail this filters is already
        // driven by it.
        searchLayout={billingV2 ? "wide-right" : "compact"}
        showClock={!billingV2}
        // Billing face: no keyboard button in the top header. This hides the
        // BUTTON only — every shortcut below still fires, including this page's
        // own Ctrl+C/Ctrl+V (:850) and single-key (:1043) listeners, which are
        // registered here and never consulted the header's chrome. The `?` key
        // (:982) still opens TutorialOverlay, so a help surface remains.
        showShortcutsButton={!billingV2}
        rightExtra={viewMode === "table" ? (
          <ColumnPicker
            columns={ALL_COLUMNS}
            visible={visibleColumns}
            onChange={setVisibleColumns}
          />
        ) : undefined}
        // Still passed on BOTH paths: on the non-billing face the header's own
        // shortcuts button renders and needs these rows. On billing the button
        // is hidden and the same array feeds the tab-row copy below.
        shortcuts={MO_SHORTCUTS}
      />

      {/* ── Content area ───────────────────────────────────────────────────────── */}
      {/* Focus mode — full bleed, manages own layout */}
      {/* Billing face: the shell mounts even at ZERO orders (`|| billingV2`).
          Everything the operator needs to get OUT of an empty day lives inside
          ReviewView — the rail, the Orders|Picking tabs, and `billingHeaderSlot`,
          which is where the date stepper and Filter were relocated to (:1142).
          The header's own Row 2 is suppressed on this face (:1266), so with the
          shell unmounted there was no date control anywhere on screen and a
          zero-order day was a dead end. The rail and the right pane already have
          their own genuinely-empty states (review-view.tsx:2563, :2629).
          `!loading && !error` is UNTOUCHED and still wins: the skeleton and the
          retry line below stay the only thing on screen while either is true.
          With the flag off this term is false and the expression is the original
          `orders.length > 0`, so the non-billing face is unchanged. */}
      {!loading && !error && (orders.length > 0 || billingV2) && viewMode === "focus" && (
        <ReviewView
          orders={filteredOrders}
          allOrders={orders}
          activeSlot={activeSlot}
          flaggedIds={flaggedIds}
          focusedId={focusedId}
          onFocusChange={setFocusedId}
          onFlag={handleFlag}
          onSaveSoNumber={handleSaveSoNumber}
          onSaveCustomer={handleSaveCustomer}
          onCopy={handleCopy}
          showCopyToast={showCopyToast}
          batchStates={batchStates}
          onAdvanceBatch={handleAdvanceBatch}
          punchedVisible={punchedVisible}
          onTogglePunched={() => setPunchedVisible(prev => !prev)}
          recentlyPunchedIds={recentlyPunchedIds}
          slotCutoffs={slotCutoffs}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSplitComplete={handleSplitComplete}
          disabledTagKeys={disabledTagKeys}
          billingV2={billingV2}
          billingTab={billingTab}
          onBillingTabChange={setBillingTab}
          onBillingActionSaved={loadOrders}
          billingHeaderSlot={billingHeaderSlot}
          hasHeaderFilter={hasHeaderFilter}
          // The day the header stepper is on, for the Billing Picking tab's
          // Done area. Already this page's state (:175) in the exact
          // YYYY-MM-DD IST form the billing routes parse — passed down, not
          // re-derived. Nothing else in ReviewView reads it, and the tab it
          // feeds renders on the billing face only.
          selectedDate={selectedDate}
          // Per-user notes-band size (px). The VALUE applies on both faces; only
          // the stepper control inside ReviewView is billing-gated.
          notesFontSize={notesFontSize}
          onNotesFontSizeChange={handleNotesFontSizeChange}
        />
      )}

      {/* Table mode — padded wrapper. Also shows loading/error/empty for focus mode. */}
      {/* ⚠ This guard and the ReviewView guard above must stay MUTUALLY
          EXCLUSIVE — they are siblings, and both claiming the zero case would
          render the shell with the full-page message underneath it. So the
          `orders.length === 0` term gains the exact inverse of what that guard
          gained: billing hands the zero case to the shell, every other face
          keeps it here. loading/error are outside this term and still route
          here on BOTH faces, which is what keeps the skeleton and the retry
          line reachable for billing. With the flag off `!billingV2` is true and
          the term is the original `orders.length === 0`. */}
      {(viewMode !== "focus" || loading || error || (orders.length === 0 && !billingV2)) && (
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {!loading && hasUrgentOrHold && viewMode === "table" && (
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

          {/* The `!billingV2` term is belt-and-braces: the wrapper guard above
              already withholds the zero case from the billing face, so this is
              unreachable there. It is written here anyway because THIS is the
              site that carries the copy — the billing face states the same fact
              in two better-placed halves (the rail's "No new orders" and the
              pane's "No orders yet today"), and a reader arriving at this
              paragraph should not have to walk back up to the wrapper to learn
              that. Non-billing keeps this message verbatim. */}
          {!loading && !error && orders.length === 0 && !billingV2 && (
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
              skuPanelOrderId={skuPanelOrderId}
              onCloseSkuPanel={() => setSkuPanelOrderId(null)}
              disabledTagKeys={disabledTagKeys}
            />
          )}
        </div>
      )}

      {/* The <SlotCompletionModal> render sat here until 2026-08-10. Its only
          opener was the `E` shortcut (removed above), so nothing could reach it.
          components/…/slot-completion-modal.tsx is LEFT ON DISK and is now
          ORPHANED — see the report's orphan list; retire it in a cleanup pass,
          not here (CORE §3: never delete files unless instructed). */}

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

      {/* Smart copy toast */}
      {copyToast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 text-white text-[12px] px-4 py-2 rounded-lg shadow-lg transition-opacity ${
          copyToast.type === "customer" ? "bg-green-700"
            : copyToast.type === "sku" ? "bg-blue-700"
            : "bg-amber-700"
        }`}>
          <Copy size={13} />
          <span>{copyToast.text}</span>
        </div>
      )}

      <TutorialOverlay
        manualTrigger={showTutorial}
        onClose={() => setShowTutorial(false)}
      />
    </div>
  );
}
