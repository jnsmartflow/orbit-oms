"use client";

// Floor Control — THE TRIP DESK. The whole Floor tab: rail on the left, bills in
// the middle (v3 mockup).
//
// 🔴 IT REPLACES floor-board.tsx's Floor-tab rendering. That file is NOT deleted
// — archiving is a later step — it simply stops being rendered. What went with
// it, and why (v3 §04): the slot tabs (the trips are already grouped by slot on
// the rail), By picker (unreachable since 2026-08-27 anyway), By group, the
// At-desk pool block, and the decision rail with its cards, slot picker and
// suggestion layer. All of them existed because the desk used to assign pickers
// and choose slots by hand. It does neither now.
//
// TWO STATES, decided by the rail's selection and nothing else:
//   pool  → header + Flat | By route pivot + the table
//   trip  → trip header + the bills grouped under STOPS
//
// ⚠ THE STOPS ARE RENDERED AS ONE FloorTable PER STOP, with a header row above
// each. The mockup draws one table with colspan separator rows; a table per stop
// is the same thing on screen — every FloorTable shares the one colgroup, so the
// columns line up across them — and it is the pattern SlotBand and RouteRow
// already use. It also keeps `toggleAll` per group, which is the contract
// lib/floor/selection.ts documents.
//
// ⚠ NO WINDOW-LEVEL KEY LISTENER ANYWHERE UNDER HERE. floor-page.tsx is the
// single Esc owner for the floor tree (FLOOR §4.6).

import { useState, type ReactNode } from "react";
import { sortPickingQueue } from "@/lib/picking/sort";
import { FLOOR_SPINE } from "@/lib/floor/sort";
import { FloorTable } from "./floor-table";
import { RouteRow } from "./route-row";
import { TripRail, type RailSelection } from "./trip-rail";
import { TripDetailHeader } from "./trip-detail-header";
import {
  countByStatus,
  finishedCount,
  formatLitres,
  sumLitres,
  formatWeightKg,
  sumWeightKg,
} from "./status-pill";
import type { FloorSelection } from "@/lib/floor/selection";
import type { FloorBoardResult, FloorBoardRow } from "@/lib/floor/types";
import type { TripSummary, TripDetail } from "@/lib/trips/queries";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function istTodayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
/**
 * The IST calendar day an instant falls on, for the date-bar strip below.
 *
 * ⚠ SAFE AGAINST THE OFFSET-LESS-STRING TRAP (CORE §3) BY ITS INPUT, not by
 * luck. `Date | string | null` is the shared PickingQueueRow shape: a real Date
 * is unambiguous, and every STRING this board carries is produced server-side by
 * `.toISOString()` (lib/floor/queries.ts), so it always ends in `Z` and reads as
 * UTC on a depot phone and on Vercel alike. Never point this at a hand-built
 * "YYYY-MM-DDTHH:mm" — that one is parsed in the HOST's zone, the two hosts
 * disagree by 5.5 hours, and it only shows near midnight.
 */
