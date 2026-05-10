"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CustomerSearch from "./components/customer-search";
import CategoryGrid from "./components/category-grid";
import ExpandedPanel from "./components/expanded-panel";
import ProductSearch, { type ProductSearchHandle } from "./components/product-search";
import CartPanel from "./components/cart-panel";
import SendConfirmOverlay from "./components/send-confirm-overlay";
import KeyboardHelpOverlay from "./components/keyboard-help-overlay";
import { useKeyboardRouting } from "./hooks/use-keyboard-routing";
import type { Bill, CartLine, Customer, Product } from "./types";
import { buildEmail, buildMailtoUrl, type EmailDispatch, type EmailMarker } from "@/lib/place-order/email";
import { clearDraft, loadDraft, saveDraft, type DraftSnapshot } from "@/lib/place-order/draft-storage";

// /place-order — desktop phone-order entry surface for depot operators.
//
// Phase 7 lands the final feature set on top of the Phase 1-6 page:
//   - Multi-bill: bills[] + activeBillId; b cycles, Shift+B adds new
//   - localStorage drafts: per-customer, 24h TTL, autosave on change +
//     beforeunload, restore on customer-select
//   - Customer-switch flow: explicit save-old + load-new + reset semantics
//     (avoids state-batching races between save and load effects)
//   - < 1024px viewport guard: redirect to mobile /order
//   - Keyboard help overlay (?)

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

  const [expandedFamily, setExpandedFamily] = useState<string | null>(null);
  const [activeSubProductByFamily, setActiveSubProductByFamily] = useState<Record<string, string>>({});

  // Cart (multi-bill).
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

  // Search state.
  const [searchQuery,   setSearchQuery]   = useState("");
  const [focusHintBase, setFocusHintBase] = useState<string | null>(null);

  const productSearchRef = useRef<ProductSearchHandle | null>(null);

  // Mount data fetch.
  useEffect(() => {
    fetch("/api/place-order/data")
      .then((r) => r.json())
      .then((data: { customers?: Customer[]; products?: Product[] }) => {
        setCustomers(data.customers ?? []);
        setProducts(data.products ?? []);
      })
      .catch(() => { /* silent */ })
      .finally(() => setDataLoading(false));
  }, []);

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

  const productsByFamily = useMemo<Record<string, Product[]>>(() => {
    const map: Record<string, Product[]> = {};
    for (const p of products) {
      if (!map[p.family]) map[p.family] = [];
      map[p.family].push(p);
    }
    return map;
  }, [products]);

  const sortedFamilies = useMemo<string[]>(() => {
    const totals = new Map<string, number>();
    for (const p of products) {
      totals.set(p.family, (totals.get(p.family) ?? 0) + p.packs.length);
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([family]) => family);
  }, [products]);

  // Active bill convenience.
  const activeBill = useMemo<Bill | undefined>(
    () => bills.find((b) => b.id === activeBillId),
    [bills, activeBillId],
  );

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
    const k = lineKey(product.subProduct, product.baseColour ?? null);
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
          lines: bill.lines.map((l, i) => i === idx ? { ...l, packQtys: nextPackQtys } : l),
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
        };
        return { ...bill, lines: [...bill.lines, newLine] };
      }
      return {
        ...bill,
        lines: bill.lines.map((l, i) =>
          i === idx ? { ...l, packQtys: { ...l.packQtys, [pack]: qty } } : l,
        ),
      };
    }));
  }

  function removeLine(billId: number, subProduct: string, baseColour: string | null): void {
    const k = lineKey(subProduct, baseColour);
    setBills((prev) => prev.map((bill) => {
      if (bill.id !== billId) return bill;
      return { ...bill, lines: bill.lines.filter((l) => lineKey(l.subProduct, l.baseColour) !== k) };
    }));
  }

  // ── Multi-bill ─────────────────────────────────────────────────────────

  // Multi-bill is mouse-only — invoked from the cart panel's [+ Add] tab
  // (Phase 7 keyboard removal: b / Shift+B retired, see use-keyboard-routing).
  const addBill = useCallback((): void => {
    setBillCounter((prev) => {
      const id = prev + 1;
      setBills((prevBills) => [...prevBills, { id, lines: [] }]);
      setActiveBillId(id);
      // New bill is empty → close any expanded panel so the next action
      // shows fresh focus on the new bill's empty cart.
      setExpandedFamily(null);
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
    setExpandedFamily(null);
  }

  function resetCart(): void {
    setBills(FRESH_BILLS);
    setActiveBillId(1);
    setBillCounter(1);
    setShipTo("");
    setDispatch("Normal");
    setMarker(null);
    setJustAddedKeys({});
    setExpandedFamily(null);
  }

  function currentSnapshot(): DraftSnapshot {
    return { bills, activeBillId, billCounter, shipTo, dispatch, marker };
  }

  function handleSelectCustomer(next: Customer): void {
    // Save current customer's state before switching (planning doc §5.2:
    // "selecting a different customer when cart has items → silent auto-save
    // current cart as draft, switch context").
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

  // beforeunload save — single-attach via latest-state ref so the effect
  // doesn't re-attach on every keystroke.
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

  // ── Category panel handlers ────────────────────────────────────────────

  const openCategory = useCallback((family: string): void => {
    setExpandedFamily(family);
    setActiveSubProductByFamily((prev) => {
      if (prev[family]) return prev;
      const list  = productsByFamily[family] ?? [];
      const first = list[0]?.subProduct;
      if (!first) return prev;
      return { ...prev, [family]: first };
    });
  }, [productsByFamily]);

  const closeCategory = useCallback((): void => {
    setExpandedFamily(null);
    setFocusHintBase(null);
  }, []);

  function setActiveSubProduct(family: string, subProduct: string): void {
    setActiveSubProductByFamily((prev) => ({ ...prev, [family]: subProduct }));
  }

  function onSelectProductFromSearch(product: Product): void {
    setActiveSubProductByFamily((prev) => ({ ...prev, [product.family]: product.subProduct }));
    setExpandedFamily(product.family);
    setFocusHintBase(product.baseColour ?? "");
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
    // Clear the local draft for this customer — the email is now the
    // record of truth (planning doc §4 step 1).
    if (selectedCustomer) clearDraft(selectedCustomer.code);
    // Reset cart; keep customer for follow-up orders.
    resetCart();
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 3000);
  }, [canSend, emailOutput.subject, emailOutput.body, selectedCustomer]);

  const onSearchPrefill = useCallback((firstChar: string): void => {
    setSearchQuery(firstChar);
  }, []);

  const onShowHelp = useCallback((): void => {
    setHelpOpen(true);
  }, []);

  useKeyboardRouting({
    sortedFamilies,
    expandedFamily,
    confirmOpen,
    helpOpen,
    onOpenCategory:  openCategory,
    onCloseCategory: closeCategory,
    onSearchPrefill,
    onConfirmSend,
    onShowHelp,
    searchInputRef:  productSearchRef,
  });

  return (
    <>
      <div className="sticky top-0 z-30 h-[56px] bg-white border-b border-gray-200 flex items-center px-6 gap-4">
        <div className="w-8 h-8 bg-teal-600 rounded-[8px] flex items-center justify-center flex-shrink-0">
          <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="7" stroke="white" strokeWidth="1.6" />
            <circle cx="11" cy="11" r="2.2" fill="white" />
            <circle cx="18" cy="11" r="2" fill="white" />
          </svg>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-[14px] font-semibold text-gray-900">Place Order</span>
          <span className="text-[11px] text-gray-400">JSW Dulux · Surat Depot</span>
        </div>
        <CustomerSearch
          customers={customers}
          selected={selectedCustomer}
          onSelect={handleSelectCustomer}
          onClear={handleClearCustomer}
          autoFocusOnMount={!dataLoading}
        />
        {selectedCustomer && (
          <button
            type="button"
            onClick={onShowHelp}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
            className="ml-auto text-[11px] text-gray-400 hover:text-gray-700 px-2 py-1 rounded inline-flex items-center gap-1.5 hover:bg-gray-50"
          >
            <span className="font-mono bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 text-[10px]">?</span>
            shortcuts
          </button>
        )}
      </div>

      <div className="grid grid-cols-[1fr_360px] min-h-[calc(100vh-56px)]">
        <div className="px-6 py-[18px] pb-10 min-w-0">
          {dataLoading ? (
            <p className="text-[13px] text-gray-400 text-center py-12">Loading customers and products…</p>
          ) : selectedCustomer ? (
            <>
              <ProductSearch
                ref={productSearchRef}
                products={products}
                query={searchQuery}
                onQueryChange={setSearchQuery}
                onSelectProduct={onSelectProductFromSearch}
              />

              <div className="flex items-center justify-between mb-[10px] pl-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                  Categories
                </span>
                <span className="text-[11px] text-gray-400">
                  <span className="inline-block bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 font-mono text-[10px] text-gray-500">1</span>
                  <span className="inline-block bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 font-mono text-[10px] text-gray-500 ml-0.5">9</span>
                  <span className="ml-2">jump · letters → search · / send · ? help</span>
                </span>
              </div>
              <CategoryGrid
                products={products}
                onCategoryClick={openCategory}
                expandedFamily={expandedFamily}
                renderExpanded={(family, imageSlug, imageFailed) => {
                  const familyProducts  = productsByFamily[family] ?? [];
                  const activeSubProduct =
                    activeSubProductByFamily[family]
                    ?? familyProducts[0]?.subProduct
                    ?? "";
                  if (!activeSubProduct) return null;
                  return (
                    <ExpandedPanel
                      family={family}
                      imageSlug={imageSlug}
                      imageFailed={imageFailed}
                      products={familyProducts}
                      activeSubProduct={activeSubProduct}
                      onSubProductChange={(sp) => setActiveSubProduct(family, sp)}
                      qtyAt={qtyAt}
                      onSetQty={setQty}
                      onClose={closeCategory}
                      focusHintBase={focusHintBase}
                      onFocused={() => setFocusHintBase(null)}
                    />
                  );
                }}
              />
            </>
          ) : (
            <div className="text-center py-12">
              <p className="text-[13px] text-gray-500">
                Type a customer name (e.g. <span className="font-mono">Mehta</span>) or SAP code (e.g. <span className="font-mono">12389</span>) above to begin.
              </p>
              <p className="text-[11px] text-gray-400 mt-2 font-mono">
                {customers.length} customers loaded
              </p>
            </div>
          )}
        </div>

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
          onRemoveLine={removeLine}
          onConfirmSend={onConfirmSend}
          canSend={canSend}
        />
      </div>

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
