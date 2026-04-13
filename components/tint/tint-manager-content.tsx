"use client";

import { useState, useEffect, useCallback, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  Loader2,
  AlertCircle, Layers,
  Eye, Plus, MoreHorizontal, UserPlus, RefreshCw, X, Scissors,
  Truck, Search, ChevronDown, ChevronUp, LayoutGrid, Table as TableIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/status-badge";
import { ObdCode } from "@/components/shared/obd-code";
import { SplitBuilderModal } from "@/components/tint/split-builder-modal";
import type { SplitBuilderModalProps } from "@/components/tint/split-builder-modal";
import { TintTableView } from "@/components/tint/tint-table-view";
import { CustomerMissingSheet } from "@/components/shared/customer-missing-sheet";
import { OrderDetailPanel } from "@/components/shared/order-detail-panel";
import { UniversalHeader } from "@/components/universal-header";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TintAssignmentInfo {
  id:          number;
  status:      string;
  assignedTo:  { id: number; name: string | null };
  startedAt:   string | null;
  completedAt: string | null;
  updatedAt:   string;
}

export interface TintOrder {
  id:                 number;
  obdNumber:          string;
  workflowStage:      string;
  dispatchSlot:       string | null;
  dispatchStatus:     string | null;
  priorityLevel:      number;
  sequenceOrder:      number | null;
  createdAt:          string;
  shipToCustomerName: string | null;
  shipToCustomerId:   string | null;
  customerMissing:    boolean;
  smu:                string | null;
  obdEmailDate:       string | null;
  obdEmailTime:       string | null;
  orderDateTime:      string | null;
  slotId:             number | null;
  slotName:           string | null;
  slotTime:           string | null;
  slotIsNextDay:      boolean;
  originalSlotId:     number | null;
  originalSlotName:   string | null;
  deliveryTypeName:   string | null;
  customer: {
    customerName:       string;
    area:               { name: string };
    salesOfficerGroup:  {
      salesOfficer: { name: string };
    } | null;
  } | null;
  querySnapshot: {
    totalVolume: number;
    totalLines:  number;
    articleTag:  string | null;
  } | null;
  tintAssignments: TintAssignmentInfo[];
  lineItems: {
    id:                number;
    lineId:            number;
    skuCodeRaw:        string;
    skuDescriptionRaw: string | null;
    unitQty:           number;
    volumeLine:        number | null;
    isTinting:         boolean;
    article:           number | null;
    articleTag:        string | null;
  }[];
  remainingQty?: number;
  existingSplits?: {
    rawLineItemId: number;
    assignedQty:   number;
  }[];
  splits?: {
    id:             number;
    splitNumber:    number;
    totalQty:       number;
    status:         string;
    articleTag:     string | null;
    dispatchStatus: string | null;
    createdAt:      string;
    assignedTo:     { name: string };
    lineItems: {
      rawLineItemId: number;
      assignedQty:   number;
      rawLineItem: {
        skuCodeRaw:        string;
        skuDescriptionRaw: string | null;
      };
    }[];
  }[];
}

export interface SplitCard {
  id:             number;
  splitNumber:    number;
  status:         string;
  dispatchStatus: string | null;
  priorityLevel:  number | null;
  sequenceOrder:  number | null;
  totalQty:       number;
  totalVolume:    number | null;
  articleTag:     string | null;
  createdAt:      string;
  startedAt:      string | null;
  completedAt:    string | null;
  smu:              string | null;
  obdEmailDate:     string | null;
  obdEmailTime:     string | null;
  orderDateTime:    string | null;
  slotId:           number | null;
  slotName:         string | null;
  slotTime:         string | null;
  slotIsNextDay:    boolean;
  originalSlotId:   number | null;
  originalSlotName: string | null;
  deliveryTypeName: string | null;
  assignedTo:     { id: number; name: string | null };
  lineItems: {
    rawLineItemId: number;
    assignedQty:   number;
    rawLineItem: {
      skuCodeRaw:        string;
      skuDescriptionRaw: string | null;
      volumeLine:        number | null;
      isTinting:         boolean;
    };
  }[];
  order: {
    id:       number;
    obdNumber: string;
    customer: {
      customerName:       string;
      salesOfficerGroup:  {
        salesOfficer: { name: string };
      } | null;
    } | null;
  };
}

export interface CompletedAssignment {
  id:               number;
  completedAt:      string | null;
  smu:              string | null;
  obdEmailDate:     string | null;
  obdEmailTime:     string | null;
  orderDateTime:    string | null;
  slotId:           number | null;
  slotName:         string | null;
  slotTime:         string | null;
  slotIsNextDay:    boolean;
  originalSlotId:   number | null;
  originalSlotName: string | null;
  deliveryTypeName: string | null;
  assignedTo:  { id: number; name: string | null };
  order: {
    id:                 number;
    obdNumber:          string;
    shipToCustomerName: string | null;
    customer: {
      customerName:      string;
      area:              { name: string };
      salesOfficerGroup: { salesOfficer: { name: string } } | null;
    } | null;
    querySnapshot: {
      totalVolume:  number;
      totalLines:   number;
      articleTag:   string | null;
    } | null;
  };
}

interface Operator {
  id:   number;
  name: string | null;
}

interface SlotSummaryItem {
  id:               number;
  name:             string;
  slotTime:         string;
  isNextDay:        boolean;
  sortOrder:        number;
  tintPendingCount: number;
}

type ColItem =
  | { type: "order"; data: TintOrder }
  | { type: "split"; data: SplitCard };

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatNow(d: Date): string {
  const DAYS   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let h = d.getHours();
  const m    = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} · ${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

function isSlotClosed(slotTime: string, isNextDay: boolean): boolean {
  if (isNextDay) return false;
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const [h, m] = slotTime.split(":").map(Number);
  const slotMinutes = (h ?? 0) * 60 + (m ?? 0) + 15; // 15-min grace
  const nowMinutes = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();
  return nowMinutes > slotMinutes;
}

function formatObdDateTime(date: string | null, time: string | null): string {
  if (!date) return "";
  const d = new Date(date);
  const dateStr = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return time ? `${dateStr} ${time}` : dateStr;
}

function formatOrderDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "Asia/Kolkata"
  });
  const timeStr = d.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata"
  });
  return `${dateStr} ${timeStr}`;
}

function buildTs(date: string | null, time: string | null): number {
  const dateStr = date ?? "1970-01-01";
  const parts = (time ?? "00:00").split(":");
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  const ts = new Date(dateStr);
  ts.setHours(h, m, 0, 0);
  return ts.getTime();
}

function formatVolume(v: number): string {
  if (!v) return "— L";
  const n = Math.round(v);
  return `${n >= 1000 ? n.toLocaleString("en-US") : n} L`;
}

// ── Dispatch / Priority badge helpers ─────────────────────────────────────────

function DispatchStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const map: Record<string, { label: string; className: string }> = {
    dispatch:                   { label: "Dispatch",  className: "bg-green-50 border-green-200 text-green-700" },
    hold:                       { label: "Hold",      className: "bg-red-50 border-red-200 text-red-700" },
    waiting_for_confirmation:   { label: "Waiting",   className: "bg-amber-50 border-amber-200 text-amber-700" },
  };
  const cfg = map[status];
  if (!cfg) return null;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border",
      cfg.className,
    )}>
      <Truck size={9} />
      {cfg.label}
    </span>
  );
}


// ── Status Popover (portal — fixed position, no overflow clipping) ────────────

interface StatusPopoverProps {
  position:        { top: number; right: number };
  anchorRef:       RefObject<HTMLButtonElement>;
  currentDispatch: string | null;
  currentPriority: "normal" | "urgent";
  onSave:          (dispatch: string | null, priority: "normal" | "urgent") => Promise<void>;
  onClose:         () => void;
  isSaving:        boolean;
}

