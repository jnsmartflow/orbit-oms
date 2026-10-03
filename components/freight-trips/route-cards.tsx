"use client";

// Freight Trips — the held pool as DELIVERY-TYPE CARDS (Floor "All tab" style).
// Mockup (owner-approved): docs/mockups/freight-trips/held-cards.html — its card
// anatomy copied, MINUS every status bit: no ring (a plain "{n} bills" block in
// its 64px slot), no per-route status bar, no greyed empty rows. Held bills have
// no pick progress.
//
//   ┌ head ─ dot(s) TYPE ─────────────────────── ┐
//   │ 3,209 kg                          [ 22 ]  │  ← click: the drill-in on its FIRST club tab
//   │ 7 stops · 5,785 L                [ bills ] │
//   ├ row ─ Adajan + Olpad   3 stops ……… 1,030 kg │  ← click: the drill-in on that club's tab
//   └ row ─ Other routes     1 stop  ………    69 kg ┘
//
// Cards: Local and Upcountry always (empty → "No held bills"); IGT / Cross only
// with bills; "No route" (amber, read-only) only when some held bill has no route
// or no delivery type — its rows are the bills themselves.
//
// 🔴 COPIED, NOT IMPORTED. Floor's components/floor/route-cards.tsx is typed to
// FloorBoardRow (zone, pick status) and draws its bar; the CLUBBING RULES are
// copied below (clubRowsFor) and Floor's file is untouched:
//   - a club is in a type when its delivery type is one the type covers
//     (scopeTypes — imported, pure); members main first; a member with
//     `reachFrom` draws that other type's bills; a member with none: no row;
//   - routes in no club share "Other routes" (by kg); route 25 hidden;
//   - Hand bills (the dealer collects) ride no truck: out of kg / L / stops,
//     shown as "+N Hand · X kg — not counted".
// Clubs come from Floor's getRouteClubs() via /api/freight-trips/pool.

import { formatLitres, formatWeightKg } from "@/components/floor/status-pill";
import { loadKg, loadLitres } from "@/lib/orders/gift";
import { scopeTypes } from "@/lib/floor/scope";
import type { FloorRouteClub, FloorScope } from "@/lib/floor/types";
import type { FreightPoolRow } from "@/lib/freight-trips/pool";

/** Route 20 "No Route" is no route; route 25 "TEST R" is hidden (Floor's rule). */
const NO_ROUTE_IDS: readonly number[] = [20];
const HIDDEN_ROUTE_IDS: readonly number[] = [25];

type TypeKey = Exclude<FloorScope, "All">;

/** The type cards, in order, with their identity colours (data.* — CLAUDE_UI §2.1). */
const TYPE_CARDS: { key: TypeKey; label: string; dots: string[]; always: boolean }[] = [
  { key: "Local", label: "Local", dots: ["bg-data-blue"], always: true },
  { key: "Upcountry", label: "Upcountry", dots: ["bg-data-orange"], always: true },
  { key: "IGT / Cross", label: "IGT / Cross", dots: ["bg-data-teal", "bg-data-rose"], always: false },
];

// ── Figures ─────────────────────────────────────────────────────────────────

export function stopCount(rows: FreightPoolRow[]): number {
  return new Set(rows.map((r) => r.stopKey)).size;
}

export function litresOf(rows: FreightPoolRow[]): number {
  return rows.reduce((s, r) => s + loadLitres(r.volumeLitres, r.isGift), 0);
}

