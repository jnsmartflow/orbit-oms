"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, PackageOpen, X } from "lucide-react";

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
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface OrderCardProps {
  order: OperatorOrder;
  isActionLoading: boolean;
  onStart: () => void;
  onDone: () => void;
}

function OrderCard({ order, isActionLoading, onStart, onDone }: OrderCardProps) {
  const inProgress = order.workflowStage === "tinting_in_progress";
  const assignedAt = order.tintAssignments[0]?.createdAt;
  const weight     = order.querySnapshot?.totalWeight;
  const lines      = order.querySnapshot?.totalLines;
  const customer   = order.customer?.customerName ?? order.shipToCustomerName ?? "—";
  const area       = order.customer?.area.name ?? "";

  return (
    <div
      className={`bg-white rounded-xl p-4 shadow-sm mb-3 border-l-4 ${
        inProgress ? "border-l-orange-400" : "border-l-amber-300"
      }`}
    >
      {/* Row 1: OBD + Weight */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-mono font-bold text-slate-800">{order.obdNumber}</span>
        {weight != null && (
          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded shrink-0">
            {weight.toFixed(1)} kg
          </span>
        )}
      </div>

      {/* Row 2: Customer + Area */}
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-sm text-slate-600 truncate">{customer}</span>
        {area && <span className="text-xs text-slate-400 shrink-0">{area}</span>}
      </div>

      {/* Row 3: Lines + assigned time */}
      <div className="flex items-center justify-between text-xs text-slate-400 mb-3">
        <span>{lines != null ? `${lines} lines` : "—"}</span>
        {assignedAt && (
          <span>Assigned {timeAgo(assignedAt)}</span>
        )}
      </div>

      {/* Action button */}
      {inProgress ? (
        <button
          onClick={onDone}
          disabled={isActionLoading}
          className="w-full bg-green-600 text-white rounded-lg py-2 font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-700 transition-colors"
        >
          {isActionLoading && <Loader2 className="animate-spin" size={16} />}
          Mark as Done
        </button>
      ) : (
        <button
          onClick={onStart}
          disabled={isActionLoading}
          className="w-full bg-[#1a237e] text-white rounded-lg py-2 font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#1a237e]/90 transition-colors"
        >
          {isActionLoading && <Loader2 className="animate-spin" size={16} />}
          Start Tinting
        </button>
      )}
    </div>
  );
}

interface SectionProps {
  label: string;
  dotColor: string;
  emptyText: string;
  orders: OperatorOrder[];
  actionLoading: number | null;
  onStart: (id: number) => void;
  onDone: (id: number) => void;
}

function Section({
  label, dotColor, emptyText, orders, actionLoading, onStart, onDone,
}: SectionProps) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <h2 className="font-semibold text-slate-700">{label}</h2>
        <span className="text-sm text-slate-400">({orders.length})</span>
      </div>
      {orders.length === 0 ? (
        <p className="text-sm text-slate-400 pl-4">{emptyText}</p>
      ) : (
        orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            isActionLoading={actionLoading === order.id}
            onStart={() => onStart(order.id)}
            onDone={() => onDone(order.id)}
          />
        ))
      )}
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

  const inProgressOrders = orders.filter((o) => o.workflowStage === "tinting_in_progress");
  const todoOrders       = orders.filter((o) => o.workflowStage === "pending_tint_assignment");

  const inProgressCount  = inProgressOrders.length;
  const todoCount        = todoOrders.length;
  const bothEmpty        = inProgressCount === 0 && todoCount === 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    );
  }

  return (
    <div>
      {/* Stats bar */}
      <div className="flex flex-row gap-3 mb-6">
        <span className="bg-orange-100 text-orange-700 px-4 py-2 rounded-full text-sm font-medium">
          In Progress: <strong>{inProgressCount}</strong>
        </span>
        <span className="bg-amber-100 text-amber-700 px-4 py-2 rounded-full text-sm font-medium">
          To Do: <strong>{todoCount}</strong>
        </span>
        <span className="bg-green-100 text-green-700 px-4 py-2 rounded-full text-sm font-medium">
          Done Today: <strong>0</strong>
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start justify-between bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-3 text-red-400 hover:text-red-600 shrink-0"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Empty state */}
      {bothEmpty ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <PackageOpen size={48} className="text-slate-300 mb-4" />
          <p className="text-slate-500 font-medium mb-1">No tint jobs assigned</p>
          <p className="text-slate-400 text-sm">Check back later or contact your Tint Manager</p>
        </div>
      ) : (
        <>
          {/* In Progress section */}
          <Section
            label="In Progress"
            dotColor="bg-orange-400"
            emptyText="No orders in progress"
            orders={inProgressOrders}
            actionLoading={actionLoading}
            onStart={(id) => postAction("/api/tint/operator/start", id)}
            onDone={(id) => postAction("/api/tint/operator/done", id)}
          />

          {/* To Do section */}
          <Section
            label="To Do"
            dotColor="bg-amber-400"
            emptyText="No orders assigned"
            orders={todoOrders}
            actionLoading={actionLoading}
            onStart={(id) => postAction("/api/tint/operator/start", id)}
            onDone={(id) => postAction("/api/tint/operator/done", id)}
          />
        </>
      )}
    </div>
  );
}
