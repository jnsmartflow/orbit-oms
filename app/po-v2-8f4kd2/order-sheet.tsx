"use client";

import { ChevronLeft } from "lucide-react";
import {
  memberImage, packRows, tileArtFor,
  DIVIDER, FILL, INK, MUTED, RULE, SURFACE, URGENT, VIOLET,
} from "./v2-data";
import type { ApiCustomer, V2CartLine } from "./v2-data";
import type { V2Snapshot } from "./v2-storage";

// The shared read-only view of ONE stored order — a SCREEN — and the small
// pieces the two list screens share with it.
//
// 🔴 CONTAINMENT — imports ./v2-data, a TYPE from ./v2-storage, and
// node_modules. Nothing else. It owns no storage
// and no navigation: it is handed a snapshot and a footer and renders them.
// Every decision — what the buttons do, what happens to the board — belongs to
// po-v2-page.tsx, which is why this file can be read in one sitting.
//
// 🔴 A SCREEN, NOT A SHEET, AND THAT IS THE CHANGE. Both details used to be a
// V2Sheet over their list. A sheet is for a DECISION you dismiss — replace or
// keep, delete or don't — and it comes with a scrim, a drag handle and a
// height cap that all say "answer me and I will go away". An order you read
// through, line by line, checking what you sent, is a PLACE you went to: it
// gets a header with a back chevron, the full height of the screen, and the
// bottom nav still under it so you are never stranded.
//
// 🔴 ONE VIEW, USED TWICE. The sent detail and the draft detail were two
// different renderings of the same object, and they had already drifted: the
// sent one printed a per-line "N units" subtitle that the review screen had
// deliberately dropped. A salesman checking what he sent and a salesman
// checking what he parked are doing the same thing, and they should be looking
// at the same page.

/* ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE TYPE SCALE — TEN ROLES, AND NOTHING ON EITHER SCREEN IS OUTSIDE THEM.
 *
 * The detail screen and the two list screens share one scale, stated here
 * because they are drawn in two files and a scale that lives in a designer's
 * head drifts the first time only one of the two is edited. Every text node in
 * THIS file and in drafts-sent.tsx carries its role tag in a comment, so the
 * audit is a grep and not an opinion.
 *
 *   T1  screen title    20 / 700 / -.02em          the one thing per screen
 *   T2  header meta     11 mono / MUTED            code · area under a title
 *   T3  section label   10 / 700 / +.13em caps     ORDER · SAVED · TODAY
 *   T4  card title      17 / 500                   a dealer on a list card
 *   T5  card meta       12 mono / MUTED            code · area, and the time
 *   T6  chip            12 / 600 + a 13px icon     every tag, everywhere
 *   T7  row label       11 / 600 / +.1em caps      the left half of a fact
 *   T8  row value       14 / 500                   the right half of a fact
 *   T9  product name    15 / 600  ·  colour 11 / 700 caps VIOLET
 *   T10 figures         13 mono tabular            "1L x6"
 *
 * 🔴 T4 IS 500, NOT 700, AND THAT IS THE WHOLE POINT — CLAUDE_UI §60. "Weight,
 * not colour, is the heavy dial. Nothing on the card is 700." A 15px/700 name
 * over a 11.5px/600 count over an 800-weight pill was four different weights
 * fighting on one 65px card. SIZE carries the name now: 17px at 500 is bigger
 * AND lighter than the 15px/700 it replaces, and it is the only thing on the
 * card that is 17px, so nothing has to shout to be found.
 *
 * The one style on these screens outside the scale is the DETAIL FOOTER's
 * buttons (15px/800), and they are outside this file: po-v2-page.tsx passes
 * them in as the `footer` node. Named in the step report rather than silently
 * left out.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The bottom nav's height including the safe area, as a CSS expression.
 *
 * 🔴 IT LIVES HERE SO BOTH THE PAGE AND THE LIST SCREENS CAN READ IT. It used
 * to be a private constant in po-v2-page.tsx, and drafts-sent.tsx padded its
 * lists by a hardcoded 24 instead — which was harmless only for as long as the
 * nav was (wrongly) hidden on those screens. The moment the nav came back, the
 * last card sat under it. One number, one home.
 */
