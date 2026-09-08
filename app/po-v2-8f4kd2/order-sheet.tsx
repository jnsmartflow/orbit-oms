"use client";

import { ChevronLeft } from "lucide-react";
import {
  memberImage, packRows, tileArtFor,
  CARD_SHADOW, DIVIDER, FAINT, INK, MUTED, PAGE, RULE, SURFACE, URGENT, VIOLET,
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

/** "Urgent" · "Call · SO" · "Normal" — what the dispatch pill says. */
export function dispatchLabel(snapshot: V2Snapshot): string {
  if (snapshot.dispatch === "Call") return `Call · ${snapshot.callTarget}`;
  return snapshot.dispatch;
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

/** "1 product" / "7 products" — the only count on a card. See the note below. */
export function productCount(snapshot: V2Snapshot): string {
  const n = snapshot.lines.length;
  return `${n} ${n === 1 ? "product" : "products"}`;
}

/** A pill. `tone` picks the two that carry meaning; everything else is quiet. */
export function Pill({ text, tone = "quiet" }: {
  text: string; tone?: "quiet" | "urgent" | "violet";
}): React.JSX.Element {
  const bg = tone === "urgent" ? "#FEF2F2" : tone === "violet" ? "#F5F3FF" : "#F4F3F8";
  const fg = tone === "urgent" ? URGENT : tone === "violet" ? VIOLET : MUTED;
  return (
    <span className="shrink-0 rounded-full px-2 py-[3px] text-[10.5px] font-extrabold uppercase"
          style={{ background: bg, color: fg, letterSpacing: ".04em" }}>
      {text}
    </span>
  );
}

/**
 * One labelled fact in the ORDER card. Value right-aligned, and the whole row
 * is omitted by the caller when there is nothing to say.
 */
function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2"
         style={{ borderTop: `1px solid ${DIVIDER}` }}>
      <span className="shrink-0 text-[12.5px] font-semibold" style={{ color: MUTED }}>{label}</span>
      <span className="min-w-0 flex-1 text-right text-[13px] font-semibold" style={{ color: INK }}>
        {value}
      </span>
    </div>
  );
}

/**
 * ONE STORED ORDER, READ-ONLY, AS A FULL SCREEN.
 *
 * 🔴 NO TOTALS. Not units, not a sum of anything. Units across different pack
 * sizes do not add to a number anybody can act on — six 1L and two 20L is
 * "eight units" of nothing — and a total that is wrong is worse than a total
 * that is absent. The count is "N products", which is a real fact, and the
 * packs themselves carry the quantities. As of 2026-09-08 there is no unit
 * total anywhere in the app, review included.
 *
 * THE PRODUCT ROW IS review-screen.tsx's, value for value: a 46px tin at radius
 * 11, the name at 15px/600 leading-snug and NEVER truncated, the colour at
 * 11.5px/800 uppercase violet with .06em tracking, and a FIXED 96px right
 * column of mono/13px tabular figures reading "1L ×6". Fixed and shrink-0 so a
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
    <main className="min-h-screen w-full" style={{ background: PAGE, paddingBottom: bottomPad }}>
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
          <h1 className="truncate text-[17px] font-extrabold"
              style={{ color: c ? INK : MUTED, letterSpacing: "-0.02em" }}>
            {c?.name ?? "No dealer yet"}
          </h1>
          {c && (
            <p className="truncate text-[11.5px]" style={{ color: MUTED }}>
              {/* AREA IS REAL — ApiCustomer carries it and 739 of 741 dealers
                  have one. The two that do not show the code alone rather than
                  a dangling separator. */}
              <span className="font-mono">{c.code}</span>{c.area ? ` · ${c.area}` : ""}
            </p>
          )}
        </div>
        <span className="mt-1.5 shrink-0"><Pill text={status} tone="quiet" /></span>
      </header>

      {/* ── THE ORDER CARD ──────────────────────────────────────────────── */}
      <h2 className="px-4 pb-1.5 pt-4 text-[11.5px] font-extrabold uppercase"
          style={{ color: FAINT, letterSpacing: ".08em" }}>
        Order
      </h2>
      <div className="px-4">
        <div className="overflow-hidden rounded-[14px]"
             style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
          {/* 🔴 ONLY ROWS WITH CONTENT. A "Remark —" line is a row he has to
              read before learning it says nothing. The first row is always
              present because an order always has a time. */}
          <div className="flex items-start justify-between gap-3 px-3 py-2">
            <span className="shrink-0 text-[12.5px] font-semibold" style={{ color: MUTED }}>{status}</span>
            <span className="min-w-0 flex-1 text-right text-[13px] font-semibold" style={{ color: INK }}>
              {when}
            </span>
          </div>
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
      <h2 className="px-4 pb-1.5 pt-4 text-[11.5px] font-extrabold uppercase"
          style={{ color: FAINT, letterSpacing: ".08em" }}>
        {n} {n === 1 ? "product" : "products"}
      </h2>
      <div className="px-4">
        <div className="overflow-hidden rounded-[14px]"
             style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
          {snapshot.lines.map((line, i) => (
            <div key={line.id} className="flex items-start gap-3 px-3"
                 style={{ borderTop: i === 0 ? undefined : `1px solid ${DIVIDER}`,
                          paddingTop: 12, paddingBottom: 12 }}>
              <Tin line={line} size={46} radius={11} />
              <div className="min-w-0 flex-1">
                {/* Not truncated — see review-screen: at 46px the tins are very
                    nearly indistinguishable and only the name says which
                    product it is, so it wraps rather than clipping. */}
                <p className="text-[15px] font-semibold leading-snug" style={{ color: INK }}>
                  {line.label}
                </p>
                {line.option && (
                  <p className="mt-0.5 truncate text-[11.5px] font-extrabold uppercase"
                     style={{ color: VIOLET, letterSpacing: ".06em" }}>
                    {line.option}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right" style={{ width: 96 }}>
                {packRows(line).map(({ label, qty }) => (
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
          pads by nav + footer. */}
      <div className="fixed inset-x-0 z-10 flex gap-2 px-4 pt-3"
           style={{ bottom: bottomPad, background: SURFACE,
                    borderTop: `1px solid ${RULE}`, paddingBottom: 12 }}>
        {footer}
      </div>
    </main>
  );
}
