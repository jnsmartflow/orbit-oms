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
      setAssignedOrders(data.assignedOrders);
      setAssignedSplits(data.assignedSplits);
      setHasActiveJob(data.hasActiveJob);
      setCompletedOrders(data.completedOrders ?? []);
      setCompletedSplits(data.completedSplits ?? []);

      const allJobs = [
        ...data.assignedSplits
          .filter(s => ["tint_assigned", "tinting_in_progress"].includes(s.status))
          .map(s => ({ id: s.id, type: "split" as const, seq: s.operatorSequence, status: s.status })),
        ...data.assignedOrders
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
      <header style={{
        background: "#fff", borderBottom: "1px solid #e2e5f1",
        height: 52, display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: "0 16px",
        flexShrink: 0, gap: 10,
      }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: "#111827" }}>
          My Tint Jobs
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Layout toggle */}
          <div style={{
            display: "flex", alignItems: "center",
            background: "#f7f8fc", border: "1px solid #e2e5f1",
            borderRadius: 8, overflow: "hidden",
          }}>
            {/* Split view button */}
            <button
              type="button"
              onClick={() => setFocusMode(false)}
              title="Split view"
              style={{
                width: 32, height: 30, border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: !focusMode ? "#e8eaf6" : "transparent",
                color: !focusMode ? "#1a237e" : "#9ca3af",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="8" height="18" rx="1"/>
                <rect x="13" y="3" width="8" height="18" rx="1"/>
              </svg>
            </button>
            <div style={{ width: 1, height: 18, background: "#e2e5f1" }} />
            {/* Focus view button */}
            <button
              type="button"
              onClick={() => setFocusMode(true)}
              title="Focus view"
              style={{
                width: 32, height: 30, border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: focusMode ? "#e8eaf6" : "transparent",
                color: focusMode ? "#1a237e" : "#9ca3af",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="1"/>
              </svg>
            </button>
          </div>
          {/* Clock */}
          <div style={{
            fontFamily: "monospace", fontSize: 12, fontWeight: 600,
            color: "#9ca3af", background: "#f7f8fc",
            border: "1px solid #e2e5f1", padding: "4px 10px", borderRadius: 8,
          }}>
            {clock || "--:--:--"}
          </div>
        </div>
      </header>

      {/* ── STAT BAR ── */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #e2e5f1",
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
        flexShrink: 0,
      }}>
        {[
          { label: "Pending",         value: pendingCount,    color: "#d97706", iconBg: "#fffbeb",
            icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:14,height:14}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
          { label: "In Progress",     value: inProgressCount, color: "#2563eb", iconBg: "#eff6ff",
            icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:14,height:14}}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> },
          { label: "Completed Today", value: completedCount,  color: "#16a34a", iconBg: "#f0fdf4",
            icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:14,height:14}}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
          { label: "Volume Done",
            value: volumeDone >= 1000 ? `${(volumeDone / 1000).toFixed(1)}k L` : `${volumeDone} L`,
            color: "#4f46e5", iconBg: "#eef2ff",
            icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:14,height:14}}><path d="M3 3h18v4H3z"/><path d="M3 10h12v4H3z"/><path d="M3 17h8v4H3z"/></svg> },
        ].map((cell) => (
          <div key={cell.label} style={{
            padding: "9px 16px", borderRight: "1px solid #e2e5f1",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: "50%",
              background: cell.iconBg, color: cell.color,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              {cell.icon}
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: cell.color, lineHeight: 1 }}>
                {cell.value}
              </div>
              <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: ".4px", color: "#9ca3af", marginTop: 1 }}>
                {cell.label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── MAIN (placeholder — filled in next steps) ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{
          width: focusMode ? 0 : "35%",
          minWidth: focusMode ? 0 : undefined,
          display: focusMode ? "none" : "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "#fff",
          borderRight: "1px solid #e2e5f1",
          flexShrink: 0,
        }}>
          <div style={{ flex: 1, overflowY: "auto" }}>

            {/* Queue section */}
            <div style={{ padding: "12px 14px 6px" }}>

              {/* Section header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".6px", color: "#9ca3af" }}>
                  Queue
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, background: "#f7f8fc", border: "1px solid #e2e5f1", color: "#6b7280", padding: "1px 7px", borderRadius: 999 }}>
                  {jobs.length}
                </span>
              </div>

              {/* Remaining volume hint */}
              <div style={{ background: "#f7f8fc", border: "1px solid #e2e5f1", borderRadius: 8, padding: "7px 11px", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: "#6b7280" }}>Remaining volume today</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: "#111827" }}>
                  {remainingVolume > 0 ? `${remainingVolume} L` : "— L"}
                </span>
              </div>

              {/* Queue cards */}
              {jobs.length === 0 && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 16px", textAlign: "center" }}>
                  <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#f7f8fc", border: "1px solid #e2e5f1", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "#6b7280" }}>Queue is clear!</p>
                  <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>All jobs done for today.</p>
                </div>
              )}

              {jobs.map((job, idx) => {
                const isActive   = job.status === "tinting_in_progress";
                const hasActive  = jobs.some(j => j.status === "tinting_in_progress");
                const isNext     = !isActive && !hasActive && idx === 0;
                const isQueued   = !isActive && !isNext;
                const isSelected = job.id === selectedJobId && job.type === selectedJobType;

                const hdrBg = isActive ? "#eff6ff"
                  : isNext   ? "#e8eaf6"
                  : "#f7f8fc";
                const hdrBorder = isActive ? "#bfdbfe"
                  : isNext       ? "#c5cae9"
                  : "#e2e5f1";

                const seqLabel = isActive ? "Active"
                  : isNext      ? "Next up"
                  : `#${idx + 1}`;
                const seqStyle: React.CSSProperties = isActive
                  ? { background: "#dbeafe", color: "#1e40af" }
                  : isNext
                  ? { background: "#1a237e", color: "#fff" }
                  : { background: "#f7f8fc", border: "1px solid #e2e5f1", color: "#9ca3af" };

                return (
                  <div
                    key={`${job.type}-${job.id}`}
                    onClick={() => { setSelectedJobId(job.id); setSelectedJobType(job.type); }}
                    style={{
                      border: `1px solid ${isSelected ? "#1a237e" : isActive ? "#bfdbfe" : isNext ? "#c5cae9" : "#e2e5f1"}`,
                      borderRadius: 12, overflow: "hidden", marginBottom: 8,
                      cursor: "pointer", opacity: isQueued ? 0.55 : 1,
                      outline: isSelected ? "2px solid #1a237e" : "none",
                      outlineOffset: 1,
                      transition: "opacity .15s, border-color .12s",
                    }}
                  >
                    {/* Card header */}
                    <div style={{ padding: "8px 11px 7px", borderBottom: `1px solid ${hdrBorder}`, background: hdrBg, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {job.customerName}
                        </div>
                        <div style={{ fontFamily: "monospace", fontSize: 9, fontWeight: 600, color: "#7c3aed", marginTop: 2 }}>
                          {job.obdNumber}{job.splitNumber != null ? ` · Split #${job.splitNumber}` : ""}
                        </div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 99, whiteSpace: "nowrap", flexShrink: 0, ...seqStyle }}>
                        {seqLabel}
                      </span>
                    </div>

                    {/* Card body */}
                    <div style={{ padding: "7px 11px 9px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <div>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: "#111827" }}>
                          {job.totalVolume != null ? `${job.totalVolume} L` : "—"}{job.articleTag ? ` · ${job.articleTag}` : ""}
                        </div>
                        <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 1 }}>
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
                          <span style={{ fontSize: 9.5, fontWeight: 700, padding: "3px 7px", borderRadius: 5, background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#16a34a", display: "flex", alignItems: "center", gap: 3, whiteSpace: "nowrap", flexShrink: 0 }}>
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                            TI {covered}/{total}
                          </span>
                        ) : (
                          <span style={{ fontSize: 9.5, fontWeight: 700, padding: "3px 7px", borderRadius: 5, background: "#fef2f2", border: "1px solid #fca5a5", color: "#dc2626", whiteSpace: "nowrap", flexShrink: 0 }}>
                            TI {covered}/{total}
                          </span>
                        );
                      })()}
                    </div>

                    {/* Fill TI nudge — Next Up card only, TI not done */}
                    {isNext && !job.tiSubmitted && (
                      <div style={{ margin: "0 10px 9px", padding: "7px 10px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 7, fontSize: 11, fontWeight: 600, color: "#92400e", display: "flex", alignItems: "center", gap: 6 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                        </svg>
                        Fill TI now while you&apos;re free
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedJobId(job.id); setSelectedJobType(job.type); }}
                          style={{ marginLeft: "auto", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 5, padding: "3px 9px", fontSize: 10.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
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
            <div style={{ height: 1, background: "#e2e5f1", margin: "4px 14px 12px" }} />

            {/* Completed Today section */}
            <div style={{ padding: "0 14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".6px", color: "#9ca3af" }}>
                  Completed Today
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, background: "#f7f8fc", border: "1px solid #e2e5f1", color: "#6b7280", padding: "1px 7px", borderRadius: 999 }}>
                  {completedCount}
                </span>
              </div>

              {completedOrders.length === 0 && completedSplits.length === 0 && (
                <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", padding: "12px 0" }}>
                  No completed jobs yet today.
                </p>
              )}

              {completedOrders.map(co => {
                const customerName = co.order.customer?.customerName ?? co.order.shipToCustomerName ?? "—";
                const doneTime = co.completedAt
                  ? new Date(co.completedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
                  : "—";
                return (
                  <div key={`co-${co.id}`} style={{ border: "1px solid #e2e5f1", borderRadius: 12, overflow: "hidden", marginBottom: 7, opacity: 0.65 }}>
                    <div style={{ padding: "8px 11px", background: "#f0fdf4", borderBottom: "1px solid #bbf7d0" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{customerName}</div>
                      <div style={{ fontFamily: "monospace", fontSize: 9, fontWeight: 600, color: "#7c3aed", marginTop: 2 }}>
                        {co.order.obdNumber}
                      </div>
                    </div>
                    <div style={{ padding: "7px 11px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#27500a", background: "#eaf3de", border: "1px solid #97c459", padding: "2px 7px", borderRadius: 5 }}>
                        ✓ Tinting Done
                      </span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, color: "#16a34a", background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "2px 8px", borderRadius: 6 }}>
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
                  <div key={`cs-${sp.id}`} style={{ border: "1px solid #e2e5f1", borderRadius: 12, overflow: "hidden", marginBottom: 7, opacity: 0.65 }}>
                    <div style={{ padding: "8px 11px", background: "#f0fdf4", borderBottom: "1px solid #bbf7d0" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{customerName}</div>
                      <div style={{ fontFamily: "monospace", fontSize: 9, fontWeight: 600, color: "#7c3aed", marginTop: 2 }}>
                        {sp.order.obdNumber}{sp.splitNumber != null ? ` · Split #${sp.splitNumber}` : ""}
                      </div>
                    </div>
                    <div style={{ padding: "7px 11px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#27500a", background: "#eaf3de", border: "1px solid #97c459", padding: "2px 7px", borderRadius: 5 }}>
                        ✓ Tinting Done
                      </span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, color: "#16a34a", background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "2px 8px", borderRadius: 6 }}>
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
          background: "#f0f2f8",
        }}>

          {/* Update toast */}
          {tiUpdateToast && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "#f0fdf4", borderBottom: "1px solid #bbf7d0", flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "#15803d" }}>TI entry updated</span>
            </div>
          )}

          {/* Success toast */}
          {tiSuccessToast && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "#f0fdf4", borderBottom: "1px solid #bbf7d0", flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "#15803d" }}>TI entries saved</span>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "#fef2f2", borderBottom: "1px solid #fca5a5" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: "#b91c1c", flex: 1 }}>{error}</span>
              <button type="button" onClick={() => setError(null)} style={{ fontSize: 12, color: "#dc2626", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                Dismiss
              </button>
            </div>
          )}

          {/* No job selected */}
          {!selectedJob && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center", padding: 40 }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#fff", border: "1px solid #e2e5f1", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>
                </svg>
              </div>
              <p style={{ fontSize: 14, fontWeight: 700, color: "#6b7280" }}>No job selected</p>
              <p style={{ fontSize: 12, color: "#9ca3af" }}>Tap a job in the queue to view details</p>
            </div>
          )}

          {/* Job detail */}
          {selectedJob && (
            <>
              {/* Job identity topbar */}
              <div style={{
                background: "#fff", borderBottom: "1px solid #e2e5f1",
                padding: "11px 16px", flexShrink: 0,
                display: "flex", alignItems: "flex-start",
                justifyContent: "space-between", gap: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#111827", lineHeight: 1.2, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {selectedJob.customerName}
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: 10.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                    <span style={{ color: "#7c3aed" }}>{selectedJob.obdNumber}</span>
                    <span style={{ color: "#9ca3af" }}>
                      {selectedJob.splitNumber != null ? `· Split #${selectedJob.splitNumber}` : ""}
                      {selectedJob.dispatchSlot ? ` · ${selectedJob.dispatchSlot}` : ""}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                  {/* Status badge */}
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                    border: "1px solid transparent",
                    ...(selectedJob.status === "tinting_in_progress"
                      ? { background: "#eff6ff", borderColor: "#bfdbfe", color: "#1d4ed8" }
                      : { background: "#fffbeb", borderColor: "#fde68a", color: "#92400e" }),
                  }}>
                    {selectedJob.status === "tinting_in_progress" ? "In Progress" : "Assigned"}
                  </span>
                  {/* Elapsed timer — only when in progress */}
                  {selectedJob.status === "tinting_in_progress" && (
                    <div style={{
                      fontFamily: "monospace", fontSize: 11, fontWeight: 600,
                      background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8",
                      padding: "3px 9px", borderRadius: 6,
                      display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
                    }}>
                      <div style={{
                        width: 6, height: 6, borderRadius: "50%", background: "#2563eb", flexShrink: 0,
                        animation: "pulse 1.4s ease-in-out infinite",
                      }} />
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
              <div style={{ flex: 1, overflowY: "auto" }}>

                {/* Meta strip */}
                <div style={{
                  background: "#fff", borderBottom: "1px solid #e2e5f1",
                  display: "grid", gridTemplateColumns: "repeat(4,1fr)", flexShrink: 0,
                }}>
                  {[
                    { label: "Articles", value: selectedJob.articleTag ?? "—" },
                    { label: "Volume",   value: selectedJob.totalVolume != null ? `${selectedJob.totalVolume} L` : "—" },
                    { label: "Slot",     value: selectedJob.dispatchSlot ?? "—" },
                    { label: "Sales Officer", value: "—" },
                  ].map(cell => (
                    <div key={cell.label} style={{ padding: "9px 14px", borderRight: "1px solid #e2e5f1" }}>
                      <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "#9ca3af", marginBottom: 2 }}>
                        {cell.label}
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#111827" }}>{cell.value}</div>
                    </div>
                  ))}
                </div>

                {/* SKU Lines */}
                <div style={{ padding: "14px 16px" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".6px", color: "#9ca3af", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                    SKU Lines
                    <div style={{ flex: 1, height: 1, background: "#e2e5f1" }} />
                  </div>

                  {selectedJob.lineItems.length === 0 ? (
                    <p style={{ fontSize: 12, color: "#9ca3af" }}>No SKU lines found.</p>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", border: "1px solid #e2e5f1", borderRadius: 12, overflow: "hidden" }}>
                      <thead>
                        <tr>
                          {["Code", "Description", "Qty", "Volume"].map((h, i) => (
                            <th key={h} style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "#9ca3af", padding: "8px 12px", textAlign: i >= 2 ? "right" : "left", background: "#f7f8fc", borderBottom: "1px solid #e2e5f1" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedJob.lineItems.map((item, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #e2e5f1" }}>
                            <td style={{ padding: "9px 12px", fontFamily: "monospace", color: "#7c3aed", fontSize: 10.5, fontWeight: 600 }}>
                              {item.rawLineItem.skuCodeRaw}
                            </td>
                            <td style={{ padding: "9px 12px", fontSize: 12, fontWeight: 600, color: "#111827" }}>
                              {item.rawLineItem.skuDescriptionRaw ?? "—"}
                              {item.rawLineItem.isTinting && (
                                <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", background: "#ede9fe", border: "1px solid #c4b5fd", color: "#5b21b6", padding: "1px 5px", borderRadius: 4, marginLeft: 4 }}>
                                  TINT
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "9px 12px", fontSize: 12, fontWeight: 600, color: "#111827", textAlign: "right" }}>
                              {item.rawLineItem.unitQty}
                            </td>
                            <td style={{ padding: "9px 12px", fontSize: 12, fontWeight: 600, color: "#6b7280", textAlign: "right" }}>
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
                  <div ref={coverageStripRef} style={{ padding: "0 16px 8px" }}>
                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".6px", color: "#9ca3af", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                      TI Coverage
                      <div style={{ flex: 1, height: 1, background: "#e2e5f1" }} />
                      {tiEntriesLoading && <span style={{ fontSize: 9, fontWeight: 600, color: "#9ca3af" }}>loading…</span>}
                    </div>
                    <div style={{ background: "#f7f8fc", border: "1px solid #e2e5f1", borderRadius: 10, overflow: "hidden" }}>
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
                            style={{
                              display: "flex", alignItems: done ? "flex-start" : "center", gap: 8,
                              padding: "8px 12px",
                              borderBottom: i < tintingLines.length - 1 ? "1px solid #e2e5f1" : undefined,
                              cursor: "pointer",
                              background: done ? "#f0fdf4" : "#fffbeb",
                            }}
                          >
                            <span style={{ fontSize: 14, flexShrink: 0, marginTop: done ? 1 : 0 }}>{done ? "✅" : "⏳"}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div>
                                <span style={{ fontSize: 11.5, fontWeight: 700, color: "#111827", fontFamily: "monospace" }}>{line.skuCodeRaw}</span>
                                {line.skuDescriptionRaw && <span style={{ fontSize: 11, color: "#6b7280" }}> · {line.skuDescriptionRaw}</span>}
                                <span style={{ fontSize: 10.5, color: "#9ca3af" }}> · {line.unitQty} qty · {PACK_CODES.find(p => p.value === line.packCode)?.label ?? line.packCode}</span>
                              </div>
                              {tiEntry && shadeStr && (
                                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
                                  <span style={{
                                    fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, flexShrink: 0,
                                    background: tiEntry.table === "TINTER" ? "#e0e7ff" : "#fef9c3",
                                    color:      tiEntry.table === "TINTER" ? "#3730a3" : "#713f12",
                                    border:     `1px solid ${tiEntry.table === "TINTER" ? "#a5b4fc" : "#fde047"}`,
                                  }}>
                                    {tiEntry.table === "TINTER" ? "Tinter" : "Acotone"}
                                  </span>
                                  <span style={{ fontSize: 10.5, color: "#6b7280", fontFamily: "monospace" }}>{shadeStr}</span>
                                </div>
                              )}
                            </div>
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5, flexShrink: 0,
                              marginTop: done ? 1 : 0,
                              ...(done
                                ? { background: "#dcfce7", border: "1px solid #86efac", color: "#15803d" }
                                : { background: "#fef9c3", border: "1px solid #fde047", color: "#854d0e" }),
                            }}>
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
                        <p style={{ fontSize: 11, fontWeight: 600, marginTop: 6, color: allDone ? "#15803d" : "#92400e" }}>
                          {covered} of {total} lines covered
                        </p>
                      );
                    })()}
                  </div>
                )}

                {/* TI Form */}
                <div id="ti-form-section" style={{ padding: "0 16px 8px" }}>

                  {/* Section title */}
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".6px", color: "#9ca3af", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                    Tinter Issue Form
                    <div style={{ flex: 1, height: 1, background: "#e2e5f1" }} />
                  </div>

                  {/* No tinting lines */}
                  {tintingLines.length === 0 && (
                    <div style={{ background: "#fff", border: "1px solid #e2e5f1", borderRadius: 12, padding: "16px", textAlign: "center" }}>
                      <p style={{ fontSize: 12, color: "#9ca3af" }}>No tinting lines in this job — start directly.</p>
                    </div>
                  )}

                  {/* Single-form */}
                  {tintingLines.length > 0 && (
                    <div style={{ background: "#fff", border: "1px solid #e2e5f1", borderRadius: 12, overflow: "hidden" }}>

                      {/* Tinter type selector */}
                      <div style={{ padding: "10px 14px", borderBottom: "1px solid #f0f2f8", display: "flex", gap: 6 }}>
                        {(["TINTER", "ACOTONE"] as const).map(t => (
                          <button key={t} type="button"
                            onClick={() => handleTinterTypeChange(t)}
                            style={{ padding: "5px 16px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1px solid",
                              background: tinterType === t ? "#1a237e" : "#fff",
                              color: tinterType === t ? "#fff" : "#6b7280",
                              borderColor: tinterType === t ? "#1a237e" : "#d1d5db" }}>
                            {t === "TINTER" ? "Tinter" : "Acotone"}
                          </button>
                        ))}
                      </div>

                      {/* All saved shades combobox (shared, shown once above entries) */}
                      <div style={{ padding: "10px 14px", borderBottom: "1px solid #f0f2f8" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
                          <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "#9ca3af" }}>All Saved Shades</span>
                          <span style={{ fontSize: 9.5, color: "#d1d5db" }}>(optional — applies to focused entry)</span>
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
                                    style={{ padding: "7px 12px", cursor: "pointer", fontSize: 12, fontWeight: 500, color: "#111827", borderTop: "1px solid #f3f4f6" }}>
                                    <span style={{ fontWeight: 600 }}>{shade.shadeName}</span>
                                    <span style={{ color: "#9ca3af", fontSize: 11 }}> · {PACK_CODES.find(p => p.value === shade.packCode)?.label ?? shade.packCode ?? "—"}</span>
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
                          <div key={entry.id} style={{ borderBottom: "1px solid #e2e5f1" }}>
                            {/* Entry header */}
                            <div style={{ padding: "8px 14px", background: "#f7f8fc", borderBottom: "1px solid #f0f2f8", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: "#9ca3af" }}>Entry {idx + 1}</span>
                                {idx === 0 && editingEntryId && (
                                  <>
                                    <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "#e0e7ff", border: "1px solid #a5b4fc", color: "#3730a3" }}>
                                      Editing existing entry
                                    </span>
                                    <button type="button"
                                      onClick={() => { setEditingEntryId(null); setTiEntries(prev => [defaultTIFormEntry(), ...prev.slice(1)]); }}
                                      style={{ fontSize: 10.5, fontWeight: 600, color: "#6b7280", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                                      Cancel edit
                                    </button>
                                  </>
                                )}
                              </div>
                              {tiEntries.length > 1 && (
                                <button type="button"
                                  onClick={() => setTiEntries(prev => prev.filter(e => e.id !== entry.id))}
                                  style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid #fca5a5", background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#dc2626" }}>
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                              )}
                            </div>

                            <div style={{ padding: "12px 14px" }}>
                              {/* 1. Base SKU Dropdown */}
                              <div style={{ marginBottom: 10 }}>
                                <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "#9ca3af", display: "block", marginBottom: 4 }}>Base SKU</span>
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
                                <div style={{ marginBottom: 10, padding: "8px 10px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8 }}>
                                  <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "#92400e", marginBottom: 5, display: "flex", alignItems: "center", gap: 5 }}>
                                    Suggestions
                                    {entry.suggestionsLoading && <span style={{ fontSize: 9, fontWeight: 500, color: "#d97706" }}>loading…</span>}
                                  </div>
                                  {visibleSugs.map(sug => (
                                    <div key={sug.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#111827" }}>🎨 {sug.shadeName}</span>
                                        <span style={{ fontSize: 10.5, color: "#6b7280", marginLeft: 4 }}>· {PACK_CODES.find(p => p.value === sug.packCode)?.label ?? sug.packCode ?? "—"}</span>
                                        <div style={{ fontSize: 9.5, color: "#9ca3af" }}>
                                          {sug.lastUsedAt ? `Last used: ${new Date(sug.lastUsedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}` : "First time"}
                                        </div>
                                      </div>
                                      <button type="button"
                                        onClick={() => applyShadeToEntry(entry.id, sug)}
                                        style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 5, background: "#f59e0b", color: "#fff", border: "none", cursor: "pointer", flexShrink: 0 }}>
                                        Use this
                                      </button>
                                    </div>
                                  ))}
                                  {entry.suggestions.length > 3 && (
                                    <button type="button"
                                      onClick={() => setTiEntries(prev => prev.map(e => e.id === entry.id ? { ...e, suggestionsExpanded: !e.suggestionsExpanded } : e))}
                                      style={{ fontSize: 10.5, fontWeight: 600, color: "#92400e", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                                      {entry.suggestionsExpanded ? "Show less" : `+${entry.suggestions.length - 3} more`}
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* 4+5. Tin Qty + Pack Size display */}
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 8, marginBottom: 12 }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                  <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "#9ca3af" }}>Tin Qty</span>
                                  <input type="number" min={0} step={0.1} placeholder="0" value={entry.tinQty || ""}
                                    onChange={e => setTiEntries(prev => prev.map(en => en.id === entry.id ? { ...en, tinQty: Number(e.target.value) } : en))}
                                    style={{ height: 34, background: flash ? "#fffbeb" : "#f7f8fc", border: `1px solid ${flash ? "#fcd34d" : "#e2e5f1"}`, borderRadius: 8, padding: "0 10px", fontSize: 12, fontWeight: 500, color: "#111827", outline: "none", transition: "background .3s,border-color .3s" }} />
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                  <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "#9ca3af" }}>Pack Size</span>
                                  <div style={{ height: 34, background: "#f0f2f8", border: "1px solid #e2e5f1", borderRadius: 8, padding: "0 10px", fontSize: 12, fontWeight: 600, color: entry.packCode ? "#111827" : "#9ca3af", display: "flex", alignItems: "center" }}>
                                    {entry.packCode ? (PACK_CODES.find(p => p.value === entry.packCode)?.label ?? entry.packCode) : "—"}
                                  </div>
                                </div>
                              </div>

                              {/* Selected shade indicator */}
                              {entry.selectedShadeName !== null && (
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                                  <span style={{
                                    display: "inline-flex", alignItems: "center", gap: 5,
                                    background: "#e8eaf6", border: "1px solid #1a237e", borderRadius: 999,
                                    padding: "3px 10px", fontSize: 11, color: "#1a237e", fontWeight: 600,
                                  }}>
                                    <Palette size={11} />
                                    {entry.selectedShadeName}
                                  </span>
                                  <button type="button"
                                    onClick={() => setTiEntries(prev => prev.map(en => en.id === entry.id ? {
                                      ...en,
                                      selectedShadeName: null, selectedShadeId: null,
                                      shadeValues: {}, showAllColumns: true,
                                    } : en))}
                                    style={{ fontSize: 10.5, fontWeight: 700, color: "#dc2626", background: "none", border: "none", cursor: "pointer", padding: "0 2px" }}>
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
                                    <div style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: "#9ca3af", marginBottom: 7 }}>Shade Quantities</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5, marginBottom: 5 }}>
                                      {displayCols.slice(0, 7).map(shade => (
                                        <div key={shade.code} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                                          <div style={{ fontSize: 9, fontWeight: 800, padding: "3px 0", borderRadius: 5, width: "100%", textAlign: "center", background: shade.bg, border: `1.5px solid ${shade.border}`, color: shade.text }}>{shade.code}</div>
                                          <input type="number" min={0} step={0.01} placeholder="—"
                                            value={entry.shadeValues[shade.code] || ""}
                                            onChange={e => setTiEntries(prev => prev.map(en => en.id === entry.id ? { ...en, shadeValues: { ...en.shadeValues, [shade.code]: Number(e.target.value) } } : en))}
                                            style={{ width: "100%", padding: "5px 2px", borderRadius: 5, fontSize: 11, fontWeight: 700, textAlign: "center", background: flash ? "#fffbeb" : shade.bg, border: `1.5px solid ${flash ? "#fcd34d" : shade.border}`, color: shade.text, outline: "none", fontFamily: "monospace", transition: "background .3s,border-color .3s" }} />
                                        </div>
                                      ))}
                                    </div>
                                    {displayCols.length > 7 && (
                                      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5, marginBottom: 5 }}>
                                        {displayCols.slice(7).map(shade => (
                                          <div key={shade.code} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
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
                                        style={{ fontSize: 10.5, fontWeight: 600, color: "#1a237e", background: "none", border: "none", cursor: "pointer", padding: "3px 0 8px", display: "block" }}>
                                        {!entry.showAllColumns
                                          ? `+ Show all columns (${hiddenCount} hidden)`
                                          : `− Show active columns only`}
                                      </button>
                                    )}
                                    {!showToggle && <div style={{ marginBottom: 10 }} />}
                                  </>
                                );
                              })()}

                              {/* 7. Save as Shade Toggle — only when SKU selected */}
                              {entry.skuCodeRaw && (
                                <div style={{ borderTop: "1px solid #f0f2f8", paddingTop: 10 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <Switch
                                      checked={entry.saveAsShade}
                                      onCheckedChange={(v: boolean) => setTiEntries(prev => prev.map(en => en.id === entry.id ? { ...en, saveAsShade: v, shadeNameError: "" } : en))}
                                      className="data-[checked]:bg-[#1a237e] data-[unchecked]:bg-[#d1d5db]"
                                    />
                                    <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Save as shade formula</span>
                                  </div>
                                  <div style={{ overflow: "hidden", maxHeight: entry.saveAsShade ? "80px" : "0px", transition: "max-height 200ms ease", marginTop: entry.saveAsShade ? 8 : 0 }}>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                      <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "#9ca3af" }}>
                                        Shade name <span style={{ color: "#ef4444" }}>*</span>
                                      </span>
                                      <input type="text" placeholder="e.g. Ivory White"
                                        value={entry.shadeName}
                                        onChange={e => setTiEntries(prev => prev.map(en => en.id === entry.id ? { ...en, shadeName: e.target.value, shadeNameError: "" } : en))}
                                        style={{ height: 34, background: "#f7f8fc", border: `1px solid ${entry.shadeNameError ? "#ef4444" : "#e2e5f1"}`, borderRadius: 8, padding: "0 10px", fontSize: 12, fontWeight: 500, color: "#111827", outline: "none" }} />
                                      {entry.shadeNameError && <span style={{ fontSize: 10.5, color: "#ef4444" }}>{entry.shadeNameError}</span>}
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
                        style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: "#1a237e", cursor: "pointer", background: "#e8eaf6" }}>
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
              <div style={{
                background: "#fff",
                borderTop: "1px solid #e2e5f1",
                padding: "11px 16px",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}>
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
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                        {/* TI incomplete warning */}
                        {tiIncompleteWarning && tiIncompleteWarning.length > 0 && (
                          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 12px" }}>
                            <p style={{ fontSize: 12, fontWeight: 700, color: "#92400e", margin: "0 0 5px 0" }}>
                              Some tinting lines are missing TI entries:
                            </p>
                            <ul style={{ fontSize: 11.5, color: "#b45309", margin: "0 0 6px 14px", padding: 0 }}>
                              {tiIncompleteWarning.map(line => (
                                <li key={line.rawLineItemId}>
                                  {line.skuCodeRaw}{line.skuDescriptionRaw ? ` · ${line.skuDescriptionRaw}` : ""}
                                </li>
                              ))}
                            </ul>
                            <p style={{ fontSize: 11, color: "#92400e", margin: 0 }}>
                              Please fill TI entries for these lines before marking Done.
                            </p>
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => editingEntryId ? handleUpdateEntry(selectedJob) : handleSubmitTIAndStart(selectedJob)}
                            disabled={anyLoading}
                            style={{ flex: 1, background: "#1a237e", color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontSize: 13, fontWeight: 700, cursor: anyLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: anyLoading ? 0.6 : 1 }}
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
                            style={{ flex: 1, background: "#16a34a", color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontSize: 13, fontWeight: 700, cursor: anyLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: anyLoading ? 0.6 : 1 }}
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
                          style={{ flex: 1, background: "#1a237e", color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontSize: 13, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: isLoading ? 0.6 : 1 }}
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
                        style={{ flex: 1, background: "#1a237e", color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontSize: 13, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: isLoading ? 0.6 : 1 }}
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
                      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: "#9ca3af" }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                        Another job is in progress — TI submitted ✓
                      </div>
                    );
                  }

                  // Case 4 — TI submitted, no active job → Start Job (or Update TI Entry if in edit mode)
                  return (
                    <div style={{ flex: 1, display: "flex", gap: 8 }}>
                      {editingEntryId && (
                        <button
                          type="button"
                          onClick={() => handleUpdateEntry(selectedJob)}
                          disabled={isLoading}
                          style={{ flex: 1, background: "#1a237e", color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontSize: 13, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: isLoading ? 0.6 : 1 }}
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
                        style={{ flex: 1, background: "#1a237e", color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontSize: 13, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: isLoading ? 0.6 : 1 }}
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
          style={{
            position: "fixed", bottom: 80, left: 16, zIndex: 60,
            width: 48, height: 48, borderRadius: "50%",
            background: "#1a237e", color: "#fff", border: "none",
            cursor: "pointer", boxShadow: "0 4px 16px rgba(26,35,126,.35)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
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
            <span style={{
              position: "absolute", top: -2, right: -2,
              width: 18, height: 18, borderRadius: "50%",
              background: "#ef4444", fontSize: 9.5, fontWeight: 800,
              color: "#fff", display: "flex", alignItems: "center",
              justifyContent: "center", border: "2px solid #fff",
            }}>
              {jobs.length}
            </span>
          )}
        </button>
      )}

      {/* Queue sheet overlay */}
      {queueSheetOpen && (
        <div
          onClick={() => setQueueSheetOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 70,
            background: "rgba(0,0,0,.4)",
          }}
        />
      )}

      {/* Queue sheet */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 71,
        background: "#fff", borderRadius: "18px 18px 0 0",
        maxHeight: "72vh", display: "flex", flexDirection: "column",
        boxShadow: "0 -8px 32px rgba(0,0,0,.12)",
        transform: queueSheetOpen ? "translateY(0)" : "translateY(100%)",
        transition: "transform .26s cubic-bezier(.32,.72,0,1)",
        pointerEvents: queueSheetOpen ? "all" : "none",
      }}>
        {/* Handle */}
        <div style={{ width: 36, height: 4, background: "#e2e5f1", borderRadius: 2, margin: "10px auto 0", flexShrink: 0 }} />

        {/* Sheet header */}
        <div style={{ padding: "12px 16px 10px", borderBottom: "1px solid #e2e5f1", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>Queue &amp; Completed</span>
          <button
            type="button"
            onClick={() => setQueueSheetOpen(false)}
            style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid #e2e5f1", background: "#f7f8fc", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#6b7280" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Sheet body */}
        <div style={{ overflowY: "auto", padding: "12px 16px 24px" }}>

          {/* Queue label */}
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".6px", color: "#9ca3af", marginBottom: 10 }}>
            Queue
          </div>

          {/* Queue cards */}
          {jobs.map((job, idx) => {
            const isActive   = job.status === "tinting_in_progress";
            const hasActive  = jobs.some(j => j.status === "tinting_in_progress");
            const isNext     = !isActive && !hasActive && idx === 0;
            const isSelected = job.id === selectedJobId && job.type === selectedJobType;
            const hdrBg      = isActive ? "#eff6ff" : isNext ? "#e8eaf6" : "#f7f8fc";
            const hdrBorder  = isActive ? "#bfdbfe" : isNext ? "#c5cae9" : "#e2e5f1";
            const seqLabel   = isActive ? "Active" : isNext ? "Next up" : `#${idx + 1}`;
            const seqStyle: React.CSSProperties = isActive
              ? { background: "#dbeafe", color: "#1e40af" }
              : isNext
              ? { background: "#1a237e", color: "#fff" }
              : { background: "#f7f8fc", border: "1px solid #e2e5f1", color: "#9ca3af" };

            return (
              <div
                key={`sheet-${job.type}-${job.id}`}
                onClick={() => { setSelectedJobId(job.id); setSelectedJobType(job.type); setQueueSheetOpen(false); }}
                style={{
                  border: `1px solid ${isSelected ? "#1a237e" : isActive ? "#bfdbfe" : isNext ? "#c5cae9" : "#e2e5f1"}`,
                  borderRadius: 12, overflow: "hidden", marginBottom: 8,
                  cursor: "pointer", opacity: (!isActive && !isNext) ? 0.55 : 1,
                  outline: isSelected ? "2px solid #1a237e" : "none",
                  outlineOffset: 1,
                }}
              >
                <div style={{ padding: "8px 11px 7px", borderBottom: `1px solid ${hdrBorder}`, background: hdrBg, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {job.customerName}
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 9, fontWeight: 600, color: "#7c3aed", marginTop: 2 }}>
                      {job.obdNumber}{job.splitNumber != null ? ` · Split #${job.splitNumber}` : ""}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 99, whiteSpace: "nowrap", flexShrink: 0, ...seqStyle }}>
                    {seqLabel}
                  </span>
                </div>
                <div style={{ padding: "7px 11px 9px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: "#111827" }}>
                      {job.totalVolume != null ? `${job.totalVolume} L` : "—"}{job.articleTag ? ` · ${job.articleTag}` : ""}
                    </div>
                    <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 1 }}>{job.dispatchSlot ?? "—"}</div>
                  </div>
                  {job.tiSubmitted
                    ? <span style={{ fontSize: 9.5, fontWeight: 700, padding: "3px 7px", borderRadius: 5, background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#16a34a", whiteSpace: "nowrap", flexShrink: 0 }}>✓ TI Done</span>
                    : <span style={{ fontSize: 9.5, fontWeight: 700, padding: "3px 7px", borderRadius: 5, background: "#fef2f2", border: "1px solid #fca5a5", color: "#dc2626", whiteSpace: "nowrap", flexShrink: 0 }}>TI Needed</span>
                  }
                </div>
              </div>
            );
          })}

          {/* Divider */}
          <div style={{ height: 1, background: "#e2e5f1", margin: "8px 0 12px" }} />

          {/* Completed label */}
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".6px", color: "#9ca3af", marginBottom: 10 }}>
            Completed Today
          </div>

          {completedOrders.length === 0 && completedSplits.length === 0 && (
            <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", padding: "8px 0" }}>
              No completed jobs yet today.
            </p>
          )}

          {completedOrders.map(co => {
            const customerName = co.order.customer?.customerName ?? co.order.shipToCustomerName ?? "—";
            const doneTime = co.completedAt
              ? new Date(co.completedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
              : "—";
            return (
              <div key={`sheet-co-${co.id}`} style={{ border: "1px solid #e2e5f1", borderRadius: 12, overflow: "hidden", marginBottom: 7, opacity: 0.65 }}>
                <div style={{ padding: "8px 11px", background: "#f0fdf4", borderBottom: "1px solid #bbf7d0" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{customerName}</div>
                  <div style={{ fontFamily: "monospace", fontSize: 9, fontWeight: 600, color: "#7c3aed", marginTop: 2 }}>
                    {co.order.obdNumber}
                  </div>
                </div>
                <div style={{ padding: "7px 11px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#27500a", background: "#eaf3de", border: "1px solid #97c459", padding: "2px 7px", borderRadius: 5 }}>
                    ✓ Tinting Done
                  </span>
                  <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, color: "#16a34a", background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "2px 8px", borderRadius: 6 }}>
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
              <div key={`sheet-cs-${sp.id}`} style={{ border: "1px solid #e2e5f1", borderRadius: 12, overflow: "hidden", marginBottom: 7, opacity: 0.65 }}>
                <div style={{ padding: "8px 11px", background: "#f0fdf4", borderBottom: "1px solid #bbf7d0" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{customerName}</div>
                  <div style={{ fontFamily: "monospace", fontSize: 9, fontWeight: 600, color: "#7c3aed", marginTop: 2 }}>
                    {sp.order.obdNumber}{sp.splitNumber != null ? ` · Split #${sp.splitNumber}` : ""}
                  </div>
                </div>
                <div style={{ padding: "7px 11px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#27500a", background: "#eaf3de", border: "1px solid #97c459", padding: "2px 7px", borderRadius: 5 }}>
                    ✓ Tinting Done
                  </span>
                  <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, color: "#16a34a", background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "2px 8px", borderRadius: 6 }}>
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