export const NAV_H = "calc(54px + max(env(safe-area-inset-bottom), 8px))";

/**
 * 🔴 THE GROUND BEHIND THE CARDS, AND WHY IT IS NOT PAGE.
 *
 * These screens are lists of white cards, and PAGE (#FAFAFC) is two points off
 * white: at arm's length on a phone the cards had no edge and the list read as
 * one flat sheet with rules drawn on it. FILL (#F4F3F8) is the palette's own
 * warm grey — the ground under every inert square in the app — and it is
 * enough separation to see a card without being a colour anybody notices.
 *
 * It is the EXISTING token, not a new one: v2-data is outside this step's
 * containment and, more to the point, a screen-specific eleventh grey is how a
 * palette stops being one.
 */
export const LIST_BG = FILL;

/**
 * 🔴 ONE HAIRLINE, NOT THE TWO-LAYER CARD_SHADOW.
 *
 * CARD_SHADOW is a hairline PLUS a wide soft drop, which is right for the
 * board's family cards — big, few, and meant to lift. Seven order cards down a
 * list with that on each read as a stack of receipts. One 1px edge plus the
 * warmer ground does the whole job: the ground says "these are objects", the
 * hairline says where each one stops.
 *
 * Paired with a 1px RULE border, and BOTH cards on the detail screen carry the
 * same three — radius 14, that border, this shadow — plus the same 14px inner
 * padding, so the Order card and the products card read as one object split in
 * two rather than as two designs that happen to be stacked.
 */
export const CARD_EDGE = "0 1px 2px rgba(27,24,38,.06)";
export const CARD_RADIUS = 14;
/** The inner padding both cards and every list card share. */
export const CARD_PAD = 14;

/** The frame both cards on this screen share, and the list cards copy. */
export const cardFrame = {
  background: SURFACE,
  borderRadius: CARD_RADIUS,
  border: `1px solid ${RULE}`,
  boxShadow: CARD_EDGE,
} as const;

/** The tin a cart LINE should show, and the wash behind it. Local: only Tin
 *  needs it, and an export nothing imports is a promise nobody asked for. */
function lineArt(line: V2CartLine): { src: string | null; wash: string } {
  // 🔴 THE LINE'S OWN PRODUCT, THEN ITS TILE. Copied in behaviour from
  // review-screen.tsx so a line looks the same wherever it is drawn: the member
  // sap is the catalog join key and is already on the line, the tile is the
  // fallback for a product with no photo of its own, and the WASH always comes
  // from the tile because the wash IS the family.
  const tile = tileArtFor(line.tileSap);
  return { src: memberImage(line.product ?? line.subProduct) ?? tile.src, wash: tile.wash };
}

/** "Urgent" · "Call · SO" · "Normal" — what the dispatch chip says. */
export function dispatchLabel(snapshot: V2Snapshot): string {
  if (snapshot.dispatch === "Call") return `Call · ${snapshot.callTarget}`;
  return snapshot.dispatch;
}

/* ── ICONS ────────────────────────────────────────────────────────────────
 *
 * 🔴 DRAWN HERE, NOT IMPORTED, AND THE REASON IS 13px.
 *
 * The brief said to hand-write these "as BottomNav already does" — BottomNav
 * does NOT: it renders lucide-react components (Grid2x2, FileText, Send), as
 * does every other icon in this folder bar one. The code wins, so this is
 * recorded rather than assumed. The ONE hand-drawn precedent is StarGlyph in
 * customer-list.tsx, and its reason is exactly the reason here: a set of icons
 * that must sit in a row and read as one family cannot be assembled from a
 * library's individual silhouettes. Five lucide glyphs at 13px arrive with
 * five different optical weights and five different amounts of padding inside
 * their 24-box; drawn to one grid, at one stroke width, with one cap style,
 * they line up. No dependency is added either way — lucide is already here.
 *
 * A chip icon is 13px and DECORATIVE: the chip's own word says the same thing,
 * so every one of these is aria-hidden and none is a tap target.
 */
