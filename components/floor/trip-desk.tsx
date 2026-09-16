"use client";

// Floor Control — THE TRIP DESK. The whole Floor tab: rail on the left, bills in
// the middle (v3 mockup).
//
// 🔴 IT REPLACED floor-board.tsx's Floor-tab rendering, and that file was
// deleted in slice 6 (2026-09-15). What went with it, and why (v3 §04): the
// slot tabs (the slot is a chip on each rail card since slice 6), By picker
// (unreachable since 2026-08-27 anyway), By group, the
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
// columns line up across them — and it is the pattern RouteRow already uses
// (and SlotBand did, until slot-band.tsx was deleted as an orphan, 2026-09-15). It also keeps `toggleAll` per group, which is the contract
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
  rowStatus,
  isTintRoomRow,
  countByStatus,
  finishedCount,
  formatLitres,
  sumLitres,
  formatWeightKg,
  sumWeightKg,
} from "./status-pill";
import type { FloorSelection } from "@/lib/floor/selection";
import type { FloorBoardResult, FloorBoardRow, FloorScope } from "@/lib/floor/types";
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
  scope,
  onChangeVehicle,
  onCancelTrip,
  onSetTripShown,
  onSetTripSentToBilling,
  activeTab,
  tabs,
  sideBody,
  tintOperators,
  unfilteredRows,
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
  /** The page's delivery-type scope. The rail filters trips by it (slice 6). */
  scope: FloorScope;
  onChangeVehicle: (tripId: number) => void;
  onCancelTrip: (tripId: number) => void;
  /** Show to floor (`shown: true`) or take back (`false`) — slice 8. */
  onSetTripShown: (tripId: number, shown: boolean) => void;
  /** Send to billing (`sent: true`) or take back (`false`) — slice 9. */
  onSetTripSentToBilling: (tripId: number, sent: boolean) => void;
  /** Which of the four tabs is open. The RAIL is identical on all of them. */
  activeTab: "floor" | "tinting" | "hold" | "cancelled";
  /** The tab pills + their counts + New trip, built by floor-page and rendered
   *  as the first child of the TABLE column. Passed as a node rather than
   *  rebuilt here: the counts come from four different filtered lists that
   *  floor-page already owns, and a second derivation of them is two answers. */
  tabs: ReactNode;
  /** The Hold / Cancelled body. Rendered in the table column when `activeTab`
   *  is neither floor nor tinting, so those tabs keep the rail beside them. */
  sideBody: ReactNode;
  /** Order id → tint operator name, for the Tinting tab's Operator column.
   *  null while it has not been fetched — the tab is what triggers the fetch,
   *  so the Floor tab never asks (see /api/floor/tint-operators). */
  tintOperators: Map<number, string | null> | null;
  /**
   * The board rows BEFORE search and the Status/Flags filter (2026-09-14).
   *
   * 🔴 IT EXISTS SO A POOL FILTER CANNOT EMPTY THE TRIP PANE. The stop lookup
   * below used the filtered array, so ticking one Status chip blanked every stop
   * on every trip and each one fell back to "not on today's board". Live case:
   * L-260914-01, 5 stops and 11 bills, all 11 genuinely on the board — the
   * filter was the whole of it, and the two that still rendered an hour earlier
   * had simply not yet moved out of the filtered set.
   *
   * ⚠ THE TRIP PANE IS A RECORD OF WHAT IS ON THE TRIP. A filter aimed at the
   * pool has no business deciding what a stop contains. Everything else in this
   * component still reads the FILTERED `floor` — only the lookup changed.
   */
  unfilteredRows: FloorBoardRow[];
}) {
  const [pivot, setPivot] = useState<"flat" | "route">("flat");
  const [openRoute, setOpenRoute] = useState<string | null>(null);

  const isHistory = floor.mode === "history";
  const variant = isHistory ? "history" : "live";
  const nowMs = Date.now();
  // ── THE FLOOR / TINTING SPLIT (2026-09-14) ───────────────────────────────
  //
  // 🔴 EXCLUDED HERE, ONCE, AT THE TOP. Every Floor list below is built from
  // `dueRows` or `upcomingAll`, so excluding at this line is what makes the two
  // tabs exact complements. The bug this fixes was having the include without
  // the exclude: the Tinting tab filtered rows IN and nothing filtered them OUT,
  // so five bills rendered on both tabs and Floor's badge counted them twice.
  //
  // ⚠ `floor.rows` STAYS WHOLE. `tintingTabRows` below reads the unfiltered
  // array, and so does the Tinting tab's own count in floor-page.tsx. Filtering
  // the source would empty the tab it feeds.
  //
  // ⚠ ONE PREDICATE, NOT A SECOND COPY OF THE CONDITION. `isTintRoomRow` lives
  // beside `rowStatus` in status-pill.tsx, which owns "what state is this row
  // in" for the whole screen.
  const floorTabRows = floor.rows.filter((r) => !isTintRoomRow(r));
  const dueRows = floorTabRows.filter((r) => r.zone !== "upcoming");

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
  const upcomingAll = floorTabRows.filter((r) => r.zone === "upcoming");
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

  // ── THE DATE CONTROL SPLIT IN TWO (2026-09-14) ───────────────────────────
  //
  // It used to be one full-width bar above the rail AND the table. The tab row
  // moved into the table column (the original July shape, and the one Mail
  // Orders still uses), and this went with it — split by JOB, not by chunk:
  //
  //   dateControl  the things you PRESS — History ›, or the ‹ date › stepper
  //                and Back to Live. Rides the tab row, right-aligned.
  //   liveBar      the things you READ — Live + the counts, or "past day —
  //                read only". Its own strip under the tabs.
  //
  // Controls up with the other controls, information down next to the data it
  // describes. Both live INSIDE the table column now, so neither moves when the
  // rail is there and neither spans the rail.
  // ── THE FLAT / BY ROUTE PIVOT, LIFTED (2026-09-14) ───────────────────────
  //
  // 🔴 IT USED TO BE A CHILD OF THE "To plan" HEADING ROW, which is why it had
  // to move BEFORE that row could be deleted. It lost its `ml-auto` parent in
  // the lift, so it carries its own right-alignment here.
  //
  // ⚠ RENDERED WHERE IT DOES SOMETHING, AND NOWHERE ELSE. It controls the POOL
  // and the TINTING list, which are the two views that group by route. On a
  // selected TRIP the bills are grouped by STOP and the pivot has nothing to
  // pivot; on Hold and Cancelled it is not that table's control at all. A
  // control that renders and then does nothing when pressed is worse than one
  // that is absent, so it is absent there.
  const showPivot =
    (activeTab === "floor" && railSelection.kind === "pool") || activeTab === "tinting";
  const pivotToggle = showPivot ? (
    <span className="inline-flex gap-[2px] rounded-[7px] bg-gray-100 p-[2px]">
      {(["flat", "route"] as const).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => setPivot(p)}
          className={`rounded-[5px] px-3 py-[3px] text-[11px] ${
            pivot === p ? "bg-white font-semibold text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {p === "flat" ? "Flat" : "By route"}
        </button>
      ))}
    </span>
  ) : null;

  // ── ONE ROW, LEFT AND RIGHT (2026-09-14) ─────────────────────────────────
  //
  // The date control moved DOWN off the tab row and onto this one, and the
  // pivot moved UP off the heading row onto it. Both now sit at the right end,
  // with what you READ on the left:
  //
  //   live     ● Live · N still open · …        [Flat | By route]  History ›
  //   history  ‹ 12 Sept ›                      [Flat | By route]  ‹ Back to Live
  //
  // ⚠ THE HISTORY STEPPER REPLACES "past day — read only" rather than sitting
  // beside it. The stepper IS the read-only signal: it names a past date and the
  // forward arrow is disabled at yesterday. A second row for a caption would be
  // a row that says nothing the date does not.
  const liveBar = (
    <div
      className={`flex items-center gap-2 border-b border-gray-200 px-3.5 py-[7px] text-[11.5px] ${
        isHistory ? "bg-[#f9fafb]" : "bg-[#fcfcfd]"
      }`}
    >
      {isHistory ? (
        <>
          <button type="button" className={navCls} onClick={() => onStepHistory(-1)}>‹</button>
          <span className="font-semibold">{histDate ? fmtHistLabel(histDate) : ""}</span>
          <button
            type="button"
            className={navCls}
            disabled={forwardDisabled}
            onClick={() => !forwardDisabled && onStepHistory(1)}
          >
            ›
          </button>
        </>
      ) : (
        <>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#10b981]" />
          <span className="font-semibold">Live</span>
          <span className="text-[10.5px] text-gray-400">
            {stillOpen} still open &middot; {checkedToday} checked today
            {checkedEarlier > 0 && <> &middot; {checkedEarlier} checked earlier</>}
          </span>
        </>
      )}
      <span className="ml-auto flex items-center gap-3">
        {pivotToggle}
        {isHistory ? (
          <button type="button" className="text-[10.5px] font-semibold text-brand-600" onClick={onExitHistory}>
            &lsaquo; Back to Live
          </button>
        ) : (
          <button type="button" className="text-[10.5px] font-semibold text-brand-600" onClick={onEnterHistory}>
            History &rsaquo;
          </button>
        )}
      </span>
    </div>
  );

  // ── THE TINTING TAB (2026-09-14) ─────────────────────────────────────────
  //
  // 🔴 A CLIENT-SIDE SPLIT OF ROWS THE BOARD ALREADY HAS. Every bill here came
  // in through `floorBoardWhere` arm 2 and is a row like any other — no
  // predicate, no arm, no query was added to build this tab. It is a `filter`.
  //
  // WHAT IT HOLDS: tint bills NOT YET BEING MIXED — `pending_tint_assignment`
  // and `tint_assigned`. A bill LEAVES this tab the moment mixing starts and
  // appears on Floor wearing the solid pink Tinting pill, because at that point
  // it is coming soon and the planner should be looking at it.
  //
  // ⚠ THE STATUS ASKED IS rowStatus, NOT `tintPhase` DIRECTLY. The phase says
  // where the tint room is; the status says whether anyone downstream has taken
  // over. They agree here today, and asking the one owner is what keeps them
  // agreeing if the picking booleans ever start outranking the phase for one of
  // these stages.
  // The include half of the same split — `floorTabRows` above is its exact
  // complement, both through the one predicate.
  const tintingTabRows = floor.rows.filter(isTintRoomRow);
  // ⚠ NO HEADING ROW (2026-09-14). "In the tint room · N bills · N L" was
  // deleted with its Floor twin: the tab pill above already names the view and
  // carries the count, and the row spent 44px repeating it. Nothing else read
  // it — its counts were computed inline from `tintingTabRows`, which the table
  // below still uses.
  //
  // ⚠ Invoice OFF, Operator ON — they share the third column slot. Neither bill
  // on this tab has been picked, so no invoice exists and the column would be
  // blank on every row (floor-table.tsx explains the sharing). `tintOperators`
  // is null until the tab's own fetch lands; an empty map renders a dash
  // everywhere, which is the honest in-between state.
  const tintLeaf = {
    showInvoice: false,
    operatorByOrderId: tintOperators ?? new Map<number, string | null>(),
  };
  const tintingBody: ReactNode = (
    <>
      {tintingTabRows.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <div className="text-[28px] leading-none text-gray-300">○</div>
          <h4 className="mt-2 text-[13px] font-semibold text-gray-900">Nothing waiting on tint</h4>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
            Every tint bill is either being mixed or finished. Both are on the Floor tab.
          </p>
        </div>
      ) : pivot === "route" ? (
        // The pivot lives on the Live row now and that row renders on every tab,
        // so this tab has to honour it too — a toggle that moved but only worked
        // on one of the two views it is shown above would be worse than the
        // heading row it came from.
        <ByRoute
          rows={sort(tintingTabRows)}
          nowMs={nowMs}
          anchorIso={floor.date}
          variant={variant}
          openRoute={openRoute}
          onToggleRoute={(name) => setOpenRoute(name)}
          selProps={selProps}
          leafProps={tintLeaf}
        />
      ) : (
        <FloorTable
          rows={sort(tintingTabRows)}
          anchorIso={floor.date}
          nowMs={nowMs}
          variant={variant}
          {...tintLeaf}
          {...selProps}
        />
      )}
    </>
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
    // ⚠ UNFILTERED, AND NOT `dueRows`/`upcomingAll` (2026-09-14). Those two are
    // derived from the filtered board, so an active Status chip emptied every
    // stop — see the `unfilteredRows` prop. The tint-room exclusion is dropped
    // here too: a trip can carry a tint bill, and the Tinting TAB is a view of
    // the pool, never a rule about what a stop may contain.
    const rowById = new Map(unfilteredRows.map((r) => [r.orderId, r] as const));
    const drops = tripDetail?.id === selectedTrip.id ? tripDetail.drops : [];
    // ⚠ THE SAME FRESHNESS TEST AS `drops`. tripDetail lags the rail by one
    // fetch when the planner clicks between trips, and showing the PREVIOUS
    // trip's history under this trip's buttons would be worse than showing none
    // — a confident line about the wrong load.
    // NULL, not [], while the detail is still for another trip: the header's
    // clock then shows no count rather than the previous trip's.
    const activity = tripDetail?.id === selectedTrip.id ? tripDetail.activity : null;

    middle = (
      <>
        <TripDetailHeader
          // Keyed by trip, so the ··· menu and the history toggle close when the
          // planner picks another trip.
          key={selectedTrip.id}
          trip={selectedTrip}
          activity={activity}
          busy={tripBusyId === selectedTrip.id}
          readOnly={isHistory}
          onAddBills={() => onSelectRail({ kind: "pool" })}
          onChangeVehicle={() => onChangeVehicle(selectedTrip.id)}
          onCancelTrip={() => onCancelTrip(selectedTrip.id)}
          gateOn={gateOn}
          onShowToFloor={() => onSetTripShown(selectedTrip.id, true)}
          onTakeBackFromFloor={() => onSetTripShown(selectedTrip.id, false)}
          onSendToBilling={() => onSetTripSentToBilling(selectedTrip.id, true)}
          onTakeBackFromBilling={() => onSetTripSentToBilling(selectedTrip.id, false)}
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
          // The panel's 22px bottom padding lives here, under the last stop —
          // the stops are the bottom of the detail panel (design spec).
          <div className="pb-[22px]">
          {drops.map((d, i) => {
            const rows = d.orderIds
              .map((id) => rowById.get(id))
              .filter((r): r is FloorBoardRow => r !== undefined);
            return (
              // 20px between stops, the first 6px under the stops bar (design
              // spec, 2026-09-15). `i` is the stop's index in the trip's drops.
              <div key={d.id} className={i === 0 ? "mt-1.5" : "mt-5"}>
                {/* The STOP HEADER — a customer, numbered in visit order.
                    🔴 NO BAND (owner, 2026-09-15): the tinted full-width strip
                    with a border above and below is gone. The header now sits
                    inside the panel's 18px side padding with ONE hairline under
                    it, and the number is a plain grey mono figure rather than a
                    black square — the customer's name is what a planner is
                    looking for, so nothing else on the line may shout. */}
                <div className="flex flex-wrap items-baseline gap-[9px] border-b border-[#e7e7ee] px-[18px] pb-[7px]">
                  <span className="min-w-[15px] shrink-0 font-mono text-[11px] font-semibold text-[#96969f]">
                    {d.dropSeq}
                  </span>
                  {/* NOT truncated (owner) — a customer name is the thing you
                      came to read; the row wraps instead. */}
                  <span className="text-[14.5px] font-semibold text-[#1a1a22]">{d.customerName}</span>
                  <span className="text-[12.5px] tabular-nums text-[#96969f]">
                    {d.areaName ? `${d.areaName} · ` : ""}{d.bills} bill{d.bills === 1 ? "" : "s"} ·{" "}
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
                    // Every bill here is on THIS trip, so the tag would repeat
                    // the heading on every row (owner). The pool and By route
                    // keep it — out there the trips are mixed.
                    hideTripTag
                    {...selProps}
                  />
                ) : (
                  <div className="px-3.5 py-2.5 pl-[34px] text-[11px] text-gray-400">
                    {/* Slice 10 (2026-09-15): History now pulls a trip's bills BY
                        TRIP (floorHistoryTripBillsWhere), so on either desk this
                        line is reached only by a bill the view itself leaves out
                        — the page's delivery-type scope, or the admin Hide
                        filter. It says only that, and never names a day. */}
                    {d.bills} bill{d.bills === 1 ? " is" : "s are"} on this stop, not in this view.
                  </div>
                )}
              </div>
            );
          })}
          </div>
        )}

        {/* The full history is no longer down here: the clock in the trip
            header opens it in place (floor redesign, 2026-09-15, owner). */}
      </>
    );
  }

  // ── THE MIDDLE COLUMN'S CONTENT, BY TAB ──────────────────────────────────
  //
  // 🔴 THE RAIL RENDERS ON ALL FOUR TABS, and that is the whole reason this
  // component is now the shell for every one of them rather than the Floor
  // tab's body. Before, On hold and Cancelled rendered instead of the desk, the
  // 298px rail vanished, and the table jumped a column-width sideways — every
  // heading landing somewhere new on a tab change. Switching tabs must change
  // WHAT IS IN THE TABLE and never where the table is.
  //
  // On the non-Floor tabs the rail is informational: nothing on those tabs is
  // addable to a trip anyway, so it needs no special rule, no disabled state
  // and no second code path.
  const body: ReactNode =
    activeTab === "tinting" ? tintingBody : activeTab === "floor" ? middle : sideBody;

  return (
    <div className="grid min-h-0 flex-1 overflow-hidden" style={{ gridTemplateColumns: "298px 1fr" }}>
      <TripRail
        trips={trips}
        loading={tripsLoading}
        anchorIso={floor.date}
        scope={scope}
        gateOn={gateOn}
        poolCount={poolRows.length + poolUpcoming.length}
        poolLitres={sumLitres([...poolRows, ...poolUpcoming])}
        selection={railSelection}
        onSelect={onSelectRail}
      />
      {/* THE TABLE COLUMN. Tabs first, exactly as the original July board had
          them and as Mail Orders still does — the scope row spans the page
          above, and everything below it belongs to one column or the other. */}
      <div className="flex min-h-0 flex-col overflow-hidden">
        {/* THE TAB ROW. "+ New trip" stays here; the date control moved DOWN onto
            the Live row below (2026-09-14), so this row is tabs and the one
            filled action and nothing else. */}
        <div className="flex items-center gap-[18px] border-b border-gray-200 bg-white px-3.5">
          {tabs}
        </div>
        {liveBar}
        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
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
  leafProps,
}: {
  rows: FloorBoardRow[];
  nowMs: number;
  anchorIso: string;
  variant: "live" | "history" | "upcoming";
  openRoute: string | null;
  onToggleRoute: (name: string | null) => void;
  selProps: LeafProps;
  /** Column options forwarded to each route's FloorTable — the Tinting tab's
   *  Invoice-off / Operator-on pair. Omitted on the pool, where the defaults
   *  are what every other Floor table already uses. */
  leafProps?: { showInvoice?: boolean; operatorByOrderId?: Map<number, string | null> };
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
          {...leafProps}
          {...selProps}
        />
      ))}
    </>
  );
}
