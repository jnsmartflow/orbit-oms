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
//   green  checked       = checked + dispatched
//   yellow needs check   = picked, not checked (pick_done)
//   blue   picking       = with picker (pick_assigned)
//   grey   waiting       = waiting + other
//   red    on hold       = held
//
// Was: pick_done shown blue with 'being picked' until 2026-09-22; now its own yellow segment. Do not revert.
// (Held was amber until the same day; it is now the "On hold" pill's red,
// ON_HOLD_SEGMENT in status-pill.tsx. The yellow is NEEDS_CHECK_SEGMENT,
// progress-bar.tsx — one value for every floor bar.)
//
// ⚠ HELD BILLS HAVE A SEGMENT, and every bucket must: the segments are
// flex-weighted by bill count, so the four always fill the full width. A bucket
// with no segment would make the bar stop short and read as broken — which is
// exactly what the older bar did for held bills.

import type { TripSummary } from "@/lib/trips/queries";
import { NEEDS_CHECK_SEGMENT } from "./progress-bar";
import { ON_HOLD_SEGMENT } from "./status-pill";

export interface TripBarCounts {
  done: number;
  /** Picked, not checked — pick_done (2026-09-22: its own segment). */
  needsCheck: number;
  /** With a picker — pick_assigned. Since 2026-09-22 this no longer includes picked bills. */
  picking: number;
  waiting: number;
  held: number;
  total: number;
}

/** The five buckets, from the trip's own counts. `checked` already includes dispatched bills. */
export function tripBarCounts(c: TripSummary["counts"]): TripBarCounts {
  return {
    done: c.checked,
    needsCheck: c.picked,
    picking: c.withPicker,
    waiting: c.waiting + c.other,
    held: c.held,
    total: c.total,
  };
}

// Green, blue and grey from the locked design file (owner, 2026-09-15);
// yellow and red are shared values (2026-09-22) — see the header.
const SEGMENTS: Array<{ key: keyof Omit<TripBarCounts, "total">; color: string; label: string }> = [
  { key: "done", color: "#2eb862", label: "Checked" },
  { key: "needsCheck", color: NEEDS_CHECK_SEGMENT, label: "Needs check" },
  { key: "picking", color: "#5b8ded", label: "Picking" },
  { key: "waiting", color: "#d3d3dd", label: "Waiting" },
  { key: "held", color: ON_HOLD_SEGMENT, label: "On hold" },
];

/**
 * The segmented bar, full width of its container. Nothing on an empty trip.
 *
 * ONE SIZE EVERYWHERE — the rail card and the detail panel use it unchanged
 * (owner): 7px tall, 4px radius, a 1.5px gap BETWEEN segments so they never fuse
 * into one solid block, and a light #f1f1f6 track behind them.
 */
export function TripBar({ counts, className = "" }: { counts: TripBarCounts; className?: string }) {
  if (counts.total === 0) return null;
  return (
    <span className={`flex h-[7px] w-full gap-[1.5px] overflow-hidden rounded-[4px] bg-[#f1f1f6] ${className}`}>
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
    <div className={`flex flex-wrap items-center gap-x-[15px] gap-y-1 text-[12.5px] tabular-nums text-[#61616d] ${className}`}>
      {SEGMENTS.map((s) =>
        counts[s.key] > 0 ? (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
            <b className="font-semibold text-[#1a1a22]">{counts[s.key]}</b>
            {s.label}
          </span>
        ) : null,
      )}
      {counts.picking === 0 && counts.needsCheck === 0 && counts.waiting === 0 && (
        <span className="text-[#96969f]">nothing pending</span>
      )}
    </div>
  );
}
