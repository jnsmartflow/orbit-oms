"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Mic, Check, ChevronLeft, Plus } from "lucide-react";
import type { RawPack } from "@/lib/place-order/pack-buckets";
import type { Product, CartLine, Bill, Customer } from "@/app/(place-order)/place-order/types";
import { rankProductsForQuery } from "@/lib/place-order/mobile-search";
import { formatPack, packToMl, packStep, packKey } from "@/lib/place-order/pack";
import { getBaseAliasDisplay } from "@/lib/place-order/base-aliases";
import { getSecondLine, isVariantQualifierTab } from "@/lib/place-order/sub-product-descriptors";

// /po — new public mobile order page. PHASE 2 (search + add, build screen).
//   - live ranked product search on the locked-customer hero bar
//     (rankProductsForQuery, reused from lib/place-order/mobile-search)
//   - tap a result → single-product quantity picking (qty rows, units,
//     +/- by box step, 16px inputs — pack logic reused from
//     lib/place-order/pack)
//   - Done → commit a canonical CartLine into /po cart state, persist to
//     the orbitoms_po_draft key, flash an "Added" toast, return to search
//   - voice (Web Speech API, en-IN) wired onto the hero search; mic stays
//     visible whenever search is active (fixes the /order picking quirk)
//
// Cart state already holds MULTIPLE bills internally (Bill 1 default) so
// Phase 3 can add the bill strip + bottom cart bar without reshaping data.
// The visible cart bar / bill strip and the email send (cartToMailtoBody)
// are intentionally NOT built here — Phase 3 / Phase 4.
//
// Modelled on app/order/page.tsx (the FROZEN backup, NOT edited here).

// ── SpeechRecognition types (not in default lib.dom.d.ts) ──────────────────
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

// ── Draft persistence — dedicated key, never /order's or desktop's ─────────
const PO_DRAFT_KEY    = "orbitoms_po_draft";
const PO_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;   // 24h, matches desktop convention

// Full order snapshot persisted under PO_DRAFT_KEY. Phase 2 stores customer +
// bills (cart). Phase 4 will extend with shipTo / dispatch / marker.
type PoDraft = {
  customer:     Customer;
  bills:        Bill[];
  billCounter:  number;
  activeBillId: number;
  updatedAt:    number;
};

// Returns the persisted snapshot from a non-stale draft, else null. Stale or
// malformed entries are evicted on read.
function loadPoDraft(): Omit<PoDraft, "updatedAt"> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PO_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PoDraft>;
    if (!parsed || !parsed.customer || typeof parsed.updatedAt !== "number") {
      return null;
    }
    if (Date.now() - parsed.updatedAt > PO_DRAFT_TTL_MS) {
      window.localStorage.removeItem(PO_DRAFT_KEY);
      return null;
    }
    return {
      customer:     parsed.customer,
      bills:        Array.isArray(parsed.bills) && parsed.bills.length > 0
                      ? parsed.bills
                      : [{ id: 1, lines: [] }],
      billCounter:  typeof parsed.billCounter === "number" ? parsed.billCounter : 1,
      activeBillId: typeof parsed.activeBillId === "number" ? parsed.activeBillId : 1,
    };
  } catch {
    return null;
  }
}

function savePoDraft(snapshot: Omit<PoDraft, "updatedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const entry: PoDraft = { ...snapshot, updatedAt: Date.now() };
    window.localStorage.setItem(PO_DRAFT_KEY, JSON.stringify(entry));
  } catch {
    // Quota exceeded / private mode — silently drop. The email is the record
    // of truth; a missing draft just means the user re-builds after refresh.
  }
}

function clearPoDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PO_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

// ── Display helpers (mirrors /order) ───────────────────────────────────────

// Sort RawPacks for display: KG anchored last, otherwise by ML magnitude.
// Mirrors the /order page + the /api/order/data comparator.
function sortRawPacks(packs: RawPack[]): RawPack[] {
  return [...packs].sort((a, b) => {
    const aKg = (a.unit ?? "").toUpperCase() === "KG";
    const bKg = (b.unit ?? "").toUpperCase() === "KG";
    if (aKg !== bKg) return aKg ? 1 : -1;
    return packToMl(a.packCode, a.unit) - packToMl(b.packCode, b.unit);
  });
}

