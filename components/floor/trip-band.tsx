"use client";

// Floor Control — one trip band on the By-trip view (mockup §03).
//
// 🔴 IT RENDERS FROM THE TRIP PAYLOAD, NOT FROM BOARD ROWS. `counts` and
// `totalLitres` come from GET /api/floor/trips, which reads every bill under the
// trip through trip_drops. A band built by filtering the board's own rows would
// be wrong in the one case that matters most: a trip whose bills are all checked
// has left `floorLiveBaseWhere`'s set, so it would render as an empty band with
// a 0-of-0 progress bar — the board would say a finished load had nothing on it.
//
// The row TABLE inside the band is a different matter and does come from board
// rows: those are the bills still on screen, which is exactly what a table of
// live rows should show. When the two disagree — 7 in `counts`, 4 in the table —
// that is not a bug, it is the difference between "on this trip" and "still on
// today's board", and the band says so in words rather than leaving the reader
// to notice the gap.
//
// Reuses the shared <ProgressBar /> and <FloorTable /> unchanged. The four
// segment colours and the four status names are status-pill.tsx's, so a trip
// band and a slot band cannot describe the same work differently.

import { ProgressBar } from "./progress-bar";
import { FloorTable, type FloorTableVariant } from "./floor-table";
import { formatLitres, type StatusCounts } from "./status-pill";
import { tripWording } from "@/lib/floor/trip-wording";
import type { FloorSelection } from "@/lib/floor/selection";
import type { FloorBoardRow } from "@/lib/floor/types";
import type { TripSummary } from "@/lib/trips/queries";

/** chk_trips_status's five values → the chip. `ready` is DERIVED, never stored.
 *
 *  ⚠ `released`'s LABEL comes from lib/floor/trip-wording.ts and depends on the
 *  desk-control state, so it is filled in below rather than here — with the gate
 *  off, "Released" would name an event that did not happen. The STORED value is
 *  'released' either way and must not be renamed (chk_trips_status). */
const STATE_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft — at desk", cls: "bg-[#f1f0f5] text-[#6f6d7d]" },
  released: { label: "Released", cls: "bg-[#e8effd] text-[#2563eb]" },
  loading: { label: "Loading", cls: "bg-[#fdf3e3] text-[#b45309]" },
  dispatched: { label: "Dispatched", cls: "bg-[#f1f0f5] text-[#6f6d7d]" },
  cancelled: { label: "Cancelled", cls: "bg-[#f1f0f5] text-[#6f6d7d]" },
};

const ACTION =
  "inline-flex h-[28px] items-center rounded-[7px] border border-gray-300 bg-white px-3 text-[11.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const ACTION_PRIMARY =
  "inline-flex h-[28px] items-center rounded-[7px] bg-brand-600 px-3.5 text-[11.5px] font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400";
const READY_META = { label: "Ready to leave", cls: "bg-[#eaf7ee] text-[#15803d]" };

/**
 * The trip's own counts, in the shape the shared bar and legend already read.
 *
 * ⚠ `other` IS FOLDED INTO `waiting`, deliberately. The API returns a fifth
 * bucket for bills outside the four picking stages (trip membership is not
 * gated, so a trip can hold one at `pending_support` or `dispatched`).
 * `StatusCounts` has four, and widening it would change what "waiting" means on
 * the slot bands, the route rows and the By-picker cards — the exact split
 * status-pill.tsx's own header refuses for the held-back reading. Folding is the
 * lesser evil: the bar stays honest about its TOTAL, and the legend below names
 * the remainder separately so nothing is hidden.
 */
