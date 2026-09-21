"use client";

// Floor Control — THE UPCOUNTRY LOAD PLAN, v2 (2026-09-21, owner).
//
// The Upcountry tab's "Load plan" view: the due pool as suggested trucks,
// planned SERVER-SIDE (POST /api/floor/load-plan → lib/floor/load-plan-v2-run)
// by the v2 engine, whose rules are docs/load-plan/LOGIC.md.
//
// 🔴 NO RATE, NO RUPEE HERE. The engine and the rates stay on the server; the
// response carries kg, stops, places, reasons and the kg / stop limits only.
// Every engine import below is `import type` — nothing of the engine is
// bundled for the browser.
//
// What the planner can do, all of it held in THIS component's state and sent
// with every request (a reload starts from the suggestion; only a Replan press
// leaves a trace — the plan it returns is kept as a snapshot, no rates, for the
// admin Load plan check):
//   - Replan with the vehicles they have ("Vehicles I have": counts, and an
//     optional driver max kg per vehicle). "Back to suggested" drops all of it.
//   - Pin a card: it comes back exactly as it is.
//   - Move a stop to another card or to Waiting. The target card is then
//     pinned as it now stands (a card's key is its type + its stop ids), and a
//     stop moved to Waiting stays there — Replan respects both like a pin. A
//     move that takes a card over its hard limit shows it red and is allowed.
//   - Make trip: the floor's existing New trip flow with the card's bills.
//
// Layout: the route cards' equal grid (`columns`), every card one size, and
// one panel full width under the open card's row (the v1 view's pattern).

import { useEffect, useMemo, useRef, useState } from "react";
import { FloorTable, type FloorTableVariant } from "./floor-table";
import { sortPickingQueue } from "@/lib/picking/sort";
import { FLOOR_SPINE } from "@/lib/floor/sort";
import type { FloorBoardRow } from "@/lib/floor/types";
import type { AvailableVehicle, V2Card, V2Plan, VehicleType } from "@/lib/trips/load-plan-v2";
import type { LoadPlanV2Response, V2Limits } from "@/lib/floor/load-plan-v2-run";

const TYPES: VehicleType[] = ["ace", "big", "gc"];
const LABEL: Record<VehicleType, string> = { ace: "Ace", big: "Big", gc: "GC" };
const kgNum = (kg: number) => Math.round(kg).toLocaleString("en-US");
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const sort = (rows: FloorBoardRow[]) => sortPickingQueue(rows, FLOOR_SPINE) as FloorBoardRow[];
const isTruck = (c: V2Card): c is V2Card & { type: VehicleType } => c.type === "ace" || c.type === "big" || c.type === "gc";
const GREEN = "#2eb862";
const AMBER = "#e0a832";
const RED = "#d64545";

interface Req {
  /** Counts Replan presses: each press re-asks, and is kept as a snapshot once. */
  replanNo: number;
  available?: AvailableVehicle[];
  pinned: string[];
  waiting: string[];
}