/** Whole kilos, "+" when a bill has no weight; "—" when no bill has one (Floor's kgText). */
export function kgText(rows: { weightKg: number | null; isGift: boolean }[]): string {
  let kg = 0;
  let unknown = 0;
  for (const r of rows) {
    const w = loadKg(r.weightKg, r.isGift);
    if (w === null) unknown += 1;
    else kg += w;
  }
  if (formatWeightKg(kg) === null) return unknown > 0 ? "—" : "0";
  return `${Math.round(kg).toLocaleString("en-US")}${unknown > 0 ? "+" : ""}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A held bill with no route of its own: no route id, or the "No Route" placeholder. */
function hasNoRoute(r: FreightPoolRow): boolean {
  return r.routeId === null || NO_ROUTE_IDS.includes(r.routeId);
}

// ── The model ───────────────────────────────────────────────────────────────

/** One ROUTE inside a club — a section of the drill-in (Floor's open panel). */
export interface RouteSection {
  key: string;
  name: string;
  /** The other type this route's bills come from (Kamrej: "Upcountry"), or null. */
  reachLabel: string | null;
  rows: FreightPoolRow[];
  hand: FreightPoolRow[];
}

/** One row of a type card (and one tab of the drill-in): a route club, or "Other routes". */
export interface ClubRow {
  key: string;
  name: string;
  /** Counted bills (not Hand). */
  rows: FreightPoolRow[];
  hand: FreightPoolRow[];
  /** Its routes with held bills — club members main first; Other routes by kg. */
  routes: RouteSection[];
}

function kgOf(rows: FreightPoolRow[]): number {
  return rows.reduce((s, r) => s + (loadKg(r.weightKg, r.isGift) ?? 0), 0);
}

export interface TypeCard {
  key: TypeKey;
  label: string;
  dots: string[];
  clubs: ClubRow[];
  rows: FreightPoolRow[];
  hand: FreightPoolRow[];
}

/** The clubs of one type, from Floor's club rules (copied), no-route bills excluded. */
function clubRowsFor(
  types: readonly string[],
  clubs: FloorRouteClub[],
  typeRows: FreightPoolRow[],
  allRows: FreightPoolRow[],
): ClubRow[] {
  const typeClubs = clubs.filter((c) => types.includes(c.deliveryType)).sort((a, b) => a.sortOrder - b.sortOrder);
  const clubRouteIds = new Set(typeClubs.flatMap((c) => c.members.map((m) => m.routeId)));

  const section = (key: string, name: string, reachLabel: string | null, all: FreightPoolRow[]): RouteSection => ({
    key,
    name,
    reachLabel,
    rows: all.filter((r) => !r.isHand),
    hand: all.filter((r) => r.isHand),
  });
  const club = (key: string, name: string, routes: RouteSection[]): ClubRow => {
    const withBills = routes.filter((s) => s.rows.length > 0 || s.hand.length > 0);
    return {
      key,
      name,
      rows: withBills.flatMap((s) => s.rows),
      hand: withBills.flatMap((s) => s.hand),
      routes: withBills,
    };
  };

  const out: ClubRow[] = typeClubs.map((c) =>
    club(
      `club:${c.id}`,
      c.name,
      [...c.members]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((m) =>
          section(
            `r:${m.routeId}`,
            m.routeName,
            m.reachFrom,
            m.reachFrom === null
              ? typeRows.filter((r) => r.routeId === m.routeId)
              : allRows.filter((r) => r.routeId === m.routeId && r.deliveryType === m.reachFrom),
          ),
        ),
    ),
  );

  // Routes in no club: ONE "Other routes" row, a section per route, by kg (Floor's order).
  const other = typeRows.filter(
    (r) => !hasNoRoute(r) && r.routeId !== null && !clubRouteIds.has(r.routeId) && !HIDDEN_ROUTE_IDS.includes(r.routeId),
  );
  if (other.length > 0) {
    const byRoute = new Map<number, FreightPoolRow[]>();
    for (const r of other) {
      const list = byRoute.get(r.routeId as number) ?? [];
      list.push(r);
      byRoute.set(r.routeId as number, list);
    }
    const sections = Array.from(byRoute.entries())
      .map(([id, list]) => section(`r:${id}`, list[0].route ?? "Route", null, list))
      .sort((a, b) => kgOf(b.rows) - kgOf(a.rows) || a.name.localeCompare(b.name));
    out.push(club("other", "Other routes", sections));
  }
  // Only clubs with held bills — no greyed empty rows (owner).
  return out.filter((c) => c.rows.length > 0 || c.hand.length > 0);
}

export interface HeldCardsModel {
  cards: TypeCard[];
  /** Held bills with no route, or no delivery type — the amber card. Empty = no card. */
  noRoute: FreightPoolRow[];
}

/**
 * @param scopedRows the pool in the chip in effect; @param allRows the whole pool
 * (only for a club member that draws from another type, e.g. Kamrej).
 */
export function buildHeldCards(
  scope: FloorScope,
  clubs: FloorRouteClub[],
  scopedRows: FreightPoolRow[],
  allRows: FreightPoolRow[],
): HeldCardsModel {
  const typed = new Set<number>();
  const cards: TypeCard[] = [];
  for (const t of TYPE_CARDS) {
    if (scope !== "All" && scope !== t.key) continue;
    const types = scopeTypes(t.key) ?? [];
    const typeRows = scopedRows.filter((r) => r.deliveryType !== null && types.includes(r.deliveryType));
    for (const r of typeRows) if (!hasNoRoute(r)) typed.add(r.orderId);
    const clubRows = clubRowsFor(types, clubs, typeRows, allRows);
    // A Kamrej-style reach can pull rows of ANOTHER type into this card; the
    // card's totals are its club rows, so they always add up to what it lists.
    const rows = clubRows.flatMap((c) => c.rows);
    const hand = clubRows.flatMap((c) => c.hand);
    if (!t.always && rows.length === 0 && hand.length === 0) continue;
    cards.push({ key: t.key, label: t.label, dots: t.dots, clubs: clubRows, rows, hand });
  }
  for (const c of cards) for (const r of [...c.rows, ...c.hand]) typed.add(r.orderId);
  const noRoute = scopedRows.filter((r) => !typed.has(r.orderId) && !(r.routeId !== null && HIDDEN_ROUTE_IDS.includes(r.routeId)));
  return { cards, noRoute };
}

/** Find the bills a click opened, from the CURRENT model (so moved bills drop out). */
/** What a click opens: one club tab of a type (head click = its FIRST club), or No route. */
export type DrillTarget = { kind: "type"; type: TypeKey; clubKey: string } | { kind: "noRoute" };

/**
 * The drill-in's TABS (the type's club rows) and the selected one, from the
 * CURRENT model — so a club whose last bill went onto a trip drops out, and the
 * selection falls back to the first tab. Null = nothing left to show (back to cards).
 */
export function drillTabs(model: HeldCardsModel, t: DrillTarget): { tabs: ClubRow[]; selected: ClubRow } | null {
  if (t.kind === "noRoute") {
    if (model.noRoute.length === 0) return null;
    const rows = model.noRoute.filter((r) => !r.isHand);
    const hand = model.noRoute.filter((r) => r.isHand);
    const only: ClubRow = {
      key: "noRoute",
      name: "No route",
      rows,
      hand,
      routes: [{ key: "none", name: "No route", reachLabel: null, rows, hand }],
    };
    return { tabs: [only], selected: only };
  }
  const tabs = model.cards.find((c) => c.key === t.type)?.clubs ?? [];
  if (tabs.length === 0) return null;
  return { tabs, selected: tabs.find((c) => c.key === t.clubKey) ?? tabs[0] };
}

// ── The grid ────────────────────────────────────────────────────────────────
// Mockup sizes: card radius 14px, head 22px / 24px padding, kg 30px, rows 64px
// with an inset divider. 4 columns ≥1281px, 2 below, 1 at ≤680px.

const HEAD = "flex w-full items-center gap-4 border-b border-ink-100 px-6 py-[22px] text-left";
const ROW = "flex h-16 w-full flex-col justify-center px-6 text-left hover:bg-ink-25";

export function HeldCardGrid({
  model,
  onOpen,
  searching = false,
}: {
  model: HeldCardsModel;
  onOpen: (t: DrillTarget) => void;
  /** A search is in effect: an empty Local / Upcountry card reads "No matches". */
  searching?: boolean;
}) {
  const { cards, noRoute } = model;
  return (
    <div className="grid grid-cols-1 items-stretch gap-5 min-[681px]:grid-cols-2 min-[1281px]:grid-cols-4">
      {cards.map((c) => {
        const total = c.rows.length + c.hand.length;
        return (
          <section key={c.key} className="flex flex-col overflow-hidden rounded-[14px] border border-ink-100 bg-white">
            {/* Head = the whole type: the drill-in opens on its FIRST club tab. */}
            <button
              type="button"
              disabled={c.clubs.length === 0}
              onClick={() => c.clubs.length > 0 && onOpen({ kind: "type", type: c.key, clubKey: c.clubs[0].key })}
              className={`${HEAD} hover:bg-ink-25 disabled:cursor-default disabled:hover:bg-transparent`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-700">
                  <span className="inline-flex gap-[3px]">
                    {c.dots.map((d) => (
                      <span key={d} className={`h-2 w-2 shrink-0 rounded-full ${d}`} />
                    ))}
                  </span>
                  {c.label}
                </span>
                <span className="mt-2 block text-[30px] font-semibold leading-none tracking-[-0.025em] tabular-nums text-ink-900">
                  {c.rows.length > 0 ? kgText(c.rows) : "0"}
                  <small className="ml-1 text-[13px] font-medium tracking-normal text-ink-400">kg</small>
                </span>
                <span className="mt-2.5 flex flex-wrap gap-x-4 text-[12px] tabular-nums text-ink-500">
                  <span><b className="font-semibold text-ink-700">{stopCount(c.rows)}</b> stops</span>
                  <span><b className="font-semibold text-ink-700">{formatLitres(litresOf(c.rows))}</b> L</span>
                </span>
                {c.hand.length > 0 && (
                  <span className="mt-1 block whitespace-nowrap text-[11.5px] font-semibold tabular-nums text-data-brown">
                    +{c.hand.length} Hand &middot; {kgText(c.hand)} kg — not counted
                  </span>
                )}
              </span>
              {/* The ring's 64px slot, neutral: a plain count, no status. */}
              <span className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border border-ink-100 bg-ink-25">
                <span className="text-[17px] font-semibold leading-none tabular-nums text-ink-900">{total}</span>
                <span className="mt-[3px] text-[10px] font-medium text-ink-400">bills</span>
              </span>
            </button>
            {c.clubs.length === 0 ? (
              <div className="flex flex-1 items-center justify-center px-6 py-8 text-[12.5px] text-ink-400">{searching ? "No matches" : "No held bills"}</div>
            ) : (
              <div className="flex flex-1 flex-col py-1.5">
                {c.clubs.map((club, i) => (
                  <button
                    key={club.key}
                    type="button"
                    onClick={() => onOpen({ kind: "type", type: c.key, clubKey: club.key })}
                    className={`${ROW} ${i > 0 ? "shadow-[inset_0_1px_0_#F3F4F7]" : ""}`}
                  >
                    <span className="flex w-full items-baseline gap-2">
                      <span className="min-w-0 truncate text-[13px] font-semibold text-ink-900">{club.name}</span>
                      {club.rows.length > 0 ? (
                        <>
                          <span className="whitespace-nowrap text-[12px] text-ink-400">{plural(stopCount(club.rows), "stop", "stops")}</span>
                          <span className="ml-auto whitespace-nowrap text-[13px] font-semibold tabular-nums text-ink-900">
                            {kgText(club.rows)}
                            <small className="ml-0.5 text-[11.5px] font-normal text-ink-400">kg</small>
                          </span>
                        </>
                      ) : (
                        <span className="ml-auto whitespace-nowrap text-[12px] text-ink-400">Hand only</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {noRoute.length > 0 && (
        <section className="flex flex-col overflow-hidden rounded-[14px] border bg-white" style={{ borderColor: "#FCE7B2" /* mockup --amber-bd */ }}>
          <button type="button" onClick={() => onOpen({ kind: "noRoute" })} className={`${HEAD} bg-warn-bg`} style={{ borderBottomColor: "#FCE7B2" }}>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-700">
                <span className="h-2 w-2 shrink-0 rounded-full bg-warn-text" />
                No route
                <span className="ml-auto rounded-full border bg-white px-2 py-[2px] text-[11px] font-semibold text-warn-text" style={{ borderColor: "#FCE7B2" }}>
                  Needs an area
                </span>
              </span>
              <span className="mt-2 block text-[30px] font-semibold leading-none tracking-[-0.025em] tabular-nums text-ink-900">
                {noRoute.length}
                <small className="ml-1 text-[13px] font-medium tracking-normal text-ink-400">bills</small>
              </span>
              <span className="mt-2.5 flex flex-wrap gap-x-4 text-[12px] tabular-nums text-ink-500">
                <span><b className="font-semibold text-ink-700">{formatLitres(litresOf(noRoute))}</b> L</span>
                <span>Not on any type card</span>
              </span>
            </span>
          </button>
          <div className="flex flex-1 flex-col py-1.5">
            {noRoute.map((r, i) => (
              <button
                key={r.orderId}
                type="button"
                onClick={() => onOpen({ kind: "noRoute" })}
                className={`${ROW} ${i > 0 ? "shadow-[inset_0_1px_0_#F3F4F7]" : ""}`}
              >
                <span className="flex w-full items-baseline gap-2">
                  <span className="min-w-0 truncate text-[13px] font-semibold text-ink-900">{r.dealerName}</span>
                  <span className="whitespace-nowrap font-mono text-[12px] text-ink-400">{r.obdNumber}</span>
                  <span className="ml-auto whitespace-nowrap text-[12px] font-semibold text-warn-text">{hasNoRoute(r) ? "No route" : "No delivery type"}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
