"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Loader2, Star, Zap } from "lucide-react";
import { UniversalHeader, type HeaderSegment, type FilterGroup, type FilterOption } from "@/components/universal-header";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getTodayIST } from "@/lib/dates";
import {
  sortPickingQueue,
  byWindow,
  byDeliveryType,
  byKeyCustomer,
  byPriority,
  byFifo,
} from "@/lib/picking/sort";
import type { PickingQueueRow } from "@/lib/picking/types";
import type { PickingQueueResult } from "@/lib/picking/queue";

const EM_DASH = "—";
const NUMBER_LOCALE = "en-US"; // fixed locale — identical thousands-separator output depot PC vs Vercel

type TabId = number | "all" | "unmatched";

interface Picker {
  id: number;
  name: string;
}

function isUnmatchedRow(row: PickingQueueRow): boolean {
  return row.route === null && row.area === null && row.deliveryType === null;
}

function formatNumber(n: number): string {
  return n.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatNullableNumber(n: number | null): string {
  return n === null ? EM_DASH : formatNumber(n);
}

// §27 fixed-table standard — percentage widths, must sum to 100.
// Checkbox(4) #(3) OBD(19) Dealer(27) Route(14) LT(7) Flags(9) Status(17) = 100
// Matches docs/mockups/picking/desktop-picking-v9.html (List view) column-for-column.
const COLUMN_WIDTHS = [4, 3, 19, 27, 14, 7, 9, 17] as const;

// Desktop display order = the shared pick spine MINUS byAssigned (design §4), so
// an order keeps its slot position — and its # — as it moves Waiting → Assigned
// → Picked → Ready. Rules are imported individually from lib/picking/sort.ts;
// that file and PICKING_SPINE are NEVER edited — this is a client-side re-sort.
const DISPLAY_RULES = [byWindow, byDeliveryType, byKeyCustomer, byPriority, byFifo];

const DATA_ROW_HEIGHT = 44; // grown to fit the OBD cell's two stacked lines (this table only)

const CELL_BASE: CSSProperties = {
  padding: "0 14px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

type Align = "left" | "center" | "right";

function headerCellStyle(align: Align, extra?: CSSProperties): CSSProperties {
  return {
    ...CELL_BASE,
    textAlign: align,
    fontSize: 10,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#9ca3af",
    ...extra,
  };
}

type CellTone = "primary" | "secondary" | "muted" | "mono";

function dataCellStyle(align: Align, tone: CellTone, extra?: CSSProperties): CSSProperties {
  const toneStyle: CSSProperties =
    tone === "primary"
      ? { fontSize: 11, fontWeight: 500, color: "#111827" }
      : tone === "mono"
        ? { fontSize: 11, color: "#111827", fontFamily: '"SF Mono", ui-monospace, Menlo, monospace' }
        : tone === "muted"
          ? { fontSize: 11, color: "#9ca3af" }
          : { fontSize: 11, color: "#4b5563" };
  return { ...CELL_BASE, textAlign: align, ...toneStyle, ...extra };
}

// CLAUDE_SUPPORT.md §4.5: displayed value = orderDateTime ?? obdEmailDate,
// resolved already in queue.ts. Format explicitly in IST — never let the
// browser's local timezone pick the day.
function formatObdDateTime(value: Date | string | null): string | null {
  if (value === null) return null;
  const d = new Date(value);
  const datePart = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
  const timePart = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
  return `${datePart} · ${timePart}`;
}

const OBD_CELL_STYLE: CSSProperties = {
  padding: "0 14px",
  verticalAlign: "middle",
};

const OBD_LINE_STYLE: CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function NullableText({ value }: { value: string | null }) {
  if (value === null) {
    return <span style={{ color: "#9ca3af" }}>{EM_DASH}</span>;
  }
  return <>{value}</>;
}

// Flags as icons (design §2) — ★ key customer (amber), ⚡ P1 urgent (red), the
// same glyphs the mobile card uses. Both if both; em-dash when neither. Never
// the old "P1"/"KEY" text badges.
function FlagIcons({ row }: { row: PickingQueueRow }) {
  const isP1 = row.priorityLevel === 1;
  if (!isP1 && !row.isKeyCustomer) {
    return <span style={{ color: "#d1d5db" }}>{EM_DASH}</span>;
  }
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      {row.isKeyCustomer && <Star size={13} fill="#f59e0b" style={{ color: "#f59e0b" }} />}
      {isP1 && <Zap size={13} fill="#ef4444" style={{ color: "#ef4444" }} />}
    </span>
  );
}

// Status pill — the row's verdict, derived from the stage booleans in priority
// order (design §1). Teal is NEVER used here (one-teal rule reserves it for the
// active slot tab).
type StatusLabel = "Ready" | "Picked" | "Assigned" | "Waiting";
const STATUS_STYLES: Record<StatusLabel, { bg: string; color: string; border: string; dot: string }> = {
  Ready:    { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0", dot: "#16a34a" },
  Picked:   { bg: "#fffbeb", color: "#b45309", border: "#fde68a", dot: "#d97706" },
  Assigned: { bg: "#f3f4f6", color: "#374151", border: "#e5e7eb", dot: "#374151" },
  Waiting:  { bg: "#f3f4f6", color: "#6b7280", border: "#e5e7eb", dot: "#9ca3af" },
};
function rowStatus(row: PickingQueueRow): StatusLabel {
  if (row.isChecked) return "Ready";
  if (row.isDone) return "Picked";
  if (row.isAssigned) return "Assigned";
  return "Waiting";
}
function StatusPill({ row }: { row: PickingQueueRow }) {
  const label = rowStatus(row);
  const s = STATUS_STYLES[label];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 22,
        padding: "0 10px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />
      {label}
    </span>
  );
}

function isWaiting(row: PickingQueueRow): boolean {
  return !row.isAssigned && !row.isDone && !row.isChecked;
}

// Fixed Status filter options — values MUST match rowStatus()'s return exactly.
const STATUS_FILTER_OPTIONS: FilterOption[] = [
  { value: "Waiting", label: "Waiting" },
  { value: "Assigned", label: "Assigned" },
  { value: "Picked", label: "Picked" },
  { value: "Ready", label: "Ready" },
];

// ── Undo (per-row, assigned rows only) ──────────────────────────────────────
// Small, secondary, NOT teal — the active tab segment owns the page's one
// teal element. A plain underlined text button, visually a reversal action.

const UNDO_LINK_STYLE: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 500,
  color: "#4b5563",
  textDecoration: "underline",
  background: "none",
  border: "none",
  padding: 0,
};

