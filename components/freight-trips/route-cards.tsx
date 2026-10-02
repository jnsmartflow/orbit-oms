"use client";

// Freight Trips — the held pool as ROUTE CARDS, Floor's "By route" look.
//
// 🔴 COPIED, NOT IMPORTED (decided 2026-10-02). Floor's components/floor/route-cards.tsx
// is typed to FloorBoardRow (zone, pick status for its bar) and wires FloorTable
// into its open panel; it has no switch for the bar. Freight rows are HELD bills —
// no pick progress, no upcoming zone — so the CLUBBING RULES and the CARD LOOK
// are copied here and the status bar is left out. Floor's file is untouched.
//
// Rules copied from Floor (keep in step by hand if Floor's change):
//   - a club is on a section when its delivery type is one the section covers
//     (scopeTypes — imported, pure); members main first; a member with no bills
//     gets no line; a member with `reachFrom` draws that other type's bills;
//   - every route of the section in no club, plus route-less bills, share ONE
//     "Other routes" card — lines by kg, "No route" last; route 20 folds into
//     "No route", route 25 is hidden;
//   - Hand bills (the dealer collects) ride no truck: out of kg / L / stops,
//     summed as "+N Hand · X kg — not counted";
//   - every card the same height across the grid (spacer line slots).
// Clubs come from Floor's getRouteClubs() via /api/freight-trips/pool.

import { formatLitres, formatWeightKg } from "@/components/floor/status-pill";
import { loadKg, loadLitres } from "@/lib/orders/gift";
import { scopeTypes } from "@/lib/floor/scope";
import type { FloorRouteClub, FloorScope } from "@/lib/floor/types";
import type { FreightPoolRow } from "@/lib/freight-trips/pool";

const NO_ROUTE_IDS: readonly number[] = [20];
const HIDDEN_ROUTE_IDS: readonly number[] = [25];
const NO_ROUTE_LABEL = "No route";

export interface FreightLine {
  key: string;
  name: string;
  /** Counted bills (not Hand). */
  rows: FreightPoolRow[];
  hand: FreightPoolRow[];
  reachLabel: string | null;
}

