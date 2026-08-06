"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { Check, Pencil, Copy, Mail, Flag, Search, Printer, StickyNote, Star, Droplet, X, Truck } from "lucide-react";
import type { MoOrder, MoOrderLine, CustomerSearchResult } from "@/lib/mail-orders/types";
import type { SlotCutoffs } from "@/lib/mail-orders/utils";
import {
  smartTitleCase,
  cleanSubject,
  isOdCiFlagged,
  getOrderFlags,
  getOrderVolume,
  getPackVolumeLiters,
  getLineVolume,
  buildReplyTemplate,
  getOrderSignals,
  getBillLabel,
  getSplitDisplayLabel,
  splitLinesByCategory,
  splitDeliveryRemarks,
  SPLIT_VOLUME_THRESHOLD,
  SPLIT_LINE_THRESHOLD,
  formatVolume,
} from "@/lib/mail-orders/utils";
// Stable tag keys — the ship-card signal filter below keys on MO_TAG.urgent
// rather than the literal "Urgent", so a label change cannot silently un-filter
// it. Leaf module, no cycle (see tag-catalog.ts header).
import { MO_TAG } from "@/lib/hide/tag-catalog";
import { searchCustomers, saveLineStatus, searchSkus, resolveLine, saveNotes } from "@/lib/mail-orders/api";
import { BillingTabBar, type BillingTab } from "@/components/billing/billing-tab-bar";
import { BillingPickingTab } from "@/components/billing/billing-picking-tab";
import { BillingActionRibbon, BTN_BASE, BTN_OFF } from "@/components/billing/billing-action-ribbon";
import { BillingShipToPencil } from "@/components/billing/billing-ship-to-pencil";
import type { DispatchWindow } from "@/components/floor/dispatch-slot-picker";
import { BillToCard } from "@/components/mail-orders/bill-to-card";
import { ShipToCard } from "@/components/mail-orders/ship-to-card";
import { MetaRibbon, getMatchChip } from "@/components/mail-orders/meta-ribbon";
import { InstructionsStrip } from "@/components/mail-orders/instructions-strip";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

