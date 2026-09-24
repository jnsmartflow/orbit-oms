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
// THREE STATES, decided by the rail's selection and the targeted add:
//   pool  → header + Flat | By route pivot + the table
//   trip  → trip header + the bills grouped under STOPS
//   add   → the trip, UNCHANGED, then the pink band, then the pool below it
//           ("+ Add bills" inside a trip — 2026-09-18, owner). The trip being
//           filled never leaves the screen; scroll down to choose, look up to
//           see what the truck already holds.
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

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { sortPickingQueue } from "@/lib/picking/sort";
import { FLOOR_SPINE } from "@/lib/floor/sort";
import { FloorTable } from "./floor-table";
import { RouteRow } from "./route-row";
import { RouteCards, buildRouteCards, shownCards, tabHasClubs, useCardColumns } from "./route-cards";
import { LoadPlanView } from "./load-plan";
import { LoadPlanV2View } from "./load-plan-v2";
import type { VehicleSize } from "@/lib/trips/vehicle-size";
import type { LoadPlanConfig } from "@/lib/trips/load-plan";
import { TripRail, type RailSelection } from "./trip-rail";
import { TripDetailHeader } from "./trip-detail-header";
import { TripAddBand } from "./trip-add-band";
import { lastUpdateTime } from "./connection-strip";
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
import type { FloorBoardResult, FloorBoardRow, FloorRouteClub, FloorScope } from "@/lib/floor/types";
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

/** Gap above the pink band when "+ Add bills" scrolls to it — the band near the
 *  top of the column, not flush against it, with pool rows readable below. */
const BAND_TOP_GAP = 12;

/** The pool's three views. "plan" is offered only on LOAD_PLAN_SCOPES. */
type PoolView = "flat" | "route" | "plan";
/** Tabs with a Load plan view — Upcountry, where it is also the default. */
const LOAD_PLAN_SCOPES: FloorScope[] = ["Upcountry"];
/**
 * Every tab opens on By route (owner, 2026-09-22). Upcountry opened on Load
 * plan until then; Load plan is still OFFERED there (LOAD_PLAN_SCOPES), just no
 * longer the default. `scope` is kept so a per-tab default stays a one-line
 * change.
 */
const defaultPoolView = (_scope: FloorScope): PoolView => "route";

// FLOOR_SPINE, imported and never re-implemented (FLOOR §3).
const sort = (rows: FloorBoardRow[]) => sortPickingQueue(rows, FLOOR_SPINE) as FloorBoardRow[];

/**
 * Is this row in the POOL — the "To plan" list the Floor tab shows? On no trip,
 * and not in the tint room (that is the Tinting tab's). Both zones.
 *
 * 🔴 EXPORTED SO THE SEARCH AUTO-TICK USES THE SAME TEST (2026-09-18).
 * floor-page.tsx ticks a pasted OBD's rows; it used to tick every match on the
 * board, including bills on trips the pool never shows, so a bill could be
 * ticked where nobody could see it. One predicate, so what is ticked and what is
 * listed cannot disagree.
 */