interface Form {
  count: Record<VehicleType, string>;
  limits: Record<VehicleType, string[]>;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** "2 Ace · 4 Big · 2 GC" (+ bulk, direct, hold, waiting when there are any). */
function summaryLine(p: V2Plan): string {
  const s = p.summary;
  const main = `${s.ace} Ace · ${s.big} Big · ${s.gc} GC`;
  const extra = [
    s.bulk ? `${s.bulk} Bulk` : null,
    s.direct ? `${s.direct} Direct` : null,
    s.waiting ? `${s.waiting} Waiting` : null,
    s.hold ? `${s.hold} Hold` : null,
  ].filter(Boolean);
  return extra.length ? `${main}  (+ ${extra.join(" · ")})` : main;
}

/** The form → the engine's `available`: one entry per driver max, the rest plain. */
function toAvailable(f: Form): AvailableVehicle[] {
  const out: AvailableVehicle[] = [];
  TYPES.forEach((t) => {
    const limits = f.limits[t].map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
    const n = Math.max(Math.floor(Number(f.count[t]) || 0), limits.length);
    limits.forEach((maxKg) => out.push({ type: t, count: 1, maxKg }));
    if (n - limits.length > 0) out.push({ type: t, count: n - limits.length });
  });
  return out;
}

export function LoadPlanV2View({
  rows,
  upcomingCount,
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
}: {
  /** The tab's DUE pool rows — the bills the plan is asked for. */
  rows: FloorBoardRow[];
  upcomingCount: number;
  routeNames: Readonly<Record<number, string>>;
  columns: number;
  nowMs: number;
  anchorIso: string;
  variant: FloorTableVariant;
  onMarkUrgent: (id: number) => void;
  onOpenDetail: (id: number) => void;
  gateOn: boolean;
  onMakeTrip?: (orderIds: number[]) => void;
  makeTripBusy?: boolean;
}) {
  const [req, setReq] = useState<Req>({ replanNo: 0, pinned: [], waiting: [] });
  const [form, setForm] = useState<Form>({ count: { ace: "", big: "", gc: "" }, limits: { ace: [], big: [], gc: [] } });
  const [plan, setPlan] = useState<V2Plan | null>(null);
  const [limits, setLimits] = useState<V2Limits | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "off" | "error">("loading");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const rowById = useMemo(() => new Map(rows.map((r) => [r.orderId, r] as const)), [rows]);
  const idsSig = useMemo(() => rows.map((r) => r.orderId).sort((a, b) => a - b).join(","), [rows]);
  const reqSig = JSON.stringify(req);

  // ── The plan: re-asked whenever the pool or the planner's choices change.
  const seq = useRef(0);
  /** The last Replan press already sent as a snapshot (the admin Load plan check keeps each press once). */
  const snappedNo = useRef(0);
  useEffect(() => {
    const my = ++seq.current;
    const ctl = new AbortController();
    setState((s) => (s === "ready" ? s : "loading"));
    const orderIds = idsSig === "" ? [] : idsSig.split(",").map(Number);
    const r0 = JSON.parse(reqSig) as Req;
    const snapshot = r0.available !== undefined && r0.replanNo > snappedNo.current;
    if (snapshot) snappedNo.current = r0.replanNo;
    fetch("/api/floor/load-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds, available: r0.available, pinned: r0.pinned, waiting: r0.waiting, ...(snapshot ? { snapshot: true } : {}) }),
      signal: ctl.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as LoadPlanV2Response;
      })
      .then((res) => {
        if (my !== seq.current) return;
        if (!res.plan) {
          setState("off");
          return;
        }
        setPlan(res.plan);
        setLimits(res.limits);
        setState("ready");
        // Keep the planner's lists in step with the plan: a pinned card whose
        // bill left keeps its pin under its new key; a waiting stop that left drops.
        const pinnedNow = res.plan.cards.filter((c) => c.flags.pinned).map((c) => c.key);
        const waitingNow = res.plan.cards
          .filter((c) => c.type === "waiting")
          .flatMap((c) => c.stops.map((s) => s.id));
        setReq((cur) => {
          const pinned = sameSet(cur.pinned, pinnedNow) ? cur.pinned : pinnedNow;
          const waiting = cur.waiting.filter((id) => waitingNow.includes(id));
          return pinned === cur.pinned && waiting.length === cur.waiting.length ? cur : { ...cur, pinned, waiting };
        });
      })
      .catch((e: unknown) => {
        if (my !== seq.current || (e instanceof DOMException && e.name === "AbortError")) return;
        setState("error");
      });
    return () => ctl.abort();
  }, [idsSig, reqSig]);

  const cards = plan?.cards ?? [];
  const open = cards.find((c) => c.key === openKey) ?? null;
  useEffect(() => {
    if (openKey !== null && plan && !plan.cards.some((c) => c.key === openKey)) setOpenKey(null);
  }, [openKey, plan]);