interface PickingTableProps {
  rows: PickingQueueRow[];
  sequenceByOrderId: Map<number, number>;
  selected: Set<number>;
  onToggleOne: (orderId: number) => void;
  allSelectedInTab: boolean;
  someSelectedInTab: boolean;
  onToggleAllInTab: () => void;
  unassigningOrderId: number | null;
  unassignError: { orderId: number; message: string } | null;
  onUnassign: (orderId: number) => void;
}

function PickingTable({
  rows,
  sequenceByOrderId,
  selected,
  onToggleOne,
  allSelectedInTab,
  someSelectedInTab,
  onToggleAllInTab,
  unassigningOrderId,
  unassignError,
  onUnassign,
}: PickingTableProps) {
  // Every state renders INLINE (design §3) — the old "N assigned" collapse
  // drawer is gone. `rows` arrives already filtered (tab + panel filters +
  // search) and ordered (spine minus byAssigned) from the parent; this only
  // renders. The checkbox + Select-All still gate on isWaiting() only (guard G).
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
      <colgroup>
        {COLUMN_WIDTHS.map((w, i) => (
          <col key={i} style={{ width: `${w}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr style={{ height: 32, borderBottom: "1px solid #ebebeb" }}>
          <th style={headerCellStyle("center", { paddingLeft: 10, paddingRight: 4 })}>
            <Checkbox
              checked={allSelectedInTab}
              indeterminate={someSelectedInTab && !allSelectedInTab}
              onCheckedChange={() => onToggleAllInTab()}
            />
          </th>
          <th style={headerCellStyle("center")}>#</th>
          <th style={headerCellStyle("left")}>OBD</th>
          <th style={headerCellStyle("left")}>Dealer</th>
          <th style={headerCellStyle("left")}>Route</th>
          <th style={headerCellStyle("right")}>LT</th>
          <th style={headerCellStyle("left")}>Flags</th>
          <th style={headerCellStyle("left", { paddingRight: 12 })}>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const obdDateTimeLabel = formatObdDateTime(row.obdDateTime);
          const waiting = isWaiting(row);
          const isRowBusy = unassigningOrderId === row.orderId;
          const errorForRow = unassignError?.orderId === row.orderId ? unassignError.message : null;
          return (
            <tr
              key={row.orderId}
              className="group hover:bg-gray-50"
              style={{ height: DATA_ROW_HEIGHT, borderBottom: "1px solid #f0f0f0" }}
            >
              <td style={dataCellStyle("center", "muted", { paddingLeft: 10, paddingRight: 4 })}>
                {waiting && (
                  <Checkbox checked={selected.has(row.orderId)} onCheckedChange={() => onToggleOne(row.orderId)} />
                )}
              </td>
              <td style={dataCellStyle("center", "muted", { fontWeight: 600 })}>
                {sequenceByOrderId.get(row.orderId) ?? EM_DASH}
              </td>
              <td style={OBD_CELL_STYLE}>
                <div
                  style={{
                    ...OBD_LINE_STYLE,
                    fontSize: 11,
                    color: "#111827",
                    fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
                  }}
                >
                  {row.obdNumber}
                </div>
                {obdDateTimeLabel !== null && (
                  <div style={{ ...OBD_LINE_STYLE, fontSize: 10, color: "#9ca3af", marginTop: 1 }}>
                    {obdDateTimeLabel}
                  </div>
                )}
              </td>
              <td style={OBD_CELL_STYLE}>
                <div style={{ ...OBD_LINE_STYLE, fontSize: 11.5, fontWeight: 600, color: "#111827" }}>
                  {row.dealerName}
                </div>
                {row.isShipToOverride && (
                  <div style={{ ...OBD_LINE_STYLE, fontSize: 10, color: "#9ca3af", marginTop: 1 }}>
                    &rarr; ship-to
                  </div>
                )}
              </td>
              <td style={dataCellStyle("left", "secondary")}>
                <NullableText value={row.route} />
              </td>
              <td
                style={dataCellStyle("right", "secondary", {
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 600,
                  color: "#1f2937",
                })}
              >
                {formatNullableNumber(row.volumeLitres)}
              </td>
              <td style={dataCellStyle("left", "secondary")}>
                <FlagIcons row={row} />
              </td>
              <td style={dataCellStyle("left", "secondary", { paddingRight: 12 })}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <StatusPill row={row} />
                  {row.isAssigned && (
                    <button
                      type="button"
                      disabled={isRowBusy}
                      onClick={() => onUnassign(row.orderId)}
                      className={isRowBusy ? "opacity-100" : "opacity-0 group-hover:opacity-100 transition-opacity"}
                      style={{ ...UNDO_LINK_STYLE, cursor: isRowBusy ? "default" : "pointer" }}
                    >
                      {isRowBusy ? "…" : "Undo"}
                    </button>
                  )}
                </span>
                {errorForRow !== null && (
                  <div style={{ fontSize: 9.5, color: "#dc2626", marginTop: 2, whiteSpace: "normal" }}>{errorForRow}</div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function PickingQueue() {
  // "YYYY-MM-DD" in IST — same shape/convention as Support's `date` state.
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayIST());
  const [data, setData] = useState<PickingQueueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  const [unassigningOrderId, setUnassigningOrderId] = useState<number | null>(null);
  const [unassignError, setUnassignError] = useState<{ orderId: number; message: string } | null>(null);

  // Bulk-assign selection (mirrors components/support/support-orders-table.tsx's
  // `selected` Set<number> pattern exactly).
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Unified filter panel (design §8) — three groups keyed route/status/delivery;
  // within a group OR, across groups AND. Global (NOT reset on tab change) — the
  // panel is a persistent lens, unlike the old per-tab route dropdown.
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({
    route: [],
    status: [],
    delivery: [],
  });
  // Client-side search (there is no server search) — dealer OR OBD, case-insensitive.
  const [searchQuery, setSearchQuery] = useState("");
  const [pickers, setPickers] = useState<Picker[]>([]);
  const [pickersLoading, setPickersLoading] = useState(true);
  const [chosenPickerId, setChosenPickerId] = useState<number | null>(null);
  const [bulkAssigning, setBulkAssigning] = useState(false);

  // UniversalHeader wants a Date; convert both ways exactly as Support does
  // (support-page-content.tsx `headerDate` / `handleHeaderDateChange`).
  const headerDate = useMemo(
    () => new Date(selectedDate + "T00:00:00+05:30"),
    [selectedDate],
  );
  const handleDateChange = useCallback((d: Date) => {
    setSelectedDate(d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  }, []);

  const fetchQueue = useCallback(async (): Promise<PickingQueueResult> => {
    // Row counts change between days — never cache across dates, always refetch.
    const res = await fetch(`/api/picking/queue?date=${selectedDate}`);
    if (!res.ok) {
      throw new Error(`Request failed (${res.status})`);
    }
    return res.json();
  }, [selectedDate]);

  // Picker list for the bulk-assign dropdown — reuses the same picker-role
  // query app/api/warehouse/pickers/route.ts already exposes. Fetched once;
  // the picker roster doesn't change within a session.
  useEffect(() => {
    let cancelled = false;
    async function loadPickers() {
      try {
        const res = await fetch("/api/warehouse/pickers");
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as { pickers?: Picker[] };
        if (!cancelled) setPickers(json.pickers ?? []);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Failed to load pickers");
      } finally {
        if (!cancelled) setPickersLoading(false);
      }
    }
    void loadPickers();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const json = await fetchQueue();
        if (cancelled) return;
        setData(json);
        // Reset the active tab on every load (including a date change) —
        // a tab open for one day may be empty on another; never leave the
        // user staring at a stale empty tab.
        const firstNonEmpty = json.windows.find((w) => w.count > 0);
        setActiveTab(firstNonEmpty ? firstNonEmpty.id : "all");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load picking queue");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [fetchQueue]);

  // Selection is scoped to "the current tab" (mirrors Support's reset-on-
  // section-change, support-orders-table.tsx lines 245-258) — switching tabs
  // clears it rather than carrying a stale cross-tab selection into a bar
  // whose count would then not match what's visible.
  useEffect(() => {
    setSelected(new Set());
    setChosenPickerId(null);
  }, [activeTab]);

  // Post-action refetch — deliberately does NOT reset activeTab. The
  // date-driven effect above owns "reset on load"; after the operator's own
  // Undo/Assign we want to keep them exactly where they were, even if the
  // tab they're looking at now has fewer (or zero) rows.
  const refetchAfterAction = useCallback(async () => {
    try {
      const json = await fetchQueue();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh picking queue");
    }
  }, [fetchQueue]);

  const handleUnassign = useCallback(
    async (orderId: number) => {
      setUnassigningOrderId(orderId);
      setUnassignError(null);
      try {
        const res = await fetch("/api/picking/unassign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok) {
          setUnassignError({ orderId, message: json.error ?? `Request failed (${res.status})` });
          if (res.status === 409) {
            await refetchAfterAction();
          }
          return;
        }
        await refetchAfterAction();
      } catch (err) {
        setUnassignError({ orderId, message: err instanceof Error ? err.message : "Unassign failed" });
      } finally {
        setUnassigningOrderId(null);
      }
    },
    [refetchAfterAction],
  );

  const segments: HeaderSegment[] = useMemo(() => {
    if (!data) return [];
    const windowSegments: HeaderSegment[] = data.windows.map((w) => ({
      id: w.id,
      label: w.windowTime,
      count: w.count,
    }));
    const allSegment: HeaderSegment = { id: "all", label: "All", count: data.totalCount };
    const unmatchedSegment: HeaderSegment[] =
      data.unmatchedCount > 0
        ? [{ id: "unmatched", label: "Unmatched", count: data.unmatchedCount }]
        : [];
    return [...windowSegments, allSegment, ...unmatchedSegment];
  }, [data]);

  // Desktop display order = the pick spine MINUS byAssigned (design §4), applied
  // client-side. sort.ts is never touched. Assigned/Picked/Ready rows keep their
  // slot position instead of sinking, so a row's # never jumps as its status
  // changes.
  const displayRows: PickingQueueRow[] = useMemo(
    () => (data ? sortPickingQueue(data.rows, DISPLAY_RULES) : []),
    [data],
  );

  // Global pick-sequence #: 1-based over the WHOLE day's display order, so a row
  // shows the same # in every slot tab (design §5). Computed once from
  // displayRows; unaffected by status changes (byAssigned is not in the rules).
  const sequenceByOrderId = useMemo(() => {
    const m = new Map<number, number>();
    displayRows.forEach((r, i) => m.set(r.orderId, i + 1));
    return m;
  }, [displayRows]);

  // Slot-tab slice only — the panel filters + search are applied below, so the
  // filter/search narrowing composes cleanly on top of the tab narrowing.
  const tabRows: PickingQueueRow[] = useMemo(() => {
    if (!data || activeTab === null) return [];
    if (activeTab === "all") return displayRows;
    if (activeTab === "unmatched") return displayRows.filter(isUnmatchedRow);
    return displayRows.filter((r) => r.windowId === activeTab);
  }, [data, displayRows, activeTab]);

  // Final rendered list = tab slice AND panel filters AND search. Within a group
  // OR (row's value ∈ the group's selection); across groups AND; an empty group
  // imposes nothing. Search = dealer OR OBD, case-insensitive.
  const visibleRows: PickingQueueRow[] = useMemo(() => {
    const routeSel = activeFilters.route ?? [];
    const statusSel = activeFilters.status ?? [];
    const deliverySel = activeFilters.delivery ?? [];
    const q = searchQuery.trim().toLowerCase();
    return tabRows.filter((r) => {
      if (routeSel.length > 0 && (r.route === null || !routeSel.includes(r.route))) return false;
      if (statusSel.length > 0 && !statusSel.includes(rowStatus(r))) return false;
      if (deliverySel.length > 0 && (r.deliveryType === null || !deliverySel.includes(r.deliveryType))) return false;
      if (q && !(r.dealerName.toLowerCase().includes(q) || r.obdNumber.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [tabRows, activeFilters, searchQuery]);

  // Filter-panel option lists — distinct values across ALL active rows (not just
  // the current tab), so the panel reads as a stable global lens. Route/Delivery
  // are data-derived + alphabetical; Status is the fixed 4-state set.
  const routeOptions: FilterOption[] = useMemo(() => {
    const set = new Set<string>();
    for (const r of displayRows) if (r.route !== null) set.add(r.route);
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
      .map((v) => ({ value: v, label: v }));
  }, [displayRows]);
  const deliveryOptions: FilterOption[] = useMemo(() => {
    const set = new Set<string>();
    for (const r of displayRows) if (r.deliveryType !== null) set.add(r.deliveryType);
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
      .map((v) => ({ value: v, label: v }));
  }, [displayRows]);
  const filterGroups: FilterGroup[] = useMemo(
    () => [
      { label: "Route", key: "route", options: routeOptions },
      { label: "Status", key: "status", options: STATUS_FILTER_OPTIONS },
      { label: "Delivery type", key: "delivery", options: deliveryOptions },
    ],
    [routeOptions, deliveryOptions],
  );

  // Applied-filter pills — one per active value across all groups.
  const appliedFilters = useMemo(() => {
    const out: { groupKey: string; value: string }[] = [];
    for (const key of Object.keys(activeFilters)) {
      for (const value of activeFilters[key] ?? []) out.push({ groupKey: key, value });
    }
    return out;
  }, [activeFilters]);

  const removeFilter = useCallback((groupKey: string, value: string) => {
    setActiveFilters((prev) => ({
      ...prev,
      [groupKey]: (prev[groupKey] ?? []).filter((v) => v !== value),
    }));
  }, []);

  // Selection scope — Waiting rows among what's ACTUALLY visible (tab + filters
  // + search already applied to visibleRows), so Select-All never selects a row
  // hidden by a filter/search, and never a non-Waiting row (guard G).
  const selectableIdsInTab = useMemo(
    () => visibleRows.filter(isWaiting).map((r) => r.orderId),
    [visibleRows],
  );
  const allSelectedInTab = selectableIdsInTab.length > 0 && selectableIdsInTab.every((id) => selected.has(id));
  const someSelectedInTab = selectableIdsInTab.some((id) => selected.has(id));

  // Plain multi-select — no ordering constraint (the no-jump top-prefix guard
  // was removed for V1; will be re-wired in a later iteration).
  const toggleAllInTab = useCallback(() => {
    setSelected(allSelectedInTab ? new Set() : new Set(selectableIdsInTab));
  }, [allSelectedInTab, selectableIdsInTab]);

  const toggleOne = useCallback((orderId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

  const handleBulkAssign = useCallback(async () => {
    if (selected.size === 0 || chosenPickerId === null) return;
    setBulkAssigning(true);
    try {
      const res = await fetch("/api/picking/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: Array.from(selected), pickerId: chosenPickerId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        assigned?: number;
        failed?: { orderId: number; error: string }[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error ?? `Request failed (${res.status})`);
        return;
      }
      const assignedCount = json.assigned ?? 0;
      const failedList = json.failed ?? [];
      if (failedList.length > 0) {
        toast(`${assignedCount} assigned, ${failedList.length} failed`);
      } else {
        toast.success(`${assignedCount} assigned`);
      }
      setSelected(new Set());
      setChosenPickerId(null);
      // Refetch fresh — never splice/patch local state. Subtotals, block
      // counts, and numbering all recompute server-side; failed bills simply
      // reappear as unassigned on this next read (no reconciliation needed).
      await refetchAfterAction();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Assign failed");
    } finally {
      setBulkAssigning(false);
    }
  }, [selected, chosenPickerId, refetchAfterAction]);

  return (
    <>
      <UniversalHeader
        title="Picking Queue"
        stats={data ? [{ label: "OBDs", value: data.totalCount }] : undefined}
        segments={segments}
        activeSegment={activeTab}
        onSegmentChange={(id) => {
          // Ignore deselect (id === null) — the queue always shows exactly
          // one tab's worth of rows, never a "nothing selected" state.
          if (id !== null) setActiveTab(id as TabId);
        }}
        filterGroups={filterGroups}
        activeFilters={activeFilters}
        onFilterChange={setActiveFilters}
        searchPlaceholder="Search dealer or OBD…"
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        currentDate={headerDate}
        onDateChange={handleDateChange}
        showDatePicker
      />

      <div className="px-4 py-4 pb-20">
        {/* ── Applied-filter pills + Select All + test note (design §8 / mock
            .subrow). Route filtering now comes from the header Filter panel,
            not a loose dropdown. ──────────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 px-1 py-1.5 mb-2 flex-wrap">
          {appliedFilters.length > 0 && (
            <span className="text-[11px] font-semibold text-gray-400">Filters:</span>
          )}
          {appliedFilters.map(({ groupKey, value }) => (
            <span
              key={`${groupKey}:${value}`}
              className="inline-flex items-center gap-1 h-[24px] pl-2.5 pr-1 bg-white border border-gray-200 rounded-[7px] text-[11px] font-medium text-gray-700"
            >
              {value}
              <button
                type="button"
                onClick={() => removeFilter(groupKey, value)}
                aria-label={`Remove ${value} filter`}
                className="text-gray-400 hover:text-gray-700 text-[13px] leading-none px-0.5"
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={toggleAllInTab}
            disabled={selectableIdsInTab.length === 0}
            className="ml-auto text-xs font-medium text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
          >
            {allSelectedInTab ? "Deselect All" : "Select All"}
          </button>
          <p className="text-[11px] text-gray-400">Test mode — tagged &amp; reversible.</p>
        </div>

        {loading && (
          <p className="text-[13px] text-gray-400 text-center py-16">Loading queue&hellip;</p>
        )}

        {!loading && error && (
          <p className="text-[13px] text-red-600 text-center py-16">
            Couldn&apos;t load the picking queue: {error}
          </p>
        )}

        {!loading && !error && data && (
          visibleRows.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-16">
              No orders in this window.
            </p>
          ) : (
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <PickingTable
                rows={visibleRows}
                sequenceByOrderId={sequenceByOrderId}
                selected={selected}
                onToggleOne={toggleOne}
                allSelectedInTab={allSelectedInTab}
                someSelectedInTab={someSelectedInTab}
                onToggleAllInTab={toggleAllInTab}
                unassigningOrderId={unassigningOrderId}
                unassignError={unassignError}
                onUnassign={handleUnassign}
              />
            </div>
          )
        )}
      </div>

      {/* ── Sticky bulk-assign bar — styled like Support's Submit bar ──── */}
      <div
        className={cn(
          "fixed bottom-0 left-[72px] right-0 z-50 transform transition-transform duration-200",
          selected.size > 0 ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div
          className="bg-white"
          style={{ borderTop: "1px solid rgba(17,24,39,0.06)", boxShadow: "0 -1px 1px rgba(17,24,39,0.04), 0 -8px 24px rgba(17,24,39,0.06)" }}
        >
          <div className="flex items-center gap-3 pl-5 pr-[22px] py-3" style={{ minHeight: "56px" }}>
            <span className="text-xs font-medium text-gray-700">{selected.size} selected</span>

            <div className="flex-1" />

            <span className="text-[11px] text-gray-500">assign to</span>
            <select
              value={chosenPickerId ?? ""}
              onChange={(e) => setChosenPickerId(e.target.value ? Number(e.target.value) : null)}
              className="h-[30px] px-2.5 text-[11px] border border-gray-200 rounded-[10px] bg-white text-gray-900 font-medium focus:outline-none focus:border-teal-200 min-w-[150px]"
            >
              <option value="" disabled>
                {pickersLoading ? "Loading…" : "Choose picker"}
              </option>
              {pickers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <div className="w-px h-[22px] bg-gray-200 mx-1 flex-shrink-0" />

            <button
              type="button"
              onClick={() => { setSelected(new Set()); setChosenPickerId(null); }}
              className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1 transition-colors"
            >
              Clear
            </button>

            {/* bg-gray-900 — NOT teal; the active tab segment owns this page's one teal element. */}
            <button
              type="button"
              onClick={() => void handleBulkAssign()}
              disabled={bulkAssigning || selected.size === 0 || chosenPickerId === null}
              className="px-4 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-lg hover:bg-gray-800 flex items-center gap-1.5 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {bulkAssigning && <Loader2 size={12} className="animate-spin" />}
              Assign
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
