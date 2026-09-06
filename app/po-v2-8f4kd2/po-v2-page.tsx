"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import ProductDrawer from "./product-drawer";
import {
  FAMILIES, INK, RULE, SEARCH_BG, VIOLET, VIOLET_BG,
  productForTile, tally,
  type V2CartLine, type V2Tile,
} from "./v2-data";

// Hidden v2 salesman order page — BOARD + CART.
//
// 🔴 CONTAINMENT — v2 must never modify anything outside app/po-v2-8f4kd2/.
// Every colour is an INLINE STYLE, never a CSS variable, so globals.css and
// tailwind.config.ts stay untouched and deleting this one folder removes v2
// whole. Imports are ./v2-data, ./product-drawer and node_modules only —
// nothing from lib/ or app/po/ (step 5 wires the real catalog in).
//
// The cart lives in REACT STATE ONLY. No localStorage, no fetch, no email —
// a refresh empties it, which is correct for this step.
//
// NO HORIZONTAL SCROLL is met structurally, not with an overflow-x crutch:
// the grid is four equal `1fr` tracks, every grid cell and the header's text
// block carry `min-w-0` (grid/flex children default to `min-width:auto`, which
// is what actually causes runaway rows), and the header lines truncate.

// Two-line clamp for tile labels. `wordBreak: "normal"` keeps words whole at
// every normal opportunity; `overflowWrap: "break-word"` is the last-resort
// escape that only fires when a SINGLE word cannot fit its line at all.
// Together: break at spaces, never mid-word.
const TILE_TEXT_STYLE: React.CSSProperties = {
  color:           INK,
  letterSpacing:   "-0.02em",
  display:         "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  overflow:        "hidden",
  overflowWrap:    "break-word",
  wordBreak:       "normal",
};

