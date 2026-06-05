"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Mic, Check, ChevronLeft, ChevronDown, ChevronRight, Plus, Pencil, Send, RefreshCw } from "lucide-react";
import type { RawPack } from "@/lib/place-order/pack-buckets";
import type { Product, CartLine, Bill, Customer } from "@/app/(place-order)/place-order/types";
import { rankProductsForQuery } from "@/lib/place-order/mobile-search";
import { formatPack, packToMl, packStep, packKey, parsePackKey } from "@/lib/place-order/pack";
import { getBaseAliasDisplay } from "@/lib/place-order/base-aliases";
import { getSecondLine, isVariantQualifierTab } from "@/lib/place-order/sub-product-descriptors";

// /po — new public mobile order page. PHASE 2 (search + add, build screen).
//   - live ranked product search on the locked-customer hero bar
//     (rankProductsForQuery, reused from lib/place-order/mobile-search)
//   - tap a result → single-product quantity picking (qty rows, units,
//     +/- by box step, 16px inputs — pack logic reused from
//     lib/place-order/pack)
//   - Done → commit a canonical CartLine into /po cart state, persist to
//     the orbitoms_po_draft key, show a persistent "Added" banner, return to search
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

// Order-level fields (mirror /order's value sets exactly — they feed the email).
type Dispatch = "Normal" | "Hold" | "Urgent";
type Marker   = "Truck" | "Cross Delivery" | "DTS" | null;

// Email recipient — identical to /order.
const ORDER_TO = "surat.order@outlook.com";

// Sort pack entries KG-last, then by ML magnitude — the SAME comparator the
// /api/order/data feed + /order use, so the per-line pack order in the email
// matches /order byte-for-byte.
function sortPackEntries<T extends { packCode: string; unit: string | null }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const aKg = (a.unit ?? "").toUpperCase() === "KG";
    const bKg = (b.unit ?? "").toUpperCase() === "KG";
    if (aKg !== bKg) return aKg ? 1 : -1;
    return packToMl(a.packCode, a.unit) - packToMl(b.packCode, b.unit);
  });
}

// Email subject + body builder. MIRRORS app/order/page.tsx buildEmail()
// byte-for-byte (field order Customer/Dispatch/Marker/Ship To; blank line +
// "Bill {b.id}" only when >1 active bill; "{product ?? subProduct} {baseColour}
// {label}*{units}, …"; em-dash subject). Display aliases (§12/§13) are NEVER
// inserted — raw baseColour only, exactly like /order. cart.ts has no
// cartToMailtoBody helper and /order builds inline, so this mirrors /order
// (the authoritative byte-identical source) rather than lib/place-order/email.ts
// (which numbers bills by index, diverging on non-contiguous bill ids).
function buildEmailParts(args: {
  customer: Customer | null;
  bills:    Bill[];
  shipTo:   string;
  dispatch: Dispatch;
  marker:   Marker;
}): { subject: string; body: string; valid: boolean } {
  const { customer, bills, shipTo, dispatch, marker } = args;
  const name = customer?.name ?? "";
  const code = customer?.code ?? "";
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
      // CartLine.packQtys is keyed by composite "<packCode>|<unit>"; rebuild
      // the formatted "{label}*{units}" list in the same order /order emits
      // (the product's pack order = the KG-last/ML sort).
      const entries = sortPackEntries(
        Object.entries(l.packQtys)
          .filter(([, q]) => q > 0)
          .map(([k, q]) => {
            const { packCode, unit } = parsePackKey(k);
            return { packCode, unit, qty: q };
          }),
      );
      const packStr = entries
        .map((e) => `${formatPack(e.packCode, e.unit)}*${e.qty}`)
        .join(", ");
      const head = l.product ?? l.subProduct;
      const productText = l.baseColour ? `${head} ${l.baseColour}` : head;
      lines.push(`${productText} ${packStr}`);
    });
  });

  const subject = "Order"
    + (name ? ` — ${name}` : "")
    + (code ? ` ${code}`    : "");
  const valid = !!customer && activeBills.length > 0;

  return { subject, body: lines.join("\n"), valid };
}

// ── Draft persistence — dedicated key, never /order's or desktop's ─────────
const PO_DRAFT_KEY    = "orbitoms_po_draft";
const PO_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;   // 24h, matches desktop convention

// Full order snapshot persisted under PO_DRAFT_KEY: customer + bills (cart) +
// order-level review fields (shipTo / dispatch / marker).
type PoDraft = {
  customer:     Customer;
  bills:        Bill[];
  billCounter:  number;
  activeBillId: number;
  shipTo:       string;
  dispatch:     Dispatch;
  marker:       Marker;
  multiSelect:  boolean;
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
      shipTo:       typeof parsed.shipTo === "string" ? parsed.shipTo : "",
      dispatch:     parsed.dispatch === "Hold" || parsed.dispatch === "Urgent"
                      ? parsed.dispatch : "Normal",
      marker:       parsed.marker === "Truck" || parsed.marker === "Cross Delivery" || parsed.marker === "DTS"
                      ? parsed.marker : null,
      multiSelect:  typeof parsed.multiSelect === "boolean" ? parsed.multiSelect : false,
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
  p: { product?: string | null; baseColour: string | null; family?: string; subProduct?: string },
): React.JSX.Element | null {
  if (isVariantQualifierTab(p.family, p.subProduct)) return null;
  const a = getBaseAliasDisplay(p.product, p.baseColour);
  return a ? <span className="font-normal text-gray-400"> · {a}</span> : null;
}

