"use client";

// Floor Control — BY ROUTE AS CARDS (2026-09-19, design:
// docs/mockups/floor-trips/route-cards.html).
//
// The pool's By route view on a tab that HAS CLUBS (Local today). Two kinds
// of card:
//   club    one per CLUB, in the club's fixed order — never re-sorted, and an
//           empty club stays in its place, dimmed, reading "No bills";
//   other   ONE "Other routes" card, always last: every route of the tab in
//           no club, plus the route-less bills, one line each — lines by
//           kilos, "No route" always the last line. Display-only: nothing is
//           written for it (owner, 2026-09-19).
// All the same size, in one grid — see "The layout" below.
// A tab with no clubs (All, Upcountry, IGT today) keeps the old route rows
// (ByRoute in trip-desk.tsx) — this component is not rendered there.
//
// 🔴 DISPLAY ONLY. Nothing here writes, and nothing here decides what the pool
// is: every row arrives already filtered by trip-desk.tsx (due half, on no
// trip, not in the tint room — `isPoolRow`). The card counts exactly what the
// pool holds, so the bar and the table under it always agree (owner). Held
// bills are not in the pool at all (every board arm pins dispatchStatus), so
// there is no held segment here and no held count.
// Was: pick_done shown blue with 'being picked' until 2026-09-22; now its own yellow segment. Do not revert.
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
import { NEEDS_CHECK_SEGMENT } from "./progress-bar";
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
/** The display-only card that gathers every unclubbed route (see RouteCardModel). */
const OTHER_ROUTES_LABEL = "Other routes";

// ── The bar ─────────────────────────────────────────────────────────────────
// The trip bar's colours (trip-bar.tsx) plus the tint pink. The colour IS the
// status — no words, no chips (owner). No held segment: see above.
const SEGMENTS = [
  { key: "done", color: "#2eb862" },
  { key: "needsCheck", color: NEEDS_CHECK_SEGMENT },
  { key: "picking", color: "#5b8ded" },
  { key: "waiting", color: "#d3d3dd" },
  { key: "tint", color: "#f9a8d4" },
] as const;
type BarKey = (typeof SEGMENTS)[number]["key"];

/**
 * The five segments, from `countByStatus` — the one owner of "what state is
 * this row in" (status-pill.tsx). Every one of its buckets lands in exactly one
 * segment, so the segments always fill the bar:
 *   done       = done + dispatched (dispatched is 0 on a live board)
 *   needsCheck = picked, not checked (pick_done) — yellow since 2026-09-22
 *   picking    = with picker
 *   waiting    = waiting + tint done (the same rung: on the floor, nobody has it)
 *   tint       = tinting, plus the two tint-room states (never in the pool — they
 *                are the Tinting tab's — counted anyway so nothing falls through)
 */
