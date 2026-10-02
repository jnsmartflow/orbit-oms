"use client";

// Freight Trips — the screen (composition root). A REPORT-ONLY "paper trip"
// layer: ops group HELD bills into a freight trip with its own vehicle /
// transporter / driver for the freight report. 🔴 Nothing here changes a bill —
// every call goes to /api/freight-trips/* (./api.ts), which writes freight
// tables only. The bills stay held; the floor never sees freight.
//
// Look: a copy of Floor's trip desk (rail + main), built new — Floor's
// trip-desk / trip-rail / trip-detail-header are NOT imported (they hard-wire
// /api/floor/trips). Header: <UniversalHeader /> (CORE §3; /floor is the one
// hand-rolled exception and this screen does not earn a second).
//
//   rail:  Held bills · trip cards (active, newest first) · Cancelled (n)
//   main:  pool (Held bills) | one trip (stops) | trip + add band + pool | cancelled list
//   bar:   the shared FloorActionBar shell, only while something is ticked
//
// Live sync: freight tables have NO live_changes trigger (CORE §13), so the
// screen polls /api/freight-trips/marker every 30 s and reloads on a change.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { UniversalHeader } from "@/components/universal-header";
import { FloorActionBar, BAR_PRIMARY, BAR_SECONDARY } from "@/components/floor/floor-action-bar";
import { formatLitres, formatWeightKg } from "@/components/floor/status-pill";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";
import { applySearch, parseSearch } from "@/lib/floor/search";
import { loadKg, loadLitres } from "@/lib/orders/gift";
import type { FloorSelection } from "@/lib/floor/selection";
import type { FloorHoldRow, FloorScope } from "@/lib/floor/types";
import {
  addBills,
  cancelTrip,
  createTrip,
  fetchOptions,
  fetchPool,
  fetchTrip,
  fetchTrips,
  istDay,
  patchTrip,
  removeBills,
  type BillSkip,
  type FreightOptions,
  type FreightTripDetail,
  type FreightTripSummary,
  type TripFields,
} from "./api";
import { FreightRail, type RailSelection } from "./freight-rail";
import { PoolView } from "./pool-view";
import { TripView } from "./trip-view";
import { TripDrawer } from "./trip-drawer";

const SCOPE_SEGMENTS = [
  { id: "Local", label: "Local" },
  { id: "Upcountry", label: "Upcountry" },
  { id: "IGT / Cross", label: "IGT · Cross" },
];
const POLL_MS = 30_000;
const EMPTY: FloorSelection = new Set<number>();

/** The figures for whatever is ticked — gift = 0 (lib/orders/gift.ts), unknown kg flagged. */
function figuresOf(rows: FloorHoldRow[]) {
  let litres = 0;
  let kg = 0;
  let unknown = 0;
  for (const r of rows) {
    litres += loadLitres(r.volumeLitres, r.isGift);
    const w = loadKg(r.weightKg, r.isGift);
    if (w === null) unknown += 1;
    else kg += w;
  }
  return [
    { key: "l", value: formatLitres(litres), unit: "L" },
    { key: "kg", value: `${formatWeightKg(kg) ?? "0"}${unknown > 0 ? "+" : ""}`, unit: "kg" },
  ];
}

function skipToast(skipped: BillSkip[]) {
  if (skipped.length === 0) return;
  const shown = skipped.slice(0, 5).map((s) => s.reason);
  toast.warning(`${skipped.length} bill${skipped.length === 1 ? "" : "s"} not moved`, {
    description: shown.join(" · ") + (skipped.length > 5 ? ` · +${skipped.length - 5} more` : ""),
  });
}

