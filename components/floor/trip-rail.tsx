"use client";

// Floor Control — the LEFT RAIL of the trip desk (v3 mockup §01).
//
// 🔴 IT REPLACES THE DECISION RAIL ENTIRELY. What used to live here was a stack
// of cards for bills the dispatch engine could not slot, each with a slot picker
// and a "Why no slot?" link. Those bills are now rows on the board itself,
// marked with a quiet `no slot` chip, and the rail holds TRIPS instead.
//
// Two kinds of entry, and only one is selected at a time:
//   - "To plan" — the pool. The default.
//   - one card per trip.
//
// 🔴 ONE FLAT LIST, NEWEST CREATED FIRST, NO GROUP HEADERS (slice 6, 2026-09-15).
// The rail used to group trips under their slot, with a "No slot yet" group
// last. It no longer groups at all: the slot is a small chip on the card when
// set, and absent when not. The order is CREATED TIME, not trip number — since
// slice 5 a cancelled trip gives its number back, so a trip made at 3pm can hold
// seq 5. The order is set once, by getTripsForDate (lib/trips/queries.ts), so
// this rail and the Add-to-trip list cannot disagree about it.
//
// 🔴 THE PAGE'S SCOPE FILTERS IT; IT HAS NO TABS OF ITS OWN. All / Local /
// Upcountry / IGT is the page's own control. A trip is in scope by its OWN
// delivery type — the letter in its number — through the same `inScope` the
// board rows use (lib/floor/scope.ts). A Cross trip shows under All only, because
// there is no Cross scope.
//
// 🔴 NO "Draft" AND NO "Confirmed" ANYWHERE (slice 6). The stored status still
// exists and still drives two things (the carry-forward rule and the dispatch
// close); it is simply not a thing the floor reads.
//
// 🔴 THE CARD WAS REDESIGNED 2026-09-15 (owner, locked): number · slot · ONE
// badge (Dispatched / Picking / Ready / Shown — see `tripBadge`), then the
// ROUTE, then stops · bills · litres, then the DRIVER ("No driver yet" in
// amber), then the four-colour trip bar (trip-bar.tsx). The vehicle and the area
// moved to the detail panel.
//
// ⚠ CANCELLED TRIPS ARE NOT ON THIS RAIL AT ALL (2026-09-11). They are still in
// the database — renamed <number>-C since slice 5 — and still reachable in
// history. They are simply not work, and the live rail is a list of work.
// DISPLAY ONLY: nothing here deletes or hides a row, and the header counts
// describe exactly what is rendered.
//
// ⚠ A CARRIED TRIP LOOKS OLD. lib/trips/live-trips.ts follows a trip from an
// earlier day forward while it still holds a bill that is not done (slice 10 —
// done = checked, or on hold). Its number chip turns amber (redesign) — the
// number already carries the real date — rather than implying it is today's.

import { TripBar, tripBarCounts } from "./trip-bar";
import { formatLitres } from "./status-pill";
import { inScope } from "@/lib/floor/scope";
import type { FloorScope } from "@/lib/floor/types";
import type { TripSummary } from "@/lib/trips/queries";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Thu 10 Sep" from a date-only "YYYY-MM-DD".
 *
 * ⚠ NEVER `new Date(str)` — an offset-less string is read in the HOST's
 * timezone (CORE §3), which on a depot phone is 5.5 hours from the server's
 * answer. Date.UTC, the same parse every other date-only formatter here uses.
 */
