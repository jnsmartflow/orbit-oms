"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Search, Send } from "lucide-react";

// Public mobile order form for Sales Officers. Picker UI for customer
// and per-bill SKU/pack qty selection, builds a mailto: link to the
// depot's order inbox. Reachable at /order (whitelisted in middleware).
// Customer + SKU data fetched from /api/order/data on mount.

const ORDER_TO = "surat.order@outlook.com";

// ── SpeechRecognition types (not in default lib.dom.d.ts) ───────────────
// Minimal shape for the Web Speech API surface we use. Voice input feeds
// the per-bill product search (en-IN locale for Indian English paint
// product names). Browser support is a runtime check; on unsupported
// browsers the mic button is hidden entirely.

interface SpeechRecognitionEventLike {
  readonly results: ArrayLike<ArrayLike<{ readonly transcript: string }>>;
}
interface SpeechRecognitionInstance {
  lang:            string;
  continuous:      boolean;
  interimResults:  boolean;
  maxAlternatives: number;
  onresult:        ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror:         (() => void) | null;
  onend:           (() => void) | null;
  start():         void;
  stop():          void;
}
interface SpeechRecognitionCtor {
  new (): SpeechRecognitionInstance;
}
declare global {
  interface Window {
    SpeechRecognition?:       SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

// ── Types ────────────────────────────────────────────────────────────────

type Customer = { name: string; code: string };
type Product = {
  family:       string;
  subProduct:   string;          // catalog key
  baseColour:   string | null;   // null for PLAIN rows; named base/colour for variants
  displayName:  string;          // shown in suggestion + active-product UI
  searchTokens: string;          // pre-built lowercase token blob for filtering
  tinterType:   string | null;
  productType:  string;          // BASE_VARIANT | COLOUR | PLAIN; informational only
  packs:        string[];
};
type PackQty  = { pack: string; qty: number };
type BillLine = {
  displayName: string;           // shown in the added-lines list
  subProduct:  string;           // email-line product text (with baseColour appended when set)
  baseColour:  string | null;
  packs:       PackQty[];
};

// ── Pack label helpers ──────────────────────────────────────────────────
//
// packCode in mo_sku_lookup is a bare numeric string. Conventions:
// - Values ≥ 50  → millilitres (e.g. "50"   → "50ML",  "200"   → "200ML")
// - Values < 1   → also millilitres, decimalised litres (e.g. "0.5" → "500ML")
// - Values 1..40 → litres                              (e.g. "1"   → "1L",   "4" → "4L")
// Used for both display (pack counter rows, added-lines list) and email
// output. Sort by ML-equivalent so 50ML/100ML/200ML come before 1L.

function formatPack(pack: string): string {
  const num = parseFloat(pack);
  if (Number.isNaN(num)) return pack;
  if (num >= 50)         return `${num}ML`;
  if (num < 1)           return `${Math.round(num * 1000)}ML`;
  return `${num}L`;
}

function packToMl(pack: string): number {
  const num = parseFloat(pack);
  if (Number.isNaN(num)) return Number.MAX_SAFE_INTEGER;
  if (num >= 50)         return num;          // already millilitres
  return num * 1000;                          // litres or sub-1L decimals → ML
}

function sortPacksForDisplay(packs: string[]): string[] {
  return [...packs].sort((a, b) => packToMl(a) - packToMl(b));
}

// Step multiple per pack for the +/− stepper. Aligns increments with the
// natural ordering unit (carton/drum) so SO doesn't tap 12× to reach a
// 100ML carton. Manual entry is rounded down to the nearest multiple on
// blur. Anything not in this map (rare/odd packs) steps by 1.
const PACK_STEP: Record<string, number> = {
  "50ML":  12,
  "100ML": 12,
  "200ML": 12,
  "500ML": 12,
  "1L":    6,
  "4L":    4,
  "10L":   2,
  "20L":   1,
  "30L":   1,
  "40KG":  1,
};
function packStep(packLabel: string): number {
  return PACK_STEP[packLabel] ?? 1;
}

// After a toggle-and-advance (Enter on an unselected item), return the new
// highlightedIndex in the next render's coordinate system. The caller passes
// the OLD `items` list (before the toggle), the NEW selectedProducts (with
// the toggled item appended), and the index of the just-toggled item in the
// old list. The next render's unselectedSuggestions excludes that one item,
// so any old index > addedAtOldIdx shifts down by 1; indices < addedAtOldIdx
// are unchanged. Wraps to start of list. Returns -1 if every item is now
// selected (caller should set highlightedIndex to -1; next Enter falls into
// Priority 4 — commit).
function findNextUnselectedAfterAdd(
  oldItems: Product[],
  newSelected: Product[],
  addedAtOldIdx: number,
): number {
  if (oldItems.length === 0) return -1;
  const isSel = (p: Product): boolean =>
    newSelected.some((s) => s.subProduct === p.subProduct && s.baseColour === p.baseColour);
  for (let offset = 1; offset <= oldItems.length; offset++) {
    const oldIdx = (addedAtOldIdx + offset) % oldItems.length;
    if (!isSel(oldItems[oldIdx])) {
      return oldIdx > addedAtOldIdx ? oldIdx - 1 : oldIdx;
    }
  }
  return -1;
}
type Bill = {
  id:                number;
  searchQuery:       string;
  lines:             BillLine[];
  activeProduct:     Product | null;       // current product in pack picker (= selectedProducts[pickerIndex] during picking)
  packQtys:          Record<string, number>;
  // Multi-SKU select-then-pack state:
  mode:              "search" | "multi-select" | "picking";
  selectedProducts:  Product[];             // basket order = selection order
  pickerIndex:       number;                 // which selectedProducts item we're on (0-based)
  recentlyAddedKeys: string[];               // composite keys highlighted in cart during/after a picking journey
  suggestionPage:    number;                 // 0-based current page in paginated multi-select results
  highlightedIndex:  number;                 // -1 = none; index into unselectedSuggestions for keyboard nav (laptop)
};
type Dispatch = "Normal" | "Hold" | "Urgent";
type Marker   = "Truck" | "Cross Delivery" | "DTS" | null;

// Phase 1 keyboard workflow — imperative handle exposed by each BillCard so
// the parent can focus a specific bill's product-search input or its first
// pack-qty input after auto-advance moments (selectCustomer, picker open).
type BillCardHandle = {
  focusProductSearch: () => void;
  focusFirstPackRow:  () => void;
};

// ── Component ────────────────────────────────────────────────────────────

export default function OrderPage(): React.JSX.Element {
  // Data
  const [customers,    setCustomers]   = useState<Customer[]>([]);
  const [products,     setProducts]    = useState<Product[]>([]);
  const [dataLoading,  setDataLoading] = useState(true);

  // Customer
  const [selectedCust, setSelectedCust] = useState<Customer | null>(null);
  const [custQuery,    setCustQuery]    = useState("");

  // Order-level
  const [dispatch, setDispatch] = useState<Dispatch>("Normal");
  const [marker,   setMarker]   = useState<Marker>(null);

  // Ship to
  const [shipTo,      setShipTo]      = useState("");
  const [shipFocused, setShipFocused] = useState(false);

  // Bills
  const [bills,       setBills]       = useState<Bill[]>([]);
  const [billCounter, setBillCounter] = useState(0);

  // Voice input — Web Speech API. speechSupported is set client-side only
  // (avoids SSR mismatch); listeningBillId tracks which bill currently has
  // mic active (one mic at a time across all bills).
  const [speechSupported,  setSpeechSupported]  = useState(false);
  const [listeningBillId,  setListeningBillId]  = useState<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Phase 1 keyboard workflow — refs + state for the laptop tele-caller flow
  // (customer → product → pack → send) entirely from the keyboard. Mobile is
  // unaffected: handlers are additive and mount auto-focus is matchMedia-gated.
  const [custHighlightedIndex, setCustHighlightedIndex] = useState<number>(-1);
  const custInputRef        = useRef<HTMLInputElement | null>(null);
  const sendButtonRef       = useRef<HTMLButtonElement | null>(null);
  const billHandlesRef      = useRef<Map<number, BillCardHandle>>(new Map());
  // Latest-callback ref for the page-level Ctrl+Enter listener — keeps the
  // window keydown handler attached once on mount while still firing the
  // freshest canSend / handleSend snapshot.
  const latestHandleSendRef = useRef<(() => void) | null>(null);
  // Guard so the post-selectCustomer focus effect fires once per selection,
  // even though `bills` re-renders on every keystroke during product search.
  const focusedAfterCustRef = useRef<boolean>(false);

  // ── Effects ────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/order/data")
      .then((r) => r.json())
      .then((data: { customers?: Customer[]; products?: Product[] }) => {
        setCustomers(data.customers ?? []);
        setProducts(data.products ?? []);
      })
      .catch(() => { /* silent — form still usable, just empty pickers */ })
      .finally(() => setDataLoading(false));
  }, []);

  // Initialise the first bill once data finishes loading.
  useEffect(() => {
    if (!dataLoading && bills.length === 0) addBill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoading]);

  // Detect SpeechRecognition support (client-only).
  useEffect(() => {
    if (typeof window !== "undefined"
        && (window.SpeechRecognition || window.webkitSpeechRecognition)) {
      setSpeechSupported(true);
    }
  }, []);

  // Stop any active recognition on unmount so it doesn't leak.
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, []);

  // Keep latestHandleSendRef in sync with the freshest canSend/handleSend
  // snapshot every render. Intentionally no deps array — runs every render so
  // the ref always points at the current closure. Lint-clean: exhaustive-deps
  // only fires when a deps array is present.
  useEffect(() => {
    latestHandleSendRef.current = () => {
      if (canSend) handleSend();
    };
  });

  // Page-level Ctrl/Cmd+Enter listener. Attached once on mount, reads via the
  // latest-callback ref so it never sees a stale canSend.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        latestHandleSendRef.current?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Mount auto-focus on the customer search input — desktop only. Mobile
  // users do not get the keyboard popped on load. matchMedia is read inside
  // the effect so SSR doesn't see `window`.
  useEffect(() => {
    if (dataLoading || selectedCust) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    custInputRef.current?.focus();
  }, [dataLoading, selectedCust]);

  // After selectCustomer, focus Bill 1's product-search input. focusedAfterCustRef
  // gates this so the effect fires once per selection — bills re-renders on
  // every keystroke would otherwise yank focus back.
  useEffect(() => {
    if (!selectedCust) {
      focusedAfterCustRef.current = false;
      return;
    }
    if (focusedAfterCustRef.current) return;
    if (bills.length === 0) return;
    const handle = billHandlesRef.current.get(bills[0].id);
    if (handle) {
      handle.focusProductSearch();
      focusedAfterCustRef.current = true;
    }
  }, [selectedCust, bills]);

  // ── Customer handlers ─────────────────────────────────────────────────

  const custSuggestions = useMemo<Customer[]>(() => {
    if (custQuery.length < 2) return [];
    const q = custQuery.toLowerCase();
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || c.code.includes(q))
      .slice(0, 5);
  }, [custQuery, customers]);

  function selectCustomer(c: Customer): void {
    setSelectedCust(c);
    setCustQuery("");
  }

  function clearCustomer(): void {
    setSelectedCust(null);
    setCustQuery("");
  }

  // ── Ship-to handlers ──────────────────────────────────────────────────

  const shipSuggestions = useMemo<Customer[]>(() => {
    if (shipTo.length < 2) return [];
    const q = shipTo.toLowerCase();
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || c.code.includes(q))
      .slice(0, 5);
  }, [shipTo, customers]);

  function selectShipTo(c: Customer): void {
    setShipTo(`${c.name} (${c.code})`);
    setShipFocused(false);
  }

  // ── Bill handlers ─────────────────────────────────────────────────────

  function addBill(): void {
    const id = billCounter + 1;
    setBillCounter(id);
    setBills((prev) => [
      ...prev,
      {
        id,
        searchQuery:       "",
        lines:             [],
        activeProduct:     null,
        packQtys:          {},
        mode:              "search",
        selectedProducts:  [],
        pickerIndex:       0,
        recentlyAddedKeys: [],
        suggestionPage:    0,
        highlightedIndex:  -1,
      },
    ]);
  }

  function removeBill(billId: number): void {
    if (listeningBillId === billId) stopListening();
    setBills((prev) => prev.filter((b) => b.id !== billId));
  }

  // Update the search query AND derive the bill's mode based on the new
  // result count. Locked while the bill is in 'picking' mode (search input
  // is greyed out). selectedProducts deliberately PERSIST across query
  // changes — refining or clearing the search must not wipe the basket.
  // The basket is cleared only by startPicking, nextProduct's finishing
  // branch, or removeBill.
  function setBillQuery(billId: number, q: string): void {
    setBills((prev) => prev.map((b) => {
      if (b.id !== billId) return b;
      if (b.mode === "picking") return b; // search is locked while picking
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        return { ...b, searchQuery: q, mode: "search", suggestionPage: 0, highlightedIndex: -1 };
      }
      const matched = getProductSuggestions(q);
      return {
        ...b,
        searchQuery:     q,
        mode:            matched.length >= 1 ? "multi-select" : "search",
        suggestionPage:  0,
        highlightedIndex: -1,
      };
    }));
  }

  // Single-result auto-pick path. Reads the latest searchQuery from the
  // updater's `prev` state (avoids the stale-closure bug where `bills.find`
  // outside the updater captured an outdated value).
  function pickProduct(billId: number, product: Product): void {
    if (listeningBillId === billId) stopListening();
    setBills((prev) => prev.map((b) => {
      if (b.id !== billId) return b;
      return {
        ...b,
        selectedProducts:  [product],
        pickerIndex:       0,
        activeProduct:     product,
        packQtys:          {},
        mode:              "picking",
        recentlyAddedKeys: [],
        suggestionPage:    0,
        highlightedIndex:  -1,
      };
    }));
  }

  // Toggle a product in the multi-select basket. Add if absent, remove if
  // present. Keyed by (subProduct, baseColour) since same subProduct can
  // appear with different baseColour as separate index rows.
  function toggleProductSelection(billId: number, product: Product): void {
    setBills((prev) => prev.map((b) => {
      if (b.id !== billId || b.mode !== "multi-select") return b;
      const exists = b.selectedProducts.some(
        (p) => p.subProduct === product.subProduct && p.baseColour === product.baseColour,
      );
      const nextSelected = exists
        ? b.selectedProducts.filter(
            (p) => !(p.subProduct === product.subProduct && p.baseColour === product.baseColour),
          )
        : [...b.selectedProducts, product];
      return { ...b, selectedProducts: nextSelected, highlightedIndex: -1 };
    }));
  }

  // Begin the multi-step pack-picker journey. mode → 'picking', activeProduct
  // becomes the first selected product, packQtys reset.
  function startPicking(billId: number): void {
    setBills((prev) => prev.map((b) => {
      if (b.id !== billId || b.selectedProducts.length === 0) return b;
      return {
        ...b,
        mode:              "picking",
        pickerIndex:       0,
        activeProduct:     b.selectedProducts[0],
        packQtys:          {},
        recentlyAddedKeys: [],
        suggestionPage:    0,
        highlightedIndex:  -1,
      };
    }));
  }

  // Pagination handler for the multi-select results list.
  function goToPage(billId: number, page: number): void {
    setBills((prev) => prev.map((b) =>
      b.id === billId ? { ...b, suggestionPage: Math.max(0, page), highlightedIndex: -1 } : b,
    ));
  }

  // Advance the picker. `skip=false` (Next): commit current product's qty
  // as a new line if any pack has qty > 0, then move on. `skip=true`
  // (Skip): don't commit the line, just move on. When pickerIndex reaches
  // the end of selectedProducts, return to 'search' mode and clear
  // searchQuery so the bill is ready for the next product hunt.
  function nextProduct(billId: number, skip: boolean): void {
    setBills((prev) => prev.map((b) => {
      if (b.id !== billId || b.mode !== "picking" || !b.activeProduct) return b;

      let lines  = b.lines;
      let recent = b.recentlyAddedKeys;

      if (!skip) {
        const current = b.activeProduct;
        const packs = current.packs
          .filter((p) => (b.packQtys[p] ?? 0) > 0)
          .map((p) => ({ pack: p, qty: b.packQtys[p] }));
        if (packs.length > 0) {
          // Dedup composite key: (subProduct, baseColour).
          const filtered = lines.filter(
            (l) => !(l.subProduct === current.subProduct && l.baseColour === (current.baseColour ?? null)),
          );
          const newLine: BillLine = {
            displayName: current.displayName,
            subProduct:  current.subProduct,
            baseColour:  current.baseColour ?? null,
            packs,
          };
          lines  = [...filtered, newLine];
          recent = [...recent, `${newLine.subProduct}|||${newLine.baseColour ?? ""}`];
        }
      }

      const nextIndex = b.pickerIndex + 1;
      if (nextIndex >= b.selectedProducts.length) {
        // Done — return to plain search mode, ready for next product.
        return {
          ...b,
          lines,
          recentlyAddedKeys: recent,
          selectedProducts:  [],
          pickerIndex:       0,
          activeProduct:     null,
          packQtys:          {},
          mode:              "search",
          searchQuery:       "",
          suggestionPage:    0,
          highlightedIndex:  -1,
        };
      }

      return {
        ...b,
        lines,
        recentlyAddedKeys: recent,
        pickerIndex:       nextIndex,
        activeProduct:     b.selectedProducts[nextIndex],
        packQtys:          {},
        highlightedIndex:  -1,
      };
    }));
  }

  // ── Voice input handlers ──────────────────────────────────────────────

  function startListening(billId: number): void {
    // Stop any active recognition first (one mic at a time across all bills).
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang            = "en-IN";  // Indian English — paint product names
    recognition.continuous      = false;
    recognition.interimResults  = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript.trim()) setBillQuery(billId, transcript.trim());
    };
    recognition.onerror = () => {
      setListeningBillId(null);
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      setListeningBillId(null);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setListeningBillId(billId);

    try {
      recognition.start();
    } catch {
      // start() can throw if invoked too soon after a prior stop().
      setListeningBillId(null);
      recognitionRef.current = null;
    }
  }

  function stopListening(): void {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setListeningBillId(null);
  }

  function toggleMic(billId: number): void {
    if (listeningBillId === billId) stopListening();
    else                             startListening(billId);
  }

  function stepPack(billId: number, pack: string, delta: number): void {
    setBills((prev) => prev.map((b) => {
      if (b.id !== billId) return b;
      const step = packStep(formatPack(pack));
      const cur  = b.packQtys[pack] ?? 0;
      const next = Math.max(0, cur + delta * step);
      return { ...b, packQtys: { ...b.packQtys, [pack]: next } };
    }));
  }

  function setPack(billId: number, pack: string, raw: string): void {
    const parsed = parseInt(raw, 10);
    const qty    = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    setBills((prev) => prev.map((b) => {
      if (b.id !== billId) return b;
      return { ...b, packQtys: { ...b.packQtys, [pack]: qty } };
    }));
  }

  // Laptop/desktop keyboard navigation for the multi-select suggestion list.
  // ↓/↑ wrap through unselectedSuggestions and auto-advance the page so the
  // highlight stays visible.
  //
  // Phase 1.2 Enter routing — single-key multi-select. Space is no longer
  // intercepted (literal space character types into the search input).
  // Priority order:
  //   1. empty basket + exactly 1 result        → fast-path pickProduct
  //   2. highlighted item NOT yet in basket      → ✓ add and auto-advance
  //                                                 highlight to next unselected
  //   3. highlighted item ALREADY in basket      → commit → startPicking
  //   4. no highlight + basket ≥1                → commit → startPicking
  //   5. nothing actionable                      → no-op
  //
  // Bill state is read via setBills(prev => ...) so we never inherit a stale
  // `bills` closure. State-only changes (priority 2) update inline within the
  // updater. Side-effect helpers (pickProduct, startPicking) are stashed as
  // pendingAction and fired after the updater returns — calling them inside
  // the updater would nest setBills, which is unsafe.
  function handleSearchKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    billId: number,
    items: Product[],
  ): void {
    if (!items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setBills((prev) => prev.map((b) => {
        if (b.id !== billId) return b;
        const next = b.highlightedIndex < items.length - 1 ? b.highlightedIndex + 1 : 0;
        return { ...b, highlightedIndex: next, suggestionPage: Math.floor(next / SUGGESTION_PAGE_SIZE) };
      }));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setBills((prev) => prev.map((b) => {
        if (b.id !== billId) return b;
        const next = b.highlightedIndex > 0 ? b.highlightedIndex - 1 : items.length - 1;
        return { ...b, highlightedIndex: next, suggestionPage: Math.floor(next / SUGGESTION_PAGE_SIZE) };
      }));
    } else if (e.key === "Enter") {
      e.preventDefault();
      let pendingAction: (() => void) | null = null;
      setBills((prev) => {
        const b = prev.find((x) => x.id === billId);
        if (!b) return prev;

        const hasHighlight = b.highlightedIndex >= 0;
        const highlighted  = hasHighlight ? items[b.highlightedIndex] : null;
        const isHighlightedSelected = highlighted
          ? b.selectedProducts.some((p) =>
              p.subProduct === highlighted.subProduct && p.baseColour === highlighted.baseColour)
          : false;

        // Priority 1: empty basket + 1 result → fast path. Works with or
        // without ↓ first (uses highlighted ?? items[0]).
        if (b.selectedProducts.length === 0 && items.length === 1) {
          const fast = highlighted ?? items[0];
          pendingAction = () => pickProduct(billId, fast);
          return prev;
        }

        // Priority 2: highlighted + not in basket → ✓ add and advance the
        // highlight to the next unselected item. Inline state update so we
        // can set highlightedIndex against the post-toggle coordinate system.
        if (highlighted && !isHighlightedSelected) {
          const newSelected = [...b.selectedProducts, highlighted];
          const nextIdx     = findNextUnselectedAfterAdd(items, newSelected, b.highlightedIndex);
          return prev.map((x) =>
            x.id === billId
              ? {
                  ...x,
                  selectedProducts: newSelected,
                  highlightedIndex: nextIdx,
                  suggestionPage:   nextIdx >= 0 ? Math.floor(nextIdx / SUGGESTION_PAGE_SIZE) : 0,
                }
              : x,
          );
        }

        // Priority 3: highlighted + already in basket → commit.
        if (highlighted && isHighlightedSelected) {
          pendingAction = () => startPicking(billId);
          return prev;
        }

        // Priority 4: no highlight + basket ≥1 → commit.
        if (!hasHighlight && b.selectedProducts.length >= 1) {
          pendingAction = () => startPicking(billId);
          return prev;
        }

        // Priority 5: no-op.
        return prev;
      });
      if (pendingAction !== null) (pendingAction as () => void)();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setBills((prev) => prev.map((b) => {
        if (b.id !== billId) return b;
        return { ...b, searchQuery: "", mode: "search", suggestionPage: 0, highlightedIndex: -1 };
      }));
    }
  }

  // Customer-search keyboard nav: ↓/↑ wrap through custSuggestions, Enter
  // selects the highlighted candidate (the post-selectCustomer effect then
  // hands focus to Bill 1's product search). Escape clears the query.
  function handleCustKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Escape") {
      e.preventDefault();
      setCustQuery("");
      setCustHighlightedIndex(-1);
      return;
    }
    if (custSuggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCustHighlightedIndex((i) => i < custSuggestions.length - 1 ? i + 1 : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCustHighlightedIndex((i) => i > 0 ? i - 1 : custSuggestions.length - 1);
    } else if (e.key === "Enter") {
      if (custHighlightedIndex < 0) return;
      const c = custSuggestions[custHighlightedIndex];
      if (!c) return;
      e.preventDefault();
      selectCustomer(c);
    }
  }

  // Esc-out of the pack picker. Per spec: searchQuery and committed lines are
  // PRESERVED so the tele-caller can refine the same query immediately. The
  // basket and any in-flight pack qtys are cleared. mode is forced back to
  // "search"; the next keystroke in setBillQuery will recompute multi-select
  // mode if the preserved query still matches products.
  function cancelPicking(billId: number): void {
    setBills((prev) => prev.map((b) => {
      if (b.id !== billId) return b;
      return {
        ...b,
        mode:              "search",
        selectedProducts:  [],
        pickerIndex:       0,
        activeProduct:     null,
        packQtys:          {},
        recentlyAddedKeys: [],
        suggestionPage:    0,
        highlightedIndex:  -1,
        // searchQuery and lines deliberately preserved.
      };
    }));
  }

  function deleteLineFromBill(billId: number, idx: number): void {
    setBills((prev) => prev.map((b) => {
      if (b.id !== billId) return b;
      return { ...b, lines: b.lines.filter((_, i) => i !== idx) };
    }));
  }

  function getProductSuggestions(query: string): Product[] {
    if (query.trim().length < 2) return [];
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return products
      .filter((p) => {
        const tokens = p.searchTokens.toLowerCase();
        return words.every((w) => tokens.includes(w));
      })
      // Cap at 50 so the multi-select pagination has items to paginate
      // across. SUGGESTION_PAGE_SIZE (6) drives the per-page split — searches
      // like "gloss" with 30+ colour variants now produce ~5 swipeable pages
      // instead of a single capped slice that hid the Set Quantities bar.
      .slice(0, 50);
  }

  // ── Email build ───────────────────────────────────────────────────────

  function buildEmail(): { subject: string; body: string; valid: boolean } {
    const name = selectedCust?.name ?? "";
    const code = selectedCust?.code ?? "";
    const lines: string[] = [];

    if (name || code) {
      const customerLine = name && code ? `${name} (${code})` : (name || code);
      lines.push("Customer: " + customerLine);
    }
    if (dispatch !== "Normal") lines.push("Dispatch: " + dispatch);
    if (marker)                lines.push("Marker: "   + marker);
    if (shipTo.trim())         lines.push("Ship To: "  + shipTo.trim());

    const activeBills = bills.filter((b) => b.lines.length > 0);
    activeBills.forEach((b) => {
      lines.push("");
      if (activeBills.length > 1) lines.push("Bill " + b.id);
      b.lines.forEach((l) => {
        const packStr     = l.packs.map((p) => `${formatPack(p.pack)}*${p.qty}`).join(", ");
        // Email format: "{subProduct} [{baseColour}] {packs}" — SAP-friendly,
        // matches the shape the parser already handles. baseColour is
        // appended only for colour-variant rows. Display in the UI uses
        // l.displayName. Pack labels are formatted (e.g. "1L", "200ML").
        const productText = l.baseColour
          ? `${l.subProduct} ${l.baseColour}`
          : l.subProduct;
        lines.push(`${productText} ${packStr}`);
      });
    });

    const subject = "Order"
      + (name ? ` — ${name}` : "")
      + (code ? ` ${code}`    : "");
    const valid   = !!selectedCust && activeBills.length > 0;

    return { subject, body: lines.join("\n"), valid };
  }

  const { subject, body, valid: canSend } = buildEmail();

  function handleSend(): void {
    if (!canSend) return;
    const url = `mailto:${ORDER_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[#f2f2f7] pb-12">

      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100">
        <div className="max-w-[480px] mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-[34px] h-[34px] bg-teal-600 rounded-[9px] flex items-center justify-center flex-shrink-0">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="7" stroke="white" strokeWidth="1.6" />
              <circle cx="11" cy="11" r="2.2" fill="white" />
              <circle cx="18" cy="11" r="2" fill="white" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="text-[16px] font-semibold text-gray-900 leading-tight">Place Order</span>
            <span className="text-[11px] text-gray-400 leading-tight">JSW Dulux · Surat Depot</span>
          </div>
        </div>
      </div>

      <div className="max-w-[480px] mx-auto">

        {/* Customer */}
        <Section title="Customer">
          {dataLoading ? (
            <div className="flex items-center gap-2.5 px-4 py-3">
              <Search className="w-4 h-4 text-gray-300 shrink-0" />
              <input
                disabled
                placeholder="Loading customers…"
                className="flex-1 text-[16px] bg-transparent border-none outline-none placeholder:text-gray-300"
              />
            </div>
          ) : selectedCust ? (
            <div className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0 pr-3">
                <p className="text-[15px] font-semibold text-gray-900 truncate">{selectedCust.name}</p>
                <p className="text-[12px] text-gray-400 font-mono mt-0.5">{selectedCust.code}</p>
              </div>
              <button
                type="button"
                onClick={clearCustomer}
                className="text-[13px] text-teal-600 font-medium shrink-0"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 px-4 py-3">
                <Search className="w-4 h-4 text-gray-300 shrink-0" />
                <input
                  ref={custInputRef}
                  type="text"
                  value={custQuery}
                  onChange={(e) => {
                    setCustQuery(e.target.value);
                    setCustHighlightedIndex(-1);
                  }}
                  onKeyDown={handleCustKeyDown}
                  placeholder="Name or customer code…"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="flex-1 text-[16px] text-gray-900 bg-transparent border-none outline-none placeholder:text-gray-300"
                />
                {custQuery && (
                  <button
                    type="button"
                    onClick={() => setCustQuery("")}
                    className="text-gray-300 text-lg leading-none px-1"
                    aria-label="Clear"
                  >
                    ×
                  </button>
                )}
              </div>
              {custSuggestions.length > 0 && (
                <div className="border-t border-gray-100">
                  {custSuggestions.map((c, i) => {
                    const isHighlighted = i === custHighlightedIndex;
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => selectCustomer(c)}
                        className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left border-b border-gray-50 last:border-b-0 ${
                          isHighlighted ? "bg-teal-50 outline-none" : "active:bg-gray-50"
                        }`}
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-teal-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] text-gray-900 truncate">{c.name}</p>
                          <p className="text-[12px] text-gray-400 font-mono mt-0.5">{c.code}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </Section>

        {/* Products / Bills */}
        <div className="mx-[14px] mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2 pl-0.5">
            Products
          </p>
          <div className="flex flex-col gap-[10px]">
            {bills.map((b) => (
              <BillCard
                key={b.id}
                ref={(handle) => {
                  // Register / unregister this bill's imperative handle so the
                  // parent can call focusProductSearch / focusFirstPackRow.
                  if (handle) billHandlesRef.current.set(b.id, handle);
                  else        billHandlesRef.current.delete(b.id);
                }}
                bill={b}
                dataLoading={dataLoading}
                getProductSuggestions={getProductSuggestions}
                onRemove={() => removeBill(b.id)}
                onSetQuery={(q) => setBillQuery(b.id, q)}
                onPickProduct={(product) => pickProduct(b.id, product)}
                onToggleProduct={(product) => toggleProductSelection(b.id, product)}
                onStartPicking={() => startPicking(b.id)}
                onNextProduct={(skip) => nextProduct(b.id, skip)}
                onGoToPage={(page) => goToPage(b.id, page)}
                onStepPack={(pack, delta) => stepPack(b.id, pack, delta)}
                onSetPack={(pack, raw) => setPack(b.id, pack, raw)}
                onSearchKeyDown={(e, items) => handleSearchKeyDown(e, b.id, items)}
                onCancelPicking={() => cancelPicking(b.id)}
                onDeleteLine={(idx) => deleteLineFromBill(b.id, idx)}
                speechSupported={speechSupported}
                isListening={listeningBillId === b.id}
                onMicToggle={() => toggleMic(b.id)}
              />
            ))}
            <button
              type="button"
              onClick={addBill}
              className="w-full h-11 mt-2 bg-white border-[1.5px] border-dashed border-gray-300 rounded-[14px] text-[14px] font-medium text-gray-400 active:bg-gray-50"
            >
              + Add Bill
            </button>
          </div>
        </div>

        {/* Ship To */}
        <Section title="Ship To">
          <div className="flex items-center gap-2.5 px-4 py-3">
            <Search className="w-4 h-4 text-gray-300 shrink-0" />
            <input
              type="text"
              value={shipTo}
              onChange={(e) => setShipTo(e.target.value)}
              onFocus={() => setShipFocused(true)}
              onBlur={() => setTimeout(() => setShipFocused(false), 150)}
              placeholder="Site name or alternate delivery address"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="flex-1 text-[16px] text-gray-900 bg-transparent border-none outline-none placeholder:text-gray-300"
            />
            {shipTo && (
              <button
                type="button"
                onClick={() => setShipTo("")}
                className="text-gray-300 text-lg leading-none px-1"
                aria-label="Clear"
              >
                ×
              </button>
            )}
          </div>
          {shipFocused && shipSuggestions.length > 0 && (
            <div className="border-t border-gray-100">
              {shipSuggestions.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectShipTo(c)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left border-b border-gray-50 last:border-b-0 active:bg-gray-50"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-teal-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-gray-900 truncate">{c.name}</p>
                    <p className="text-[12px] text-gray-400 font-mono mt-0.5">{c.code}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Section>

        {/* Dispatch */}
        <Section title="Dispatch">
          <div className="grid grid-cols-3 gap-2 p-3">
            <DispatchChip
              label="Normal"
              dotCls="bg-teal-500"
              selected={dispatch === "Normal"}
              selectedCls="border-teal-500 bg-teal-50 text-teal-700 font-semibold"
              onClick={() => setDispatch("Normal")}
            />
            <DispatchChip
              label="Hold"
              dotCls="bg-red-400"
              selected={dispatch === "Hold"}
              selectedCls="border-red-300 bg-red-50 text-red-700 font-semibold"
              onClick={() => setDispatch("Hold")}
            />
            <DispatchChip
              label="Urgent"
              dotCls="bg-amber-400"
              selected={dispatch === "Urgent"}
              selectedCls="border-amber-300 bg-amber-50 text-amber-700 font-semibold"
              onClick={() => setDispatch("Urgent")}
            />
          </div>
        </Section>

        {/* Order Marker */}
        <div className="mx-[14px] mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2 pl-0.5">
            Order Marker <span className="text-gray-300 font-normal normal-case tracking-normal">· optional</span>
          </p>
          <div className="bg-white rounded-[14px] overflow-hidden shadow-sm border border-gray-100">
            <div className="grid grid-cols-3 gap-2 p-3">
              <MarkerChip
                label="🚛 Truck"
                selected={marker === "Truck"}
                onClick={() => setMarker(marker === "Truck" ? null : "Truck")}
              />
              <MarkerChip
                label="🔄 Cross"
                selected={marker === "Cross Delivery"}
                onClick={() => setMarker(marker === "Cross Delivery" ? null : "Cross Delivery")}
              />
              <MarkerChip
                label="📦 DTS"
                selected={marker === "DTS"}
                onClick={() => setMarker(marker === "DTS" ? null : "DTS")}
              />
            </div>
          </div>
        </div>

        {/* Preview */}
        <Section title="Preview">
          <PreviewRow label="To" value={ORDER_TO} />
          <PreviewRow
            label="Subject"
            value={selectedCust ? subject : ""}
            placeholder="Subject will appear here"
          />
          <PreviewRow
            label="Body"
            value={body}
            placeholder="Body will appear here"
            isLast
          />
        </Section>

        {/* Send */}
        <div className="mx-[14px] mt-6">
          <button
            ref={sendButtonRef}
            type="button"
            disabled={!canSend}
            onClick={handleSend}
            className={`w-full h-[52px] rounded-[14px] text-[16px] font-semibold flex items-center justify-center gap-2 transition-colors ${
              canSend
                ? "bg-teal-600 hover:bg-teal-700 text-white"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            <Send className="w-[17px] h-[17px]" />
            Send Order
          </button>
          <p className="text-center text-[12px] text-gray-400 mt-2">
            Opens your mail app · ready to send
          </p>
        </div>

        {/* Keyboard hint bar — desktop only (≥768px). Static, not sticky.
            Mirrors the Phase 1 keyboard map so a tele-caller can see at a
            glance what each shortcut does. Mobile users don't see it. */}
        <div className="hidden md:flex flex-wrap items-center justify-center gap-3 mt-6 mx-[14px] py-3 px-4 bg-white border border-gray-200 rounded-[10px]">
          <span className="text-[11px] text-gray-500 font-mono px-2 py-1 bg-gray-50 rounded border border-gray-200">Tab → next</span>
          <span className="text-[11px] text-gray-500 font-mono px-2 py-1 bg-gray-50 rounded border border-gray-200">Enter → confirm</span>
          <span className="text-[11px] text-gray-500 font-mono px-2 py-1 bg-gray-50 rounded border border-gray-200">Esc → cancel</span>
          <span className="text-[11px] text-gray-500 font-mono px-2 py-1 bg-gray-50 rounded border border-gray-200">Alt+Enter → add line</span>
          <span className="text-[11px] text-gray-500 font-mono px-2 py-1 bg-gray-50 rounded border border-gray-200">Ctrl+Enter → send</span>
        </div>

      </div>
    </main>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title:    string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mx-[14px] mt-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2 pl-0.5">
        {title}
      </p>
      <div className="bg-white rounded-[14px] overflow-hidden shadow-sm border border-gray-100">
        {children}
      </div>
    </div>
  );
}

function DispatchChip({
  label, dotCls, selected, selectedCls, onClick,
}: {
  label:       string;
  dotCls:      string;
  selected:    boolean;
  selectedCls: string;
  onClick:     () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-[44px] rounded-[10px] border text-[14px] flex items-center justify-center gap-1.5 transition-colors ${
        selected ? selectedCls : "border-gray-200 bg-white text-gray-400 font-medium"
      }`}
    >
      <span className={`w-[7px] h-[7px] rounded-full ${dotCls}`} />
      <span>{label}</span>
    </button>
  );
}

function MarkerChip({
  label, selected, onClick,
}: {
  label:    string;
  selected: boolean;
  onClick:  () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-[44px] rounded-[10px] border text-[13px] flex items-center justify-center transition-colors ${
        selected
          ? "border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold"
          : "border-gray-200 bg-white text-gray-400 font-medium"
      }`}
    >
      {label}
    </button>
  );
}

function PreviewRow({
  label, value, placeholder, isLast,
}: {
  label:        string;
  value:        string;
  placeholder?: string;
  isLast?:      boolean;
}): React.JSX.Element {
  const hasValue = value.length > 0;
  return (
    <div className={`flex gap-2.5 px-4 py-2.5 items-start ${isLast ? "" : "border-b border-gray-100"}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-300 w-[52px] shrink-0 pt-0.5">
        {label}
      </span>
      {hasValue ? (
        <span className="text-[13px] text-gray-900 font-mono flex-1 whitespace-pre-wrap break-words">
          {value}
        </span>
      ) : (
        <span className="text-[13px] text-gray-300 italic font-mono flex-1">
          {placeholder ?? ""}
        </span>
      )}
    </div>
  );
}

// ── Bill card ────────────────────────────────────────────────────────────

interface BillCardProps {
  bill:                  Bill;
  dataLoading:           boolean;
  getProductSuggestions: (query: string) => Product[];
  onRemove:              () => void;
  onSetQuery:            (q: string) => void;
  onPickProduct:         (product: Product) => void;
  onToggleProduct:       (product: Product) => void;
  onStartPicking:        () => void;
  onNextProduct:         (skip: boolean) => void;
  onGoToPage:            (page: number) => void;
  onStepPack:            (pack: string, delta: number) => void;
  onSetPack:             (pack: string, raw: string) => void;
  onSearchKeyDown:       (e: React.KeyboardEvent<HTMLInputElement>, items: Product[]) => void;
  onCancelPicking:       () => void;
  onDeleteLine:          (idx: number) => void;
  speechSupported:       boolean;
  isListening:           boolean;
  onMicToggle:           () => void;
}

const SUGGESTION_PAGE_SIZE = 6;

const BillCard = forwardRef<BillCardHandle, BillCardProps>(function BillCard({
  bill, dataLoading, getProductSuggestions, onRemove, onSetQuery,
  onPickProduct, onToggleProduct, onStartPicking, onNextProduct, onGoToPage,
  onStepPack, onSetPack, onSearchKeyDown, onCancelPicking, onDeleteLine,
  speechSupported, isListening, onMicToggle,
}, ref) {
  const suggestions  = getProductSuggestions(bill.searchQuery);
  const hasAnyQty    = Object.values(bill.packQtys).some((q) => q > 0);
  const inPicking    = bill.mode === "picking";
  const inMultiSel   = bill.mode === "multi-select";

  // Hoisted from the multi-select IIFE so the search input's onKeyDown can
  // pass the live unselectedSuggestions list to the parent's keyboard handler.
  const unselectedSuggestions = inMultiSel
    ? suggestions.filter((p) => !bill.selectedProducts.some(
        (s) => s.subProduct === p.subProduct && s.baseColour === p.baseColour,
      ))
    : [];
  const totalPages  = Math.max(1, Math.ceil(unselectedSuggestions.length / SUGGESTION_PAGE_SIZE));
  const currentPage = Math.min(bill.suggestionPage, totalPages - 1);

  // Phase 1 keyboard refs — productSearch for selectCustomer/Esc auto-focus,
  // packInputs for pack-row Enter chaining, nextButton as 0-pack fallback.
  const productSearchRef = useRef<HTMLInputElement | null>(null);
  const packInputsRef    = useRef<HTMLInputElement[]>([]);
  const nextButtonRef    = useRef<HTMLButtonElement | null>(null);
  // prevModeRef + prevActiveRef gate the focus effect to fire exactly once
  // per transition: search→picking, picking→search, or picker advancing to
  // the next product within the same picking journey.
  const prevModeRef      = useRef<Bill["mode"]>(bill.mode);
  const prevActiveRef    = useRef<Product | null>(bill.activeProduct);

  // Imperative handle exposed to OrderPage so it can focus this bill's
  // product-search or first pack-row from outside.
  useImperativeHandle(ref, () => ({
    focusProductSearch: () => productSearchRef.current?.focus(),
    focusFirstPackRow:  () => {
      const first = packInputsRef.current[0];
      if (first) first.focus();
      else       nextButtonRef.current?.focus();
    },
  }), []);

  // Mode + activeProduct transition focus:
  //   - search → picking            : focus first pack of new product
  //   - picking → picking (new prod) : focus first pack of new product
  //   - picking → search             : focus this bill's product-search input
  // prevModeRef + prevActiveRef gate so we fire once per transition.
  useEffect(() => {
    const prevMode   = prevModeRef.current;
    const prevActive = prevActiveRef.current;
    const nextMode   = bill.mode;
    const nextActive = bill.activeProduct;

    const enteredPicking   = prevMode !== "picking" && nextMode === "picking";
    const advancedProduct  = prevMode === "picking" && nextMode === "picking" && prevActive !== nextActive;
    const exitedPicking    = prevMode === "picking" && nextMode === "search";

    if (enteredPicking || advancedProduct) {
      const first = packInputsRef.current[0];
      if (first) first.focus();
      else       nextButtonRef.current?.focus();   // 0-pack fallback
    } else if (exitedPicking) {
      productSearchRef.current?.focus();
    }

    prevModeRef.current   = nextMode;
    prevActiveRef.current = nextActive;
  }, [bill.mode, bill.activeProduct]);

  // Keyboard nav scroll: when ↓/↑ moves highlightedIndex, scroll the new
  // suggestion row into view. Page auto-advance has already updated
  // suggestionPage, so by the time this effect runs the row is in the DOM.
  useEffect(() => {
    if (bill.highlightedIndex < 0) return;
    const el = document.getElementById(`sugg-${bill.id}-${bill.highlightedIndex}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [bill.highlightedIndex, bill.id]);

  // Hoisted so handlePackKeyDown's "is last row" check + the pack input
  // ref-callback both index against the same array.
  const sortedPacks = bill.activeProduct ? sortPacksForDisplay(bill.activeProduct.packs) : [];

  // Pack-row keyboard handler. Key map:
  //   Alt+Enter   → add line from any row (commits product, advances/finishes
  //                 the journey). No-op when every pack qty is 0.
  //   Enter       → next pack input, or commit on last row.
  //   Esc         → cancel picker entirely.
  //   + / ↑       → onStepPack(pack, +1) — routes through stepPack so the
  //                 step size respects packStep(label) for cartons (12, 6, 4…)
  //                 instead of the browser's native 1 step on number inputs.
  //   - / ↓       → onStepPack(pack, -1) — same, descending.
  // Other keys fall through to native input behaviour (typing, selection).
  function handlePackKeyDown(e: React.KeyboardEvent<HTMLInputElement>, i: number): void {
    const pack = sortedPacks[i];
    if (!pack) return;

    if (e.altKey && e.key === "Enter") {
      e.preventDefault();
      const hasAnyQty = Object.values(bill.packQtys).some((q) => q > 0);
      if (!hasAnyQty) return;   // silent no-op — don't advance with empty line
      onNextProduct(false);
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (i < sortedPacks.length - 1) {
        packInputsRef.current[i + 1]?.focus();
      } else {
        onNextProduct(false);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      onCancelPicking();
      return;
    }

    if (e.key === "+" || e.key === "ArrowUp") {
      e.preventDefault();
      onStepPack(pack, +1);
      return;
    }

    if (e.key === "-" || e.key === "ArrowDown") {
      e.preventDefault();
      onStepPack(pack, -1);
      return;
    }
  }

  // Multi-SKU select-then-pack flow (top → bottom):
  //   Bill header (line-count badge)
  //   Cart lines (full height, recently-added rows highlighted teal during/after a picking journey)
  //   Search row (greyed out in picking mode; otherwise editable, with mic + clear)
  //   IF mode === 'multi-select':
  //      - 1 result  → render plain row, tap = pickProduct (single-result fast path)
  //      - 2+ result → render checkbox rows, tap = toggleProductSelection
  //                    Set Quantities bar when ≥1 selected (only on 2+ result path)
  //   IF mode === 'picking':
  //      - Progress dots + "n of N"
  //      - Product header (teal, no Change button — exit via Skip-through-end)
  //      - Pack counters
  //      - Sticky Skip + Next/Add-All bar
  //
  // overflow-hidden is intentionally absent so natural document scroll works
  // while the keyboard is up. The Skip / Next action bar sits near the top
  // of the qty card (not sticky-bottom) so it never overlaps qty rows or
  // hides behind the iOS soft keyboard.
  const nextProductInQueue = inPicking && bill.pickerIndex < bill.selectedProducts.length - 1
    ? bill.selectedProducts[bill.pickerIndex + 1]
    : null;

  return (
    <div id={`bill-${bill.id}`} className="bg-white rounded-[14px] shadow-sm">

      {/* Bill header */}
      <div className="flex items-center justify-between px-[14px] py-[10px] bg-[#fafafa] border-b border-[#f0f0f0] rounded-t-[14px]">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.07em] text-teal-600">
            Bill {bill.id}
          </span>
          {bill.lines.length > 0 && (
            <span className="inline-flex items-center justify-center w-[17px] h-[17px] rounded-full bg-teal-600 text-white text-[10px] font-bold">
              {bill.lines.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-gray-300 text-xl leading-none px-1"
          aria-label="Remove bill"
        >
          ×
        </button>
      </div>

      {/* Cart lines OR empty state — recently-added rows highlighted */}
      {bill.lines.length > 0 ? (
        <div className="border-b border-[#f0f0f0]">
          {bill.lines.map((line, idx) => {
            const lineKey  = `${line.subProduct}|||${line.baseColour ?? ""}`;
            const isRecent = bill.recentlyAddedKeys.includes(lineKey);
            return (
              <div
                key={`${lineKey}-${idx}`}
                className={`flex items-center gap-2.5 px-[14px] py-[9px] border-b border-[#f0f0f0] last:border-b-0 transition-colors ${
                  isRecent ? "bg-teal-50/50" : ""
                }`}
              >
                <div className="w-[6px] h-[6px] rounded-full bg-teal-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-gray-900 truncate">{line.displayName}</p>
                  <p className="text-[11px] text-teal-600 font-mono mt-0.5">
                    {line.packs.map((p) => `${formatPack(p.pack)}*${p.qty}`).join(", ")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteLine(idx)}
                  className="text-gray-300 text-[17px] leading-none shrink-0"
                  aria-label="Delete line"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-[14px] py-3 text-[13px] text-gray-300 italic border-b border-[#f0f0f0]">
          No products added
        </div>
      )}

      {/* Search row — greyed out in picking mode (input disabled, mic & clear hidden) */}
      <div
        className={`flex items-center gap-2 px-[14px] py-[10px] border-b border-[#f0f0f0] transition-opacity ${
          inPicking ? "opacity-50" : ""
        }`}
      >
        <Search className="w-4 h-4 text-gray-300 shrink-0" />
        <input
          ref={productSearchRef}
          type="text"
          disabled={dataLoading || inPicking}
          value={bill.searchQuery}
          onChange={(e) => onSetQuery(e.target.value)}
          onKeyDown={(e) => onSearchKeyDown(e, unselectedSuggestions)}
          placeholder={dataLoading ? "Loading products…" : "Search next product…"}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          className="flex-1 text-[16px] text-gray-900 bg-transparent border-none outline-none placeholder:text-gray-300 placeholder:text-[14px] disabled:opacity-60 disabled:cursor-not-allowed"
        />
        {speechSupported && !inPicking && (
          isListening ? (
            <button
              type="button"
              onClick={onMicToggle}
              title="Tap to stop"
              aria-label="Stop voice input"
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-red-500 text-white animate-pulse"
            >
              <MicSvg />
            </button>
          ) : (
            <button
              type="button"
              onClick={onMicToggle}
              disabled={dataLoading}
              title="Tap to speak"
              aria-label="Start voice input"
              className="shrink-0 w-7 h-7 flex items-center justify-center text-gray-300 hover:text-teal-600 disabled:opacity-50"
            >
              <MicSvg />
            </button>
          )
        )}
        {bill.searchQuery && !inPicking && (
          <button
            type="button"
            onClick={() => onSetQuery("")}
            className="bg-[#e5e5ea] rounded-full w-[17px] h-[17px] flex items-center justify-center text-[11px] text-gray-500 shrink-0 leading-none"
            aria-label="Clear"
          >
            ×
          </button>
        )}
      </div>

      {/* Multi-select suggestions — paginated, with pinned Selected section.
          unselectedSuggestions / totalPages / currentPage are hoisted to the
          BillCard top so the search input's onKeyDown can pass them in. */}
      {inMultiSel && suggestions.length > 0 && (() => {
        const pageItems   = unselectedSuggestions.slice(
          currentPage * SUGGESTION_PAGE_SIZE,
          (currentPage + 1) * SUGGESTION_PAGE_SIZE,
        );
        // Fast path only when no prior selections AND exactly one unselected
        // result — preserves multi-select work if user has already ticked items.
        const isFastPath  = bill.selectedProducts.length === 0 && unselectedSuggestions.length === 1;

        return (
          <div className="border-b border-[#f0f0f0]">
            {isFastPath ? (
              // Single result, no prior selection — tap = pick straight to picker.
              (() => {
                const p = unselectedSuggestions[0];
                const isHighlighted = bill.highlightedIndex === 0;
                return (
                  <button
                    id={`sugg-${bill.id}-0`}
                    type="button"
                    onClick={() => onPickProduct(p)}
                    className={`w-full flex items-center gap-2.5 px-[14px] py-[11px] text-left ${
                      isHighlighted ? "bg-teal-50 outline-none" : "active:bg-teal-50"
                    }`}
                  >
                    <div className="w-[7px] h-[7px] rounded-full bg-teal-100 border-2 border-teal-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium text-gray-900 truncate">{p.displayName}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{p.family}</p>
                    </div>
                    <span className="text-gray-300 text-[17px] shrink-0 leading-none">›</span>
                  </button>
                );
              })()
            ) : (
              <>
                {/* Selected section — pinned at top while multi-selecting */}
                {bill.selectedProducts.length > 0 && (
                  <>
                    <div className="px-[13px] py-[6px] bg-gray-50 border-b border-[#f0f0f0]">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        Selected ({bill.selectedProducts.length})
                      </span>
                    </div>
                    {bill.selectedProducts.map((product) => (
                      <div
                        key={`sel-${product.subProduct}|||${product.baseColour ?? ""}`}
                        onClick={() => onToggleProduct(product)}
                        className="flex items-center gap-[10px] px-[13px] py-[10px] border-b border-[#f0f0f0] bg-teal-50/30 cursor-pointer active:bg-teal-50/60"
                      >
                        <div className="w-5 h-5 rounded-[6px] border-2 bg-teal-600 border-teal-600 flex items-center justify-center shrink-0">
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-gray-900 truncate">{product.displayName}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">{product.family}</p>
                        </div>
                        <span
                          className="text-gray-300 text-[18px] leading-none shrink-0 px-1"
                          aria-label="Deselect"
                        >
                          ×
                        </span>
                      </div>
                    ))}
                    {unselectedSuggestions.length > 0 && (
                      <div className="px-[13px] py-[6px] bg-gray-50 border-b border-[#f0f0f0]">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                          Results
                        </span>
                      </div>
                    )}
                  </>
                )}

                {/* Results — paginated, checkbox each row, swipe to navigate.
                    touchStart writes the start clientX onto the container's
                    DOM dataset; touchEnd reads it and decides next/prev.
                    The 40px threshold lets ordinary taps (toggle row) pass
                    through without registering as a swipe. */}
                <div
                  onTouchStart={(e) => {
                    const t = e.touches[0];
                    e.currentTarget.dataset.touchStartX = String(t.clientX);
                  }}
                  onTouchEnd={(e) => {
                    const startStr = e.currentTarget.dataset.touchStartX ?? "0";
                    const startX   = parseFloat(startStr);
                    const endX     = e.changedTouches[0].clientX;
                    const diff     = startX - endX;
                    if (Math.abs(diff) < 40) return;
                    if (diff > 0 && currentPage < totalPages - 1) {
                      onGoToPage(currentPage + 1);     // swipe left → next
                    } else if (diff < 0 && currentPage > 0) {
                      onGoToPage(currentPage - 1);     // swipe right → prev
                    }
                  }}
                  className="select-none"
                >
                  {pageItems.map((p, pageIdx) => {
                    const globalIdx     = currentPage * SUGGESTION_PAGE_SIZE + pageIdx;
                    const isHighlighted = globalIdx === bill.highlightedIndex;
                    return (
                      <div
                        id={`sugg-${bill.id}-${globalIdx}`}
                        key={`res-${p.subProduct}|||${p.baseColour ?? ""}`}
                        onClick={() => onToggleProduct(p)}
                        className={`flex items-center gap-[10px] px-[13px] py-[11px] border-b border-[#f0f0f0] cursor-pointer ${
                          isHighlighted ? "bg-teal-50 outline-none" : "active:bg-teal-50"
                        }`}
                      >
                        <div className="w-5 h-5 rounded-[6px] border-2 bg-white border-gray-300 flex items-center justify-center shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-medium text-gray-900 truncate">{p.displayName}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">{p.family}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Page dot indicators — active = wide teal pill, others = small gray circles */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-[6px] py-[8px] border-b border-[#f0f0f0]">
                    {Array.from({ length: totalPages }).map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onGoToPage(i)}
                        aria-label={`Page ${i + 1}`}
                        className={`rounded-full transition-all cursor-pointer ${
                          i === currentPage
                            ? "w-[18px] h-[6px] bg-teal-600"
                            : "w-[6px] h-[6px] bg-gray-200"
                        }`}
                      />
                    ))}
                  </div>
                )}

              </>
            )}
          </div>
        );
      })()}

      {/* Set Quantities bar — sticky to the visual viewport bottom so it
          stays above the keyboard regardless of how long the results list
          is. Lives at bill-card level (outside the multi-select block) so
          it's also visible when search has been cleared but the basket
          still has selections. Hidden during picking — that mode has its
          own Skip/Next sticky bar. */}
      {bill.selectedProducts.length > 0 && !inPicking && (
        <div className="sticky bottom-0 bg-teal-50 border-t border-teal-200 px-[13px] py-[10px] rounded-b-[14px] z-10 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-teal-700">
            {bill.selectedProducts.length} product{bill.selectedProducts.length > 1 ? "s" : ""} selected
          </span>
          <button
            type="button"
            onClick={onStartPicking}
            className="bg-teal-600 hover:bg-teal-700 text-white text-[13px] font-semibold px-4 py-2 rounded-[8px]"
          >
            Set Quantities →
          </button>
        </div>
      )}

      {/* Picker — progress + product header + pack counters + Skip/Next bar */}
      {inPicking && bill.activeProduct && (
        <>
          {/* Progress dots + count */}
          <div className="flex items-center gap-2 px-[14px] py-[8px] bg-[#fafafa] border-b border-[#f0f0f0]">
            <div className="flex gap-[5px]">
              {bill.selectedProducts.map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full ${
                    i < bill.pickerIndex
                      ? "bg-teal-600"
                      : i === bill.pickerIndex
                        ? "bg-teal-600 ring-2 ring-teal-100"
                        : "bg-gray-200"
                  }`}
                />
              ))}
            </div>
            <span className="text-[11px] text-gray-400 ml-auto">
              {bill.pickerIndex + 1} of {bill.selectedProducts.length}
            </span>
          </div>

          {/* Product header (no Change button — flow exits via Skip-to-end) */}
          <div className="px-[14px] py-[10px] bg-teal-50 border-b border-teal-200">
            <p className="text-[13px] font-semibold text-teal-700 truncate">{bill.activeProduct.displayName}</p>
            <p className="text-[11px] text-teal-400 mt-0.5">
              {bill.activeProduct.family}
              {bill.activeProduct.tinterType ? ` · ${bill.activeProduct.tinterType}` : ""}
            </p>
          </div>

          {/* Skip + Next/Add-All bar — placed at the top of the qty card so it
              never overlaps qty rows or hides behind the iOS soft keyboard. */}
          <div className="bg-white border-b border-[#f0f0f0] px-[14px] py-[10px] flex gap-2">
            <button
              type="button"
              onClick={() => onNextProduct(true)}
              className="text-[12px] font-medium text-gray-500 bg-gray-100 active:bg-gray-200 rounded-[9px] px-4 h-10 shrink-0"
            >
              Skip
            </button>
            <button
              ref={nextButtonRef}
              type="button"
              onClick={() => onNextProduct(false)}
              className="flex-1 h-10 bg-teal-600 hover:bg-teal-700 text-white rounded-[9px] text-[13px] font-semibold truncate min-w-0 px-3"
            >
              {nextProductInQueue
                ? `Next → ${nextProductInQueue.displayName}`
                : "+ Add All to Bill"}
            </button>
          </div>

          {/* Pack counters — step multiples align taps with cartons. Pack
              qty inputs receive Tab + Enter via packInputsRef; the +/-
              buttons are tabIndex={-1} so Tab walks input → input. */}
          {sortedPacks.map((pack, i) => {
            const qty   = bill.packQtys[pack] ?? 0;
            const label = formatPack(pack);
            const step  = packStep(label);
            return (
              <div
                key={pack}
                className="flex items-center gap-3 px-[14px] py-[10px] border-b border-[#f0f0f0]"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium">{label}</p>
                  {step > 1 && (
                    <p className="text-[10px] text-gray-400 mt-0.5">per {step}</p>
                  )}
                </div>
                <div className="flex items-center bg-gray-100 rounded-[9px] overflow-hidden shrink-0">
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => onStepPack(pack, -1)}
                    className={`w-9 h-9 flex items-center justify-center text-[20px] font-light bg-transparent border-none ${
                      qty === 0 ? "text-gray-300" : "text-teal-600"
                    }`}
                    aria-label={`Decrease ${label}`}
                  >
                    −
                  </button>
                  <input
                    ref={(el) => { if (el) packInputsRef.current[i] = el; }}
                    type="number"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    min={0}
                    value={qty}
                    onChange={(e) => onSetPack(pack, e.target.value)}
                    onFocus={(e) => {
                      e.target.select();
                      // Scroll focused row above the keyboard on iOS.
                      // requestAnimationFrame defers until after the keyboard begins to
                      // open so the layout has settled before we measure & scroll.
                      requestAnimationFrame(() => {
                        e.target.scrollIntoView({ block: "center", behavior: "smooth" });
                      });
                    }}
                    onKeyDown={(e) => handlePackKeyDown(e, i)}
                    className="w-10 text-center text-[16px] font-bold bg-transparent border-none outline-none"
                    style={{ color: qty > 0 ? "#0d9488" : "#111827" }}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => onStepPack(pack, 1)}
                    className="w-9 h-9 flex items-center justify-center text-[20px] font-light text-teal-600 bg-transparent border-none"
                    aria-label={`Increase ${label}`}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}

        </>
      )}

    </div>
  );
});

// Inline mic-icon SVG used by the search row in BillCard.
function MicSvg(): React.JSX.Element {
  return (
    <svg
      width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}