// Pack-quantity rows for one product. The single (exact) pack-row UI used by
// BOTH the single picker and the multi-select set-quantities screen: pack
// label + "per N" sub-label (left), −/16px input/+ stepper (right), dashed
// underline at 0. `showBoxNote` adds the mockup's "{N} box" note under the
// stepper (multi-qty screen only — single picker passes it false, staying
// byte-identical). `registerInput` lets the single picker keep its
// packInputsRef for desktop focus/scroll.
function PackRows({
  product, qtys, onStep, onSet, showBoxNote = false, registerInput,
}: {
  product:       Product;
  qtys:          Record<string, number>;
  onStep:        (key: string, label: string, delta: number) => void;
  onSet:         (key: string, raw: string) => void;
  showBoxNote?:  boolean;
  registerInput?: (i: number, el: HTMLInputElement | null) => void;
}): React.JSX.Element {
  const sorted = sortRawPacks(product.packs);
  if (sorted.length === 0) {
    return (
      <div className="px-4 py-4 text-[13px] text-gray-400 italic">
        No packs available for this product.
      </div>
    );
  }
  return (
    <>
      {sorted.map((rp, i) => {
        const key      = packKey(rp.packCode, rp.unit);
        const label    = formatPack(rp.packCode, rp.unit);
        const step     = packStep(label);
        const qty      = qtys[key] ?? 0;
        const onlyPack = sorted.length === 1;
        const boxes    = step > 1 && qty > 0 && qty % step === 0 ? qty / step : null;
        const stepper = (
          <div className="flex items-center bg-gray-100 rounded-[9px] overflow-hidden shrink-0">
            <button
              type="button"
              tabIndex={-1}
              onClick={() => onStep(key, label, -1)}
              className={`w-9 h-9 flex items-center justify-center text-[20px] font-light bg-transparent border-none ${qty === 0 ? "text-gray-300" : "text-teal-600"}`}
              aria-label={`Decrease ${label}`}
            >
              −
            </button>
            <input
              ref={registerInput ? (el) => registerInput(i, el) : undefined}
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              min={0}
              value={qty}
              onChange={(e) => onSet(key, e.target.value)}
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
              onClick={() => onStep(key, label, 1)}
              className="w-9 h-9 flex items-center justify-center text-[20px] font-light text-teal-600 bg-transparent border-none"
              aria-label={`Increase ${label}`}
            >
              +
            </button>
          </div>
        );
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
            {showBoxNote ? (
              <div className="flex flex-col items-end gap-1 shrink-0">
                {stepper}
                {boxes != null && (
                  <span className="text-[11px] text-teal-700 font-mono">{boxes} box</span>
                )}
              </div>
            ) : stepper}
          </div>
        );
      })}
    </>
  );
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
  const [mode,          setMode]          = useState<"search" | "picking" | "multiqty">("search");
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  // Quantity entry — keyed by composite packKey("<packCode>|<unit>") so a 5 KG
  // and 5 L SKU never collide, and the CartLine is Phase-4 buildEmail-ready.
  const [packQtys, setPackQtys] = useState<Record<string, number>>({});

  // Cart — multiple bills internally (Bill 1 default). UI for switching bills
  // arrives in Phase 3; activeBillId already drives which bill an add lands in.
  const [bills,        setBills]        = useState<Bill[]>([{ id: 1, lines: [] }]);
  const [billCounter,  setBillCounter]  = useState(1);
  const [activeBillId, setActiveBillId] = useState(1);

  // Page view: build screen vs the review/send shell.
  const [view, setView] = useState<"build" | "review">("build");

  // Multi-select (default OFF, persisted). When ON, tapping a result toggles
  // selection instead of opening the single picker; "Set quantities" opens a
  // screen with every selected product's pack rows at once.
  const [multiSelect,      setMultiSelect]      = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Product[]>([]);
  // Per-product pack quantities for the multi-qty screen: productId → packKey → units.
  const [multiQtys,        setMultiQtys]        = useState<Record<number, Record<string, number>>>({});

  // Review-screen order-level fields (reused from /order's value sets).
  const [shipTo,      setShipTo]      = useState("");
  const [shipFocused, setShipFocused] = useState(false);
  const [dispatch,    setDispatch]    = useState<Dispatch>("Normal");
  const [marker,      setMarker]      = useState<Marker>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Persistent "last added" confirmation banner. Set on every add, replaced
  // by the newest, cleared only on a full reset (New order / change / Send).
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  // Voice input (Web Speech API).
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening,       setListening]       = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Reset confirm dialog — "new" (New order) or "change" (Switch customer).
  const [confirmKind, setConfirmKind] = useState<null | "new" | "change">(null);

  const custInputRef   = useRef<HTMLInputElement | null>(null);
  const heroInputRef   = useRef<HTMLInputElement | null>(null);
  const packInputsRef  = useRef<HTMLInputElement[]>([]);
  const confirmBtnRef  = useRef<HTMLButtonElement | null>(null);
  const cancelBtnRef   = useRef<HTMLButtonElement | null>(null);

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
      setShipTo(saved.shipTo);
      setDispatch(saved.dispatch);
      setMarker(saved.marker);
      setMultiSelect(saved.multiSelect);
    }
  }, []);

  // Detect SpeechRecognition support (client-only).
  useEffect(() => {
    if (typeof window !== "undefined"
        && (window.SpeechRecognition || window.webkitSpeechRecognition)) {
      setSpeechSupported(true);
    }
  }, []);

  // Stop recognition on unmount.
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
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

  // Confirm dialog: focus the confirm button on open, trap Tab between the two
  // buttons, Esc cancels. Accessible per the task spec.
  useEffect(() => {
    if (!confirmKind) return;
    const t = requestAnimationFrame(() => confirmBtnRef.current?.focus());
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        setConfirmKind(null);
      } else if (e.key === "Tab") {
        const first = cancelBtnRef.current;
        const last  = confirmBtnRef.current;
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [confirmKind]);

  // ── Customer handlers (modelled on /order) ────────────────────────────────
  const custSuggestions = useMemo<Customer[]>(() => {
    if (custQuery.length < 2) return [];
    const q = custQuery.toLowerCase();
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || c.code.includes(q))
      .slice(0, 5);
  }, [custQuery, customers]);

  // Build a full snapshot from current state, with optional overrides for the
  // value(s) being changed this tick (state setters haven't committed yet).
  function snapshot(
    overrides: Partial<Omit<PoDraft, "updatedAt" | "customer">> = {},
  ): Omit<PoDraft, "updatedAt"> | null {
    if (!selectedCust) return null;
    return {
      customer:     selectedCust,
      bills, billCounter, activeBillId, shipTo, dispatch, marker, multiSelect,
      ...overrides,
    };
  }

  function persist(nextBills: Bill[], nextCounter: number, nextActiveId: number): void {
    const s = snapshot({ bills: nextBills, billCounter: nextCounter, activeBillId: nextActiveId });
    if (s) savePoDraft(s);
  }

  function selectCustomer(c: Customer): void {
    setSelectedCust(c);
    setCustQuery("");
    savePoDraft({
      customer: c, bills, billCounter, activeBillId, shipTo, dispatch, marker, multiSelect,
    });
  }

  function clearCustomer(): void {
    if (listening) stopListening();
    setSelectedCust(null);
    setCustQuery("");
    setHeroQuery("");
    setMode("search");
    setView("build");
    setActiveProduct(null);
    setPackQtys({});
    const freshBills: Bill[] = [{ id: 1, lines: [] }];
    setBills(freshBills);
    setBillCounter(1);
    setActiveBillId(1);
    setShipTo("");
    setShipFocused(false);
    setDispatch("Normal");
    setMarker(null);
    setPreviewOpen(false);
    setMultiSelect(false);
    setSelectedProducts([]);
    setMultiQtys({});
    setLastAdded(null);
    clearPoDraft();
  }

  // ── New order / Change reset wiring ───────────────────────────────────────
  // clearCustomer() above is the FULL reset (all bills/cart/ship/dispatch/
  // marker/counters + removes the orbitoms_po_draft key + back to pick).

  // Brand-bar "New order": confirm, then full reset. No-op on a truly blank
  // slate (no customer, empty cart) — nothing to clear.
  function onNewOrder(): void {
    if (!selectedCust && !hasAnyLines) return;
    setConfirmKind("new");
  }

  // Customer "Change": confirm first only when the cart has lines; otherwise
  // go straight back to the customer picker (full reset).
  function onChange(): void {
    if (hasAnyLines) setConfirmKind("change");
    else             clearCustomer();
  }

  // Confirm dialog primary action.
  function confirmProceed(): void {
    clearCustomer();
    setConfirmKind(null);
  }

  // ── Multi-select ──────────────────────────────────────────────────────────
  function toggleMultiSelect(): void {
    const next = !multiSelect;
    setMultiSelect(next);
    if (!next) {            // turning OFF clears any in-progress ticks
      setSelectedProducts([]);
      setMultiQtys({});
    }
    const s = snapshot({ multiSelect: next });
    if (s) savePoDraft(s);
  }

  // Toggle a product in the selection (add/remove by id — mirrors /order's
  // toggleProductSelection).
  function toggleProductSelection(p: Product): void {
    setSelectedProducts((prev) =>
      prev.some((s) => s.id === p.id)
        ? prev.filter((s) => s.id !== p.id)
        : [...prev, p],
    );
  }

  function openMultiQty(): void {
    if (selectedProducts.length === 0) return;
    if (listening) stopListening();
    setMode("multiqty");
  }

  // Back from the multi-qty screen — preserve selection + typed quantities.
  function closeMultiQty(): void {
    setMode("search");
  }

  function stepMultiPack(productId: number, key: string, label: string, delta: number): void {
    const step = packStep(label);
    setMultiQtys((prev) => {
      const cur = prev[productId] ?? {};
      const nextQty = Math.max(0, (cur[key] ?? 0) + delta * step);
      return { ...prev, [productId]: { ...cur, [key]: nextQty } };
    });
  }

  function setMultiPackRaw(productId: number, key: string, raw: string): void {
    const parsed = parseInt(raw, 10);
    const qty = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    setMultiQtys((prev) => ({ ...prev, [productId]: { ...(prev[productId] ?? {}), [key]: qty } }));
  }

  // Commit ALL selected products (with qty > 0) as CartLines into the active
  // bill at once — dedup by productId, same as the single add.
  function commitMultiSelect(): void {
    const newLines: CartLine[] = [];
    for (const p of selectedProducts) {
      const pq = multiQtys[p.id] ?? {};
      const filtered: Record<string, number> = {};
      for (const [k, v] of Object.entries(pq)) {
        if (v > 0) filtered[k] = v;
      }
      if (Object.keys(filtered).length === 0) continue;   // skip products with no qty
      newLines.push({
        productId:   p.id,
        family:      p.family,
        subProduct:  p.subProduct,
        product:     p.product ?? null,
        uiGroup:     p.uiGroup ?? null,
        displayName: p.displayName,
        baseColour:  p.baseColour ?? null,
        packQtys:    filtered,
        touchedAt:   Date.now(),
      });
    }
    if (newLines.length === 0) return;

    const addedIds = new Set(newLines.map((l) => l.productId));
    const nextBills = bills.map((b) => {
      if (b.id !== activeBillId) return b;
      const kept = b.lines.filter((l) => l.productId === undefined || !addedIds.has(l.productId));
      return { ...b, lines: [...kept, ...newLines] };
    });
    setBills(nextBills);
    persist(nextBills, billCounter, activeBillId);

    setLastAdded(`Added ${newLines.length} ${newLines.length === 1 ? "product" : "products"}`);

    // Clear selection, return to the search results (toggle left as-is).
    setSelectedProducts([]);
    setMultiQtys({});
    setMode("search");
  }

  // ── Review-screen handlers ────────────────────────────────────────────────
  const shipSuggestions = useMemo<Customer[]>(() => {
    if (shipTo.length < 2) return [];
    const q = shipTo.toLowerCase();
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || c.code.includes(q))
      .slice(0, 5);
  }, [shipTo, customers]);

  function changeShipTo(v: string): void {
    setShipTo(v);
    const s = snapshot({ shipTo: v });
    if (s) savePoDraft(s);
  }

  function selectShipTo(c: Customer): void {
    const v = `${c.name} (${c.code})`;
    setShipTo(v);
    setShipFocused(false);
    const s = snapshot({ shipTo: v });
    if (s) savePoDraft(s);
  }

  function chooseDispatch(d: Dispatch): void {
    setDispatch(d);
    const s = snapshot({ dispatch: d });
    if (s) savePoDraft(s);
  }

  function chooseMarker(m: Marker): void {
    setMarker(m);
    const s = snapshot({ marker: m });
    if (s) savePoDraft(s);
  }

  // Remove a single line from a bill (reuses /order's deleteLineFromBill shape).
  function removeLine(billId: number, idx: number): void {
    const nextBills = bills.map((b) =>
      b.id === billId ? { ...b, lines: b.lines.filter((_, i) => i !== idx) } : b,
    );
    setBills(nextBills);
    persist(nextBills, billCounter, activeBillId);
  }

  // Edit a line: re-open the picker pre-filled with its qtys (/order's
  // edit = re-pick; commitLine then replaces it via productId dedup). The
  // catalog row must still exist.
  function editLine(billId: number, line: CartLine): void {
    const p = products.find((pr) => pr.id === line.productId);
    if (!p) return;
    if (listening) stopListening();
    setActiveBillId(billId);
    persist(bills, billCounter, billId);
    setActiveProduct(p);
    setPackQtys({ ...line.packQtys });
    packInputsRef.current = [];
    setView("build");
    setMode("picking");
  }

  // Bill header edit affordance — make this bill active + drop to build screen.
  function editBill(billId: number): void {
    setActiveBillId(billId);
    persist(bills, billCounter, billId);
    setView("build");
    setMode("search");
  }

  // "+ Add another bill" from review — create + activate + go build it.
  function addAnotherBill(): void {
    const id = billCounter + 1;
    const nextBills: Bill[] = [...bills, { id, lines: [] }];
    setBills(nextBills);
    setBillCounter(id);
    setActiveBillId(id);
    persist(nextBills, id, id);
    setView("build");
    setMode("search");
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

    // Persistent "last added" banner — product name only (no pack detail).
    setLastAdded(`Added · ${productLabel(activeProduct)}`);

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

  // ── Bill strip / review navigation ────────────────────────────────────────
  function switchBill(id: number): void {
    setActiveBillId(id);
    persist(bills, billCounter, id);
  }

  function addBill(): void {
    const id = billCounter + 1;
    const nextBills: Bill[] = [...bills, { id, lines: [] }];
    setBills(nextBills);
    setBillCounter(id);
    setActiveBillId(id);
    persist(nextBills, id, id);
  }

  function openReview(): void {
    if (listening) stopListening();
    setMode("search");
    setView("review");
  }

  function closeReview(): void {
    setView("build");
  }

  const hasAnyLines    = bills.some((b) => b.lines.length > 0);
  const heroPlaceholder = multiSelect
    ? "Search & tap to select"
    : (hasAnyLines ? "Search next product" : "Search products to add");

  // Multi-select bottom-bar gating + "Add" enablement.
  const showSelectBar = mode === "search" && multiSelect && selectedProducts.length >= 1;
  const anyMultiQty   = selectedProducts.some(
    (p) => Object.values(multiQtys[p.id] ?? {}).some((q) => q > 0),
  );

  // Cart totals. Units total = sum of line units — NEVER × packStep
  // (§10 cart totals / §22 landmine). Volume (Phase 4) would be
  // units × packToLitres per pack, also never × packStep.
  const billUnits  = (b: Bill): number =>
    b.lines.reduce((s, l) => s + Object.values(l.packQtys).reduce((a, q) => a + q, 0), 0);
  const totalUnits = bills.reduce((s, b) => s + billUnits(b), 0);
  const multiBill  = bills.length > 1;
  const reviewBills = bills.filter((b) => b.lines.length > 0);

  // Avatar initial for the customer block (first letter of name, uppercased).
  const custInitial = (selectedCust?.name?.trim().charAt(0) ?? "").toUpperCase() || "?";

  // Confirm-dialog copy, by intent.
  const confirmCopy = confirmKind === "change"
    ? { title: "Switch customer?", body: "This clears the current order.", cta: "Switch customer" }
    : { title: "Start a new order?", body: "This clears the current order and starts fresh. It can’t be undone.", cta: "New order" };

  // Email — byte-identical to /order. Computed each render (like /order).
  const { subject: emailSubject, body: emailBody, valid: canSend } =
    buildEmailParts({ customer: selectedCust, bills, shipTo, dispatch, marker });

  function handleSend(): void {
    if (!canSend) return;
    const url = `mailto:${ORDER_TO}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
    window.location.href = url;   // mailto: opens the mail app; page does not unload
    // Full reset so the next order starts empty (back to customer-pick).
    clearCustomer();
  }

  // §10 chips for a cart line: per pack "{label} ×{units}" + conditional
  // " · {N} box" when step > 1 && units > 0 && units % step === 0.
  function lineChips(line: CartLine): { label: string; units: number; boxes: number | null }[] {
    const entries = sortPackEntries(
      Object.entries(line.packQtys)
        .filter(([, q]) => q > 0)
        .map(([k, q]) => { const { packCode, unit } = parsePackKey(k); return { packCode, unit, qty: q }; }),
    );
    return entries.map((e) => {
      const label = formatPack(e.packCode, e.unit);
      const step  = packStep(label);
      const boxes = step > 1 && e.qty > 0 && e.qty % step === 0 ? e.qty / step : null;
      return { label, units: e.qty, boxes };
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <main
      className="bg-[#f9fafb] overflow-y-auto"
      style={{ height: "var(--vvh, 100vh)" }}
    >
      <div className="max-w-[480px] mx-auto flex flex-col min-h-full">

        {/* Brand bar — normal flow (scrolls away). The product search bar is the
            single top-pinned element, so brand/customer/bill rows scroll up
            above it. No sticky here → no stacked-sticky pixel fight. */}
        <header className="bg-white border-b border-gray-200">
          <div className="flex items-center justify-between px-4 py-[11px]">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-gray-900 leading-tight truncate">
                Purchase Order
              </div>
              <div className="text-[11px] text-gray-500 leading-tight truncate mt-px">
                JSW Dulux · Surat Depot
              </div>
            </div>
            <button
              type="button"
              onClick={onNewOrder}
              className="flex items-center gap-1.5 text-teal-700 text-[13px] font-medium shrink-0 pl-3 active:opacity-70"
            >
              <RefreshCw className="w-[15px] h-[15px]" /> New order
            </button>
          </div>
        </header>

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
        ) : view === "review" ? (
          /* ── Review & send (mockup state 6) ────────────────────────────── */
          <>
            <div className="bg-white border-b border-gray-200">
              <div className="flex items-center gap-2 px-4 py-[14px]">
                <button
                  type="button"
                  onClick={closeReview}
                  aria-label="Back to build"
                  className="flex items-center gap-2 text-left"
                >
                  <ChevronDown className="w-[18px] h-[18px] text-gray-500 shrink-0" />
                  <span className="text-[15px] font-semibold text-gray-900">Review &amp; send</span>
                </button>
              </div>
            </div>

            {/* Bills + lines */}
            {reviewBills.map((b) => (
              <div key={b.id} className="bg-white border-b border-gray-200 px-4 py-[13px]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] font-semibold text-gray-600">Bill {b.id}</span>
                  <button
                    type="button"
                    onClick={() => editBill(b.id)}
                    className="text-gray-400 active:text-gray-600 p-1 -mr-1"
                    aria-label={`Edit Bill ${b.id}`}
                  >
                    <Pencil className="w-[15px] h-[15px]" />
                  </button>
                </div>
                {b.lines.map((line, idx) => (
                  <div
                    key={`${line.productId}-${idx}`}
                    className="flex items-start gap-2 py-[6px] border-b border-gray-50 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => editLine(b.id, line)}
                      className="flex-1 min-w-0 text-left"
                      aria-label="Edit quantities"
                    >
                      <p className="text-[14px] text-gray-900 truncate">
                        {productLabel(line)}{aliasSuffix(line)}
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        {lineChips(line).map((c) => (
                          <span key={c.label} className="text-[12px] text-teal-700">
                            {c.label} <span className="font-mono">×{c.units}</span>
                            {c.boxes != null && (
                              <span className="text-gray-400 font-normal"> · {c.boxes} box</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeLine(b.id, idx)}
                      className="text-gray-300 text-[17px] leading-none shrink-0 px-1 active:text-gray-500"
                      aria-label="Remove line"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ))}

            {/* + Add another bill */}
            <div className="bg-white border-b border-gray-200 px-4 py-[12px]">
              <button
                type="button"
                onClick={addAnotherBill}
                className="flex items-center gap-1 text-[13px] text-teal-700 font-medium"
              >
                <Plus className="w-[14px] h-[14px]" /> Add another bill
              </button>
            </div>

            {/* Ship To */}
            <div className="bg-white border-b border-gray-200 px-4 py-[13px]">
              <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-[7px]">Ship to</p>
              <div className="flex items-center gap-2.5 border border-gray-200 rounded-lg px-3 py-[11px]">
                <Search className="w-4 h-4 text-gray-300 shrink-0" />
                <input
                  type="text"
                  value={shipTo}
                  onChange={(e) => changeShipTo(e.target.value)}
                  onFocus={() => setShipFocused(true)}
                  onBlur={() => setTimeout(() => setShipFocused(false), 150)}
                  placeholder="Same as billing"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="flex-1 text-[16px] text-gray-900 bg-transparent border-none outline-none placeholder:text-gray-400"
                />
                {shipTo && (
                  <button
                    type="button"
                    onClick={() => changeShipTo("")}
                    className="text-gray-300 text-lg leading-none px-1 shrink-0"
                    aria-label="Clear"
                  >
                    ×
                  </button>
                )}
              </div>
              {shipFocused && shipSuggestions.length > 0 && (
                <div className="border border-gray-100 rounded-lg mt-1 overflow-hidden">
                  {shipSuggestions.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectShipTo(c)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-gray-50 last:border-b-0 active:bg-gray-50"
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

            {/* Dispatch */}
            <div className="bg-white border-b border-gray-200 px-4 py-[13px]">
              <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-[7px]">Dispatch</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { label: "Normal", dot: "bg-teal-500",  on: "border-teal-500 bg-teal-50 text-teal-700" },
                  { label: "Hold",   dot: "bg-red-400",   on: "border-red-300 bg-red-50 text-red-700" },
                  { label: "Urgent", dot: "bg-amber-400", on: "border-amber-300 bg-amber-50 text-amber-700" },
                ] as const).map((d) => {
                  const on = dispatch === d.label;
                  return (
                    <button
                      key={d.label}
                      type="button"
                      onClick={() => chooseDispatch(d.label)}
                      className={`h-[42px] rounded-[10px] border text-[14px] flex items-center justify-center gap-1.5 ${
                        on ? `${d.on} font-semibold` : "border-gray-200 bg-white text-gray-400 font-medium"
                      }`}
                    >
                      <span className={`w-[7px] h-[7px] rounded-full ${d.dot}`} />
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Order Marker */}
            <div className="bg-white border-b border-gray-200 px-4 py-[13px]">
              <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-[7px]">
                Order marker <span className="text-gray-300 normal-case tracking-normal">· optional</span>
              </p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { label: "🚛 Truck", value: "Truck" as const },
                  { label: "🔄 Cross", value: "Cross Delivery" as const },
                  { label: "📦 DTS",   value: "DTS" as const },
                ]).map((m) => {
                  const on = marker === m.value;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => chooseMarker(on ? null : m.value)}
                      className={`h-[42px] rounded-[10px] border text-[13px] flex items-center justify-center ${
                        on
                          ? "border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold"
                          : "border-gray-200 bg-white text-gray-400 font-medium"
                      }`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preview (collapsible) — exact email body that will send */}
            <div className="bg-white border-b border-gray-200">
              <button
                type="button"
                onClick={() => setPreviewOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-[13px] text-left"
              >
                <span className="text-[14px] text-gray-600">Preview email</span>
                <ChevronDown
                  className={`w-[18px] h-[18px] text-gray-400 transition-transform ${previewOpen ? "rotate-180" : ""}`}
                />
              </button>
              {previewOpen && (
                <div className="px-4 pb-[14px]">
                  <p className="text-[11px] text-gray-400 mb-1">To: {ORDER_TO}</p>
                  <p className="text-[11px] text-gray-400 mb-2">Subject: {emailSubject}</p>
                  <pre className="text-[12px] text-gray-900 font-mono whitespace-pre-wrap break-words bg-gray-50 border border-gray-100 rounded-lg p-3">
{emailBody}
                  </pre>
                </div>
              )}
            </div>

            {/* Send — page-level sticky bottom */}
            <div className="sticky bottom-0 z-20 bg-white border-t border-gray-200 px-4 py-3 mt-auto">
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                className={`w-full h-[52px] rounded-[12px] text-[16px] font-semibold flex items-center justify-center gap-2 ${
                  canSend ? "bg-teal-600 active:bg-teal-700 text-white" : "bg-gray-200 text-gray-400 cursor-not-allowed"
                }`}
              >
                <Send className="w-[17px] h-[17px]" />
                Send order
              </button>
            </div>
          </>
        ) : (
          /* ── Customer locked — build screen (header + bill strip + search/picking + cart bar) ── */
          <>
            {mode === "picking" ? (
              /* Picking sub-header — Back */
              <div className="bg-white border-b border-gray-200 px-4 py-[14px]">
                <button
                  type="button"
                  onClick={cancelPicking}
                  className="flex items-center gap-2 min-w-0 text-left"
                  aria-label="Back to search"
                >
                  <ChevronLeft className="w-[18px] h-[18px] text-gray-500 shrink-0" />
                  <span className="text-[15px] font-semibold text-gray-900 truncate">Back</span>
                </button>
              </div>
            ) : (
              /* Distinct customer block — tinted band + teal avatar */
              <div className="bg-gray-50 border-b border-gray-200 px-4 py-[14px] flex items-center gap-3">
                <div className="w-[42px] h-[42px] rounded-full bg-teal-600 text-white flex items-center justify-center text-[17px] font-semibold shrink-0">
                  {custInitial}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-bold text-gray-900 truncate">
                    {selectedCust.name}
                  </div>
                  <div className="text-[12px] text-gray-500 mt-px truncate">
                    {selectedCust.code}{selectedCust.area ? ` · ${selectedCust.area}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onChange}
                  className="text-teal-700 text-[13px] font-medium shrink-0 pl-2"
                >
                  Change
                </button>
              </div>
            )}

            {/* Bill strip — directly under the customer header (search mode) */}
            {mode === "search" && (
              <div className="bg-white border-b border-gray-200 px-4 py-[9px] flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 overflow-x-auto">
                  {bills.length === 1 ? (
                    <span className="text-[13px] text-gray-500 shrink-0">Bill {bills[0].id}</span>
                  ) : (
                    bills.map((b) => {
                      const active = b.id === activeBillId;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => switchBill(b.id)}
                          className={
                            active
                              ? "shrink-0 text-[13px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-3 py-[3px]"
                              : "shrink-0 text-[13px] text-gray-500 px-2 py-[3px]"
                          }
                        >
                          Bill {b.id}
                        </button>
                      );
                    })
                  )}
                </div>
                <button
                  type="button"
                  onClick={addBill}
                  className="flex items-center gap-1 text-[13px] text-teal-700 font-medium shrink-0 pl-3"
                >
                  <Plus className="w-[14px] h-[14px]" /> Add bill
                </button>
              </div>
            )}

            {/* "Select multiple" toggle — between bill strip and search (default OFF) */}
            {mode === "search" && (
              <div className="bg-white border-b border-gray-200 px-4 py-[10px] flex items-center justify-between">
                <span className="text-[14px] text-gray-700">Select multiple</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={multiSelect}
                  aria-label="Select multiple products"
                  onClick={toggleMultiSelect}
                  className={`relative w-[46px] h-[26px] rounded-full transition-colors shrink-0 ${multiSelect ? "bg-teal-600" : "bg-gray-300"}`}
                >
                  <span
                    className={`absolute top-[2px] left-[2px] w-[22px] h-[22px] rounded-full bg-white shadow transition-transform ${multiSelect ? "translate-x-[20px]" : ""}`}
                  />
                </button>
              </div>
            )}

            {/* Persistent amber "last added" banner (replaces on each add,
                clears on full reset). */}
            {lastAdded && mode === "search" && (
              <div className="mx-4 mt-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-[13px] py-[9px] text-[13px] text-amber-700">
                <Check className="w-[15px] h-[15px] shrink-0" />
                <span className="truncate">{lastAdded}</span>
              </div>
            )}

            {mode === "search" ? (
              <>
                {/* Hero search bar — the SINGLE top-pinned element. Pure CSS
                    sticky (no JS viewport math — §22). Opaque page-bg so results
                    don't show through; bottom border + soft shadow = elevation
                    cue as results scroll underneath. */}
                <div className="sticky top-0 z-30 bg-[#f9fafb] p-4 border-b border-gray-200 shadow-[0_2px_6px_rgba(0,0,0,0.04)]">
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
                        // Multi-select ON → checkbox row that TOGGLES selection
                        // (does not open the picker). OFF → single-add row.
                        if (multiSelect) {
                          const selected = selectedProducts.some((s) => s.id === p.id);
                          return (
                            <div
                              key={p.id}
                              onClick={() => toggleProductSelection(p)}
                              className="flex items-center gap-3 py-[13px] px-1 border-b border-gray-100 last:border-b-0 cursor-pointer active:bg-gray-50"
                            >
                              <div className={`w-5 h-5 rounded-[6px] border-2 flex items-center justify-center shrink-0 ${selected ? "bg-teal-600 border-teal-600" : "bg-white border-gray-300"}`}>
                                {selected && (
                                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                                    <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[15px] text-gray-900 truncate">
                                  {productLabel(p)}{aliasSuffix(p)}
                                </p>
                                {second && (
                                  <p className="text-[12px] text-gray-400 truncate mt-0.5">{second}</p>
                                )}
                              </div>
                            </div>
                          );
                        }
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
            ) : mode === "multiqty" ? (
              /* ── Multi-select: set quantities for ALL selected products ── */
              <>
                {/* sticky header (single top-pinned element on this screen) */}
                <div className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-[13px] flex items-center gap-2.5 shadow-[0_2px_6px_rgba(0,0,0,0.04)]">
                  <button type="button" onClick={closeMultiQty} aria-label="Back to results" className="shrink-0">
                    <ChevronDown className="w-[18px] h-[18px] text-gray-500" />
                  </button>
                  <span className="text-[15px] font-semibold text-gray-900">Set quantities</span>
                  <span className="text-[12px] text-gray-500 ml-auto">
                    {selectedProducts.length} {selectedProducts.length === 1 ? "product" : "products"}
                  </span>
                </div>

                {/* one section per selected product — full pack rows (reused) */}
                {selectedProducts.map((p) => {
                  const second = getSecondLine(
                    p.family, p.subProduct,
                    getBaseAliasDisplay(p.product, p.baseColour),
                  );
                  return (
                    <div key={p.id} className="bg-white border-b border-gray-200 pt-[14px] pb-1">
                      <div className="px-4">
                        <div className="text-[15px] font-semibold text-gray-900">
                          {productLabel(p)}{aliasSuffix(p)}
                        </div>
                        <div className="text-[11px] text-gray-400 mt-0.5 mb-1">{second ?? " "}</div>
                      </div>
                      <PackRows
                        product={p}
                        qtys={multiQtys[p.id] ?? {}}
                        onStep={(key, label, delta) => stepMultiPack(p.id, key, label, delta)}
                        onSet={(key, raw) => setMultiPackRaw(p.id, key, raw)}
                        showBoxNote
                      />
                    </div>
                  );
                })}

                {/* sticky "Add N products to Bill" */}
                <div className="sticky bottom-0 z-20 bg-white border-t border-gray-200 px-4 py-3 mt-auto">
                  <button
                    type="button"
                    onClick={commitMultiSelect}
                    disabled={!anyMultiQty}
                    className={`w-full h-[52px] rounded-[12px] text-[15px] font-semibold ${
                      anyMultiQty ? "bg-teal-600 active:bg-teal-700 text-white" : "bg-gray-200 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    Add {selectedProducts.length} {selectedProducts.length === 1 ? "product" : "products"} to Bill {activeBillId}
                  </button>
                </div>
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
                    <PackRows
                      product={activeProduct}
                      qtys={packQtys}
                      onStep={stepPack}
                      onSet={setPackRaw}
                      registerInput={(i, el) => { if (el) packInputsRef.current[i] = el; }}
                    />
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

            {/* Multi-select bottom bar — shown when >= 1 product is ticked
                (takes priority over the cart bar; single bar at a time). */}
            {showSelectBar && (
              <div className="sticky bottom-0 z-20 bg-teal-600 text-white px-[18px] py-[15px] flex items-center justify-between">
                <span className="text-[14px] font-semibold">
                  {selectedProducts.length} selected
                </span>
                <button
                  type="button"
                  onClick={openMultiQty}
                  className="flex items-center gap-1 text-[14px] font-semibold shrink-0 pl-3 active:opacity-80"
                >
                  Set quantities
                  <ChevronRight className="w-[17px] h-[17px]" />
                </button>
              </div>
            )}

            {/* Bottom cart bar — page-level sticky (§15.5 rule 4), search mode +
                has lines, and only when the select bar isn't showing. */}
            {mode === "search" && !showSelectBar && hasAnyLines && (
              <div className="sticky bottom-0 z-20 bg-teal-600 text-white px-[18px] py-[15px] flex items-center justify-between">
                <div className="min-w-0">
                  {multiBill ? (
                    <>
                      <div className="text-[14px] font-semibold truncate">
                        {bills.length} bills · {totalUnits} {totalUnits === 1 ? "unit" : "units"}
                      </div>
                      <div className="text-[12px] text-teal-50 truncate mt-px">
                        {bills.map((b) => `Bill ${b.id} · ${billUnits(b)}`).join("   ·   ")}
                      </div>
                    </>
                  ) : (
                    <div className="text-[14px] font-semibold truncate">
                      Bill {bills[0].id} · {bills[0].lines.length} {bills[0].lines.length === 1 ? "product" : "products"} · {totalUnits} {totalUnits === 1 ? "unit" : "units"}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={openReview}
                  className="flex items-center gap-1 text-[14px] font-semibold shrink-0 pl-3 active:opacity-80"
                >
                  Review &amp; send
                  <ChevronRight className="w-[17px] h-[17px]" />
                </button>
              </div>
            )}
          </>
        )}

        {/* Reset confirm dialog — New order / Switch customer */}
        {confirmKind && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
            onClick={() => setConfirmKind(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="po-confirm-title"
              aria-describedby="po-confirm-body"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[340px] bg-white rounded-[14px] shadow-xl p-5"
            >
              <h2 id="po-confirm-title" className="text-[16px] font-semibold text-gray-900">
                {confirmCopy.title}
              </h2>
              <p id="po-confirm-body" className="text-[13px] text-gray-500 mt-1.5 leading-snug">
                {confirmCopy.body}
              </p>
              <div className="flex gap-2 mt-5">
                <button
                  ref={cancelBtnRef}
                  type="button"
                  onClick={() => setConfirmKind(null)}
                  className="flex-1 h-[44px] rounded-[10px] border border-gray-200 bg-white text-gray-700 text-[14px] font-medium active:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  ref={confirmBtnRef}
                  type="button"
                  onClick={confirmProceed}
                  className="flex-1 h-[44px] rounded-[10px] bg-teal-600 text-white text-[14px] font-semibold active:bg-teal-700"
                >
                  {confirmCopy.cta}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
