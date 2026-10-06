"use client";

// Floor Control composition root. It owns the selection Set, every write
// handler, the four feeds and the SINGLE window-level Esc listener.
//
// 🔴 THE FLOOR TAB IS NOW THE TRIP DESK (2026-09-10, v3 layout). What it renders
// is <TripDesk>: trips on the left, the selected trip's bills or the not-on-a-
// trip pool in the middle. What it STOPPED rendering, and why:
//
//   floor-rail.tsx        the decision rail. Its bills — released stages, no
//                         dispatchStatus — are ROWS on the board now, because
//                         floorBoardWhere() unions them in (lib/floor/queries).
//                         Putting a bill on a trip is what gives it a slot, so
//                         the rail's per-card slot picker had nothing left to do.
//   floor-board.tsx       the slot tabs, By picker, By group, the At-desk pool
//                         and the whole pivot. TripDesk owns Flat / By route.
//   assign-bar.tsx        replaced by floor-bottom-bar.tsx — Add to trip /
//                         Remove from trip. Assigning a picker is /picking's job.
//   trip-selection-bar.tsx folded into that same one bar.
//   build-trip-drawer.tsx replaced by trip-form.tsx, which creates a trip and
//                         attaches the selection only when asked to.
//   assign-context-banner.tsx  unreachable once By picker went — it was the only
//                         way into an assign context.
//
// ⚠ FOUR OF THOSE WERE DELETED IN SLICE 6 (2026-09-15), on the owner's
// instruction: floor-board.tsx, trip-band.tsx, build-trip-drawer.tsx and
// desk-pool.tsx. They are in git history. The rest are still on disk, simply
// not rendered; archiving them is its own step (archive/RETIREMENT-PLAYBOOK.md).
//
// The five state actions (mark-urgent · change-slot · hold · cancel · restore)
// still go through /api/floor/actions, and the row ⚡ is still wired here.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { TripDesk, isPoolRow } from "./trip-desk";
import { TripRedeliveryDialog } from "./trip-redelivery-dialog";
import { TripRedeliveryInfo } from "./trip-redelivery-info";
import { TripForm } from "./trip-form";
import type { VehicleSize } from "@/lib/trips/vehicle-size";
import { rankRouteName } from "@/lib/trips/route-label";
import { FloorBottomBar } from "./floor-bottom-bar";
import { TripVehicleEditor } from "./trip-vehicle-editor";
import {
  rowStatus,
  isTintRoomRow,
  countByStatus,
  waitingForPickerCount,

  isHeldBack,
  formatLitres,
  sumLitres,
  formatWeightKg,
  sumWeightKg,
} from "./status-pill";
import { countArticles } from "@/lib/floor/format";
import { PickGateToggle } from "./pick-gate-toggle";
import { FloorSkeleton } from "./floor-skeleton";
import { HoldTab } from "./hold-tab";
import { CancelledTab } from "./cancelled-tab";
import { DetailPanel, type DetailActions } from "./detail-panel";
import { OffFloorDialog, type OffFloorFormBill, type CiReasonOption } from "./off-floor-dialog";
import { offFloorRefusal } from "@/lib/floor/off-floor";
import { SearchBox, SearchHits } from "./search-box";
import { FilterSheet } from "./filter-sheet";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";
import { useFloorRailPoll } from "@/lib/floor/use-floor-rail-poll";
// Live change feed (7b) — behind app_settings 'live.feed'. OFF → the two hooks
// above run exactly as before, inside <LegacyFloorSync> (bottom of this file).
import { useLiveFeed, readLiveHint, liveLog } from "@/lib/live/use-live-feed";
import { chunk, MAX_PATCH_IDS, type FeedMode, type Work } from "@/lib/live/feed-core";
import {
  boardIdsOnTrips,
  isDateMismatch,
  mergeFloorRows,
  mergeTrips,
  tripIdsToRefresh,
  withBoardRows,
  type FloorRowPatchIn,
} from "@/lib/floor/live-merge";
// 🔴 toggleAllIds / (no isSelectable), NOT the stage-gated pair (2026-09-10 d).
// Selecting a bill on this screen means putting it on a TRIP, and trip
// membership is not stage-gated — see the two families in lib/floor/selection.ts.
import { toggleDeskKey, toggleAllDesk, rdKey, isRdKey, rdIdOf, type FloorDeskSelection } from "@/lib/floor/selection";
import { rowsInScope, scopeBoard } from "@/lib/floor/scope";
import { parseSearch, applySearch, searchReport, lookupTermOf, type Searchable, type ParsedSearch } from "@/lib/floor/search";
import { applyFloorFilters, applyFlagFilters, EMPTY_FILTERS, type FloorFilters } from "@/lib/floor/filter";
import type { DispatchWindow } from "@/components/floor/dispatch-slot-picker";
import type { FloorScope, FloorBoardResult, FloorBoardRow, FloorPicker, FloorHoldRow, FloorCancelledRow, FloorDetailSource, FloorRouteClub, FloorSearchHit } from "@/lib/floor/types";
import type { FloorLoadPlanPayload } from "@/lib/floor/load-plan-config";
import type { RailSelection } from "./trip-rail";
import type { TripSummary, TripDetail, TripRedeliveryRow } from "@/lib/trips/queries";
import { chooseTripTypeName } from "@/lib/trips/type-choice";
import type {
  DeliveryTypeOption,
  VehicleOption,
  TransporterOption,
  DispatchWindowOption,
} from "./trip-options";

/** The four dropdown lists the Build trip drawer needs, from /api/floor/trips/options. */
interface TripOptions {
  deliveryTypes: DeliveryTypeOption[];
  windows: DispatchWindowOption[];
  vehicles: VehicleOption[];
  transporters: TransporterOption[];
}

const SCOPES: FloorScope[] = ["All", "Local", "Upcountry", "IGT / Cross"];

// Every board/hold/cancelled fetch asks for the UNSCOPED set and the chips
// narrow it client-side (lib/floor/scope.ts).
//
// This is not an optimisation guess — Floor's scope was NEVER a database
// filter. lib/floor/queries.ts applied it as a post-fetch `continue` in JS and
// no `findMany` ever referenced it, so `scope=All` and `scope=Local` cost the
// server the identical query; only the serialised payload differed. Asking for
// `All` once and filtering here runs the SAME predicate on the SAME rows, and
// turns a chip click from 3 HTTP round trips into a `useMemo`.
//
// Sent explicitly rather than omitted: the routes default to "All" when the
// param is absent (parseScope), so this is belt-and-braces, and it keeps the
// request legible in the network tab and the server logs.
const UNSCOPED_QS = "scope=All";


// The FOUR top tabs (design §3, plus Tinting on 2026-09-14).
//
// ⚠ "tinting" IS A VIEW, NOT A FEED. It has no route, no predicate and no arm of
// its own — it is a client-side filter of board rows the payload already holds
// (see TripDesk). The other three each have a feed behind them; this one does
// not, and giving it one would be the mistake.
type TopTab = "floor" | "tinting" | "hold" | "cancelled";

interface BoardData {
  // ⚠ NO `rail` SINCE 2026-09-13 — see app/api/floor/board/route.ts. The feed is
  // gone; arm 2 of floorBoardWhere is not, so those bills are still here as rows.
  floor: FloorBoardResult;
  pickers: FloorPicker[];
}

/** "The feed was on for Floor last time" (localStorage) — lets the mount load wait for the head cursor. */
const FLOOR_LIVE_HINT_KEY = "orbit.live.floor";

/** GET /api/floor/counts — the lazy tabs' labels while their rows are not loaded (live feed only). */
interface TabCounts {
  hold: Record<FloorScope, number>;
  cancelled: Record<FloorScope, number>;
}

function istTodayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function addDaysIso(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/**
 * A board row's trip NUMBER → the trip on the loaded rail feed. THE page's one
 * tripNumber → trip mapping: `removeSelectionFromTrips` and the search's trip
 * narrowing (2026-09-29) both call this, so the two can never resolve a number
 * differently. The feed is newest-created first, so a number a cancelled trip
 * gave back resolves to the newer trip holding it now.
 */
function findTripByNumber(trips: TripSummary[], tripNumber: string): TripSummary | undefined {
  return trips.find((x) => x.tripNumber === tripNumber);
}

/** A trip the search reached through bills on the loaded desk, with how many. */
export interface TripSearchHit {
  tripId: number;
  tripNumber: string;
  count: number;
}

/**
 * The trips holding bills that `parsed` matches (2026-09-29, owner). Read over
 * the UNSCOPED board rows — a trip is opened unscoped (floor-page's
 * `unfilteredRows`), so a Local trip carrying the searched Upcountry bill is
 * still that bill's trip. Cancelled trips are skipped (they hold no bills).
 */
function tripHitsFor(rows: FloorBoardRow[], trips: TripSummary[], parsed: ParsedSearch): TripSearchHit[] {
  if (parsed.mode === "none") return [];
  const byId = new Map<number, TripSearchHit>();
  for (const r of applySearch(rows, parsed)) {
    if (r.tripDropId === null || !r.tripNumber) continue;
    const t = findTripByNumber(trips, r.tripNumber);
    if (!t || t.status === "cancelled") continue;
    const hit = byId.get(t.id) ?? { tripId: t.id, tripNumber: t.tripNumber, count: 0 };
    hit.count++;
    byId.set(t.id, hit);
  }
  return Array.from(byId.values());
}

/** One trip GET /api/floor/trips/lookup returned. */
export interface LookupTrip {
  tripId: number;
  tripNumber: string;
  tripDate: string; // YYYY-MM-DD
  status: string;
  obdNumber: string;
  obdNumbers: string[];
  onLiveDesk: boolean;
}

/** The other-days lookup's state, for the hits strip. Null = no lookup.
 *  "opening" / "open-failed" (2026-09-29): the lookup found a trip on an older
 *  day and the page is switching to History for it — see `openLookupTrip`. */
export type LookupState =
  | { term: string; status: "loading" | "none" | "error" }
  // GET /api/floor/search (2026-10-06): several bills (a shared invoice), or one
  // during a targeted add (the page does not jump then) — each one a button.
  | { term: string; status: "many"; hits: FloorSearchHit[] }
  | { status: "opening" | "open-failed"; trip: LookupTrip; reason?: string }
  // The server named a live tab, but the loaded list no longer holds the bill.
  | { status: "moved"; message: string };

/** A search hit's trip, in the shape `openLookupTrip` takes (the trip jump is
 *  the 2026-09-29 lookup's, unchanged). */
function lookupTripOf(h: FloorSearchHit): LookupTrip | null {
  if (!h.trip) return null;
  return {
    tripId: h.trip.id,
    tripNumber: h.trip.number,
    tripDate: h.trip.date,
    status: h.trip.status,
    obdNumber: h.obdNumber,
    obdNumbers: [h.obdNumber],
    onLiveDesk: h.trip.onLiveDesk,
  };
}

/** "pick_assigned" → "pick assigned"; a held bill reads "on hold". For the
 *  "No longer on hold — now: …" line. */
function stageWords(h: FloorSearchHit): string {
  if (h.dispatchStatus === "hold") return "on hold";
  return h.workflowStage.replace(/_/g, " ");
}

/**
 * A search jump in flight (2026-10-06). `resolve` — waiting for the target
 * tab's rows to be loaded so the bill can be checked against them; `highlight`
 * — the row is (or will be) on screen: scroll to it and light it.
 * `staleData` — the board that was on screen when the jump had to leave
 * History; the live check waits until a newer board has replaced it.
 */
interface SearchFocus {
  hit: FloorSearchHit;
  phase: "resolve" | "highlight";
  staleData?: BoardData | null;
}

/** Which board a load() is for — live, or History on one day. Two loads with
 *  different keys answer different questions (the stale-answer guard). */
function viewKeyOf(viewMode: "live" | "history", histDate: string | null): string {
  return viewMode === "history" && histDate ? `history:${histDate}` : "live";
}

// Every write route returns one of these shapes: { failed:[…] } for the batch
// routes (release/actions/picking-assign) or { error } for a hard reject. We read
// BOTH — a write that skipped silently must never look like success (the bug that
// hid the Hold-tab release no-op).
interface WriteBody {
  error?: string;
  /** The batch routes' applied ids (POST /api/floor/actions returns them). */
  done?: number[];
  failed?: Array<{ orderId?: number; error?: string }>;
  /** POST /api/floor/actions hand | unhand — repeat presses, nothing written. */
  skipped?: number[];
  /** POST /api/floor/release — what Release did to each WRITTEN bill (2026-10-01). */
  outcomes?: Array<{ orderId: number; outcome: "released" | "picker_removed" | "hold_cleared" }>;
}

async function postJson(url: string, payload: unknown, method: "POST" | "PATCH" = "POST"): Promise<{ ok: boolean; body: WriteBody }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as WriteBody;
    return { ok: res.ok, body };
  } catch {
    return { ok: false, body: { error: "Network error — check your connection." } };
  }
}

// Surface a write result to the operator. Returns true ONLY on a clean,
// fully-applied write. A non-2xx response, a hard `error`, OR a non-empty
// `failed[]` (partial or total failure) raises a toast and returns false — the
// response is never discarded. Success is intentionally silent (the board reload
// is the confirmation).
function reportWrite(label: string, r: { ok: boolean; body: WriteBody }): boolean {
  const failed = Array.isArray(r.body.failed) ? r.body.failed : [];
  if (!r.ok) {
    toast.error(r.body.error ? `${label} failed — ${r.body.error}` : `${label} failed.`);
    return false;
  }
  if (failed.length > 0) {
    const reason = failed[0]?.error ?? "not valid at its current state";
    toast.error(`${label}: ${failed.length} bill${failed.length === 1 ? "" : "s"} not updated — ${reason}`);
    return false;
  }
  return true;
}

// Release (Hold tab bulk + the panel's Release) — the failures through
// reportWrite as before, PLUS one success line built from the per-bill outcomes
// (2026-10-01), because a release now does three different things: "3 released
// · 1 hold cleared · 1 picker removed". Silent when nothing was written.
function reportRelease(r: { ok: boolean; body: WriteBody }): void {
  reportWrite("Release", r);
  const outcomes = Array.isArray(r.body.outcomes) ? r.body.outcomes : [];
  if (outcomes.length === 0) return;
  const count = (k: "released" | "hold_cleared" | "picker_removed") => outcomes.filter((o) => o.outcome === k).length;
  const parts = [
    [count("released"), "released"],
    [count("hold_cleared"), "hold cleared"],
    [count("picker_removed"), "picker removed"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, label]) => `${n} ${label}`);
  toast.success(parts.join(" · "));
}

// ── The Cancel / Raise CI form's bills (2026-09-22) ─────────────────────────
//
// 🔴 THE PRE-CHECK ASKS offFloorRefusal() — the function both write routes call
// (lib/floor/off-floor.ts) — so a greyed bill in the form is one the server
// would refuse. A board row carries no `workflowStage`, so the three stages the
// rule names are read off the row's own derived facts:
//   isDispatched      → dispatched
//   tintPhase assigned → tint_assigned        (tintPhaseOf, lib/floor/queries.ts)
//   tintPhase tinting  → tinting_in_progress
// Anything else is a stage the rule allows, and a live board row is never
// cancelled. The server re-checks every bill regardless.
function boardRowToOffFloorBill(r: FloorBoardRow): OffFloorFormBill {
  const stage = r.isDispatched
    ? "dispatched"
    : r.tintPhase === "assigned"
      ? "tint_assigned"
      : r.tintPhase === "tinting"
        ? "tinting_in_progress"
        : "";
  return {
    orderId: r.orderId,
    obdNumber: r.obdNumber,
    dealerName: r.dealerName,
    litres: r.volumeLitres,
    invoiceNo: r.invoiceNo,
    refusal: offFloorRefusal({ workflowStage: stage, tripDropId: r.tripDropId, tripNumber: r.tripNumber }),
  };
}

// ⚠ A HELD ROW CANNOT BE PRE-CHECKED: the Hold feed carries no stage, trip or
// invoice number. It goes in un-greyed and with no invoice tag; the server's
// refusals come back in the form's result view.
function holdRowToOffFloorBill(r: FloorHoldRow): OffFloorFormBill {
  return {
    orderId: r.orderId,
    obdNumber: r.obdNumber,
    dealerName: r.dealerName,
    litres: r.volumeLitres,
    refusal: null,
  };
}

