"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, PackageOpen, X, Layers, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ObdCode } from "@/components/shared/obd-code";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TintAssignment {
  id: number;
  status: string;
  createdAt: string;
}

interface OperatorOrder {
  id: number;
  obdNumber: string;
  workflowStage: string;
  dispatchSlot?: string | null;
  shipToCustomerName: string | null;
  createdAt: string;
  customer: {
    customerName: string;
    area: { name: string };
  } | null;
  querySnapshot: {
    totalWeight: number;
    totalLines: number;
  } | null;
  tintAssignments: TintAssignment[];
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

function getProgressPct(stage: string): number {
  if (stage === "tinting_done")        return 100;
  if (stage === "tinting_in_progress") return 50;
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

function stageBadgeVariant(stage: string): StageBadgeVariant {
  if (stage === "tinting_in_progress") return "in-progress";
  if (stage === "tinting_done")        return "done";
  return "pending";
}

// ── Job card ──────────────────────────────────────────────────────────────────

interface OrderCardProps {
  order:           OperatorOrder;
  isActionLoading: boolean;
  onStart:         () => void;
  onDone:          () => void;
}

function OrderCard({ order, isActionLoading, onStart, onDone }: OrderCardProps) {
  const isPending    = order.workflowStage === "pending_tint_assignment";
  const isInProgress = order.workflowStage === "tinting_in_progress";
  const isDone       = order.workflowStage === "tinting_done";
  const weight       = order.querySnapshot?.totalWeight;
  const lines        = order.querySnapshot?.totalLines;
  const customerName = order.customer?.customerName ?? order.shipToCustomerName ?? "—";
  const area         = order.customer?.area.name ?? "—";
  const pct          = getProgressPct(order.workflowStage);

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
          { label: "Weight",        value: weight != null ? `${weight.toFixed(1)} kg` : "—" },
          { label: "SKU Count",     value: lines != null ? String(lines) : "—" },
          { label: "Slot",          value: order.dispatchSlot ?? "—" },
          { label: "Delivery Type", value: "—" },
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
  );
}

// ── Page Content ──────────────────────────────────────────────────────────────

export function TintOperatorContent() {
  const [orders,        setOrders]        = useState<OperatorOrder[]>([]);
  const [isLoading,     setIsLoading]     = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [error,         setError]         = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const res  = await fetch("/api/tint/operator/my-orders");
      const data = (await res.json()) as { orders: OperatorOrder[] };
      setOrders(data.orders);
    } catch {
      // leave stale
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    fetchOrders().finally(() => setIsLoading(false));
  }, [fetchOrders]);

  async function postAction(endpoint: string, orderId: number) {
    setActionLoading(orderId);
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
      setActionLoading(null);
    }
  }

  // ── Derived stats ─────────────────────────────────────────────────────────

  const inProgressOrders = orders.filter((o) => o.workflowStage === "tinting_in_progress");
  const todoOrders       = orders.filter((o) => o.workflowStage === "pending_tint_assignment");
  const doneOrders       = orders.filter((o) => o.workflowStage === "tinting_done");

  // Sort: in-progress first, then pending, then done
  const sortedOrders = [...inProgressOrders, ...todoOrders, ...doneOrders];

  const bothEmpty = inProgressOrders.length === 0 && todoOrders.length === 0;

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
          value={todoOrders.length}
          icon={<Layers size={18} />}
          iconBg="bg-indigo-50"
          iconColor="text-indigo-600"
          valueColor="text-indigo-600"
        />
        <StatCard
          label="In Progress"
          value={inProgressOrders.length}
          icon={<Clock size={18} />}
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
          valueColor="text-amber-600"
        />
        <StatCard
          label="Completed Today"
          value={doneOrders.length}
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
          sortedOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              isActionLoading={actionLoading === order.id}
              onStart={() => postAction("/api/tint/operator/start", order.id)}
              onDone={() => postAction("/api/tint/operator/done", order.id)}
            />
          ))
        )}
      </div>

    </div>
  );
}
