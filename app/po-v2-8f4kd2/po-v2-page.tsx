"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Eraser, FileText, Home, Send, Users, X } from "lucide-react";
import ProductDrawer from "./product-drawer";
import V2Sheet from "./v2-sheet";
import { CustomerListBody, CustomerSearchInput } from "./customer-list";
import { MIN_QUERY, ProductResults, ProductSearchInput } from "./product-search";
import {
  FAMILIES, INK, RULE, VIOLET, VIOLET_BG,
  addRecent, buildCatalog, loadRecents, resolveForSearch, unitsIn,
  type ApiCustomer, type ApiPayload, type ApiProduct,
  type V2CartLine, type V2Recent, type V2Resolved, type V2Tile,
} from "./v2-data";

// Hidden v2 salesman order page — LANDING + BOARD, two screens in one route.
//
// 🔴 CONTAINMENT — imports its own siblings and node_modules only. Nothing
// from lib/ or app/po/. Every colour is an inline style, so globals.css and
// tailwind.config.ts stay untouched.
//
// TWO SCREENS, ONE URL. The dealer list and the board are switched by state,
// not by routing: /po-v2-8f4kd2 is the whole app. That keeps the fetched
// catalog and the cart alive across the switch with no store and no reload.
//
// Cart is REACT STATE ONLY — no localStorage (recents are the one exception,
// under v2's own key), no email.
//
// NO HORIZONTAL SCROLL, met structurally rather than with an overflow-x
// crutch: four equal `1fr` tracks, `min-w-0` on grid/flex children (they
// default to `min-width:auto`, which is what actually causes runaway rows),
// and truncating text.

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
  | { kind: "ready"; customers: ApiCustomer[]; products: ApiProduct[]; byTile: Map<string, V2Resolved> };

type Screen = "customers" | "order";
type Sheet  = null | "switch" | "cancel";