function fmtTripDay(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WD[dt.getUTCDay()]} ${dt.getUTCDate()} ${MON[dt.getUTCMonth()]}`;
}

/** The rail's selection: the pool, or one trip. */
export type RailSelection = { kind: "pool" } | { kind: "trip"; tripId: number };

export interface TripChip {
  label: string;
  cls: string;
}

export function TripRail({
  trips,
  loading,
  anchorIso,
  scope,
  gateOn,
  poolCount,
  poolLitres,
  selection,
  onSelect,
}: {
  trips: TripSummary[] | null;
  loading: boolean;
  /**
   * The day the board is anchored on, "YYYY-MM-DD".
   *
   * A trip whose own `tripDate` is EARLIER than this was CARRIED — it still holds
   * a bill that is not done (lib/trips/live-trips.ts, slice 10) — and its card
   * says so with its real date. On a History day nothing is carried. Nothing else
   * reads this.
   */
  anchorIso: string;
  /** The page's All / Local / Upcountry / IGT scope. Filters trips by their own type. */
  scope: FloorScope;
  /** Desk control. The card's "Shown" marker appears only while it is on. */
  gateOn: boolean;
  poolCount: number;
  poolLitres: number;
  // ⚠ THE "IN TINTING" LINE WAS HERE AND WENT ON 2026-09-14. It counted the tint
  // room above the trips; the TINTING TAB now does that job, with a table behind
  // it and an Operator column the line could never carry. Two summaries of one
  // pile is one too many, and the tab is the one you can act on.
  selection: RailSelection;
  onSelect: (sel: RailSelection) => void;
}) {
  const all = trips ?? [];
  // 🔴 CANCELLED NEVER REACHES THE RAIL (2026-09-11), and a trip outside the
  // page's scope does not either (slice 6). One filter, applied once, in the
  // server's order — newest created first.
  const live = all.filter((t) => t.status !== "cancelled" && inScope(t.deliveryTypeName, scope));

  // The header's two numbers. Both describe the LIVE list — what is actually on
  // the rail — so the count and the cards can never disagree.
  const tripCount = live.length;
  const billCount = live.reduce((sum, t) => sum + t.counts.total, 0);

  const poolOn = selection.kind === "pool";

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto border-r border-gray-200 bg-[#fcfbfe] px-2.5 py-2.5">
      {/* ── The rail's own count (2026-09-11) ─────────────────────────────
          Smart Flow had to scroll the rail to know what was on it. Two numbers,
          one line, above everything. It counts the LIVE, in-scope list, which
          is what is rendered. */}
      <div className="flex items-baseline gap-2 px-1 pb-2">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-gray-400">
          Trips
        </span>
        <span className="text-[11px] tabular-nums text-gray-500">
          {tripCount} trip{tripCount === 1 ? "" : "s"} · {billCount} bill
          {billCount === 1 ? "" : "s"}
        </span>
      </div>

      {/* ── The pool ─────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => onSelect({ kind: "pool" })}
        className={`mb-2 w-full rounded-[10px] border px-2.5 py-2 text-left ${
          poolOn ? "border-brand-600 bg-brand-50" : "border-gray-200 bg-white hover:bg-[#fafafa]"
        }`}
      >
        {/* ── "To plan", RENAMED FROM "Not on a trip" (2026-09-14) ──────────
            "Pending dispatch" was considered and rejected: `dispatched` now
            means gone on a truck (POST …/trips/[id]/dispatch writes the stage),
            and this pile includes bills still being picked.

            🔴 THE COUNT DOES NOT CHANGE WHEN YOU CLICK A TAB, AND THE
            ARITHMETIC IS HERE BECAUSE THE GAP LOOKS LIKE A BUG.

                105 rows on the Floor tab  +  5 on the Tinting tab  =  110 here

            The Tinting tab takes its rows OUT of the Floor tab's table, but they
            are still not on a trip, so they are still to plan. A bill in the
            tint room genuinely needs a truck — a 4pm load can be planned for
            paint that will be mixed by 3 — so leaving it out of this number
            would hide work the planner has to place. And the rail is identical
            on all four tabs (that is the whole point of it not moving); a card
            whose number changed on a tab click would contradict it.

            Owner decision 2026-09-14. Do not "fix" this to match the Floor
            tab's row count. */}
        <div className="text-[13px] font-bold tracking-[-0.008em] text-gray-900">To plan</div>
        <div className="mt-px text-[11.5px] tabular-nums text-gray-500">
          {poolCount} bill{poolCount === 1 ? "" : "s"} · {formatLitres(poolLitres)} L
        </div>
      </button>

      {loading && trips === null && (
        <div className="px-1 py-4 text-center text-[11px] text-gray-400">Loading trips…</div>
      )}

      {trips !== null && live.length === 0 && (
        <div className="px-1 py-4 text-[11px] leading-relaxed text-gray-400">
          {scope === "All" || all.every((t) => t.status === "cancelled")
            ? "No trips today. Start one with New trip — it can be empty, and bills can be added later."
            : `No ${scope} trips today.`}
        </div>
      )}

      {live.map((t) => (
        <TripCard
          key={t.id}
          trip={t}
          anchorIso={anchorIso}
          gateOn={gateOn}
          selected={selection.kind === "trip" && selection.tripId === t.id}
          onSelect={() => onSelect({ kind: "trip", tripId: t.id })}
        />
      ))}
    </div>
  );
}

function TripCard({
  trip,
  selected,
  onSelect,
  anchorIso,
  gateOn,
}: {
  trip: TripSummary;
  selected: boolean;
  onSelect: () => void;
  anchorIso: string;
  gateOn: boolean;
}) {
  // 🔴 A CARRIED TRIP READS AS OLD, NOT AS TODAY'S (2026-09-11). Printing its REAL
  // date is the whole point of carrying it: a trip silently relabelled today
  // would hide exactly the staleness the planner has to act on.
  //
  // A plain string compare is exact on zero-padded "YYYY-MM-DD" and needs no
  // Date at all.
  const isCarried = trip.tripDate < anchorIso;
  const bar = tripBarCounts(trip.counts);
  const badge = tripBadge(trip, gateOn);

  // 🔴 THE CARD IS FOUR LINES AND A BAR (floor redesign, 2026-09-15, owner):
  //   number · slot · badge / route / stops · bills · litres / driver / bar.
  // The vehicle and the area are off the card — the detail panel carries both.
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`mb-1.5 w-full rounded-[10px] border px-2.5 py-2 text-left ${
        selected ? "border-brand-600 bg-brand-50" : "border-gray-200 bg-white hover:bg-[#fafafa]"
      }`}
    >
      <div className="flex items-center gap-1.5">
        {/* 🔴 A CARRIED TRIP'S NUMBER CHIP IS AMBER (owner). The separate date
            chip is gone: it did not fit, and the number already carries its
            date — L-260914-24 seen on the 15th IS the carry signal. Amber, not
            a new word, so it costs no width. The tooltip keeps the old
            explanation for anyone who hovers. */}
        <span
          title={
            isCarried
              ? `Planned for ${fmtTripDay(trip.tripDate)} — it follows you forward until every bill on it is checked or on hold, or it is cancelled`
              : undefined
          }
          className={`shrink-0 rounded-[5px] px-1.5 py-px font-mono text-[11px] font-semibold ${
            isCarried ? "bg-[#fdf3e3] text-[#b45309] ring-1 ring-inset ring-[#f5d9a8]" : "bg-gray-900 text-white"
          }`}
        >
          {trip.tripNumber}
        </span>
        {/* The slot — a small chip when set, ABSENT when not (slice 6; kept by
            the owner in the redesign — 34 of 74 trips carry one). */}
        {trip.windowTime && (
          <span className="shrink-0 rounded-[4px] border border-gray-200 bg-white px-[5px] py-px text-[10px] font-semibold tabular-nums text-gray-600">
            {trip.windowTime}
          </span>
        )}
        {badge && (
          <span
            className={`ml-auto shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.06em] ${badge.cls}`}
          >
            {badge.label}
          </span>
        )}
      </div>

      {/* ROUTE, not area (owner). The name the most stops run on, "+N" greyed
          for the others (lib/trips/queries.ts deriveRouteLabel). */}
      <div className="mt-1 truncate text-[12.5px] font-semibold text-gray-900">
        {trip.routeName ? (
          <>
            {trip.routeName}
            {trip.routeExtraCount > 0 && (
              <span className="font-normal text-gray-400"> +{trip.routeExtraCount}</span>
            )}
          </>
        ) : (
          <span className="font-normal text-gray-400">No route</span>
        )}
      </div>

      {/* ⚠ AN EMPTY TRIP SAYS SO (2026-09-10 c) rather than "0 stops · 0 bills ·
          0 L" — an empty trip is a normal morning state (owner, slice 6). */}
      {bar.total === 0 ? (
        <div className="text-[11px] text-gray-400">No bills yet</div>
      ) : (
        <div className="text-[11px] tabular-nums text-gray-500">
          {trip.dropCount} stop{trip.dropCount === 1 ? "" : "s"} · {bar.total} bill
          {bar.total === 1 ? "" : "s"} · {formatLitres(trip.totalLitres)} L
        </div>
      )}

      {/* DRIVER, not vehicle (owner). ONE line, always — an ellipsis, never a
          wrap. No driver is amber: on this screen amber means someone has to do
          something. A typed plate never brings a driver, so those trips read
          "No driver yet" until a master vehicle is chosen (owner, accepted). */}
      <div className="truncate text-[11.5px] text-gray-700" title={trip.driverName ?? undefined}>
        {trip.driverName ?? <span className="font-medium text-[#b45309]">No driver yet</span>}
      </div>

      <TripBar counts={bar} className="mt-1.5" />
    </button>
  );
}

/**
 * The ONE badge a rail card wears (floor redesign, 2026-09-15, owner) — first
 * match wins:
 *
 *   DISPATCHED — every bill dispatched
 *   PICKING    — at least one bill with a picker, or picked and not checked
 *   HELD       — at least one bill on hold (added by the owner the same day)
 *   READY      — every bill done: nothing waiting, picking or on hold
 *   SHOWN      — shown to the floor, nothing picked yet (desk control on only)
 *   none       — anything else
 *
 * Picking beats Shown: once picking has started, the trip was obviously shown.
 *
 * ⚠ READY HERE IS STRICTER THAN `trip.isReady`. `isReady` leaves held bills out
 * of the maths (a finished load with a hold is ready to go); this badge, by the
 * owner's rule, shows READY only when no bill is on hold. `isReady` is untouched
 * and still drives what it always drove.
 */
export function tripBadge(trip: TripSummary, gateOn: boolean): TripChip | null {
  const b = tripBarCounts(trip.counts);
  if (b.total > 0 && trip.dispatchedCount === b.total) return BADGE_DISPATCHED;
  if (b.picking > 0) return BADGE_PICKING;
  // HELD (owner, 2026-09-15) — closes the gap where done bills plus a hold
  // matched nothing. Below Picking (live picking is the more useful fact, and
  // the bar's amber segment still shows the hold); above Ready (a trip with a
  // hold is not ready).
  if (b.held > 0) return BADGE_HELD;
  if (b.total > 0 && b.done === b.total) return BADGE_READY;
  if (gateOn && trip.shownAt && b.picking === 0 && b.done === 0) return BADGE_SHOWN;
  return null;
}

const BADGE_DISPATCHED: TripChip = { label: "Dispatched", cls: "bg-[#f1f0f5] text-[#6f6d7d]" };
const BADGE_PICKING: TripChip = { label: "Picking", cls: "bg-[#e0f2fe] text-[#0369a1]" };
// Amber: the bar's hold segment and "No driver yet" — someone has to act.
const BADGE_HELD: TripChip = { label: "Held", cls: "bg-[#fef3c7] text-[#b45309]" };
const BADGE_READY: TripChip ={ label: "Ready", cls: "bg-[#eaf7ee] text-[#15803d]" };
const BADGE_SHOWN: TripChip = { label: "Shown", cls: "bg-[#ecfdf5] text-[#047857]" };
