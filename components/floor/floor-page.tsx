"use client";

// Floor Control composition root. Step 5 adds SELECTION + the assignment bar +
// the mutation wiring. Additive only: the header, the rail and the board layout
// are unchanged; floor-page owns the selection Set and every write handler.
//
// Assignment reuses the EXISTING Picking endpoints unchanged:
//   Assign/Reassign → (unassign any already-assigned) then /api/picking/assign
//   Unassign        → /api/picking/unassign
// The five state actions (mark-urgent · change-slot · hold · cancel · restore)
// go through /api/floor/actions. Rail Hold/✕ and the row ⚡ are wired here too.

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { FloorRail } from "./floor-rail";
import { FloorBoard } from "./floor-board";
import { FloorSkeleton } from "./floor-skeleton";
import { AssignBar } from "./assign-bar";
import { HoldTab } from "./hold-tab";
import { CancelledTab } from "./cancelled-tab";
import { DetailPanel, type DetailActions } from "./detail-panel";
import { SearchBox, SearchHits } from "./search-box";
import { FilterSheet } from "./filter-sheet";
import { ConnectionStrip } from "./connection-strip";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";
import { useFloorRailPoll } from "@/lib/floor/use-floor-rail-poll";
import { toggleOne, toggleAll as toggleAllRows, isSelectable, type FloorSelection } from "@/lib/floor/selection";
import { parseSearch, applySearch, searchReport, type Searchable } from "@/lib/floor/search";
import { applyFloorFilters, applyFlagFilters, EMPTY_FILTERS, type FloorFilters } from "@/lib/floor/filter";
import type { RailReleaseSlot } from "./rail-card";
import type { DispatchWindow } from "@/components/support/dispatch-slot-picker";
import type { FloorRailCard, FloorScope, FloorBoardResult, FloorBoardRow, FloorPicker, FloorHoldRow, FloorCancelledRow, FloorDetailSource } from "@/lib/floor/types";
import type { SlotTabKey } from "./floor-tabs";

const SCOPES: FloorScope[] = ["All", "Local", "Upcountry", "IGT"];

// The three top tabs (design §3 — Floor / On hold / Cancelled).
type TopTab = "floor" | "hold" | "cancelled";

interface BoardData {
  rail: FloorRailCard[];
  floor: FloorBoardResult;
  pickers: FloorPicker[];
}

function istTodayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function addDaysIso(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// Every write route returns one of these shapes: { failed:[…] } for the batch
// routes (release/actions/picking-assign) or { error } for a hard reject. We read
// BOTH — a write that skipped silently must never look like success (the bug that
// hid the Hold-tab release no-op).
interface WriteBody {
  error?: string;
  failed?: Array<{ error?: string }>;
}

async function postJson(url: string, payload: unknown, method: "POST" | "PATCH" = "POST"): Promise<{ ok: boolean; body: WriteBody }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as WriteBody;
    return { ok: res.ok, body };
  } catch {
    return { ok: false, body: { error: "Network error — check your connection." } };
  }
}

// Surface a write result to the operator. Returns true ONLY on a clean,
// fully-applied write. A non-2xx response, a hard `error`, OR a non-empty
// `failed[]` (partial or total failure) raises a toast and returns false — the
// response is never discarded. Success is intentionally silent (the board reload
// is the confirmation).
function reportWrite(label: string, r: { ok: boolean; body: WriteBody }): boolean {
  const failed = Array.isArray(r.body.failed) ? r.body.failed : [];
  if (!r.ok) {
    toast.error(r.body.error ? `${label} failed — ${r.body.error}` : `${label} failed.`);
    return false;
  }
  if (failed.length > 0) {
    const reason = failed[0]?.error ?? "not valid at its current state";
    toast.error(`${label}: ${failed.length} bill${failed.length === 1 ? "" : "s"} not updated — ${reason}`);
    return false;
  }
  return true;
}

