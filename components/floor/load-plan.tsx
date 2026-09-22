"use client";

// Floor Control — THE LOAD PLAN VIEW (2026-09-19, owner).
//
// The Upcountry pool as SUGGESTED TRUCKLOADS: one card per truck that
// lib/trips/load-plan.ts packs from the due pool under the tab's rules
// (load_plan_config). It regroups on every render — a bill planned, released
// or re-weighed moves the cards the next time the board loads.
//
// 🔴 A SUGGESTION, NEVER AN ACTION. Nothing here writes. "Make trip" hands the
// card's bills to the floor's existing New trip flow (floor-page.tsx
// `createTripWithSelection`) — the same two API calls as ticking them and
// pressing New trip. No trip action changes a bill's status or hold.
//
// ⚠ DUE BILLS ONLY (owner): today's and overdue, the same set the route cards
// count. Upcoming bills are not planned; the summary says how many there are.
//
// ⚠ THE PANEL'S TABLES HAVE NO TICK BOXES. The card is the unit: Make trip
// takes all of its bills. A tick made inside one panel would sit out of sight
// the moment another card opened — the rule the route cards exist to keep —
// and nothing here needs one. ⚡ and ⋯ still work on every row.
//
// Layout: the route cards' equal-size grid (4/3/2 at 1470/1100, `columns` from
// `useCardColumns`) and one panel, full width under the open card's row.

import { useEffect, useMemo, useRef, useState } from "react";
import { FloorTable, type FloorTableVariant } from "./floor-table";
import { formatWeightKg, sumWeightKg } from "./status-pill";
import { sortPickingQueue } from "@/lib/picking/sort";
import { FLOOR_SPINE } from "@/lib/floor/sort";
import { planLoads, summarisePlan, type LoadPlanConfig, type PlannedTruck } from "@/lib/trips/load-plan";
import type { FloorBoardRow } from "@/lib/floor/types";

const sort = (rows: FloorBoardRow[]) => sortPickingQueue(rows, FLOOR_SPINE) as FloorBoardRow[];
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const kgNum = (kg: number) => Math.round(kg).toLocaleString("en-US");

/** "2,635" or "2,635+" — the floor's honest "+" when a bill has no weight. */
function kgText(kg: number, unknown: number): string {
  return `${kgNum(kg)}${unknown > 0 ? "+" : ""}`;
}

const KIND_LABEL = { small: "Small truck", big: "Big truck", bulk: "Bulk" } as const;