function istDayOf(at: Date | string | null): string | null {
  return at === null ? null : new Date(at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function addDaysIso(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}
function fmtHistLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WD[dt.getUTCDay()]} ${dt.getUTCDate()} ${MON[dt.getUTCMonth()]}`;
}

/**
 * What every leaf table needs beyond its own rows. Typed rather than left as a
 * Record so the spread into FloorTable and RouteRow is CHECKED — a bare
 * Record<string, unknown> widens `selection` to unknown and the two call sites
 * below would stop type-checking against their own props.
 */
type LeafProps = {
  selection?: FloorSelection;
  onToggleRow?: (id: number) => void;
  onToggleAll?: (rows: FloorBoardRow[]) => void;
  onMarkUrgent: (id: number) => void;
  onOpenDetail: (id: number) => void;
  gateOn: boolean;
};

// FLOOR_SPINE, imported and never re-implemented (FLOOR §3).
const sort = (rows: FloorBoardRow[]) => sortPickingQueue(rows, FLOOR_SPINE) as FloorBoardRow[];

export function TripDesk({
  floor,
  trips,
  tripsLoading,
  tripDetail,
  selection: railSelection,
  onSelectRail,
  gateOn,
  histDate,
  onEnterHistory,
  onExitHistory,
  onStepHistory,
  rowSelection,
  onToggleRow,
  onToggleAll,
  onMarkUrgent,
  onOpenDetail,
  tripBusyId,
  onReleaseTrip,
  onChangeVehicle,
  onCancelTrip,
}: {
  floor: FloorBoardResult;
  trips: TripSummary[] | null;
  tripsLoading: boolean;
  /** The selected trip's drops, from GET /api/floor/trips/[id]. null while loading. */
  tripDetail: TripDetail | null;
  selection: RailSelection;
  onSelectRail: (sel: RailSelection) => void;
  gateOn: boolean;
  histDate: string | null;
  onEnterHistory: () => void;
  onExitHistory: () => void;
  onStepHistory: (delta: number) => void;
  rowSelection: FloorSelection;
  onToggleRow: (id: number) => void;
  onToggleAll: (rows: FloorBoardRow[]) => void;
  onMarkUrgent: (id: number) => void;
  onOpenDetail: (id: number) => void;
  tripBusyId: number | null;
  onReleaseTrip: (tripId: number) => void;
  onChangeVehicle: (tripId: number) => void;
  onCancelTrip: (tripId: number) => void;
}) {
  const [pivot, setPivot] = useState<"flat" | "route">("flat");
  const [openRoute, setOpenRoute] = useState<string | null>(null);

  const isHistory = floor.mode === "history";
  const variant = isHistory ? "history" : "live";
  const nowMs = Date.now();
  const dueRows = floor.rows.filter((r) => r.zone !== "upcoming");

  // Selection/urgent/detail wiring, forwarded to every leaf table. Read-only in
  // History: a past day is a record, and every write path would edit a day the
  // depot has already closed (the same rule the detail panel's `history` source
  // follows, FLOOR §4.7).
  const selProps: LeafProps = isHistory
    ? { onMarkUrgent, onOpenDetail, gateOn }
    : { selection: rowSelection, onToggleRow, onToggleAll, onMarkUrgent, onOpenDetail, gateOn };

  // ── THE POOL, IN TWO HALVES (2026-09-10 b) ───────────────────────────────
  //
  // 🔴 UPCOMING BILLS ARE BACK ON THE SCREEN. They never left the payload —
  // `floorLiveBaseWhere` has no forward date fence and never had one — but the
  // only thing that rendered them was upcoming-strip.tsx, inside the old board,
  // and when that stopped rendering on 2026-09-10 a bill promised for Saturday
  // simply vanished. `dueRows` (:124) is still the set every COUNT on this
  // screen uses, because a bill due Saturday is not today's workload; the LIST
  // below shows both, with a divider between them.
  //
  // ⚠ THE ZONE TEST IS THE ROW'S OWN, not a date compare done here. `zone` is
  // computed server-side by the one expression lib/picking/queue.ts:763 and
  // lib/floor/queries.ts:793 share, and it already handles the two cases a naive
  // `targetDate > today` gets wrong: a NULL date is "due", never "upcoming", and
  // a bill a supervisor released early stays "due" for good.
  const upcomingAll = floor.rows.filter((r) => r.zone === "upcoming");
  const poolRows = dueRows.filter((r) => r.tripDropId === null);
  const poolUpcoming = upcomingAll.filter((r) => r.tripDropId === null);
  const selectedTrip =
    railSelection.kind === "trip"
      ? (trips ?? []).find((t) => t.id === railSelection.tripId) ?? null
      : null;

  // ── The date bar — unchanged from the old board ──────────────────────────
  const yesterdayIso = addDaysIso(istTodayIso(), -1);
  const forwardDisabled = (histDate ?? "") >= yesterdayIso;
  const navCls =
    "flex h-6 w-6 items-center justify-center rounded-[5px] border border-gray-200 bg-white text-gray-500 disabled:opacity-40";

  // ── THE LIVE STRIP — it now COUNTS WHAT IT CLAIMS (2026-09-13) ───────────
  //
  // 🔴 IT USED TO READ "{liveCounts.done} checked today" AND THAT WAS A LIE THE
  // MOMENT THE BOARD GREW A CARRIED ARM. `countByStatus().done` is a STAGE
  // bucket — it counts rows sitting at pick_checked — and says nothing about
  // WHEN they were checked. That was exact while the only way onto the live
  // board for a checked bill was arm 1's checked-TODAY branch. It stopped being
  // exact on 2026-09-11 when `floorCarriedPoolWhere` began admitting bills
  // checked on any day, and again on 2026-09-13 with `floorTripBillsWhere`.
  // Measured on 2026-09-12 the strip claimed 184 checked today when 165 were;
  // measured early on 2026-09-13, before anyone had checked anything, it
  // claimed 47 checked today when the true figure was ZERO. A number that wrong
  // is worse than no number.
  //
  // ⚠ WORDING AND COUNTING ONLY — NO PREDICATE MOVED. The payload already
  // carries what an honest count needs: every checked row on the board has a
  // `checkedAt` (measured live, 47 of 47, none null), so the day test is done
  // HERE on data already fetched. No arm, no `floorBoardWhere`, no extra fetch
  // and no per-row lookup was touched to get this.
  //
  // ⚠ `countByStatus` IS STILL THE OWNER OF THE FOUR STATUSES and is not
  // re-implemented. `stillOpen` comes straight off it, exactly as before; only
  // the checked HALF is split by date, and it is split here rather than inside
  // the shared helper because widening `StatusCounts` would change what "done"
  // means on the slot bands, the route rows and the By-picker cards too.
  //
  // The three numbers partition `dueRows` exactly, so the strip still adds up.
  // A checked row with no timestamp would fall in "checked earlier" — it cannot
  // be shown as today's without a date saying so, and none exist today.
  const liveCounts = countByStatus(dueRows);
  const stillOpen = liveCounts.total - liveCounts.done;
  const todayIso = istTodayIso();
  const checkedToday = dueRows.filter((r) => r.isChecked && istDayOf(r.checkedAt) === todayIso).length;
  const checkedEarlier = liveCounts.done - checkedToday;

  const dateBar = isHistory ? (
    <div className="flex items-center gap-2 border-b border-gray-200 bg-[#f9fafb] px-3.5 py-[7px] text-[11.5px]">
      <button type="button" className={navCls} onClick={() => onStepHistory(-1)}>‹</button>
      <span className="font-semibold">{histDate ? fmtHistLabel(histDate) : ""}</span>
      <button type="button" className={navCls} disabled={forwardDisabled} onClick={() => !forwardDisabled && onStepHistory(1)}>›</button>
      <span className="ml-2 text-[10.5px] text-gray-400">past day — read only</span>
      <button type="button" className="ml-auto text-[10.5px] font-semibold text-brand-600" onClick={onExitHistory}>
        Back to Live ›
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-2 border-b border-gray-200 bg-[#fcfcfd] px-3.5 py-[7px] text-[11.5px]">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#10b981]" />
      <span className="font-semibold">Live</span>
      <span className="text-[10.5px] text-gray-400">
        {stillOpen} still open &middot; {checkedToday} checked today
        {checkedEarlier > 0 && <> &middot; {checkedEarlier} checked earlier</>}
      </span>
      <button type="button" className="ml-auto text-[10.5px] font-semibold text-brand-600" onClick={onEnterHistory}>
        History ›
      </button>
    </div>
  );

  // ── The middle ───────────────────────────────────────────────────────────
  let middle: ReactNode;

  if (railSelection.kind === "pool") {
    // The header describes the WHOLE pool, both halves, because that is what
    // the table below lists — a header that counted only the due half would not
    // add up to the rows on screen. The divider gives the upcoming subtotal.
    const allPool = [...poolRows, ...poolUpcoming];
    const litres = sumLitres(allPool);
    const weight = sumWeightKg(allPool);
    const weightStr = formatWeightKg(weight.kg);
    middle = (
      <>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-gray-200 px-4 py-3">
          <h4 className="m-0 text-[14px] font-bold tracking-[-0.01em] text-gray-900">Not on a trip</h4>
          <span className="text-[12px] tabular-nums text-gray-500">
            {allPool.length} bill{allPool.length === 1 ? "" : "s"} · {formatLitres(litres)} L
            {weightStr !== null && (
              // "+" when some bill has no weight recorded — the total is a lower
              // bound, never a guess. See sumWeightKg in status-pill.tsx.
              <span
                title={
                  weight.unknown > 0
                    ? `${weight.unknown} bill${weight.unknown === 1 ? " has" : "s have"} no weight recorded`
                    : undefined
                }
              >
                {" · "}
                {weightStr}
                {weight.unknown > 0 ? "+" : ""} kg
              </span>
            )}
          </span>
          <span className="ml-auto inline-flex gap-[2px] rounded-[7px] bg-gray-100 p-[2px]">
            {(["flat", "route"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPivot(p)}
                className={`rounded-[5px] px-3 py-[4px] text-[11px] ${
                  pivot === p ? "bg-white font-semibold text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {p === "flat" ? "Flat" : "By route"}
              </button>
            ))}
          </span>
        </div>

        {allPool.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="text-[28px] leading-none text-gray-300">○</div>
            <h4 className="mt-2 text-[13px] font-semibold text-gray-900">Every bill is on a trip</h4>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
              Nothing is waiting to be planned. New bills land here as they arrive.
            </p>
          </div>
        ) : pivot === "flat" ? (
          <FloorTable
            rows={sort(poolRows)}
            upcomingRows={sort(poolUpcoming)}
            anchorIso={floor.date}
            nowMs={nowMs}
            variant={variant}
            {...selProps}
          />
        ) : (
          <>
            {/* By route groups the DUE half only, exactly as it did. Routes are
                a way of reading today's work, and folding Saturday's bills into
                "Adajan is 2 of 9" would change a number the operator already
                reads. The upcoming half follows the route rows as one block,
                with the same divider the flat view uses. */}
            <ByRoute rows={poolRows} nowMs={nowMs} anchorIso={floor.date} variant={variant} openRoute={openRoute} onToggleRoute={setOpenRoute} selProps={selProps} />
            {poolUpcoming.length > 0 && (
              <FloorTable
                rows={[]}
                upcomingRows={sort(poolUpcoming)}
                anchorIso={floor.date}
                nowMs={nowMs}
                variant={variant}
                {...selProps}
              />
            )}
          </>
        )}
      </>
    );
  } else if (!selectedTrip) {
    middle = (
      <div className="px-5 py-14 text-center text-[11.5px] text-gray-400">
        That trip is no longer on this day&rsquo;s board.
      </div>
    );
  } else {
    // The trip's bills, grouped under its stops. `tripDetail` carries the drops
    // in dropSeq order and which orders sit on each; the board carries the rows.
    //
    // ⚠ A DROP CAN STILL HOLD BILLS THE BOARD DOES NOT CARRY, and the stop
    // renders anyway with a line saying so, rather than vanishing and making
    // the stop count disagree with the header's.
    //
    // 🔴 THAT LINE USED TO BE A GUESS, AND FROM 2026-09-13 IT IS ALSO RARE.
    // It read "N bills finished — off today's live board", which asserted two
    // things this component cannot see: that the bills were finished, and that
    // being finished is why they are absent. The real cause was a gap in the
    // board predicate — a bill checked on an earlier day and now on a trip
    // matched no arm — and `floorTripBillsWhere` (lib/floor/queries.ts) closes
    // it. For any bill on a live, non-cancelled trip dated today or later, this
    // branch is now unreachable. It is kept as an HONEST fallback for the one
    // case left (a bill whose `dispatchStatus` is not "dispatch", which every
    // arm pins), and its wording now states only what is observable here: the
    // row is not in the payload. Why it is not in the payload is a question
    // this file has no way to answer and must stop pretending to.
    // ⚠ BUILT FROM THE WHOLE BOARD, NOT `dueRows`. A bill promised for a later
    // date can sit on a trip — that is the point of being able to plan Saturday
    // on Thursday — and while this map read only the due half, such a bill was
    // missing from its stop and the stop rendered the "finished, off today's
    // board" line instead. Wrong on both counts.
    const rowById = new Map(
      [...dueRows, ...upcomingAll].map((r) => [r.orderId, r] as const),
    );
    const drops = tripDetail?.id === selectedTrip.id ? tripDetail.drops : [];

    middle = (
      <>
        <TripDetailHeader
          trip={selectedTrip}
          gateOn={gateOn}
          busy={tripBusyId === selectedTrip.id}
          readOnly={isHistory}
          onRelease={() => onReleaseTrip(selectedTrip.id)}
          onAddBills={() => onSelectRail({ kind: "pool" })}
          onChangeVehicle={() => onChangeVehicle(selectedTrip.id)}
          onCancelTrip={() => onCancelTrip(selectedTrip.id)}
        />

        {tripDetail === null || tripDetail.id !== selectedTrip.id ? (
          <div className="px-5 py-10 text-center text-[11.5px] text-gray-400">Loading stops…</div>
        ) : drops.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="text-[28px] leading-none text-gray-300">○</div>
            <h4 className="mt-2 text-[13px] font-semibold text-gray-900">No bills on this trip yet</h4>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
              Press Add bills, tick what goes on it, then Add to trip.
            </p>
          </div>
        ) : (
          drops.map((d) => {
            const rows = d.orderIds
              .map((id) => rowById.get(id))
              .filter((r): r is FloorBoardRow => r !== undefined);
            return (
              <div key={d.id}>
                {/* The STOP row — a customer, numbered in visit order. */}
                <div className="flex items-center gap-2 border-y border-[#f0eef5] bg-[#fbfaff] px-3.5 py-2">
                  <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] bg-gray-900 text-[10.5px] font-bold text-white">
                    {d.dropSeq}
                  </span>
                  <span className="truncate text-[12px] font-semibold text-gray-900">{d.customerName}</span>
                  <span className="truncate text-[11.5px] tabular-nums text-gray-500">
                    {d.areaName ? `· ${d.areaName} ` : ""}· {d.bills} bill{d.bills === 1 ? "" : "s"} ·{" "}
                    {formatLitres(d.litres)} L
                  </span>
                </div>
                {rows.length > 0 ? (
                  // No zone partition INSIDE a stop: a stop is one customer and
                  // its bills are read as one delivery. The Due cell on each row
                  // still says which day it is promised for.
                  <FloorTable
                    rows={sort(rows)}
                    anchorIso={floor.date}
                    nowMs={nowMs}
                    variant={variant}
                    {...selProps}
                  />
                ) : (
                  <div className="px-3.5 py-2.5 pl-[34px] text-[11px] text-gray-400">
                    {d.bills} bill{d.bills === 1 ? " is" : "s are"} on this stop, not on today&rsquo;s board.
                  </div>
                )}
              </div>
            );
          })
        )}
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {dateBar}
      <div className="grid min-h-0 flex-1 overflow-hidden" style={{ gridTemplateColumns: "298px 1fr" }}>
        <TripRail
          trips={trips}
          loading={tripsLoading}
          anchorIso={floor.date}
          poolCount={poolRows.length + poolUpcoming.length}
          poolLitres={sumLitres([...poolRows, ...poolUpcoming])}
          selection={railSelection}
          onSelect={onSelectRail}
          gateOn={gateOn}
        />
        <div className="min-h-0 overflow-y-auto">{middle}</div>
      </div>
    </div>
  );
}

