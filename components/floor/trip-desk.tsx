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
import { countByStatus, formatLitres, sumLitres, formatWeightKg, sumWeightKg } from "./status-pill";
import type { FloorSelection } from "@/lib/floor/selection";
import type { FloorBoardResult, FloorBoardRow } from "@/lib/floor/types";
import type { TripSummary, TripDetail } from "@/lib/trips/queries";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function istTodayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
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

  const liveCounts = countByStatus(dueRows);
  const stillOpen = liveCounts.total - liveCounts.done;

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
        {stillOpen} still open &middot; {liveCounts.done} checked today
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
    // ⚠ A DROP CAN HOLD BILLS THE BOARD NO LONGER SHOWS — a finished trip's
    // bills have left the live predicate. The stop still renders, with a line
    // saying so, rather than vanishing and making the stop count disagree with
    // the header's.
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
                    {d.bills} bill{d.bills === 1 ? "" : "s"} finished — off today&rsquo;s live board.
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
    const ca = countByStatus(a[1]);
    const cb = countByStatus(b[1]);
    const pa = ca.total ? ca.done / ca.total : 1;
    const pb = cb.total ? cb.done / cb.total : 1;
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
