"use client";

// Floor Control composition root. Step 3 wires the LEFT RAIL only: fetches
// /api/floor/board, lifts the delivery-type scope, mounts <FloorRail/>, and
// owns the release handler. The hand-rolled header (Step 1) and the right main
// pane (still skeleton until Step 4) are unchanged in structure — additive
// wiring only. Layout/copy authority: docs/mockups/floor-control/01-board.html.

import { useState, useEffect, useCallback } from "react";
import { Search, Filter } from "lucide-react";
import { FloorRail } from "./floor-rail";
import { FloorSkeleton } from "./floor-skeleton";
import type { RailReleaseSlot } from "./rail-card";
import type { DispatchWindow } from "@/components/support/dispatch-slot-picker";
import type { FloorRailCard, FloorScope, FloorWindowCount } from "@/lib/floor/types";

const SCOPES: FloorScope[] = ["All", "Local", "Upcountry", "IGT"];
const TABS = ["Floor", "On hold", "Cancelled"] as const;

interface BoardData {
  rail: FloorRailCard[];
  windows: FloorWindowCount[];
  floorTotal: number;
}

export function FloorPage() {
  const [scope, setScope] = useState<FloorScope>("All");
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/floor/board?scope=${scope}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData({ rail: json.rail ?? [], windows: json.floor?.windows ?? [], floorTotal: json.floor?.total ?? 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRelease = useCallback(
    async (orderId: number, slot: RailReleaseSlot) => {
      try {
        await fetch("/api/floor/release", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ releases: [{ orderId, ...slot }] }),
        });
      } finally {
        // Re-fetch either way; the released card leaves the rail on success.
        void load();
      }
    },
    [load],
  );

  const dispatchWindows: DispatchWindow[] = (data?.windows ?? []).map((w) => ({
    id: w.id,
    windowTime: w.windowTime,
    label: null,
  }));

  // Row 1 date + time (design §5). Computed at render; no ticking clock widget.
  const now = new Date();
  const dateStr = now
    .toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })
    .replace(",", "");
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      {/* ── Row 1 — title + date/time. Nothing else (design §5). ─────────── */}
      <div className="flex h-11 items-center gap-2.5 border-b border-[#f0f0f0] px-4">
        <span className="text-[14.5px] font-semibold tracking-[-0.01em] text-gray-900">Floor Control</span>
        <span
          suppressHydrationWarning
          className="ml-auto text-[11px] text-gray-400"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {dateStr} &middot; {timeStr}
        </span>
      </div>

      {/* ── Row 2 — scope chips left (live); search + filter right (inert). ─ */}
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
          {/* Search — inert placeholder (real box arrives in a later step). */}
          <div className="flex h-[30px] w-[260px] items-center gap-[7px] rounded-[7px] border border-gray-200 bg-white px-[9px] text-[11.5px] text-gray-400">
            <Search size={13} className="flex-shrink-0 text-gray-400" />
            <span>Search name, or paste numbers</span>
          </div>
          {/* Filter — inert placeholder. */}
          <button
            type="button"
            className="flex h-[30px] items-center gap-1.5 rounded-[7px] border border-gray-200 bg-white px-[11px] text-[11.5px] text-gray-500"
          >
            <Filter size={13} />
            Filter
          </button>
        </div>
      </div>

      {/* ── Body — left rail (344px) + right main (design §3 two-pane). ──── */}
      <div className="grid min-h-0 flex-1 overflow-hidden" style={{ gridTemplateColumns: "344px 1fr" }}>
        <FloorRail
          cards={data?.rail ?? null}
          loading={loading}
          error={error}
          scope={scope}
          floorTotal={data?.floorTotal ?? 0}
          windows={dispatchWindows}
          onRelease={handleRelease}
          onShowAll={() => setScope("All")}
        />

        {/* Right main — floor / hold / cancelled (still skeleton until Step 4). */}
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center gap-[18px] border-b border-gray-200 bg-white px-3.5">
            {TABS.map((t, i) => (
              <span
                key={t}
                className={`border-b-2 py-3 text-[12px] ${
                  i === 0 ? "border-gray-900 font-bold text-gray-900" : "border-transparent text-gray-500"
                }`}
              >
                {t}
              </span>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FloorSkeleton variant="floor" />
          </div>
        </div>
      </div>
    </div>
  );
}