export function FreightTripsPage({ canEdit }: { canEdit: boolean }) {
  const [date, setDate] = useState<Date>(() => new Date());
  const dateStr = istDay(date);
  const [scope, setScope] = useState<FloorScope>("All");
  const [search, setSearch] = useState("");

  const [trips, setTrips] = useState<FreightTripSummary[] | null>(null);
  const [pool, setPool] = useState<FloorHoldRow[]>([]);
  const [poolLoading, setPoolLoading] = useState(true);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [view, setView] = useState<RailSelection>({ kind: "pool" });
  const [detail, setDetail] = useState<FreightTripDetail | null>(null);
  const [adding, setAdding] = useState(false);

  const [poolSel, setPoolSel] = useState<FloorSelection>(EMPTY);
  const [tripSel, setTripSel] = useState<FloorSelection>(EMPTY);

  const [options, setOptions] = useState<FreightOptions | null>(null);
  const [drawer, setDrawer] = useState<"new" | "edit" | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  const openTripId = view.kind === "trip" ? view.tripId : null;

  // ── Loads ──────────────────────────────────────────────────────────────
  const loadTrips = useCallback(async () => {
    try {
      setTrips((await fetchTrips(dateStr)).trips);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load freight trips");
    }
  }, [dateStr]);

  const loadPool = useCallback(async () => {
    setPoolLoading(true);
    try {
      const r = await fetchPool(scope);
      setPool(r.rows);
      setPoolError(null);
      // Ticks on bills that left the pool (put on a trip elsewhere, released) go.
      const ids = new Set(r.rows.map((x) => x.orderId));
      setPoolSel((s) => new Set(Array.from(s).filter((id) => ids.has(id))));
    } catch (e) {
      setPoolError(e instanceof Error ? e.message : "error");
    } finally {
      setPoolLoading(false);
    }
  }, [scope]);

  const loadDetail = useCallback(async (id: number) => {
    try {
      const { trip } = await fetchTrip(id);
      setDetail(trip);
      const ids = new Set(trip.stops.flatMap((s) => s.bills.map((b) => b.orderId)));
      setTripSel((s) => new Set(Array.from(s).filter((x) => ids.has(x))));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the trip");
    }
  }, []);

  const reloadAll = useCallback(async () => {
    await loadTrips();
    await loadPool();
    if (openTripId !== null) await loadDetail(openTripId);
  }, [loadTrips, loadPool, loadDetail, openTripId]);

  useEffect(() => { void loadTrips(); }, [loadTrips]);
  useEffect(() => { void loadPool(); }, [loadPool]);
  useEffect(() => {
    setTripSel(EMPTY);
    setAdding(false);
    if (openTripId === null) { setDetail(null); return; }
    setDetail(null);
    void loadDetail(openTripId);
  }, [openTripId, loadDetail]);

  usePickingMarker({
    scope: "openPending",
    url: "/api/freight-trips/marker",
    pollMs: POLL_MS,
    onChange: () => { void reloadAll(); },
    paused: drawer !== null || confirmCancel || busy,
  });

  const ensureOptions = useCallback(async () => {
    if (options) return;
    try {
      setOptions(await fetchOptions());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load vehicles");
    }
  }, [options]);

  // ── Derived ────────────────────────────────────────────────────────────
  const parsed = useMemo(() => parseSearch(search), [search]);
  const poolRows = useMemo(() => (search.trim() ? applySearch(pool, parsed) : pool), [pool, parsed, search]);
  const poolLitres = useMemo(() => pool.reduce((s, r) => s + loadLitres(r.volumeLitres, r.isGift), 0), [pool]);
  const poolSelRows = useMemo(() => pool.filter((r) => poolSel.has(r.orderId)), [pool, poolSel]);
  const tripRows = useMemo(() => (detail ? detail.stops.flatMap((s) => s.bills) : []), [detail]);
  const tripSelRows = useMemo(() => tripRows.filter((r) => tripSel.has(r.orderId)), [tripRows, tripSel]);
  const detailCancelled = detail?.status === "cancelled";
  const inPool = view.kind === "pool";
  const inAddBand = view.kind === "trip" && adding && detail !== null && !detailCancelled;
  const tripNumberOf = (id: number) => trips?.find((t) => t.id === id)?.tripNumber ?? "the trip";

  // ── Writes (all /api/freight-trips/*) ────────────────────────────────────
  async function addTo(tripId: number, ids: number[]) {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const r = await addBills(tripId, ids);
      if (r.added.length > 0) {
        toast.success(`${r.added.length} bill${r.added.length === 1 ? "" : "s"} added to ${tripNumberOf(tripId)} — still on hold on the floor`);
      }
      skipToast(r.skipped);
      setPoolSel(EMPTY);
      await reloadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the bills");
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (!detail || tripSel.size === 0) return;
    setBusy(true);
    try {
      const r = await removeBills(detail.id, Array.from(tripSel));
      toast.success(`${r.removed.length} bill${r.removed.length === 1 ? "" : "s"} removed from ${detail.tripNumber}`);
      skipToast(r.skipped);
      setTripSel(EMPTY);
      await reloadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the bills");
    } finally {
      setBusy(false);
    }
  }

  async function submitDrawer(fields: TripFields) {
    setBusy(true);
    try {
      if (drawer === "new") {
        const ids = Array.from(poolSel);
        const r = await createTrip(dateStr, fields, ids);
        toast.success(`${r.trip.tripNumber} created${r.added.length > 0 ? ` with ${r.added.length} bill${r.added.length === 1 ? "" : "s"}` : ""} — the bills stay on hold on the floor`);
        skipToast(r.skipped);
        setPoolSel(EMPTY);
        setDrawer(null);
        await loadTrips();
        await loadPool();
        setView({ kind: "trip", tripId: r.trip.id });
      } else if (drawer === "edit" && detail) {
        const r = await patchTrip(detail.id, fields);
        toast.success(r.changed ? `${detail.tripNumber} updated` : "Nothing changed");
        setDrawer(null);
        await reloadAll();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the trip");
    } finally {
      setBusy(false);
    }
  }

  async function doCancel() {
    if (!detail) return;
    setBusy(true);
    try {
      await cancelTrip(detail.id);
      toast.success(`${detail.tripNumber} cancelled — its bills are free for another trip`);
      setConfirmCancel(false);
      setView({ kind: "pool" });
      await loadTrips();
      await loadPool();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel the trip");
    } finally {
      setBusy(false);
    }
  }

  // ── The bar ─────────────────────────────────────────────────────────────
  let bar: React.ReactNode = null;
  if (canEdit && (inPool || inAddBand) && poolSel.size > 0) {
    bar = (
      <FloorActionBar count={poolSel.size} figures={figuresOf(poolSelRows)} onClear={() => setPoolSel(EMPTY)} clearDisabled={busy}>
        {inAddBand && detail ? (
          <button type="button" className={BAR_PRIMARY} disabled={busy} onClick={() => void addTo(detail.id, Array.from(poolSel))}>
            Add to {detail.tripNumber}
          </button>
        ) : (
          <button
            type="button"
            className={BAR_PRIMARY}
            disabled={busy}
            onClick={() => { void ensureOptions(); setDrawer("new"); }}
          >
            + New trip
          </button>
        )}
      </FloorActionBar>
    );
  } else if (canEdit && view.kind === "trip" && !adding && !detailCancelled && tripSel.size > 0) {
    bar = (
      <FloorActionBar count={tripSel.size} figures={figuresOf(tripSelRows)} onClear={() => setTripSel(EMPTY)} clearDisabled={busy}>
        <button type="button" className={BAR_SECONDARY} disabled={busy} onClick={() => void removeSelected()}>
          Remove from trip
        </button>
      </FloorActionBar>
    );
  }

  // ── Main ────────────────────────────────────────────────────────────────
  let main: React.ReactNode;
  if (view.kind === "cancelled") {
    const list = (trips ?? []).filter((t) => t.status === "cancelled");
    main = (
      <div>
        <div className="border-b border-ink-100 px-4 py-2.5 text-[15px] font-semibold text-ink-900">
          Cancelled on {dateStr} <span className="ml-2 text-[12px] font-normal text-ink-500">read only — kept as the record</span>
        </div>
        {list.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setView({ kind: "trip", tripId: t.id })}
            className="flex w-full items-center gap-3 border-b border-ink-100 px-4 py-2.5 text-left hover:bg-ink-25"
          >
            <span className="font-mono text-[12px] font-semibold text-ink-700">{t.tripNumber}</span>
            <span className="font-mono text-[12px] text-ink-500">{t.vehicleLabel ?? "No vehicle"}</span>
            <span className="ml-auto text-[11.5px] text-ink-400">
              cancelled{t.cancelledByName ? ` by ${t.cancelledByName}` : ""}
            </span>
          </button>
        ))}
      </div>
    );
  } else if (view.kind === "trip") {
    main = !detail ? (
      <div className="px-5 py-14 text-center text-[11.5px] text-ink-400">Loading the trip…</div>
    ) : (
      <>
        <TripView
          trip={detail}
          canEdit={canEdit}
          readOnly={detailCancelled}
          selection={tripSel}
          onSelection={setTripSel}
          onEdit={() => { void ensureOptions(); setDrawer("edit"); }}
          onAddBills={() => { setTripSel(EMPTY); setPoolSel(EMPTY); setAdding(true); }}
          onCancelTrip={() => setConfirmCancel(true)}
          compact={inAddBand}
        />
        {inAddBand && (
          <>
            <div className="flex items-center gap-3 border-y border-brand-200 bg-brand-50 px-4 py-2.5">
              <span className="text-[13px] font-semibold text-ink-900">Adding to {detail.tripNumber}</span>
              <span className="text-[12px] text-ink-600">— tick held bills below</span>
              <button
                type="button"
                onClick={() => { setAdding(false); setPoolSel(EMPTY); }}
                className="ml-auto h-8 rounded-lg border border-ink-200 bg-white px-3 text-[12.5px] font-semibold text-ink-900 hover:bg-ink-50"
              >
                Done
              </button>
            </div>
            <PoolView
              rows={poolRows}
              loading={poolLoading}
              error={poolError}
              selection={poolSel}
              onSelection={setPoolSel}
              selectable={canEdit}
              title="— tick the ones that go on this trip"
            />
          </>
        )}
      </>
    );
  } else {
    main = (
      <PoolView
        rows={poolRows}
        loading={poolLoading}
        error={poolError}
        selection={poolSel}
        onSelection={setPoolSel}
        selectable={canEdit}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      <UniversalHeader
        title={
          <span className="flex items-baseline gap-2">
            Freight Trips
            <span className="text-[11px] font-normal text-ink-400">Report only — the floor never sees these</span>
          </span>
        }
        showShortcutsButton={false}
        searchPlaceholder="Search OBD, invoice, dealer"
        searchValue={search}
        onSearchChange={setSearch}
        // Delivery-type scope for the held pool — drawn HERE (leftExtra), not as
        // the header's `segments`, so the header's 1-9 hotkey cannot switch it.
        // Default: NO chip active = every type (Floor On hold's set). Clicking a
        // chip filters; clicking the active one clears back to all (CLAUDE_UI §6:
        // no "All" button).
        leftExtra={
          <span className="inline-flex gap-[2px] rounded-[7px] bg-gray-100 p-[3px]">
            {SCOPE_SEGMENTS.map((s) => {
              const on = scope === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setScope(on ? "All" : (s.id as FloorScope))}
                  className={`rounded-[5px] px-[11px] py-[4px] text-[11px] transition-colors ${
                    on ? "bg-brand-600 font-medium text-white" : "text-gray-500 hover:bg-white/60"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </span>
        }
        currentDate={date}
        onDateChange={(d) => { setDate(d); setView({ kind: "pool" }); }}
      />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* The rail column fills the body's full height (its own bg + border to
            the bottom, like Floor's trip rail) and scrolls on its own. */}
        <div className="flex max-h-[38vh] min-h-0 shrink-0 flex-col md:max-h-none md:w-[260px]">
          <FreightRail
            trips={trips}
            loading={trips === null}
            selection={view}
            onSelect={(s) => { setAdding(false); setView(s); }}
            poolCount={pool.length}
            poolLitres={poolLitres}
            addCount={canEdit && inPool ? poolSel.size : 0}
            onAddToTrip={(id) => void addTo(id, Array.from(poolSel))}
          />
        </div>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className={`min-h-0 flex-1 overflow-y-auto ${bar ? "pb-[88px]" : ""}`}>{main}</div>
          {bar}
        </div>
      </div>

      {drawer && (
        <TripDrawer
          mode={drawer}
          trip={drawer === "edit" ? detail : null}
          options={options}
          billCount={drawer === "new" ? poolSel.size : 0}
          billLitres={drawer === "new" ? poolSelRows.reduce((s, r) => s + loadLitres(r.volumeLitres, r.isGift), 0) : 0}
          busy={busy}
          onClose={() => setDrawer(null)}
          onSubmit={(f) => void submitDrawer(f)}
        />
      )}

      {confirmCancel && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-[400px] rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-[15px] font-semibold text-ink-900">Cancel {detail.tripNumber}?</h3>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-600">
              Its {detail.counts.bills} bill{detail.counts.bills === 1 ? "" : "s"} come off this freight trip and can go on another.
              The trip is kept as cancelled. Nothing changes on the floor.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmCancel(false)}
                className="h-9 rounded-lg border border-ink-200 bg-white px-4 text-[13px] font-semibold text-ink-900 hover:bg-ink-50"
              >
                Keep trip
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void doCancel()}
                className="h-9 rounded-lg border border-danger bg-danger px-4 text-[13px] font-semibold text-white hover:bg-danger-text disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              >
                Cancel freight trip
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
