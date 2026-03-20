"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, PackageOpen, X, Layers, Clock, CheckCircle2, AlertCircle, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatCard } from "@/components/shared/stat-card";
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
  id:          number;
  splitNumber: number;
  status:      string;
  totalVolume: number | null;
  articleTag:  string | null;
  createdAt:   string;
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
    status:    string;
    startedAt: string | null;
  }[];
  querySnapshot: {
    totalUnitQty: number;
    totalVolume:  number;
    articleTag:   string | null;
    totalLines:   number;
  } | null;
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

export function TintOperatorContent() {
  const [assignedSplits,  setAssignedSplits]  = useState<OperatorSplit[]>([]);
  const [assignedOrders,  setAssignedOrders]  = useState<OperatorOrder[]>([]);
  const [isLoading,       setIsLoading]       = useState(true);
  const [splitActionLoading, setSplitActionLoading] = useState<number | null>(null);
  const [orderActionLoading, setOrderActionLoading] = useState<number | null>(null);
  const [error,           setError]           = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const res  = await fetch("/api/tint/operator/my-orders");
      const data = (await res.json()) as {
        assignedOrders: OperatorOrder[];
        assignedSplits: OperatorSplit[];
      };
      setAssignedOrders(data.assignedOrders);
      setAssignedSplits(data.assignedSplits);
    } catch {
      // leave stale
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    fetchOrders().finally(() => setIsLoading(false));
  }, [fetchOrders]);

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
        const err = (await res.json()) as { error?: string };
        throw new Error(typeof err.error === "string" ? err.error : "Action failed");
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
        const err = (await res.json()) as { error?: string };
        throw new Error(typeof err.error === "string" ? err.error : "Action failed");
      }
      await fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setOrderActionLoading(null);
    }
  }

  // ── Derived stats ─────────────────────────────────────────────────────────

  const inProgressSplits = assignedSplits.filter((s) => s.status === "tinting_in_progress");
  const todoSplits       = assignedSplits.filter((s) => s.status === "tint_assigned");

  const inProgressOrders = assignedOrders.filter((o) => o.workflowStage === "tinting_in_progress");
  const todoOrders       = assignedOrders.filter((o) => o.workflowStage === "tint_assigned");

  const myQueueCount    = todoSplits.length    + todoOrders.length;
  const inProgressCount = inProgressSplits.length + inProgressOrders.length;

  const bothEmpty = myQueueCount === 0 && inProgressCount === 0;

  // Sort splits: in-progress first, then pending
  const sortedSplits = [...inProgressSplits, ...todoSplits];
  // Sort orders: in-progress first, then pending
  const sortedOrders = [...inProgressOrders, ...todoOrders];

  // ── Loading ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f0f2f8]">
        <div className="px-6 pt-5 pb-3 h-12" />
        <div className="px-6 pb-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-gray-100 rounded-xl h-[88px] animate-pulse" />
          ))}
        </div>
        <div className="px-6 pb-6 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-gray-100 rounded-xl h-32 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#f0f2f8]">

      {/* ── Page title ───────────────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-3">
        <h1 className="text-[17px] font-extrabold text-gray-900">My Tint Jobs</h1>
      </div>

      {/* ── Stat bar ─────────────────────────────────────────────────────── */}
      <div className="px-6 pb-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="My Queue"
          value={myQueueCount}
          icon={<Layers size={18} />}
          iconBg="bg-indigo-50"
          iconColor="text-indigo-600"
          valueColor="text-indigo-600"
        />
        <StatCard
          label="In Progress"
          value={inProgressCount}
          icon={<Clock size={18} />}
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
          valueColor="text-amber-600"
        />
        <StatCard
          label="Completed Today"
          value={0}
          icon={<CheckCircle2 size={18} />}
          iconBg="bg-green-50"
          iconColor="text-green-600"
          valueColor="text-green-600"
        />
      </div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className="px-6 pb-6">

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-[12.5px] mb-4">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <span className="text-red-700 font-medium">{error}</span>
            <button
              type="button"
              className="ml-auto text-[12px] text-red-600 underline"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Empty state */}
        {bothEmpty ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
              <PackageOpen className="h-5 w-5 text-gray-400" />
            </div>
            <p className="text-[13px] font-semibold text-gray-500">No tint jobs assigned</p>
            <p className="text-[12px] text-gray-400 mt-1">Check back later or contact your Tint Manager</p>
          </div>
        ) : (
          <>
            {/* Regular assigned orders */}
            {sortedOrders.map((order) => (
              <RegularOrderCard
                key={`order-${order.id}`}
                order={order}
                isActionLoading={orderActionLoading === order.id}
                onStart={() => postOrderAction("/api/tint/operator/start", order.id)}
                onDone={() => postOrderAction("/api/tint/operator/done", order.id)}
              />
            ))}

            {/* Split cards */}
            {sortedSplits.map((split) => (
              <SplitCard
                key={`split-${split.id}`}
                split={split}
                isActionLoading={splitActionLoading === split.id}
                onStart={() => postSplitAction("/api/tint/operator/split/start", split.id)}
                onDone={() => postSplitAction("/api/tint/operator/split/done", split.id)}
              />
            ))}
          </>
        )}
      </div>

    </div>
  );
}
