"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Loader2 } from "lucide-react";
import { UniversalHeader, type HeaderSegment } from "@/components/universal-header";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getTodayIST } from "@/lib/dates";
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
// Checkbox(4) #(3) OBD(13) Dealer(20) Area(11) Article(14) LT(6) KG(6) Flags(7) Picker(10) Actions(6) = 100
// Matches the approved mock (docs/mockups/picking/bulk-assign.html) column-for-column.
const COLUMN_WIDTHS = [4, 3, 13, 20, 11, 14, 6, 6, 7, 10, 6] as const;
const COLUMN_COUNT = COLUMN_WIDTHS.length;

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

function badgeStyle(tone: "red" | "amber" | "green"): CSSProperties {
  const palette: CSSProperties =
    tone === "red"
      ? { background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }
      : tone === "amber"
        ? { background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a" }
        : { background: "#dcfce7", color: "#15803d", border: "1px solid #bbf7d0" };
  return {
    fontSize: 10.5,
    fontWeight: 600,
    padding: "1px 6px",
    borderRadius: 4,
    ...palette,
  };
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

function FlagBadges({ row }: { row: PickingQueueRow }) {
  const isP1 = row.priorityLevel === 1;
  if (!isP1 && !row.isKeyCustomer) {
    return <span style={{ color: "#9ca3af" }}>{EM_DASH}</span>;
  }
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {isP1 && <span style={badgeStyle("red")}>P1</span>}
      {row.isKeyCustomer && <span style={badgeStyle("amber")}>KEY</span>}
    </span>
  );
}

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

// ── Route-block grouping ────────────────────────────────────────────────────
//
// The payload arrives already spine-sorted. We NEVER re-sort or re-group by
// key here — we walk the rows once, top to bottom, and start a new block only
// when (deliveryType, route) differs from the immediately preceding row. This
// is consecutive-run grouping, not a Map-keyed grouping — a Map would risk
// reordering blocks by insertion/key order and silently fork the spine.
//
// Route blocks are built from UNASSIGNED rows only — an assigned bill is not
// work remaining, so it doesn't belong in a route block or its L/kg subtotal.

interface RouteBlock {
  key: string;
  deliveryType: string | null;
  route: string | null;
  rows: PickingQueueRow[];
  startIndex: number; // 0-based position of the block's first row within the tab's row list — feeds continuous "#" numbering
  // Vehicle-ready route rule — copied from the block's first row. Safe: every row in a
  // block already shares (deliveryType, route), so they share identical readiness values
  // by construction (lib/picking/queue.ts computes them per window::deliveryType::route).
  readyRoute: boolean;
  routeReadyWeightKg: number;
}

function buildRouteBlocks(rows: PickingQueueRow[]): RouteBlock[] {
  const blocks: RouteBlock[] = [];
  rows.forEach((row, idx) => {
    const last = blocks[blocks.length - 1];
    if (last && last.deliveryType === row.deliveryType && last.route === row.route) {
      last.rows.push(row);
    } else {
      blocks.push({
        key: `${row.deliveryType ?? "null"}::${row.route ?? "null"}::${idx}`,
        deliveryType: row.deliveryType,
        route: row.route,
        rows: [row],
        startIndex: idx,
        readyRoute: row.isReadyRoute,
        routeReadyWeightKg: row.routeReadyWeightKg,
      });
    }
  });
  return blocks;
}

// Read-only lookup (not a grouping mechanism) — used solely to decide whether
// a route name needs its delivery-type prefix, e.g. "Local · Adajan" vs a
// bare "Adajan", per the CURRENT TAB's visible (unassigned) rows only.
function computeRouteTypeCounts(rows: PickingQueueRow[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.route === null) continue;
    const set = map.get(r.route) ?? new Set<string>();
    if (r.deliveryType !== null) set.add(r.deliveryType);
    map.set(r.route, set);
  }
  return map;
}

