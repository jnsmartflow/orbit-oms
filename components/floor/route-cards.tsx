"use client";

// Floor Control — BY ROUTE AS CARDS (2026-09-19, design:
// docs/mockups/floor-trips/route-cards.html).
//
// The pool's By route view on a tab that HAS CLUBS (Local today). Two rows of
// cards, three to a row:
//   row 1  one card per CLUB, in the club's fixed order — never re-sorted, and
//          an empty club stays in its place, dimmed, reading "No bills";
//   row 2  every other route of the tab that has bills today, one card each,
//          by name, with "No route" last.
// A tab with no clubs (All, Upcountry, IGT today) keeps the old route rows
// (ByRoute in trip-desk.tsx) — this component is not rendered there.
//
// 🔴 DISPLAY ONLY. Nothing here writes, and nothing here decides what the pool
// is: every row arrives already filtered by trip-desk.tsx (due half, on no
// trip, not in the tint room — `isPoolRow`). The card counts exactly what the
// pool holds, so the bar and the table under it always agree (owner). Held
// bills are not in the pool at all (every board arm pins dispatchStatus), so
// there is no amber here and no held count.
//
// ⚠ THE ONE REACH ACROSS THE TAB FILTER. A club member whose route has no area
// on this tab (Kamrej on Local) takes its bills from the tab its areas ARE on
// (`reachFrom`, worked out by lib/floor/route-clubs.ts) and its line says which,
// in grey. Only club members reach, and only that way; every other card is
// built from this tab's rows alone (owner, 2026-09-19).
//
// Commit 3 of 5: the cards only. Clicking a card to open its bills is commit 4.

import {
  countByStatus,
  formatLitres,
  formatWeightKg,
  sumLitres,
  sumWeightKg,
} from "./status-pill";
import type { FloorBoardRow, FloorRouteClub } from "@/lib/floor/types";

// ── The placeholder routes (lib/trips/route-label.ts PLACEHOLDER_ROUTE_IDS) ──
// route_master rows that name no place. Split here by what the owner decided
// for THIS view (2026-09-19):
//   20 "No Route" — folded into the "No route" card with bills whose area has
//                   no route at all; the two used to be separate groups that
//                   differed only by a capital letter.
//   25 "TEST R"   — hidden. Inactive, with no area (read 2026-09-19), so no
//                   bill can reach it today; if one ever did, it would not be
//                   on a card.
const NO_ROUTE_IDS: readonly number[] = [20];
const HIDDEN_ROUTE_IDS: readonly number[] = [25];
const NO_ROUTE_LABEL = "No route";

// ── The bar ─────────────────────────────────────────────────────────────────
// The trip bar's colours (trip-bar.tsx, owner 2026-09-15) plus the tint pink.
// The colour IS the status — no words, no chips (owner). No amber: see above.
const SEGMENTS = [
  { key: "done", color: "#2eb862" },
  { key: "picking", color: "#5b8ded" },
  { key: "waiting", color: "#d3d3dd" },
  { key: "tint", color: "#f9a8d4" },
] as const;
type BarKey = (typeof SEGMENTS)[number]["key"];

/**
 * The four segments, from `countByStatus` — the one owner of "what state is
 * this row in" (status-pill.tsx). Every one of its buckets lands in exactly one
 * segment, so the segments always fill the bar:
 *   done    = done + dispatched (dispatched is 0 on a live board)
 *   picking = with picker + picked, not checked
 *   waiting = waiting + tint done (the same rung: on the floor, nobody has it)
 *   tint    = tinting, plus the two tint-room states (never in the pool — they
 *             are the Tinting tab's — counted anyway so nothing falls through)
 */
function barCounts(rows: FloorBoardRow[]): Record<BarKey, number> {
  const c = countByStatus(rows);
  return {
    done: c.done + c.dispatched,
    picking: c.withPicker + c.needsCheck,
    waiting: c.waiting + c.tintDone,
    tint: c.tinting + c.tintAssigned + c.tintPending,
  };
}

