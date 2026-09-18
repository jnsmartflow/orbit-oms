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
// Upcountry / IGT is the page's own control. A trip is in scope when ANY of its
// types matches — its stored type UNIONED with its bills' types (owner,
// 2026-09-18; `tripInScope`, lib/floor/scope.ts). A Local + Upcountry load is
// on Local, on Upcountry and on All, and wears a quiet "Local + Upcountry" chip;
// an IGT transfer carrying Upcountry stock stays on IGT and gains Upcountry. A
// trip only ever GAINS tabs from its bills — it never leaves the one it was
// numbered under. A Cross trip shows under All only, because there is no Cross
// scope.
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

import type { ReactNode } from "react";
import { TripBar, tripBarCounts } from "./trip-bar";
import { formatLitres } from "./status-pill";
import { tripInScope, tripMixLabel } from "@/lib/floor/scope";
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
  addMode = false,
  addCount = 0,
  addSummary = null,
  sameRouteLabel = null,
  onAddToTrip,
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
  /**
   * 🔴 ADD MODE (2026-09-16, owner's add-to-trip design). Pool bills are ticked
   * and waiting to be placed, so the rail stops being a list of trips and
   * becomes the PICKER: a pink hint at the top, a "+" on every card that can
   * take bills, and a click that ADDS instead of opening.
   *
   * ⚠ IT IS DERIVED UPSTREAM from "the bar is in pool mode and something is
   * ticked" (floor-page.tsx), never stored here — clearing the selection ends
   * it, which is what makes Escape and ✕ cancel with no extra wiring.
   *
   * ⚠ PINK, NEVER VIOLET. Violet already means SELECTED on this screen; add mode
   * borrows the tint room's pink (#db2777 on #fce7f3, border #f9a8d4, text
   * #be185d) and shows it only while bills are waiting to be placed.
   */
  addMode?: boolean;
  addCount?: number;
  addSummary?: ReactNode;
  /**
   * The selection-s route when it is a SINGLE one (floor-page). A trip whose own
   * route label is exactly this gets a quiet green "Same route" line.
   *
   * ⚠ A HINT, NEVER A RESTRICTION (owner). Every card stays clickable; this only
   * saves reading twenty of them. Null when the selection spans several routes —
   * there is no sensible match then, and marking the biggest would be a guess.
   */
  sameRouteLabel?: string | null;
  onAddToTrip?: (tripId: number) => void;
}) {
  const all = trips ?? [];
  // 🔴 CANCELLED NEVER REACHES THE RAIL (2026-09-11), and a trip outside the
  // page's scope does not either (slice 6). One filter, applied once, in the
  // server's order — newest created first. In scope = ANY of the trip's types,
  // stored ∪ bills (2026-09-18).
  const live = all.filter((t) => t.status !== "cancelled" && tripInScope(t, scope));

  // The header's two numbers. Both describe the LIVE list — what is actually on
  // the rail — so the count and the cards can never disagree.
  const tripCount = live.length;
  const billCount = live.reduce((sum, t) => sum + t.counts.total, 0);

  const poolOn = selection.kind === "pool";

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto border-r border-[#e7e7ee] bg-[#fafafc] px-[11px] pb-4 pt-3">
      {/* ── The rail's own count (2026-09-11) ─────────────────────────────
          Smart Flow had to scroll the rail to know what was on it. Two numbers,
          one line, above everything. It counts the LIVE, in-scope list, which
          is what is rendered. */}
      {/* THE HINT, in place of the count while bills are waiting to be placed.
          It replaces the head rather than joining it: the rail has one job at a
          time, and "20 trips · 120 bills" is not the question being asked. */}
      {addMode ? (
        <div className="mb-[10px] rounded-[8px] border border-[#f9a8d4] bg-[#fce7f3] px-2.5 py-2">
          <div className="text-[12.5px] font-bold text-[#be185d]">
            Click a trip to add {addCount} bill{addCount === 1 ? "" : "s"}
          </div>
          <div className="mt-0.5 text-[11.5px] tabular-nums text-[#9d174d]">{addSummary}</div>
        </div>
      ) : (
        <div className="mb-[9px] px-1 text-[11px] font-semibold uppercase tabular-nums tracking-[0.06em] text-[#96969f]">
          {tripCount} trip{tripCount === 1 ? "" : "s"} · {billCount} bill{billCount === 1 ? "" : "s"}
        </div>
      )}

      {/* ── The pool ─────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => onSelect({ kind: "pool" })}
        className={`mb-[14px] w-full rounded-[9px] border px-3 py-2.5 text-left ${
          poolOn ? "border-brand-600 bg-brand-50" : "border-[#e7e7ee] bg-white hover:border-[#cfcfda]"
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
        <div className="text-[14.5px] font-semibold tracking-[-0.008em] text-[#1a1a22]">To plan</div>
        <div className="mt-px text-[12.5px] tabular-nums text-[#61616d]">
          {poolCount} bill{poolCount === 1 ? "" : "s"} · {formatLitres(poolLitres)} L
        </div>
      </button>

      {loading && trips === null && (
        <div className="px-1 py-4 text-center text-[11px] text-[#96969f]">Loading trips…</div>
      )}

      {trips !== null && live.length === 0 && (
        <div className="px-1 py-4 text-[11px] leading-relaxed text-[#96969f]">
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
          // ⚠ A DISPATCHED TRIP IS NOT ADDABLE, and says so on hover. The bills
          // route refuses one with a 409 (app/api/floor/trips/[id]/bills), so a
          // "+" on that card would offer a press that is guaranteed to fail.
          // (Cancelled trips never reach this rail at all.)
          addable={addMode && t.status !== "dispatched" && t.status !== "cancelled"}
          // Its own label must match exactly: "Adajan" is the same route,
          // "Adajan +1" is a load that also goes somewhere else.
          sameRoute={sameRouteLabel !== null && t.routeName === sameRouteLabel && t.routeExtraCount === 0}
          addMode={addMode}
          onAdd={() => onAddToTrip?.(t.id)}
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
  addMode = false,
  addable = false,
  sameRoute = false,
  onAdd,
}: {
  trip: TripSummary;
  selected: boolean;
  onSelect: () => void;
  anchorIso: string;
  gateOn: boolean;
  /** Bills are waiting to be placed — see TripRail's `addMode`. */
  addMode?: boolean;
  /** This trip can take them. False on a dispatched trip: no "+", no click. */
  addable?: boolean;
  /** This trip already runs the selection-s route. */
  sameRoute?: boolean;
  onAdd?: () => void;
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
  const mixLabel = tripMixLabel(trip);

  // 🔴 THE CARD IS FOUR LINES AND A BAR (floor redesign, 2026-09-15, owner):
  //   number · slot · badge / route / stops · bills · litres / driver / bar.
  // The vehicle and the area are off the card — the detail panel carries both.
  // 🔴 THE WHOLE CARD IS THE TARGET IN ADD MODE (owner). The "+" marks that the
  // rail has changed meaning; it is not a thing to aim at. A card that cannot
  // take bills is inert — it neither adds nor opens, so a click during add mode
  // can never do something the planner did not ask for.
  const blocked = addMode && !addable;
  return (
    <button
      type="button"
      onClick={blocked ? undefined : addMode ? onAdd : onSelect}
      disabled={blocked}
      title={blocked ? `${trip.tripNumber} has been dispatched — it cannot take more bills` : undefined}
      className={`relative mb-2 flex w-full flex-col gap-[6px] rounded-[9px] border px-3 pb-3 pt-[11px] text-left ${
        blocked
          ? "cursor-not-allowed border-[#e7e7ee] bg-white opacity-50"
          : addable
            ? "cursor-pointer border-[#cfcfda] bg-white hover:border-[#db2777] hover:bg-[#fce7f3]"
            : selected
              ? "border-brand-600 bg-white shadow-[0_0_0_3px_#f2edfe]"
              : "border-[#e7e7ee] bg-white hover:border-[#cfcfda]"
      }`}
    >
      {addable && (
        <span
          aria-hidden
          className="absolute right-[11px] top-[10px] flex h-[19px] w-[19px] items-center justify-center rounded-full border border-[#f9a8d4] bg-[#fce7f3] text-[14px] font-bold leading-none text-[#db2777]"
        >
          +
        </span>
      )}
      {/* The badge keeps clear of the "+" while it is there. */}
      <div className={`flex items-center gap-[7px] ${addable ? "pr-[25px]" : ""}`}>
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
          className={`shrink-0 rounded-[5px] border px-[6px] py-px font-mono text-[11.5px] font-semibold ${
            isCarried ? "border-[#f5d9a8] bg-[#fdf3e3] text-[#8a5d0c]" : "border-[#e7e7ee] bg-[#f1f1f6] text-[#61616d]"
          }`}
        >
          {trip.tripNumber}
        </span>
        {/* The slot — a small chip when set, ABSENT when not (slice 6; kept by
            the owner in the redesign — 34 of 74 trips carry one). */}
        {trip.windowTime && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#96969f]">
            {trip.windowTime}
          </span>
        )}
        {badge && (
          <span
            className={`ml-auto shrink-0 rounded-[20px] px-2 py-[2px] text-[10.5px] font-bold uppercase tracking-[0.05em] ${badge.cls}`}
          >
            {badge.label}
          </span>
        )}
      </div>

      {/* ROUTE, not area (owner). The name the most stops run on, "+N" greyed
          for the others (lib/trips/queries.ts deriveRouteLabel). */}
      <div className="truncate text-[16.5px] font-semibold leading-[1.22] tracking-[-0.012em] text-[#1a1a22]">
        {trip.routeName ? (
          <>
            {trip.routeName}
            {trip.routeExtraCount > 0 && (
              <span className="font-medium text-[#96969f]"> +{trip.routeExtraCount}</span>
            )}
          </>
        ) : (
          <span className="font-medium text-[#96969f]">No route</span>
        )}
      </div>

      {/* ⚠ AN EMPTY TRIP SAYS SO (2026-09-10 c) rather than "0 stops · 0 bills ·
          0 L" — an empty trip is a normal morning state (owner, slice 6). */}
      {bar.total === 0 ? (
        <div className="text-[12.5px] text-[#96969f]">No bills yet</div>
      ) : (
        <div className="text-[12.5px] tabular-nums text-[#61616d]">
          {trip.dropCount} stop{trip.dropCount === 1 ? "" : "s"} · {bar.total} bill
          {bar.total === 1 ? "" : "s"} · {formatLitres(trip.totalLitres)} L
        </div>
      )}

      {/* THE MIX CHIP (owner, 2026-09-18) — only when the load holds more than
          one delivery type, so nobody is surprised by what is on the truck.
          Quiet grey: a fact, not a warning. Real type names joined with "+";
          never the word "cross" (Cross is its own delivery type). */}
      {mixLabel && (
        <div>
          <span className="inline-block rounded-[5px] border border-[#e7e7ee] bg-[#f6f6f9] px-[6px] py-px text-[11px] font-medium text-[#61616d]">
            {mixLabel}
          </span>
        </div>
      )}

      {/* DRIVER, not vehicle (owner). ONE line, always — an ellipsis, never a
          wrap. No driver is amber: on this screen amber means someone has to do
          something. A typed plate never brings a driver, so those trips read
          "No driver yet" until a master vehicle is chosen (owner, accepted). */}
      <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium text-[#61616d]" title={trip.driverName ?? undefined}>
        {trip.driverName ?? <span className="font-semibold text-[#8a5d0c]">No driver yet</span>}
      </div>

      {/* QUIET, and between the driver and the bar (owner-s design). A hint, not
          a badge — it must not compete with the state badge above it. */}
      {sameRoute && <div className="text-[11.5px] font-semibold text-[#15773a]">Same route</div>}

      <TripBar counts={bar} className="mt-[2px]" />
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
const BADGE_PICKING: TripChip = { label: "Picking", cls: "bg-[#e4ecfd] text-[#1d4ed8]" };
// Amber: the bar's hold segment and "No driver yet" — someone has to act.
const BADGE_HELD: TripChip = { label: "Held", cls: "bg-[#fdf2d9] text-[#8a5d0c]" };
const BADGE_READY: TripChip = { label: "Ready", cls: "bg-[#e2f6e9] text-[#15773a]" };
const BADGE_SHOWN: TripChip = { label: "Shown", cls: "bg-[#fdf2d9] text-[#8a5d0c]" };