function Stroke({ size, children }: { size: number; children: React.ReactNode }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden
         fill="none" stroke="currentColor" strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round"
         className="shrink-0">
      {children}
    </svg>
  );
}

/** A product count. A carton seen in three-quarter view — the box a pack ships in. */
export function IconBox({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Stroke size={size}>
      <path d="M12 2.7 20.4 7.4v9.2L12 21.3 3.6 16.6V7.4z" />
      <path d="M3.6 7.4 12 12l8.4-4.6M12 12v9.3" />
    </Stroke>
  );
}

/** Urgent. */
export function IconBolt({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Stroke size={size}>
      <path d="M13.6 2.5 5.2 13.3h5.5L10.4 21.5l8.4-10.8h-5.6z" />
    </Stroke>
  );
}

/** Call before dispatch — a handset. */
export function IconPhone({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Stroke size={size}>
      <path d="M6.7 3.4h3.1l1.5 3.9-1.9 1.2a12.6 12.6 0 0 0 5.2 5.2l1.2-1.9 3.9 1.5v3.1a1.6 1.6 0 0 1-1.8 1.6A15.9 15.9 0 0 1 5.1 5.2a1.6 1.6 0 0 1 1.6-1.8z" />
    </Stroke>
  );
}

/** Ship to somewhere other than the billing dealer. */
export function IconTruck({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Stroke size={size}>
      <path d="M2.9 6.4h10.5v9.1H2.9z" />
      <path d="M13.4 9.5h3.7l3.2 3v3h-6.9z" />
      <path d="M7 17.4a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0" />
      <path d="M15.3 17.4a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0" />
    </Stroke>
  );
}

/** A remark on the order — the return arrow a note is written after. */
export function IconReply({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Stroke size={size}>
      <path d="M9.4 5.4 3.9 10.9l5.5 5.5" />
      <path d="M3.9 10.9h9.4a6.2 6.2 0 0 1 6.2 6.2v1.5" />
    </Stroke>
  );
}

/** Sent. */
function IconCheck({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Stroke size={size}>
      <path d="M4.6 12.5 9.4 17.3 19.6 6.9" />
    </Stroke>
  );
}

/** Saved by hand — a bookmark. */
function IconBookmark({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Stroke size={size}>
      <path d="M6.6 3.6h10.8v16.8L12 16.2l-5.4 4.2z" />
    </Stroke>
  );
}

/** Auto-saved — written by the clock, not by him. */
function IconClock({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Stroke size={size}>
      <path d="M3.4 12a8.6 8.6 0 1 0 17.2 0 8.6 8.6 0 1 0-17.2 0" />
      <path d="M12 6.9V12l3.6 2.2" />
    </Stroke>
  );
}

/** Delete a saved draft. 15px — it is a control, not a chip's decoration. */
export function IconTrash({ size = 15 }: { size?: number }): React.JSX.Element {
  return (
    <Stroke size={size}>
      <path d="M4.6 6.6h14.8" />
      <path d="M9.4 6.6V4.4h5.2v2.2" />
      <path d="M6.9 6.6l.9 13a1.4 1.4 0 0 0 1.4 1.3h5.6a1.4 1.4 0 0 0 1.4-1.3l.9-13" />
    </Stroke>
  );
}

/** Sent · Saved · Auto-saved — the glyph the status chip carries. */
export function statusIcon(status: string): React.JSX.Element {
  if (status.startsWith("Sent")) return <IconCheck />;
  if (status.startsWith("Auto")) return <IconClock />;
  return <IconBookmark />;
}

/**
 * A small square tin, at whatever size the caller needs.
 *
 * MULTIPLY, exactly as the board and the review screen do it: every file is an
 * opaque white square, so painted normally it would cover the family wash and
 * every tile would be a white box.
 */
