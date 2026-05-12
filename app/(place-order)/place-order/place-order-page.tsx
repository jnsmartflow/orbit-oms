"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CustomerSearch from "./components/customer-search";
import BigSearchBar from "./components/big-search-bar";
import SpeedDialGrid, { type SpeedDialItem } from "./components/speed-dial-grid";
import ActiveProductPanel, { type ActivePanelState } from "./components/active-product-panel";
import RecentlyUsed, { type RecentlyUsedItem } from "./components/recently-used";
import LastOrderRecall, { type RepeatOrderEntry } from "./components/last-order-recall";
import BrowseAllFamilies from "./components/browse-all-families";
import CartPanel from "./components/cart-panel";
import SendConfirmOverlay from "./components/send-confirm-overlay";
import KeyboardHelpOverlay from "./components/keyboard-help-overlay";
import type { Bill, CartLine, Customer, Product } from "./types";
import { buildEmail, buildMailtoUrl, type EmailDispatch, type EmailMarker } from "@/lib/place-order/email";
import { clearDraft, loadDraft, saveDraft, type DraftSnapshot } from "@/lib/place-order/draft-storage";
import type { QuickTile } from "@/lib/place-order/quick-tiles-config";
import type { SearchResult } from "@/lib/place-order/queries";
import { useKeyboardRouting, routeDigit } from "@/lib/place-order/use-keyboard-routing";

// /place-order — desktop phone-order entry surface for depot operators.
//
// v4 layout (May 2026):
//   - Top bar with logo + customer-search pill
//   - Left: big search bar + 9-tile speed dial + active panel + recently
//     used + last-order recall + browse-all
//   - Right: cart panel (340px), single-active-bill render with sub-product
//     groupings; bill tabs + Add survive for multi-bill workflows
//
// Cart state shape (Bill[], activeBillId, billCounter, draft autosave,
// customer-switch save/load, beforeunload) is preserved verbatim from the
// v1-v3 build per Stage 2 decision C. Only addition: CartLine.touchedAt
// is set on every setQty path to power RecentlyUsed sort.
//
// Keyboard wiring is intentionally absent from this file — page-level
// global handlers land in lib via use-keyboard-routing.ts (Step 3.6).

function lineKey(subProduct: string, baseColour: string | null): string {
  return `${subProduct}|||${baseColour ?? ""}`;
}
function billLineKey(billId: number, subProduct: string, baseColour: string | null): string {
  return `${billId}|||${lineKey(subProduct, baseColour)}`;
}

const JUST_ADDED_FLASH_MS  = 1200;
const MOBILE_BREAKPOINT_PX = 1024;

const FRESH_BILLS: Bill[] = [{ id: 1, lines: [] }];

