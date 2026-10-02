"use client";

// Freight Trips — the Held bills pool. Floor's held set (via /api/freight-trips/pool,
// which is getFloorHold) minus bills already on an active freight trip, drawn by
// the SHARED held-bills table (components/floor/hold-table.tsx, imported as-is).
//
//   Flat     — one HoldTable.
//   By route — one header row per route ("{n} bills · {L} L · oldest held …")
//              with its own select-all, expandable to a HoldTable of its bills.

import { useMemo, useState } from "react";
import { HoldTable } from "@/components/floor/hold-table";
import { formatLitres } from "@/components/floor/status-pill";
import { heldSinceLabel, holdAgeDays } from "@/lib/floor/hold-log";
import { loadLitres } from "@/lib/orders/gift";
import { isAllIdsSelected, toggleAllIds, toggleOne, type FloorSelection } from "@/lib/floor/selection";
import type { FloorHoldRow } from "@/lib/floor/types";

type Pivot = "flat" | "route";

export function PoolView({
  rows,
  loading,
  error,
  selection,
  onSelection,
  selectable,
  title,
}: {
  rows: FloorHoldRow[];
  loading: boolean;
  error: string | null;
  selection: FloorSelection;
  onSelection: (next: FloorSelection) => void;
  selectable: boolean;
  /** Overrides the header line (the add band passes its own). */
  title?: string;
}) {
  const [pivot, setPivot] = useState<Pivot>("flat");
  const now = useMemo(() => new Date(), [rows]);

  const groups = useMemo(() => {
    const byRoute = new Map<string, FloorHoldRow[]>();
    for (const r of rows) {
      const key = r.route ?? "No route";
      const list = byRoute.get(key) ?? [];
      list.push(r);
      byRoute.set(key, list);
    }
    // Most bills first; "No route" always last.
    return Array.from(byRoute.entries()).sort(([a, ra], [b, rb]) => {
      if (a === "No route") return 1;
      if (b === "No route") return -1;
      return rb.length - ra.length || a.localeCompare(b);
    });
  }, [rows]);

  const seg = (on: boolean) => `px-[11px] text-[11px] ${on ? "bg-white font-semibold text-ink-900" : "text-ink-500"}`;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-2.5">
        <div className="min-w-0">
          <span className="text-[15px] font-semibold text-ink-900">Held bills {rows.length}</span>
          <span className="ml-2 text-[12px] text-ink-500">{title ?? "— not on a freight trip yet"}</span>
        </div>
        <span className="ml-auto flex h-[27px] shrink-0 overflow-hidden rounded-[6px] border border-ink-100 bg-ink-50">
          <button type="button" className={seg(pivot === "flat")} onClick={() => setPivot("flat")}>Flat</button>
          <button type="button" className={seg(pivot === "route")} onClick={() => setPivot("route")}>By route</button>
        </span>
      </div>

      {loading && rows.length === 0 ? (
        <div className="px-5 py-14 text-center text-[11.5px] text-ink-400">Loading held bills…</div>
      ) : error ? (
        <div className="px-5 py-14 text-center text-[11.5px] text-ink-400">Couldn&rsquo;t load held bills. {error}</div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <h4 className="text-[13px] font-semibold text-ink-900">No held bills to plan</h4>
          <p className="mt-1.5 text-[11.5px] text-ink-400">Every held bill is already on a freight trip, or nothing is on hold.</p>
        </div>
      ) : pivot === "flat" ? (
        <div className="overflow-x-auto">
          <div className="min-w-[1080px]">
            <HoldTable
              rows={rows}
              now={now}
              selectable={selectable}
              selection={selection}
              onToggleRow={(id) => onSelection(toggleOne(selection, id))}
              onToggleAll={(rs) => onSelection(toggleAllIds(selection, rs))}
            />
          </div>
        </div>
      ) : (
        groups.map(([route, list]) => (
          <RouteGroup
            key={route}
            route={route}
            rows={list}
            now={now}
            selectable={selectable}
            selection={selection}
            onSelection={onSelection}
          />
        ))
      )}
    </div>
  );
}

function RouteGroup({
  route,
  rows,
  now,
  selectable,
  selection,
  onSelection,
}: {
  route: string;
  rows: FloorHoldRow[];
  now: Date;
  selectable: boolean;
  selection: FloorSelection;
  onSelection: (next: FloorSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const litres = rows.reduce((s, r) => s + loadLitres(r.volumeLitres, r.isGift), 0);
  // Oldest hold = the largest age among rows with a known held-since.
  const ages = rows.map((r) => holdAgeDays(r.heldSince, now)).filter((d): d is number => d !== null);
  const oldest = ages.length > 0 ? heldSinceLabel(Math.max(...ages)) : "—";
  const allOn = isAllIdsSelected(selection, rows);

  return (
    <div className="border-b border-ink-100">
      <div className="flex items-center gap-3 bg-ink-25 px-4 py-2">
        {selectable && (
          <input
            type="checkbox"
            aria-label={`Select all held bills on ${route}`}
            className="h-[13px] w-[13px] cursor-pointer accent-brand-600"
            checked={allOn}
            onChange={() => onSelection(toggleAllIds(selection, rows))}
          />
        )}
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="text-ink-400">{open ? "▾" : "▸"}</span>
          <span className="truncate text-[13px] font-semibold text-ink-900">{route}</span>
          <span className="text-[12px] tabular-nums text-ink-500">
            {rows.length} bill{rows.length === 1 ? "" : "s"} · {formatLitres(litres)} L
          </span>
          <span className="ml-auto text-[11.5px] text-ink-400">oldest held {oldest}</span>
        </button>
      </div>
      {open && (
        <div className="overflow-x-auto">
          <div className="min-w-[1080px]">
            <HoldTable
              rows={rows}
              now={now}
              selectable={selectable}
              selection={selection}
              onToggleRow={(id) => onSelection(toggleOne(selection, id))}
              onToggleAll={(rs) => onSelection(toggleAllIds(selection, rs))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