// "{displayName} — {baseColour}" unless displayName already contains the base.
function productLabel(p: { displayName: string; baseColour: string | null }): string {
  if (!p.baseColour) return p.displayName;
  if (p.displayName.toUpperCase().includes(p.baseColour.toUpperCase())) {
    return p.displayName;
  }
  return `${p.displayName} — ${p.baseColour}`;
}

// Faint "· {alias}" suffix after the label. Suppressed for variant-qualifier
// tabs (they carry the qualifier on the light second line instead).
function aliasSuffix(
  p: { product: string | null; baseColour: string | null; family?: string; subProduct?: string },
): React.JSX.Element | null {
  if (isVariantQualifierTab(p.family, p.subProduct)) return null;
  const a = getBaseAliasDisplay(p.product, p.baseColour);
  return a ? <span className="font-normal text-gray-400"> · {a}</span> : null;
}

export default function PoPage(): React.JSX.Element {
  const [customers,   setCustomers]   = useState<Customer[]>([]);
  const [products,    setProducts]    = useState<Product[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const [selectedCust, setSelectedCust] = useState<Customer | null>(null);
  const [custQuery,    setCustQuery]    = useState("");

  // Hero product search.
  const [heroQuery, setHeroQuery] = useState("");

  // Build-screen mode + the product currently being quantity-picked.
  const [mode,          setMode]          = useState<"search" | "picking">("search");
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  // Quantity entry — keyed by composite packKey("<packCode>|<unit>") so a 5 KG
  // and 5 L SKU never collide, and the CartLine is Phase-4 buildEmail-ready.
  const [packQtys, setPackQtys] = useState<Record<string, number>>({});

  // Cart — multiple bills internally (Bill 1 default). UI for switching bills
  // arrives in Phase 3; activeBillId already drives which bill an add lands in.
  const [bills,        setBills]        = useState<Bill[]>([{ id: 1, lines: [] }]);
  const [billCounter,  setBillCounter]  = useState(1);
  const [activeBillId, setActiveBillId] = useState(1);

  // Brief "Added · {product}" confirmation toast.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Voice input (Web Speech API).
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening,       setListening]       = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const custInputRef  = useRef<HTMLInputElement | null>(null);
  const heroInputRef  = useRef<HTMLInputElement | null>(null);
  const packInputsRef = useRef<HTMLInputElement[]>([]);

  // ── Data ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/order/data")
      .then((r) => r.json())
      .then((data: { customers?: Customer[]; products?: Product[] }) => {
        setCustomers(data.customers ?? []);
        setProducts(data.products ?? []);
      })
      .catch(() => { /* silent — search just shows nothing */ })
      .finally(() => setDataLoading(false));
  }, []);

  // Restore customer + cart from a non-stale draft on mount.
  useEffect(() => {
    const saved = loadPoDraft();
    if (saved) {
      setSelectedCust(saved.customer);
      setBills(saved.bills);
      setBillCounter(saved.billCounter);
      setActiveBillId(saved.activeBillId);
    }
  }, []);

  // Detect SpeechRecognition support (client-only).
  useEffect(() => {
    if (typeof window !== "undefined"
        && (window.SpeechRecognition || window.webkitSpeechRecognition)) {
      setSpeechSupported(true);
    }
  }, []);

  // Stop recognition + clear toast timer on unmount.
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Keyboard-aware viewport sizing — carried over from /order verbatim in
  // behaviour. Writes visualViewport.height into a --vvh CSS var (straight to
  // documentElement.style, NOT React state — avoids a render storm on every
  // resize tick). <main> consumes it as its explicit height.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    function update(): void {
      const h = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty("--vvh", `${h}px`);
    }
    update();   // sync write so --vvh has a value before first paint
    if (!vv) return;
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Mount auto-focus the customer search — DESKTOP ONLY (matches /order).
  useEffect(() => {
    if (dataLoading || selectedCust) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    custInputRef.current?.focus();
  }, [dataLoading, selectedCust]);

  // Picking-entry effect: scroll the first qty row into view (scroll-only,
  // §15.5 rule 3). Auto-focus the first qty input is DESKTOP ONLY — mobile
  // never pops the keyboard, dodging the iOS scrollIntoView+keyboard race.
  useEffect(() => {
    if (mode !== "picking" || !activeProduct) return;
    const id = requestAnimationFrame(() => {
      const first = packInputsRef.current[0];
      first?.scrollIntoView({ block: "start", behavior: "smooth" });
      if (typeof window !== "undefined"
          && window.matchMedia("(min-width: 768px)").matches) {
        first?.focus();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [mode, activeProduct]);

  // ── Customer handlers (modelled on /order) ────────────────────────────────
  const custSuggestions = useMemo<Customer[]>(() => {
    if (custQuery.length < 2) return [];
    const q = custQuery.toLowerCase();
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || c.code.includes(q))
      .slice(0, 5);
  }, [custQuery, customers]);

  function persist(nextBills: Bill[], nextCounter: number, nextActiveId: number): void {
    if (!selectedCust) return;
    savePoDraft({
      customer:     selectedCust,
      bills:        nextBills,
      billCounter:  nextCounter,
      activeBillId: nextActiveId,
    });
  }

  function selectCustomer(c: Customer): void {
    setSelectedCust(c);
    setCustQuery("");
    savePoDraft({
      customer: c, bills, billCounter, activeBillId,
    });
  }

  function clearCustomer(): void {
    if (listening) stopListening();
    setSelectedCust(null);
    setCustQuery("");
    setHeroQuery("");
    setMode("search");
    setActiveProduct(null);
    setPackQtys({});
    const freshBills: Bill[] = [{ id: 1, lines: [] }];
    setBills(freshBills);
    setBillCounter(1);
    setActiveBillId(1);
    clearPoDraft();
  }

  // ── Search → pick ─────────────────────────────────────────────────────────
  const suggestions = useMemo<Product[]>(() => {
    if (heroQuery.trim().length < 2) return [];
    return rankProductsForQuery(products, heroQuery).slice(0, 50);
  }, [heroQuery, products]);

  function pickProduct(p: Product): void {
    if (listening) stopListening();
    setActiveProduct(p);
    setPackQtys({});
    packInputsRef.current = [];
    setMode("picking");
  }

  function cancelPicking(): void {
    setMode("search");
    setActiveProduct(null);
    setPackQtys({});
  }

  // ── Quantity cell semantics (units; +/- by box step) ──────────────────────
  function stepPack(key: string, label: string, delta: number): void {
    const step = packStep(label);
    setPackQtys((prev) => {
      const cur = prev[key] ?? 0;
      return { ...prev, [key]: Math.max(0, cur + delta * step) };
    });
  }

  function setPackRaw(key: string, raw: string): void {
    const parsed = parseInt(raw, 10);
    const qty = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    setPackQtys((prev) => ({ ...prev, [key]: qty }));
  }

  const anyQty = Object.values(packQtys).some((q) => q > 0);

  // ── Done → commit a CartLine into the active bill ─────────────────────────
  function commitLine(): void {
    if (!activeProduct) return;
    const filtered: Record<string, number> = {};
    for (const [k, v] of Object.entries(packQtys)) {
      if (v > 0) filtered[k] = v;
    }
    if (Object.keys(filtered).length === 0) {
      cancelPicking();   // nothing entered — treat as a silent back-out
      return;
    }

    const line: CartLine = {
      productId:   activeProduct.id,
      family:      activeProduct.family,
      subProduct:  activeProduct.subProduct,
      product:     activeProduct.product ?? null,
      uiGroup:     activeProduct.uiGroup ?? null,
      displayName: activeProduct.displayName,
      baseColour:  activeProduct.baseColour ?? null,
      packQtys:    filtered,
      touchedAt:   Date.now(),
    };

    // Replace any existing line for the same catalog row in the active bill
    // (dedup by productId — mirrors /order), else append.
    const nextBills = bills.map((b) => {
      if (b.id !== activeBillId) return b;
      const kept = b.lines.filter((l) => l.productId !== line.productId);
      return { ...b, lines: [...kept, line] };
    });
    setBills(nextBills);
    persist(nextBills, billCounter, activeBillId);

    // Toast.
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(`Added · ${productLabel(activeProduct)}`);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);

    // Return to search. Clear the query so the next hunt starts fresh.
    setMode("search");
    setActiveProduct(null);
    setPackQtys({});
    setHeroQuery("");

    // Desktop-only refocus of the hero search (NO mobile auto-focus — §15.4).
    if (typeof window !== "undefined"
        && window.matchMedia("(min-width: 768px)").matches) {
      requestAnimationFrame(() => heroInputRef.current?.focus());
    }
  }

  // ── Voice (Web Speech API, en-IN) ─────────────────────────────────────────
  function startListening(): void {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang            = "en-IN";
    recognition.continuous      = false;
    recognition.interimResults  = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript.trim()) setHeroQuery(transcript.trim());
    };
    recognition.onerror = () => { setListening(false); recognitionRef.current = null; };
    recognition.onend   = () => { setListening(false); recognitionRef.current = null; };

    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
      recognitionRef.current = null;
    }
  }

  function stopListening(): void {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setListening(false);
  }

  function toggleMic(): void {
    if (listening) stopListening();
    else           startListening();
  }

  const hasAnyLines    = bills.some((b) => b.lines.length > 0);
  const sortedPacks    = activeProduct ? sortRawPacks(activeProduct.packs) : [];
  const heroPlaceholder = hasAnyLines ? "Search next product" : "Search products to add";

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <main
      className="bg-[#f9fafb] overflow-y-auto"
      style={{ height: "var(--vvh, 100vh)" }}
    >
      <div className="max-w-[480px] mx-auto flex flex-col min-h-full">

        {!selectedCust ? (
          /* ── Pick a customer ───────────────────────────────────────────── */
          <div className="px-4 pt-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2 pl-0.5">
              Customer
            </p>
            <div className="bg-white rounded-[14px] overflow-hidden shadow-sm border border-gray-100">
              <div className="flex items-center gap-2.5 px-4 py-3">
                <Search className="w-4 h-4 text-gray-300 shrink-0" />
                <input
                  ref={custInputRef}
                  type="text"
                  value={custQuery}
                  onChange={(e) => setCustQuery(e.target.value)}
                  placeholder={dataLoading ? "Loading customers…" : "Name or customer code…"}
                  disabled={dataLoading}
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
                  {custSuggestions.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left border-b border-gray-50 last:border-b-0 active:bg-gray-50"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-teal-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] text-gray-900 truncate">{c.name}</p>
                        <p className="text-[12px] text-gray-400 font-mono mt-0.5 truncate">
                          {c.code}
                          {c.area && <span className="font-sans"> · {c.area}</span>}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── Customer locked — header + (search | picking) ─────────────── */
          <>
            <header className="sticky top-0 z-30 bg-white border-b border-gray-200">
              <div className="flex items-center justify-between px-4 py-[14px]">
                {mode === "picking" ? (
                  <button
                    type="button"
                    onClick={cancelPicking}
                    className="flex items-center gap-2 min-w-0 text-left"
                    aria-label="Back to search"
                  >
                    <ChevronLeft className="w-[18px] h-[18px] text-gray-500 shrink-0" />
                    <span className="text-[15px] font-semibold text-gray-900 truncate">
                      Back
                    </span>
                  </button>
                ) : (
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-gray-900 leading-tight truncate">
                      {selectedCust.name}
                    </div>
                    {selectedCust.code && (
                      <div className="text-[12px] text-gray-500 leading-tight truncate mt-px">
                        {selectedCust.code}
                      </div>
                    )}
                  </div>
                )}
                {mode !== "picking" && (
                  <button
                    type="button"
                    onClick={clearCustomer}
                    className="text-teal-700 text-[13px] font-medium px-[10px] py-[6px] -mr-[6px] shrink-0"
                  >
                    Change
                  </button>
                )}
              </div>
            </header>

            {/* "Added" toast */}
            {toast && mode === "search" && (
              <div className="mx-4 mt-3 flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-lg px-[13px] py-[9px] text-[13px] text-teal-700">
                <Check className="w-[15px] h-[15px] shrink-0" />
                <span className="truncate">{toast}</span>
              </div>
            )}

            {mode === "search" ? (
              <>
                {/* Hero search bar */}
                <div className="p-4">
                  <div className={`flex items-center gap-3 border rounded-full px-[18px] py-[14px] transition-shadow ${
                    listening
                      ? "border-teal-600 shadow-[0_0_0_3px_rgba(13,148,136,0.10)]"
                      : "border-gray-300 focus-within:border-teal-600 focus-within:shadow-[0_0_0_3px_rgba(13,148,136,0.10)]"
                  }`}>
                    <Search className={`w-[19px] h-[19px] shrink-0 ${listening ? "text-teal-600" : "text-gray-400"}`} />
                    {listening ? (
                      <span className="flex-1 text-[16px] font-medium text-teal-700">Listening…</span>
                    ) : (
                      <input
                        ref={heroInputRef}
                        type="text"
                        value={heroQuery}
                        onChange={(e) => setHeroQuery(e.target.value)}
                        placeholder={heroPlaceholder}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        className="flex-1 text-[16px] text-gray-900 bg-transparent border-none outline-none placeholder:text-gray-400"
                      />
                    )}
                    {/* Clear (only when typed and not listening) */}
                    {heroQuery && !listening && (
                      <button
                        type="button"
                        onClick={() => setHeroQuery("")}
                        className="shrink-0 text-gray-400 text-[18px] leading-none px-1"
                        aria-label="Clear"
                      >
                        ×
                      </button>
                    )}
                    {/* Mic — visible whenever search is active (supported). */}
                    {speechSupported && (
                      <button
                        type="button"
                        onClick={toggleMic}
                        aria-label={listening ? "Stop voice input" : "Start voice input"}
                        title={listening ? "Tap to stop" : "Tap to speak"}
                        className={
                          listening
                            ? "shrink-0 w-[34px] h-[34px] rounded-full bg-teal-600 text-white flex items-center justify-center"
                            : "shrink-0 text-teal-600"
                        }
                      >
                        <Mic className="w-[19px] h-[19px]" />
                      </button>
                    )}
                  </div>

                  {/* Voice listening dots (mockup state 5) */}
                  {listening && (
                    <div className="flex items-center justify-center gap-2 mt-3.5">
                      <span className="w-[7px] h-[7px] rounded-full bg-teal-600 animate-pulse" />
                      <span className="w-[7px] h-[7px] rounded-full bg-teal-200" />
                      <span className="w-[7px] h-[7px] rounded-full bg-teal-200" />
                      <span className="text-[12px] text-gray-400 ml-1.5">say a product name</span>
                    </div>
                  )}
                </div>

                {/* Results (mockup state 2) */}
                {!listening && heroQuery.trim().length >= 2 && (
                  <div className="px-4">
                    {suggestions.length === 0 ? (
                      <div className="py-[13px] text-[15px] text-gray-500 italic border-b border-gray-100">
                        No products match {heroQuery.trim()}
                      </div>
                    ) : (
                      suggestions.map((p) => {
                        const second = getSecondLine(
                          p.family, p.subProduct,
                          getBaseAliasDisplay(p.product, p.baseColour),
                        );
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => pickProduct(p)}
                            className="w-full flex items-center gap-3 py-[13px] px-1 text-left border-b border-gray-100 last:border-b-0 active:bg-gray-50"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-[15px] text-gray-900 truncate">
                                {productLabel(p)}{aliasSuffix(p)}
                              </p>
                              {second && (
                                <p className="text-[12px] text-gray-400 truncate mt-0.5">{second}</p>
                              )}
                            </div>
                            <Plus className="w-[18px] h-[18px] text-teal-600 shrink-0" />
                          </button>
                        );
                      })
                    )}
                  </div>
                )}

                {/* Empty hint — only with no query and an empty cart */}
                {!listening && heroQuery.trim().length < 2 && !hasAnyLines && (
                  <div className="mt-auto px-[18px] py-[18px] text-center text-[13px] text-gray-400">
                    Add products to start the order
                  </div>
                )}
              </>
            ) : (
              /* ── Quantity picking (single product) ────────────────────── */
              activeProduct && (
                <>
                  <div className="px-4 pt-4 pb-2">
                    <div className="text-[17px] font-semibold text-gray-900 leading-tight">
                      {productLabel(activeProduct)}{aliasSuffix(activeProduct)}
                    </div>
                    {getSecondLine(
                      activeProduct.family, activeProduct.subProduct,
                      getBaseAliasDisplay(activeProduct.product, activeProduct.baseColour),
                    ) && (
                      <div className="text-[13px] text-gray-400 leading-tight mt-0.5">
                        {getSecondLine(
                          activeProduct.family, activeProduct.subProduct,
                          getBaseAliasDisplay(activeProduct.product, activeProduct.baseColour),
                        )}
                      </div>
                    )}
                  </div>

                  <div className="bg-white border-y border-gray-200">
                    {sortedPacks.length === 0 ? (
                      <div className="px-4 py-4 text-[13px] text-gray-400 italic">
                        No packs available for this product.
                      </div>
                    ) : (
                      sortedPacks.map((rp, i) => {
                        const key      = packKey(rp.packCode, rp.unit);
                        const label    = formatPack(rp.packCode, rp.unit);
                        const step     = packStep(label);
                        const qty      = packQtys[key] ?? 0;
                        const onlyPack = sortedPacks.length === 1;
                        return (
                          <div
                            key={key}
                            className={`flex items-center gap-3 px-4 ${onlyPack ? "py-[18px]" : "py-[12px]"} border-b border-gray-100 last:border-b-0 scroll-mt-[80px]`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className={`${onlyPack ? "text-[16px]" : "text-[15px]"} font-medium text-gray-900`}>{label}</p>
                              {step > 1 && (
                                <p className="text-[10px] text-gray-400 mt-0.5">per {step}</p>
                              )}
                            </div>
                            <div className="flex items-center bg-gray-100 rounded-[9px] overflow-hidden shrink-0">
                              <button
                                type="button"
                                tabIndex={-1}
                                onClick={() => stepPack(key, label, -1)}
                                className={`w-9 h-9 flex items-center justify-center text-[20px] font-light bg-transparent border-none ${qty === 0 ? "text-gray-300" : "text-teal-600"}`}
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
                                onChange={(e) => setPackRaw(key, e.target.value)}
                                onFocus={(e) => {
                                  e.target.select();
                                  requestAnimationFrame(() => {
                                    e.target.scrollIntoView({ block: "center", behavior: "smooth" });
                                  });
                                }}
                                className={`w-10 text-center text-[16px] font-bold bg-transparent outline-none ${qty === 0 ? "border-b border-dashed border-gray-300" : "border-none"}`}
                                style={{ color: qty > 0 ? "#0d9488" : "#111827" }}
                              />
                              <button
                                type="button"
                                tabIndex={-1}
                                onClick={() => stepPack(key, label, 1)}
                                className="w-9 h-9 flex items-center justify-center text-[20px] font-light text-teal-600 bg-transparent border-none"
                                aria-label={`Increase ${label}`}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Action bar — sits near the top of the qty card (not
                      sticky-bottom) so it never hides behind the soft keyboard. */}
                  <div className="flex gap-2 px-4 py-3">
                    <button
                      type="button"
                      onClick={cancelPicking}
                      className="px-[14px] py-[12px] text-gray-500 hover:text-gray-700 text-[14px] font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={commitLine}
                      disabled={!anyQty}
                      className={`flex-1 rounded-[10px] text-[15px] font-semibold px-4 py-[12px] ${
                        anyQty
                          ? "bg-teal-600 hover:bg-teal-700 text-white"
                          : "bg-gray-200 text-gray-400 cursor-not-allowed"
                      }`}
                    >
                      Add to Bill {activeBillId}
                    </button>
                  </div>
                </>
              )
            )}
          </>
        )}
      </div>
    </main>
  );
}
