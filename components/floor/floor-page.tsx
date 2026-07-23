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

import { useState, useEffect, useCallback } from "react";
import { Search, Filter } from "lucide-react";
import { FloorRail } from "./floor-rail";
import { FloorBoard } from "./floor-board";
import { FloorSkeleton } from "./floor-skeleton";
import { AssignBar } from "./assign-bar";
import { toggleOne, toggleAll as toggleAllRows, type FloorSelection } from "@/lib/floor/selection";
import type { RailReleaseSlot } from "./rail-card";
import type { DispatchWindow } from "@/components/support/dispatch-slot-picker";
import type { FloorRailCard, FloorScope, FloorBoardResult, FloorBoardRow, FloorPicker } from "@/lib/floor/types";
import type { SlotTabKey } from "./floor-tabs";

const SCOPES: FloorScope[] = ["All", "Local", "Upcountry", "IGT"];

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

async function postJson(url: string, payload: unknown): Promise<void> {
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}

export function FloorPage() {
  const [scope, setScope] = useState<FloorScope>("All");
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const params = new URLSearchParams({ scope });
      if (viewMode === "history" && histDate) {
        params.set("mode", "history");
        params.set("date", histDate);
      }
      const res = await fetch(`/api/floor/board?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData({ rail: json.rail ?? [], floor: json.floor, pickers: json.pickers ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [scope, viewMode, histDate]);

  useEffect(() => {
    void load();
  }, [load]);

  // Selection does NOT survive a tab/scope/date change (design §7.8).
  useEffect(() => {
    setSelection(new Set());
  }, [slotTab, scope, viewMode, histDate]);

  const clearSelection = () => setSelection(new Set());

  const rows = data?.floor.rows ?? [];
  const selectedRows = rows.filter((r) => selection.has(r.orderId));
  const selectedIds = selectedRows.map((r) => r.orderId);

  // ── Release + rail actions ────────────────────────────────────────────────
  const handleRelease = useCallback(
    async (orderId: number, slot: RailReleaseSlot) => {
      try {
        await postJson("/api/floor/release", { releases: [{ orderId, ...slot }] });
      } finally {
        void load();
      }
    },
    [load],
  );
  const railHold = useCallback(
    async (orderId: number) => {
      await postJson("/api/floor/actions", { action: "hold", orderIds: [orderId] });
      await load();
    },
    [load],
  );
  const railCancel = useCallback(
    async (orderId: number) => {
      await postJson("/api/floor/actions", { action: "cancel", orderIds: [orderId] });
      await load();
    },
    [load],
  );

  // Row ⚡ — per-bill urgent TOGGLE (no `urgent` field → route flips it).
  const rowMarkUrgent = useCallback(
    async (orderId: number) => {
      await postJson("/api/floor/actions", { action: "mark-urgent", orderIds: [orderId] });
      await load();
    },
    [load],
  );

  const onToggleRow = useCallback((id: number) => setSelection((s) => toggleOne(s, id)), []);
  const onToggleAll = useCallback((tableRows: FloorBoardRow[]) => setSelection((s) => toggleAllRows(s, tableRows)), []);

  // ── Bulk bar actions ──────────────────────────────────────────────────────
  const bulkMarkUrgent = async () => {
    if (selectedIds.length === 0) return;
    await postJson("/api/floor/actions", { action: "mark-urgent", orderIds: selectedIds, urgent: true });
    clearSelection();
    await load();
  };
  const bulkHold = async () => {
    if (selectedIds.length === 0) return;
    await postJson("/api/floor/actions", { action: "hold", orderIds: selectedIds });
    clearSelection();
    await load();
  };
  const bulkChangeSlot = async (date: string, windowId: number) => {
    if (selectedIds.length === 0) return;
    await postJson("/api/floor/actions", { action: "change-slot", orderIds: selectedIds, dispatchTargetDate: date, dispatchWindowId: windowId });
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
      await postJson("/api/picking/unassign", { orderId });
    }
    await postJson("/api/picking/assign", { orderIds: selectedIds, pickerId });
    clearSelection();
    await load();
  };
  const bulkUnassign = async () => {
    const alreadyAssigned = selectedRows.filter((r) => r.isAssigned).map((r) => r.orderId);
    for (const orderId of alreadyAssigned) {
      await postJson("/api/picking/unassign", { orderId });
    }
    clearSelection();
    await load();
  };

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

  const barVisible = viewMode === "live" && selection.size > 0 && data !== null;

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
          <div className="flex h-[30px] w-[260px] items-center gap-[7px] rounded-[7px] border border-gray-200 bg-white px-[9px] text-[11.5px] text-gray-400">
            <Search size={13} className="flex-shrink-0 text-gray-400" />
            <span>Search name, or paste numbers</span>
          </div>
          <button type="button" className="flex h-[30px] items-center gap-1.5 rounded-[7px] border border-gray-200 bg-white px-[11px] text-[11.5px] text-gray-500">
            <Filter size={13} />
            Filter
          </button>
        </div>
      </div>

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
        />

        {/* Right main — tabs + board + (bulk bar overlay). */}
        <div className="relative flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center gap-[18px] border-b border-gray-200 bg-white px-3.5">
            <span className="flex items-center gap-1.5 border-b-2 border-gray-900 py-3 text-[12px] font-bold text-gray-900">
              Floor
              <span className="rounded bg-gray-900 px-1.5 py-px text-[10px] font-bold text-white">{data?.floor.total ?? 0}</span>
            </span>
            <span className="border-b-2 border-transparent py-3 text-[12px] text-gray-400">On hold</span>
            <span className="border-b-2 border-transparent py-3 text-[12px] text-gray-400">Cancelled</span>

            {slotTab !== "all" && (
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

          {loading && !data ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <FloorSkeleton variant="floor" />
            </div>
          ) : error && !data ? (
            <div className="px-5 py-14 text-center text-[11.5px] text-gray-400">Couldn&rsquo;t load the floor. {error}</div>
          ) : data ? (
            <FloorBoard
              floor={data.floor}
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
            />
          ) : null}

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
    </div>
  );
}
