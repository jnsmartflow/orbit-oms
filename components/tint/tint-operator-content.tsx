"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Loader2, Eye, ChevronDown, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { ObdCode } from "@/components/shared/obd-code";
import { SkuDetailsSheet } from "@/components/tint/sku-details-sheet";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SplitLineItem {
  rawLineItemId?: number;
  rawLineItem: {
    skuCodeRaw:        string;
    skuDescriptionRaw: string | null;
    unitQty:           number;
    volumeLine:        number | null;
    isTinting:         boolean;
  };
}

interface OperatorSplit {
  id:               number;
  splitNumber:      number;
  status:           string;
  totalVolume:      number | null;
  articleTag:       string | null;
  createdAt:        string;
  tiSubmitted:       boolean;
  tiCoveredLines:    number;
  totalTintingLines: number;
  operatorSequence:  number;
  startedAt:         string | null;
  completedAt:       string | null;
  orderId:           number;
  order: {
    obdNumber:          string;
    shipToCustomerId:   string;
    shipToCustomerName: string | null;
    dispatchSlot:       string | null;
    customer: {
      customerName: string;
      area: { name: string };
    } | null;
  };
  lineItems: SplitLineItem[];
}

interface OperatorOrder {
  id:                 number;
  obdNumber:          string;
  workflowStage:      string;
  dispatchSlot:       string | null;
  createdAt:          string;
  shipToCustomerId:   string;
  shipToCustomerName: string | null;
  customer: {
    customerName: string;
    area:         { name: string };
  } | null;
  tiCoveredLines:    number;
  totalTintingLines: number;
  tintAssignments: {
    id:               number;
    status:           string;
    startedAt:        string | null;
    tiSubmitted:      boolean;
    operatorSequence: number;
  }[];
  querySnapshot: {
    totalUnitQty: number;
    totalVolume:  number;
    articleTag:   string | null;
    totalLines:   number;
  } | null;
  rawLineItems: {
    id:                number;
    obdNumber:         string;
    skuCodeRaw:        string;
    skuDescriptionRaw: string | null;
    unitQty:           number;
    volumeLine:        number | null;
    isTinting:         boolean;
  }[];
}

interface ShadeMasterRecord {
  id:                number;
  shadeName:         string;
  shipToCustomerId:  string;
  shipToCustomerName: string;
  tinterType:        "TINTER" | "ACOTONE";
  packCode:          string | null;
  skuCode:           string | null;
  baseSku:           string;
  tinQty:            number;
  YOX: number; LFY: number; GRN: number; TBL: number; WHT: number;
  MAG: number; FFR: number; BLK: number; OXR: number; HEY: number;
  HER: number; COB: number; COG: number;
  YE2: number; YE1: number; XY1: number; XR1: number; WH1: number;
  RE2: number; RE1: number; OR1: number; NO2: number; NO1: number;
  MA1: number; GR1: number; BU2: number; BU1: number;
}

interface TintingLine {
  rawLineItemId:     number;
  skuCodeRaw:        string;
  skuDescriptionRaw: string | null;
  unitQty:           number;
  volumeLine:        number | null;
  packCode:          string;
}

interface TIFormEntry {
  id:                  string;
  rawLineItemId:       number | null;
  skuCodeRaw:          string;
  skuDescriptionRaw:   string;
  unitQty:             number;
  packCode:            string;
  tinQty:              number;
  shadeValues:         Record<string, number>;
  suggestions:         ShadeSuggestion[];
  suggestionsLoading:  boolean;
  suggestionsExpanded: boolean;
  saveAsShade:         boolean;
  shadeName:           string;
  shadeNameError:      string;
  flashActive:         boolean;
  selectedShadeName:   string | null;
  selectedShadeId:     number | null;
  showAllColumns:      boolean;
}

interface ShadeSuggestion extends ShadeMasterRecord {
  lastUsedAt: string | null;
}

interface TIEntryRecord {
  id:            number;
  table:         "TINTER" | "ACOTONE";
  rawLineItemId: number | null;
  baseSku:       string;
  tinQty:        number;
  packCode:      string | null;
  shadeValues:   Record<string, number>;
  createdAt:     string;
}

interface Job {
  id:               number;
  type:             "split" | "order";
  operatorSequence: number;
  status:           string;
  tiSubmitted:      boolean;
  startedAt:        string | null;
  customerName:     string;
  obdNumber:        string;
  splitNumber?:     number;
  dispatchSlot:     string | null;
  articleTag:       string | null;
  totalVolume:      number | null;
  lineItems:        SplitLineItem[];
  orderId:          number;
  tintAssignmentId:   number | null;
  shipToCustomerId:   string;
  shipToCustomerName: string | null;
  tiCoveredLines:     number;
  totalTintingLines:  number;
}

interface CompletedAssignment {
  id:          number;
  completedAt: string | null;
  order: {
    obdNumber:          string;
    shipToCustomerId:   string;
    shipToCustomerName: string | null;
    customer:           { customerName: string; area: { name: string } } | null;
    querySnapshot:      { totalVolume: number } | null;
  };
}

