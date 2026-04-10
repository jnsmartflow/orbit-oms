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
  buildReplyTemplate,
} from "@/lib/mail-orders/utils";
import { searchCustomers } from "@/lib/mail-orders/api";

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

  // Group orders into pending and punched
  const pendingOrders = useMemo(
    () => orders.filter(o => o.status !== "punched" || recentlyPunchedIds.has(o.id)),
    [orders, recentlyPunchedIds],
  );
  const punchedOrders = useMemo(
    () => orders.filter(o => o.status === "punched" && !recentlyPunchedIds.has(o.id)),
    [orders, recentlyPunchedIds],
  );

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

          {/* RIGHT — Action buttons */}
          <div className="flex items-center gap-[5px] flex-shrink-0">
            <button
              onClick={handleCopyClick}
              className="h-[24px] px-[7px] border border-gray-200 rounded-[5px] text-[10px] font-medium text-gray-400 bg-white hover:bg-gray-50 hover:border-gray-300 hover:text-gray-600 inline-flex items-center gap-[3px] whitespace-nowrap transition-all"
            >
              <Copy size={11} />
              Copy
              <span className="text-[7px] font-bold text-gray-300 bg-gray-50 px-[2px] rounded-[2px] border border-gray-100 font-mono ml-0.5">Ctrl+C</span>
            </button>
            <button
              onClick={handleReplyClick}
              disabled={!isPunched}
              className={`h-[24px] px-[7px] border rounded-[5px] text-[10px] font-medium inline-flex items-center gap-[3px] whitespace-nowrap transition-all bg-white ${
                !isPunched
                  ? "border-gray-200 text-gray-400 opacity-35 pointer-events-none"
                  : replyCopied
                    ? "border-teal-200 text-teal-700 bg-teal-50"
                    : "border-teal-200 text-teal-700 hover:bg-teal-50"
              }`}
            >
              <Mail size={11} />
              Reply
              <span className="text-[7px] font-bold text-gray-300 bg-gray-50 px-[2px] rounded-[2px] border border-gray-100 font-mono ml-0.5">R</span>
            </button>
            <button
              onClick={() => onFlag(order.id)}
              className={`h-[24px] px-[7px] border rounded-[5px] text-[10px] font-medium inline-flex items-center gap-[3px] whitespace-nowrap transition-all bg-white ${
                isFlagged
                  ? "border-amber-200 text-amber-700 hover:bg-amber-50"
                  : "border-gray-200 text-gray-400 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-600"
              }`}
            >
              <Flag size={11} />
              Flag
              <span className="text-[7px] font-bold text-gray-300 bg-gray-50 px-[2px] rounded-[2px] border border-gray-100 font-mono ml-0.5">F</span>
            </button>
          </div>
        </div>
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

            {/* SKU table — Step 3 placeholder */}
            <div className="flex-1 overflow-y-auto flex items-center justify-center text-gray-400 text-[13px]">
              SKU table — Step 3
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
