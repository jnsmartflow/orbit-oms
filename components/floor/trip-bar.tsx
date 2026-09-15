"use client";

// Floor Control — THE TRIP BAR and its legend (floor redesign, 2026-09-15).
//
// A TRIP-ONLY bar, four segments, used by the rail card and the trip detail
// panel. NOT progress-bar.tsx: that one has nine segments and is still used by
// route-row.tsx on the pool's By route view, which this redesign does not touch.
//
// 🔴 THE MAPPING IS AN OWNER DECISION, from the trip's own buckets
// (TripBillCounts, lib/trips/queries.ts):
//
//   green  done          = checked + dispatched
//   blue   being picked  = with picker + picked-not-checked
//   grey   waiting       = waiting + other
//   amber  on hold       = held
//
// ⚠ AMBER MEANS "ON HOLD" HERE, not "needs check" as on the older bar. On this
// screen amber means someone has to do something (the same amber as "No driver
// yet"). The picking screens keep their own colours.
//
// ⚠ HELD BILLS HAVE A SEGMENT, and every bucket must: the segments are
// flex-weighted by bill count, so the four always fill the full width. A bucket
// with no segment would make the bar stop short and read as broken — which is
// exactly what the older bar did for held bills.

import type { TripSummary } from "@/lib/trips/queries";

export interface TripBarCounts {
  done: number;
  picking: number;
  waiting: number;
  held: number;
  total: number;
}

/** The four buckets, from the trip's own counts. `checked` already includes dispatched bills. */
export function tripBarCounts(c: TripSummary["counts"]): TripBarCounts {
  return {
    done: c.checked,
    picking: c.withPicker + c.picked,
    waiting: c.waiting + c.other,
    held: c.held,
    total: c.total,
  };
}

// Exact colours from the locked design file (owner, 2026-09-15).
const SEGMENTS: Array<{ key: keyof Omit<TripBarCounts, "total">; color: string; label: string }> = [
  { key: "done", color: "#2eb862", label: "done" },
  { key: "picking", color: "#5b8ded", label: "being picked" },
  { key: "waiting", color: "#d3d3dd", label: "waiting" },
  { key: "held", color: "#e0a832", label: "on hold" },
];

/**
 * The segmented bar, full width of its container. Nothing on an empty trip.
 *
 * ONE SIZE EVERYWHERE — the rail card and the detail panel use it unchanged
 * (owner): 7px tall, 4px radius, a 1.5px gap BETWEEN segments so they never fuse
 * into one solid block, and a light #f1f1f5 track behind them.
 */
export function TripBar({ counts, className = "" }: { counts: TripBarCounts; className?: string }) {
  if (counts.total === 0) return null;
  return (
    <span className={`flex h-[7px] w-full gap-[1.5px] overflow-hidden rounded-[4px] bg-[#f1f1f5] ${className}`}>
      {SEGMENTS.map((s) =>
        counts[s.key] > 0 ? (
          <span key={s.key} className="h-full" style={{ flexGrow: counts[s.key], flexBasis: 0, background: s.color }} />
        ) : null,
      )}
    </span>
  );
}

/**
 * "● 5 done  ● 3 being picked  ● 1 waiting" — only the segments that exist.
 * "nothing pending" follows when no bill is being picked or waiting (owner: an
 * empty-looking legend is confusing).
 */
export function TripBarLegend({ counts, className = "" }: { counts: TripBarCounts; className?: string }) {
  if (counts.total === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] tabular-nums text-gray-600 ${className}`}>
      {SEGMENTS.map((s) =>
        counts[s.key] > 0 ? (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            <b className="font-bold text-gray-900">{counts[s.key]}</b>
            {s.label}
          </span>
        ) : null,
      )}
      {counts.picking === 0 && counts.waiting === 0 && <span className="text-gray-400">nothing pending</span>}
    </div>
  );
}
