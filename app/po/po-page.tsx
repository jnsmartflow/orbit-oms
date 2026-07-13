"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Mic, Check, ChevronLeft, ChevronDown, ChevronRight, Plus, Pencil, Copy, Clock, Send, RefreshCw, Home, Bookmark, Trash2 } from "lucide-react";
import type { RawPack } from "@/lib/place-order/pack-buckets";
import type { Product, CartLine, Bill, Customer } from "@/app/(place-order)/place-order/types";
import { rankProductsForQuery } from "@/lib/place-order/mobile-search";
import { formatPack, packToMl, packStepForPack, packKey, parsePackKey } from "@/lib/place-order/pack";
import { getBaseAliasDisplay, getBaseAliasLabel } from "@/lib/place-order/base-aliases";
import { emailLineLabel, renderOrderBody, buildSubject, type OrderBodyBill, type OrderBodyLine } from "@/lib/place-order/email";
import { getSecondLine, isVariantQualifierTab } from "@/lib/place-order/sub-product-descriptors";
import {
  loadSavedDrafts, upsertSavedDraft, removeSavedDraft, newDraftId,
  draftSummary, formatSavedAt, type SavedDraft,
} from "@/lib/place-order/saved-drafts";
import {
  loadSentOrders, addSentOrder, removeSentOrder, newSentId, type SentOrder,
} from "@/lib/place-order/sent-orders";
import SplashScreen from "./splash-screen";

// "N bills" for a Drafts/Sent list row or the receipt's Total — units
// dropped (was noisy); wraps draftSummary (which still computes both) so
// every call site routes through this one function for the string.
function billsCountLabel(snapshot: Parameters<typeof draftSummary>[0]): string {
  const { bills } = draftSummary(snapshot);
  return `${bills} ${bills === 1 ? "bill" : "bills"}`;
}

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

// Order-level fields. /po's set DIVERGES from /order on purpose: a "Call" dispatch
// (routed to SO or Dealer via callTarget) replaces /order's "Hold", and a "Bounce"
// remark is added. These feed the email.
type Dispatch   = "Normal" | "Urgent" | "Call";
type CallTarget = "SO" | "Dealer" | null;
type Marker     = "Truck" | "Cross Delivery" | "Bounce" | "DTS" | null;

// Cross-billing source depots (shown in the "Cross billing from?" sheet).
const CROSS_DEPOTS = ["Dahisar", "Ahmedabad", "Rajkot", "Pune"] as const;
// Notes "Quick add" presets — appended into the free-text notes field.
const NOTE_PRESETS = ["Pls share DPL", "Pls send stickers"] as const;

// Email recipient — orders go to the AkzoNobel depot inbox, which forwards to the
// parser inbox (surat.order@outlook.com). No longer identical to /order (frozen).
const ORDER_TO = "surat.depot@akzonobel.com";

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
  callTarget: CallTarget;
  marker:     Marker;
  crossDepot: string | null;
  notes:      string;
}): { subject: string; body: string; valid: boolean } {
  const { customer, bills, shipTo, dispatch, callTarget, marker, crossDepot, notes } = args;
  const name = customer?.name ?? "";
  const code = customer?.code ?? "";

  const billTo = (name || code)
    ? (name && code ? `${name} (${code})` : (name || code))
    : null;

  // Dispatch line. Urgent → "Urgent"; Call → "Call to SO/Dealer" (from
  // callTarget); Normal omits the line.
  const dispatchText =
    dispatch === "Call"     ? "Call to " + (callTarget ?? "SO")
    : dispatch !== "Normal" ? dispatch
    :                         null;

  // Order-remark line for the selected marker (Order Remarks section).
  const remarkText =
    marker === "Cross Delivery" ? `Cross billing from ${crossDepot ?? ""}`.trim()
    : marker === "Truck"        ? "Truck order"
    : marker === "Bounce"       ? "Bounce order"
    : marker === "DTS"          ? "DTS order"
    :                             null;

  const shipToText = resolvedShipTo(shipTo);

  const note = notes.trim() || null;

  const activeBills = bills.filter((b) => b.lines.length > 0);
  const bodyBills: OrderBodyBill[] = activeBills.map((b) => {
    const itemLines: OrderBodyLine[] = b.lines.map((l) => {
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
      // Name via the shared helper so all three surfaces (desktop email.ts,
      // /order, /po) stay byte-identical — incl. the PROMISE PRIMER + general
      // de-double rules.
      const productText = emailLineLabel(l.product ?? null, l.baseColour, l.subProduct);
      return { name: productText, packString: packStr };
    });
    return { label: activeBills.length > 1 ? "Bill " + b.id : null, lines: itemLines };
  });

  const body = renderOrderBody({
    billTo,
    shipTo:   shipToText,
    dispatch: dispatchText,
    remark:   remarkText,
    note,
    bills:    bodyBills,
  });

  const subject = buildSubject(customer, marker, crossDepot);
  const valid = !!customer && activeBills.length > 0;

  return { subject, body, valid };
}

// Ship To ONLY when a real custom address is entered. Blank (= "Same as
// billing" default) resolves to null. Shared by buildEmailParts and the
// read-only Sent receipt so both display the exact same value.
function resolvedShipTo(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed && trimmed.toLowerCase() !== "same as billing" ? trimmed : null;
}

// Current dispatch's display text — same "Call · target" shape the live
// Dispatch pill shows once committed. Shared with the Sent receipt.
function dispatchLabel(dispatch: Dispatch, callTarget: CallTarget): string {
  return dispatch === "Call" && callTarget ? `Call · ${callTarget}` : dispatch;
}

// Order Remarks options — single source for the Review picker grid and the
// Sent receipt's read-only label lookup.
const MARKER_OPTIONS: { label: string; value: NonNullable<Marker> }[] = [
  { label: "🚛 Truck",  value: "Truck" },
  { label: "🔄 Cross",  value: "Cross Delivery" },
  { label: "↩️ Bounce", value: "Bounce" },
  { label: "📦 DTS",    value: "DTS" },
];

function markerLabel(marker: Marker): string | null {
  return MARKER_OPTIONS.find((m) => m.value === marker)?.label ?? null;
}

// ── Draft persistence — dedicated key, never /order's or desktop's ─────────
const PO_DRAFT_KEY    = "orbitoms_po_draft";
const PO_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;   // 24h, matches desktop convention