export interface FreightCard {
  key: string;
  name: string;
  lines: FreightLine[];
  rows: FreightPoolRow[];
  hand: FreightPoolRow[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function stopCount(rows: FreightPoolRow[]): number {
  return new Set(rows.map((r) => r.stopKey)).size;
}

export function litresOf(rows: FreightPoolRow[]): number {
  return rows.reduce((s, r) => s + loadLitres(r.volumeLitres, r.isGift), 0);
}

/** Whole kilos, "+" when a bill has no weight, "—" when none has one (Floor's kgText). */
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

function kgNumber(rows: FreightPoolRow[]): number {
  return rows.reduce((s, r) => s + (loadKg(r.weightKg, r.isGift) ?? 0), 0);
}

/** The delivery types a section covers — Floor's scopeTypes (pure), [] for "no type". */
export function sectionTypes(section: Exclude<FloorScope, "All"> | null): readonly string[] {
  return section === null ? [] : scopeTypes(section) ?? [];
}

/**
 * The cards for one delivery-type SECTION.
 * @param types       the delivery types the section covers (sectionTypes)
 * @param sectionRows the section's rows; @param allRows every pool row (for `reachFrom`).
 */
export function buildFreightCards(
  types: readonly string[],
  clubs: FloorRouteClub[],
  sectionRows: FreightPoolRow[],
  allRows: FreightPoolRow[],
): FreightCard[] {
  const sectionClubs = clubs.filter((c) => types.includes(c.deliveryType)).sort((a, b) => a.sortOrder - b.sortOrder);
  const clubRouteIds = new Set(sectionClubs.flatMap((c) => c.members.map((m) => m.routeId)));

  const clubCards: FreightCard[] = sectionClubs.map((c) => {
    const lines: FreightLine[] = [...c.members]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => {
        const all =
          m.reachFrom === null
            ? sectionRows.filter((r) => r.routeId === m.routeId)
            : allRows.filter((r) => r.routeId === m.routeId && r.deliveryType === m.reachFrom);
        return {
          key: `r:${m.routeId}`,
          name: m.routeName,
          rows: all.filter((r) => !r.isHand),
          hand: all.filter((r) => r.isHand),
          reachLabel: m.reachFrom,
        };
      })
      .filter((l) => l.rows.length > 0 || l.hand.length > 0);
    return {
      key: `club:${c.id}`,
      name: c.name,
      lines,
      rows: lines.flatMap((l) => l.rows),
      hand: lines.flatMap((l) => l.hand),
    };
  });

  const others = new Map<string, FreightLine>();
  for (const r of sectionRows) {
    if (r.routeId !== null && (clubRouteIds.has(r.routeId) || HIDDEN_ROUTE_IDS.includes(r.routeId))) continue;
    const key = r.routeId === null || NO_ROUTE_IDS.includes(r.routeId) ? "none" : `r:${r.routeId}`;
    const line = others.get(key) ?? {
      key,
      name: key === "none" ? NO_ROUTE_LABEL : r.route ?? NO_ROUTE_LABEL,
      rows: [],
      hand: [],
      reachLabel: null,
    };
    (r.isHand ? line.hand : line.rows).push(r);
    others.set(key, line);
  }
  const otherLines = Array.from(others.values()).sort((a, b) => {
    if (a.key === "none") return 1;
    if (b.key === "none") return -1;
    return kgNumber(b.rows) - kgNumber(a.rows) || a.name.localeCompare(b.name);
  });
  const cards = clubCards.filter((c) => c.rows.length > 0 || c.hand.length > 0);
  if (otherLines.length > 0) {
    cards.push({
      key: "other",
      name: "Other routes",
      lines: otherLines,
      rows: otherLines.flatMap((l) => l.rows),
      hand: otherLines.flatMap((l) => l.hand),
    });
  }
  return cards;
}

// ── The grid ────────────────────────────────────────────────────────────────

const CARD = "block w-full min-w-0 rounded-[11px] border border-ink-100 bg-white text-left";
const LINE = "block w-full border-t border-ink-50 px-3.5 pb-3 pt-[11px] text-left";

/** What a click opens: the whole card (lineKey null) or one route line. */
export interface DrillTarget {
  section: string;
  cardKey: string;
  lineKey: string | null;
}

export function FreightCardGrid({
  section,
  cards,
  lineSlots,
  handSlot,
  onOpen,
}: {
  section: string;
  cards: FreightCard[];
  /** The most route lines on any card on the page — every card gets that many slots. */
  lineSlots: number;
  /** Some card on the page has Hand bills — reserve the "+N Hand" line. */
  handSlot: boolean;
  onOpen: (t: DrillTarget) => void;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {cards.map((c) => {
        const spacers = Math.max(0, lineSlots - c.lines.length);
        const handOnly = c.rows.length === 0;
        return (
          <div key={c.key} className={CARD}>
            <button
              type="button"
              onClick={() => onOpen({ section, cardKey: c.key, lineKey: null })}
              className="block w-full rounded-t-[11px] px-3.5 pb-3 pt-3.5 text-left hover:bg-ink-25"
            >
              <span className="mb-1 block truncate text-[13px] font-semibold text-ink-500">{c.name}</span>
              <span className="block whitespace-nowrap text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] tabular-nums text-ink-900">
                {handOnly ? (
                  <small className="text-[13px] font-medium tracking-normal text-ink-400">Hand only</small>
                ) : (
                  <>
                    {kgText(c.rows)}
                    <small className="ml-[3px] text-[13px] font-semibold tracking-normal text-ink-400">kg</small>
                  </>
                )}
              </span>
              <span className="mt-[5px] block whitespace-nowrap text-[12.5px] tabular-nums text-ink-400">
                {handOnly ? <>&nbsp;</> : <>{plural(stopCount(c.rows), "stop", "stops")} &middot; {formatLitres(litresOf(c.rows))} L</>}
              </span>
              {handSlot && (
                <span
                  className={`mt-[3px] block whitespace-nowrap text-[11.5px] font-semibold tabular-nums text-data-brown ${c.hand.length > 0 ? "" : "invisible"}`}
                  aria-hidden={c.hand.length === 0}
                >
                  +{c.hand.length} Hand &middot; {kgText(c.hand)} kg — not counted
                </span>
              )}
            </button>
            {Array.from({ length: spacers }, (_, i) => (
              <span key={`spacer:${i}`} className={`${LINE} invisible`} aria-hidden>
                <span className="flex items-baseline gap-2 text-[14.5px]">·</span>
              </span>
            ))}
            {c.lines.map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => onOpen({ section, cardKey: c.key, lineKey: l.key })}
                className={`${LINE} hover:bg-ink-25`}
              >
                <span className="flex items-baseline gap-2 whitespace-nowrap">
                  <span className="min-w-0 truncate text-[14.5px] font-semibold text-ink-900">{l.name}</span>
                  {l.reachLabel && <span className="shrink-0 text-[11px] text-ink-400">{l.reachLabel}</span>}
                  {l.rows.length > 0 ? (
                    <>
                      <span className="shrink-0 text-[12px] tabular-nums text-ink-400">{plural(stopCount(l.rows), "stop", "stops")}</span>
                      <span className="ml-auto shrink-0 text-[14px] font-bold tabular-nums text-ink-900">
                        {kgText(l.rows)}
                        <small className="ml-0.5 text-[11px] font-medium text-ink-400">kg</small>
                      </span>
                    </>
                  ) : (
                    <span className="shrink-0 text-[12px] text-ink-400">Hand only</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
