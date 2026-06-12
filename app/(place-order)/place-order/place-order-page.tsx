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
import RecentCustomers from "./components/recent-customers";
import { addRecent } from "@/lib/place-order/recents";
import type { Bill, CartLine, Customer, Product } from "./types";
import type { RawPack } from "@/lib/place-order/pack-buckets";
import { packKey, parsePackKey } from "@/lib/place-order/pack";
import { buildEmail, buildMailtoUrl, type EmailCallTarget, type EmailDispatch, type EmailMarker } from "@/lib/place-order/email";
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

// Cart-line identity (Phase 3 cutover, 2026-05-13). Catalog row id
// is the dedup key — survives Phase 4 when subProduct is dropped.
// Legacy drafts saved before Phase 3 stored no productId; matching
// falls back to (subProduct, baseColour) via cartLineMatches below.
function lineKey(productId: number): string {
  return `id:${productId}`;
}
function billLineKey(billId: number, productId: number): string {
  return `${billId}|||${lineKey(productId)}`;
}
function cartLineMatches(line: CartLine, product: Product): boolean {
  if (line.productId !== undefined) return line.productId === product.id;
  // Legacy fallback for pre-Phase-3 localStorage drafts. For filled
  // families with multiple rows sharing (subProduct, baseColour),
  // this can match the wrong row — an acceptable transitional
  // state since (a) the user re-touches the cell and the new line
  // gets productId, (b) the alternative is orphaning every draft.
  return line.subProduct === product.subProduct
      && (line.baseColour ?? null) === (product.baseColour ?? null);
}

const JUST_ADDED_FLASH_MS  = 1200;
const MOBILE_BREAKPOINT_PX = 1024;

const FRESH_BILLS: Bill[] = [{ id: 1, lines: [] }];