  // ── Planner actions ───────────────────────────────────────────────────────
  const replan = () => setReq((r) => ({ ...r, replanNo: r.replanNo + 1, available: toAvailable(form) }));
  const backToSuggested = () => {
    setReq((r) => ({ replanNo: r.replanNo, pinned: [], waiting: [] }));
    setOpenKey(null);
  };
  const togglePin = (c: V2Card) =>
    setReq((r) => ({ ...r, pinned: c.flags.pinned ? r.pinned.filter((k) => k !== c.key) : [...r.pinned, c.key] }));
  /** Move stop `stopId` out of card `from` to truck card `toKey`, or to Waiting. */
  const moveStop = (from: V2Card, stopId: string, toKey: string) => {
    setReq((r) => {
      let pinned = r.pinned.slice();
      let waiting = r.waiting.filter((id) => id !== stopId);
      // A pinned source stays pinned without the stop.
      if (isTruck(from) && pinned.includes(from.key)) {
        pinned = pinned.filter((k) => k !== from.key);
        const rest = from.stops.map((s) => s.id).filter((id) => id !== stopId);
        if (rest.length > 0) pinned.push(`${from.type}:${rest.sort().join("|")}`);
      }
      if (toKey === "waiting") {
        waiting = [...waiting, stopId];
      } else {
        const to = cards.find((c) => c.key === toKey);
        if (to && isTruck(to)) {
          pinned = pinned.filter((k) => k !== to.key);
          pinned.push(`${to.type}:${to.stops.map((s) => s.id).concat([stopId]).sort().join("|")}`);
        }
      }
      return { ...r, pinned, waiting };
    });
  };

  const sideName = (side: string) => (side.startsWith("route:") ? routeNames[Number(side.slice(6))] ?? side : side);
  const trucks = cards.filter(isTruck);

  if (state === "off") {
    return (
      <div className="px-5 py-14 text-center">
        <div className="text-[28px] leading-none text-gray-300">○</div>
        <h4 className="mt-2 text-[13px] font-semibold text-gray-900">Load plan not set up</h4>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">The Upcountry load plan has no rules yet. Flat and By route still work.</p>
      </div>
    );
  }