function Tin({ line, size, radius }: {
  line: V2CartLine; size: number; radius: number;
}): React.JSX.Element {
  const art = lineArt(line);
  return (
    <span className="relative block shrink-0 overflow-hidden"
          style={{ width: size, height: size, borderRadius: radius, background: art.wash }}>
      {art.src && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={art.src} alt="" aria-hidden width={600} height={600}
             decoding="async" loading="lazy" className="block h-full w-full"
             style={{ objectFit: "contain", mixBlendMode: "multiply" }} />
      )}
    </span>
  );
}

// 🔴 OrderTins IS GONE, 2026-09-08. A card carried up to four 30px tins on the
// reasoning that a salesman recognises an order by its shape. He does — at 46px
// in the DETAIL, where a tin is a photograph. Shrunk onto a card they were four
// near-identical blue Dulux tubs costing a whole row of every card, and the row
// said nothing the product count did not. Tins stayed; the row went.
//
// 🔴 productCount() WENT WITH THE SECOND REWRITE, 2026-09-08. Its one caller
// was the card's "7 products", which is now the COUNT CHIP — a box glyph and
// the numeral, because the word "products" was the widest thing on the row and
// it was the same word on every card. Nothing imported it; an export nothing
// uses is a promise nobody asked for.

/**
 * A CHIP — T6, and the only tag shape in the app.
 *
 * 🔴 AN ICON AND A NUMBER OR A SHORT WORD, 12/600, 8px radius, 26px tall.
 *
 * It replaces Pill, which was 10.5px/800 UPPERCASE with .04em tracking: four
 * of those on one card were four small blocks of shouting, and at 10.5px the
 * only way to tell them apart was to read them. An ICON is recognised without
 * reading, which is the entire job of a tag on a list — the word beside it is
 * the confirmation, not the signal.
 *
 * 🔴 NOT A TAP TARGET, DELIBERATELY. Every chip on these screens sits INSIDE
 * the card's own button and none of them is separately actionable, so §60's
 * 44px floor is not in play: the target is the 113px card. The one control
 * that IS separate — the delete icon — gets its own 44px box and sits outside
 * the card button for that reason.
 */
export function Chip({ icon, text, tone = "quiet" }: {
  icon: React.ReactNode; text: string; tone?: "quiet" | "urgent" | "violet";
}): React.JSX.Element {
  const bg = tone === "urgent" ? "#FEF2F2" : tone === "violet" ? "#F5F3FF" : FILL;
  const fg = tone === "urgent" ? URGENT : tone === "violet" ? VIOLET : MUTED;
  return (
    /* T6 chip — 12 / 600 with a 13px icon.
       min-w-0 and a truncating label, NOT shrink-0: four chips and a clock on
       a 328px card row is 30px of overflow in the worst real combination —
       Urgent + Ship to + "Cross Delivery" — and flex-shrink takes it out of
       the WIDEST chip first, which is the remark. So the row degrades by
       clipping the longest word rather than by pushing the time off the card.
       The icons stay shrink-0, so no chip ever loses its glyph. */
    <span className="inline-flex min-w-0 items-center gap-1 px-2 text-[12px] font-semibold"
          style={{ height: 26, borderRadius: 8, background: bg, color: fg }}>
      {icon}
      <span className="truncate">{text}</span>
    </span>
  );
}

/**
 * One labelled fact in the ORDER card — T7 label, T8 value.
 *
 * 🔴 EXACTLY 44px, BORDER INCLUDED. Not min-height and not padding that
 * happens to land near it: a fixed 44 is what makes four facts 176px and what
 * makes the card the same object whatever it holds. Tailwind's preflight sets
 * border-box, so the 1px hairline is inside the 44 and the rows stack without
 * drift.
 *
 * The value TRUNCATES rather than wrapping, which is the one thing this shape
 * costs: a long Note clips here. It is the right trade at four rows — the note
 * went out on the wire in full and the review screen shows it in full — but it
 * is a trade and it is named.
 */
function Fact({ label, value, first = false }: {
  label: string; value: string; first?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3"
         style={{ height: 44, paddingLeft: CARD_PAD, paddingRight: CARD_PAD,
                  borderTop: first ? undefined : `1px solid ${DIVIDER}` }}>
      {/* T7 row label — 11 / 600 / +.1em caps / muted */}
      <span className="shrink-0 text-[11px] font-semibold uppercase"
            style={{ color: MUTED, letterSpacing: ".1em" }}>
        {label}
      </span>
      {/* T8 row value — 14 / 500 */}
      <span className="min-w-0 flex-1 truncate text-right text-[14px] font-medium" style={{ color: INK }}>
        {value}
      </span>
    </div>
  );
}

