"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Check, Flag, List } from "lucide-react";
import {
  smartTitleCase,
  getOrderVolume,
  formatVolume,
  getSlotFromTime,
  BATCH_COPY_LIMIT,
} from "@/lib/mail-orders/utils";
import type { MoOrder, MoOrderLine, LineStatus } from "@/lib/mail-orders/types";
import { LINE_STATUS_REASONS } from "@/lib/mail-orders/types";
import { saveLineStatus } from "@/lib/mail-orders/api";
import { LineStatusPanel } from "./line-status-panel";

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

function getSignalBadges(order: MoOrder): Array<{ label: string; type: "blocker" | "attention" | "info" | "split" }> {
  const badges: Array<{ label: string; type: "blocker" | "attention" | "info" | "split" }> = [];
  const fields = [order.remarks, order.billRemarks, order.deliveryRemarks, order.subject].filter(Boolean).join(" ");

  if (/\bOD\b/i.test(fields)) badges.push({ label: "OD", type: "blocker" });
  if (/\bCI\b/i.test(fields)) badges.push({ label: "CI", type: "blocker" });
  if (/\bbounce\b/i.test(fields)) badges.push({ label: "Bounce", type: "blocker" });

  if (/\bbill\s*tomorrow\b/i.test(fields)) badges.push({ label: "Bill tomorrow", type: "attention" });
  if (/\bcross\s*bill/i.test(fields)) badges.push({ label: "Cross", type: "attention" });
  if (order.shipToOverride) badges.push({ label: "Ship-to", type: "attention" });
  if (order.dispatchPriority === "Urgent") badges.push({ label: "Urgent", type: "attention" });

  if (/\btruck\b/i.test(fields)) badges.push({ label: "Truck", type: "info" });
  if (/\bchallan\b/i.test(fields)) badges.push({ label: "Challan", type: "info" });
  if (/\bDPL\b/i.test(fields)) badges.push({ label: "DPL", type: "info" });
  if (/\b7\s*days\b/i.test(fields)) badges.push({ label: "7 Days", type: "info" });
  if (/\bextension\b/i.test(fields) && !badges.some(b => b.label === "Bill tomorrow")) {
    badges.push({ label: "Extension", type: "info" });
  }

  if (order.splitLabel) badges.push({ label: `✂ ${order.splitLabel}`, type: "split" });

  return badges;
}

const BADGE_STYLES: Record<string, string> = {
  blocker: "bg-red-50 text-red-700 border-red-200",
  attention: "bg-amber-50 text-amber-700 border-amber-200",
  info: "bg-gray-50 text-gray-500 border-gray-200",
  split: "bg-purple-50 text-purple-600 border-purple-200",
};

