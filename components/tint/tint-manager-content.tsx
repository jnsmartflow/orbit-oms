"use client";

import { useState, useEffect, useCallback, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  Loader2, Clock, CheckCircle2, Zap, Gift,
  AlertCircle, Layers,
  Eye, Plus, MoreHorizontal, UserPlus, RefreshCw, X, Scissors,
  Truck, Search, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/status-badge";
import { ObdCode } from "@/components/shared/obd-code";
import { SkuDetailsSheet } from "@/components/tint/sku-details-sheet";
import { SplitBuilderModal } from "@/components/tint/split-builder-modal";
import type { SplitBuilderModalProps } from "@/components/tint/split-builder-modal";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TintAssignmentInfo {
  id:          number;
  status:      string;
  assignedTo:  { id: number; name: string | null };
  startedAt:   string | null;
  completedAt: string | null;
  updatedAt:   string;
}

interface TintOrder {
  id:                 number;
  obdNumber:          string;
  workflowStage:      string;
  dispatchSlot:       string | null;
  dispatchStatus:     string | null;
  priorityLevel:      number;
  sequenceOrder:      number | null;
  createdAt:          string;
  shipToCustomerName: string | null;
  smu:                string | null;
  obdEmailDate:       string | null;
  obdEmailTime:       string | null;
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

interface SplitCard {
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
  smu:            string | null;
  obdEmailDate:   string | null;
  obdEmailTime:   string | null;
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

interface Operator {
  id:   number;
  name: string | null;
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

function formatObdDateTime(date: string | null, time: string | null): string {
  if (!date) return "";
  const d = new Date(date);
  const dateStr = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return time ? `${dateStr} ${time}` : dateStr;
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
      className="bg-white border border-[#e2e5f1] rounded-xl shadow-lg p-3.5 w-[210px]"
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
                  : "bg-[#EEEDFE] border-[#AFA9EC] text-[#3C3489]"
                : "bg-white border-[#cdd1e8] text-gray-400 hover:bg-[#f7f8fc]",
            )}
          >
            {p === "urgent" ? "🚨 Urgent" : "Normal"}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="border-t border-[#f0f1f8] mb-3" />

      {/* Dispatch status — compact horizontal toggle */}
      <p className="text-[10px] font-bold uppercase tracking-[.4px] text-gray-400 mb-1.5">
        Dispatch Status
      </p>
      <div className="flex gap-1 p-0.5 bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg mb-3">
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
            ? "bg-[#1a237e] text-white hover:bg-[#1a237e]/90"
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
    dot:       "bg-indigo-400",
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
  order:          TintOrder;
  stage:          ColStage;
  onAssign:       () => void;
  onCreateSplit:  () => void;
  onRefresh:      () => void;
  onMoveUp:       () => void;
  onMoveDown:     () => void;
}

function KanbanCard({ order, stage, onAssign, onCreateSplit, onRefresh, onMoveUp, onMoveDown }: KanbanCardProps) {
  const [skuSheetOpen, setSkuSheetOpen] = useState(false);
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
        "bg-white border border-[#e2e5f1] rounded-xl overflow-hidden shadow-sm cursor-pointer",
        "hover:shadow-md hover:border-[#cdd1e8] transition-all duration-150",
      )}
    >
      {/* Top accent bar */}
      <div className={cn(
        "h-[3px] w-full",
        isPending    ? "bg-gradient-to-r from-indigo-500 to-indigo-300"
        : isAssigned   ? "bg-gradient-to-r from-amber-400 to-amber-300"
        : isInProgress ? "bg-gradient-to-r from-blue-500 to-blue-300"
        : "bg-gradient-to-r from-green-600 to-green-400",
      )} />

      <div className="px-3.5 pt-3 pb-3">
        {/* 1. Icons + badges */}
        <div className="mb-2">
          {/* Icon row */}
          <div className="flex items-center justify-end gap-1 h-[24px]">
            {/* Eye icon */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setSkuSheetOpen(true); }}
              className="w-[26px] h-[26px] rounded-lg flex items-center justify-center text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
              title="View SKU lines"
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
                    ? "bg-[#1a237e] text-white"
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
                  className="absolute right-0 top-8 z-50 bg-white border border-[#e2e5f1] rounded-xl shadow-lg py-1 min-w-[130px] max-w-[150px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {order.workflowStage === "pending_tint_assignment" && (
                    <>
                      {!hasSplits && (
                        <>
                          <button
                            type="button"
                            onClick={() => { setMenuOpen(false); onAssign(); }}
                            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-[#f7f8fc] transition-colors whitespace-nowrap"
                          >
                            <UserPlus size={12} className="text-gray-400 flex-shrink-0" />
                            Assign
                          </button>
                          <div className="mx-3 border-t border-[#f0f1f8]" />
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => { setMenuOpen(false); onCreateSplit(); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-[#f7f8fc] transition-colors whitespace-nowrap"
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
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-[#f7f8fc] transition-colors whitespace-nowrap"
                      >
                        <ChevronUp size={12} className="text-gray-400 flex-shrink-0" />
                        Move Up
                      </button>
                      <button
                        type="button"
                        onClick={() => { setMenuOpen(false); onMoveDown(); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-[#f7f8fc] transition-colors whitespace-nowrap"
                      >
                        <ChevronDown size={12} className="text-gray-400 flex-shrink-0" />
                        Move Down
                      </button>
                      <div className="mx-3 border-t border-[#f0f1f8]" />
                      <button
                        type="button"
                        onClick={() => { setMenuOpen(false); onAssign(); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-[#f7f8fc] transition-colors whitespace-nowrap"
                      >
                        <RefreshCw size={12} className="text-gray-400 flex-shrink-0" />
                        Re-assign
                      </button>
                      <div className="mx-3 border-t border-[#f0f1f8]" />
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
          </div>
          {/* Badge row */}
          <div className="flex items-center gap-1.5 flex-wrap min-h-[22px]">
            {isDone ? (
              <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-200 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                ✓ Done
              </span>
            ) : (
              <StatusBadge variant={isUrgent ? "urgent" : "normal"} size="sm" />
            )}
            <DispatchStatusBadge status={order.dispatchStatus ?? null} />
          </div>
        </div>

        {/* 2. Customer name */}
        <p className="text-[13.5px] font-bold text-gray-900 leading-snug mb-1">{customerName}</p>

        {/* 3. OBD + area */}
        <div className="flex items-center gap-1 text-[11px] text-gray-400 mb-2.5">
          <ObdCode code={order.obdNumber} />
          <span>·</span>
          <span>{areaName}</span>
          {formatObdDateTime(order.obdEmailDate, order.obdEmailTime) && (
            <>
              <span>·</span>
              <span>{formatObdDateTime(order.obdEmailDate, order.obdEmailTime)}</span>
            </>
          )}
        </div>

        {/* 4. Info grid */}
        <div className="bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg p-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
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
              <div className="text-[12px] font-semibold text-gray-900">{cell.value}</div>
            </div>
          ))}
        </div>

        {/* Split status indicator */}
        {activeSplits.length > 0 && (
          <div className="mt-2 mb-0 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
              <span className="text-[11px] font-semibold text-amber-700">
                {activeSplits.length} Split{activeSplits.length > 1 ? "s" : ""} Active
              </span>
            </div>
            <span className="text-[11px] text-amber-600 font-medium">
              {remainingQty > 0 ? `${remainingQty} remaining` : "Fully assigned"}
            </span>
          </div>
        )}

        {/* 5. Bottom section — per stage */}
        {isPending && (
          <div className="mt-2.5 pt-2.5 border-t border-[#e2e5f1]">
            {hasSplits ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onCreateSplit(); }}
                className="w-full flex items-center justify-center gap-2 bg-white border border-[#1a237e] text-[#1a237e] rounded-lg py-3 text-[12px] font-semibold hover:bg-[#e8eaf6] transition-colors"
              >
                <Scissors size={13} />
                Create Split
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAssign(); }}
                className="w-full flex items-center justify-center gap-2 bg-[#1a237e] text-white rounded-lg py-3 text-[12px] font-semibold hover:bg-[#1a237e]/90 transition-colors"
              >
                <UserPlus size={13} />
                Assign
              </button>
            )}
          </div>
        )}

        {isAssigned && (
          <div className="mt-2.5 pt-2.5 border-t border-[#e2e5f1]">
            <div className="flex items-center gap-2.5 bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-[#1a237e] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
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
          <div className="mt-2.5 pt-2.5 border-t border-[#e2e5f1]">
            <div className="flex items-center gap-2.5 bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-[#378ADD] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
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
          <div className="mt-2.5 pt-2.5 border-t border-[#e2e5f1]">
            <div className="flex items-center gap-2.5 bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-[#639922] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                {operatorInitials}
              </div>
              <span className="text-[12px] font-semibold text-gray-900 flex-1 truncate">
                {operatorName}
              </span>
              <span className="text-[11px] text-gray-400 flex-shrink-0">
                {formatTime(assignment?.completedAt)}
              </span>
            </div>
            <div className="mt-2 pt-2 border-t border-[#e2e5f1] flex items-center gap-2">
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
                <span className="bg-[#eff6ff] border border-[#bfdbfe] text-[#1e40af] text-[10.5px] font-semibold px-2.5 py-1 rounded-full">
                  Pending Support
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>

    <SkuDetailsSheet
      open={skuSheetOpen}
      onClose={() => { setSkuSheetOpen(false); setMenuOpen(false); }}
      obdNumber={order.obdNumber}
      customerName={customerName}
      lineItems={order.lineItems ?? []}
      splits={order.splits ?? []}
    />
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
      <div className="relative bg-white h-full w-[420px] flex flex-col border-l border-[#e2e5f1] shadow-xl overflow-hidden">

        {/* Header */}
        <div className="px-6 py-5 border-b border-[#e2e5f1] flex-shrink-0">
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
                <div className="flex items-center gap-2.5 bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg px-3 py-2">
                  <div className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0",
                    isDone ? "bg-[#639922]" : colStage === "tinting_in_progress" ? "bg-[#378ADD]" : "bg-[#1a237e]",
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
                    className="mt-2 w-full flex items-center justify-center gap-2 bg-white border border-[#1a237e] text-[#1a237e] rounded-lg py-2 text-[12px] font-semibold hover:bg-[#e8eaf6] transition-colors"
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
                      className="bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg px-3 py-2 text-[11px]"
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
                        <span className="bg-[#eff6ff] border border-[#bfdbfe] text-[#1e40af] text-[11px] font-semibold px-2.5 py-1 rounded-full">Pending Support</span>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="border-t border-[#e2e5f1]" />

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
                          isCurrent ? "border-[#1a237e] bg-[#e8eaf6]" : "bg-[#f7f8fc] border-[#e2e5f1]",
                        )}
                      >
                        {/* Header row */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[12px] font-bold text-gray-800">Split #{s.splitNumber}</span>
                            {isCurrent && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#1a237e] text-white">current</span>
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
                                ? "bg-indigo-50 text-indigo-700 border-indigo-200"
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
                            <div className="w-5 h-5 rounded-full bg-[#1a237e] flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
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
        <div className="px-5 py-4 border-t border-[#e2e5f1] flex items-center justify-end gap-2 bg-white flex-shrink-0">
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
            className="px-4 py-2 text-[12px] font-semibold text-gray-600 border border-[#e2e5f1] rounded-lg hover:bg-[#f7f8fc] transition-colors"
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
  split, colStage, onReassign, onCancel, onRefresh, onMoveUp, onMoveDown,
}: {
  split:      SplitCard;
  colStage:   ColStage;
  onReassign: () => void;
  onCancel:   () => void;
  onRefresh:  () => void;
  onMoveUp:   () => void;
  onMoveDown: () => void;
}) {
  const [menuOpen,       setMenuOpen]       = useState(false);
  const [popoverOpen,    setPopoverOpen]    = useState(false);
  const [popoverPos,     setPopoverPos]     = useState<{ top: number; right: number } | null>(null);
  const [isSaving,       setIsSaving]       = useState(false);
  const [skuSheetOpen,   setSkuSheetOpen]   = useState(false);
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
        "bg-white border border-[#e2e5f1] rounded-xl overflow-hidden shadow-sm",
        "hover:shadow-md hover:border-[#cdd1e8] transition-all duration-150",
      )}
    >
      {/* Top accent bar */}
      <div className={cn(
        "h-[3px] w-full",
        isDone       ? "bg-gradient-to-r from-green-600 to-green-400"
        : isInProgress ? "bg-gradient-to-r from-blue-500 to-blue-300"
        : "bg-gradient-to-r from-amber-400 to-amber-300",
      )} />

      <div className="px-3.5 pt-3 pb-3">
        {/* Icons + badges */}
        <div className="mb-2">
          {/* Icon row */}
          <div className="flex items-center justify-end gap-1 h-[24px]">
            {/* ⊞ button — opens Split Detail sheet */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); console.log('Layers clicked, splitId:', split.id, 'orderId:', split.order.id); setSplitSheetOpen(true); }}
              className="w-[26px] h-[26px] rounded-lg flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
              title="View split details"
            >
              <Layers size={14} />
            </button>

            {/* 👁 button — opens SKU sheet */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setSkuSheetOpen(true); }}
              className="w-[26px] h-[26px] rounded-lg flex items-center justify-center text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
              title="View SKU lines"
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
                    ? "bg-[#1a237e] text-white"
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
                  className="absolute right-0 top-8 z-50 bg-white border border-[#e2e5f1] rounded-xl shadow-lg py-1 min-w-[130px] max-w-[150px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {split.status === "tint_assigned" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => { setMenuOpen(false); onMoveUp(); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-[#f7f8fc] transition-colors whitespace-nowrap"
                      >
                        <ChevronUp size={12} className="text-gray-400 flex-shrink-0" />
                        Move Up
                      </button>
                      <button
                        type="button"
                        onClick={() => { setMenuOpen(false); onMoveDown(); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-[#f7f8fc] transition-colors whitespace-nowrap"
                      >
                        <ChevronDown size={12} className="text-gray-400 flex-shrink-0" />
                        Move Down
                      </button>
                      <div className="mx-3 border-t border-[#f0f1f8]" />
                      <button
                        type="button"
                        onClick={() => { setMenuOpen(false); onReassign(); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-gray-700 hover:bg-[#f7f8fc] transition-colors whitespace-nowrap"
                      >
                        <RefreshCw size={12} className="text-gray-400 flex-shrink-0" />
                        Re-assign
                      </button>
                      <div className="mx-3 border-t border-[#f0f1f8]" />
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
            <StatusBadge variant={isUrgent ? "urgent" : "normal"} size="sm" />
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
          <ObdCode code={split.order.obdNumber} />
          {formatObdDateTime(split.obdEmailDate, split.obdEmailTime) && (
            <>
              <span>·</span>
              <span>{formatObdDateTime(split.obdEmailDate, split.obdEmailTime)}</span>
            </>
          )}
        </div>

        {/* Info grid */}
        <div className="bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg p-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
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
              <div className="text-[12px] font-semibold text-gray-900">{cell.value}</div>
            </div>
          ))}
        </div>

        {/* Operator row */}
        <div className="mt-3 pt-3 border-t border-[#e2e5f1]">
          <div className="flex items-center gap-2.5 bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg px-3 py-2">
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0",
              isDone       ? "bg-[#639922]"
              : isInProgress ? "bg-[#378ADD]"
              : "bg-[#1a237e]",
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
          <div className="mt-2 pt-2 border-t border-[#e2e5f1] flex items-center gap-2">
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
              <span className="bg-[#eff6ff] border border-[#bfdbfe] text-[#1e40af] text-[10.5px] font-semibold px-2.5 py-1 rounded-full">
                Pending Support
              </span>
            )}
          </div>
        )}
      </div>
    </div>

    <SkuDetailsSheet
      open={skuSheetOpen}
      onClose={() => setSkuSheetOpen(false)}
      obdNumber={split.order.obdNumber}
      customerName={customerName}
      lineItems={split.lineItems.map((li) => ({
        id:                li.rawLineItemId,
        skuCodeRaw:        li.rawLineItem.skuCodeRaw,
        skuDescriptionRaw: li.rawLineItem.skuDescriptionRaw ?? null,
        unitQty:           li.assignedQty,
        volumeLine:        li.rawLineItem.volumeLine ?? null,
        isTinting:         li.rawLineItem.isTinting ?? true,
      }))}
      splits={[]}
    />

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
  const [orders,          setOrders]          = useState<TintOrder[]>([]);
  const [activeSplits,    setActiveSplits]    = useState<SplitCard[]>([]);
  const [completedSplits, setCompletedSplits] = useState<SplitCard[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [now,       setNow]       = useState<Date>(() => new Date());

  const [slotFilter,         setSlotFilter]         = useState<"all" | "10:30" | "12:30" | "15:30">("all");
  const [priorityFilter,     setPriorityFilter]     = useState<"all" | "urgent" | "normal">("all");
  const [dispatchFilter,     setDispatchFilter]     = useState<"all" | "dispatch" | "hold" | "waiting_for_confirmation">("all");
  const [typeFilter,         setTypeFilter]         = useState<"all" | "split" | "whole">("all");
  const [searchQuery,        setSearchQuery]        = useState("");
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const [workloadBarOpen,    setWorkloadBarOpen]    = useState(false);
  const [operatorFilter,     setOperatorFilter]     = useState("");
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

  const [showColStrip, setShowColStrip] = useState(false);

  // ── Clock ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function handleScroll() {
      setShowColStrip(window.scrollY > 180);
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

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
        orders:          TintOrder[];
        activeSplits:    SplitCard[];
        completedSplits: SplitCard[];
      };
      setOrders(data.orders);
      setActiveSplits(data.activeSplits);
      setCompletedSplits(data.completedSplits);
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
          orders:          TintOrder[];
          activeSplits:    SplitCard[];
          completedSplits: SplitCard[];
        };
        const opsData    = (await opsRes.json())    as { operators: Operator[] };
        setOrders(ordersData.orders);
        setActiveSplits(ordersData.activeSplits);
        setCompletedSplits(ordersData.completedSplits);
        setOperators(opsData.operators);
      } finally {
        setIsLoading(false);
      }
    }
    void init();
  }, [fetchOrders]);

  // ── Client-side filtering ─────────────────────────────────────────────────

  const filteredOrders = orders.filter((o) => {
    if (slotFilter !== "all" && !(o.dispatchSlot ?? "").includes(slotFilter)) return false;
    if (priorityFilter === "urgent" && !(o.priorityLevel <= 2)) return false;
    if (priorityFilter === "normal" && !(o.priorityLevel > 2)) return false;
    if (dispatchFilter !== "all" && o.dispatchStatus !== dispatchFilter) return false;
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
      const opName = o.tintAssignments[0]?.assignedTo.name ?? "";
      if (opName !== operatorFilter) return false;
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
    const pl = s.priorityLevel ?? 5;
    if (priorityFilter === "urgent" && !(pl <= 2)) return false;
    if (priorityFilter === "normal" && !(pl > 2)) return false;
    if (dispatchFilter !== "all" && s.dispatchStatus !== dispatchFilter) return false;
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
    const pl = s.priorityLevel ?? 5;
    if (priorityFilter === "urgent" && !(pl <= 2)) return false;
    if (priorityFilter === "normal" && !(pl > 2)) return false;
    if (dispatchFilter !== "all" && s.dispatchStatus !== dispatchFilter) return false;
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

  function clearAllFilters() {
    setSlotFilter("all");
    setPriorityFilter("all");
    setDispatchFilter("all");
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

  const slotCounts: Record<"all" | "10:30" | "12:30" | "15:30", number> = {
    "all":   orders.length,
    "10:30": orders.filter((o) => (o.dispatchSlot ?? "").includes("10:30")).length,
    "12:30": orders.filter((o) => (o.dispatchSlot ?? "").includes("12:30")).length,
    "15:30": orders.filter((o) => (o.dispatchSlot ?? "").includes("15:30")).length,
  };

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
    slotFilter !== "all" || priorityFilter !== "all" || dispatchFilter !== "all" ||
    typeFilter !== "all" || operatorFilter !== "" || searchQuery !== "";
  const activeParts: string[] = [];
  if (slotFilter !== "all")     activeParts.push(slotFilter);
  if (priorityFilter !== "all") activeParts.push(priorityFilter);
  if (dispatchFilter !== "all") activeParts.push(dispatchFilter.replace(/_/g, " "));
  if (typeFilter !== "all")     activeParts.push(typeFilter);
  if (operatorFilter)           activeParts.push(operatorFilter);
  if (searchQuery)              activeParts.push(`"${searchQuery}"`);

  // ── Loading state ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f0f2f8]">
        <div className="h-[52px] bg-white border-b border-[#e2e5f1]" />
        <div className="px-6 pb-6 mt-4">
          <div className="grid grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-[#f7f8fc] border border-[#e2e5f1] rounded-[14px] overflow-hidden">
                <div className="bg-white border-b border-[#e2e5f1] px-4 py-3">
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
    <div className="min-h-screen bg-[#f0f2f8]">

      {/* ── Topbar ───────────────────────────────────────────────────────── */}
      <div className="h-[52px] bg-white border-b border-[#e2e5f1] px-6 flex items-center sticky top-0 z-40">
        <div className="flex items-center flex-1">
          <h1 className="text-[17px] font-extrabold text-gray-900">Tint Manager</h1>
          <span className="bg-[#f7f8fc] border border-[#e2e5f1] text-[12px] text-gray-400 font-semibold px-2.5 py-0.5 rounded-full ml-2">
            {orders.length} tint orders
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Search bar */}
          <div ref={searchRef} className="relative">
            <div className="relative flex items-center">
              <Search size={13} className="absolute left-2.5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchDropdownOpen(e.target.value.length > 0);
                }}
                onFocus={() => { if (searchQuery) setSearchDropdownOpen(true); }}
                placeholder="Search OBD, customer, SKU…"
                className="w-[220px] focus:w-[260px] transition-all duration-200 pl-8 pr-7 py-1.5 text-[12px] bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg focus:outline-none focus:border-[#1a237e] focus:bg-white placeholder:text-gray-400 text-gray-800"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(""); setSearchDropdownOpen(false); }}
                  className="absolute right-2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {searchDropdownOpen && suggestions.length > 0 && (
              <div className="absolute top-full mt-1 right-0 w-[280px] bg-white border border-[#e2e5f1] rounded-xl shadow-lg py-1 z-50">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setSearchQuery(s.value); setSearchDropdownOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left hover:bg-[#f7f8fc] transition-colors"
                  >
                    <span className={cn(
                      "text-[9.5px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0",
                      s.tag === "OBD"      ? "bg-indigo-50 text-indigo-600"
                      : s.tag === "Customer" ? "bg-amber-50 text-amber-600"
                      : "bg-green-50 text-green-600",
                    )}>
                      {s.tag}
                    </span>
                    <span className="text-[12px] text-gray-800 truncate">{s.value}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="font-mono text-[12px] text-gray-400" suppressHydrationWarning>
            {formatNow(now)}
          </span>
        </div>
      </div>

      {/* ── Filter row ───────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-[#e2e5f1] px-6 py-2.5 flex items-center gap-3 flex-wrap sticky top-[52px] z-40">
        {/* SLOT group */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[.5px] text-gray-400 mr-1">Slot</span>
          {(["all", "10:30", "12:30", "15:30"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSlotFilter(s)}
              className={cn(
                "text-[11px] font-medium px-2 py-0.5 rounded-md border transition-colors",
                slotFilter === s
                  ? "bg-[#1a237e] text-white border-[#1a237e]"
                  : "bg-white text-gray-500 border-[#e2e5f1] hover:border-[#c5cae9] hover:text-gray-800",
              )}
            >
              {s === "all" ? `All (${slotCounts.all})` : `${s} (${slotCounts[s]})`}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-[#e2e5f1] flex-shrink-0" />

        {/* PRIORITY group */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[.5px] text-gray-400 mr-1">Priority</span>
          {(["all", "urgent", "normal"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriorityFilter(p)}
              className={cn(
                "text-[11px] font-medium px-2 py-0.5 rounded-md border transition-colors",
                priorityFilter === p
                  ? p === "urgent"
                    ? "bg-red-500 text-white border-red-500"
                    : "bg-[#1a237e] text-white border-[#1a237e]"
                  : "bg-white text-gray-500 border-[#e2e5f1] hover:border-[#c5cae9] hover:text-gray-800",
              )}
            >
              {p === "all" ? "All" : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-[#e2e5f1] flex-shrink-0" />

        {/* DISPATCH group */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[.5px] text-gray-400 mr-1">Dispatch</span>
          {(["all", "dispatch", "hold", "waiting_for_confirmation"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDispatchFilter(d)}
              className={cn(
                "text-[11px] font-medium px-2 py-0.5 rounded-md border transition-colors",
                dispatchFilter === d
                  ? "bg-[#1a237e] text-white border-[#1a237e]"
                  : "bg-white text-gray-500 border-[#e2e5f1] hover:border-[#c5cae9] hover:text-gray-800",
              )}
            >
              {d === "all" ? "All" : d === "waiting_for_confirmation" ? "Waiting" : d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-[#e2e5f1] flex-shrink-0" />

        {/* TYPE group */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[.5px] text-gray-400 mr-1">Type</span>
          {(["all", "split", "whole"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={cn(
                "text-[11px] font-medium px-2 py-0.5 rounded-md border transition-colors",
                typeFilter === t
                  ? "bg-[#1a237e] text-white border-[#1a237e]"
                  : "bg-white text-gray-500 border-[#e2e5f1] hover:border-[#c5cae9] hover:text-gray-800",
              )}
            >
              {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Active filter summary pill */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="flex items-center gap-1 bg-[#e8eaf6] border border-[#c5cae9] text-[#3C3489] text-[11px] font-semibold px-2.5 py-0.5 rounded-full hover:bg-[#d0d4f0] transition-colors"
          >
            {activeParts.join(" · ")}
            <X size={10} className="ml-0.5" />
          </button>
        )}

        {/* Operator dropdown */}
        <select
          value={operatorFilter}
          onChange={(e) => setOperatorFilter(e.target.value)}
          className="ml-auto bg-white border border-[#cdd1e8] rounded-lg px-3 py-1.5 text-[12px] text-gray-500 focus:outline-none focus:border-[#1a237e]"
        >
          <option value="">Operator: All</option>
          {operators.map((op) => (
            <option key={op.id} value={op.name ?? ""}>
              {op.name ?? `Operator ${op.id}`}
            </option>
          ))}
        </select>
      </div>

      {/* ── Operator workload bar ─────────────────────────────────────────── */}
      <div className="bg-white border-b border-[#e2e5f1]">
        <button
          type="button"
          onClick={() => setWorkloadBarOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-6 py-2 hover:bg-[#f7f8fc] transition-colors text-left"
        >
          <span className="text-[11px] font-bold uppercase tracking-[.5px] text-gray-500">
            Operator Workload
          </span>
          {workloadBarOpen
            ? <ChevronUp size={13} className="text-gray-400 ml-1" />
            : <ChevronDown size={13} className="text-gray-400 ml-1" />
          }
        </button>
        {workloadBarOpen && operatorWorkload.length > 0 && (
          <div className="px-6 pb-3 flex items-center gap-2 flex-wrap">
            {operatorWorkload.map((op) => (
              <button
                key={op.name}
                type="button"
                onClick={() => setOperatorFilter(operatorFilter === op.name ? "" : op.name)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all",
                  operatorFilter === op.name
                    ? "bg-[#e8eaf6] border-[#1a237e]"
                    : "bg-[#f7f8fc] border-[#e2e5f1] hover:border-[#c5cae9]",
                )}
              >
                <div className="w-6 h-6 rounded-full bg-[#1a237e] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                  {initials(op.name)}
                </div>
                <span className="text-[12px] font-semibold text-gray-800">{op.name}</span>
                <div className="flex items-center gap-1">
                  {op.assigned > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                      {op.assigned} assigned
                    </span>
                  )}
                  {op.inProgress > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                      {op.inProgress} in progress
                    </span>
                  )}
                  {op.done > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                      {op.done} done
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
        {workloadBarOpen && operatorWorkload.length === 0 && (
          <div className="px-6 pb-3 text-[12px] text-gray-400 italic">No operators with active work.</div>
        )}
      </div>

      {/* ── Stat bar ─────────────────────────────────────────────────────── */}
      <div className="px-3 py-2.5 grid grid-cols-4 gap-3">
        {([
          {
            count:     pendingCount,
            label:     "PENDING",
            sub:       "unassigned",
            volume:    formatVolume(pendingVolume),
            iconBg:    "bg-orange-50",
            iconColor: "text-orange-500",
            icon: <Clock size={16} />,
          },
          {
            count:     assignedCount,
            label:     "ASSIGNED",
            sub:       "awaiting start",
            volume:    formatVolume(assignedVolume),
            iconBg:    "bg-green-50",
            iconColor: "text-green-500",
            icon: <CheckCircle2 size={16} />,
          },
          {
            count:     inProgressCount,
            label:     "IN PROGRESS",
            sub:       "being tinted",
            volume:    formatVolume(inProgressVolume),
            iconBg:    "bg-amber-50",
            iconColor: "text-amber-500",
            icon: <Zap size={16} />,
          },
          {
            count:     doneCount,
            label:     "COMPLETED",
            sub:       "tinting done",
            volume:    formatVolume(doneVolume),
            iconBg:    "bg-purple-50",
            iconColor: "text-purple-500",
            icon: <Gift size={16} />,
          },
        ] as const).map((card) => (
          <div
            key={card.label}
            className="bg-white border border-[#e2e5f1] rounded-xl flex items-center gap-[10px]"
            style={{ padding: "10px 14px" }}
          >
            <div
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                card.iconBg,
                card.iconColor,
              )}
            >
              {card.icon}
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-[20px] font-extrabold text-gray-900 leading-none">
                  {card.count}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-[.4px] text-gray-500">
                  {card.label}
                </span>
              </div>
              <div className="text-[11px] text-gray-400 mt-1">
                {card.volume}&nbsp; ·&nbsp; {card.sub}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Column reference strip ────────────────────────────────────────── */}
      <div
        className={cn(
          "sticky top-[96px] z-30 bg-[#f0f2f8]",
          "transition-opacity duration-300 ease-in-out",
          showColStrip
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none h-0 overflow-hidden",
        )}
      >
        <div className="grid grid-cols-4 px-3" style={{ gap: "8px" }}>
          {COLUMNS.map((col) => {
            const count =
              col.stage === "pending_tint_assignment"
                ? filteredOrders.filter(o =>
                    o.workflowStage === "pending_tint_assignment" ||
                    ((o.workflowStage === "tint_assigned" || o.workflowStage === "tinting_in_progress") &&
                     (o.remainingQty ?? 0) > 0)
                  ).length
                : col.stage === "tint_assigned"
                ? filteredOrders.filter(o => o.workflowStage === "tint_assigned" && (o.remainingQty ?? 0) === 0).length
                  + activeSplits.filter(s => s.status === "tint_assigned").length
                : col.stage === "tinting_in_progress"
                ? filteredOrders.filter(o => o.workflowStage === "tinting_in_progress" && (o.remainingQty ?? 0) === 0).length
                  + activeSplits.filter(s => s.status === "tinting_in_progress").length
                : completedSplits.length
                  + filteredOrders.filter(o => o.workflowStage === "pending_support").length;
            return (
              <div
                key={col.stage}
                className="bg-white flex items-center gap-2 px-4 py-3 border-b border-[#e2e5f1]"
              >
                <div className={cn("w-2 h-2 rounded-full flex-shrink-0", col.dot)} />
                <span className="text-[13px] font-bold text-gray-900 flex-1">
                  {col.label}
                </span>
                <span className={cn(
                  "text-[11px] font-bold px-2 py-0.5 rounded-full",
                  col.pillClass,
                )}>
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Kanban board ─────────────────────────────────────────────────── */}
      <div className="px-3 pb-6">
        <div className="grid grid-cols-4 gap-2">
          {COLUMNS.map((col) => {
            const isPendingCol = col.stage === "pending_tint_assignment";

            const colOrderItems: TintOrder[] = col.stage === "pending_tint_assignment"
              ? filteredOrders
                  .filter((o) =>
                    o.workflowStage === "pending_tint_assignment" ||
                    ((o.workflowStage === "tint_assigned" || o.workflowStage === "tinting_in_progress") &&
                     (o.remainingQty ?? 0) > 0)
                  )
                  .sort((a, b) => {
                    // Parse date — obdEmailDate is stored as ISO date string e.g. "2026-03-19"
                    const dateStrA = a.obdEmailDate ?? '1970-01-01'
                    const dateStrB = b.obdEmailDate ?? '1970-01-01'

                    // Parse time — obdEmailTime may be stored as "12:34" or "12:34:00"
                    // Extract hours and minutes safely
                    const timeA = a.obdEmailTime ?? '00:00'
                    const timeB = b.obdEmailTime ?? '00:00'
                    const [hA, mA] = timeA.split(':').map(Number)
                    const [hB, mB] = timeB.split(':').map(Number)

                    // Build comparable timestamps
                    const tsA = new Date(dateStrA)
                    tsA.setHours(hA ?? 0, mA ?? 0, 0, 0)

                    const tsB = new Date(dateStrB)
                    tsB.setHours(hB ?? 0, mB ?? 0, 0, 0)

                    return tsA.getTime() - tsB.getTime()
                  })
              : col.stage === "tint_assigned"
              ? filteredOrders.filter((o) => o.workflowStage === "tint_assigned" && (o.remainingQty ?? 0) === 0)
                  .sort((a, b) => {
                    const seqDiff = (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0)
                    if (seqDiff !== 0) return seqDiff
                    const priDiff = (a.priorityLevel ?? 5) - (b.priorityLevel ?? 5)
                    if (priDiff !== 0) return priDiff
                    const dateStrA = a.obdEmailDate ?? '1970-01-01'
                    const dateStrB = b.obdEmailDate ?? '1970-01-01'
                    const timeA = a.obdEmailTime ?? '00:00'
                    const timeB = b.obdEmailTime ?? '00:00'
                    const [hA, mA] = timeA.split(':').map(Number)
                    const [hB, mB] = timeB.split(':').map(Number)
                    const tsA = new Date(dateStrA)
                    tsA.setHours(hA ?? 0, mA ?? 0, 0, 0)
                    const tsB = new Date(dateStrB)
                    tsB.setHours(hB ?? 0, mB ?? 0, 0, 0)
                    return tsA.getTime() - tsB.getTime()
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
                    const dateStrA = a.obdEmailDate ?? '1970-01-01'
                    const dateStrB = b.obdEmailDate ?? '1970-01-01'
                    const timeA = a.obdEmailTime ?? '00:00'
                    const timeB = b.obdEmailTime ?? '00:00'
                    const [hA, mA] = timeA.split(':').map(Number)
                    const [hB, mB] = timeB.split(':').map(Number)
                    const tsA = new Date(dateStrA)
                    tsA.setHours(hA ?? 0, mA ?? 0, 0, 0)
                    const tsB = new Date(dateStrB)
                    tsB.setHours(hB ?? 0, mB ?? 0, 0, 0)
                    return tsA.getTime() - tsB.getTime()
                  })
              : col.stage === "tinting_in_progress"
              ? filteredActiveSplits.filter((s) => s.status === "tinting_in_progress")
              : filteredCompletedSplits;

            const allColItems: ColItem[] = [
              ...colOrderItems.map((o) => ({ type: "order" as const, data: o })),
              ...colSplitItems.map((s) => ({ type: "split" as const, data: s })),
            ];

            const itemCount  = allColItems.length;
            const page       = pages[col.stage] ?? 0;
            const totalPages = Math.ceil(itemCount / CARDS_PER_PAGE);
            const pageItems  = allColItems.slice(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE);

            return (
              <div
                key={col.stage}
                className="bg-[#f7f8fc] border border-[#e2e5f1] rounded-[12px] overflow-hidden"
              >
                {/* Column header */}
                <div className="bg-white border-b border-[#e2e5f1] px-4 py-3 flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full flex-shrink-0", col.dot)} />
                  <span className="text-[13px] font-bold text-gray-900 flex-1">{col.label}</span>
                  <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full", col.pillClass)}>
                    {itemCount}
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
          <div className="relative bg-white rounded-[14px] shadow-xl w-[400px] overflow-hidden border border-[#e2e5f1]">
            <div className="px-5 pt-5 pb-4 border-b border-[#e2e5f1]">
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
                          ? "border-[#1a237e] bg-[#e8eaf6]"
                          : "border-[#e2e5f1] hover:border-[#c5cae9] hover:bg-[#f7f8fc]",
                      )}
                    >
                      <div className="w-9 h-9 rounded-full bg-[#1a237e] text-white flex items-center justify-center text-[12px] font-bold flex-shrink-0">
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
                          "w-5 h-5 rounded-full bg-[#1a237e] text-white flex items-center justify-center text-[10px] transition-opacity flex-shrink-0",
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

            <div className="px-5 pb-5 pt-3 border-t border-[#e2e5f1] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSplitReassignOpen(false)}
                className="text-[12.5px] font-semibold text-gray-600 border border-[#e2e5f1] bg-white hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSplitReassign}
                disabled={!splitReassignedToId || isSplitReassigning}
                className="text-[12.5px] font-semibold text-white bg-[#1a237e] hover:bg-[#283593] px-4 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
          <div className="relative bg-white rounded-[14px] shadow-xl w-[400px] overflow-hidden border border-[#e2e5f1]">
            <div className="px-5 pt-5 pb-4 border-b border-[#e2e5f1]">
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
                              ? "border-[#1a237e] bg-[#e8eaf6]"
                              : "border-[#e2e5f1] hover:border-[#c5cae9] hover:bg-[#f7f8fc]",
                          )}
                        >
                          <div className="w-9 h-9 rounded-full bg-[#1a237e] text-white flex items-center justify-center text-[12px] font-bold flex-shrink-0">
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
                              "w-5 h-5 rounded-full bg-[#1a237e] text-white flex items-center justify-center text-[10px] transition-opacity flex-shrink-0",
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
                    className="w-full rounded-lg border border-[#cdd1e8] bg-white px-3 py-2 text-[12.5px] text-gray-800 placeholder:text-gray-400 focus:border-[#1a237e] focus:outline-none resize-none"
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

                <div className="px-5 pb-5 pt-3 border-t border-[#e2e5f1] flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeAssignModal}
                    className="text-[12.5px] font-semibold text-gray-600 border border-[#e2e5f1] bg-white hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAssign}
                    disabled={!assignedToId || isAssigning}
                    className="text-[12.5px] font-semibold text-white bg-[#1a237e] hover:bg-[#283593] px-4 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    className="text-[12.5px] font-semibold text-gray-600 border border-[#e2e5f1] bg-white hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