/**
 * A section label — T3. ORDER and "7 PRODUCTS" here; SAVED, IN PROGRESS and
 * TODAY on the lists. Exported so the two files cannot drift: a section label
 * that is 10/700/.13em on one screen and 11.5/800/.08em on the other is two
 * scales, which is the thing this step exists to stop.
 */
export function SectionLabel({ text }: { text: string }): React.JSX.Element {
  return (
    /* T3 section label — 10 / 700 / +.13em caps / muted */
    <h2 className="px-4 pb-2 pt-5 text-[10px] font-bold uppercase"
        style={{ color: MUTED, letterSpacing: ".13em" }}>
      {text}
    </h2>
  );
}

/**
 * ONE STORED ORDER, READ-ONLY, AS A FULL SCREEN.
 *
 * 🔴 NO TOTALS. Not units, not a sum of anything. Units across different pack
 * sizes do not add to a number anybody can act on — six 1L and two 20L is
 * "eight units" of nothing — and a total that is wrong is worse than a total
 * that is absent. The count is the chip on the list card, which is a real
 * fact, and the packs themselves carry the quantities. As of 2026-09-08 there
 * is no unit total anywhere in the app, review included.
 *
 * THE PRODUCT ROW IS review-screen.tsx's, value for value: a 46px tin at radius
 * 11, the name at 15px/600 leading-snug and NEVER truncated, the colour at
 * 11px/700 uppercase violet with .06em tracking, and a FIXED 96px right column
 * of mono/13px tabular figures reading "1L ×6". Fixed and shrink-0 so a
 * one-pack line and a four-pack line start their numbers at the same x.
 */