export function FloorPage({ canEdit = false }: { canEdit?: boolean } = {}) {
  // 🔴 THE TEMPORARY ADMIN-ONLY GATE IS GONE (2026-09-10). It existed for one
  // day, to keep the By trip pivot option off everyone else's screen while it
  // was tested on live data, and it read the session purely to decide whether to
  // render one button. The trip desk IS the Floor tab now — there is no pivot
  // option to hide and nothing to gate — so `useSession`, `isAdmin` and the
  // `isAdmin` dependency on load() all went with it. Everyone holding `floor`
  // canView sees this screen; the routes behind it still gate canEdit
  // server-side, exactly as they did.

  const [scope, setScope] = useState<FloorScope>("All");
  const [data, setData] = useState<BoardData | null>(null);
  // The route clubs for the By route cards (2026-09-19). Rides the board
  // response as `routeClubs`; kept beside `data` rather than in it, because
  // BoardData is what the scope/search memos rebuild and clubs are neither.
  const [routeClubs, setRouteClubs] = useState<FloorRouteClub[]>([]);
  // The Load plan rules + route names (2026-09-19), beside `routeClubs` for the
  // same reason. Empty until the board answers; a tab with no rules reads
  // "Load plan not set up".
  const [loadPlan, setLoadPlan] = useState<FloorLoadPlanPayload>({ configs: {}, routeNames: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Hold + Cancelled feeds. Fetched alongside the board so the tab counts are
  // always live regardless of which tab is open (design §5.4 / §3).
  const [holdRows, setHoldRows] = useState<FloorHoldRow[] | null>(null);
  const [cancelledRows, setCancelledRows] = useState<FloorCancelledRow[] | null>(null);
  const [sideError, setSideError] = useState<string | null>(null);
  // Time of the last successful board load — shown by the connection strip as
  // "last update HH:MM" when the server becomes unreachable (design §13).
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  // Server reachability, driven off the SAME /api/floor/marker probe the board's
  // live-sync runs (use-picking-marker onProbe) — one poll, no second fetch.
  const [connected, setConnected] = useState(true);
  // The picking visibility gate (2026-09-09). Owned HERE, not by the switch,
  // because the same fact drives the switch, the held-back pills on every row
  // and the trip header's Show to floor — three readings that must never disagree.
  //
  // null = not known yet (the read has not landed, or it failed). Everything
  // downstream treats null as OFF for RENDERING (`gateOn === true` below), so an
  // unread state shows the board exactly as it is today; the switch itself
  // renders nothing at all rather than claiming a position it does not know.
  const [gateEnabled, setGateEnabled] = useState<boolean | null>(null);
  const gateOn = gateEnabled === true;

  // Search (committed on Enter) + filters. Both are client-side over already-
  // loaded data (design §5.2/§5.3) — no refetch, no new route.
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<FloorFilters>(EMPTY_FILTERS);

  const [topTab, setTopTab] = useState<TopTab>("floor");
  const [viewMode, setViewMode] = useState<"live" | "history">("live");
  const [histDate, setHistDate] = useState<string | null>(null);

  // 🔴 `slotTab` AND `mode` ARE GONE (2026-09-10). The slot tabs went because a
  // trip carries the slot now — the rail groups trips under their window, so a
  // tab that re-cut the board by window would be the same grouping twice. The
  // pivot went with By picker and By group, and TripDesk owns the Flat / By route
  // choice that survived it. The assign context went with them: tapping a picker
  // card was the ONLY way to enter one, and there is no picker grid any more.

  // ── The trip board (2026-09-09) ───────────────────────────────────────────
  // 🔴 A SEPARATE FETCH, NOT A SLICE OF THE BOARD. `GET /api/floor/trips?date=`
  // reads every bill under each trip through trip_drops; the board's own rows
  // only carry what is still in `floorLiveBaseWhere`'s set. A trip whose bills
  // are all checked has LEFT that set, so bands built by filtering board rows
  // would render empty with a 0-of-0 bar. See trip-band.tsx's header.
  //
  // ⚠ NOT A SECOND POLL. It is fetched by `load()` alongside the other three
  // feeds and on nothing else — the live-sync marker still drives exactly one
  // refresh path, and the pause rules (panel open, selection up, History, tab
  // hidden) are unchanged.
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [tripOptions, setTripOptions] = useState<TripOptions | null>(null);

  // ── What the rail has selected, and the stops behind it ───────────────────
  //
  // The desk has exactly TWO readings and this is what picks between them: the
  // pool ("To plan") or one trip. It lands on the pool — the planner’s
  // first question of the day is what still has to go somewhere.
  const [railSelection, setRailSelection] = useState<RailSelection>({ kind: "pool" });
  // 🔴 A THIRD TRIP FETCH, AND IT HAS TO BE. `GET /api/floor/trips?date=` returns
  // summaries with no drops on them — a day of trips with every stop expanded
  // would be a payload nobody reads, since only one trip is open at a time. The
  // stops come from `GET /api/floor/trips/[id]`, fetched when the selection
  // changes and after every write that could move a bill between stops.
  //
  // ⚠ NOT A POLL. The effect below keys on `trips` — a fresh array on every
  // load() — so the stops refresh exactly when the board does and on nothing
  // else. The live-sync marker still drives one refresh path and the pause rules
  // (panel open, selection up, History, tab hidden) are unchanged.
  const [tripDetail, setTripDetail] = useState<TripDetail | null>(null);
  // The New trip form, and what it should attach the moment the trip exists.
  // An EMPTY array is the New trip button; a non-empty one is "New trip…" at the
  // foot of the bottom bar's list.
  const [tripFormSeed, setTripFormSeed] = useState<number[] | null>(null);
  // Which trip the vehicle editor is open over, and which trip has a write in
  // flight. Two separate ids on purpose: the editor stays open while its own
  // PATCH runs, and a Cancel on another band must not grey this one's buttons.
  const [editingTripId, setEditingTripId] = useState<number | null>(null);
  const [tripBusyId, setTripBusyId] = useState<number | null>(null);
  const [tripBarBusy, setTripBarBusy] = useState(false);
  /**
   * TARGETED ADD (2026-09-16): the trip "+ Add bills" was pressed in, or null.
   *
   * 🔴 THE ONE PIECE OF STATE THIS FLOW ADDS. Pool add mode is derived (see
   * `addMode`), but this cannot be: the planner has NAMED a trip and then walks
   * away from its panel into the pool, so the answer has to be remembered.
   * Cleared by Done, by Escape, by any click on the rail (`selectRail`), and by
   * the trip leaving the loaded list or being cancelled (the effect beside
   * `selectRail`). Nothing else clears it — search, tab changes and the live
   * refetch leave it alone.
   *
   * 🔴 THE BAR READS THIS, NOT THE RAIL (2026-09-18). The rail stays on the
   * trip throughout, so anything that asks the rail "pool or trip?" gets "trip"
   * and offers Remove. `addTargetLabel` is checked first in the bottom bar, and
   * the bar's context text says "adding to X" off this same id.
   */
  const [addingToTripId, setAddingToTripId] = useState<number | null>(null);
  /** Placeholder route names from the trips feed — see the add hint below. */
  const [placeholderRoutes, setPlaceholderRoutes] = useState<ReadonlySet<string>>(() => new Set<string>());
  /**
   * How many bills the last press added, for the band-s brief Undo — and the ids
   * to hand back. Cleared after ten seconds so the band goes quiet again.
   */
  const [lastAdd, setLastAdd] = useState<{ tripId: number; orderIds: number[] } | null>(null);
  const lastAddTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ⚠ REFS, NOT DEPENDENCIES. `setSelection()` is asynchronous, so a handler
  // that closed over `selectedIds` would post the PREVIOUS selection if it fired
  // in the same tick as a tick-box change. Putting them in the dependency array
  // instead would rebuild every trip handler on every keystroke of a selection.
  // A ref reads the CURRENT value at call time and keeps the callbacks stable.
  const selectedIdsRef = useRef<number[]>([]);
  const tripsRef = useRef<TripSummary[] | null>(null);

  // Selection (design §7.8) — a Set of orderIds; survives a re-sort, cleared on
  // any tab/scope/date change below.
  const [selection, setSelection] = useState<FloorDeskSelection>(new Set());
  // The bottom bar's ··· More menu (2026-09-22). Owned HERE, not in the menu,
  // because this component is the single Esc owner (FLOOR §4.6) and Esc must be
  // able to close it. Reset whenever the bar goes away (effect below barVisible).
  const [moreOpen, setMoreOpen] = useState(false);
  // The Hold tab bar's own ··· More (2026-09-22) — same reason it lives here.
  const [holdMoreOpen, setHoldMoreOpen] = useState(false);
  // The By route card open as chips + table (2026-09-24), or null for the grid.
  // Owned HERE for the same reason: Esc goes back to the cards. TripDesk clears
  // it whenever that card is not on screen, so Esc never closes an unseen card.
  const [openRouteCard, setOpenRouteCard] = useState<string | null>(null);

  // ── The other-days lookup's state (owner, 2026-09-29) ─────────────────────
  // Declared HERE, above load(), because load() settles the "Opening …" line
  // when the History day it was waiting for lands (see `pendingOpenRef`).
  // `lookupSeq` drops a stale lookup answer when a newer search (or a clear)
  // has happened since the request went out.
  const [lookup, setLookup] = useState<LookupState | null>(null);
  const lookupSeq = useRef(0);
  /**
   * The trip a lookup is OPENING on an older day, until the load for that day
   * lands. load() resolves it (clears the line once the day's trips include the
   * trip) or fails it (the line turns into an error with a retry). Cleared by a
   * new search, a clear, or a load for a different view (the planner moved on).
   */
  const pendingOpenRef = useRef<LookupTrip | null>(null);
  /** The search jump in flight, or null (2026-10-06 — see SearchFocus). */
  const [searchFocus, setSearchFocus] = useState<SearchFocus | null>(null);
  /**
   * EVERY bill the last search named (a shared invoice names two) — each of
   * their rows wears the amber search mark wherever it is on screen. Kept until
   * Clear search, a new search, or the detail panel opening on a bill NOT in
   * this list (openDetail / navigateDetail). Ticking a row leaves it alone.
   */
  const [litIds, setLitIds] = useState<number[]>([]);
  /**
   * A Cancel & CI bill the search found OUTSIDE today's list (2026-10-06): the
   * tab shows these rows, read-only, under a "Search result · {date}" banner
   * instead of today's — the way History shows an old trip. Null = today's list.
   * Cleared by Clear search and by any new search.
   */
  const [cancelSearch, setCancelSearch] = useState<{ rows: FloorCancelledRow[]; label: string } | null>(null);

  // ── THE STALE-ANSWER GUARD (owner, 2026-09-29) ────────────────────────────
  // load() had no guard, and on a slow link a LIVE refresh that started before
  // a History jump could land AFTER it — putting today's board and today's
  // trips under a History header, with polling paused so nothing corrected it
  // (step-3b diagnosis: live loads of 20-26 s starting ~7 s apart). Every load
  // now takes a number; its answer is applied only while it is still the
  // newest load AND the page still shows the view it was asked for. Same
  // pattern as `lookupSeq`. `viewKeyRef` is the CURRENT view, refreshed every
  // render below, so an in-flight load compares against now, not its closure.
  const loadSeq = useRef(0);
  const loadInFlightRef = useRef(false);
  const viewKeyRef = useRef(viewKeyOf(viewMode, histDate));
  viewKeyRef.current = viewKeyOf(viewMode, histDate);

  // ── LIVE CHANGE FEED (7b, behind app_settings 'live.feed') ────────────────
  // Mode "live": the feed replaces the 15 s marker + 30 s blind reload
  // (<LegacyFloorSync> is not mounted), On hold / Cancel & CI load lazily, and
  // changed bills are patched in by id (POST /api/floor/rows). Any other mode —
  // "off", "fallback" (repeated errors), or "unknown" without the hint — mounts
  // the old hooks and everything below behaves exactly as before: every
  // `feedModeRef.current === "live"` test is false. See the flush further down.
  const [tabCounts, setTabCounts] = useState<TabCounts | null>(null);
  const [sideTabLoading, setSideTabLoading] = useState<"hold" | "cancelled" | null>(null);
  const [detailChangeSignal, setDetailChangeSignal] = useState(0);
  const [, setRenderTick] = useState(0);
  const liveHintRef = useRef<boolean | null>(null);
  if (liveHintRef.current === null) liveHintRef.current = readLiveHint(FLOOR_LIVE_HINT_KEY);
  const feedModeRef = useRef<FeedMode>("unknown");
  const flushRef = useRef<() => void>(() => {});
  const onFeedModeRef = useRef<(m: FeedMode, prev: FeedMode) => void>(() => {});
  const onFeedChangesRef = useRef<(b: { orderIds: number[] }) => void>(() => {});
  const onMidnightRef = useRef<() => void>(() => {});
  const dataRef = useRef<BoardData | null>(data);
  dataRef.current = data;
  const holdRowsRef = useRef<FloorHoldRow[] | null>(holdRows);
  holdRowsRef.current = holdRows;
  const cancelledRowsRef = useRef<FloorCancelledRow[] | null>(cancelledRows);
  cancelledRowsRef.current = cancelledRows;
  const topTabRef = useRef<TopTab>(topTab);
  topTabRef.current = topTab;
  const feed = useLiveFeed({
    scope: "floor",
    topics: "order,trip,config",
    hintKey: FLOOR_LIVE_HINT_KEY,
    onPending: () => flushRef.current(),
    onChanges: (b) => onFeedChangesRef.current(b),
    onMode: (m, prev) => {
      feedModeRef.current = m;
      onFeedModeRef.current(m, prev);
    },
    onMidnight: () => onMidnightRef.current(),
  });
  const feedLive = feed.mode === "live";

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const viewKey = viewKeyOf(viewMode, histDate);
    const isStale = () => seq !== loadSeq.current || viewKeyRef.current !== viewKey;
    // Live feed: a full load covers every change seen so far — drop the queue.
    // Lazy tabs: On hold / Cancel & CI only once opened; their labels come from
    // /api/floor/counts until then. OFF: lazy is false and nothing here differs.
    const lazy = feedModeRef.current === "live" && viewMode === "live";
    if (lazy) feed.controller.current?.noteFullLoad();
    const wantHold = !lazy || holdRowsRef.current !== null || topTabRef.current === "hold";
    const wantCanc = !lazy || cancelledRowsRef.current !== null || topTabRef.current === "cancelled";
    loadInFlightRef.current = true;
    setLoading(true);
    setError(null);
    setSideError(null);
    try {
      // ⚠ ALWAYS UNSCOPED — see UNSCOPED_QS below. `scope` is deliberately NOT
      // a dependency of this callback: a chip click must not refetch.
      const params = new URLSearchParams(UNSCOPED_QS);
      if (viewMode === "history" && histDate) {
        params.set("mode", "history");
        params.set("date", histDate);
      }
      // Board + hold + cancelled + trips — four independent GET routes, fetched
      // together (parallel client fetches, not a prisma $transaction).
      // Hold/Cancelled are pure open states (no date anchor), so they ignore the
      // history params.
      //
      // ⚠ TRIPS JOINED THIS Promise.all ON 2026-09-12. It used to be awaited
      // AFTER these three, and it depends on none of them, so it sat on the
      // critical path for nothing: 32 statements and ~1 s of pure serial
      // latency on a page whose own board query executes in 4 ms server-side.
      // Measured before/after in the commit message. No predicate moved, no
      // poll interval moved, nothing under lib/floor/queries.ts was touched.
      //
      // 🔴 THE TRIPS REJECTION IS CAUGHT INSIDE THE ARRAY, AND THAT IS THE
      // WHOLE CARE OF THIS CHANGE. A bare fourth entry would make a trips
      // network failure reject the Promise.all, fall to the outer catch, and
      // BLANK THE BOARD — which is precisely what the sequential try/catch that
      // used to sit below these three prevented (FLOOR §5: never throw the page
      // away over a side feed). Catching to `null` here leaves that promise
      // unable to reject, so the failure semantics are byte-for-byte what they
      // were when trips ran last: a board rejection blanks, a trips failure
      // does not. The `null` is read in the trips block further down.
      //
      // ⚠ One honest difference: when the board answers non-2xx the throw below
      // now happens with the trips request ALREADY ISSUED, where before it was
      // never sent. That request is a read-only GET whose response is discarded,
      // and the outer catch still does `setTrips(null)`, so nothing observable
      // changes — but it is a difference, and it is written down rather than
      // discovered later.
      const tripDateParam =
        viewMode === "history" && histDate ? histDate : istTodayIso();
      // (Live feed: a lazy tab not yet opened is skipped — `null` — and the
      // counts ride as a fifth entry, caught like trips. OFF: the same four.)
      const [boardRes, holdRes, cancRes, tripRes, countsRes] = await Promise.all([
        fetch(`/api/floor/board?${params.toString()}`, { cache: "no-store" }),
        wantHold ? fetch(`/api/floor/hold?${UNSCOPED_QS}`, { cache: "no-store" }) : null,
        wantCanc ? fetch(`/api/floor/cancelled?${UNSCOPED_QS}`, { cache: "no-store" }) : null,
        fetch(`/api/floor/trips?date=${tripDateParam}`, { cache: "no-store" }).catch(() => null),
        lazy && (!wantHold || !wantCanc) ? fetch("/api/floor/counts", { cache: "no-store" }).catch(() => null) : null,
      ]);
      // A stale answer is dropped BEFORE anything is read or thrown — its
      // failure is no more this view's than its success is.
      if (isStale()) return;
      if (!boardRes.ok) throw new Error(`HTTP ${boardRes.status}`);
      const board = await boardRes.json();
      // ⚠ READ EVERY BODY FIRST, THEN CHECK ONCE, THEN APPLY. The side-feed
      // bodies are awaited here, before any setter, so the guard below is the
      // last await in the success path and a load is applied whole or not at
      // all — never a live board beside a History day's trips. The failure
      // semantics are unchanged: a board or a hold/cancelled body that throws
      // still reaches the outer catch; a trips failure still only empties the
      // rail (the inner try/catch below, now around the read).
      const holdBody = holdRes === null ? null : holdRes.ok ? await holdRes.json() : null;
      const cancBody = cancRes === null ? null : cancRes.ok ? await cancRes.json() : null;
      let countsBody: ({ enabled?: boolean } & Partial<TabCounts>) | null = null;
      try {
        if (countsRes && countsRes.ok) countsBody = (await countsRes.json()) as { enabled?: boolean } & Partial<TabCounts>;
      } catch {
        countsBody = null; // labels keep their last numbers
      }
      let tripsBody: { trips?: TripSummary[]; placeholderRoutes?: string[] } | null = null;
      let tripsError: string | null = null;
      try {
        if (tripRes === null) tripsError = "Trips feed unreachable";
        else if (tripRes.ok) tripsBody = (await tripRes.json()) as { trips?: TripSummary[]; placeholderRoutes?: string[] };
        else tripsError = `Trips feed HTTP ${tripRes.status}`;
      } catch {
        tripsError = "Trips feed unreachable";
      }
      if (isStale()) return;

      setData({ floor: board.floor, pickers: board.pickers ?? [] });
      setRouteClubs((board.routeClubs ?? []) as FloorRouteClub[]);
      setLoadPlan((board.loadPlan ?? { configs: {}, routeNames: {} }) as FloorLoadPlanPayload);

      // A failed side feed must not blank the board — surface its own error and
      // leave the tab empty rather than throwing the whole page away.
      if (holdRes === null) { /* live feed: lazy tab not opened — rows stay unloaded */ }
      else if (holdBody !== null) setHoldRows((holdBody.rows ?? []) as FloorHoldRow[]);
      else { setHoldRows([]); setSideError(`Hold feed HTTP ${holdRes.status}`); }
      if (cancRes === null) { /* live feed: lazy tab not opened */ }
      else if (cancBody !== null) setCancelledRows((cancBody.rows ?? []) as FloorCancelledRow[]);
      else { setCancelledRows([]); setSideError((prev) => prev ?? `Cancelled feed HTTP ${cancRes.status}`); }
      if (countsBody?.enabled && countsBody.hold && countsBody.cancelled) {
        setTabCounts({ hold: countsBody.hold, cancelled: countsBody.cancelled });
      }

      // The day's trips — a FOURTH feed, issued in the Promise.all above rather
      // than by a poll of its own, so the board and the bands can never describe
      // different moments. Anchored on the SAME day the board is showing: today
      // in live mode, the viewed day in History.
      //
      // A failure leaves the rail empty and does NOT blank the board — same rule
      // as the hold/cancelled feeds above (FLOOR §5: never throw the page away
      // over a side feed). THREE failure shapes, all landing on that rule:
      //   `tripRes === null` — the request itself failed, caught in the array.
      //   `!tripRes.ok`      — the route answered non-2xx.
      //   a throw from .json() — a malformed body, which rejects HERE and not in
      //                          the array, which is why the try/catch survives
      //                          the move rather than being folded into it.
      //
      // 🔴 FETCHED FOR EVERYONE. It used to be skipped for a non-admin, because
      // By trip was an admin-only pivot option nobody else could reach. The trip
      // desk IS the Floor tab now, so skipping this would leave the rail empty
      // for every operator on the floor.
      // (The read itself moved above the stale check; the rule is unchanged.)
      if (tripsBody !== null) {
        setTrips(tripsBody.trips ?? []);
        // The routes that name nothing, by their current names — the pool-s
        // add hint skips exactly what the rail card-s label skips (2026-09-16).
        setPlaceholderRoutes(new Set(tripsBody.placeholderRoutes ?? []));
      } else {
        setTrips([]);
        setSideError((prev) => prev ?? tripsError ?? "Trips feed unreachable");
      }

      setLastSyncedAt(new Date());

      // ── Settle a lookup's History jump (owner, 2026-09-29) ───────────────
      // This load is the newest and for the view on screen. If it is the day a
      // lookup is opening, the jump is done once that day's trips include the
      // trip (it was selected in openLookupTrip). A load for any OTHER view
      // means the planner moved on — the line goes quietly.
      const pend = pendingOpenRef.current;
      if (pend !== null) {
        pendingOpenRef.current = null;
        const forThatDay = viewKey === viewKeyOf("history", pend.tripDate);
        const found = (tripsBody?.trips ?? []).some((t) => t.id === pend.tripId);
        setLookup((cur) =>
          cur?.status !== "opening" || cur.trip.tripId !== pend.tripId
            ? cur
            : forThatDay && !found
              ? {
                  status: "open-failed",
                  trip: pend,
                  reason: tripsError ?? `${pend.tripNumber} is not in that day's trips`,
                }
              : null,
        );
      }
    } catch (e) {
      if (isStale()) return;
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
      setHoldRows(null);
      setCancelledRows(null);
      setTrips(null);
      // The History load a lookup was waiting on failed → say so, with a retry.
      const pend = pendingOpenRef.current;
      if (pend !== null && viewKey === viewKeyOf("history", pend.tripDate)) {
        pendingOpenRef.current = null;
        setLookup((cur) =>
          cur?.status === "opening" && cur.trip.tripId === pend.tripId
            ? { status: "open-failed", trip: pend, reason: e instanceof Error ? e.message : "Failed to load" }
            : cur,
        );
      }
    } finally {
      // ⚠ ONLY THE NEWEST LOAD CLEARS THE SPINNER. A superseded load finishing
      // must not report "loaded" while the newer one is still in flight.
      if (seq === loadSeq.current) {
        loadInFlightRef.current = false;
        setLoading(false);
        // Live feed: changes that arrived during the load were held back — apply now.
        if (feedModeRef.current === "live") setTimeout(() => flushRef.current(), 0);
      }
    }
    // `scope` is NOT here on purpose — every fetch is unscoped and the chips are
    // a pure client-side narrowing (scopedData below). Adding it back would
    // restore the 3-fetches-per-chip-click behaviour this change removed.
  }, [viewMode, histDate]);

  // ⚠ ONE EXCEPTION, live feed only: when this browser saw the feed ON last
  // time (FLOOR_LIVE_HINT_KEY), the MOUNT load is skipped — the feed takes its
  // head cursor first and then asks for the load itself (design: cursor before
  // load, so no change is missed). If the feed turns out OFF or unreachable,
  // onFeedMode below loads at once. Without the hint (always, until the switch
  // has been on) this effect is exactly what it was.
  const skipMountLoadRef = useRef(liveHintRef.current === true);
  const mountLoadSkippedRef = useRef(false);
  useEffect(() => {
    if (skipMountLoadRef.current) {
      skipMountLoadRef.current = false;
      if (feedModeRef.current === "unknown") {
        mountLoadSkippedRef.current = true;
        return;
      }
    }
    void load();
  }, [load]);

  // The gate state, read ONCE on mount. Deliberately NOT folded into load() and
  // NOT re-read on the 15s marker tick: it is an operations setting that changes
  // a handful of times a day, and adding a fourth fetch to every board reload
  // would spend a round trip on an answer that is almost always the same. The
  // switch is this screen's own control, so a flip made here updates state
  // directly (`onChanged`); a flip made in another tab shows up on next load.
  //
  // A failure leaves `gateEnabled` null, which renders as OFF and hides the
  // switch — the board is then exactly what it is today, which is the safe
  // direction (FLOOR §5: never blank the board over a side feed).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/floor/pick-gate", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { enabled?: boolean };
        if (!cancelled && typeof body.enabled === "boolean") setGateEnabled(body.enabled);
      } catch {
        // silent — the switch stays hidden and the board is unaffected
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Selection does NOT survive a tab/scope/date change (design §7.8). Includes
  // the top tab: switching away from Floor drops the floor selection (Hold and
  // Cancelled own their own selection internally).
  //
  // `railSelection` is on the list by the same rule the others are: moving
  // between the pool and a trip changes WHICH ROWS ARE ON SCREEN, and a tick
  // surviving that move would put a bill on a trip the operator cannot see. It
  // also keeps the bottom bar honest — the bar's mode is read off this same
  // selection, so a stale tick would offer "Remove from trip" over pool rows.
  useEffect(() => {
    setSelection(new Set());
  }, [scope, viewMode, histDate, topTab, railSelection]);

  const clearSelection = () => setSelection(new Set());

  // The New trip form's dropdown lists. Fetched ONCE, lazily, the first time the
  // form opens — four static master-data lists have no business on the
  // 15-second board reload, and most sessions never open the form at all.
  //
  // `seedIds` is what the trip should be created WITH: empty from the New trip
  // button, the current selection from "New trip…" at the foot of the Add-to-trip
  // list.
  const openTripForm = useCallback(
    async (seedIds: number[]) => {
      setTripFormSeed(seedIds);
      if (tripOptions !== null) return;
      try {
        const res = await fetch("/api/floor/trips/options", { cache: "no-store" });
        if (res.ok) {
          setTripOptions((await res.json()) as TripOptions);
        } else {
          // CLOSE AGAIN on failure. The form renders only once its options have
          // landed, so leaving it "open" with nothing loaded would show the
          // operator an empty screen and a toast he may have missed.
          setTripFormSeed(null);
          toast.error(`Could not load the trip form — HTTP ${res.status}`);
        }
      } catch {
        setTripFormSeed(null);
        toast.error("Could not load the trip form — check your connection.");
      }
    },
    [tripOptions],
  );

  // After a create. The new trip is SELECTED on the rail — the planner has just
  // said what he is building, and landing him back on the pool would make him
  // find it. The selection is cleared and the board refetched EXPLICITLY: the
  // live-sync poll is paused while a selection is up (FLOOR §5), so leaving the
  // refresh to it would leave the new trip off screen until he clicked something
  // else.
  const onTripCreated = useCallback(
    async (tripId: number) => {
      setTripFormSeed(null);
      setSelection(new Set());
      // Opening the new trip ends any targeted add, for the reason `selectRail`
      // gives: the rail moves, so the add must not stay pointed elsewhere.
      setAddingToTripId(null);
      setLastAdd(null);
      setRailSelection({ kind: "trip", tripId });
      await load();
    },
    [load],
  );

  // The selected trip's STOPS. Cleared the moment the rail moves to the pool, so
  // a stale trip's stops can never render under a different header.
  //
  // ⚠ `trips` IS A DEPENDENCY ON PURPOSE. Its identity changes on every load(),
  // which is what makes a write — add, remove, release, cancel — pull the stops
  // again. Without it a bill added to the open trip would land on the rail card's
  // count and nowhere in the list below it.
  useEffect(() => {
    if (railSelection.kind !== "trip") {
      setTripDetail(null);
      return;
    }
    const tripId = railSelection.tripId;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/floor/trips/${tripId}`, { cache: "no-store" });
        if (!res.ok) {
          // No toast. The rail card is still on screen with its own counts, and
          // the desk says "Loading stops…" rather than claiming the trip is
          // empty — a 404 here means the trip left the day, which the next
          // load() will show honestly.
          if (!cancelled) setTripDetail(null);
          return;
        }
        const body = (await res.json()) as { trip?: TripDetail };
        if (!cancelled) setTripDetail(body.trip ?? null);
      } catch {
        if (!cancelled) setTripDetail(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [railSelection, trips]);

  // ── Trip writes ───────────────────────────────────────────────────────────
  //
  // ⚠ EVERY ONE OF THESE CLEARS THE SELECTION AND THEN REFETCHES EXPLICITLY.
  // The live-sync poll is PAUSED while a selection is up (FLOOR §5), so leaving
  // the refresh to it would leave the board stale until the operator clicked
  // something else. Same shape as the Show strip's handler and bulkAssign's.

  /**
   * Undo one add: take the bills THAT PRESS attached back off THAT trip
   * (2026-09-16, owner's design).
   *
   * 🔴 IT CHECKS BEFORE IT REMOVES, and that is not belt-and-braces. The bills
   * route's `remove` clears whatever stop a bill is on — it does not verify the
   * stop belongs to the trip in the URL — so undoing blind could pull a bill off
   * a DIFFERENT trip if another planner moved it in those ten seconds. The trip
   * is read first and only ids still on it are sent; anything that moved is left
   * exactly where it is and said out loud.
   *
   * ⚠ IT WORKS EVEN IF A BILL HAS SINCE BEEN PICKED OR HELD. Removing from a
   * trip writes `tripDropId` and nothing else — no stage, no hold — so there is
   * no state for the undo to fight. A picked bill simply returns to the pool
   * still picked.
   */
  const undoAdd = useCallback(
    async (tripId: number, orderIds: number[]) => {
      if (orderIds.length === 0) return;
      setTripBusyId(tripId);
      try {
        const detail = await fetch(`/api/floor/trips/${tripId}`, { cache: "no-store" })
          .then((r) => (r.ok ? (r.json() as Promise<TripDetail>) : null))
          .catch(() => null);
        if (detail === null) {
          toast.error("Could not undo — the trip could not be read.");
          return;
        }
        const stillOn = new Set(detail.drops.flatMap((d) => d.orderIds));
        const ids = orderIds.filter((id) => stillOn.has(id));
        const moved = orderIds.length - ids.length;
        if (ids.length === 0) {
          toast.info("Nothing to undo — those bills are no longer on this trip.");
          return;
        }
        const res = await fetch(`/api/floor/trips/${tripId}/bills`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderIds: ids, action: "remove" }),
        });
        const body = await res.json().catch(() => ({}));
        const detached: number[] = body?.detached ?? [];
        if (!res.ok && detached.length === 0) {
          toast.error(`Could not undo — ${body?.failed?.[0]?.error ?? body?.error ?? `HTTP ${res.status}`}`);
          return;
        }
        toast.success(
          `Undone — ${detached.length} bill${detached.length === 1 ? "" : "s"} back in the pool` +
            (moved > 0 ? `; ${moved} had already been moved elsewhere and ${moved === 1 ? "was" : "were"} left alone` : ""),
        );
      } catch {
        toast.error("Could not undo — check your connection.");
      } finally {
        setTripBusyId(null);
      }
      // The live-sync poll may be paused, so the rail counts only come back
      // right if we ask (FLOOR §5).
      await load();
    },
    [load],
  );

  /**
   * "+ Add bills" inside a trip (2026-09-16): remember the trip and open the
   * pool BELOW it (2026-09-18 — TripDesk stacks trip, band, pool; it used to
   * swap the trip out). The trip's card STAYS selected on the rail, which is
   * why this does not touch `railSelection`.
   *
   * ⚠ THE SELECTION IS CLEARED, on the way in and on the way out. A tick made
   * on the trip's own rows means "take this off"; carried into the add it would
   * be posted as an add. Ticks made in the pool mean "put this on"; carried out
   * by Done they would sit under a trip bar offering Remove. There is one
   * selection for the screen, so the mode change empties it.
   */
  const startAddingTo = useCallback((tripId: number) => {
    setSelection(new Set());
    setAddingToTripId(tripId);
    setLastAdd(null);
  }, []);

  /** Done, Escape, or a rail click: close the pool half and leave the trip. */
  const stopAddingTo = useCallback(() => {
    setSelection(new Set());
    setAddingToTripId(null);
    setLastAdd(null);
  }, []);

  /**
   * A click on the rail — "To plan" or a trip card. The rail's ONLY caller.
   *
   * 🔴 IT ENDS A TARGETED ADD (owner, 2026-09-18). A click on a card is a plain
   * request to look at that trip. Before this, the rail moved and the add did
   * not: the rail lit trip B while the band still said "Adding bills to A" and
   * the pane still showed the pool. Silently retargeting the add to B would be
   * the opposite surprise, so the click simply opens what was clicked.
   */
  const selectRail = useCallback(
    (sel: RailSelection) => {
      stopAddingTo();
      setRailSelection(sel);
    },
    [stopAddingTo],
  );

  /**
   * 🔴 THE ADD ENDS WHEN ITS TRIP LEAVES THE LOADED LIST (owner, 2026-09-18) —
   * a History day that does not include it, or a trip cancelled by someone
   * else. The band is drawn only when the trip is found, so without this the
   * band vanished while the mode stayed on, and the pane kept showing a pool
   * with no trip named anywhere. Same class as the bar reading the wrong state:
   * the band and the mode must never disagree.
   *
   * `trips === null` is a load in flight, not an answer — left alone.
   */
  useEffect(() => {
    if (addingToTripId === null || trips === null) return;
    const target = trips.find((t) => t.id === addingToTripId);
    if (!target || target.status === "cancelled") stopAddingTo();
  }, [addingToTripId, trips, stopAddingTo]);

  /** Add the ticked bills to an existing trip. */
  const addSelectionToTrip = useCallback(
    async (tripId: number, opts?: { quiet?: boolean }) => {
      const ids = selectedIdsRef.current;
      if (ids.length === 0) return;
      setTripBusyId(tripId);
      try {
        const res = await fetch(`/api/floor/trips/${tripId}/bills`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderIds: ids, action: "add" }),
        });
        const body = await res.json().catch(() => ({}));
        const attached: number[] = body?.attached ?? [];
        const skipped: number[] = body?.skipped ?? [];
        const failed: Array<{ orderId: number; error: string }> = body?.failed ?? [];
        if (!res.ok && attached.length === 0 && skipped.length === 0) {
          toast.error(`Could not add — ${failed[0]?.error ?? body?.error ?? `HTTP ${res.status}`}`);
        } else if (opts?.quiet) {
          // 🔴 NO TOAST WHILE FILLING A NAMED TRIP (owner). The band across the
          // pool is the receipt — its counts move with every press — and a popup
          // every few seconds while bucketing is noise that also covers the bar
          // being pressed. The one thing the toast carried is kept: the band
          // shows "· N added · Undo" for ten seconds.
          if (attached.length > 0) {
            setLastAdd({ tripId, orderIds: attached });
            if (lastAddTimer.current) clearTimeout(lastAddTimer.current);
            lastAddTimer.current = setTimeout(() => setLastAdd(null), 10_000);
          }
        } else if (attached.length > 0 || skipped.length > 0) {
          // 🔴 THE RECEIPT, WITH A WAY BACK (2026-09-16). "2 bills added to
          // L-260916-04 · now 4 bills · 1,361 L" — what moved, where it went,
          // and what that trip now holds. The counts are READ BACK from the trip
          // itself rather than added up here: another planner may have been
          // adding to the same load a second earlier, and a number this page
          // computed would quietly disagree with the card beside it.
          const after = await fetch(`/api/floor/trips/${tripId}`, { cache: "no-store" })
            .then((r) => (r.ok ? (r.json() as Promise<TripDetail>) : null))
            .catch(() => null);
          const label = after?.tripNumber ?? "the trip";
          const moved =
            attached.length > 0
              ? `${attached.length} bill${attached.length === 1 ? "" : "s"} added to ${label}`
              : `${skipped.length} already on ${label}`;
          const now =
            after !== null
              ? ` · now ${after.counts.total} bill${after.counts.total === 1 ? "" : "s"} · ${formatLitres(after.totalLitres)} L`
              : "";
          const extra =
            attached.length > 0 && skipped.length > 0
              ? ` (${skipped.length} already on it)`
              : "";
          toast.success(`${moved}${extra}${now}`, {
            // Ten seconds: long enough to notice a wrong card and reach for it,
            // short enough that it is gone before the next selection is made.
            duration: 10_000,
            // UNDO REVERSES THIS ADD AND NOTHING ELSE — the ids this press
            // actually attached, off this trip. Nothing to undo when every bill
            // was already there.
            ...(attached.length > 0
              ? { action: { label: "Undo", onClick: () => void undoAdd(tripId, attached) } }
              : {}),
          });
        }
        // Never swallowed, even beside a success — FLOOR §6(b).
        if (failed.length > 0) {
          toast.error(
            `${failed.length} bill${failed.length === 1 ? "" : "s"} not added — ${failed[0].error}`,
          );
        }
      } catch {
        toast.error("Could not add to the trip — check your connection.");
      } finally {
        setTripBusyId(null);
      }
      setSelection(new Set());
      await load();
    },
    [load, undoAdd],
  );

  /** Take the ticked bills off whatever trip they are on. */
  const removeSelectionFromTrips = useCallback(
    async (rowsToRemove: FloorBoardRow[]) => {
      if (rowsToRemove.length === 0) return;
      setTripBarBusy(true);
      try {
        // Grouped by trip because the route is per-trip. A selection spanning
        // two bands is ordinary — the operator ticks by eye — so this posts once
        // per trip rather than refusing the mixed case.
        const byTrip = new Map<string, number[]>();
        for (const r of rowsToRemove) {
          if (!r.tripNumber) continue;
          const arr = byTrip.get(r.tripNumber) ?? [];
          arr.push(r.orderId);
          byTrip.set(r.tripNumber, arr);
        }
        const allTrips = tripsRef.current ?? [];
        let removed = 0;
        const problems: string[] = [];
        for (const [tripNumber, orderIds] of Array.from(byTrip.entries())) {
          const t = findTripByNumber(allTrips, tripNumber);
          if (!t) {
            problems.push(`${tripNumber} is no longer on the board`);
            continue;
          }
          const res = await fetch(`/api/floor/trips/${t.id}/bills`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderIds, action: "remove" }),
          });
          const body = await res.json().catch(() => ({}));
          const detached: number[] = body?.detached ?? [];
          const failed: Array<{ orderId: number; error: string }> = body?.failed ?? [];
          removed += detached.length;
          if (failed.length > 0) problems.push(`${tripNumber}: ${failed[0].error}`);
          else if (!res.ok) problems.push(`${tripNumber}: ${body?.error ?? `HTTP ${res.status}`}`);
        }
        if (removed > 0) toast.success(`${removed} removed from trip${byTrip.size === 1 ? "" : "s"}`);
        if (problems.length > 0) toast.error(problems[0]);
        if (removed === 0 && problems.length === 0) toast.error("Nothing was removed.");
      } catch {
        toast.error("Could not remove — check your connection.");
      } finally {
        setTripBarBusy(false);
      }
      setSelection(new Set());
      await load();
    },
    [load],
  );

  /**
   * Remove from trip, SPLIT (2026-10-03, plan rev 5 §4.3): the ticked bills go
   * the existing way (bills route, unchanged); the ticked RE-DELIVERIES go to
   * POST /api/floor/trips/[id]/redeliveries { action: "remove", redeliveryIds }
   * on the OPEN trip — they are only ever drawn there. A re-delivery's orderId
   * never reaches the bills route: that would take the bill off its FIRST trip.
   */
  const removeSelectionSplit = useCallback(
    async (rowsToRemove: FloorBoardRow[], redeliveryIds: number[], tripId: number | null) => {
      if (redeliveryIds.length === 0) {
        await removeSelectionFromTrips(rowsToRemove);
        return;
      }
      setTripBarBusy(true);
      try {
        if (tripId === null) {
          toast.error("Open the trip the re-deliveries are on, then remove them.");
        } else {
          const res = await fetch(`/api/floor/trips/${tripId}/redeliveries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "remove", redeliveryIds }),
          });
          const body = await res.json().catch(() => ({}));
          const removed: number[] = body?.removed ?? [];
          const failed: Array<{ redeliveryId: number; error: string }> = body?.failed ?? [];
          if (removed.length > 0) {
            toast.success(`${removed.length} re-deliver${removed.length === 1 ? "y" : "ies"} removed from the trip`);
          }
          if (failed.length > 0) toast.error(`${failed.length} re-delivery not removed — ${failed[0].error}`);
          else if (!res.ok && removed.length === 0) toast.error(`Could not remove — ${body?.error ?? `HTTP ${res.status}`}`);
        }
      } catch {
        toast.error("Could not remove — check your connection.");
      } finally {
        setTripBarBusy(false);
      }
      if (rowsToRemove.length > 0) {
        // Clears the selection and reloads itself.
        await removeSelectionFromTrips(rowsToRemove);
      } else {
        setSelection(new Set());
        await load();
      }
    },
    [load, removeSelectionFromTrips],
  );

  // ⚠ THE CONFIRM PLAN HANDLER WENT IN SLICE 6 (2026-09-15). The button is gone
  // with the Draft / Confirmed words: entering a vehicle is what moves a trip out
  // of draft now, on the SERVER, inside the create and PATCH routes
  // (app/api/floor/trips/route.ts, …/[id]/route.ts). POST …/[id]/confirm still
  // exists and has no caller on this screen.

  // ⚠ THE MARK DISPATCHED HANDLER WENT IN SLICE 7 (2026-09-15). The planner at
  // this desk cannot see whether a truck left; the supervisor standing next to
  // it can. Finishing the loading on the supervisor's future loading screen is
  // what will mark the bills dispatched, through the SAME route this called —
  // POST /api/floor/trips/[id]/dispatch, kept on purpose. Until that screen
  // exists nothing on the floor writes the stage and no trip closes.

  /** Cancel a trip. NEVER a delete — the number stays claimed (see the route). */
  const cancelTrip = useCallback(
    async (tripId: number) => {
      setTripBusyId(tripId);
      try {
        const res = await fetch(`/api/floor/trips/${tripId}/cancel`, { method: "POST" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(`Could not cancel — ${body?.error ?? `HTTP ${res.status}`}`);
        } else {
          const detached: number[] = body?.detached ?? [];
          toast.success(
            `${body?.trip?.tripNumber ?? "Trip"} cancelled` +
              (detached.length > 0 ? ` · ${detached.length} bill${detached.length === 1 ? "" : "s"} back at the desk` : ""),
          );
          const failed: Array<{ orderId: number; error: string }> = body?.failed ?? [];
          if (failed.length > 0) toast.error(`${failed.length} bill(s) not detached — ${failed[0].error}`);
        }
      } catch {
        toast.error("Could not cancel — check your connection.");
      } finally {
        setTripBusyId(null);
      }
      setSelection(new Set());
      await load();
    },
    [load],
  );

  /** Open the vehicle editor. Needs the same option lists the drawer does. */
  const openVehicleEditor = useCallback(
    async (tripId: number) => {
      setEditingTripId(tripId);
      if (tripOptions !== null) return;
      try {
        const res = await fetch("/api/floor/trips/options", { cache: "no-store" });
        if (res.ok) setTripOptions((await res.json()) as TripOptions);
        else {
          setEditingTripId(null);
          toast.error(`Could not load the form — HTTP ${res.status}`);
        }
      } catch {
        setEditingTripId(null);
        toast.error("Could not load the form — check your connection.");
      }
    },
    [tripOptions],
  );

  // UNSCOPED on purpose — this only resolves already-SELECTED ids into rows for
  // the bulk bar, and a selection can only ever hold in-scope ids (it is cleared
  // on every scope change by the effect above). Reading the unscoped set keeps
  // the bar populated for the one render between a chip click and that clear,
  // which is exactly how it behaved when a chip click refetched.
  const rows = data?.floor.rows ?? [];
  // 🔴 BOARD ROWS BY NUMERIC orderId ONLY. Every bill action below (add to
  // trip, New trip, Remove, Hold, Cancel / Raise CI, the type choice) reads
  // `selectedRows` / `selectedIdsRef`, so an `rd:` key (a ticked re-delivery)
  // can never reach one of them — it matches no board row by construction.
  const selectedRows = rows.filter((r) => selection.has(r.orderId));
  const selectedIds = selectedRows.map((r) => r.orderId);
  // RE-DELIVERIES ticked on the open trip (2026-10-03) — `rd:<id>` keys, resolved
  // against the trip detail the panel draws. Only Remove from trip reads them.
  const tripRedeliveryById = new Map<number, TripRedeliveryRow>(
    (tripDetail?.drops ?? []).flatMap((d) => (d.redeliveries ?? []).map((r) => [r.id, r] as const)),
  );
  const selectedRedeliveryIds = Array.from(selection)
    .filter(isRdKey)
    .map(rdIdOf)
    .filter((id) => tripRedeliveryById.has(id));
  // Keep the refs the trip handlers read in step with the render. Assigning
  // during render is safe for a ref (no subscription, no re-render) and is what
  // makes the handlers stable without going stale.
  selectedIdsRef.current = selectedIds;
  tripsRef.current = trips;

  // ⚠ THE RAIL'S THREE HANDLERS WENT WITH THE RAIL (2026-09-10) — per-card
  // Release-to-a-slot, Hold and ✕. Hold and Cancel are unchanged and still
  // reachable on any bill through the detail panel (`detailActions` below);
  // per-bill release is what putting the bill on a trip does now.
  //
  // /api/floor/release itself is NOT dead — lib/floor/release.ts is the one
  // writer both it and the trip release call (FLOOR: one owner per behaviour).
  // Nothing on this screen posts to it any more.

  // Row ⚡ — per-bill urgent TOGGLE (no `urgent` field → route flips it).
  const rowMarkUrgent = useCallback(
    async (orderId: number) => {
      const r = await postJson("/api/floor/actions", { action: "mark-urgent", orderIds: [orderId] });
      reportWrite("Urgent", r);
      await load();
    },
    [load],
  );

  const onToggleRow = useCallback((id: number) => setSelection((s) => toggleDeskKey(s, id)), []);
  // A RE-DEL row ticks by `rd:<redeliveryId>` — never the bill's orderId (lib/floor/selection.ts).
  const onToggleRedelivery = useCallback((redeliveryId: number) => setSelection((s) => toggleDeskKey(s, rdKey(redeliveryId))), []);
  const onToggleAll = useCallback((tableRows: FloorBoardRow[]) => setSelection((s) => toggleAllDesk(s, tableRows)), []);

  // ── Bulk bar actions ──────────────────────────────────────────────────────
  // Bulk mark-urgent + bulk hold were RETIRED with the bulk-bar v2 rebuild —
  // urgent is now the per-row ⚡ (rowMarkUrgent → floor-table); hold is the detail
  // panel's ⋯ menu. Do not re-add them to the bar.
  // ── Show to floor, PER TRIP (slice 8, 2026-09-15) ─────────────────────────
  // The per-BILL Show strip, its handler and POST /api/floor/pick-visible were
  // retired: with desk control on, the desk now shows the supervisor one TRUCK
  // at a time. This posts to POST /api/floor/trips/[id]/show, which writes the
  // TRIP (trips.shownAt) and never an order row.
  //
  // ⚠ THE REFETCH IS EXPLICIT, as on every write here — the live-sync poll may
  // be paused, and nothing else would notice.
  const setTripShown = useCallback(
    async (tripId: number, shown: boolean) => {
      setTripBusyId(tripId);
      try {
        const res = await fetch(`/api/floor/trips/${tripId}/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shown }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          changed?: boolean;
          tripNumber?: string;
          waitingCount?: number;
          error?: string;
        };
        const label = body?.tripNumber ?? "Trip";
        if (!res.ok) {
          toast.error(`Could not ${shown ? "show" : "take back"} — ${body?.error ?? `HTTP ${res.status}`}`);
        } else if (!body.changed) {
          // A skip, and SAID as one: nothing was written.
          toast.info(`${label} was already ${shown ? "shown to the floor" : "taken back"}.`);
        } else if (shown) {
          const n = body.waitingCount ?? 0;
          toast.success(`${label} shown to the floor · ${n} bill${n === 1 ? "" : "s"} waiting`);
        } else {
          toast.success(`${label} taken back from the floor — bills already with pickers stay with them`);
        }
      } catch {
        toast.error(`Could not ${shown ? "show" : "take back"} — check your connection.`);
      } finally {
        setTripBusyId(null);
      }
      await load();
    },
    [load],
  );

  // ── Send to billing, PER TRIP (slice 9, 2026-09-15) ───────────────────────
  // Puts the trip on the Billing screen's Print tab. Posts to
  // POST /api/floor/trips/[id]/billing, which writes the TRIP and never an order
  // row. Take-back is always allowed while the trip is sent — billing's copy /
  // Done never locks it (Print v2, 2026-10-05). Explicit refetch, as above.
  const setTripSentToBilling = useCallback(
    async (tripId: number, sent: boolean) => {
      setTripBusyId(tripId);
      try {
        const res = await fetch(`/api/floor/trips/${tripId}/billing`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sent }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          changed?: boolean;
          tripNumber?: string;
          eligible?: number;
          invoiced?: number;
          error?: string;
          code?: string;
        };
        const label = body?.tripNumber ?? "Trip";
        if (!res.ok && body?.code === "CHALLAN_ONLY") {
          // Challan orders slice 2b (2026-10-06): the server's own sentence, alone.
          toast.error(body.error ?? "Only challan orders on this trip — nothing to bill.");
        } else if (!res.ok) {
          toast.error(`Could not ${sent ? "send to billing" : "take back"} — ${body?.error ?? `HTTP ${res.status}`}`);
        } else if (!body.changed) {
          toast.info(`${label} was already ${sent ? "sent to billing" : "taken back from billing"}.`);
        } else if (sent) {
          toast.success(`${label} sent to billing · ${body.invoiced ?? 0} of ${body.eligible ?? 0} invoiced`);
        } else {
          toast.success(`${label} taken back from billing`);
        }
      } catch {
        toast.error(`Could not ${sent ? "send to billing" : "take back"} — check your connection.`);
      } finally {
        setTripBusyId(null);
      }
      await load();
    },
    [load],
  );

  // ⚠ THREE BULK HANDLERS WENT WITH THE BARS THAT CALLED THEM (2026-09-10):
  // `bulkChangeSlot` (the assign bar's Change slot), `bulkAssign` (its Assign /
  // Reassign) and `assignGroup` (the By-group header's one-press assign).
  //
  // Nothing on this screen assigns a picker in bulk any more. The slot comes
  // from the trip; handing bills to a picker is the supervisor's job on
  // /picking, where the mobile Assign tab does it one bill at a time and always
  // did. Per-bill Reassign and Unassign are UNCHANGED and still in the detail
  // panel's ⋯ menu (`detailActions` below) — those call /api/picking/assign and
  // /api/picking/unassign directly, so no Picking endpoint lost a caller.

  // ── Bottom bar: bulk Hold + 8 s Undo (2026-09-22, floor-bulk-actions v5) ──
  //
  // Hold posts every ticked id to the existing `hold` action — the route was
  // always a batch; only the caller was single-bill. Undo posts the ids that
  // were ACTUALLY held to `unhold`, which puts back the one field hold changed
  // (`dispatchStatus`, derived from the stage server-side).
  //
  // ⚠ THE UNDO IDS LIVE IN THE TOAST'S CLOSURE. The reload right after the hold
  // takes those bills off the board, so nothing on screen can be read back for
  // them eight seconds later.
  const undoHold = useCallback(
    async (orderIds: number[]) => {
      const r = await postJson("/api/floor/actions", { action: "unhold", orderIds });
      if (reportWrite("Undo hold", r)) {
        const n = orderIds.length;
        toast.success(`${n} bill${n === 1 ? "" : "s"} back on the floor`);
      }
      await load();
    },
    [load],
  );

  const bulkHold = useCallback(
    async (rowsToHold: FloorBoardRow[]) => {
      if (rowsToHold.length === 0) return;
      setTripBarBusy(true);
      const r = await postJson("/api/floor/actions", { action: "hold", orderIds: rowsToHold.map((x) => x.orderId) });
      setTripBarBusy(false);
      const done = Array.isArray(r.body.done) ? r.body.done : [];
      const failed = Array.isArray(r.body.failed) ? r.body.failed : [];
      if (done.length === 0) {
        // Nothing held — say why and keep every tick where it was.
        const why = r.body.error ?? failed[0]?.error;
        toast.error(why ? `Hold failed — ${why}` : "Hold failed.");
        await load();
        return;
      }
      const heldSet = new Set(done);
      // A held bill keeps its trip (hold never writes tripDropId) but leaves the
      // trip's stop on the board, so the planner is told how many went.
      const fromTrips = rowsToHold.filter((x) => heldSet.has(x.orderId) && x.tripDropId !== null).length;
      const n = done.length;
      const tripsBit = fromTrips > 0 ? ` · ${fromTrips} from trip${fromTrips === 1 ? "" : "s"}` : "";
      const undo = { duration: 8_000, action: { label: "Undo", onClick: () => void undoHold(done) } };
      if (failed.length > 0) {
        toast.warning(
          `${n} held · ${failed.length} could not be held${tripsBit} — ${failed[0]?.error ?? "not valid at its current state"}`,
          undo,
        );
      } else {
        toast.success(`${n} bill${n === 1 ? "" : "s"} put on hold${tripsBit}`, undo);
      }
      // The failed ones stay ticked, so the planner can see which they were.
      setSelection(new Set(failed.map((f) => f.orderId).filter((id): id is number => typeof id === "number")));
      await load();
    },
    [load, undoHold],
  );

  // ── Hold tab: bulk release → the floor (reuses the Step-3 release route). ──
  // Each ticked bill gets the SAME chosen date+window; the route advances it to
  // pending_picking with dispatchStatus="dispatch", so it leaves Hold and lands
  // on the floor like any other released bill. A held-after-auto-dispatch bill is
  // already at pending_picking — accepted via FLOOR_RELEASABLE_STAGES. A bill
  // held while a picker had it (2026-10-01): pick_assigned → picker removed and
  // released fresh; pick_done / pick_checked → hold cleared only, slot ignored.
  // The server decides per bill; the toast says which (reportRelease).
  const holdRelease = useCallback(
    async (orderIds: number[], date: string, windowId: number) => {
      const releases = orderIds.map((orderId) => ({ orderId, dispatchTargetDate: date, dispatchWindowId: windowId }));
      const r = await postJson("/api/floor/release", { releases });
      reportRelease(r);
      await load();
    },
    [load],
  );

  // ── Cancel & CI tab: bulk restore of Cancel rows → back onto the board as
  // `no slot` rows (actions "restore"; a bill with a live CI is refused there). ──
  const cancelledRestore = useCallback(
    async (orderIds: number[]) => {
      const r = await postJson("/api/floor/actions", { action: "restore", orderIds });
      reportWrite("Restore", r);
      await load();
    },
    [load],
  );

  // ── Scope (client-side, from ONE unscoped fetch) ───────────────────────────
  // `data` holds the UNSCOPED board exactly as the server returned it. This memo
  // reproduces what the server used to return for the selected scope: the same
  // `inScope` predicate (lib/floor/scope.ts — literally the function that used
  // to live in queries.ts), plus the derived numbers re-derived in the SAME
  // order the server derives them (scope → drop `upcoming` → per-window counts →
  // total). Everything downstream reads `scopedData` and is otherwise untouched.
  //
  // The rail scopes too — getFloorRail applied the identical filter (design
  // §5.2: "the delivery-type scope applies to BOTH feeds").
  //
  // `pickers` is scope-independent and passes through unchanged.
  const scopedData = useMemo<BoardData | null>(() => {
    if (!data) return null;
    if (scope === "All") return data; // identity — skip the work entirely
    return {
      floor: scopeBoard(data.floor, scope),
      pickers: data.pickers,
    };
  }, [data, scope]);

  // ── Search + filter (client-side, design §5.2/§5.3) ─────────────────────────
  const parsed = useMemo(() => parseSearch(searchQuery), [searchQuery]);

  // Hold / Cancelled scoped the same way, BEFORE search/flags below — the same
  // order the server applied it (scope inside the row loop, search/flags here).
  const scopedHold = useMemo<FloorHoldRow[] | null>(
    () => (holdRows ? rowsInScope(holdRows, scope) : null),
    [holdRows, scope],
  );
  const scopedCancelled = useMemo<FloorCancelledRow[] | null>(
    () => (cancelledRows ? rowsInScope(cancelledRows, scope) : null),
    [cancelledRows, scope],
  );

  // Floor: search + Status/Flags filter. Rows re-derived and windows/total
  // recomputed so the slot tabs + Floor count reflect exactly what is shown.
  const filteredFloor = useMemo<FloorBoardResult | null>(() => {
    if (!scopedData) return null;
    const fRows = applyFloorFilters(applySearch(scopedData.floor.rows, parsed), filters);
    // ⚠ `total` IS THE FLOOR TAB'S BADGE, SO IT EXCLUDES THE TINT ROOM
    // (2026-09-14). Those rows are the Tinting tab's and are counted by
    // `tintingCount` below; leaving them in here was half the double-count bug
    // — the badge said 111 while the Floor table listed the same five bills the
    // Tinting tab was also listing. Same predicate as the table's own exclusion
    // in trip-desk.tsx, so the badge and the rows under it cannot disagree.
    //
    // ⚠ `rows` STAYS WHOLE. TripDesk splits it into the two tabs itself, and the
    // Tinting tab reads this array; filtering here would empty it.
    const due = fRows.filter((r) => r.zone !== "upcoming" && !isTintRoomRow(r));
    const windows = scopedData.floor.windows.map((w) => ({ ...w, count: due.filter((r) => r.windowId === w.id).length }));
    return { ...scopedData.floor, rows: fRows, windows, total: due.length };
  }, [scopedData, parsed, filters]);

  // The board after search + Status/Flags, but NOT scoped (2026-09-19). The
  // route cards read it for one thing: a club member whose route has no area
  // on the open tab (Kamrej on Local) — see components/floor/route-cards.tsx.
  // Same two filters as `filteredFloor`, so a Status chip narrows that line
  // exactly as it narrows every other.
  const clubReachRows = useMemo<FloorBoardRow[]>(
    () => (data ? applyFloorFilters(applySearch(data.floor.rows, parsed), filters) : []),
    [data, parsed, filters],
  );

  // Hold / Cancelled: search + Flags only (Status is a floor-only concept).
  const filteredHold = useMemo<FloorHoldRow[] | null>(
    () => (scopedHold ? applyFlagFilters(applySearch(scopedHold, parsed), filters) : null),
    [scopedHold, parsed, filters],
  );
  const filteredCancelled = useMemo<FloorCancelledRow[] | null>(
    () => (scopedCancelled ? applyFlagFilters(applySearch(scopedCancelled, parsed), filters) : null),
    [scopedCancelled, parsed, filters],
  );

  // The open tab's pool + report for the hits strip (chips / summary). Scoped,
  // so the hit counts describe the chip the operator is actually looking at.
  //
  // ⚠ BOTH ZONES (2026-09-10 b). This filtered upcoming rows out while they were
  // off screen; they are listed now, so a strip reporting fewer hits than the
  // auto-tick just selected would be describing a different board from the one
  // below it.
  //
  // 🔴 THE FLOOR TAB COUNTS THE POOL ONLY (owner, 2026-09-29). It counted every
  // scoped row, trip bills included, so an OBD on a trip read "1 bill matched"
  // over a pool that showed nothing. Pool = `isPoolRow`, the same test the pool
  // list and the auto-tick use. Bills on trips are reported as `elsewhere` and
  // get their own "on L-… ›" line (`tripSearchHits` below). The Tinting tab
  // counts the tint-room rows it lists.
  const searchableFloorRows = useMemo(
    () => (scopedData?.floor.rows ?? []).filter(topTab === "tinting" ? isTintRoomRow : isPoolRow),
    [scopedData, topTab],
  );
  const tripBillRows = useMemo(
    () => (topTab === "floor" ? (data?.floor.rows ?? []).filter((r) => r.tripDropId !== null) : []),
    [data, topTab],
  );
  const activePool: Searchable[] =
    topTab === "hold"
      ? scopedHold ?? []
      : topTab === "cancelled"
        ? cancelSearch?.rows ?? scopedCancelled ?? []
        : searchableFloorRows;
  const tabSearchReport = useMemo(
    () => searchReport(activePool, parsed, tripBillRows),
    [activePool, parsed, tripBillRows],
  );

  // ── Search → the trips holding the matched bills (owner, 2026-09-29) ──────
  // The rail narrows to these while the search is up; clearing the search
  // brings the full rail back and leaves whatever trip is open alone.
  const tripSearchHits = useMemo(
    () => (data ? tripHitsFor(data.floor.rows, trips ?? [], parsed) : []),
    [data, trips, parsed],
  );
  const searchTripIds = useMemo(
    () => (tripSearchHits.length > 0 ? new Set(tripSearchHits.map((h) => h.tripId)) : null),
    [tripSearchHits],
  );

  // ── The other-days lookup (owner, 2026-09-29) ─────────────────────────────
  // GET /api/floor/trips/lookup — for ONE full number the loaded desk did not
  // find, or that was searched before the board had loaded at all. State and
  // refs are declared above load() (`lookup`, `lookupSeq`, `pendingOpenRef`).
  //
  // The number a search committed BEFORE the board arrived (fix 2, 2026-09-29).
  // Its lookup runs at once; when the board lands, the effect below re-runs the
  // search if the number is on the loaded desk, so the local match wins and the
  // lookup (still in flight or already answered) is voided. Cleared by any new
  // search, a clear, or the lookup acting on its answer.
  const earlyLookupRawRef = useRef<string | null>(null);

  /** Open a trip the lookup found: on today's desk → the live desk; otherwise
   *  History on the trip's own date, with "Opening …" in the status line until
   *  that day has loaded (load() settles it). History stays read-only. */
  const openLookupTrip = useCallback(
    (t: LookupTrip) => {
      earlyLookupRawRef.current = null;
      pendingOpenRef.current = null;
      setTopTab("floor");
      if (t.onLiveDesk) {
        setLookup(null);
        setViewMode("live");
      } else if (t.tripDate < istTodayIso()) {
        pendingOpenRef.current = t;
        setLookup({ status: "opening", trip: t });
        const target = viewKeyOf("history", t.tripDate);
        const alreadyThere = viewKeyRef.current === target;
        // Moved NOW, not at the next render: a live load finishing in the gap
        // before that render must already read as stale, or it would land
        // today's board and settle the "Opening …" line against the wrong day.
        viewKeyRef.current = target;
        setHistDate(t.tripDate);
        setViewMode("history");
        // Already on that day → no view change, so no load would run and the
        // line would never settle. Load it explicitly.
        if (alreadyThere) void load();
      } else {
        // Dated after today and not on the desk — History cannot go forward.
        setLookup(null);
        toast.error(`${t.tripNumber} is dated ${t.tripDate} — it is not on today's desk yet.`);
        return;
      }
      selectRail({ kind: "trip", tripId: t.tripId });
    },
    [selectRail, load],
  );

  /**
   * Jump to the tab a search hit belongs on (2026-10-06, owner). A trip hit is
   * the 2026-09-29 lookup's jump, unchanged (live desk, or History on the
   * trip's day). Floor / Tinting / On hold are LIVE ONLY — the page leaves
   * History for them — and are checked against the loaded rows before the row
   * is lit (the `resolve` effect below). Cancel & CI reaches all history.
   */
  const goToHit = useCallback(
    (hit: FloorSearchHit) => {
      setCancelSearch(null);
      setLookup(null);
      if (hit.target === "trip") {
        const t = lookupTripOf(hit);
        if (t) openLookupTrip(t);
        setSearchFocus({ hit, phase: "highlight" });
        return;
      }
      if (hit.target === "cancel_ci") {
        setTopTab("cancelled");
        setSearchFocus({ hit, phase: "resolve" });
        return;
      }
      // Live only. Leaving History: the board on screen is that day's, so the
      // check must wait for the live one (`staleData`). viewKeyRef is moved now
      // for the same reason openLookupTrip moves it.
      let staleData: BoardData | null | undefined;
      if (viewKeyRef.current !== "live") {
        staleData = dataRef.current;
        viewKeyRef.current = "live";
        setViewMode("live");
      }
      setTopTab(hit.target === "hold" ? "hold" : hit.target === "tinting" ? "tinting" : "floor");
      setSearchFocus({ hit, phase: "resolve", staleData });
    },
    [openLookupTrip],
  );

  /**
   * GET /api/floor/search — for ONE full number (2026-10-06; replaced the trip
   * lookup's call here). One bill → jump to it, unless `navigate` is false (a
   * targeted add is open: jumping would end it, so the hit is offered as a
   * button instead). Several bills (a shared invoice) → listed, each a button.
   */
  const runSearch = useCallback(
    async (term: string, navigate: boolean) => {
      const seq = ++lookupSeq.current;
      setLookup({ term, status: "loading" });
      try {
        const res = await fetch(`/api/floor/search?q=${encodeURIComponent(term)}`, { cache: "no-store" });
        if (seq !== lookupSeq.current) return;
        if (!res.ok) {
          setLookup({ term, status: "error" });
          return;
        }
        const body = (await res.json()) as { hits?: FloorSearchHit[] };
        if (seq !== lookupSeq.current) return;
        const hits = body.hits ?? [];
        setLitIds(hits.map((h) => h.orderId));
        if (hits.length === 0) setLookup({ term, status: "none" });
        else if (hits.length === 1 && navigate) goToHit(hits[0]);
        else setLookup({ term, status: "many", hits });
      } catch {
        if (seq === lookupSeq.current) setLookup({ term, status: "error" });
      }
    },
    [goToHit],
  );

  const commitSearch = useCallback(
    (raw: string) => {
      setSearchQuery(raw);
      const p = parseSearch(raw);
      // Auto-tick (design §5.2) — ONLY on the Floor tab, and ONLY selectable rows
      // (Waiting / With picker, Step 5). A pasted number matching a Done or
      // Needs-check row is still found + shown, but never ticked.
      if (p.mode === "numbers" && topTab === "floor" && scopedData) {
        // Searched across BOTH zones (2026-09-10 b). Pasting an OBD that turns
        // out to be promised for Saturday should find it and tick it — that is
        // exactly the case a planner pulling work forward is searching for.
        // No eligibility filter (2026-09-10 d). A pasted OBD that turns out to
        // be a finished bill is exactly the one a planner is looking for when he
        // is building a load, and it used to be found and then not ticked.
        //
        // 🔴 ONLY ROWS THE PANE IS SHOWING (owner, 2026-09-18). This used to
        // tick every match on the board, so a pasted OBD for a bill already on
        // a trip was ticked in the pool where nobody could see it — and a
        // pressed button then acted on it. A bill ticked out of sight is how a
        // van leaves short. So:
        //   - the pool (or a targeted add, which shows the pool): pool rows
        //     only, by the pool's own test (`isPoolRow`, trip-desk.tsx);
        //   - an open trip: that trip's own bills only, read off the stops the
        //     panel renders (unscoped, as the panel is).
        let visible: FloorBoardRow[];
        if (railSelection.kind === "pool" || addingToTripId !== null) {
          visible = scopedData.floor.rows.filter(isPoolRow);
        } else if (tripDetail !== null && tripDetail.id === railSelection.tripId) {
          const onTrip = new Set(tripDetail.drops.flatMap((d) => d.orderIds));
          visible = (data?.floor.rows ?? []).filter((r) => onTrip.has(r.orderId));
        } else {
          visible = [];
        }
        const ids = applySearch(visible, p).map((r) => r.orderId);
        setSelection(new Set(ids));
      } else {
        setSelection(new Set());
      }

      // ── Trips (owner, 2026-09-29) ──────────────────────────────────────────
      // Any earlier lookup is void the moment a new search is committed.
      lookupSeq.current++;
      setLookup(null);
      setSearchFocus(null);
      setCancelSearch(null);
      setLitIds([]);
      earlyLookupRawRef.current = null;
      pendingOpenRef.current = null;
      if (p.mode === "none") return;
      // 🔴 THE LOOKUP DOES NOT WAIT FOR THE BOARD (fix 2, 2026-09-29). It used
      // to return here when `data` was null, so a number searched in the first
      // seconds after a page load (26 s on a slow link) was never looked up and
      // never retried. The lookup needs no board — ask now, and let the board,
      // when it lands, overrule it if the number is on the desk (effect below).
      if (!data) {
        const early = lookupTermOf(raw);
        if (early !== null) {
          earlyLookupRawRef.current = raw;
          void runSearch(early, addingToTripId === null);
        }
        return;
      }
      // ONE matched trip → open it, as a rail click would. Several → the rail
      // narrows (`searchTripIds`) and nothing opens.
      //
      // ⚠ NOT WHILE THE POOL ALSO MATCHES, AND NOT DURING A TARGETED ADD. A
      // pasted list is how a planner ticks pool bills for a load; if one of the
      // numbers is already on a trip, jumping into that trip would throw away
      // the ticks just made and end the add. The rail still narrows and the
      // "on L-… ›" line still offers the trip.
      const hits = tripHitsFor(data.floor.rows, trips ?? [], p);
      const poolHit = applySearch((scopedData?.floor.rows ?? []).filter(isPoolRow), p).length > 0;
      if (hits.length === 1 && !poolHit && addingToTripId === null && topTab === "floor") {
        selectRail({ kind: "trip", tripId: hits[0].tripId });
      }
      // ONE full number → ask the server where the bill is, ALWAYS (2026-10-06).
      // It used to ask only when the loaded desk found nothing, but On hold and
      // Cancel & CI may not be loaded at all under the live feed, and an old
      // cancel is never in the loaded list — so a local "0 hits" proved nothing.
      // The local filter above still runs first and instantly; the answer then
      // switches tab and lights the row.
      const term = lookupTermOf(raw);
      if (term !== null) void runSearch(term, addingToTripId === null);
    },
    [topTab, scopedData, data, trips, railSelection, addingToTripId, tripDetail, selectRail, runSearch],
  );
  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSelection(new Set());
    lookupSeq.current++;
    setLookup(null);
    setSearchFocus(null);
    setCancelSearch(null);
    setLitIds([]);
    earlyLookupRawRef.current = null;
    pendingOpenRef.current = null;
  }, []);

  // ── The board arrives after an early lookup (fix 2, 2026-09-29) ───────────
  // If the number is on the desk that just loaded, the LOCAL match wins: the
  // search is re-committed exactly as if it had been typed now, which voids
  // the lookup (in flight or already answered — `lookupSeq`) and runs the
  // normal narrowing / auto-open / auto-tick. Only one thing ever opens. Not on
  // the desk → nothing here; the early lookup carries on and acts on its own.
  useEffect(() => {
    const raw = earlyLookupRawRef.current;
    if (raw === null || !data) return;
    earlyLookupRawRef.current = null;
    if (applySearch(data.floor.rows, parseSearch(raw)).length > 0) commitSearch(raw);
  }, [data, commitSearch]);

  // ── A search jump, step 1: check the bill against the loaded rows ─────────
  // (2026-10-06.) Waits until the target tab's rows exist (On hold and Cancel &
  // CI load lazily under the live feed; the live board after leaving History),
  // then decides where the row actually is NOW:
  //   On hold   — in the Hold rows → light it; else "No longer on hold — now: …".
  //   Floor /
  //   Tinting   — found on the live board → the tab its row really belongs on
  //               (isTintRoomRow, the tabs' own split), the pool or its trip on
  //               the rail; else "No longer tinting / Not on the live board".
  //   Cancel&CI — in today's list → light it there; otherwise the server's own
  //               row (any date) under the "Search result" banner.
  // A scope chip or a Flags filter hiding the row is cleared, so the row the
  // planner asked for is never lit somewhere he cannot see.
  useEffect(() => {
    const f = searchFocus;
    if (f === null || f.phase !== "resolve") return;
    const { hit } = f;
    const id = hit.orderId;
    const moved = (what: string) => {
      setSearchFocus(null);
      setLookup({ status: "moved", message: `${hit.obdNumber} — ${what} — now: ${stageWords(hit)}` });
    };
    const light = () => setSearchFocus({ hit, phase: "highlight" });

    if (hit.target === "cancel_ci") {
      if (cancelledRows === null) return; // still loading (lazy tab / first load)
      const today = cancelledRows.find((r) => r.orderId === id);
      if (today) {
        if (rowsInScope([today], scope).length === 0) setScope("All");
        if (applyFlagFilters([today], filters).length === 0) setFilters(EMPTY_FILTERS);
        light();
        return;
      }
      if (hit.cancelRow === null) {
        moved("no Cancel & CI record found");
        return;
      }
      const at = hit.cancelRow.at;
      const label = at
        ? new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })
        : "date unknown";
      setCancelSearch({ rows: [hit.cancelRow], label });
      light();
      return;
    }

    if (hit.target === "hold") {
      if (holdRows === null) return;
      const row = holdRows.find((r) => r.orderId === id);
      if (!row) {
        moved("no longer on hold");
        return;
      }
      if (rowsInScope([row], scope).length === 0) setScope("All");
      if (applyFlagFilters([row], filters).length === 0) setFilters(EMPTY_FILTERS);
      light();
      return;
    }

    // floor / tinting — the LIVE board, and a board newer than the one on
    // screen when the jump left History.
    if (viewMode !== "live" || loading || !data || (f.staleData !== undefined && data === f.staleData)) return;
    const row = data.floor.rows.find((r) => r.orderId === id);
    if (!row) {
      moved(hit.target === "tinting" ? "no longer tinting" : "not on the live board");
      return;
    }
    if (row.tripDropId !== null && row.tripNumber) {
      const t = findTripByNumber(trips ?? [], row.tripNumber);
      setTopTab("floor");
      if (t) selectRail({ kind: "trip", tripId: t.id });
    } else {
      const tab: TopTab = isTintRoomRow(row) ? "tinting" : "floor";
      setTopTab(tab);
      // The pool is where a no-trip row is listed — not during a targeted add,
      // which already shows the pool and must not be ended by a jump.
      if (tab === "floor" && railSelection.kind !== "pool" && addingToTripId === null) selectRail({ kind: "pool" });
    }
    if (rowsInScope([row], scope).length === 0) setScope("All");
    if (applyFloorFilters([row], filters).length === 0) setFilters(EMPTY_FILTERS);
    light();
  }, [searchFocus, cancelledRows, holdRows, data, loading, viewMode, trips, scope, filters, railSelection, addingToTripId, selectRail]);

  // ── A search jump, step 2: scroll to the row ──────────────────────────────
  // The row is found in the DOM by `data-order-id` (floor-table / hold-table /
  // cancelled-tab rows carry it), retried while the tab, the trip's stops or a
  // History day finish loading, then scrolled to the middle once. The MARK is
  // the effect below, not this one.
  useEffect(() => {
    const f = searchFocus;
    if (f === null || f.phase !== "highlight") return;
    const sel = `[data-order-id="${f.hit.orderId}"]`;
    let tries = 0;
    const poll = setInterval(() => {
      tries++;
      const el = Array.from(document.querySelectorAll<HTMLElement>(sel)).find((x) => x.offsetParent !== null);
      if (el) {
        clearInterval(poll);
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } else if (tries >= 60) {
        clearInterval(poll); // ~30 s — a History day on a slow link; then give up quietly
      }
    }, 500);
    return () => clearInterval(poll);
  }, [searchFocus]);

  // ── The amber search mark — every row of every bill the search named ──────
  // `data-search-hit="on"` on each row carrying one of `litIds` (styled by
  // SEARCH_HIT_ROW_CLS, floor-table.tsx — amber `warn` tokens). PERSISTENT: no
  // fade. Re-applied every 700 ms because a row React unmounts and remounts (a
  // tab switch, a trip opened, a live refresh, a History day loading) comes back
  // without it; the attribute is not React's, so a plain re-render never strips
  // it. Removed from every row the moment `litIds` changes or empties (Clear
  // search, a new search, another bill's panel — see `litIds`).
  useEffect(() => {
    if (litIds.length === 0) return;
    const sel = litIds.map((id) => `[data-order-id="${id}"]`).join(",");
    const apply = () => {
      document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
        if (el.getAttribute("data-search-hit") !== "on") el.setAttribute("data-search-hit", "on");
      });
    };
    apply();
    const keep = setInterval(apply, 700);
    return () => {
      clearInterval(keep);
      document.querySelectorAll<HTMLElement>(sel).forEach((el) => el.removeAttribute("data-search-hit"));
    };
  }, [litIds]);

  // ── Detail panel (design §10) — open state + single-bill action handlers ──
  // Additive wiring only: the panel is mounted at the end; every write REUSES an
  // existing route through reportWrite (no swallowed response, no new route).
  const [detail, setDetail] = useState<{ orderId: number; source: FloorDetailSource } | null>(null);
  // Opening (or paging to) a bill the last search did NOT name ends the amber
  // search mark (2026-10-06) — the planner has moved on to another bill.
  const dropLitUnless = useCallback(
    (orderId: number) => setLitIds((cur) => (cur.length > 0 && !cur.includes(orderId) ? [] : cur)),
    [],
  );
  const openDetail = useCallback(
    (orderId: number, src: FloorDetailSource) => {
      setDetail({ orderId, source: src });
      dropLitUnless(orderId);
    },
    [dropLitUnless],
  );
  const closeDetail = useCallback(() => setDetail(null), []);
  const navigateDetail = useCallback(
    (orderId: number) => {
      setDetail((d) => (d ? { ...d, orderId } : d));
      dropLitUnless(orderId);
    },
    [dropLitUnless],
  );

  // The list Prev/Next walks — whichever source the panel was opened from
  // (design §10.5). Rebuilt on every board reload so it tracks the live order.
  // Prev/Next walks the VISIBLE (searched/filtered) list of the source surface,
  // except the rail which is never filtered (design §6.1).
  const detailList = useMemo<number[]>(() => {
    if (!detail) return [];
    switch (detail.source) {
      // ⚠ NO "rail" CASE SINCE 2026-09-13. The decision rail stopped rendering on
      // 2026-09-10 and its feed was removed today, so `openDetail(id, "rail")`
      // has no caller and this arm had no list to walk. The union member stays on
      // FloorDetailSource — detail-panel.tsx still branches on it for the
      // release affordance, and narrowing the union is a separate decision.
      // Both floor sources walk the SAME list, and that is already the right
      // one for either: `filteredFloor` is derived from `scopedData.floor.rows`,
      // which IS the history payload in history mode. So Prev/Next steps
      // through the viewed day's rows and can never reach a live row — the two
      // never coexist in one payload.
      case "history":
        // A Cancel & CI search result opens read-only (2026-10-06) — its pager
        // walks the search rows, never the board.
        if (cancelSearch?.rows.some((r) => r.orderId === detail.orderId)) {
          return cancelSearch.rows.map((r) => r.orderId);
        }
        return (filteredFloor?.rows ?? []).map((r) => r.orderId);
      case "floor":
        // Every row the desk lists, upcoming included (2026-09-10 b). The pager
        // must not be stricter than a tap: an upcoming row is openable from the
        // list, so Prev/Next has to be able to reach it and leave it.
        return (filteredFloor?.rows ?? []).map((r) => r.orderId);
      case "hold":
        return (filteredHold ?? []).map((r) => r.orderId);
      case "cancelled":
        return (filteredCancelled ?? []).map((r) => r.orderId);
      // "rail" — no list. Its feed and its only opener are gone (above); the
      // pager simply has nothing to walk, which is the honest answer.
      default:
        return [];
    }
  }, [detail, filteredFloor, filteredHold, filteredCancelled, cancelSearch]);

  // Duplicate-SO flag for the OPEN bill, taken from the row that is ALREADY
  // loaded — no second fetch and no new field on /api/floor/order/[orderId],
  // which would be a second source of truth for one fact.
  //
  // ⚠ Keyed on `detail.orderId`, NOT captured at click time: Prev/Next walks
  // the panel to another bill (navigateDetail) without re-opening it, so a
  // value frozen on open would describe the wrong bill from the second one on.
  //
  // Deliberately the UNSCOPED `data`, matching onReassign's reasoning below:
  // "does this bill have a twin" is a property of the bill, not of the chip in
  // view. Hold and Cancelled rows are not flagged at all (their feeds do not
  // carry the field), so a panel opened from those tabs resolves to false —
  // the known gap, not a bug.
  // Hand — read off whichever loaded row the panel was opened from (board,
  // Hold or Cancel & CI all carry `isHand`), like detailHasDuplicateSo below.
  const detailIsHand = useMemo(() => {
    if (!detail) return false;
    const id = detail.orderId;
    return (
      (data?.floor.rows ?? []).find((r) => r.orderId === id)?.isHand ??
      (holdRows ?? []).find((r) => r.orderId === id)?.isHand ??
      (cancelledRows ?? []).find((r) => r.orderId === id)?.isHand ??
      (cancelSearch?.rows ?? []).find((r) => r.orderId === id)?.isHand ??
      false
    );
  }, [detail, data, holdRows, cancelledRows, cancelSearch]);

  const detailHasDuplicateSo = useMemo(() => {
    if (!detail) return false;
    // The rail lookup that used to sit here went with the rail feed (2026-09-13);
    // it always missed and fell through to the board rows anyway.
    return (data?.floor.rows ?? []).find((r) => r.orderId === detail.orderId)?.hasDuplicateSo ?? false;
  }, [detail, data]);

  // ── The Cancel / Raise CI form (2026-09-22, off-floor-dialog.tsx) ─────────
  //
  // One form, three openers — the Floor bar, the Hold bar and the detail panel.
  // Each hands in its bills and what "applied" means for ITS selection: the
  // Floor bar keeps only the not-done bills ticked, the Hold tab does the same
  // with its own local ticks, and the panel closes once its bill has gone.
  const [offFloor, setOffFloor] = useState<{
    bills: OffFloorFormBill[];
    onApplied: (doneIds: number[], notDoneIds: number[]) => void;
  } | null>(null);
  // Esc must not close the form while a request is in flight — the result
  // would land on a closed form and the planner would never see it.
  const offFloorBusyRef = useRef(false);
  // The CI reasons — fetched ONCE, when the form first opens, and kept for the
  // session. A failed fetch is retried on the next open.
  const [ciReasons, setCiReasons] = useState<CiReasonOption[] | null>(null);
  const [ciReasonsError, setCiReasonsError] = useState<string | null>(null);
  const ciReasonsAsked = useRef(false);
  const loadCiReasons = useCallback(async () => {
    if (ciReasonsAsked.current) return;
    ciReasonsAsked.current = true;
    try {
      // Floor's own GET, not /api/ci/reasons — the desk users hold no `ci` ticks.
      const res = await fetch("/api/floor/ci", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { reasons?: CiReasonOption[]; error?: string };
      if (!res.ok || !Array.isArray(body.reasons)) {
        ciReasonsAsked.current = false;
        setCiReasonsError(`Could not load the CI reasons — ${body.error ?? `HTTP ${res.status}`}`);
        return;
      }
      setCiReasonsError(null);
      setCiReasons(body.reasons);
    } catch {
      ciReasonsAsked.current = false;
      setCiReasonsError("Could not load the CI reasons — check your connection.");
    }
  }, []);
  const openOffFloor = useCallback(
    (bills: OffFloorFormBill[], onApplied: (doneIds: number[], notDoneIds: number[]) => void) => {
      if (bills.length === 0) return;
      setMoreOpen(false);
      setHoldMoreOpen(false);
      setOffFloor({ bills, onApplied });
      void loadCiReasons();
    },
    [loadCiReasons],
  );
  /** Esc's close — refused mid-request. */
  const closeOffFloor = useCallback(() => {
    if (offFloorBusyRef.current) return;
    setOffFloor(null);
  }, []);
  const setOffFloorBusy = useCallback((b: boolean) => {
    offFloorBusyRef.current = b;
  }, []);

  // ── RE-DELIVERY dialog + info modal (2026-10-03, plan rev 5 §4.1/§4.2) ─────
  // Both are closed by THIS page's one Esc listener (FLOOR §4.6), never their own.
  const [redeliveryTripId, setRedeliveryTripId] = useState<number | null>(null);
  const redeliveryBusyRef = useRef(false);
  const closeRedeliveryDialog = useCallback(() => {
    if (redeliveryBusyRef.current) return; // mid-request — refused, like the off-floor form
    setRedeliveryTripId(null);
  }, []);
  const setRedeliveryBusy = useCallback((b: boolean) => {
    redeliveryBusyRef.current = b;
  }, []);
  const [redeliveryInfoId, setRedeliveryInfoId] = useState<number | null>(null);
  const closeRedeliveryInfo = useCallback(() => setRedeliveryInfoId(null), []);

  // A Cancel & CI tab row that is a CI (2026-09-22): its panel shows no
  // Restore — the return is with billing, and the actions route refuses it.
  // Read off the row already loaded, like detailHasDuplicateSo above.
  const detailCiNumber = useMemo(() => {
    if (!detail || detail.source !== "cancelled") return null;
    const r = (cancelledRows ?? []).find((x) => x.orderId === detail.orderId);
    return r?.action === "ci" ? r.ciNumber ?? "a CI" : null;
  }, [detail, cancelledRows]);

  const detailActions: DetailActions = useMemo(
    () => ({
      onRelease: async (orderId, date, windowId) => {
        const r = await postJson("/api/floor/release", { releases: [{ orderId, dispatchTargetDate: date, dispatchWindowId: windowId }] });
        reportRelease(r);
        await load();
      },
      // Ship-to change → Floor's OWN thin route (step 2/8 of the Support
      // retirement). One job, sequential awaits, no $transaction, and an
      // unchanged value writes nothing so the live-sync marker stays honest.
      onChangeShipTo: async (orderId, customerId) => {
        const r = await postJson("/api/floor/ship-to", { orderId, customerId });
        reportWrite("Change ship-to", r);
        await load();
      },
      onUpdateSlot: async (orderId, date, windowId) => {
        const r = await postJson("/api/floor/actions", { action: "change-slot", orderIds: [orderId], dispatchTargetDate: date, dispatchWindowId: windowId });
        reportWrite("Update slot", r);
        await load();
      },
      // Reassign = unassign (only if the bill already has a picker) then assign,
      // reusing the Picking endpoints. The current assignment is read from the
      // live floor rows so a Waiting bill isn't sent a spurious unassign (409).
      onReassign: async (orderId, pickerId) => {
        // Deliberately the UNSCOPED rows: "does this bill already have a picker"
        // is a property of the bill, not of the chip in view. Only in-scope rows
        // are reachable here (the panel opens from a scoped list), so the result
        // is identical either way — the wider set just cannot miss.
        const row = (data?.floor.rows ?? []).find((x) => x.orderId === orderId);
        if (row?.isAssigned) {
          reportWrite("Unassign", await postJson("/api/picking/unassign", { orderId }));
        }
        reportWrite("Assign", await postJson("/api/picking/assign", { orderIds: [orderId], pickerId }));
        await load();
      },
      onRestore: async (orderId) => {
        reportWrite("Restore", await postJson("/api/floor/actions", { action: "restore", orderIds: [orderId] }));
        await load();
      },
      onHold: async (orderId) => {
        reportWrite("Hold", await postJson("/api/floor/actions", { action: "hold", orderIds: [orderId] }));
        await load();
      },
      // ⋯ Cancel → the SAME Cancel / Raise CI form, on this one bill (2026-09-22).
      // No direct cancel call any more: every cancel from the floor now carries
      // a reason. The bill is described from the loaded board row (pre-checked)
      // or the Hold row; the panel closes once the bill has gone.
      onCancel: async (orderId) => {
        const row = (data?.floor.rows ?? []).find((x) => x.orderId === orderId);
        const held = (holdRows ?? []).find((x) => x.orderId === orderId);
        const bill: OffFloorFormBill = row
          ? boardRowToOffFloorBill(row)
          : held
            ? holdRowToOffFloorBill(held)
            : { orderId, obdNumber: `#${orderId}`, dealerName: null, litres: null, refusal: null };
        openOffFloor([bill], (doneIds) => {
          if (doneIds.includes(orderId)) closeDetail();
        });
      },
      onUnassign: async (orderId) => {
        reportWrite("Unassign", await postJson("/api/picking/unassign", { orderId }));
        await load();
      },
      // HAND — the dealer collects (2026-09-24). A repeat press writes nothing
      // on the server and comes back in `skipped`; say so rather than stay quiet.
      onHand: async (orderId, set) => {
        const label = set ? "Mark Hand" : "Clear Hand";
        const r = await postJson("/api/floor/actions", { action: set ? "hand" : "unhand", orderIds: [orderId] });
        if (reportWrite(label, r)) {
          if ((r.body.skipped ?? []).length > 0) toast(set ? "Already marked Hand — nothing changed." : "Not marked Hand — nothing changed.");
          else toast.success(set ? "Marked Hand — the dealer collects." : "Hand cleared.");
        }
        await load();
      },
    }),
    [load, data, holdRows, openOffFloor, closeDetail],
  );

  // ── History navigation ────────────────────────────────────────────────────
  const enterHistory = useCallback(() => {
    setHistDate(addDaysIso(istTodayIso(), -1));
    setViewMode("history");
  }, []);
  const exitHistory = useCallback(() => setViewMode("live"), []);
  const stepHistory = useCallback((delta: number) => {
    setHistDate((cur) => {
      if (!cur) return cur;
      const next = addDaysIso(cur, delta);
      const yesterday = addDaysIso(istTodayIso(), -1);
      if (delta > 0 && next > yesterday) return cur;
      return next;
    });
  }, []);

  // ── Live sync (design §13) — TWO different mechanisms, no shared abstraction ─
  const detailOpen = detail !== null;
  const offFloorOpen = offFloor !== null;
  const isLive = viewMode === "live";

  // Single Esc owner — lifted out of detail-panel so exactly ONE action fires per
  // press and only ONE listener exists: panel open → close it (selection kept);
  // else the bar's ··· More menu open → close it; else an open By route card →
  // back to the cards; else a live selection →
  // clear it; else the add band → end it; else nothing. The Cancel / Raise CI
  // form, when open, comes before all of them. Ignored while focus is in a
  // field / native control so Esc never wipes a selection mid-type (ship-to
  // search, far-date box, picker dropdown).
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // The RE-DELIVERY dialog and info modal (2026-10-03) — the top layer, and
      // checked BEFORE the field guard below: the dialog opens with focus in its
      // number box, and Esc must still close it from there. One layer per press.
      if (redeliveryInfoId !== null) {
        closeRedeliveryInfo();
        return;
      }
      if (redeliveryTripId !== null) {
        closeRedeliveryDialog();
        return;
      }
      // A DispatchSlotPicker popover is open (its portalled root carries this
      // marker only while open) — leave it to outside-click, as today.
      if (document.querySelector('[data-slot-popover="open"]')) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      // The Cancel / Raise CI form (2026-09-22) — FIRST, above the panel: it
      // can be opened FROM the panel, and one Esc must close only the top
      // layer. Refused mid-request (closeOffFloor).
      if (offFloorOpen) closeOffFloor();
      else if (detailOpen) closeDetail();
      // The bars' ··· More menus (2026-09-22) — closed first, so the next Esc
      // clears the selection and one press never does both.
      else if (moreOpen || holdMoreOpen) {
        setMoreOpen(false);
        setHoldMoreOpen(false);
      }
      // An open By route card → back to the card grid (2026-09-24), BEFORE the
      // selection: the chip row says "Esc to go back to cards", and the ticks
      // survive it — the next Esc clears them as before.
      else if (openRouteCard !== null) setOpenRouteCard(null);
      else if (selection.size > 0) clearSelection();
      // Then the add band — the same thing Done does. A live selection is
      // cleared first, so one Esc never both empties the ticks and closes the
      // band the planner is still working in.
      else if (addingToTripId !== null) stopAddingTo();
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [offFloorOpen, closeOffFloor, detailOpen, moreOpen, holdMoreOpen, openRouteCard, selection, closeDetail, clearSelection, addingToTripId, stopAddingTo, redeliveryInfoId, redeliveryTripId, closeRedeliveryInfo, closeRedeliveryDialog]);

  // Reconcile the floor SELECTION against fresh data WITHOUT moving the visible
  // board (design §13 rules 2 + 3): drop the tick on any selected row that
  // changed elsewhere and say so, but never re-render/re-sort the rows he is
  // reaching for. A read-only GET — no orders.update anywhere.
  const reconcileSelection = useCallback(async () => {
    try {
      // Unscoped, like every other board fetch. This only ever ASKS "is each
      // already-selected id still selectable?", and a selection can only hold
      // in-scope ids — so the wider set answers the same question and can never
      // untick a bill merely because the chip changed.
      const res = await fetch(`/api/floor/board?${UNSCOPED_QS}`, { cache: "no-store" });
      if (!res.ok) return;
      const board = await res.json();
      // 🔴 NO ELIGIBILITY TERM AT ALL. The only honest question this reconcile
      // can ask is "is the ticked bill still on the board", and that is now the
      // only one it asks.
      //
      // It has been narrowed twice and both narrowings were wrong. It read
      // `r.zone !== "upcoming" && isSelectable(r)`: the zone term unticked every
      // upcoming bill once those came back on screen (fixed 2026-09-10 b), and
      // `isSelectable` — Waiting or With-picker only — would untick every
      // finished bill the moment the marker fired, silently undoing the selection
      // a planner had just made (2026-09-10 d). A reconcile that drops ticks the
      // UI allows is worse than none: it is unexplainable from the screen.
      const stillSelectable = new Set<number>(
        (board.floor?.rows ?? []).map((r: FloorBoardRow) => r.orderId),
      );
      setSelection((prev) => {
        const next: FloorDeskSelection = new Set();
        let dropped = 0;
        for (const id of Array.from(prev)) {
          // A ticked RE-DELIVERY (`rd:` key) is not a board row and is never
          // judged here — the trip detail decides whether it still exists.
          if (isRdKey(id) || stillSelectable.has(id)) next.add(id);
          else dropped++;
        }
        if (dropped > 0) {
          toast.info(`${dropped} selected bill${dropped === 1 ? "" : "s"} changed elsewhere — unticked`);
          return next;
        }
        return prev;
      });
      setLastSyncedAt(new Date());
    } catch {
      /* silent — the connection strip owns the "not connected" surface */
    }
    // No `scope` dep — the request is unscoped and the answer is scope-independent.
  }, []);

  // The TRIPS feed alone (2026-09-22) — for the marker's ticked-bills path
  // below. While bills are ticked the board rows must not move under the
  // planner's hand, so the marker only reconciles the ticks; but the rail's
  // cards and bars describe TRUCKS, not the rows being ticked, and without this
  // they froze for as long as a selection was up — a picker marking a bill done
  // never reached the rail. Live mode only (the marker is paused in History),
  // so the day is today. A failure keeps the rail as it is: this is a refresh,
  // and blanking the rail mid-selection would be worse than a stale one.
  const refreshTrips = useCallback(async () => {
    try {
      const res = await fetch(`/api/floor/trips?date=${istTodayIso()}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { trips?: TripSummary[]; placeholderRoutes?: string[] };
      // TODAY's trips — dropped if the page left the live desk while this was
      // in flight (a History jump), the same rule as load()'s stale guard.
      if (viewKeyRef.current !== "live") return;
      setTrips(body.trips ?? []);
      setPlaceholderRoutes(new Set(body.placeholderRoutes ?? []));
    } catch {
      /* silent — the next marker change or the 30 s poll tries again */
    }
  }, []);

  // FLOOR — the Picking pattern: use-picking-marker, pointed at the floor's OWN
  // marker (/api/floor/marker) via the optional `url` param, so it watches the
  // floor's EXACT set (getFloorLiveMarkerWhere) — no silent dependence on what
  // picking's openPending scope means. `scope` is required by the hook's type but
  // ignored by the floor marker route (fixed set). `onProbe` feeds the connection
  // strip off this same 15s poll — one probe powers both. Deferred while the
  // detail panel is open or in read-only history.
  //
  // ⚠ LIVE FEED 7b: the two hooks moved, unchanged, into <LegacyFloorSync> at
  // the foot of this file, which is rendered only while the feed is NOT live
  // (`legacySyncMounted`). Their arguments are built here, word for word as
  // they were written inline.
  const legacyMarkerOnChange = () => {
    if (!isLive) return;
    // Rule 2: never move the ground while rows are selected — reconcile the
    // ticks only. Rule 1: otherwise refresh in place (rows keyed by orderId).
    // With ticks up: reconcile the ticks AND refresh the trips feed (rail
    // cards and bars), never the board rows.
    if (selection.size > 0) {
      void reconcileSelection();
      void refreshTrips();
    } else void load();
  };

  // RAIL — the Mail Orders pattern: a 30s full refetch. Paused while a selection
  // is up or the panel is open (a refetch would move the floor ground) or history.
  //
  // ⚠ A TICK DOES NOT SUPERSEDE A LOAD IN FLIGHT (2026-09-29). With the
  // stale-answer guard, a newer load voids the older one; a timed refresh
  // starting over one that is still running would, on a link where a load
  // outlasts the gap between ticks, void every load and never show one. The
  // running load is already fresh. The MARKER still always reloads — it has
  // seen a real change, and a load started before the change may miss it.
  const legacyRailOnTick = () => {
    if (!loadInFlightRef.current) void load();
  };

  // Off, fallback (repeated feed errors), or not known yet on a browser that
  // never saw the feed on → the old hooks run. Live → they are not mounted.
  const legacySyncMounted =
    feed.mode === "off" || feed.mode === "fallback" || (feed.mode === "unknown" && !liveHintRef.current);

  // ── LIVE FEED 7b — applying changes ────────────────────────────────────────
  // The feed (useLiveFeed) only COLLECTS changed ids; this is where they land.
  // "Never move the ground under a hand": nothing is applied while the panel,
  // a form, a menu or a write is open, while typing, or in History — the glance
  // keeps running and only applying waits (`hardPaused`). While bills are
  // ticked or a targeted add is on (`rowsPaused`), trips still refresh (the
  // rail describes trucks, not the rows being ticked — same rule as the old
  // marker path) and ticked bills that left the board are unticked, but no
  // board row moves.
  const hardPaused =
    !isLive ||
    detailOpen ||
    offFloorOpen ||
    tripFormSeed !== null ||
    editingTripId !== null ||
    moreOpen ||
    holdMoreOpen ||
    tripBusyId !== null ||
    tripBarBusy;
  const rowsPaused = selection.size > 0 || addingToTripId !== null;
  const hardPausedRef = useRef(hardPaused);
  hardPausedRef.current = hardPaused;
  const rowsPausedRef = useRef(rowsPaused);
  rowsPausedRef.current = rowsPaused;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const flushingRef = useRef(false);
  const tripsForbiddenRef = useRef(false);
  const midnightPendingRef = useRef(false);
  const patchSeqRef = useRef(0);
  const patchFailuresRef = useRef(0);
  const lastRecoverLoadRef = useRef(0);
  const tickCheckedRef = useRef<Set<number>>(new Set());

  const refreshCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/floor/counts", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { enabled?: boolean } & Partial<TabCounts>;
      if (body.enabled === false) return feed.controller.current?.noteDisabled();
      if (body.hold && body.cancelled) setTabCounts({ hold: body.hold, cancelled: body.cancelled });
    } catch {
      /* the labels keep their last numbers */
    }
  }, [feed.controller]);

  // The pick gate lives in app_settings, so a flip made elsewhere arrives as a
  // `config` change — re-read it alongside that full load (live feed only).
  const readGate = useCallback(async () => {
    try {
      const res = await fetch("/api/floor/pick-gate", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { enabled?: boolean };
      if (typeof body.enabled === "boolean") setGateEnabled(body.enabled);
    } catch {
      /* unchanged */
    }
  }, []);

  // GET /api/floor/trips?ids= (floor canEdit, like the trips list). A viewer
  // never asks (the desk has no trips for them today); a 403 stops asking for
  // the rest of the session — no error loop. Any other failure is silent: the
  // next full load corrects the rail.
  const refreshTripsByIds = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0 || !canEdit || tripsForbiddenRef.current) return;
      for (const part of chunk(ids, MAX_PATCH_IDS)) {
        try {
          const res = await fetch(`/api/floor/trips?date=${istTodayIso()}&ids=${part.join(",")}`, { cache: "no-store" });
          if (res.status === 403) {
            tripsForbiddenRef.current = true;
            liveLog("floor", "trips by id: 403 — not asking again this session");
            return;
          }
          if (!res.ok) {
            liveLog("floor", `trips by id: HTTP ${res.status}`);
            return;
          }
          const body = (await res.json()) as { enabled?: boolean; trips?: TripSummary[]; gone?: number[] };
          if (body.enabled === false) return feed.controller.current?.noteDisabled();
          if (viewKeyRef.current !== "live") return;
          setTrips((prev) => (prev === null ? prev : mergeTrips(prev, body.trips ?? [], body.gone ?? [])));
          liveLog("floor", "trips patched", { ids: part, gone: body.gone ?? [] });
        } catch {
          return;
        }
      }
    },
    [canEdit, feed.controller],
  );

  type RowsAnswer = {
    enabled?: boolean;
    date?: string;
    rows?: FloorRowPatchIn[];
    soFlags?: Record<string, boolean>;
    tripIds?: number[];
    pickers?: FloorPicker[];
  };
  const postRows = useCallback(async (ids: number[]): Promise<RowsAnswer> => {
    const res = await fetch("/api/floor/rows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`rows HTTP ${res.status}`);
    return (await res.json()) as RowsAnswer;
  }, []);

  // Ticked bills that changed elsewhere and LEFT the board are unticked (the
  // old reconcileSelection's rule, by id instead of a whole board read).
  const checkTickedBills = useCallback(async () => {
    const ctl = feed.controller.current;
    if (!ctl) return;
    const sel = selectionRef.current;
    const ids = ctl.pendingSnapshot().orders.filter((id) => sel.has(id) && !tickCheckedRef.current.has(id));
    if (ids.length === 0) return;
    for (const id of ids) tickCheckedRef.current.add(id);
    const body = await postRows(ids.slice(0, MAX_PATCH_IDS));
    if (body.enabled === false) return ctl.noteDisabled();
    const left = new Set((body.rows ?? []).filter((r) => r.tab !== "board").map((r) => r.id));
    if (left.size === 0) return;
    setSelection((prev) => {
      const next: FloorDeskSelection = new Set();
      let dropped = 0;
      for (const id of Array.from(prev)) {
        // `rd:` keys are never board rows — kept as they are.
        if (!isRdKey(id) && left.has(id)) dropped++;
        else next.add(id);
      }
      if (dropped === 0) return prev;
      toast.info(`${dropped} selected bill${dropped === 1 ? "" : "s"} changed elsewhere — unticked`);
      return next;
    });
  }, [feed.controller, postRows]);

  const applyPatch = useCallback(
    async (work: Extract<Work, { kind: "patch" }>, ordersPaused: boolean) => {
      const ctl = feed.controller.current;
      const cur = dataRef.current;
      if (!ctl || !cur) return; // no board yet — flush's recovery load covers it
      if (ordersPaused) {
        // Trips only. The board bills that SHOW those trips wait in the queue.
        ctl.requeue(boardIdsOnTrips(cur.floor.rows, work.tripIds, tripsRef.current), []);
        await refreshTripsByIds(work.tripIds);
        return;
      }
      // A trip that changed with no bill changing (show, send to billing,
      // vehicle, rename) still changes what its bills' rows show.
      const ids = Array.from(new Set([...work.orderIds, ...boardIdsOnTrips(cur.floor.rows, work.tripIds, tripsRef.current)]));
      if (ids.length > MAX_PATCH_IDS) {
        liveLog("floor", `${ids.length} ids — full load instead`);
        void load();
        return;
      }
      const seq0 = loadSeq.current;
      const patches: FloorRowPatchIn[] = [];
      const soFlags: Record<string, boolean> = {};
      const nowTripIds: number[] = [];
      let pickers: FloorPicker[] | null = null;
      let date: string | null = null;
      if (ids.length > 0) {
        for (const part of chunk(ids, MAX_PATCH_IDS)) {
          const body = await postRows(part);
          if (body.enabled === false) return ctl.noteDisabled();
          patches.push(...(body.rows ?? []));
          Object.assign(soFlags, body.soFlags ?? {});
          nowTripIds.push(...(body.tripIds ?? []));
          pickers = body.pickers ?? pickers;
          date = body.date ?? date;
        }
      }
      // A full load started meanwhile began AFTER these ids were taken — it
      // covers them. Anything opened mid-fetch → apply later, never under a hand.
      if (loadSeq.current !== seq0 || viewKeyRef.current !== "live") return;
      if (loadInFlightRef.current || hardPausedRef.current || rowsPausedRef.current) {
        ctl.requeue(work.orderIds, work.tripIds);
        return;
      }
      const before = dataRef.current;
      if (!before) return;
      if (date !== null && isDateMismatch(before.floor.date, date)) {
        liveLog("floor", `rows are for ${date}, board is ${before.floor.date} — full load`);
        void load();
        return;
      }
      if (patches.length > 0) {
        const onBoardBefore = new Set(before.floor.rows.map((r) => r.orderId));
        const m = mergeFloorRows(
          { board: before.floor.rows, hold: holdRowsRef.current, cancelled: cancelledRowsRef.current },
          patches,
          soFlags,
        );
        const next: BoardData = { floor: withBoardRows(before.floor, m.lists.board), pickers: pickers ?? before.pickers };
        dataRef.current = next;
        setData(next);
        if (holdRowsRef.current !== null) {
          holdRowsRef.current = m.lists.hold;
          setHoldRows(m.lists.hold);
        }
        if (cancelledRowsRef.current !== null) {
          cancelledRowsRef.current = m.lists.cancelled;
          setCancelledRows(m.lists.cancelled);
        }
        patchSeqRef.current++;
        setLastSyncedAt(new Date());
        liveLog("floor", "rows patched", {
          ids,
          tabs: patches.map((p) => `${p.id}→${p.tab ?? "gone"}`),
          touched: Array.from(m.tabsTouched),
        });
        // A lazy tab's label: refresh when a bill went to it, or came from a
        // place this page cannot see (not on the board → maybe that tab).
        if (
          (holdRowsRef.current === null || cancelledRowsRef.current === null) &&
          patches.some((p) => p.tab === "hold" || p.tab === "cancelled" || !onBoardBefore.has(p.id))
        ) {
          void refreshCounts();
        }
        await refreshTripsByIds(tripIdsToRefresh(work.tripIds, nowTripIds, m.previousTripNumbers, tripsRef.current));
      } else {
        await refreshTripsByIds(work.tripIds);
      }
    },
    [feed.controller, load, postRows, refreshCounts, refreshTripsByIds],
  );

  const flush = useCallback(async () => {
    const ctl = feed.controller.current;
    if (!ctl || ctl.getMode() !== "live" || flushingRef.current) return;
    if (hardPausedRef.current || loadInFlightRef.current || isTypingInField()) return;
    // No board (the last load failed): the old 30 s rail poll used to retry —
    // here a full load at most every 30 s (also driven by the 30 s tick below).
    if (!dataRef.current) {
      if (Date.now() - lastRecoverLoadRef.current >= 30_000) {
        lastRecoverLoadRef.current = Date.now();
        void load();
      }
      return;
    }
    const ordersPaused = rowsPausedRef.current;
    if (midnightPendingRef.current && !ordersPaused) {
      midnightPendingRef.current = false;
      liveLog("floor", "IST midnight — full load");
      void load();
      return;
    }
    const work = ctl.take({ ordersPaused });
    flushingRef.current = true;
    let applied = false;
    try {
      if (work?.kind === "full") {
        liveLog("floor", `full load (${work.reasons.join(", ")})`);
        if (work.reasons.includes("config")) void readGate();
        await load();
      } else if (work?.kind === "patch") {
        await applyPatch(work, ordersPaused);
      }
      if (ordersPaused) await checkTickedBills();
      patchFailuresRef.current = 0;
      applied = work !== null;
    } catch (e) {
      patchFailuresRef.current++;
      liveLog("floor", `apply failed (${patchFailuresRef.current})`, e instanceof Error ? e.message : e);
      if (work?.kind === "patch") ctl.requeue(work.orderIds, work.tripIds);
      // Three in a row → one full load instead; the retry pace is the glance's.
      if (patchFailuresRef.current >= 3) {
        patchFailuresRef.current = 0;
        void load();
      }
    } finally {
      flushingRef.current = false;
    }
    // Changes that arrived while this ran → one more pass. Never after a
    // failure (the glance paces retries); stops when take() has nothing left.
    if (applied) setTimeout(() => flushRef.current(), 0);
  }, [feed.controller, load, applyPatch, checkTickedBills, readGate]);
  flushRef.current = () => {
    void flush();
  };

  onFeedModeRef.current = (m, prev) => {
    // Live → off: the old hooks mount; one full (non-lazy) load fills On hold /
    // Cancel & CI and re-bases everything — no browser reload needed.
    // The mount load was skipped on the hint and the feed is off/unreachable →
    // load now. Live: the flush's "start"/"switch-on" full load covers it.
    if (m === "off" && prev === "live") void load();
    else if ((m === "off" || m === "fallback") && mountLoadSkippedRef.current) {
      mountLoadSkippedRef.current = false;
      void load();
    }
    if (m === "live") mountLoadSkippedRef.current = false;
  };
  onFeedChangesRef.current = (b) => {
    const d = detailRef.current;
    if (d && b.orderIds.includes(d.orderId)) setDetailChangeSignal((n) => n + 1);
  };
  onMidnightRef.current = () => {
    if (viewKeyRef.current !== "live") return;
    midnightPendingRef.current = true;
    flushRef.current();
  };

  // A bill opened in the panel starts with no "changed" signal.
  useEffect(() => {
    setDetailChangeSignal(0);
  }, [detail?.orderId]);
  // Pauses lifting → apply what queued up.
  useEffect(() => {
    if (!hardPaused) flushRef.current();
  }, [hardPaused, rowsPaused]);
  useEffect(() => {
    if (selection.size === 0) tickCheckedRef.current = new Set();
  }, [selection]);
  // Typing ends → apply; and a 30 s render tick (no network) so ages and the
  // clock move while no reload happens. Live mode only.
  useEffect(() => {
    if (!feedLive) return;
    const onFocusOut = () => setTimeout(() => flushRef.current(), 0);
    document.addEventListener("focusout", onFocusOut);
    const tick = setInterval(() => {
      setRenderTick((t) => t + 1);
      if (!dataRef.current) flushRef.current(); // recovery after a failed load (throttled in flush)
    }, 30_000);
    return () => {
      document.removeEventListener("focusout", onFocusOut);
      clearInterval(tick);
    };
  }, [feedLive]);

  // Lazy tabs (live only): On hold / Cancel & CI load the first time they are
  // opened; after that they are patched like the board. A patch landing
  // mid-fetch → fetch once more, so an older answer never wins.
  const loadSideTab = useCallback(async (tab: "hold" | "cancelled") => {
    const seq0 = loadSeq.current;
    setSideTabLoading(tab);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const patch0 = patchSeqRef.current;
        const res = await fetch(`/api/floor/${tab}?${UNSCOPED_QS}`, { cache: "no-store" });
        if (loadSeq.current !== seq0 || viewKeyRef.current !== "live") return;
        if (!res.ok) {
          setSideError(`${tab === "hold" ? "Hold" : "Cancelled"} feed HTTP ${res.status}`);
          if (tab === "hold") setHoldRows([]);
          else setCancelledRows([]);
          return;
        }
        const body = (await res.json()) as { rows?: unknown[] };
        if (loadSeq.current !== seq0) return;
        if (patchSeqRef.current !== patch0 && attempt === 0) continue;
        if (tab === "hold") {
          holdRowsRef.current = (body.rows ?? []) as FloorHoldRow[];
          setHoldRows(holdRowsRef.current);
        } else {
          cancelledRowsRef.current = (body.rows ?? []) as FloorCancelledRow[];
          setCancelledRows(cancelledRowsRef.current);
        }
        liveLog("floor", `${tab} tab loaded (${(body.rows ?? []).length})`);
        return;
      }
    } catch {
      setSideError(`${tab === "hold" ? "Hold" : "Cancelled"} feed unreachable`);
      if (tab === "hold") setHoldRows([]);
      else setCancelledRows([]);
    } finally {
      setSideTabLoading((cur) => (cur === tab ? null : cur));
    }
  }, []);
  useEffect(() => {
    if (!feedLive || !isLive || loading || sideTabLoading !== null) return;
    if (topTab === "hold" && holdRows === null) void loadSideTab("hold");
    else if (topTab === "cancelled" && cancelledRows === null) void loadSideTab("cancelled");
  }, [feedLive, isLive, loading, sideTabLoading, topTab, holdRows, cancelledRows, loadSideTab]);

  // Unscoped on purpose: this is the LIST of dispatch windows to offer, not
  // their counts. The server maps every active dispatch_slot_master row whatever
  // the scope, so scoping would return the same ids — and the pickable windows
  // must not shrink just because a chip is on.
  const dispatchWindows: DispatchWindow[] = (data?.floor.windows ?? []).map((w) => ({
    id: w.id,
    windowTime: w.windowTime,
    label: null,
  }));

  const now = new Date();
  const dateStr = now
    .toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })
    .replace(",", "");
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

  const barVisible = topTab === "floor" && viewMode === "live" && selection.size > 0 && data !== null;
  // The menu lives on the bar, so it closes when the bar goes (ticks cleared,
  // tab changed, History) — never left "open" to reappear with the next tick.
  useEffect(() => {
    if (!barVisible) setMoreOpen(false);
  }, [barVisible]);
  // Same for the Hold bar's menu when the Hold tab is left (HoldTab closes it
  // itself when its ticks go).
  useEffect(() => {
    if (topTab !== "hold") setHoldMoreOpen(false);
  }, [topTab]);

  // ── ONE BAR, TWO READINGS (2026-09-10) ────────────────────────────────────
  //
  // 🔴 DECIDED BY THE RAIL, NOT BY THE ROWS. The previous cut tested whether
  // every ticked bill already had a `tripDropId` — a rows test, because there
  // were two bars and a mixed selection had to pick one. There is one bar now,
  // and the rail already says which question the operator is asking: the pool
  // means "where does this go", a trip means "what comes off this load". Rows
  // cannot express that — an empty selection has no rows at all, and a bill can
  // sit under a trip's stop while the planner is looking at the pool.
  //
  // The trip mode's Remove posts per trip anyway (removeSelectionFromTrips
  // groups by tripNumber), so a selection spanning stops is ordinary.
  const barMode: "pool" | "trip" = railSelection.kind === "trip" ? "trip" : "pool";
  /**
   * THE RAIL IS THE PICKER while pool bills are ticked (2026-09-16, owner's
   * add-to-trip design). Derived from the two things already on screen — no new
   * state — so clearing the selection (✕, Escape, or the add itself) ends it.
   *
   * ⚠ POOL MODE ONLY. A selection made INSIDE a trip means "take these off",
   * and its bar says so; turning the rail into a picker there would offer to
   * add bills that are already on a trip.
   */
  const addMode = barMode === "pool" && selection.size > 0 && addingToTripId === null;
  /**
   * The trip being filled, read off the live rail feed — so the band-s counts
   * and the button-s name are the trip as it is now, not as it was when "+ Add
   * bills" was pressed. Null (and the band closes) if it leaves the board.
   */
  const addTargetTrip = addingToTripId !== null ? (trips ?? []).find((t) => t.id === addingToTripId) ?? null : null;
  /**
   * The delivery type "+ New trip" numbers the trip under — the one with the
   * most ticked bills, a tie broken by the active tab, then by the first bill
   * ticked (lib/trips/type-choice.ts). Null only when no ticked bill has a type.
   *
   * 🔴 A MIXED SELECTION IS NOT AN ERROR (owner, 2026-09-18). A trip can carry
   * more than one delivery type — Varachha (Local) and Kamrej (Upcountry) share
   * a truck. The number keeps one letter because the number is an identifier;
   * what the trip holds is read off its bills. This replaced a block that
   * refused a mixed selection outright (8e1551a0).
   *
   * Walked in `selection`'s own order — a Set keeps insertion order, which is
   * the order the bills were TICKED — not `selectedRows`, which is board order.
   */
  const newTripTypeName = useMemo<string | null>(() => {
    const typeById = new Map(selectedRows.map((r) => [r.orderId, r.deliveryType]));
    // Numeric keys only — an `rd:` key is never a bill on this decision.
    const inTickOrder = Array.from(selection)
      .filter((id): id is number => typeof id === "number" && typeById.has(id))
      .map((id) => typeById.get(id) ?? null);
    return chooseTripTypeName(inTickOrder, scope);
  }, [selection, selectedRows, scope]);

  /**
   * "+ New trip" with bills ticked — CREATE DIRECTLY, no form (owner,
   * 2026-09-16). The trip is born with the selection in it, appears on the rail
   * and OPENS: it is the one place this flow moves the planner, because a trip
   * one second old is one he will want to look at.
   *
   * ⚠ NO TOAST ON SUCCESS. Landing inside the new trip is the confirmation.
   * Failures still speak.
   *
   * The delivery type comes from the bills themselves (`newTripTypeName` — the
   * majority, never a question). The options list is fetched lazily here for
   * the name → id mapping, exactly as the form does; most sessions never press
   * this.
   */
  //
  // ── MAKE TRIP FROM A LOAD-PLAN CARD (2026-09-19, owner) ──────────────────
  // `fromPlan` = the card's bill ids. It is THIS flow — the same two API
  // calls, the same checks, no new write path — with three differences the
  // owner asked for, and nothing else:
  //   - the card's bills REPLACE any ticks (the bar shows them while it runs);
  //   - the delivery type is chosen from THOSE bills, by the same rule
  //     (`chooseTripTypeName`), not from whatever was ticked before;
  //   - it STAYS on the load plan: the ticks are cleared, the board reloads so
  //     the plan regroups, and a toast offers "Open" (which selects the trip
  //     on the rail exactly as a rail click does) instead of opening it.
  const createTripWithSelection = useCallback(async (fromPlan?: { orderIds: number[]; vehicleSize?: VehicleSize }) => {
    const ids = fromPlan ? fromPlan.orderIds : selectedIdsRef.current;
    if (ids.length === 0) return;
    // ── HAND TRIP (2026-09-24, design §4) ─────────────────────────────────
    // "+ New trip" with EVERY ticked bill marked Hand builds a Hand trip — the
    // dealer collects, so no vehicle, plate, driver or size is sent (the server
    // refuses them on a Hand trip anyway). A MIX of Hand and truck bills is
    // refused here, before anything is created: the add route would split them
    // and leave half the ticks behind. (The load plan never holds Hand bills.)
    const handById = new Map((data?.floor.rows ?? []).map((r) => [r.orderId, r.isHand] as const));
    const handCount = ids.filter((id) => handById.get(id) === true).length;
    if (handCount > 0 && handCount < ids.length) {
      toast.error(
        `${handCount} of the ${ids.length} ticked bills are Hand (dealer collects) — a trip is either a truck or a Hand trip. Tick one kind.`,
      );
      return;
    }
    const isHandTrip = handCount > 0;
    if (fromPlan) setSelection(new Set(ids));
    setTripBarBusy(true);
    try {
      let opts = tripOptions;
      if (opts === null) {
        const res = await fetch("/api/floor/trips/options", { cache: "no-store" });
        if (!res.ok) {
          toast.error(`Could not read the trip options — HTTP ${res.status}`);
          return;
        }
        opts = (await res.json()) as TripOptions;
        setTripOptions(opts);
      }
      // Null when every ticked bill is untyped — refused below exactly as
      // before, since there is no letter to number the trip with. From a plan
      // card, the same rule over the card's own bills (in plan order).
      const typeName = fromPlan
        ? chooseTripTypeName(
            (() => {
              const typeById = new Map((data?.floor.rows ?? []).map((r) => [r.orderId, r.deliveryType] as const));
              return ids.filter((id) => typeById.has(id)).map((id) => typeById.get(id) ?? null);
            })(),
            scope,
          )
        : newTripTypeName;
      const deliveryType = opts.deliveryTypes.find((d) => d.name === typeName);
      if (!deliveryType) {
        toast.error(
          typeName === null
            ? "These bills have no customer in Delivery Point Master. Add the customer first, then create the trip."
            : `Could not match the delivery type "${typeName}" — nothing was created.`,
        );
        return;
      }

      const createRes = await fetch("/api/floor/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryTypeId: deliveryType.id,
          // The board's own anchor day, never a clock read here — a trip built
          // while looking at a past day carries that day, as the form does.
          tripDate: viewMode === "history" && histDate ? histDate : istTodayIso(),
          // A load plan card's own size (Ace / Big / GC) rides along, so the
          // trip carries it without the form (owner, 2026-09-21).
          ...(fromPlan?.vehicleSize && !isHandTrip ? { vehicleSize: fromPlan.vehicleSize } : {}),
          ...(isHandTrip ? { isHand: true } : {}),
        }),
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        toast.error(`Could not create the trip — ${created?.error ?? `HTTP ${createRes.status}`}`);
        return;
      }
      const trip = created.trip as { id: number; tripNumber: string };

      // ⚠ A FAILURE HERE LEAVES A REAL, EMPTY TRIP rather than rolling back —
      // there is no transaction (CORE §3), and an empty trip is visible and
      // fixable where a silently-deleted one is not. Same choice trip-form makes.
      const billsRes = await fetch(`/api/floor/trips/${trip.id}/bills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: ids, action: "add" }),
      });
      const billsBody = await billsRes.json().catch(() => ({}));
      const failed: Array<{ orderId: number; error: string }> = billsBody?.failed ?? [];
      if (failed.length > 0) {
        toast.error(
          `${trip.tripNumber} created, but ${failed.length} bill${failed.length === 1 ? "" : "s"} did not go on — ${failed[0].error}`,
        );
      }
      if (fromPlan) {
        // STAY on the plan (owner): clear the ticks, reload so the plan
        // regroups without these bills, and offer the trip rather than open it.
        setSelection(new Set());
        await load();
        toast.success(`Trip ${trip.tripNumber} made`, {
          action: { label: "Open", onClick: () => selectRail({ kind: "trip", tripId: trip.id }) },
        });
        return;
      }
      // Clears the selection, selects the new trip on the rail, refetches.
      await onTripCreated(trip.id);
    } catch {
      toast.error("Could not create the trip — check your connection.");
    } finally {
      setTripBarBusy(false);
    }
  }, [newTripTypeName, tripOptions, viewMode, histDate, onTripCreated, data, scope, load, selectRail]);

  // ⚠ `attachableTrips` WENT WITH THE DROPDOWN (2026-09-16). The same rule — a
  // dispatched or cancelled trip cannot take bills — now lives on the rail
  // card, which renders those cards inert with the reason on hover
  // (trip-rail.tsx, `addable`).
  //
  // ⚠ THE NEW TRIP FORM IS NOT SEEDED WITH A DELIVERY TYPE (owner, 2026-09-21,
  // trip-form-v1 mockup). `seedDeliveryTypeId` — the type every ticked bill
  // agreed on — went with the shared trip form: the form opens with nothing
  // picked and the planner chooses. The direct "+ New trip" path with ticked
  // bills still picks by majority (`newTripTypeName`).

  // ── What the selection adds up to (2026-09-10 b) ─────────────────────────
  //
  // Four numbers on the bar: litres, kilos, pieces, routes. Litres is what the
  // depot talks in; KILOS is what a vehicle's capacity is measured in
  // (`vehicle_master.capacityKg`), which is the number a planner is actually
  // checking when he decides whether a selection fits.
  //
  // 🔴 AN UNKNOWN WEIGHT IS NOT COUNTED AS ZERO. `sumWeightKg` returns the total
  // of the weights it HAS plus how many it could not read, and the bar renders
  // "67+ kg" when that count is non-zero. The importer stores a missing SAP
  // gross weight as 0 (app/api/import/obd/route.ts:600 and three siblings), so
  // "0" and "unknown" are the same stored value — folding them into the sum
  // would report a van-load as lighter than it is, silently, which is the one
  // failure mode this number exists to prevent.
  const selectionWeight = useMemo(() => sumWeightKg(selectedRows), [selectedRows]);
  // Pieces. Bills with no article tag are skipped rather than counted as zero
  // (~27% of SKUs are unmastered, CORE §7.1.c) — countArticles reports those
  // separately and the bar simply omits the number when nothing parsed.
  const selectionArticles = useMemo(
    () => countArticles(selectedRows.map((r) => r.articleTag)).pieces,
    [selectedRows],
  );
  // Distinct routes. A null route is its own bucket, not a skipped row: "two
  // routes and something unrouted" is three things to plan, and dropping the
  // unrouted one would make the bar under-report the spread.
  const selectionRoutes = useMemo(
    () => new Set(selectedRows.map((r) => r.route ?? "\u0000unrouted")).size,
    [selectedRows],
  );

  /**
   * THE SELECTION'S ROUTE, by the SAME rule the rail card's label uses
   * (2026-09-16, owner): `rankRouteName` from lib/trips/route-label.ts, the one
   * implementation both sides call. Most BILLS wins here — the trip ranks by
   * stops — a tie goes to the first row on the board, placeholder routes are
   * skipped, and the rest become "+N".
   *
   * `rank` is kept beside the label because the "Same route" hint needs to know
   * whether the selection is a SINGLE route: with two or more there is no
   * sensible match, and guessing at the biggest would mark cards that are only
   * partly right.
   */
  const selectionRouteRank = useMemo(
    () =>
      rankRouteName(
        selectedRows.map((r, i) => ({ name: r.route, order: i, hasBills: true })),
        placeholderRoutes,
      ),
    [selectedRows, placeholderRoutes],
  );
  /**
   * The label a card must match to earn its quiet "Same route" line: only when
   * the selection is ONE route, and never in targeted add mode, where the trip
   * has already been chosen and there is nothing to compare.
   */
  const sameRouteLabel =
    addMode && selectionRouteRank !== null && selectionRouteRank.others === 0
      ? selectionRouteRank.name
      : null;

  // ⚠ THE RAIL'S PINK ADD HINT WENT ON 2026-09-22 (floor-bulk-actions v5), and
  // `addSummary` — its second line — went with it. The bottom bar already
  // prints the same litres / kg for the selection.

  // A short reminder of what the selection is sitting on. Reads off the rail,
  // for the same reason `barMode` does.
  //
  // ⚠ A TARGETED ADD SPEAKS FIRST (2026-09-18). The rail is still on the trip
  // being filled, and "on L-260918-03" read as a claim about the TICKED BILLS —
  // which were pool bills on no trip at all. While adding it says where they are
  // going instead.
  const barContextLabel = useMemo(() => {
    if (addTargetTrip) return `adding to ${addTargetTrip.tripNumber}`;
    if (railSelection.kind !== "trip") return null;
    const t = (trips ?? []).find((x) => x.id === railSelection.tripId);
    return t ? `on ${t.tripNumber}` : null;
  }, [addTargetTrip, railSelection, trips]);

  // Tab counts reflect the searched/filtered set of each surface (they equal the
  // full totals when no search/filter is active).
  const floorCount = filteredFloor?.total ?? 0;
  // Live feed, lazy tab not loaded yet → the server's count for this scope
  // (before search / flags). Loaded, or feed off → exactly as before.
  const liveCounts = feedLive && isLive ? tabCounts : null;
  const holdCount = filteredHold?.length ?? liveCounts?.hold[scope] ?? 0;
  const cancelledCount = filteredCancelled?.length ?? liveCounts?.cancelled[scope] ?? 0;

  // Bills ON the floor with nobody on them yet — the one number the operator
  // cannot read off the badge beside it, which counts everything including work
  // already finished today (a 42 made entirely of checked bills and a 42 with 40
  // untouched ones look identical without this).
  //
  // ⚠ THE SAME SET AS `floorCount`, never the raw server payload: `filteredFloor`
  // has already been scoped + searched + flag-filtered, and its `total` is the DUE
  // rows (rows minus zone "upcoming"). Re-cutting due off that same object is what
  // keeps the pair honest — narrow the search and both numbers move together, or
  // the smaller one would quietly describe bills no longer on screen.
  //
  // ⚠ THE RULE IS NOT RE-DERIVED HERE. `countByStatus()` (status-pill.tsx) owns the
  // four statuses for this whole screen and `waiting` IS its pending_picking
  // bucket. queries.ts already carries one server-side inline copy for the By-group
  // payload, flagged there as having to stay in step; a third copy would be a third
  // place to forget.
  // ── "N waiting" NOW COUNTS WHAT IT CLAIMS (2026-09-13) ────────────────────
  //
  // 🔴 IT READ `counts.waiting` AND THAT SWEPT IN THE TINT ROOM. Every bill at
  // a tint stage fell through `rowStatus` to "waiting", so the badge — titled
  // "Bills on the floor with no picker assigned yet" — counted five bills that
  // were on the mixer and that no picker could start. Measured 2026-09-13: it
  // read 16 when 11 were actually available. Same defect as the "checked today"
  // count fixed on 2026-09-12: a label asserting something it does not test.
  //
  // ⚠ COUNTING ONLY. No predicate, no arm, no fetch. `rowStatus` now returns the
  // three tint statuses, so the split falls out of the vocabulary rather than
  // from a second rule written here — and the two folds live in status-pill.tsx
  // beside it, because "which statuses mean waiting for a picker" is that file's
  // question and not this one's.
  const waitingCount = useMemo(
    () => (filteredFloor ? waitingForPickerCount(countByStatus(filteredFloor.rows.filter((r) => r.zone !== "upcoming"))) : 0),
    [filteredFloor],
  );

  // ── THE TINTING TAB'S COUNT AND ITS OPERATOR LOOKUP ──────────────────────
  //
  // The tab holds tint bills NOT YET BEING MIXED. Counted off `rowStatus`, the
  // one owner, so the badge and the rows behind it cannot disagree — and off
  // EVERY row rather than the due slice, because a tint bill promised for
  // Saturday is exactly what "what is coming" means.
  const tintingCount = useMemo(() => {
    if (!filteredFloor) return 0;
    // The include half of the split, through the SAME predicate `filteredFloor.
    // total` excludes on. Two badges, one rule, exact complements.
    return filteredFloor.rows.filter(isTintRoomRow).length;
  }, [filteredFloor]);

  const [tintOperators, setTintOperators] = useState<Map<number, string | null> | null>(null);

  /**
   * Who holds each bill in the tint room.
   *
   * 🔴 FETCHED ONLY WHILE THE TINTING TAB IS OPEN, AND THAT IS THE POINT. The
   * board query does not read `tint_assignments` and must not — the rail feed
   * that used to was deleted on 2026-09-13 for costing 772 ms and 25 of the
   * call's 84 statements, taking the board from 3,909 ms to 1,958 ms. An
   * operator name on the row would have spent it back on every load AND on
   * every 30-second poll.
   *
   * ⚠ IT IS DELIBERATELY NOT IN `load()`, which is what the 30s rail poll calls.
   * Being its own effect keyed on the tab is the whole mechanism: the Floor tab
   * never mounts it, the poll never touches it, and the 15s marker is unrelated.
   * Measured cost when it does run: +171 ms and +5 statements.
   *
   * ⚠ AND IT DOES NOT FOLLOW THE POLL EITHER. An operator name changes when a
   * manager assigns — a handful of times a day — so a name 30 seconds stale is
   * not worth a recurring read on the depot's link. It refetches when the tab is
   * opened and when `load()` has just run for another reason (`lastSyncedAt`),
   * which covers the explicit Refresh without adding a timer of its own.
   * Owner decision 2026-09-14.
   */
  useEffect(() => {
    if (topTab !== "tinting") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/floor/tint-operators", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { operators?: Array<{ orderId: number; name: string | null }> };
        if (cancelled) return;
        setTintOperators(new Map((body.operators ?? []).map((o) => [o.orderId, o.name])));
      } catch {
        // A missing name is a dash, never an error banner: the tab's real
        // content is the rows, and they are already on screen. Leaving the map
        // as it was is better than blanking a column over a dropped request.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [topTab, lastSyncedAt]);

  // ── The visibility gate (2026-09-09) ──────────────────────────────────────
  // "N not shown" for the header switch, counted off the rows this screen
  // ALREADY has. Same slice `waitingCount` above uses (due rows of the filtered
  // floor) so the two numbers describe the same board, and through isHeldBack()
  // rather than a hand-written held-back test (per trip since slice 8) — that
  // shape is the exact bug class CLAUDE_PICKING §7's standing rule warns about.
  //
  // ⚠ NOT the picking marker's own held-back number. Floor must never call the
  // picking marker: two sources for one figure is two figures that can disagree,
  // and this one has to match the pills on the rows below it.
  const heldBackCount = useMemo(
    () =>
      filteredFloor
        ? filteredFloor.rows.filter((r) => r.zone !== "upcoming" && isHeldBack(r)).length
        : 0,
    [filteredFloor],
  );


  // Tab pill (Floor / On hold / Cancelled) — active is dark-underlined; the count
  // badge is dark on the active tab, grey otherwise.
  function tabPill(key: TopTab, label: string, count: number) {
    const on = topTab === key;
    return (
      <button
        type="button"
        onClick={() => setTopTab(key)}
        className={`flex items-center gap-1.5 border-b-2 py-3 text-[12px] ${
          on ? "border-gray-900 font-bold text-gray-900" : "border-transparent text-gray-400 hover:text-gray-600"
        }`}
      >
        {label}
        <span className={`rounded px-1.5 py-px text-[10px] font-bold ${on ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"}`}>
          {count}
        </span>
      </button>
    );
  }

  /**
   * The tab pills, their readouts and New trip — rendered by TripDesk as the
   * first child of the TABLE column (2026-09-14).
   *
   * ⚠ BUILT HERE, RENDERED THERE. The four counts come from four different
   * filtered lists this component already owns, so deriving them inside the desk
   * would be a second answer to each. Passing the finished node keeps one.
   */
  const tabRow = (
    <>
      {/* Floor + its waiting readout as ONE unit: a tight 8px gap binds the
          label to the badge it qualifies while the row's own 18px gap still
          separates it from the next tab. Plain grey inline stats (CLAUDE_UI §4),
          NOT a second pill: the badge next door is already a filled one. NOT
          teal either — teal on this row is the New trip button alone
          (CLAUDE_UI §6). It sits OUTSIDE the tab button on purpose: it reports,
          it is not a fifth thing to click.

          Shown at ZERO deliberately: "0 waiting" is the good state and worth
          saying out loud. */}
      <span className="flex items-center gap-2">
        {tabPill("floor", "Floor", floorCount)}
        <span className="text-[11px] text-gray-400" title="Bills on the floor with no picker assigned yet">
          <span className="font-semibold tabular-nums text-gray-700">{waitingCount}</span> waiting
        </span>
      </span>
      {/* 🔴 THE TINTING TAB IS STYLED LIKE EVERY OTHER TAB — ink when active, no
          pink anywhere on it. Pink belongs to the PILLS, which say what state a
          bill is in; a pink tab would make the colour mean two things and would
          shout on a row of four equals. The `inTinting` readout that used to sit
          beside "waiting" is gone with it: the tab's own badge is that number,
          and two of them side by side was one too many. */}
      {tabPill("tinting", "Tinting", tintingCount)}
      {tabPill("hold", "On hold", holdCount)}
      {/* "Cancel & CI" since 2026-09-22 — today's cancels AND the CIs the floor
          raised. The TopTab key stays "cancelled"; only the label moved. */}
      {tabPill("cancelled", "Cancel & CI", cancelledCount)}

      {/* 🔴 NO "+ New trip" ON THIS ROW ANY MORE (2026-09-22). A trip is made
          from ticked bills, by the bottom bar's "+ New trip" — the only way in
          now. With nothing ticked the Floor tab has NO brand button: a browse
          state (like CLAUDE_UI §59.9's list screens). TripForm and openTripForm
          stay in this file with no caller; not deleted.

          The right-hand group of this row (live dot · Flat | By route ·
          History / the history stepper) is built by TripDesk, which owns
          those controls' state (trip-desk.tsx). */}
    </>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      {/* The old live-sync — mounted only while the live feed is not live. */}
      {legacySyncMounted && (
        <LegacyFloorSync
          markerPaused={!isLive || detailOpen}
          onMarkerChange={legacyMarkerOnChange}
          onProbe={setConnected}
          railPaused={!isLive || detailOpen || selection.size > 0}
          onRailTick={legacyRailOnTick}
        />
      )}
      {/* ── Row 1 — title + date/time (design §5). ───────────────────────── */}
      <div className="flex h-11 items-center gap-2.5 border-b border-[#f0f0f0] px-4">
        {/* The board no longer names itself — the nav says where you are and the
            tabs below name the content. The ROW stays: it carries the date/clock,
            which does not move.

            The gate switch takes the vacated left end. It renders nothing at all
            until the state is known, and reads as a quiet ghost button when the
            gate is off — so this row is unchanged from today in both of those
            cases. Only /floor canEdit holders reach this screen, so the control
            needs no permission test of its own, and it must not grow one that
            would let a viewer flip it. */}
        <PickGateToggle
          enabled={gateEnabled}
          heldBackCount={heldBackCount}
          // ⚠ REFETCH ON A FLIP (slice 8). It was needed while turning desk
          // control on marked trips shown server-side (the no-cliff step,
          // removed 2026-09-21); a flip now writes only the switch, and the pills
          // pair `isAwaitingShow` with `gateEnabled` on the client. Kept as a
          // cheap resync — a trip write moves no orders.updatedAt, so the floor's
          // own marker would not notice one made elsewhere.
          onChanged={(v) => {
            setGateEnabled(v);
            void load();
          }}
        />
        <span suppressHydrationWarning className="ml-auto text-[11px] text-gray-400" style={{ fontVariantNumeric: "tabular-nums" }}>
          {dateStr} &middot; {timeStr}
        </span>
      </div>

      {/* ── Row 2 — scope chips left; search + filter right (inert). ─────── */}
      <div className="flex h-[46px] items-center gap-3 border-b border-gray-200 bg-[#fcfcfd] px-4">
        <div className="inline-flex gap-[2px] rounded-[7px] bg-gray-100 p-[2px]">
          {SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`rounded-[5px] px-3 py-[5px] text-[11px] ${
                scope === s ? "bg-white font-semibold text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <SearchBox committed={searchQuery} onSearch={commitSearch} onClear={clearSearch} />
          <FilterSheet filters={filters} onChange={setFilters} showStatus={topTab === "floor" || topTab === "tinting"} />
        </div>
      </div>

      {/* Search results strip (design §5.2) — describes the OPEN tab's matches. */}
      <SearchHits
        parsed={parsed}
        report={tabSearchReport}
        onClear={clearSearch}
        // Trip lines on the Floor tab only — the tab whose rail click opens a trip.
        tripHits={topTab === "floor" ? tripSearchHits : []}
        onOpenTrip={(tripId) => selectRail({ kind: "trip", tripId })}
        lookup={lookup}
        onPickHit={goToHit}
        // A failed History jump retries the same trip (it reloads that day).
        onRetryOpen={openLookupTrip}
      />

      {/* Connection strip (design §13) — only in live mode; renders only when the
          server is unreachable. A strip, never a modal — the board stays readable. */}
      {/* The connection strip that rendered here is replaced by the live dot in
          the tab row (2026-09-22) — same `connected` / `lastSyncedAt` state from
          the same marker probe, passed to TripDesk below. */}

      {/* ── Body — ONE column (2026-09-10) ────────────────────────────────
          🔴 THE 344px DECISION RAIL IS GONE. It held the bills the dispatch
          engine could not slot, each on a card with its own slot picker and a
          "Why no slot?" link. Those bills are ROWS on the board now — the board
          predicate was widened to union them in (floorBoardWhere, lib/floor/
          queries.ts), which put 4 more bills on a 40-row board — and they wear a
          quiet `no slot` chip instead of a card. Putting one on a trip is what
          gives it a slot, so the card's picker had nothing left to decide.

          The desk grows its OWN 298px rail inside this column, of trips. Two
          rails side by side would have been two answers to "what am I looking
          at". */}
      <div className="grid min-h-0 flex-1 overflow-hidden" style={{ gridTemplateColumns: "1fr" }}>
        {/* The desk. (The bottom bar is NOT overlaid here any more — TripDesk
            places it inside its bills column, 2026-09-22.)

            🔴 THE TAB ROW MOVED INSIDE THE TABLE COLUMN (2026-09-14). It used to
            sit here, spanning the whole page above the rail. That is the shape
            the original July board had it in and the one Mail Orders still uses:
            a full-width SCOPE row, then rail and main side by side, with the
            tabs as the first child of main. It also fixes the bug that came
            with the old shape — On hold and Cancelled rendered INSTEAD of the
            desk, the 298px rail disappeared, and every column jumped sideways
            on a tab change.

            `tabRow` is built here because the four counts come from four
            different filtered lists this component already owns; TripDesk
            renders it, so the rail and the tabs cannot get out of line. */}
        <div className="relative flex min-h-0 flex-col overflow-hidden">
          {loading && !data ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <FloorSkeleton variant="floor" />
            </div>
          ) : error && !data ? (
            <div className="px-5 py-14 text-center text-[11.5px] text-gray-400">Couldn&rsquo;t load the floor. {error}</div>
          ) : filteredFloor ? (
            <TripDesk
              // The gate is forwarded UNCHANGED to every leaf table, where it
              // swaps the Status pill's label on held-back waiting rows. No
              // column, no width array and no count moves with it.
              gateOn={gateOn}
              floor={filteredFloor}
              // The day's trips, from their own feed — never derived from the
              // board rows (see the state declaration). A trip whose bills are
              // all checked has left the board's live set, and a rail built by
              // filtering rows would drop it.
              trips={trips}
              tripsLoading={loading}
              tripDetail={tripDetail}
              selection={railSelection}
              onSelectRail={selectRail}
              histDate={histDate}
              onEnterHistory={enterHistory}
              onExitHistory={exitHistory}
              onStepHistory={stepHistory}
              rowSelection={selection}
              onToggleRow={onToggleRow}
              onToggleRedelivery={onToggleRedelivery}
              onOpenRedelivery={setRedeliveryInfoId}
              onAddRedelivery={setRedeliveryTripId}
              onToggleAll={onToggleAll}
              onMarkUrgent={rowMarkUrgent}
              // ── ADD MODE (2026-09-16) ────────────────────────────────────
              // Bills are ticked in the POOL and are waiting to be placed, so
              // the rail stops being a list and becomes the picker. DERIVED,
              // never stored: it is exactly "the bar is in pool mode and
              // something is ticked", so Escape and ✕ — which clear the
              // selection — end it with no second piece of state to go stale.
              addMode={addMode}
              addCount={selectedRows.length}
              sameRouteLabel={sameRouteLabel}
              onAddToTrip={(id) => void addSelectionToTrip(id)}
              // Targeted add — "+ Add bills" inside a trip (2026-09-16).
              addingToTripId={addingToTripId}
              lastAddCount={lastAdd?.orderIds.length ?? 0}
              onUndoLastAdd={() => { if (lastAdd) { const { tripId, orderIds } = lastAdd; setLastAdd(null); void undoAdd(tripId, orderIds); } }}
              onStartAddingTo={startAddingTo}
              onDoneAdding={stopAddingTo}
              tripBusyId={tripBusyId}
              // The page's All / Local / Upcountry / IGT / Cross scope, for the RAIL
              // (slice 6). The rail filters trips by their own delivery type;
              // it adds no tabs of its own.
              scope={scope}
              onChangeVehicle={(id) => void openVehicleEditor(id)}
              onCancelTrip={(id) => void cancelTrip(id)}
              onSetTripShown={(id, shown) => void setTripShown(id, shown)}
              onSetTripSentToBilling={(id, sent) => void setTripSentToBilling(id, sent)}
              // 🔴 RENDERED ON ALL FOUR TABS (2026-09-14). The desk owns the
              // rail, and the rail must not move when the tab changes — so the
              // desk is the shell for every tab and swaps only what is in the
              // TABLE column. Hold and Cancelled ride in as `sideBody`.
              activeTab={topTab}
              tabs={tabRow}
              // Live feed: the chip follows the feed's own health (and says
              // "Delayed" while its lag persists). Off: the marker probe, as before.
              connected={feedLive ? feed.connected : connected}
              delayed={feedLive && feed.delayed}
              lastSyncedAt={lastSyncedAt}
              sideBody={
                topTab === "hold" ? (
                  <HoldTab
                    rows={filteredHold}
                    loading={(loading || sideTabLoading === "hold") && filteredHold === null}
                    error={error ?? sideError}
                    scope={scope}
                    windows={dispatchWindows}
                    onRelease={holdRelease}
                    onOpenDetail={(id) => openDetail(id, "hold")}
                    menuOpen={holdMoreOpen}
                    onMenuOpenChange={setHoldMoreOpen}
                    onOpenOffFloor={(rows, keepTicked) =>
                      openOffFloor(rows.map(holdRowToOffFloorBill), (_done, notDone) => keepTicked(notDone))
                    }
                  />
                ) : topTab === "cancelled" ? (
                  cancelSearch !== null ? (
                    // A search result from another day (2026-10-06): the found
                    // row(s) only, READ-ONLY — no ticks, and the panel opens as
                    // "history" — like History's old trip. Clear → today's list.
                    <CancelledTab
                      rows={cancelSearch.rows}
                      loading={false}
                      error={null}
                      scope="All"
                      onRestore={cancelledRestore}
                      onOpenDetail={(id) => openDetail(id, "history")}
                      searchResult={{ label: cancelSearch.label, onClear: clearSearch }}
                    />
                  ) : (
                    <CancelledTab
                      rows={filteredCancelled}
                      loading={(loading || sideTabLoading === "cancelled") && filteredCancelled === null}
                      error={error ?? sideError}
                      scope={scope}
                      onRestore={cancelledRestore}
                      onOpenDetail={(id) => openDetail(id, "cancelled")}
                    />
                  )
                ) : null
              }
              tintOperators={tintOperators}
              // ⚠ THE UNFILTERED ROWS, for the trip pane’s stop lookup ONLY. The desk
              // still receives the FILTERED board as `floor`; this is the second
              // array, and TripDesk’s own comment says why a pool filter must not
              // decide what a stop contains.
              //
              // 🔴 UNSCOPED TOO (owner, 2026-09-18): `data`, not `scopedData`. The
              // delivery-type tab filters the POOL, never the contents of a truck
              // the planner has deliberately opened — a Local + Upcountry trip
              // opened on the Local tab shows its Upcountry stops in full. Hiding
              // half a load behind a tab is how a truck leaves with 12 bills
              // while the planner believes it has 8. Hide and the date anchor are
              // applied server-side, so a bill they leave out is still absent
              // here and still reads "not in this view".
              unfilteredRows={data?.floor.rows ?? []}
              routeClubs={routeClubs}
              clubReachRows={clubReachRows}
              openRouteCard={openRouteCard}
              onOpenRouteCard={setOpenRouteCard}
              onScopeChange={setScope}
              searchActive={searchQuery.trim() !== ""}
              // The trips holding the searched bills — the rail narrows to them
              // (owner, 2026-09-29). Null = no narrowing.
              searchTripIds={searchTripIds}
              loadPlanConfigs={loadPlan.configs}
              routeNames={loadPlan.routeNames}
              onMakeTrip={(orderIds, vehicleSize) => void createTripWithSelection({ orderIds, vehicleSize })}
              makeTripBusy={tripBarBusy}
              // ONE BAR, placed by TripDesk INSIDE its bills column (2026-09-22)
              // so it never runs under the trip rail. The assign bar and the
              // trip selection bar were two components at the same bottom-0,
              // picked between by a rows test; both are gone, and this one reads
              // which question to ask off the rail.
              bottomBar={
                barVisible ? (
                  <FloorBottomBar
                    count={selectedRows.length + selectedRedeliveryIds.length}
                    redeliveryCount={selectedRedeliveryIds.length}
                    litres={formatLitres(sumLitres(selectedRows))}
                    weight={formatWeightKg(selectionWeight.kg)}
                    weightIsPartial={selectionWeight.unknown > 0}
                    articles={selectionArticles}
                    routes={selectionRoutes}
                    mode={barMode}
                    busy={tripBarBusy || tripBusyId !== null}
                    addTargetLabel={addTargetTrip?.tripNumber ?? null}
                    onAddToTarget={() => { if (addingToTripId !== null) void addSelectionToTrip(addingToTripId, { quiet: true }); }}
                    onNewTripWithSelection={() => void createTripWithSelection()}
                    onRemoveFromTrip={() =>
                      void removeSelectionSplit(
                        selectedRows,
                        selectedRedeliveryIds,
                        railSelection.kind === "trip" ? railSelection.tripId : null,
                      )
                    }
                    onClear={clearSelection}
                    contextLabel={barContextLabel}
                    menuOpen={moreOpen}
                    onMenuOpenChange={setMoreOpen}
                    onHold={() => void bulkHold(selectedRows)}
                    onOffFloor={() =>
                      openOffFloor(selectedRows.map(boardRowToOffFloorBill), (_done, notDone) =>
                        setSelection(new Set(notDone)),
                      )
                    }
                  />
                ) : null
              }
              // The SAME desk renders live and history, so the source is
              // decided here by the view (2026-08-25). "history" is the
              // read-only source — it suppresses every action in the panel
              // (detail-panel's `readOnly`). `isLive` is the one flag this
              // screen already uses for the live/history split (the sync
              // pauses key off it), so the panel can never disagree with the
              // desk about which day it is showing.
              onOpenDetail={(id) => openDetail(id, isLive ? "floor" : "history")}
            />
          ) : null}
        </div>
      </div>

      {/* The New trip form (2026-09-10, replacing build-trip-drawer.tsx).
          Renders only once its options have landed — three empty dropdowns would
          look like a broken form rather than a loading one.

          ⚠ NO Esc HANDLER OF ITS OWN. floor-page is the SINGLE window-level Esc
          owner for the whole floor tree (FLOOR §4.6); a second listener races it
          in registration order, which is the bug that spec replaced. The form
          closes on its ✕ and on its backdrop. */}
      {tripFormSeed !== null && tripOptions && (
        <TripForm
          // The board's own anchor day, not a clock read inside the form — so a
          // trip built while looking at a past day carries that day.
          tripDate={viewMode === "history" && histDate ? histDate : istTodayIso()}
          deliveryTypes={tripOptions.deliveryTypes}
          windows={tripOptions.windows}
          vehicles={tripOptions.vehicles}
          transporters={tripOptions.transporters}
          attachOrderIds={tripFormSeed}
          onClose={() => setTripFormSeed(null)}
          onCreated={(tripId) => void onTripCreated(tripId)}
        />
      )}

      {/* The vehicle / transporter / slot editor over ONE trip (2026-09-10).
          Renders only once its options have landed and the trip is still on the
          board — a trip that left between opening and loading simply closes.

          ⚠ NO Esc HANDLER OF ITS OWN, same rule as the Build trip drawer:
          floor-page is the single window-level Esc owner (FLOOR §4.6). */}
      {editingTripId !== null && tripOptions && (() => {
        const t = (trips ?? []).find((x) => x.id === editingTripId);
        if (!t) return null;
        return (
          <TripVehicleEditor
            trip={t}
            windows={tripOptions.windows}
            vehicles={tripOptions.vehicles}
            transporters={tripOptions.transporters}
            deliveryTypes={tripOptions.deliveryTypes}
            onClose={() => setEditingTripId(null)}
            onSaved={() => {
              setEditingTripId(null);
              // Explicit refetch — the poll may be paused (FLOOR §5).
              void load();
            }}
          />
        );
      })()}

      {/* Detail panel (design §10) — slides over the board from any surface. */}
      {detail && (
        <DetailPanel
          orderId={detail.orderId}
          source={detail.source}
          hasDuplicateSo={detailHasDuplicateSo}
          withBillingCiNumber={detailCiNumber}
          isHand={detailIsHand}
          canEdit={canEdit}
          list={detailList}
          windows={dispatchWindows}
          pickers={data?.pickers ?? []}
          actions={detailActions}
          onClose={closeDetail}
          onNavigate={navigateDetail}
          // Live feed only: bumps when this bill changes elsewhere. The panel
          // checks and offers "Changed — Reload"; it never swaps data itself.
          changeSignal={feedLive ? detailChangeSignal : undefined}
        />
      )}

      {/* Cancel / Raise CI (2026-09-22) — above the panel, which can open it.
          The form closes itself on its Back / Done / scrim, and after an
          all-done submit; `onApplied` fixes the opener's ticks and reloads. */}
      {/* RE-DELIVERY (2026-10-03) — the add dialog and the read-only info.
          Closed by this page's one Esc listener; after an add the page reloads,
          which refreshes the trips and, through them, the open trip's stops. */}
      {redeliveryTripId !== null && (
        <TripRedeliveryDialog
          tripId={redeliveryTripId}
          tripNumber={(trips ?? []).find((t) => t.id === redeliveryTripId)?.tripNumber ?? "this trip"}
          onClose={closeRedeliveryDialog}
          onAdded={() => void load()}
          onBusyChange={setRedeliveryBusy}
        />
      )}
      {redeliveryInfoId !== null && tripRedeliveryById.has(redeliveryInfoId) && (
        <TripRedeliveryInfo
          redelivery={tripRedeliveryById.get(redeliveryInfoId) as TripRedeliveryRow}
          tripNumber={tripDetail?.tripNumber ?? ""}
          onClose={closeRedeliveryInfo}
        />
      )}

      {offFloor && (
        <OffFloorDialog
          bills={offFloor.bills}
          reasons={ciReasons}
          reasonsError={ciReasonsError}
          onApplied={(doneIds, notDoneIds) => {
            offFloor.onApplied(doneIds, notDoneIds);
            void load();
          }}
          onBusyChange={setOffFloorBusy}
          onClose={() => setOffFloor(null)}
        />
      )}
    </div>
  );
}

/** Focus is in a field — the live feed waits to apply (typing queues patches). */
function isTypingInField(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement as HTMLElement | null;
  const tag = el?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el?.isContentEditable;
}

/**
 * The OLD live-sync, moved here unchanged (live feed 7b): the 15 s floor marker
 * (use-picking-marker → /api/floor/marker, which also drives the connection
 * chip) and the 30 s blind reload (useFloorRailPoll). FloorPage renders this
 * only while the live feed is NOT live — switch off, fallback after repeated
 * feed errors, or not yet known on a browser that never saw the feed on — so
 * with the switch off the page runs exactly these two hooks with exactly the
 * arguments it always passed. Mounting / unmounting is what starts and stops
 * them (each cleans up its own timer and listener).
 */
function LegacyFloorSync({
  markerPaused,
  onMarkerChange,
  onProbe,
  railPaused,
  onRailTick,
}: {
  markerPaused: boolean;
  onMarkerChange: () => void;
  onProbe: (ok: boolean) => void;
  railPaused: boolean;
  onRailTick: () => void;
}) {
  usePickingMarker({
    scope: "openPending",
    url: "/api/floor/marker",
    paused: markerPaused,
    onProbe,
    onChange: onMarkerChange,
  });
  useFloorRailPoll({
    paused: railPaused,
    onTick: onRailTick,
  });
  return null;
}
