"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { UniversalHeader, type HeaderSegment } from "@/components/universal-header";
import { getTodayIST } from "@/lib/dates";
import type { PickingQueueRow } from "@/lib/picking/types";
import type { PickingQueueResult } from "@/lib/picking/queue";

const EM_DASH = "—";
const NUMBER_LOCALE = "en-US"; // fixed locale — identical thousands-separator output depot PC vs Vercel

type TabId = number | "all" | "unmatched";

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
// #(4) OBD(15) Dealer(24) Area(13) Article(17) LT(7) KG(7) Flags(8) spare(5) = 100
// OBD widened 13→15 (stacked obdNumber + IST date/time line), Dealer narrowed 26→24 to compensate.
const COLUMN_WIDTHS = [4, 15, 24, 13, 17, 7, 7, 8, 5] as const;
const COLUMN_COUNT = COLUMN_WIDTHS.length;

const DATA_ROW_HEIGHT = 44; // was 36 — grown to fit the OBD cell's two stacked lines (this table only)

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

function badgeStyle(tone: "red" | "amber"): CSSProperties {
  const palette: CSSProperties =
    tone === "red"
      ? { background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }
      : { background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a" };
  return {
    fontSize: 10.5,
    fontWeight: 600,
    padding: "1px 6px",
    borderRadius: 4,
    ...palette,
  };
}

function assignedPillStyle(): CSSProperties {
  return {
    fontSize: 10.5,
    fontWeight: 600,
    padding: "1px 6px",
    borderRadius: 4,
    background: "#f3f4f6",
    color: "#6b7280",
    border: "1px solid #e5e7eb",
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

function formatAssignedTime(value: Date | string | null): string {
  if (value === null) return EM_DASH;
  const d = new Date(value);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
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

// ── Action column ────────────────────────────────────────────────────────
// Small, secondary, NOT teal — the active tab segment owns the page's one
// teal element. Plain gray outline for Assign; a plain underlined text
// button for Undo (still not teal, visually distinct as a reversal action).

const ASSIGN_BUTTON_STYLE: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 500,
  padding: "3px 10px",
  borderRadius: 6,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#4b5563",
};

const UNDO_LINK_STYLE: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 500,
  color: "#4b5563",
  textDecoration: "underline",
  background: "none",
  border: "none",
  padding: 0,
};

function ActionCell({
  row,
  pendingOrderId,
  actionError,
  onAssign,
  onUnassign,
}: {
  row: PickingQueueRow;
  pendingOrderId: number | null;
  actionError: { orderId: number; message: string } | null;
  onAssign: (orderId: number) => void;
  onUnassign: (orderId: number) => void;
}) {
  const isPending = pendingOrderId === row.orderId;
  const errorForRow = actionError?.orderId === row.orderId ? actionError.message : null;

  return (
    <>
      {row.isAssigned ? (
        <button
          type="button"
          disabled={isPending}
          onClick={() => onUnassign(row.orderId)}
          style={{ ...UNDO_LINK_STYLE, opacity: isPending ? 0.6 : 1, cursor: isPending ? "default" : "pointer" }}
        >
          {isPending ? "…" : "Undo"}
        </button>
      ) : (
        <button
          type="button"
          disabled={isPending}
          onClick={() => onAssign(row.orderId)}
          style={{ ...ASSIGN_BUTTON_STYLE, opacity: isPending ? 0.6 : 1, cursor: isPending ? "default" : "pointer" }}
        >
          {isPending ? "…" : "Assign"}
        </button>
      )}
      {errorForRow !== null && (
        <div style={{ fontSize: 9.5, color: "#dc2626", marginTop: 2, whiteSpace: "normal" }}>{errorForRow}</div>
      )}
    </>
  );
}

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
  justifyContent: "space-between",
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
  pendingOrderId: number | null;
  actionError: { orderId: number; message: string } | null;
  onAssign: (orderId: number) => void;
  onUnassign: (orderId: number) => void;
}

function PickingTable({ rows, pendingOrderId, actionError, onAssign, onUnassign }: PickingTableProps) {
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
          <th style={headerCellStyle("center", { paddingLeft: 10, paddingRight: 4 })}>#</th>
          <th style={headerCellStyle("left")}>OBD</th>
          <th style={headerCellStyle("left")}>Dealer</th>
          <th style={headerCellStyle("left")}>Area</th>
          <th style={headerCellStyle("left")}>Article</th>
          <th style={headerCellStyle("right")}>LT</th>
          <th style={headerCellStyle("right")}>KG</th>
          <th style={headerCellStyle("left")}>Flags</th>
          <th style={headerCellStyle("center", { paddingRight: 12 })} />
        </tr>
      </thead>
      <tbody>
        {blocks.map((block) => (
          <Fragment key={block.key}>
            <tr style={BLOCK_HEADER_ROW_STYLE}>
              <td colSpan={COLUMN_COUNT} style={{ padding: 0 }}>
                <div style={BLOCK_HEADER_CELL_STYLE}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>
                    {blockHeaderLabel(block, routeTypeCounts)}
                  </span>
                  <span style={{ fontSize: 10.5, color: "#6b7280" }}>{blockHeaderRight(block.rows)}</span>
                </div>
              </td>
            </tr>
            {block.rows.map((row, i) => {
              const obdDateTimeLabel = formatObdDateTime(row.obdDateTime);
              return (
                <tr key={row.orderId} style={{ height: DATA_ROW_HEIGHT, borderBottom: "1px solid #f0f0f0" }}>
                  <td style={dataCellStyle("center", "muted", { paddingLeft: 10, paddingRight: 4 })}>
                    {block.startIndex + i + 1}
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
                  <td style={dataCellStyle("center", "secondary", { paddingRight: 12 })}>
                    <ActionCell
                      row={row}
                      pendingOrderId={pendingOrderId}
                      actionError={actionError}
                      onAssign={onAssign}
                      onUnassign={onUnassign}
                    />
                  </td>
                </tr>
              );
            })}
          </Fragment>
        ))}

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
              assignedRows.map((row, i) => (
                <tr key={row.orderId} style={{ height: DATA_ROW_HEIGHT, borderBottom: "1px solid #f0f0f0", opacity: 0.6 }}>
                  <td style={dataCellStyle("center", "muted", { paddingLeft: 10, paddingRight: 4 })}>
                    {unassignedRows.length + i + 1}
                  </td>
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
                  <td style={dataCellStyle("left", "muted")}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ ...OBD_LINE_STYLE, maxWidth: "100%" }}>{row.dealerName}</span>
                      <span style={assignedPillStyle()}>Assigned</span>
                    </span>
                    <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 1 }}>
                      {/* Always self-assign in this build (test mode) — pickerId
                          is always the current caller (no picker-select UI
                          exists yet), so "You" is always accurate here. If a
                          real picker-assignment UI is added later, this must
                          become a real-name/"You"-if-self check against the
                          signed-in user instead of a hardcoded label. */}
                      You · {formatAssignedTime(row.assignedAt)}
                    </div>
                  </td>
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
                  <td style={dataCellStyle("center", "secondary", { paddingRight: 12 })}>
                    <ActionCell
                      row={row}
                      pendingOrderId={pendingOrderId}
                      actionError={actionError}
                      onAssign={onAssign}
                      onUnassign={onUnassign}
                    />
                  </td>
                </tr>
              ))}
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
  const [pendingOrderId, setPendingOrderId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<{ orderId: number; message: string } | null>(null);

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

  // Post-action refetch — deliberately does NOT reset activeTab. The
  // date-driven effect above owns "reset on load"; after the operator's own
  // Assign/Undo click we want to keep them exactly where they were, even if
  // the tab they're looking at now has fewer (or zero) rows.
  const refetchAfterAction = useCallback(async () => {
    try {
      const json = await fetchQueue();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh picking queue");
    }
  }, [fetchQueue]);

  const handleAssign = useCallback(
    async (orderId: number) => {
      setPendingOrderId(orderId);
      setActionError(null);
      try {
        const res = await fetch("/api/picking/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok) {
          setActionError({ orderId, message: json.error ?? `Request failed (${res.status})` });
          if (res.status === 409) {
            await refetchAfterAction();
          }
          return;
        }
        await refetchAfterAction();
      } catch (err) {
        setActionError({ orderId, message: err instanceof Error ? err.message : "Assign failed" });
      } finally {
        setPendingOrderId(null);
      }
    },
    [refetchAfterAction],
  );

  const handleUnassign = useCallback(
    async (orderId: number) => {
      setPendingOrderId(orderId);
      setActionError(null);
      try {
        const res = await fetch("/api/picking/unassign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok) {
          setActionError({ orderId, message: json.error ?? `Request failed (${res.status})` });
          if (res.status === 409) {
            await refetchAfterAction();
          }
          return;
        }
        await refetchAfterAction();
      } catch (err) {
        setActionError({ orderId, message: err instanceof Error ? err.message : "Unassign failed" });
      } finally {
        setPendingOrderId(null);
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

      <div className="px-4 py-4">
        <p className="text-[11px] text-gray-400 mb-3">
          Test mode — assignments are tagged and reversible.
        </p>

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
                pendingOrderId={pendingOrderId}
                actionError={actionError}
                onAssign={handleAssign}
                onUnassign={handleUnassign}
              />
            </div>
          )
        )}
      </div>
    </>
  );
}