export function isPoolRow(r: FloorBoardRow): boolean {
  return r.tripDropId === null && !isTintRoomRow(r);
}

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
  addMode,
  addCount,
  sameRouteLabel,
  onAddToTrip,
  addingToTripId,
  lastAddCount,
  onUndoLastAdd,
  onStartAddingTo,
  onDoneAdding,
  activeTab,
  tabs,
  connected,
  lastSyncedAt,
  sideBody,
  tintOperators,
  unfilteredRows,
  routeClubs,
  clubReachRows,
  openRouteCard,
  onOpenRouteCard,
  searchActive,
  loadPlanConfigs,
  routeNames,
  onMakeTrip,
  makeTripBusy,
  bottomBar,
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
  /**
   * ADD MODE (2026-09-16): pool bills are ticked and waiting to be placed, so the
   * rail is the picker. Passed straight through to TripRail; the desk itself has
   * no behaviour of its own here.
   */
  addMode: boolean;
  /** Ticked bills — the rail's "+" button names the count in its aria-label. */
  addCount: number;
  /** The selection-s route when it is a single one — cards matching it say so. */
  sameRouteLabel: string | null;
  onAddToTrip: (tripId: number) => void;
  /**
   * TARGETED ADD MODE (2026-09-16): "+ Add bills" was pressed INSIDE a trip, so
   * the pool opens with that trip written across the top and the rail stops
   * offering a choice. Null when not filling a named trip.
   */
  addingToTripId: number | null;
  /** Bills the last press added — the band-s brief Undo. */
  lastAddCount: number;
  onUndoLastAdd: () => void;
  onStartAddingTo: (tripId: number) => void;
  onDoneAdding: () => void;
  /** Which of the four tabs is open. The RAIL is identical on all of them. */
  activeTab: "floor" | "tinting" | "hold" | "cancelled";
  /** The tab pills + their counts + New trip, built by floor-page and rendered
   *  as the first child of the TABLE column. Passed as a node rather than
   *  rebuilt here: the counts come from four different filtered lists that
   *  floor-page already owns, and a second derivation of them is two answers. */
  tabs: ReactNode;
  /** The floor marker probe's answer (use-picking-marker onProbe) — the live
   *  dot. No poll of its own. */
  connected: boolean;
  /** The last successful board load — the dot's "not connected" tooltip. */
  lastSyncedAt: Date | null;
  /** The Hold / Cancelled body. Rendered in the table column when `activeTab`
   *  is neither floor nor tinting, so those tabs keep the rail beside them. */
  sideBody: ReactNode;
  /** Order id → tint operator name, for the Tinting tab's Operator column.
   *  null while it has not been fetched — the tab is what triggers the fetch,
   *  so the Floor tab never asks (see /api/floor/tint-operators). */
  tintOperators: Map<number, string | null> | null;
  /**
   * The board rows BEFORE search and the Status/Flags filter (2026-09-14), and
   * BEFORE the delivery-type tab (2026-09-18) — a trip's stops show every bill
   * on the trip whatever tab is open (owner; see floor-page.tsx where this is
   * passed).
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
  /** Every route club, all delivery types (GET /api/floor/board `routeClubs`). */
  routeClubs: FloorRouteClub[];
  /**
   * The board rows after search and the Status/Flags filter but BEFORE the
   * delivery-type tab. Read by the route cards for one thing only: a club
   * member whose route has no area on this tab (Kamrej on Local).
   */
  clubReachRows: FloorBoardRow[];
  /**
   * The route card open as chips + table, by its model key (`club:<id>` or
   * `other`), or null for the card grid. floor-page's state, because its Esc
   * listener closes it (2026-09-24).
   */
  openRouteCard: string | null;
  onOpenRouteCard: (key: string | null) => void;
  /** A search is up — the pool shows Flat until it is cleared (2026-09-19). */
  searchActive: boolean;
  /** Load plan rules by delivery type name (GET /api/floor/board `loadPlan`). */
  loadPlanConfigs: Record<string, LoadPlanConfig>;
  /** route_master id → name, for the plan's reasons. */
  routeNames: Record<number, string>;
  /** Make trip on a load-plan card — the New trip flow with these bills. */
  onMakeTrip?: (orderIds: number[], vehicleSize?: VehicleSize) => void;
  makeTripBusy?: boolean;
  /**
   * The Floor tab's bottom bar (floor-bottom-bar.tsx), built by floor-page and
   * placed HERE, in the bills column (2026-09-22). It used to be mounted in
   * floor-page, one level above this grid, so its `inset-x-0` spanned the rail
   * too. Null when nothing is ticked.
   */
  bottomBar?: ReactNode;
}) {
  // ── TWO VIEW STATES, ONE PER LIST (2026-09-19) ───────────────────────────
  //
  // 🔴 THE POOL OPENS ON BY ROUTE (owner). The Tinting tab keeps its own switch,
  // on Flat as before, and today's route rows — it used to share this one
  // state, so making By route the pool's default would have flipped the
  // Tinting tab into cards too.
  //
  // ⚠ A SEARCH SHOWS THE POOL FLAT, WITHOUT TOUCHING `poolPivot`. The search
  // auto-ticks the bills it finds (floor-page.tsx), and a tick inside a card
  // nobody has opened is a bill ticked out of sight — the "van leaves short"
  // case floor-page's auto-tick comment warns about. Flat lists every tick.
  // Clearing the search puts back whatever the planner had, because the saved
  // choice was never overwritten.
  //
  // ── EACH TAB REMEMBERS ITS OWN POOL VIEW (Load plan, 2026-09-19, owner) ──
  // By route is the default on every tab — Upcountry included since
  // 2026-09-22 (it opened on Load plan before). A choice made on one tab never
  // carries to another — `poolViews` holds one entry per tab the planner has
  // actually switched, and the default fills the rest.
  const [poolViews, setPoolViews] = useState<Partial<Record<FloorScope, PoolView>>>({});
  const poolPivot: PoolView = poolViews[scope] ?? defaultPoolView(scope);
  const setPoolPivot = (v: PoolView) => setPoolViews((cur) => ({ ...cur, [scope]: v }));
  const [tintPivot, setTintPivot] = useState<"flat" | "route">("flat");
  const effectivePoolPivot: PoolView = searchActive ? "flat" : poolPivot;

  // ── Scrolling in and out of a targeted add (owner, 2026-09-18) ────────────
  //
  // 🔴 "+ Add bills" TAKES THE PLANNER TO THE POOL. The press is a request to go
  // and choose bills; on a trip longer than the screen the band opens below the
  // last stop, off screen, and a button that appears to do nothing is the worst
  // outcome there is. So the column scrolls until the band sits just under its
  // top edge (BAND_TOP_GAP), with pool rows readable beneath it. Smooth, unless
  // the viewer asked for reduced motion. On a short trip where nothing can
  // scroll, the browser clamps and nothing moves — the band is already in view.
  //
  // 🔴 DONE PUTS THE TRIP BACK WHERE IT WAS. The position is saved as the add
  // opens — before the scroll above, so it is the trip's own — and restored
  // when the add ends. Without this the browser can only clamp to what is left
  // when the pool half closes, landing somewhere arbitrary in the trip.
  //
  // ⚠ A LAYOUT EFFECT, SO THE RESTORE LANDS BEFORE PAINT. With a plain effect
  // the pool-less trip painted once at the clamped position and then jumped.
  // Safe here: TripDesk renders only once the board's data has loaded in the
  // browser (floor-page shows the skeleton until then), never on the server —
  // the same footing components/tint/manager/board-bits.tsx uses it on.
  //
  // ⚠ ONLY WHEN THE SAME TRIP IS STILL OPEN. A rail click ends the add AND opens
  // a different trip (floor-page `selectRail`); restoring the old trip's offset
  // onto another trip would be a jump for no reason, so it is dropped instead.
  const scrollRef = useRef<HTMLDivElement>(null);
  const poolHalfRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef<{ tripId: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (addingToTripId !== null) {
      if (savedScroll.current !== null || !el) return;
      savedScroll.current = { tripId: addingToTripId, top: el.scrollTop };
      const band = poolHalfRef.current;
      if (!band) return;
      const top = el.scrollTop + band.getBoundingClientRect().top - el.getBoundingClientRect().top - BAND_TOP_GAP;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
      return;
    }
    const saved = savedScroll.current;
    savedScroll.current = null;
    if (saved && el && railSelection.kind === "trip" && railSelection.tripId === saved.tripId) {
      el.scrollTop = saved.top;
    }
  }, [addingToTripId, railSelection]);
  const [openRoute, setOpenRoute] = useState<string | null>(null);
  // Cards per row for the route cards, by screen width (route-cards.tsx).
  const cardColumns = useCardColumns();

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
  // `isPoolRow` restates the tint exclusion `floorTabRows` already applied —
  // harmless here, and it is the one test the search auto-tick shares.
  const poolRows = dueRows.filter(isPoolRow);
  const poolUpcoming = upcomingAll.filter(isPoolRow);

  // ── THE ROUTE CARDS (2026-09-19) ─────────────────────────────────────────
  //
  // Built here, once, only on a tab that has clubs (Local today); every other
  // tab keeps the route rows. The reach rows are the same pool test as
  // `poolRows`, just not scoped — RouteCards reads them for Kamrej alone.
  //
  // ⚠ BOTH HALVES GO IN (2026-09-19): upcoming bills sit inside their own
  // route now, not in a block below. The cards split them off by `zone` and
  // count the due half only — see RouteLine.upcoming.
  const cardModel =
    scope !== "All" && tabHasClubs(routeClubs, scope)
      ? buildRouteCards(scope, routeClubs, [...poolRows, ...poolUpcoming], clubReachRows.filter(isPoolRow))
      : null;
  // 🔴 ONE CARD OPEN AT A TIME (owner, 2026-09-24). Which one is floor-page's
  // state (`openRouteCard`), because floor-page owns the floor's one Esc
  // listener and Esc goes back to the cards. Was: every card holding a tick
  // stayed open beside the one last clicked (commit 4b, 2026-09-19) — the chip
  // row replaced that; ticks now simply survive a switch between chips.
  //
  // ⚠ CLEARED WHENEVER THAT CARD IS NOT ON SCREEN — another tab or view, a
  // trip on the rail, a search, or its last due bill gone onto a trip. So Esc
  // never spends a press closing a card nobody can see, and coming back to By
  // route always shows the grid first.
  const cardsOnScreen =
    activeTab === "floor" &&
    (railSelection.kind === "pool" || addingToTripId !== null) &&
    effectivePoolPivot === "route" &&
    cardModel !== null;
  const openCardShown =
    cardsOnScreen &&
    openRouteCard !== null &&
    cardModel !== null &&
    shownCards(cardModel).some((c) => c.key === openRouteCard);
  useEffect(() => {
    if (openRouteCard !== null && !openCardShown) onOpenRouteCard(null);
  }, [openRouteCard, openCardShown, onOpenRouteCard]);

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
    (activeTab === "floor" && (railSelection.kind === "pool" || addingToTripId !== null)) ||
    activeTab === "tinting";
  // Which of the two states this toggle drives — the open tab's own.
  const onTinting = activeTab === "tinting";
  const shownPivot: PoolView = onTinting ? tintPivot : effectivePoolPivot;
  const setShownPivot = (v: PoolView) => (onTinting ? setTintPivot(v === "flat" ? "flat" : "route") : setPoolPivot(v));
  // While a search is up the pool is Flat and neither By route nor Load plan
  // can be chosen; the button says why rather than doing nothing when pressed.
  const routeLocked = !onTinting && searchActive;
  // Load plan is offered on the POOL of a tab that plans loads — never on
  // the Tinting tab, whose bills are not in the pool.
  const pivotOptions: PoolView[] =
    !onTinting && LOAD_PLAN_SCOPES.includes(scope) ? ["flat", "route", "plan"] : ["flat", "route"];
  const pivotToggle = showPivot ? (
    <span className="inline-flex gap-[2px] rounded-[7px] bg-gray-100 p-[2px]">
      {pivotOptions.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => setShownPivot(p)}
          disabled={p !== "flat" && routeLocked}
          title={p !== "flat" && routeLocked ? `Clear the search to ${p === "plan" ? "see the load plan" : "group by route"}` : undefined}
          className={`rounded-[5px] px-3 py-[3px] text-[11px] disabled:cursor-not-allowed disabled:opacity-50 ${
            shownPivot === p ? "bg-white font-semibold text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {p === "flat" ? "Flat" : p === "route" ? "By route" : "Load plan"}
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
  //
  // 🔴 THE LIVE ROW IS GONE (2026-09-22). What it carried moved UP into the tab
  // row's right-hand group, in this order:
  //   live    [Offline chip, only when disconnected] · [Flat | By route] · History ›
  //   history ‹ date › · [Flat | By route] · ‹ Back to Live
  // 🔴 NOTHING WHILE CONNECTED (owner, 2026-09-22 — the live dot was removed).
  // Only when the marker probe stops answering does a grey "Offline · last
  // update HH:MM" chip appear. Same state, same probe (floor-page `connected` /
  // `lastSyncedAt`), no new poll. Never in History — the strip never showed
  // there either. The Live counts the row used to print are not shown now.
  const rightGroup = (
    <span className="ml-auto flex items-center gap-3 text-[11.5px]">
      {isHistory ? (
        <span className="flex items-center gap-2">
          <button type="button" className={navCls} onClick={() => onStepHistory(-1)} aria-label="Previous day">‹</button>
          <span className="font-semibold text-gray-900">{histDate ? fmtHistLabel(histDate) : ""}</span>
          <button
            type="button"
            className={navCls}
            disabled={forwardDisabled}
            onClick={() => !forwardDisabled && onStepHistory(1)}
            aria-label="Next day"
          >
            ›
          </button>
        </span>
      ) : connected ? null : (
        <span role="status" className="whitespace-nowrap rounded-full bg-ink-100 px-2 py-[2px] text-[12px] text-ink-600">
          Offline · last update {lastUpdateTime(lastSyncedAt)}
        </span>
      )}
      {pivotToggle}
      {isHistory ? (
        <button type="button" className="text-[11px] font-semibold text-brand-600" onClick={onExitHistory}>
          &lsaquo; Back to Live
        </button>
      ) : (
        <button type="button" className="text-[11px] font-semibold text-brand-600" onClick={onEnterHistory}>
          History &rsaquo;
        </button>
      )}
    </span>
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
      ) : tintPivot === "route" ? (
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

  // 🔴 TARGETED ADD STACKS, IT DOES NOT SWAP (owner, 2026-09-18). It used to
  // replace the trip with the pool, so the load being filled vanished and only
  // the band's text was left of it. Now the trip panel renders exactly as it
  // does on its own, the band sits under it as the divider, and the pool opens
  // below. The trip panel is built ONCE (`renderTripPanel`) and placed first in
  // both layouts, so React keeps the same nodes when the pool half opens and
  // closes — Done takes the pool away and leaves the trip where it was.
  const targetTrip = addingToTripId !== null ? (trips ?? []).find((t) => t.id === addingToTripId) ?? null : null;

  // ── The POOL half — the "To plan" list, with its empty state ─────────────
  // Built unconditionally (cheap: already-derived rows) and placed by the
  // branches below.
  let poolContent: ReactNode;
  {
    // The header describes the WHOLE pool, both halves, because that is what
    // the table below lists — a header that counted only the due half would not
    // add up to the rows on screen. The divider gives the upcoming subtotal.
    const allPool = [...poolRows, ...poolUpcoming];
    const litres = sumLitres(allPool);
    const weight = sumWeightKg(allPool);
    const weightStr = formatWeightKg(weight.kg);
    // Also what the route cards show when no card has a bill due (2026-09-24).
    const poolEmpty = (
      <div className="px-5 py-14 text-center">
        <div className="text-[28px] leading-none text-gray-300">○</div>
        <h4 className="mt-2 text-[13px] font-semibold text-gray-900">Every bill is on a trip</h4>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
          Nothing is waiting to be planned. New bills land here as they arrive.
        </p>
      </div>
    );
    poolContent = (
      <>
        {allPool.length === 0 ? (
          poolEmpty
        ) : effectivePoolPivot === "flat" ? (
          <FloorTable
            rows={sort(poolRows)}
            upcomingRows={sort(poolUpcoming)}
            anchorIso={floor.date}
            nowMs={nowMs}
            variant={variant}
            {...selProps}
          />
        ) : effectivePoolPivot === "plan" && scope === "Upcountry" && !isHistory ? (
          // THE UPCOUNTRY LOAD PLAN v2 (2026-09-21) — planned server-side from
          // these due bills (POST /api/floor/load-plan); Replan, pins, moves,
          // Make trip. History keeps the v1 view below: a past day is a record.
          <LoadPlanV2View
            rows={poolRows}
            upcomingCount={poolUpcoming.length}
            routeNames={routeNames}
            columns={cardColumns}
            nowMs={nowMs}
            anchorIso={floor.date}
            variant={variant}
            onMarkUrgent={onMarkUrgent}
            onOpenDetail={onOpenDetail}
            gateOn={gateOn}
            onMakeTrip={onMakeTrip}
            makeTripBusy={makeTripBusy}
          />
        ) : effectivePoolPivot === "plan" ? (
          // THE LOAD PLAN (2026-09-19) — the due pool as suggested trucks.
          // Upcoming bills are not planned, only counted. No Make trip in
          // History: a past day is a record.
          <LoadPlanView
            rows={poolRows}
            upcomingCount={poolUpcoming.length}
            config={loadPlanConfigs[scope] ?? null}
            routeNames={routeNames}
            columns={cardColumns}
            nowMs={nowMs}
            anchorIso={floor.date}
            variant={variant}
            onMarkUrgent={onMarkUrgent}
            onOpenDetail={onOpenDetail}
            gateOn={gateOn}
            onMakeTrip={isHistory ? undefined : onMakeTrip}
            makeTripBusy={makeTripBusy}
          />
        ) : (
          <>
            {/* By route groups the DUE half only, exactly as it did. Routes are
                a way of reading today's work, and folding Saturday's bills into
                "Adajan is 2 of 9" would change a number the operator already
                reads. The upcoming half follows the route rows as one block,
                with the same divider the flat view uses. */}
            {/* CARDS ON A TAB WITH CLUBS (Local and Upcountry); every other
                tab keeps the route rows exactly as they were. */}
            {cardModel !== null ? (
              <RouteCards
                model={cardModel}
                columns={cardColumns}
                openKey={openCardShown ? openRouteCard : null}
                onOpenCard={onOpenRouteCard}
                empty={poolEmpty}
                nowMs={nowMs}
                anchorIso={floor.date}
                variant={variant}
                leaf={selProps}
              />
            ) : (
              <ByRoute rows={poolRows} nowMs={nowMs} anchorIso={floor.date} variant={variant} openRoute={openRoute} onToggleRoute={setOpenRoute} selProps={selProps} />
            )}
            {/* The Upcoming block stays for the ROUTE ROWS only. On the cards
                every upcoming bill is inside its own route's panel instead
                (owner, 2026-09-19) — rendering it here too would list those
                bills twice. Flat keeps its block untouched. */}
            {cardModel === null && poolUpcoming.length > 0 && (
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
  }

  // ── The TRIP panel — header, bar, legend, stops ───────────────────────────
  // `adding` is true only while THIS trip is being filled with the pool open
  // below it. It changes exactly two things, both so the panel stays put and
  // cannot be acted on by accident:
  //   - the header hides its "+ Add bills" (already open) and keeps the row's
  //     height, so the stops do not jump;
  //   - the stop tables keep their tick column but render NO boxes
  //     (`selectionLocked`). There is ONE selection for the whole screen, and a
  //     trip row ticked in the middle of an add would mix "take this off" into
  //     the add. Dropping the column instead would slide every column sideways.
  //     ⚡ and ⋯ still work.
  const renderTripPanel = (trip: TripSummary, adding: boolean): ReactNode => {
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
    const drops = tripDetail?.id === trip.id ? tripDetail.drops : [];
    // ⚠ THE SAME FRESHNESS TEST AS `drops`. tripDetail lags the rail by one
    // fetch when the planner clicks between trips, and showing the PREVIOUS
    // trip's history under this trip's buttons would be worse than showing none
    // — a confident line about the wrong load.
    // NULL, not [], while the detail is still for another trip: the header's
    // clock then shows no count rather than the previous trip's.
    const activity = tripDetail?.id === trip.id ? tripDetail.activity : null;

    return (
      <>
        <TripDetailHeader
          // Keyed by trip, so the ··· menu and the history toggle close when the
          // planner picks another trip.
          key={trip.id}
          trip={trip}
          activity={activity}
          busy={tripBusyId === trip.id}
          readOnly={isHistory}
          adding={adding}
          onAddBills={() => onStartAddingTo(trip.id)}
          onChangeVehicle={() => onChangeVehicle(trip.id)}
          onCancelTrip={() => onCancelTrip(trip.id)}
          gateOn={gateOn}
          onShowToFloor={() => onSetTripShown(trip.id, true)}
          onTakeBackFromFloor={() => onSetTripShown(trip.id, false)}
          onSendToBilling={() => onSetTripSentToBilling(trip.id, true)}
          onTakeBackFromBilling={() => onSetTripSentToBilling(trip.id, false)}
        />

        {tripDetail === null || tripDetail.id !== trip.id ? (
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
                    selectionLocked={adding}
                    {...selProps}
                  />
                ) : (
                  <div className="px-3.5 py-2.5 pl-[34px] text-[11px] text-gray-400">
                    {/* Slice 10 (2026-09-15): History now pulls a trip's bills BY
                        TRIP (floorHistoryTripBillsWhere), so on either desk this
                        line is reached only by a bill the view itself leaves out
                        — the admin Hide filter, or the day the board is anchored
                        on. NEVER the delivery-type tab (owner, 2026-09-18): the
                        stop lookup reads unscoped rows, so an opened trip shows
                        every bill whatever tab is selected. It says only that,
                        and never names a day. */}
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
  };

  // ── Placing the pieces ────────────────────────────────────────────────────
  //
  // ⚠ THE TRIP PANEL IS ALWAYS THE FIRST CHILD, in a slot keyed "trip", so that
  // opening and closing the pool half below it never remounts it: the header's
  // history toggle stays as it was. The scroll position is handled separately
  // (`scrollRef` below) — it is saved when the add opens and put back on Done.
  //
  // If the target trip is not in the loaded list, floor-page ends the add
  // (1bfa0db9) — the pool renders alone for that one frame.
  let middle: ReactNode;
  if (targetTrip) {
    middle = (
      <>
        <div key="trip">{renderTripPanel(targetTrip, true)}</div>
        <div key="pool" ref={poolHalfRef}>
          {/* THE DIVIDER. The band that used to head the pool now separates the
              truck from what can go on it. */}
          <TripAddBand
            tripNumber={targetTrip.tripNumber}
            routeName={targetTrip.routeName}
            routeExtraCount={targetTrip.routeExtraCount}
            bills={targetTrip.counts.total}
            litres={formatLitres(targetTrip.totalLitres)}
            lastAddCount={lastAddCount}
            busy={tripBusyId === targetTrip.id}
            onUndo={onUndoLastAdd}
            onDone={onDoneAdding}
          />
          {poolContent}
        </div>
      </>
    );
  } else if (railSelection.kind === "pool" || addingToTripId !== null) {
    middle = poolContent;
  } else if (!selectedTrip) {
    middle = (
      <div className="px-5 py-14 text-center text-[11.5px] text-gray-400">
        That trip is no longer on this day&rsquo;s board.
      </div>
    );
  } else {
    middle = (
      <>
        <div key="trip">{renderTripPanel(selectedTrip, false)}</div>
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
        // ⚠ NOT A PICKER WHILE A NAMED TRIP IS BEING FILLED (owner): the trip is
        // already decided, so a card click opens it rather than adding to it.
        addMode={addMode && addingToTripId === null}
        addCount={addCount}
        sameRouteLabel={sameRouteLabel}
        onAddToTrip={onAddToTrip}
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
      {/* `relative` — the Floor bar and the Hold / Cancelled bars are
          positioned against THIS column, so none of them runs under the rail. */}
      <div className="relative flex min-h-0 flex-col overflow-hidden">
        {/* THE TAB ROW (2026-09-22): tabs on the left; on the right the live
            dot (or the history stepper), Flat | By route where it applies, and
            History / Back to Live. The Live row that sat under it is gone, and
            so is the "+ New trip" that sat here. */}
        <div className="flex items-center gap-[18px] border-b border-gray-200 bg-white px-3.5">
          {tabs}
          {rightGroup}
        </div>
        {/* ⚠ ONE ELEMENT, TWO SHAPES (2026-09-22). Floor and Tinting scroll
            here. Hold and Cancelled bring their own scrolling body and an
            absolute bar, so for them this is a bounded flex column instead: as a
            plain scroll box it let their `flex-1` grow to the content, and the
            bar sat after the last row rather than on the bottom edge. Same
            element either way, so a tab change never remounts it. The bottom
            padding keeps the last rows clear of the Floor bar. */}
        <div
          ref={scrollRef}
          className={
            activeTab === "hold" || activeTab === "cancelled"
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : `min-h-0 flex-1 overflow-y-auto ${bottomBar ? "pb-[84px]" : ""}`
          }
        >
          {body}
        </div>
        {bottomBar}
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