export default function OrderDetail({
  snapshot, status, when, shipTo, onBack, footer, bottomPad,
}: {
  snapshot: V2Snapshot;
  /** Sent · Saved · Auto-saved — the chip in the header. */
  status: string;
  /** Already formatted by the caller: only it knows if this was sent or saved. */
  when: string;
  /**
   * 🔴 THE SHIP-TO DEALER, RESOLVED — or null.
   *
   * The snapshot stores a shipToCode and nothing else, deliberately: the dealer
   * list is refetched every load and a stored copy would go stale the moment an
   * area or a name changed. Only the page holds that list, so only the page can
   * turn the code into a name, and it passes the answer in.
   *
   * snapshotOf writes shipToCode ONLY when it differs from the billing dealer,
   * so a non-null value already means "somewhere else" — there is no second
   * comparison to make here and no way for the two to disagree.
   */
  shipTo: ApiCustomer | null;
  onBack: () => void;
  footer: React.ReactNode;
  /** The bottom nav's height — the footer sits above it, not under it. */
  bottomPad: string;
}): React.JSX.Element {
  const c = snapshot.customer;
  const n = snapshot.lines.length;

  return (
    <main className="min-h-screen w-full" style={{ background: LIST_BG, paddingBottom: bottomPad }}>
      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 flex items-start gap-1 px-2 py-2"
              style={{ background: SURFACE, borderBottom: `1px solid ${RULE}` }}>
        {/* 44px — CLAUDE_UI §60's floor, and the only way out of this screen
            other than the nav. */}
        <button type="button" aria-label="Back" onClick={onBack}
                className="flex h-11 w-11 shrink-0 items-center justify-center">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.5} style={{ color: INK }} />
        </button>
        <div className="min-w-0 flex-1 py-1">
          {/* T1 screen title — 20 / 700 / -.02em */}
          <h1 className="truncate text-[20px] font-bold leading-tight"
              style={{ color: c ? INK : MUTED, letterSpacing: "-0.02em" }}>
            {c?.name ?? "No dealer yet"}
          </h1>
          {c && (
            /* T2 header meta — 11 mono / muted */
            <p className="mt-0.5 truncate font-mono text-[11px]" style={{ color: MUTED }}>
              {/* AREA IS REAL — ApiCustomer carries it and 739 of 741 dealers
                  have one. The two that do not show the code alone rather than
                  a dangling separator. */}
              {c.code}{c.area ? ` · ${c.area}` : ""}
            </p>
          )}
        </div>
        <span className="mt-1.5 shrink-0">
          <Chip icon={statusIcon(status)} text={status} tone="quiet" />
        </span>
      </header>

      {/* ── THE ORDER CARD ──────────────────────────────────────────────── */}
      <SectionLabel text="Order" />
      <div className="px-4">
        <div className="overflow-hidden" style={cardFrame}>
          {/* 🔴 ONLY ROWS WITH CONTENT. A "Remark —" line is a row he has to
              read before learning it says nothing. The first row is always
              present because an order always has a time. */}
          <Fact first label={status} value={when} />
          {snapshot.dispatch !== "Normal" && (
            <Fact label="Dispatch" value={dispatchLabel(snapshot)} />
          )}
          {snapshot.marker && (
            <Fact label="Remark"
                  value={snapshot.marker === "Cross Delivery" && snapshot.crossDepot.trim()
                    ? `Cross Delivery from ${snapshot.crossDepot.trim()}` : snapshot.marker} />
          )}
          {snapshot.shipToCode && (
            <Fact label="Ship to"
                  value={shipTo ? `${shipTo.name} · ${shipTo.code}` : snapshot.shipToCode} />
          )}
          {snapshot.notes.trim() && <Fact label="Note" value={snapshot.notes.trim()} />}
        </div>
      </div>

      {/* ── THE PRODUCTS ────────────────────────────────────────────────── */}
      <SectionLabel text={`${n} ${n === 1 ? "product" : "products"}`} />
      <div className="px-4">
        {/* The same frame, the same padding — one object split in two. */}
        <div className="overflow-hidden" style={cardFrame}>
          {snapshot.lines.map((line, i) => (
            <div key={line.id} className="flex items-start gap-3"
                 style={{ borderTop: i === 0 ? undefined : `1px solid ${DIVIDER}`,
                          paddingLeft: CARD_PAD, paddingRight: CARD_PAD,
                          paddingTop: 12, paddingBottom: 12 }}>
              <Tin line={line} size={46} radius={11} />
              <div className="min-w-0 flex-1">
                {/* T9 product name — 15 / 600. Not truncated: at 46px the tins
                    are very nearly indistinguishable and only the name says
                    which product it is, so it wraps rather than clipping. */}
                <p className="text-[15px] font-semibold leading-snug" style={{ color: INK }}>
                  {line.label}
                </p>
                {line.option && (
                  /* T9 colour — 11 / 700 caps violet */
                  <p className="mt-0.5 truncate text-[11px] font-bold uppercase"
                     style={{ color: VIOLET, letterSpacing: ".06em" }}>
                    {line.option}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right" style={{ width: 96 }}>
                {packRows(line).map(({ label, qty }) => (
                  /* T10 figures — 13 mono tabular */
                  <p key={label} className="whitespace-nowrap font-mono text-[13px] tabular-nums"
                     style={{ color: INK, marginTop: 3 }}>
                    {label} ×{qty}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── THE BUTTONS ─────────────────────────────────────────────────── */}
      {/* Fixed above the nav, not floating over the list: the order scrolls
          under them and the last product still clears both, because the page
          pads by nav + footer.

          ⚠ THE BUTTON TEXT IS THE ONE STYLE ON THIS SCREEN OUTSIDE THE TEN
          ROLES (15px/800). The nodes come from po-v2-page.tsx, which this step
          does not own, so it is reported rather than changed. */}
      <div className="fixed inset-x-0 z-10 flex gap-2 px-4 pt-3"
           style={{ bottom: bottomPad, background: SURFACE,
                    borderTop: `1px solid ${RULE}`, paddingBottom: 12 }}>
        {footer}
      </div>
    </main>
  );
}
