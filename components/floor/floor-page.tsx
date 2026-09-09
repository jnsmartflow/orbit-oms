"use client";

// Floor Control composition root. Step 5 adds SELECTION + the assignment bar +
// the mutation wiring. Additive only: the header, the rail and the board layout
// are unchanged; floor-page owns the selection Set and every write handler.
//
// Assignment reuses the EXISTING Picking endpoints unchanged:
//   Assign/Reassign → (unassign any already-assigned) then /api/picking/assign
//   Unassign        → /api/picking/unassign
// The five state actions (mark-urgent · change-slot · hold · cancel · restore)
// go through /api/floor/actions. Rail Hold/✕ and the row ⚡ are wired here too.

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { FloorRail } from "./floor-rail";
import { FloorBoard } from "./floor-board";
import { AssignContextBanner } from "./assign-context-banner";
import { BuildTripDrawer } from "./build-trip-drawer";
import { rowStatus, countByStatus, isHeldBack } from "./status-pill";
import { PickGateToggle } from "./pick-gate-toggle";
import { ShowStrip } from "./show-strip";
import { FloorSkeleton } from "./floor-skeleton";
import { AssignBar } from "./assign-bar";
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
import type { RailReleaseSlot } from "./rail-card";
import type { DispatchWindow } from "@/components/floor/dispatch-slot-picker";
import type { FloorRailCard, FloorScope, FloorBoardResult, FloorBoardRow, FloorPicker, FloorHoldRow, FloorCancelledRow, FloorDetailSource } from "@/lib/floor/types";
import type { SlotTabKey } from "./floor-tabs";
import type { TripSummary } from "@/lib/trips/queries";
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

