"use client";

// Floor Control — the LEFT RAIL of the trip desk (v3 mockup §01).
//
// 🔴 IT REPLACES THE DECISION RAIL ENTIRELY. What used to live here was a stack
// of cards for bills the dispatch engine could not slot, each with a slot picker
// and a "Why no slot?" link. Those bills are now rows on the board itself,
// marked with a quiet `no slot` chip, and the rail holds TRIPS instead. Putting
// a bill on a trip is what gives it a slot — so the picker, the suggestion layer
// and the whole card have nothing left to do.
//
// Two kinds of entry, and only one is selected at a time:
//   - "Not on a trip" — the pool. The default.
//   - one card per trip, grouped under its slot label.
//
// ⚠ GROUPED BY SLOT LABEL, NOT BY SLOT ID. A trip with no window sits under
// "No slot yet" rather than being hidden — it is a real trip the planner is
// still assembling, and a trip cannot be released without a window, so this is
// the group he has to come back to.
//
// ⚠ CANCELLED TRIPS ARE NOT ON THIS RAIL AT ALL (2026-09-11). They used to sink
// to the bottom, greyed. They are still kept in the database — a cancelled trip
// retains its number so the allocator can never reissue it — and they are still
// reachable in history. They are simply not work, and the live rail is a list of
// work. DISPLAY ONLY: nothing here deletes or hides a row, and the summary
// counts below describe exactly what is rendered.
//
// ⚠ A CARRIED DRAFT SHOWS ITS REAL DATE. lib/trips/queries.ts follows an open
// draft forward off its own day so it can never become unreachable, and this
// rail prints the date it actually carries rather than implying it is today's.
// Reading as old is the point — see the date chip on the card.

import { ProgressBar } from "./progress-bar";
import { formatLitres, type StatusCounts } from "./status-pill";
import { tripWording } from "@/lib/floor/trip-wording";
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

const STATE_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-[#f1f0f5] text-[#6f6d7d]" },
  released: { label: "Confirmed", cls: "bg-[#e8effd] text-[#2563eb]" },
  loading: { label: "Loading", cls: "bg-[#fdf3e3] text-[#b45309]" },
  dispatched: { label: "Dispatched", cls: "bg-[#f1f0f5] text-[#6f6d7d]" },
  cancelled: { label: "Cancelled", cls: "bg-[#f1f0f5] text-[#6f6d7d]" },
};
const READY = { label: "Ready", cls: "bg-[#eaf7ee] text-[#15803d]" };

/**
 * The API's five buckets folded into the four the shared bar and pill speak.
 *
 * ⚠ `other` FOLDS INTO `waiting`. Trip membership is not stage-gated, so a trip
 * can hold a bill outside the four picking stages; `StatusCounts` has four, and
 * widening it would change what "waiting" means on every other surface that
 * counts through it. The band's own legend names the remainder; a rail card is
 * too small for that, so here it simply reads as waiting.
 */
export function toStatusCounts(c: TripSummary["counts"]): StatusCounts {
  return {
    waiting: c.waiting + c.other,
    withPicker: c.withPicker,
    needsCheck: c.picked,
    done: c.checked,
    // ALWAYS 0 here, and that is correct rather than a gap. `bucketFor`
    // (lib/trips/queries.ts) already folds `dispatched` into `checked` — a trip
    // asks "is every bill on this load finished", and shipped and checked are
    // both yes. The separate Dispatched reading belongs to Floor History, which
    // is answering a different question about a different day.
    dispatched: 0,
    total: c.total,
  };
}

/** The chip a trip wears. `ready` is DERIVED and outranks the stored status. */
export function tripStateMeta(trip: TripSummary, gateOn: boolean) {
  if (trip.status === "cancelled" || trip.status === "dispatched") {
    return STATE_META[trip.status];
  }
  if (trip.isReady) return READY;
  if (trip.status === "released") {
    // "Confirmed" with desk control off, "Released" with it on — the same stored
    // value, described honestly for the state the desk is in.
    return { label: tripWording(gateOn).releasedLabel, cls: STATE_META.released.cls };
  }
  return STATE_META[trip.status] ?? { label: trip.status, cls: STATE_META.draft.cls };
}

