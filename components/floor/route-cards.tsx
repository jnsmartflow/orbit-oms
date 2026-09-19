"use client";

// Floor Control — BY ROUTE AS CARDS (2026-09-19, design:
// docs/mockups/floor-trips/route-cards.html).
//
// The pool's By route view on a tab that HAS CLUBS (Local today). Two kinds
// of card:
//   club    one per CLUB, in the club's fixed order — never re-sorted, and an
//           empty club stays in its place, dimmed, reading "No bills";
//   single  every other route of the tab that has bills, one COMPACT card
//           each, by name, with "No route" last.
// Where they sit depends on the screen width — see "The layout" below.
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
// CLICK A CARD and the bills of all its routes open full width under its row,
// one FloorTable per route (commit 4, 2026-09-19). WHICH cards are open is
// TripDesk's to decide, not this file's: every card holding a ticked bill,
// plus the one last clicked (commit 4b), so no tick is ever inside a closed
// card. Several can be open; each panel sits under its own card's row.

import { useEffect, useState } from "react";
import {
  countByStatus,
  formatLitres,
  formatWeightKg,
  sumLitres,
  sumWeightKg,
} from "./status-pill";
import { FloorTable, type FloorTableVariant } from "./floor-table";
import { sortPickingQueue } from "@/lib/picking/sort";
import { FLOOR_SPINE } from "@/lib/floor/sort";
import type { FloorSelection } from "@/lib/floor/selection";
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
//
// Built ONCE, by trip-desk.tsx, and handed to <RouteCards>. TripDesk needs it
// too: to open the card that holds the planner's ticked bills it has to know
// which card each bill is on, and a second copy of these rules would be two
// answers to one question.

export interface RouteLine {
  key: string;
  name: string;
  /** Bills due today or overdue — the ONLY bills any card number counts. */
  rows: FloorBoardRow[];
  /**
   * Bills promised for a later date (2026-09-19). Listed in the open panel,
   * after today's, and NEVER counted on the card: the kilos a planner loads
   * today's truck against must not include Sunday's bills (owner).
   */
  upcoming: FloorBoardRow[];
  /** The other tab this line's bills come from (Kamrej: "Upcountry"), or null. */
  reachLabel: string | null;
}

export interface RouteCard {
  /** Stable across reloads: `club:<id>` or `single:<route key>`. */
  key: string;
  kind: "club" | "single";
  name: string;
  /** Club: its members, main first. Single: its one route. */
  lines: RouteLine[];
  /** Every DUE bill on the card — the lines' rows together. What it counts. */
  rows: FloorBoardRow[];
  /** Every upcoming bill on the card — listed when open, never counted. */
  upcoming: FloorBoardRow[];
}

export interface RouteCardModel {
  /** Row 1 — the tab's clubs in their fixed order, empty ones included. */
  clubCards: RouteCard[];
  /** Row 2 — the tab's other routes with bills; by name, "No route" last. */
  singleCards: RouteCard[];
}

/**
 * Due today or overdue — the row's OWN `zone`, computed server-side by the one
 * expression the board shares (lib/floor/queries.ts), never a date compare
 * here: a null date is due, and a bill released early stays due.
 */
const isDue = (r: FloorBoardRow) => r.zone !== "upcoming";

/** Row 2's key for a row: its route id, or the one shared "No route" key. */
function singleKey(r: FloorBoardRow): string {
  return r.routeId === null || NO_ROUTE_IDS.includes(r.routeId) ? "none" : `r:${r.routeId}`;
}

/** Does this tab draw cards at all? Only when it has at least one club. */
export function tabHasClubs(clubs: FloorRouteClub[], deliveryType: string): boolean {
  return clubs.some((c) => c.deliveryType === deliveryType);
}

/**
 * The cards for one tab.
 *
 * @param rows      the tab's pool rows, BOTH halves — due and upcoming. Split
 *                  here by the row's own `zone` (never a date compare): due
 *                  rows are counted, upcoming ones only listed (2026-09-19).
 * @param reachRows pool rows from EVERY tab, both halves, same filters — read
 *                  only for a club member with `reachFrom`, and only its rows
 *                  of that one other type.
 */