export default function PlaceOrderPage(): React.JSX.Element {
  const [customers,   setCustomers]   = useState<Customer[]>([]);
  const [products,    setProducts]    = useState<Product[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Speed dial config — fetched once on mount, swappable server-side.
  const [quickTiles, setQuickTiles] = useState<QuickTile[]>([]);

  // v4 active-panel state machine + search-driven base-row focus hint.
  const [activeState, setActiveState] = useState<ActivePanelState>({ kind: "idle" });
  const [focusHint,   setFocusHint]   = useState<{ base: string | null } | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Cart (multi-bill — preserved from v1-v3 build).
  const [bills, setBills]                 = useState<Bill[]>(FRESH_BILLS);
  const [activeBillId, setActiveBillId]   = useState<number>(1);
  const [billCounter, setBillCounter]     = useState<number>(1);
  const [justAddedKeys, setJustAddedKeys] = useState<Record<string, true>>({});

  // Order-level fields.
  const [shipTo,   setShipTo]   = useState<string>("");
  const [dispatch, setDispatch] = useState<EmailDispatch>("Normal");
  const [marker,   setMarker]   = useState<EmailMarker>(null);

  // Send / help flow.
  const [confirmOpen,  setConfirmOpen]  = useState<boolean>(false);
  const [helpOpen,     setHelpOpen]     = useState<boolean>(false);
  const [toastVisible, setToastVisible] = useState<boolean>(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const sendButtonRef  = useRef<HTMLButtonElement>(null);
  const pageBodyRef    = useRef<HTMLElement>(null);   // <main> target for cell-Esc parking

  // ── Mount: catalog + speed-dial fetch ──────────────────────────────────
  useEffect(() => {
    fetch("/api/place-order/data")
      .then((r) => r.json())
      .then((data: { customers?: Customer[]; products?: Product[] }) => {
        setCustomers(data.customers ?? []);
        setProducts(data.products ?? []);
      })
      .catch(() => { /* silent — empty arrays already in state */ })
      .finally(() => setDataLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/place-order/quick-tiles")
      .then((r) => r.json())
      .then((tiles: QuickTile[]) => setQuickTiles(tiles))
      .catch(() => { /* silent — empty dial is acceptable fallback */ });
  }, []);

  // Customer-lock auto-focus: after a customer is selected (or swapped),
  // jump focus into the big search bar so the operator can start typing
  // the product immediately. Clearing the customer skips the focus call.
  useEffect(() => {
    if (selectedCustomer) {
      searchInputRef.current?.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer?.code]);

  // < 1024px viewport → redirect to mobile /order. Runs on mount + resize.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    function check(matches: boolean): void {
      if (matches) window.location.href = "/order";
    }
    check(mql.matches);
    function onChange(e: MediaQueryListEvent): void { check(e.matches); }
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const activeBill      = useMemo<Bill | undefined>(
    () => bills.find((b) => b.id === activeBillId),
    [bills, activeBillId],
  );
  const activeCartLines = activeBill?.lines ?? [];

  // ── Cart helpers (write to ACTIVE bill) ────────────────────────────────

  function flashLine(billId: number, subProduct: string, baseColour: string | null): void {
    const k = billLineKey(billId, subProduct, baseColour);
    setJustAddedKeys((prev) => ({ ...prev, [k]: true }));
    setTimeout(() => {
      setJustAddedKeys((prev) => {
        if (!prev[k]) return prev;
        const next = { ...prev };
        delete next[k];
        return next;
      });
    }, JUST_ADDED_FLASH_MS);
  }

  function qtyAt(subProduct: string, baseColour: string | null, pack: string): number {
    if (!activeBill) return 0;
    const k    = lineKey(subProduct, baseColour);
    const line = activeBill.lines.find((l) => lineKey(l.subProduct, l.baseColour) === k);
    return line?.packQtys[pack] ?? 0;
  }

  function setQty(product: Product, pack: string, qty: number): void {
    const k   = lineKey(product.subProduct, product.baseColour ?? null);
    const now = Date.now();
    setBills((prev) => prev.map((bill) => {
      if (bill.id !== activeBillId) return bill;
      const idx = bill.lines.findIndex((l) => lineKey(l.subProduct, l.baseColour) === k);
      if (qty <= 0) {
        if (idx < 0) return bill;
        const line = bill.lines[idx];
        const nextPackQtys = { ...line.packQtys };
        delete nextPackQtys[pack];
        if (Object.keys(nextPackQtys).length === 0) {
          return { ...bill, lines: bill.lines.filter((_, i) => i !== idx) };
        }
        return {
          ...bill,
          lines: bill.lines.map((l, i) =>
            i === idx ? { ...l, packQtys: nextPackQtys, touchedAt: now } : l,
          ),
        };
      }
      if (idx < 0) {
        flashLine(bill.id, product.subProduct, product.baseColour ?? null);
        const newLine: CartLine = {
          family:      product.family,
          subProduct:  product.subProduct,
          displayName: product.displayName,
          baseColour:  product.baseColour ?? null,
          packQtys:    { [pack]: qty },
          touchedAt:   now,
        };
        return { ...bill, lines: [...bill.lines, newLine] };
      }
      return {
        ...bill,
        lines: bill.lines.map((l, i) =>
          i === idx ? { ...l, packQtys: { ...l.packQtys, [pack]: qty }, touchedAt: now } : l,
        ),
      };
    }));
  }

  function handleRemovePack(subProduct: string, baseColour: string | null, pack: string): void {
    const matching = products.find(
      (p) => p.subProduct === subProduct && (p.baseColour ?? null) === baseColour,
    );
    if (!matching) {
      console.warn(`[place-order-page] remove pack: product not in catalog: ${subProduct} / ${baseColour ?? "null"}`);
      return;
    }
    setQty(matching, pack, 0);
  }

  // ── Multi-bill ─────────────────────────────────────────────────────────

  const addBill = useCallback((): void => {
    setBillCounter((prev) => {
      const id = prev + 1;
      setBills((prevBills) => [...prevBills, { id, lines: [] }]);
      setActiveBillId(id);
      setActiveState({ kind: "idle" });
      setFocusHint(null);
      return id;
    });
  }, []);

  // ── Customer / draft persistence ───────────────────────────────────────

  function applyDraft(snap: DraftSnapshot): void {
    setBills(snap.bills.length > 0 ? snap.bills : FRESH_BILLS);
    setActiveBillId(snap.activeBillId);
    setBillCounter(snap.billCounter);
    setShipTo(snap.shipTo);
    setDispatch(snap.dispatch);
    setMarker(snap.marker);
    setJustAddedKeys({});
    setActiveState({ kind: "idle" });
    setFocusHint(null);
  }

  function resetCart(): void {
    setBills(FRESH_BILLS);
    setActiveBillId(1);
    setBillCounter(1);
    setShipTo("");
    setDispatch("Normal");
    setMarker(null);
    setJustAddedKeys({});
    setActiveState({ kind: "idle" });
    setFocusHint(null);
  }

  function currentSnapshot(): DraftSnapshot {
    return { bills, activeBillId, billCounter, shipTo, dispatch, marker };
  }

  function handleSelectCustomer(next: Customer): void {
    if (selectedCustomer && selectedCustomer.code !== next.code) {
      saveDraft(selectedCustomer, currentSnapshot());
    }
    setSelectedCustomer(next);
    const draft = loadDraft(next.code);
    if (draft) applyDraft(draft);
    else       resetCart();
  }

  function handleClearCustomer(): void {
    if (selectedCustomer) {
      saveDraft(selectedCustomer, currentSnapshot());
    }
    setSelectedCustomer(null);
    resetCart();
  }

  // Autosave on any cart-shape change while customer is set.
  useEffect(() => {
    if (!selectedCustomer) return;
    saveDraft(selectedCustomer, { bills, activeBillId, billCounter, shipTo, dispatch, marker });
  }, [selectedCustomer, bills, activeBillId, billCounter, shipTo, dispatch, marker]);

  // beforeunload — single-attach via latest-state ref.
  const stateRef = useRef({ selectedCustomer, bills, activeBillId, billCounter, shipTo, dispatch, marker });
  useEffect(() => {
    stateRef.current = { selectedCustomer, bills, activeBillId, billCounter, shipTo, dispatch, marker };
  });
  useEffect(() => {
    function onBeforeUnload(): void {
      const s = stateRef.current;
      if (s.selectedCustomer) {
        saveDraft(s.selectedCustomer, {
          bills:        s.bills,
          activeBillId: s.activeBillId,
          billCounter:  s.billCounter,
          shipTo:       s.shipTo,
          dispatch:     s.dispatch,
          marker:       s.marker,
        });
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // ── Active-panel transitions ───────────────────────────────────────────

  // Shared application of a QuickTile to activeState. Reused by the
  // SpeedDialGrid click handler (via a label lookup) and the keyboard
  // router (which has the QuickTile directly).
  function applyTile(tile: QuickTile): void {
    if (tile.type === "sub-product" && tile.subProductName) {
      const matching = products.find((p) => p.subProduct === tile.subProductName);
      if (!matching) {
        console.warn(`[place-order-page] tile sub-product not in catalog: ${tile.subProductName}`);
        return;
      }
      setActiveState({
        kind:              "sub-product",
        subProductName:    tile.subProductName,
        family:            matching.family,
        speedDialPosition: tile.position,
      });
      setFocusHint(null);
    } else if (tile.type === "family" && tile.familyName) {
      const familyProducts  = products.filter((p) => p.family === tile.familyName);
      const firstSubProduct = familyProducts[0]?.subProduct ?? "";
      setActiveState({
        kind:              "family",
        familyName:        tile.familyName,
        activeSubProduct:  firstSubProduct,
        speedDialPosition: tile.position,
      });
      setFocusHint(null);
    } else if (tile.type === "section" && tile.sectionName) {
      setActiveState({
        kind:              "section",
        sectionName:       tile.sectionName,
        drilled:           null,
        speedDialPosition: tile.position,
      });
      setFocusHint(null);
    }
  }

  function handleTileClick(item: SpeedDialItem): void {
    const original = quickTiles.find((t) => t.label === item.label);
    if (original) applyTile(original);
  }

  function handleSearchSelect(result: SearchResult): void {
    if (result.type === "family") {
      const familyProducts = products.filter((p) => p.family === result.family);
      const firstSubProduct = familyProducts[0]?.subProduct ?? "";
      setActiveState({
        kind:             "family",
        familyName:       result.family,
        activeSubProduct: firstSubProduct,
      });
      setFocusHint(null);
    } else if (result.type === "sub-product-base") {
      // Operator was specific about colour — open the sub-product panel
      // and aim the cell-focus hint at the matched base row.
      setActiveState({
        kind:           "sub-product",
        subProductName: result.subProductName,
        family:         result.family,
      });
      setFocusHint({ base: result.baseColour });
    } else {
      // sub-product result: locate in catalog to get family + first base.
      const matching = products.find((p) => p.subProduct === result.subProductName);
      if (!matching) {
        console.warn(`[place-order-page] search sub-product not in catalog: ${result.subProductName}`);
        return;
      }
      setActiveState({
        kind:           "sub-product",
        subProductName: result.subProductName,
        family:         matching.family,
      });
      const subProductRows = products.filter((p) => p.subProduct === result.subProductName);
      const firstBase      = subProductRows[0]?.baseColour ?? "";
      setFocusHint({ base: firstBase });
    }
    setSearchQuery("");
  }

  function handleClosePanel(): void {
    setActiveState({ kind: "idle" });
    setFocusHint(null);
    searchInputRef.current?.focus();
  }

  const handleEscapeFromCell = useCallback((): void => {
    // Esc-from-cell = "done with this product, ready for next." Close
    // the active panel + clear the focus hint, then park focus on
    // <main> so digit / `/` / `?` shortcuts route immediately. The
    // previously-active speed-dial tile de-highlights as a side effect
    // (activeTileId derivation finds no match in idle state).
    setFocusHint(null);
    setActiveState({ kind: "idle" });
    pageBodyRef.current?.focus();
  }, []);

  function handleSubProductChange(name: string): void {
    setActiveState((prev) => {
      if (prev.kind === "family") {
        return { ...prev, activeSubProduct: name };
      }
      if (prev.kind === "section" && prev.drilled) {
        return { ...prev, drilled: { ...prev.drilled, activeSubProduct: name } };
      }
      return prev;
    });
  }

  function handleDrillTo(familyName: string, firstSubProduct: string): void {
    setActiveState((prev) => {
      if (prev.kind !== "section") return prev;
      return { ...prev, drilled: { familyName, activeSubProduct: firstSubProduct } };
    });
  }

  function handleDrillBack(): void {
    setActiveState((prev) => {
      if (prev.kind !== "section") return prev;
      return { ...prev, drilled: null };
    });
  }

  function handleRepeatOrder(entries: RepeatOrderEntry[]): void {
    for (const entry of entries) {
      const matching = products.find(
        (p) => p.subProduct === entry.productName
            && (p.baseColour ?? null) === (entry.baseColour ?? null),
      );
      if (!matching) {
        console.warn(`[place-order-page] repeat-order entry not in catalog: ${entry.productName} / ${entry.baseColour ?? "null"}`);
        continue;
      }
      setQty(matching, entry.packCode, entry.units);
    }
  }

  function handleRecentlyUsedClick(item: { subProduct: string; family: string }): void {
    setActiveState({
      kind:           "sub-product",
      subProductName: item.subProduct,
      family:         item.family,
    });
    setFocusHint(null);
  }

  function handleBrowseFamilyClick(familyName: string): void {
    const familyProducts  = products.filter((p) => p.family === familyName);
    const firstSubProduct = familyProducts[0]?.subProduct ?? "";
    setActiveState({
      kind:             "family",
      familyName,
      activeSubProduct: firstSubProduct,
    });
    setFocusHint(null);
  }

  // ── Email build + send ─────────────────────────────────────────────────

  const emailOutput = useMemo(() => {
    return buildEmail({
      customer: selectedCustomer,
      bills:    bills.map((b) => b.lines.map((l) => ({
        subProduct: l.subProduct,
        baseColour: l.baseColour,
        packQtys:   l.packQtys,
      }))),
      shipTo,
      dispatch,
      marker,
    });
  }, [selectedCustomer, bills, shipTo, dispatch, marker]);

  const canSend = emailOutput.valid;

  const onConfirmSend = useCallback((): void => {
    if (!canSend) return;
    setConfirmOpen(true);
  }, [canSend]);

  const handleSend = useCallback((): void => {
    if (!canSend) return;
    const url = buildMailtoUrl(emailOutput.subject, emailOutput.body);
    window.location.href = url;
    setConfirmOpen(false);
    if (selectedCustomer) clearDraft(selectedCustomer.code);
    resetCart();
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 3000);
  }, [canSend, emailOutput.subject, emailOutput.body, selectedCustomer]);

  const onShowHelp   = useCallback((): void => { setHelpOpen(true); }, []);
  const onToggleHelp = useCallback((): void => { setHelpOpen((h) => !h); }, []);

  // ── Single-source digit dispatch ───────────────────────────────────────
  // Both the window-level keyboard hook AND the BigSearchBar empty-query
  // interceptor call into this. Keeps the routing logic from diverging
  // between the two entry points.

  function handleDigit(digit: number): void {
    const route = routeDigit(digit, activeState, products, quickTiles);
    if (route.action === "tile") {
      applyTile(route.tile);
    }
    // noop otherwise — digit out of range
  }

  // ── Global keyboard router ─────────────────────────────────────────────
  // Disabled while either modal is open; those overlays own the keyboard.

  useKeyboardRouting({
    activeState,
    onDigit:       handleDigit,
    onClosePanel:  handleClosePanel,
    onFocusSearch: () => searchInputRef.current?.focus(),
    onToggleHelp,
    enabled:       !confirmOpen && !helpOpen && !!selectedCustomer,
  });

  // ── Derived view state (no useMemo — bounded N, render-time fine) ──────

  const tileItems: SpeedDialItem[] = quickTiles.map((t) => ({
    position:    t.position,
    label:       t.label,
    parentLabel: t.parentLabel,
    type:        t.type,
  }));

  let activeTileId: string | null = null;
  for (const tile of quickTiles) {
    if (activeState.kind === "sub-product"
        && tile.type === "sub-product"
        && tile.subProductName === activeState.subProductName) {
      activeTileId = tile.label;
      break;
    }
    if (activeState.kind === "family"
        && tile.type === "family"
        && tile.familyName === activeState.familyName) {
      activeTileId = tile.label;
      break;
    }
    if (activeState.kind === "section"
        && tile.type === "section"
        && tile.sectionName === activeState.sectionName) {
      activeTileId = tile.label;
      break;
    }
  }

  const cartItemLabels = new Set<string>();
  for (const tile of quickTiles) {
    let hasLines = false;
    if (tile.type === "sub-product" && tile.subProductName) {
      hasLines = activeCartLines.some((l) => l.subProduct === tile.subProductName);
    } else if (tile.type === "family" && tile.familyName) {
      hasLines = activeCartLines.some((l) => l.family === tile.familyName);
    } else if (tile.type === "section" && tile.sectionName) {
      const familiesInSection = new Set(
        products.filter((p) => p.section === tile.sectionName).map((p) => p.family),
      );
      hasLines = activeCartLines.some((l) => familiesInSection.has(l.family));
    }
    if (hasLines) cartItemLabels.add(tile.label);
  }

  const recentlyUsedItems: RecentlyUsedItem[] = (() => {
    const map = new Map<string, RecentlyUsedItem>();
    for (const line of activeCartLines) {
      const k = `${line.family}|||${line.subProduct}`;
      const t = line.touchedAt ?? 0;
      const existing = map.get(k);
      if (existing) {
        existing.cartLineCount += 1;
        existing.lastTouchedAt = Math.max(existing.lastTouchedAt, t);
      } else {
        map.set(k, {
          family:        line.family,
          subProduct:    line.subProduct,
          cartLineCount: 1,
          lastTouchedAt: t,
        });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.lastTouchedAt - a.lastTouchedAt)
      .slice(0, 5);
  })();

  return (
    <>
      <header className="bg-white border-b border-gray-200 h-[52px] flex items-center px-4 gap-3 sticky top-0 z-30">
        <div className="w-[28px] h-[28px] rounded-md bg-teal-600 flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 22 22" className="w-[16px] h-[16px]" fill="none">
            <circle cx="11" cy="11" r="7" stroke="white" strokeWidth="1.4" />
            <circle cx="11" cy="11" r="2.2" fill="white" />
            <circle cx="18" cy="11" r="2" fill="white" />
          </svg>
        </div>
        <span className="text-[14px] font-semibold text-gray-900">Purchase Order (PO)</span>
        {/* min-w-0 lets the pill's `truncate` actually clip; NO overflow-hidden here — that would clip the absolute-positioned dropdown when typing a customer query. */}
        <div className="flex-1 max-w-[420px] mx-4 min-w-0">
          <CustomerSearch
            customers={customers}
            selected={selectedCustomer}
            onSelect={handleSelectCustomer}
            onClear={handleClearCustomer}
            autoFocusOnMount={!dataLoading}
          />
        </div>
        <div className="flex-1" />
        {selectedCustomer && (
          <button
            type="button"
            onClick={onShowHelp}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
            className="text-[11px] text-gray-400 hover:text-gray-700 px-2 py-1 rounded inline-flex items-center gap-1.5 hover:bg-gray-50"
          >
            <span className="font-mono bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 text-[10px]">?</span>
            shortcuts
          </button>
        )}
      </header>

      <main
        ref={pageBodyRef}
        tabIndex={-1}
        className="flex h-[calc(100vh-52px)] focus:outline-none"
      >
        <section className="flex-1 bg-gray-50 overflow-hidden">
          <div className="max-w-[920px] mx-auto p-3">
            {dataLoading ? (
              <p className="text-[13px] text-gray-400 text-center py-12">Loading customers and products…</p>
            ) : !selectedCustomer ? (
              <div className="text-center py-12">
                <p className="text-[13px] text-gray-500">
                  Type a customer name (e.g. <span className="font-mono">Mehta</span>) or SAP code (e.g. <span className="font-mono">12389</span>) above to begin.
                </p>
                <p className="text-[11px] text-gray-400 mt-2 font-mono">
                  {customers.length} customers loaded
                </p>
              </div>
            ) : (
              <>
                <BigSearchBar
                  ref={searchInputRef}
                  query={searchQuery}
                  onQueryChange={setSearchQuery}
                  onResultSelect={handleSearchSelect}
                  products={products}
                />
                <SpeedDialGrid
                  tiles={tileItems}
                  activeTileId={activeTileId}
                  cartItemLabels={cartItemLabels}
                  onTileClick={handleTileClick}
                  headerSubtitle={`${quickTiles.length} most-ordered families`}
                  compact={activeState.kind !== "idle"}
                />
                <ActiveProductPanel
                  state={activeState}
                  productsAll={products}
                  cartLines={activeCartLines}
                  qtyAt={qtyAt}
                  onSetQty={setQty}
                  onClose={handleClosePanel}
                  onEscape={handleEscapeFromCell}
                  onSubProductChange={handleSubProductChange}
                  onDrillTo={handleDrillTo}
                  onDrillBack={handleDrillBack}
                  focusHintBase={focusHint?.base ?? null}
                  onFocused={() => setFocusHint(null)}
                />
                {activeState.kind === "idle" && (
                  <>
                    <RecentlyUsed
                      items={recentlyUsedItems}
                      onItemClick={handleRecentlyUsedClick}
                    />
                    <LastOrderRecall
                      customerCode={selectedCustomer.code}
                      customerName={selectedCustomer.name}
                      onRepeatOrder={handleRepeatOrder}
                    />
                  </>
                )}
                <BrowseAllFamilies
                  productsAll={products}
                  onFamilyClick={handleBrowseFamilyClick}
                />
              </>
            )}
          </div>
        </section>

        <CartPanel
          customer={selectedCustomer}
          bills={bills}
          activeBillId={activeBillId}
          justAddedKeys={justAddedKeys}
          shipTo={shipTo}
          dispatch={dispatch}
          marker={marker}
          onSetActiveBill={setActiveBillId}
          onAddBill={addBill}
          onShipToChange={setShipTo}
          onDispatchChange={setDispatch}
          onMarkerChange={setMarker}
          onRemovePack={handleRemovePack}
          onConfirmSend={onConfirmSend}
          canSend={canSend}
          sendButtonRef={sendButtonRef}
        />
      </main>

      {confirmOpen && (
        <SendConfirmOverlay
          subject={emailOutput.subject}
          body={emailOutput.body}
          onSend={handleSend}
          onCancel={() => setConfirmOpen(false)}
        />
      )}

      {helpOpen && (
        <KeyboardHelpOverlay onClose={() => setHelpOpen(false)} />
      )}

      {toastVisible && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-40 bg-gray-900 text-white text-[12px] px-4 py-2.5 rounded-[8px] shadow-lg"
        >
          Email opened in your mail client
        </div>
      )}
    </>
  );
}