function StatusPopover({
  position,
  anchorRef,
  currentDispatch,
  currentPriority,
  onSave,
  onClose,
  isSaving,
}: StatusPopoverProps) {
  const [dispatch, setDispatch] = useState<string | null>(currentDispatch);
  const [priority, setPriority] = useState<"normal" | "urgent">(currentPriority);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click — excludes both the popover itself and the anchor button
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current  && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    // Small delay so the button click that opened this doesn't immediately close it
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleOutside);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleOutside);
    };
  }, [onClose, anchorRef]);

  const hasChanges = dispatch !== currentDispatch || priority !== currentPriority;

  const content = (
    <div
      ref={popoverRef}
      style={{ position: "fixed", top: position.top, right: position.right, zIndex: 9999 }}
      className="bg-white border border-gray-200 rounded-xl shadow-lg p-3.5 w-[210px]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <p className="text-[10px] font-extrabold uppercase tracking-[.6px] text-gray-400 mb-3">
        Set Status
      </p>

      {/* Priority */}
      <p className="text-[10px] font-bold uppercase tracking-[.4px] text-gray-400 mb-1.5">
        Priority
      </p>
      <div className="flex gap-1.5 mb-3">
        {(["normal", "urgent"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPriority(p)}
            className={cn(
              "flex-1 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors",
              priority === p
                ? p === "urgent"
                  ? "bg-red-50 border-red-300 text-red-700"
                  : "bg-gray-50 border-gray-300 text-gray-700"
                : "bg-white border-gray-300 text-gray-400 hover:bg-gray-50",
            )}
          >
            {p === "urgent" ? "🚨 Urgent" : "Normal"}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="border-t border-gray-100 mb-3" />

      {/* Dispatch status — compact horizontal toggle */}
      <p className="text-[10px] font-bold uppercase tracking-[.4px] text-gray-400 mb-1.5">
        Dispatch Status
      </p>
      <div className="flex gap-1 p-0.5 bg-gray-50 border border-gray-200 rounded-lg mb-3">
        {([
          { value: "dispatch",                 label: "Dispatch", activeClass: "bg-green-50 border border-green-200 text-green-700" },
          { value: "hold",                     label: "Hold",     activeClass: "bg-red-50 border border-red-200 text-red-700" },
          { value: "waiting_for_confirmation", label: "Waiting",  activeClass: "bg-amber-50 border border-amber-200 text-amber-700" },
        ] as const).map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setDispatch(dispatch === opt.value ? null : opt.value)}
            className={cn(
              "flex-1 py-1.5 rounded-md text-[10.5px] font-semibold transition-colors",
              dispatch === opt.value
                ? opt.activeClass
                : "text-gray-400 hover:text-gray-600",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Save button */}
      <button
        type="button"
        disabled={!hasChanges || isSaving}
        onClick={() => { void onSave(dispatch, priority); }}
        className={cn(
          "w-full py-1.5 rounded-lg text-[11.5px] font-semibold transition-colors flex items-center justify-center gap-1.5",
          hasChanges && !isSaving
            ? "bg-teal-600 text-white hover:bg-teal-700"
            : "bg-gray-100 text-gray-400 cursor-not-allowed",
        )}
      >
        {isSaving ? <Loader2 size={12} className="animate-spin" /> : null}
        {isSaving ? "Saving…" : "Save"}
      </button>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : null;
}

// ── Column config ─────────────────────────────────────────────────────────────

const COLUMNS = [
  {
    stage:     "pending_tint_assignment",
    label:     "Pending Assignment",
    dot:       "bg-teal-500",
    pillClass: "bg-red-50 text-red-600 border border-red-200",
  },
  {
    stage:     "tint_assigned",
    label:     "Assigned",
    dot:       "bg-amber-400",
    pillClass: "bg-amber-50 text-amber-600 border border-amber-200",
  },
  {
    stage:     "tinting_in_progress",
    label:     "In Progress",
    dot:       "bg-blue-400",
    pillClass: "bg-blue-50 text-blue-600 border border-blue-200",
  },
  {
    stage:     "completed",
    label:     "Completed",
    dot:       "bg-green-400",
    pillClass: "bg-green-50 text-green-600 border border-green-200",
  },
] as const;

type ColStage = typeof COLUMNS[number]["stage"];

const CARDS_PER_PAGE = 5;

// ── Kanban card ───────────────────────────────────────────────────────────────

interface KanbanCardProps {
  order:              TintOrder;
  stage:              ColStage;
  onAssign:           () => void;
  onCreateSplit:      () => void;
  onRefresh:          () => void;
  onMoveUp:           () => void;
  onMoveDown:         () => void;
  onViewDetail:       () => void;
  onCustomerMissing?: () => void;
}

function KanbanCard({ order, stage, onAssign, onCreateSplit, onRefresh, onMoveUp, onMoveDown, onViewDetail, onCustomerMissing }: KanbanCardProps) {
  const [menuOpen,     setMenuOpen]     = useState(false);
  const [popoverOpen,  setPopoverOpen]  = useState(false);
  const [popoverPos,   setPopoverPos]   = useState<{ top: number; right: number } | null>(null);
  const [isSaving,     setIsSaving]     = useState(false);
  const menuRef        = useRef<HTMLDivElement>(null);
  const plusButtonRef  = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const assignment       = order.tintAssignments[0] ?? null;
  const customerName    = order.customer?.customerName ?? order.shipToCustomerName ?? "—";
  const areaName        = order.customer?.area.name ?? "—";
  const isUrgent        = order.priorityLevel <= 2;
  const isDone          = stage === "completed";
  const isPending       = stage === "pending_tint_assignment";
  const isAssigned      = stage === "tint_assigned";
  const isInProgress    = stage === "tinting_in_progress";
  const volume          = order.querySnapshot?.totalVolume
    ? `${order.querySnapshot.totalVolume} L`
    : "—";
  const smu             = order.smu ?? "—";
  const salesOfficerName = order.customer?.salesOfficerGroup?.salesOfficer?.name ?? "—";
  const operatorName    = assignment?.assignedTo.name ?? "—";
  const operatorInitials = operatorName === "—"
    ? "?"
    : operatorName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  const activeSplits  = (order.splits ?? []).filter((s) =>
    ["tint_assigned", "tinting_in_progress"].includes(s.status)
  );
  const assignedQty   = (order.splits ?? []).reduce((sum, s) => sum + s.totalQty, 0);
  const totalQty      = (order.lineItems ?? []).reduce((sum, l) => sum + l.unitQty, 0);
  const remainingQty  = order.remainingQty ?? (totalQty - assignedQty);
  const hasSplits     = (order.splits ?? []).length > 0 ||
                        (order.existingSplits ?? []).length > 0;

  async function handleCancelAssignment() {
    try {
      await fetch("/api/tint/manager/cancel-assignment", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderId: order.id }),
      });
      onRefresh();
    } catch (err) {
      console.error("Cancel assignment failed:", err);
    }
  }

  // ── Status popover save ───────────────────────────────────────────────────

  async function handleStatusSave(
    newDispatch: string | null,
    newPriority: "normal" | "urgent",
  ) {
    setIsSaving(true);
    try {
      const body: Record<string, string | null> = {};
      if (newDispatch !== order.dispatchStatus)            body.dispatchStatus = newDispatch;
      if ((newPriority === "urgent") !== isUrgent)         body.priority       = newPriority;
      if (Object.keys(body).length === 0) { setPopoverOpen(false); return; }

      const res = await fetch(`/api/tint/manager/orders/${order.id}/status`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save");
      setPopoverOpen(false);
      onRefresh();
    } catch (err) {
      console.error("Status save failed:", err);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
    <div
      className={cn(
        "bg-white border border-gray-200 rounded-lg overflow-hidden cursor-pointer",
        "hover:border-gray-300 transition-all duration-150",
      )}
    >
      <div className="px-3.5 pt-3 pb-3">
        {/* 1. Icons + badges */}
        <div className="mb-2">
          {/* Icon row */}
          <div className="flex items-center justify-between h-[24px]">
            {/* Left: split indicator */}
            <div className="flex items-center">
              {activeSplits.length > 0 && (
                <span className="text-[10px] font-semibold text-amber-600">
                  ✂ {activeSplits.length} · {remainingQty > 0 ? `${remainingQty} left` : "fully assigned"}
                </span>
              )}
            </div>
            {/* Right: action icons */}
            <div className="flex items-center gap-1">
            {/* Eye icon */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onViewDetail(); }}
              className="w-[26px] h-[26px] rounded-lg flex items-center justify-center text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
              title="View order details"
            >
              <Eye size={14} />
            </button>

            {/* + button — opens status popover */}
            <div className="relative">
              <button
                ref={plusButtonRef}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  if (!popoverOpen && plusButtonRef.current) {
                    const rect = plusButtonRef.current.getBoundingClientRect();
                    setPopoverPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                  }
                  setPopoverOpen((v) => !v);
                }}
                className={cn(
                  "w-[26px] h-[26px] rounded-lg flex items-center justify-center transition-colors",
                  popoverOpen
                    ? "bg-teal-600 text-white"
                    : "text-gray-400 hover:bg-gray-100",
                )}
                title="Set priority / dispatch status"
              >
                <Plus size={14} />
              </button>

              {popoverOpen && popoverPos && (
                <StatusPopover
                  position={popoverPos}
                  anchorRef={plusButtonRef}
                  currentDispatch={order.dispatchStatus ?? null}
                  currentPriority={isUrgent ? "urgent" : "normal"}
                  onSave={handleStatusSave}
                  onClose={() => setPopoverOpen(false)}
                  isSaving={isSaving}
                />
              )}
            </div>

            {/* ... button + dropdown */}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setPopoverOpen(false); setMenuOpen(!menuOpen); }}
                className="w-[26px] h-[26px] rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors"
              >
                <MoreHorizontal size={14} />
              </button>

              {menuOpen && (
                <div
                  className="absolute right-0 top-8 z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[130px] max-w-[150px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {order.workflowStage === "pending_tint_assignment" && (
                    <>
                      {!hasSplits && (
                        <>
                          <button
                            type="button"
                            onClick={() => { setMenuOpen(false); onAssign(); }}
                            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
                          >
                            <UserPlus size={12} className="text-gray-400 flex-shrink-0" />
                            Assign
                          </button>
                          <div className="mx-3 border-t border-gray-100" />
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => { setMenuOpen(false); onCreateSplit(); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
                      >
                        <Scissors size={12} className="text-gray-400 flex-shrink-0" />
                        Create Split
                      </button>
                    </>
                  )}

                  {order.workflowStage === "tint_assigned" && (
                    <>
                      <button
                        type="button"
                        onClick={() => { setMenuOpen(false); onMoveUp(); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
                      >
                        <ChevronUp size={12} className="text-gray-400 flex-shrink-0" />
                        Move Up
                      </button>
                      <button
                        type="button"
                        onClick={() => { setMenuOpen(false); onMoveDown(); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
                      >
                        <ChevronDown size={12} className="text-gray-400 flex-shrink-0" />
                        Move Down
                      </button>
                      <div className="mx-3 border-t border-gray-100" />
                      <button
                        type="button"
                        onClick={() => { setMenuOpen(false); onAssign(); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
                      >
                        <RefreshCw size={12} className="text-gray-400 flex-shrink-0" />
                        Re-assign
                      </button>
                      <div className="mx-3 border-t border-gray-100" />
                      <button
                        type="button"
                        onClick={() => { setMenuOpen(false); void handleCancelAssignment(); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-red-600 hover:bg-red-50 transition-colors whitespace-nowrap"
                      >
                        <X size={12} className="text-red-400 flex-shrink-0" />
                        Cancel
                      </button>
                    </>
                  )}

                  {(order.workflowStage === "tinting_in_progress" ||
                    order.workflowStage === "pending_support") && (
                    <div className="px-3.5 py-2.5 text-[11.5px] text-gray-400 italic">
                      No actions available
                    </div>
                  )}
                </div>
              )}
            </div>
            </div>{/* end right icons */}
          </div>
          {/* Badge row */}
          <div className="flex items-center gap-1.5 flex-wrap min-h-[22px]">
            {isDone ? (
              <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-200 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                ✓ Done
              </span>
            ) : isUrgent ? (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full border bg-red-50 border-red-200 text-red-600">
                🚨 Urgent
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full border bg-gray-50 border-gray-200 text-gray-500">
                ● Normal
              </span>
            )}
            <DispatchStatusBadge status={order.dispatchStatus ?? null} />
          </div>
        </div>

        {/* 2. Customer name */}
        <div className="flex items-center gap-1.5 mb-1">
          <p className="text-[13.5px] font-bold text-gray-900 leading-snug truncate">{customerName}</p>
          {order.customerMissing && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (onCustomerMissing) onCustomerMissing(); }}
              className="text-amber-500 hover:bg-amber-50 rounded p-0.5 flex-shrink-0 transition-colors"
              title="Customer Missing — click to resolve"
            >
              <AlertCircle size={14} />
            </button>
          )}
        </div>

        {/* 3. OBD + area */}
        <div className="flex items-center gap-1 text-[11px] text-gray-400 mb-2.5">
          {order.deliveryTypeName && (
            <span
              className={cn(
                "w-[5px] h-[5px] rounded-full flex-shrink-0",
                order.deliveryTypeName === "Local"       ? "bg-blue-600"
                : order.deliveryTypeName === "Upcountry" ? "bg-orange-600"
                : order.deliveryTypeName === "IGT"       ? "bg-teal-600"
                : order.deliveryTypeName === "Cross Depot" ? "bg-rose-600"
                : "bg-gray-300",
              )}
              title={order.deliveryTypeName}
            />
          )}
          <ObdCode code={order.obdNumber} />
          <span>·</span>
          <span>{areaName}</span>
          {formatOrderDateTime(order.orderDateTime) && (
            <>
              <span>·</span>
              <span>{formatOrderDateTime(order.orderDateTime)}</span>
            </>
          )}
        </div>

        {/* 4. Info grid */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
          {([
            { label: "SMU",           value: smu },
            { label: "SALES OFFICER", value: salesOfficerName },
            { label: "ARTICLES",      value: order.querySnapshot?.articleTag ?? "—" },
            { label: "VOLUME",        value: volume },
          ] as const).map((cell) => (
            <div key={cell.label}>
              <div className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400 mb-0.5">
                {cell.label}
              </div>
              <div className="text-[12px] font-semibold text-gray-600">{cell.value}</div>
            </div>
          ))}
        </div>

        {/* 5. Bottom section — per stage */}
        {isPending && (
          <div className="mt-2.5 pt-2.5 border-t border-gray-200">
            {hasSplits ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onCreateSplit(); }}
                className="w-full flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 rounded-lg py-3 text-[12px] font-semibold hover:bg-gray-50 hover:border-gray-300 transition-colors"
              >
                <Scissors size={13} />
                Create Split
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAssign(); }}
                className="w-full flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 rounded-lg py-3 text-[12px] font-semibold hover:bg-gray-50 hover:border-gray-300 transition-colors"
              >
                <UserPlus size={13} />
                Assign
              </button>
            )}
          </div>
        )}

        {isAssigned && (
          <div className="mt-2.5 pt-2.5 border-t border-gray-200">
            <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-teal-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                {operatorInitials}
              </div>
              <span className="text-[12px] font-semibold text-gray-900 flex-1 truncate">
                {operatorName}
              </span>
              <span className="text-[11px] text-gray-400 flex-shrink-0">
                {formatTime(assignment?.updatedAt)}
              </span>
            </div>
          </div>
        )}

        {isInProgress && (
          <div className="mt-2.5 pt-2.5 border-t border-gray-200">
            <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-teal-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                {operatorInitials}
              </div>
              <span className="text-[12px] font-semibold text-gray-900 flex-1 truncate">
                {operatorName}
              </span>
              <span className="text-[11px] text-gray-400 flex-shrink-0">
                {formatTime(assignment?.startedAt)}
              </span>
            </div>
          </div>
        )}

        {isDone && (
          <div className="mt-2.5 pt-2.5 border-t border-gray-200">
            <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-green-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                {operatorInitials}
              </div>
              <span className="text-[12px] font-semibold text-gray-900 flex-1 truncate">
                {operatorName}
              </span>
              <span className="text-[11px] text-gray-400 flex-shrink-0">
                {formatTime(assignment?.completedAt)}
              </span>
            </div>
            <div className="mt-2 pt-2 border-t border-gray-200 flex items-center gap-2">
              <span className="flex items-center gap-1 bg-green-50 border border-green-200 text-green-700 text-[10.5px] font-semibold px-2.5 py-1 rounded-full">
                ✓ Tinting Done
              </span>
              <span className="text-gray-300 text-[13px]">›</span>
              {order.dispatchStatus === "dispatch" && (
                <span className="bg-[#eaf3de] border border-[#97c459] text-[#27500a] text-[10.5px] font-semibold px-2.5 py-1 rounded-full">
                  🚚 Dispatch
                </span>
              )}
              {order.dispatchStatus === "hold" && (
                <span className="bg-[#fcebeb] border border-[#f09595] text-[#791f1f] text-[10.5px] font-semibold px-2.5 py-1 rounded-full">
                  Hold
                </span>
              )}
              {order.dispatchStatus === "waiting_for_confirmation" && (
                <span className="bg-[#faeeda] border border-[#fac775] text-[#633806] text-[10.5px] font-semibold px-2.5 py-1 rounded-full">
                  Waiting
                </span>
              )}
              {!order.dispatchStatus && (
                <span className="bg-amber-50 border border-amber-200 text-amber-700 text-[10.5px] font-semibold px-2.5 py-1 rounded-full">
                  Pending Support
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>

    </>
  );
}

// ── Split Detail Sheet ────────────────────────────────────────────────────────

interface SplitDetailLine {
  rawLineItemId: number;
  assignedQty:   number;
  rawLineItem: {
    skuCodeRaw:        string;
    skuDescriptionRaw: string | null;
    volumeLine:        number | null;
    isTinting:         boolean;
  };
}

interface SplitDetailItem {
  id:             number;
  splitNumber:    number;
  status:         string;
  dispatchStatus: string | null;
  priorityLevel:  number | null;
  totalQty:       number;
  totalVolume:    number | null;
  articleTag:     string | null;
  createdAt:      string;
  startedAt:      string | null;
  completedAt:    string | null;
  assignedTo:     { name: string | null };
  lineItems:      SplitDetailLine[];
}

interface SplitDetailOrder {
  id:        number;
  obdNumber: string;
  customer:  { customerName: string } | null;
  splits:    SplitDetailItem[];
}

function SplitDetailSheet({
  open, onClose, splitId, orderId, colStage, onReassign, onCancel,
}: {
  open:       boolean;
  onClose:    () => void;
  splitId:    number;
  orderId:    number;
  colStage:   ColStage;
  onReassign: () => void;
  onCancel:   () => void;
}) {
  const [orderData, setOrderData] = useState<SplitDetailOrder | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    fetch(`/api/tint/manager/orders/${orderId}/splits`)
      .then((r) => r.json())
      .then((data) => setOrderData(data.order))
      .finally(() => setIsLoading(false));
  }, [open, orderId]);

  const currentSplit     = orderData?.splits.find((s) => s.id === splitId) ?? null;
  const customerName     = orderData?.customer?.customerName ?? "—";
  const isAssigned       = colStage === "tint_assigned";
  const isDone           = colStage === "completed";
  const operatorName     = currentSplit?.assignedTo.name ?? "—";
  const operatorInitials = operatorName === "—"
    ? "?"
    : operatorName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const timeDisplay = isDone
    ? formatTime(currentSplit?.completedAt)
    : colStage === "tinting_in_progress"
    ? formatTime(currentSplit?.startedAt)
    : formatTime(currentSplit?.createdAt);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-end">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative bg-white h-full w-[420px] flex flex-col border-l border-gray-200 shadow-xl overflow-hidden">

        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-200 flex-shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-[.6px] text-gray-400 mb-1">
            {currentSplit ? `SPLIT #${currentSplit.splitNumber} · ` : ""}{orderData?.obdNumber ?? "—"}
          </p>
          <h2 className="text-[15px] font-bold text-gray-900">{customerName}</h2>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {isLoading || !currentSplit ? (
            <>
              <div className="bg-gray-100 rounded-xl h-20 animate-pulse" />
              <div className="bg-gray-100 rounded-xl h-20 animate-pulse" />
            </>
          ) : (
            <>
              {/* — ASSIGNED OPERATOR — */}
              <div>
                <p className="text-[9.5px] font-bold uppercase tracking-[.6px] text-gray-400 mb-2">
                  ASSIGNED OPERATOR
                </p>
                <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <div className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0",
                    isDone ? "bg-green-600" : colStage === "tinting_in_progress" ? "bg-teal-600" : "bg-teal-600",
                  )}>
                    {operatorInitials}
                  </div>
                  <span className="text-[12px] font-semibold text-gray-900 flex-1 truncate">{operatorName}</span>
                  <span className="text-[11px] text-gray-400 flex-shrink-0">{timeDisplay}</span>
                </div>
                {isAssigned && (
                  <button
                    type="button"
                    onClick={() => onReassign()}
                    className="mt-2 w-full flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 rounded-lg py-2 text-[12px] font-semibold hover:bg-gray-50 hover:border-gray-300 transition-colors"
                  >
                    <RefreshCw size={12} />
                    Re-assign
                  </button>
                )}
              </div>

              {/* — SKU LINES — */}
              <div>
                <p className="text-[9.5px] font-bold uppercase tracking-[.6px] text-gray-400 mb-2">
                  SKU LINES
                </p>
                <div className="flex flex-col gap-1.5">
                  {currentSplit.lineItems.map((li) => (
                    <div
                      key={li.rawLineItemId}
                      className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[11px]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-violet-600 flex-shrink-0">{li.rawLineItem.skuCodeRaw}</span>
                        <span className="flex-1 px-2 truncate text-gray-500">{li.rawLineItem.skuDescriptionRaw ?? "—"}</span>
                      </div>
                      <div className="flex gap-4 text-[11px] mt-1.5">
                        <div>
                          <p className="text-gray-400 mb-0.5">QTY</p>
                          <p className="font-semibold">{li.assignedQty}</p>
                        </div>
                        {li.rawLineItem.volumeLine && (
                          <div>
                            <p className="text-gray-400 mb-0.5">VOLUME</p>
                            <p className="font-semibold">{li.rawLineItem.volumeLine} L</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* — STATUS — */}
              <div>
                <p className="text-[9.5px] font-bold uppercase tracking-[.6px] text-gray-400 mb-2">
                  STATUS
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    "text-[11px] font-semibold px-2.5 py-1 rounded-full border",
                    currentSplit.status === "tinting_done" || currentSplit.status === "pending_support"
                      ? "bg-green-50 text-green-700 border-green-200"
                      : currentSplit.status === "tinting_in_progress"
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : currentSplit.status === "cancelled"
                      ? "bg-gray-100 text-gray-500 border-gray-200"
                      : "bg-amber-50 text-amber-700 border-amber-200",
                  )}>
                    {currentSplit.status.replace(/_/g, " ")}
                  </span>
                  {isDone && (
                    <>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-gray-300 flex-shrink-0">
                        <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {currentSplit.dispatchStatus === "dispatch" && (
                        <span className="bg-[#eaf3de] border border-[#97c459] text-[#27500a] text-[11px] font-semibold px-2.5 py-1 rounded-full">🚚 Dispatch</span>
                      )}
                      {currentSplit.dispatchStatus === "hold" && (
                        <span className="bg-[#fcebeb] border border-[#f09595] text-[#791f1f] text-[11px] font-semibold px-2.5 py-1 rounded-full">Hold</span>
                      )}
                      {currentSplit.dispatchStatus === "waiting_for_confirmation" && (
                        <span className="bg-[#faeeda] border border-[#fac775] text-[#633806] text-[11px] font-semibold px-2.5 py-1 rounded-full">Waiting</span>
                      )}
                      {!currentSplit.dispatchStatus && (
                        <span className="bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-semibold px-2.5 py-1 rounded-full">Pending Support</span>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="border-t border-gray-200" />

              {/* — ALL SPLITS FOR THIS OBD — */}
              <div>
                <p className="text-[9.5px] font-bold uppercase tracking-[.6px] text-gray-400 mb-2">
                  ALL SPLITS FOR THIS OBD
                </p>
                <div className="flex flex-col gap-2.5">
                  {(orderData?.splits ?? []).filter((s) => s.status !== "cancelled").map((s) => {
                    const isCurrent  = s.id === splitId;
                    const opName     = s.assignedTo.name ?? "—";
                    const opInitials = opName === "—" ? "?" : opName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
                    return (
                      <div
                        key={s.id}
                        className={cn(
                          "rounded-xl px-4 py-3 border",
                          isCurrent ? "border-gray-900 bg-gray-50" : "bg-gray-50 border-gray-200",
                        )}
                      >
                        {/* Header row */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[12px] font-bold text-gray-800">Split #{s.splitNumber}</span>
                            {isCurrent && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-teal-600 text-white">current</span>
                            )}
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                              s.status === "tinting_done" || s.status === "pending_support"
                                ? "bg-green-50 text-green-700 border-green-200"
                                : s.status === "tinting_in_progress"
                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                : s.status === "cancelled"
                                ? "bg-gray-100 text-gray-500 border-gray-200"
                                : s.status === "dispatch_confirmation" || s.status === "dispatched"
                                ? "bg-teal-50 text-teal-700 border-teal-200"
                                : "bg-amber-50 text-amber-700 border-amber-200",
                            )}>
                              {s.status.replace(/_/g, " ")}
                            </span>
                            {s.dispatchStatus && (
                              <span className={cn(
                                "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                                s.dispatchStatus === "dispatch"
                                  ? "bg-green-50 text-green-700 border-green-200"
                                  : s.dispatchStatus === "hold"
                                  ? "bg-red-50 text-red-700 border-red-200"
                                  : "bg-amber-50 text-amber-700 border-amber-200",
                              )}>
                                {s.dispatchStatus === "waiting_for_confirmation" ? "Waiting" : s.dispatchStatus.charAt(0).toUpperCase() + s.dispatchStatus.slice(1)}
                              </span>
                            )}
                          </div>
                          <span className="text-[10.5px] text-gray-400 font-mono ml-2 flex-shrink-0">
                            {new Date(s.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </span>
                        </div>
                        {/* Operator row */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full bg-teal-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                              {opInitials}
                            </div>
                            <span className="text-[11.5px] font-medium text-gray-700">{opName}</span>
                          </div>
                          <span className="text-[11.5px] font-semibold text-gray-700">
                            {s.articleTag ?? `${s.totalQty} units`}
                          </span>
                        </div>
                        {/* Line items */}
                        <div className="flex flex-col gap-1">
                          {s.lineItems.map((item) => (
                            <div key={item.rawLineItemId} className="flex items-center justify-between text-[11px] text-gray-500">
                              <span className="font-mono text-violet-600 flex-shrink-0">{item.rawLineItem.skuCodeRaw}</span>
                              <span className="flex-1 px-2 truncate">{item.rawLineItem.skuDescriptionRaw ?? "—"}</span>
                              <span className="font-semibold text-gray-700 flex-shrink-0">{item.assignedQty} units</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-end gap-2 bg-white flex-shrink-0">
          {isAssigned && (
            <button
              type="button"
              onClick={() => { onCancel(); onClose(); }}
              className="px-4 py-2 text-[12px] font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
            >
              Cancel Split
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>,
    document.body
  );
}

// ── Split Kanban card ─────────────────────────────────────────────────────────

function SplitKanbanCard({
  split, colStage, onReassign, onCancel, onRefresh, onMoveUp, onMoveDown, onViewDetail,
}: {
  split:        SplitCard;
  colStage:     ColStage;
  onReassign:   () => void;
  onCancel:     () => void;
  onRefresh:    () => void;
  onMoveUp:     () => void;
  onMoveDown:   () => void;
  onViewDetail: () => void;
}) {
  const [menuOpen,       setMenuOpen]       = useState(false);
  const [popoverOpen,    setPopoverOpen]    = useState(false);
  const [popoverPos,     setPopoverPos]     = useState<{ top: number; right: number } | null>(null);
  const [isSaving,       setIsSaving]       = useState(false);
  const [splitSheetOpen, setSplitSheetOpen] = useState(false);
  const menuRef       = useRef<HTMLDivElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const customerName     = split.order.customer?.customerName ?? "—";
  const salesOfficerName = split.order.customer?.salesOfficerGroup?.salesOfficer?.name ?? "—";
  const volume           = split.totalVolume != null ? `${split.totalVolume.toFixed(1)} L` : "—";
  const smu              = split.smu ?? "—";
  const operatorName     = split.assignedTo.name ?? "—";
  const operatorInitials = operatorName === "—"
    ? "?"
    : operatorName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const splitPriorityLevel = split.priorityLevel ?? 5;
  const isUrgent         = splitPriorityLevel <= 2;

  const isAssigned   = colStage === "tint_assigned";
  const isInProgress = colStage === "tinting_in_progress";
  const isDone       = colStage === "completed";

  const timeDisplay = isDone       ? formatTime(split.completedAt)
                    : isInProgress ? formatTime(split.startedAt)
                    : formatTime(split.createdAt);

  // ── Status popover save ───────────────────────────────────────────────────

  async function handleStatusSave(
    newDispatch: string | null,
    newPriority: "normal" | "urgent",
  ) {
    setIsSaving(true);
    try {
      const body: Record<string, string | null> = {};
      if (newDispatch !== split.dispatchStatus)       body.dispatchStatus = newDispatch;
      if ((newPriority === "urgent") !== isUrgent)    body.priority       = newPriority;
      if (Object.keys(body).length === 0) { setPopoverOpen(false); return; }

      const res = await fetch(`/api/tint/manager/splits/${split.id}/status`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save");
      setPopoverOpen(false);
      onRefresh();
    } catch (err) {
      console.error("Split status save failed:", err);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
    <div
      className={cn(
        "bg-white border border-gray-200 rounded-lg overflow-hidden",
        "hover:border-gray-300 transition-all duration-150",
      )}
    >
      <div className="px-3.5 pt-3 pb-3">
        {/* Icons + badges */}
        <div className="mb-2">
          {/* Icon row */}
          <div className="flex items-center justify-end gap-1 h-[24px]">
            {/* ⊞ button — opens Split Detail sheet */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); console.log('Layers clicked, splitId:', split.id, 'orderId:', split.order.id); setSplitSheetOpen(true); }}
              className="w-[26px] h-[26px] rounded-lg flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
              title="View split details"
            >
              <Layers size={14} />
            </button>

            {/* 👁 button — opens order detail panel */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onViewDetail(); }}
              className="w-[26px] h-[26px] rounded-lg flex items-center justify-center text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
              title="View order details"
            >
              <Eye size={14} />
            </button>

            {/* + button — opens status popover */}
            <div className="relative">
              <button
                ref={plusButtonRef}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  if (!popoverOpen && plusButtonRef.current) {
                    const rect = plusButtonRef.current.getBoundingClientRect();
                    setPopoverPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                  }
                  setPopoverOpen((v) => !v);
                }}
                className={cn(
                  "w-[26px] h-[26px] rounded-lg flex items-center justify-center transition-colors",
                  popoverOpen
                    ? "bg-teal-600 text-white"
                    : "text-gray-400 hover:bg-gray-100",
                )}
                title="Set priority / dispatch status"
              >
                <Plus size={14} />
              </button>

              {popoverOpen && popoverPos && (
                <StatusPopover
                  position={popoverPos}
                  anchorRef={plusButtonRef}
                  currentDispatch={split.dispatchStatus}
                  currentPriority={isUrgent ? "urgent" : "normal"}
                  onSave={handleStatusSave}
                  onClose={() => setPopoverOpen(false)}
                  isSaving={isSaving}
                />
              )}
            </div>

            {/* ... button + dropdown */}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setPopoverOpen(false); setMenuOpen(!menuOpen); }}
                className="w-[26px] h-[26px] rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors"
              >
                <MoreHorizontal size={14} />
              </button>

              {menuOpen && (
                <div
                  className="absolute right-0 top-8 z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[130px] max-w-[150px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {split.status === "tint_assigned" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => { setMenuOpen(false); onMoveUp(); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
                      >
                        <ChevronUp size={12} className="text-gray-400 flex-shrink-0" />
                        Move Up
                      </button>
                      <button
                        type="button"
                        onClick={() => { setMenuOpen(false); onMoveDown(); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
                      >
                        <ChevronDown size={12} className="text-gray-400 flex-shrink-0" />
                        Move Down
                      </button>
                      <div className="mx-3 border-t border-gray-100" />
                      <button
                        type="button"
                        onClick={() => { setMenuOpen(false); onReassign(); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
                      >
                        <RefreshCw size={12} className="text-gray-400 flex-shrink-0" />
                        Re-assign
                      </button>
                      <div className="mx-3 border-t border-gray-100" />
                      <button
                        type="button"
                        onClick={() => { setMenuOpen(false); onCancel(); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-red-600 hover:bg-red-50 transition-colors whitespace-nowrap"
                      >
                        <X size={12} className="text-red-400 flex-shrink-0" />
                        Cancel
                      </button>
                    </>
                  ) : (
                    <div className="px-3.5 py-2.5 text-[11.5px] text-gray-400 italic">
                      No actions available
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {/* Badge row */}
          <div className="flex items-center gap-1.5 flex-wrap min-h-[22px]">
            <span className={cn(
              "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border",
              isDone       ? "bg-green-50 text-green-700 border-green-200"
              : isInProgress ? "bg-blue-50 text-blue-700 border-blue-200"
              : "bg-violet-50 text-violet-700 border-violet-200",
            )}>
              <Scissors size={10} />
              Split #{split.splitNumber}
            </span>
            {isUrgent ? (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full border bg-red-50 border-red-200 text-red-600">
                🚨 Urgent
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full border bg-gray-50 border-gray-200 text-gray-500">
                ● Normal
              </span>
            )}
            <DispatchStatusBadge status={split.dispatchStatus} />
            {isDone && (
              <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-200 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                ✓ Done
              </span>
            )}
          </div>
        </div>

        {/* Customer name */}
        <p className="text-[13.5px] font-bold text-gray-900 leading-snug mb-1">{customerName}</p>

        {/* OBD row */}
        <div className="flex items-center gap-1 text-[11px] text-gray-400 mb-2.5">
          {split.deliveryTypeName && (
            <span
              className={cn(
                "w-[5px] h-[5px] rounded-full flex-shrink-0",
                split.deliveryTypeName === "Local"         ? "bg-blue-600"
                : split.deliveryTypeName === "Upcountry"   ? "bg-orange-600"
                : split.deliveryTypeName === "IGT"         ? "bg-teal-600"
                : split.deliveryTypeName === "Cross Depot" ? "bg-rose-600"
                : "bg-gray-300",
              )}
              title={split.deliveryTypeName}
            />
          )}
          <ObdCode code={split.order.obdNumber} />
          {formatOrderDateTime(split.orderDateTime) && (
            <>
              <span>·</span>
              <span>{formatOrderDateTime(split.orderDateTime)}</span>
            </>
          )}
        </div>

        {/* Info grid */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
          {([
            { label: "SMU",           value: smu },
            { label: "SALES OFFICER", value: salesOfficerName },
            { label: "ARTICLES",      value: split.articleTag ?? "—" },
            { label: "VOLUME",        value: volume },
          ] as const).map((cell) => (
            <div key={cell.label}>
              <div className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400 mb-0.5">
                {cell.label}
              </div>
              <div className="text-[12px] font-semibold text-gray-600">{cell.value}</div>
            </div>
          ))}
        </div>

        {/* Operator row */}
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0",
              isDone       ? "bg-green-600"
              : isInProgress ? "bg-teal-600"
              : "bg-teal-600",
            )}>
              {operatorInitials}
            </div>
            <span className="text-[12px] font-semibold text-gray-900 flex-1 truncate">
              {operatorName}
            </span>
            <span className="text-[11px] text-gray-400 flex-shrink-0">
              {timeDisplay}
            </span>
          </div>
        </div>

        {/* Two-badge status trail — Completed column only */}
        {isDone && (
          <div className="mt-2 pt-2 border-t border-gray-200 flex items-center gap-2">
            <span className="flex items-center gap-1 bg-green-50 border border-green-200 text-green-700 text-[10.5px] font-semibold px-2.5 py-1 rounded-full">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Tinting Done
            </span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
              className="text-gray-300 flex-shrink-0">
              <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {split.dispatchStatus === "dispatch" && (
              <span className="bg-[#eaf3de] border border-[#97c459] text-[#27500a] text-[10.5px] font-semibold px-2.5 py-1 rounded-full">
                🚚 Dispatch
              </span>
            )}
            {split.dispatchStatus === "hold" && (
              <span className="bg-[#fcebeb] border border-[#f09595] text-[#791f1f] text-[10.5px] font-semibold px-2.5 py-1 rounded-full">
                Hold
              </span>
            )}
            {split.dispatchStatus === "waiting_for_confirmation" && (
              <span className="bg-[#faeeda] border border-[#fac775] text-[#633806] text-[10.5px] font-semibold px-2.5 py-1 rounded-full">
                Waiting
              </span>
            )}
            {!split.dispatchStatus && (
              <span className="bg-amber-50 border border-amber-200 text-amber-700 text-[10.5px] font-semibold px-2.5 py-1 rounded-full">
                Pending Support
              </span>
            )}
          </div>
        )}
      </div>
    </div>

    <SplitDetailSheet
      open={splitSheetOpen}
      onClose={() => setSplitSheetOpen(false)}
      splitId={split.id}
      orderId={split.order.id}
      colStage={colStage}
      onReassign={() => { setSplitSheetOpen(false); onReassign(); }}
      onCancel={() => { setSplitSheetOpen(false); onCancel(); }}
    />
    </>
  );
}

// ── Page Content ──────────────────────────────────────────────────────────────

export function TintManagerContent() {
  const [orders,               setOrders]               = useState<TintOrder[]>([]);
  const [activeSplits,         setActiveSplits]         = useState<SplitCard[]>([]);
  const [completedSplits,      setCompletedSplits]      = useState<SplitCard[]>([]);
  const [completedAssignments, setCompletedAssignments] = useState<CompletedAssignment[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [now,       setNow]       = useState<Date>(() => new Date());

  const [slotFilter,         setSlotFilter]         = useState<"all" | number>("all");
  const [priorityFilter,     setPriorityFilter]     = useState<"all" | "urgent" | "normal">("all");
  const [delTypeFilter,      setDelTypeFilter]      = useState<Set<string>>(new Set());
  const [slotSummary,        setSlotSummary]        = useState<SlotSummaryItem[]>([]);
  const [typeFilter,         setTypeFilter]         = useState<"all" | "split" | "whole">("all");
  const [searchQuery,        setSearchQuery]        = useState("");
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const [workloadBarOpen,    setWorkloadBarOpen]    = useState(false);
  const [operatorFilter,     setOperatorFilter]     = useState("");
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [headerFilters,      setHeaderFilters]      = useState<Record<string, string[]>>({ deliveryType: [], priority: [], type: [], operator: [] });
  const searchRef = useRef<HTMLDivElement>(null);

  const [selectedOrder,   setSelectedOrder]   = useState<TintOrder | null>(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignedToId,    setAssignedToId]    = useState<string>("");
  const [note,            setNote]            = useState("");
  const [isAssigning,     setIsAssigning]     = useState(false);
  const [assignError,     setAssignError]     = useState<string | null>(null);

  const [pages, setPages] = useState<Record<string, number>>({});

  const [splitBuilderOpen,  setSplitBuilderOpen]  = useState(false);
  const [splitBuilderOrder, setSplitBuilderOrder] = useState<SplitBuilderModalProps["order"] | null>(null);

  const [selectedSplitForReassign, setSelectedSplitForReassign] = useState<SplitCard | null>(null);
  const [splitReassignOpen,        setSplitReassignOpen]        = useState(false);
  const [splitReassignedToId,      setSplitReassignedToId]      = useState<string>("");
  const [isSplitReassigning,       setIsSplitReassigning]       = useState(false);
  const [splitReassignError,       setSplitReassignError]       = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<"card" | "table">(() => {
    if (typeof window !== "undefined") {
      return (sessionStorage.getItem("tm_view_mode") as "card" | "table") ?? "card";
    }
    return "card";
  });

  const tableAnchorRef = useRef<HTMLButtonElement | null>(null);

  const [tablePopover, setTablePopover] = useState<{
    id:              number;
    type:            "order" | "split";
    position:        { top: number; right: number };
    currentDispatch: string | null;
    currentPriority: "normal" | "urgent";
  } | null>(null);
  const [tablePopoverSaving, setTablePopoverSaving] = useState(false);

  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);

  const [missingSheetOpen,  setMissingSheetOpen]  = useState(false);
  const [missingSheetOrder, setMissingSheetOrder] = useState<TintOrder | null>(null);

  const [tableSplitData, setTableSplitData] = useState<{
    splitId:  number;
    orderId:  number;
    colStage: ColStage;
  } | null>(null);
  const [tableSplitOpen, setTableSplitOpen] = useState(false);

  // ── Clock ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Sync headerFilters → existing filter states
  useEffect(() => {
    const dt = headerFilters.deliveryType ?? [];
    setDelTypeFilter(new Set(dt));
    const pr = headerFilters.priority ?? [];
    setPriorityFilter(pr.length === 1 ? (pr[0] as "urgent" | "normal") : "all");
    const tp = headerFilters.type ?? [];
    setTypeFilter(tp.length === 1 ? (tp[0] as "split" | "whole") : "all");
    const op = headerFilters.operator ?? [];
    setOperatorFilter(op.length === 1 ? op[0] : "");
  }, [headerFilters]);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchOrders = useCallback(async () => {
    try {
      const res  = await fetch("/api/tint/manager/orders");
      const data = (await res.json()) as {
        orders:               TintOrder[];
        activeSplits:         SplitCard[];
        completedSplits:      SplitCard[];
        completedAssignments: CompletedAssignment[];
        slotSummary:          SlotSummaryItem[];
      };
      setOrders(data.orders ?? []);
      setActiveSplits(data.activeSplits ?? []);
      setCompletedSplits(data.completedSplits ?? []);
      setCompletedAssignments(data.completedAssignments ?? []);
      setSlotSummary(data.slotSummary ?? []);
    } catch {
      // leave stale
    }
  }, []);

  useEffect(() => {
    async function init() {
      setIsLoading(true);
      try {
        const [ordersRes, opsRes] = await Promise.all([
          fetch("/api/tint/manager/orders"),
          fetch("/api/tint/manager/operators"),
        ]);
        const ordersData = (await ordersRes.json()) as {
          orders:               TintOrder[];
          activeSplits:         SplitCard[];
          completedSplits:      SplitCard[];
          completedAssignments: CompletedAssignment[];
          slotSummary:          SlotSummaryItem[];
        };
        const opsData    = (await opsRes.json())    as { operators: Operator[] };
        setOrders(ordersData.orders ?? []);
        setActiveSplits(ordersData.activeSplits ?? []);
        setCompletedSplits(ordersData.completedSplits ?? []);
        setCompletedAssignments(ordersData.completedAssignments ?? []);
        setSlotSummary(ordersData.slotSummary ?? []);
        setOperators(opsData.operators ?? []);
      } finally {
        setIsLoading(false);
      }
    }
    void init();
  }, [fetchOrders]);

  // ── Client-side filtering ─────────────────────────────────────────────────

  const filteredOrders = (orders ?? []).filter((o) => {
    if (delTypeFilter.size > 0 && !delTypeFilter.has(o.deliveryTypeName ?? "")) return false;
    if (priorityFilter === "urgent" && !(o.priorityLevel <= 2)) return false;
    if (priorityFilter === "normal" && !(o.priorityLevel > 2)) return false;
    if (typeFilter === "whole") {
      const hasSplits = (o.splits ?? []).some((s) =>
        ["tint_assigned", "tinting_in_progress"].includes(s.status)
      );
      if (hasSplits) return false;
    }
    if (typeFilter === "split") {
      const hasSplits = (o.splits ?? []).some((s) =>
        ["tint_assigned", "tinting_in_progress"].includes(s.status)
      );
      if (!hasSplits) return false;
    }
    if (operatorFilter) {
      if (o.workflowStage === "pending_tint_assignment") {
        const hasSplitByOp = (o.splits ?? []).some(
          (s) => s.assignedTo?.name === operatorFilter && ["tint_assigned", "tinting_in_progress"].includes(s.status)
        );
        if (!hasSplitByOp) return false;
      } else {
        const opName = o.tintAssignments[0]?.assignedTo.name ?? "";
        if (opName !== operatorFilter) return false;
      }
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchObd      = o.obdNumber.toLowerCase().includes(q);
      const matchCustomer = (o.customer?.customerName ?? "").toLowerCase().includes(q);
      const matchSO       = (o.customer?.salesOfficerGroup?.salesOfficer?.name ?? "").toLowerCase().includes(q);
      const matchSku      = o.lineItems.some((l) => l.skuCodeRaw.toLowerCase().includes(q));
      if (!matchObd && !matchCustomer && !matchSO && !matchSku) return false;
    }
    return true;
  });

  const filteredActiveSplits = activeSplits.filter((s) => {
    if (delTypeFilter.size > 0 && !delTypeFilter.has(s.deliveryTypeName ?? "")) return false;
    const pl = s.priorityLevel ?? 5;
    if (priorityFilter === "urgent" && !(pl <= 2)) return false;
    if (priorityFilter === "normal" && !(pl > 2)) return false;
    if (typeFilter === "whole") return false;
    if (operatorFilter && (s.assignedTo.name ?? "") !== operatorFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchObd      = s.order.obdNumber.toLowerCase().includes(q);
      const matchCustomer = (s.order.customer?.customerName ?? "").toLowerCase().includes(q);
      const matchSO       = (s.order.customer?.salesOfficerGroup?.salesOfficer?.name ?? "").toLowerCase().includes(q);
      if (!matchObd && !matchCustomer && !matchSO) return false;
    }
    return true;
  });

  const filteredCompletedSplits = completedSplits.filter((s) => {
    if (delTypeFilter.size > 0 && !delTypeFilter.has(s.deliveryTypeName ?? "")) return false;
    const pl = s.priorityLevel ?? 5;
    if (priorityFilter === "urgent" && !(pl <= 2)) return false;
    if (priorityFilter === "normal" && !(pl > 2)) return false;
    if (typeFilter === "whole") return false;
    if (operatorFilter && (s.assignedTo.name ?? "") !== operatorFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchObd      = s.order.obdNumber.toLowerCase().includes(q);
      const matchCustomer = (s.order.customer?.customerName ?? "").toLowerCase().includes(q);
      const matchSO       = (s.order.customer?.salesOfficerGroup?.salesOfficer?.name ?? "").toLowerCase().includes(q);
      if (!matchObd && !matchCustomer && !matchSO) return false;
    }
    return true;
  });

  // ── Derived stats ─────────────────────────────────────────────────────────

  const pendingCount    = orders.filter(o => o.workflowStage === "pending_tint_assignment").length;
  const assignedCount   = orders.filter(o => o.workflowStage === "tint_assigned").length
                        + activeSplits.filter(s => s.status === "tint_assigned").length;
  const inProgressCount = orders.filter(o => o.workflowStage === "tinting_in_progress").length
                        + activeSplits.filter(s => s.status === "tinting_in_progress").length;
  const doneCount       = completedSplits.length
                        + orders.filter(o => o.workflowStage === "pending_support").length;

  const pendingVolume    = orders
    .filter(o => o.workflowStage === "pending_tint_assignment")
    .reduce((s, o) => s + (o.querySnapshot?.totalVolume ?? 0), 0);

  const assignedVolume   =
    activeSplits.filter(s => s.status === "tint_assigned")
      .reduce((s, sp) => s + (sp.totalVolume ?? 0), 0)
    + orders.filter(o => o.workflowStage === "tint_assigned")
      .reduce((s, o) => s + (o.querySnapshot?.totalVolume ?? 0), 0);

  const inProgressVolume =
    activeSplits.filter(s => s.status === "tinting_in_progress")
      .reduce((s, sp) => s + (sp.totalVolume ?? 0), 0)
    + orders.filter(o => o.workflowStage === "tinting_in_progress")
      .reduce((s, o) => s + (o.querySnapshot?.totalVolume ?? 0), 0);

  const doneVolume       =
    completedSplits.reduce((s, sp) => s + (sp.totalVolume ?? 0), 0)
    + orders.filter(o => o.workflowStage === "pending_support")
      .reduce((s, o) => s + (o.querySnapshot?.totalVolume ?? 0), 0);

  function handleTableStatusPopover(
    id: number,
    type: "order" | "split",
    buttonEl: HTMLButtonElement,
  ) {
    tableAnchorRef.current = buttonEl;
    const rect = buttonEl.getBoundingClientRect();
    const position = { top: rect.bottom + 6, right: window.innerWidth - rect.right };

    if (type === "order") {
      const order = filteredOrders.find((o) => o.id === id);
      if (!order) return;
      setTablePopover({
        id, type, position,
        currentDispatch: order.dispatchStatus,
        currentPriority: order.priorityLevel <= 2 ? "urgent" : "normal",
      });
    } else {
      const split = filteredActiveSplits.find((s) => s.id === id)
        ?? filteredCompletedSplits.find((s) => s.id === id);
      if (!split) return;
      setTablePopover({
        id, type, position,
        currentDispatch: split.dispatchStatus,
        currentPriority: (split.priorityLevel ?? 5) <= 2 ? "urgent" : "normal",
      });
    }
  }

  async function handleTableStatusSave(
    dispatch: string | null,
    priority: "normal" | "urgent",
  ) {
    if (!tablePopover) return;
    setTablePopoverSaving(true);
    try {
      const body: Record<string, string | null> = {};
      if (dispatch !== tablePopover.currentDispatch) body.dispatchStatus = dispatch;
      if (priority !== tablePopover.currentPriority) body.priority = priority;
      if (Object.keys(body).length === 0) { setTablePopover(null); return; }

      const url = tablePopover.type === "order"
        ? `/api/tint/manager/orders/${tablePopover.id}/status`
        : `/api/tint/manager/splits/${tablePopover.id}/status`;

      const res = await fetch(url, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save");
      setTablePopover(null);
      void fetchOrders();
    } catch (err) {
      console.error("Table status save failed:", err);
    } finally {
      setTablePopoverSaving(false);
    }
  }

  function clearAllFilters() {
    setPriorityFilter("all");
    setDelTypeFilter(new Set());
    setTypeFilter("all");
    setSearchQuery("");
    setOperatorFilter("");
  }

  function closeAssignModal() {
    setAssignModalOpen(false);
  }

  function openSplitBuilder(order: TintOrder) {
    const customerName = order.customer?.customerName ?? order.shipToCustomerName ?? "—";
    setSplitBuilderOrder({
      id:             order.id,
      obdNumber:      order.obdNumber,
      customerName,
      lineItems:      order.lineItems,
      existingSplits: order.existingSplits ?? [],
      previousSplits: order.splits ?? [],
    });
    setSplitBuilderOpen(true);
  }

  function openAssignModal(order: TintOrder) {
    const currentOpId = order.tintAssignments[0]?.assignedTo.id;
    setSelectedOrder(order);
    setAssignedToId(currentOpId ? String(currentOpId) : "");
    setNote("");
    setAssignError(null);
    setAssignModalOpen(true);
  }

  function openSplitReassign(split: SplitCard) {
    setSelectedSplitForReassign(split);
    setSplitReassignedToId(split.assignedTo.id ? String(split.assignedTo.id) : "");
    setSplitReassignError(null);
    setSplitReassignOpen(true);
  }

  async function handleSplitReassign() {
    if (!selectedSplitForReassign || !splitReassignedToId) return;
    setIsSplitReassigning(true);
    setSplitReassignError(null);
    try {
      const res = await fetch("/api/tint/manager/splits/reassign", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          splitId:      selectedSplitForReassign.id,
          assignedToId: Number(splitReassignedToId),
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(typeof err.error === "string" ? err.error : "Re-assign failed");
      }
      setSplitReassignOpen(false);
      setSelectedSplitForReassign(null);
      void fetchOrders();
    } catch (err) {
      setSplitReassignError(err instanceof Error ? err.message : "Re-assign failed");
    } finally {
      setIsSplitReassigning(false);
    }
  }

  async function handleReorder(
    type: "order" | "split",
    id: number,
    direction: "up" | "down",
  ) {
    try {
      await fetch("/api/tint/manager/reorder", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type, id, direction }),
      });
      void fetchOrders();
    } catch (err) {
      console.error("Reorder failed:", err);
    }
  }

  async function handleCancelAssignment(order: TintOrder) {
    try {
      await fetch("/api/tint/manager/cancel-assignment", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderId: order.id }),
      });
      void fetchOrders();
    } catch (err) {
      console.error("Cancel assignment failed:", err);
    }
  }

  async function handleCancelSplit(splitId: number) {
    try {
      const res = await fetch("/api/tint/manager/splits/cancel", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ splitId }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to cancel split");
      }
      void fetchOrders();
    } catch (err) {
      console.error("Cancel split failed:", err);
    }
  }

  async function handleAssign() {
    if (!selectedOrder || !assignedToId) return;
    setIsAssigning(true);
    setAssignError(null);
    try {
      const res = await fetch("/api/tint/manager/assign", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          orderId:      selectedOrder.id,
          assignedToId: Number(assignedToId),
          note:         note || undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(typeof err.error === "string" ? err.error : "Assignment failed");
      }
      closeAssignModal();
      setSelectedOrder(null);
      void fetchOrders();
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Assignment failed");
    } finally {
      setIsAssigning(false);
    }
  }

  // ── Pre-render computations ────────────────────────────────────────────────

  const operatorWorkload = (() => {
    const map = new Map<string, { assigned: number; inProgress: number; done: number }>();
    for (const s of activeSplits) {
      const name  = s.assignedTo.name ?? "Unknown";
      const entry = map.get(name) ?? { assigned: 0, inProgress: 0, done: 0 };
      if (s.status === "tint_assigned")          entry.assigned++;
      else if (s.status === "tinting_in_progress") entry.inProgress++;
      map.set(name, entry);
    }
    for (const s of completedSplits) {
      const name  = s.assignedTo.name ?? "Unknown";
      const entry = map.get(name) ?? { assigned: 0, inProgress: 0, done: 0 };
      entry.done++;
      map.set(name, entry);
    }
    for (const o of orders) {
      const name = o.tintAssignments[0]?.assignedTo.name;
      if (!name) continue;
      const entry = map.get(name) ?? { assigned: 0, inProgress: 0, done: 0 };
      if (o.workflowStage === "tint_assigned")          entry.assigned++;
      else if (o.workflowStage === "tinting_in_progress") entry.inProgress++;
      else if (o.workflowStage === "pending_support")     entry.done++;
      map.set(name, entry);
    }
    return Array.from(map.entries()).map(([name, counts]) => ({ name, ...counts }));
  })();

  const suggestions = (() => {
    if (!searchQuery.trim()) return [] as { tag: "Customer" | "OBD" | "SKU"; value: string }[];
    const q    = searchQuery.trim().toLowerCase();
    const seen = new Set<string>();
    const results: { tag: "Customer" | "OBD" | "SKU"; value: string }[] = [];
    for (const o of orders) {
      if (o.obdNumber.toLowerCase().includes(q)) {
        const key = `OBD:${o.obdNumber}`;
        if (!seen.has(key)) { seen.add(key); results.push({ tag: "OBD", value: o.obdNumber }); }
      }
    }
    for (const o of orders) {
      const name = o.customer?.customerName ?? "";
      if (name && name.toLowerCase().includes(q)) {
        const key = `Customer:${name}`;
        if (!seen.has(key)) { seen.add(key); results.push({ tag: "Customer", value: name }); }
      }
    }
    for (const o of orders) {
      for (const l of o.lineItems) {
        if (l.skuCodeRaw.toLowerCase().includes(q)) {
          const key = `SKU:${l.skuCodeRaw}`;
          if (!seen.has(key)) { seen.add(key); results.push({ tag: "SKU", value: l.skuCodeRaw }); }
        }
      }
    }
    return results.slice(0, 4);
  })();

  const hasActiveFilters =
    priorityFilter !== "all" || delTypeFilter.size > 0 ||
    typeFilter !== "all" || operatorFilter !== "" || searchQuery !== "";
  const activeParts: string[] = [];
  if (priorityFilter !== "all") activeParts.push(priorityFilter);
  if (delTypeFilter.size > 0)   activeParts.push(Array.from(delTypeFilter).join(", "));
  if (typeFilter !== "all")     activeParts.push(typeFilter);
  if (operatorFilter)           activeParts.push(operatorFilter);
  if (searchQuery)              activeParts.push(`"${searchQuery}"`);

  // ── Loading state ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white">
        <div className="h-[52px] bg-white border-b border-gray-200" />
        <div className="px-6 pb-6 mt-4">
          <div className="grid grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-gray-50 border border-gray-200 rounded-[14px] overflow-hidden">
                <div className="bg-white border-b border-gray-200 px-4 py-3">
                  <div className="h-4 bg-gray-100 rounded animate-pulse w-24" />
                </div>
                <div className="p-3 flex flex-col gap-2">
                  {[0, 1, 2].map((j) => (
                    <div key={j} className="bg-gray-100 rounded-xl h-32 animate-pulse" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const assignCustomerName = selectedOrder
    ? (selectedOrder.customer?.customerName ?? selectedOrder.shipToCustomerName ?? "—")
    : "";

  // True only when the order is genuinely being RE-assigned (currently assigned with no remaining qty
  // and at least one active split). Orders showing in Pending due to remainingQty > 0 or all-splits-
  // cancelled are always a fresh Assign, not a Re-assign.
  const isReassign = !!selectedOrder &&
    selectedOrder.workflowStage === "tint_assigned" &&
    (selectedOrder.remainingQty ?? 0) === 0 &&
    (selectedOrder.splits ?? []).filter((s) => s.status !== "cancelled").length > 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white">

      <UniversalHeader
        title="Tint Manager"
        stats={[
          { label: "pending", value: pendingCount },
          { label: "assigned", value: assignedCount },
          { label: "in progress", value: inProgressCount },
          { label: "done", value: doneCount },
        ]}
        filterGroups={[
          { label: "Delivery Type", key: "deliveryType", options: [{ value: "LOCAL", label: "Local" }, { value: "UPC", label: "UPC" }, { value: "IGT", label: "IGT" }, { value: "CROSS", label: "Cross" }] },
          { label: "Priority", key: "priority", options: [{ value: "urgent", label: "Urgent" }, { value: "normal", label: "Normal" }] },
          { label: "Type", key: "type", options: [{ value: "split", label: "Split" }, { value: "whole", label: "Whole" }] },
          { label: "Operator", key: "operator", options: operators.filter((op) => op.name).map((op) => ({ value: String(op.id), label: op.name! })) },
        ]}
        activeFilters={headerFilters}
        onFilterChange={setHeaderFilters}
        searchPlaceholder="Search OBD, customer..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        rightExtra={
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setViewMode("card"); if (typeof window !== "undefined") sessionStorage.setItem("tm_view_mode", "card"); }}
              className={`p-1 rounded ${viewMode === "card" ? "bg-gray-100 text-gray-900" : "text-gray-400 hover:text-gray-600"}`}
              title="Card view"
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => { setViewMode("table"); if (typeof window !== "undefined") sessionStorage.setItem("tm_view_mode", "table"); }}
              className={`p-1 rounded ${viewMode === "table" ? "bg-gray-100 text-gray-900" : "text-gray-400 hover:text-gray-600"}`}
              title="Table view"
            >
              <TableIcon size={14} />
            </button>
          </div>
        }
        shortcuts={[
          { key: "\u2191\u2193", label: "Navigate rows" },
          { key: "\u21B5", label: "Order details" },
        ]}
      />

      {/* ── OLD HEADER START (hidden) ── */}
      <div style={{ display: "none" }}>
      {/* ── Topbar ───────────────────────────────────────────────────────── */}
      <div className="h-[42px] bg-white border-b border-gray-200 px-5 flex items-center sticky top-0 z-40">
        {/* Left: title + stats */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h1 className="text-[14px] font-semibold text-gray-900 flex-shrink-0">Tint Manager</h1>
          <div className="flex items-center gap-2.5 text-[11px] text-gray-400 flex-shrink-0">
            <span><span className="text-gray-900 font-semibold">{pendingCount}</span> Pending</span>
            <span><span className="text-gray-900 font-semibold">{assignedCount}</span> Assigned</span>
            <span><span className="text-gray-900 font-semibold">{inProgressCount}</span> In Progress</span>
            <span><span className="text-gray-900 font-semibold">{doneCount}</span> Done</span>
            <span className="text-gray-200">|</span>
            <span><span className="text-gray-600 font-medium">{formatVolume(pendingVolume + assignedVolume + inProgressVolume + doneVolume)}</span></span>
            <span className="text-gray-200">&middot;</span>
            <span><span className="text-gray-600 font-medium">{orders.length}</span> OBDs</span>
          </div>
        </div>

        {/* Right: search + view toggle + clock */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Search */}
          <div ref={searchRef} className="relative">
            <div className="relative flex items-center">
              <Search size={12} className="absolute left-2 text-gray-300 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchDropdownOpen(e.target.value.length > 0);
                }}
                onFocus={() => { if (searchQuery) setSearchDropdownOpen(true); }}
                placeholder="Search..."
                className="w-[140px] focus:w-[200px] transition-all duration-200 pl-7 pr-7 py-1 text-[11px] border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 placeholder:text-gray-300 text-gray-700"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(""); setSearchDropdownOpen(false); }}
                  className="absolute right-2 text-gray-300 hover:text-gray-500 transition-colors"
                >
                  <X size={10} />
                </button>
              )}
            </div>
            {searchDropdownOpen && suggestions.length > 0 && (
              <div className="absolute top-full mt-1 right-0 w-[240px] bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setSearchQuery(s.value); setSearchDropdownOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <span className={cn(
                      "text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0",
                      s.tag === "OBD" ? "bg-gray-100 text-gray-600"
                      : s.tag === "Customer" ? "bg-amber-50 text-amber-600"
                      : "bg-green-50 text-green-600",
                    )}>
                      {s.tag}
                    </span>
                    <span className="text-[11px] text-gray-700 truncate">{s.value}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* View toggle */}
          <div className="flex items-center border border-gray-200 rounded-md overflow-hidden">
            <button
              type="button"
              onClick={() => { setViewMode("card"); sessionStorage.setItem("tm_view_mode", "card"); }}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium transition-colors",
                viewMode === "card" ? "bg-gray-50 text-gray-900" : "text-gray-400 hover:text-gray-600",
              )}
            >
              <LayoutGrid size={11} />
              Cards
            </button>
            <button
              type="button"
              onClick={() => { setViewMode("table"); sessionStorage.setItem("tm_view_mode", "table"); }}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium border-l border-gray-200 transition-colors",
                viewMode === "table" ? "bg-gray-50 text-gray-900" : "text-gray-400 hover:text-gray-600",
              )}
            >
              <TableIcon size={11} />
              Table
            </button>
          </div>

          <span className="text-[11px] text-gray-400" suppressHydrationWarning>
            {formatNow(now)}
          </span>
        </div>
      </div>

      {/* ── Row 2: Slots + Filter + Workload ─────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-5 py-1.5 flex items-center gap-2 sticky top-[42px] z-[39]">
        {/* Slot pills */}
        <div className="flex items-center gap-2 flex-1 overflow-x-auto">
          {slotSummary.map((slot) => {
            const closed = isSlotClosed(slot.slotTime, slot.isNextDay);
            const isActive = slotFilter === slot.id;
            const isDone = slot.tintPendingCount === 0;
            return (
              <button
                key={slot.id}
                type="button"
                onClick={() => setSlotFilter(isActive ? "all" : slot.id)}
                className={cn(
                  "inline-flex items-center gap-1 px-2.5 py-0.5 border rounded-md text-xs whitespace-nowrap h-7 flex-shrink-0 transition-colors",
                  closed && !isActive && "bg-gray-50 border-gray-100 text-gray-400",
                  isActive && "border-gray-900 text-gray-900 font-medium",
                  !closed && !isActive && "bg-white border-gray-200 text-gray-500 hover:border-gray-300",
                )}
              >
                {isDone && !isActive && (
                  <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {slot.name}
                {isActive && slot.tintPendingCount > 0 && (
                  <span className="text-[10px] text-gray-400 ml-0.5">{slot.tintPendingCount} pending</span>
                )}
                {!isActive && !isDone && slot.tintPendingCount > 0 && (
                  <span className="text-[10px] text-gray-400 ml-0.5">{slot.tintPendingCount}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right side: Filter dropdown + Workload dropdown */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Filter dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setFilterDropdownOpen((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1 border rounded-md text-[11px] font-medium transition-colors h-7",
                hasActiveFilters
                  ? "border-gray-900 text-gray-900"
                  : "border-gray-200 text-gray-500 hover:border-gray-300",
              )}
            >
              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
              </svg>
              Filter
              {hasActiveFilters && (
                <span className="text-[9px] font-bold bg-gray-900 text-white px-1.5 py-0.5 rounded-full">
                  {(delTypeFilter.size > 0 ? 1 : 0) + (priorityFilter !== "all" ? 1 : 0) + (typeFilter !== "all" ? 1 : 0) + (operatorFilter ? 1 : 0)}
                </span>
              )}
            </button>

            {filterDropdownOpen && (
              <>
                {/* Backdrop */}
                <div className="fixed inset-0 z-40" onClick={() => setFilterDropdownOpen(false)} />
                {/* Panel */}
                <div className="absolute right-0 top-full mt-1 w-[260px] bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-3 px-4">
                  {/* Del Type */}
                  <div className="mb-3">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Delivery Type</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(["Local", "Upcountry", "IGT", "Cross Depot"] as const).map((dt) => {
                        const isActive = delTypeFilter.has(dt);
                        const label = dt === "Upcountry" ? "UPC" : dt === "Cross Depot" ? "Cross" : dt;
                        return (
                          <button
                            key={dt}
                            type="button"
                            onClick={() => {
                              setDelTypeFilter((prev) => {
                                const next = new Set(prev);
                                if (next.has(dt)) next.delete(dt); else next.add(dt);
                                return next;
                              });
                            }}
                            className={cn(
                              "px-2.5 py-1 text-[11px] font-medium border rounded-md transition-colors",
                              isActive ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:border-gray-300",
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Priority */}
                  <div className="mb-3">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Priority</p>
                    <div className="flex gap-1.5">
                      {(["urgent", "normal"] as const).map((p) => {
                        const isActive = priorityFilter === p;
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setPriorityFilter(isActive ? "all" : p)}
                            className={cn(
                              "px-2.5 py-1 text-[11px] font-medium border rounded-md transition-colors",
                              isActive ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:border-gray-300",
                            )}
                          >
                            {p === "urgent" ? "Urgent" : "Normal"}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Type */}
                  <div className="mb-3">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Type</p>
                    <div className="flex gap-1.5">
                      {(["split", "whole"] as const).map((t) => {
                        const isActive = typeFilter === t;
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setTypeFilter(isActive ? "all" : t)}
                            className={cn(
                              "px-2.5 py-1 text-[11px] font-medium border rounded-md transition-colors",
                              isActive ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:border-gray-300",
                            )}
                          >
                            {t === "split" ? "Split" : "Whole"}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Operator */}
                  <div className="mb-3">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Operator</p>
                    <select
                      value={operatorFilter}
                      onChange={(e) => setOperatorFilter(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-[11px] border border-gray-200 rounded-md text-gray-600 focus:outline-none focus:border-gray-400 bg-white"
                    >
                      <option value="">All Operators</option>
                      {operators.map((op) => (
                        <option key={op.id} value={op.name ?? ""}>
                          {op.name ?? `Operator ${op.id}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Clear */}
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={() => { clearAllFilters(); setFilterDropdownOpen(false); }}
                      className="w-full text-center text-[11px] font-medium text-gray-400 hover:text-gray-600 py-1 transition-colors"
                    >
                      Clear all filters
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Workload dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setWorkloadBarOpen((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1 border rounded-md text-[11px] font-medium transition-colors h-7",
                workloadBarOpen
                  ? "border-gray-900 text-gray-900"
                  : "border-gray-200 text-gray-500 hover:border-gray-300",
              )}
            >
              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
              </svg>
              Workload
            </button>

            {workloadBarOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setWorkloadBarOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-[300px] bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-3 px-4">
                  {operatorWorkload.length === 0 ? (
                    <p className="text-[11px] text-gray-400 italic py-2">No operators with active work.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {operatorWorkload.map((op) => (
                        <div
                          key={op.name}
                          className="flex items-center gap-2 p-2 rounded-lg border border-gray-100 hover:border-gray-200 transition-colors"
                        >
                          <div className="w-6 h-6 rounded-full bg-teal-600 text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                            {op.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2)}
                          </div>
                          <span className="text-[11px] font-medium text-gray-700 flex-1">{op.name}</span>
                          <div className="flex items-center gap-1">
                            {op.assigned > 0 && (
                              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">{op.assigned}</span>
                            )}
                            {op.inProgress > 0 && (
                              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">{op.inProgress}</span>
                            )}
                            {op.done > 0 && (
                              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-green-50 text-green-700">{op.done}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      </div>{/* ── END OLD HEADER (hidden) ── */}

      {/* ── Kanban board ─────────────────────────────────────────────────── */}
      {viewMode === "card" && (
      <div className="px-3 pb-6">
        <div className="grid grid-cols-4 gap-2 mt-2">
          {COLUMNS.map((col) => {
            const volumeByStage: Record<string, number> = {
              pending_tint_assignment: pendingVolume,
              tint_assigned:           assignedVolume,
              tinting_in_progress:     inProgressVolume,
              completed:               doneVolume,
            };
            const colVolume = volumeByStage[col.stage] ?? 0;
            const isPendingCol = col.stage === "pending_tint_assignment";

            const colOrderItems: TintOrder[] = col.stage === "pending_tint_assignment"
              ? filteredOrders
                  .filter((o) =>
                    o.workflowStage === "pending_tint_assignment" ||
                    ((o.workflowStage === "tint_assigned" || o.workflowStage === "tinting_in_progress") &&
                     (o.remainingQty ?? 0) > 0)
                  )
                  .sort((a, b) => {
                    const tsA = a.orderDateTime ? new Date(a.orderDateTime).getTime() : buildTs(a.obdEmailDate, a.obdEmailTime);
                    const tsB = b.orderDateTime ? new Date(b.orderDateTime).getTime() : buildTs(b.obdEmailDate, b.obdEmailTime);
                    return tsA - tsB;
                  })
              : col.stage === "tint_assigned"
              ? filteredOrders.filter((o) => o.workflowStage === "tint_assigned" && (o.remainingQty ?? 0) === 0)
                  .sort((a, b) => {
                    const seqDiff = (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0)
                    if (seqDiff !== 0) return seqDiff
                    const priDiff = (a.priorityLevel ?? 5) - (b.priorityLevel ?? 5)
                    if (priDiff !== 0) return priDiff
                    const tsA = a.orderDateTime ? new Date(a.orderDateTime).getTime() : buildTs(a.obdEmailDate, a.obdEmailTime);
                    const tsB = b.orderDateTime ? new Date(b.orderDateTime).getTime() : buildTs(b.obdEmailDate, b.obdEmailTime);
                    return tsA - tsB;
                  })
              : col.stage === "tinting_in_progress"
              ? filteredOrders.filter((o) => o.workflowStage === "tinting_in_progress" && (o.remainingQty ?? 0) === 0)
              : filteredOrders.filter((o) => o.workflowStage === "pending_support");

            const colSplitItems: SplitCard[] = isPendingCol
              ? []
              : col.stage === "tint_assigned"
              ? filteredActiveSplits.filter((s) => s.status === "tint_assigned")
                  .sort((a, b) => {
                    const seqDiff = (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0)
                    if (seqDiff !== 0) return seqDiff
                    const priDiff = (a.priorityLevel ?? 5) - (b.priorityLevel ?? 5)
                    if (priDiff !== 0) return priDiff
                    const tsA = a.orderDateTime ? new Date(a.orderDateTime).getTime() : buildTs(a.obdEmailDate, a.obdEmailTime);
                    const tsB = b.orderDateTime ? new Date(b.orderDateTime).getTime() : buildTs(b.obdEmailDate, b.obdEmailTime);
                    return tsA - tsB;
                  })
              : col.stage === "tinting_in_progress"
              ? filteredActiveSplits.filter((s) => s.status === "tinting_in_progress")
              : filteredCompletedSplits;

            // For the Completed column, also include whole-OBD assignments shaped as TintOrder
            const colAssignmentItems: TintOrder[] = col.stage === "completed"
              ? (() => {
                  const existingOrderIds = new Set(colOrderItems.map((o) => o.id));
                  return completedAssignments
                    .filter((a) => !existingOrderIds.has(a.order.id))
                    .map((a): TintOrder => ({
                      id:                 a.order.id,
                      obdNumber:          a.order.obdNumber,
                      workflowStage:      "pending_support",
                      dispatchSlot:       null,
                      dispatchStatus:     null,
                      priorityLevel:      5,
                      sequenceOrder:      null,
                      createdAt:          a.completedAt ?? "",
                      shipToCustomerName: a.order.shipToCustomerName,
                      shipToCustomerId:   null,
                      customerMissing:    false,
                      smu:                a.smu,
                      obdEmailDate:       a.obdEmailDate,
                      obdEmailTime:       a.obdEmailTime,
                      orderDateTime:      a.orderDateTime,
                      slotId:             a.slotId,
                      slotName:           a.slotName,
                      slotTime:           a.slotTime,
                      slotIsNextDay:      a.slotIsNextDay,
                      originalSlotId:     a.originalSlotId,
                      originalSlotName:   a.originalSlotName,
                      deliveryTypeName:   a.deliveryTypeName,
                      customer:           a.order.customer ?? null,
                      querySnapshot:      a.order.querySnapshot ?? null,
                      tintAssignments: [{
                        id:          a.id,
                        status:      "tinting_done",
                        assignedTo:  a.assignedTo,
                        startedAt:   null,
                        completedAt: a.completedAt,
                        updatedAt:   a.completedAt ?? "",
                      }],
                      lineItems:      [],
                      existingSplits: [],
                      splits:         [],
                      remainingQty:   0,
                    }));
                })()
              : [];

            const allColItems: ColItem[] = [
              ...colOrderItems.map((o) => ({ type: "order" as const, data: o })),
              ...colAssignmentItems.map((o) => ({ type: "order" as const, data: o })),
              ...colSplitItems.map((s) => ({ type: "split" as const, data: s })),
            ];

            const itemCount  = allColItems.length;
            const page       = pages[col.stage] ?? 0;
            const totalPages = Math.ceil(itemCount / CARDS_PER_PAGE);
            const pageItems  = allColItems.slice(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE);

            return (
              <div
                key={col.stage}
                className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden"
              >
                {/* Column header */}
                <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full flex-shrink-0", col.dot)} />
                  <span className="text-[13px] font-bold text-gray-900 flex-1">{col.label}</span>
                  <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full", col.pillClass)}>
                    {itemCount}
                  </span>
                  <span className="text-[11px] text-gray-400 font-medium">
                    {colVolume > 0 ? `${Math.round(colVolume).toLocaleString()} L` : "— L"}
                  </span>
                </div>

                {/* Card list */}
                <div className="p-2 flex flex-col gap-2">
                  {itemCount === 0 ? (
                    <div className="flex flex-col items-center py-12 text-center">
                      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                        <Layers className="h-5 w-5 text-gray-400" />
                      </div>
                      <p className="text-[13px] font-semibold text-gray-500">No orders</p>
                      <p className="text-[12px] text-gray-400 mt-1">Nothing in this column</p>
                    </div>
                  ) : (
                    pageItems.map((item) =>
                      item.type === "order" ? (
                        <KanbanCard
                          key={`o-${item.data.id}`}
                          order={item.data}
                          stage={col.stage}
                          onAssign={() => openAssignModal(item.data)}
                          onCreateSplit={() => openSplitBuilder(item.data)}
                          onRefresh={() => { void fetchOrders(); }}
                          onMoveUp={() => handleReorder("order", item.data.id, "up")}
                          onMoveDown={() => handleReorder("order", item.data.id, "down")}
                          onViewDetail={() => setDetailOrderId(item.data.id)}
                          onCustomerMissing={() => { setMissingSheetOrder(item.data); setMissingSheetOpen(true); }}
                        />
                      ) : (
                        <SplitKanbanCard
                          key={`s-${item.data.id}`}
                          split={item.data}
                          colStage={col.stage}
                          onReassign={() => openSplitReassign(item.data)}
                          onCancel={() => { void handleCancelSplit(item.data.id); }}
                          onRefresh={() => { void fetchOrders(); }}
                          onMoveUp={() => handleReorder("split", item.data.id, "up")}
                          onMoveDown={() => handleReorder("split", item.data.id, "down")}
                          onViewDetail={() => setDetailOrderId(item.data.order.id)}
                        />
                      )
                    )
                  )}
                </div>

                {/* Per-column pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-3 pb-3 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        setPages((p) => ({ ...p, [col.stage]: Math.max(0, page - 1) }))
                      }
                      disabled={page === 0}
                      className="text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-30 px-2 py-1"
                    >
                      ←
                    </button>
                    <span className="text-[11px] text-gray-500 font-medium">
                      {page + 1} / {totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPages((p) => ({
                          ...p,
                          [col.stage]: Math.min(totalPages - 1, page + 1),
                        }))
                      }
                      disabled={page >= totalPages - 1}
                      className="text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-30 px-2 py-1"
                    >
                      →
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* ── Table view ───────────────────────────────────────────────────── */}
      {viewMode === "table" && (
        <TintTableView
          filteredOrders={filteredOrders}
          filteredActiveSplits={filteredActiveSplits}
          filteredCompletedSplits={filteredCompletedSplits}
          completedAssignments={completedAssignments}
          onOrderClick={(order) => setDetailOrderId(order.id)}
          onSplitClick={(split) => {
            const colStage: ColStage = split.status === "tint_assigned"
              ? "tint_assigned"
              : split.status === "tinting_in_progress"
              ? "tinting_in_progress"
              : "completed";
            setTableSplitData({ splitId: split.id, orderId: split.order.id, colStage });
            setTableSplitOpen(true);
          }}
          onStatusPopover={handleTableStatusPopover}
          onAssign={(order) => openAssignModal(order)}
          onCreateSplit={(order) => openSplitBuilder(order)}
          onMoveUp={(id, type) => { void handleReorder(type, id, "up"); }}
          onMoveDown={(id, type) => { void handleReorder(type, id, "down"); }}
          onCancelAssignment={(order) => { void handleCancelAssignment(order); }}
          onReassignSplit={(split) => openSplitReassign(split)}
          onCancelSplit={(split) => { void handleCancelSplit(split.id); }}
          onCustomerMissing={(order) => { setMissingSheetOrder(order); setMissingSheetOpen(true); }}
        />
      )}

      {/* ── Split Builder modal ──────────────────────────────────────────── */}
      {splitBuilderOrder && (
        <SplitBuilderModal
          open={splitBuilderOpen}
          onClose={() => { setSplitBuilderOpen(false); setSplitBuilderOrder(null); }}
          order={splitBuilderOrder}
          operators={operators.filter((op): op is { id: number; name: string } => op.name !== null)}
          onSuccess={() => { void fetchOrders(); }}
        />
      )}

      {/* ── Split Re-assign modal ────────────────────────────────────────── */}
      {splitReassignOpen && selectedSplitForReassign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setSplitReassignOpen(false)}
          />
          <div className="relative bg-white rounded-[14px] shadow-xl w-[400px] overflow-hidden border border-gray-200">
            <div className="px-5 pt-5 pb-4 border-b border-gray-200">
              <p className="text-[15px] font-bold text-gray-900">Re-assign Split</p>
              <p className="text-[12px] text-gray-400 mt-1">
                <ObdCode code={selectedSplitForReassign.order.obdNumber} />
                {" · Split #"}
                {selectedSplitForReassign.splitNumber}
              </p>
            </div>

            <div className="px-5 pt-4 pb-2 max-h-[260px] overflow-y-auto">
              {operators.length === 0 ? (
                <p className="text-[12px] text-gray-400 py-4 text-center">No operators available</p>
              ) : (
                operators.map((op) => {
                  const isSelected = splitReassignedToId === String(op.id);
                  return (
                    <div
                      key={op.id}
                      onClick={() => setSplitReassignedToId(String(op.id))}
                      className={cn(
                        "flex items-center gap-3 p-3.5 border-[1.5px] rounded-xl mb-2 cursor-pointer transition-all",
                        isSelected
                          ? "border-gray-900 bg-gray-50"
                          : "border-gray-200 hover:border-gray-300 hover:bg-gray-50",
                      )}
                    >
                      <div className="w-9 h-9 rounded-full bg-teal-600 text-white flex items-center justify-center text-[12px] font-bold flex-shrink-0">
                        {initials(op.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-gray-900">
                          {op.name ?? `Operator ${op.id}`}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">Available</p>
                      </div>
                      <div
                        className={cn(
                          "w-5 h-5 rounded-full bg-teal-600 text-white flex items-center justify-center text-[10px] transition-opacity flex-shrink-0",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      >
                        ✓
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {splitReassignError && (
              <div className="flex items-center gap-2.5 mx-5 mb-3 p-3.5 bg-red-50 border border-red-200 rounded-xl text-[12.5px]">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <span className="text-red-700 font-medium">{splitReassignError}</span>
                <button className="ml-auto text-[12px] text-red-600 underline" onClick={handleSplitReassign}>
                  Retry
                </button>
              </div>
            )}

            <div className="px-5 pb-5 pt-3 border-t border-gray-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSplitReassignOpen(false)}
                className="text-[12.5px] font-semibold text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSplitReassign}
                disabled={!splitReassignedToId || isSplitReassigning}
                className="text-[12.5px] font-semibold text-white bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSplitReassigning && <Loader2 className="animate-spin" size={14} />}
                Confirm Re-assign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Assignment modal ─────────────────────────────────────────────── */}
      {assignModalOpen && selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={closeAssignModal} />
          <div className="relative bg-white rounded-[14px] shadow-xl w-[400px] overflow-hidden border border-gray-200">
            <div className="px-5 pt-5 pb-4 border-b border-gray-200">
              <p className="text-[15px] font-bold text-gray-900">
                {isReassign ? "Re-assign Operator" : "Assign Operator"}
              </p>
              <p className="text-[12px] text-gray-400 mt-1">
                <ObdCode code={selectedOrder.obdNumber} />
                {" · "}
                {assignCustomerName}
              </p>
            </div>

            {(selectedOrder.workflowStage === "pending_tint_assignment" ||
              selectedOrder.workflowStage === "tint_assigned") && (
              <>
                <div className="px-5 pt-4 pb-2 max-h-[260px] overflow-y-auto">
                  {operators.length === 0 ? (
                    <p className="text-[12px] text-gray-400 py-4 text-center">No operators available</p>
                  ) : (
                    operators.map((op) => {
                      const isSelected = assignedToId === String(op.id);
                      return (
                        <div
                          key={op.id}
                          onClick={() => setAssignedToId(String(op.id))}
                          className={cn(
                            "flex items-center gap-3 p-3.5 border-[1.5px] rounded-xl mb-2 cursor-pointer transition-all",
                            isSelected
                              ? "border-gray-900 bg-gray-50"
                              : "border-gray-200 hover:border-gray-300 hover:bg-gray-50",
                          )}
                        >
                          <div className="w-9 h-9 rounded-full bg-teal-600 text-white flex items-center justify-center text-[12px] font-bold flex-shrink-0">
                            {initials(op.name)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold text-gray-900">
                              {op.name ?? `Operator ${op.id}`}
                            </p>
                            <p className="text-[11px] text-gray-400 mt-0.5">Available</p>
                          </div>
                          <div
                            className={cn(
                              "w-5 h-5 rounded-full bg-teal-600 text-white flex items-center justify-center text-[10px] transition-opacity flex-shrink-0",
                              isSelected ? "opacity-100" : "opacity-0",
                            )}
                          >
                            ✓
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="px-5 pb-3">
                  <label className="text-[11.5px] font-semibold text-gray-600 block mb-1.5">
                    Note (optional)
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Any tinting instructions…"
                    rows={2}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[12.5px] text-gray-800 placeholder:text-gray-400 focus:border-gray-700 focus:outline-none resize-none"
                  />
                </div>

                {assignError && (
                  <div className="flex items-center gap-2.5 mx-5 mb-3 p-3.5 bg-red-50 border border-red-200 rounded-xl text-[12.5px]">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <span className="text-red-700 font-medium">{assignError}</span>
                    <button className="ml-auto text-[12px] text-red-600 underline" onClick={handleAssign}>
                      Retry
                    </button>
                  </div>
                )}

                <div className="px-5 pb-5 pt-3 border-t border-gray-200 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeAssignModal}
                    className="text-[12.5px] font-semibold text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAssign}
                    disabled={!assignedToId || isAssigning}
                    className="text-[12.5px] font-semibold text-white bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAssigning && <Loader2 className="animate-spin" size={14} />}
                    {isReassign ? "Confirm Re-assign" : "Assign Operator"}
                  </button>
                </div>
              </>
            )}

            {(selectedOrder.workflowStage === "tinting_in_progress" ||
              selectedOrder.workflowStage === "pending_support") && (
              <div className="px-5 pt-5 pb-5">
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[12.5px] text-amber-700 font-medium">
                  {selectedOrder.workflowStage === "tinting_in_progress"
                    ? "Tinting is in progress — assignment cannot be changed."
                    : "Tinting is complete — assignment cannot be changed."}
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={closeAssignModal}
                    className="text-[12.5px] font-semibold text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Table view: Split detail sheet ────────────────────────────────── */}
      {tableSplitData && (
        <SplitDetailSheet
          open={tableSplitOpen}
          onClose={() => setTableSplitOpen(false)}
          splitId={tableSplitData.splitId}
          orderId={tableSplitData.orderId}
          colStage={tableSplitData.colStage}
          onReassign={() => setTableSplitOpen(false)}
          onCancel={() => { setTableSplitOpen(false); void fetchOrders(); }}
        />
      )}

      {/* ── Table view: Status popover ─────────────────────────────────────── */}
      {tablePopover && (
        <StatusPopover
          position={tablePopover.position}
          anchorRef={tableAnchorRef as RefObject<HTMLButtonElement>}
          currentDispatch={tablePopover.currentDispatch}
          currentPriority={tablePopover.currentPriority}
          onSave={handleTableStatusSave}
          onClose={() => setTablePopover(null)}
          isSaving={tablePopoverSaving}
        />
      )}

      {/* ── Customer Missing Sheet ─────────────────────────────────────────── */}
      <CustomerMissingSheet
        open={missingSheetOpen}
        onOpenChange={setMissingSheetOpen}
        shipToCustomerId={missingSheetOrder?.shipToCustomerId}
        shipToCustomerName={missingSheetOrder?.shipToCustomerName}
        onResolved={() => { setMissingSheetOpen(false); void fetchOrders(); }}
      />

      {/* ── Order Detail Panel ────────────────────────────────────────────── */}
      <OrderDetailPanel
        orderId={detailOrderId}
        onClose={() => setDetailOrderId(null)}
      />

    </div>
  );
}