export function buildRouteCards(
  deliveryType: string,
  clubs: FloorRouteClub[],
  rows: FloorBoardRow[],
  reachRows: FloorBoardRow[],
): RouteCardModel {
  const tabClubs = clubs
    .filter((c) => c.deliveryType === deliveryType)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const clubRouteIds = new Set(tabClubs.flatMap((c) => c.members.map((m) => m.routeId)));

  // Row 1 — the clubs, members main first.
  const clubCards: RouteCard[] = tabClubs.map((c) => {
    const lines: RouteLine[] = [...c.members]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => {
        const all =
          m.reachFrom === null
            ? rows.filter((r) => r.routeId === m.routeId)
            : reachRows.filter((r) => r.routeId === m.routeId && r.deliveryType === m.reachFrom);
        return {
          key: `r:${m.routeId}`,
          name: m.routeName,
          rows: all.filter(isDue),
          upcoming: all.filter((r) => !isDue(r)),
          reachLabel: m.reachFrom,
        };
      });
    return {
      key: `club:${c.id}`,
      kind: "club",
      name: c.name,
      lines,
      rows: lines.flatMap((l) => l.rows),
      upcoming: lines.flatMap((l) => l.upcoming),
    };
  });

  // Row 2 — this tab's other routes with bills. By name, "No route" last.
  // A route whose only bills are upcoming still gets a card (it reads "No
  // bills" and opens to list them) — upcoming bills with no route land in the
  // "No route" card, like every other route-less bill (owner, 2026-09-19).
  const singles = new Map<string, RouteLine>();
  for (const r of rows) {
    if (r.routeId !== null && (clubRouteIds.has(r.routeId) || HIDDEN_ROUTE_IDS.includes(r.routeId))) continue;
    const key = singleKey(r);
    const line = singles.get(key) ?? {
      key,
      name: key === "none" ? NO_ROUTE_LABEL : r.route ?? NO_ROUTE_LABEL,
      rows: [],
      upcoming: [],
      reachLabel: null,
    };
    (isDue(r) ? line.rows : line.upcoming).push(r);
    singles.set(key, line);
  }
  const singleCards: RouteCard[] = Array.from(singles.values())
    .sort((a, b) => {
      if (a.key === "none") return 1;
      if (b.key === "none") return -1;
      return a.name.localeCompare(b.name);
    })
    .map((l) => ({ key: `single:${l.key}`, kind: "single", name: l.name, lines: [l], rows: l.rows, upcoming: l.upcoming }));

  return { clubCards, singleCards };
}

/**
 * The cards holding at least one ticked bill, in board order (row 1 left to
 * right, then row 2). TripDesk keeps every one of them open (commit 4b).
 */
export function cardsHoldingTicks(model: RouteCardModel, selection: ReadonlySet<number>): string[] {
  if (selection.size === 0) return [];
  return [...model.clubCards, ...model.singleCards]
    // BOTH halves: a ticked upcoming bill is a tick like any other, and must
    // never sit inside a closed card either.
    .filter((c) => [...c.rows, ...c.upcoming].some((r) => selection.has(r.orderId)))
    .map((c) => c.key);
}

// ── The board ───────────────────────────────────────────────────────────────

// FLOOR_SPINE, imported and never re-implemented (FLOOR §3) — the same sort
// every other floor table uses, so a bill sits in the same order as in Flat.
const sort = (rows: FloorBoardRow[]) => sortPickingQueue(rows, FLOOR_SPINE) as FloorBoardRow[];

/**
 * Upcoming bills by due date, earliest first (owner). FLOOR_SPINE first, then a
 * STABLE sort on the date, so bills due the same day keep the spine's order.
 * `dispatchTargetDate` is the row's "YYYY-MM-DD" string, so text order is date
 * order; an upcoming row always has one (a null date is never upcoming).
 */
const sortUpcoming = (rows: FloorBoardRow[]) =>
  sort(rows).sort((a, b) => (a.dispatchTargetDate ?? "").localeCompare(b.dispatchTargetDate ?? ""));

/** Anything to open — today's bills or later ones. */
const openable = (c: RouteCard) => c.rows.length > 0 || c.upcoming.length > 0;