export default function PoV2Page(): React.JSX.Element {
  const [load, setLoad]       = useState<LoadState>({ kind: "loading" });
  const [screen, setScreen]   = useState<Screen>("customers");
  const [dealer, setDealer]   = useState<ApiCustomer | null>(null);
  const [recents, setRecents] = useState<V2Recent[]>([]);
  const [query, setQuery]     = useState("");
  const [sheet, setSheet]     = useState<Sheet>(null);
  const [prodQuery, setProdQuery] = useState("");
  const [openTile, setOpenTile] = useState<V2Tile | null>(null);
  const [openRow, setOpenRow]     = useState<ApiProduct | null>(null);
  const [lines, setLines]     = useState<V2CartLine[]>([]);

  const fetchData = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const res = await fetch("/api/order/data", { cache: "no-store" });
      if (!res.ok) throw new Error(`Catalog request failed (${res.status})`);
      const data = (await res.json()) as ApiPayload;
      // The route swallows its own errors and answers 200 with empty arrays
      // (route.ts:140), so an empty catalog is a FAILURE here, not a valid
      // read. Treating it as success is what produces a silent empty screen.
      if (!Array.isArray(data.products) || data.products.length === 0) {
        throw new Error("Catalog came back empty");
      }
      const { byTile, report } = buildCatalog(data.products);
      // The catalog gate, kept live: the curated option lists are a snapshot
      // of 90 days of orders and the catalog moves underneath them, so a
      // reseed can invalidate a chip at any time.
      if (
        report.missingOptions.length || report.zeroRowTiles.length ||
        report.emptyPackChips.length || report.droppedDupes.length
      ) {
        console.warn("[po-v2] catalog gate", report);
      }
      setLoad({ kind: "ready", customers: data.customers ?? [], products: data.products, byTile });
    } catch (err) {
      setLoad({ kind: "error", message: err instanceof Error ? err.message : "Could not load the catalog" });
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);
  // Client-only read, so the server render and the first client render agree.
  useEffect(() => { setRecents(loadRecents()); }, []);

  const countsByTile = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const line of lines) counts[line.tileSap] = (counts[line.tileSap] ?? 0) + 1;
    return counts;
  }, [lines]);

  const orderUnits = useMemo(
    () => lines.reduce((sum, line) => sum + unitsIn(line.qtys), 0),
    [lines],
  );

  /** Picking a dealer — from the landing list OR the switch sheet. */
  function pickDealer(c: ApiCustomer): void {
    setDealer(c);
    setRecents(addRecent(c));
    setQuery("");
    setSheet(null);
    setScreen("order");
    // 🔴 THE CART IS NOT TOUCHED. Lines are keyed on products, not on the
    // dealer, so swapping who the order is for keeps every line intact — that
    // is the whole point of the switch sheet.
  }

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
      { id: `${tile.sap}-${Date.now()}-${prev.length}`, tileSap: tile.sap,
        label: tile.label, option: picked.option, rowId: picked.row.id, qtys },
    ]);
    setOpenTile(null);
  }

  /** A line added from a search hit rather than a tile. */
  function addLineFromRow(
    product: V2Resolved,
    picked: { option: string | null; row: ApiProduct; qtys: Record<string, number> },
  ): void {
    const qtys: Record<string, number> = {};
    for (const [label, qty] of Object.entries(picked.qtys)) {
      if (qty > 0) qtys[label] = qty;
    }
    setLines((prev) => [
      ...prev,
      // tileSap is the resolved product's sap, so a searched line lights up
      // its board tile exactly like one added from the board — the badge does
      // not care which door the salesman came through.
      { id: `${product.sap}-${Date.now()}-${prev.length}`, tileSap: product.sap,
        label: product.label, option: picked.option, rowId: picked.row.id, qtys },
    ]);
    setOpenRow(null);
  }

  /**
   * "+ More" inside the drawer. Not a second mechanism: it closes the drawer
   * and runs the REAL product search, pre-filled with this product's name, so
   * the results are that product's other catalog options.
   */
  function openMore(query: string): void {
    setOpenTile(null);
    setOpenRow(null);
    setProdQuery(query);
  }

  const ready       = load.kind === "ready";
  const customers   = ready ? load.customers : [];
  const products    = ready ? load.products : [];
  const searching   = prodQuery.trim().length >= MIN_QUERY;
  const cartOpen    = lines.length > 0;
  const openProduct = ready && openTile ? load.byTile.get(openTile.sap) ?? null : null;
  const searchResolved = ready && openRow ? resolveForSearch(openRow, load.byTile) : null;

  // ── Failure — a plain message and Retry, never a silent empty screen ─────
  if (load.kind === "error") {
    return (
      <main className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-white px-8 text-center">
        <p className="text-[15px] font-bold" style={{ color: INK }}>Could not load</p>
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

  // ══ SCREEN 1 — THE DEALER LIST ═══════════════════════════════════════════
  if (screen === "customers") {
    return (
      <main className="min-h-screen w-full bg-white" style={{ paddingBottom: 76 }}>
        <header
          className="sticky top-0 z-10 flex items-center gap-2 bg-white px-4 py-3"
          style={{ borderBottom: `1px solid ${RULE}` }}
        >
          <OrbitMark />
          <span className="text-[19px] font-extrabold" style={{ color: VIOLET, letterSpacing: "-0.03em" }}>
            Orbit
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px] text-neutral-400">SURAT DEPOT</span>
        </header>

        <div className="px-4 pt-3 pb-2">
          <CustomerSearchInput value={query} onChange={setQuery} />
        </div>

        {ready ? (
          <CustomerListBody
            customers={customers} recents={recents} query={query} onPick={pickDealer}
          />
        ) : (
          <p className="px-4 py-10 text-center text-[13px] text-neutral-400">Loading dealers…</p>
        )}

        <BottomNav />
      </main>
    );
  }

  // ══ SCREEN 2 — THE BOARD ═════════════════════════════════════════════════
  return (
    <>
      <main className="min-h-screen w-full bg-white" style={{ paddingBottom: cartOpen ? 108 : 24 }}>
        {/* ── TOP BAR — the whole left side opens the switch sheet ──────── */}
        <header
          className="sticky top-0 z-10 flex items-center gap-3 bg-white px-4 py-2.5"
          style={{ borderBottom: `1px solid ${RULE}` }}
        >
          <button
            type="button"
            onClick={() => { setQuery(""); setSheet("switch"); }}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-extrabold tracking-tight" style={{ color: VIOLET }}>
                {dealer ? dealer.name.toUpperCase() : "—"}
              </span>
              <span className="block truncate font-mono text-[11px] text-neutral-400">
                {dealer ? `${dealer.code}${dealer.area ? ` · ${dealer.area}` : ""}` : ""}
              </span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-300" strokeWidth={2.5} />
          </button>
          {/* Opens the cancel sheet. It clears NOTHING on its own. */}
          <button
            type="button" aria-label="Start a new order"
            onClick={() => setSheet("cancel")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{ border: `1px solid ${RULE}` }}
          >
            <X className="h-4 w-4 text-neutral-400" strokeWidth={2.5} />
          </button>
        </header>

        {/* ── PRODUCT SEARCH ──────────────────────────────────────────── */}
        <div className="px-4 pt-3">
          <ProductSearchInput value={prodQuery} onChange={setProdQuery} />
        </div>

        {/* Under 2 characters the board stands; at 2 the board is REPLACED by
            results. The dealer bar above and the cart bar below both stay, so
            searching never loses the salesman his context. */}
        {searching ? (
          <div className="pt-2">
            <ProductResults
              products={products}
              query={prodQuery}
              onPick={(row) => setOpenRow(row)}
            />
          </div>
        ) : (
        <>
        {/* ── FAMILY BLOCKS ────────────────────────────────────────────── */}
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
                    className="relative flex h-16 min-w-0 items-center justify-center rounded-[13px] px-[2px]"
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
        </>
        )}
      </main>

      {/* ── BOTTOM BAR ─────────────────────────────────────────────────── */}
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

      {/* ── CHANGE-CUSTOMER SHEET ──────────────────────────────────────── */}
      {sheet === "switch" && (
        <V2Sheet onClose={() => setSheet(null)}>
          <div className="shrink-0 px-4 pt-1.5 pb-3">
            <h2 className="text-[18px] font-extrabold" style={{ color: INK, letterSpacing: "-0.025em" }}>
              Change customer
            </h2>
            <p className="text-[11.5px] text-neutral-400">
              {lines.length} {lines.length === 1 ? "line" : "lines"} already in this order — they stay
            </p>
          </div>
          <div className="shrink-0 px-4 pb-2">
            <CustomerSearchInput value={query} onChange={setQuery} />
          </div>
          <div className="min-h-0 overflow-y-auto">
            <CustomerListBody
              customers={customers} recents={recents} query={query}
              currentCode={dealer?.code ?? null} onPick={pickDealer}
            />
          </div>
        </V2Sheet>
      )}

      {/* ── CANCEL SHEET — clears nothing by itself ────────────────────── */}
      {sheet === "cancel" && (
        <V2Sheet
          onClose={() => setSheet(null)}
          footer={
            // The safe way out is the biggest target in the sheet.
            <button
              type="button" onClick={() => setSheet(null)}
              className="w-full rounded-[13px] py-3 text-[15px] font-extrabold text-white"
              style={{ background: VIOLET }}
            >
              Keep editing
            </button>
          }
        >
          <div className="shrink-0 px-4 pt-1.5 pb-3">
            <h2 className="text-[18px] font-extrabold" style={{ color: INK, letterSpacing: "-0.025em" }}>
              Start a new order?
            </h2>
            <p className="text-[11.5px] text-neutral-400">
              {lines.length} {lines.length === 1 ? "line" : "lines"} will be cleared
            </p>
          </div>
          <div className="shrink-0 space-y-2 px-4 pb-3">
            <DestructiveRow
              icon={<Eraser className="h-4 w-4" strokeWidth={2.5} style={{ color: INK }} />}
              label={`Clear items, keep ${firstWord(dealer?.name)}`}
              sub="Empty basket, same dealer on screen"
              onClick={() => { setLines([]); setSheet(null); }}
            />
            <DestructiveRow
              icon={<Users className="h-4 w-4" strokeWidth={2.5} style={{ color: INK }} />}
              label="Start over, choose a dealer"
              sub="Back to the dealer list"
              onClick={() => {
                setLines([]);
                setDealer(null);
                setQuery("");
                setProdQuery("");
                setSheet(null);
                setScreen("customers");
              }}
            />
          </div>
        </V2Sheet>
      )}

      {/* ── PRODUCT DRAWER, from the BOARD ─────────────────────────────── */}
      {/* `key` forces a fresh mount per tile, so selections never leak. */}
      {openTile && openProduct && (
        <ProductDrawer
          key={openTile.sap}
          product={openProduct}
          onClose={() => setOpenTile(null)}
          onAdd={(picked) => addLine(openTile, picked)}
          onMore={openMore}
        />
      )}

      {/* ── PRODUCT DRAWER, from a SEARCH HIT ──────────────────────────── */}
      {/* Opens on that exact menu row with its option already selected —
          resolveForSearch appends the option to the chip row when the curated
          list does not carry it, so what was searched for is never invisible. */}
      {openRow && searchResolved && (
        <ProductDrawer
          key={`row-${openRow.id}`}
          product={searchResolved.product}
          initialOption={searchResolved.initialOption}
          onClose={() => setOpenRow(null)}
          onAdd={(picked) => addLineFromRow(searchResolved.product, picked)}
          onMore={openMore}
        />
      )}
    </>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

/** First word of the dealer's name, for the "keep {dealer}" label. */
function firstWord(name: string | undefined): string {
  const word = (name ?? "").trim().split(/\s+/)[0];
  return word && word.length > 0 ? word : "dealer";
}

/** The Orbit ring: a violet circle with a filled dot inside it. */
function OrbitMark(): React.JSX.Element {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: 20, height: 20, border: `2.4px solid ${VIOLET}` }}
    >
      <span className="block rounded-full" style={{ width: 6, height: 6, background: VIOLET }} />
    </span>
  );
}