/** By route — the same RouteRow the old board used, worst-first. */
function ByRoute({
  rows,
  nowMs,
  anchorIso,
  variant,
  openRoute,
  onToggleRoute,
  selProps,
}: {
  rows: FloorBoardRow[];
  nowMs: number;
  anchorIso: string;
  variant: "live" | "history" | "upcoming";
  openRoute: string | null;
  onToggleRoute: (name: string | null) => void;
  selProps: LeafProps;
}) {
  const map = new Map<string, FloorBoardRow[]>();
  for (const r of rows) {
    const k = r.route ?? "No route";
    const arr = map.get(k) ?? [];
    arr.push(r);
    map.set(k, arr);
  }
  const groups = Array.from(map.entries()).sort((a, b) => {
    // The completion RATIO, worst-first. finishedCount, not `done` alone
    // (2026-09-11): on a history day a route whose bills had all shipped scored
    // 0% and floated to the top as the worst route on the board, when it was in
    // fact the most complete one. Unchanged on a live board — `dispatched` is
    // always 0 there, so this is byte-for-byte the old ratio.
    const ca = countByStatus(a[1]);
    const cb = countByStatus(b[1]);
    const pa = ca.total ? finishedCount(ca) / ca.total : 1;
    const pb = cb.total ? finishedCount(cb) / cb.total : 1;
    if (pa !== pb) return pa - pb;
    return b[1].length - a[1].length;
  });

  return (
    <>
      {groups.map(([name, gr]) => (
        <RouteRow
          key={name}
          name={name}
          rows={sort(gr)}
          nowMs={nowMs}
          anchorIso={anchorIso}
          open={openRoute === name}
          onToggle={() => onToggleRoute(openRoute === name ? null : name)}
          variant={variant}
          {...selProps}
        />
      ))}
    </>
  );
}