/** What each route's FloorTable needs beyond its rows — trip-desk's LeafProps. */
interface LeafWiring {
  selection?: FloorSelection;
  onToggleRow?: (id: number) => void;
  onToggleAll?: (rows: FloorBoardRow[]) => void;
  onMarkUrgent: (id: number) => void;
  onOpenDetail: (id: number) => void;
  gateOn: boolean;
}

// ── The layout (2026-09-19, owner) ──────────────────────────────────────────
//
// THREE LAYOUTS BY SCREEN WIDTH, and nothing shrinks to make one fit:
//
//   wide    ≥ 1400px  four columns — three club columns, then a narrower
//                     column (0.7 of a club's) that STACKS the single cards.
//                     The depot desk runs at ~1920px: this is the normal view.
//   mid  1100–1399px  three club columns, then the single cards in a short
//                     row beneath them, side by side.
//   narrow  < 1100px  two club columns, the single cards under the clubs.
//
// 🔴 WHY THE BREAKPOINTS ARE WHERE THEY ARE. Measured in Chrome with the app's
// font (2026-09-19): "Kamrej · Upcountry · 3 stops · 1,174 kg" is 225px wide
// at the card's sizes, and ordinary lines run to ~207px. With the 72px sidebar
// and the 298px trip rail, four columns leave a club column only ~196px of text
// at 1280px — so four columns start at 1400px, where it is ~228px.
//
// 🔴 A JS WIDTH, NOT CSS ALONE. A card's panel opens under the ROW its card is
// in, and the rows differ per layout (the single cards sit beside club row 1,
// or under all of them). CSS can move boxes between columns but not decide
// which row a panel follows, so the layout is chosen here and ONE is drawn.
//
// ⚠ NOTHING COUNTS TO THREE BY HAND. Clubs fill `clubCols` per row in their
// sortOrder and wrap; a row with fewer clubs leaves its cells EMPTY rather than
// stretching them (every row uses the same fixed track list). A club with more
// routes simply grows a line per route; `items-start` keeps a tall card from
// stretching its neighbours. Any number of single cards join the stack or the
// row, and a tall stack only makes its row taller — the club tracks never give
// up width to it.

export type CardLayout = "wide" | "mid" | "narrow";

const WIDE_MIN = 1400;
const MID_MIN = 1100;

function layoutFor(width: number): CardLayout {
  return width >= WIDE_MIN ? "wide" : width >= MID_MIN ? "mid" : "narrow";
}

/**
 * The layout for the current window, following resizes. `matchMedia` change
 * events, never a key listener (floor-page owns the floor's only one).
 *
 * Starts at "wide" — the desk's own width — until the first effect reads the
 * real window; TripDesk only ever renders in the browser, so that first read
 * lands before anyone can click.
 */