export default function PoV2Page(): React.JSX.Element {
  const [openTile, setOpenTile] = useState<V2Tile | null>(null);
  const [lines,    setLines]    = useState<V2CartLine[]>([]);

  // How many lines each tile has contributed — drives the badge and the fill.
  const countsByTile = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const line of lines) counts[line.tileSap] = (counts[line.tileSap] ?? 0) + 1;
    return counts;
  }, [lines]);

  // Order-wide box total for the bottom bar. Each line is tallied against ITS
  // OWN packs, then summed — pack tables differ per product, so a single flat
  // sum over sizes would be wrong.
  const orderBoxes = useMemo(() => {
    const total = lines.reduce((sum, line) => sum + tally(line.qtys, line.packs).boxes, 0);
    return Math.round(total * 10) / 10;
  }, [lines]);

  function addLine(
    tile: V2Tile,
    picked: {
      variant: string | null;
      base:    string | null;
      shade:   string | null;
      qtys:    Record<string, number>;
    },
  ): void {
    const product = productForTile(tile.sap);
    // Keep only the packs actually ordered, so a line never carries a trail of
    // zeroes into the review screen step 5 will build.
    const qtys: Record<string, number> = {};
    for (const [size, qty] of Object.entries(picked.qtys)) {
      if (qty > 0) qtys[size] = qty;
    }
    setLines((prev) => [
      ...prev,
      {
        id:          `${tile.sap}-${Date.now()}-${prev.length}`,
        tileSap:     tile.sap,
        productKey:  product.key,
        productName: product.name,
        variant:     picked.variant,
        base:        picked.base,
        shade:       picked.shade,
        qtys,
        packs:       product.packs,
      },
    ]);
    setOpenTile(null);
  }

  const cartOpen = lines.length > 0;

  return (
    <>
      <main
        className="min-h-screen w-full bg-white"
        // Clearance so the fixed bottom bar never covers the last tile row.
        style={{ paddingBottom: cartOpen ? 108 : 24 }}
      >
        {/* ── 1. TOP BAR ───────────────────────────────────────────────── */}
        {/* No chevron anywhere in this bar, by spec. The X button is inert. */}
        <header
          className="sticky top-0 z-10 flex items-center gap-3 bg-white px-4 py-2.5"
          style={{ borderBottom: `1px solid ${RULE}` }}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-extrabold tracking-tight text-violet-700">
              AMBIKA PAINTS
            </p>
            <p className="truncate font-mono text-[11px] text-neutral-400">
              102492 · PARLE POINT
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{ border: `1px solid ${RULE}` }}
          >
            <X className="h-4 w-4 text-neutral-400" strokeWidth={2.5} />
          </button>
        </header>

        {/* ── 2. SEARCH ────────────────────────────────────────────────── */}
        {/* Static by spec — a div, not an <input>. "Search product" is
            rendered text, not a placeholder, so nothing is focusable yet. */}
        <div className="px-4 pt-3">
          <div
            className="flex items-center gap-2 rounded-[12px] px-3 py-3"
            style={{ background: SEARCH_BG }}
          >
            <Search className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={2.5} />
            <span className="truncate text-[15px] text-neutral-400">Search product</span>
          </div>
        </div>

        {/* ── 3. FAMILY BLOCKS ─────────────────────────────────────────── */}
        {FAMILIES.map((family) => (
          <section key={family.name} className="px-4 pt-4">
            <div className="mb-2 flex items-center gap-2">
              <h2
                className="shrink-0 text-[10px] font-extrabold uppercase text-neutral-400"
                style={{ letterSpacing: "0.1em" }}
              >
                {family.name}
              </h2>
              {/* flex-1 rule filling the remaining width to the right edge */}
              <span className="h-px flex-1" style={{ background: RULE }} />
            </div>

            <div className="grid grid-cols-4" style={{ gap: 7 }}>
              {family.tiles.map((tile) => {
                const count = countsByTile[tile.sap] ?? 0;
                const inOrder = count > 0;
                return (
                  <button
                    key={tile.sap}
                    type="button"
                    onClick={() => setOpenTile(tile)}
                    className="relative flex h-16 min-w-0 items-center justify-center rounded-[13px] px-[2px]"
                    style={{
                      background: inOrder ? VIOLET_BG : family.tint,
                      border: inOrder ? `1.5px solid ${VIOLET}` : "1.5px solid transparent",
                    }}
                  >
                    <span className="text-center text-[13px] font-bold" style={TILE_TEXT_STYLE}>
                      {tile.label}
                    </span>
                    {inOrder && (
                      <span
                        className="absolute flex items-center justify-center rounded-full text-[10px] font-extrabold text-white"
                        style={{
                          top: -7, right: -7,
                          minWidth: 18, height: 18, padding: "0 5px",
                          background: VIOLET,
                        }}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </main>

      {/* ── 4. BOTTOM BAR — only once the order has something in it ─────── */}
      {cartOpen && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 bg-white px-4 pt-3"
          style={{
            borderTop: `1px solid ${RULE}`,
            paddingBottom: "max(env(safe-area-inset-bottom), 12px)",
          }}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold" style={{ color: INK }}>
              {lines.length} {lines.length === 1 ? "line" : "lines"}
            </p>
            <p className="truncate font-mono text-[11px] text-neutral-400">
              {orderBoxes} boxes
            </p>
          </div>
          {/* Inert by spec — step 5 builds the review screen. */}
          <button
            type="button"
            className="shrink-0 rounded-[13px] px-5 py-3 text-[15px] font-extrabold text-white"
            style={{ background: VIOLET }}
          >
            Review order
          </button>
        </div>
      )}

      {/* ── 5. DRAWER ────────────────────────────────────────────────────
          `key` forces a fresh mount per tile, so selections and quantities
          never leak from one product into the next. */}
      {openTile && (
        <ProductDrawer
          key={openTile.sap}
          product={productForTile(openTile.sap)}
          onClose={() => setOpenTile(null)}
          onAdd={(picked) => addLine(openTile, picked)}
        />
      )}
    </>
  );
}
