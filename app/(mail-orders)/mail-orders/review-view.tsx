"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { Check, Pencil, Copy, Mail, Flag, Search } from "lucide-react";
import type { MoOrder, MoOrderLine, CustomerSearchResult } from "@/lib/mail-orders/types";
import type { SlotCutoffs } from "@/lib/mail-orders/utils";
import {
  smartTitleCase,
  cleanSubject,
  isOdCiFlagged,
  getOrderFlags,
  getOrderVolume,
  getPackVolumeLiters,
  buildReplyTemplate,
} from "@/lib/mail-orders/utils";
import { searchCustomers, saveLineStatus, searchSkus, resolveLine } from "@/lib/mail-orders/api";

interface ReviewViewProps {
  orders: MoOrder[];           // filtered orders (by slot, search, filters)
  allOrders: MoOrder[];        // all orders (for slot counts, unfiltered)
  activeSlot: string | null;
  flaggedIds: Set<number>;
  focusedId: number | null;
  onFocusChange: (id: number | null) => void;
  onFlag: (id: number) => void;
  onSaveSoNumber: (id: number, value: string) => Promise<boolean>;
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
}

// ── Helpers ────────────────────────────────────────────────────────────────

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

function formatTime(iso: string): string {
  const d = new Date(iso);
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`;
}

// Map flag string to badge category
function flagCategory(flag: string): "blocker" | "attention" | "info" {
  const upper = flag.toUpperCase();
  if (upper === "OD" || upper === "CI" || upper === "BOUNCE") return "blocker";
  if (upper === "HOLD") return "attention";
  return "info";
}

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

// ── Remark Section ─────────────────────────────────────────────────────────

function RemarkSection({ label, value, isEmpty }: { label: string; value: string; isEmpty?: boolean }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontSize: 9, fontWeight: 600, color: "#9ca3af",
        textTransform: "uppercase", letterSpacing: "0.04em",
        marginBottom: 1,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 11, color: isEmpty ? "#d1d5db" : "#4b5563",
        lineHeight: 1.3,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        fontStyle: isEmpty ? "italic" : "normal",
      }}>
        {value}
      </div>
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
}: ReviewViewProps) {
  // ── Local state ─────────────────────────────────────────────────
  const [soInput, setSoInput] = useState("");
  const [editingSoNumber, setEditingSoNumber] = useState(false);
  const [codeFlash, setCodeFlash] = useState(false);
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
  const [activeLineIndex, setActiveLineIndex] = useState<number>(0);

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
  }, [focusedId]);

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

  // Group orders into pending and punched (earliest first for review workflow)
  const pendingOrders = useMemo(() => {
    const list = orders.filter(o => o.status !== "punched" || recentlyPunchedIds.has(o.id));
    return [...list].sort(
      (a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime(),
    );
  }, [orders, recentlyPunchedIds]);
  const punchedOrders = useMemo(() => {
    const list = orders.filter(o => o.status === "punched" && !recentlyPunchedIds.has(o.id));
    return [...list].sort(
      (a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime(),
    );
  }, [orders, recentlyPunchedIds]);

  // ── Handlers ─────────────────────────────────────────────────────
  function handleCopyCode() {
    if (!selectedOrder?.customerCode) return;
    navigator.clipboard.writeText(selectedOrder.customerCode);
    setCodeFlash(true);
    setTimeout(() => setCodeFlash(false), 1500);
  }

  async function handlePunchClick() {
    if (!selectedOrder) return;
    if (soInput.length !== 10) return;
    const ok = await onSaveSoNumber(selectedOrder.id, soInput);
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
  }

  function handleReplyClick() {
    if (!selectedOrder) return;
    if (selectedOrder.status !== "punched" || !selectedOrder.soNumber) return;
    const name = smartTitleCase(
      selectedOrder.customerMatchStatus === "exact" && selectedOrder.customerName
        ? selectedOrder.customerName
        : cleanSubject(selectedOrder.subject),
    ) + (selectedOrder.splitLabel ? ` (${selectedOrder.splitLabel})` : "");

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

  // ── Order row renderer (left panel) ──────────────────────────────
  function renderOrderRow(order: MoOrder) {
    const isFocused = focusedId === order.id;
    const isFlagged = order.isLocked || isOdCiFlagged(order);
    const isPunched = order.status === "punched";

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
        onClick={() => onFocusChange(order.id)}
        className={`px-3.5 py-2.5 border-b border-gray-100 cursor-pointer border-l-[3px] transition-colors ${borderClass}`}
        data-review-order-id={order.id}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${getDeliveryDotClass(order.customerDeliveryType)}`} />
            <span className="text-[13px] font-semibold text-gray-900 truncate">
              {smartTitleCase(order.customerName ?? cleanSubject(order.subject))}
              {order.splitLabel ? ` (${order.splitLabel})` : ""}
            </span>
          </div>
          <span className="text-[11px] text-gray-400 flex-shrink-0 ml-2 tabular-nums">
            {formatTime(order.receivedAt)}
          </span>
        </div>
        <div className="text-[11px] text-gray-400 mt-0.5 truncate">
          {smartTitleCase(cleanSubject(order.soName))}
        </div>
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

  // Auto-advance: when focused order becomes fully punched (after grace period),
  // move to next pending order
  useEffect(() => {
    if (focusedId === null) return;
    const order = orders.find(o => o.id === focusedId);
    if (!order) return;
    if (order.status === "punched" && !recentlyPunchedIds.has(order.id)) {
      const nextPending = orders.find(o => o.status !== "punched");
      if (nextPending) {
        onFocusChange(nextPending.id);
      }
    }
  }, [orders, focusedId, recentlyPunchedIds, onFocusChange]);

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
  function renderDetailHeader(order: MoOrder) {
    const flags = getOrderFlags(order);
    const blockerFlags = flags.filter(f => flagCategory(f) === "blocker");
    const attentionFlags = flags.filter(f => flagCategory(f) === "attention");
    const infoFlags = flags.filter(f => flagCategory(f) === "info");
    const isFlagged = !!order.isLocked || isOdCiFlagged(order);
    const isPunched = order.status === "punched" && !!order.soNumber;
    const showInputMode = !isPunched || editingSoNumber;
    const punchReady = soInput.length === 10;

    const status = order.customerMatchStatus ?? "unmatched";
    const matchCount = order.matchedLines;
    const totalCount = order.totalLines;
    const allMatched = matchCount === totalCount;

    // Meta items (only those with values)
    const metaParts: { key: string; el: React.ReactNode }[] = [];
    metaParts.push({ key: "so", el: <>{smartTitleCase(cleanSubject(order.soName))}</> });
    metaParts.push({ key: "time", el: <span className="tabular-nums">{formatTime(order.receivedAt)}</span> });
    if (order.customerArea) metaParts.push({ key: "area", el: <>{smartTitleCase(order.customerArea)}</> });
    if (order.customerDeliveryType) metaParts.push({ key: "dtype", el: <>{order.customerDeliveryType}</> });
    const vol = Math.round(getOrderVolume(order.lines));
    if (vol > 0) metaParts.push({ key: "vol", el: <span className="tabular-nums">{vol}L</span> });
    metaParts.push({ key: "lines", el: <>{order.totalLines} lines</> });

    return (
      <div className="flex-shrink-0 border-b border-gray-200">
        {/* ── Row 1 ── */}
        <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-[7px]">
          {/* LEFT */}
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            {/* Delivery dot */}
            <span className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${getDeliveryDotClass(order.customerDeliveryType)}`} />

            {/* Customer name */}
            <span className="text-[17px] font-bold tracking-tight text-gray-900 truncate">
              {smartTitleCase(order.customerName ?? cleanSubject(order.subject))}
              {order.splitLabel ? ` (${order.splitLabel})` : ""}
            </span>

            {/* Code chip — 3 states */}
            {status === "exact" && order.customerCode && (
              <span
                onClick={handleCopyCode}
                className={`font-mono text-[11px] font-medium px-[7px] py-[2px] border rounded cursor-pointer transition-all flex-shrink-0 ${
                  codeFlash
                    ? "bg-teal-50 border-teal-200 text-teal-700"
                    : "bg-gray-50 border-gray-200 text-gray-800 hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700"
                }`}
              >
                {order.customerCode}
              </span>
            )}
            {status === "multiple" && (
              <div className="relative flex-shrink-0">
                <span
                  onClick={() => setCodePopoverOpen(prev => !prev)}
                  className="text-[11px] font-semibold px-[7px] py-[2px] bg-amber-50 border border-amber-200 rounded text-amber-700 cursor-pointer inline-flex items-center gap-1 hover:bg-amber-100"
                >
                  {multiCandidates.length} found ▾
                </span>
                {codePopoverOpen && (
                  <div ref={popoverRef} className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-[280px] max-h-[280px] overflow-y-auto">
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
                              {[c.area, c.route].filter(Boolean).join(" \u00b7 ")}
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
                )}
              </div>
            )}
            {status === "unmatched" && (
              <div className="relative flex-shrink-0">
                <span className="inline-flex items-center h-[24px] border-[1.5px] border-amber-200 rounded bg-amber-50 overflow-hidden">
                  <Search size={10} className="text-amber-600 ml-1.5" />
                  <input
                    ref={custSearchInputRef}
                    type="text"
                    placeholder="Search customer..."
                    value={custSearchQuery}
                    onChange={(e) => setCustSearchQuery(e.target.value)}
                    onFocus={() => setCodePopoverOpen(true)}
                    className="border-none outline-none bg-transparent text-[11px] text-gray-900 px-1.5 w-[130px] placeholder:text-amber-600 placeholder:font-normal"
                  />
                </span>
                {codePopoverOpen && (
                  <div ref={popoverRef} className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-[280px] max-h-[240px] overflow-y-auto">
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
                              {[c.area, c.route].filter(Boolean).join(" \u00b7 ")}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Match chip */}
            <span className={`text-[10px] font-semibold px-1.5 py-[2px] rounded-[3px] flex-shrink-0 border ${
              allMatched
                ? "bg-green-50 text-green-700 border-green-200"
                : "bg-amber-50 text-amber-700 border-amber-200"
            }`}>
              {matchCount}/{totalCount}
            </span>

            {/* Dispatch badge */}
            {order.dispatchStatus && (
              <span className={`text-[10px] font-semibold px-2 py-[2px] rounded flex-shrink-0 border ${
                order.dispatchStatus === "Hold"
                  ? "bg-red-50 text-red-700 border-red-200"
                  : "bg-green-50 text-green-700 border-green-200"
              }`}>
                {order.dispatchStatus}
              </span>
            )}
            {order.dispatchPriority === "Urgent" && (
              <span className="text-[10px] font-semibold px-2 py-[2px] rounded bg-amber-50 text-amber-700 border border-amber-200 flex-shrink-0">
                Urgent
              </span>
            )}

            {/* Signal badges */}
            {blockerFlags.map((f, i) => (
              <span key={`b-${i}`} className="text-[9px] font-semibold px-[5px] py-[1px] rounded-[3px] bg-red-50 text-red-700 border border-red-200 flex-shrink-0">
                {f}
              </span>
            ))}
            {attentionFlags.map((f, i) => (
              <span key={`a-${i}`} className="text-[9px] font-semibold px-[5px] py-[1px] rounded-[3px] bg-amber-50 text-amber-700 border border-amber-200 flex-shrink-0">
                {f}
              </span>
            ))}
            {infoFlags.map((f, i) => (
              <span key={`i-${i}`} className="text-[9px] font-semibold px-[5px] py-[1px] rounded-[3px] bg-gray-50 text-gray-500 border border-gray-200 flex-shrink-0">
                {f}
              </span>
            ))}
          </div>

          {/* RIGHT — Order No. input or Punched state */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {showInputMode ? (
              <>
                <div className="flex items-center border-[1.5px] border-gray-200 rounded-md overflow-hidden focus-within:border-teal-500 focus-within:shadow-[0_0_0_3px_rgba(13,148,136,0.08)]">
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
            ) : (
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
            )}
          </div>
        </div>

        {/* ── Row 2 ── */}
        <div className="flex items-center justify-between px-5 pb-2.5">
          {/* LEFT — Meta */}
          <div className="flex items-center gap-[5px] flex-wrap text-[11px] text-gray-400 min-w-0">
            {metaParts.map((p, i) => (
              <span key={p.key} className="inline-flex items-center gap-[5px]">
                {i > 0 && <span className="text-gray-300">·</span>}
                {p.el}
              </span>
            ))}
          </div>

          {/* RIGHT — Compact icon action buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            {/* Copy */}
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

            {/* Reply */}
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

            {/* Flag */}
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
          </div>
        </div>
      </div>
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

    return (
      <div className="flex-1 overflow-y-auto" style={{ padding: "0 6px" }}>
        <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "4%" }} />
            <col style={{ width: "24%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "26%" }} />
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
              <th style={thStyle}>Description</th>
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

                  {/* Description */}
                  <td style={{ ...tdBase, ...rowEdge }}>
                    {rowState === "normal" && (
                      <>
                        <span style={{ fontWeight: 500, color: "#111827" }}>{line.productName}</span>
                        {line.baseColour && (
                          <span style={{ color: "#6b7280" }}> · {line.baseColour}</span>
                        )}
                      </>
                    )}
                    {rowState === "partial" && (
                      <>
                        <span style={{ fontWeight: 500, color: "#b45309" }}>{line.productName}</span>
                        {line.baseColour && (
                          <span style={{ color: "#b45309" }}> · {line.baseColour}</span>
                        )}
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: "0 4px", borderRadius: 2,
                          background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a",
                          marginLeft: 4, display: "inline-block",
                        }}>PARTIAL</span>
                      </>
                    )}
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
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* LEFT PANEL — 320px */}
      <div className="w-[320px] flex-shrink-0 border-r border-gray-200 flex flex-col">
        {/* Search input */}
        <div className="px-3 py-2 border-b border-gray-200">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter orders..."
            className="w-full h-[28px] border border-gray-200 rounded-md px-2.5 text-[11px] text-gray-600 outline-none placeholder:text-gray-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
          />
        </div>

        {/* Order list */}
        <div className="flex-1 overflow-y-auto">
          {pendingOrders.map(renderOrderRow)}

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
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedOrder ? (
          <>
            {renderDetailHeader(selectedOrder)}
            {renderSkuTable(selectedOrder)}

            {/* ── Remarks Footer ── */}
            <div style={{
              flexShrink: 0,
              borderTop: "1px solid #e5e7eb",
              padding: "8px 20px",
              display: "flex",
              gap: 20,
              background: "#f9fafb",
            }}>
              <RemarkSection
                label="Delivery"
                value={selectedOrder.deliveryRemarks || "—"}
                isEmpty={!selectedOrder.deliveryRemarks}
              />
              <RemarkSection
                label="Bill"
                value={selectedOrder.billRemarks || "—"}
                isEmpty={!selectedOrder.billRemarks}
              />
              <RemarkSection
                label="Notes"
                value={
                  selectedOrder.remarks_list && selectedOrder.remarks_list.length > 0
                    ? selectedOrder.remarks_list.map(r => r.rawText).join(" · ")
                    : "—"
                }
                isEmpty={!selectedOrder.remarks_list || selectedOrder.remarks_list.length === 0}
              />
              <div style={{ width: 60, flex: "none" }}>
                <div style={{
                  fontSize: 9, fontWeight: 600, color: "#9ca3af",
                  textTransform: "uppercase", letterSpacing: "0.04em",
                  marginBottom: 1,
                }}>
                  Received
                </div>
                <div style={{ fontSize: 11, color: "#4b5563", fontVariantNumeric: "tabular-nums" }}>
                  {formatTime(selectedOrder.receivedAt)}
                </div>
              </div>
            </div>

            {/* ── Nav Footer ── */}
            <div style={{
              flexShrink: 0,
              height: 36,
              borderTop: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: "0 20px",
            }}>
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