function getOrderDisplayName(order: MoOrder): string {
  const raw = order.customerMatchStatus === "exact" && order.customerName
    ? order.customerName
    : cleanSubject(order.subject);
  return smartTitleCase(raw) + (order.splitLabel ? ` (${order.splitLabel})` : "");
}

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
    const pending = slotOrders
      .filter((o) => o.status === "pending")
      .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
    const punched = slotOrders
      .filter((o) => o.status === "punched")
      .sort((a, b) => new Date(b.punchedAt || b.receivedAt).getTime() - new Date(a.punchedAt || a.receivedAt).getTime());
    return [...pending, ...punched];
  }, [orders, activeSlot]);

  // ── State ────────────────────────────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showOrderList, setShowOrderList] = useState(false);
  const [orderListHighlight, setOrderListHighlight] = useState(-1);
  const [soInput, setSoInput] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);
  const [skuCopied, setSkuCopied] = useState(false);
  const [replyCopied, setReplyCopied] = useState(false);
  const [justDoneId, setJustDoneId] = useState<number | null>(null);
  const [graceCountdown, setGraceCountdown] = useState(0);
  const [activeLineId, setActiveLineId] = useState<number | null>(null);
  const [lineStatuses, setLineStatuses] = useState<Record<number, LineStatus>>({});
  const [panelHighlight, setPanelHighlight] = useState(0);

  // Slide animation state
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const soInputRef = useRef<HTMLInputElement>(null);
  const orderListRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const justDoneIdRef = useRef<number | null>(null);
  const panelActionRef = useRef<{
    toggleFound: (found: boolean) => void;
    selectReason: (index: number) => void;
    save: () => void;
  } | null>(null);

  const currentOrder = queue[currentIndex] ?? null;
  const pendingCount = queue.filter((o) => o.status === "pending").length;
  const punchedCount = queue.filter((o) => o.status === "punched").length;
  const totalCount = queue.length;

  // ── Reset state when order changes ───────────────────────────────────────────
  useEffect(() => {
    setSoInput(currentOrder?.soNumber || "");
    setCodeCopied(false);
    setSkuCopied(false);
    setReplyCopied(false);
    setActiveLineId(null);
    setPanelHighlight(0);
    // Build initial line statuses from order data
    const initialStatuses: Record<number, LineStatus> = {};
    if (currentOrder) {
      for (const line of currentOrder.lines) {
        if (line.lineStatus) {
          initialStatuses[line.id] = line.lineStatus;
        }
      }
    }
    setLineStatuses(initialStatuses);
  }, [currentOrder?.id, currentOrder?.soNumber]);

  // ── Blur SO input when entering grace period ─────────────────────────────────
  useEffect(() => {
    if (justDoneId !== null) {
      soInputRef.current?.blur();
    }
  }, [justDoneId]);

  // ── Grace period timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (justDoneId === null) return;
    setGraceCountdown(8);
    const interval = setInterval(() => {
      setGraceCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          justDoneIdRef.current = null;
          setJustDoneId(null);
          advanceToNextPending();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justDoneId]);

  // ── Re-pin currentIndex when queue re-sorts during grace period ──────────
  useEffect(() => {
    if (justDoneIdRef.current === null) return;
    const doneId = justDoneIdRef.current;
    const newIdx = queue.findIndex((o) => o.id === doneId);
    if (newIdx !== -1 && newIdx !== currentIndex) {
      setCurrentIndex(newIdx);
    }
  }, [queue, currentIndex]);

  // ── Close order list on outside click ────────────────────────────────────────
  useEffect(() => {
    if (!showOrderList) return;
    function handleClick(e: MouseEvent) {
      if (orderListRef.current && !orderListRef.current.contains(e.target as Node)) {
        setShowOrderList(false);
        setOrderListHighlight(-1);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showOrderList]);

  // ── Animated navigation ──────────────────────────────────────────────────────
  const animateToIndex = useCallback((newIndex: number, direction: "left" | "right") => {
    if (newIndex < 0 || newIndex >= queue.length || isAnimating) return;
    setSlideDirection(direction);
    setIsAnimating(true);

    setTimeout(() => {
      setCurrentIndex(newIndex);
      setShowOrderList(false);
      justDoneIdRef.current = null;
      setJustDoneId(null);

      requestAnimationFrame(() => {
        setSlideDirection(null);
        setIsAnimating(false);
      });
    }, 150);
  }, [queue.length, isAnimating]);

  // ── Navigation helpers ───────────────────────────────────────────────────────
  const goTo = useCallback((index: number) => {
    if (index >= 0 && index < queue.length && index !== currentIndex) {
      const direction = index > currentIndex ? "left" : "right";
      animateToIndex(index, direction);
    }
  }, [queue.length, currentIndex, animateToIndex]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) animateToIndex(currentIndex - 1, "right");
  }, [currentIndex, animateToIndex]);

  const goNext = useCallback(() => {
    if (currentIndex < queue.length - 1) animateToIndex(currentIndex + 1, "left");
  }, [currentIndex, queue.length, animateToIndex]);

  const advanceToNextPending = useCallback(() => {
    // First try: next pending after current position
    const nextIdx = queue.findIndex(
      (o, i) => i > currentIndex && o.status === "pending"
    );
    if (nextIdx !== -1) {
      animateToIndex(nextIdx, "left");
      return;
    }
    // Second try: first pending in entire queue
    const firstPending = queue.findIndex((o) => o.status === "pending");
    if (firstPending !== -1) {
      animateToIndex(firstPending, firstPending > currentIndex ? "left" : "right");
      return;
    }
    // No pending left — stay (slot complete will handle)
  }, [queue, currentIndex, animateToIndex]);

  const jumpToNextUnmatched = useCallback(() => {
    const nextIdx = queue.findIndex(
      (o, i) => i > currentIndex && o.status === "pending" && o.matchedLines < o.totalLines,
    );
    if (nextIdx !== -1) goTo(nextIdx);
  }, [queue, currentIndex, goTo]);

  // ── Action handlers ──────────────────────────────────────────────────────────
  const handleSaveLineStatus = useCallback(async (
    lineId: number,
    status: { found: boolean; reason?: string; altSkuCode?: string; altSkuDescription?: string; note?: string },
  ) => {
    setLineStatuses(prev => ({
      ...prev,
      [lineId]: {
        found: status.found,
        reason: status.reason ?? null,
        altSkuCode: status.altSkuCode ?? null,
        altSkuDescription: status.altSkuDescription ?? null,
        note: status.note ?? null,
      },
    }));
    setActiveLineId(null);
    try {
      await saveLineStatus(lineId, status);
    } catch {
      setLineStatuses(prev => {
        const next = { ...prev };
        delete next[lineId];
        return next;
      });
    }
  }, []);

  const handleQuickToggle = useCallback(async (lineId: number) => {
    const current = lineStatuses[lineId];
    const newFound = current ? !current.found : false;

    setLineStatuses(prev => ({
      ...prev,
      [lineId]: {
        found: newFound,
        reason: newFound ? null : (current?.reason ?? "out_of_stock"),
        altSkuCode: newFound ? null : (current?.altSkuCode ?? null),
        altSkuDescription: newFound ? null : (current?.altSkuDescription ?? null),
        note: newFound ? null : (current?.note ?? null),
      },
    }));

    try {
      await saveLineStatus(lineId, {
        found: newFound,
        reason: newFound ? undefined : (current?.reason ?? "out_of_stock"),
        altSkuCode: newFound ? undefined : (current?.altSkuCode ?? undefined),
        altSkuDescription: newFound ? undefined : (current?.altSkuDescription ?? undefined),
        note: newFound ? undefined : (current?.note ?? undefined),
      });
    } catch {
      setLineStatuses(prev => {
        if (current) return { ...prev, [lineId]: current };
        const next = { ...prev };
        delete next[lineId];
        return next;
      });
    }
  }, [lineStatuses]);

  const handleCopyCode = useCallback(() => {
    if (!currentOrder?.customerCode) return;
    navigator.clipboard.writeText(currentOrder.customerCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
  }, [currentOrder]);

  const handleCopySkus = useCallback(() => {
    if (!currentOrder) return;
    const matched = currentOrder.lines.filter((l) => {
      if (l.matchStatus !== "matched" || !l.skuCode) return false;
      const s = lineStatuses[l.id];
      if (s && !s.found) return false;
      return true;
    });
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
  }, [currentOrder, batchStates, onCopy, onAdvanceBatch, lineStatuses]);

  const handleSoSubmit = useCallback(async () => {
    if (!currentOrder || !soInput.trim()) return;
    soInputRef.current?.blur();
    const success = await onSaveSoNumber(currentOrder.id, soInput.trim());
    if (success) {
      justDoneIdRef.current = currentOrder.id;
      setJustDoneId(currentOrder.id);
    }
  }, [currentOrder, soInput, onSaveSoNumber]);

  const handleReplyAndNext = useCallback(() => {
    if (!currentOrder) return;
    const name = currentOrder.customerName
      ? smartTitleCase(currentOrder.customerName)
      : cleanSubject(currentOrder.subject);
    const code = currentOrder.customerCode || "—";
    const area = currentOrder.customerArea ? smartTitleCase(currentOrder.customerArea) : "—";
    const soNum = currentOrder.soNumber || "—";
    const notFoundLines = currentOrder.lines.filter(l => {
      const s = lineStatuses[l.id];
      return s && !s.found;
    });
    const foundCount = currentOrder.lines.length - notFoundLines.length;

    const templateLines = [
      `Customer : ${name}`,
      `Code     : ${code}`,
      `Area     : ${area}`,
      notFoundLines.length > 0
        ? `SO No.   : ${soNum} (${foundCount} of ${currentOrder.totalLines} lines)`
        : `SO No.   : ${soNum}`,
    ];

    if (notFoundLines.length > 0) {
      templateLines.push("", "Not available:");
      for (const l of notFoundLines) {
        templateLines.push(`- ${l.rawText} \u00d7 ${l.quantity}`);
        const s = lineStatuses[l.id];
        if (s?.reason) {
          const label = LINE_STATUS_REASONS.find(r => r.value === s.reason)?.label ?? s.reason;
          templateLines.push(`  Reason: ${label}`);
        }
        if (s?.altSkuCode) {
          templateLines.push(`  Alt: ${s.altSkuCode}${s.altSkuDescription ? ` ${s.altSkuDescription}` : ""}`);
        }
        if (s?.note) {
          templateLines.push(`  Note: ${s.note}`);
        }
      }
    }

    templateLines.push("", "Thanks & Regards", "JSW Dulux Ltd");
    navigator.clipboard.writeText(templateLines.join("\n"));
    setReplyCopied(true);
    setTimeout(() => setReplyCopied(false), 1500);

    if (justDoneId !== null) {
      justDoneIdRef.current = null;
      setJustDoneId(null);
      advanceToNextPending();
    }
  }, [currentOrder, justDoneId, advanceToNextPending, lineStatuses]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      const isInInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      // ── SKU panel open: panel-specific shortcuts only ─────────────
      if (activeLineId !== null) {
        if (e.key === "Escape") {
          e.preventDefault();
          if (activeLineId > 0) {
            const idx = currentOrder?.lines.findIndex(l => l.id === activeLineId) ?? -1;
            if (idx >= 0) setPanelHighlight(idx);
            setActiveLineId(-1);
          } else {
            setActiveLineId(null);
          }
          return;
        }

        if (isInInput) return;

        if (activeLineId === -1) {
          const lines = currentOrder?.lines ?? [];
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setPanelHighlight(p => Math.max(0, p - 1));
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setPanelHighlight(p => Math.min(lines.length - 1, p + 1));
            return;
          }
          if (e.key === "-" || e.key === "0") {
            e.preventDefault();
            const line = lines[panelHighlight];
            if (line) {
              const s = lineStatuses[line.id];
              if (!s || s.found) handleQuickToggle(line.id);
            }
            return;
          }
          if (e.key === "+" || e.key === "=") {
            e.preventDefault();
            const line = lines[panelHighlight];
            if (line) {
              const s = lineStatuses[line.id];
              if (s && !s.found) handleQuickToggle(line.id);
            }
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            const line = lines[panelHighlight];
            if (line) setActiveLineId(line.id);
            return;
          }
        } else {
          const ref = panelActionRef.current;
          if (!ref) { return; }

          if (e.key === "-" || e.key === "0") {
            e.preventDefault();
            ref.toggleFound(false);
            return;
          }
          if (e.key === "+" || e.key === "=") {
            e.preventDefault();
            ref.toggleFound(true);
            return;
          }
          if (e.key >= "1" && e.key <= "5") {
            e.preventDefault();
            ref.selectReason(parseInt(e.key) - 1);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            ref.save();
            return;
          }
        }
        return;
      }

      // ── Order list open: own keyboard mode ────────────────────────
      if (showOrderList) {
        if (e.key === "Escape") { e.preventDefault(); setShowOrderList(false); setOrderListHighlight(-1); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); setOrderListHighlight((p) => Math.min(p + 1, queue.length - 1)); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); setOrderListHighlight((p) => Math.max(p - 1, 0)); return; }
        if (e.key === "Enter" && orderListHighlight >= 0) { e.preventDefault(); goTo(orderListHighlight); setShowOrderList(false); setOrderListHighlight(-1); return; }
        if (e.key === "l" || e.key === "L") { e.preventDefault(); setShowOrderList(false); setOrderListHighlight(-1); return; }
        return;
      }

      // ── SO input active ───────────────────────────────────────────
      if (isInInput) {
        if (e.key === "Enter" && soInput.trim()) { e.preventDefault(); handleSoSubmit(); return; }
        if (e.key === "Escape") { e.preventDefault(); (document.activeElement as HTMLElement)?.blur(); return; }
        return;
      }

      // ── Card-level shortcuts (nothing focused) ────────────────────
      if (isAnimating) return;

      const key = e.key;
      if (key === "ArrowLeft" || key === "ArrowUp") { e.preventDefault(); goPrev(); return; }
      if (key === "ArrowRight" || key === "ArrowDown") { e.preventDefault(); goNext(); return; }
      if (key === "q" || key === "Q") { handleCopyCode(); return; }
      if (key === "w" || key === "W") { handleCopySkus(); return; }
      if (key === "e" || key === "E") { e.preventDefault(); soInputRef.current?.focus(); return; }
      if (key === "r" || key === "R") { handleReplyAndNext(); return; }
      if ((key === "f" || key === "F") && currentOrder) { onFlag(currentOrder.id); return; }
      if (key === "n" || key === "N") { jumpToNextUnmatched(); return; }
      if (key === "s" || key === "S") { setActiveLineId(-1); return; }
      if (key === "l" || key === "L") { e.preventDefault(); setShowOrderList(true); setOrderListHighlight(currentIndex); return; }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    showOrderList, orderListHighlight, soInput, currentOrder, currentIndex, isAnimating, activeLineId, panelHighlight,
    goPrev, goNext, handleCopyCode, handleCopySkus, handleSoSubmit,
    handleReplyAndNext, onFlag, jumpToNextUnmatched, goTo, queue.length, lineStatuses, handleQuickToggle,
  ]);

  // ── Scroll order list highlight into view ────────────────────────────────────
  useEffect(() => {
    if (!showOrderList || orderListHighlight < 0) return;
    const el = orderListRef.current?.querySelector(`[data-ol-idx="${orderListHighlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [showOrderList, orderListHighlight]);

  // ── Scroll panel highlight into view ────────────────────────────────────────
  useEffect(() => {
    if (activeLineId !== -1) return;
    const el = document.querySelector(`[data-panel-idx="${panelHighlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeLineId, panelHighlight]);

  // ── Derived state ────────────────────────────────────────────────────────────
  const isSlotComplete = totalCount > 0 && pendingCount === 0 && justDoneId === null;
  const isJustDone = currentOrder?.id === justDoneId;
  const isFlagged = currentOrder ? flaggedIds.has(currentOrder.id) : false;
  const isPunched = currentOrder?.status === "punched" && !isJustDone;

  // ── Slide animation style ────────────────────────────────────────────────────
  const slideStyle: React.CSSProperties = {
    transition: "transform 150ms ease-out, opacity 150ms ease-out",
    transform: slideDirection === "left"
      ? "translateX(-40px)"
      : slideDirection === "right"
      ? "translateX(40px)"
      : "translateX(0)",
    opacity: slideDirection ? 0.3 : 1,
  };

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
            <div className="h-[3px] bg-green-500" />
            <div className="px-4 py-6 text-center">
              <div className="w-12 h-12 rounded-full bg-green-50 mx-auto mb-3 flex items-center justify-center">
                <Check size={24} className="text-green-600" />
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">{slotName} complete</h2>
              <p className="text-xs text-gray-500">
                {totalCount} orders · {soGroups.size} SOs · {formatVolume(totalVol)}
              </p>
            </div>
            <div className="border-t border-gray-200">
              {Array.from(soGroups.entries()).map(([soName, soOrders]) => (
                <div key={soName} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 last:border-b-0">
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
            <div className="flex gap-2 p-4 border-t border-gray-200">
              <button onClick={handleCopyAllSOs} className="flex-1 py-2.5 rounded-md bg-gray-100 text-gray-700 text-xs font-semibold hover:bg-gray-200 transition-colors">
                Copy all SO nos.
              </button>
              {nextSlot && (
                <button className="flex-1 py-2.5 rounded-md bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition-colors">
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
  const displayName = getOrderDisplayName(order);
  const dotColor = getDeliveryDotColor(order.customerDeliveryType);
  const dotTitle = getDeliveryDotTitle(order.customerDeliveryType);
  const totalVol = getOrderVolume(order.lines);
  const volStr = formatVolume(totalVol);
  const badges = getSignalBadges(order);
  const hasCode = order.customerMatchStatus === "exact" && order.customerCode;
  const matchedCount = order.lines.filter((l) => l.matchStatus === "matched" && l.skuCode).length;
  const notFoundCount = order.lines.filter(l => {
    const s = lineStatuses[l.id];
    return s && !s.found;
  }).length;

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
      <div className="max-w-2xl mx-auto">

        {/* ── Progress strip ────────────────────────────────────────────── */}
        <div className="mb-3">
          <div className="flex items-center gap-2.5 text-[11px] text-gray-500 mb-2">
            <span className="font-medium whitespace-nowrap">{currentIndex + 1}/{totalCount}</span>
            <div className="flex-1 h-1.5 bg-gray-200 rounded-full relative">
              {/* Green fill = punched progress */}
              <div
                className="absolute inset-y-0 left-0 bg-green-400 rounded-full transition-all duration-300"
                style={{ width: `${totalCount > 0 ? (punchedCount / totalCount) * 100 : 0}%` }}
              />
              {/* Teal dot = current position */}
              {totalCount > 0 && (
                <div
                  className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-teal-500 ring-2 ring-white transition-all duration-300"
                  style={{
                    left: `clamp(5px, ${totalCount > 1 ? (currentIndex / (totalCount - 1)) * 100 : 0}%, calc(100% - 5px))`,
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              )}
            </div>
            <span className="text-[10px] text-gray-400 whitespace-nowrap">{punchedCount} done</span>
            <div className="relative" ref={orderListRef}>
              <button
                onClick={() => { setShowOrderList((p) => !p); setOrderListHighlight(currentIndex); }}
                className="flex items-center gap-1 px-2 py-1 border border-gray-200 rounded text-[10px] text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <List size={11} />
                <span className="hidden sm:inline">List</span>
                <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded bg-gray-100 text-[8px] font-bold text-gray-400">L</span>
              </button>

              {showOrderList && (
                <div className="absolute top-full right-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-72 overflow-y-auto">
                  {queue.map((o, idx) => {
                    const isDone = o.status === "punched";
                    const isItemFlagged = flaggedIds.has(o.id);
                    const isHighlighted = idx === orderListHighlight;
                    const isCurrent = idx === currentIndex;
                    return (
                      <button
                        key={o.id}
                        data-ol-idx={idx}
                        onClick={() => { goTo(idx); setShowOrderList(false); setOrderListHighlight(-1); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left border-b border-gray-50 last:border-b-0 transition-colors ${
                          isHighlighted ? "bg-teal-50" : isCurrent ? "bg-gray-50" : "hover:bg-gray-50"
                        }`}
                      >
                        <span className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${
                          isDone ? "bg-green-500" : isItemFlagged ? "bg-amber-400" : "bg-gray-300"
                        }`} />
                        <span className="flex-1 text-[11px] font-medium text-gray-700 truncate">
                          {getOrderDisplayName(o)}
                        </span>
                        {o.soNumber && (
                          <span className="text-[10px] text-gray-400 font-mono">{o.soNumber}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Card with slide animation ──────────────────────────────────── */}
        <div ref={cardRef} style={slideStyle}>
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
                <h2 className="text-xl font-bold text-gray-900 leading-tight truncate" title={displayName}>
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
                  <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px] font-mono">{order.customerCode}</span>
                )}
                {order.customerArea && (
                  <><span className="text-gray-300">·</span><span className="text-gray-500">{smartTitleCase(order.customerArea)}</span></>
                )}
                {order.customerDeliveryType && (
                  <><span className="text-gray-300">·</span><span className="text-gray-500">{getDeliveryDotTitle(order.customerDeliveryType)}</span></>
                )}
                {volStr && (
                  <><span className="text-gray-300">·</span><span className="text-gray-500">{volStr}</span></>
                )}
                <span className="text-gray-300">·</span>
                <span className="text-gray-500">{order.totalLines} lines</span>
                {isPunched && order.soNumber && (
                  <><span className="text-gray-300">·</span><span className="font-mono text-teal-700 font-semibold">SO {order.soNumber}</span></>
                )}
              </div>

              {/* Signal badges */}
              {badges.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {badges.map((b, i) => (
                    <span key={i} className={`text-[9px] font-medium px-1.5 py-0.5 rounded border ${BADGE_STYLES[b.type]}`}>
                      {b.label}
                    </span>
                  ))}
                </div>
              )}

              {/* ── Just done state ────────────────────────────────────── */}
              {isJustDone ? (
                <div>
                  <button
                    onClick={handleReplyAndNext}
                    className="w-full py-2.5 rounded-md bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-white/20 text-[10px] font-bold">R</span>
                    {replyCopied ? "Copied! Going next…" : "Copy reply & go next"}
                  </button>
                  <div className="text-center mt-2 text-xs text-teal-700 font-medium flex items-center justify-center gap-2">
                    Next order in {graceCountdown}s
                    <button
                      onClick={() => { justDoneIdRef.current = null; setJustDoneId(null); advanceToNextPending(); }}
                      className="text-teal-600 font-semibold underline hover:text-teal-800"
                    >
                      Go now →
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* ── Copy buttons ────────────────────────────────────── */}
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
                      }`}>Q</span>
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
                      }`}>W</span>
                      {skuCopied ? "Copied!" : "Copy SKUs"}
                    </button>
                  </div>

                  {/* ── SO Number input ─────────────────────────────────── */}
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

                  {/* ── Action button ───────────────────────────────────── */}
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

              {/* ── SKU summary row ───────────────────────────────────── */}
              <button
                type="button"
                onClick={() => setActiveLineId(-1)}
                className="w-full flex items-center justify-between py-3 mt-3 border-t border-gray-100"
              >
                <div className="flex items-center gap-2">
                  {notFoundCount > 0 ? (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#f59e0b" strokeWidth="2"><path d="M8 2 L14 13 H2Z"/></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#22c55e" strokeWidth="2.5"><polyline points="3 8 6.5 11.5 13 5"/></svg>
                  )}
                  <span className="text-xs text-gray-600 font-medium">
                    {order.totalLines} SKU lines
                  </span>
                  {notFoundCount > 0 && (
                    <>
                      <span className="text-gray-300">{"\u00b7"}</span>
                      <span className="text-xs text-red-500 font-medium">
                        {notFoundCount} not found
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] px-1.5 py-0.5 border border-gray-200 rounded text-gray-500 font-semibold">
                    S
                  </span>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#d1d5db" strokeWidth="2">
                    <polyline points="6 4 10 8 6 12"/>
                  </svg>
                </div>
              </button>
            </div>
          </div>
        </div>

      </div>

      {/* ── Nav bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-4 py-4 max-w-2xl mx-auto">
        <button
          onClick={goPrev}
          disabled={currentIndex === 0}
          className={`text-xs font-medium px-3.5 py-2 rounded-lg border transition-colors ${
            currentIndex === 0
              ? "text-gray-300 border-gray-100 cursor-default"
              : "text-gray-600 border-gray-200 bg-white hover:bg-gray-50"
          }`}
        >
          {"\u2190"} Prev
        </button>
        <span className="text-xs text-gray-400 font-medium">
          {currentIndex + 1} of {totalCount}
        </span>
        <button
          onClick={goNext}
          disabled={currentIndex >= totalCount - 1}
          className={`text-xs font-medium px-3.5 py-2 rounded-lg border transition-colors ${
            currentIndex >= totalCount - 1
              ? "text-gray-300 border-gray-100 cursor-default"
              : "text-gray-600 border-gray-200 bg-white hover:bg-gray-50"
          }`}
        >
          Next {"\u2192"}
        </button>
      </div>

      {/* ── SKU Lines list panel (activeLineId === -1) ──────────────── */}
      {activeLineId === -1 && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/10" onClick={() => setActiveLineId(null)} />
          <div className="w-[360px] bg-white border-l border-gray-200 h-full overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">
                  SKU lines ({order.lines.length})
                </p>
                <button
                  onClick={() => setActiveLineId(null)}
                  className="w-6 h-6 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center text-sm"
                >
                  {"\u00d7"}
                </button>
              </div>

              {order.lines.map((line, idx) => {
                const status = lineStatuses[line.id];
                const isNF = status && !status.found;
                const reasonObj = isNF && status.reason
                  ? LINE_STATUS_REASONS.find(r => r.value === status.reason)
                  : null;

                return (
                  <div
                    key={line.id}
                    data-panel-idx={idx}
                    className={`flex items-center gap-2 py-2.5 px-2 rounded-lg mb-1 cursor-pointer transition-colors ${
                      idx === panelHighlight
                        ? "bg-teal-50 ring-1 ring-teal-200"
                        : isNF ? "bg-red-50 hover:bg-red-100" : "hover:bg-gray-50"
                    }`}
                  >
                    {/* Toggle */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleQuickToggle(line.id); }}
                      className={`w-7 h-4 rounded-full relative flex-shrink-0 transition-colors ${
                        isNF ? "bg-red-500" : "bg-green-500"
                      }`}
                    >
                      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                        isNF ? "left-0.5" : "left-[14px]"
                      }`} />
                    </button>

                    {/* Info */}
                    <div
                      className="flex-1 min-w-0"
                      onClick={() => setActiveLineId(line.id)}
                    >
                      <p className={`text-xs font-medium truncate ${
                        isNF ? "line-through text-gray-400" : "text-gray-800"
                      }`}>
                        {line.rawText}
                      </p>
                      <div className="flex items-center gap-1 mt-0.5 text-[10px] text-gray-400 flex-wrap">
                        {line.skuCode ? (
                          <span className={`font-mono ${isNF ? "line-through" : ""}`}>{line.skuCode}</span>
                        ) : (
                          <span className="text-amber-500 text-[9px] font-medium">unmatched</span>
                        )}
                        {line.packCode && (
                          <><span className="text-gray-300">{"\u00b7"}</span><span>{line.packCode}</span></>
                        )}
                        <span className="text-gray-300">{"\u00b7"}</span>
                        <span>{"\u00d7"}{line.quantity}</span>
                        {reasonObj && (
                          <><span className="text-gray-300">{"\u00b7"}</span>
                          <span className="text-[8px] font-semibold px-1 py-px rounded bg-red-50 text-red-700 border border-red-200">{reasonObj.label}</span></>
                        )}
                        {isNF && status?.altSkuCode && (
                          <span className="text-[8px] font-semibold px-1 py-px rounded bg-teal-50 text-teal-700 border border-teal-200">ALT</span>
                        )}
                      </div>
                    </div>

                    {/* Arrow to detail */}
                    <svg
                      onClick={() => setActiveLineId(line.id)}
                      className="text-gray-300 flex-shrink-0 cursor-pointer hover:text-gray-500"
                      width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
                    >
                      <polyline points="6 4 10 8 6 12"/>
                    </svg>
                  </div>
                );
              })}

              {/* Summary */}
              <div className="flex items-center justify-between py-2 mt-2 border-t border-gray-100 text-[11px]">
                <span className="text-gray-500">Lines</span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-green-600">
                    {order.lines.length - notFoundCount} found
                  </span>
                  {notFoundCount > 0 && (
                    <span className="font-semibold text-red-600">
                      {notFoundCount} not found
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Line detail panel (activeLineId > 0) ───────────────────── */}
      {activeLineId !== null && activeLineId > 0 && (() => {
        const activeLine = order.lines.find(l => l.id === activeLineId);
        if (!activeLine) return null;
        const lineWithStatus = {
          ...activeLine,
          lineStatus: lineStatuses[activeLineId] ?? activeLine.lineStatus ?? null,
        };
        return (
          <LineStatusPanel
            line={lineWithStatus}
            onSave={handleSaveLineStatus}
            onCancel={() => setActiveLineId(-1)}
            actionRef={panelActionRef}
          />
        );
      })()}
    </div>
  );
}