export function FloorPage() {
  const [scope, setScope] = useState<FloorScope>("All");
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Hold + Cancelled feeds. Fetched alongside the board so the tab counts are
  // always live regardless of which tab is open (design §5.4 / §3).
  const [holdRows, setHoldRows] = useState<FloorHoldRow[] | null>(null);
  const [cancelledRows, setCancelledRows] = useState<FloorCancelledRow[] | null>(null);
  const [sideError, setSideError] = useState<string | null>(null);
  // Time of the last successful board load — shown by the connection strip as
  // "last update HH:MM" when the server becomes unreachable (design §13).
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  // Server reachability, driven off the SAME /api/floor/marker probe the board's
  // live-sync runs (use-picking-marker onProbe) — one poll, no second fetch.
  const [connected, setConnected] = useState(true);

  // Search (committed on Enter) + filters. Both are client-side over already-
  // loaded data (design §5.2/§5.3) — no refetch, no new route.
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<FloorFilters>(EMPTY_FILTERS);

  const [topTab, setTopTab] = useState<TopTab>("floor");
  const [slotTab, setSlotTab] = useState<SlotTabKey>("10:30");
  const [mode, setMode] = useState<"flat" | "route">("flat");
  const [viewMode, setViewMode] = useState<"live" | "history">("live");
  const [histDate, setHistDate] = useState<string | null>(null);

  // Selection (design §7.8) — a Set of orderIds; survives a re-sort, cleared on
  // any tab/scope/date change below.
  const [selection, setSelection] = useState<FloorSelection>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSideError(null);
    try {
      const params = new URLSearchParams({ scope });
      if (viewMode === "history" && histDate) {
        params.set("mode", "history");
        params.set("date", histDate);
      }
      // Board + hold + cancelled — three independent GET routes, fetched together
      // (parallel client fetches, not a prisma $transaction). Hold/Cancelled are
      // pure open states (no date anchor), so they ignore the history params.
      const scopeQs = new URLSearchParams({ scope }).toString();
      const [boardRes, holdRes, cancRes] = await Promise.all([
        fetch(`/api/floor/board?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/floor/hold?${scopeQs}`, { cache: "no-store" }),
        fetch(`/api/floor/cancelled?${scopeQs}`, { cache: "no-store" }),
      ]);
      if (!boardRes.ok) throw new Error(`HTTP ${boardRes.status}`);
      const board = await boardRes.json();
      setData({ rail: board.rail ?? [], floor: board.floor, pickers: board.pickers ?? [] });

      // A failed side feed must not blank the board — surface its own error and
      // leave the tab empty rather than throwing the whole page away.
      if (holdRes.ok) setHoldRows(((await holdRes.json()).rows ?? []) as FloorHoldRow[]);
      else { setHoldRows([]); setSideError(`Hold feed HTTP ${holdRes.status}`); }
      if (cancRes.ok) setCancelledRows(((await cancRes.json()).rows ?? []) as FloorCancelledRow[]);
      else { setCancelledRows([]); setSideError((prev) => prev ?? `Cancelled feed HTTP ${cancRes.status}`); }
      setLastSyncedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
      setHoldRows(null);
      setCancelledRows(null);
    } finally {
      setLoading(false);
    }
  }, [scope, viewMode, histDate]);

  useEffect(() => {
    void load();
  }, [load]);

  // Selection does NOT survive a tab/scope/date change (design §7.8). Includes
  // the top tab: switching away from Floor drops the floor selection (Hold and
  // Cancelled own their own selection internally).
  useEffect(() => {
    setSelection(new Set());
  }, [slotTab, scope, viewMode, histDate, topTab]);

  const clearSelection = () => setSelection(new Set());

  const rows = data?.floor.rows ?? [];
  const selectedRows = rows.filter((r) => selection.has(r.orderId));
  const selectedIds = selectedRows.map((r) => r.orderId);

  // ── Release + rail actions ────────────────────────────────────────────────
  const handleRelease = useCallback(
    async (orderId: number, slot: RailReleaseSlot) => {
      const r = await postJson("/api/floor/release", { releases: [{ orderId, ...slot }] });
      reportWrite("Release", r);
      await load();
    },
    [load],
  );
  const railHold = useCallback(
    async (orderId: number) => {
      const r = await postJson("/api/floor/actions", { action: "hold", orderIds: [orderId] });
      reportWrite("Hold", r);
      await load();
    },
    [load],
  );
  const railCancel = useCallback(
    async (orderId: number) => {
      const r = await postJson("/api/floor/actions", { action: "cancel", orderIds: [orderId] });
      reportWrite("Cancel", r);
      await load();
    },
    [load],
  );

  // Row ⚡ — per-bill urgent TOGGLE (no `urgent` field → route flips it).
  const rowMarkUrgent = useCallback(
    async (orderId: number) => {
      const r = await postJson("/api/floor/actions", { action: "mark-urgent", orderIds: [orderId] });
      reportWrite("Urgent", r);
      await load();
    },
    [load],
  );

  const onToggleRow = useCallback((id: number) => setSelection((s) => toggleOne(s, id)), []);
  const onToggleAll = useCallback((tableRows: FloorBoardRow[]) => setSelection((s) => toggleAllRows(s, tableRows)), []);

  // ── Bulk bar actions ──────────────────────────────────────────────────────
  const bulkMarkUrgent = async () => {
    if (selectedIds.length === 0) return;
    const r = await postJson("/api/floor/actions", { action: "mark-urgent", orderIds: selectedIds, urgent: true });
    reportWrite("Urgent", r);
    clearSelection();
    await load();
  };
  const bulkHold = async () => {
    if (selectedIds.length === 0) return;
    const r = await postJson("/api/floor/actions", { action: "hold", orderIds: selectedIds });
    reportWrite("Hold", r);
    clearSelection();
    await load();
  };
  const bulkChangeSlot = async (date: string, windowId: number) => {
    if (selectedIds.length === 0) return;
    const r = await postJson("/api/floor/actions", { action: "change-slot", orderIds: selectedIds, dispatchTargetDate: date, dispatchWindowId: windowId });
    reportWrite("Change slot", r);
    clearSelection();
    await load();
  };

  // Assignment REUSES the Picking endpoints unchanged. Assign/Reassign = put
  // every selected bill under the chosen picker: unassign any already-assigned
  // ones first (so they are back at pending_picking), then one assign batch.
  const bulkAssign = async (pickerId: number) => {
    if (selectedRows.length === 0) return;
    const alreadyAssigned = selectedRows.filter((r) => r.isAssigned).map((r) => r.orderId);
    for (const orderId of alreadyAssigned) {
      reportWrite("Unassign", await postJson("/api/picking/unassign", { orderId }));
    }
    reportWrite("Assign", await postJson("/api/picking/assign", { orderIds: selectedIds, pickerId }));
    clearSelection();
    await load();
  };
  const bulkUnassign = async () => {
    const alreadyAssigned = selectedRows.filter((r) => r.isAssigned).map((r) => r.orderId);
    for (const orderId of alreadyAssigned) {
      reportWrite("Unassign", await postJson("/api/picking/unassign", { orderId }));
    }
    clearSelection();
    await load();
  };

  // ── Hold tab: bulk release → the floor (reuses the Step-3 release route). ──
  // Each ticked bill gets the SAME chosen date+window; the route advances it to
  // pending_picking with dispatchStatus="dispatch", so it leaves Hold and lands
  // on the floor like any other released bill. A held-after-auto-dispatch bill is
  // already at pending_picking — accepted via FLOOR_RELEASABLE_STAGES.
  const holdRelease = useCallback(
    async (orderIds: number[], date: string, windowId: number) => {
      const releases = orderIds.map((orderId) => ({ orderId, dispatchTargetDate: date, dispatchWindowId: windowId }));
      const r = await postJson("/api/floor/release", { releases });
      reportWrite("Release", r);
      await load();
    },
    [load],
  );

  // ── Cancelled tab: bulk restore → back to the left rail (Step-5 actions). ──
  const cancelledRestore = useCallback(
    async (orderIds: number[]) => {
      const r = await postJson("/api/floor/actions", { action: "restore", orderIds });
      reportWrite("Restore", r);
      await load();
    },
    [load],
  );

  // ── Search + filter (client-side, design §5.2/§5.3) ─────────────────────────
  const parsed = useMemo(() => parseSearch(searchQuery), [searchQuery]);

  // Floor: search + Status/Flags filter. Rows re-derived and windows/total
  // recomputed so the slot tabs + Floor count reflect exactly what is shown.
  const filteredFloor = useMemo<FloorBoardResult | null>(() => {
    if (!data) return null;
    const fRows = applyFloorFilters(applySearch(data.floor.rows, parsed), filters);
    const due = fRows.filter((r) => r.zone !== "upcoming");
    const windows = data.floor.windows.map((w) => ({ ...w, count: due.filter((r) => r.windowId === w.id).length }));
    return { ...data.floor, rows: fRows, windows, total: due.length };
  }, [data, parsed, filters]);

  // Hold / Cancelled: search + Flags only (Status is a floor-only concept).
  const filteredHold = useMemo<FloorHoldRow[] | null>(
    () => (holdRows ? applyFlagFilters(applySearch(holdRows, parsed), filters) : null),
    [holdRows, parsed, filters],
  );
  const filteredCancelled = useMemo<FloorCancelledRow[] | null>(
    () => (cancelledRows ? applyFlagFilters(applySearch(cancelledRows, parsed), filters) : null),
    [cancelledRows, parsed, filters],
  );

  // The rail is NEVER filtered (design §6.1) — it is the undecided pile and must
  // stay complete. Search only HIGHLIGHTS matching rail cards.
  const railHighlightIds = useMemo<Set<number>>(() => {
    if (parsed.mode === "none" || !data) return new Set<number>();
    return new Set(applySearch(data.rail, parsed).map((c) => c.orderId));
  }, [parsed, data]);

  // The open tab's pool + report for the hits strip (chips / summary).
  const dueFloorRows = useMemo(() => (data?.floor.rows ?? []).filter((r) => r.zone !== "upcoming"), [data]);
  const activePool: Searchable[] = topTab === "floor" ? dueFloorRows : topTab === "hold" ? holdRows ?? [] : cancelledRows ?? [];
  const tabSearchReport = useMemo(() => searchReport(activePool, parsed), [activePool, parsed]);

  const commitSearch = useCallback(
    (raw: string) => {
      setSearchQuery(raw);
      const p = parseSearch(raw);
      // Auto-tick (design §5.2) — ONLY on the Floor tab, and ONLY selectable rows
      // (Waiting / With picker, Step 5). A pasted number matching a Done or
      // Needs-check row is still found + shown, but never ticked.
      if (p.mode === "numbers" && topTab === "floor" && data) {
        const due = data.floor.rows.filter((r) => r.zone !== "upcoming");
        const ids = applySearch(due, p).filter(isSelectable).map((r) => r.orderId);
        setSelection(new Set(ids));
      } else {
        setSelection(new Set());
      }
    },
    [topTab, data],
  );
  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSelection(new Set());
  }, []);

  // ── Detail panel (design §10) — open state + single-bill action handlers ──
  // Additive wiring only: the panel is mounted at the end; every write REUSES an
  // existing route through reportWrite (no swallowed response, no new route).
  const [detail, setDetail] = useState<{ orderId: number; source: FloorDetailSource } | null>(null);
  const openDetail = useCallback((orderId: number, src: FloorDetailSource) => setDetail({ orderId, source: src }), []);
  const closeDetail = useCallback(() => setDetail(null), []);
  const navigateDetail = useCallback((orderId: number) => setDetail((d) => (d ? { ...d, orderId } : d)), []);

  // The list Prev/Next walks — whichever source the panel was opened from
  // (design §10.5). Rebuilt on every board reload so it tracks the live order.
  // Prev/Next walks the VISIBLE (searched/filtered) list of the source surface,
  // except the rail which is never filtered (design §6.1).
  const detailList = useMemo<number[]>(() => {
    if (!detail) return [];
    switch (detail.source) {
      case "rail":
        return (data?.rail ?? []).map((c) => c.orderId);
      case "floor":
        return (filteredFloor?.rows ?? []).filter((r) => r.zone !== "upcoming").map((r) => r.orderId);
      case "hold":
        return (filteredHold ?? []).map((r) => r.orderId);
      case "cancelled":
        return (filteredCancelled ?? []).map((r) => r.orderId);
    }
  }, [detail, data, filteredFloor, filteredHold, filteredCancelled]);

  const detailActions: DetailActions = useMemo(
    () => ({
      onRelease: async (orderId, date, windowId) => {
        const r = await postJson("/api/floor/release", { releases: [{ orderId, dispatchTargetDate: date, dispatchWindowId: windowId }] });
        reportWrite("Release", r);
        await load();
      },
      // Ship-to change REUSES Support's override write as a CALLER — that route
      // uses $transaction (CORE §3), but this Floor file does not. Floor v1 users
      // (admin + operations) both pass Support's route gate.
      onChangeShipTo: async (orderId, customerId) => {
        const r = await postJson(`/api/support/orders/${orderId}`, { shipToOverrideCustomerId: customerId }, "PATCH");
        reportWrite("Change ship-to", r);
        await load();
      },
      onUpdateSlot: async (orderId, date, windowId) => {
        const r = await postJson("/api/floor/actions", { action: "change-slot", orderIds: [orderId], dispatchTargetDate: date, dispatchWindowId: windowId });
        reportWrite("Update slot", r);
        await load();
      },
      // Reassign = unassign (only if the bill already has a picker) then assign,
      // reusing the Picking endpoints. The current assignment is read from the
      // live floor rows so a Waiting bill isn't sent a spurious unassign (409).
      onReassign: async (orderId, pickerId) => {
        const row = (data?.floor.rows ?? []).find((x) => x.orderId === orderId);
        if (row?.isAssigned) {
          reportWrite("Unassign", await postJson("/api/picking/unassign", { orderId }));
        }
        reportWrite("Assign", await postJson("/api/picking/assign", { orderIds: [orderId], pickerId }));
        await load();
      },
      onRestore: async (orderId) => {
        reportWrite("Restore", await postJson("/api/floor/actions", { action: "restore", orderIds: [orderId] }));
        await load();
      },
      onHold: async (orderId) => {
        reportWrite("Hold", await postJson("/api/floor/actions", { action: "hold", orderIds: [orderId] }));
        await load();
      },
      onCancel: async (orderId) => {
        reportWrite("Cancel", await postJson("/api/floor/actions", { action: "cancel", orderIds: [orderId] }));
        await load();
      },
      onUnassign: async (orderId) => {
        reportWrite("Unassign", await postJson("/api/picking/unassign", { orderId }));
        await load();
      },
    }),
    [load, data],
  );

  // ── History navigation ────────────────────────────────────────────────────
  const enterHistory = useCallback(() => {
    setHistDate(addDaysIso(istTodayIso(), -1));
    setViewMode("history");
  }, []);
  const exitHistory = useCallback(() => setViewMode("live"), []);
  const stepHistory = useCallback((delta: number) => {
    setHistDate((cur) => {
      if (!cur) return cur;
      const next = addDaysIso(cur, delta);
      const yesterday = addDaysIso(istTodayIso(), -1);
      if (delta > 0 && next > yesterday) return cur;
      return next;
    });
  }, []);

  // ── Live sync (design §13) — TWO different mechanisms, no shared abstraction ─
  const detailOpen = detail !== null;
  const isLive = viewMode === "live";

  // Reconcile the floor SELECTION against fresh data WITHOUT moving the visible
  // board (design §13 rules 2 + 3): drop the tick on any selected row that
  // changed elsewhere and say so, but never re-render/re-sort the rows he is
  // reaching for. A read-only GET — no orders.update anywhere.
  const reconcileSelection = useCallback(async () => {
    try {
      const res = await fetch(`/api/floor/board?${new URLSearchParams({ scope }).toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const board = await res.json();
      const stillSelectable = new Set<number>(
        (board.floor?.rows ?? [])
          .filter((r: FloorBoardRow) => r.zone !== "upcoming" && isSelectable(r))
          .map((r: FloorBoardRow) => r.orderId),
      );
      setSelection((prev) => {
        const next = new Set<number>();
        let dropped = 0;
        for (const id of Array.from(prev)) {
          if (stillSelectable.has(id)) next.add(id);
          else dropped++;
        }
        if (dropped > 0) {
          toast.info(`${dropped} selected bill${dropped === 1 ? "" : "s"} changed elsewhere — unticked`);
          return next;
        }
        return prev;
      });
      setLastSyncedAt(new Date());
    } catch {
      /* silent — the connection strip owns the "not connected" surface */
    }
  }, [scope]);

  // FLOOR — the Picking pattern: use-picking-marker, pointed at the floor's OWN
  // marker (/api/floor/marker) via the optional `url` param, so it watches the
  // floor's EXACT set (getFloorLiveMarkerWhere) — no silent dependence on what
  // picking's openPending scope means. `scope` is required by the hook's type but
  // ignored by the floor marker route (fixed set). `onProbe` feeds the connection
  // strip off this same 15s poll — one probe powers both. Deferred while the
  // detail panel is open or in read-only history.
  usePickingMarker({
    scope: "openPending",
    url: "/api/floor/marker",
    paused: !isLive || detailOpen,
    onProbe: setConnected,
    onChange: () => {
      if (!isLive) return;
      // Rule 2: never move the ground while rows are selected — reconcile the
      // ticks only. Rule 1: otherwise refresh in place (rows keyed by orderId).
      if (selection.size > 0) void reconcileSelection();
      else void load();
    },
  });

  // RAIL — the Mail Orders pattern: a 30s full refetch. Paused while a selection
  // is up or the panel is open (a refetch would move the floor ground) or history.
  useFloorRailPoll({
    paused: !isLive || detailOpen || selection.size > 0,
    onTick: () => void load(),
  });

  const dispatchWindows: DispatchWindow[] = (data?.floor.windows ?? []).map((w) => ({
    id: w.id,
    windowTime: w.windowTime,
    label: null,
  }));

  const now = new Date();
  const dateStr = now
    .toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })
    .replace(",", "");
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

  const barVisible = topTab === "floor" && viewMode === "live" && selection.size > 0 && data !== null;

  // Tab counts reflect the searched/filtered set of each surface (they equal the
  // full totals when no search/filter is active).
  const floorCount = filteredFloor?.total ?? 0;
  const holdCount = filteredHold?.length ?? 0;
  const cancelledCount = filteredCancelled?.length ?? 0;

  // Tab pill (Floor / On hold / Cancelled) — active is dark-underlined; the count
  // badge is dark on the active tab, grey otherwise.
  function tabPill(key: TopTab, label: string, count: number) {
    const on = topTab === key;
    return (
      <button
        type="button"
        onClick={() => setTopTab(key)}
        className={`flex items-center gap-1.5 border-b-2 py-3 text-[12px] ${
          on ? "border-gray-900 font-bold text-gray-900" : "border-transparent text-gray-400 hover:text-gray-600"
        }`}
      >
        {label}
        <span className={`rounded px-1.5 py-px text-[10px] font-bold ${on ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"}`}>
          {count}
        </span>
      </button>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      {/* ── Row 1 — title + date/time (design §5). ───────────────────────── */}
      <div className="flex h-11 items-center gap-2.5 border-b border-[#f0f0f0] px-4">
        <span className="text-[14.5px] font-semibold tracking-[-0.01em] text-gray-900">Floor Control</span>
        <span suppressHydrationWarning className="ml-auto text-[11px] text-gray-400" style={{ fontVariantNumeric: "tabular-nums" }}>
          {dateStr} &middot; {timeStr}
        </span>
      </div>

      {/* ── Row 2 — scope chips left; search + filter right (inert). ─────── */}
      <div className="flex h-[46px] items-center gap-3 border-b border-gray-200 bg-[#fcfcfd] px-4">
        <div className="inline-flex gap-[2px] rounded-[7px] bg-gray-100 p-[2px]">
          {SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`rounded-[5px] px-3 py-[5px] text-[11px] ${
                scope === s ? "bg-white font-semibold text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <SearchBox committed={searchQuery} onSearch={commitSearch} onClear={clearSearch} />
          <FilterSheet filters={filters} onChange={setFilters} showStatus={topTab === "floor"} />
        </div>
      </div>

      {/* Search results strip (design §5.2) — describes the OPEN tab's matches. */}
      <SearchHits parsed={parsed} report={tabSearchReport} onClear={clearSearch} />

      {/* Connection strip (design §13) — only in live mode; renders only when the
          server is unreachable. A strip, never a modal — the board stays readable. */}
      {isLive && <ConnectionStrip connected={connected} lastSyncedAt={lastSyncedAt} />}

      {/* ── Body — left rail (344px) + right main. ───────────────────────── */}
      <div className="grid min-h-0 flex-1 overflow-hidden" style={{ gridTemplateColumns: "344px 1fr" }}>
        <FloorRail
          cards={data?.rail ?? null}
          loading={loading}
          error={error}
          scope={scope}
          floorTotal={data?.floor.total ?? 0}
          windows={dispatchWindows}
          onRelease={handleRelease}
          onHold={railHold}
          onCancel={railCancel}
          onShowAll={() => setScope("All")}
          onOpenDetail={(id) => openDetail(id, "rail")}
          highlightIds={railHighlightIds}
        />

        {/* Right main — tabs + board + (bulk bar overlay). */}
        <div className="relative flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center gap-[18px] border-b border-gray-200 bg-white px-3.5">
            {tabPill("floor", "Floor", floorCount)}
            {tabPill("hold", "On hold", holdCount)}
            {tabPill("cancelled", "Cancelled", cancelledCount)}

            {topTab === "floor" && slotTab !== "all" && (
              <span className="ml-auto flex h-[27px] overflow-hidden rounded-[6px] border border-gray-200 bg-gray-50">
                {(["flat", "route"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`px-[11px] text-[11px] ${mode === m ? "bg-white font-semibold text-gray-900" : "text-gray-500"}`}
                  >
                    {m === "flat" ? "Flat" : "By route"}
                  </button>
                ))}
              </span>
            )}
          </div>

          {topTab === "floor" ? (
            loading && !data ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <FloorSkeleton variant="floor" />
              </div>
            ) : error && !data ? (
              <div className="px-5 py-14 text-center text-[11.5px] text-gray-400">Couldn&rsquo;t load the floor. {error}</div>
            ) : filteredFloor ? (
              <FloorBoard
                floor={filteredFloor}
                slotTab={slotTab}
                onSlotTab={setSlotTab}
                mode={mode}
                histDate={histDate}
                onEnterHistory={enterHistory}
                onExitHistory={exitHistory}
                onStepHistory={stepHistory}
                selection={selection}
                onToggleRow={onToggleRow}
                onToggleAll={onToggleAll}
                onMarkUrgent={rowMarkUrgent}
                onOpenDetail={(id) => openDetail(id, "floor")}
              />
            ) : null
          ) : topTab === "hold" ? (
            <HoldTab
              rows={filteredHold}
              loading={loading && filteredHold === null}
              error={error ?? sideError}
              scope={scope}
              windows={dispatchWindows}
              onRelease={holdRelease}
              onOpenDetail={(id) => openDetail(id, "hold")}
            />
          ) : (
            <CancelledTab
              rows={filteredCancelled}
              loading={loading && filteredCancelled === null}
              error={error ?? sideError}
              scope={scope}
              onRestore={cancelledRestore}
              onOpenDetail={(id) => openDetail(id, "cancelled")}
            />
          )}

          {barVisible && (
            <AssignBar
              selectedRows={selectedRows}
              pickers={data!.pickers}
              windows={dispatchWindows}
              onAssign={bulkAssign}
              onUnassign={bulkUnassign}
              onMarkUrgent={bulkMarkUrgent}
              onHold={bulkHold}
              onChangeSlot={bulkChangeSlot}
              onClear={clearSelection}
            />
          )}
        </div>
      </div>

      {/* Detail panel (design §10) — slides over the board from any surface. */}
      {detail && (
        <DetailPanel
          orderId={detail.orderId}
          source={detail.source}
          list={detailList}
          windows={dispatchWindows}
          pickers={data?.pickers ?? []}
          actions={detailActions}
          onClose={closeDetail}
          onNavigate={navigateDetail}
        />
      )}
    </div>
  );
}
