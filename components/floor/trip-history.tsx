"use client";

// Floor Control — a trip's OWN HISTORY (2026-09-14, slice 2).
//
// 🔴 WHAT THIS REPLACES: nothing. Before it there was no way to ask a trip what
// had happened to it. The four stamps on `trips` answered created / released /
// dispatched / cancelled and nothing else — not who swapped the van, not when a
// bill joined the load, and after a cancel not even which bills had been on it.
//
// ONE face since the floor redesign (2026-09-15): the full list, oldest first,
// opened by the clock in the trip header. The "recent lines" strip and the
// bottom toggle were retired by the owner's design.
//
// ⚠ THE SUMMARY IS NOT WRITTEN HERE. Every line comes from `trip_activity.summary`,
// composed at the source in lib/trips/activity.ts, so this file cannot make a row
// say something the writer did not. A second spelling of the same event is the
// exact drift the one-owner rule exists to stop — and it is what let the release
// toast and the release button disagree before slice 1.
//
// ⚠ ORDER IS THE SERVER'S. getTripActivity returns oldest-first, which is the
// order a person reads a story; Recent slices the TAIL of that and shows it
// newest-first, because "what just happened" reads backwards. Neither view
// re-sorts by anything else.

import type { TripActivityRow } from "@/lib/trips/activity";

// ⚠ A DOT PER ACTION, and the palette is the one the rest of the desk already
// speaks: teal for the thing that moved the trip forward, slate for an edit,
// red for the end of it. An action this map has not been taught falls back to
// slate rather than rendering nothing — same rule as trip-rail's STATE_META.
const DOT: Record<string, string> = {
  created: "bg-[#94a3b8]",
  bills_added: "bg-[#2563eb]",
  bills_removed: "bg-[#94a3b8]",
  vehicle_changed: "bg-[#b45309]",
  details_changed: "bg-[#94a3b8]",
  released: "bg-[#15803d]",
  dispatched: "bg-[#15803d]",
  cancelled: "bg-[#b91c1c]",
};

function dotFor(action: string): string {
  return DOT[action] ?? "bg-[#94a3b8]";
}

/**
 * "14 Sep, 4:12 PM" in IST.
 *
 * ⚠ EXPLICIT timeZone, never the host's. A depot phone and the Vercel box in
 * Mumbai do not have to agree about local time, and a history that reads 5.5
 * hours out is worse than one with no clock (CORE §3).
 */
function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** The OBD numbers a row carries, when it carries any. Read, never derived. */
function obdsOf(detail: unknown): string[] {
  if (detail === null || typeof detail !== "object") return [];
  const v = (detail as Record<string, unknown>).obdNumbers;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Every row, oldest first (floor redesign, 2026-09-15).
 *
 * 🔴 OPENED BY THE CLOCK in the trip header, in place under the header — not from
 * the ··· menu (owner): ··· holds destructive actions and people learn to avoid
 * opening it; history is a view, not an action. The collapsed "Full history"
 * toggle that sat at the bottom of the panel, and the three recent lines under
 * the buttons, both went with the redesign.
 */
export function TripHistoryList({ rows }: { rows: TripActivityRow[] }) {
  return (
        <div className="pb-1">
          {rows.length === 0 ? (
            /* ⚠ SAYS WHY, NOT JUST "EMPTY". Every trip built before 2026-09-14
               has no history and never will — nothing was backfilled. A planner
               looking at an older trip deserves the reason rather than a blank
               box that reads as a fault. */
            <p className="m-0 text-[11.5px] leading-[1.6] text-gray-400">
              Nothing recorded. Trip history started on 14 Sep 2026 and was not
              backfilled, so trips built before then carry only their original
              created, dispatched and cancelled stamps.
            </p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-0 p-0">
              {rows.map((r, i) => {
                const obds = obdsOf(r.detail);
                return (
                  <li key={r.id} className="relative flex gap-2.5 pb-3 last:pb-0">
                    {/* The spine. Not drawn past the last row — a line running
                        into nothing implies a step that has not happened yet. */}
                    {i < rows.length - 1 && (
                      <span className="absolute bottom-0 left-[4px] top-[14px] w-px bg-[#e8e8ec]" />
                    )}
                    <span className={`mt-[6px] h-[9px] w-[9px] shrink-0 rounded-full ${dotFor(r.action)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[12px] font-semibold text-gray-900">{r.summary}</span>
                        <span className="text-[11px] tabular-nums text-gray-400">{fmt(r.createdAt)}</span>
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {r.actorName ?? `user ${r.actorId}`}
                      </div>
                      {/* 🔴 THE BILL LIST, AND ON A CANCEL ROW IT IS THE ONLY
                          RECORD THAT SURVIVES. Cancelling nulls every bill's
                          `tripDropId`, so after it runs nothing else in the
                          database can say which bills were on this trip. */}
                      {obds.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {obds.map((o) => (
                            <span
                              key={o}
                              className="rounded-[4px] bg-[#f4f4f6] px-1.5 py-px text-[10.5px] tabular-nums text-gray-600"
                            >
                              {o}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
  );
}