interface ReviewViewProps {
  orders: MoOrder[];           // filtered orders (by slot, search, filters)
  allOrders: MoOrder[];        // all orders (for slot counts, unfiltered)
  activeSlot: string | null;
  flaggedIds: Set<number>;
  focusedId: number | null;
  onFocusChange: (id: number | null) => void;
  onFlag: (id: number) => void;
  // `opts.isEdit` marks a correction to an already-punched order, so the page
  // can skip the punch-time restamp and the pending-list grace. Optional — a
  // caller that omits it gets fresh-punch behaviour, which is what every
  // non-billing caller wants.
  onSaveSoNumber: (id: number, value: string, opts?: { isEdit?: boolean }) => Promise<boolean>;
  onSaveCustomer: (id: number, data: { customerCode: string; customerName: string; saveKeyword?: boolean; keyword?: string; area?: string; deliveryType?: string; route?: string }) => void;
  onCopy: (id: number, lines: MoOrderLine[], batchIndex?: number) => void;
  batchStates: Record<number, number>;
  onAdvanceBatch: (orderId: number) => void;
  punchedVisible: boolean;
  onTogglePunched: () => void;
  recentlyPunchedIds: Set<number>;
  slotCutoffs: SlotCutoffs | undefined;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSplitComplete?: (orderAId: number) => void;
  /** Tag visibility (Feature B) — keys turned OFF; suppress matching badges. */
  disabledTagKeys?: Set<string>;
  // ── Billing v2 (rollout-flagged) ──────────────────────────────────────────
  // When `billingV2` is true this view grows an Orders | Picking tab bar at the
  // TOP OF THE RIGHT PANE — structurally identical to Floor Control, whose
  // Floor / On hold / Cancelled tabs sit in the same place
  // (components/floor/floor-page.tsx:613). The LEFT rail is untouched and stays
  // visible on both tabs, exactly as Floor's "needs your decision" rail does.
  // Only the right pane's CONTENT switches. State is owned by the parent page
  // so it survives this component re-rendering.
  // All three are undefined for every user today → nothing renders, and this
  // view behaves exactly as it always has.
  billingV2?: boolean;
  billingTab?: BillingTab;
  onBillingTabChange?: (tab: BillingTab) => void;
  /** Phase 2 — reload the order list after a billing action writes mo_orders. */
  onBillingActionSaved?: () => void;
  /**
   * Right-aligned controls for the Orders|Picking row — the date stepper and
   * Filter, relocated from the header's Row 2 on the billing face. Passed
   * straight through to BillingTabBar.rightSlot; this view never inspects it.
   */
  billingHeaderSlot?: React.ReactNode;
  /**
   * Billing v2 — is any HEADER FILTER currently narrowing the list?
   *
   * `searchQuery` already arrives as a prop, but `headerFilters` is owned by
   * mail-orders-page.tsx and never sent down. The empty states need to tell
   * "nothing came in" apart from "your filter hid it", so the parent answers
   * that one question rather than this view learning the filter shape.
   *
   * Defaults to false → a caller that does not pass it reads as "unfiltered",
   * which is the pre-existing behaviour for every non-billing face.
   */
  hasHeaderFilter?: boolean;
  /**
   * The day the header date stepper is on (YYYY-MM-DD, IST), forwarded to the
   * Billing Picking tab so its Done area follows the stepper. This view does
   * not read it for anything else — the Orders face is already filtered by the
   * parent, which fetches per date.
   *
   * Optional and passed straight through: omitted → the tab omits `?date=` →
   * the routes default to today, which is what they did before the param
   * existed. Every non-billing caller is unaffected.
   */
  selectedDate?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** "56L", or "" when the order has no measurable volume. ONE derivation, used
 *  by both the ribbon summary line and the Billing SKU caption — they must not
 *  be able to disagree about the same number. */
function volumeStringFor(order: MoOrder): string {
  const vol = Math.round(getOrderVolume(order.lines));
  return vol > 0 ? `${vol}L` : "";
}

function getDeliveryDotClass(type: string | null | undefined): string {
  switch ((type ?? "").toUpperCase()) {
    case "LOCAL": return "bg-blue-600";
    case "UPCOUNTRY":
    case "UPC": return "bg-orange-600";
    case "IGT": return "bg-teal-600";
    case "CROSS": return "bg-rose-600";
    default: return "bg-gray-300";
  }
}

function StarGlyph() {
  return <Star size={12} className="text-amber-500 flex-shrink-0" fill="currentColor" />;
}

function TruckGlyph() {
  return <Truck size={12} strokeWidth={2} className="text-violet-700 flex-shrink-0" />;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`;
}

// Map flag string to badge category

// ── SKU Table types/helpers ────────────────────────────────────────────────

type RowState = "normal" | "partial" | "not-found" | "unmatched";

// API expects snake_case values; UI displays the label.
type ReasonOption = { value: string; label: string };

const REASON_OPTIONS: (ReasonOption | null)[] = [
  { value: "out_of_stock", label: "Out of stock" },
  { value: "wrong_pack", label: "Wrong pack" },
  { value: "discontinued", label: "Discontinued" },
  { value: "other_depot", label: "Other depot" },
  null, // divider
  { value: "other", label: "Other" },
];

const REASON_LABELS: Record<string, string> = {
  out_of_stock: "Out of stock",
  wrong_pack: "Wrong pack",
  discontinued: "Discontinued",
  other_depot: "Other depot",
  other: "Other",
};

// 1-5 quick-pick keyboard mapping (skips the divider)
const REASON_KEY_VALUES = ["out_of_stock", "wrong_pack", "discontinued", "other_depot", "other"];

// ── Toggle component ───────────────────────────────────────────────────────

function SkuToggle({ isOn, onToggle }: { isOn: boolean; onToggle: () => void }) {
  return (
    <span
      className="mo-print-hide"
      onClick={onToggle}
      style={{
        width: 28, height: 14, borderRadius: 7,
        cursor: "pointer", position: "relative",
        display: "inline-block", transition: "background 0.15s",
        verticalAlign: "middle",
        background: isOn ? "#16a34a" : "#d1d5db",
      }}
    >
      <span style={{
        width: 10, height: 10, borderRadius: "50%",
        background: "#fff", position: "absolute", top: 2,
        left: isOn ? 16 : 2,
        transition: "left 0.12s",
        boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
      }} />
    </span>
  );
}

// ── Reason Dropdown ────────────────────────────────────────────────────────

function ReasonDropdown({
  onSelect,
  onClose,
}: {
  onSelect: (reason: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey, { capture: true });
    return () => document.removeEventListener("keydown", handleKey, { capture: true });
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "calc(100% + 2px)",
        right: 0,
        width: 148,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
        zIndex: 20,
        padding: 3,
      }}
    >
      {(() => {
        let reasonNumber = 0;
        return REASON_OPTIONS.map((opt, i) => {
          if (opt === null) {
            return <div key={`div-${i}`} style={{ height: 1, background: "#f3f4f6", margin: "2px 0" }} />;
          }
          reasonNumber++;
          const num = reasonNumber;
          return (
            <button
              key={opt.value}
              onClick={() => onSelect(opt.value)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                width: "100%", padding: "6px 10px",
                fontSize: 11, fontWeight: 500, color: "#111827",
                border: "none", background: "none", cursor: "pointer",
                textAlign: "left", borderRadius: 5, transition: "background 0.08s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <span style={{
                fontSize: 9, fontWeight: 600, color: "#9ca3af",
                width: 14, textAlign: "center", flexShrink: 0,
                fontFamily: '"SF Mono", ui-monospace, monospace',
              }}>
                {num}
              </span>
              {opt.label}
            </button>
          );
        });
      })()}
    </div>
  );
}

// ── Resolve Popover ────────────────────────────────────────────────────────

interface SkuSearchResult {
  material: string;
  description: string;
  packCode: string;
  packMatch: boolean;
}

function ResolvePopover({
  line,
  onResolve,
  onClose,
}: {
  line: MoOrderLine;
  onResolve: (lineId: number, material: string, description: string, packCode: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(line.rawText);
  const [packFilter, setPackFilter] = useState<string | null>(null);
  const [results, setResults] = useState<SkuSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    }
    document.addEventListener("keydown", handleKey, { capture: true });
    return () => document.removeEventListener("keydown", handleKey, { capture: true });
  }, [onClose]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!query.trim()) { setResults([]); return; }
      setSearching(true);
      try {
        const data = await searchSkus(query.trim(), packFilter ?? undefined);
        setResults(data);
      } catch { setResults([]); }
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, packFilter]);

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)", zIndex: 49,
        }}
      />
      <div
        ref={ref}
        style={{
          position: "fixed",
          top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width: 480, maxHeight: "70vh",
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          zIndex: 50,
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "12px 16px",
          borderBottom: "1px solid #e5e7eb",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 12,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>Resolve Line</div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{line.rawText}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 24, height: 24, borderRadius: 4, border: "1px solid #e5e7eb",
              background: "#fff", cursor: "pointer", fontSize: 14, color: "#9ca3af",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Detected info */}
        <div style={{ padding: "8px 16px", background: "#f9fafb", fontSize: 11, color: "#6b7280", display: "flex", gap: 12, flexWrap: "wrap" }}>
          {line.productName && <span>Product: <b style={{ color: "#111827" }}>{line.productName}</b></span>}
          {line.baseColour && <span>Base: <b style={{ color: "#111827" }}>{line.baseColour}</b></span>}
          {line.packCode && <span>Pack: <b style={{ color: "#111827" }}>{line.packCode}</b></span>}
          <span>Qty: <b style={{ color: "#111827" }}>{line.quantity}</b></span>
        </div>

        {/* Search */}
        <div style={{ padding: "8px 16px", display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search SKU..."
            autoFocus
            style={{
              flex: 1, height: 30, border: "1px solid #e5e7eb", borderRadius: 6,
              padding: "0 10px", fontSize: 11, outline: "none", color: "#374151",
            }}
          />
          {/* Pack filter chips */}
          <div style={{ display: "flex", gap: 4 }}>
            {["1", "4", "10", "20"].map(pk => (
              <button
                key={pk}
                onClick={() => setPackFilter(packFilter === pk ? null : pk)}
                style={{
                  height: 24, padding: "0 8px", borderRadius: 4, fontSize: 10, fontWeight: 500,
                  border: "1px solid", cursor: "pointer", transition: "all 0.1s",
                  ...(packFilter === pk
                    ? { background: "#111827", color: "#fff", borderColor: "#111827" }
                    : { background: "#fff", color: "#6b7280", borderColor: "#e5e7eb" }
                  ),
                }}
              >
                {pk}L
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: "auto", maxHeight: 320 }}>
          {searching && (
            <div style={{ padding: 16, textAlign: "center", fontSize: 11, color: "#9ca3af" }}>Searching...</div>
          )}
          {!searching && results.length === 0 && query.trim() && (
            <div style={{ padding: 16, textAlign: "center", fontSize: 11, color: "#9ca3af" }}>No SKUs found</div>
          )}
          {results.map((sku) => (
            <button
              key={sku.material}
              onClick={() => onResolve(line.id, sku.material, sku.description, sku.packCode)}
              style={{
                display: "flex", width: "100%", padding: "8px 16px", gap: 8,
                border: "none", borderBottom: "1px solid #f3f4f6", background: "#fff",
                cursor: "pointer", textAlign: "left", alignItems: "center",
                transition: "background 0.08s",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#f9fafb"}
              onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}
            >
              <span style={{ fontFamily: '"SF Mono", ui-monospace, Menlo, monospace', fontSize: 11, color: "#6b7280", width: 80, flexShrink: 0 }}>
                {sku.material}
              </span>
              <span style={{ fontSize: 11, flex: 1, minWidth: 0, color: "#111827" }}>
                {sku.description}
                <span style={{ color: "#9ca3af" }}> · {sku.packCode}L</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function ReviewView({
  orders,
  allOrders,
  focusedId,
  onFocusChange,
  onFlag,
  onSaveSoNumber,
  onSaveCustomer,
  onCopy,
  punchedVisible,
  onTogglePunched,
  recentlyPunchedIds,
  searchQuery,
  onSearchChange,
  onSplitComplete,
  disabledTagKeys,
  billingV2 = false,
  billingTab = "orders",
  onBillingTabChange,
  onBillingActionSaved,
  billingHeaderSlot,
  hasHeaderFilter = false,
  selectedDate,
}: ReviewViewProps) {
  // Billing v2 (Phase 2) — dispatch windows for the reused Floor slot picker.
  // Fetched ONLY when the flag is on: with it off this effect returns
  // immediately, issues no request, and `billingWindows` stays [] and unused.
  const [billingWindows, setBillingWindows] = useState<DispatchWindow[]>([]);
  useEffect(() => {
    if (!billingV2) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/billing/dispatch-windows", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { windows?: DispatchWindow[] };
        if (!cancelled) setBillingWindows(body.windows ?? []);
      } catch {
        // Silent — the picker simply has no windows to offer, and the rest of
        // the detail view is unaffected.
      }
    })();
    return () => { cancelled = true; };
  }, [billingV2]);
  // ── Local state ─────────────────────────────────────────────────
  const [soInput, setSoInput] = useState("");
  const [editingSoNumber, setEditingSoNumber] = useState(false);
  const [replyCopied, setReplyCopied] = useState(false);
  const [codePopoverOpen, setCodePopoverOpen] = useState(false);

  // Customer search popover state
  const [custSearchQuery, setCustSearchQuery] = useState("");
  const [custSearchResults, setCustSearchResults] = useState<CustomerSearchResult[]>([]);
  const [custSearching, setCustSearching] = useState(false);
  const [custSearched, setCustSearched] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const custSearchInputRef = useRef<HTMLInputElement>(null);

  // SKU table state
  const [reasonDropdownLineId, setReasonDropdownLineId] = useState<number | null>(null);
  const [lineStatusOverrides, setLineStatusOverrides] = useState<Map<number, { found: boolean; reason: string | null }>>(new Map());
  const [resolveLineId, setResolveLineId] = useState<number | null>(null);
  const [resolvedLineOverrides, setResolvedLineOverrides] = useState<Map<number, {
    skuCode: string;
    skuDescription: string;
    packCode: string;
  }>>(new Map());
  // Alt-SKU modal (combo twins). altModalLine = the line whose alternates are
  // shown; copiedCode = the most-recently-copied code for the transient
  // "Copied" state. No persistence — clipboard only.
  const [altModalLine, setAltModalLine] = useState<MoOrderLine | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);
  const [activeLineIndex, setActiveLineIndex] = useState<number>(0);
  const [descMode, setDescMode] = useState<"long" | "short">(() => {
    if (typeof window === "undefined") return "long";
    const stored = window.localStorage.getItem("mo-review-desc-mode");
    return stored === "short" ? "short" : "long";
  });
  const [splitDismissed, setSplitDismissed] = useState(false);
  const [splitting, setSplitting] = useState(false);

  // Notes modal — keyed by orderId so the dot/fill survives order navigation
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesOverrides, setNotesOverrides] = useState<Map<number, string | null>>(new Map());

  // ── Billing v2 — deliberately reopened punched order ──────────────
  // The right pane blanks to "All caught up" whenever `pendingOrders` is empty,
  // deliberately IGNORING `focusedId` — because focusedId is sticky (nothing in
  // this app ever clears it) and would otherwise keep the just-punched bill on
  // screen as though it were still work.
  //
  // That guard also swallowed a deliberate click on a DONE row, so re-reading a
  // punched bill did nothing. This state is the narrow exception: it is set ONLY
  // by clicking a row the punchedOrders predicate would call done, so it can
  // distinguish "I want to look at this again" from focusedId's residue.
  //
  // ⚠ A punch NEVER sets this. That is the whole point: after the last punch of
  // the day focusedId still points at that order and `selectedOrder` still
  // resolves, so anything keyed on focus would wrongly redisplay it — this stays
  // null and the pane flips to "All caught up", exactly as before.
  const [reopenedPunchedId, setReopenedPunchedId] = useState<number | null>(null);

  // ── Selected order ──────────────────────────────────────────────
  const selectedOrder = useMemo(() => {
    if (focusedId === null) return null;
    return orders.find(o => o.id === focusedId) ?? null;
  }, [orders, focusedId]);

  // Reset SO input + popover when focused order changes
  useEffect(() => {
    setSoInput("");
    setEditingSoNumber(false);
    setCodePopoverOpen(false);
    setCustSearchQuery("");
    setCustSearchResults([]);
    setCustSearched(false);
    setReasonDropdownLineId(null);
    setLineStatusOverrides(new Map());
    setResolveLineId(null);
    setResolvedLineOverrides(new Map());
    setActiveLineIndex(0);
    setSplitDismissed(false);
    setSplitting(false);
    setNotesModalOpen(false);
    setNotesDraft("");
  }, [focusedId]);

  // Persist desc mode to localStorage
  useEffect(() => {
    try {
      window.localStorage.setItem("mo-review-desc-mode", descMode);
    } catch {
      // localStorage unavailable — ignore
    }
  }, [descMode]);

  // Auto-select first pending order if none selected
  useEffect(() => {
    if (focusedId === null && orders.length > 0) {
      const first = orders.find(o => o.status !== "punched");
      if (first) onFocusChange(first.id);
    }
  }, [orders, focusedId, onFocusChange]);

  // Scroll selected order into view
  useEffect(() => {
    if (focusedId !== null) {
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-review-order-id="${focusedId}"]`)
          ?.scrollIntoView({ block: "nearest" });
      });
    }
  }, [focusedId]);

  // Close popover on outside click
  useEffect(() => {
    if (!codePopoverOpen) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setCodePopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [codePopoverOpen]);

  // Focus customer search input on popover open
  useEffect(() => {
    if (codePopoverOpen) {
      setTimeout(() => custSearchInputRef.current?.focus(), 50);
    }
  }, [codePopoverOpen]);

  // Debounced customer search
  useEffect(() => {
    if (!codePopoverOpen) return;
    if (custSearchQuery.length < 2) {
      setCustSearchResults([]);
      setCustSearched(false);
      return;
    }
    const timer = setTimeout(async () => {
      setCustSearching(true);
      try {
        const results = await searchCustomers(custSearchQuery);
        setCustSearchResults(results);
        setCustSearched(true);
      } catch {
        setCustSearchResults([]);
      }
      setCustSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [custSearchQuery, codePopoverOpen]);

  function getBillNumber(order: MoOrder): number {
    const combined = [order.remarks, order.billRemarks]
      .filter(Boolean).join(" ").toLowerCase();
    const m = combined.match(/\bbill\s+(\d+)\b/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // Group orders into pending and punched (earliest first, then bill number, then split label)
  const pendingOrders = useMemo(() => {
    const list = orders.filter(o => o.status !== "punched" || recentlyPunchedIds.has(o.id));
    return [...list].sort((a, b) => {
      const timeDiff = new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      const billDiff = getBillNumber(a) - getBillNumber(b);
      if (billDiff !== 0) return billDiff;
      return (a.splitLabel ?? "").localeCompare(b.splitLabel ?? "");
    });
  }, [orders, recentlyPunchedIds]);
  // Orders-tab badge: how many orders still NEED ACTION, i.e. not punched.
  //
  // ⚠ Deliberately NOT `pendingOrders.length`. That group keeps
  // recently-punched rows VISIBLE (`|| recentlyPunchedIds.has(o.id)` above) so a
  // row does not vanish from under the operator the moment they punch it —
  // right for the list, wrong for a count. Using it would leave the badge
  // reading one too many for a few seconds after every punch. The badge tracks
  // the truth; the rail tracks the operator's place in it.
  const pendingActionCount = useMemo(
    () => orders.filter(o => o.status !== "punched").length,
    [orders],
  );
  // ── Billing v2 — empty-state discrimination ──────────────────────
  // Two different facts, two different messages. "Nothing came in" is good
  // news and says so; "your filter hid everything" is a dead end the operator
  // has to get out of, and telling them "no new orders" while a filter is on
  // would be a lie they act on.
  //
  // ⚠ `pendingOrders` keeps recently-punched rows for ~8s (the grace window
  // above), so both states appear a beat AFTER the last punch, not instantly.
  // That is deliberate and inherited — the rail must not empty under a hand.
  const hasActiveFilter = searchQuery.trim().length > 0 || hasHeaderFilter;
  const genuinelyEmpty = pendingOrders.length === 0 && !hasActiveFilter;

  const punchedOrders = useMemo(() => {
    const list = orders.filter(o => o.status === "punched" && !recentlyPunchedIds.has(o.id));
    return [...list].sort((a, b) => {
      const timeDiff = new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      const billDiff = getBillNumber(a) - getBillNumber(b);
      if (billDiff !== 0) return billDiff;
      return (a.splitLabel ?? "").localeCompare(b.splitLabel ?? "");
    });
  }, [orders, recentlyPunchedIds]);

  // ── Billing v2 — clearing the reopened-punched exception ──────────
  // Two ways out, besides clicking a pending row (which the row handler itself
  // clears) and the × on the detail header.
  //
  // 1. New work arrived. The exception exists only for the empty state; once
  //    there is something to punch the pane should be back on work, not on a
  //    bill the operator opened five minutes ago. Keyed on the LENGTH, not the
  //    array — `pendingOrders` is a fresh reference on every 30s poll.
  useEffect(() => {
    if (pendingOrders.length > 0) setReopenedPunchedId(null);
  }, [pendingOrders.length]);

  // 2. The reopened order left the visible set — the operator changed date, or
  //    a filter now excludes it. Without this the pane would fall through to the
  //    `selectedOrder` arm with nothing to render.
  useEffect(() => {
    if (reopenedPunchedId !== null && !orders.some(o => o.id === reopenedPunchedId)) {
      setReopenedPunchedId(null);
    }
  }, [orders, reopenedPunchedId]);

  // ── Rail-head day summary (billing face only) ─────────────────────
  // Reproduces the two facts the top header carried before f82016f0 dropped
  // them ("N orders" + "X% punched"), from the SAME source: `allOrders` is what
  // mail-orders-page passes as its UNFILTERED day state (:1270) — the very set
  // its `totalOrders` / `punchPct` are computed from, so the rail cannot
  // disagree with the number this page shows on the non-billing face.
  //
  // ⚠ Deliberately NOT derived from `punchedOrders` above. That list is
  // filtered, and it excludes the 8-second recently-punched grace window by
  // design (:687) — reading it here would make the percentage dip and recover
  // after every punch, and disagree with the header whenever a filter is on.
  const railTotal = allOrders.length;
  const railPunched = useMemo(
    () => allOrders.filter(o => o.status === "punched").length,
    [allOrders],
  );
  // Zero-guard: no orders means no percentage to state. Guarding here rather
  // than at the render site keeps the divide in one place.
  const railPunchPct = railTotal > 0
    ? Math.round((railPunched / railTotal) * 100)
    : 0;

  // ── Handlers ─────────────────────────────────────────────────────

  async function handlePunchClick() {
    if (!selectedOrder) return;
    if (soInput.length !== 10) return;
    // Recomputed here, NOT read from `soEditMode`: that binding lives inside
    // renderDetailHeader and is out of scope in this function. This expression
    // is character-equivalent to it, including the `!!soNumber` term.
    //
    // ⚠ The `!!selectedOrder.soNumber` term is load-bearing, not defensive.
    // renderDetailHeader's `isPunched` is `status === "punched" && !!soNumber`
    // (:1261), and handlePunch (mail-orders-page.tsx:588) can leave an order
    // `punched` with NO number. Such an order shows the FRESH-PUNCH box, so
    // dropping this term would mark a genuine first punch as an edit and rob it
    // of the grace it needs.
    const editFlag =
      billingV2 && selectedOrder.status === "punched" && !!selectedOrder.soNumber && editingSoNumber;
    const ok = await onSaveSoNumber(selectedOrder.id, soInput, { isEdit: editFlag });
    if (ok) {
      setSoInput("");
      setEditingSoNumber(false);
    }
  }

  function handleSoKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && soInput.length === 10) {
      e.preventDefault();
      handlePunchClick();
    }
    // Escape cancels an EDIT only. On a fresh punch there is nothing to fall
    // back to, so it is left alone there and the header's own Escape chain keeps
    // whatever behaviour it has. `stopPropagation` keeps this key from also
    // reaching that chain and clearing the search behind the operator.
    if (e.key === "Escape" && editingSoNumber) {
      e.preventDefault();
      e.stopPropagation();
      handleCancelSoEdit();
    }
  }

  // Leave edit mode without writing anything — back to the view-mode pill.
  // `soInput` is blanked so the next entry into edit mode re-prefills cleanly
  // from `order.soNumber` rather than resuming a half-typed correction.
  function handleCancelSoEdit() {
    setEditingSoNumber(false);
    setSoInput("");
  }

  function handleReplyClick() {
    if (!selectedOrder) return;
    if (selectedOrder.status !== "punched" || !selectedOrder.soNumber) return;
    const billLabel = getBillLabel(selectedOrder);
    const name = smartTitleCase(
      selectedOrder.customerMatchStatus === "exact" && selectedOrder.customerName
        ? selectedOrder.customerName
        : cleanSubject(selectedOrder.subject),
    ) + (selectedOrder.splitLabel ? ` (${getSplitDisplayLabel(selectedOrder)})` : "")
      + (billLabel ? ` · ${billLabel}` : "");

    const template = buildReplyTemplate(
      selectedOrder.soName,
      [{
        customerName: name,
        customerCode: selectedOrder.customerCode ?? null,
        area: selectedOrder.customerArea ?? null,
        soNumber: selectedOrder.soNumber,
        flags: getOrderFlags(selectedOrder),
      }],
    );

    navigator.clipboard.writeText(template);
    setReplyCopied(true);
    setTimeout(() => setReplyCopied(false), 1500);
  }

  function handlePrintClick() {
    if (!selectedOrder) return;
    window.print();
  }

  function getEffectiveNotes(orderId: number, fallback: string | null): string | null {
    if (notesOverrides.has(orderId)) return notesOverrides.get(orderId) ?? null;
    return fallback;
  }

  function handleNotesOpen() {
    if (!selectedOrder) return;
    const current = getEffectiveNotes(selectedOrder.id, selectedOrder.notes ?? null);
    setNotesDraft(current ?? "");
    setNotesModalOpen(true);
  }

  async function handleNotesSave() {
    if (!selectedOrder || notesSaving) return;
    const trimmed = notesDraft.trim();
    const value: string | null = trimmed.length > 0 ? trimmed : null;
    setNotesSaving(true);
    try {
      await saveNotes(selectedOrder.id, value);
      setNotesOverrides(prev => {
        const next = new Map(prev);
        next.set(selectedOrder.id, value);
        return next;
      });
      setNotesModalOpen(false);
    } catch (err) {
      console.error("[review-view] saveNotes failed:", err);
    }
    setNotesSaving(false);
  }

  async function handleSplitClick() {
    if (!selectedOrder || !splitPreview || splitting) return;
    setSplitting(true);
    try {
      const res = await fetch(
        `/api/mail-orders/${selectedOrder.id}/split`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            groups: [splitPreview.groupA.lineIds, splitPreview.groupB.lineIds],
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("[review-view] split failed:", err);
        setSplitting(false);
        return;
      }
      const orderAId = selectedOrder.id;
      if (onSplitComplete) {
        onSplitComplete(orderAId);
      }
      setSplitting(false);
    } catch (err) {
      console.error("[review-view] split error:", err);
      setSplitting(false);
    }
  }

  function handleCopyClick() {
    if (!selectedOrder) return;
    onCopy(selectedOrder.id, selectedOrder.lines);
  }

  async function handlePickCandidate(c: { customerCode: string; customerName: string; area?: string | null; deliveryType?: string | null; route?: string | null }, fromSearch: boolean) {
    if (!selectedOrder) return;
    const shouldSaveKeyword = fromSearch && custSearchQuery.length >= 3 && !/^\d+$/.test(custSearchQuery);
    onSaveCustomer(selectedOrder.id, {
      customerCode: c.customerCode,
      customerName: c.customerName,
      saveKeyword: shouldSaveKeyword,
      keyword: shouldSaveKeyword ? custSearchQuery : undefined,
      area: c.area ?? undefined,
      deliveryType: c.deliveryType ?? undefined,
      route: c.route ?? undefined,
    });
    setCodePopoverOpen(false);
  }

  // Parsed multi candidates
  const multiCandidates = useMemo(() => {
    if (!selectedOrder?.customerCandidates) return [];
    try {
      return JSON.parse(selectedOrder.customerCandidates) as Array<{
        code: string; name: string; area?: string | null; deliveryType?: string | null; route?: string | null;
      }>;
    } catch {
      return [];
    }
  }, [selectedOrder]);

  const splitPreview = useMemo(() => {
    if (!selectedOrder) return null;
    if (selectedOrder.splitLabel) return null;
    if (selectedOrder.status === "punched") return null;
    if (selectedOrder.lines.length <= 1) return null;

    const totalVol = getOrderVolume(selectedOrder.lines);
    const tripsThreshold =
      totalVol > SPLIT_VOLUME_THRESHOLD ||
      selectedOrder.lines.length > SPLIT_LINE_THRESHOLD;
    if (!tripsThreshold) return null;

    const effectiveLines = selectedOrder.lines;
    const lineItems = effectiveLines.map((l, idx) => ({
      index: idx,
      quantity: l.quantity,
      packCode: l.packCode,
      productName: l.productName,
      paintType: l.paintType,
      materialType: l.materialType,
    }));

    const [groupAIdx, groupBIdx] = splitLinesByCategory(lineItems);
    if (groupAIdx.length === 0 || groupBIdx.length === 0) return null;

    const toIds = (indices: number[]) =>
      indices.map((i) => effectiveLines[i].id);
    const toVol = (indices: number[]) =>
      indices.reduce(
        (s, i) =>
          s + getLineVolume(effectiveLines[i].quantity, effectiveLines[i].packCode),
        0,
      );

    return {
      groupA: {
        lineIds: toIds(groupAIdx),
        count: groupAIdx.length,
        volume: toVol(groupAIdx),
      },
      groupB: {
        lineIds: toIds(groupBIdx),
        count: groupBIdx.length,
        volume: toVol(groupBIdx),
      },
    };
  }, [selectedOrder]);

  // ── Order row renderer (left panel) ──────────────────────────────
  function renderOrderRow(order: MoOrder) {
    const isFocused = focusedId === order.id;
    const isFlagged = order.isLocked || isOdCiFlagged(order);
    const isPunched = order.status === "punched";
    // Computed once here and reused below for both the truck icon and the
    // bill/split badges — do not call getOrderSignals a second time per row.
    const sigs = getOrderSignals(order, { disabledTagKeys });
    const hasTruckOrder = sigs.some((s) => s.type === "truck-order");

    const borderClass = isFocused
      ? "bg-teal-50 border-l-teal-600"
      : isFlagged
        ? "border-l-amber-600 hover:bg-gray-50"
        : isPunched
          ? "border-l-transparent opacity-40"
          : "border-l-transparent hover:bg-gray-50";

    return (
      <div
        key={order.id}
        onClick={() => {
          // Is this row in the DONE list? Derived from the order, deliberately
          // NOT from a parameter: this function is passed straight to
          // `.map(renderOrderRow)` for both lists, so a second argument would
          // silently receive the array index (falsy 0 for the first row).
          //
          // The test is character-identical to the `punchedOrders` predicate,
          // so "is this done" is decided by the same rule that put it there.
          const isDoneRow = order.status === "punched" && !recentlyPunchedIds.has(order.id);
          // Clicking a PENDING row clears the exception in the same expression —
          // no separate effect needed for the commonest way out.
          setReopenedPunchedId(billingV2 && isDoneRow ? order.id : null);
          onFocusChange(order.id);
        }}
        className={`px-3.5 py-2.5 border-b border-gray-100 cursor-pointer border-l-[3px] transition-colors ${borderClass}`}
        data-review-order-id={order.id}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${getDeliveryDotClass(order.customerDeliveryType)}`} />
            <span className="text-[13px] font-semibold text-gray-900 truncate">
              {smartTitleCase(order.customerName ?? cleanSubject(order.subject))}
            </span>
            {order.isKeyCustomer && <StarGlyph />}
            {hasTruckOrder && <TruckGlyph />}
            {(() => {
              // Show bill OR split badges in left panel — each order gets
              // at most one of these because getOrderSignals emits the
              // parent "Bill N" only when splitLabel is null.
              const leftPanelBadges = sigs.filter(
                s => s.type === "bill" || s.type === "split"
              );
              if (leftPanelBadges.length === 0) return null;
              const badgeStyles: Record<string, string> = {
                bill:  "bg-blue-50 text-blue-700 border-blue-200",
                split: "bg-purple-50 text-purple-600 border-purple-200",
              };
              return leftPanelBadges.map((s, i) => (
                <span
                  key={`lp-${i}`}
                  className={`text-[8px] font-semibold px-1 py-0 rounded border flex-shrink-0 ${badgeStyles[s.type] ?? ""}`}
                >
                  {s.label}
                </span>
              ));
            })()}
          </div>
          <span className="text-[11px] text-gray-400 flex-shrink-0 ml-2 tabular-nums">
            {formatTime(order.receivedAt)}
          </span>
        </div>
        <div className="text-[11px] text-gray-400 mt-0.5 truncate">
          {smartTitleCase(cleanSubject(order.soName))}
        </div>
        {isPunched && order.punchedBy?.name && order.punchedAt && (
          <div className="text-[10px] text-gray-400 mt-0.5 truncate tabular-nums">
            ✓ {smartTitleCase(order.punchedBy.name)} {formatTime(order.punchedAt)}
          </div>
        )}
      </div>
    );
  }

  // ── SKU table helpers ────────────────────────────────────────────
  function getRowState(line: MoOrderLine): RowState {
    const override = lineStatusOverrides.get(line.id);
    if (override) {
      if (!override.found) return "not-found";
      // override found=true means cleared — fall through to match status
    } else if (line.lineStatus?.found === false) {
      return "not-found";
    }
    if (line.matchStatus === "partial") return "partial";
    if (line.matchStatus === "unmatched") return "unmatched";
    return "normal";
  }

  function getLineReason(line: MoOrderLine): string | null {
    const override = lineStatusOverrides.get(line.id);
    if (override) return override.reason;
    return line.lineStatus?.reason ?? null;
  }

  async function handleToggle(line: MoOrderLine) {
    const currentState = getRowState(line);
    if (currentState === "not-found") {
      // Toggle ON — clear the not-found status
      setLineStatusOverrides(prev => {
        const next = new Map(prev);
        next.set(line.id, { found: true, reason: null });
        return next;
      });
      try {
        await saveLineStatus(line.id, { found: true });
      } catch (err) {
        console.error("[review-view] saveLineStatus (clear) failed:", err);
        // Revert on failure
        setLineStatusOverrides(prev => {
          const next = new Map(prev);
          next.delete(line.id);
          return next;
        });
      }
    } else {
      // Toggle OFF — show reason dropdown
      setReasonDropdownLineId(line.id);
    }
  }

  // reasonValue is the snake_case API value (e.g. "out_of_stock")
  async function handleReasonSelect(lineId: number, reasonValue: string) {
    setReasonDropdownLineId(null);
    setLineStatusOverrides(prev => {
      const next = new Map(prev);
      next.set(lineId, { found: false, reason: reasonValue });
      return next;
    });
    try {
      await saveLineStatus(lineId, { found: false, reason: reasonValue });
    } catch (err) {
      console.error("[review-view] saveLineStatus (set reason) failed:", err);
      // Revert on failure
      setLineStatusOverrides(prev => {
        const next = new Map(prev);
        next.delete(lineId);
        return next;
      });
    }
  }

  async function handleResolveLine(lineId: number, material: string, description: string, packCode: string) {
    setResolveLineId(null);
    setResolvedLineOverrides(prev => {
      const next = new Map(prev);
      next.set(lineId, { skuCode: material, skuDescription: description, packCode });
      return next;
    });
    try {
      await resolveLine(lineId, material, false);
    } catch {
      setResolvedLineOverrides(prev => {
        const next = new Map(prev);
        next.delete(lineId);
        return next;
      });
    }
  }

  // ── Navigation list (matches left panel order: pending then optionally punched) ──
  const navigationList = useMemo(() => {
    return [...pendingOrders, ...(punchedVisible ? punchedOrders : [])];
  }, [pendingOrders, punchedOrders, punchedVisible]);

  const currentIndex = useMemo(() => {
    if (focusedId === null) return -1;
    return navigationList.findIndex(o => o.id === focusedId);
  }, [navigationList, focusedId]);

  function handlePrevOrder() {
    if (currentIndex > 0) {
      onFocusChange(navigationList[currentIndex - 1].id);
    }
  }

  function handleNextOrder() {
    if (currentIndex < navigationList.length - 1) {
      onFocusChange(navigationList[currentIndex + 1].id);
    }
  }

  // Scroll active SKU line into view
  useEffect(() => {
    if (!selectedOrder || selectedOrder.lines.length === 0) return;
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-review-line-index="${activeLineIndex}"]`);
      if (row) row.scrollIntoView({ block: "nearest" });
    });
  }, [activeLineIndex, selectedOrder]);

  // ── Line-level keyboard navigation (review mode only) ─────────────
  useEffect(() => {
    function handleReviewKeys(e: KeyboardEvent) {
      if (!selectedOrder) return;

      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey || e.metaKey) return;

      const lines = selectedOrder.lines;
      if (!lines || lines.length === 0) return;

      // ↑↓ — Navigate lines
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setActiveLineIndex(prev => Math.min(prev + 1, lines.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setActiveLineIndex(prev => Math.max(prev - 1, 0));
        return;
      }

      // Tab / Shift+Tab — Navigate orders
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          if (currentIndex > 0) onFocusChange(navigationList[currentIndex - 1].id);
        } else {
          if (currentIndex < navigationList.length - 1) onFocusChange(navigationList[currentIndex + 1].id);
        }
        return;
      }

      // Space — Toggle found/not-found on active line
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        e.stopPropagation();
        const sortedLines = [...lines].sort((a, b) => a.lineNumber - b.lineNumber);
        const activeLine = sortedLines[activeLineIndex];
        if (activeLine) handleToggle(activeLine);
        return;
      }

      // 1-5 — Quick pick reason (when dropdown is open)
      if (reasonDropdownLineId !== null) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= 5) {
          e.preventDefault();
          e.stopPropagation();
          const reasonValue = REASON_KEY_VALUES[num - 1];
          if (reasonValue) handleReasonSelect(reasonDropdownLineId, reasonValue);
          return;
        }
      }
    }

    window.addEventListener("keydown", handleReviewKeys, { capture: true });
    return () => window.removeEventListener("keydown", handleReviewKeys, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrder, activeLineIndex, currentIndex, navigationList, onFocusChange, reasonDropdownLineId]);

  // ── Detail header (right panel) ──────────────────────────────────
  // Print. Component-scope because BOTH renderDetailHeader (the OFF actions
  // row) and renderSkuTable (the Billing caption row) render it, and it closes
  // over nothing order-specific — only handlePrintClick, which prints the whole
  // #mo-print-area container.
  const printButton = (
    <>
      <button
        onClick={handlePrintClick}
        title="Print order"
        style={{
          width: 28, height: 28, borderRadius: 6,
          border: "1px solid #e5e7eb", background: "#fff",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          color: "#9ca3af", transition: "all 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#f9fafb";
          e.currentTarget.style.borderColor = "#d1d5db";
          e.currentTarget.style.color = "#6b7280";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "#fff";
          e.currentTarget.style.borderColor = "#e5e7eb";
          e.currentTarget.style.color = "#9ca3af";
        }}
      >
        <Printer size={14} />
      </button>
    </>
  );

  function renderDetailHeader(order: MoOrder) {
    const isPunched = order.status === "punched" && !!order.soNumber;
    const signals = getOrderSignals(order, { isPunched, disabledTagKeys });
    const isFlagged = !!order.isLocked || isOdCiFlagged(order);
    const showInputMode = !isPunched || editingSoNumber;
    const punchReady = soInput.length === 10;

    // Ship-to identity + delivery instruction parsing
    const parsed = splitDeliveryRemarks(order.deliveryRemarks, order.shipToOverride ?? false);
    const billToName = smartTitleCase(order.customerName ?? cleanSubject(order.subject));

    // Billing v2 — resolve the override dealer through the FK relation instead
    // of the `[→ Name (Code)]` text encoding, mirroring Floor's dealer coalesce
    // (app/api/floor/order/[orderId]/route.ts:134/:145-146/:170-173).
    //
    // WHY: the billing ✎ pencil writes `shipToOverrideCustomerId` and nothing
    // else — it never rewrites `deliveryRemarks` — so for an operator-set
    // override the suffix the parse needs was never written. The parse then
    // fell through to `order.customerName`, i.e. the BILL-TO name, or to "—".
    // The relation is the field the save actually populates.
    //
    // `null` when the override is free text that matched no dealer (§6: the
    // flag can be true with no id) — that case still uses the parse below, so
    // nothing regresses for redirects like "as per challan".
    //
    // ⚠ Deliberately NOT writing the resolved name back into deliveryRemarks.
    // Two encodings of one fact drift; the FK is the source of truth.
    const overrideDealer =
      billingV2 && order.shipToOverride ? (order.shipToOverrideCustomer ?? null) : null;

    const shipToName = order.shipToOverride
      ? smartTitleCase(
          overrideDealer?.customerName
            ?? parsed.shipToName
            ?? order.deliveryRemarks?.trim()
            ?? order.customerName
            ?? "",
        )
      : billToName;
    const shipToCode = order.shipToOverride
      ? (overrideDealer?.customerCode ?? parsed.shipToCode)
      : (order.customerCode ?? null);
    // ⚠ Area/type come from a DIFFERENT SOURCE on each path and that is
    // intended. `order.shipToArea` is joined from mo_customer_keywords on the
    // PARSED code; the dealer's is master data (area_master → delivery_type_
    // master). With the flag off only the keywords value is ever read.
    const shipToArea = order.shipToOverride
      ? (overrideDealer?.area?.name ?? order.shipToArea ?? null)
      : (order.customerArea ?? null);
    const shipToDeliveryType = order.shipToOverride
      ? (overrideDealer?.area?.deliveryType?.name ?? order.shipToDeliveryType ?? null)
      : (order.customerDeliveryType ?? null);

    // Signal routing
    const billSignals = signals.filter((s) => s.card === "bill");
    const shipSignals = signals.filter((s) => s.card === "ship");

    // ── Billing v2 — the ship card drops Urgent / Hold / Dispatch ────────────
    // On this face those three are redundant with BillingActionRibbon, which
    // reads the SAME fields (billing-action-ribbon.tsx:54-55 — `dispatchStatus`
    // and `dispatchPriority`) in the SAME amber and red, and is interactive
    // besides. Dispatch is worse than redundant: its label is `dispatchStatus`
    // passed through verbatim, which in this app is only ever "Hold" or
    // "Dispatch", so the chip is the constant word "Dispatch" — rendered green
    // (signal-pill.tsx:32-34), i.e. the least informative state shouting
    // loudest — and its tagKey is undefined, so it is the one chip Hide
    // settings cannot suppress.
    //
    // ⚠ FILTERED AT THE CALL SITE, not in getOrderSignals. ShipToCard is SHARED
    // with the non-billing focus face (only its `actionSlot` pencil is gated),
    // and getOrderSignals also feeds the rail row (:1024) and Table view. This
    // narrows what THIS card is handed and nothing else.
    //
    // The predicate removes exactly three signals and keeps every other:
    //   • tagKey === MO_TAG.urgent  → the Urgent chip, pushed once
    //   • type === "status"         → the dispatchStatus chip, the ONLY push of
    //     that type; catches Hold AND Dispatch, and is immune to Dispatch's
    //     undefined tagKey and raw-passthrough label
    // `Challan` (type "info") is the only other ship signal and survives. The
    // "⚑ captured" pill is NOT a signal — ShipToCard renders it from the
    // `isOverride` prop (:99-106) — so it is untouched either way.
    const shipSignalsForCard = billingV2
      ? shipSignals.filter((s) => !(s.tagKey === MO_TAG.urgent || s.type === "status"))
      : shipSignals;

    // Instructions strip: collapse typed remarks into a single notes string
    const notesText = (order.remarks_list ?? [])
      .filter((r) => r.remarkType !== "delivery" && r.remarkType !== "billing")
      .map((r) => r.rawText)
      .filter((t) => t && t.trim().length > 0)
      .join(" · ");
    const notesString = notesText.length > 0 ? notesText : null;

    // MetaRibbon pre-formatted strings
    const receivedAtFormatted = formatTime(order.receivedAt);
    const punchedAtFormatted = order.punchedAt ? formatTime(order.punchedAt) : null;
    const punchedByName = order.punchedBy?.name ? smartTitleCase(order.punchedBy.name) : null;
    const volumeString = volumeStringFor(order);
    const soNameFormatted = smartTitleCase(cleanSubject(order.soName));

    // Picker integration: multi / unmatched orders get a clickable chip trigger
    const matchStatus = order.customerMatchStatus ?? null;
    const needsPicker = matchStatus === "multiple" || matchStatus === "unmatched";
    const chipFallbackLabel = matchStatus === "multiple"
      ? `${multiCandidates.length} found ▾`
      : matchStatus === "unmatched"
        ? "Search…"
        : undefined;
    const onCodeClickHandler = needsPicker
      ? () => setCodePopoverOpen((prev) => !prev)
      : undefined;

    const multiPopoverContent = (
      <div ref={popoverRef} className="bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-[280px] max-h-[280px] overflow-y-auto">
        {multiCandidates.map((c) => (
          <div
            key={c.code}
            onClick={() => handlePickCandidate({ customerCode: c.code, customerName: c.name, area: c.area, deliveryType: c.deliveryType, route: c.route }, false)}
            className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer"
          >
            <span className="font-mono text-[11px] text-gray-800 flex-shrink-0">{c.code}</span>
            <div className="min-w-0">
              <div className="text-[11px] text-gray-600 truncate">{smartTitleCase(c.name)}</div>
              {(c.area || c.route) && (
                <div className="text-[10px] text-gray-400 truncate">
                  {[c.area, c.route].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          </div>
        ))}
        <div className="border-t border-gray-100 mt-1.5 pt-1.5">
          <input
            ref={custSearchInputRef}
            type="text"
            placeholder="Or search by name..."
            value={custSearchQuery}
            onChange={(e) => setCustSearchQuery(e.target.value)}
            className="text-[11px] h-[28px] px-2 border border-gray-200 rounded-md w-full focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 focus:outline-none"
          />
          {custSearching && <p className="text-[11px] text-gray-400 px-1 py-1.5">Searching...</p>}
          {!custSearching && custSearched && custSearchResults.length === 0 && (
            <p className="text-[11px] text-gray-400 px-1 py-1.5">No customers found</p>
          )}
          {!custSearching && custSearchResults.map((c) => (
            <div
              key={c.customerCode}
              onClick={() => handlePickCandidate(c, true)}
              className="flex items-start gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer"
            >
              <span className="font-mono text-[11px] text-gray-800 flex-shrink-0">{c.customerCode}</span>
              <div className="min-w-0">
                <div className="text-[11px] text-gray-600 truncate">{smartTitleCase(c.customerName)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );

    const unmatchedPopoverContent = (
      <div ref={popoverRef} className="bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-[280px] max-h-[240px] overflow-y-auto">
        <input
          ref={custSearchInputRef}
          type="text"
          placeholder="Search customer..."
          value={custSearchQuery}
          onChange={(e) => setCustSearchQuery(e.target.value)}
          autoFocus
          className="text-[11px] h-[28px] px-2 border border-amber-200 rounded-md w-full mb-1.5 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 focus:outline-none"
        />
        {custSearching && <p className="text-[11px] text-gray-400 px-1 py-2">Searching...</p>}
        {!custSearching && custSearched && custSearchResults.length === 0 && (
          <p className="text-[11px] text-gray-400 px-1 py-2">No customers found</p>
        )}
        {!custSearching && custSearchResults.map((c) => (
          <div
            key={c.customerCode}
            onClick={() => handlePickCandidate(c, true)}
            className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer"
          >
            <span className="font-mono text-[11px] text-gray-800 flex-shrink-0">{c.customerCode}</span>
            <div className="min-w-0">
              <div className="text-[11px] text-gray-600 truncate">{smartTitleCase(c.customerName)}</div>
              {(c.area || c.route) && (
                <div className="text-[10px] text-gray-400 truncate">
                  {[c.area, c.route].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );

    const popoverContent = needsPicker && codePopoverOpen
      ? (matchStatus === "multiple" ? multiPopoverContent : unmatchedPopoverContent)
      : undefined;

    // ── The three states of this slot ─────────────────────────────────────
    //   1. fresh punch  (!isPunched)                    → Order No. box + Punch
    //   2. billing EDIT (isPunched && editingSoNumber)  → compact inline editor
    //   3. view         (isPunched, not editing)        → the green pill + ✎
    //
    // ⚠ THIS SLOT IS NOT BILLING-ONLY. It is passed unconditionally to
    // MetaRibbon (:1817) and rendered by its NON-override branch
    // (meta-ribbon.tsx:139), so it also drives the non-billing focus view.
    // That is why mode 2 is gated on `billingV2`: with the flag off the pencil
    // still opens the full Order No. box + Punch, exactly as it always has.
    const soEditMode = billingV2 && isPunched && editingSoNumber;

    const soNumberSlot = soEditMode ? (
      // 2 — a CORRECTION, not a re-punch: no Punch button, an explicit ✓ to
      // commit and ✕ to back out. Same `handlePunchClick` save handler and the
      // same 10-digit gate as a fresh punch; only the chrome differs.
      <>
        <div className="flex items-center bg-[#f7f7f5] border border-gray-200 rounded-[10px] overflow-hidden transition-colors focus-within:bg-white focus-within:border-teal-600 focus-within:ring-2 focus-within:ring-teal-600/15">
          <input
            type="text"
            value={soInput}
            onChange={(e) => setSoInput(e.target.value.replace(/\D/g, "").slice(0, 10))}
            onKeyDown={handleSoKeyDown}
            autoFocus
            maxLength={10}
            className="w-[130px] h-[30px] border-none outline-none bg-transparent font-mono text-[14px] font-medium text-gray-900 px-2.5"
          />
        </div>
        <button
          onClick={handlePunchClick}
          disabled={!punchReady}
          title={punchReady ? "Save order number" : "Enter 10 digits"}
          aria-label="Save order number"
          className={`flex h-[26px] w-[26px] items-center justify-center rounded-md border transition-colors ${
            punchReady
              ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100 cursor-pointer"
              : "border-gray-200 bg-white text-gray-300 cursor-default"
          }`}
        >
          <Check size={13} />
        </button>
        <button
          onClick={handleCancelSoEdit}
          title="Cancel"
          aria-label="Cancel editing order number"
          className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400 hover:bg-gray-50 hover:text-gray-600 hover:border-gray-300 cursor-pointer"
        >
          <X size={13} />
        </button>
      </>
    ) : showInputMode ? (
      <>
        {/* (D) BILLING ONLY: styled to match the wide-arm search box in
            universal-header.tsx — same pearl fill, hairline border, 10px radius
            and teal focus ring, so the two fields on that screen read as one
            control family.
            ⚠ The OFF arm is the ORIGINAL string, restored verbatim from
            0a8582e3~1. This slot is shared with the non-billing focus view (see
            the note above), so only the class string may branch — the input,
            its handlers, placeholder, maxLength and 120px width are one
            definition and stay identical on both faces. */}
        <div
          className={
            billingV2
              ? "flex items-center bg-[#f7f7f5] border border-gray-200 rounded-[10px] overflow-hidden transition-colors focus-within:bg-white focus-within:border-teal-600 focus-within:ring-2 focus-within:ring-teal-600/15"
              : "flex items-center border-[1.5px] border-gray-200 rounded-md overflow-hidden focus-within:border-teal-500 focus-within:shadow-[0_0_0_3px_rgba(13,148,136,0.08)]"
          }
        >
          <span className="text-[10px] font-medium text-gray-400 pl-2 whitespace-nowrap">Order No.</span>
          <input
            type="text"
            value={soInput}
            onChange={(e) => setSoInput(e.target.value.replace(/\D/g, "").slice(0, 10))}
            onKeyDown={handleSoKeyDown}
            placeholder="Enter number"
            maxLength={10}
            className="w-[120px] h-[30px] border-none outline-none bg-transparent font-mono text-[14px] font-medium text-gray-900 px-2 placeholder:text-gray-300 placeholder:font-normal placeholder:text-[12px]"
          />
        </div>
        <button
          onClick={handlePunchClick}
          disabled={!punchReady}
          className={`h-[32px] px-3.5 rounded-md text-[12px] font-semibold whitespace-nowrap transition-all ${
            punchReady
              ? "bg-teal-600 text-white hover:bg-teal-700 cursor-pointer"
              : "bg-gray-100 text-gray-300 cursor-default"
          }`}
        >
          Punch
        </button>
      </>
    ) : billingV2 ? (
      // 3a — BILLING view. ✓ and the SO number are ONE green pill, wearing the
      // tokens the separate "Punched" pill used to carry (bg-green-50 /
      // text-green-700 / border-green-200) — same shade, moved, not re-picked.
      // That pill is gone here: the green already says punched, so the word was
      // saying it twice. The ✓ keeps its own text-green-600.
      <>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-2 py-0.5">
          <Check size={14} className="text-green-600" />
          <span className="font-mono text-[14px] font-medium text-green-700">{order.soNumber}</span>
        </span>
        <button
          // PREFILL with the current number: on this face the pencil opens the
          // compact editor, which is a correction of a known value, so it should
          // start from that value rather than make the operator retype ten
          // digits. The OFF arm below keeps the original blank-on-entry.
          onClick={() => { setEditingSoNumber(true); setSoInput(order.soNumber ?? ""); }}
          className="w-[18px] h-[18px] rounded border border-gray-200 bg-white cursor-pointer flex items-center justify-center text-gray-400 hover:bg-gray-50 hover:text-gray-600 hover:border-gray-300"
          title="Edit SO number"
        >
          <Pencil size={10} />
        </button>
      </>
    ) : (
      // 3b — the ORIGINAL punched view, restored verbatim from 0a8582e3~1: bare
      // ✓, gray-900 number, pencil, then the separate "Punched" pill, in that
      // order, with `setSoInput("")` on entry. This slot is shared with the
      // non-billing focus view, so this arm must stay character-identical to
      // what shipped before the billing restyle.
      <>
        <Check size={14} className="text-green-600" />
        <span className="font-mono text-[14px] font-medium text-gray-900">{order.soNumber}</span>
        <button
          onClick={() => { setEditingSoNumber(true); setSoInput(""); }}
          className="w-[18px] h-[18px] rounded border border-gray-200 bg-white cursor-pointer flex items-center justify-center text-gray-400 hover:bg-gray-50 hover:text-gray-600 hover:border-gray-300"
          title="Edit SO number"
        >
          <Pencil size={10} />
        </button>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
          Punched
        </span>
      </>
    );

    // Notes. Hoisted separately from Print (2026-07-31) so the Billing ribbon
    // can place the two independently — Notes beside the actions on the left,
    // Print on the SKU caption row. The OFF path still renders both, in the
    // original order, via `utilityButtons` below; a Fragment emits no DOM, so
    // that row is byte-identical to before either hoist.
    // Notes stays inside renderDetailHeader because it reads this order's notes;
    // Print does not, and lives at component scope.
    const notesButton = (
      <>
        {(() => {
          const effective = getEffectiveNotes(order.id, order.notes ?? null);
          const hasNotes = !!effective && effective.length > 0;
          return (
            <div style={{ position: "relative", display: "inline-flex" }}>
              <button
                onClick={handleNotesOpen}
                title={hasNotes ? "Notes (saved)" : "Notes"}
                style={{
                  width: 28, height: 28, borderRadius: 6,
                  border: "1px solid",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.12s",
                  ...(hasNotes
                    ? { borderColor: "#d1d5db", background: "#fff", color: "#374151" }
                    : { borderColor: "#e5e7eb", background: "#fff", color: "#9ca3af" }),
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#f9fafb";
                  e.currentTarget.style.borderColor = "#d1d5db";
                  if (!hasNotes) e.currentTarget.style.color = "#6b7280";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#fff";
                  e.currentTarget.style.borderColor = hasNotes ? "#d1d5db" : "#e5e7eb";
                  e.currentTarget.style.color = hasNotes ? "#374151" : "#9ca3af";
                }}
              >
                <StickyNote size={14} />
              </button>
              {hasNotes && (
                <span
                  style={{
                    position: "absolute",
                    top: -2, right: -2,
                    width: 8, height: 8,
                    borderRadius: "50%",
                    background: "#0d9488",
                    border: "1.5px solid #fff",
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
          );
        })()}
      </>
    );

    const utilityButtons = (
      <>
        {printButton}
        {notesButton}
      </>
    );

    // Billing-face Notes — a SEPARATE, LABELLED variant. `notesButton` above is
    // still the icon-only version the OFF path renders; labelling that in place
    // would change the non-billing ribbon. This one wears the same BTN_BASE the
    // Urgent/Hold/Slot buttons use, so the four read as one row of controls.
    // Same handler, same has-notes dot, same mo-print-hide.
    const billingNotesButton = (() => {
      const effective = getEffectiveNotes(order.id, order.notes ?? null);
      const hasNotes = !!effective && effective.length > 0;
      return (
        <span className="relative inline-flex">
          <button
            type="button"
            onClick={handleNotesOpen}
            title={hasNotes ? "Notes (saved)" : "Notes"}
            // Has-notes now TINTS THE WHOLE BUTTON in the instructions-strip
            // violet, replacing the 8px corner dot that used to carry the
            // signal. Two reasons: the fill is unmissable where a corner dot was
            // not, and it matches the band the note actually appears in
            // (instructions-strip.tsx — #f5f3ff fill, #5b21b6 text, #7c3aed
            // accent), so the button and its content read as one thing.
            //
            // It also retires a stray teal: that dot was bg-teal-600, and this
            // row already spends the brand accent on Import and the search
            // focus ring (CLAUDE_UI §1 — one teal element per surface).
            className={`${BTN_BASE} ${hasNotes ? "border-[#7c3aed]/40 bg-[#f5f3ff] text-[#5b21b6] hover:bg-[#ede9fe]" : BTN_OFF}`}
          >
            {/* Icon inherits the button's colour when notes exist — unchanged
                expression, it just now inherits violet instead of gray-800. */}
            <StickyNote size={12} className={hasNotes ? "" : "text-gray-400"} />
            Notes
          </button>
        </span>
      );
    })();

    // ── Billing v2 — the redesigned ribbon row ────────────────────────────
    // Replaces MetaRibbon's CONTENTS only (its outer row keeps the same padding,
    // top border and alignment). `undefined` when the flag is off, which makes
    // MetaRibbon render its summary line + slots exactly as it always has.
    //
    // Left→right (2026-08-01): the sales officer's name · spacer · then EVERY
    // action together on the right — Urgent · Hold · Slot · Notes · the punch
    // controls — with the ⓘ and the reopen × trailing as utilities.
    //
    // Punch is the last ACTION, not the last node: the ⓘ and × are view
    // utilities, not things done to the order, and they keep the position they
    // have always had at the end of the row.
    //
    // ⚠ A FUTURE action button inserts immediately BEFORE the soNumberSlot
    // wrapper below — that is the one line that keeps Punch last.
    //
    // The descriptive facts that used to sit on this line — received, punched by
    // — live in the ⓘ popover. It is fed the SAME formatted strings MetaRibbon
    // would have rendered (soNameFormatted / receivedAtFormatted /
    // punchedByName / punchedAtFormatted), so the two faces cannot disagree.
    // `soNameFormatted` is now rendered here as well; both read that one
    // binding, so the row and the popover cannot drift. Readiness (✓ 6/6) and
    // volume live on the SKU caption below, via the same getMatchChip().
    //
    // soNumberSlot is reused VERBATIM — the punch flow, its 10-digit gate, the
    // edit pencil and the "Punched" badge are untouched, and Order No. / SO
    // number stays on the RIGHT in both the pre- and post-punch states.
    const billingRibbonRow = billingV2 ? (
      <div className="flex w-full items-center gap-2">
        {/* (B) The order's provenance, inline — this replaces the ⓘ popover,
            which is gone from this row along with its import. It renders the
            SAME three bindings BillingOrderInfo was fed, in the same order and
            the same formats (:1310-1314): soNameFormatted, receivedAtFormatted,
            and — once punched — punchedByName + punchedAtFormatted.

            The punched half uses BillingOrderInfo's own both-halves guard
            (`!!punchedByName && !!punchedAt`, its :54): a name with no time, or
            a time with no name, renders neither rather than a half sentence.

            ⚠ `min-w-0 truncate` is load-bearing: this is the only shrinkable
            node on the row, so a long line must give way rather than push the
            action cluster past the right edge. */}
        <span className="min-w-0 truncate text-[11px] text-gray-400">
          {soNameFormatted} · {receivedAtFormatted}
          {!!punchedByName && !!punchedAtFormatted &&
            ` · punched by ${punchedByName} ${punchedAtFormatted}`}
        </span>
        <div className="flex-1" />
        <BillingActionRibbon
          order={order}
          windows={billingWindows}
          onSaved={() => onBillingActionSaved?.()}
        />
        {/* Notes sits with the actions, not with the utilities: it is something
            the operator DOES to this order, like Hold or Urgent — not a view
            control. Same handler and same "dot when notes exist" indicator. */}
        <span className="mo-print-hide inline-flex flex-shrink-0 items-center">
          {billingNotesButton}
        </span>
        {/* Copy — removed from this face in 267bcad4 (2026-07-31) on the
            reasoning that Ctrl+C covers it; re-added for the mouse-first
            billing operator. Same handler as the retired actionsSlot button
            (handleCopyClick → onCopy with no batchIndex → buildClipboardText):
            one click copies every matched SKU line, unbatched — NOT the
            two-state Ctrl+C machine. Same Copy icon, BTN_BASE/BTN_OFF shape
            so it reads as part of this action group like Notes does. */}
        <button
          type="button"
          onClick={handleCopyClick}
          title="Copy · Ctrl+C"
          className={`mo-print-hide ${BTN_BASE} ${BTN_OFF}`}
        >
          <Copy size={12} className="text-gray-400" />
          Copy
        </button>
        {/* (C) The row's ONE divider: it separates the things you DO to the
            order (Urgent/Hold/Slot/Notes) from the punch controls. The four
            buttons are deliberately left undivided — they are one group. Same
            `w-px h-4 bg-gray-200` rule used across the header and tab row. */}
        <div className="w-px h-4 bg-gray-200" />
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {soNumberSlot}
        </div>
        {/* Right end: only the reopen ×, on a deliberately reopened done order.
            The ⓘ was removed 2026-08-01 — its three facts now render inline on
            the left of this row, so the popover had nothing left to hold.

            Gated on THIS order being the reopened one, not merely on the state
            being set, so it cannot appear on a normal pending detail. With the
            flag off `reopenedPunchedId` is never set (the row handler gates on
            billingV2), and this whole row is `billingV2 ? … : undefined`
            anyway — two independent reasons it cannot reach the OFF path. */}
        <div className="mo-print-hide flex flex-shrink-0 items-center gap-1">
          {reopenedPunchedId !== null && order.id === reopenedPunchedId && (
            <button
              type="button"
              title="Close — back to all caught up"
              aria-label="Close reopened order"
              onClick={() => setReopenedPunchedId(null)}
              className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors cursor-pointer"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>
    ) : undefined;

    const actionsSlot = (
      <div className="mo-print-hide" style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        {/* Phase 2 — Slot / Hold / Urgent. Prepended as a SIBLING inside the
            existing actions row: nothing here is wrapped, no style object is
            changed, and with the flag off this expression is `false`, which
            React renders as nothing at all. */}
        {billingV2 && (
          <BillingActionRibbon
            order={order}
            windows={billingWindows}
            onSaved={() => onBillingActionSaved?.()}
          />
        )}
        {/* Copy · Reply · Flag — hidden on the BILLING face only (2026-07-31).
            Reply is unused there, Flag is not a billing concern, and Copy is
            covered by Ctrl+C, which is a wholly separate document-level
            listener in mail-orders-page.tsx (registered on `document`, active
            in focus mode) — removing this button cannot affect it.
            ⚠ Ctrl+C is a TWO-STATE machine: first press copies the CUSTOMER
            CODE, second press the SKUs. This button copied SKUs in one click,
            so on the billing face SKU copy now takes two presses.
            A Fragment emits no DOM, so with the flag OFF these three render as
            direct flex children of the same row, exactly as before. Print and
            Notes are outside this guard and are unaffected on both faces. */}
        {!billingV2 && (<>
        <button
          onClick={handleCopyClick}
          title="Copy · Ctrl+C"
          style={{
            width: 28, height: 28, borderRadius: 6,
            border: "1px solid #e5e7eb", background: "#fff",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            color: "#9ca3af", transition: "all 0.12s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#f9fafb";
            e.currentTarget.style.borderColor = "#d1d5db";
            e.currentTarget.style.color = "#6b7280";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#fff";
            e.currentTarget.style.borderColor = "#e5e7eb";
            e.currentTarget.style.color = "#9ca3af";
          }}
        >
          <Copy size={14} />
        </button>
        <button
          onClick={handleReplyClick}
          disabled={!isPunched}
          title="Reply · R"
          style={{
            width: 28, height: 28, borderRadius: 6,
            border: "1px solid",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.12s",
            ...(isPunched
              ? {
                  borderColor: replyCopied ? "#5eead4" : "#99f6e4",
                  background: replyCopied ? "#ccfbf1" : "#fff",
                  color: "#0f766e",
                  cursor: "pointer",
                }
              : {
                  borderColor: "#e5e7eb",
                  background: "#fff",
                  color: "#d1d5db",
                  opacity: 0.5,
                  pointerEvents: "none" as const,
                }),
          }}
          onMouseEnter={(e) => { if (isPunched) e.currentTarget.style.background = "#f0fdfa"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = isPunched && replyCopied ? "#ccfbf1" : "#fff"; }}
        >
          <Mail size={14} />
        </button>
        <button
          onClick={() => onFlag(order.id)}
          title="Flag · F"
          style={{
            width: 28, height: 28, borderRadius: 6,
            border: "1px solid",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.12s",
            ...(isFlagged
              ? { borderColor: "#fde68a", background: "#fffbeb", color: "#b45309" }
              : { borderColor: "#e5e7eb", background: "#fff", color: "#9ca3af" }),
          }}
          onMouseEnter={(e) => {
            if (isFlagged) {
              e.currentTarget.style.background = "#fef3c7";
            } else {
              e.currentTarget.style.background = "#f9fafb";
              e.currentTarget.style.borderColor = "#d1d5db";
              e.currentTarget.style.color = "#6b7280";
            }
          }}
          onMouseLeave={(e) => {
            if (isFlagged) {
              e.currentTarget.style.background = "#fffbeb";
            } else {
              e.currentTarget.style.background = "#fff";
              e.currentTarget.style.borderColor = "#e5e7eb";
              e.currentTarget.style.color = "#9ca3af";
            }
          }}
        >
          <Flag size={14} />
        </button>
        </>)}
        {utilityButtons}
      </div>
    );

    return (
      <>
        {/* Billing v2 — a floor under the two cards so the pair stops wobbling
            as the operator steps through orders. Since the ship card lost its
            Urgent/Hold/Dispatch chips (c9ff6bb5) its chip row is usually absent
            entirely, and the card shrank by that row's height.

            ⚠ Applied to the CHILDREN, not this container. These are grid items
            with the default `align-items: stretch`, so the row is already
            max(bill, ship) and both cards share a height — a floor on each
            child is what raises that max. A min-h on the container itself would
            fight its own pt-3/pb-2 padding.

            108px ≈ the card at its natural height WITH one chip row present, so
            an order carrying a Challan (the only ship signal that survives the
            billing filter) does not push the row taller than an order with
            none. It is a floor, never a cap: a card with more content still
            grows.

            Call-site only — ShipToCard and BillToCard are SHARED with the
            non-billing focus face and are not modified. With the flag off this
            expression contributes no class at all. */}
        <div
          data-tutorial="detail-header"
          className={`flex-shrink-0 grid grid-cols-2 gap-3 px-4 pt-3 pb-2${billingV2 ? " [&>div]:min-h-[108px]" : ""}`}
        >
          <BillToCard
            customerName={billToName}
            customerCode={order.customerCode}
            customerArea={order.customerArea ?? null}
            customerDeliveryType={order.customerDeliveryType ?? null}
            customerMatchStatus={order.customerMatchStatus ?? null}
            isKeyCustomer={order.isKeyCustomer}
            signals={billSignals}
            onCodeClick={onCodeClickHandler}
            popoverSlot={popoverContent}
            chipFallbackLabel={chipFallbackLabel}
          />
          <ShipToCard
            shipToName={shipToName}
            shipToCode={shipToCode}
            shipToArea={shipToArea}
            shipToDeliveryType={shipToDeliveryType}
            isOverride={order.shipToOverride ?? false}
            signals={shipSignalsForCard}
            disabledTagKeys={disabledTagKeys}
            // Phase 2 — undefined unless the flag is on, so the card renders
            // nothing extra for every user today.
            actionSlot={
              billingV2 ? (
                <BillingShipToPencil
                  moOrderId={order.id}
                  hasOverride={order.shipToOverride ?? false}
                  onSaved={() => onBillingActionSaved?.()}
                />
              ) : undefined
            }
            billToName={billToName}
            billToCode={order.customerCode}
            billToArea={order.customerArea ?? null}
            billToDeliveryType={order.customerDeliveryType ?? null}
          />
        </div>

        <div data-tutorial="so-input" className="flex-shrink-0">
          <MetaRibbon
            soName={soNameFormatted}
            receivedAt={receivedAtFormatted}
            volume={volumeString}
            matchedLines={order.matchedLines}
            totalLines={order.totalLines}
            punchedByName={punchedByName}
            punchedAt={punchedAtFormatted}
            actionsSlot={actionsSlot}
            soNumberSlot={soNumberSlot}
            punchButtonSlot={null}
            contentOverride={billingRibbonRow}
          />
        </div>

        <div className="flex-shrink-0">
          {/* Billing face gets Floor's light-purple instruction treatment; every
              other face keeps the grey strip. This component renders in FOCUS
              mode for non-billing users too, so the recolour has to be a prop —
              it is not reachable behind a render-time billingV2 branch. */}
          <InstructionsStrip
            delivery={parsed.deliveryInstruction}
            bill={order.billRemarks || null}
            notes={notesString}
            tone={billingV2 ? "violet" : "default"}
          />
        </div>
      </>
    );
  }

  // ── SKU Table renderer ───────────────────────────────────────────
  function renderSkuTable(order: MoOrder) {
    const sortedLines = [...order.lines].sort((a, b) => a.lineNumber - b.lineNumber);

    const thStyle: React.CSSProperties = {
      height: 32,
      fontSize: 10,
      fontWeight: 500,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      color: "#9ca3af",
      textAlign: "left",
      background: "#f9fafb",
      borderBottom: "1px solid #ebebeb",
      paddingLeft: 14,
      paddingRight: 14,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    };

    const thFirst: React.CSSProperties = { paddingLeft: 10, paddingRight: 4, textAlign: "center" };
    const thLast: React.CSSProperties = { paddingRight: 12, textAlign: "center" };

    const tdBase: React.CSSProperties = {
      height: 36,
      fontSize: 11,
      borderBottom: "1px solid #f0f0f0",
      paddingLeft: 14,
      paddingRight: 14,
      verticalAlign: "middle",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    };

    const tdFirst: React.CSSProperties = { paddingLeft: 10, paddingRight: 4, textAlign: "center" };
    const tdLast: React.CSSProperties = { paddingRight: 12, textAlign: "center" };

    function descriptionText(line: MoOrderLine): { primary: string; secondary: string | null } {
      if (descMode === "long" && line.skuDescription && line.skuDescription.trim()) {
        return { primary: line.skuDescription, secondary: null };
      }
      return {
        primary: line.productName ?? "—",
        secondary: line.baseColour ?? null,
      };
    }

    // Copy a SKU code to the clipboard with a ~1.1s "Copied" confirmation.
    // navigator.clipboard only — no storage.
    function copyAltCode(code: string): void {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(code);
      }
      setCopiedCode(code);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedCode(null), 1100);
    }

    // One row in the alt-SKU modal (primary or alternate) + its Copy button.
    function renderSkuRow(code: string, desc: string, primary: boolean, key: string) {
      const copyable = !!code && code !== "—";
      const done = copyable && copiedCode === code;
      return (
        <div
          key={key}
          className={`flex items-center gap-2.5 px-2.5 py-2 mb-1.5 rounded-lg border ${primary ? "bg-teal-50 border-teal-200" : "bg-white border-gray-200"}`}
        >
          <span className="min-w-[104px] font-mono text-[12px]">{code}</span>
          <span className="flex-1 text-[10.5px] leading-[1.35] text-gray-600">{desc}</span>
          {copyable && (
            <button
              type="button"
              onClick={() => copyAltCode(code)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-[10px] font-semibold ${done ? "border-teal-600 bg-teal-600 text-white" : "border-teal-200 bg-white text-teal-700 hover:bg-teal-50"}`}
            >
              {done ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
            </button>
          )}
        </div>
      );
    }

    // Billing v2 — the caption that took over readiness + volume from the
    // ribbon summary line. Sits ABOVE the scroll region (a sibling of it, not a
    // child) so it stays put while the lines scroll.
    //
    // Reuses getMatchChip() from meta-ribbon — the SAME function that rendered
    // the old "✓ 6/6" — so the two faces can never show a different readiness
    // for the same order. Line count prefers the stored totalLines and falls
    // back to the rendered rows.
    //
    // NOT mo-print-hide, deliberately: these facts used to print as part of the
    // ribbon, and moving them must not quietly drop them from a printed sheet.
    // Left: line count + readiness. Right: volume. Line count prefers the
    // stored totalLines and falls back to the rendered rows; pluralised so the
    // single-line case reads "1 line".
    const captionLines = order.totalLines ?? order.lines.length;
    const captionVolume = volumeStringFor(order);
    const captionChip = getMatchChip(order.matchedLines, order.totalLines);

    return (
      <>
      {billingV2 && (
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-3.5 py-[7px] text-[11px] text-gray-500">
          {/* LEFT — line count + readiness. NOT mo-print-hide: these facts
              printed as part of the old ribbon summary line, and moving them
              must not drop them from a printed sheet. */}
          <div className="flex min-w-0 items-center gap-2">
            <span className="tabular-nums">
              {captionLines} line{captionLines === 1 ? "" : "s"}
            </span>
            {captionChip && (
              <>
                <span className="text-gray-300">·</span>
                <span className={`inline-flex items-center h-4 px-[5px] text-[10px] font-semibold rounded border ${captionChip.classes}`}>
                  {captionChip.label}
                </span>
              </>
            )}
          </div>
          {/* RIGHT — volume, with a droplet to read as liquid at a glance.
              Renders NOTHING when the order has no measurable volume: a lone
              icon with no number is worse than an empty right edge.
              NOT mo-print-hide — volume printed as part of the old ribbon line
              and must keep printing. */}
          {captionVolume && (
            <span className="flex flex-shrink-0 items-center gap-1 tabular-nums">
              <Droplet size={12} className="text-gray-400" />
              {captionVolume}
            </span>
          )}
        </div>
      )}
      <div data-tutorial="sku-table" className="flex-1 overflow-y-auto" style={{ padding: "0 6px" }}>
        <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "4%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "5.5%" }} />
            <col style={{ width: "5.5%" }} />
            <col style={{ width: "5.5%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "6.5%" }} />
          </colgroup>
          <thead className="sticky top-0 z-[2]">
            <tr>
              <th style={{ ...thStyle, ...thFirst }}>#</th>
              <th style={thStyle}>Raw Text</th>
              <th style={thStyle}>SKU Code</th>
              <th style={{ ...thStyle, textAlign: "center", paddingLeft: 6, paddingRight: 6 }}>ALT SKU</th>
              <th style={thStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                  <span>Description</span>
                  <button
                    onClick={() => setDescMode(m => m === "long" ? "short" : "long")}
                    title={descMode === "long" ? "Switch to short description" : "Switch to long description"}
                    style={{
                      fontSize: 9,
                      fontWeight: 500,
                      padding: "1px 6px",
                      borderRadius: 4,
                      border: "1px solid #e5e7eb",
                      background: "#fff",
                      color: "#6b7280",
                      cursor: "pointer",
                      letterSpacing: "0.02em",
                      textTransform: "uppercase",
                      transition: "background 0.12s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#f9fafb"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                  >
                    {descMode}
                  </button>
                </div>
              </th>
              <th style={{ ...thStyle, textAlign: "center" }}>Pk</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Qty</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Vol</th>
              <th style={{ ...thStyle, textAlign: "center" }}>Status</th>
              <th style={{ ...thStyle, ...thLast }}></th>
            </tr>
          </thead>
          <tbody>
            {sortedLines.map((origLine, idx) => {
              // Apply resolved line overrides (from in-session resolves)
              const resolved = resolvedLineOverrides.get(origLine.id);
              const line: MoOrderLine = resolved
                ? {
                    ...origLine,
                    skuCode: resolved.skuCode,
                    skuDescription: resolved.skuDescription,
                    packCode: resolved.packCode,
                    matchStatus: "matched",
                  }
                : origLine;
              const rowState = getRowState(line);
              const reason = getLineReason(line);
              const isFirst = idx === 0;
              const isLast = idx === sortedLines.length - 1;

              const rowEdge: React.CSSProperties = {};
              if (isFirst) rowEdge.borderTop = "4px solid transparent";
              if (isLast) rowEdge.borderBottom = "4px solid transparent";

              const skuColor =
                rowState === "not-found" ? "#d1d5db"
                : rowState === "partial" ? "#d97706"
                : "#6b7280";

              const vol = getPackVolumeLiters(line.packCode) * line.quantity;
              const isActiveLine = idx === activeLineIndex;

              return (
                <tr
                  key={line.id}
                  data-review-line-index={idx}
                  className="transition-colors hover:bg-gray-50"
                  style={isActiveLine ? {
                    background: "#fefce8",
                  } : undefined}
                >
                  {/* # */}
                  <td style={{
                    ...tdBase,
                    ...tdFirst,
                    ...rowEdge,
                    color: "#9ca3af",
                    borderLeft: isActiveLine ? "3px solid #eab308" : "3px solid transparent",
                  }}>
                    {line.lineNumber}
                  </td>

                  {/* Raw Text */}
                  <td style={{ ...tdBase, ...rowEdge, color: rowState === "not-found" ? "#d1d5db" : "#374151" }}>
                    {line.rawText}
                  </td>

                  {/* SKU Code */}
                  <td style={{
                    ...tdBase,
                    ...rowEdge,
                    fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
                    color: skuColor,
                  }}>
                    {rowState === "unmatched" ? (
                      <span
                        onClick={() => setResolveLineId(line.id)}
                        style={{ color: "#d1d5db", cursor: "pointer" }}
                      >
                        —
                      </span>
                    ) : (
                      line.skuCode ?? "—"
                    )}
                  </td>

                  {/* Alt */}
                  <td style={{ ...tdBase, ...rowEdge, textAlign: "center" }}>
                    {(line.altSkus?.length ?? 0) > 0 ? (
                      <span
                        onClick={() => setAltModalLine(line)}
                        className={`inline-flex cursor-pointer select-none items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                          altModalLine?.id === line.id
                            ? "border-gray-700 bg-gray-700 text-white"
                            : "border-gray-300 bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        ⇄ {line.altSkus?.length ?? 0}
                      </span>
                    ) : (
                      <span style={{ color: "#d1d5db" }}>—</span>
                    )}
                  </td>

                  {/* Description */}
                  <td style={{ ...tdBase, ...rowEdge }}>
                    {rowState === "normal" && (() => {
                      const { primary, secondary } = descriptionText(line);
                      return (
                        <>
                          <span style={{ fontWeight: 500, color: "#111827" }}>{primary}</span>
                          {secondary && (
                            <span style={{ color: "#6b7280" }}> · {secondary}</span>
                          )}
                        </>
                      );
                    })()}
                    {rowState === "partial" && (() => {
                      const { primary, secondary } = descriptionText(line);
                      return (
                        <>
                          <span style={{ fontWeight: 500, color: "#b45309" }}>{primary}</span>
                          {secondary && (
                            <span style={{ color: "#b45309" }}> · {secondary}</span>
                          )}
                          <span style={{
                            fontSize: 9, fontWeight: 600, padding: "0 4px", borderRadius: 2,
                            background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a",
                            marginLeft: 4, display: "inline-block",
                          }}>PARTIAL</span>
                        </>
                      );
                    })()}
                    {rowState === "unmatched" && (
                      <>
                        <span style={{ color: "#9ca3af", fontStyle: "italic" }}>No match found</span>
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: "0 4px", borderRadius: 2,
                          background: "#f9fafb", color: "#9ca3af", border: "1px solid #e5e7eb",
                          marginLeft: 4, display: "inline-block",
                        }}>UNMATCHED</span>
                        <span
                          onClick={() => setResolveLineId(line.id)}
                          style={{
                            fontSize: 10, color: "#0d9488", cursor: "pointer", fontWeight: 500,
                            marginLeft: 4,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                        >
                          Resolve →
                        </span>
                      </>
                    )}
                    {rowState === "not-found" && (
                      <>
                        <span style={{ fontWeight: 400, color: "#d1d5db" }}>{line.productName}</span>
                        {line.baseColour && (
                          <span style={{ color: "#d1d5db" }}> · {line.baseColour}</span>
                        )}
                      </>
                    )}
                  </td>

                  {/* Pk */}
                  <td style={{
                    ...tdBase,
                    ...rowEdge,
                    textAlign: "center",
                    color: rowState === "not-found" ? "#d1d5db" : "#6b7280",
                  }}>
                    {line.packCode ?? "—"}
                  </td>

                  {/* Qty */}
                  <td style={{
                    ...tdBase,
                    ...rowEdge,
                    textAlign: "right",
                    fontWeight: 500,
                    color: "#374151",
                  }}>
                    {line.quantity}
                  </td>

                  {/* Vol */}
                  <td style={{
                    ...tdBase,
                    ...rowEdge,
                    textAlign: "right",
                    color: rowState === "not-found" ? "#d1d5db" : "#9ca3af",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {vol > 0 ? `${Math.round(vol)}L` : "—"}
                  </td>

                  {/* Status */}
                  <td style={{
                    ...tdBase,
                    ...rowEdge,
                    textAlign: "center",
                    position: "relative",
                    overflow: "visible",
                  }}>
                    {rowState === "not-found" && reason && (
                      <span
                        onClick={() => setReasonDropdownLineId(line.id)}
                        style={{
                          fontSize: 10, fontWeight: 500, color: "#9ca3af",
                          padding: "1px 6px", borderRadius: 3,
                          background: "#f9fafb", border: "1px solid #e5e7eb",
                          cursor: "pointer", whiteSpace: "nowrap", display: "inline-block",
                        }}
                      >
                        {REASON_LABELS[reason] ?? reason}
                      </span>
                    )}
                    {reasonDropdownLineId === line.id && (
                      <ReasonDropdown
                        onSelect={(r) => handleReasonSelect(line.id, r)}
                        onClose={() => setReasonDropdownLineId(null)}
                      />
                    )}
                  </td>

                  {/* Toggle */}
                  <td style={{ ...tdBase, ...tdLast, ...rowEdge }}>
                    <SkuToggle
                      isOn={rowState !== "not-found"}
                      onToggle={() => handleToggle(line)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Alt-SKU modal — opens on the ⇄ chip; copy any code (primary or alt). */}
        <Dialog
          open={!!altModalLine}
          onOpenChange={(open) => { if (!open) { setAltModalLine(null); setCopiedCode(null); } }}
        >
          <DialogPortal>
            {/* Dark dimmed overlay (gray-900 = rgb 17,24,39 @ 45%) — matches mockup. */}
            <DialogOverlay className="bg-gray-900/45" />
            {/* Centered 440px card: header + scrollable body + footer all inside. */}
            <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 w-[440px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-gray-900/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
              {altModalLine && (() => {
                const ml = altModalLine;
                const comboParts = [ml.productName, ml.baseColour, ml.packCode].filter(Boolean) as string[];
                const title = comboParts.length > 0
                  ? comboParts.join(" · ")
                  : (ml.skuDescription ?? ml.rawText ?? "SKU options");
                const alts = ml.altSkus ?? [];
                return (
                  <>
                    <DialogHeader className="gap-1 border-b border-gray-100 px-[18px] pt-4 pb-3">
                      <DialogTitle className="text-[13px] font-semibold">{title}</DialogTitle>
                      <DialogDescription className="text-[10.5px] text-gray-400">
                        {ml.rawText ? <span className="mb-0.5 block truncate text-gray-500">{ml.rawText}</span> : null}
                        1 primary · {alts.length} alternate{alts.length === 1 ? "" : "s"} — tap copy to grab any code
                      </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[340px] overflow-auto px-[14px] pt-2 pb-[14px]">
                      <div className="mx-1 mt-3 mb-1.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-gray-400">
                        Primary (billed)
                      </div>
                      {renderSkuRow(ml.skuCode ?? "—", ml.skuDescription ?? "—", true, "primary")}
                      <div className="mx-1 mt-3 mb-1.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-teal-700">
                        Alternate SKUs
                      </div>
                      {alts.map((a, i) => renderSkuRow(a.code, a.description, false, `${a.code}-${i}`))}
                    </div>
                    <div className="flex justify-end border-t border-gray-100 px-[18px] py-2.5">
                      <button
                        type="button"
                        onClick={() => { setAltModalLine(null); setCopiedCode(null); }}
                        className="rounded-md border border-gray-200 bg-white px-3.5 py-1.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50"
                      >
                        Close
                      </button>
                    </div>
                  </>
                );
              })()}
            </DialogPrimitive.Popup>
          </DialogPortal>
        </Dialog>
      </div>
      </>
    );
  }

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* LEFT PANEL — 320px */}
      <div data-tutorial="order-list" className="w-[320px] flex-shrink-0 border-r border-gray-200 flex flex-col">
        {/* Rail head. On the BILLING face this slot carries the rail title; on
            every other face it carries the filter input, exactly as before.
            Same wrapper padding and the same 28px inner height in both, so the
            order list starts at an identical offset either way — swapping one
            for the other shifts nothing below it.
            ⚠ The search STATE is untouched: `searchQuery`/`onSearchChange` are
            props owned by mail-orders-page.tsx and shared with Table view. Only
            the input is not rendered here, so batch-2 universal search can pick
            the same state back up. Do not delete the OFF branch. */}
        {billingV2 ? (
          <div className="px-3 py-2 border-b border-gray-200">
            {/* The day summary ALONE, left-aligned — the "Inbox" label was
                dropped 2026-08-01: the rail's contents say what it is, and the
                word was competing with the tab bar for the same job.
                ⚠ The h-[28px] stays and is load-bearing (see the note above):
                it is what keeps the order list starting at the same offset as
                the non-billing face, and it must not follow the label out.
                Stats reuse the `text-[10px] text-gray-400` of the "N punched"
                divider below — the nearest count text in this rail. */}
            {/* Rail head: an "Inbox" label on the LEFT, the day summary on the
                RIGHT, split by justify-between. The Mail glyph is the SAME
                lucide icon the sidebar maps to this module
                (role-sidebar.tsx:55, `mail_orders: Mail`), so the rail and the
                nav name the screen with one mark.

                The percentage is the only coloured thing on the line — GREEN at
                100, BLUE below, so "still going" reads at a glance without the
                alarm an amber would carry. The `railTotal > 0` guard is
                unchanged: an empty day shows "0 orders" and no percentage, so
                there is nothing to colour.

                ⚠ h-[28px] stays and is load-bearing — it is what keeps the
                order list starting at the same offset as the non-billing face. */}
            <div className="flex h-[28px] items-center justify-between text-[10px] text-gray-400">
              <span className="flex items-center gap-1.5">
                <Mail size={14} className="text-gray-400 flex-shrink-0" />
                <span className="uppercase tracking-wide">Inbox</span>
              </span>
              <span>
                {railTotal} orders
                {railTotal > 0 && (
                  <span className={`ml-1 font-medium ${railPunchPct === 100 ? "text-green-600" : "text-blue-600"}`}>
                    · {railPunchPct}% punched
                  </span>
                )}
              </span>
            </div>
          </div>
        ) : (
        <div className="px-3 py-2 border-b border-gray-200">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter orders..."
            className="w-full h-[28px] border border-gray-200 rounded-md px-2.5 text-[11px] text-gray-600 outline-none placeholder:text-gray-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
          />
        </div>
        )}

        {/* Order list */}
        <div className="flex-1 overflow-y-auto">
          {pendingOrders.map(renderOrderRow)}

          {/* Billing v2 — the pending group is empty. Sits ABOVE the punched
              divider, which still renders below with its own count, so the
              operator can always see (and open) what was already done today.
              Classes replicated from components/floor/rail-empty.tsx rather
              than importing RailEmpty: that component is owned by Floor
              (CLAUDE_FLOOR.md §1) and none of its three variants carries this
              copy. Same skeleton, same type scale — one look across screens. */}
          {billingV2 && pendingOrders.length === 0 && (
            genuinelyEmpty ? (
              <div className="px-5 py-14 text-center">
                <div className="text-[28px] leading-none text-gray-300">&#9675;</div>
                <h4 className="mt-2 text-[13px] font-semibold text-gray-900">No new orders</h4>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
                  New orders appear here on their own.
                </p>
              </div>
            ) : (
              /* Filtered to nothing — Picking's quieter register (a single grey
                 line, no icon, no headline): this is a transient consequence of
                 a control the operator is holding, not a state of the day. */
              <p className="text-[12px] text-gray-400 text-center py-6">No orders match.</p>
            )
          )}

          {punchedOrders.length > 0 && (
            <>
              <div
                onClick={onTogglePunched}
                className="text-[10px] text-gray-400 px-3.5 py-2 border-b border-gray-100 bg-gray-50 cursor-pointer hover:bg-gray-100 select-none"
              >
                {punchedVisible ? "▾" : "▸"} {punchedOrders.length} punched
              </div>
              {punchedVisible && punchedOrders.map(renderOrderRow)}
            </>
          )}
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div id="mo-print-area" className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        {/* Billing v2 — Orders | Picking, at the TOP OF THIS PANE. Same position
            and spacing as Floor Control's Floor / On hold / Cancelled bar
            (floor-page.tsx:613), so the two screens read identically. The left
            rail above is NOT inside this div and is therefore untouched: it
            stays visible on both tabs, like Floor's decision rail.
            mo-print-hide — the tab bar is chrome, never printed. */}
        {billingV2 && onBillingTabChange && (
          <div className="mo-print-hide flex-shrink-0">
            <BillingTabBar
              active={billingTab}
              onChange={onBillingTabChange}
              ordersCount={pendingActionCount}
              rightSlot={billingHeaderSlot}
            />
          </div>
        )}

        {billingV2 && billingTab === "picking" ? (
          <BillingPickingTab date={selectedDate} />
        ) : billingV2 && pendingOrders.length === 0 && reopenedPunchedId === null ? (
          /* Billing v2 — nothing left to work on. Deliberately placed BEFORE
             the `selectedOrder` arm: a punched order stays selected (nothing
             clears focusedId), so without this the pane would keep showing the
             last bill as though it were still work. Selection state itself is
             untouched — this only stops rendering it.

             The `reopenedPunchedId === null` conjunct is the ONE exception: a
             deliberate click on a done row falls through to the `selectedOrder`
             arm below and shows that bill. Safe to key on because a PUNCH never
             sets it — only a click does — so the last punch of the day still
             lands here.
             The tab bar above and the #mo-print-area wrapper are outside this
             ternary and render regardless, so Orders|Picking still switches. */
          genuinelyEmpty ? (
            /* Two ways to have nothing to work on, and they are not the same
               news. `railTotal === 0` means NOTHING ARRIVED — the green tick and
               "Every order is punched" would credit the operator with finishing
               work that never existed, and at 09:00 it reads as "you are done
               for the day". Anything above zero and empty here really is the
               day cleared, which is what the tick is for.

               ⚠ Keyed on `railTotal` (:753 — `allOrders.length`, the UNFILTERED
               day count), deliberately NOT on `genuinelyEmpty`. That flag folds
               in the filter question and is already false whenever a filter is
               on, so reusing it would hand the neutral copy to a
               filtered-to-nothing day — a day that DID receive orders. The
               filtered arm below is untouched and still owns that case.
               `railTotal` is also what the rail head prints as "N orders", so
               the two halves of this screen cannot disagree about whether the
               day is empty. */
            railTotal === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                {/* Neutral register — the SAME grey ○ and type scale as the
                    rail's genuinely-empty state (:2563-2571), so the two halves
                    of an empty screen read as one statement rather than two
                    unrelated placeholders. No tick, no green: nothing has been
                    achieved yet, and nothing has gone wrong. */}
                <div className="px-5 py-14 text-center">
                  <div className="text-[28px] leading-none text-gray-300">&#9675;</div>
                  <h4 className="mt-2 text-[13px] font-semibold text-gray-900">No orders yet today</h4>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
                    New orders appear here as emails arrive.
                  </p>
                </div>
              </div>
            ) : (
            <div className="flex flex-1 items-center justify-center">
              {/* Mirrors components/floor/floor-board.tsx:140-152 — the green
                  tick "day is done" state, same type scale and spacing. */}
              <div className="px-5 py-14 text-center">
                <div className="text-[28px] leading-none text-[#22c55e]">&#10003;</div>
                <h4 className="mt-2 text-[13px] font-semibold text-gray-900">All caught up</h4>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
                  Every order is punched. New ones show up here as they come in.
                </p>
              </div>
            </div>
            )
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-[12px] text-gray-400 text-center">No orders match your filter.</p>
            </div>
          )
        ) : selectedOrder ? (
          <>
            {renderDetailHeader(selectedOrder)}

            {splitPreview && !splitDismissed && (
              <div className="mo-print-hide mx-5 my-2 p-2.5 bg-amber-50 border border-amber-200 rounded-md flex items-center justify-between gap-3 flex-shrink-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold text-amber-800">
                    {"\u26A0"} Large order — split recommended
                  </div>
                  <div className="text-[11px] text-amber-600 mt-0.5">
                    Group A: {splitPreview.groupA.count} lines · {formatVolume(splitPreview.groupA.volume)}
                    <span className="mx-2 text-amber-300">|</span>
                    Group B: {splitPreview.groupB.count} lines · {formatVolume(splitPreview.groupB.volume)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={handleSplitClick}
                    disabled={splitting}
                    className={`h-7 px-3 text-[11px] font-medium rounded text-white transition-colors ${
                      splitting
                        ? "bg-amber-400 cursor-wait"
                        : "bg-amber-600 hover:bg-amber-700 cursor-pointer"
                    }`}
                  >
                    {splitting ? "Splitting..." : "Split"}
                  </button>
                  <button
                    onClick={() => setSplitDismissed(true)}
                    disabled={splitting}
                    className="h-7 px-3 text-[11px] font-medium text-amber-700 hover:bg-amber-100 rounded transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            <div className="bg-white border border-gray-200 rounded-lg mx-4 mt-3 mb-3 flex flex-col flex-1 min-h-0 overflow-hidden">
              {renderSkuTable(selectedOrder)}
            </div>

            {/* ── Nav Footer ── */}
            <div
              className="mo-print-hide"
              style={{
                flexShrink: 0,
                height: 36,
                borderTop: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                padding: "0 20px",
              }}
            >
              <button
                onClick={handlePrevOrder}
                disabled={currentIndex <= 0}
                style={{
                  height: 26, fontSize: 11, fontWeight: 500, padding: "0 12px",
                  borderRadius: 5, border: "1px solid",
                  background: "#fff",
                  ...(currentIndex <= 0
                    ? { color: "#d1d5db", borderColor: "#f3f4f6", cursor: "default" }
                    : { color: "#4b5563", borderColor: "#e5e7eb", cursor: "pointer" }
                  ),
                }}
                onMouseEnter={(e) => { if (currentIndex > 0) e.currentTarget.style.background = "#f9fafb"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
              >
                ← Prev
              </button>

              <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500 }}>
                {currentIndex >= 0 ? currentIndex + 1 : 0} of {navigationList.length}
              </span>

              <button
                onClick={handleNextOrder}
                disabled={currentIndex >= navigationList.length - 1}
                style={{
                  height: 26, fontSize: 11, fontWeight: 500, padding: "0 12px",
                  borderRadius: 5, border: "1px solid",
                  background: "#fff",
                  ...(currentIndex >= navigationList.length - 1
                    ? { color: "#d1d5db", borderColor: "#f3f4f6", cursor: "default" }
                    : { color: "#4b5563", borderColor: "#e5e7eb", cursor: "pointer" }
                  ),
                }}
                onMouseEnter={(e) => { if (currentIndex < navigationList.length - 1) e.currentTarget.style.background = "#f9fafb"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
              >
                Next →
              </button>

              <span style={{ fontSize: 9, color: "#d1d5db", marginLeft: 6 }}>
                ↑↓ navigate · Ctrl+C copy · Ctrl+V paste SO
              </span>
            </div>

            {/* ── Resolve Popover ── */}
            {resolveLineId !== null && (() => {
              const line = selectedOrder.lines.find(l => l.id === resolveLineId);
              if (!line) return null;
              return (
                <ResolvePopover
                  line={line}
                  onResolve={handleResolveLine}
                  onClose={() => setResolveLineId(null)}
                />
              );
            })()}

            {/* ── Notes Modal ── */}
            {notesModalOpen && (
              <>
                <div
                  onClick={() => { if (!notesSaving) setNotesModalOpen(false); }}
                  style={{
                    position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 49,
                  }}
                />
                <div
                  role="dialog"
                  aria-label="Notes"
                  style={{
                    position: "fixed",
                    top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                    width: 440,
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
                    zIndex: 50,
                    display: "flex", flexDirection: "column",
                    overflow: "hidden",
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && !notesSaving) {
                      e.stopPropagation();
                      setNotesModalOpen(false);
                    }
                  }}
                >
                  {/* Header */}
                  <div style={{
                    padding: "12px 16px",
                    borderBottom: "1px solid #e5e7eb",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    gap: 12,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>Notes</div>
                    <button
                      onClick={() => { if (!notesSaving) setNotesModalOpen(false); }}
                      disabled={notesSaving}
                      aria-label="Close"
                      style={{
                        width: 24, height: 24, borderRadius: 4, border: "1px solid #e5e7eb",
                        background: "#fff", cursor: notesSaving ? "default" : "pointer",
                        fontSize: 14, color: "#9ca3af",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      ×
                    </button>
                  </div>

                  {/* Body */}
                  <div style={{ padding: "14px 16px 12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                    <label
                      htmlFor="mo-notes-textarea"
                      style={{
                        fontSize: 10, fontWeight: 500, color: "#9ca3af",
                        textTransform: "uppercase", letterSpacing: "0.05em",
                      }}
                    >
                      Notes for this order
                    </label>
                    <textarea
                      id="mo-notes-textarea"
                      autoFocus
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      placeholder="Add a note for this order…"
                      rows={4}
                      maxLength={5000}
                      className="focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
                      style={{
                        width: "100%",
                        minHeight: 96,
                        resize: "vertical",
                        border: "1px solid #e5e7eb",
                        borderRadius: 6,
                        padding: "8px 10px",
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: "#111827",
                        outline: "none",
                        fontFamily: "inherit",
                      }}
                    />
                  </div>

                  {/* Footer */}
                  <div style={{
                    padding: "10px 16px 14px 16px",
                    display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8,
                  }}>
                    <button
                      onClick={() => setNotesModalOpen(false)}
                      disabled={notesSaving}
                      style={{
                        height: 30, padding: "0 12px", borderRadius: 6,
                        fontSize: 12, fontWeight: 500,
                        border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280",
                        cursor: notesSaving ? "default" : "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleNotesSave}
                      disabled={notesSaving}
                      style={{
                        height: 30, padding: "0 14px", borderRadius: 6,
                        fontSize: 12, fontWeight: 600,
                        border: "1px solid #111827",
                        background: notesSaving ? "#374151" : "#111827",
                        color: "#fff",
                        cursor: notesSaving ? "wait" : "pointer",
                      }}
                    >
                      {notesSaving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* ── Print Footer (only visible when printing) ── */}
            <div className="mo-print-footer">
              OrbitOMS · JSW Dulux Surat Depot · Printed {new Date().toLocaleString("en-IN", {
                day: "2-digit", month: "short", year: "numeric",
                hour: "2-digit", minute: "2-digit",
                hour12: false, timeZone: "Asia/Kolkata",
              })} IST
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-[13px]">
            Select an order from the left panel
          </div>
        )}
      </div>
    </div>
  );
}