function StatusBar({ rows, className = "" }: { rows: FloorBoardRow[]; className?: string }) {
  if (rows.length === 0) return null;
  const counts = barCounts(rows);
  return (
    <span className={`flex h-1 w-full gap-[1.5px] overflow-hidden rounded-[2px] bg-[#f1f1f6] ${className}`}>
      {SEGMENTS.map((s) =>
        counts[s.key] > 0 ? (
          <span key={s.key} className="h-full" style={{ flexGrow: counts[s.key], flexBasis: 0, background: s.color }} />
        ) : null,
      )}
    </span>
  );
}

// ── Figures ─────────────────────────────────────────────────────────────────

/** Distinct stops — `stopKey` is the trip module's own stop identity. */
function stopCount(rows: FloorBoardRow[]): number {
  return new Set(rows.map((r) => r.stopKey)).size;
}

/**
 * "2,807" — or "2,807+" when a bill has no weight, the same honest "+" the add
 * hint uses (floor-page.tsx). "—" when no bill on the card has a weight at all.
 *
 * WHOLE KILOS (the design): a card is read across the room to judge a truck,
 * and a tenth of a kilo is noise there. `formatWeightKg` still decides whether
 * there is a weight at all, so the two can never disagree about "—". Display
 * only — nothing rounded here is fed back into arithmetic.
 */