// The view the board opens on, and the view closing an assign context returns
// to. One definition so the two can never drift apart.
const DEFAULT_VIEW_MODE = "route" as const;

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
  const [slotTab, setSlotTab] = useState<SlotTabKey>("10:30");
  // The board LANDS on DEFAULT_VIEW_MODE — currently "route" (changed
  // 2026-08-27, commit 8468297a). Closing an assign context returns to the same
  // constant, so the landing view and the exit view can never drift apart:
  // change the constant and both move together.
  //
  // Previously landed on the picker grid (2026-08-11), on the reasoning that the
  // desk operator's first question of the day is "who is free"; superseded
  // 2026-08-27. Recorded so it is not rediscovered as a new idea.
  //
  // "picker" is the odd one out mechanically: flat/route pivot the CURRENT slot
  // tab, picker ignores it entirely — see floor-board.tsx's branch. "group"
  // (2026-08-17) is the second of that kind and ignores the slot tab for a
  // stronger reason: bundles deliberately span slots and dates, so a slot filter
  // would cut most of them in half. With the landing view now "route", the slot
  // tab matters on first paint where under the picker default it did not.
  const [mode, setMode] = useState<"flat" | "route" | "picker" | "group" | "trip">(DEFAULT_VIEW_MODE);
  const [viewMode, setViewMode] = useState<"live" | "history">("live");
  const [histDate, setHistDate] = useState<string | null>(null);

  // ── Assign context (2026-08-11) ────────────────────────────────────────────
  // Set by tapping a card in the By-picker grid: "I am deciding what to give
  // THIS person." null is the ordinary board and every consumer short-circuits
  // on it, so nothing below changes shape when it is unset.
  //   pending → the waiting bills he could be given (selectable, assignable)
  //   current → what is already in his hands (read-only, just for context)
  const [assignContext, setAssignContext] = useState<number | null>(null);
  const [contextMode, setContextMode] = useState<"pending" | "current">("pending");

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
  const [tripDrawerOpen, setTripDrawerOpen] = useState(false);
  const [tripOptions, setTripOptions] = useState<TripOptions | null>(null);

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
      // A failure leaves the bands empty and does NOT blank the board — same
      // rule as the hold/cancelled feeds above (FLOOR §5: never throw the page
      // away over a side feed).
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
  // `assignContext`/`contextMode` join the list for the same reason the others
  // are on it: each one changes WHICH ROWS ARE ON SCREEN, and a tick surviving
  // that change means assigning a bill the operator can no longer see.
  useEffect(() => {
    setSelection(new Set());
  }, [slotTab, scope, viewMode, histDate, topTab, assignContext, contextMode]);

  const clearSelection = () => setSelection(new Set());

  // Drop the assign context whenever its premise goes away. Leaving the Floor
  // tab or stepping into History both mean "the operator is no longer handing
  // work to anybody" — History is a read-only past day where assigning is not
  // even possible.
  useEffect(() => {
    if (topTab !== "floor" || viewMode !== "live") {
      setAssignContext(null);
      setContextMode("pending");
    }
  }, [topTab, viewMode]);

  // Which view a given context reading belongs in. ONE rule, used by the picker
  // card and by the banner's toggle, so the band and the board below it can
  // never describe different questions:
  //   pending → By GROUP. "What can I give this man" is exactly the question
  //             bundling answers, and handing him a bundle is one press.
  //   current → By ROUTE. Grouping is meaningless on bills already assigned;
  //             they are not candidates for anything.
  const viewForContext = (m: "pending" | "current") => (m === "pending" ? "group" : "route");

  // Tapping a picker card. `initialMode` comes from the CARD's own status
  // (floor-board derives it with pickerCardStatus, the same rule that coloured
  // the card): a busy picker opens on what he is holding, a free one on what he
  // could be given. The toggle in the banner still moves between the two — this
  // only decides which loads.
  const openAssignContext = useCallback((pickerId: number, initialMode: "pending" | "current") => {
    setAssignContext(pickerId);
    setContextMode(initialMode);
    setMode(viewForContext(initialMode));
  }, []);

  // Back to the grid. Both exits (the banner's Done and the "By picker" button)
  // land here so there is one definition of what leaving the context means.
  const closeAssignContext = useCallback(() => {
    setAssignContext(null);
    setContextMode("pending");
    setMode(DEFAULT_VIEW_MODE);
  }, []);

  // The banner's pending/current toggle moves the VIEW with the reading, by the
  // same rule the picker card uses — otherwise the band would say "what he's
  // holding" over a board showing bundles of unassigned bills.
  const toggleContextMode = useCallback(() => {
    setContextMode((m) => {
      const next = m === "pending" ? "current" : "pending";
      setMode(viewForContext(next));
      return next;
    });
  }, []);

  // The By-group CHIP. It does NOT clear the assign context — reversed from the
  // first cut of this view. The precedent on this screen already settles it: the
  // existing "pending" reading shows FLOOR-WIDE waiting bills while the banner
  // names one picker. The view is not scoped to a person; the ACTION is, and the
  // banner announces the action. Entering from the chip with nobody chosen is
  // the same view with no banner and a select-only header button.
  const openGroupMode = useCallback(() => {
    setContextMode("pending");
    setMode("group");
  }, []);

  // ── By trip ───────────────────────────────────────────────────────────────
  // A PLAIN setMode, and deliberately its own branch in the toggle below.
  // "picker" routes through closeAssignContext (it IS the way back to the grid)
  // and "group" through openGroupMode (it drops the context); "trip" does
  // neither — it is an ordinary view with no context of its own, so routing it
  // through either would silently clear an assign context the operator had not
  // asked to leave.
  const openTripMode = useCallback(() => {
    setMode("trip");
  }, []);

  // The Build trip drawer's dropdown lists. Fetched ONCE, lazily, the first time
  // the drawer opens — four static master-data lists have no business on the
  // 15-second board reload, and most sessions never open the drawer at all.
  const openTripDrawer = useCallback(async () => {
    setTripDrawerOpen(true);
    if (tripOptions !== null) return;
    try {
      const res = await fetch("/api/floor/trips/options", { cache: "no-store" });
      if (res.ok) {
        setTripOptions((await res.json()) as TripOptions);
      } else {
        // CLOSE AGAIN on failure. The drawer renders only once its options have
        // landed, so leaving it "open" with nothing loaded would show the
        // operator an empty screen and a toast he may have missed.
        setTripDrawerOpen(false);
        toast.error(`Could not load the trip form — HTTP ${res.status}`);
      }
    } catch {
      setTripDrawerOpen(false);
      toast.error("Could not load the trip form — check your connection.");
    }
  }, [tripOptions]);

  // After a create. The selection is cleared and the board refetched EXPLICITLY:
  // the live-sync poll is paused while a selection is up (FLOOR §5), so leaving
  // the refresh to it would leave the new trip off screen until the operator
  // clicked something else. Same shape as the Show strip's own handler.
  const onTripCreated = useCallback(async () => {
    setTripDrawerOpen(false);
    setSelection(new Set());
    await load();
  }, [load]);

  // UNSCOPED on purpose — this only resolves already-SELECTED ids into rows for
  // the bulk bar, and a selection can only ever hold in-scope ids (it is cleared
  // on every scope change by the effect above). Reading the unscoped set keeps
  // the bar populated for the one render between a chip click and that clear,
  // which is exactly how it behaved when a chip click refetched.
  const rows = data?.floor.rows ?? [];
  const selectedRows = rows.filter((r) => selection.has(r.orderId));
  const selectedIds = selectedRows.map((r) => r.orderId);

  // ── Release + rail actions ────────────────────────────────────────────────
  const handleRelease = useCallback(
    async (orderId: number, slot: RailReleaseSlot) => {
      const r = await postJson("/api/floor/release", { releases: [{ orderId, ...slot }] });
      reportWrite("Release", r);
      await load();
    },
    [load],
  );
  const railHold = useCallback(
    async (orderId: number) => {
      const r = await postJson("/api/floor/actions", { action: "hold", orderIds: [orderId] });
      reportWrite("Hold", r);
      await load();
    },
    [load],
  );
  const railCancel = useCallback(
    async (orderId: number) => {
      const r = await postJson("/api/floor/actions", { action: "cancel", orderIds: [orderId] });
      reportWrite("Cancel", r);
      await load();
    },
    [load],
  );

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

  const bulkChangeSlot = async (date: string, windowId: number) => {
    if (selectedIds.length === 0) return;
    const r = await postJson("/api/floor/actions", { action: "change-slot", orderIds: selectedIds, dispatchTargetDate: date, dispatchWindowId: windowId });
    reportWrite("Change slot", r);
    clearSelection();
    await load();
  };

  // Assignment REUSES the Picking endpoints unchanged. Assign/Reassign = put
  // every selected bill under the chosen picker: unassign any already-assigned
  // ones first (so they are back at pending_picking), then one assign batch.
  //
  // ⚠ `explicitIds` CLOSES A RACE, it is not a convenience. The By-group header
  // button selects a group and assigns it in ONE press; `setSelection()` is
  // asynchronous, so a handler that called it and then read `selectedIds` would
  // post the PREVIOUS selection. The group passes its own ids straight down and
  // this function never has to wait for state to commit. Omitted (the assign
  // bar, the detail panel) it reads the live selection exactly as before.
  const bulkAssign = async (pickerId: number, explicitIds?: number[]) => {
    // Resolve against the UNSCOPED rows for the same reason onReassign does:
    // "is this bill already assigned" is a property of the bill, not of the chip
    // in view. A bill that vanished between render and click simply is not found
    // and drops out — the server would have rejected it into `failed[]` anyway.
    const targetRows = explicitIds
      ? rows.filter((r) => explicitIds.includes(r.orderId))
      : selectedRows;
    if (targetRows.length === 0) return;
    const targetIds = targetRows.map((r) => r.orderId);

    const alreadyAssigned = targetRows.filter((r) => r.isAssigned).map((r) => r.orderId);
    for (const orderId of alreadyAssigned) {
      reportWrite("Unassign", await postJson("/api/picking/unassign", { orderId }));
    }
    // ONE call for the whole group — the existing batch endpoint, unchanged.
    reportWrite("Assign", await postJson("/api/picking/assign", { orderIds: targetIds, pickerId }));
    clearSelection();
    await load();
  };

  // By-group one-press assign. Ticks the group (so the operator sees what went)
  // and assigns it, passing the ids EXPLICITLY so the write cannot depend on
  // that tick having landed. Nothing is hand-removed from the view afterwards:
  // `load()` refetches and the bills leave the waiting set because they are no
  // longer waiting, which is the honest reason. Failures surface through
  // reportWrite — a non-empty `failed[]` raises a toast rather than reading as
  // success (FLOOR §6b is the bug that rule came from).
  const assignGroup = async (orderIds: number[], pickerId: number) => {
    setSelection(new Set(orderIds));
    await bulkAssign(pickerId, orderIds);
  };
  // (bulkUnassign was retired with the bulk-bar v2 rebuild — the bar keeps
  // reassign-to-picker via bulkAssign; per-bill Unassign stays in the panel ⋯.)

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

  // ── Assign-context derivations ─────────────────────────────────────────────
  // Name: roster first, then any row the picker holds (an orphan — a pickerId
  // still carrying bills whose user account was deactivated is off the roster
  // but must not become "#42" on screen), then the id as a last resort.
  const contextPickerName = useMemo<string | null>(() => {
    if (assignContext === null) return null;
    const rostered = data?.pickers.find((p) => p.id === assignContext)?.name;
    if (rostered) return rostered;
    const fromRow = (data?.floor.rows ?? []).find((r) => r.pickerId === assignContext)?.assignedToName;
    return fromRow ?? `Picker #${assignContext}`;
  }, [assignContext, data]);

  // Banner counts. Derived from `filteredFloor` — the SAME rows FloorBoard sees
  // — and with rowStatus(), the same predicate it filters on, so the number in
  // the banner and the number of rows below it cannot disagree.
  const contextCounts = useMemo(() => {
    const due = (filteredFloor?.rows ?? []).filter((r) => r.zone !== "upcoming");
    let pending = 0;
    let current = 0;
    for (const r of due) {
      const st = rowStatus(r);
      if (st === "waiting") pending++;
      else if (r.pickerId === assignContext && (st === "withPicker" || st === "needsCheck")) current++;
    }
    return { pending, current };
  }, [filteredFloor, assignContext]);

  // "What he's holding" is a look, not a workspace — no ticks, so no bulk bar.
  const contextReadOnly = assignContext !== null && contextMode === "current";

  // The rail is NEVER filtered (design §6.1) — it is the undecided pile and must
  // stay complete. Search only HIGHLIGHTS matching rail cards.
  const railHighlightIds = useMemo<Set<number>>(() => {
    if (parsed.mode === "none" || !scopedData) return new Set<number>();
    return new Set(applySearch(scopedData.rail, parsed).map((c) => c.orderId));
  }, [parsed, scopedData]);

  // The open tab's pool + report for the hits strip (chips / summary). Scoped,
  // so the hit counts describe the chip the operator is actually looking at.
  const dueFloorRows = useMemo(
    () => (scopedData?.floor.rows ?? []).filter((r) => r.zone !== "upcoming"),
    [scopedData],
  );
  const activePool: Searchable[] = topTab === "floor" ? dueFloorRows : topTab === "hold" ? scopedHold ?? [] : scopedCancelled ?? [];
  const tabSearchReport = useMemo(() => searchReport(activePool, parsed), [activePool, parsed]);

  const commitSearch = useCallback(
    (raw: string) => {
      setSearchQuery(raw);
      const p = parseSearch(raw);
      // Auto-tick (design §5.2) — ONLY on the Floor tab, and ONLY selectable rows
      // (Waiting / With picker, Step 5). A pasted number matching a Done or
      // Needs-check row is still found + shown, but never ticked.
      if (p.mode === "numbers" && topTab === "floor" && scopedData) {
        const due = scopedData.floor.rows.filter((r) => r.zone !== "upcoming");
        const ids = applySearch(due, p).filter(isSelectable).map((r) => r.orderId);
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
        return (filteredFloor?.rows ?? []).filter((r) => r.zone !== "upcoming").map((r) => r.orderId);
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
      const stillSelectable = new Set<number>(
        (board.floor?.rows ?? [])
          .filter((r: FloorBoardRow) => r.zone !== "upcoming" && isSelectable(r))
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

  const barVisible = topTab === "floor" && viewMode === "live" && selection.size > 0 && data !== null && !contextReadOnly;

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

      {/* ── Body — left rail (344px) + right main. ───────────────────────── */}
      <div className="grid min-h-0 flex-1 overflow-hidden" style={{ gridTemplateColumns: "344px 1fr" }}>
        <FloorRail
          cards={scopedData?.rail ?? null}
          loading={loading}
          error={error}
          scope={scope}
          floorTotal={scopedData?.floor.total ?? 0}
          windows={dispatchWindows}
          onRelease={handleRelease}
          onHold={railHold}
          onCancel={railCancel}
          onShowAll={() => setScope("All")}
          onOpenDetail={(id) => openDetail(id, "rail")}
          highlightIds={railHighlightIds}
        />

        {/* Right main — tabs + board + (bulk bar overlay). */}
        <div className="relative flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center gap-[18px] border-b border-gray-200 bg-white px-3.5">
            {/* Floor + its waiting readout as ONE unit: a tight 8px gap binds the
                label to the badge it qualifies while the row's own 18px gap still
                separates it from "On hold" — spaced like a fourth tab it would read
                as one. Plain grey inline stats (CLAUDE_UI §4), NOT a second pill:
                the badge next door is already a filled one. NOT teal either — teal
                on this screen is the active slot tab alone (CLAUDE_UI §6 colour
                rule). It sits OUTSIDE the tab button on purpose: it reports, it is
                not a fifth thing to click.

                Rendered in every view mode, By group included — that view's own
                strip is untouched and states the same number for the same set, so
                the two agree rather than compete. Shown at ZERO deliberately: "0
                waiting" is the good state and worth saying out loud, the same
                reasoning the By-group count line is built on. */}
            <span className="flex items-center gap-2">
              {tabPill("floor", "Floor", floorCount)}
              <span className="text-[11px] text-gray-400" title="Bills on the floor with no picker assigned yet">
                <span className="font-semibold tabular-nums text-gray-700">{waitingCount}</span> waiting
              </span>
            </span>
            {tabPill("hold", "On hold", holdCount)}
            {tabPill("cancelled", "Cancelled", cancelledCount)}

            {/* View pivot. Flat / By route re-cut the CURRENT slot tab, so they
                are meaningless on All (which renders slot bands and ignores
                `mode` outright) and stay hidden there — unchanged behaviour.
                By picker ignores the slot tab by design, so it is offered on
                every tab including All. The `showSlotModes` term keeps all
                three visible while picker mode is active, so there is always a
                way back out of it — otherwise All + picker would be a trap. */}
            {topTab === "floor" && (() => {
              // Both slot-blind views keep the whole toggle visible while they
              // are active, so All + picker / All + group is never a trap.
              const showSlotModes =
                slotTab !== "all" || mode === "picker" || mode === "group" || mode === "trip";
              const modes = (["flat", "route", "trip", "group", "picker"] as const).filter(
                (m) => m === "picker" || m === "group" || m === "trip" || showSlotModes,
              );
              return (
                <span className="ml-auto flex h-[27px] overflow-hidden rounded-[6px] border border-gray-200 bg-gray-50">
                  {modes.map((m) => (
                    <button
                      key={m}
                      type="button"
                      // "By picker" IS the way back to the grid, so it routes
                      // through the one close handler rather than just setting
                      // mode — otherwise the context would survive underneath
                      // and the banner would hang over the roster. "By group"
                      // drops the context for the same reason (openGroupMode).
                      onClick={() =>
                        m === "picker"
                          ? closeAssignContext()
                          : m === "group"
                            ? openGroupMode()
                            : // "trip" gets its OWN branch — a plain setMode. It
                              // carries no assign context of its own, so routing
                              // it through either handler above would clear one
                              // the operator had not asked to leave.
                              m === "trip"
                              ? openTripMode()
                              : setMode(m)
                      }
                      className={`px-[11px] text-[11px] ${mode === m ? "bg-white font-semibold text-gray-900" : "text-gray-500"}`}
                    >
                      {m === "flat"
                        ? "Flat"
                        : m === "route"
                          ? "By route"
                          : m === "trip"
                            ? "By trip"
                            : m === "picker"
                              ? "By picker"
                              : "By group"}
                    </button>
                  ))}
                </span>
              );
            })()}
          </div>

          {/* Assign context band — only on the live Floor tab, only while a
              picker card is open. Floor's OWN component: mail-orders'
              InstructionsStrip renders a caption derived from its prop name
              ("NOTES · …") with no way to suppress it, and belongs to the
              Billing/Review surfaces — see assign-context-banner.tsx. */}
          {topTab === "floor" && assignContext !== null && contextPickerName && (
            <AssignContextBanner
              pickerName={contextPickerName}
              contextMode={contextMode}
              pendingCount={contextCounts.pending}
              currentCount={contextCounts.current}
              onToggleMode={toggleContextMode}
              onCancel={closeAssignContext}
            />
          )}

          {topTab === "floor" ? (
            loading && !data ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <FloorSkeleton variant="floor" />
              </div>
            ) : error && !data ? (
              <div className="px-5 py-14 text-center text-[11.5px] text-gray-400">Couldn&rsquo;t load the floor. {error}</div>
            ) : filteredFloor ? (
              <FloorBoard
                // Forwarded to every leaf FloorTable, where it swaps the Status
                // pill's label on held-back waiting rows. No column, no width,
                // no band and no count on this board changes with it.
                gateOn={gateOn}
                floor={filteredFloor}
                // Unscoped on purpose — the roster is scope-independent (see
                // scopedData's note above; getFloorPickers applies no
                // delivery-type filter), same as DetailPanel's `pickers`.
                pickers={data?.pickers ?? []}
                slotTab={slotTab}
                onSlotTab={setSlotTab}
                mode={mode}
                // The day's trips, from their own feed — never derived from the
                // board rows below them (see the state declaration).
                trips={trips}
                tripsLoading={loading}
                onBuildTrip={() => void openTripDrawer()}
                assignContext={assignContext}
                // Name, not just the id — the By-group header button says who it
                // is assigning to, and floor-board has no roster of its own.
                assignContextName={contextPickerName}
                contextMode={contextMode}
                onPickPicker={openAssignContext}
                onAssignGroup={assignGroup}
                histDate={histDate}
                onEnterHistory={enterHistory}
                onExitHistory={exitHistory}
                onStepHistory={stepHistory}
                selection={selection}
                onToggleRow={onToggleRow}
                onToggleAll={onToggleAll}
                onMarkUrgent={rowMarkUrgent}
                // The SAME board renders live and history, so the source is
                // decided here by the view (2026-08-25). "history" is the
                // read-only source — it suppresses every action in the panel
                // (detail-panel's `readOnly`). `isLive` is the one flag this
                // screen already uses for the live/history split (the sync
                // pauses key off it), so the panel can never disagree with the
                // board about which day it is showing.
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

          {/* The Show strip (2026-09-09) — ABOVE the assign bar, never inside it.
              The bar is held to four controls by a recorded decision that cost
              three bulk actions (assign-bar.tsx:11-15), and this is a different
              job anyway: the bar hands bills to a PICKER, this hands them to the
              FLOOR.

              THREE conditions, all required: the gate is on, the selection holds
              at least one bill EITHER direction can act on, and `barVisible` —
              the SAME flag the assign bar uses. Reusing that flag is load-bearing
              twice: the strip is positioned off the bar's 60px, so a strip
              without a bar would float over the last table row; and barVisible
              already carries the live/history, tab and read-only-context rules,
              which the strip needs identically and must not restate.

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

          {barVisible && (
            <AssignBar
              selectedRows={selectedRows}
              pickers={data!.pickers}
              // In an assign context the target is already decided — the bar
              // drops the "which picker" step rather than asking a question
              // the operator answered by tapping the card.
              lockedPicker={
                assignContext !== null && contextPickerName ? { id: assignContext, name: contextPickerName } : null
              }
              windows={dispatchWindows}
              onAssign={bulkAssign}
              onChangeSlot={bulkChangeSlot}
              onClear={clearSelection}
            />
          )}
        </div>
      </div>

      {/* Build trip drawer (2026-09-09). Renders only once its options have
          landed — three empty dropdowns would look like a broken form rather
          than a loading one.

          ⚠ NO Esc HANDLER OF ITS OWN. floor-page is the SINGLE window-level Esc
          owner for the whole floor tree (FLOOR §4.6); a second listener races it
          in registration order, which is the bug that spec replaced. The drawer
          closes on its ✕ and on its backdrop. */}
      {tripDrawerOpen && tripOptions && (
        <BuildTripDrawer
          rows={selectedRows}
          // The board's own anchor day, not a clock read inside the drawer —
          // so a trip built while looking at a past day carries that day.
          tripDate={viewMode === "history" && histDate ? histDate : istTodayIso()}
          deliveryTypes={tripOptions.deliveryTypes}
          windows={tripOptions.windows}
          vehicles={tripOptions.vehicles}
          transporters={tripOptions.transporters}
          onClose={() => setTripDrawerOpen(false)}
          onCreated={() => void onTripCreated()}
        />
      )}

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