interface CompletedSplit {
  id:          number;
  splitNumber: number;
  totalVolume: number | null;
  completedAt: string | null;
  orderId:     number;
  order: {
    obdNumber:          string;
    shipToCustomerId:   string;
    shipToCustomerName: string | null;
    customer:           { customerName: string; area: { name: string } } | null;
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SHADES = [
  { code: "YOX", bg: "#fef3c7", border: "#f59e0b", text: "#92400e" },
  { code: "LFY", bg: "#d1fae5", border: "#10b981", text: "#065f46" },
  { code: "GRN", bg: "#bbf7d0", border: "#16a34a", text: "#14532d" },
  { code: "TBL", bg: "#dbeafe", border: "#3b82f6", text: "#1e3a8a" },
  { code: "WHT", bg: "#f9fafb", border: "#9ca3af", text: "#374151" },
  { code: "MAG", bg: "#fce7f3", border: "#ec4899", text: "#831843" },
  { code: "FFR", bg: "#fee2e2", border: "#ef4444", text: "#7f1d1d" },
  { code: "BLK", bg: "#1f2937", border: "#374151", text: "#f9fafb" },
  { code: "OXR", bg: "#ffedd5", border: "#f97316", text: "#7c2d12" },
  { code: "HEY", bg: "#fef9c3", border: "#eab308", text: "#713f12" },
  { code: "HER", bg: "#ffe4e6", border: "#f43f5e", text: "#881337" },
  { code: "COB", bg: "#e0e7ff", border: "#6366f1", text: "#312e81" },
  { code: "COG", bg: "#ecfdf5", border: "#059669", text: "#064e3b" },
] as const;

const ACOTONE_SHADES = [
  { code: "YE2", bg: "#fef9c3", border: "#eab308", text: "#713f12" },
  { code: "YE1", bg: "#fef3c7", border: "#f59e0b", text: "#92400e" },
  { code: "XY1", bg: "#fde68a", border: "#d97706", text: "#78350f" },
  { code: "XR1", bg: "#ffedd5", border: "#f97316", text: "#7c2d12" },
  { code: "WH1", bg: "#f9fafb", border: "#9ca3af", text: "#374151" },
  { code: "RE2", bg: "#fce7f3", border: "#ec4899", text: "#831843" },
  { code: "RE1", bg: "#fee2e2", border: "#ef4444", text: "#7f1d1d" },
  { code: "OR1", bg: "#fff7ed", border: "#fb923c", text: "#9a3412" },
  { code: "NO2", bg: "#f1f5f9", border: "#94a3b8", text: "#334155" },
  { code: "NO1", bg: "#e2e8f0", border: "#64748b", text: "#1e293b" },
  { code: "MA1", bg: "#ede9fe", border: "#8b5cf6", text: "#4c1d95" },
  { code: "GR1", bg: "#d1fae5", border: "#10b981", text: "#065f46" },
  { code: "BU2", bg: "#dbeafe", border: "#3b82f6", text: "#1e3a8a" },
  { code: "BU1", bg: "#e0e7ff", border: "#6366f1", text: "#312e81" },
] as const;

const PACK_CODES = [
  { value: "ml_500", label: "500ml" },
  { value: "L_1",    label: "1L" },
  { value: "L_4",    label: "4L" },
  { value: "L_10",   label: "10L" },
  { value: "L_20",   label: "20L" },
] as const;

function defaultTIFormEntry(): TIFormEntry {
  return {
    id:                  Math.random().toString(36).slice(2),
    rawLineItemId:       null,
    skuCodeRaw:          "",
    skuDescriptionRaw:   "",
    unitQty:             0,
    packCode:            "",
    tinQty:              0,
    shadeValues:         {},
    suggestions:         [],
    suggestionsLoading:  false,
    suggestionsExpanded: false,
    saveAsShade:         false,
    shadeName:           "",
    shadeNameError:      "",
    flashActive:         false,
    selectedShadeName:   null,
    selectedShadeId:     null,
    showAllColumns:      true,
  };
}

function derivePackCode(volumeLine: number | null, unitQty: number): string {
  const perUnit = (unitQty > 0 && volumeLine != null) ? volumeLine / unitQty : 0;
  if (perUnit >= 20) return "L_20";
  if (perUnit >= 10) return "L_10";
  if (perUnit >= 4)  return "L_4";
  if (perUnit >= 1)  return "L_1";
  return "ml_500";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getProgressPct(status: string): number {
  if (status === "tinting_done")        return 100;
  if (status === "tinting_in_progress") return 50;
  return 0;
}

function getProgressBarColor(pct: number): string {
  if (pct === 0)  return "bg-gray-200";
  if (pct < 25)   return "bg-red-400";
  if (pct < 75)   return "bg-amber-400";
  if (pct < 100)  return "bg-green-400";
  return "bg-green-500";
}

function getProgressTextColor(pct: number): string {
  if (pct === 0)  return "text-gray-400";
  if (pct < 25)   return "text-red-500";
  if (pct < 75)   return "text-amber-500";
  return "text-green-500";
}

type StageBadgeVariant = "pending" | "in-progress" | "done";

function stageBadgeVariant(status: string): StageBadgeVariant {
  if (status === "tinting_in_progress") return "in-progress";
  if (status === "tinting_done")        return "done";
  return "pending";
}

// ── Split card ─────────────────────────────────────────────────────────────────

interface SplitCardProps {
  split:           OperatorSplit;
  isActionLoading: boolean;
  onStart:         () => void;
  onDone:          () => void;
}

function SplitCard({ split, isActionLoading, onStart, onDone }: SplitCardProps) {
  const [skuSheetOpen, setSkuSheetOpen] = useState(false);
  const isPending    = split.status === "tint_assigned";
  const isInProgress = split.status === "tinting_in_progress";
  const isDone       = split.status === "tinting_done";
  const customerName = split.order.customer?.customerName ?? split.order.shipToCustomerName ?? "—";
  const area         = split.order.customer?.area.name ?? "—";
  const pct          = getProgressPct(split.status);

  return (
    <>
    <div className="bg-white border border-[#e2e5f1] rounded-xl p-4 shadow-sm mb-3 cursor-pointer hover:shadow-md hover:border-[#cdd1e8] transition-all">

      {/* Top row: OBD + split number + status badge + slot/date */}
      <div className="flex items-center gap-2">
        <ObdCode code={split.order.obdNumber} />
        <span className="text-[11px] text-gray-400">Split #{split.splitNumber}</span>
        <StatusBadge variant={stageBadgeVariant(split.status)} size="sm" />
        <span className="ml-auto text-[11px] text-gray-400 font-mono shrink-0">
          {split.order.dispatchSlot ?? timeAgo(split.createdAt)}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setSkuSheetOpen(true); }}
          className="p-1 rounded-md text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
          title="View SKU lines"
        >
          <Eye size={13} />
        </button>
      </div>

      {/* Customer name */}
      <p className="text-[14px] font-bold text-gray-900 mt-1 truncate">{customerName}</p>

      {/* Area */}
      <p className="text-[12px] text-gray-400">{area}</p>

      {/* Meta grid */}
      <div className="mt-2.5 bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg p-2.5 grid grid-cols-2 gap-2">
        {[
          { label: "Articles", value: split.articleTag ?? "—" },
          { label: "Volume",   value: split.totalVolume != null ? `${split.totalVolume} L` : "—" },
          { label: "Slot",     value: split.order.dispatchSlot ?? "—" },
          { label: "Status",   value: split.status },
        ].map((cell) => (
          <div key={cell.label}>
            <div className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400 mb-0.5">
              {cell.label}
            </div>
            <div className="text-[12px] font-semibold text-gray-900">{cell.value}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="mt-2.5">
        <div className="flex justify-between mb-1">
          <span className="text-[10.5px] font-semibold text-gray-400">Tinting Progress</span>
          <span className={cn("text-[11px] font-bold", getProgressTextColor(pct))}>{pct}%</span>
        </div>
        <div className="h-[5px] bg-gray-100 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", getProgressBarColor(pct))}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Action button */}
      <div className="pt-3 border-t border-[#e2e5f1] mt-3">
        {isPending && (
          <button
            type="button"
            onClick={onStart}
            disabled={isActionLoading}
            className="w-full bg-[#1a237e] text-white py-2.5 rounded-lg font-semibold text-[13px] flex items-center justify-center gap-2 hover:bg-[#283593] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isActionLoading && <Loader2 className="animate-spin" size={15} />}
            Start Job
          </button>
        )}
        {isInProgress && (
          <button
            type="button"
            onClick={onDone}
            disabled={isActionLoading}
            className="w-full bg-green-600 text-white py-2.5 rounded-lg font-semibold text-[13px] flex items-center justify-center gap-2 hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isActionLoading && <Loader2 className="animate-spin" size={15} />}
            Mark as Done ✓
          </button>
        )}
        {isDone && (
          <span className="flex items-center justify-center w-full bg-green-50 text-green-600 border border-green-200 py-2.5 rounded-lg font-semibold text-[13px] pointer-events-none">
            Completed
          </span>
        )}
      </div>

    </div>

    <SkuDetailsSheet
      open={skuSheetOpen}
      onClose={() => setSkuSheetOpen(false)}
      obdNumber={split.order.obdNumber}
      customerName={customerName}
      lineItems={split.lineItems.map((item) => item.rawLineItem)}
    />
    </>
  );
}

// ── Regular order card ─────────────────────────────────────────────────────────

interface RegularOrderCardProps {
  order:           OperatorOrder;
  isActionLoading: boolean;
  onStart:         () => void;
  onDone:          () => void;
}

function RegularOrderCard({ order, isActionLoading, onStart, onDone }: RegularOrderCardProps) {
  const isPending    = order.workflowStage === "tint_assigned";
  const isInProgress = order.workflowStage === "tinting_in_progress";
  const customerName = order.customer?.customerName ?? order.shipToCustomerName ?? "—";
  const area         = order.customer?.area.name ?? "—";
  const pct          = getProgressPct(isInProgress ? "tinting_in_progress" : "tint_assigned");

  return (
    <div className="bg-white border border-[#e2e5f1] rounded-xl p-4 shadow-sm mb-3 cursor-pointer hover:shadow-md hover:border-[#cdd1e8] transition-all">

      {/* Top row: OBD + status badge + slot/date */}
      <div className="flex items-center gap-2">
        <ObdCode code={order.obdNumber} />
        <StatusBadge variant={stageBadgeVariant(order.workflowStage)} size="sm" />
        <span className="ml-auto text-[11px] text-gray-400 font-mono shrink-0">
          {order.dispatchSlot ?? timeAgo(order.createdAt)}
        </span>
      </div>

      {/* Customer name */}
      <p className="text-[14px] font-bold text-gray-900 mt-1 truncate">{customerName}</p>

      {/* Area */}
      <p className="text-[12px] text-gray-400">{area}</p>

      {/* Meta grid */}
      <div className="mt-2.5 bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg p-2.5 grid grid-cols-2 gap-2">
        {[
          { label: "Articles", value: order.querySnapshot?.articleTag ?? "—" },
          { label: "Volume",   value: order.querySnapshot?.totalVolume != null ? `${order.querySnapshot.totalVolume} L` : "—" },
          { label: "Slot",     value: order.dispatchSlot ?? "—" },
          { label: "Status",   value: order.workflowStage },
        ].map((cell) => (
          <div key={cell.label}>
            <div className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400 mb-0.5">
              {cell.label}
            </div>
            <div className="text-[12px] font-semibold text-gray-900">{cell.value}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="mt-2.5">
        <div className="flex justify-between mb-1">
          <span className="text-[10.5px] font-semibold text-gray-400">Tinting Progress</span>
          <span className={cn("text-[11px] font-bold", getProgressTextColor(pct))}>{pct}%</span>
        </div>
        <div className="h-[5px] bg-gray-100 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", getProgressBarColor(pct))}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Action button */}
      <div className="pt-3 border-t border-[#e2e5f1] mt-3">
        {isPending && (
          <button
            type="button"
            onClick={onStart}
            disabled={isActionLoading}
            className="w-full bg-[#1a237e] text-white py-2.5 rounded-lg font-semibold text-[13px] flex items-center justify-center gap-2 hover:bg-[#283593] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isActionLoading && <Loader2 className="animate-spin" size={15} />}
            Start Job
          </button>
        )}
        {isInProgress && (
          <button
            type="button"
            onClick={onDone}
            disabled={isActionLoading}
            className="w-full bg-green-600 text-white py-2.5 rounded-lg font-semibold text-[13px] flex items-center justify-center gap-2 hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isActionLoading && <Loader2 className="animate-spin" size={15} />}
            Mark as Done ✓
          </button>
        )}
      </div>

    </div>
  );
}

// ── Page Content ──────────────────────────────────────────────────────────────

const pulseKeyframes = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

export function TintOperatorContent() {
  const [assignedSplits,   setAssignedSplits]   = useState<OperatorSplit[]>([]);
  const [assignedOrders,   setAssignedOrders]   = useState<OperatorOrder[]>([]);
  const [completedOrders,  setCompletedOrders]  = useState<CompletedAssignment[]>([]);
  const [completedSplits,  setCompletedSplits]  = useState<CompletedSplit[]>([]);
  const [isLoading,        setIsLoading]        = useState(true);
  const [splitActionLoading, setSplitActionLoading] = useState<number | null>(null);
  const [orderActionLoading, setOrderActionLoading] = useState<number | null>(null);
  const [error,           setError]           = useState<string | null>(null);
  const [hasActiveJob,    setHasActiveJob]    = useState(false);
  const [selectedJobId,   setSelectedJobId]   = useState<number | null>(null);
  const [selectedJobType, setSelectedJobType] = useState<"split" | "order" | null>(null);
  const [focusMode,       setFocusMode]       = useState(false);
  const [queueSheetOpen,  setQueueSheetOpen]  = useState(false);
  const [clock,           setClock]           = useState("");
  const [elapsed,         setElapsed]         = useState("00:00:00");
  // ── TI form state ────────────────────────────────────────────────────────
  const [tinterType,         setTinterType]         = useState<"TINTER" | "ACOTONE">("TINTER");
  const [tiEntries,          setTiEntries]          = useState<TIFormEntry[]>(() => [defaultTIFormEntry()]);
  const [allSavedShades,     setAllSavedShades]     = useState<ShadeMasterRecord[]>([]);
  const [allShadesLoading,   setAllShadesLoading]   = useState(false);
  const [allShadesComboOpen, setAllShadesComboOpen] = useState<string | null>(null);
  const [allShadesSearch,    setAllShadesSearch]    = useState("");
  const [tiActionLoading,    setTiActionLoading]    = useState(false);
  const [conflictDialog,     setConflictDialog]     = useState<{
    existingId:   number;
    shadeName:    string;
    entryId:      string;
    job:          Job;
    remainingIds: string[];
  } | null>(null);
  const [tiSuccessToast,      setTiSuccessToast]      = useState(false);
  const [tiUpdateToast,       setTiUpdateToast]       = useState(false);
  const [tiIncompleteWarning, setTiIncompleteWarning] = useState<{
    rawLineItemId:     number;
    skuCodeRaw:        string;
    skuDescriptionRaw: string | null;
  }[] | null>(null);
  const [existingTIEntries,  setExistingTIEntries]  = useState<Map<number, TIEntryRecord>>(new Map());
  const [tiEntriesLoading,   setTiEntriesLoading]   = useState(false);
  const [editingEntryId,     setEditingEntryId]     = useState<{ id: number; table: "TINTER" | "ACOTONE" } | null>(null);

  const coverageStripRef  = useRef<HTMLDivElement>(null);
  const autoSelectDoneRef = useRef(false);

  const fetchOrders = useCallback(async () => {
    try {
      const res  = await fetch("/api/tint/operator/my-orders");
      const data = (await res.json()) as {
        assignedOrders:  OperatorOrder[];
        assignedSplits:  OperatorSplit[];
        hasActiveJob:    boolean;
        completedOrders: CompletedAssignment[];
        completedSplits: CompletedSplit[];
      };
      setAssignedOrders(data.assignedOrders ?? []);
      setAssignedSplits(data.assignedSplits ?? []);
      setHasActiveJob(data.hasActiveJob);
      setCompletedOrders(data.completedOrders ?? []);
      setCompletedSplits(data.completedSplits ?? []);

      const allJobs = [
        ...(data.assignedSplits ?? [])
          .filter(s => ["tint_assigned", "tinting_in_progress"].includes(s.status))
          .map(s => ({ id: s.id, type: "split" as const, seq: s.operatorSequence, status: s.status })),
        ...(data.assignedOrders ?? [])
          .filter(o => ["tint_assigned", "assigned", "tinting_in_progress"].includes(o.tintAssignments[0]?.status ?? ""))
          .map(o => ({ id: o.id, type: "order" as const, seq: o.tintAssignments[0]?.operatorSequence ?? 0, status: o.tintAssignments[0]?.status ?? "" })),
      ].sort((a, b) => a.seq - b.seq);

      const active = allJobs.find(j => j.status === "tinting_in_progress");
      const toSelect = active ?? allJobs[0] ?? null;
      if (toSelect) {
        setSelectedJobId(toSelect.id);
        setSelectedJobType(toSelect.type);
      }
    } catch {
      // leave stale
    }
  }, []);

  const loadExistingTIEntries = useCallback(async (job: Job) => {
    const fetchId   = job.type === "split" ? job.id : job.tintAssignmentId;
    const fetchType = job.type === "split" ? "split" : "assignment";
    if (!fetchId) { setExistingTIEntries(new Map()); return; }
    setTiEntriesLoading(true);
    try {
      const [resA, resB] = await Promise.all([
        fetch(`/api/tint/operator/tinter-issue/${fetchId}?type=${fetchType}`),
        fetch(`/api/tint/operator/tinter-issue-b/${fetchId}?type=${fetchType}`),
      ]);
      type RawEntry = Record<string, unknown> & {
        id: number; rawLineItemId: number | null; baseSku: string;
        tinQty: unknown; packCode: string | null; createdAt: string;
      };
      const rawA = resA.ok ? (await resA.json()) as { entries: RawEntry[] } : null;
      const rawB = resB.ok ? (await resB.json()) as { entries: RawEntry[] } : null;

      const TINTER_COLS  = ["YOX","LFY","GRN","TBL","WHT","MAG","FFR","BLK","OXR","HEY","HER","COB","COG"] as const;
      const ACOTONE_COLS = ["YE2","YE1","XY1","XR1","WH1","RE2","RE1","OR1","NO2","NO1","MA1","GR1","BU2","BU1"] as const;

      const map = new Map<number, TIEntryRecord>();

      for (const e of rawA?.entries ?? []) {
        if (e.rawLineItemId == null) continue;
        const sv: Record<string, number> = {};
        for (const col of TINTER_COLS) sv[col] = Number(e[col] ?? 0);
        const rec: TIEntryRecord = { id: e.id, table: "TINTER", rawLineItemId: e.rawLineItemId, baseSku: e.baseSku, tinQty: Number(e.tinQty), packCode: e.packCode, shadeValues: sv, createdAt: e.createdAt };
        const ex = map.get(e.rawLineItemId);
        if (!ex || new Date(e.createdAt) > new Date(ex.createdAt)) map.set(e.rawLineItemId, rec);
      }
      for (const e of rawB?.entries ?? []) {
        if (e.rawLineItemId == null) continue;
        const sv: Record<string, number> = {};
        for (const col of ACOTONE_COLS) sv[col] = Number(e[col] ?? 0);
        const rec: TIEntryRecord = { id: e.id, table: "ACOTONE", rawLineItemId: e.rawLineItemId, baseSku: e.baseSku, tinQty: Number(e.tinQty), packCode: e.packCode, shadeValues: sv, createdAt: e.createdAt };
        const ex = map.get(e.rawLineItemId);
        if (!ex || new Date(e.createdAt) > new Date(ex.createdAt)) map.set(e.rawLineItemId, rec);
      }
      setExistingTIEntries(map);
    } catch {
      // leave stale
    } finally {
      setTiEntriesLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    fetchOrders().finally(() => setIsLoading(false));
  }, [fetchOrders]);

  useEffect(() => {
    const tick = () => setClock(
      new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }),
    );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  async function postSplitAction(endpoint: string, splitId: number) {
    setSplitActionLoading(splitId);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ splitId }),
      });
      if (!res.ok) {
        let message = "Action failed";
        try {
          const err = (await res.json()) as { error?: string };
          if (typeof err.error === "string") message = err.error;
        } catch {
          // empty body — use default message
        }
        console.log("Action error:", res.status, message);
        throw new Error(message);
      }
      await fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSplitActionLoading(null);
    }
  }

  async function postOrderAction(endpoint: string, orderId: number) {
    setOrderActionLoading(orderId);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderId }),
      });
      if (!res.ok) {
        let message = "Action failed";
        try {
          const err = (await res.json()) as { error?: string };
          if (typeof err.error === "string") message = err.error;
        } catch {
          // empty body — use default message
        }
        console.log("Action error:", res.status, message);
        throw new Error(message);
      }
      await fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setOrderActionLoading(null);
    }
  }

  // ── Memos ─────────────────────────────────────────────────────────────────

  const jobs = useMemo<Job[]>(() => {
    const splitJobs: Job[] = assignedSplits
      .filter(s => ["tint_assigned", "tinting_in_progress"].includes(s.status))
      .map(s => ({
        id:               s.id,
        type:             "split" as const,
        operatorSequence: s.operatorSequence,
        status:           s.status,
        tiSubmitted:      s.tiSubmitted,
        startedAt:        s.startedAt,
        customerName:      s.order.customer?.customerName ?? s.order.shipToCustomerName ?? "—",
        obdNumber:         s.order.obdNumber,
        splitNumber:       s.splitNumber,
        dispatchSlot:      s.order.dispatchSlot,
        articleTag:        s.articleTag,
        totalVolume:       s.totalVolume,
        lineItems:         s.lineItems,
        orderId:           s.orderId,
        tintAssignmentId:  null,
        shipToCustomerId:  s.order.shipToCustomerId,
        shipToCustomerName: s.order.shipToCustomerName,
        tiCoveredLines:    s.tiCoveredLines,
        totalTintingLines: s.totalTintingLines,
      }));

    const orderJobs: Job[] = assignedOrders
      .filter(o => ["tint_assigned", "assigned", "tinting_in_progress"].includes(o.tintAssignments[0]?.status ?? ""))
      .map(o => ({
        id:               o.id,
        type:             "order" as const,
        operatorSequence: o.tintAssignments[0]?.operatorSequence ?? 0,
        status:           o.tintAssignments[0]?.status === "assigned"
          ? "tint_assigned"
          : o.tintAssignments[0]?.status ?? "",
        tiSubmitted:      o.tintAssignments[0]?.tiSubmitted ?? false,
        startedAt:        o.tintAssignments[0]?.startedAt ?? null,
        customerName:      o.customer?.customerName ?? o.shipToCustomerName ?? "—",
        obdNumber:         o.obdNumber,
        splitNumber:       undefined,
        dispatchSlot:      o.dispatchSlot,
        articleTag:        o.querySnapshot?.articleTag ?? null,
        totalVolume:       o.querySnapshot?.totalVolume ?? null,
        lineItems:         o.rawLineItems.map(li => ({ rawLineItemId: li.id, rawLineItem: li })),
        orderId:           o.id,
        tintAssignmentId:  o.tintAssignments[0]?.id ?? null,
        shipToCustomerId:  o.shipToCustomerId,
        shipToCustomerName: o.shipToCustomerName,
        tiCoveredLines:    o.tiCoveredLines,
        totalTintingLines: o.totalTintingLines,
      }));

    return [...splitJobs, ...orderJobs].sort(
      (a, b) => a.operatorSequence - b.operatorSequence,
    );
  }, [assignedSplits, assignedOrders]);

  const selectedJob = useMemo(
    () => jobs.find(j => j.id === selectedJobId && j.type === selectedJobType) ?? null,
    [jobs, selectedJobId, selectedJobType],
  );

  const tintingLines = useMemo<TintingLine[]>(() => {
    if (!selectedJob) return [];
    return selectedJob.lineItems
      .filter(li => li.rawLineItem.isTinting)
      .map(li => ({
        rawLineItemId:     li.rawLineItemId ?? 0,
        skuCodeRaw:        li.rawLineItem.skuCodeRaw,
        skuDescriptionRaw: li.rawLineItem.skuDescriptionRaw,
        unitQty:           li.rawLineItem.unitQty,
        volumeLine:        li.rawLineItem.volumeLine,
        packCode:          derivePackCode(li.rawLineItem.volumeLine, li.rawLineItem.unitQty),
      }));
  }, [selectedJob]);

  useEffect(() => {
    if (!selectedJob?.startedAt || selectedJob.status !== "tinting_in_progress") {
      setElapsed("00:00:00");
      return;
    }
    const start = new Date(selectedJob.startedAt).getTime();
    const update = () => {
      const diff = Math.floor((Date.now() - start) / 1000);
      const h = Math.floor(diff / 3600).toString().padStart(2, "0");
      const m = Math.floor((diff % 3600) / 60).toString().padStart(2, "0");
      const s = (diff % 60).toString().padStart(2, "0");
      setElapsed(`${h}:${m}:${s}`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [selectedJob?.startedAt, selectedJob?.status]);

  // Reset TI form state when job changes
  useEffect(() => {
    setTinterType("TINTER");
    setTiEntries([defaultTIFormEntry()]);
    setAllSavedShades([]);
    setAllShadesLoading(false);
    setAllShadesComboOpen(null);
    setAllShadesSearch("");
    setConflictDialog(null);
    setTiSuccessToast(false);
    setTiUpdateToast(false);
    setTiIncompleteWarning(null);
    setExistingTIEntries(new Map());
    setEditingEntryId(null);
    autoSelectDoneRef.current = false;
  }, [selectedJobId, selectedJobType]);

  // Load all saved shades when job or tinterType changes
  useEffect(() => {
    if (!selectedJob?.shipToCustomerId) { setAllSavedShades([]); return; }
    setAllShadesLoading(true);
    fetch(`/api/tint/operator/shades?shipToCustomerId=${encodeURIComponent(selectedJob.shipToCustomerId)}&tinterType=${tinterType}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { data: ShadeMasterRecord[] } | null) => { if (d) setAllSavedShades(d.data); })
      .catch(() => {})
      .finally(() => setAllShadesLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJob?.shipToCustomerId, tinterType]);

  // Load existing TI entries when job changes
  useEffect(() => {
    if (selectedJob) loadExistingTIEntries(selectedJob);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJob?.id, selectedJob?.type, selectedJob?.tintAssignmentId]);

  // Auto-select single tinting line when there is exactly one line and no TI entry yet
  useEffect(() => {
    if (tiEntriesLoading) return;
    if (autoSelectDoneRef.current) return;
    if (tintingLines.length !== 1) return;
    if (existingTIEntries.size !== 0) return;
    autoSelectDoneRef.current = true;
    handleSkuSelect(tiEntries[0].id, tintingLines[0].rawLineItemId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiEntriesLoading, tintingLines.length, existingTIEntries.size]);

  const pendingCount    = jobs.filter(j => j.status === "tint_assigned").length;
  const inProgressCount = jobs.filter(j => j.status === "tinting_in_progress").length;
  const completedCount  = completedOrders.length + completedSplits.length;
  const volumeDone      =
    completedSplits.reduce((s, sp) => s + (sp.totalVolume ?? 0), 0) +
    completedOrders.reduce((s, co) => s + (co.order.querySnapshot?.totalVolume ?? 0), 0);
  const remainingVolume = jobs
    .filter(j => j.status !== "tinting_in_progress")
    .reduce((s, j) => s + (j.totalVolume ?? 0), 0);

  // ── Derived stats ─────────────────────────────────────────────────────────

  const inProgressSplits = assignedSplits.filter((s) => s.status === "tinting_in_progress");
  const todoSplits       = assignedSplits.filter((s) => s.status === "tint_assigned");

  const inProgressOrders = assignedOrders.filter((o) => o.workflowStage === "tinting_in_progress");
  const todoOrders       = assignedOrders.filter((o) => o.workflowStage === "tint_assigned");

  const myQueueCount = todoSplits.length + todoOrders.length;

  const bothEmpty = myQueueCount === 0 && inProgressCount === 0;

  // Sort splits: in-progress first, then pending
  const sortedSplits = [...inProgressSplits, ...todoSplits];
  // Sort orders: in-progress first, then pending
  const sortedOrders = [...inProgressOrders, ...todoOrders];

  // ── TI form functions ─────────────────────────────────────────────────────

  function handleTinterTypeChange(type: "TINTER" | "ACOTONE") {
    setTinterType(type);
    setTiEntries(prev => prev.map(e => ({
      ...e,
      shadeValues: {}, suggestions: [], suggestionsLoading: false,
      selectedShadeName: null, selectedShadeId: null, showAllColumns: true,
    })));
    setAllSavedShades([]);
  }

  function handleSkuSelect(entryId: string, rawLineItemId: number) {
    const line = tintingLines.find(l => l.rawLineItemId === rawLineItemId);
    if (!line || !selectedJob) return;

    const existing = existingTIEntries.get(rawLineItemId);

    setTiEntries(prev => prev.map(e => e.id !== entryId ? e : {
      ...e,
      rawLineItemId:      line.rawLineItemId,
      skuCodeRaw:         line.skuCodeRaw,
      skuDescriptionRaw:  line.skuDescriptionRaw ?? "",
      unitQty:            line.unitQty,
      packCode:           line.packCode,
      tinQty:             existing ? existing.tinQty : line.unitQty,
      shadeValues:        existing ? existing.shadeValues : {},
      suggestions:        [],
      suggestionsLoading: !existing && !!line.packCode,
      suggestionsExpanded: false,
      flashActive:        !!existing,
      selectedShadeName:  null,
      selectedShadeId:    null,
      showAllColumns:     existing ? false : true,
    }));

    if (existing) {
      setTinterType(existing.table);
      setEditingEntryId({ id: existing.id, table: existing.table });
      setTimeout(() => {
        setTiEntries(prev => prev.map(e => e.id !== entryId ? e : { ...e, flashActive: false }));
      }, 1500);
      return;
    }

    // No existing entry — new entry mode
    setEditingEntryId(null);
    if (!line.packCode) return;
    const url = `/api/tint/operator/shades?shipToCustomerId=${encodeURIComponent(selectedJob.shipToCustomerId)}&tinterType=${tinterType}&skuCode=${encodeURIComponent(line.skuCodeRaw)}&packCode=${encodeURIComponent(line.packCode)}`;
    fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then((d: { data: ShadeSuggestion[] } | null) => {
        setTiEntries(prev => prev.map(e => e.id !== entryId ? e : {
          ...e, suggestions: d?.data ?? [], suggestionsLoading: false,
        }));
      })
      .catch(() => {
        setTiEntries(prev => prev.map(e => e.id !== entryId ? e : { ...e, suggestionsLoading: false }));
      });
  }

  function applyShadeToEntry(entryId: string, shade: ShadeMasterRecord) {
    const cols = tinterType === "TINTER" ? SHADES : ACOTONE_SHADES;
    const shadeValues: Record<string, number> = {};
    for (const col of cols) {
      shadeValues[col.code] = Number(shade[col.code as keyof ShadeMasterRecord]) || 0;
    }

    // Auto-match SKU line if the shade has a skuCode
    const matchedLine = shade.skuCode
      ? (tintingLines.find(l => l.skuCodeRaw === shade.skuCode) ?? null)
      : null;

    setTiEntries(prev => prev.map(e => {
      if (e.id !== entryId) return e;
      return {
        ...e,
        tinQty:            matchedLine ? matchedLine.unitQty : shade.tinQty,
        shadeValues,
        flashActive:       true,
        selectedShadeName: shade.shadeName,
        selectedShadeId:   shade.id,
        showAllColumns:    false,
        ...(matchedLine ? {
          rawLineItemId:     matchedLine.rawLineItemId,
          skuCodeRaw:        matchedLine.skuCodeRaw,
          skuDescriptionRaw: matchedLine.skuDescriptionRaw ?? "",
          unitQty:           matchedLine.unitQty,
          packCode:          matchedLine.packCode,
          suggestions:       [],
          suggestionsLoading: false,
        } : {}),
      };
    }));
    setTimeout(() => {
      setTiEntries(prev => prev.map(e => e.id !== entryId ? e : { ...e, flashActive: false }));
    }, 1500);
  }

  function buildShadeBody(entry: TIFormEntry, job: Job): Record<string, unknown> {
    const cols = tinterType === "TINTER" ? SHADES : ACOTONE_SHADES;
    const body: Record<string, unknown> = {
      shadeName:          entry.shadeName.trim(),
      shipToCustomerId:   job.shipToCustomerId,
      shipToCustomerName: job.shipToCustomerName ?? job.customerName,
      tinterType,
      packCode:           entry.packCode || null,
      skuCode:            entry.skuCodeRaw || null,
      baseSku:            entry.skuCodeRaw,
      tinQty:             entry.tinQty,
    };
    for (const col of cols) {
      body[col.code] = entry.shadeValues[col.code] ?? 0;
    }
    return body;
  }

  async function saveShadesThenSubmitTI(job: Job, entryIds: string[]) {
    for (const entryId of entryIds) {
      const entry = tiEntries.find(e => e.id === entryId);
      if (!entry?.saveAsShade) continue;
      const shadeRes = await fetch("/api/tint/operator/shades", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildShadeBody(entry, job)),
      });
      if (shadeRes.status === 409) {
        const data = (await shadeRes.json()) as { existingId: number; shadeName: string };
        setConflictDialog({
          existingId:   data.existingId,
          shadeName:    data.shadeName,
          entryId,
          job,
          remainingIds: entryIds.slice(entryIds.indexOf(entryId) + 1),
        });
        setTiActionLoading(false);
        return;
      }
      if (!shadeRes.ok) throw new Error("Failed to save shade formula");
    }
    // All shades saved — submit TI
    const cols    = tinterType === "TINTER" ? SHADES : ACOTONE_SHADES;
    const entries = tiEntries.filter(e => e.skuCodeRaw && e.tinQty > 0);
    if (tinterType === "TINTER") {
      const res = await fetch("/api/tint/operator/tinter-issue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId:          job.orderId,
          splitId:          job.type === "split" ? job.id : undefined,
          tintAssignmentId: job.type === "order" ? job.tintAssignmentId : undefined,
          entries: entries.map(e => ({
            rawLineItemId: e.rawLineItemId || undefined,
            baseSku: e.skuCodeRaw, tinQty: e.tinQty, packCode: e.packCode || null,
            ...Object.fromEntries(cols.map(c => [c.code, e.shadeValues[c.code] ?? 0])),
          })),
        }),
      });
      if (!res.ok) { const err = (await res.json()) as { error?: string }; throw new Error(err.error ?? "Failed to submit TI"); }
    } else {
      const res = await fetch("/api/tint/operator/tinter-issue-b", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          splitId:          job.type === "split" ? job.id : undefined,
          tintAssignmentId: job.type === "order" ? job.tintAssignmentId : undefined,
          entries: entries.map(e => ({
            rawLineItemId: e.rawLineItemId || undefined,
            baseSku: e.skuCodeRaw, tinQty: e.tinQty, packCode: e.packCode || null,
            ...Object.fromEntries(cols.map(c => [c.code, e.shadeValues[c.code] ?? 0])),
          })),
        }),
      });
      if (!res.ok) { const err = (await res.json()) as { error?: string }; throw new Error(err.error ?? "Failed to submit TI"); }
    }
    await fetchOrders();
    await loadExistingTIEntries(job);
    setTimeout(() => coverageStripRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
    if (job.status === "tinting_in_progress") {
      setTiEntries([defaultTIFormEntry()]);
      setTiIncompleteWarning(null);
      setTiSuccessToast(true);
      setTimeout(() => setTiSuccessToast(false), 3000);
    } else {
      await startJob(job);
    }
  }

  async function handleSubmitTIAndStart(job: Job) {
    if (tiEntries.length === 0) { setError("Add at least one entry"); return; }
    for (const e of tiEntries) {
      if (!e.skuCodeRaw) { setError("Select a SKU line for all entries"); return; }
      if (e.tinQty <= 0) { setError("Tin Qty must be greater than 0 for all entries"); return; }
    }
    for (const e of tiEntries) {
      if (e.saveAsShade && !e.shadeName.trim()) {
        setTiEntries(prev => prev.map(en => en.id === e.id ? { ...en, shadeNameError: "Shade name is required" } : en));
        return;
      }
    }
    setTiActionLoading(true);
    setError(null);
    try {
      const saveIds = tiEntries.filter(e => e.saveAsShade).map(e => e.id);
      await saveShadesThenSubmitTI(job, saveIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit TI");
    } finally {
      setTiActionLoading(false);
    }
  }

  async function handleConflictOverwrite() {
    if (!conflictDialog) return;
    const { existingId, job, entryId, remainingIds } = conflictDialog;
    setConflictDialog(null);
    setTiActionLoading(true);
    setError(null);
    try {
      const entry = tiEntries.find(e => e.id === entryId);
      if (entry) {
        const res = await fetch(`/api/tint/operator/shades/${existingId}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildShadeBody(entry, job)),
        });
        if (!res.ok) throw new Error("Failed to overwrite shade formula");
      }
      if (remainingIds[0] === "__EDIT__") {
        await doPatchEntry(job);
      } else {
        await saveShadesThenSubmitTI(job, remainingIds);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to overwrite shade");
    } finally {
      setTiActionLoading(false);
    }
  }

  function handleStripRowClick(rawLineItemId: number) {
    const line = tintingLines.find(l => l.rawLineItemId === rawLineItemId);
    if (!line) return;
    const existing = existingTIEntries.get(rawLineItemId);
    if (existing) {
      setTinterType(existing.table);
      setEditingEntryId({ id: existing.id, table: existing.table });
      setTiEntries(prev => {
        const first = prev[0] ?? defaultTIFormEntry();
        return [{
          ...first,
          rawLineItemId:      line.rawLineItemId,
          skuCodeRaw:         line.skuCodeRaw,
          skuDescriptionRaw:  line.skuDescriptionRaw ?? "",
          unitQty:            line.unitQty,
          packCode:           line.packCode,
          tinQty:             existing.tinQty,
          shadeValues:        existing.shadeValues,
          suggestions:        [],
          suggestionsLoading: false,
          suggestionsExpanded: false,
          flashActive:        true,
          selectedShadeName:  null,
          selectedShadeId:    null,
          showAllColumns:     false,
        }, ...prev.slice(1)];
      });
      setTimeout(() => {
        setTiEntries(prev => prev.map((e, i) => i === 0 ? { ...e, flashActive: false } : e));
      }, 1500);
    } else {
      setEditingEntryId(null);
      const firstId = tiEntries[0]?.id;
      if (firstId) handleSkuSelect(firstId, rawLineItemId);
    }
    document.getElementById("ti-form-section")?.scrollIntoView({ behavior: "smooth" });
  }

  async function doPatchEntry(job: Job) {
    if (!editingEntryId) return;
    const entry = tiEntries[0];
    if (!entry) return;
    const cols = editingEntryId.table === "TINTER" ? SHADES : ACOTONE_SHADES;
    const endpoint = editingEntryId.table === "TINTER"
      ? `/api/tint/operator/tinter-issue/${editingEntryId.id}`
      : `/api/tint/operator/tinter-issue-b/${editingEntryId.id}`;
    const res = await fetch(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseSku:       entry.skuCodeRaw,
        tinQty:        entry.tinQty,
        packCode:      entry.packCode || null,
        rawLineItemId: entry.rawLineItemId ?? undefined,
        ...Object.fromEntries(cols.map(c => [c.code, entry.shadeValues[c.code] ?? 0])),
      }),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error ?? "Failed to update entry");
    }
    await loadExistingTIEntries(job);
    setTimeout(() => coverageStripRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
    setEditingEntryId(null);
    setTiEntries(prev => [defaultTIFormEntry(), ...prev.slice(1)]);
    setTiUpdateToast(true);
    setTimeout(() => setTiUpdateToast(false), 3000);
  }

  async function handleUpdateEntry(job: Job) {
    const entry = tiEntries[0];
    if (!entry || !editingEntryId) return;
    if (!entry.skuCodeRaw) { setError("Select a SKU line for entry 1"); return; }
    if (entry.tinQty <= 0) { setError("Tin Qty must be greater than 0 for entry 1"); return; }
    if (entry.saveAsShade && !entry.shadeName.trim()) {
      setTiEntries(prev => prev.map((en, i) => i === 0 ? { ...en, shadeNameError: "Shade name is required" } : en));
      return;
    }
    setTiActionLoading(true);
    setError(null);
    try {
      if (entry.saveAsShade) {
        const shadeRes = await fetch("/api/tint/operator/shades", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildShadeBody(entry, job)),
        });
        if (shadeRes.status === 409) {
          const data = (await shadeRes.json()) as { existingId: number; shadeName: string };
          setConflictDialog({ existingId: data.existingId, shadeName: data.shadeName, entryId: entry.id, job, remainingIds: ["__EDIT__"] });
          setTiActionLoading(false);
          return;
        }
        if (!shadeRes.ok) throw new Error("Failed to save shade formula");
      }
      await doPatchEntry(job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update entry");
    } finally {
      setTiActionLoading(false);
    }
  }

  async function startJob(job: Job) {
    if (job.type === "split") {
      await postSplitAction("/api/tint/operator/split/start", job.id);
    } else {
      await postOrderAction("/api/tint/operator/start", job.id);
    }
  }

  async function markDone(job: Job) {
    setTiIncompleteWarning(null);
    type DoneErrBody = { error?: string; message?: string; missingLines?: { rawLineItemId: number; skuCodeRaw: string; skuDescriptionRaw: string | null }[] };
    if (job.type === "split") {
      setSplitActionLoading(job.id);
      setError(null);
      try {
        const res = await fetch("/api/tint/operator/split/done", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body:   JSON.stringify({ splitId: job.id }),
        });
        if (!res.ok) {
          const data = (await res.json()) as DoneErrBody;
          if (data.error === "TI incomplete") {
            setTiIncompleteWarning(data.missingLines ?? []);
            return;
          }
          throw new Error(data.error ?? "Action failed");
        }
        await fetchOrders();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      } finally {
        setSplitActionLoading(null);
      }
    } else {
      setOrderActionLoading(job.id);
      setError(null);
      try {
        const res = await fetch("/api/tint/operator/done", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body:   JSON.stringify({ orderId: job.id }),
        });
        if (!res.ok) {
          const data = (await res.json()) as DoneErrBody;
          if (data.error === "TI incomplete") {
            setTiIncompleteWarning(data.missingLines ?? []);
            return;
          }
          throw new Error(data.error ?? "Action failed");
        }
        await fetchOrders();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      } finally {
        setOrderActionLoading(null);
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <style>{pulseKeyframes}</style>

      {/* ── TOPBAR ── */}
      <header className="h-[52px] bg-white border-b border-[#e2e5f1] px-4 flex items-center justify-between sticky top-0 z-40 flex-shrink-0 gap-2.5">
        <span className="text-[17px] font-extrabold text-gray-900">
          My Tint Jobs
        </span>
        <div className="flex items-center gap-2">
          {/* Layout toggle */}
          <div className="flex items-center bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg overflow-hidden">
            {/* Split view button */}
            <button
              type="button"
              onClick={() => setFocusMode(false)}
              title="Split view"
              className={cn("w-8 h-[30px] flex items-center justify-center border-none cursor-pointer transition-colors", !focusMode ? "bg-[#e8eaf6] text-[#1a237e]" : "bg-transparent text-gray-400")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="8" height="18" rx="1"/>
                <rect x="13" y="3" width="8" height="18" rx="1"/>
              </svg>
            </button>
            <div className="w-px h-[18px] bg-[#e2e5f1]" />
            {/* Focus view button */}
            <button
              type="button"
              onClick={() => setFocusMode(true)}
              title="Focus view"
              className={cn("w-8 h-[30px] flex items-center justify-center border-none cursor-pointer transition-colors", focusMode ? "bg-[#e8eaf6] text-[#1a237e]" : "bg-transparent text-gray-400")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="1"/>
              </svg>
            </button>
          </div>
          {/* Clock */}
          <div className="font-mono text-[12px] font-semibold text-gray-400 bg-[#f7f8fc] border border-[#e2e5f1] px-2.5 py-1 rounded-lg">
            {clock || "--:--:--"}
          </div>
        </div>
      </header>

      {/* ── STAT BAR ── */}
      <div className="px-3 py-2.5 grid grid-cols-4 gap-3 bg-[#f8f9fa] border-b border-[#e2e5f1]">
        {[
          { label: "Pending",         value: pendingCount,    iconBg: "bg-orange-50",  iconColor: "text-orange-500",  sub: "unassigned",
            icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:14,height:14}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
          { label: "In Progress",     value: inProgressCount, iconBg: "bg-blue-50",    iconColor: "text-blue-600",    sub: "being tinted",
            icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:14,height:14}}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> },
          { label: "Completed Today", value: completedCount,  iconBg: "bg-green-50",   iconColor: "text-green-600",   sub: "tinting done",
            icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:14,height:14}}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
          { label: "Volume Done",
            value: volumeDone >= 1000 ? `${(volumeDone / 1000).toFixed(1)}k L` : `${volumeDone} L`,
            iconBg: "bg-purple-50", iconColor: "text-purple-500", sub: "today",
            icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:14,height:14}}><path d="M3 3h18v4H3z"/><path d="M3 10h12v4H3z"/><path d="M3 17h8v4H3z"/></svg> },
        ].map((cell) => (
          <div key={cell.label} className="bg-white border border-[#e2e5f1] rounded-xl flex items-center gap-[10px] px-[14px] py-[10px]">
            <div className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0", cell.iconBg, cell.iconColor)}>
              {cell.icon}
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-[20px] font-extrabold text-gray-900 leading-none">{cell.value}</span>
                <span className="text-[10px] font-bold uppercase tracking-[.4px] text-gray-500">{cell.label}</span>
              </div>
              <div className="text-[11px] text-gray-400 mt-1">{cell.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── MAIN (placeholder — filled in next steps) ── */}
      <div className="flex flex-1 overflow-hidden">
        <div className={cn("flex flex-col overflow-hidden bg-white border-r border-[#e2e5f1] flex-shrink-0 transition-all", focusMode ? "w-0 hidden" : "w-[35%]")}>
          <div className="flex-1 overflow-y-auto">

            {/* Queue section */}
            <div className="px-3.5 pt-3 pb-1.5">

              {/* Section header */}
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[10px] font-extrabold uppercase tracking-[.6px] text-gray-400">
                  Queue
                </span>
                <span className="text-[10px] font-bold bg-[#f7f8fc] border border-[#e2e5f1] text-gray-500 px-1.5 py-px rounded-full">
                  {jobs.length}
                </span>
              </div>

              {/* Remaining volume hint */}
              <div className="bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg px-2.5 py-1.5 mb-2.5 flex items-center justify-between">
                <span className="text-[10.5px] font-semibold text-gray-500">Remaining volume today</span>
                <span className="text-[12px] font-extrabold text-gray-900">
                  {remainingVolume > 0 ? `${remainingVolume} L` : "— L"}
                </span>
              </div>

              {/* Queue cards */}
              {jobs.length === 0 && (
                <div className="flex flex-col items-center py-8 px-4 text-center">
                  <div className="w-11 h-11 rounded-full bg-[#f7f8fc] border border-[#e2e5f1] flex items-center justify-center mb-2.5">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                  </div>
                  <p className="text-[14px] font-bold text-gray-500">Queue is clear!</p>
                  <p className="text-[12px] text-gray-400 mt-1">All jobs done for today.</p>
                </div>
              )}

              {jobs.map((job, idx) => {
                const isActive   = job.status === "tinting_in_progress";
                const hasActive  = jobs.some(j => j.status === "tinting_in_progress");
                const isNext     = !isActive && !hasActive && idx === 0;
                const isQueued   = !isActive && !isNext;
                const isSelected = job.id === selectedJobId && job.type === selectedJobType;

                const seqLabel = isActive ? "Active"
                  : isNext      ? "Next up"
                  : `#${idx + 1}`;

                return (
                  <div
                    key={`${job.type}-${job.id}`}
                    onClick={() => { setSelectedJobId(job.id); setSelectedJobType(job.type); }}
                    className={cn(
                      "border rounded-xl overflow-hidden mb-2 cursor-pointer transition-all duration-150",
                      isSelected ? "border-[#1a237e] outline outline-2 outline-[#1a237e] outline-offset-1" : "",
                      isActive ? "border-[#bfdbfe]" : isNext ? "border-[#c5cae9]" : "border-[#e2e5f1]",
                      isQueued ? "opacity-55" : ""
                    )}
                  >
                    {/* Card header */}
                    <div className={cn("px-2.5 py-2 border-b flex items-start justify-between gap-1.5",
                      isActive ? "bg-[#eff6ff] border-[#bfdbfe]" : isNext ? "bg-[#e8eaf6] border-[#c5cae9]" : "bg-[#f7f8fc] border-[#e2e5f1]"
                    )}>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-bold text-gray-900 truncate">
                          {job.customerName}
                        </div>
                        <div className="font-mono text-[9px] font-semibold text-[#7c3aed] mt-0.5">
                          {job.obdNumber}{job.splitNumber != null ? ` · Split #${job.splitNumber}` : ""}
                        </div>
                      </div>
                      <span className={cn("text-[10px] font-extrabold px-1.5 py-px rounded-full whitespace-nowrap flex-shrink-0",
                        isActive ? "bg-[#dbeafe] text-[#1e40af]" : isNext ? "bg-[#1a237e] text-white" : "bg-[#f7f8fc] border border-[#e2e5f1] text-gray-400"
                      )}>
                        {seqLabel}
                      </span>
                    </div>

                    {/* Card body */}
                    <div className="px-2.5 py-2 flex items-center justify-between gap-1.5">
                      <div>
                        <div className="text-[11.5px] font-bold text-gray-900">
                          {job.totalVolume != null ? `${job.totalVolume} L` : "—"}{job.articleTag ? ` · ${job.articleTag}` : ""}
                        </div>
                        <div className="text-[10.5px] text-gray-400 mt-px">
                          {job.dispatchSlot ?? "—"}
                        </div>
                      </div>

                      {/* TI coverage badge */}
                      {(() => {
                        const covered = job.tiCoveredLines;
                        const total   = job.totalTintingLines;
                        const allDone = total > 0 && covered >= total;
                        if (total === 0) return null;
                        return allDone ? (
                          <span className="text-[9.5px] font-bold px-1.5 py-px rounded-[5px] bg-[#f0fdf4] border border-[#bbf7d0] text-[#16a34a] flex items-center gap-0.5 whitespace-nowrap flex-shrink-0">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                            TI {covered}/{total}
                          </span>
                        ) : (
                          <span className="text-[9.5px] font-bold px-1.5 py-px rounded-[5px] bg-[#fef2f2] border border-[#fca5a5] text-[#dc2626] whitespace-nowrap flex-shrink-0">
                            TI {covered}/{total}
                          </span>
                        );
                      })()}
                    </div>

                    {/* Fill TI nudge — Next Up card only, TI not done */}
                    {isNext && !job.tiSubmitted && (
                      <div className="mx-2.5 mb-2 px-2.5 py-1.5 bg-[#fffbeb] border border-[#fde68a] rounded-lg text-[11px] font-semibold text-[#92400e] flex items-center gap-1.5">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                        </svg>
                        Fill TI now while you&apos;re free
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedJobId(job.id); setSelectedJobType(job.type); }}
                          className="ml-auto bg-amber-400 text-white border-none rounded-[5px] px-2 py-px text-[10.5px] font-bold cursor-pointer whitespace-nowrap"
                        >
                          Fill →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Divider */}
            <div className="h-px bg-[#e2e5f1] mx-3.5 my-3" />

            {/* Completed Today section */}
            <div className="px-3.5 pb-4">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[10px] font-extrabold uppercase tracking-[.6px] text-gray-400">
                  Completed Today
                </span>
                <span className="text-[10px] font-bold bg-[#f7f8fc] border border-[#e2e5f1] text-gray-500 px-1.5 py-px rounded-full">
                  {completedCount}
                </span>
              </div>

              {completedOrders.length === 0 && completedSplits.length === 0 && (
                <p className="text-[11px] text-gray-400 text-center py-3">
                  No completed jobs yet today.
                </p>
              )}

              {completedOrders.map(co => {
                const customerName = co.order.customer?.customerName ?? co.order.shipToCustomerName ?? "—";
                const doneTime = co.completedAt
                  ? new Date(co.completedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
                  : "—";
                return (
                  <div key={`co-${co.id}`} className="border border-[#e2e5f1] rounded-xl overflow-hidden mb-1.5 opacity-65">
                    <div className="px-2.5 py-2 bg-[#f0fdf4] border-b border-[#bbf7d0]">
                      <div className="text-[12px] font-bold text-gray-900">{customerName}</div>
                      <div className="font-mono text-[9px] font-semibold text-[#7c3aed] mt-0.5">
                        {co.order.obdNumber}
                      </div>
                    </div>
                    <div className="px-2.5 py-1.5 flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-[#27500a] bg-[#eaf3de] border border-[#97c459] px-1.5 py-px rounded-[5px]">
                        ✓ Tinting Done
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-[#16a34a] bg-[#f0fdf4] border border-[#bbf7d0] px-2 py-px rounded-[6px]">
                        {doneTime}
                      </span>
                    </div>
                  </div>
                );
              })}

              {completedSplits.map(sp => {
                const customerName = sp.order.customer?.customerName ?? sp.order.shipToCustomerName ?? "—";
                const doneTime = sp.completedAt
                  ? new Date(sp.completedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
                  : "—";
                return (
                  <div key={`cs-${sp.id}`} className="border border-[#e2e5f1] rounded-xl overflow-hidden mb-1.5 opacity-65">
                    <div className="px-2.5 py-2 bg-[#f0fdf4] border-b border-[#bbf7d0]">
                      <div className="text-[12px] font-bold text-gray-900">{customerName}</div>
                      <div className="font-mono text-[9px] font-semibold text-[#7c3aed] mt-0.5">
                        {sp.order.obdNumber}{sp.splitNumber != null ? ` · Split #${sp.splitNumber}` : ""}
                      </div>
                    </div>
                    <div className="px-2.5 py-1.5 flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-[#27500a] bg-[#eaf3de] border border-[#97c459] px-1.5 py-px rounded-[5px]">
                        ✓ Tinting Done
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-[#16a34a] bg-[#f0fdf4] border border-[#bbf7d0] px-2 py-px rounded-[6px]">
                        {doneTime}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        </div>
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "#f8f9fa",
        }}>

          {/* Update toast */}
          {tiUpdateToast && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-[#f0fdf4] border-b border-[#bbf7d0] flex-shrink-0">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span className="text-[12.5px] font-semibold text-[#15803d]">TI entry updated</span>
            </div>
          )}

          {/* Success toast */}
          {tiSuccessToast && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-[#f0fdf4] border-b border-[#bbf7d0] flex-shrink-0">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span className="text-[12.5px] font-semibold text-[#15803d]">TI entries saved</span>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-[#fef2f2] border-b border-[#fca5a5]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span className="text-[12.5px] font-medium text-[#b91c1c] flex-1">{error}</span>
              <button type="button" onClick={() => setError(null)} className="text-[12px] text-[#dc2626] bg-transparent border-none cursor-pointer underline">
                Dismiss
              </button>
            </div>
          )}

          {/* No job selected */}
          {!selectedJob && (
            <div className="flex-1 flex flex-col items-center justify-center gap-2.5 text-center p-10">
              <div className="w-11 h-11 rounded-full bg-white border border-[#e2e5f1] flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>
                </svg>
              </div>
              <p className="text-[14px] font-bold text-gray-500">No job selected</p>
              <p className="text-[12px] text-gray-400">Tap a job in the queue to view details</p>
            </div>
          )}

          {/* Job detail */}
          {selectedJob && (
            <>
              {/* Job identity topbar */}
              <div className="bg-white border-b border-[#e2e5f1] px-4 py-[11px] flex-shrink-0 flex items-start justify-between gap-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-extrabold text-gray-900 leading-snug mb-1 truncate">
                    {selectedJob.customerName}
                  </div>
                  <div className="font-mono text-[10.5px] font-semibold flex items-center gap-1.5 flex-wrap">
                    <span className="text-[#7c3aed]">{selectedJob.obdNumber}</span>
                    <span className="text-gray-400">
                      {selectedJob.splitNumber != null ? `· Split #${selectedJob.splitNumber}` : ""}
                      {selectedJob.dispatchSlot ? ` · ${selectedJob.dispatchSlot}` : ""}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  {/* Status badge */}
                  <span className={cn("text-[10px] font-bold px-2 py-px rounded-[6px]",
                    selectedJob.status === "tinting_in_progress"
                      ? "bg-[#eff6ff] border border-[#bfdbfe] text-[#1d4ed8]"
                      : "bg-[#fffbeb] border border-[#fde68a] text-[#92400e]"
                  )}>
                    {selectedJob.status === "tinting_in_progress" ? "In Progress" : "Assigned"}
                  </span>
                  {/* Elapsed timer — only when in progress */}
                  {selectedJob.status === "tinting_in_progress" && (
                    <div className="font-mono text-[11px] font-semibold bg-[#eff6ff] border border-[#bfdbfe] text-[#1d4ed8] px-2.5 py-px rounded-[6px] flex items-center gap-1.5 whitespace-nowrap">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#2563eb] flex-shrink-0" style={{ animation: "pulse 1.4s ease-in-out infinite" }} />
                      {elapsed}
                    </div>
                  )}
                </div>
              </div>

              {/* Stage colour strip */}
              <div style={{
                height: 3, flexShrink: 0,
                background: selectedJob.status === "tinting_in_progress"
                  ? "linear-gradient(90deg,#3b82f6,#93c5fd)"
                  : "linear-gradient(90deg,#fbbf24,#fcd34d)",
              }} />

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto">

                {/* Meta strip */}
                <div className="bg-white border-b border-[#e2e5f1] grid grid-cols-4 flex-shrink-0">
                  {[
                    { label: "Articles", value: selectedJob.articleTag ?? "—" },
                    { label: "Volume",   value: selectedJob.totalVolume != null ? `${selectedJob.totalVolume} L` : "—" },
                    { label: "Slot",     value: selectedJob.dispatchSlot ?? "—" },
                    { label: "Sales Officer", value: "—" },
                  ].map(cell => (
                    <div key={cell.label} className="px-3.5 py-[9px] border-r border-[#e2e5f1]">
                      <div className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400 mb-0.5">
                        {cell.label}
                      </div>
                      <div className="text-[12.5px] font-bold text-gray-900">{cell.value}</div>
                    </div>
                  ))}
                </div>

                {/* SKU Lines */}
                <div className="px-4 py-3.5">
                  <div className="text-[10px] font-extrabold uppercase tracking-[.6px] text-gray-400 mb-2.5 flex items-center gap-2">
                    SKU Lines
                    <div className="flex-1 h-px bg-[#e2e5f1]" />
                  </div>

                  {selectedJob.lineItems.length === 0 ? (
                    <p className="text-[12px] text-gray-400">No SKU lines found.</p>
                  ) : (
                    <table className="w-full border-collapse bg-white border border-[#e2e5f1] rounded-xl overflow-hidden">
                      <thead>
                        <tr className="bg-[#f7f8fc] border-b border-[#e2e5f1]">
                          {["Code", "Description", "Qty", "Volume"].map((h, i) => (
                            <th key={h} className={cn("px-3 py-2 text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400", i >= 2 ? "text-right" : "text-left")}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedJob.lineItems.map((item, i) => (
                          <tr key={i} className="border-b border-[#e2e5f1] last:border-b-0">
                            <td className="px-3 py-[9px] font-mono text-[#7c3aed] text-[10.5px] font-semibold">
                              {item.rawLineItem.skuCodeRaw}
                            </td>
                            <td className="px-3 py-[9px] text-[12px] font-semibold text-gray-900">
                              {item.rawLineItem.skuDescriptionRaw ?? "—"}
                              {item.rawLineItem.isTinting && (
                                <span className="text-[9px] font-bold uppercase bg-[#ede9fe] border border-[#c4b5fd] text-[#5b21b6] px-1.5 py-px rounded-[4px] ml-1">
                                  TINT
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-[9px] text-[12px] font-semibold text-gray-900 text-right">
                              {item.rawLineItem.unitQty}
                            </td>
                            <td className="px-3 py-[9px] text-[12px] font-semibold text-gray-500 text-right">
                              {item.rawLineItem.volumeLine != null ? `${item.rawLineItem.volumeLine} L` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* TI Status Strip */}
                {tintingLines.length > 0 && (
                  <div ref={coverageStripRef} className="px-4 pb-2">
                    <div className="text-[10px] font-extrabold uppercase tracking-[.6px] text-gray-400 mb-2 flex items-center gap-2">
                      TI Coverage
                      <div className="flex-1 h-px bg-[#e2e5f1]" />
                      {tiEntriesLoading && <span className="text-[9px] font-semibold text-gray-400">loading…</span>}
                    </div>
                    <div className="bg-[#f7f8fc] border border-[#e2e5f1] rounded-[10px] overflow-hidden">
                      {tintingLines.map((line, i) => {
                        const done    = existingTIEntries.has(line.rawLineItemId);
                        const tiEntry = done ? existingTIEntries.get(line.rawLineItemId)! : null;
                        const shadeStr = tiEntry
                          ? Object.entries(tiEntry.shadeValues)
                              .filter(([, v]) => v > 0)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join("  ")
                          : "";
                        return (
                          <div
                            key={line.rawLineItemId}
                            onClick={() => handleStripRowClick(line.rawLineItemId)}
                            className={cn("flex gap-2 px-3 py-2 cursor-pointer", done ? "items-start bg-[#f0fdf4]" : "items-center bg-[#fffbeb]", i < tintingLines.length - 1 ? "border-b border-[#e2e5f1]" : "")}
                          >
                            <span className={cn("text-[14px] flex-shrink-0", done ? "mt-px" : "")}>{done ? "✅" : "⏳"}</span>
                            <div className="flex-1 min-w-0">
                              <div>
                                <span className="text-[11.5px] font-bold text-gray-900 font-mono">{line.skuCodeRaw}</span>
                                {line.skuDescriptionRaw && <span className="text-[11px] text-gray-500"> · {line.skuDescriptionRaw}</span>}
                                <span className="text-[10.5px] text-gray-400"> · {line.unitQty} qty · {PACK_CODES.find(p => p.value === line.packCode)?.label ?? line.packCode}</span>
                              </div>
                              {tiEntry && shadeStr && (
                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  <span className={cn("text-[9px] font-bold px-1.5 py-px rounded-[3px] flex-shrink-0",
                                    tiEntry.table === "TINTER" ? "bg-[#e0e7ff] border border-[#a5b4fc] text-[#3730a3]" : "bg-[#fef9c3] border border-[#fde047] text-[#713f12]"
                                  )}>
                                    {tiEntry.table === "TINTER" ? "Tinter" : "Acotone"}
                                  </span>
                                  <span className="text-[10.5px] text-gray-500 font-mono">{shadeStr}</span>
                                </div>
                              )}
                            </div>
                            <span className={cn("text-[10px] font-bold px-1.5 py-px rounded-[5px] flex-shrink-0", done ? "mt-px" : "", done ? "bg-[#dcfce7] border border-[#86efac] text-[#15803d]" : "bg-[#fef9c3] border border-[#fde047] text-[#854d0e]")}>
                              {done ? "TI Done" : "Pending"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {(() => {
                      const covered = tintingLines.filter(l => existingTIEntries.has(l.rawLineItemId)).length;
                      const total   = tintingLines.length;
                      const allDone = covered === total;
                      return (
                        <p className={cn("text-[11px] font-semibold mt-1.5", allDone ? "text-[#15803d]" : "text-[#92400e]")}>
                          {covered} of {total} lines covered
                        </p>
                      );
                    })()}
                  </div>
                )}

                {/* TI Form */}
                <div id="ti-form-section" className="px-4 pb-2">

                  {/* Section title */}
                  <div className="text-[10px] font-extrabold uppercase tracking-[.6px] text-gray-400 mb-2.5 flex items-center gap-2">
                    Tinter Issue Form
                    <div className="flex-1 h-px bg-[#e2e5f1]" />
                  </div>

                  {/* No tinting lines */}
                  {tintingLines.length === 0 && (
                    <div className="bg-white border border-[#e2e5f1] rounded-xl p-4 text-center">
                      <p className="text-[12px] text-gray-400">No tinting lines in this job — start directly.</p>
                    </div>
                  )}

                  {/* Single-form */}
                  {tintingLines.length > 0 && (
                    <div className="bg-white border border-[#e2e5f1] rounded-xl overflow-hidden">

                      {/* Tinter type selector */}
                      <div className="px-3.5 py-2.5 border-b border-[#f0f2f8] flex gap-1.5">
                        {(["TINTER", "ACOTONE"] as const).map(t => (
                          <button key={t} type="button"
                            onClick={() => handleTinterTypeChange(t)}
                            className={cn("px-4 py-[5px] rounded-[6px] text-[12px] font-bold cursor-pointer border",
                              tinterType === t ? "bg-[#1a237e] text-white border-[#1a237e]" : "bg-white text-gray-500 border-[#d1d5db]"
                            )}>
                            {t === "TINTER" ? "Tinter" : "Acotone"}
                          </button>
                        ))}
                      </div>

                      {/* All saved shades combobox (shared, shown once above entries) */}
                      <div className="px-3.5 py-2.5 border-b border-[#f0f2f8]">
                        <div className="flex items-center gap-1 mb-1.5">
                          <span className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400">All Saved Shades</span>
                          <span className="text-[9.5px] text-gray-300">(optional — applies to focused entry)</span>
                        </div>
                        <Popover open={allShadesComboOpen !== null} onOpenChange={(open) => {
                          if (!open) { setAllShadesComboOpen(null); setAllShadesSearch(""); }
                        }}>
                          <PopoverTrigger
                            onClick={() => {
                              const firstEntryId = tiEntries[0]?.id ?? null;
                              setAllShadesComboOpen(firstEntryId);
                            }}
                            style={{ width: "100%", height: 34, background: "#f7f8fc", border: "1px solid #e2e5f1", borderRadius: 8, padding: "0 10px", fontSize: 12, fontWeight: 500, color: "#111827", outline: "none", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: "#9ca3af" }}>
                              {allShadesLoading ? "Loading…" : "Browse all shades…"}
                            </span>
                            <ChevronDown size={13} style={{ flexShrink: 0, color: "#9ca3af", marginLeft: 4 }} />
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-72 p-0">
                            <div style={{ padding: 8 }}>
                              <input type="text" placeholder="Search shades…" value={allShadesSearch}
                                onChange={e => setAllShadesSearch(e.target.value)}
                                style={{ width: "100%", height: 30, border: "1px solid #e2e5f1", borderRadius: 6, padding: "0 8px", fontSize: 11.5, outline: "none" }} />
                            </div>
                            <div style={{ maxHeight: 200, overflowY: "auto" }}>
                              {allSavedShades
                                .filter(s => !allShadesSearch || s.shadeName.toLowerCase().includes(allShadesSearch.toLowerCase()))
                                .map(shade => (
                                  <div key={shade.id}
                                    onClick={() => {
                                      const targetId = allShadesComboOpen ?? tiEntries[0]?.id;
                                      if (targetId) applyShadeToEntry(targetId, shade);
                                      setAllShadesComboOpen(null);
                                      setAllShadesSearch("");
                                    }}
                                    className="px-3 py-[7px] cursor-pointer text-[12px] font-medium text-gray-900 border-t border-[#f3f4f6] hover:bg-[#f7f8fc]">
                                    <span className="font-semibold">{shade.shadeName}</span>
                                    <span className="text-gray-400 text-[11px]"> · {PACK_CODES.find(p => p.value === shade.packCode)?.label ?? shade.packCode ?? "—"}</span>
                                  </div>
                                ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>

                      {/* Entries */}
                      {tiEntries.map((entry, idx) => {
                        const shadeColumns = tinterType === "TINTER" ? SHADES : ACOTONE_SHADES;
                        const flash = entry.flashActive;
                        const visibleSugs = entry.suggestionsExpanded ? entry.suggestions : entry.suggestions.slice(0, 3);

                        return (
                          <div key={entry.id} className="border-b border-[#e2e5f1]">
                            {/* Entry header */}
                            <div className="px-3.5 py-2 bg-[#f7f8fc] border-b border-[#f0f2f8] flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-extrabold uppercase tracking-[.5px] text-gray-400">Entry {idx + 1}</span>
                                {idx === 0 && editingEntryId && (
                                  <>
                                    <span className="text-[9.5px] font-bold px-1.5 py-px rounded-[4px] bg-[#e0e7ff] border border-[#a5b4fc] text-[#3730a3]">
                                      Editing existing entry
                                    </span>
                                    <button type="button"
                                      onClick={() => { setEditingEntryId(null); setTiEntries(prev => [defaultTIFormEntry(), ...prev.slice(1)]); }}
                                      className="text-[10.5px] font-semibold text-gray-500 bg-transparent border-none cursor-pointer underline p-0">
                                      Cancel edit
                                    </button>
                                  </>
                                )}
                              </div>
                              {tiEntries.length > 1 && (
                                <button type="button"
                                  onClick={() => setTiEntries(prev => prev.filter(e => e.id !== entry.id))}
                                  className="w-[22px] h-[22px] rounded-[5px] border border-[#fca5a5] bg-[#fef2f2] flex items-center justify-center cursor-pointer text-[#dc2626]">
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                              )}
                            </div>

                            <div className="px-3.5 py-3">
                              {/* 1. Base SKU Dropdown */}
                              <div className="mb-2.5">
                                <span className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400 block mb-1">Base SKU</span>
                                <select
                                  value={entry.rawLineItemId ?? ""}
                                  onChange={e => {
                                    const val = Number(e.target.value);
                                    if (val) handleSkuSelect(entry.id, val);
                                  }}
                                  style={{ width: "100%", height: 34, background: "#f7f8fc", border: "1px solid #e2e5f1", borderRadius: 8, padding: "0 8px", fontSize: 12, fontWeight: 500, color: entry.rawLineItemId ? "#111827" : "#9ca3af", outline: "none" }}>
                                  <option value="">Select SKU line…</option>
                                  {tintingLines.map(line => (
                                    <option key={line.rawLineItemId} value={line.rawLineItemId}>
                                      {line.skuCodeRaw}{line.skuDescriptionRaw ? ` · ${line.skuDescriptionRaw}` : ""} · {line.unitQty} qty · {PACK_CODES.find(p => p.value === line.packCode)?.label ?? line.packCode}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {/* 2. Suggestions panel — only when SKU selected and suggestions exist */}
                              {entry.skuCodeRaw && (entry.suggestionsLoading || entry.suggestions.length > 0) && (
                                <div className="mb-2.5 px-2.5 py-2 bg-[#fffbeb] border border-[#fde68a] rounded-[8px]">
                                  <div className="text-[9.5px] font-bold uppercase tracking-[.4px] text-[#92400e] mb-1.5 flex items-center gap-1.5">
                                    Suggestions
                                    {entry.suggestionsLoading && <span className="text-[9px] font-medium text-[#d97706]">loading…</span>}
                                  </div>
                                  {visibleSugs.map(sug => (
                                    <div key={sug.id} className="flex items-center gap-2 mb-1">
                                      <div className="flex-1 min-w-0">
                                        <span className="text-[11.5px] font-bold text-gray-900">🎨 {sug.shadeName}</span>
                                        <span className="text-[10.5px] text-gray-500 ml-1">· {PACK_CODES.find(p => p.value === sug.packCode)?.label ?? sug.packCode ?? "—"}</span>
                                        <div className="text-[9.5px] text-gray-400">
                                          {sug.lastUsedAt ? `Last used: ${new Date(sug.lastUsedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}` : "First time"}
                                        </div>
                                      </div>
                                      <button type="button"
                                        onClick={() => applyShadeToEntry(entry.id, sug)}
                                        className="text-[10.5px] font-bold px-2.5 py-px rounded-[5px] bg-amber-400 text-white border-none cursor-pointer flex-shrink-0">
                                        Use this
                                      </button>
                                    </div>
                                  ))}
                                  {entry.suggestions.length > 3 && (
                                    <button type="button"
                                      onClick={() => setTiEntries(prev => prev.map(e => e.id === entry.id ? { ...e, suggestionsExpanded: !e.suggestionsExpanded } : e))}
                                      className="text-[10.5px] font-semibold text-[#92400e] bg-transparent border-none cursor-pointer p-0">
                                      {entry.suggestionsExpanded ? "Show less" : `+${entry.suggestions.length - 3} more`}
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* 4+5. Tin Qty + Pack Size display */}
                              <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: "1fr 100px" }}>
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400">Tin Qty</span>
                                  <input type="number" min={0} step={0.1} placeholder="0" value={entry.tinQty || ""}
                                    onChange={e => setTiEntries(prev => prev.map(en => en.id === entry.id ? { ...en, tinQty: Number(e.target.value) } : en))}
                                    style={{ height: 34, background: flash ? "#fffbeb" : "#f7f8fc", border: `1px solid ${flash ? "#fcd34d" : "#e2e5f1"}`, borderRadius: 8, padding: "0 10px", fontSize: 12, fontWeight: 500, color: "#111827", outline: "none", transition: "background .3s,border-color .3s" }} />
                                </div>
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400">Pack Size</span>
                                  <div className={cn("h-[34px] bg-[#f0f2f8] border border-[#e2e5f1] rounded-[8px] px-2.5 text-[12px] font-semibold flex items-center", entry.packCode ? "text-gray-900" : "text-gray-400")}>
                                    {entry.packCode ? (PACK_CODES.find(p => p.value === entry.packCode)?.label ?? entry.packCode) : "—"}
                                  </div>
                                </div>
                              </div>

                              {/* Selected shade indicator */}
                              {entry.selectedShadeName !== null && (
                                <div className="flex items-center justify-between mb-2">
                                  <span className="inline-flex items-center gap-1.5 bg-[#e8eaf6] border border-[#1a237e] rounded-full px-2.5 py-px text-[11px] text-[#1a237e] font-semibold">
                                    <Palette size={11} />
                                    {entry.selectedShadeName}
                                  </span>
                                  <button type="button"
                                    onClick={() => setTiEntries(prev => prev.map(en => en.id === entry.id ? {
                                      ...en,
                                      selectedShadeName: null, selectedShadeId: null,
                                      shadeValues: {}, showAllColumns: true,
                                    } : en))}
                                    className="text-[10.5px] font-bold text-[#dc2626] bg-transparent border-none cursor-pointer px-0.5">
                                    Clear ×
                                  </button>
                                </div>
                              )}

                              {/* 6. Shade Columns Grid */}
                              {(() => {
                                const allCols = shadeColumns as readonly { code: string; bg: string; border: string; text: string }[];
                                const activeCols = allCols.filter(col => (entry.shadeValues[col.code] ?? 0) > 0);
                                const displayCols = (!entry.showAllColumns && activeCols.length > 0) ? activeCols : allCols;
                                const hiddenCount = allCols.length - activeCols.length;
                                const showToggle = entry.selectedShadeName !== null && activeCols.length > 0;
                                return (
                                  <>
                                    <div className="text-[9.5px] font-extrabold uppercase tracking-[.5px] text-gray-400 mb-1.5">Shade Quantities</div>
                                    <div className="grid grid-cols-7 gap-1 mb-1">
                                      {displayCols.slice(0, 7).map(shade => (
                                        <div key={shade.code} className="flex flex-col items-center gap-0.5">
                                          <div style={{ fontSize: 9, fontWeight: 800, padding: "3px 0", borderRadius: 5, width: "100%", textAlign: "center", background: shade.bg, border: `1.5px solid ${shade.border}`, color: shade.text }}>{shade.code}</div>
                                          <input type="number" min={0} step={0.01} placeholder="—"
                                            value={entry.shadeValues[shade.code] || ""}
                                            onChange={e => setTiEntries(prev => prev.map(en => en.id === entry.id ? { ...en, shadeValues: { ...en.shadeValues, [shade.code]: Number(e.target.value) } } : en))}
                                            style={{ width: "100%", padding: "5px 2px", borderRadius: 5, fontSize: 11, fontWeight: 700, textAlign: "center", background: flash ? "#fffbeb" : shade.bg, border: `1.5px solid ${flash ? "#fcd34d" : shade.border}`, color: shade.text, outline: "none", fontFamily: "monospace", transition: "background .3s,border-color .3s" }} />
                                        </div>
                                      ))}
                                    </div>
                                    {displayCols.length > 7 && (
                                      <div className="grid grid-cols-7 gap-1 mb-1">
                                        {displayCols.slice(7).map(shade => (
                                          <div key={shade.code} className="flex flex-col items-center gap-0.5">
                                            <div style={{ fontSize: 9, fontWeight: 800, padding: "3px 0", borderRadius: 5, width: "100%", textAlign: "center", background: shade.bg, border: `1.5px solid ${shade.border}`, color: shade.text }}>{shade.code}</div>
                                            <input type="number" min={0} step={0.01} placeholder="—"
                                              value={entry.shadeValues[shade.code] || ""}
                                              onChange={e => setTiEntries(prev => prev.map(en => en.id === entry.id ? { ...en, shadeValues: { ...en.shadeValues, [shade.code]: Number(e.target.value) } } : en))}
                                              style={{ width: "100%", padding: "5px 2px", borderRadius: 5, fontSize: 11, fontWeight: 700, textAlign: "center", background: flash ? "#fffbeb" : shade.bg, border: `1.5px solid ${flash ? "#fcd34d" : shade.border}`, color: shade.text, outline: "none", fontFamily: "monospace", transition: "background .3s,border-color .3s" }} />
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {showToggle && (
                                      <button type="button"
                                        onClick={() => setTiEntries(prev => prev.map(en => en.id === entry.id ? { ...en, showAllColumns: !en.showAllColumns } : en))}
                                        className="text-[10.5px] font-semibold text-[#1a237e] bg-transparent border-none cursor-pointer py-0.5 pb-2 block">
                                        {!entry.showAllColumns
                                          ? `+ Show all columns (${hiddenCount} hidden)`
                                          : `− Show active columns only`}
                                      </button>
                                    )}
                                    {!showToggle && <div className="mb-2.5" />}
                                  </>
                                );
                              })()}

                              {/* 7. Save as Shade Toggle — only when SKU selected */}
                              {entry.skuCodeRaw && (
                                <div className="border-t border-[#f0f2f8] pt-2.5">
                                  <div className="flex items-center gap-2">
                                    <Switch
                                      checked={entry.saveAsShade}
                                      onCheckedChange={(v: boolean) => setTiEntries(prev => prev.map(en => en.id === entry.id ? { ...en, saveAsShade: v, shadeNameError: "" } : en))}
                                      className="data-[checked]:bg-[#1a237e] data-[unchecked]:bg-[#d1d5db]"
                                    />
                                    <span className="text-[12px] font-semibold text-gray-700">Save as shade formula</span>
                                  </div>
                                  <div style={{ overflow: "hidden", maxHeight: entry.saveAsShade ? "80px" : "0px", transition: "max-height 200ms ease", marginTop: entry.saveAsShade ? 8 : 0 }}>
                                    <div className="flex flex-col gap-0.5">
                                      <span className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400">
                                        Shade name <span className="text-[#ef4444]">*</span>
                                      </span>
                                      <input type="text" placeholder="e.g. Ivory White"
                                        value={entry.shadeName}
                                        onChange={e => setTiEntries(prev => prev.map(en => en.id === entry.id ? { ...en, shadeName: e.target.value, shadeNameError: "" } : en))}
                                        style={{ height: 34, background: "#f7f8fc", border: `1px solid ${entry.shadeNameError ? "#ef4444" : "#e2e5f1"}`, borderRadius: 8, padding: "0 10px", fontSize: 12, fontWeight: 500, color: "#111827", outline: "none" }} />
                                      {entry.shadeNameError && <span className="text-[10.5px] text-[#ef4444]">{entry.shadeNameError}</span>}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Add Another Entry */}
                      <div
                        onClick={() => setTiEntries(prev => [...prev, defaultTIFormEntry()])}
                        className="px-3.5 py-2.5 flex items-center justify-center gap-1.5 text-[11.5px] font-bold text-[#1a237e] cursor-pointer bg-[#e8eaf6]">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Add Another Entry
                      </div>

                    </div>
                  )}

                </div>

              </div>

              {/* Footer */}
              <div className="bg-white border-t border-[#e2e5f1] px-4 py-[11px] flex-shrink-0 flex items-center gap-2.5">
                {(() => {
                  const isLoading = (selectedJob.type === "split"
                    ? splitActionLoading === selectedJob.id
                    : orderActionLoading === selectedJob.id) || tiActionLoading;

                  // Case 1 — In progress → Add TI Entry + Mark as Done
                  if (selectedJob.status === "tinting_in_progress") {
                    const isTILoading   = tiActionLoading;
                    const isDoneLoading = selectedJob.type === "split"
                      ? splitActionLoading === selectedJob.id
                      : orderActionLoading === selectedJob.id;
                    const anyLoading = isTILoading || isDoneLoading;
                    return (
                      <div className="flex-1 flex flex-col gap-2">
                        {/* TI incomplete warning */}
                        {tiIncompleteWarning && tiIncompleteWarning.length > 0 && (
                          <div className="bg-[#fffbeb] border border-[#fde68a] rounded-[8px] px-3 py-2.5">
                            <p className="text-[12px] font-bold text-[#92400e] mb-1">
                              Some tinting lines are missing TI entries:
                            </p>
                            <ul className="text-[11.5px] text-[#b45309] mb-1.5 ml-3.5" style={{ padding: 0 }}>
                              {tiIncompleteWarning.map(line => (
                                <li key={line.rawLineItemId}>
                                  {line.skuCodeRaw}{line.skuDescriptionRaw ? ` · ${line.skuDescriptionRaw}` : ""}
                                </li>
                              ))}
                            </ul>
                            <p className="text-[11px] text-[#92400e]">
                              Please fill TI entries for these lines before marking Done.
                            </p>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => editingEntryId ? handleUpdateEntry(selectedJob) : handleSubmitTIAndStart(selectedJob)}
                            disabled={anyLoading}
                            className={cn("flex-1 bg-[#1a237e] text-white border-none rounded-[10px] py-[11px] text-[13px] font-bold flex items-center justify-center gap-1.5 transition-opacity", anyLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer")}
                          >
                            {isTILoading
                              ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" style={{ animation: "spin .7s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            }
                            {editingEntryId ? "Update TI Entry" : "Add TI Entry"}
                          </button>
                          <button
                            type="button"
                            onClick={() => markDone(selectedJob)}
                            disabled={anyLoading}
                            className={cn("flex-1 bg-[#16a34a] text-white border-none rounded-[10px] py-[11px] text-[13px] font-bold flex items-center justify-center gap-1.5 transition-opacity", anyLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer")}
                          >
                            {isDoneLoading
                              ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" style={{ animation: "spin .7s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                            }
                            Mark as Done
                          </button>
                        </div>
                      </div>
                    );
                  }

                  // Case 2 — TI not submitted
                  if (!selectedJob.tiSubmitted) {
                    // No tinting lines → Start directly
                    if (tintingLines.length === 0) {
                      return (
                        <button
                          type="button"
                          onClick={() => startJob(selectedJob)}
                          disabled={isLoading}
                          className={cn("flex-1 bg-[#1a237e] text-white border-none rounded-[10px] py-[11px] text-[13px] font-bold flex items-center justify-center gap-1.5 transition-opacity", isLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer")}
                        >
                          {isLoading
                            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" style={{ animation: "spin .7s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                          }
                          Start Job
                        </button>
                      );
                    }
                    // Tinting lines exist → Submit TI & Start
                    return (
                      <button
                        type="button"
                        onClick={() => editingEntryId ? handleUpdateEntry(selectedJob) : handleSubmitTIAndStart(selectedJob)}
                        disabled={isLoading}
                        className={cn("flex-1 bg-[#1a237e] text-white border-none rounded-[10px] py-[11px] text-[13px] font-bold flex items-center justify-center gap-1.5 transition-opacity", isLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer")}
                      >
                        {isLoading
                          ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" style={{ animation: "spin .7s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                          : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        }
                        {editingEntryId ? "Update TI Entry" : "Submit TI & Start"}
                      </button>
                    );
                  }

                  // Case 3 — TI submitted, another job in progress → blocked
                  if (hasActiveJob) {
                    return (
                      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-gray-400">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0">
                          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                        Another job is in progress — TI submitted ✓
                      </div>
                    );
                  }

                  // Case 4 — TI submitted, no active job → Start Job (or Update TI Entry if in edit mode)
                  return (
                    <div className="flex-1 flex gap-2">
                      {editingEntryId && (
                        <button
                          type="button"
                          onClick={() => handleUpdateEntry(selectedJob)}
                          disabled={isLoading}
                          className={cn("flex-1 bg-[#1a237e] text-white border-none rounded-[10px] py-[11px] text-[13px] font-bold flex items-center justify-center gap-1.5 transition-opacity", isLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer")}
                        >
                          {isLoading
                            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" style={{ animation: "spin .7s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                          }
                          Update TI Entry
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startJob(selectedJob)}
                        disabled={isLoading}
                        className={cn("flex-1 bg-[#1a237e] text-white border-none rounded-[10px] py-[11px] text-[13px] font-bold flex items-center justify-center gap-1.5 transition-opacity", isLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer")}
                      >
                        {isLoading
                          ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" style={{ animation: "spin .7s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                          : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        }
                        Start Job
                      </button>
                    </div>
                  );
                })()}
              </div>

            </>
          )}

        </div>
      </div>

      {/* Focus mode FAB */}
      {focusMode && (
        <button
          type="button"
          onClick={() => setQueueSheetOpen(true)}
          style={{ position: "fixed", bottom: 80, left: 16, zIndex: 60 }}
          className="w-12 h-12 rounded-full bg-[#1a237e] text-white border-none cursor-pointer flex items-center justify-center shadow-lg"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <line x1="8" y1="6" x2="21" y2="6"/>
            <line x1="8" y1="12" x2="21" y2="12"/>
            <line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/>
            <line x1="3" y1="12" x2="3.01" y2="12"/>
            <line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
          {jobs.length > 0 && (
            <span style={{ position: "absolute", top: -2, right: -2 }}
              className="w-[18px] h-[18px] rounded-full bg-[#ef4444] text-[9.5px] font-extrabold text-white flex items-center justify-center border-2 border-white">
              {jobs.length}
            </span>
          )}
        </button>
      )}

      {/* Queue sheet overlay */}
      {queueSheetOpen && (
        <div
          onClick={() => setQueueSheetOpen(false)}
          className="fixed inset-0 z-[70] bg-black/40"
        />
      )}

      {/* Queue sheet */}
      <div
        className="bg-white flex flex-col shadow-2xl"
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 71,
          borderRadius: "18px 18px 0 0", maxHeight: "72vh",
          transform: queueSheetOpen ? "translateY(0)" : "translateY(100%)",
          transition: "transform .26s cubic-bezier(.32,.72,0,1)",
          pointerEvents: queueSheetOpen ? "all" : "none",
        }}>
        {/* Handle */}
        <div className="w-9 h-1 bg-[#e2e5f1] rounded-sm mx-auto mt-2.5 flex-shrink-0" />

        {/* Sheet header */}
        <div className="px-4 py-3 border-b border-[#e2e5f1] flex-shrink-0 flex items-center justify-between">
          <span className="text-[14px] font-extrabold text-gray-900">Queue &amp; Completed</span>
          <button
            type="button"
            onClick={() => setQueueSheetOpen(false)}
            className="w-7 h-7 rounded-[8px] border border-[#e2e5f1] bg-[#f7f8fc] flex items-center justify-center cursor-pointer text-gray-500"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Sheet body */}
        <div className="overflow-y-auto px-4 py-3 pb-6">

          {/* Queue label */}
          <div className="text-[10px] font-extrabold uppercase tracking-[.6px] text-gray-400 mb-2.5">
            Queue
          </div>

          {/* Queue cards */}
          {jobs.map((job, idx) => {
            const isActive   = job.status === "tinting_in_progress";
            const hasActive  = jobs.some(j => j.status === "tinting_in_progress");
            const isNext     = !isActive && !hasActive && idx === 0;
            const isQueued   = !isActive && !isNext;
            const isSelected = job.id === selectedJobId && job.type === selectedJobType;
            const seqLabel   = isActive ? "Active" : isNext ? "Next up" : `#${idx + 1}`;

            return (
              <div
                key={`sheet-${job.type}-${job.id}`}
                onClick={() => { setSelectedJobId(job.id); setSelectedJobType(job.type); setQueueSheetOpen(false); }}
                className={cn(
                  "border rounded-xl overflow-hidden mb-2 cursor-pointer transition-all duration-150",
                  isSelected ? "border-[#1a237e] outline outline-2 outline-[#1a237e] outline-offset-1" : "",
                  isActive ? "border-[#bfdbfe]" : isNext ? "border-[#c5cae9]" : "border-[#e2e5f1]",
                  isQueued ? "opacity-55" : ""
                )}
              >
                <div className={cn("px-2.5 py-2 border-b flex items-start justify-between gap-1.5",
                  isActive ? "bg-[#eff6ff] border-[#bfdbfe]" : isNext ? "bg-[#e8eaf6] border-[#c5cae9]" : "bg-[#f7f8fc] border-[#e2e5f1]"
                )}>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-bold text-gray-900 truncate">
                      {job.customerName}
                    </div>
                    <div className="font-mono text-[9px] font-semibold text-[#7c3aed] mt-0.5">
                      {job.obdNumber}{job.splitNumber != null ? ` · Split #${job.splitNumber}` : ""}
                    </div>
                  </div>
                  <span className={cn("text-[10px] font-extrabold px-1.5 py-px rounded-full whitespace-nowrap flex-shrink-0",
                    isActive ? "bg-[#dbeafe] text-[#1e40af]" : isNext ? "bg-[#1a237e] text-white" : "bg-[#f7f8fc] border border-[#e2e5f1] text-gray-400"
                  )}>
                    {seqLabel}
                  </span>
                </div>
                <div className="px-2.5 py-2 flex items-center justify-between gap-1.5">
                  <div>
                    <div className="text-[11.5px] font-bold text-gray-900">
                      {job.totalVolume != null ? `${job.totalVolume} L` : "—"}{job.articleTag ? ` · ${job.articleTag}` : ""}
                    </div>
                    <div className="text-[10.5px] text-gray-400 mt-px">{job.dispatchSlot ?? "—"}</div>
                  </div>
                  {job.tiSubmitted
                    ? <span className="text-[9.5px] font-bold px-1.5 py-px rounded-[5px] bg-[#f0fdf4] border border-[#bbf7d0] text-[#16a34a] whitespace-nowrap flex-shrink-0">✓ TI Done</span>
                    : <span className="text-[9.5px] font-bold px-1.5 py-px rounded-[5px] bg-[#fef2f2] border border-[#fca5a5] text-[#dc2626] whitespace-nowrap flex-shrink-0">TI Needed</span>
                  }
                </div>
              </div>
            );
          })}

          {/* Divider */}
          <div className="h-px bg-[#e2e5f1] my-2 mb-3" />

          {/* Completed label */}
          <div className="text-[10px] font-extrabold uppercase tracking-[.6px] text-gray-400 mb-2.5">
            Completed Today
          </div>

          {completedOrders.length === 0 && completedSplits.length === 0 && (
            <p className="text-[11px] text-gray-400 text-center py-2">
              No completed jobs yet today.
            </p>
          )}

          {completedOrders.map(co => {
            const customerName = co.order.customer?.customerName ?? co.order.shipToCustomerName ?? "—";
            const doneTime = co.completedAt
              ? new Date(co.completedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
              : "—";
            return (
              <div key={`sheet-co-${co.id}`} className="border border-[#e2e5f1] rounded-xl overflow-hidden mb-1.5 opacity-65">
                <div className="px-2.5 py-2 bg-[#f0fdf4] border-b border-[#bbf7d0]">
                  <div className="text-[12px] font-bold text-gray-900">{customerName}</div>
                  <div className="font-mono text-[9px] font-semibold text-[#7c3aed] mt-0.5">
                    {co.order.obdNumber}
                  </div>
                </div>
                <div className="px-2.5 py-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-[#27500a] bg-[#eaf3de] border border-[#97c459] px-1.5 py-px rounded-[5px]">
                    ✓ Tinting Done
                  </span>
                  <span className="font-mono text-[11px] font-semibold text-[#16a34a] bg-[#f0fdf4] border border-[#bbf7d0] px-2 py-px rounded-[6px]">
                    {doneTime}
                  </span>
                </div>
              </div>
            );
          })}

          {completedSplits.map(sp => {
            const customerName = sp.order.customer?.customerName ?? sp.order.shipToCustomerName ?? "—";
            const doneTime = sp.completedAt
              ? new Date(sp.completedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
              : "—";
            return (
              <div key={`sheet-cs-${sp.id}`} className="border border-[#e2e5f1] rounded-xl overflow-hidden mb-1.5 opacity-65">
                <div className="px-2.5 py-2 bg-[#f0fdf4] border-b border-[#bbf7d0]">
                  <div className="text-[12px] font-bold text-gray-900">{customerName}</div>
                  <div className="font-mono text-[9px] font-semibold text-[#7c3aed] mt-0.5">
                    {sp.order.obdNumber}{sp.splitNumber != null ? ` · Split #${sp.splitNumber}` : ""}
                  </div>
                </div>
                <div className="px-2.5 py-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-[#27500a] bg-[#eaf3de] border border-[#97c459] px-1.5 py-px rounded-[5px]">
                    ✓ Tinting Done
                  </span>
                  <span className="font-mono text-[11px] font-semibold text-[#16a34a] bg-[#f0fdf4] border border-[#bbf7d0] px-2 py-px rounded-[6px]">
                    {doneTime}
                  </span>
                </div>
              </div>
            );
          })}

        </div>
      </div>

    </div>

      {/* Conflict Dialog */}
      <Dialog open={!!conflictDialog} onOpenChange={(open: boolean) => { if (!open) setConflictDialog(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Shade already exists</DialogTitle>
            <DialogDescription>
              A shade named &quot;{conflictDialog?.shadeName}&quot; already exists for this customer with this SKU and pack size. Overwrite it?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflictDialog(null)}>Cancel</Button>
            <Button onClick={handleConflictOverwrite} disabled={tiActionLoading}>
              {tiActionLoading && <Loader2 className={cn("animate-spin mr-1")} size={13} />}
              Overwrite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