function kgText(rows: FloorBoardRow[]): string {
  const w = sumWeightKg(rows);
  if (formatWeightKg(w.kg) === null) return "—";
  return `${Math.round(w.kg).toLocaleString("en-US")}${w.unknown > 0 ? "+" : ""}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ── The model ───────────────────────────────────────────────────────────────

interface RouteLine {
  key: string;
  name: string;
  rows: FloorBoardRow[];
  /** The other tab this line's bills come from (Kamrej: "Upcountry"), or null. */
  reachLabel: string | null;
}

/** Row 2's key for a row: its route id, or the one shared "No route" key. */
function singleKey(r: FloorBoardRow): string {
  return r.routeId === null || NO_ROUTE_IDS.includes(r.routeId) ? "none" : `r:${r.routeId}`;
}

export function RouteCards({
  deliveryType,
  clubs,
  rows,
  reachRows,
}: {
  /** The tab's delivery type — the `deliveryType` string clubs and rows carry. */
  deliveryType: string;
  /** Every club the board returned; this component keeps the tab's own. */
  clubs: FloorRouteClub[];
  /** The tab's pool rows, due half — exactly what the pool lists. */
  rows: FloorBoardRow[];
  /**
   * Pool rows from EVERY tab, due half, same filters — read only for a club
   * member with `reachFrom`, and only its rows of that one other type.
   */
  reachRows: FloorBoardRow[];
}) {
  const tabClubs = clubs
    .filter((c) => c.deliveryType === deliveryType)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const clubRouteIds = new Set(tabClubs.flatMap((c) => c.members.map((m) => m.routeId)));

  // Row 1 — the clubs, members main first.
  const clubCards = tabClubs.map((c) => {
    const lines: RouteLine[] = [...c.members]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => ({
        key: `r:${m.routeId}`,
        name: m.routeName,
        rows:
          m.reachFrom === null
            ? rows.filter((r) => r.routeId === m.routeId)
            : reachRows.filter((r) => r.routeId === m.routeId && r.deliveryType === m.reachFrom),
        reachLabel: m.reachFrom,
      }));
    return { id: c.id, name: c.name, lines, rows: lines.flatMap((l) => l.rows) };
  });

  // Row 2 — this tab's other routes with bills. By name, "No route" last.
  const singles = new Map<string, RouteLine>();
  for (const r of rows) {
    if (r.routeId !== null && (clubRouteIds.has(r.routeId) || HIDDEN_ROUTE_IDS.includes(r.routeId))) continue;
    const key = singleKey(r);
    const line = singles.get(key) ?? {
      key,
      name: key === "none" ? NO_ROUTE_LABEL : r.route ?? NO_ROUTE_LABEL,
      rows: [],
      reachLabel: null,
    };
    line.rows.push(r);
    singles.set(key, line);
  }
  const singleCards = Array.from(singles.values()).sort((a, b) => {
    if (a.key === "none") return 1;
    if (b.key === "none") return -1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="px-3.5 py-3.5">
      {clubCards.length > 0 && (
        <div className="grid grid-cols-3 items-start gap-3">
          {clubCards.map((c) => (
            <ClubCard key={c.id} name={c.name} lines={c.lines} rows={c.rows} />
          ))}
        </div>
      )}
      {singleCards.length > 0 && (
        <div className={`grid grid-cols-3 items-start gap-3 ${clubCards.length > 0 ? "mt-3" : ""}`}>
          {singleCards.map((l) => (
            <SingleCard key={l.key} line={l} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── The cards ───────────────────────────────────────────────────────────────

const CARD = "rounded-[11px] border border-[#e7e7ee] bg-white";

function KgFigure({ rows }: { rows: FloorBoardRow[] }) {
  return (
    <p className="m-0 text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] tabular-nums text-[#1a1a22]">
      {kgText(rows)}
      <small className="ml-[3px] text-[13px] font-semibold tracking-normal text-[#96969f]">kg</small>
    </p>
  );
}

function ClubCard({ name, lines, rows }: { name: string; lines: RouteLine[]; rows: FloorBoardRow[] }) {
  // An empty club keeps its place, dimmed, and says so (owner).
  if (rows.length === 0) {
    return (
      <div className={`${CARD} opacity-[.45]`}>
        <div className="px-3.5 pb-3 pt-3.5">
          <p className="m-0 mb-1 text-[13px] font-semibold text-[#61616d]">{name}</p>
          <p className="m-0 text-[12.5px] text-[#96969f]">No bills</p>
        </div>
      </div>
    );
  }
  return (
    <div className={CARD}>
      <div className="px-3.5 pb-3 pt-3.5">
        <p className="m-0 mb-1 text-[13px] font-semibold text-[#61616d]">{name}</p>
        <KgFigure rows={rows} />
        <p className="m-0 mt-[5px] text-[12.5px] tabular-nums text-[#96969f]">
          {plural(stopCount(rows), "stop", "stops")} &middot; {formatLitres(sumLitres(rows))} L
        </p>
      </div>
      {lines.map((l) => (
        <div key={l.key} className="border-t border-[#f1f1f6] px-3.5 pb-3 pt-[11px]">
          <div className={`flex items-baseline gap-2 ${l.rows.length > 0 ? "mb-2" : ""}`}>
            <span className="text-[14.5px] font-semibold text-[#1a1a22]">{l.name}</span>
            {l.reachLabel && <span className="text-[11px] text-[#96969f]">{l.reachLabel}</span>}
            {l.rows.length > 0 ? (
              <>
                <span className="text-[12px] tabular-nums text-[#96969f]">
                  {plural(stopCount(l.rows), "stop", "stops")}
                </span>
                <span className="ml-auto text-[14px] font-bold tabular-nums text-[#1a1a22]">
                  {kgText(l.rows)}
                  <small className="ml-0.5 text-[11px] font-medium text-[#96969f]">kg</small>
                </span>
              </>
            ) : (
              // A club route with nothing today: the line stays so the card's
              // shape never changes, and says so — no bar to draw.
              <span className="text-[12px] text-[#96969f]">No bills</span>
            )}
          </div>
          <StatusBar rows={l.rows} />
        </div>
      ))}
    </div>
  );
}

function SingleCard({ line }: { line: RouteLine }) {
  return (
    <div className={CARD}>
      <div className="px-3.5 pb-3 pt-3.5">
        <p className="m-0 mb-1 text-[13px] font-semibold text-[#61616d]">{line.name}</p>
        <KgFigure rows={line.rows} />
        <p className="m-0 mt-[5px] text-[12.5px] tabular-nums text-[#96969f]">
          {plural(stopCount(line.rows), "stop", "stops")} &middot; {plural(line.rows.length, "bill", "bills")}
        </p>
      </div>
      <StatusBar rows={line.rows} className="mx-3.5 mb-3.5 !w-auto" />
    </div>
  );
}