// Re-assign bill ids so id === index+1 after every mutation (add/delete/
// duplicate). buildEmail numbers non-empty bills by POSITION, not id (see
// lib/place-order/email.ts), so renumbering never changes the email for an
// unchanged cart — it only keeps the Bill-N tab labels gap-free.
function renumberBills(bills: Bill[]): Bill[] {
  return bills.map((b, i) => ({ ...b, id: i + 1 }));
}

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
  // Top-bar customer-search query (lifted from CustomerSearch) — gates the
  // landing recent-dealers grid so it hides while the operator is typing.
  const [customerQuery, setCustomerQuery] = useState<string>("");

  // Cart (multi-bill — preserved from v1-v3 build).
  const [bills, setBills]                 = useState<Bill[]>(FRESH_BILLS);
  const [activeBillId, setActiveBillId]   = useState<number>(1);
  const [billCounter, setBillCounter]     = useState<number>(1);
  const [justAddedKeys, setJustAddedKeys] = useState<Record<string, true>>({});

  // Order-level fields.
  const [shipTo,     setShipTo]     = useState<string>("");
  const [dispatch,   setDispatch]   = useState<EmailDispatch>("Normal");
  const [callTarget, setCallTarget] = useState<EmailCallTarget>(null);
  const [marker,     setMarker]     = useState<EmailMarker>(null);
  const [crossDepot, setCrossDepot] = useState<string | null>(null);
  const [notes,      setNotes]      = useState<string>("");

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

  function flashLine(billId: number, productId: number): void {
    const k = billLineKey(billId, productId);
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

  function qtyAt(product: Product, pack: RawPack): number {
    if (!activeBill) return 0;
    const line = activeBill.lines.find((l) => cartLineMatches(l, product));
    if (!line) return 0;
    // Phase 3.5 (2026-05-13): composite key first, then legacy bare
    // packCode fallback so pre-cutover localStorage drafts still read.
    // Once the user edits the cell, setQty migrates the key forward.
    const composite = packKey(pack.packCode, pack.unit);
    if (line.packQtys[composite] !== undefined) return line.packQtys[composite];
    return line.packQtys[pack.packCode] ?? 0;
  }

  function setQty(product: Product, pack: RawPack, qty: number): void {
    const composite = packKey(pack.packCode, pack.unit);
    const legacyBare = pack.packCode;
    const now = Date.now();
    setBills((prev) => prev.map((bill) => {
      if (bill.id !== activeBillId) return bill;
      const idx = bill.lines.findIndex((l) => cartLineMatches(l, product));
      if (qty <= 0) {
        if (idx < 0) return bill;
        const line = bill.lines[idx];
        // Delete both the composite key and the legacy bare key —
        // covers carts that hold both forms during the migration
        // window (a user edited some packs but not others).
        const nextPackQtys = { ...line.packQtys };
        delete nextPackQtys[composite];
        if (composite !== legacyBare) delete nextPackQtys[legacyBare];
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
        flashLine(bill.id, product.id);
        const newLine: CartLine = {
          // Phase 3 cart-line identity: productId is the primary
          // dedup key. subProduct/baseColour/product/uiGroup are
          // carried for email + cart display + legacy-draft fallback.
          productId:   product.id,
          family:      product.family,
          subProduct:  product.subProduct,
          product:     product.product ?? null,
          uiGroup:     product.uiGroup ?? null,
          displayName: product.displayName,
          baseColour:  product.baseColour ?? null,
          packQtys:    { [composite]: qty },
          touchedAt:   now,
        };
        return { ...bill, lines: [...bill.lines, newLine] };
      }
      // Existing line — write composite key and migrate any legacy
      // bare key off the same line so the cart doesn't carry both.
      return {
        ...bill,
        lines: bill.lines.map((l, i) => {
          if (i !== idx) return l;
          const next = { ...l.packQtys, [composite]: qty };
          if (composite !== legacyBare) delete next[legacyBare];
          return { ...l, packQtys: next, touchedAt: now };
        }),
      };
    }));
  }

  function handleRemovePack(productId: number | undefined, subProduct: string, baseColour: string | null, packKeyStr: string): void {
    // Prefer id lookup so filled families where multiple rows share
    // (subProduct, baseColour) resolve to the exact row the user
    // clicked. Legacy drafts (no productId) fall back to the old
    // (subProduct, baseColour) match.
    const matching = productId !== undefined
      ? products.find((p) => p.id === productId)
      : products.find(
          (p) => p.subProduct === subProduct && (p.baseColour ?? null) === baseColour,
        );
    if (!matching) {
      console.warn(`[place-order-page] remove pack: product not in catalog: id=${productId ?? "?"} ${subProduct} / ${baseColour ?? "null"}`);
      return;
    }
    // packKeyStr may be a composite "5|KG" or a legacy bare "5".
    // parsePackKey handles both and returns the right RawPack.
    setQty(matching, parsePackKey(packKeyStr), 0);
  }

  // ── Multi-bill ─────────────────────────────────────────────────────────

  // All three mutations renumber to id === index+1 and leave activeBillId
  // pointing at a real bill. Reachable from the single-bill state — the cart
  // bill-bar now always renders when a customer is selected.
  function addBill(): void {
    const next = renumberBills([...bills, { id: bills.length + 1, lines: [] }]);
    setBills(next);
    setBillCounter(next.length);
    setActiveBillId(next.length);                 // new bill is last → id = length
    setActiveState({ kind: "idle" });
    setFocusHint(null);
  }

  function duplicateBill(billId: number): void {
    const idx = bills.findIndex((b) => b.id === billId);
    if (idx < 0) return;
    // Deep copy: brand-new line objects AND new packQtys maps so the copy
    // shares NO references with the source (CORE §3 — editing one must never
    // mutate the other).
    const copiedLines: CartLine[] = bills[idx].lines.map((l) => ({
      ...l,
      packQtys: { ...l.packQtys },
    }));
    const next = renumberBills([
      ...bills.slice(0, idx + 1),
      { id: 0, lines: copiedLines },              // id fixed by renumber
      ...bills.slice(idx + 1),
    ]);
    setBills(next);
    setBillCounter(next.length);
    setActiveBillId(idx + 2);                      // copy sits at index idx+1 → id idx+2
    setActiveState({ kind: "idle" });
    setFocusHint(null);
  }

  function deleteBill(billId: number): void {
    if (bills.length <= 1) return;                // never delete the last bill
    const idx = bills.findIndex((b) => b.id === billId);
    if (idx < 0) return;
    const next = renumberBills(bills.filter((_, i) => i !== idx));
    // Repoint active: the previous bill if any, else the first remaining.
    const nextActiveId = next[Math.max(0, idx - 1)]?.id ?? 1;
    setBills(next);
    setBillCounter(next.length);
    setActiveBillId(nextActiveId);
    setActiveState({ kind: "idle" });
    setFocusHint(null);
  }

  // ── Customer / draft persistence ───────────────────────────────────────

  function applyDraft(snap: DraftSnapshot): void {
    // Renumber on restore (idempotent for already-1..n drafts) and clamp the
    // active id so a draft can never rehydrate a dangling activeBillId.
    const restored = renumberBills(snap.bills.length > 0 ? snap.bills : FRESH_BILLS);
    const activeId = restored.some((b) => b.id === snap.activeBillId)
      ? snap.activeBillId
      : (restored[0]?.id ?? 1);
    setBills(restored);
    setActiveBillId(activeId);
    setBillCounter(restored.length);
    setShipTo(snap.shipTo);
    // Coerce any stale stored dispatch (e.g. the removed "Hold") to a valid value.
    setDispatch(snap.dispatch === "Urgent" || snap.dispatch === "Call" ? snap.dispatch : "Normal");
    setCallTarget(snap.callTarget);
    setMarker(snap.marker);
    setCrossDepot(snap.crossDepot);
    setNotes(snap.notes);
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
    setCallTarget(null);
    setMarker(null);
    setCrossDepot(null);
    setNotes("");
    setJustAddedKeys({});
    setActiveState({ kind: "idle" });
    setFocusHint(null);
  }

  function currentSnapshot(): DraftSnapshot {
    return { bills, activeBillId, billCounter, shipTo, dispatch, callTarget, marker, crossDepot, notes };
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
    saveDraft(selectedCustomer, { bills, activeBillId, billCounter, shipTo, dispatch, callTarget, marker, crossDepot, notes });
  }, [selectedCustomer, bills, activeBillId, billCounter, shipTo, dispatch, callTarget, marker, crossDepot, notes]);

  // beforeunload — single-attach via latest-state ref.
  const stateRef = useRef({ selectedCustomer, bills, activeBillId, billCounter, shipTo, dispatch, callTarget, marker, crossDepot, notes });
  useEffect(() => {
    stateRef.current = { selectedCustomer, bills, activeBillId, billCounter, shipTo, dispatch, callTarget, marker, crossDepot, notes };
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
          callTarget:   s.callTarget,
          marker:       s.marker,
          crossDepot:   s.crossDepot,
          notes:        s.notes,
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
      // Single family → [familyName]; multi-family group tile (e.g. Primer +
      // Distemper) → tile.familyNames, filtered in list ORDER so the first
      // family's tabs lead. Phase 3 (2026-05-13): default tab is the first
      // row's uiGroup when present, else its subProduct (unmigrated families).
      const families        = tile.familyNames ?? [tile.familyName];
      const familyProducts  = families.flatMap((f) => products.filter((p) => p.family === f));
      const firstSubProduct = familyProducts[0]
        ? familyProducts[0].uiGroup ?? familyProducts[0].subProduct
        : "";
      setActiveState({
        kind:              "family",
        familyName:        tile.familyName,
        familyNames:       tile.familyNames,
        headerLabel:       tile.familyNames ? tile.label : undefined,
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
      // Search results are always single-family (the group is a tile-only
      // concept) — use the same set shape for uniformity. familyNames stays
      // undefined → header "{familyName} family", behaviour unchanged.
      const families        = [result.family];
      const familyProducts  = families.flatMap((f) => products.filter((p) => p.family === f));
      const firstSubProduct = familyProducts[0]
        ? familyProducts[0].uiGroup ?? familyProducts[0].subProduct
        : "";
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
      // Phase 3.5 (2026-05-13): RepeatOrderEntry only carries packCode
      // (the recall payload is unit-blind). Look up the catalog row's
      // pack with this packCode to inherit its unit — that way the
      // qty lands on the right composite key. If the catalog has
      // multiple packs sharing the packCode but differing in unit
      // (rare), the first wins; acceptable for a repeat-order shortcut.
      const catalogPack = matching.packs.find((p) => p.packCode === entry.packCode);
      const pack = catalogPack ?? { packCode: entry.packCode, unit: null };
      setQty(matching, pack, entry.units);
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
    // Browse-all is single-family — same set shape for uniformity (familyNames
    // undefined → header "{familyName} family", behaviour unchanged).
    const families        = [familyName];
    const familyProducts  = families.flatMap((f) => products.filter((p) => p.family === f));
    const firstSubProduct = familyProducts[0]
      ? familyProducts[0].uiGroup ?? familyProducts[0].subProduct
      : "";
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
        // Phase 3 (2026-05-13): pass real product name through so the
        // email body shows e.g. "GLOSS BRILLIANT WHITE 1L*1" instead
        // of the bucket subProduct. Null for unmigrated families.
        product:    l.product ?? null,
        baseColour: l.baseColour,
        packQtys:   l.packQtys,
      }))),
      shipTo,
      dispatch,
      callTarget,
      marker,
      crossDepot,
      notes,
    });
  }, [selectedCustomer, bills, shipTo, dispatch, callTarget, marker, crossDepot, notes]);

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
    if (selectedCustomer) {
      clearDraft(selectedCustomer.code);
      // Device-local recents shortcut (best-effort; never blocks Send, never
      // touches the mailto body). Save AFTER the order is sent.
      addRecent(selectedCustomer);
    }
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
      const families = tile.familyNames ?? [tile.familyName];
      hasLines = activeCartLines.some((l) => families.includes(l.family));
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

  // Empty-landing hint (no customer). Shown as-is when there are no recents or
  // while the operator is typing a customer query; replaced by the recent-
  // dealers grid otherwise.
  const landingHint = (
    <div className="text-center py-12">
      <p className="text-[13px] text-gray-500">
        Type a customer name (e.g. <span className="font-mono">Mehta</span>) or SAP code (e.g. <span className="font-mono">12389</span>) above to begin.
      </p>
      <p className="text-[11px] text-gray-400 mt-2 font-mono">
        {customers.length} customers loaded
      </p>
    </div>
  );

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
            onQueryChange={setCustomerQuery}
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
        className="flex min-h-[calc(100vh-52px)] focus:outline-none"
      >
        <section className="flex-1 bg-gray-50">
          <div className="max-w-[920px] mx-auto p-3">
            {dataLoading ? (
              <p className="text-[13px] text-gray-400 text-center py-12">Loading customers and products…</p>
            ) : !selectedCustomer ? (
              customerQuery.trim() === "" ? (
                <RecentCustomers
                  customerCount={customers.length}
                  onSelect={handleSelectCustomer}
                  fallback={landingHint}
                />
              ) : (
                landingHint
              )
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
          customers={customers}
          shipTo={shipTo}
          dispatch={dispatch}
          callTarget={callTarget}
          marker={marker}
          crossDepot={crossDepot}
          notes={notes}
          onSetActiveBill={setActiveBillId}
          onAddBill={addBill}
          onDuplicateBill={duplicateBill}
          onDeleteBill={deleteBill}
          onShipToChange={setShipTo}
          onDispatchChange={setDispatch}
          onCallTargetChange={setCallTarget}
          onMarkerChange={setMarker}
          onCrossDepotChange={setCrossDepot}
          onNotesChange={setNotes}
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
