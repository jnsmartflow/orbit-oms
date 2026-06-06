"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Mic, Check, ChevronLeft, ChevronDown, ChevronRight, Plus, Pencil, Copy, Clock, Send, RefreshCw } from "lucide-react";
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

// Order-level fields. /po's set DIVERGES from /order on purpose: "Hold" is
// renamed "Call to SO" and a "Bounce" remark is added. These feed the email.
type Dispatch = "Normal" | "Call to SO" | "Urgent";
type Marker   = "Truck" | "Cross Delivery" | "Bounce" | "DTS" | null;

// Cross-billing source depots (shown in the "Cross billing from?" sheet).
const CROSS_DEPOTS = ["Dahisar", "Ahmedabad", "Rajkot", "Pune"] as const;
// Notes "Quick add" presets — appended into the free-text notes field.
const NOTE_PRESETS = ["Pls share DPL", "Pls send stickers"] as const;

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
  customer:   Customer | null;
  bills:      Bill[];
  shipTo:     string;
  dispatch:   Dispatch;
  marker:     Marker;
  crossDepot: string | null;
  notes:      string;
}): { subject: string; body: string; valid: boolean } {
  const { customer, bills, shipTo, dispatch, marker, crossDepot, notes } = args;
  const name = customer?.name ?? "";
  const code = customer?.code ?? "";
  const lines: string[] = [];

  if (name || code) {
    const customerLine = name && code ? `${name} (${code})` : (name || code);
    lines.push("Customer: " + customerLine);
  }
  // Dispatch reflects the rename — "Dispatch: Call to SO" when chosen.
  if (dispatch !== "Normal") lines.push("Dispatch: " + dispatch);
  // Order-remark line for the selected marker (Order Remarks section).
  if (marker) {
    const remarkText =
      marker === "Cross Delivery" ? `Cross billing from ${crossDepot ?? ""}`.trim()
      : marker === "Truck"        ? "Truck order"
      : marker === "Bounce"       ? "Bounce order"
      : marker === "DTS"          ? "DTS order"
      :                             "";
    if (remarkText) lines.push("Remark: " + remarkText);
  }
  // Ship To ONLY when a real custom address is entered. Blank (= "Same as
  // billing" default) is omitted entirely.
  const shipToTrim = shipTo.trim();
  if (shipToTrim && shipToTrim.toLowerCase() !== "same as billing") {
    lines.push("Ship To: " + shipToTrim);
  }
  // Free-text note (Notes section) when non-empty.
  if (notes.trim()) lines.push("Note: " + notes.trim());

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
  crossDepot:   string | null;
  notes:        string;
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
      dispatch:     parsed.dispatch === "Call to SO" || parsed.dispatch === "Urgent"
                      ? parsed.dispatch : "Normal",
      marker:       parsed.marker === "Truck" || parsed.marker === "Cross Delivery"
                      || parsed.marker === "Bounce" || parsed.marker === "DTS"
                      ? parsed.marker : null,
      crossDepot:   typeof parsed.crossDepot === "string" ? parsed.crossDepot : null,
      notes:        typeof parsed.notes === "string" ? parsed.notes : "",
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

// ── Device-local recent customers — newest-first, deduped by code, cap 6 ────
// Pure client/localStorage (real PWA): each entry holds EXACTLY the fields
// selectCustomer() needs to re-start an order (name / code / area) + a stamp.
const PO_RECENTS_KEY = "po_recent_customers";
const PO_RECENTS_CAP = 6;

type RecentCustomer = { name: string; code: string; area: string | null; ts: number };

function getRecents(): RecentCustomer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PO_RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is Partial<RecentCustomer> =>
          !!e && typeof (e as RecentCustomer).name === "string"
          && typeof (e as RecentCustomer).code === "string",
      )
      .map((e) => ({
        name: e.name as string,
        code: e.code as string,
        area: typeof e.area === "string" ? e.area : null,
        ts:   typeof e.ts === "number" ? e.ts : 0,
      }))
      .slice(0, PO_RECENTS_CAP);
  } catch {
    return [];
  }
}

// Move this customer to the top (dedupe by code), persist, return the new list.
function addRecent(c: Customer): RecentCustomer[] {
  const entry: RecentCustomer = {
    name: c.name, code: c.code, area: c.area ?? null, ts: Date.now(),
  };
  const next = [entry, ...getRecents().filter((e) => e.code !== entry.code)]
    .slice(0, PO_RECENTS_CAP);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PO_RECENTS_KEY, JSON.stringify(next));
    } catch {
      // Quota / private mode — recents are best-effort, drop silently.
    }
  }
  return next;
}

