"use client";

import { memberImage, packRows, tileArtFor, DIVIDER, FAINT, INK, MUTED, RULE, URGENT, VIOLET } from "./v2-data";
import type { V2CartLine } from "./v2-data";
import type { V2Snapshot } from "./v2-storage";

// The shared read-only view of ONE stored order, and the small pieces the two
// list screens share with it.
//
// 🔴 CONTAINMENT — imports ./v2-data, a TYPE from ./v2-storage, and
// node_modules. Nothing else. It owns no storage
// and no navigation: it is handed a snapshot and a footer and renders them.
// Every decision — what the buttons do, what happens to the board — belongs to
// po-v2-page.tsx, which is why this file can be read in one sitting.
//
// 🔴 ONE SHEET, USED TWICE. The sent detail and the draft detail were two
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

/**
 * Up to four tins and a "+N", for a list card.
 *
 * ONE TIN PER LINE, NOT PER PRODUCT, and in the order they were added. A
 * salesman recognises an order by its shape — three blue tubs and a small
 * white tin — and de-duplicating would change that shape for no gain.
 */
export function OrderTins({ lines, size = 30 }: {
  lines: V2CartLine[]; size?: number;
}): React.JSX.Element {
  const shown = lines.slice(0, 4);
  const rest  = lines.length - shown.length;
  return (
    <span className="flex items-center" style={{ gap: 4 }}>
      {shown.map((l) => <Tin key={l.id} line={l} size={size} radius={7} />)}
      {rest > 0 && (
        <span className="flex shrink-0 items-center justify-center rounded-[7px] text-[11px] font-extrabold"
              style={{ width: size, height: size, background: "#F4F3F8", color: MUTED }}>
          +{rest}
        </span>
      )}
    </span>
  );
}

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
 * ONE STORED ORDER, READ-ONLY.
 *
 * 🔴 NO TOTALS. Not units, not a sum of anything. Units across different pack
 * sizes do not add to a number anybody can act on — six 1L and two 20L is
 * "eight units" of nothing — and a total that is wrong is worse than a total
 * that is absent. The count on the list card is "N products", which is a real
 * fact about the order, and the packs themselves carry the quantities.
 *
 * 🔴 AND NO PER-LINE "N units" SUBTITLE. The sent sheet printed one under every
 * line; the review screen removed it deliberately ("he orders packs, the depot
 * picks packs"). This is that inconsistency resolved in review's favour, so all
 * three surfaces now draw a line the same way.
 *
 * THE ROW IS review-screen.tsx's, value for value: a 46px tin at radius 11, the
 * name at 15px/600 leading-snug and NEVER truncated, the colour at 11.5px/800
 * uppercase violet with .06em tracking, and a FIXED 96px right column of
 * mono/13px tabular figures reading "1L ×6". Fixed and shrink-0 so a one-pack
 * line and a four-pack line start their numbers at the same x.
 */
export default function OrderSheet({ snapshot, when, footer }: {
  snapshot: V2Snapshot;
  /** Already formatted by the caller — only it knows if this was sent or saved. */
  when: string;
  footer: React.ReactNode;
}): React.JSX.Element {
  const meta: { label: string; value: string }[] = [];
  // 🔴 EVERY ROW THAT IS EMPTY IS OMITTED, not rendered blank. A "Remark: —"
  // line is a row a salesman has to read before learning it says nothing.
  if (snapshot.dispatch !== "Normal") meta.push({ label: "Dispatch", value: dispatchLabel(snapshot) });
  if (snapshot.marker) {
    meta.push({ label: "Remark",
                value: snapshot.marker === "Cross Delivery" && snapshot.crossDepot.trim()
                  ? `Cross Delivery from ${snapshot.crossDepot.trim()}` : snapshot.marker });
  }
  if (snapshot.notes.trim()) meta.push({ label: "Note", value: snapshot.notes.trim() });

  return (
    <>
      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 pt-1.5 pb-3">
        <h2 className="truncate text-[18px] font-extrabold"
            style={{ color: snapshot.customer ? INK : MUTED, letterSpacing: "-0.025em" }}>
          {snapshot.customer?.name ?? "No dealer yet"}
        </h2>
        <p className="truncate text-[11.5px]" style={{ color: MUTED }}>
          {snapshot.customer?.code ? (
            <span className="font-mono">{snapshot.customer.code}</span>
          ) : null}
          {snapshot.customer?.code ? " · " : ""}
          {when}
        </p>
      </div>

      {/* ── META ────────────────────────────────────────────────────────── */}
      {meta.length > 0 && (
        <div className="shrink-0 px-4 pb-3">
          <div className="rounded-[11px] px-3 py-2" style={{ background: "#F4F3F8" }}>
            {meta.map((m) => (
              <p key={m.label} className="flex gap-2 text-[12.5px] leading-relaxed">
                <span className="shrink-0 font-extrabold uppercase"
                      style={{ color: FAINT, letterSpacing: ".04em", minWidth: 58 }}>
                  {m.label}
                </span>
                <span className="min-w-0 flex-1" style={{ color: INK }}>{m.value}</span>
              </p>
            ))}
          </div>
        </div>
      )}

      {/* ── LINES ───────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto"
           style={{ borderTop: `1px solid ${RULE}` }}>
        {snapshot.lines.map((line) => (
          <div key={line.id} className="flex items-start gap-3 px-4"
               style={{ borderBottom: `1px solid ${DIVIDER}`, paddingTop: 14, paddingBottom: 14 }}>
            <Tin line={line} size={46} radius={11} />
            <div className="min-w-0 flex-1">
              {/* Not truncated — see review-screen: at 46px the tins are very
                  nearly indistinguishable and only the name says which product
                  it is, so it wraps rather than clipping. */}
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

      {/* 🔴 THE FOOTER IS RENDERED HERE, NOT PASSED TO V2Sheet. The sheet has a
          footer slot of its own and using both would draw two. This one is a
          `shrink-0` sibling after a `min-h-0 flex-1` scroller, which is exactly
          how V2Sheet pins its own — same border, same safe-area padding — so
          the buttons stay put while the lines scroll, and v2-sheet.tsx is not
          touched to achieve it. */}
      <div className="flex shrink-0 gap-2 px-4 pt-3"
           style={{ borderTop: `1px solid ${RULE}`,
                    paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}>
        {footer}
      </div>
    </>
  );
}