export function TripRail({
  trips,
  loading,
  anchorIso,
  poolCount,
  poolLitres,
  selection,
  onSelect,
  gateOn,
}: {
  trips: TripSummary[] | null;
  loading: boolean;
  /**
   * The day the board is anchored on, "YYYY-MM-DD".
   *
   * A trip whose own `tripDate` is EARLIER than this is a CARRIED DRAFT —
   * lib/trips/queries.ts follows an open draft forward so it can never become
   * unreachable on a read-only past day — and its card says so with its real
   * date. Nothing else reads this.
   */
  anchorIso: string;
  poolCount: number;
  poolLitres: number;
  selection: RailSelection;
  onSelect: (sel: RailSelection) => void;
  gateOn: boolean;
}) {
  const all = trips ?? [];
  // 🔴 CANCELLED NEVER REACHES THE RAIL (2026-09-11). One filter, applied once,
  // so no group below can reintroduce them.
  const live = all.filter((t) => t.status !== "cancelled");

  // The header's two numbers. Both describe the LIVE list — what is actually on
  // the rail — so the count and the cards can never disagree.
  const tripCount = live.length;
  const billCount = live.reduce((sum, t) => sum + t.counts.total, 0);

  // Group by slot LABEL. Order: the windows the trips actually use, ascending by
  // time string (the labels are HH:MM, so a plain sort is the clock order), then
  // "No slot yet" last — it is the group still needing a decision.
  const groups = new Map<string, TripSummary[]>();
  for (const t of live) {
    const key = t.windowTime ?? "No slot yet";
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }
  const orderedKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === "No slot yet") return 1;
    if (b === "No slot yet") return -1;
    return a.localeCompare(b, "en");
  });

  const poolOn = selection.kind === "pool";

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto border-r border-gray-200 bg-[#fcfbfe] px-2.5 py-2.5">
      {/* ── The rail's own count (2026-09-11) ─────────────────────────────
          Smart Flow had to scroll the rail to know what was on it. Two numbers,
          one line, above everything.

          Typography is the rail's existing pair, not a new style: the group
          headings below use 10.5px bold uppercase at 0.1em in gray-400, and the
          card sub-lines use 11px tabular-nums in gray-500. This reuses both —
          the label from the first, the figures from the second — so it reads as
          part of the rail rather than as a banner on top of it.

          It counts the LIVE list, which is what is rendered. Cancelled trips are
          not on the rail and are not in this number. */}
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
        <div className="text-[13px] font-bold tracking-[-0.008em] text-gray-900">Not on a trip</div>
        <div className="mt-px text-[11.5px] tabular-nums text-gray-500">
          {poolCount} bill{poolCount === 1 ? "" : "s"} · {formatLitres(poolLitres)} L
        </div>
      </button>

      {loading && trips === null && (
        <div className="px-1 py-4 text-center text-[11px] text-gray-400">Loading trips…</div>
      )}

      {trips !== null && all.length === 0 && (
        <div className="px-1 py-4 text-[11px] leading-relaxed text-gray-400">
          No trips today. Tick bills in the pool and press Add to trip, or start one with New trip.
        </div>
      )}

      {orderedKeys.map((key) => (
        <div key={key}>
          <div className="px-1 pb-1 pt-2.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-gray-400">
            {key}
          </div>
          {groups.get(key)!.map((t) => (
            <TripCard
              key={t.id}
              trip={t}
              gateOn={gateOn}
              anchorIso={anchorIso}
              selected={selection.kind === "trip" && selection.tripId === t.id}
              onSelect={() => onSelect({ kind: "trip", tripId: t.id })}
            />
          ))}
        </div>
      ))}

    </div>
  );
}

function TripCard({
  trip,
  selected,
  onSelect,
  gateOn,
  anchorIso,
}: {
  trip: TripSummary;
  selected: boolean;
  onSelect: () => void;
  gateOn: boolean;
  anchorIso: string;
}) {
  // 🔴 A CARRIED DRAFT READS AS OLD, NOT AS TODAY'S (2026-09-11). An open draft
  // dated before the board's anchor now follows the planner forward rather than
  // staying stranded on an unreachable past day. Printing its REAL date is the
  // whole point of carrying it: a trip silently relabelled today would hide
  // exactly the staleness the planner has to act on.
  //
  // A plain string compare is exact on zero-padded "YYYY-MM-DD" and needs no
  // Date at all. Only a draft is ever carried (see getTripsForDate), so only a
  // draft can show this chip.
  const isCarried = trip.tripDate < anchorIso;
  const counts = toStatusCounts(trip.counts);
  const meta = tripStateMeta(trip, gateOn);
  const vehicle = trip.vehicleNo ?? trip.adhocVehicleNo;
  const isDraft = trip.status === "draft";
  const isCancelled = trip.status === "cancelled";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`mb-1.5 w-full rounded-[10px] border px-2.5 py-2 text-left ${
        selected
          ? "border-brand-600 bg-brand-50"
          : isDraft
            ? "border-dashed border-[#d6d3e2] bg-white hover:bg-[#fafafa]"
            : "border-gray-200 bg-white hover:bg-[#fafafa]"
      } ${isCancelled ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        {isCarried && (
          <span
            title={`Still a draft from ${fmtTripDay(trip.tripDate)} — it follows you forward until it is confirmed or cancelled`}
            className="shrink-0 rounded-[4px] bg-[#fdf3e3] px-[5px] py-px text-[9.5px] font-bold uppercase tracking-[0.05em] text-[#b45309]"
          >
            {fmtTripDay(trip.tripDate)}
          </span>
        )}
        <span
          className={`shrink-0 rounded-[5px] px-1.5 py-px font-mono text-[11px] font-semibold ${
            isDraft || isCancelled
              ? "border border-gray-200 bg-white text-gray-600"
              : "bg-gray-900 text-white"
          }`}
        >
          {trip.tripNumber}
        </span>
        <span
          className={`ml-auto shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.06em] ${meta.cls}`}
        >
          {meta.label}
        </span>
      </div>

      <div className="mb-px mt-1 truncate text-[12px] font-semibold text-gray-900">
        {vehicle ?? <span className="text-[#b45309]">Draft vehicle {trip.seq}</span>}
      </div>

      {/* ⚠ AN EMPTY TRIP SAYS SO (2026-09-10 c). It used to read
          "0 stops · 0 bills · 0 L" over an empty progress bar, which is three
          true numbers arranged to look like a rendering fault. A brand-new draft
          is the state this card is in most often — the planner creates the trip
          and then goes to find bills for it — so the ordinary case was the one
          that looked broken. */}
      {counts.total === 0 ? (
        <div className="text-[11px] text-gray-400">No bills yet</div>
      ) : (
        <>
          <div className="text-[11px] tabular-nums text-gray-500">
            {trip.dropCount} stop{trip.dropCount === 1 ? "" : "s"} · {counts.total} bill
            {counts.total === 1 ? "" : "s"} · {formatLitres(trip.totalLitres)} L
          </div>
          <ProgressBar counts={counts} className="mt-1.5 !h-[5px]" />
        </>
      )}
    </button>
  );
}