function toStatusCounts(c: TripSummary["counts"]): StatusCounts {
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

export function TripBand({
  trip,
  rows,
  nowMs,
  open,
  onToggle,
  variant,
  selection,
  onToggleRow,
  onToggleAll,
  onMarkUrgent,
  onOpenDetail,
  gateOn,
  onRelease,
  onAddBills,
  onChangeVehicle,
  onCancelTrip,
  busy = false,
}: {
  trip: TripSummary;
  /** The trip's bills that are STILL ON THE BOARD. May be shorter than `trip.counts.total`. */
  rows: FloorBoardRow[];
  nowMs: number;
  open: boolean;
  onToggle: () => void;
  variant: FloorTableVariant;
  selection?: FloorSelection;
  onToggleRow?: (id: number) => void;
  onToggleAll?: (rows: FloorBoardRow[]) => void;
  onMarkUrgent?: (id: number) => void;
  onOpenDetail?: (id: number) => void;
  gateOn?: boolean;
  /** Confirm / Release. Absent on a History band — a past day is read-only. */
  onRelease?: (tripId: number) => void;
  onAddBills?: (tripId: number) => void;
  onChangeVehicle?: (tripId: number) => void;
  onCancelTrip?: (tripId: number) => void;
  /** True while any write on THIS trip is in flight. */
  busy?: boolean;
}) {
  const counts = toStatusCounts(trip.counts);
  const pending = counts.total - counts.done;
  // The gate decides what the second state is CALLED, never what is stored.
  const wording = tripWording(gateOn === true);

  // The mockup's three shells: ready (green edge), draft (dashed), dispatched
  // (faded). Everything else is the plain surface.
  const shell = trip.isReady
    ? "border-[#c7e9d3]"
    : trip.status === "draft"
      ? "border-dashed border-[#d6d3e2] bg-[#fbfaff]"
      : trip.status === "dispatched" || trip.status === "cancelled"
        ? "border-gray-200 opacity-[.62]"
        : "border-gray-200";

  // Ready outranks the stored status on the chip — it is the more useful fact
  // and it is the one the operator is waiting for. A dispatched or cancelled
  // trip keeps its own chip: it has left, and "ready to leave" would be a lie.
  const meta =
    trip.isReady && trip.status !== "dispatched" && trip.status !== "cancelled"
      ? READY_META
      : trip.status === "released"
        ? // "Released" with the gate on, "Confirmed" with it off — the same
          // stored value, described honestly for the state the desk is in.
          { label: wording.releasedLabel, cls: STATE_META.released.cls }
        : (STATE_META[trip.status] ?? { label: trip.status, cls: "bg-[#f1f0f5] text-[#6f6d7d]" });

  // "Draft vehicle N" (mockup) when neither a master vehicle nor an ad-hoc plate
  // is set. N is the trip's own per-day sequence, so two drafts never share a
  // name and the name is stable across reloads.
  const vehicleLabel = trip.vehicleNo ?? trip.adhocVehicleNo;

  const metaBits = [
    trip.windowTime,
    `${trip.dropCount} drop${trip.dropCount === 1 ? "" : "s"}`,
    `${counts.total} bill${counts.total === 1 ? "" : "s"}`,
    // formatLitres, never a raw toLocaleString: the API sums a Float column, so
    // an unrounded total prints "4729.400000000001 L". The pool header uses the
    // SAME function, so the two can never disagree by a decimal.
    `${formatLitres(trip.totalLitres)} L`,
  ].filter(Boolean) as string[];

  // Which actions this band offers. Cancelled offers NONE — it is a record of
  // what was called off, and every write path refuses it server-side anyway
  // (PATCH 409s, cancel is idempotent). Dispatched likewise: it has left.
  const isClosed = trip.status === "cancelled" || trip.status === "dispatched";
  const isDraft = trip.status === "draft";
  const showActions = !isClosed && (onRelease || onAddBills || onChangeVehicle || onCancelTrip);

  return (
    <div className={`overflow-hidden rounded-[11px] border ${shell}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-3 px-3.5 py-3 text-left"
      >
        <span className="w-2.5 shrink-0 text-[11px] text-gray-400">{open ? "▾" : "▸"}</span>
        <span
          className={`shrink-0 rounded-[6px] px-2.5 py-[3px] font-mono text-[12px] font-semibold tracking-[0.02em] ${
            trip.status === "draft"
              ? "border border-gray-200 bg-white text-gray-600"
              : "bg-gray-900 text-white"
          }`}
        >
          {trip.tripNumber}
        </span>
        <span className="text-[13px] font-semibold text-gray-900">
          {vehicleLabel ?? <span className="text-[#b45309]">Draft vehicle {trip.seq}</span>}
        </span>
        <span className="text-[11.5px] text-gray-500">{metaBits.join(" · ")}</span>
        <span
          className={`ml-auto shrink-0 rounded-full px-2.5 py-[3px] text-[10px] font-bold uppercase tracking-[0.07em] ${meta.cls}`}
        >
          {meta.label}
        </span>
      </button>

      {/* The bar + legend. Always rendered, open or closed — the whole point of
          the band is answering "what is still pending here" without expanding. */}
      <div className="grid grid-cols-[1fr_auto] items-center gap-3.5 px-3.5 pb-3">
        <ProgressBar counts={counts} className="min-w-[120px]" />
        <div className="flex flex-wrap gap-3 text-[11.5px] tabular-nums text-gray-600">
          {counts.done > 0 && (
            <span>
              <i className="mr-1.5 inline-block h-2 w-2 rounded-[3px] bg-[#22c55e] align-[0px]" />
              <b className="font-bold">{counts.done}</b> done
            </span>
          )}
          {counts.needsCheck > 0 && (
            <span>
              <i className="mr-1.5 inline-block h-2 w-2 rounded-[3px] bg-[#fbbf24] align-[0px]" />
              <b className="font-bold">{counts.needsCheck}</b> need check
            </span>
          )}
          {counts.withPicker > 0 && (
            <span>
              <i className="mr-1.5 inline-block h-2 w-2 rounded-[3px] bg-[#0284C7] align-[0px]" />
              <b className="font-bold">{counts.withPicker}</b> with picker
            </span>
          )}
          {counts.waiting > 0 && (
            <span>
              <i className="mr-1.5 inline-block h-2 w-2 rounded-[3px] bg-[#d1d5db] align-[0px]" />
              <b className="font-bold">{counts.waiting}</b>{" "}
              {/* The gate is the ONLY thing on this screen that changes copy, and
                  only on a draft: with desk control on, a draft trip's bills are
                  genuinely invisible downstairs, which is a different fact from
                  "waiting for a picker". */}
              {gateOn && trip.status === "draft" ? "at desk, floor cannot see" : "waiting"}
            </span>
          )}
          {pending === 0 && counts.total > 0 && <span className="text-gray-400">nothing pending</span>}
          {counts.total === 0 && <span className="text-gray-400">no bills yet</span>}
        </div>
      </div>

      {/* ── Actions ────────────────────────────────────────────────────────
          Draft:     [Confirm plan / Release to floor] · Add bills · Change vehicle · Cancel trip
          Confirmed:                                     Add bills · Change vehicle · Cancel trip
          Cancelled / dispatched: none at all.

          ⚠ ALWAYS VISIBLE, open or closed. The whole point of a band is that
          the operator can act on a trip without expanding it — expanding is for
          reading the bills, not for reaching the buttons.

          ⚠ ONE PRIMARY, and only on a draft. Confirm/Release is the state's real
          job; everything else is a plain bordered button (CLAUDE_UI §1's
          one-teal-per-state rule, the same discipline the detail panel header
          follows). */}
      {showActions && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[#f0f0f0] px-3.5 py-2.5">
          {isDraft && onRelease && (
            <button
              type="button"
              onClick={() => onRelease(trip.id)}
              disabled={busy || counts.total === 0}
              title={
                counts.total === 0
                  ? "Add bills to this trip first"
                  : wording.releaseButton
              }
              className={ACTION_PRIMARY}
            >
              {busy ? "Working…" : wording.releaseButton}
            </button>
          )}
          {onAddBills && (
            <button type="button" onClick={() => onAddBills(trip.id)} disabled={busy} className={ACTION}>
              Add bills
            </button>
          )}
          {onChangeVehicle && (
            <button type="button" onClick={() => onChangeVehicle(trip.id)} disabled={busy} className={ACTION}>
              Change vehicle
            </button>
          )}
          {onCancelTrip && (
            <button
              type="button"
              onClick={() => onCancelTrip(trip.id)}
              disabled={busy}
              className={`${ACTION} !text-[#b91c1c] hover:!bg-[#fef2f2]`}
            >
              Cancel trip
            </button>
          )}

          {/* 🔴 SAYS WHAT IS TRUE. With desk control off the bills are ALREADY
              on the supervisor's board, so the button settles the plan and
              changes nothing downstairs. Promising a handover that will not
              happen is how an operator stops trusting the button. */}
          {isDraft && onRelease && wording.releaseCaveat && (
            <span className="basis-full text-[10.5px] text-gray-400">{wording.releaseCaveat}</span>
          )}
        </div>
      )}

      {open && rows.length > 0 && (
        <FloorTable
          rows={rows}
          nowMs={nowMs}
          variant={variant}
          selection={selection}
          onToggleRow={onToggleRow}
          onToggleAll={onToggleAll}
          onMarkUrgent={onMarkUrgent}
          onOpenDetail={onOpenDetail}
          gateOn={gateOn}
        />
      )}

      {/* The honest gap. `counts.total` is every bill on the trip; `rows` is the
          ones still on today's live board. A finished trip has all of the first
          and none of the second, and saying so is better than an empty table
          under a full progress bar. */}
      {open && rows.length === 0 && counts.total > 0 && (
        <div className="border-t border-[#f0f0f0] px-3.5 py-3 text-[11px] text-gray-400">
          {counts.done === counts.total
            ? `All ${counts.total} bill${counts.total === 1 ? "" : "s"} finished — they have left the live board.`
            : `None of this trip's ${counts.total} bill${counts.total === 1 ? " is" : "s are"} on today's board.`}
        </div>
      )}
      {open && counts.total === 0 && (
        <div className="border-t border-[#f0f0f0] px-3.5 py-3 text-[11px] text-gray-400">
          No bills on this trip yet.
        </div>
      )}
    </div>
  );
}