function blockHeaderLabel(
  block: Pick<RouteBlock, "deliveryType" | "route">,
  routeTypeCounts: Map<string, Set<string>>,
): string {
  if (block.route === null) return EM_DASH;
  const types = routeTypeCounts.get(block.route);
  const spansMultipleTypes = types !== undefined && types.size > 1;
  if (spansMultipleTypes && block.deliveryType !== null) {
    return `${block.deliveryType} · ${block.route}`;
  }
  return block.route;
}

function formatBlockTotal(rows: PickingQueueRow[], field: "volumeLitres" | "weightKg", unit: string): string {
  let sum = 0;
  let hasValue = false;
  for (const r of rows) {
    const v = r[field];
    if (v !== null) {
      sum += v;
      hasValue = true;
    }
  }
  return hasValue ? `${formatNumber(sum)} ${unit}` : `${EM_DASH} ${unit}`;
}

function blockHeaderRight(rows: PickingQueueRow[]): string {
  const litres = formatBlockTotal(rows, "volumeLitres", "L");
  const kg = formatBlockTotal(rows, "weightKg", "kg");
  return `${rows.length} OBDs · ${litres} · ${kg}`;
}

const BLOCK_HEADER_ROW_STYLE: CSSProperties = {
  height: 30,
  background: "#fafafa",
  borderBottom: "1px solid #ebebeb",
};

const BLOCK_HEADER_CELL_STYLE: CSSProperties = {
  padding: "0 14px",
  display: "flex",
  alignItems: "center",
  gap: 10,
  height: 30,
};

// Collapse bar for assigned rows — mirrors Support's done-group pattern
// (CLAUDE_SUPPORT.md §4.2 / components/support/support-orders-table.tsx):
// collapsed by default, a "▸ N assigned" bar, click to expand.
const ASSIGNED_BAR_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 14px",
  cursor: "pointer",
  background: "#f9fafb",
  borderTop: "1px solid #f0f0f0",
  borderBottom: "1px solid #f0f0f0",
  userSelect: "none",
};

interface PickingTableProps {
  rows: PickingQueueRow[];
  selected: Set<number>;
  onToggleOne: (orderId: number) => void;
  onToggleBlock: (orderIds: number[], selectAll: boolean) => void;
  allSelectedInTab: boolean;
  someSelectedInTab: boolean;
  onToggleAllInTab: () => void;
  unassigningOrderId: number | null;
  unassignError: { orderId: number; message: string } | null;
  onUnassign: (orderId: number) => void;
}