export function useCardLayout(): CardLayout {
  const [layout, setLayout] = useState<CardLayout>("wide");
  useEffect(() => {
    const wide = window.matchMedia(`(min-width: ${WIDE_MIN}px)`);
    const mid = window.matchMedia(`(min-width: ${MID_MIN}px)`);
    const read = () => setLayout(layoutFor(window.innerWidth));
    read();
    wide.addEventListener("change", read);
    mid.addEventListener("change", read);
    return () => {
      wide.removeEventListener("change", read);
      mid.removeEventListener("change", read);
    };
  }, []);
  return layout;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function RouteCards({
  model,
  layout,
  openKeys,
  onToggleCard,
  nowMs,
  anchorIso,
  variant,
  leaf,
}: {
  model: RouteCardModel;
  /** Which of the three layouts to draw — TripDesk passes `useCardLayout()`. */
  layout: CardLayout;
  /** The open cards' keys — any number (TripDesk `openCards`). */
  openKeys: readonly string[];
  onToggleCard: (key: string) => void;
  nowMs: number;
  anchorIso: string;
  variant: FloorTableVariant;
  /** Forwarded unchanged to each route's FloorTable. No selection in History. */
  leaf: LeafWiring;
}) {
  const { clubCards, singleCards } = model;
  // A key that no longer names a card with bills (its last bill went onto a
  // trip, or its single card is gone) counts as closed: nothing to show, and
  // nothing else dims for it.
  const isOpen = (c: RouteCard) => openable(c) && openKeys.includes(c.key);
  const anyOpen = [...clubCards, ...singleCards].some(isOpen);

  const card = (c: RouteCard) => (
    <CardButton
      key={c.key}
      card={c}
      isOpen={isOpen(c)}
      dimmed={anyOpen && !isOpen(c)}
      onToggle={() => onToggleCard(c.key)}
    />
  );
  // THE PANELS OPEN UNDER THE ROW THEIR CARD IS IN, full width (design) — one
  // per open card, in the cards' own order, so two open cards in one row stack
  // in the order they stand.
  const panels = (cards: RouteCard[]) =>
    cards.filter(isOpen).map((c) => (
      <OpenPanel key={`panel:${c.key}`} card={c} nowMs={nowMs} anchorIso={anchorIso} variant={variant} leaf={leaf} />
    ));

  const clubCols = layout === "narrow" ? 2 : 3;
  // Always at least one row, so the singles column has a row to sit in even if
  // a tab's clubs were all removed while the cards were on screen.
  const clubRows = clubCards.length > 0 ? chunk(clubCards, clubCols) : [[]];

  if (layout === "wide") {
    // ONE TRACK LIST FOR EVERY ROW, so the columns line up down the page. The
    // stack is pinned to track 4 of row 1; later rows leave track 4 empty.
    const tracks = "repeat(3, minmax(0, 1fr)) minmax(0, 0.7fr)";
    return (
      <div className="px-3.5 py-3.5">
        {clubRows.map((row, i) => (
          <div key={i} className={i === 0 ? "" : "mt-3"}>
            <div className="grid items-start gap-3" style={{ gridTemplateColumns: tracks }}>
              {row.map(card)}
              {i === 0 && singleCards.length > 0 && (
                <div className="flex flex-col gap-2" style={{ gridColumn: 4, gridRow: 1 }}>
                  {singleCards.map(card)}
                </div>
              )}
            </div>
            {/* Row 1's panels include the stack's: it sits beside that row. */}
            {panels(i === 0 ? [...row, ...singleCards] : row)}
          </div>
        ))}
      </div>
    );
  }

  // mid / narrow — club rows, then the single cards beneath them.
  const clubTracks = `repeat(${clubCols}, minmax(0, 1fr))`;
  // Mid: a short row of compact cards, as many as fit, never stretched to fill
  // it (auto-fill keeps the empty tracks). Narrow: the same two columns as the
  // clubs, so the singles stack under them.
  const singleTracks = layout === "mid" ? "repeat(auto-fill, minmax(190px, 1fr))" : clubTracks;
  return (
    <div className="px-3.5 py-3.5">
      {clubRows.map((row, i) =>
        row.length === 0 ? null : (
          <div key={i} className={i === 0 ? "" : "mt-3"}>
            <div className="grid items-start gap-3" style={{ gridTemplateColumns: clubTracks }}>
              {row.map(card)}
            </div>
            {panels(row)}
          </div>
        ),
      )}
      {singleCards.length > 0 && (
        <div className={clubCards.length > 0 ? "mt-3" : ""}>
          <div className="grid items-start gap-3" style={{ gridTemplateColumns: singleTracks }}>
            {singleCards.map(card)}
          </div>
          {panels(singleCards)}
        </div>
      )}
    </div>
  );
}

// ── The cards ───────────────────────────────────────────────────────────────
//
// 🔴 THE CARD IS THE BUTTON (owner): no "Take both", no chevron. Click opens
// the bills of every route on it; click again, or another card, closes or
// switches — except a card holding ticked bills, which stays open beside the
// new one until its ticks go (see trip-desk.tsx).
//
// ⚠ A real <button>, so Tab and Enter/Space work with no key listener of ours:
// the floor has ONE window-level key listener and it is floor-page's (FLOOR
// §4.6). Its content is spans only — a <p> or <div> is not valid in a button.
//
// ⚠ CLUB TEXT NEVER WRAPS (owner). Every line is `whitespace-nowrap`; if a
// line ever outgrows its card (a five-figure Kamrej near 1400px), the ROUTE
// NAME gives way with an ellipsis and the numbers stay whole — the layout
// breakpoints above are what keep that from happening in practice.

const CARD = "block w-full min-w-0 rounded-[11px] border bg-white text-left transition-opacity";

function KgFigure({ rows }: { rows: FloorBoardRow[] }) {
  return (
    <span className="block whitespace-nowrap text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] tabular-nums text-[#1a1a22]">
      {kgText(rows)}
      <small className="ml-[3px] text-[13px] font-semibold tracking-normal text-[#96969f]">kg</small>
    </span>
  );
}

function CardButton({
  card,
  isOpen,
  dimmed,
  onToggle,
}: {
  card: RouteCard;
  isOpen: boolean;
  dimmed: boolean;
  onToggle: () => void;
}) {
  // EMPTY = nothing due today or overdue: the card reads "No bills", dimmed.
  // It can still OPEN when it holds upcoming bills (owner, 2026-09-19) — only a
  // card with nothing at all is inert.
  const empty = card.rows.length === 0;
  const canOpen = openable(card);
  // Open: the violet ring (brand, CLAUDE_UI §2).
  const cls = [
    CARD,
    isOpen ? "border-brand-600 ring-[3px] ring-brand-100" : "border-[#e7e7ee] hover:border-[#cfcfda]",
    (empty && !isOpen) || dimmed ? "opacity-[.45]" : "",
    canOpen ? "cursor-pointer" : "cursor-default",
  ].join(" ");

  return (
    <button
      type="button"
      className={cls}
      onClick={onToggle}
      disabled={!canOpen}
      aria-expanded={canOpen ? isOpen : undefined}
    >
      {card.kind === "single" ? (
        <CompactSingle card={card} />
      ) : empty ? (
        // Nothing due: an empty club keeps its place, dimmed, and says so
        // (owner) — and so does a club whose only bills are upcoming.
        <span className="block px-3.5 pb-3 pt-3.5">
          <span className="mb-1 block truncate text-[13px] font-semibold text-[#61616d]">{card.name}</span>
          <span className="block text-[12.5px] text-[#96969f]">No bills</span>
        </span>
      ) : (
        <>
          <span className="block px-3.5 pb-3 pt-3.5">
            <span className="mb-1 block truncate text-[13px] font-semibold text-[#61616d]">{card.name}</span>
            <KgFigure rows={card.rows} />
            <span className="mt-[5px] block whitespace-nowrap text-[12.5px] tabular-nums text-[#96969f]">
              {plural(stopCount(card.rows), "stop", "stops")} &middot; {formatLitres(sumLitres(card.rows))} L
            </span>
          </span>
          {card.lines.map((l) => (
            <span key={l.key} className="block border-t border-[#f1f1f6] px-3.5 pb-3 pt-[11px]">
              <span className={`flex items-baseline gap-2 whitespace-nowrap ${l.rows.length > 0 ? "mb-2" : ""}`}>
                <span className="min-w-0 truncate text-[14.5px] font-semibold text-[#1a1a22]">{l.name}</span>
                {l.reachLabel && <span className="shrink-0 text-[11px] text-[#96969f]">{l.reachLabel}</span>}
                {l.rows.length > 0 ? (
                  <>
                    <span className="shrink-0 text-[12px] tabular-nums text-[#96969f]">
                      {plural(stopCount(l.rows), "stop", "stops")}
                    </span>
                    <span className="ml-auto shrink-0 text-[14px] font-bold tabular-nums text-[#1a1a22]">
                      {kgText(l.rows)}
                      <small className="ml-0.5 text-[11px] font-medium text-[#96969f]">kg</small>
                    </span>
                  </>
                ) : (
                  // A club route with nothing today: the line stays so the
                  // card's shape never changes, and says so — no bar to draw.
                  <span className="shrink-0 text-[12px] text-[#96969f]">No bills</span>
                )}
              </span>
              <StatusBar rows={l.rows} />
            </span>
          ))}
        </>
      )}
    </button>
  );
}

/**
 * A single-route card, COMPACT (owner, 2026-09-19) — it lives in the narrow
 * fourth column or a short row, and is the smallest thing on the board:
 *   line 1  route name left, kilos right       "Parvat            4 kg"
 *   line 2  "1 stop · 1 bill", small and grey  (or "No bills" when nothing
 *           is due today — its upcoming bills still open with it)
 *   then the bar. No big number: that stays on the club cards.
 */
function CompactSingle({ card }: { card: RouteCard }) {
  const due = card.rows;
  return (
    <span className="block px-3 pb-2.5 pt-2.5">
      <span className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="min-w-0 truncate text-[13.5px] font-semibold text-[#1a1a22]">{card.name}</span>
        {due.length > 0 && (
          <span className="ml-auto shrink-0 text-[13.5px] font-bold tabular-nums text-[#1a1a22]">
            {kgText(due)}
            <small className="ml-0.5 text-[11px] font-medium text-[#96969f]">kg</small>
          </span>
        )}
      </span>
      <span className="mt-0.5 block whitespace-nowrap text-[11.5px] tabular-nums text-[#96969f]">
        {due.length > 0 ? (
          <>
            {plural(stopCount(due), "stop", "stops")} &middot; {plural(due.length, "bill", "bills")}
          </>
        ) : (
          "No bills"
        )}
      </span>
      {due.length > 0 && (
        <span className="mt-2 block">
          <StatusBar rows={due} />
        </span>
      )}
    </span>
  );
}

// ── The open panel ──────────────────────────────────────────────────────────
//
// One section per route with bills, main first: a small heading (name, the
// grey reach label, stops, kilos), then that route's own FloorTable.
//
// ⚠ ONE FloorTable PER ROUTE, never one merged table: it keeps `toggleAll` per
// group — the contract lib/floor/selection.ts documents — and it is the
// pattern the trip panel's stops already use. Every FloorTable shares one
// colgroup, so the columns line up across sections.
//
// ⚠ AREA, NOT ROUTE (`showArea`, owner): every bill in a section is on the
// route its heading names.
//
// A route with nothing at all gets no section. A route whose only bills are
// upcoming DOES — its heading says "No bills" (nothing due) and its table
// lists them.
//
// ⚠ ONE TABLE PER ROUTE, TODAY'S FIRST, THEN UPCOMING BY DATE — and no
// "Upcoming" divider (owner, 2026-09-19): the blue date in each row's Due
// cell is the explanation. So they go in as plain `rows`, NOT through
// FloorTable's `upcomingRows`, which is what draws the divider. The heading
// counts today's bills only, like the card.

function OpenPanel({
  card,
  nowMs,
  anchorIso,
  variant,
  leaf,
}: {
  card: RouteCard;
  nowMs: number;
  anchorIso: string;
  variant: FloorTableVariant;
  leaf: LeafWiring;
}) {
  const sections = card.lines.filter((l) => l.rows.length > 0 || l.upcoming.length > 0);
  return (
    <div className="mt-3 overflow-hidden rounded-[11px] border border-[#e7e7ee] bg-white">
      {sections.map((l, i) => (
        <div key={l.key} className={i === 0 ? "" : "border-t border-[#e7e7ee]"}>
          <div className="flex flex-wrap items-baseline gap-[9px] border-b border-[#e7e7ee] bg-[#fafafc] px-3.5 py-[9px]">
            <span className="text-[13.5px] font-bold text-[#1a1a22]">{l.name}</span>
            {l.reachLabel && <span className="text-[11px] text-[#96969f]">{l.reachLabel}</span>}
            <span className="text-[12px] tabular-nums text-[#96969f]">
              {l.rows.length > 0 ? (
                <>
                  {plural(stopCount(l.rows), "stop", "stops")} &middot; {kgText(l.rows)} kg
                </>
              ) : (
                "No bills"
              )}
            </span>
          </div>
          <FloorTable
            rows={[...sort(l.rows), ...sortUpcoming(l.upcoming)]}
            nowMs={nowMs}
            anchorIso={anchorIso}
            variant={variant}
            showArea
            {...leaf}
          />
        </div>
      ))}
    </div>
  );
}
