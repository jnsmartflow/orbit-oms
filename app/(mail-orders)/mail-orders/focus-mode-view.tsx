"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Check, ChevronDown, ChevronUp, Flag, List } from "lucide-react";
import {
  formatTime,
  smartTitleCase,
  getOrderVolume,
  formatVolume,
  getSlotFromTime,
  buildClipboardText,
  buildBatchClipboardText,
  BATCH_COPY_LIMIT,
  isOdCiFlagged,
} from "@/lib/mail-orders/utils";
import type { MoOrder, MoOrderLine } from "@/lib/mail-orders/types";

// ── Types ────────────────────────────────────────────────────────────────────

interface FocusModeViewProps {
  orders: MoOrder[];
  activeSlot: string | null;
  flaggedIds: Set<number>;
  onFlag: (id: number) => void;
  onSaveSoNumber: (orderId: number, value: string) => Promise<boolean>;
  onCopy: (id: number, lines: MoOrderLine[], batchIndex?: number) => void;
  batchStates: Record<number, number>;
  onAdvanceBatch: (orderId: number) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SLOT_ORDER = ["Morning", "Afternoon", "Evening", "Night"] as const;

function getDeliveryDotColor(deliveryType: string | null | undefined): string | null {
  if (!deliveryType) return null;
  switch (deliveryType.toUpperCase()) {
    case "LOCAL": return "bg-blue-600";
    case "UPC": return "bg-orange-600";
    case "IGT": return "bg-teal-600";
    case "CROSS":
    case "CROSS DEPOT": return "bg-rose-600";
    default: return null;
  }
}

function getDeliveryDotTitle(deliveryType: string | null | undefined): string {
  if (!deliveryType) return "";
  switch (deliveryType.toUpperCase()) {
    case "LOCAL": return "Local";
    case "UPC": return "Upcountry";
    case "IGT": return "IGT";
    case "CROSS":
    case "CROSS DEPOT": return "Cross Depot";
    default: return deliveryType;
  }
}

function cleanSubject(subject: string): string {
  let s = subject;
  s = s.replace(/^(?:(?:fw|fwd|re)\s*:\s*)+/i, "");
  s = s.replace(/^urgent\s+/i, "");
  s = s.replace(/^Order\s*:\s*/i, "");
  s = s.replace(/^Order\s+for\s+/i, "");
  s = s.replace(/^Order-\d+\s*/i, "");
  s = s.replace(/^Order\s+-\s*/i, "");
  s = s.replace(/^Order-[a-z]+\s+/i, "");
  s = s.replace(/^Order\s+/i, "");
  s = s.replace(/^\d{4,}\s*/, "");
  s = s.replace(/\s*[-–]\s*(truck\s*order|truck)\s*$/i, "");
  s = s.replace(/\s*\(truck\s*order\)\s*/gi, "");
  s = s.replace(/\s*\(\d{4,}\)\s*/g, "");
  s = s.replace(/\s+\d{4,}$/, "");
  s = s.replace(/\s*-\s*order$/i, "");
  s = s.replace(/\.+$/, "");
  s = s.replace(/-\d{4,}$/, "");
  return s.trim() || subject.trim();
}

function formatTimeAMPM(receivedAt: string): string {
  const d = new Date(receivedAt);
  return d.toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/** Extract signal badges from order remarks */
function getSignalBadges(order: MoOrder): Array<{ label: string; type: "blocker" | "attention" | "info" | "split" }> {
  const badges: Array<{ label: string; type: "blocker" | "attention" | "info" | "split" }> = [];
  const fields = [order.remarks, order.billRemarks, order.deliveryRemarks, order.subject].filter(Boolean).join(" ");

  // Blockers (red)
  if (/\bOD\b/i.test(fields)) badges.push({ label: "OD", type: "blocker" });
  if (/\bCI\b/i.test(fields)) badges.push({ label: "CI", type: "blocker" });
  if (/\bbounce\b/i.test(fields)) badges.push({ label: "Bounce", type: "blocker" });

  // Attention (amber)
  if (/\bbill\s*tomorrow\b/i.test(fields)) badges.push({ label: "Bill tomorrow", type: "attention" });
  if (/\bcross\s*bill/i.test(fields)) badges.push({ label: "Cross", type: "attention" });
  if (order.shipToOverride) badges.push({ label: "Ship-to", type: "attention" });
  if (order.dispatchPriority === "Urgent") badges.push({ label: "Urgent", type: "attention" });

  // Info (gray)
  if (/\btruck\b/i.test(fields)) badges.push({ label: "Truck", type: "info" });
  if (/\bchallan\b/i.test(fields)) badges.push({ label: "Challan", type: "info" });
  if (/\bDPL\b/i.test(fields)) badges.push({ label: "DPL", type: "info" });
  if (/\b7\s*days\b/i.test(fields)) badges.push({ label: "7 Days", type: "info" });
  if (/\bextension\b/i.test(fields) && !badges.some(b => b.label === "Bill tomorrow")) {
    badges.push({ label: "Extension", type: "info" });
  }

  // Split (purple)
  if (order.splitLabel) badges.push({ label: `✂ ${order.splitLabel}`, type: "split" });

  return badges;
}

const BADGE_STYLES: Record<string, string> = {
  blocker: "bg-red-50 text-red-700 border-red-200",
  attention: "bg-amber-50 text-amber-700 border-amber-200",
  info: "bg-gray-50 text-gray-500 border-gray-200",
  split: "bg-purple-50 text-purple-600 border-purple-200",
};

const GRACE_PERIOD_MS = 8000;

// ── Component ────────────────────────────────────────────────────────────────

export function FocusModeView({
  orders,
  activeSlot,
  flaggedIds,
  onFlag,
  onSaveSoNumber,
  onCopy,
  batchStates,
  onAdvanceBatch,
}: FocusModeViewProps) {
  // ── Build queue for the active slot ──────────────────────────────────────────
  const queue = useMemo(() => {
    let slotOrders = orders;
    if (activeSlot) {
      slotOrders = orders.filter((o) => getSlotFromTime(o.receivedAt) === activeSlot);
    }
    // Sort: pending first (by receivedAt ASC), then punched (by punchedAt DESC)
    const pending = slotOrders
      .filter((o) => o.status === "pending")
      .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
    const punched = slotOrders
      .filter((o) => o.status === "punched")
      .sort((a, b) => new Date(b.punchedAt || b.receivedAt).getTime() - new Date(a.punchedAt || a.receivedAt).getTime());
    return [...pending, ...punched];
  }, [orders, activeSlot]);

  // ── Current index ────────────────────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showOrderList, setShowOrderList] = useState(false);
  const [expandLines, setExpandLines] = useState(false);
  const [soInput, setSoInput] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);
  const [skuCopied, setSkuCopied] = useState(false);
  const [replyCopied, setReplyCopied] = useState(false);
  const [justDoneId, setJustDoneId] = useState<number | null>(null);
  const [graceCountdown, setGraceCountdown] = useState(0);
  const soInputRef = useRef<HTMLInputElement>(null);
  const orderListRef = useRef<HTMLDivElement>(null);

  const currentOrder = queue[currentIndex] ?? null;
  const pendingCount = queue.filter((o) => o.status === "pending").length;
  const punchedCount = queue.filter((o) => o.status === "punched").length;
  const totalCount = queue.length;

  // ── Reset state when order changes ───────────────────────────────────────────
  useEffect(() => {
    setSoInput(currentOrder?.soNumber || "");
    setExpandLines(false);
    setCodeCopied(false);
    setSkuCopied(false);
    setReplyCopied(false);
  }, [currentOrder?.id, currentOrder?.soNumber]);

  // ── Auto-focus SO input on active (pending) orders ───────────────────────────
  useEffect(() => {
    if (currentOrder && currentOrder.status === "pending" && currentOrder.id !== justDoneId) {
      setTimeout(() => soInputRef.current?.focus(), 100);
    }
  }, [currentOrder?.id, currentOrder?.status, justDoneId]);

  // ── Grace period timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (justDoneId === null) return;
    setGraceCountdown(8);
    const interval = setInterval(() => {
      setGraceCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          // Auto-advance to next pending
          advanceToNextPending();
          setJustDoneId(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justDoneId]);

  // ── Close order list on outside click ────────────────────────────────────────
  useEffect(() => {
    if (!showOrderList) return;
    function handleClick(e: MouseEvent) {
      if (orderListRef.current && !orderListRef.current.contains(e.target as Node)) {
        setShowOrderList(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showOrderList]);

  // ── Navigation helpers ───────────────────────────────────────────────────────
  const goTo = useCallback((index: number) => {
    if (index >= 0 && index < queue.length) {
      setCurrentIndex(index);
      setShowOrderList(false);
      setJustDoneId(null);
    }
  }, [queue.length]);

  const goPrev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);
  const goNext = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);

  const advanceToNextPending = useCallback(() => {
    const nextIdx = queue.findIndex((o, i) => i > currentIndex && o.status === "pending");
    if (nextIdx !== -1) {
      setCurrentIndex(nextIdx);
      setJustDoneId(null);
    } else {
      // No more pending — stay or go to next in list
      if (currentIndex < queue.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
    }
  }, [queue, currentIndex]);

  const jumpToNextUnmatched = useCallback(() => {
    const nextIdx = queue.findIndex(
      (o, i) => i > currentIndex && o.status === "pending" && o.matchedLines < o.totalLines,
    );
    if (nextIdx !== -1) goTo(nextIdx);
  }, [queue, currentIndex, goTo]);

  // ── Action handlers ──────────────────────────────────────────────────────────
  const handleCopyCode = useCallback(() => {
    if (!currentOrder?.customerCode) return;
    navigator.clipboard.writeText(currentOrder.customerCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
  }, [currentOrder]);

  const handleCopySkus = useCallback(() => {
    if (!currentOrder) return;
    const matched = currentOrder.lines.filter((l) => l.matchStatus === "matched" && l.skuCode != null);
    if (matched.length === 0) return;
    const needsBatching = matched.length > BATCH_COPY_LIMIT;
    if (needsBatching) {
      const currentBatch = batchStates[currentOrder.id] ?? 0;
      onCopy(currentOrder.id, currentOrder.lines, currentBatch);
      onAdvanceBatch(currentOrder.id);
    } else {
      onCopy(currentOrder.id, currentOrder.lines);
    }
    setSkuCopied(true);
    setTimeout(() => setSkuCopied(false), 1500);
  }, [currentOrder, batchStates, onCopy, onAdvanceBatch]);

  const handleSoSubmit = useCallback(async () => {
    if (!currentOrder || !soInput.trim()) return;
    const success = await onSaveSoNumber(currentOrder.id, soInput.trim());
    if (success) {
      setJustDoneId(currentOrder.id);
    }
  }, [currentOrder, soInput, onSaveSoNumber]);

  const handleReplyAndNext = useCallback(() => {
    if (!currentOrder) return;
    // Build simple reply template inline (avoids dependency on buildReplyTemplate which may not exist yet)
    const customerName = currentOrder.customerName
      ? smartTitleCase(currentOrder.customerName)
      : cleanSubject(currentOrder.subject);
    const code = currentOrder.customerCode || "—";
    const area = currentOrder.customerArea ? smartTitleCase(currentOrder.customerArea) : "—";
    const soNum = currentOrder.soNumber || "—";
    const template = [
      `Customer : ${customerName}`,
      `Code     : ${code}`,
      `Area     : ${area}`,
      `SO No.   : ${soNum}`,
      ``,
      `Thanks & Regards`,
      `JSW Dulux Ltd`,
    ].join("\n");
    navigator.clipboard.writeText(template);
    setReplyCopied(true);
    setTimeout(() => setReplyCopied(false), 1500);

    // If in grace period, advance immediately
    if (justDoneId !== null) {
      setJustDoneId(null);
      advanceToNextPending();
    }
  }, [currentOrder, justDoneId, advanceToNextPending]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      const isInInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      // SO input: Enter to submit
      if (isInInput && e.key === "Enter" && soInput.trim()) {
        e.preventDefault();
        handleSoSubmit();
        return;
      }

      // Escape: close order list or blur input
      if (e.key === "Escape") {
        if (showOrderList) {
          setShowOrderList(false);
          return;
        }
        if (isInInput) {
          (document.activeElement as HTMLElement)?.blur();
          return;
        }
        return;
      }

      if (isInInput) return;

      const key = e.key;

      // Navigation
      if (key === "ArrowLeft" || key === "ArrowUp") { e.preventDefault(); goPrev(); return; }
      if (key === "ArrowRight" || key === "ArrowDown") { e.preventDefault(); goNext(); return; }

      // Q — copy code
      if (key === "q" || key === "Q") { handleCopyCode(); return; }

      // W — copy SKUs
      if (key === "w" || key === "W") { handleCopySkus(); return; }

      // E — focus SO input
      if (key === "e" || key === "E") { soInputRef.current?.focus(); return; }

      // R — reply
      if (key === "r" || key === "R") { handleReplyAndNext(); return; }

      // F — flag
      if ((key === "f" || key === "F") && currentOrder) { onFlag(currentOrder.id); return; }

      // N — next unmatched
      if (key === "n" || key === "N") { jumpToNextUnmatched(); return; }

      // L — toggle order list
      if (key === "l" || key === "L") { setShowOrderList((p) => !p); return; }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    showOrderList, soInput, currentOrder,
    goPrev, goNext, handleCopyCode, handleCopySkus, handleSoSubmit,
    handleReplyAndNext, onFlag, jumpToNextUnmatched,
  ]);

  // ── Slot complete check ──────────────────────────────────────────────────────
  const isSlotComplete = totalCount > 0 && pendingCount === 0 && justDoneId === null;

  // ── Determine card state ─────────────────────────────────────────────────────
  const isJustDone = currentOrder?.id === justDoneId;
  const isFlagged = currentOrder ? flaggedIds.has(currentOrder.id) : false;
  const isPunched = currentOrder?.status === "punched" && !isJustDone;

  // ── No orders ────────────────────────────────────────────────────────────────
  if (totalCount === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-400 text-sm">No orders in this slot.</p>
      </div>
    );
  }

  // ── Slot complete card ───────────────────────────────────────────────────────
  if (isSlotComplete) {
    const slotName = activeSlot || "Slot";
    const totalVol = queue.reduce((s, o) => s + getOrderVolume(o.lines), 0);
    const soGroups = new Map<string, MoOrder[]>();
    for (const o of queue) {
      const key = o.soName;
      if (!soGroups.has(key)) soGroups.set(key, []);
      soGroups.get(key)!.push(o);
    }

    // Find next slot with orders
    const currentSlotIdx = activeSlot ? SLOT_ORDER.indexOf(activeSlot as typeof SLOT_ORDER[number]) : -1;
    let nextSlot: string | null = null;
    if (currentSlotIdx !== -1) {
      for (let i = currentSlotIdx + 1; i < SLOT_ORDER.length; i++) {
        if (orders.some((o) => getSlotFromTime(o.receivedAt) === SLOT_ORDER[i])) {
          nextSlot = SLOT_ORDER[i];
          break;
        }
      }
    }

    const handleCopyAllSOs = () => {
      const soNums = queue.map((o) => o.soNumber).filter(Boolean);
      navigator.clipboard.writeText(soNums.join("\n"));
    };

    return (
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="max-w-lg mx-auto">
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {/* Green accent bar */}
            <div className="h-[3px] bg-green-500" />
            <div className="px-4 py-6 text-center">
              {/* Check icon */}
              <div className="w-12 h-12 rounded-full bg-green-50 mx-auto mb-3 flex items-center justify-center">
                <Check size={24} className="text-green-600" />
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">
                {slotName} complete
              </h2>
              <p className="text-xs text-gray-500">
                {totalCount} orders · {soGroups.size} SOs · {formatVolume(totalVol)}
              </p>
            </div>

            {/* SO groups */}
            <div className="border-t border-gray-200">
              {Array.from(soGroups.entries()).map(([soName, soOrders]) => (
                <div
                  key={soName}
                  className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 last:border-b-0"
                >
                  <div>
                    <p className="text-xs font-semibold text-gray-700">{soName}</p>
                    <p className="text-[10px] text-gray-400">{soOrders.length} orders</p>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => {
                        const nums = soOrders.map((o) => o.soNumber).filter(Boolean);
                        navigator.clipboard.writeText(nums.join("\n"));
                      }}
                      className="text-[10px] px-2 py-1 border border-gray-200 rounded bg-white text-gray-600 hover:bg-gray-50"
                    >
                      SAP
                    </button>
                    <button
                      onClick={() => {
                        const lines = soOrders.map((o, i) => {
                          const name = o.customerName ? smartTitleCase(o.customerName) : cleanSubject(o.subject);
                          return `${i + 1}. ${name} · ${o.customerCode || "—"} · ${smartTitleCase(o.customerArea) || "—"}\n   SO: ${o.soNumber || "—"}`;
                        });
                        navigator.clipboard.writeText(lines.join("\n\n") + "\n\nThanks & Regards\nJSW Dulux Ltd");
                      }}
                      className="text-[10px] px-2 py-1 border border-gray-200 rounded bg-white text-gray-600 hover:bg-gray-50"
                    >
                      Reply
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="flex gap-2 p-4 border-t border-gray-200">
              <button
                onClick={handleCopyAllSOs}
                className="flex-1 py-2.5 rounded-md bg-gray-100 text-gray-700 text-xs font-semibold hover:bg-gray-200 transition-colors"
              >
                Copy all SO nos.
              </button>
              {nextSlot && (
                <button
                  onClick={() => {
                    // This would need to be handled by parent — for now just signal via event
                    // Parent should setActiveSlot(nextSlot)
                  }}
                  className="flex-1 py-2.5 rounded-md bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition-colors"
                >
                  Next: {nextSlot} →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Order card ───────────────────────────────────────────────────────────────
  const order = currentOrder!;
  const customerName = order.customerMatchStatus === "exact" && order.customerName
    ? smartTitleCase(order.customerName)
    : smartTitleCase(cleanSubject(order.subject));
  const splitSuffix = order.splitLabel ? ` (${order.splitLabel})` : "";
  const displayName = customerName + splitSuffix;
  const dotColor = getDeliveryDotColor(order.customerDeliveryType);
  const dotTitle = getDeliveryDotTitle(order.customerDeliveryType);
  const totalVol = getOrderVolume(order.lines);
  const volStr = formatVolume(totalVol);
  const badges = getSignalBadges(order);
  const hasCode = order.customerMatchStatus === "exact" && order.customerCode;
  const matchedCount = order.lines.filter((l) => l.matchStatus === "matched" && l.skuCode).length;

  // Card border style
  let cardBorderClass = "border-gray-200";
  let accentBar = null;
  if (isJustDone) {
    cardBorderClass = "border-teal-500 border-2";
    accentBar = <div className="h-[3px] bg-teal-500" />;
  } else if (isFlagged) {
    cardBorderClass = "border-amber-400";
    accentBar = <div className="h-[3px] bg-amber-400" />;
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      <div className="max-w-lg mx-auto">
        {/* ── Progress strip ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 mb-3 text-[11px] text-gray-500">
          <span className="font-medium whitespace-nowrap">
            {currentIndex + 1} of {totalCount}
          </span>
          <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-500 rounded-full transition-all duration-300"
              style={{ width: `${(punchedCount / totalCount) * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-400">
            {punchedCount} done
          </span>
          {/* Order list button */}
          <div className="relative" ref={orderListRef}>
            <button
              onClick={() => setShowOrderList((p) => !p)}
              className="flex items-center gap-1 px-2 py-1 border border-gray-200 rounded text-[10px] text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <List size={11} />
              List
            </button>

            {/* Order list popover */}
            {showOrderList && (
              <div className="absolute top-full right-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-72 overflow-y-auto">
                {queue.map((o, idx) => {
                  const isCurrent = idx === currentIndex;
                  const isDone = o.status === "punched";
                  const isItemFlagged = flaggedIds.has(o.id);
                  const name = o.customerMatchStatus === "exact" && o.customerName
                    ? smartTitleCase(o.customerName)
                    : smartTitleCase(cleanSubject(o.subject));
                  return (
                    <button
                      key={o.id}
                      onClick={() => goTo(idx)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left border-b border-gray-50 last:border-b-0 transition-colors hover:bg-gray-50 ${isCurrent ? "bg-teal-50" : ""}`}
                    >
                      <span
                        className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${
                          isDone ? "bg-green-500" : isItemFlagged ? "bg-amber-400" : "bg-gray-300"
                        }`}
                      />
                      <span className="flex-1 text-[11px] font-medium text-gray-700 truncate">
                        {name}
                      </span>
                      {o.soNumber && (
                        <span className="text-[10px] text-gray-400 font-mono">
                          {o.soNumber}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Card ────────────────────────────────────────────────────────── */}
        <div className={`bg-white border rounded-lg overflow-hidden ${cardBorderClass}`}>
          {accentBar}
          <div className="px-4 pt-3.5 pb-3">
            {/* Identity row */}
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-gray-500">{order.soName}</span>
              <div className="flex items-center gap-2">
                {isJustDone && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full">
                    <Check size={10} /> Done
                  </span>
                )}
                <span className="text-[10px] text-gray-400">{formatTimeAMPM(order.receivedAt)}</span>
              </div>
            </div>

            {/* Customer name */}
            <div className="flex items-center gap-1.5 mb-2">
              <h2 className="text-lg font-bold text-gray-900 leading-tight truncate" title={displayName}>
                {displayName}
              </h2>
              {dotColor && (
                <span className={`w-[6px] h-[6px] rounded-full ${dotColor} flex-shrink-0`} title={dotTitle} />
              )}
              {isFlagged && (
                <Flag size={14} className="text-amber-500 flex-shrink-0 fill-amber-500" />
              )}
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-1.5 flex-wrap mb-2 text-[11px]">
              {hasCode && (
                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px] font-mono">
                  {order.customerCode}
                </span>
              )}
              {order.customerArea && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="text-gray-500">{smartTitleCase(order.customerArea)}</span>
                </>
              )}
              {order.customerDeliveryType && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="text-gray-500">{getDeliveryDotTitle(order.customerDeliveryType)}</span>
                </>
              )}
              {volStr && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="text-gray-500">{volStr}</span>
                </>
              )}
              <span className="text-gray-300">·</span>
              <span className="text-gray-500">{order.totalLines} lines</span>
              {isPunched && order.soNumber && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="font-mono text-teal-700 font-semibold">SO {order.soNumber}</span>
                </>
              )}
            </div>

            {/* Signal badges */}
            {badges.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {badges.map((b, i) => (
                  <span
                    key={i}
                    className={`text-[9px] font-medium px-1.5 py-0.5 rounded border ${BADGE_STYLES[b.type]}`}
                  >
                    {b.label}
                  </span>
                ))}
              </div>
            )}

            {/* ── Just done state: R button only ──────────────────────────── */}
            {isJustDone ? (
              <div>
                <button
                  onClick={handleReplyAndNext}
                  className="w-full py-2.5 rounded-md bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors flex items-center justify-center gap-2"
                >
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-white/20 text-[10px] font-bold">
                    R
                  </span>
                  {replyCopied ? "Copied! Going next…" : "Copy reply & go next"}
                </button>
                <div className="text-center mt-2 text-xs text-teal-700 font-medium flex items-center justify-center gap-2">
                  Next order in {graceCountdown}s
                  <button
                    onClick={() => { setJustDoneId(null); advanceToNextPending(); }}
                    className="text-teal-600 font-semibold underline hover:text-teal-800"
                  >
                    Go now →
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* ── Copy buttons ──────────────────────────────────────────── */}
                <div className="grid grid-cols-2 gap-2 mb-2.5">
                  <button
                    onClick={handleCopyCode}
                    disabled={!hasCode}
                    className={`flex items-center justify-center gap-1.5 py-2.5 border rounded-md text-xs font-semibold transition-colors ${
                      codeCopied
                        ? "border-teal-500 text-teal-600 bg-teal-50"
                        : hasCode
                        ? "border-gray-200 text-gray-700 bg-white hover:bg-gray-50"
                        : "border-gray-100 text-gray-300 bg-gray-50 cursor-not-allowed"
                    }`}
                  >
                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${
                      codeCopied ? "bg-teal-500 text-white" : "bg-gray-100 text-gray-600"
                    }`}>
                      Q
                    </span>
                    {codeCopied ? "Copied!" : "Copy code"}
                  </button>
                  <button
                    onClick={handleCopySkus}
                    disabled={matchedCount === 0}
                    className={`flex items-center justify-center gap-1.5 py-2.5 border rounded-md text-xs font-semibold transition-colors ${
                      skuCopied
                        ? "border-teal-500 text-teal-600 bg-teal-50"
                        : matchedCount > 0
                        ? "border-gray-200 text-gray-700 bg-white hover:bg-gray-50"
                        : "border-gray-100 text-gray-300 bg-gray-50 cursor-not-allowed"
                    }`}
                  >
                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${
                      skuCopied ? "bg-teal-500 text-white" : "bg-gray-100 text-gray-600"
                    }`}>
                      W
                    </span>
                    {skuCopied ? "Copied!" : "Copy SKUs"}
                  </button>
                </div>

                {/* ── SO Number input ───────────────────────────────────────── */}
                <div className="mb-2.5">
                  <input
                    ref={soInputRef}
                    type="text"
                    value={soInput}
                    onChange={(e) => setSoInput(e.target.value)}
                    placeholder="SO number (E to focus)"
                    className={`w-full h-11 border-[1.5px] rounded-md px-3 text-lg font-mono text-gray-900 outline-none transition-colors placeholder:text-gray-300 placeholder:font-sans placeholder:text-sm ${
                      soInput.trim()
                        ? "border-teal-500 bg-teal-50/50"
                        : "border-gray-200 focus:border-teal-500"
                    }`}
                    disabled={isPunched}
                  />
                </div>

                {/* ── R button ──────────────────────────────────────────────── */}
                <button
                  onClick={isPunched ? handleReplyAndNext : soInput.trim() ? handleSoSubmit : undefined}
                  disabled={!isPunched && !soInput.trim()}
                  className={`w-full py-2.5 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                    isPunched
                      ? "bg-teal-600 text-white hover:bg-teal-700"
                      : soInput.trim()
                      ? "bg-teal-600 text-white hover:bg-teal-700"
                      : "bg-gray-100 text-gray-400 cursor-default"
                  }`}
                >
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${
                    isPunched || soInput.trim() ? "bg-white/20 text-white" : "bg-gray-200 text-gray-400"
                  }`}>
                    {isPunched ? "R" : "↵"}
                  </span>
                  {isPunched
                    ? replyCopied ? "Copied!" : "Copy reply"
                    : soInput.trim() ? "Save SO & punch" : "Enter SO number first"
                  }
                </button>
              </>
            )}

            {/* ── Expandable lines ─────────────────────────────────────────── */}
            <button
              onClick={() => setExpandLines((p) => !p)}
              className="w-full flex items-center justify-between pt-2.5 mt-2.5 border-t border-gray-100 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
            >
              <span>
                {matchedCount}/{order.totalLines} SKU lines
                {matchedCount < order.totalLines && (
                  <span className="text-amber-500 ml-1">
                    ({order.totalLines - matchedCount} unmatched)
                  </span>
                )}
              </span>
              {expandLines ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {expandLines && (
              <div className="mt-2 max-h-48 overflow-y-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-gray-400 font-medium">
                      <th className="text-left py-1 pr-2">#</th>
                      <th className="text-left py-1 pr-2">Raw text</th>
                      <th className="text-left py-1 pr-2">SKU</th>
                      <th className="text-right py-1 pr-2">Pk</th>
                      <th className="text-right py-1">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.map((line, i) => (
                      <tr
                        key={line.id}
                        className={`border-t border-gray-50 ${line.matchStatus !== "matched" ? "text-amber-600" : "text-gray-600"}`}
                      >
                        <td className="py-1 pr-2 text-gray-400">{i + 1}</td>
                        <td className="py-1 pr-2 truncate max-w-[160px]" title={line.rawText}>
                          {line.rawText}
                        </td>
                        <td className="py-1 pr-2 font-mono text-[9px]">
                          {line.skuCode || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="py-1 pr-2 text-right">{line.packCode || "—"}</td>
                        <td className="py-1 text-right font-medium">{line.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Navigation footer ──────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 bg-gray-50">
            <button
              onClick={goPrev}
              disabled={currentIndex === 0}
              className={`text-[11px] px-2 py-1 rounded transition-colors ${
                currentIndex === 0 ? "text-gray-300 cursor-default" : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              }`}
            >
              ← Prev
            </button>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded bg-gray-100 text-[9px] font-bold text-gray-500 px-1">
                F
              </span>
              <span className="text-[10px] text-gray-400">
                {isFlagged ? "Unflag" : "Flag"}
              </span>
              <span className="text-gray-200">·</span>
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded bg-gray-100 text-[9px] font-bold text-gray-500 px-1">
                N
              </span>
              <span className="text-[10px] text-gray-400">Next unmatched</span>
            </div>
            <button
              onClick={goNext}
              disabled={currentIndex >= totalCount - 1}
              className={`text-[11px] px-2 py-1 rounded transition-colors ${
                currentIndex >= totalCount - 1 ? "text-gray-300 cursor-default" : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              }`}
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