function PickingTable({
  rows,
  selected,
  onToggleOne,
  onToggleBlock,
  allSelectedInTab,
  someSelectedInTab,
  onToggleAllInTab,
  unassigningOrderId,
  unassignError,
  onUnassign,
}: PickingTableProps) {
  const unassignedRows = useMemo(() => rows.filter((r) => !r.isAssigned), [rows]);
  const assignedRows = useMemo(() => rows.filter((r) => r.isAssigned), [rows]);

  const routeTypeCounts = useMemo(() => computeRouteTypeCounts(unassignedRows), [unassignedRows]);
  const blocks = useMemo(() => buildRouteBlocks(unassignedRows), [unassignedRows]);

  const [assignedExpanded, setAssignedExpanded] = useState(false);

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
          <th style={headerCellStyle("left")}>Area</th>
          <th style={headerCellStyle("left")}>Article</th>
          <th style={headerCellStyle("right")}>LT</th>
          <th style={headerCellStyle("right")}>KG</th>
          <th style={headerCellStyle("left")}>Flags</th>
          <th style={headerCellStyle("left")}>Picker</th>
          <th style={headerCellStyle("center", { paddingRight: 12 })} />
        </tr>
      </thead>
      <tbody>
        {blocks.map((block) => {
          const blockOrderIds = block.rows.map((r) => r.orderId);
          const blockSelectedCount = blockOrderIds.filter((id) => selected.has(id)).length;
          const blockAllSelected = blockOrderIds.length > 0 && blockSelectedCount === blockOrderIds.length;
          const blockIndeterminate = blockSelectedCount > 0 && !blockAllSelected;

          return (
            <Fragment key={block.key}>
              <tr style={BLOCK_HEADER_ROW_STYLE}>
                <td colSpan={COLUMN_COUNT} style={{ padding: 0 }}>
                  <div style={BLOCK_HEADER_CELL_STYLE}>
                    <Checkbox
                      checked={blockAllSelected}
                      indeterminate={blockIndeterminate}
                      onCheckedChange={() => onToggleBlock(blockOrderIds, !blockAllSelected)}
                    />
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>
                      {blockHeaderLabel(block, routeTypeCounts)}
                    </span>
                    {block.readyRoute && (
                      <span style={badgeStyle("green")}>
                        ＝{formatNumber(block.routeReadyWeightKg)} kg · truck ready
                      </span>
                    )}
                    <span style={{ fontSize: 10.5, color: "#6b7280", marginLeft: "auto" }}>
                      {blockHeaderRight(block.rows)}
                    </span>
                  </div>
                </td>
              </tr>
              {block.rows.map((row, i) => {
                const obdDateTimeLabel = formatObdDateTime(row.obdDateTime);
                return (
                  <tr key={row.orderId} style={{ height: DATA_ROW_HEIGHT, borderBottom: "1px solid #f0f0f0" }}>
                    <td style={dataCellStyle("center", "muted", { paddingLeft: 10, paddingRight: 4 })}>
                      <Checkbox checked={selected.has(row.orderId)} onCheckedChange={() => onToggleOne(row.orderId)} />
                    </td>
                    <td style={dataCellStyle("center", "muted")}>{block.startIndex + i + 1}</td>
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
                    <td style={dataCellStyle("left", "primary")}>
                      {row.dealerName}
                      {row.isShipToOverride && (
                        <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 400, color: "#9ca3af" }}>
                          &rarr; ship-to
                        </span>
                      )}
                    </td>
                    <td style={dataCellStyle("left", "secondary")}>
                      <NullableText value={row.area} />
                    </td>
                    <td style={dataCellStyle("left", "secondary")}>
                      <NullableText value={row.articleTag} />
                    </td>
                    <td style={dataCellStyle("right", "secondary")}>{formatNullableNumber(row.volumeLitres)}</td>
                    <td style={dataCellStyle("right", "secondary")}>{formatNullableNumber(row.weightKg)}</td>
                    <td style={dataCellStyle("left", "secondary")}>
                      <FlagBadges row={row} />
                    </td>
                    <td style={dataCellStyle("left", "muted")}>{EM_DASH}</td>
                    <td style={dataCellStyle("center", "secondary", { paddingRight: 12 })} />
                  </tr>
                );
              })}
            </Fragment>
          );
        })}

        {assignedRows.length > 0 && (
          <>
            <tr>
              <td colSpan={COLUMN_COUNT} style={{ padding: 0 }}>
                <div style={ASSIGNED_BAR_STYLE} onClick={() => setAssignedExpanded((v) => !v)}>
                  <span
                    style={{
                      fontSize: 10,
                      color: "#6b7280",
                      display: "inline-block",
                      transform: assignedExpanded ? "rotate(90deg)" : "none",
                      transition: "transform 150ms",
                    }}
                  >
                    ▸
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#6b7280" }}>
                    {assignedRows.length} assigned
                  </span>
                </div>
              </td>
            </tr>
            {assignedExpanded &&
              assignedRows.map((row, i) => {
                const isRowBusy = unassigningOrderId === row.orderId;
                const errorForRow = unassignError?.orderId === row.orderId ? unassignError.message : null;
                return (
                  <tr key={row.orderId} style={{ height: DATA_ROW_HEIGHT, borderBottom: "1px solid #f0f0f0", opacity: 0.6 }}>
                    <td style={dataCellStyle("center", "muted", { paddingLeft: 10, paddingRight: 4 })} />
                    <td style={dataCellStyle("center", "muted")} />
                    <td style={OBD_CELL_STYLE}>
                      <div
                        style={{
                          ...OBD_LINE_STYLE,
                          fontSize: 11,
                          color: "#6b7280",
                          fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
                        }}
                      >
                        {row.obdNumber}
                      </div>
                    </td>
                    <td style={dataCellStyle("left", "muted")}>{row.dealerName}</td>
                    <td style={dataCellStyle("left", "muted")}>
                      <NullableText value={row.area} />
                    </td>
                    <td style={dataCellStyle("left", "muted")}>
                      <NullableText value={row.articleTag} />
                    </td>
                    <td style={dataCellStyle("right", "muted")}>{formatNullableNumber(row.volumeLitres)}</td>
                    <td style={dataCellStyle("right", "muted")}>{formatNullableNumber(row.weightKg)}</td>
                    <td style={dataCellStyle("left", "muted")}>
                      <FlagBadges row={row} />
                    </td>
                    <td style={dataCellStyle("left", "muted")}>{row.assignedToName ?? EM_DASH}</td>
                    <td style={dataCellStyle("center", "secondary", { paddingRight: 12 })}>
                      <button
                        type="button"
                        disabled={isRowBusy}
                        onClick={() => onUnassign(row.orderId)}
                        style={{ ...UNDO_LINK_STYLE, opacity: isRowBusy ? 0.6 : 1, cursor: isRowBusy ? "default" : "pointer" }}
                      >
                        {isRowBusy ? "…" : "Undo"}
                      </button>
                      {errorForRow !== null && (
                        <div style={{ fontSize: 9.5, color: "#dc2626", marginTop: 2, whiteSpace: "normal" }}>{errorForRow}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
          </>
        )}
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

  const visibleRows: PickingQueueRow[] = useMemo(() => {
    if (!data || activeTab === null) return [];
    if (activeTab === "all") return data.rows;
    if (activeTab === "unmatched") return data.rows.filter(isUnmatchedRow);
    return data.rows.filter((r) => r.windowId === activeTab);
  }, [data, activeTab]);

  // Selection scope — UNASSIGNED rows in the CURRENT TAB only. Never the
  // assigned done-group, never rows outside this tab (those are cleared by
  // the tab-change effect above, not filtered here — Array.from() below
  // reflects exactly what's checked).
  const selectableIdsInTab = useMemo(
    () => visibleRows.filter((r) => !r.isAssigned).map((r) => r.orderId),
    [visibleRows],
  );
  const allSelectedInTab = selectableIdsInTab.length > 0 && selectableIdsInTab.every((id) => selected.has(id));
  const someSelectedInTab = selectableIdsInTab.some((id) => selected.has(id));

  const toggleAllInTab = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectedInTab) {
        selectableIdsInTab.forEach((id) => next.delete(id));
      } else {
        selectableIdsInTab.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [allSelectedInTab, selectableIdsInTab]);

  const toggleOne = useCallback((orderId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

  const toggleBlock = useCallback((orderIds: number[], selectAll: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (selectAll) orderIds.forEach((id) => next.add(id));
      else orderIds.forEach((id) => next.delete(id));
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
        currentDate={headerDate}
        onDateChange={handleDateChange}
        showDatePicker
      />

      <div className="px-4 py-4 pb-20">
        {/* ── Toolbar — mirrors Support's Select All / hint bar ────────── */}
        <div className="flex items-center justify-between px-1 py-1.5 mb-2">
          <button
            type="button"
            onClick={toggleAllInTab}
            disabled={selectableIdsInTab.length === 0}
            className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40 transition-colors"
          >
            {allSelectedInTab ? "Deselect All" : "Select All"}
          </button>
          <p className="text-[11px] text-gray-400">
            Test mode — assignments are tagged and reversible.
          </p>
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
                selected={selected}
                onToggleOne={toggleOne}
                onToggleBlock={toggleBlock}
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