function clearRecents(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PO_RECENTS_KEY);
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
              // Select-all on focus only. The keyboard-safe scroll-to-top + the
              // footer-hide are handled centrally by the document focusin/focusout
              // listener (covers the picker, multi-qty, and any future input).
              onFocus={(e) => e.target.select()}
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
  // Device-local recent customers (landing only). Loaded from localStorage in a
  // mount effect — NOT during render — so SSR/first paint render nothing (no
  // hydration mismatch). recentsLoaded gates the section until that read runs.
  const [recents,       setRecents]       = useState<RecentCustomer[]>([]);
  const [recentsLoaded, setRecentsLoaded] = useState(false);

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
  // Array index of the bill awaiting a delete-confirm sheet (null = no sheet).
  const [billToDelete, setBillToDelete] = useState<number | null>(null);

  // Page view: build screen vs the review/send shell.
  const [view, setView] = useState<"build" | "review">("build");

  // Multi-select (default OFF, persisted). When ON, tapping a result toggles
  // selection instead of opening the single picker; "Set quantities" opens a
  // screen with every selected product's pack rows at once.
  const [multiSelect,      setMultiSelect]      = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Product[]>([]);
  // Per-product pack quantities for the multi-qty screen: productId → packKey → units.
  const [multiQtys,        setMultiQtys]        = useState<Record<number, Record<string, number>>>({});

  // SINGLE focus flag for every non-search input (qty boxes, Ship To, Notes, and
  // any future field). Driven by the central document focusin/focusout listener
  // (one mechanism — no per-input wiring). Gates the bottom footer pills so they
  // can't cover the focused field while the keyboard is up.
  const [inputFocused, setInputFocused] = useState(false);

  // Review-screen order-level fields (reused from /order's value sets).
  const [shipTo,      setShipTo]      = useState("");
  // shipFocused ONLY gates the ship-to suggestions dropdown now (the footer-hide
  // moved to the central inputFocused flag).
  const [shipFocused, setShipFocused] = useState(false);
  const [dispatch,    setDispatch]    = useState<Dispatch>("Normal");
  const [marker,      setMarker]      = useState<Marker>(null);
  // Cross-billing depot (set only when marker === "Cross Delivery") + its sheet.
  const [crossDepot,     setCrossDepot]     = useState<string | null>(null);
  const [crossSheetOpen, setCrossSheetOpen] = useState(false);
  // Free-text order notes + the "Quick add" preset menu.
  const [notes,        setNotes]        = useState("");
  const [quickAddOpen, setQuickAddOpen] = useState(false);

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
  // Pending focusout → setInputFocused(false) timer; a quick refocus cancels it.
  const blurTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setCrossDepot(saved.crossDepot);
      setNotes(saved.notes);
      setMultiSelect(saved.multiSelect);
    }
  }, []);

  // Load device-local recent customers on mount (client-only → no hydration mismatch).
  useEffect(() => {
    setRecents(getRecents());
    setRecentsLoaded(true);
  }, []);

  // Central focus mechanism — ONE place that keeps every non-search input above
  // the keyboard (qty boxes, Ship To, Notes, and anything added later). On
  // focusin of a managed <input>/<textarea>, flag inputFocused (which hides the
  // bottom footer pill) and, on a DOUBLE rAF (let the pill-hide reflow commit
  // first), scroll the field's section — or the field itself when it has none
  // (e.g. the single-product picker qty input) — to the TOP of the scroll area
  // so it rises above the keyboard (no blank band). focusout clears the flag
  // after 150ms; a quick refocus cancels the timer. Search fields (custInputRef
  // / heroInputRef) are excluded so the pinned hero search never gets yanked.
  // scrollIntoView only — no viewport offset/translateY math (§22).
  useEffect(() => {
    if (typeof document === "undefined") return;
    function isManagedInput(
      t: EventTarget | null,
    ): t is HTMLInputElement | HTMLTextAreaElement {
      if (!(t instanceof HTMLInputElement) && !(t instanceof HTMLTextAreaElement)) return false;
      if (t === custInputRef.current || t === heroInputRef.current) return false;
      return true;
    }
    function onFocusIn(e: FocusEvent): void {
      const el = e.target;
      if (!isManagedInput(el)) return;
      if (blurTimerRef.current) {
        clearTimeout(blurTimerRef.current);
        blurTimerRef.current = null;
      }
      setInputFocused(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const target = el.closest("[data-product-section],[data-field-section]") ?? el;
          target.scrollIntoView({ block: "start", behavior: "auto" });
        });
      });
    }
    function onFocusOut(e: FocusEvent): void {
      if (!isManagedInput(e.target)) return;
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
      blurTimerRef.current = setTimeout(() => {
        setInputFocused(false);
        blurTimerRef.current = null;
      }, 150);
    }
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      if (blurTimerRef.current) {
        clearTimeout(blurTimerRef.current);
        blurTimerRef.current = null;
      }
    };
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

  // Keyboard-aware viewport sizing. Writes visualViewport.height into a --vvh
  // CSS var (straight to documentElement.style, NOT React state — avoids a
  // render storm). <main> consumes it as its explicit height, so on keyboard
  // open <main> shrinks to the above-keyboard area and the bottom-pinned footer
  // sits just above the keyboard (no gray void).
  //
  // Listen to BOTH "resize" AND "scroll" (mirrors /order). On iOS standalone PWA
  // the keyboard does NOT fire a clean "resize" — its final geometry arrives via
  // a visualViewport scroll/offset adjustment — so "resize" alone left --vvh at
  // the full pre-keyboard height and the footer overshot below the keyboard.
  //
  // GUARD: only write when the measured height actually CHANGES (lastH). The
  // earlier unguarded per-scroll-tick rewrite churned <main>'s height under the
  // sticky search and drifted it on iPhone (commit eb3482b1); a pure scroll
  // (no keyboard) leaves the height unchanged, so the guarded write is a no-op
  // and the pinned search holds. Height-write only — NO positioning math (§22).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    let lastH = -1;
    function update(): void {
      const h = vv ? vv.height : window.innerHeight;
      if (h === lastH) return;   // unchanged height (e.g. plain scroll) → no churn
      lastH = h;
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
      bills, billCounter, activeBillId, shipTo, dispatch, marker,
      crossDepot, notes, multiSelect,
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
      customer: c, bills, billCounter, activeBillId, shipTo, dispatch, marker,
      crossDepot, notes, multiSelect,
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
    setBillToDelete(null);
    setShipTo("");
    setShipFocused(false);
    setInputFocused(false);
    setDispatch("Normal");
    setMarker(null);
    setCrossDepot(null);
    setCrossSheetOpen(false);
    setNotes("");
    setQuickAddOpen(false);
    setMultiSelect(false);
    setSelectedProducts([]);
    setMultiQtys({});
    setLastAdded(null);
    clearPoDraft();
  }

  // ── New order / Change reset wiring ───────────────────────────────────────
  // clearCustomer() above is the FULL reset (all bills/cart/ship/dispatch/
  // marker/counters + removes the orbitoms_po_draft key + back to pick).

  // Header "New order": confirm, then full reset. No-op on a truly blank
  // slate (no customer, empty cart) — nothing to clear. This is also the ONLY
  // way to change customer now (the gray-50 locked block + "Change" button were
  // folded into the merged header — changing customer = New order full reset).
  function onNewOrder(): void {
    if (!selectedCust && !hasAnyLines) return;
    setConfirmKind("new");
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

  // Truck / Bounce / DTS (+ toggle-off). Any non-Cross pick clears crossDepot —
  // switching remark always drops the cross depot. Cross is set via confirmCross.
  function chooseMarker(m: Marker): void {
    setMarker(m);
    setCrossDepot(null);
    const s = snapshot({ marker: m, crossDepot: null });
    if (s) savePoDraft(s);
  }

  // Cross billing — tapping "Cross" (or "change") opens the depot sheet. Opening
  // does NOT commit Cross; only choosing a depot does, so dismissing without a
  // pick cancels the Cross selection (Cross must always carry a depot).
  function openCrossSheet(): void {
    setCrossSheetOpen(true);
  }
  function confirmCross(depot: string): void {
    setMarker("Cross Delivery");
    setCrossDepot(depot);
    setCrossSheetOpen(false);
    const s = snapshot({ marker: "Cross Delivery", crossDepot: depot });
    if (s) savePoDraft(s);
  }
  function cancelCrossSheet(): void {
    // No state change — if Cross wasn't already confirmed it stays unselected;
    // if it was (reopened via "change"), the prior depot is kept.
    setCrossSheetOpen(false);
  }

  // Notes free-text + "Quick add" preset append (joined with ", " when the
  // field already has content).
  function changeNotes(v: string): void {
    setNotes(v);
    const s = snapshot({ notes: v });
    if (s) savePoDraft(s);
  }
  function appendNotePreset(preset: string): void {
    const base = notes.trim();
    const next = base ? `${base}, ${preset}` : preset;
    setNotes(next);
    const s = snapshot({ notes: next });
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

  // Review screen: append a NEW bill at the end whose lines are a DEEP COPY of
  // `source`'s lines (new array + new line objects + new packQtys map — no
  // shared refs, so editing the copy never mutates the source). Keeps the
  // id === position+1 invariant (id = billCounter+1, same as addBill). Does NOT
  // switch the active bill and does NOT navigate — stays on review. No cap.
  function duplicateBill(source: Bill): void {
    const id = billCounter + 1;
    const copiedLines: CartLine[] = source.lines.map((l) => ({
      ...l,
      packQtys: { ...l.packQtys },
    }));
    const nextBills: Bill[] = [...bills, { id, lines: copiedLines }];
    setBills(nextBills);
    setBillCounter(id);
    persist(nextBills, id, activeBillId);   // active bill unchanged
  }

  // × on the active bill chip. Empty bill → delete immediately; bill with
  // products → open the confirm sheet. Never deletes the last remaining bill.
  function requestDeleteBill(index: number): void {
    if (bills.length <= 1) return;
    const bill = bills[index];
    if (!bill) return;
    if (bill.lines.length >= 1) setBillToDelete(index);
    else                        deleteBillAt(index);
  }

  // Remove the bill at `index`, renumber ids 1..n so labels stay sequential
  // (no gaps) everywhere, and select the previous bill (Math.max(0, index-1)).
  function deleteBillAt(index: number): void {
    if (bills.length <= 1) return;
    const renumbered: Bill[] = bills
      .filter((_, i) => i !== index)
      .map((b, i) => ({ ...b, id: i + 1 }));
    const nextActiveId = renumbered[Math.max(0, index - 1)]?.id ?? 1;
    setBills(renumbered);
    setBillCounter(renumbered.length);
    setActiveBillId(nextActiveId);
    persist(renumbered, renumbered.length, nextActiveId);
    setBillToDelete(null);
  }

  function cancelDeleteBill(): void {
    setBillToDelete(null);
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

  // Bills carrying at least one line — drives the Review screen list.
  // (The old build-screen summary used per-bill / total unit counts; the
  // floating "Review order" CTA shows no counts, so those reducers are gone.)
  const reviewBills = bills.filter((b) => b.lines.length > 0);

  // Confirm-dialog copy, by intent.
  const confirmCopy = confirmKind === "change"
    ? { title: "Switch customer?", body: "This clears the current order.", cta: "Switch customer" }
    : { title: "Start a new order?", body: "This clears the current order and starts fresh. It can’t be undone.", cta: "New order" };

  // Email — byte-identical to /order. Computed each render (like /order).
  const { subject: emailSubject, body: emailBody, valid: canSend } =
    buildEmailParts({ customer: selectedCust, bills, shipTo, dispatch, marker, crossDepot, notes });

  function handleSend(): void {
    if (!canSend) return;
    const url = `mailto:${ORDER_TO}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
    // Record this customer in device-local recents BEFORE the reset — this is
    // the ONLY place recents are written.
    if (selectedCust) setRecents(addRecent(selectedCust));
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

  // One floating-pill UI for EVERY bottom CTA (Review order / Set quantities /
  // Add products / Send order) — rendered into the non-scrolling <main> footer
  // so it's keyboard-safe (§22). "send" icon sits left; "arrow" sits right.
  function footerPill(opts: {
    onClick:   () => void;
    label:     string;
    disabled?: boolean;
    icon?:     "arrow" | "send";
  }): React.JSX.Element {
    const { onClick, label, disabled = false, icon = "arrow" } = opts;
    return (
      <div
        className="flex-shrink-0 bg-[#f9fafb] flex justify-center px-4 pt-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
      >
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={`flex items-center gap-2 rounded-full text-[15px] font-bold ${
            disabled
              ? "bg-gray-200 text-gray-400 cursor-not-allowed"
              : "bg-teal-600 active:bg-teal-700 text-white active:opacity-90"
          }`}
          style={{
            padding: "15px 34px",
            boxShadow: disabled ? "none" : "0 8px 22px rgba(13,148,136,0.42)",
          }}
        >
          {icon === "send" && <Send className="w-[17px] h-[17px]" />}
          {label}
          {icon === "arrow" && <ChevronRight className="w-[18px] h-[18px]" />}
        </button>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <main
      className="bg-[#f9fafb] flex flex-col overflow-hidden"
      style={{ height: "var(--vvh, 100vh)" }}
    >
      {/* Pinned teal Orbit brand bar — flex-shrink-0 TOP sibling of the scroll
          area (mirrors footerPill, the shrink-0 sibling below it). It carries
          the status-bar inset on a teal bg, so teal is continuous from the
          status bar through the inset into the bar (no white gap). The ONE
          teal-brand surface here; body content stays neutral. theme-color /
          statusBarStyle unchanged. */}
      <div
        className="flex-shrink-0 bg-[#0d9488]"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 11px)" }}
      >
        <div className="max-w-[480px] mx-auto px-4 pb-[11px] flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2">
            <svg viewBox="0 0 32 32" fill="none" className="w-[26px] h-[26px] shrink-0" aria-hidden="true">
              <circle cx="16" cy="16" r="11" stroke="#fff" strokeWidth="2" />
              <circle cx="16" cy="16" r="3.4" fill="#fff" />
              <circle cx="27" cy="16" r="2.6" fill="#fff" />
            </svg>
            <div className="min-w-0">
              <div className="text-[22px] font-extrabold text-white leading-none">Orbit</div>
              {!selectedCust && (
                <div
                  className="text-[12px] leading-tight mt-0.5 truncate"
                  style={{ color: "rgba(255,255,255,0.72)" }}
                >
                  Purchase Order · Surat Depot
                </div>
              )}
            </div>
          </div>
          {selectedCust && (
            <button
              type="button"
              onClick={onNewOrder}
              className="flex items-center gap-1.5 text-white text-[13px] font-medium shrink-0 pl-3 active:opacity-70"
            >
              <RefreshCw className="w-[15px] h-[15px]" /> New order
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content area (flex-1). The pinned product search + every
          sticky sub-header pin within THIS container; the primary CTA lives in a
          non-scrolling footer BELOW it (a place that "doesn't need lifting").
          On keyboard-open the resize listener shrinks --vvh → <main> shrinks →
          this scroll area shrinks while the footer rides up and stays pinned
          above the keyboard. No sticky-bottom jank, no viewport math (§22). */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[480px] mx-auto flex flex-col min-h-full">

        {/* Merged header — normal flow (scrolls away). The product search bar is
            the single top-pinned element, so the header/bill rows scroll up
            above it. No sticky here → no stacked-sticky pixel fight.

            Two states share ONE header (customer is the title once locked):
              • no customer → "Purchase Order" / "JSW Dulux · Surat Depot"
              • customer    → {name} / {code · area}  (the gray-50 locked block +
                               "Change" button is folded in here; changing the
                               customer = New order full reset)
            The single "New order" button (right) is identical in both states and
            vertically centred against the two-line title via items-center.

            Standalone safe-area: pad the (white) header top by the top inset so
            the title row clears the iOS notch / status bar (viewport-fit=cover
            is set globally). max() with the existing 11px → 11px normally,
            inset when present; the env() fallback is 0px so non-standalone /
            non-notch contexts are unchanged. The bg-white header fills the inset
            (no see-through strip). CSS env() only — no JS viewport math (§22). */}
        {/* Customer identity — only once a customer is locked. The brand mark +
            "New order" now live in the pinned teal bar above; on landing there's
            no white header (search is the first thing in the scroll area). */}
        {selectedCust && (
          <header className="bg-white border-b border-gray-200 px-4 py-[13px]">
            <div className="text-[16px] font-bold text-gray-900 leading-tight truncate">
              {selectedCust.name}
            </div>
            <div className="text-[12px] text-gray-500 leading-tight truncate mt-px">
              {selectedCust.code}{selectedCust.area ? ` · ${selectedCust.area}` : ""}
            </div>
          </header>
        )}

        {!selectedCust ? (
          /* ── Pick a customer — single elevated search field, no chrome ───
              No label / heading / logo / recent list. Generous top spacing
              under the brand bar, whitespace below. */
          <div className="px-4 pt-16">
            <div
              className="flex items-center gap-2.5 bg-white border border-gray-200 rounded-[16px] p-[19px]"
              style={{ boxShadow: "0 8px 28px rgba(17,24,39,0.09)" }}
            >
              <Search className="w-5 h-5 text-gray-500 shrink-0" />
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
                className="flex-1 text-[16px] text-gray-900 bg-transparent border-none outline-none placeholder:text-gray-400"
              />
              {custQuery && (
                <button
                  type="button"
                  onClick={() => setCustQuery("")}
                  className="text-gray-300 text-lg leading-none px-1 shrink-0"
                  aria-label="Clear"
                >
                  ×
                </button>
              )}
            </div>
            {custSuggestions.length > 0 && (
              <div className="mt-2 bg-white border border-gray-100 rounded-[16px] overflow-hidden shadow-sm">
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

            {/* Recent customers — landing only, while the search is idle.
                Loaded post-mount (recentsLoaded) so SSR/first paint render
                nothing. Neutral greys — no second teal accent (CLAUDE_UI). */}
            {recentsLoaded && custQuery.trim().length < 2 && (
              recents.length > 0 ? (
                <div className="mt-7">
                  <div className="flex items-center justify-between px-1 mb-2">
                    <span className="text-[12px] font-medium uppercase tracking-wider text-gray-400">
                      Recent
                    </span>
                    <button
                      type="button"
                      onClick={() => { clearRecents(); setRecents([]); }}
                      className="text-[13px] text-gray-400 active:text-gray-600"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="bg-white border border-gray-100 rounded-[16px] overflow-hidden shadow-sm">
                    {recents.map((r) => (
                      <button
                        key={r.code}
                        type="button"
                        onClick={() => selectCustomer({ name: r.name, code: r.code, area: r.area })}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left border-b border-gray-50 last:border-b-0 active:bg-gray-50"
                      >
                        <div className="w-[38px] h-[38px] rounded-[10px] bg-gray-100 flex items-center justify-center shrink-0">
                          <Clock className="w-[18px] h-[18px] text-gray-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[16px] font-bold text-gray-900 truncate">{r.name}</p>
                          <p className="text-[13px] text-gray-400 truncate mt-px">
                            {r.code}{r.area ? ` · ${r.area}` : ""}
                          </p>
                        </div>
                        <ChevronRight className="w-[18px] h-[18px] text-gray-300 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-10 flex flex-col items-center text-center px-6">
                  <div className="w-[44px] h-[44px] rounded-full bg-gray-100 flex items-center justify-center mb-3">
                    <Clock className="w-[20px] h-[20px] text-gray-300" />
                  </div>
                  <p className="text-[14px] font-medium text-gray-500">No recent customers yet</p>
                  <p className="text-[13px] text-gray-400 mt-1 leading-snug">
                    Search a customer above to start an order. The ones you send to will show up here for next time.
                  </p>
                </div>
              )
            )}
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
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => duplicateBill(b)}
                      className="flex items-center gap-1 text-[14px] text-gray-500 active:text-gray-700"
                      aria-label={`Duplicate Bill ${b.id}`}
                    >
                      <Copy className="w-[15px] h-[15px]" />
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => editBill(b.id)}
                      className="text-gray-400 active:text-gray-600 p-1 -mr-1"
                      aria-label={`Edit Bill ${b.id}`}
                    >
                      <Pencil className="w-[15px] h-[15px]" />
                    </button>
                  </div>
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
            <div data-field-section className="bg-white border-b border-gray-200 px-4 py-[13px]">
              <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-[7px]">Ship to</p>
              <div className="flex items-center gap-2.5 border border-gray-200 rounded-lg px-3 py-[11px]">
                <Search className="w-4 h-4 text-gray-300 shrink-0" />
                <input
                  type="text"
                  value={shipTo}
                  onChange={(e) => changeShipTo(e.target.value)}
                  // setShipFocused ONLY gates the suggestions dropdown now. The
                  // scroll-to-top + Send-pill hide are handled by the central
                  // focusin/focusout listener (data-field-section is its target).
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
                  { label: "Normal",     dot: "bg-teal-500",  on: "border-teal-500 bg-teal-50 text-teal-700" },
                  { label: "Call to SO", dot: "bg-red-400",   on: "border-red-300 bg-red-50 text-red-700" },
                  { label: "Urgent",     dot: "bg-amber-400", on: "border-amber-300 bg-amber-50 text-amber-700" },
                ] as const).map((d) => {
                  const on = dispatch === d.label;
                  return (
                    <button
                      key={d.label}
                      type="button"
                      onClick={() => chooseDispatch(d.label)}
                      className={`h-[42px] rounded-[10px] border text-[13px] flex items-center justify-center gap-1.5 whitespace-nowrap ${
                        on ? `${d.on} font-semibold` : "border-gray-200 bg-white text-gray-400 font-medium"
                      }`}
                    >
                      <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${d.dot}`} />
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Order Remarks — four options in a 2×2 grid. Tapping "Cross" opens
                the depot sheet (commits Cross only once a depot is chosen). */}
            <div className="bg-white border-b border-gray-200 px-4 py-[13px]">
              <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-[7px]">
                Order remarks <span className="text-gray-300 normal-case tracking-normal">· optional</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { label: "🚛 Truck",  value: "Truck" as const },
                  { label: "🔄 Cross",  value: "Cross Delivery" as const },
                  { label: "↩️ Bounce", value: "Bounce" as const },
                  { label: "📦 DTS",    value: "DTS" as const },
                ]).map((m) => {
                  const on      = marker === m.value;
                  const isCross = m.value === "Cross Delivery";
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => (isCross ? openCrossSheet() : chooseMarker(on ? null : m.value))}
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
              {marker === "Cross Delivery" && crossDepot && (
                <p className="text-[12px] text-gray-500 mt-2">
                  Cross billing from {crossDepot}{" · "}
                  <button
                    type="button"
                    onClick={openCrossSheet}
                    className="text-teal-700 font-medium active:opacity-70"
                  >
                    change
                  </button>
                </p>
              )}
            </div>

            {/* Notes — optional free text + a "Quick add" preset menu. */}
            <div data-field-section className="bg-white border-b border-gray-200 px-4 py-[13px]">
              <div className="flex items-center justify-between mb-[7px]">
                <p className="text-[11px] uppercase tracking-wide text-gray-400">
                  Notes <span className="text-gray-300 normal-case tracking-normal">· optional</span>
                </p>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setQuickAddOpen((o) => !o)}
                    className="flex items-center gap-1 text-[12px] text-teal-700 font-medium active:opacity-70"
                  >
                    Quick add
                    <ChevronDown
                      className={`w-[14px] h-[14px] transition-transform ${quickAddOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {quickAddOpen && (
                    <div className="absolute right-0 top-full mt-1 z-10 w-[190px] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                      {NOTE_PRESETS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => { appendNotePreset(p); setQuickAddOpen(false); }}
                          className="w-full text-left px-3 py-2.5 text-[14px] text-gray-700 border-b border-gray-50 last:border-b-0 active:bg-gray-50"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <input
                type="text"
                value={notes}
                onChange={(e) => changeNotes(e.target.value)}
                // Scroll-to-top + Send-pill hide handled by the central
                // focusin/focusout listener (data-field-section is its target).
                placeholder="Add a note…"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className="w-full border border-gray-200 rounded-lg px-3 py-[11px] text-[16px] text-gray-900 bg-transparent outline-none placeholder:text-gray-400"
              />
            </div>

            {/* The "Send order" CTA now lives in the non-scrolling footer at
                <main> level (keyboard-safe — stays above the keyboard when Ship
                To or Notes is focused; §22). See the bottom of render. */}
          </>
        ) : (
          /* ── Customer locked — build screen (header + bill strip + search/picking + cart bar) ── */
          <>
            {/* Picking sub-header — Back. The customer identity now lives in the
                merged header above (gray-50 locked block removed). */}
            {mode === "picking" && (
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
            )}

            {/* Bill + Multi — ONE row (search mode). Left: active bill(s) +
                add-bill control (scroll-x when many bills). Right (pinned): the
                existing "Select multiple" switch, relabelled "Multi". */}
            {mode === "search" && (
              <div className="bg-white border-b border-gray-200 px-4 py-[10px] flex items-center justify-between gap-3">
                {/* Left: active bill(s) + add-bill */}
                <div className="flex items-center gap-2 min-w-0 overflow-x-auto">
                  {bills.length === 1 ? (
                    <span className="shrink-0 text-[14px] font-semibold text-gray-700">
                      Bill {bills[0].id}
                    </span>
                  ) : (
                    bills.map((b, idx) => {
                      const active = b.id === activeBillId;
                      if (!active) {
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => switchBill(b.id)}
                            className="shrink-0 text-[14px] text-gray-500 px-2 py-[3px]"
                          >
                            Bill {b.id}
                          </button>
                        );
                      }
                      // Selected pill: label + × (delete). The × only ever renders
                      // here (active chip) and this branch only runs with 2+ bills,
                      // so the last bill never shows a ×.
                      return (
                        <div
                          key={b.id}
                          className="shrink-0 flex items-center gap-1 text-[14px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded-full pl-3 pr-1 py-[3px]"
                        >
                          <button type="button" onClick={() => switchBill(b.id)} className="leading-none">
                            Bill {b.id}
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete Bill ${b.id}`}
                            onClick={() => requestDeleteBill(idx)}
                            className="w-[19px] h-[19px] rounded-full bg-teal-600 text-white flex items-center justify-center shrink-0 active:bg-teal-700"
                          >
                            <span className="text-[13px] leading-none">×</span>
                          </button>
                        </div>
                      );
                    })
                  )}
                  {/* Add-bill: "+ Add bill" with one bill, collapses to "+" at 2+ */}
                  <button
                    type="button"
                    onClick={addBill}
                    aria-label="Add bill"
                    className="flex items-center gap-1 text-[14px] text-teal-700 font-medium shrink-0"
                  >
                    <Plus className="w-[16px] h-[16px]" />
                    {bills.length === 1 && <span>Add bill</span>}
                  </button>
                </div>

                {/* Right (pinned): Multi switch — existing toggle, relabelled */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[14px] text-gray-700">Multi</span>
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
                        // Fallback to family (e.g. "VELVET TOUCH") when there's no
                        // sub-product descriptor — mirrors /order. The {second && …}
                        // guard still renders nothing when family is empty.
                        const second = getSecondLine(
                          p.family, p.subProduct,
                          getBaseAliasDisplay(p.product, p.baseColour),
                        ) ?? p.family;
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
                    <div key={p.id} data-product-section className="bg-white border-b border-gray-200 pt-[14px] pb-1">
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

                {/* The "Add N products" CTA lives in the non-scrolling footer at
                    <main> level (keyboard-safe; stays pinned above the keyboard
                    during qty entry). See bottom of render. */}
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

            {/* The "Set quantities" (multi-select) and "Review order" CTAs now
                live in the non-scrolling footer at <main> level (keyboard-safe,
                one floating-pill UI; §22). See the bottom of render. */}
          </>
        )}

        {/* Cross-billing depot bottom-sheet. Dismissing without a pick cancels
            the Cross selection (cancelCrossSheet makes no state change, so Cross
            is only ever committed by choosing a depot). */}
        {crossSheetOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
            onClick={cancelCrossSheet}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Cross billing from"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[480px] bg-white rounded-t-[18px] p-5"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[16px] font-semibold text-gray-900">Cross billing from?</h2>
                <button
                  type="button"
                  onClick={cancelCrossSheet}
                  aria-label="Close"
                  className="text-gray-400 text-[22px] leading-none px-1 active:text-gray-600"
                >
                  ×
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {CROSS_DEPOTS.map((d) => {
                  const on = crossDepot === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => confirmCross(d)}
                      className={`h-[48px] rounded-[10px] border text-[15px] ${
                        on
                          ? "border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold"
                          : "border-gray-200 bg-white text-gray-700 font-medium active:bg-gray-50"
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Delete-bill confirm — bottom-sheet (same pattern as the Cross-depot
            sheet). Only opens when the bill has ≥1 product; empty bills delete
            immediately without it. */}
        {billToDelete !== null && bills[billToDelete] && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
            onClick={cancelDeleteBill}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Delete bill"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[480px] bg-white rounded-t-[18px] p-5"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)" }}
            >
              <h2 className="text-[16px] font-semibold text-gray-900">
                Delete Bill {billToDelete + 1}?
              </h2>
              <p className="text-[13px] text-gray-500 mt-1.5 leading-snug">
                {bills[billToDelete].lines.length}{" "}
                {bills[billToDelete].lines.length === 1 ? "product" : "products"} in this bill will be removed.
              </p>
              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={cancelDeleteBill}
                  className="flex-1 h-[44px] rounded-[10px] bg-gray-100 text-gray-700 text-[14px] font-medium active:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => deleteBillAt(billToDelete)}
                  className="flex-1 h-[44px] rounded-[10px] bg-red-600 text-white text-[14px] font-semibold active:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
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
      </div>

      {/* Non-scrolling bottom footer — the primary CTA for the current screen.
          It sits OUTSIDE the scroll area (flex-shrink-0), so when the keyboard
          opens (--vvh shrinks <main>) the footer rides up with the viewport and
          stays pinned above the keyboard — for BOTH Ship To and Notes focus —
          with no sticky-bottom jank and no viewport math (§22). Centered
          floating pill on a page-bg strip; safe-area inset clears the home
          indicator (env()=0 on Android → no change). */}
      {selectedCust && (
        view === "review"
          // Send order — HIDDEN while ANY non-search input is focused (central
          // inputFocused; the field scrolls its section to the top, the hidden
          // pill stays out of the way above the keyboard). Restored on blur.
          ? (inputFocused
              ? null
              : footerPill({ onClick: handleSend, disabled: !canSend, label: "Send order", icon: "send" }))
          // Multi-qty sub-screen — Add products. HIDDEN while a qty box is
          // focused (central inputFocused) so it never covers the rows.
          : mode === "multiqty"
            ? (inputFocused
                ? null
                : footerPill({
                    onClick: commitMultiSelect,
                    disabled: !anyMultiQty,
                    label: `Add ${selectedProducts.length} ${selectedProducts.length === 1 ? "product" : "products"}`,
                  }))
            // Multi-select active with ≥1 ticked — Set quantities (with count).
            : (mode === "search" && showSelectBar)
              ? footerPill({ onClick: openMultiQty, label: `Set quantities (${selectedProducts.length})` })
              // Default build CTA — Review order when the active cart has lines.
              : (mode === "search" && !showSelectBar && hasAnyLines)
                ? footerPill({ onClick: openReview, label: "Review order" })
                : null
      )}
    </main>
  );
}