  return (
    <div className="px-3.5 py-3.5">
      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <div className="mb-3 rounded-[11px] border border-[#e7e7ee] bg-[#fafafc] px-3.5 py-3">
        <p className="m-0 text-[13px] tabular-nums text-[#61616d]">
          {state === "error" ? (
            <span className="text-[#d64545]">The load plan could not be loaded — it will try again on the next change.</span>
          ) : !plan ? (
            <>Planning…</>
          ) : (
            <>
              <b className="font-bold text-[#1a1a22]">{plan.mode === "replan" ? "Using:" : "Suggested:"}</b> {summaryLine(plan)}
              {plan.summary.totalKg > 0 && <> &middot; {kgNum(plan.summary.totalKg)} kg</>}
              {upcomingCount > 0 && <> &middot; {upcomingCount} upcoming not planned</>}
            </>
          )}
        </p>
        {plan?.mode === "replan" && (
          <p className="m-0 mt-1 text-[12.5px] tabular-nums">
            <span className={plan.shortage ? "font-semibold text-[#b7791f]" : "text-[#2eb862]"}>
              {plan.shortage ? plan.shortage.text : "No shortage"}
            </span>
            {plan.unused.length > 0 && <span className="text-[#96969f]"> &middot; {plan.unused.map((u) => u.text).join(" · ")}</span>}
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap items-start gap-x-4 gap-y-2">
          <span className="pt-[5px] text-[12px] font-semibold text-[#61616d]">Vehicles I have</span>
          {TYPES.map((t) => (
            <div key={t} className="flex flex-col gap-1">
              <label className="flex items-center gap-1.5 text-[12px] text-[#61616d]">
                {LABEL[t]}
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={form.count[t]}
                  onChange={(e) => setForm((f) => ({ ...f, count: { ...f.count, [t]: e.target.value } }))}
                  className="w-14 rounded-[7px] border border-[#dcdce5] bg-white px-2 py-[3px] text-[12.5px] tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, limits: { ...f.limits, [t]: [...f.limits[t], ""] } }))}
                  className="text-[11.5px] text-brand-600 hover:underline"
                >
                  + add limit
                </button>
              </label>
              {form.limits[t].map((v, i) => (
                <span key={i} className="flex items-center gap-1 pl-[26px] text-[11.5px] text-[#96969f]">
                  driver max
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={v}
                    placeholder="kg"
                    onChange={(e) =>
                      setForm((f) => ({ ...f, limits: { ...f.limits, [t]: f.limits[t].map((x, j) => (j === i ? e.target.value : x)) } }))
                    }
                    className="w-[70px] rounded-[7px] border border-[#dcdce5] bg-white px-2 py-[2px] text-[12px] tabular-nums"
                  />
                  kg
                  <button
                    type="button"
                    aria-label="Remove limit"
                    onClick={() => setForm((f) => ({ ...f, limits: { ...f.limits, [t]: f.limits[t].filter((_, j) => j !== i) } }))}
                    className="px-1 text-[#96969f] hover:text-[#1a1a22]"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ))}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={replan}
              className="rounded-[8px] bg-brand-600 px-4 py-[6px] text-[12.5px] font-bold text-white hover:bg-brand-700"
            >
              Replan
            </button>
            <button
              type="button"
              onClick={backToSuggested}
              className="rounded-[8px] border border-[#dcdce5] bg-white px-3 py-[6px] text-[12.5px] font-semibold text-[#61616d] hover:border-[#c4c4d0]"
            >
              Back to suggested
            </button>
          </div>
        </div>
      </div>

      {/* ── CARDS ───────────────────────────────────────────────────────── */}
      {plan && cards.length === 0 && <p className="px-1 text-[13px] text-[#96969f]">Nothing due to plan.</p>}
      {chunk(cards, columns).map((row, i) => (
        <div key={i} className={i === 0 ? "" : "mt-3"}>
          <div className="grid items-stretch gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {row.map((c) => (
              <PlanCard
                key={c.key}
                card={c}
                limits={limits}
                sideName={sideName}
                shortage={plan?.shortage?.text ?? null}
                isOpen={open?.key === c.key}
                dimmed={open !== null && open.key !== c.key}
                onToggle={() => setOpenKey(openKey === c.key ? null : c.key)}
              />
            ))}
          </div>
          {open && row.some((c) => c.key === open.key) && (
            <PlanPanel
              card={open}
              limits={limits}
              sideName={sideName}
              targets={trucks.filter((t) => t.key !== open.key)}
              rowById={rowById}
              nowMs={nowMs}
              anchorIso={anchorIso}
              variant={variant}
              onMarkUrgent={onMarkUrgent}
              onOpenDetail={onOpenDetail}
              gateOn={gateOn}
              onTogglePin={() => togglePin(open)}
              onMove={(stopId, toKey) => moveStop(open, stopId, toKey)}
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

function title(c: V2Card): string {
  if (isTruck(c)) return LABEL[c.type];
  if (c.type === "bulk") {
    if (c.bulkKind === "hire") return "Bulk · hire truck";
    if (c.bulkKind === "heavy") return "Bulk · Big (heavy)";
    return `Bulk · ${c.vehicle ? LABEL[c.vehicle] : "Big"}`;
  }
  return c.type === "direct" ? "Direct" : c.type === "waiting" ? "Waiting" : "Hold";
}

/** The truck's colour: red over its hard limit, amber over its ideal, else green. */
function tone(c: V2Card): string {
  return c.flags.overHard ? RED : c.flags.amber ? AMBER : GREEN;
}

function PlanCard({
  card: c,
  limits,
  sideName,
  shortage,
  isOpen,
  dimmed,
  onToggle,
}: {
  card: V2Card;
  limits: V2Limits | null;
  sideName: (s: string) => string;
  shortage: string | null;
  isOpen: boolean;
  dimmed: boolean;
  onToggle: () => void;
}) {
  const lim = isTruck(c) && limits ? limits[c.type] : null;
  const cap = c.driverMaxKg ?? lim?.hardKg ?? null;
  const fill = cap ? Math.min(1, c.kg / cap) : 0;
  const note =
    c.type === "waiting"
      ? shortage ?? c.reason
      : c.type === "hold"
        ? "Hold for tomorrow"
        : c.type === "direct"
          ? "Direct route — never mixed"
          : c.type === "bulk"
            ? c.bulkKind === "hire"
              ? c.reason.split(" (")[0]
              : "One dealer, a truck of its own"
            : null;
  const cls = [
    "flex h-full w-full min-w-0 flex-col rounded-[11px] border bg-white text-left transition-[opacity,border-color,box-shadow] duration-300",
    isOpen ? "border-brand-600 ring-[3px] ring-brand-100" : c.flags.overHard ? "border-[#e7a3a3]" : "border-[#e7e7ee] hover:border-[#cfcfda]",
    dimmed ? "opacity-[.45]" : "",
  ].join(" ");
  return (
    <button type="button" className={cls} onClick={onToggle} aria-expanded={isOpen}>
      <span className="block w-full px-3.5 pb-3.5 pt-3">
        <span className="mb-1 flex items-center gap-1.5 text-[12px] text-[#96969f]">
          <b className="font-bold text-[#61616d]">{title(c)}</b>
          <span>&middot; {sideName(c.side)}</span>
          {c.flags.pinned && (
            <span className="ml-auto text-[12px]" title="Pinned" aria-label="Pinned">
              📌
            </span>
          )}
        </span>
        <span className="block truncate text-[13px] font-semibold text-[#1a1a22]" title={c.areaNames.join(" → ")}>
          {c.areaNames.join(" → ")}
        </span>
        <span className="mt-1 block whitespace-nowrap text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] tabular-nums text-[#1a1a22]">
          {kgNum(c.kg)}
          <small className="ml-[3px] text-[13px] font-semibold tracking-normal text-[#96969f]">kg</small>
        </span>
        <span className="mt-[5px] block whitespace-nowrap text-[12.5px] tabular-nums text-[#96969f]">
          {plural(c.stopCount, "stop", "stops")}
          {lim && <> &middot; ideal {kgNum(lim.idealKg)} kg</>}
          {c.driverMaxKg !== undefined && <> &middot; driver max {kgNum(c.driverMaxKg)} kg</>}
        </span>
        <span className="mt-3 flex h-4 items-end">
          {lim ? (
            <span className="block h-1 w-full overflow-hidden rounded-[2px] bg-[#f1f1f6]">
              <span className="block h-full" style={{ width: `${Math.round(fill * 100)}%`, background: tone(c) }} />
            </span>
          ) : (
            <span className={`truncate text-[11.5px] ${c.type === "waiting" && shortage ? "font-semibold text-[#b7791f]" : "text-[#96969f]"}`}>{note}</span>
          )}
        </span>
      </span>
    </button>
  );
}

// ── The panel ───────────────────────────────────────────────────────────────

function PlanPanel({
  card: c,
  limits,
  sideName,
  targets,
  rowById,
  nowMs,
  anchorIso,
  variant,
  onMarkUrgent,
  onOpenDetail,
  gateOn,
  onTogglePin,
  onMove,
  onMakeTrip,
  makeTripBusy,
}: {
  card: V2Card;
  limits: V2Limits | null;
  sideName: (s: string) => string;
  targets: V2Card[];
  rowById: Map<number, FloorBoardRow>;
  nowMs: number;
  anchorIso: string;
  variant: FloorTableVariant;
  onMarkUrgent: (id: number) => void;
  onOpenDetail: (id: number) => void;
  gateOn: boolean;
  onTogglePin: () => void;
  onMove: (stopId: string, toKey: string) => void;
  onMakeTrip?: (orderIds: number[]) => void;
  makeTripBusy?: boolean;
}) {
  const lim = isTruck(c) && limits ? limits[c.type] : null;
  // Stops a planner may move: not from a Bulk or Direct card, and not a bulk part.
  const movable = c.type !== "bulk" && c.type !== "direct";
  return (
    <div className="mt-3 overflow-hidden rounded-[11px] border border-[#e7e7ee] bg-white">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#e7e7ee] bg-[#fafafc] px-3.5 py-[11px]">
        <span className="text-[14px] font-bold text-[#1a1a22]">
          {title(c)} &middot; {sideName(c.side)}
        </span>
        <span className="text-[12.5px] tabular-nums text-[#96969f]">
          <span style={{ color: isTruck(c) ? tone(c) : undefined }} className={isTruck(c) ? "font-semibold" : ""}>
            {kgNum(c.kg)}
            {lim ? ` of ${kgNum(c.driverMaxKg ?? lim.hardKg)}` : ""} kg
          </span>
          {lim && <> (ideal {kgNum(lim.idealKg)})</>} &middot; {plural(c.stopCount, "stop", "stops")}
          {lim && <> (ideal {lim.idealStops}, max {lim.maxStops})</>} &middot; {plural(c.orderIds.length, "bill", "bills")}
          {c.driverMaxKg !== undefined && <> &middot; driver max {kgNum(c.driverMaxKg)} kg</>}
          {c.flags.overHard && <span className="font-semibold text-[#d64545]"> &middot; over the hard limit</span>}
        </span>
        <span className="ml-auto flex shrink-0 gap-2">
          {isTruck(c) && (
            <button
              type="button"
              onClick={onTogglePin}
              className="rounded-[8px] border border-[#dcdce5] bg-white px-3 py-[6px] text-[12.5px] font-semibold text-[#61616d] hover:border-[#c4c4d0]"
            >
              {c.flags.pinned ? "Unpin" : "📌 Pin"}
            </button>
          )}
          {onMakeTrip && (
            <button
              type="button"
              disabled={makeTripBusy}
              onClick={() => onMakeTrip(c.orderIds)}
              className="rounded-[8px] bg-brand-600 px-4 py-[6px] text-[12.5px] font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {makeTripBusy ? "Making…" : "Make trip"}
            </button>
          )}
        </span>
        <p className="m-0 basis-full text-[12px] text-[#61616d]">{c.reason}</p>
      </div>
      {c.stops.map((s, i) => {
        const rows = s.orderIds.map((id) => rowById.get(id)).filter((r): r is FloorBoardRow => r !== undefined);
        const dealer = rows[0]?.dealerName ?? "";
        const canMove = movable && !s.id.includes("#");
        return (
          <div key={s.id}>
            <div className="flex flex-wrap items-center gap-[9px] border-b border-[#e7e7ee] bg-[#fafafc] px-3.5 py-[7px]">
              <span className="text-[13px] font-bold text-[#1a1a22]">
                {i + 1}. {s.areaName}
              </span>
              <span className="text-[12px] tabular-nums text-[#96969f]">
                {dealer && <>{dealer} &middot; </>}
                {kgNum(s.kg)} kg{s.ridesAlong && <> &middot; rides along</>}
              </span>
              {canMove && (
                <select
                  aria-label={`Move ${s.areaName} to`}
                  value=""
                  onChange={(e) => e.target.value && onMove(s.id, e.target.value)}
                  className="ml-auto rounded-[7px] border border-[#dcdce5] bg-white px-2 py-[3px] text-[12px] text-[#61616d]"
                >
                  <option value="">Move to…</option>
                  {targets.map((t) => (
                    <option key={t.key} value={t.key}>
                      {title(t)} · {sideName(t.side)} · {t.areaNames.slice(0, 2).join(", ")}
                      {t.areaNames.length > 2 ? "…" : ""} · {kgNum(t.kg)} kg
                    </option>
                  ))}
                  {c.type !== "waiting" && <option value="waiting">Waiting</option>}
                </select>
              )}
            </div>
            {rows.length > 0 && (
              <FloorTable
                rows={sort(rows)}
                nowMs={nowMs}
                anchorIso={anchorIso}
                variant={variant}
                showArea
                onMarkUrgent={onMarkUrgent}
                onOpenDetail={onOpenDetail}
                gateOn={gateOn}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
