"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import ProductDrawer from "./product-drawer";
import {
  DEALER_CODE, FAMILIES, INK, RULE, SEARCH_BG, VIOLET, VIOLET_BG,
  buildCatalog, unitsIn,
  type ApiCustomer, type ApiPayload, type ApiProduct,
  type V2CartLine, type V2Resolved, type V2Tile,
} from "./v2-data";

// Hidden v2 salesman order page — BOARD + LIVE CATALOG + CART.
//
// 🔴 CONTAINMENT — imports ./v2-data, ./product-drawer and node_modules only.
// Nothing from lib/ or app/po/. Every colour is an inline style, so
// globals.css and tailwind.config.ts stay untouched.
//
// Cart is REACT STATE ONLY — no localStorage, no email. A refresh empties it.
//
// NO HORIZONTAL SCROLL, met structurally rather than with an overflow-x
// crutch: four equal `1fr` tracks, `min-w-0` on grid/flex children (they
// default to `min-width:auto`, which is what actually causes runaway rows),
// and truncating header lines.

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

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; customer: ApiCustomer | null; byTile: Map<string, V2Resolved> };

export default function PoV2Page(): React.JSX.Element {
  const [load, setLoad]         = useState<LoadState>({ kind: "loading" });
  const [openTile, setOpenTile] = useState<V2Tile | null>(null);
  const [lines, setLines]       = useState<V2CartLine[]>([]);

  const fetchData = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const res = await fetch("/api/order/data", { cache: "no-store" });
      if (!res.ok) throw new Error(`Catalog request failed (${res.status})`);
      const data = (await res.json()) as ApiPayload;
      // The route swallows its own errors and answers 200 with empty arrays
      // (route.ts:140), so an empty catalog is a FAILURE here, not a valid
      // read. Treating it as success is what would produce the silent empty
      // screen this step exists to avoid.
      if (!Array.isArray(data.products) || data.products.length === 0) {
        throw new Error("Catalog came back empty");
      }

      const { byTile, report } = buildCatalog(data.products);

      // The Task-5 gate, kept live rather than run once: the curated lists are
      // a snapshot of 90 days of orders and the catalog moves underneath them,
      // so a reseed can invalidate a chip at any time. Anything it finds is
      // surfaced here instead of quietly disappearing from the UI.
      if (
        report.missingOptions.length || report.zeroRowTiles.length ||
        report.emptyPackChips.length || report.droppedDupes.length
      ) {
        console.warn("[po-v2] catalog gate", report);
      }

      setLoad({
        kind: "ready",
        customer: data.customers.find((c) => c.code === DEALER_CODE) ?? null,
        byTile,
      });
    } catch (err) {
      setLoad({ kind: "error", message: err instanceof Error ? err.message : "Could not load the catalog" });
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const countsByTile = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const line of lines) counts[line.tileSap] = (counts[line.tileSap] ?? 0) + 1;
    return counts;
  }, [lines]);

  const orderUnits = useMemo(
    () => lines.reduce((sum, line) => sum + unitsIn(line.qtys), 0),
    [lines],
  );

  function addLine(
    tile: V2Tile,
    picked: { option: string | null; row: ApiProduct; qtys: Record<string, number> },
  ): void {
    const qtys: Record<string, number> = {};
    for (const [label, qty] of Object.entries(picked.qtys)) {
      if (qty > 0) qtys[label] = qty;
    }
    setLines((prev) => [
      ...prev,
      {
        id:      `${tile.sap}-${Date.now()}-${prev.length}`,
        tileSap: tile.sap,
        label:   tile.label,
        option:  picked.option,
        rowId:   picked.row.id,
        qtys,
      },
    ]);
    setOpenTile(null);
  }

  const ready    = load.kind === "ready";
  const cartOpen = lines.length > 0;
  const openProduct = ready && openTile ? load.byTile.get(openTile.sap) ?? null : null;

  // ── Failure — a plain message and a Retry, never a silent empty board ────
  if (load.kind === "error") {
    return (
      <main className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-white px-8 text-center">
        <p className="text-[15px] font-bold" style={{ color: INK }}>Could not load products</p>
        <p className="text-[13px] leading-relaxed text-neutral-400">{load.message}</p>
        <button
          type="button" onClick={() => void fetchData()}
          className="mt-1 rounded-[13px] px-6 py-3 text-[15px] font-extrabold text-white"
          style={{ background: VIOLET }}
        >
          Retry
        </button>
      </main>
    );
  }

  return (
    <>
      <main className="min-h-screen w-full bg-white" style={{ paddingBottom: cartOpen ? 108 : 24 }}>
        {/* ── 1. TOP BAR ───────────────────────────────────────────────── */}
        <header
          className="sticky top-0 z-10 flex items-center gap-3 bg-white px-4 py-2.5"
          style={{ borderBottom: `1px solid ${RULE}` }}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-extrabold tracking-tight text-violet-700">
              {ready && load.customer ? load.customer.name.toUpperCase() : "—"}
            </p>
            <p className="truncate font-mono text-[11px] text-neutral-400">
              {ready && load.customer
                ? `${load.customer.code}${load.customer.area ? ` · ${load.customer.area}` : ""}`
                : DEALER_CODE}
            </p>
          </div>
          <button
            type="button" aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{ border: `1px solid ${RULE}` }}
          >
            <X className="h-4 w-4 text-neutral-400" strokeWidth={2.5} />
          </button>
        </header>

        {/* ── 2. SEARCH — static this step; search lands in step 7 ──────── */}
        <div className="px-4 pt-3">
          <div className="flex items-center gap-2 rounded-[12px] px-3 py-3" style={{ background: SEARCH_BG }}>
            <Search className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={2.5} />
            <span className="truncate text-[15px] text-neutral-400">Search product</span>
          </div>
        </div>

        {/* ── 3. FAMILY BLOCKS ─────────────────────────────────────────── */}
        {/* While loading, the board is the loading state: same layout, tiles
            greyed and non-tappable, so nothing shifts when the data lands. */}
        {FAMILIES.map((family) => (
          <section key={family.name} className="px-4 pt-4">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="shrink-0 text-[10px] font-extrabold uppercase text-neutral-400"
                  style={{ letterSpacing: "0.1em" }}>
                {family.name}
              </h2>
              <span className="h-px flex-1" style={{ background: RULE }} />
            </div>

            <div className="grid grid-cols-4" style={{ gap: 7 }}>
              {family.tiles.map((tile) => {
                const count   = countsByTile[tile.sap] ?? 0;
                const inOrder = count > 0;
                return (
                  <button
                    key={tile.sap}
                    type="button"
                    disabled={!ready}
                    onClick={() => setOpenTile(tile)}
                    className="relative flex h-16 min-w-0 items-center justify-center rounded-[13px] px-[2px] transition-opacity"
                    style={{
                      background: inOrder ? VIOLET_BG : family.tint,
                      border:     inOrder ? `1.5px solid ${VIOLET}` : "1.5px solid transparent",
                      opacity:    ready ? 1 : 0.45,
                    }}
                  >
                    <span className="text-center text-[13px] font-bold" style={TILE_TEXT_STYLE}>
                      {tile.label}
                    </span>
                    {inOrder && (
                      <span
                        className="absolute flex items-center justify-center rounded-full text-[10px] font-extrabold text-white"
                        style={{ top: -7, right: -7, minWidth: 18, height: 18, padding: "0 5px", background: VIOLET }}
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

      {/* ── 4. BOTTOM BAR ──────────────────────────────────────────────── */}
      {cartOpen && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 bg-white px-4 pt-3"
          style={{ borderTop: `1px solid ${RULE}`, paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold" style={{ color: INK }}>
              {lines.length} {lines.length === 1 ? "line" : "lines"}
            </p>
            <p className="truncate font-mono text-[11px] text-neutral-400">{orderUnits} units</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-[13px] px-5 py-3 text-[15px] font-extrabold text-white"
            style={{ background: VIOLET }}
          >
            Review order
          </button>
        </div>
      )}

      {/* ── 5. DRAWER — `key` forces a fresh mount per tile ─────────────── */}
      {openTile && openProduct && (
        <ProductDrawer
          key={openTile.sap}
          product={openProduct}
          onClose={() => setOpenTile(null)}
          onAdd={(picked) => addLine(openTile, picked)}
        />
      )}
    </>
  );
}
