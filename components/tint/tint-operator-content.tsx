"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/status-badge";
import { ObdCode } from "@/components/shared/obd-code";
import { SkuDetailsSheet } from "@/components/tint/sku-details-sheet";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SplitLineItem {
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
  tiSubmitted:      boolean;
  operatorSequence: number;
  startedAt:        string | null;
  completedAt:      string | null;
  orderId:          number;
  order: {
    obdNumber:          string;
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
  shipToCustomerName: string | null;
  customer: {
    customerName: string;
    area:         { name: string };
  } | null;
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

interface TIEntry {
  baseSku: string;
  tinQty:  number;
  YOX: number; LFY: number; GRN: number; TBL: number; WHT: number;
  MAG: number; FFR: number; BLK: number; OXR: number; HEY: number;
  HER: number; COB: number; COG: number;
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
  tintAssignmentId: number | null;
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

function defaultTIEntry(): TIEntry {
  return {
    baseSku: "", tinQty: 0,
    YOX: 0, LFY: 0, GRN: 0, TBL: 0, WHT: 0, MAG: 0,
    FFR: 0, BLK: 0, OXR: 0, HEY: 0, HER: 0, COB: 0, COG: 0,
  };
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
  const [assignedSplits,  setAssignedSplits]  = useState<OperatorSplit[]>([]);
  const [assignedOrders,  setAssignedOrders]  = useState<OperatorOrder[]>([]);
  const [isLoading,       setIsLoading]       = useState(true);
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
  const [tiEntries,       setTiEntries]       = useState<TIEntry[]>(() => [defaultTIEntry()]);
  const [tiActionLoading, setTiActionLoading] = useState(false);

  const fetchOrders = useCallback(async () => {
    try {
      const res  = await fetch("/api/tint/operator/my-orders");
      const data = (await res.json()) as {
        assignedOrders: OperatorOrder[];
        assignedSplits: OperatorSplit[];
        hasActiveJob:   boolean;
      };
      setAssignedOrders(data.assignedOrders);
      setAssignedSplits(data.assignedSplits);
      setHasActiveJob(data.hasActiveJob);

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
        customerName:     s.order.customer?.customerName ?? s.order.shipToCustomerName ?? "—",
        obdNumber:        s.order.obdNumber,
        splitNumber:      s.splitNumber,
        dispatchSlot:     s.order.dispatchSlot,
        articleTag:       s.articleTag,
        totalVolume:      s.totalVolume,
        lineItems:        s.lineItems,
        orderId:          s.orderId,
        tintAssignmentId: null,
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
        customerName:     o.customer?.customerName ?? o.shipToCustomerName ?? "—",
        obdNumber:        o.obdNumber,
        splitNumber:      undefined,
        dispatchSlot:     o.dispatchSlot,
        articleTag:       o.querySnapshot?.articleTag ?? null,
        totalVolume:      o.querySnapshot?.totalVolume ?? null,
        lineItems:        o.rawLineItems.map(li => ({ rawLineItem: li })),
        orderId:          o.id,
        tintAssignmentId: o.tintAssignments[0]?.id ?? null,
      }));

    return [...splitJobs, ...orderJobs].sort(
      (a, b) => a.operatorSequence - b.operatorSequence,
    );
  }, [assignedSplits, assignedOrders]);

  const completedSplits = useMemo(
    () => assignedSplits.filter(s => s.status === "tinting_done"),
    [assignedSplits],
  );

  const selectedJob = useMemo(
    () => jobs.find(j => j.id === selectedJobId && j.type === selectedJobType) ?? null,
    [jobs, selectedJobId, selectedJobType],
  );

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

  useEffect(() => {
    setTiEntries([defaultTIEntry()]);
  }, [selectedJobId, selectedJobType]);

  const pendingCount    = jobs.filter(j => j.status === "tint_assigned").length;
  const inProgressCount = jobs.filter(j => j.status === "tinting_in_progress").length;
  const completedCount  = completedSplits.length;
  const volumeDone      = completedSplits.reduce((s, sp) => s + (sp.totalVolume ?? 0), 0);
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

  async function submitTI(job: Job) {
    const validEntries = tiEntries.filter(e => e.baseSku.trim() !== "");
    if (validEntries.length === 0) {
      setError("Please fill at least one Base SKU entry.");
      return;
    }
    setTiActionLoading(true);
    setError(null);
    try {
      const splitRow = job.type === "split"
        ? assignedSplits.find(s => s.id === job.id)
        : null;
      const body = {
        orderId:          job.orderId,
        splitId:          job.type === "split" ? job.id : undefined,
        tintAssignmentId: job.type === "order" ? job.tintAssignmentId : undefined,
        entries:          validEntries,
      };
      // suppress unused var warning
      void splitRow;
      const res = await fetch("/api/tint/operator/tinter-issue", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to submit TI");
      }
      await fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit TI");
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
    if (job.type === "split") {
      await postSplitAction("/api/tint/operator/split/done", job.id);
    } else {
      await postOrderAction("/api/tint/operator/done", job.id);
    }
  }

  async function submitTIAndStart(job: Job) {
    await submitTI(job);
    // fetchOrders is called inside submitTI — after it resolves,
    // the job's tiSubmitted will be true and hasActiveJob is refreshed.
    // We do not auto-call startJob here — operator taps Start separately.
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
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

                      {/* TI badge */}
                      {isActive ? (
                        <span style={{ fontSize: 9.5, fontWeight: 700, padding: "3px 7px", borderRadius: 5, background: "#f7f8fc", border: "1px solid #e2e5f1", color: "#9ca3af", whiteSpace: "nowrap", flexShrink: 0 }}>
                          TI Done
                        </span>
                      ) : job.tiSubmitted ? (
                        <span style={{ fontSize: 9.5, fontWeight: 700, padding: "3px 7px", borderRadius: 5, background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#16a34a", display: "flex", alignItems: "center", gap: 3, whiteSpace: "nowrap", flexShrink: 0 }}>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                          TI Done
                        </span>
                      ) : (
                        <span style={{ fontSize: 9.5, fontWeight: 700, padding: "3px 7px", borderRadius: 5, background: "#fef2f2", border: "1px solid #fca5a5", color: "#dc2626", whiteSpace: "nowrap", flexShrink: 0 }}>
                          TI Needed
                        </span>
                      )}
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

              {completedSplits.length === 0 && (
                <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", padding: "12px 0" }}>
                  No completed jobs yet today.
                </p>
              )}

              {completedSplits.map(sp => {
                const customerName = sp.order.customer?.customerName ?? sp.order.shipToCustomerName ?? "—";
                const doneTime = sp.completedAt
                  ? new Date(sp.completedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
                  : "—";
                return (
                  <div key={sp.id} style={{ border: "1px solid #e2e5f1", borderRadius: 12, overflow: "hidden", marginBottom: 7, opacity: 0.65 }}>
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

                {/* TI Form */}
                <div style={{ padding: "0 16px 8px" }}>

                  {/* Section title */}
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".6px", color: "#9ca3af", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                    Tinter Issue Form
                    <div style={{ flex: 1, height: 1, background: "#e2e5f1" }} />
                  </div>

                  <div style={{ background: "#fff", border: "1px solid #e2e5f1", borderRadius: 12, overflow: "hidden" }}>

                    {/* Submitted banner — shown when tiSubmitted = true */}
                    {selectedJob.tiSubmitted && (
                      <div style={{ background: "#e8eaf6", borderBottom: "1px solid #c5cae9", padding: "9px 13px", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1a237e" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#1a237e" }}>TI Submitted</span>
                        <span style={{ fontSize: 10.5, color: "#5c6bc0", fontWeight: 500, marginLeft: "auto" }}>
                          Form is read-only
                        </span>
                      </div>
                    )}

                    {/* TI entries */}
                    {tiEntries.map((entry, idx) => (
                      <div key={idx} style={{ padding: "12px 14px", borderBottom: "1px solid #e2e5f1" }}>

                        {/* Entry header */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: "#9ca3af" }}>
                            Entry {idx + 1}
                          </span>
                          {idx > 0 && !selectedJob.tiSubmitted && (
                            <button
                              type="button"
                              onClick={() => setTiEntries(prev => prev.filter((_, i) => i !== idx))}
                              style={{ width: 24, height: 24, borderRadius: 6, border: "1px solid #fca5a5", background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#dc2626" }}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            </button>
                          )}
                        </div>

                        {/* Base SKU + Tin Qty row */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 8, marginBottom: 12 }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "#9ca3af" }}>Base SKU</span>
                            <input
                              type="text"
                              placeholder="e.g. WC-DB-20"
                              disabled={selectedJob.tiSubmitted}
                              value={entry.baseSku}
                              onChange={e => setTiEntries(prev => prev.map((en, i) => i === idx ? { ...en, baseSku: e.target.value } : en))}
                              style={{ height: 34, background: "#f7f8fc", border: "1px solid #e2e5f1", borderRadius: 8, padding: "0 10px", fontSize: 12, fontWeight: 500, color: "#111827", outline: "none", opacity: selectedJob.tiSubmitted ? 0.6 : 1 }}
                            />
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "#9ca3af" }}>Tin Qty</span>
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              placeholder="0"
                              disabled={selectedJob.tiSubmitted}
                              value={entry.tinQty || ""}
                              onChange={e => setTiEntries(prev => prev.map((en, i) => i === idx ? { ...en, tinQty: Number(e.target.value) } : en))}
                              style={{ height: 34, background: "#f7f8fc", border: "1px solid #e2e5f1", borderRadius: 8, padding: "0 10px", fontSize: 12, fontWeight: 500, color: "#111827", outline: "none", opacity: selectedJob.tiSubmitted ? 0.6 : 1 }}
                            />
                          </div>
                        </div>

                        {/* Shade quantities */}
                        <div style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: "#9ca3af", marginBottom: 7 }}>
                          Shade Quantities
                        </div>

                        {/* Row 1: first 7 shades */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5, marginBottom: 5 }}>
                          {SHADES.slice(0, 7).map(shade => (
                            <div key={shade.code} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                              <div style={{ fontSize: 9, fontWeight: 800, padding: "3px 0", borderRadius: 5, width: "100%", textAlign: "center", background: shade.bg, border: `1.5px solid ${shade.border}`, color: shade.text }}>
                                {shade.code}
                              </div>
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                placeholder="—"
                                disabled={selectedJob.tiSubmitted}
                                value={(entry[shade.code as keyof TIEntry] as number) || ""}
                                onChange={e => setTiEntries(prev => prev.map((en, i) => i === idx ? { ...en, [shade.code]: Number(e.target.value) } : en))}
                                style={{ width: "100%", padding: "5px 2px", borderRadius: 5, fontSize: 11, fontWeight: 700, textAlign: "center", background: shade.bg, border: `1.5px solid ${shade.border}`, color: shade.text, outline: "none", fontFamily: "monospace", opacity: selectedJob.tiSubmitted ? 0.6 : 1 }}
                              />
                            </div>
                          ))}
                        </div>

                        {/* Row 2: last 6 shades */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5 }}>
                          {SHADES.slice(7).map(shade => (
                            <div key={shade.code} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                              <div style={{ fontSize: 9, fontWeight: 800, padding: "3px 0", borderRadius: 5, width: "100%", textAlign: "center", background: shade.bg, border: `1.5px solid ${shade.border}`, color: shade.text }}>
                                {shade.code}
                              </div>
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                placeholder="—"
                                disabled={selectedJob.tiSubmitted}
                                value={(entry[shade.code as keyof TIEntry] as number) || ""}
                                onChange={e => setTiEntries(prev => prev.map((en, i) => i === idx ? { ...en, [shade.code]: Number(e.target.value) } : en))}
                                style={{ width: "100%", padding: "5px 2px", borderRadius: 5, fontSize: 11, fontWeight: 700, textAlign: "center", background: shade.bg, border: `1.5px solid ${shade.border}`, color: shade.text, outline: "none", fontFamily: "monospace", opacity: selectedJob.tiSubmitted ? 0.6 : 1 }}
                              />
                            </div>
                          ))}
                        </div>

                      </div>
                    ))}

                    {/* Add entry button — hidden when tiSubmitted */}
                    {!selectedJob.tiSubmitted && (
                      <div
                        onClick={() => setTiEntries(prev => [...prev, defaultTIEntry()])}
                        style={{ padding: "9px 14px", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: "#1a237e", cursor: "pointer", borderTop: "1px solid #e2e5f1", background: "#e8eaf6" }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Add Another Base Entry
                      </div>
                    )}

                  </div>
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

                  // Case 1 — In progress → Mark as Done
                  if (selectedJob.status === "tinting_in_progress") {
                    return (
                      <button
                        type="button"
                        onClick={() => markDone(selectedJob)}
                        disabled={isLoading}
                        style={{ flex: 1, background: "#16a34a", color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontSize: 13, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: isLoading ? 0.6 : 1 }}
                      >
                        {isLoading
                          ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" style={{ animation: "spin .7s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                          : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                        }
                        Mark as Done
                      </button>
                    );
                  }

                  // Case 2 — TI not submitted → Submit TI & Start
                  if (!selectedJob.tiSubmitted) {
                    return (
                      <button
                        type="button"
                        onClick={() => submitTIAndStart(selectedJob)}
                        disabled={isLoading}
                        style={{ flex: 1, background: "#1a237e", color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontSize: 13, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: isLoading ? 0.6 : 1 }}
                      >
                        {isLoading
                          ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" style={{ animation: "spin .7s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                          : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        }
                        Submit TI &amp; Start
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

                  // Case 4 — TI submitted, no active job → Start Job
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

          {completedSplits.length === 0 && (
            <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", padding: "8px 0" }}>
              No completed jobs yet today.
            </p>
          )}

          {completedSplits.map(sp => {
            const customerName = sp.order.customer?.customerName ?? sp.order.shipToCustomerName ?? "—";
            const doneTime = sp.completedAt
              ? new Date(sp.completedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
              : "—";
            return (
              <div key={`sheet-done-${sp.id}`} style={{ border: "1px solid #e2e5f1", borderRadius: 12, overflow: "hidden", marginBottom: 7, opacity: 0.65 }}>
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
  );
}