/** One option row in the cancel sheet: icon square, bold label, grey sub-line. */
function DestructiveRow({ icon, label, sub, onClick }: {
  icon: React.ReactNode; label: string; sub: string; onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button" onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[13px] px-3 py-3 text-left"
      style={{ border: `1.5px solid ${RULE}` }}
    >
      <span
        className="flex shrink-0 items-center justify-center rounded-[9px]"
        style={{ width: 32, height: 32, background: "#F2F1F5" }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-bold" style={{ color: INK }}>{label}</span>
        <span className="block truncate text-[11.5px] text-neutral-400">{sub}</span>
      </span>
    </button>
  );
}

/** Home / Drafts / Sent. Only Home is active; the other two are inert. */
function BottomNav(): React.JSX.Element {
  const items = [
    { label: "Home",   icon: Home,     active: true },
    { label: "Drafts", icon: FileText, active: false },
    { label: "Sent",   icon: Send,     active: false },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex bg-white pt-2"
      style={{ borderTop: `1px solid ${RULE}`, paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}
    >
      {items.map(({ label, icon: Icon, active }) => (
        <span key={label} className="flex flex-1 flex-col items-center gap-0.5">
          <Icon className="h-[18px] w-[18px]" strokeWidth={2.5}
                style={{ color: active ? VIOLET : "#A3A3A3" }} />
          <span className="text-[10px] font-extrabold"
                style={{ color: active ? VIOLET : "#A3A3A3" }}>
            {label}
          </span>
        </span>
      ))}
    </nav>
  );
}