function barCounts(rows: FloorBoardRow[]): Record<BarKey, number> {
  const c = countByStatus(rows);
  return {
    done: c.done + c.dispatched,
    needsCheck: c.needsCheck,
    picking: c.withPicker,
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
  /** Stable across reloads: `club:<id>`, or `other` for the Other routes card. */
  key: string;
  kind: "club" | "other";
  name: string;
  /** Club: its members, main first. Other routes: by kilos, No route last. */
  lines: RouteLine[];
  /** Every DUE bill on the card — the lines' rows together. What it counts. */
  rows: FloorBoardRow[];
  /** Every upcoming bill on the card — listed when open, never counted. */
  upcoming: FloorBoardRow[];
}

export interface RouteCardModel {
  /** First, the tab's clubs in their fixed order, empty ones included. */
  clubCards: RouteCard[];
  /**
   * Then ONE "Other routes" card (owner, 2026-09-19): every route of the tab
   * that is in no club and has bills, plus the route-less bills, one LINE each.
   * Always the last card. Null when there is nothing unclubbed at all.
   *
   * ⚠ DISPLAY-ONLY GROUPING. It is not a club and nothing is written for it:
   * Parvat stays unclubbed in route_club_members. It is built here, from the
   * rows, every render.
   */
  otherCard: RouteCard | null;
}

/**
 * Due today or overdue — the row's OWN `zone`, computed server-side by the one
 * expression the board shares (lib/floor/queries.ts), never a date compare
 * here: a null date is due, and a bill released early stays due.
 */
const isDue = (r: FloorBoardRow) => r.zone !== "upcoming";

/** A line of Other routes: its route id, or the one shared "No route" key. */
function otherLineKey(r: FloorBoardRow): string {
  return r.routeId === null || NO_ROUTE_IDS.includes(r.routeId) ? "none" : `r:${r.routeId}`;
}

/** Every card in board order: the clubs, then Other routes when there is one. */
function allCards(model: RouteCardModel): RouteCard[] {
  return model.otherCard ? [...model.clubCards, model.otherCard] : model.clubCards;
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

  // The clubs, in sortOrder, members main first.
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

  // OTHER ROUTES — every route of this tab in no club, plus the route-less
  // bills, one line each on ONE card. A route whose only bills are upcoming
  // still gets its line (it reads "No bills" and its bills open with the card);
  // upcoming bills with no route land on the "No route" line.
  const others = new Map<string, RouteLine>();
  for (const r of rows) {
    if (r.routeId !== null && (clubRouteIds.has(r.routeId) || HIDDEN_ROUTE_IDS.includes(r.routeId))) continue;
    const key = otherLineKey(r);
    const line = others.get(key) ?? {
      key,
      name: key === "none" ? NO_ROUTE_LABEL : r.route ?? NO_ROUTE_LABEL,
      rows: [],
      upcoming: [],
      reachLabel: null,
    };
    (isDue(r) ? line.rows : line.upcoming).push(r);
    others.set(key, line);
  }
  // Lines by kilos due, highest first (owner, 2026-09-19); name breaks a tie so
  // the order never flickers between refreshes. "No route" is ALWAYS the last.
  const dueKg = (l: RouteLine) => sumWeightKg(l.rows).kg;
  const otherLines = Array.from(others.values()).sort((a, b) => {
    if (a.key === "none") return 1;
    if (b.key === "none") return -1;
    return dueKg(b) - dueKg(a) || a.name.localeCompare(b.name);
  });
  const otherCard: RouteCard | null =
    otherLines.length === 0
      ? null
      : {
          key: "other",
          kind: "other",
          name: OTHER_ROUTES_LABEL,
          lines: otherLines,
          rows: otherLines.flatMap((l) => l.rows),
          upcoming: otherLines.flatMap((l) => l.upcoming),
        };

  return { clubCards, otherCard };
}

/**
 * The cards holding at least one ticked bill, in board order (clubs, then
 * Other routes). TripDesk keeps every one of them open (commit 4b).
 */
export function cardsHoldingTicks(model: RouteCardModel, selection: ReadonlySet<number>): string[] {
  if (selection.size === 0) return [];
  return allCards(model)
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
// ONE GRID OF EQUAL CARDS that flow in order — clubs first by sortOrder, then
// the one Other routes card, always last (buildRouteCards).
// Columns by screen width: 4 at ≥1470px, 3 at 1100–1469px, 2 below.
//
// ⚠ 1470, NOT 1400 (owner, 2026-09-19). Four equal columns at 1440px leave a
// card ~215px of text, and "Kamrej · Upcountry · 3 stops · 1,174 kg" needs
// 225px (measured in Chrome with the app's font) — the name was cut to
// "Ka…". From 1470px it fits whole.
//
// 🔴 THE COLUMN COUNT IS KNOWN TO JS, NOT LEFT TO CSS. A card's panel opens
// full width directly under the ROW that card is in, and which row that is
// depends on how many cards fit across. So the cards are chunked into rows of
// `cols` here and each row is its own grid, with its panels after it. Every
// row uses the same track list, so the columns line up down the page, and a
// short last row leaves its cells empty rather than stretching its cards.
//
// ⚠ NOTHING COUNTS CARDS BY HAND. A new club or a new route with bills takes
// the next slot; see RouteCards for how every card gets the same height.

const FOUR_MIN = 1470;
const THREE_MIN = 1100;

function columnsFor(width: number): number {
  return width >= FOUR_MIN ? 4 : width >= THREE_MIN ? 3 : 2;
}

/**
 * Cards per row for the current window, following resizes. `matchMedia` change
 * events, never a key listener (floor-page owns the floor's only one).
 *
 * Starts at 4 — the desk runs at ~1920px — until the first effect reads the
 * real window; TripDesk only renders in the browser, so that read lands before
 * anyone can click.
 */
export function useCardColumns(): number {
  const [cols, setCols] = useState(4);
  useEffect(() => {
    const four = window.matchMedia(`(min-width: ${FOUR_MIN}px)`);
    const three = window.matchMedia(`(min-width: ${THREE_MIN}px)`);
    const read = () => setCols(columnsFor(window.innerWidth));
    read();
    four.addEventListener("change", read);
    three.addEventListener("change", read);
    return () => {
      four.removeEventListener("change", read);
      three.removeEventListener("change", read);
    };
  }, []);
  return cols;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function RouteCards({
  model,
  columns,
  openKeys,
  onToggleCard,
  nowMs,
  anchorIso,
  variant,
  leaf,
}: {
  model: RouteCardModel;
  /** Cards per row — TripDesk passes `useCardColumns()`. */
  columns: number;
  /** The open cards' keys — any number (TripDesk `openCards`). */
  openKeys: readonly string[];
  onToggleCard: (key: string) => void;
  nowMs: number;
  anchorIso: string;
  variant: FloorTableVariant;
  /** Forwarded unchanged to each route's FloorTable. No selection in History. */
  leaf: LeafWiring;
}) {
  // Clubs in sortOrder, then Other routes — always last.
  const cards = allCards(model);
  // A key that no longer names a card with anything in it (its last bill went
  // onto a trip, or Other routes has emptied) counts as closed: nothing to show,
  // and nothing else dims for it.
  const isOpen = (c: RouteCard) => openable(c) && openKeys.includes(c.key);
  const anyOpen = cards.some(isOpen);

  // 🔴 EVERY CARD THE SAME HEIGHT, ACROSS THE WHOLE BOARD (owner). The height
  // is the card with the MOST route lines — worked out from the data, never a
  // pixel number: every card is the same head plus `lineSlots` equal-height
  // line slots, so they come out identical. Today that is 2 (the clubs, and
  // Other routes with Parvat + No route); a club — or an Other routes card —
  // of 3 lines makes every card grow by one line.
  const lineSlots = Math.max(1, ...cards.map((c) => c.lines.length));
  const tracks = `repeat(${columns}, minmax(0, 1fr))`;

  return (
    <div className="px-3.5 py-3.5">
      {chunk(cards, columns).map((row, i) => (
        <div key={i} className={i === 0 ? "" : "mt-3"}>
          <div className="grid items-start gap-3" style={{ gridTemplateColumns: tracks }}>
            {row.map((c) => (
              <CardButton
                key={c.key}
                card={c}
                lineSlots={lineSlots}
                isOpen={isOpen(c)}
                dimmed={anyOpen && !isOpen(c)}
                onToggle={() => onToggleCard(c.key)}
              />
            ))}
          </div>
          {/* THE PANELS OPEN UNDER THE ROW THEIR CARD IS IN, full width
              (design) — one per open card in this row, in the cards' own order.
              A panel is NOT a card: it keeps its natural height. */}
          {row.filter(isOpen).map((c) => (
            <OpenPanel key={`panel:${c.key}`} card={c} nowMs={nowMs} anchorIso={anchorIso} variant={variant} leaf={leaf} />
          ))}
        </div>
      ))}
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
// ONE SHAPE FOR EVERY CARD, club or Other routes (owner, 2026-09-19): the
// head — name, big kilos, "N stops · L" — then one line per route with its
// bar.
//
// ⚠ EQUAL HEIGHT IS BUILT, NOT STRETCHED. Each card is:
//     head  (always three rows: name, big figure, summary)
//     spacer lines  (lineSlots − its own lines; invisible)
//     its route lines  (each reserving its bar's height, bar or not)
// so every card has the same parts at the same sizes. The spacers sit BETWEEN
// the head and the lines: the head stays at the top, the last bar lands on the
// bottom edge, and the spare space is in the middle. Nothing is stretched.
//
// ⚠ A real <button>, so Tab and Enter/Space work with no key listener of ours:
// the floor has ONE window-level key listener and it is floor-page's (FLOOR
// §4.6). Its content is spans only — a <p> or <div> is not valid in a button.
//
// ⚠ TEXT NEVER WRAPS (owner). Every line is `whitespace-nowrap`; if a line
// ever outgrows its card, the route NAME gives way with an ellipsis and the
// numbers stay whole.

const CARD = "block w-full min-w-0 rounded-[11px] border bg-white text-left transition-opacity";
const LINE = "block border-t border-[#f1f1f6] px-3.5 pb-3 pt-[11px]";

function CardButton({
  card,
  lineSlots,
  isOpen,
  dimmed,
  onToggle,
}: {
  card: RouteCard;
  lineSlots: number;
  isOpen: boolean;
  dimmed: boolean;
  onToggle: () => void;
}) {
  // EMPTY = nothing due today or overdue: the card reads "No bills", dimmed.
  // It can still OPEN when it holds upcoming bills — only a card with nothing
  // at all is inert.
  const empty = card.rows.length === 0;
  const canOpen = openable(card);
  // Open: the violet ring (brand, CLAUDE_UI §2).
  const cls = [
    CARD,
    isOpen ? "border-brand-600 ring-[3px] ring-brand-100" : "border-[#e7e7ee] hover:border-[#cfcfda]",
    (empty && !isOpen) || dimmed ? "opacity-[.45]" : "",
    canOpen ? "cursor-pointer" : "cursor-default",
  ].join(" ");
  const spacers = Math.max(0, lineSlots - card.lines.length);

  return (
    <button
      type="button"
      className={cls}
      onClick={onToggle}
      disabled={!canOpen}
      aria-expanded={canOpen ? isOpen : undefined}
    >
      <span className="block px-3.5 pb-3 pt-3.5">
        <span className="mb-1 block truncate text-[13px] font-semibold text-[#61616d]">{card.name}</span>
        {/* The big figure's row is always there; on an empty card it is held
            open invisibly so the card keeps the board's one height. */}
        <span
          className={`block whitespace-nowrap text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] tabular-nums text-[#1a1a22] ${empty ? "invisible" : ""}`}
          aria-hidden={empty || undefined}
        >
          {empty ? "0" : kgText(card.rows)}
          <small className="ml-[3px] text-[13px] font-semibold tracking-normal text-[#96969f]">kg</small>
        </span>
        <span className="mt-[5px] block whitespace-nowrap text-[12.5px] tabular-nums text-[#96969f]">
          {empty ? (
            "No bills"
          ) : (
            <>
              {plural(stopCount(card.rows), "stop", "stops")} &middot; {formatLitres(sumLitres(card.rows))} L
            </>
          )}
        </span>
      </span>
      {Array.from({ length: spacers }, (_, i) => (
        <span key={`spacer:${i}`} className={`${LINE} invisible`} aria-hidden>
          <RouteLineBody line={{ key: "", name: "·", rows: [], upcoming: [], reachLabel: null }} />
        </span>
      ))}
      {card.lines.map((l) => (
        <span key={l.key} className={LINE}>
          <RouteLineBody line={l} />
        </span>
      ))}
    </button>
  );
}

/**
 * One route line: name (+ the grey reach label), stops, kilos right, and the
 * bar under it. A route with nothing due says "No bills" and KEEPS the bar's
 * space, empty — every line slot is one height, which is what lets every card
 * on the board come out the same height.
 */
function RouteLineBody({ line: l }: { line: RouteLine }) {
  return (
    <>
      <span className="mb-2 flex items-baseline gap-2 whitespace-nowrap">
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
          <span className="shrink-0 text-[12px] text-[#96969f]">No bills</span>
        )}
      </span>
      {l.rows.length > 0 ? <StatusBar rows={l.rows} /> : <span className="block h-1" aria-hidden />}
    </>
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