/** How long a card's border flashes after a regroup changed it. */
const FLASH_MS = 1400;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function LoadPlanView({
  rows,
  upcomingCount,
  config,
  routeNames,
  columns,
  nowMs,
  anchorIso,
  variant,
  onMarkUrgent,
  onOpenDetail,
  gateOn,
  onMakeTrip,
  makeTripBusy,
  defaultOpenKey = null,
}: {
  /** The tab's DUE pool rows — exactly what the route view counts. */
  rows: FloorBoardRow[];
  /** Upcoming pool bills on this tab — not planned, only counted. */
  upcomingCount: number;
  /** The tab's rules; null = "Load plan not set up". */
  config: LoadPlanConfig | null;
  routeNames: Readonly<Record<number, string>>;
  columns: number;
  nowMs: number;
  anchorIso: string;
  variant: FloorTableVariant;
  onMarkUrgent: (id: number) => void;
  onOpenDetail: (id: number) => void;
  gateOn: boolean;
  /** Runs the New trip flow with these bills. Absent = no button (History). */
  onMakeTrip?: (orderIds: number[]) => void;
  makeTripBusy?: boolean;
  /** Which truck's panel starts open (a PlannedTruck key). Only seeds the first render. */
  defaultOpenKey?: string | null;
}) {
  // The plan, recomputed whenever the rows or rules change.
  const trucks = useMemo(
    () =>
      planLoads(
        rows.map((r) => ({ orderId: r.orderId, routeId: r.routeId, routeName: r.route, stopKey: r.stopKey, weightKg: r.weightKg, isGift: r.isGift })),
        config,
        routeNames,
      ),
    [rows, config, routeNames],
  );
  const rowById = useMemo(() => new Map(rows.map((r) => [r.orderId, r] as const)), [rows]);

  // ── One open panel. It closes by itself if its truck is gone after a regroup.
  const [openKey, setOpenKey] = useState<string | null>(defaultOpenKey);
  const open = trucks.find((t) => t.key === openKey) ?? null;
  useEffect(() => {
    if (openKey !== null && !trucks.some((t) => t.key === openKey)) setOpenKey(null);
  }, [openKey, trucks]);

  // ── The flash: a card whose bills changed since the last plan (or that is
  //    new) gets a brief violet border. Never on the first plan.
  const prevSig = useRef<Map<string, string> | null>(null);
  const [flash, setFlash] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const sig = new Map(trucks.map((t) => [t.key, t.orderIds.join(",")] as const));
    const prev = prevSig.current;
    prevSig.current = sig;
    if (prev === null) return;
    const changed = new Set(trucks.filter((t) => prev.get(t.key) !== sig.get(t.key)).map((t) => t.key));
    if (changed.size === 0) return;
    setFlash(changed);
    const id = setTimeout(() => setFlash(new Set()), FLASH_MS);
    return () => clearTimeout(id);
  }, [trucks]);

  if (config === null) {
    return (
      <div className="px-5 py-14 text-center">
        <div className="text-[28px] leading-none text-gray-300">○</div>
        <h4 className="mt-2 text-[13px] font-semibold text-gray-900">Load plan not set up</h4>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
          This tab has no load plan rules yet. Flat and By route still work.
        </p>
      </div>
    );
  }

  const s = summarisePlan(trucks);
  const unknown = trucks.reduce((n, t) => n + t.unknownWeightCount, 0);
  const sizes = [s.big > 0 ? `${s.big} big` : null, s.small > 0 ? `${s.small} small` : null].filter(Boolean).join(", ");

  return (
    <div className="px-3.5 py-3.5">
      {/* THE SUMMARY — "9,600 kg pending · 4 trucks suggested · 3 big, 1 small" */}
      <p className="mb-3 text-[13px] tabular-nums text-[#61616d]">
        {trucks.length === 0 ? (
          <>Nothing due to plan</>
        ) : (
          <>
            <b className="font-bold text-[#1a1a22]">{kgText(s.kg, unknown)} kg</b> pending &middot;{" "}
            <b className="font-bold text-[#1a1a22]">{s.trucks.toLocaleString("en-US")}</b> {s.trucks === 1 ? "truck" : "trucks"} suggested
            {sizes && <> &middot; {sizes}</>}
            {s.bulk > 0 && <> &middot; {s.bulk} bulk</>}
          </>
        )}
        {upcomingCount > 0 && <> &middot; {upcomingCount} upcoming not planned</>}
      </p>

      {chunk(trucks, columns).map((row, i) => (
        <div key={i} className={i === 0 ? "" : "mt-3"}>
          <div className="grid items-start gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {row.map((t) => (
              <TruckCard
                key={t.key}
                truck={t}
                bigMaxKg={config.bigMaxKg}
                isOpen={open?.key === t.key}
                dimmed={open !== null && open.key !== t.key}
                flashing={flash.has(t.key)}
                onToggle={() => setOpenKey(openKey === t.key ? null : t.key)}
              />
            ))}
          </div>
          {open && row.some((t) => t.key === open.key) && (
            <TruckPanel
              truck={open}
              rowById={rowById}
              nowMs={nowMs}
              anchorIso={anchorIso}
              variant={variant}
              onMarkUrgent={onMarkUrgent}
              onOpenDetail={onOpenDetail}
              gateOn={gateOn}
              onMakeTrip={onMakeTrip}
              makeTripBusy={makeTripBusy}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── The card ────────────────────────────────────────────────────────────────
//
// Routes · big kilos · "Big truck · 12 stops" in grey — no black tags — then a
// 4px fill bar pinned to the bottom: green at ≥ 50% of that truck's size,
// amber below. A Bulk card has no bar; a grey note sits in its place. Every
// card has the same parts at the same sizes, so the grid's cards come out one
// height. A real <button> (Tab / Enter work with no key listener of ours).

function TruckCard({
  truck: t,
  bigMaxKg,
  isOpen,
  dimmed,
  flashing,
  onToggle,
}: {
  truck: PlannedTruck;
  bigMaxKg: number;
  isOpen: boolean;
  dimmed: boolean;
  flashing: boolean;
  onToggle: () => void;
}) {
  const fill = t.capacityKg ? Math.min(1, t.kg / t.capacityKg) : 0;
  const cls = [
    "block w-full min-w-0 rounded-[11px] border bg-white text-left transition-[opacity,border-color,box-shadow] duration-300",
    isOpen
      ? "border-brand-600 ring-[3px] ring-brand-100"
      : flashing
        ? "border-brand-500 ring-[3px] ring-brand-100"
        : "border-[#e7e7ee] hover:border-[#cfcfda]",
    dimmed ? "opacity-[.45]" : "",
  ].join(" ");
  return (
    <button type="button" className={cls} onClick={onToggle} aria-expanded={isOpen}>
      <span className="block px-3.5 pb-3.5 pt-3.5">
        <span className="mb-1 block truncate text-[13px] font-semibold text-[#61616d]">{t.routeNames.join(" + ")}</span>
        <span className="block whitespace-nowrap text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] tabular-nums text-[#1a1a22]">
          {kgText(t.kg, t.unknownWeightCount)}
          <small className="ml-[3px] text-[13px] font-semibold tracking-normal text-[#96969f]">kg</small>
        </span>
        <span className="mt-[5px] block whitespace-nowrap text-[12.5px] tabular-nums text-[#96969f]">
          <b className="font-semibold text-[#61616d]">{KIND_LABEL[t.kind]}</b> &middot; {plural(t.stopCount, "stop", "stops")}
        </span>
        <span className="mt-3 flex h-4 items-end">
          {t.kind === "bulk" ? (
            <span className="whitespace-nowrap text-[11.5px] text-[#96969f]">Over {kgNum(bigMaxKg)} kg — hire as needed</span>
          ) : (
            <span className="block h-1 w-full overflow-hidden rounded-[2px] bg-[#f1f1f6]">
              <span
                className="block h-full"
                style={{ width: `${Math.round(fill * 100)}%`, background: fill >= 0.5 ? "#2eb862" : "#e0a832" }}
              />
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

// ── The panel ───────────────────────────────────────────────────────────────
//
// Header: the routes, "2,635 of 3,000 kg · Big truck · 12 stops · 13 bills",
// the reason, and Make trip. Below: the truck's bills grouped by route, main
// first, each group under a small heading (name · stops · kg) and in the floor's
// own table with Area in the Route column (`showArea`) — the same table as
// everywhere else on this screen, with no tick boxes (see the file header).

function TruckPanel({
  truck: t,
  rowById,
  nowMs,
  anchorIso,
  variant,
  onMarkUrgent,
  onOpenDetail,
  gateOn,
  onMakeTrip,
  makeTripBusy,
}: {
  truck: PlannedTruck;
  rowById: Map<number, FloorBoardRow>;
  nowMs: number;
  anchorIso: string;
  variant: FloorTableVariant;
  onMarkUrgent: (id: number) => void;
  onOpenDetail: (id: number) => void;
  gateOn: boolean;
  onMakeTrip?: (orderIds: number[]) => void;
  makeTripBusy?: boolean;
}) {
  const bills = t.orderIds.map((id) => rowById.get(id)).filter((r): r is FloorBoardRow => r !== undefined);
  // Groups in the truck's own route order (main first, then who joined).
  const groups = t.routeIds.map((routeId, i) => {
    const rows = bills.filter((r) => r.routeId === routeId);
    return { key: `${routeId ?? "none"}:${i}`, name: t.routeNames[i], rows };
  });
  const kgLine =
    t.capacityKg === null
      ? `${kgText(t.kg, t.unknownWeightCount)} kg`
      : `${kgText(t.kg, t.unknownWeightCount)} of ${kgNum(t.capacityKg)} kg`;

  return (
    <div className="mt-3 overflow-hidden rounded-[11px] border border-[#e7e7ee] bg-white">
      {/* The mock's panel head: a pale band — routes and figures on one line,
          Make trip at its right end, the reason on a line of its own. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#e7e7ee] bg-[#fafafc] px-3.5 py-[11px]">
        <span className="text-[14px] font-bold text-[#1a1a22]">{t.routeNames.join(" + ")}</span>
        <span className="text-[12.5px] tabular-nums text-[#96969f]">
          {kgLine} &middot; {KIND_LABEL[t.kind]} &middot; {plural(t.stopCount, "stop", "stops")} &middot;{" "}
          {plural(t.orderIds.length, "bill", "bills")}
        </span>
        {onMakeTrip && (
          <button
            type="button"
            disabled={makeTripBusy}
            onClick={() => onMakeTrip(t.orderIds)}
            className="ml-auto shrink-0 rounded-[8px] bg-brand-600 px-4 py-[7px] text-[12.5px] font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {makeTripBusy ? "Making…" : "Make trip"}
          </button>
        )}
        <p className="m-0 basis-full text-[12px] text-[#61616d]">{t.reason}</p>
      </div>
      {groups.map((g) => {
        const w = sumWeightKg(g.rows);
        return (
          <div key={g.key}>
            <div className="flex flex-wrap items-baseline gap-[9px] border-b border-[#e7e7ee] bg-[#fafafc] px-3.5 py-[9px]">
              <span className="text-[13.5px] font-bold text-[#1a1a22]">{g.name}</span>
              <span className="text-[12px] tabular-nums text-[#96969f]">
                {plural(new Set(g.rows.map((r) => r.stopKey)).size, "stop", "stops")} &middot;{" "}
                {formatWeightKg(w.kg) === null ? "—" : kgText(w.kg, w.unknown)} kg
              </span>
            </div>
            <FloorTable
              rows={sort(g.rows)}
              nowMs={nowMs}
              anchorIso={anchorIso}
              variant={variant}
              showArea
              onMarkUrgent={onMarkUrgent}
              onOpenDetail={onOpenDetail}
              gateOn={gateOn}
            />
          </div>
        );
      })}
    </div>
  );
}
