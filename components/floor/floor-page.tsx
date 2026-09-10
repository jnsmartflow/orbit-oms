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
// ⚠ NONE OF THOSE FILES IS DELETED. They are simply no longer rendered;
// archiving them is its own step, with its own README (archive/RETIREMENT-
// PLAYBOOK.md).
//
// The five state actions (mark-urgent · change-slot · hold · cancel · restore)
// still go through /api/floor/actions, and the row ⚡ is still wired here.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { TripDesk } from "./trip-desk";
import { TripForm } from "./trip-form";
import { FloorBottomBar } from "./floor-bottom-bar";
import { TripVehicleEditor } from "./trip-vehicle-editor";
import {
  rowStatus,
  countByStatus,
  isHeldBack,
  formatLitres,
  sumLitres,
  formatWeightKg,
  sumWeightKg,
} from "./status-pill";
import { countArticles } from "@/lib/floor/format";
import { PickGateToggle } from "./pick-gate-toggle";
import { ShowStrip } from "./show-strip";
import { FloorSkeleton } from "./floor-skeleton";
import { HoldTab } from "./hold-tab";
import { CancelledTab } from "./cancelled-tab";
import { DetailPanel, type DetailActions } from "./detail-panel";
import { SearchBox, SearchHits } from "./search-box";
import { FilterSheet } from "./filter-sheet";
import { ConnectionStrip } from "./connection-strip";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";
import { useFloorRailPoll } from "@/lib/floor/use-floor-rail-poll";
import { toggleOne, toggleAll as toggleAllRows, isSelectable, type FloorSelection } from "@/lib/floor/selection";
import { railInScope, rowsInScope, scopeBoard } from "@/lib/floor/scope";
import { parseSearch, applySearch, searchReport, type Searchable } from "@/lib/floor/search";
import { applyFloorFilters, applyFlagFilters, EMPTY_FILTERS, type FloorFilters } from "@/lib/floor/filter";
import type { DispatchWindow } from "@/components/floor/dispatch-slot-picker";
import type { FloorRailCard, FloorScope, FloorBoardResult, FloorBoardRow, FloorPicker, FloorHoldRow, FloorCancelledRow, FloorDetailSource } from "@/lib/floor/types";
import type { RailSelection } from "./trip-rail";
import type { TripSummary, TripDetail } from "@/lib/trips/queries";
import type {
  DeliveryTypeOption,
  VehicleOption,
  TransporterOption,
  DispatchWindowOption,
} from "./build-trip-drawer";

/** The four dropdown lists the Build trip drawer needs, from /api/floor/trips/options. */
interface TripOptions {
  deliveryTypes: DeliveryTypeOption[];
  windows: DispatchWindowOption[];
  vehicles: VehicleOption[];
  transporters: TransporterOption[];
}

const SCOPES: FloorScope[] = ["All", "Local", "Upcountry", "IGT"];

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

// The three top tabs (design §3 — Floor / On hold / Cancelled).
type TopTab = "floor" | "hold" | "cancelled";

interface BoardData {
  rail: FloorRailCard[];
  floor: FloorBoardResult;
  pickers: FloorPicker[];
}

function istTodayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function addDaysIso(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// Every write route returns one of these shapes: { failed:[…] } for the batch
// routes (release/actions/picking-assign) or { error } for a hard reject. We read
// BOTH — a write that skipped silently must never look like success (the bug that
// hid the Hold-tab release no-op).
interface WriteBody {
  error?: string;
  failed?: Array<{ error?: string }>;
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

export function FloorPage() {
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
  // and the Show strip — three readings that must never disagree.
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
  // pool ("Not on a trip") or one trip. It lands on the pool — the planner's
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

  // ⚠ REFS, NOT DEPENDENCIES. `setSelection()` is asynchronous, so a handler
  // that closed over `selectedIds` would post the PREVIOUS selection if it fired
  // in the same tick as a tick-box change. Putting them in the dependency array
  // instead would rebuild every trip handler on every keystroke of a selection.
  // A ref reads the CURRENT value at call time and keeps the callbacks stable.
  const selectedIdsRef = useRef<number[]>([]);
  const tripsRef = useRef<TripSummary[] | null>(null);

  // Selection (design §7.8) — a Set of orderIds; survives a re-sort, cleared on
  // any tab/scope/date change below.
  const [selection, setSelection] = useState<FloorSelection>(new Set());

  const load = useCallback(async () => {
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
      // Board + hold + cancelled — three independent GET routes, fetched together
      // (parallel client fetches, not a prisma $transaction). Hold/Cancelled are
      // pure open states (no date anchor), so they ignore the history params.
      const [boardRes, holdRes, cancRes] = await Promise.all([
        fetch(`/api/floor/board?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/floor/hold?${UNSCOPED_QS}`, { cache: "no-store" }),
        fetch(`/api/floor/cancelled?${UNSCOPED_QS}`, { cache: "no-store" }),
      ]);
      if (!boardRes.ok) throw new Error(`HTTP ${boardRes.status}`);
      const board = await boardRes.json();
      setData({ rail: board.rail ?? [], floor: board.floor, pickers: board.pickers ?? [] });

      // A failed side feed must not blank the board — surface its own error and
      // leave the tab empty rather than throwing the whole page away.
      if (holdRes.ok) setHoldRows(((await holdRes.json()).rows ?? []) as FloorHoldRow[]);
      else { setHoldRows([]); setSideError(`Hold feed HTTP ${holdRes.status}`); }
      if (cancRes.ok) setCancelledRows(((await cancRes.json()).rows ?? []) as FloorCancelledRow[]);
      else { setCancelledRows([]); setSideError((prev) => prev ?? `Cancelled feed HTTP ${cancRes.status}`); }

      // The day's trips — a FOURTH feed, fetched here rather than by a poll of
      // its own, so the board and the bands can never describe different
      // moments. Anchored on the SAME day the board is showing: today in live
      // mode, the viewed day in History.
      //
      // A failure leaves the rail empty and does NOT blank the board — same
      // rule as the hold/cancelled feeds above (FLOOR §5: never throw the page
      // away over a side feed).
      //
      // 🔴 FETCHED FOR EVERYONE. It used to be skipped for a non-admin, because
      // By trip was an admin-only pivot option nobody else could reach. The trip
      // desk IS the Floor tab now, so skipping this would leave the rail empty
      // for every operator on the floor.
      {
        const tripDateParam =
          viewMode === "history" && histDate ? histDate : istTodayIso();
        try {
          const tripRes = await fetch(`/api/floor/trips?date=${tripDateParam}`, { cache: "no-store" });
          if (tripRes.ok) setTrips(((await tripRes.json()).trips ?? []) as TripSummary[]);
          else { setTrips([]); setSideError((prev) => prev ?? `Trips feed HTTP ${tripRes.status}`); }
        } catch {
          setTrips([]);
          setSideError((prev) => prev ?? "Trips feed unreachable");
        }
      }

      setLastSyncedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
      setHoldRows(null);
      setCancelledRows(null);
      setTrips(null);
    } finally {
      setLoading(false);
    }
    // `scope` is NOT here on purpose — every fetch is unscoped and the chips are
    // a pure client-side narrowing (scopedData below). Adding it back would
    // restore the 3-fetches-per-chip-click behaviour this change removed.
  }, [viewMode, histDate]);

  useEffect(() => {
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

  /** Add the ticked bills to an existing trip. */
  const addSelectionToTrip = useCallback(
    async (tripId: number) => {
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
        } else {
          const parts: string[] = [];
          if (attached.length > 0) parts.push(`${attached.length} added`);
          if (skipped.length > 0) parts.push(`${skipped.length} already on it`);
          if (parts.length > 0) toast.success(parts.join(", "));
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
    [load],
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
          const t = allTrips.find((x) => x.tripNumber === tripNumber);
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

  /** Confirm / Release a draft trip. The stored value is 'released' either way. */
  const releaseTrip = useCallback(
    async (tripId: number) => {
      setTripBusyId(tripId);
      try {
        const res = await fetch(`/api/floor/trips/${tripId}/release`, { method: "POST" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(`Could not release — ${body?.error ?? `HTTP ${res.status}`}`);
        } else {
          // 🔴 THE ROUTE'S REAL BUCKETS. This read `notWaiting` until 2026-09-10
          // and called it "already with a picker" — a key the release route
          // stopped returning when it was rewritten to do the FULL release
          // through releaseBillsToFloor(). `body.notWaiting` was therefore
          // always undefined, the `?? []` swallowed it, and that line of the
          // toast never appeared. What the route actually answers with:
          //
          //   released       moved onto the floor by this press
          //   alreadyVisible already on it — nothing to do, not a failure
          //   waitingForTint mid-tint, so DELIBERATELY not moved yet
          //   stamped        newly made visible to pickers (gate on only)
          //   failed         genuinely refused, reported below
          //
          // ⚠ `waitingForTint` IS NEVER SWALLOWED (FLOOR §6b). It is the one
          // bucket an operator has to act on — those bills come back to the trip
          // when tinting finishes, and a silent count would read as a release
          // that quietly did less than it said.
          const parts: string[] = [`${body?.trip?.tripNumber ?? "Trip"} ${gateOn ? "released" : "confirmed"}`];
          const released: number[] = body?.released ?? [];
          const already: number[] = body?.alreadyVisible ?? [];
          const waitingForTint: number[] = body?.waitingForTint ?? [];
          const stamped: number[] = body?.stamped ?? [];
          if (released.length > 0) parts.push(`${released.length} to the floor`);
          if (stamped.length > 0 && gateOn) parts.push(`${stamped.length} shown to pickers`);
          if (already.length > 0) parts.push(`${already.length} already there`);
          toast.success(parts.join(" · "));
          if (waitingForTint.length > 0) {
            toast.info(
              `${waitingForTint.length} bill${waitingForTint.length === 1 ? "" : "s"} still in tinting — ` +
                `${waitingForTint.length === 1 ? "it goes" : "they go"} to the floor when the tint is done`,
            );
          }
          const failed: Array<{ orderId: number; error: string }> = body?.failed ?? [];
          if (failed.length > 0) toast.error(`${failed.length} bill(s) not released — ${failed[0].error}`);
        }
      } catch {
        toast.error("Could not release — check your connection.");
      } finally {
        setTripBusyId(null);
      }
      setSelection(new Set());
      await load();
    },
    [load, gateOn],
  );

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
  const selectedRows = rows.filter((r) => selection.has(r.orderId));
  const selectedIds = selectedRows.map((r) => r.orderId);
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

  const onToggleRow = useCallback((id: number) => setSelection((s) => toggleOne(s, id)), []);
  const onToggleAll = useCallback((tableRows: FloorBoardRow[]) => setSelection((s) => toggleAllRows(s, tableRows)), []);

  // ── Bulk bar actions ──────────────────────────────────────────────────────
  // Bulk mark-urgent + bulk hold were RETIRED with the bulk-bar v2 rebuild —
  // urgent is now the per-row ⚡ (rowMarkUrgent → floor-table); hold is the detail
  // panel's ⋯ menu. Do not re-add them to the bar.
  // ── Show to the floor (2026-09-09) ────────────────────────────────────────
  // POSTs ONLY the selected bills that are actually at the desk, then clears the
  // selection and reloads.
  //
  // ⚠ THE REFETCH IS EXPLICIT AND MUST STAY EXPLICIT. This action happens WITH a
  // selection up, and the floor's live-sync poll is PAUSED while a selection is
  // up (FLOOR §5) — so nothing else is going to notice the write. Same reason
  // every other write on this page ends in `await load()`.
  //
  // ⚠ NO RETRY, EVER. The route makes exactly one orders.update per bill; a
  // client retry would make a second, and the markers key on
  // MAX(orders.updatedAt) — a duplicate write fires a false "changed" on every
  // board (FLOOR §10). A failure is reported and left to the operator.
  const [showBusy, setShowBusy] = useState(false);
  // ONE function, both directions — the request differs by a single boolean and
  // the reporting by three nouns, so two copies would be two places to fix the
  // day the wording or the bucket names change again.
  const setDeskVisibility = async (rows: FloorBoardRow[], visible: boolean) => {
    const ids = rows.map((r) => r.orderId);
    if (ids.length === 0 || showBusy) return;
    // Wording, chosen once so every branch below reads the same way.
    const verbFail = visible ? "Show" : "Send back";
    const didWord = visible ? "shown" : "sent back to desk";
    const alreadyWord = visible ? "already visible" : "already at desk";

    setShowBusy(true);
    try {
      const res = await fetch("/api/floor/pick-visible", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: ids, visible }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        changed?: number[];
        skipped?: number[];
        failed?: Array<{ error?: string }>;
        error?: string;
      };

      // ⚠ NOT reportWrite(). That helper knows two buckets (ok / failed) and this
      // route returns THREE, so it would have to call a skip a success with no
      // detail — and the number on screen would then not match what happened.
      // A skipped bill was already in the requested state: a success, but nothing
      // was written to it, and saying "15 shown" when 3 were already shown is a
      // lie the operator would only catch by counting rows himself.
      const changed = body.changed?.length ?? 0;
      const skipped = body.skipped?.length ?? 0;
      const failed = body.failed ?? [];

      if (!res.ok) {
        // 422 = every bill was refused and nothing was written.
        toast.error(
          body.error
            ? `${verbFail} failed — ${body.error}`
            : `${verbFail} failed — none of the ${ids.length} bill${ids.length === 1 ? " was" : "s were"} changed.`,
        );
      } else {
        const parts: string[] = [];
        if (changed > 0) parts.push(`${changed} ${didWord}`);
        if (skipped > 0) parts.push(`${skipped} ${alreadyWord}`);
        if (parts.length > 0) toast.success(parts.join(", "));
        // Surfaced separately and never swallowed — a partial success that
        // reports only its successes is the swallowed-response bug FLOOR §6(b)
        // closed on the release path. On the reverse path the usual cause is the
        // race the route's stage guard exists for: a supervisor assigned the bill
        // while the operator was ticking it.
        if (failed.length > 0) {
          const reason = failed[0]?.error ?? "not valid at its current state";
          toast.error(
            `${failed.length} bill${failed.length === 1 ? "" : "s"} not changed — ${reason}`,
          );
        }
      }
    } catch {
      toast.error(`${verbFail} failed — check your connection.`);
    } finally {
      setShowBusy(false);
    }
    clearSelection();
    await load();
  };

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

  // ── Hold tab: bulk release → the floor (reuses the Step-3 release route). ──
  // Each ticked bill gets the SAME chosen date+window; the route advances it to
  // pending_picking with dispatchStatus="dispatch", so it leaves Hold and lands
  // on the floor like any other released bill. A held-after-auto-dispatch bill is
  // already at pending_picking — accepted via FLOOR_RELEASABLE_STAGES.
  const holdRelease = useCallback(
    async (orderIds: number[], date: string, windowId: number) => {
      const releases = orderIds.map((orderId) => ({ orderId, dispatchTargetDate: date, dispatchWindowId: windowId }));
      const r = await postJson("/api/floor/release", { releases });
      reportWrite("Release", r);
      await load();
    },
    [load],
  );

  // ── Cancelled tab: bulk restore → back to the left rail (Step-5 actions). ──
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
      rail: railInScope(data.rail, scope),
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
    const due = fRows.filter((r) => r.zone !== "upcoming");
    const windows = scopedData.floor.windows.map((w) => ({ ...w, count: due.filter((r) => r.windowId === w.id).length }));
    return { ...scopedData.floor, rows: fRows, windows, total: due.length };
  }, [scopedData, parsed, filters]);

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
  const searchableFloorRows = useMemo(
    () => scopedData?.floor.rows ?? [],
    [scopedData],
  );
  const activePool: Searchable[] = topTab === "floor" ? searchableFloorRows : topTab === "hold" ? scopedHold ?? [] : scopedCancelled ?? [];
  const tabSearchReport = useMemo(() => searchReport(activePool, parsed), [activePool, parsed]);

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
        const ids = applySearch(scopedData.floor.rows, p)
          .filter(isSelectable)
          .map((r) => r.orderId);
        setSelection(new Set(ids));
      } else {
        setSelection(new Set());
      }
    },
    [topTab, scopedData],
  );
  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSelection(new Set());
  }, []);

  // ── Detail panel (design §10) — open state + single-bill action handlers ──
  // Additive wiring only: the panel is mounted at the end; every write REUSES an
  // existing route through reportWrite (no swallowed response, no new route).
  const [detail, setDetail] = useState<{ orderId: number; source: FloorDetailSource } | null>(null);
  const openDetail = useCallback((orderId: number, src: FloorDetailSource) => setDetail({ orderId, source: src }), []);
  const closeDetail = useCallback(() => setDetail(null), []);
  const navigateDetail = useCallback((orderId: number) => setDetail((d) => (d ? { ...d, orderId } : d)), []);

  // The list Prev/Next walks — whichever source the panel was opened from
  // (design §10.5). Rebuilt on every board reload so it tracks the live order.
  // Prev/Next walks the VISIBLE (searched/filtered) list of the source surface,
  // except the rail which is never filtered (design §6.1).
  const detailList = useMemo<number[]>(() => {
    if (!detail) return [];
    switch (detail.source) {
      case "rail":
        return (scopedData?.rail ?? []).map((c) => c.orderId);
      // Both floor sources walk the SAME list, and that is already the right
      // one for either: `filteredFloor` is derived from `scopedData.floor.rows`,
      // which IS the history payload in history mode. So Prev/Next steps
      // through the viewed day's rows and can never reach a live row — the two
      // never coexist in one payload.
      case "floor":
      case "history":
        // Every row the desk lists, upcoming included (2026-09-10 b). The pager
        // must not be stricter than a tap: an upcoming row is openable from the
        // list, so Prev/Next has to be able to reach it and leave it.
        return (filteredFloor?.rows ?? []).map((r) => r.orderId);
      case "hold":
        return (filteredHold ?? []).map((r) => r.orderId);
      case "cancelled":
        return (filteredCancelled ?? []).map((r) => r.orderId);
    }
  }, [detail, scopedData, filteredFloor, filteredHold, filteredCancelled]);

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
  const detailHasDuplicateSo = useMemo(() => {
    if (!detail) return false;
    const railHit = (data?.rail ?? []).find((c) => c.orderId === detail.orderId);
    if (railHit) return railHit.hasDuplicateSo;
    return (data?.floor.rows ?? []).find((r) => r.orderId === detail.orderId)?.hasDuplicateSo ?? false;
  }, [detail, data]);

  const detailActions: DetailActions = useMemo(
    () => ({
      onRelease: async (orderId, date, windowId) => {
        const r = await postJson("/api/floor/release", { releases: [{ orderId, dispatchTargetDate: date, dispatchWindowId: windowId }] });
        reportWrite("Release", r);
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
      onCancel: async (orderId) => {
        reportWrite("Cancel", await postJson("/api/floor/actions", { action: "cancel", orderIds: [orderId] }));
        await load();
      },
      onUnassign: async (orderId) => {
        reportWrite("Unassign", await postJson("/api/picking/unassign", { orderId }));
        await load();
      },
    }),
    [load, data],
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
  const isLive = viewMode === "live";

  // Single Esc owner — lifted out of detail-panel so exactly ONE action fires per
  // press and only ONE listener exists: panel open → close it (selection kept);
  // else a live selection → clear it; else nothing. Ignored while focus is in a
  // field / native control so Esc never wipes a selection mid-type (ship-to
  // search, far-date box, picker dropdown).
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // A DispatchSlotPicker popover is open (its portalled root carries this
      // marker only while open) — leave it to outside-click, as today.
      if (document.querySelector('[data-slot-popover="open"]')) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (detailOpen) closeDetail();
      else if (selection.size > 0) clearSelection();
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [detailOpen, selection, closeDetail, clearSelection]);

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
      // 🔴 NO ZONE TERM (2026-09-10 b). This read
      // `r.zone !== "upcoming" && isSelectable(r)` while upcoming bills were off
      // screen entirely. They are rows in the pool now, and they can be ticked
      // and put on a trip — so the old test would have dropped every upcoming
      // tick on the next 15-second marker and told the operator his bills had
      // "changed elsewhere", which would have been false and unfixable.
      //
      // `isSelectable` alone is the right question and always was: it asks
      // whether the BILL can be acted on, which has nothing to do with which day
      // it is promised for.
      const stillSelectable = new Set<number>(
        (board.floor?.rows ?? [])
          .filter((r: FloorBoardRow) => isSelectable(r))
          .map((r: FloorBoardRow) => r.orderId),
      );
      setSelection((prev) => {
        const next = new Set<number>();
        let dropped = 0;
        for (const id of Array.from(prev)) {
          if (stillSelectable.has(id)) next.add(id);
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

  // FLOOR — the Picking pattern: use-picking-marker, pointed at the floor's OWN
  // marker (/api/floor/marker) via the optional `url` param, so it watches the
  // floor's EXACT set (getFloorLiveMarkerWhere) — no silent dependence on what
  // picking's openPending scope means. `scope` is required by the hook's type but
  // ignored by the floor marker route (fixed set). `onProbe` feeds the connection
  // strip off this same 15s poll — one probe powers both. Deferred while the
  // detail panel is open or in read-only history.
  usePickingMarker({
    scope: "openPending",
    url: "/api/floor/marker",
    paused: !isLive || detailOpen,
    onProbe: setConnected,
    onChange: () => {
      if (!isLive) return;
      // Rule 2: never move the ground while rows are selected — reconcile the
      // ticks only. Rule 1: otherwise refresh in place (rows keyed by orderId).
      if (selection.size > 0) void reconcileSelection();
      else void load();
    },
  });

  // RAIL — the Mail Orders pattern: a 30s full refetch. Paused while a selection
  // is up or the panel is open (a refetch would move the floor ground) or history.
  useFloorRailPoll({
    paused: !isLive || detailOpen || selection.size > 0,
    onTick: () => void load(),
  });

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
  // Only DRAFT and CONFIRMED trips can take bills — the routes refuse a
  // dispatched or cancelled one, and offering it would offer a guaranteed 409.
  const attachableTrips = useMemo(
    () => (trips ?? []).filter((t) => t.status === "draft" || t.status === "released"),
    [trips],
  );
  // The delivery type every ticked bill agrees on, or null. Seeds the New trip
  // form so the common case — a planner ticking one route’s bills and pressing
  // New trip… — needs no answer to a question he has already answered.
  //
  // ⚠ NULL ON A MIXED SELECTION, deliberately. There is no majority rule here:
  // an Upcountry bill on a Local trip is a real dispatch error, and a form that
  // guessed would make it silently.
  const seedDeliveryTypeId = useMemo<number | null>(() => {
    const names = new Set(selectedRows.map((r) => r.deliveryType));
    if (names.size !== 1) return null;
    const name = Array.from(names)[0];
    const match = tripOptions?.deliveryTypes.find((d) => d.name === name);
    return match?.id ?? null;
  }, [selectedRows, tripOptions]);

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

  // A short reminder of what the selection is sitting on. Reads off the rail,
  // for the same reason `barMode` does.
  const barContextLabel = useMemo(() => {
    if (railSelection.kind !== "trip") return null;
    const t = (trips ?? []).find((x) => x.id === railSelection.tripId);
    return t ? `on ${t.tripNumber}` : null;
  }, [railSelection, trips]);

  // Tab counts reflect the searched/filtered set of each surface (they equal the
  // full totals when no search/filter is active).
  const floorCount = filteredFloor?.total ?? 0;
  const holdCount = filteredHold?.length ?? 0;
  const cancelledCount = filteredCancelled?.length ?? 0;

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
  const waitingCount = useMemo(
    () => (filteredFloor ? countByStatus(filteredFloor.rows.filter((r) => r.zone !== "upcoming")).waiting : 0),
    [filteredFloor],
  );

  // ── The visibility gate (2026-09-09) ──────────────────────────────────────
  // "N not shown" for the header switch, counted off the rows this screen
  // ALREADY has. Same slice `waitingCount` above uses (due rows of the filtered
  // floor) so the two numbers describe the same board, and through isHeldBack()
  // rather than a hand-written `!isAssigned && pickVisibleAt === null` — that
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

  // The two groups inside the selection the desk strip acts on. Each button
  // sends ONLY its own ids — never the whole selection: an already-visible bill
  // on the Show path would come back under `skipped` and inflate the number
  // reported to the operator, and an assigned one would come back under `failed`
  // for a request nobody made.
  //
  // BOTH are computed on every render because a selection routinely spans both
  // states — the operator ticks by eye, in bulk — and the strip offers whichever
  // actions apply, including both at once.
  const selectedHeldBack = useMemo(
    () => selectedRows.filter((r) => isHeldBack(r)),
    [selectedRows],
  );
  // Waiting AND already handed over: the reverse group. `rowStatus === "waiting"`
  // is the same half of isHeldBack()'s rule, negated on the stamp only — an
  // assigned or picked bill belongs to neither group, because the route refuses
  // it in both directions and offering it would be offering a guaranteed error.
  const selectedShown = useMemo(
    () => selectedRows.filter((r) => rowStatus(r) === "waiting" && r.pickVisibleAt !== null),
    [selectedRows],
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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
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
        <PickGateToggle enabled={gateEnabled} heldBackCount={heldBackCount} onChanged={setGateEnabled} />
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
          <FilterSheet filters={filters} onChange={setFilters} showStatus={topTab === "floor"} />
        </div>
      </div>

      {/* Search results strip (design §5.2) — describes the OPEN tab's matches. */}
      <SearchHits parsed={parsed} report={tabSearchReport} onClear={clearSearch} />

      {/* Connection strip (design §13) — only in live mode; renders only when the
          server is unreachable. A strip, never a modal — the board stays readable. */}
      {isLive && <ConnectionStrip connected={connected} lastSyncedAt={lastSyncedAt} />}

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
        {/* Tabs + desk + (bulk bar overlay). */}
        <div className="relative flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center gap-[18px] border-b border-gray-200 bg-white px-3.5">
            {/* Floor + its waiting readout as ONE unit: a tight 8px gap binds the
                label to the badge it qualifies while the row's own 18px gap still
                separates it from "On hold" — spaced like a fourth tab it would read
                as one. Plain grey inline stats (CLAUDE_UI §4), NOT a second pill:
                the badge next door is already a filled one. NOT teal either — teal
                on this row is the New trip button alone (CLAUDE_UI §6 colour
                rule). It sits OUTSIDE the tab button on purpose: it reports, it is
                not a fourth thing to click.

                Rendered on the pool and on a trip alike — it is a floor-wide
                number, not a reading of whatever the middle happens to be showing.
                Shown at ZERO deliberately: "0 waiting" is the good state and worth
                saying out loud. */}
            <span className="flex items-center gap-2">
              {tabPill("floor", "Floor", floorCount)}
              <span className="text-[11px] text-gray-400" title="Bills on the floor with no picker assigned yet">
                <span className="font-semibold tabular-nums text-gray-700">{waitingCount}</span> waiting
              </span>
            </span>
            {tabPill("hold", "On hold", holdCount)}
            {tabPill("cancelled", "Cancelled", cancelledCount)}

            {/* 🔴 THE VIEW PIVOT IS GONE (2026-09-10) — Flat, By route, By trip,
                By group, By picker, and with it the ⏳ admin-only clause that hid
                the By trip entry from everyone but an admin. Flat / By route
                survive INSIDE the desk, on the pool where they still mean
                something; the other three were views of a board that no longer
                exists.

                What takes the space is the one thing the planner starts with. It
                is this row's only filled control (CLAUDE_UI §1) and it is
                hidden in History, where a past day is a record and a new trip on
                it would be a fiction. */}
            {topTab === "floor" && isLive && (
              <button
                type="button"
                onClick={() => void openTripForm([])}
                className="ml-auto inline-flex h-[27px] items-center gap-1.5 rounded-[7px] bg-brand-600 px-3 text-[11.5px] font-semibold text-white hover:bg-brand-700"
              >
                <span className="text-[13px] leading-none">+</span> New trip
              </button>
            )}
          </div>

          {topTab === "floor" ? (
            loading && !data ? (
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
                onSelectRail={setRailSelection}
                histDate={histDate}
                onEnterHistory={enterHistory}
                onExitHistory={exitHistory}
                onStepHistory={stepHistory}
                rowSelection={selection}
                onToggleRow={onToggleRow}
                onToggleAll={onToggleAll}
                onMarkUrgent={rowMarkUrgent}
                tripBusyId={tripBusyId}
                onReleaseTrip={(id) => void releaseTrip(id)}
                onChangeVehicle={(id) => void openVehicleEditor(id)}
                onCancelTrip={(id) => void cancelTrip(id)}
                // The SAME desk renders live and history, so the source is
                // decided here by the view (2026-08-25). "history" is the
                // read-only source — it suppresses every action in the panel
                // (detail-panel's `readOnly`). `isLive` is the one flag this
                // screen already uses for the live/history split (the sync
                // pauses key off it), so the panel can never disagree with the
                // desk about which day it is showing.
                onOpenDetail={(id) => openDetail(id, isLive ? "floor" : "history")}
              />
            ) : null
          ) : topTab === "hold" ? (
            <HoldTab
              rows={filteredHold}
              loading={loading && filteredHold === null}
              error={error ?? sideError}
              scope={scope}
              windows={dispatchWindows}
              onRelease={holdRelease}
              onOpenDetail={(id) => openDetail(id, "hold")}
            />
          ) : (
            <CancelledTab
              rows={filteredCancelled}
              loading={loading && filteredCancelled === null}
              error={error ?? sideError}
              scope={scope}
              onRestore={cancelledRestore}
              onOpenDetail={(id) => openDetail(id, "cancelled")}
            />
          )}

          {/* The Show strip (2026-09-09) — ABOVE the bottom bar, never inside
              it. It is a different job: the bar moves bills between the pool and
              a trip, this hands them to the floor's PICKERS.

              THREE conditions, all required: the gate is on, the selection holds
              at least one bill EITHER direction can act on, and `barVisible` —
              the SAME flag the bottom bar uses. Reusing that flag is load-bearing
              twice: the strip is positioned off the bar's 60px, so a strip
              without a bar would float over the last table row; and barVisible
              already carries the live/history and tab rules, which the strip
              needs identically and must not restate.

              Gate off → `gateOn` is false → nothing renders and this subtree
              does not exist. */}
          {gateOn && barVisible && selectedHeldBack.length + selectedShown.length > 0 && (
            <div className="absolute inset-x-0 bottom-[60px] z-20">
              <ShowStrip
                notShownCount={selectedHeldBack.length}
                shownCount={selectedShown.length}
                busy={showBusy}
                onShow={() => void setDeskVisibility(selectedHeldBack, true)}
                onSendBack={() => void setDeskVisibility(selectedShown, false)}
              />
            </div>
          )}

          {/* ONE BAR. The assign bar (Change slot · Choose picker · Assign) and
              the trip selection bar (Remove from trip) were two components at
              the same bottom-0, picked between by a rows test. Both are gone;
              floor-bottom-bar.tsx does the one job that is left, and reads which
              question to ask off the rail. */}
          {barVisible && (
            <FloorBottomBar
              count={selectedRows.length}
              litres={formatLitres(sumLitres(selectedRows))}
              weight={formatWeightKg(selectionWeight.kg)}
              weightIsPartial={selectionWeight.unknown > 0}
              articles={selectionArticles}
              routes={selectionRoutes}
              mode={barMode}
              trips={attachableTrips}
              busy={tripBarBusy || tripBusyId !== null}
              onAddToTrip={(id) => void addSelectionToTrip(id)}
              onNewTripWithSelection={() => void openTripForm(selectedIds)}
              onRemoveFromTrip={() => void removeSelectionFromTrips(selectedRows)}
              onClear={clearSelection}
              contextLabel={barContextLabel}
            />
          )}
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
          // Pre-select the type when every ticked bill agrees, and leave it for
          // the operator when they do not — guessing on a mixed selection would
          // put a local bill on an upcountry trip without saying so.
          seedDeliveryTypeId={seedDeliveryTypeId}
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
          list={detailList}
          windows={dispatchWindows}
          pickers={data?.pickers ?? []}
          actions={detailActions}
          onClose={closeDetail}
          onNavigate={navigateDetail}
        />
      )}
    </div>
  );
}