// Full order snapshot persisted under PO_DRAFT_KEY: customer + bills (cart) +
// order-level review fields (shipTo / dispatch / marker).
// Exported (type-only) so lib/place-order/saved-drafts.ts can reuse this exact
// shape for the Save-draft-and-reopen-later feature's snapshot — no duplicate
// type, no runtime coupling.
export type PoDraft = {
  customer:     Customer;
  bills:        Bill[];
  billCounter:  number;
  activeBillId: number;
  shipTo:       string;
  dispatch:     Dispatch;
  callTarget:   CallTarget;
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
      dispatch:     parsed.dispatch === "Call" || parsed.dispatch === "Urgent"
                      ? parsed.dispatch : "Normal",
      callTarget:   parsed.callTarget === "SO" || parsed.callTarget === "Dealer"
                      ? parsed.callTarget : null,
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
        const step     = packStepForPack(rp.packCode, rp.unit, product.product ?? product.subProduct);   // PC tools → box 25/12; paint via label-keyed packStep (+ product-scoped carton overrides)
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
              // scroll-mb-[32px]: the shrink re-scroll (--vvh updater) targets this
              // input with block:"nearest", which honors scroll-margin — so a
              // clamped low cell (e.g. 20L) lands ~32px ABOVE the keyboard, not
              // flush against it. Bottom-margin only; does NOT affect the focusin
              // block:"start" scroll (that honors scroll-margin-TOP). §22-safe.
              className={`w-10 text-center text-[16px] font-bold bg-transparent outline-none scroll-mb-[32px] ${qty === 0 ? "border-b border-dashed border-gray-300" : "border-none"}`}
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
  // Opening splash — shown once per app open (initial mount), then never again
  // (splashDone stays true across internal re-renders / navigation; no storage).
  const [splashDone, setSplashDone] = useState(false);

  // Save-draft-and-reopen-later feature — HIDDEN behind ?draft=on until Smart
  // Flow flips it on for everyone. Read once, client-only, from the URL (not
  // useSearchParams — avoids any App Router Suspense concern for a plain
  // server-wrapped page). Starts false so first paint is byte-identical to
  // today even for a ?draft=on visitor (matches the dataLoading/recentsLoaded
  // mount-effect pattern already used on this page). Every new render branch
  // for this feature (bottom bar, Drafts screen, two-button Review footer)
  // gates on this one boolean.
  const [draftsEnabled, setDraftsEnabled] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setDraftsEnabled(new URLSearchParams(window.location.search).get("draft") === "on");
  }, []);
  // Which browse-tier screen is showing — only meaningful when !selectedCust.
  // "home" is the only UNPUSHED depth (base); "drafts"/"sent" are peer screens
  // that sit at the SAME depth (1) above it. A single 3-way enum (not two
  // independent booleans) so the two screens can never both be "open" at
  // once, and a lateral switch between them is expressible as a pure state
  // change with no history push/pop (see openDrafts/openSent).
  const [browseScreen, setBrowseScreen] = useState<"home" | "drafts" | "sent">("home");
  // Saved-draft id awaiting its delete confirm sheet (null = no sheet).
  const [draftToDelete,  setDraftToDelete]  = useState<string | null>(null);
  // Sent-order id awaiting its delete confirm sheet (null = no sheet).
  const [sentToDelete,   setSentToDelete]   = useState<string | null>(null);
  // The Sent order currently shown as a read-only receipt (null = not
  // showing). Renders directly from this immutable snapshot — never loaded
  // into selectedCust/bills/etc., so there is no live state to accidentally
  // mutate and nothing to reset if the user just backs out without acting.
  const [receiptOrder,   setReceiptOrder]   = useState<SentOrder | null>(null);
  // Which saved draft (if any) the CURRENT live order came from — null for a
  // fresh order. Drives Save-draft's new-vs-overwrite choice; reset on New
  // order, after Send (both already funnel through clearCustomer() for the
  // non-draftsEnabled path), and explicitly on a draftsEnabled Send (§P5) and
  // on a Sent reopen (§P6 — it's a NEW order, not tied to any draft).
  const [openedDraftId,  setOpenedDraftId]  = useState<string | null>(null);
  // Brief confirmation/handoff overlay — "saved" (Draft saved, then auto-nav
  // to Drafts) or "sending" (Opening mail, no nav after). null = not rendered;
  // "enter"/"exit" pick which keyframe animation class the overlay wears —
  // real @keyframes `animation` (not `transition`), so no rAF/mount trick is
  // needed to kick it off, unlike a transition-based approach.
  const [overlayPhase, setOverlayPhase] = useState<"enter" | "exit" | null>(null);
  const [overlayKind,  setOverlayKind]  = useState<"saved" | "sending">("saved");

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

  // Whether the soft keyboard is ACTUALLY open — derived from the visualViewport
  // height in the --vvh updater (debounced), NOT from input focus. Gates the
  // floating footers so they hide while the keyboard is up and reappear on close,
  // even when Android dismisses the keyboard WITHOUT blurring the input (the
  // stuck-Add-button case), and so the search footer yields its space while typing.
  const [keyboardOpen, setKeyboardOpen] = useState(false);

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
  // Call routing — which party to call (SO/Dealer) + its bottom-sheet open flag.
  const [callTarget,     setCallTarget]     = useState<CallTarget>(null);
  const [callSheetOpen,  setCallSheetOpen]  = useState(false);
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
  // The currently-focused managed input (qty box / Ship To / Notes), tracked so
  // the --vvh updater can re-scroll IT to the nearest edge when the viewport
  // shrinks (keyboard opening) — corrects low picker cells like 20L. Null = none.
  const focusedInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  // Bridge to the --vvh updater's guarded measure (assigned inside its effect),
  // so focusout can fire ONE delayed re-measure to snap <main> back to full
  // height on keyboard close (kills the grey band) — no new per-tick listener.
  const vvhUpdateRef   = useRef<(() => void) | null>(null);
  const vvhResnapRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounce for the keyboardOpen flag (avoids flicker on the open/close ramp).
  const kbDebounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The single scroll container (flex-1) — reset to top on every screen change.
  const scrollAreaRef  = useRef<HTMLDivElement | null>(null);

  // ── Android Back / iPhone swipe-back: browser history = single nav authority ─
  // depthRef = pushed entries above the base (landing) entry. suppressPopRef
  // ignores the popstate from a PROGRAMMATIC history.back()/go(). backConfirmRef
  // marks the discard-confirm raised by back-on-build (item 4) vs the New-order
  // button. navStateRef carries the live screen for the one popstate handler.
  const depthRef       = useRef(0);
  const suppressPopRef = useRef(false);
  const backConfirmRef = useRef(false);
  const navStateRef    = useRef<{
    selectedCust:     boolean;
    view:             "build" | "review";
    mode:             "search" | "picking" | "multiqty";
    confirmOpen:      boolean;
    crossOpen:        boolean;
    callOpen:         boolean;
    deleteOpen:       boolean;
    draftDeleteOpen:  boolean;
    sentDeleteOpen:   boolean;
    receiptOpen:      boolean;
    browseScreen:     "home" | "drafts" | "sent";
    hasLines:         boolean;
  }>({
    selectedCust: false, view: "build", mode: "search", confirmOpen: false,
    crossOpen: false, callOpen: false, deleteOpen: false,
    draftDeleteOpen: false, sentDeleteOpen: false, receiptOpen: false,
    browseScreen: "home", hasLines: false,
  });

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
      setCallTarget(saved.callTarget);
      setMarker(saved.marker);
      setCrossDepot(saved.crossDepot);
      setNotes(saved.notes);
      setMultiSelect(saved.multiSelect);
      // Restored straight into build-search — seat one history entry so Back goes
      // build → landing (not straight out of /po).
      pushScreen("build");
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
      if (vvhResnapRef.current) {   // a quick refocus cancels a pending close re-measure
        clearTimeout(vvhResnapRef.current);
        vvhResnapRef.current = null;
      }
      focusedInputRef.current = el;
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
      focusedInputRef.current = null;
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
      blurTimerRef.current = setTimeout(() => {
        setInputFocused(false);
        blurTimerRef.current = null;
      }, 150);
      // Snap <main> back to full height after the keyboard closes. iOS standalone
      // PWA can drop the close "resize", leaving --vvh at the keyboard-open height
      // (the grey band). ONE delayed re-measure through the SAME lastH-guarded
      // path (vvhUpdateRef) reclaims the height — no new per-tick listener (§22).
      if (vvhResnapRef.current) clearTimeout(vvhResnapRef.current);
      vvhResnapRef.current = setTimeout(() => {
        vvhUpdateRef.current?.();
        vvhResnapRef.current = null;
      }, 300);
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
      if (vvhResnapRef.current) {
        clearTimeout(vvhResnapRef.current);
        vvhResnapRef.current = null;
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
    let fullH = vv ? vv.height : window.innerHeight;   // tallest (no-keyboard) height seen
    function update(): void {
      const h = vv ? vv.height : window.innerHeight;
      if (h > fullH) fullH = h;   // grows on rotation / iOS URL-bar expand
      if (h === lastH) return;   // unchanged height (e.g. plain scroll) → no churn
      const shrank = lastH !== -1 && h < lastH;   // height dropped = keyboard opening
      lastH = h;
      document.documentElement.style.setProperty("--vvh", `${h}px`);
      // "Keyboard actually open" derived from the REAL height drop (> ~120px below the
      // full no-keyboard height — above iOS URL-bar-collapse noise), debounced ~100ms
      // to avoid flicker on the open/close ramp. Height READ only — no offset math
      // (§22). THIS (not input focus) gates the floating footers, so the Add button
      // returns on keyboard close even if the input keeps focus (Android down-caret),
      // and the search footer yields its space while the keyboard is up.
      const kbOpen = (fullH - h) > 120;
      if (kbDebounceRef.current) clearTimeout(kbDebounceRef.current);
      kbDebounceRef.current = setTimeout(() => {
        setKeyboardOpen(kbOpen);
        kbDebounceRef.current = null;
      }, 100);
      // Keyboard just opened: re-scroll the focused field to the NEAREST edge so it
      // sits just above the keyboard. The focusin scroll (block:"start") ran against
      // the taller pre-keyboard viewport and clamps for low rows (the picker's 20L);
      // this correction fires AFTER the shrink. scrollIntoView only — no offset math
      // (§22). Also hardens multiqty for tall products.
      if (shrank && focusedInputRef.current) {
        const el = focusedInputRef.current;
        requestAnimationFrame(() => el.scrollIntoView({ block: "nearest", behavior: "auto" }));
      }
    }
    vvhUpdateRef.current = update;   // let focusout fire a guarded re-measure on close
    update();   // sync write so --vvh has a value before first paint
    if (!vv) {
      return () => {
        vvhUpdateRef.current = null;
        if (kbDebounceRef.current) { clearTimeout(kbDebounceRef.current); kbDebounceRef.current = null; }
      };
    }
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      vvhUpdateRef.current = null;
      if (kbDebounceRef.current) { clearTimeout(kbDebounceRef.current); kbDebounceRef.current = null; }
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

  // Reset the shared scroll container to the TOP on every screen ENTER (mode
  // and/or view change) so review / picker / multiqty / build-search never open
  // mid-scroll from the previous screen. Deps are [mode, view] ONLY — this never
  // fires on input focus, so it can't fight the focusin scrollIntoView or the
  // --vvh keyboard re-scroll (both run on focus/resize, NOT a screen change). The
  // picking-entry scrollIntoView (the rAF above) runs async and still governs the
  // picker's landing position; for every other screen this opens it at the top.
  useEffect(() => {
    scrollAreaRef.current?.scrollTo({ top: 0 });
  }, [mode, view]);

  // Confirm dialog: focus the confirm button on open, trap Tab between the two
  // buttons, Esc cancels. Accessible per the task spec.
  useEffect(() => {
    if (!confirmKind) return;
    const t = requestAnimationFrame(() => confirmBtnRef.current?.focus());
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        dismissConfirm();
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

  // ── ONE popstate handler — the only place that navigates BACK ──────────────
  // Closes the topmost LIVE layer (read from navStateRef) via the existing pure
  // handler and NEVER pushes. Every in-app Back/Cancel/× routes through
  // history.back() so it flows here too. Programmatic back()/go() set
  // suppressPopRef so their popstate is ignored. depthRef mirrors entries above
  // the base (landing) entry. (CORE §3 — no $transaction etc.; this is UI only.)
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onPop(): void {
      depthRef.current = Math.max(0, depthRef.current - 1);   // an entry was popped
      if (suppressPopRef.current) { suppressPopRef.current = false; return; }
      const s = navStateRef.current;
      if (s.confirmOpen) {                       // overlay: discard-confirm dialog
        backConfirmRef.current = false;
        setConfirmKind(null);
        return;
      }
      if (s.crossOpen)  { cancelCrossSheet(); return; }   // overlay: cross-depot sheet
      if (s.callOpen)   { cancelCallSheet();  return; }   // overlay: call-routing sheet
      if (s.deleteOpen) { cancelDeleteBill(); return; }   // overlay: delete-bill sheet
      if (s.draftDeleteOpen) { cancelDeleteDraft(); return; }   // overlay: delete-draft sheet (draftsEnabled only)
      if (s.sentDeleteOpen)  { cancelDeleteSent();  return; }   // overlay: delete-sent sheet (draftsEnabled only)
      // Read-only Sent receipt → back to the Sent list (draftsEnabled only).
      // Checked BEFORE the browseScreen check below so Back closes just the
      // receipt (one level) instead of skipping past Sent straight to Home.
      if (s.receiptOpen) { closeSentReceipt(); return; }
      if (s.view === "review")   { closeReview();   return; }
      if (s.mode === "picking")  { cancelPicking(); return; }
      if (s.mode === "multiqty") { closeMultiQty(); return; }
      // Drafts OR Sent → landing (draftsEnabled only). One branch covers both
      // peer screens — the popstate handler never reads a pushed entry's tag,
      // only this live enum, so it doesn't matter which one was actually
      // pushed vs. reached by a lateral in-tier switch.
      if (s.browseScreen !== "home") { closeBrowseScreen(); return; }
      if (s.selectedCust) {                      // build-search → landing (discard guard)
        if (s.hasLines) {
          backConfirmRef.current = true;
          setConfirmKind("change");              // "Switch customer? This clears the order."
        } else {
          clearCustomer();
        }
        return;
      }
      // landing → allow exit (the pop already navigated away; nothing to do)
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Push one tagged history entry on a FORWARD navigation; track depth.
  function pushScreen(tag: string): void {
    if (typeof window === "undefined") return;
    window.history.pushState({ poScreen: tag }, "");
    depthRef.current += 1;
  }

  // Dismiss the discard-confirm. Back-triggered (item 4): KEEP the order and
  // re-push a build entry so we stay "in" build with an entry to pop next time.
  // Button-triggered (New order): pop its own pushed entry via history.back().
  function dismissConfirm(): void {
    if (backConfirmRef.current) {
      backConfirmRef.current = false;
      setConfirmKind(null);
      pushScreen("build");
    } else if (typeof window !== "undefined") {
      window.history.back();
    } else {
      setConfirmKind(null);
    }
  }

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
      bills, billCounter, activeBillId, shipTo, dispatch, callTarget, marker,
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
      customer: c, bills, billCounter, activeBillId, shipTo, dispatch, callTarget, marker,
      crossDepot, notes, multiSelect,
    });
    pushScreen("build");   // landing → build-search
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
    setCallTarget(null);
    setCallSheetOpen(false);
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
    setOpenedDraftId(null);   // Save-draft feature: a reset always starts a fresh draft next time
  }

  // ── Browse-tier nav — Home / Drafts / Sent (draftsEnabled only) ───────────
  // Bottom-bar "Drafts" tab. Forward push from Home (depth 0->1); a LATERAL
  // move from Sent (already at depth 1) is a pure state change — no push, no
  // pop, since the popstate handler never reads a pushed entry's tag anyway.
  function openDrafts(): void {
    if (browseScreen === "drafts") return;
    if (browseScreen === "home") pushScreen("drafts");
    setBrowseScreen("drafts");
  }
  // Bottom-bar "Sent" tab. Same shape as openDrafts.
  function openSent(): void {
    if (browseScreen === "sent") return;
    if (browseScreen === "home") pushScreen("sent");
    setBrowseScreen("sent");
  }
  // Called ONLY from the popstate handler (mirrors cancelCrossSheet/cancelCallSheet
  // — every close of either browse screen, whether hardware-back, swipe, or the
  // bottom bar's "Home" tap, routes through history.back() so there is one
  // authority). Covers Drafts AND Sent — whichever was showing.
  function closeBrowseScreen(): void {
    setBrowseScreen("home");
  }
  // Bottom-bar "Home" tap while on Drafts or Sent: same authority as hardware
  // back — just pop the pushed entry and let the popstate handler above close
  // it. No-op if already on Home (nothing pushed to pop).
  function goHome(): void {
    if (browseScreen !== "home" && typeof window !== "undefined") window.history.back();
  }

  function requestDeleteDraft(id: string): void {
    setDraftToDelete(id);
    pushScreen("draft-delete");
  }
  function cancelDeleteDraft(): void {
    setDraftToDelete(null);
  }
  function confirmDeleteDraftAction(id: string): void {
    removeSavedDraft(id);
    setDraftToDelete(null);
    if (typeof window !== "undefined") { suppressPopRef.current = true; window.history.back(); }
  }

  function requestDeleteSent(id: string): void {
    setSentToDelete(id);
    pushScreen("sent-delete");
  }
  function cancelDeleteSent(): void {
    setSentToDelete(null);
  }
  function confirmDeleteSentAction(id: string): void {
    removeSentOrder(id);
    setSentToDelete(null);
    if (typeof window !== "undefined") { suppressPopRef.current = true; window.history.back(); }
  }

  // Tapping a Sent row opens the read-only receipt (NOT the editable Review
  // screen — that only happens via the receipt's own "Edit order" button).
  // One push on top of the Sent list; browseScreen stays "sent" underneath.
  function viewSentReceipt(order: SentOrder): void {
    setReceiptOrder(order);
    pushScreen("sent-receipt");
  }
  // Called ONLY from the popstate handler (mirrors closeBrowseScreen etc.).
  function closeSentReceipt(): void {
    setReceiptOrder(null);
  }

  // Save the CURRENT live order as a saved draft. Overwrites in place when the
  // live order came from a reopened draft (openedDraftId set); otherwise mints
  // a new id and remembers it, so a SECOND Save in the same session overwrites
  // rather than duplicating.
  function saveDraft(): void {
    if (!selectedCust || !hasAnyLines) return;
    const id = openedDraftId ?? newDraftId();
    const draft: SavedDraft = {
      id,
      label:   selectedCust.name,
      savedAt: Date.now(),
      snapshot: {
        customer: selectedCust, bills, billCounter, activeBillId, shipTo,
        dispatch, callTarget, marker, crossDepot, notes, multiSelect,
      },
    };
    upsertSavedDraft(draft);
    if (!openedDraftId) setOpenedDraftId(id);
    // Feedback lives in handleSaveDraftTap (the button's onClick) — the
    // lastAdded banner used here originally never renders on the Review
    // screen (it's gated on mode === "search", a build-screen-only concept),
    // so it was dead. saveDraft() itself stays pure save logic only.
  }

  // Runs the shared confirmation/handoff overlay sequence (enter -> hold ->
  // exit), then calls onComplete once the exit animation has fully played.
  // "saved" = Draft-saved tick (used by Save-draft, followed by a nav to
  // Drafts). "sending" = Opening-mail handoff (used by Send; no onComplete —
  // the order just stays on screen). Same choreography/timing either way —
  // only the icon + text swap (see the overlay JSX for the kind switch).
  function runOverlaySequence(kind: "saved" | "sending", onComplete?: () => void): void {
    setOverlayKind(kind);
    setOverlayPhase("enter");
    // 1150ms: card lands ~450ms, the hero (check-draw or icon-fade) finishes
    // ~1000ms, leaving ~150ms of fully-settled, nothing-moving hold before
    // exit starts — plus the 250ms exit + ~270ms JS margin below, total
    // ~1.4s (the tuned "deliberate, not a wait" feel).
    window.setTimeout(() => {
      setOverlayPhase("exit");   // plays the ~250ms fade+scale-down exit (CSS)
      window.setTimeout(() => {
        setOverlayPhase(null);
        onComplete?.();
      }, 270);   // >= the exit animation's 250ms so it fully plays before unmount
    }, 1150);
  }

  // Save-draft button handler: run the (unchanged) save, show the "saved" tick
  // overlay, then auto-navigate to Drafts so the user sees the saved order in
  // the list. History: pop exactly ONE entry (Review's, depth 2 -> 1) — no new
  // push — landing the stack at the same depth a fresh tap on the bottom bar's
  // Drafts tab would leave it at (the popstate handler only ever reads live
  // state via navStateRef, never a pushed entry's tag, so this is safe — see
  // reopenDraft()'s comment for the full trace). Guarded by re-reading
  // navStateRef at fire-time so a manual Back during the hold can't cause a
  // double pop.
  function handleSaveDraftTap(): void {
    saveDraft();
    runOverlaySequence("saved", () => {
      if (navStateRef.current.view !== "review") return;   // user already navigated away
      if (typeof window !== "undefined") { suppressPopRef.current = true; window.history.back(); }
      clearCustomer();     // order is already saved — safe to close it out
      setBrowseScreen("drafts");
    });
  }

  // Reopen a saved draft: rehydrate every PoDraft field into live state (same
  // fields the mount-restore effect hydrates from `orbitoms_po_draft` — but
  // this is a SEPARATE code path; the auto-save key is never touched here),
  // remember which draft this is (openedDraftId), and land on Review so the
  // user sees what they saved. From there Back behaves exactly like a normal
  // live order — nothing draft-specific past this point.
  //
  // History depth: only ONE new entry is pushed on top of the existing
  // "drafts" entry (not a pop-then-repush of "build"+"review"), because the
  // popstate handler never reads a pushed entry's tag — only live state via
  // navStateRef. Traced by hand: Review's back-arrow pops this entry → the
  // existing `view === "review"` branch fires → Build. The next back pops the
  // old "drafts" entry (now just an anonymous slot) → since selectedCust+lines
  // are live, the existing discard-confirm branch fires — identical to a
  // normal in-progress order. No ghost entries, no extra dead back-press.
  function reopenDraft(draft: SavedDraft): void {
    const s = draft.snapshot;
    setSelectedCust(s.customer);
    setBills(s.bills);
    setBillCounter(s.billCounter);
    setActiveBillId(s.activeBillId);
    setShipTo(s.shipTo);
    setDispatch(s.dispatch);
    setCallTarget(s.callTarget);
    setMarker(s.marker);
    setCrossDepot(s.crossDepot);
    setNotes(s.notes);
    setMultiSelect(s.multiSelect);
    setOpenedDraftId(draft.id);
    setBrowseScreen("home");   // leaving the browse tier (moot for render once selectedCust is set, kept for state hygiene)
    setView("review");
    setMode("search");
    pushScreen("review");
  }

  // Reopen a Sent order = REORDER: identical mechanism to reopenDraft (same
  // rehydrate, same single-push history math — see its comment for the full
  // back-nav trace), except openedDraftId is cleared to null: this is a NEW
  // order, not tied to any draft, so a later Save creates a fresh draft and a
  // later Send adds a fresh Sent entry rather than linking back to anything.
  // This is the ONLY path from the read-only Sent receipt into editable mode
  // (its "Edit order" button calls this directly) — so it also clears
  // receiptOrder, leaving read-only viewing behind for good.
  function reopenSent(order: SentOrder): void {
    const s = order.snapshot;
    setSelectedCust(s.customer);
    setBills(s.bills);
    setBillCounter(s.billCounter);
    setActiveBillId(s.activeBillId);
    setShipTo(s.shipTo);
    setDispatch(s.dispatch);
    setCallTarget(s.callTarget);
    setMarker(s.marker);
    setCrossDepot(s.crossDepot);
    setNotes(s.notes);
    setMultiSelect(s.multiSelect);
    setOpenedDraftId(null);
    setReceiptOrder(null);
    setBrowseScreen("home");
    setView("review");
    setMode("search");
    pushScreen("review");
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
    backConfirmRef.current = false;   // button-triggered (not the back-on-build path)
    setConfirmKind("new");
    pushScreen("confirm");
  }

  // Confirm dialog primary action (discard + reset to landing).
  function confirmProceed(): void {
    const fromBack = backConfirmRef.current;
    backConfirmRef.current = false;
    setConfirmKind(null);
    if (!fromBack && typeof window !== "undefined" && depthRef.current > 0) {
      // Button-triggered from any depth — snap history to base so a later Back
      // exits cleanly (item 5). One go(-N) fires one popstate → suppress it.
      const n = depthRef.current;
      depthRef.current = 0;
      suppressPopRef.current = true;
      window.history.go(-n);
    }
    // back-triggered: already at base (depthRef 0) — nothing to pop.
    clearCustomer();
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
  // toggleProductSelection). On (re-)select, seed multiQtys from the active
  // bill's existing line for this product (or blank it) so a reselect never
  // carries a stale typed value from an earlier, since-deselected pass.
  function toggleProductSelection(p: Product): void {
    const isSelected = selectedProducts.some((s) => s.id === p.id);
    if (isSelected) {
      setSelectedProducts((prev) => prev.filter((s) => s.id !== p.id));
      return;
    }
    const existing = existingLineFor(p.id);
    setMultiQtys((mq) => ({ ...mq, [p.id]: existing ? { ...existing.packQtys } : {} }));
    setSelectedProducts((prev) => [...prev, p]);
  }

  function openMultiQty(): void {
    if (selectedProducts.length === 0) return;
    if (listening) stopListening();
    setMode("multiqty");
    pushScreen("multiqty");
  }

  // Back from the multi-qty screen — preserve selection + typed quantities.
  function closeMultiQty(): void {
    setMode("search");
  }

  function stepMultiPack(productId: number, key: string, label: string, delta: number): void {
    const { packCode, unit } = parsePackKey(key);   // composite key carries packCode|unit
    const prod = selectedProducts.find((p) => p.id === productId);
    const step = packStepForPack(packCode, unit, prod ? (prod.product ?? prod.subProduct) : null);
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
    // Pop the multiqty entry — we navigated multiqty → build-search ourselves.
    if (typeof window !== "undefined") { suppressPopRef.current = true; window.history.back(); }
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
    // Normal / Urgent only — "Call" is set via confirmCall. Clears any stale target.
    setDispatch(d);
    setCallTarget(null);
    const s = snapshot({ dispatch: d, callTarget: null });
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
    pushScreen("cross");
  }
  function confirmCross(depot: string): void {
    setMarker("Cross Delivery");
    setCrossDepot(depot);
    setCrossSheetOpen(false);
    const s = snapshot({ marker: "Cross Delivery", crossDepot: depot });
    if (s) savePoDraft(s);
    // Close = pop the cross overlay entry (programmatic → suppress the popstate).
    if (typeof window !== "undefined") { suppressPopRef.current = true; window.history.back(); }
  }
  function cancelCrossSheet(): void {
    // No state change — if Cross wasn't already confirmed it stays unselected;
    // if it was (reopened via "change"), the prior depot is kept.
    setCrossSheetOpen(false);
  }

  // Call routing — tapping "Call" opens the SO/Dealer sheet. MIRRORS Cross: opening
  // does NOT commit dispatch; only picking a target does, so dismissing without a
  // pick leaves the previous Dispatch (never "Call" with no target).
  function openCallSheet(): void {
    setCallSheetOpen(true);
    pushScreen("call");
  }
  function confirmCall(target: "SO" | "Dealer"): void {
    setCallTarget(target);
    setDispatch("Call");
    setCallSheetOpen(false);
    const s = snapshot({ dispatch: "Call", callTarget: target });
    if (s) savePoDraft(s);
    // Close = pop the call overlay entry (programmatic → suppress the popstate).
    if (typeof window !== "undefined") { suppressPopRef.current = true; window.history.back(); }
  }
  function cancelCallSheet(): void {
    // No state change — dispatch stays at its previous value (Call never committed).
    setCallSheetOpen(false);
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
    // review → build-search (depth-reducing): pop the review entry.
    if (typeof window !== "undefined") { suppressPopRef.current = true; window.history.back(); }
    setActiveBillId(billId);
    persist(bills, billCounter, billId);
    setView("build");
    setMode("search");
  }

  // "+ Add another bill" from review — create + activate + go build it.
  function addAnotherBill(): void {
    // review → build-search (depth-reducing): pop the review entry.
    if (typeof window !== "undefined") { suppressPopRef.current = true; window.history.back(); }
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

  // Pre-fill from the active bill's existing line for this product (if any)
  // so re-opening an already-cart'd product edits its packs instead of
  // silently overwriting them on Done (see commitLine).
  function existingLineFor(productId: number): CartLine | undefined {
    return bills.find((b) => b.id === activeBillId)?.lines.find((l) => l.productId === productId);
  }

  function pickProduct(p: Product): void {
    if (listening) stopListening();
    setActiveProduct(p);
    const existing = existingLineFor(p.id);
    setPackQtys(existing ? { ...existing.packQtys } : {});
    packInputsRef.current = [];
    setMode("picking");
    pushScreen("picking");
  }

  function cancelPicking(): void {
    setMode("search");
    setActiveProduct(null);
    setPackQtys({});
  }

  // ── Quantity cell semantics (units; +/- by box step) ──────────────────────
  function stepPack(key: string, label: string, delta: number): void {
    const { packCode, unit } = parsePackKey(key);   // composite key carries packCode|unit
    const step = packStepForPack(packCode, unit, activeProduct?.product ?? activeProduct?.subProduct ?? null);
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
      // nothing entered — silent back-out = Back (pops the picking entry → popstate → cancelPicking).
      if (typeof window !== "undefined") window.history.back();
      else cancelPicking();
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

    // Pop the picking entry — we navigated picking → build-search ourselves.
    if (typeof window !== "undefined") { suppressPopRef.current = true; window.history.back(); }

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
    if (bill.lines.length >= 1) { setBillToDelete(index); pushScreen("delete"); }
    else                        deleteBillAt(index);   // empty bill → no sheet, no entry
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

  // Delete-sheet "Delete" action: remove the bill, then pop the sheet entry.
  function confirmDeleteBill(index: number): void {
    deleteBillAt(index);
    if (typeof window !== "undefined") { suppressPopRef.current = true; window.history.back(); }
  }

  function openReview(): void {
    if (listening) stopListening();
    setMode("search");
    setView("review");
    pushScreen("review");
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

  // Read fresh on every render rather than cached in state — cheap, and stays
  // correct after save/delete without a separate refresh call at each site.
  const savedDrafts = draftsEnabled && browseScreen === "drafts" ? loadSavedDrafts() : [];
  const sentOrders  = draftsEnabled && browseScreen === "sent"   ? loadSentOrders()  : [];

  // Confirm-dialog copy, by intent.
  const confirmCopy = confirmKind === "change"
    ? { title: "Switch customer?", body: "This clears the current order.", cta: "Switch customer" }
    : { title: "Start a new order?", body: "This clears the current order and starts fresh. It can’t be undone.", cta: "New order" };

  // Live screen snapshot read by the popstate handler (refreshed every render).
  navStateRef.current = {
    selectedCust: selectedCust !== null,
    view, mode,
    confirmOpen:     confirmKind !== null,
    crossOpen:       crossSheetOpen,
    callOpen:        callSheetOpen,
    deleteOpen:      billToDelete !== null,
    draftDeleteOpen: draftsEnabled && draftToDelete !== null,
    sentDeleteOpen:  draftsEnabled && sentToDelete !== null,
    receiptOpen:     draftsEnabled && receiptOrder !== null,
    browseScreen:    draftsEnabled ? browseScreen : "home",
    hasLines:        hasAnyLines,
  };

  // Email — byte-identical to /order. Computed each render (like /order).
  const { subject: emailSubject, body: emailBody, valid: canSend } =
    buildEmailParts({ customer: selectedCust, bills, shipTo, dispatch, callTarget, marker, crossDepot, notes });

  function handleSend(): void {
    if (!canSend) return;
    const url = `mailto:${ORDER_TO}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
    // Record this customer in device-local recents BEFORE the reset — this is
    // the ONLY place recents are written.
    if (selectedCust) setRecents(addRecent(selectedCust));

    // draftsEnabled: show the "Opening mail" handoff overlay, log this order to
    // po_sent_orders, and drop it from Drafts if it came from a reopened one —
    // ALL plain state/localStorage writes, no history calls, so none of this
    // conflicts with the mailto-must-fire-synchronously-first rule below. The
    // overlay's own backdrop fully covers the screen for its ~1.4s run, so the
    // reset below (which now ALSO runs for this path — see below) is invisible
    // until the overlay fades, revealing a fresh Home page underneath.
    if (draftsEnabled) {
      runOverlaySequence("sending");
      if (selectedCust) {
        addSentOrder({
          id:      newSentId(),
          label:   selectedCust.name,
          sentAt:  Date.now(),
          snapshot: {
            customer: selectedCust, bills, billCounter, activeBillId, shipTo,
            dispatch, callTarget, marker, crossDepot, notes, multiSelect,
          },
        });
      }
      // openedDraftId is cleared below by the shared clearCustomer() reset —
      // no need to set it here too.
      if (openedDraftId) removeSavedDraft(openedDraftId);
    }

    // Fire the mailto FIRST — within the tap gesture, BEFORE any history navigation.
    // On mobile a synchronous history.go() in the same tick cancels the pending
    // external mailto handoff before the mail app opens (the working /order only sets
    // location.href and does nothing after). Nothing that navigates history may run
    // before or in the same sync tick as this line.
    window.location.href = url;   // mailto: opens the mail app; page does not unload

    // Full reset — pure state, NO navigation, so it can't pre-empt the mailto.
    // Runs for BOTH paths now: the Sent list (just written above, when
    // draftsEnabled) is the recovery net if the user backs out of the mail
    // app, so there's no longer a reason to leave the order sitting on Review
    // — same shared reset plain /po has always used.
    clearCustomer();
    // Snap history to base so a later Back exits cleanly — DEFERRED to a later task
    // (setTimeout 0) so it runs AFTER the mailto handoff and never pre-empts it. End
    // state is unchanged: user on landing (cleared), history at base, Back exits.
    if (typeof window !== "undefined" && depthRef.current > 0) {
      const n = depthRef.current;
      depthRef.current = 0;
      suppressPopRef.current = true;
      setTimeout(() => { window.history.go(-n); }, 0);
    }
  }

  // Resend button on the read-only Sent receipt. Builds the email straight
  // from the saved snapshot via the SAME buildEmailParts a normal Send uses
  // (byte-identical body to a fresh send of this order), runs the same
  // "Opening mail" handoff overlay, and logs a FRESH po_sent_orders entry
  // (new id + sentAt = now; the original entry is untouched — addSentOrder
  // appends, never overwrites). openedDraftId is not touched — it's already
  // null here (the receipt never rehydrates into live state) and stays null,
  // since a resend isn't tied to any draft.
  //
  // Unlike handleSend(), there is no live editable state to reset afterward
  // — the receipt renders straight from the snapshot and never touched
  // selectedCust/bills/etc. — so "reset to Home" here just means closing the
  // receipt + Sent screen and snapping history back to base, the same
  // deferred (setTimeout 0) way handleSend() already does.
  function resendFromReceipt(order: SentOrder): void {
    const s = order.snapshot;
    const { subject, body, valid } = buildEmailParts({
      customer: s.customer, bills: s.bills, shipTo: s.shipTo, dispatch: s.dispatch,
      callTarget: s.callTarget, marker: s.marker, crossDepot: s.crossDepot, notes: s.notes,
    });
    if (!valid) return;
    const url = `mailto:${ORDER_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    setRecents(addRecent(s.customer));
    runOverlaySequence("sending");
    addSentOrder({
      id:      newSentId(),
      label:   s.customer.name,
      sentAt:  Date.now(),
      snapshot: s,
    });

    // Fire the mailto FIRST — same ordering rule as handleSend (see its
    // comment): nothing that navigates history may run before or in the same
    // sync tick as this line.
    window.location.href = url;

    setReceiptOrder(null);
    setBrowseScreen("home");
    if (typeof window !== "undefined" && depthRef.current > 0) {
      const n = depthRef.current;
      depthRef.current = 0;
      suppressPopRef.current = true;
      setTimeout(() => { window.history.go(-n); }, 0);
    }
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
      const step  = packStepForPack(e.packCode, e.unit, line.product ?? line.subProduct);
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

  // Single-product picker action bar — Cancel (ghost) + Add to Bill (teal,
  // disabled at zero qty). Rendered in the SAME non-scrolling <main> footer slot
  // as footerPill (a flex-shrink-0 sibling of the scroll area) so it rides --vvh
  // above the keyboard, instead of sitting inside the min-h-full scroll content
  // (the old inline bar left a grey band + parked scroll on close; §22). Hidden
  // while a qty box is focused — see the footer block at the end of render.
  function pickerFooter(): React.JSX.Element {
    return (
      <div
        className="flex-shrink-0 bg-[#f9fafb] flex gap-2 px-4 pt-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
      >
        <button
          type="button"
          onClick={() => window.history.back()}
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
    );
  }

  // Review-screen footer. Plain footerPill (Send order) when draftsEnabled is
  // false — BYTE-IDENTICAL to today, zero visual change. When draftsEnabled,
  // a second "Save draft" button sits beside Send order (two-button end bar,
  // per the locked spec) — Save disabled on an empty cart, mirroring Send's
  // own !canSend disable.
  function reviewFooter(): React.JSX.Element {
    if (!draftsEnabled) {
      return footerPill({ onClick: handleSend, disabled: !canSend, label: "Send order", icon: "send" });
    }
    return (
      <div
        className="flex-shrink-0 bg-[#f9fafb] flex items-center gap-2.5 px-4 pt-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
      >
        <button
          type="button"
          onClick={handleSaveDraftTap}
          disabled={!hasAnyLines}
          className={`flex-1 flex items-center justify-center gap-1.5 h-[48px] rounded-full border text-[14px] font-semibold ${
            hasAnyLines
              ? "border-gray-300 bg-white text-gray-700 active:bg-gray-50"
              : "border-gray-200 bg-gray-100 text-gray-300 cursor-not-allowed"
          }`}
        >
          <Bookmark className="w-[15px] h-[15px]" />
          Save draft
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className={`flex-[1.5] flex items-center justify-center gap-2 h-[48px] rounded-full text-[15px] font-bold ${
            canSend
              ? "bg-teal-600 active:bg-teal-700 text-white active:opacity-90"
              : "bg-gray-200 text-gray-400 cursor-not-allowed"
          }`}
          style={{ boxShadow: canSend ? "0 8px 22px rgba(13,148,136,0.42)" : "none" }}
        >
          <Send className="w-[17px] h-[17px]" />
          Send order
        </button>
      </div>
    );
  }

  // Read-only Sent receipt footer — Edit order (outline/secondary) + Resend
  // (solid teal, primary, slightly larger — the hero action). Mirrors the
  // reviewFooter two-button shape above.
  function receiptFooter(order: SentOrder): React.JSX.Element {
    return (
      <div
        className="flex-shrink-0 bg-[#f9fafb] flex items-center gap-2.5 px-4 pt-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
      >
        <button
          type="button"
          onClick={() => reopenSent(order)}
          className="flex-1 flex items-center justify-center gap-1.5 h-[48px] rounded-full border border-teal-600 bg-white text-teal-700 text-[14px] font-semibold active:bg-teal-50"
        >
          <Pencil className="w-[15px] h-[15px]" />
          Edit order
        </button>
        <button
          type="button"
          onClick={() => resendFromReceipt(order)}
          className="flex-[1.5] flex items-center justify-center gap-2 h-[48px] rounded-full bg-teal-600 active:bg-teal-700 text-white text-[15px] font-bold"
          style={{ boxShadow: "0 8px 22px rgba(13,148,136,0.42)" }}
        >
          <Send className="w-[17px] h-[17px]" />
          Resend order
        </button>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <main
      className="po-page bg-[#f9fafb] flex flex-col overflow-hidden"
      style={{ height: "var(--vvh, 100vh)" }}
    >
      {/* Save-draft overlay keyframes. Scoped by unique `po-save-*` class names
          (no global collision risk) — kept as a plain <style> tag here rather
          than app/globals.css so the whole feature stays contained to this
          file. Default (outside the media query) rules are the fully-SETTLED
          look — full opacity, scale(1), check fully drawn, ring invisible —
          so a browser (or a user) with prefers-reduced-motion: reduce gets a
          static tick + text and literally none of the motion below; only
          `no-preference` layers the actual keyframe animations on top. */}
      <style>{`
        .po-save-backdrop { background: rgba(0,0,0,0.4); }
        .po-save-card { opacity: 1; transform: scale(1); }
        .po-save-circle { opacity: 1; transform: scale(1); }
        .po-save-ring { opacity: 0; transform: scale(1); }
        .po-save-check { stroke-dasharray: 24; stroke-dashoffset: 0; }
        .po-save-icon-fade { opacity: 1; transform: scale(1); }
        .po-save-text { opacity: 1; }

        @media (prefers-reduced-motion: no-preference) {
          .po-save-backdrop--enter { animation: poSaveBackdropIn 200ms ease-out both; }
          .po-save-backdrop--exit  { animation: poSaveBackdropOut 250ms ease-in both; }
          .po-save-card--enter {
            opacity: 0;
            animation: poSaveCardIn 450ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
          }
          .po-save-card--exit { animation: poSaveCardOut 250ms ease-in both; }
          .po-save-card--enter .po-save-circle {
            opacity: 0;
            animation: poSaveCircleIn 380ms cubic-bezier(0.34, 1.56, 0.64, 1) 50ms both;
          }
          .po-save-card--enter .po-save-ring {
            opacity: 0;
            animation: poSaveRing 600ms ease-out 430ms both;
          }
          .po-save-card--enter .po-save-check {
            stroke-dashoffset: 24;
            animation: poSaveCheckDraw 550ms ease-out 450ms both;
          }
          .po-save-card--enter .po-save-icon-fade {
            opacity: 0;
            animation: poSaveIconFadeIn 350ms cubic-bezier(0.34, 1.56, 0.64, 1) 450ms both;
          }
          .po-save-card--enter .po-save-text {
            opacity: 0;
            animation: poSaveTextIn 300ms ease-out 350ms both;
          }
        }

        @keyframes poSaveBackdropIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes poSaveBackdropOut { from { opacity: 1; } to { opacity: 0; } }
        @keyframes poSaveCardIn {
          0%   { opacity: 0; transform: scale(0.8); }
          60%  { opacity: 1; transform: scale(1.03); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes poSaveCardOut { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.95); } }
        @keyframes poSaveCircleIn {
          0%   { opacity: 0; transform: scale(0); }
          70%  { opacity: 1; transform: scale(1.15); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes poSaveRing {
          0%   { opacity: 0.5; transform: scale(0.6); }
          100% { opacity: 0; transform: scale(1.9); }
        }
        @keyframes poSaveCheckDraw { from { stroke-dashoffset: 24; } to { stroke-dashoffset: 0; } }
        @keyframes poSaveIconFadeIn {
          0%   { opacity: 0; transform: scale(0.6); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes poSaveTextIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Opening splash — FIRST child so it covers the landing from first paint
          (no landing flash). position:fixed inset-0 escapes this <main>'s
          overflow-hidden + --vvh height. Wired to the catalog-ready flag
          (!dataLoading) and self-dismisses once min-hold + ready are both met. */}
      {!splashDone && (
        <SplashScreen ready={!dataLoading} onDone={() => setSplashDone(true)} />
      )}

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
      <div ref={scrollAreaRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
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
          draftsEnabled && browseScreen === "drafts" ? (
            /* ── Drafts screen (draftsEnabled only) — peer of landing ────── */
            <div className="px-4 pt-6">
              <div className="text-[13px] font-semibold text-gray-600 uppercase tracking-wide mb-2 px-1">
                Saved Drafts
              </div>
              {savedDrafts.length === 0 ? (
                <div className="mt-10 flex flex-col items-center text-center px-6">
                  <div className="w-[44px] h-[44px] rounded-full bg-gray-100 flex items-center justify-center mb-3">
                    <Bookmark className="w-[20px] h-[20px] text-gray-300" />
                  </div>
                  <p className="text-[14px] font-medium text-gray-500">No saved drafts yet</p>
                  <p className="text-[13px] text-gray-400 mt-1 leading-snug">
                    Build an order and tap Save draft on the Review screen to come back to it later.
                  </p>
                </div>
              ) : (
                <div className="bg-white border border-gray-100 rounded-[16px] overflow-hidden shadow-sm">
                  {savedDrafts.map((d) => {
                    return (
                      <div
                        key={d.id}
                        className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-b-0"
                      >
                        <button
                          type="button"
                          onClick={() => reopenDraft(d)}
                          className="flex-1 min-w-0 text-left"
                        >
                          <p className="text-[15px] font-medium text-gray-800 truncate">
                            {d.snapshot.customer.name}
                          </p>
                          <p className="text-[12px] text-gray-400 truncate mt-0.5">
                            {d.snapshot.customer.area ? `${d.snapshot.customer.area} · ` : ""}
                            {billsCountLabel(d.snapshot)}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5">{formatSavedAt(d.savedAt)}</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => requestDeleteDraft(d.id)}
                          aria-label="Delete draft"
                          className="text-gray-300 active:text-red-500 p-2 -mr-2 shrink-0"
                        >
                          <Trash2 className="w-[17px] h-[17px]" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : draftsEnabled && receiptOrder ? (
            /* ── Read-only Sent receipt (draftsEnabled only) ── renders
                straight from the immutable snapshot, never touches live
                state. Reuses the same bill-card visual language as Review
                (lineChips/productLabel/aliasSuffix are pure helpers, work
                identically on a snapshot's bills) minus every editable
                control. Checked BEFORE the Sent-list branch below: browseScreen
                deliberately STAYS "sent" while the receipt is open (so Back
                returns to the Sent list, not Home — see closeSentReceipt), so
                this more-specific receiptOrder check must be evaluated first
                or the broader browseScreen === "sent" branch always shadows
                it. ──────────────────────────────────────────────────────── */
            <>
              <div className="bg-white border-b border-gray-200 px-4 py-[13px]">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => window.history.back()}
                    aria-label="Back to Sent"
                    className="shrink-0"
                  >
                    <ChevronLeft className="w-[18px] h-[18px] text-gray-500" />
                  </button>
                  <span className="text-[16px] font-medium text-gray-800 truncate flex-1 min-w-0">
                    {receiptOrder.snapshot.customer.name}
                  </span>
                  <span className="text-[11px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-2 py-0.5 shrink-0">
                    Sent
                  </span>
                </div>
                <div className="pl-[26px] text-[12px] text-gray-500 truncate">
                  {receiptOrder.snapshot.customer.code}
                  {receiptOrder.snapshot.customer.area ? ` · ${receiptOrder.snapshot.customer.area}` : ""}
                </div>
              </div>

              <div className="px-4 pt-3 pb-1 text-[12px] text-gray-400">
                Sent {formatSavedAt(receiptOrder.sentAt)}
              </div>

              {receiptOrder.snapshot.bills.filter((b) => b.lines.length > 0).map((b) => (
                <div key={b.id} className="bg-white border-b border-gray-200 px-4 py-[13px]">
                  <div className="mb-2">
                    <span className="text-[12px] font-semibold text-gray-600">Bill {b.id}</span>
                  </div>
                  {b.lines.map((line, idx) => {
                    const chips = lineChips(line);
                    return (
                      <div
                        key={`${line.productId}-${idx}`}
                        className="flex items-start justify-between gap-2 py-[6px] border-b border-gray-50 last:border-b-0"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] text-gray-900 truncate">
                            {productLabel(line)}{aliasSuffix(line)}
                          </p>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                            {chips.map((c) => (
                              <span key={c.label} className="text-[12px] text-teal-700">
                                {c.label} <span className="font-mono">×{c.units}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}

              {(() => {
                const shipToText = resolvedShipTo(receiptOrder.snapshot.shipTo);
                return shipToText ? (
                  <div className="bg-white border-b border-gray-200 px-4 py-[13px]">
                    <p className="text-[11px] uppercase tracking-wide text-gray-400">Ship to</p>
                    <p className="text-[13px] text-gray-700 font-medium mt-0.5">{shipToText}</p>
                  </div>
                ) : null;
              })()}

              <div className="bg-white border-b border-gray-200 px-4 py-[13px]">
                <p className="text-[11px] uppercase tracking-wide text-gray-400">Dispatch</p>
                <p className="text-[13px] text-gray-700 font-medium mt-0.5">
                  {dispatchLabel(receiptOrder.snapshot.dispatch, receiptOrder.snapshot.callTarget)}
                </p>
              </div>

              {(() => {
                const label = markerLabel(receiptOrder.snapshot.marker);
                if (!label) return null;
                const { marker, crossDepot } = receiptOrder.snapshot;
                return (
                  <div className="bg-white border-b border-gray-200 px-4 py-[13px]">
                    <p className="text-[11px] uppercase tracking-wide text-gray-400">Order remarks</p>
                    <p className="text-[13px] text-gray-700 font-medium mt-0.5">
                      {label}
                      {marker === "Cross Delivery" && crossDepot ? ` · Cross billing from ${crossDepot}` : ""}
                    </p>
                  </div>
                );
              })()}

              {receiptOrder.snapshot.notes.trim() ? (
                <div className="bg-white border-b border-gray-200 px-4 py-[13px]">
                  <p className="text-[11px] uppercase tracking-wide text-gray-400">Notes</p>
                  <p className="text-[13px] text-gray-700 font-medium mt-0.5">
                    {receiptOrder.snapshot.notes.trim()}
                  </p>
                </div>
              ) : null}

              <div className="bg-white border-b border-gray-200 px-4 py-[13px]">
                <p className="text-[11px] uppercase tracking-wide text-gray-400">Total</p>
                <p className="text-[13px] text-gray-700 font-medium mt-0.5">
                  {billsCountLabel(receiptOrder.snapshot)}
                </p>
              </div>
            </>
          ) : draftsEnabled && browseScreen === "sent" ? (
            /* ── Sent screen (draftsEnabled only) — peer of landing, same
                shape as Drafts. Tapping a row opens the READ-ONLY receipt
                (viewSentReceipt) — reorder only happens from the receipt's
                own "Edit order" button. ──────────────────────────────────── */
            <div className="px-4 pt-6">
              <div className="text-[13px] font-semibold text-gray-600 uppercase tracking-wide mb-2 px-1">
                Sent
              </div>
              {sentOrders.length === 0 ? (
                <div className="mt-10 flex flex-col items-center text-center px-6">
                  <div className="w-[44px] h-[44px] rounded-full bg-gray-100 flex items-center justify-center mb-3">
                    <Send className="w-[20px] h-[20px] text-gray-300" />
                  </div>
                  <p className="text-[14px] font-medium text-gray-500">No sent orders yet</p>
                  <p className="text-[13px] text-gray-400 mt-1 leading-snug">
                    Orders you send today and yesterday show up here.
                  </p>
                </div>
              ) : (
                <div className="bg-white border border-gray-100 rounded-[16px] overflow-hidden shadow-sm">
                  {sentOrders.map((o) => {
                    return (
                      <div
                        key={o.id}
                        className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-b-0"
                      >
                        <button
                          type="button"
                          onClick={() => viewSentReceipt(o)}
                          className="flex-1 min-w-0 text-left"
                        >
                          <p className="text-[15px] font-medium text-gray-800 truncate">
                            {o.snapshot.customer.name}
                          </p>
                          <p className="text-[12px] text-gray-400 truncate mt-0.5">
                            {o.snapshot.customer.area ? `${o.snapshot.customer.area} · ` : ""}
                            {billsCountLabel(o.snapshot)}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5">{formatSavedAt(o.sentAt)}</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => requestDeleteSent(o.id)}
                          aria-label="Delete sent order"
                          className="text-gray-300 active:text-red-500 p-2 -mr-2 shrink-0"
                        >
                          <Trash2 className="w-[17px] h-[17px]" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
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
                        <div className="flex-1 min-w-0">
                          <p className="text-[16px] font-medium text-gray-800 truncate">{r.name}</p>
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
          )
        ) : view === "review" ? (
          /* ── Review & send (mockup state 6) ────────────────────────────── */
          <>
            <div className="bg-white border-b border-gray-200">
              <div className="flex items-center gap-2 px-4 py-[14px]">
                <button
                  type="button"
                  onClick={() => window.history.back()}
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
                  { value: "Normal", dot: "bg-teal-500",  on: "border-teal-500 bg-teal-50 text-teal-700" },
                  { value: "Urgent", dot: "bg-amber-400", on: "border-amber-300 bg-amber-50 text-amber-700" },
                  { value: "Call",   dot: "bg-red-400",   on: "border-red-300 bg-red-50 text-red-700" },
                ] as const).map((d) => {
                  const on     = dispatch === d.value;
                  const isCall = d.value === "Call";
                  // Call pill shows its chosen target once committed: "Call · SO/Dealer".
                  const label  = isCall
                    ? (dispatch === "Call" && callTarget ? `Call · ${callTarget}` : "Call")
                    : d.value;
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => (isCall ? openCallSheet() : chooseDispatch(d.value))}
                      className={`h-[42px] rounded-[10px] border text-[13px] flex items-center justify-center gap-1.5 whitespace-nowrap ${
                        on ? `${d.on} font-semibold` : "border-gray-200 bg-white text-gray-400 font-medium"
                      }`}
                    >
                      <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${d.dot}`} />
                      {label}
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
                {MARKER_OPTIONS.map((m) => {
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
                  onClick={() => window.history.back()}
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
                        const toolsMaterial = p.family === "TOOLS" ? (p.packs[0]?.material ?? null) : null;
                        const second = p.family === "TOOLS"
                          ? (p.region && toolsMaterial
                              ? `${p.region} · ${toolsMaterial}`
                              : toolsMaterial ?? p.region ?? null)
                          : p.region ?? getSecondLine(
                              p.family, p.subProduct,
                              getBaseAliasDisplay(p.product, p.baseColour),
                            ) ?? (p.subProduct === "STICKERS" ? null : p.family);
                        // Optional full-name label appended to the subtitle (e.g.
                        // MACHINE TINTER "Dramatone · Fast Red"). Null for products
                        // whose base already shows the colour name (Universal/GVA).
                        const aliasLabel = getBaseAliasLabel(p.product, p.baseColour);
                        // Multi-select ON → checkbox row that TOGGLES selection
                        // (does not open the picker). OFF → single-add row.
                        if (multiSelect) {
                          const selected = selectedProducts.some((s) => s.id === p.id);
                          return (
                            <div
                              key={p.id}
                              onClick={() => toggleProductSelection(p)}
                              className="flex items-center gap-3 py-[13px] px-1 border-b border-gray-100 last:border-b-0 cursor-pointer active:bg-gray-50 touch-manipulation"
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
                                  <p className="text-[12px] text-gray-400 truncate mt-0.5">{second}{aliasLabel && <span className="text-gray-300"> · {aliasLabel}</span>}</p>
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
                                <p className="text-[12px] text-gray-400 truncate mt-0.5">{second}{aliasLabel && <span className="text-gray-300"> · {aliasLabel}</span>}</p>
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
                  <button type="button" onClick={() => window.history.back()} aria-label="Back to results" className="shrink-0">
                    <ChevronDown className="w-[18px] h-[18px] text-gray-500" />
                  </button>
                  <span className="text-[15px] font-semibold text-gray-900">Set quantities</span>
                  <span className="text-[12px] text-gray-500 ml-auto">
                    {selectedProducts.length} {selectedProducts.length === 1 ? "product" : "products"}
                  </span>
                </div>

                {/* one section per selected product — full pack rows (reused) */}
                {selectedProducts.map((p) => {
                  const second = p.region ?? getSecondLine(
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

                {/* Bottom scroll room — gives the LAST product's last qty row
                    enough space below it for the scroll-mb-[32px] gap to be
                    honored (without it the bottom cell clamps and lands flush
                    against the keyboard). Pure spacer, picking/multiqty only. */}
                <div aria-hidden className="h-[96px] shrink-0" />
              </>
            ) : (
              /* ── Quantity picking (single product) ────────────────────── */
              activeProduct && (
                <>
                  <div className="px-4 pt-4 pb-2">
                    <div className="text-[17px] font-semibold text-gray-900 leading-tight">
                      {productLabel(activeProduct)}{aliasSuffix(activeProduct)}
                    </div>
                    {(activeProduct.region ?? getSecondLine(
                      activeProduct.family, activeProduct.subProduct,
                      getBaseAliasDisplay(activeProduct.product, activeProduct.baseColour),
                    )) && (
                      <div className="text-[13px] text-gray-400 leading-tight mt-0.5">
                        {activeProduct.region ?? getSecondLine(
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

                  {/* Cancel / Add to Bill now lives in the non-scrolling <main>
                      footer (pickerFooter) — keyboard-safe: it rides --vvh and
                      hides while a qty box is focused. Pulling it out of this
                      min-h-full scroll content is what kills the grey band /
                      parked scroll the old inline bar caused (§22). See render end. */}

                  {/* Bottom scroll room — lets the LAST pack row (e.g. 20L) honor
                      the scroll-mb-[32px] gap instead of clamping flush against
                      the keyboard. Pure spacer. */}
                  <div aria-hidden className="h-[96px] shrink-0" />
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
            onClick={() => window.history.back()}
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
                  onClick={() => window.history.back()}
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

        {/* Call-routing bottom-sheet — CLONE of the Cross-depot sheet. Dismissing
            without a pick cancels (cancelCallSheet makes no state change, so Call is
            only ever committed by choosing SO/Dealer). */}
        {callSheetOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
            onClick={() => window.history.back()}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Call to"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[480px] bg-white rounded-t-[18px] p-5"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[16px] font-semibold text-gray-900">Call to?</h2>
                <button
                  type="button"
                  onClick={() => window.history.back()}
                  aria-label="Close"
                  className="text-gray-400 text-[22px] leading-none px-1 active:text-gray-600"
                >
                  ×
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["SO", "Dealer"] as const).map((t) => {
                  const on = callTarget === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => confirmCall(t)}
                      className={`h-[48px] rounded-[10px] border text-[15px] ${
                        on
                          ? "border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold"
                          : "border-gray-200 bg-white text-gray-700 font-medium active:bg-gray-50"
                      }`}
                    >
                      {t}
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
            onClick={() => window.history.back()}
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
                  onClick={() => window.history.back()}
                  className="flex-1 h-[44px] rounded-[10px] bg-gray-100 text-gray-700 text-[14px] font-medium active:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => confirmDeleteBill(billToDelete)}
                  className="flex-1 h-[44px] rounded-[10px] bg-red-600 text-white text-[14px] font-semibold active:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete-draft confirm — same bottom-sheet pattern as delete-bill above
            (draftsEnabled only; only reachable from the Drafts screen). */}
        {draftsEnabled && draftToDelete !== null && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
            onClick={() => window.history.back()}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Delete draft"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[480px] bg-white rounded-t-[18px] p-5"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)" }}
            >
              <h2 className="text-[16px] font-semibold text-gray-900">Delete this draft?</h2>
              <p className="text-[13px] text-gray-500 mt-1.5 leading-snug">
                {savedDrafts.find((d) => d.id === draftToDelete)?.snapshot.customer.name ?? "This"}&rsquo;s saved order will be removed. This can&rsquo;t be undone.
              </p>
              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => window.history.back()}
                  className="flex-1 h-[44px] rounded-[10px] bg-gray-100 text-gray-700 text-[14px] font-medium active:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => confirmDeleteDraftAction(draftToDelete)}
                  className="flex-1 h-[44px] rounded-[10px] bg-red-600 text-white text-[14px] font-semibold active:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete-sent confirm — same bottom-sheet pattern as delete-draft
            above (draftsEnabled only; only reachable from the Sent screen). */}
        {draftsEnabled && sentToDelete !== null && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
            onClick={() => window.history.back()}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Delete sent order"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[480px] bg-white rounded-t-[18px] p-5"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)" }}
            >
              <h2 className="text-[16px] font-semibold text-gray-900">Delete this sent order?</h2>
              <p className="text-[13px] text-gray-500 mt-1.5 leading-snug">
                {sentOrders.find((o) => o.id === sentToDelete)?.snapshot.customer.name ?? "This"}&rsquo;s sent order will be removed from this list. This can&rsquo;t be undone.
              </p>
              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => window.history.back()}
                  className="flex-1 h-[44px] rounded-[10px] bg-gray-100 text-gray-700 text-[14px] font-medium active:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => confirmDeleteSentAction(sentToDelete)}
                  className="flex-1 h-[44px] rounded-[10px] bg-red-600 text-white text-[14px] font-semibold active:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Save-draft confirmation overlay — teal check + "Draft saved", then
            handleSaveDraftTap auto-navigates to Drafts after ~1s ("saved" kind).
            handleSend uses the "sending" kind instead — "Opening mail", a
            HANDOFF not a success (mailto only opens the mail app, it never
            confirms delivery), so it never says "Sent" or shows a tick; no
            onComplete nav after — the order stays on screen either way.
            Position:fixed so it sits above everything without touching the
            scroll container / --vvh math (§22/§25) — same isolation as the
            sheets above (they're fixed too; that doesn't conflict with the
            hand-tuned scroll since fixed elements sit outside it regardless of
            --vvh sizing).
            Sequence: backdrop + card spring in -> circle pops -> ring pulses
            once -> check draws OR icon fades in -> (~1s hold) -> card
            fades+shrinks out. Pure CSS @keyframes + SVG stroke-dashoffset, no
            animation library. All animation rules live under
            prefers-reduced-motion: no-preference (see the <style> block above
            <main>) — the un-animated base state IS the fully-settled look, so
            reduced-motion users just see the static icon + text with no
            transition at all. */}
        {overlayPhase && (
          <div
            className={`fixed inset-0 z-[60] flex items-center justify-center px-6 po-save-backdrop ${
              overlayPhase === "exit" ? "po-save-backdrop--exit" : "po-save-backdrop--enter"
            }`}
            aria-live="polite"
          >
            <div
              className={`relative flex flex-col items-center gap-3 bg-white rounded-[20px] px-8 py-7 shadow-xl po-save-card ${
                overlayPhase === "exit" ? "po-save-card--exit" : "po-save-card--enter"
              }`}
            >
              <div className="relative w-16 h-16 flex items-center justify-center">
                {/* Expanding pulse ring — one shot, behind the circle */}
                <span className="po-save-ring absolute inset-0 rounded-full border-2 border-teal-600" aria-hidden="true" />
                <div className="po-save-circle relative w-16 h-16 rounded-full bg-teal-600 flex items-center justify-center">
                  {overlayKind === "saved" ? (
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                      <polyline
                        className="po-save-check"
                        points="4 12 9 17 20 6"
                        stroke="#fff"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <Send className="po-save-icon-fade w-[26px] h-[26px] text-white" />
                  )}
                </div>
              </div>
              <p className="po-save-text text-[15px] font-semibold text-gray-900">
                {overlayKind === "saved" ? "Draft saved" : "Opening mail"}
              </p>
            </div>
          </div>
        )}

        {/* Reset confirm dialog — New order / Switch customer */}
        {confirmKind && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
            onClick={dismissConfirm}
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
                  onClick={dismissConfirm}
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
          // Send order — HIDDEN while the soft keyboard is ACTUALLY open (keyboardOpen,
          // from viewport height). Returns on keyboard close even if Ship To / Notes
          // keeps focus (Android down-caret).
          ? (keyboardOpen
              ? null
              : reviewFooter())
          // Multi-qty sub-screen — Add products. HIDDEN while the keyboard is open so it
          // never covers the rows; returns on keyboard close (focus may persist).
          : mode === "multiqty"
            ? (keyboardOpen
                ? null
                : footerPill({
                    onClick: commitMultiSelect,
                    disabled: !anyMultiQty,
                    label: `Add ${selectedProducts.length} ${selectedProducts.length === 1 ? "product" : "products"}`,
                  }))
            // Single-product picker — Cancel / Add to Bill. HIDDEN while the keyboard is
            // open; returns on close even if the qty box keeps focus.
            : (mode === "picking" && activeProduct)
              ? (keyboardOpen ? null : pickerFooter())
              // Multi-select active with ≥1 ticked — Set quantities. HIDDEN while the
              // keyboard is up (search typing) so results fill the space; back on close.
              : (mode === "search" && showSelectBar)
                ? (keyboardOpen ? null : footerPill({ onClick: openMultiQty, label: `Set quantities (${selectedProducts.length})` }))
                // Default build CTA — Review order when the cart has lines. Same keyboard
                // gate: hidden while typing the product search, returns on close.
                : (mode === "search" && !showSelectBar && hasAnyLines)
                  ? (keyboardOpen ? null : footerPill({ onClick: openReview, label: "Review order" }))
                  : null
      )}

      {/* Read-only Sent receipt footer — Edit order / Resend. Lives outside
          the {selectedCust && (...)} block above since the receipt renders
          while selectedCust is null (it never loads into live state). */}
      {draftsEnabled && receiptOrder && receiptFooter(receiptOrder)}

      {/* Home · Drafts · Sent bottom bar — draftsEnabled only, and only on the
          three browsing screens (selectedCust true on Build/Review, and
          receiptOrder set on the receipt, both make this branch structurally
          unreachable there — no separate hide-on-order logic needed). Gates
          on keyboardOpen like every other floating footer on this page
          (§55). This is NOT the §59 Home/Menu/You shell — that's login-only
          and unrelated; /po is public with no session, so it needs its own
          bar. Bookmark (Drafts) vs. Send/paper-plane (Sent) are deliberately
          distinct glyphs so the two are easy to tell apart. */}
      {draftsEnabled && !selectedCust && !receiptOrder && !keyboardOpen && (
        <div
          className="flex-shrink-0 bg-white border-t border-gray-200 flex"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 4px)" }}
        >
          <button
            type="button"
            onClick={goHome}
            className={`flex-1 flex flex-col items-center gap-0.5 pt-[9px] pb-[7px] text-[11px] font-medium ${
              browseScreen === "home" ? "text-teal-600" : "text-gray-400"
            }`}
          >
            <Home className="w-5 h-5" />
            Home
          </button>
          <button
            type="button"
            onClick={openDrafts}
            className={`flex-1 flex flex-col items-center gap-0.5 pt-[9px] pb-[7px] text-[11px] font-medium ${
              browseScreen === "drafts" ? "text-teal-600" : "text-gray-400"
            }`}
          >
            <Bookmark className="w-5 h-5" />
            Drafts
          </button>
          <button
            type="button"
            onClick={openSent}
            className={`flex-1 flex flex-col items-center gap-0.5 pt-[9px] pb-[7px] text-[11px] font-medium ${
              browseScreen === "sent" ? "text-teal-600" : "text-gray-400"
            }`}
          >
            <Send className="w-5 h-5" />
            Sent
          </button>
        </div>
      )}
    </main>
  );
}
