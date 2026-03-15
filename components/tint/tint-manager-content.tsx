"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TintAssignmentInfo {
  id: number;
  status: string;
  assignedTo: { id: number; name: string | null };
}

interface TintOrder {
  id: number;
  obdNumber: string;
  workflowStage: string;
  dispatchSlot: string | null;
  priorityLevel: number;
  createdAt: string;
  shipToCustomerName: string | null;
  customer: {
    customerName: string;
    area: { name: string };
  } | null;
  querySnapshot: {
    totalWeight: number;
    totalLines: number;
  } | null;
  tintAssignments: TintAssignmentInfo[];
}

interface Operator {
  id: number;
  name: string | null;
}

interface DetailLineItem {
  id: number;
  unitQty: number;
  lineWeight: number;
  isTinting: boolean;
  sku: { skuCode: string; skuName: string };
}

interface DetailOrder {
  id: number;
  obdNumber: string;
  orderType: string;
  workflowStage: string;
  createdAt: string;
  invoiceNo: string | null;
  shipToCustomerName: string | null;
  querySnapshot: {
    totalWeight: number;
    totalLines: number;
    hasTinting: boolean;
  } | null;
  batch: { batchRef: string } | null;
  customer: {
    customerName: string;
    area: { name: string };
  } | null;
}

interface OrderDetailResponse {
  order: DetailOrder;
  lineItems: DetailLineItem[];
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

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const STAGE_LABELS: Record<string, string> = {
  pending_tint_assignment: "Pending Assignment",
  tinting_in_progress:     "In Progress",
  tinting_done:            "Done",
};

// ── Kanban column config ──────────────────────────────────────────────────────

const COLUMNS = [
  { label: "Pending Assignment", stage: "pending_tint_assignment", color: "amber"  },
  { label: "In Progress",        stage: "tinting_in_progress",     color: "orange" },
  { label: "Done",               stage: "tinting_done",            color: "green"  },
] as const;

type ColumnColor = "amber" | "orange" | "green";

const COLUMN_BADGE: Record<ColumnColor, string> = {
  amber:  "bg-amber-100 text-amber-700",
  orange: "bg-orange-100 text-orange-700",
  green:  "bg-green-100 text-green-700",
};

// ── Sub-components ────────────────────────────────────────────────────────────

interface KanbanCardProps {
  order: TintOrder;
  onClick: () => void;
}

function KanbanCard({ order, onClick }: KanbanCardProps) {
  const assignment = order.tintAssignments[0] ?? null;
  const weight = order.querySnapshot?.totalWeight;

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg p-3 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
    >
      {/* Row 1: OBD + Weight */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-mono text-sm font-bold text-slate-800 truncate">
          {order.obdNumber}
        </span>
        {weight != null && (
          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded shrink-0">
            {weight.toFixed(1)} kg
          </span>
        )}
      </div>

      {/* Row 2: Customer */}
      <p className="text-sm text-slate-600 truncate mb-0.5">
        {order.customer?.customerName ?? order.shipToCustomerName ?? "—"}
      </p>

      {/* Row 3: Area */}
      <p className="text-xs text-slate-400 mb-2">
        {order.customer?.area.name ?? "—"}
      </p>

      {/* Row 4: Operator */}
      {assignment ? (
        <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">
          <span className="bg-blue-200 text-blue-800 rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold shrink-0">
            {initials(assignment.assignedTo.name)}
          </span>
          {assignment.assignedTo.name ?? "Unknown"}
        </span>
      ) : (
        <span className="text-red-500 text-xs font-medium">● Unassigned</span>
      )}

      {/* Row 5: Time ago */}
      <p className="text-xs text-slate-400 mt-1.5">{timeAgo(order.createdAt)}</p>
    </div>
  );
}

// ── Page Content ──────────────────────────────────────────────────────────────

export function TintManagerContent() {
  const [orders,    setOrders]    = useState<TintOrder[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedOrder,  setSelectedOrder]  = useState<TintOrder | null>(null);
  const [orderDetail,    setOrderDetail]    = useState<OrderDetailResponse | null>(null);
  const [detailLoading,  setDetailLoading]  = useState(false);
  const [sheetOpen,      setSheetOpen]      = useState(false);

  const [assignedToId,  setAssignedToId]  = useState<string>("");
  const [note,          setNote]          = useState("");
  const [isAssigning,   setIsAssigning]   = useState(false);
  const [assignError,   setAssignError]   = useState<string | null>(null);

  // ── Data fetching ────────────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    try {
      const res  = await fetch("/api/tint/manager/orders");
      const data = (await res.json()) as { orders: TintOrder[] };
      setOrders(data.orders);
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
        const ordersData = (await ordersRes.json()) as { orders: TintOrder[] };
        const opsData    = (await opsRes.json())    as { operators: Operator[] };
        setOrders(ordersData.orders);
        setOperators(opsData.operators);
      } finally {
        setIsLoading(false);
      }
    }
    void init();
  }, [fetchOrders]);

  // ── Open sheet ───────────────────────────────────────────────────────────
  function openSheet(order: TintOrder) {
    const currentOpId = order.tintAssignments[0]?.assignedTo.id;
    setSelectedOrder(order);
    setAssignedToId(currentOpId ? String(currentOpId) : "");
    setNote("");
    setAssignError(null);
    setOrderDetail(null);
    setSheetOpen(true);

    // Fetch full detail in background
    setDetailLoading(true);
    fetch(`/api/support/orders/${order.id}`)
      .then((r) => r.json())
      .then((data: OrderDetailResponse) => setOrderDetail(data))
      .catch(() => setOrderDetail(null))
      .finally(() => setDetailLoading(false));
  }

  // ── Assign ───────────────────────────────────────────────────────────────
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
      setSheetOpen(false);
      setSelectedOrder(null);
      void fetchOrders();
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Assignment failed");
    } finally {
      setIsAssigning(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    );
  }

  return (
    <div>
      {/* Kanban board */}
      <div className="flex flex-row gap-4 items-start">
        {COLUMNS.map((col) => {
          const colOrders = orders.filter((o) => o.workflowStage === col.stage);
          return (
            <div
              key={col.stage}
              className="flex-1 min-w-0 rounded-xl bg-slate-100 p-3"
            >
              {/* Column header */}
              <div className="flex justify-between items-center mb-3">
                <span className="font-medium text-slate-700 text-sm">{col.label}</span>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${COLUMN_BADGE[col.color]}`}
                >
                  {colOrders.length}
                </span>
              </div>

              {/* Card list */}
              <div className="flex flex-col gap-2 max-h-[70vh] overflow-y-auto">
                {colOrders.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">No orders</p>
                ) : (
                  colOrders.map((order) => (
                    <KanbanCard
                      key={order.id}
                      order={order}
                      onClick={() => openSheet(order)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Assignment Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto flex flex-col">
          <SheetHeader>
            <SheetTitle className="font-mono">
              {selectedOrder?.obdNumber ?? ""}
            </SheetTitle>
            <SheetDescription>
              {selectedOrder?.customer?.customerName ??
                selectedOrder?.shipToCustomerName ?? "—"}
              {selectedOrder?.customer?.area.name
                ? ` · ${selectedOrder.customer.area.name}`
                : ""}
            </SheetDescription>
          </SheetHeader>

          {selectedOrder && (
            <div className="px-4 pb-6 flex flex-col gap-6">

              {/* Section 1 — Order details */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                  Order Details
                </p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <SheetDetail label="Order Type"   value="Tint" />
                  <SheetDetail label="Stage"        value={STAGE_LABELS[selectedOrder.workflowStage] ?? selectedOrder.workflowStage} />
                  <SheetDetail label="Weight"       value={selectedOrder.querySnapshot?.totalWeight != null ? `${selectedOrder.querySnapshot.totalWeight.toFixed(1)} kg` : "—"} />
                  <SheetDetail label="Total Lines"  value={String(selectedOrder.querySnapshot?.totalLines ?? "—")} />
                  <SheetDetail label="Created At"   value={formatDateTime(selectedOrder.createdAt)} />
                  <SheetDetail label="Batch Ref"    value={orderDetail?.order.batch?.batchRef ?? (detailLoading ? "…" : "—")} mono />
                </div>
              </div>

              <hr className="border-slate-100" />

              {/* Section 2 — Line items */}
              <div>
                <p className="text-sm font-medium text-slate-500 mb-2">Line Items</p>
                {detailLoading ? (
                  <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
                    <Loader2 className="animate-spin" size={14} />
                    Loading…
                  </div>
                ) : !orderDetail || orderDetail.lineItems.length === 0 ? (
                  <p className="text-slate-400 text-sm">
                    {selectedOrder.querySnapshot?.totalLines
                      ? `${selectedOrder.querySnapshot.totalLines} lines (detail unavailable)`
                      : "No line items found."}
                  </p>
                ) : (
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="text-left text-xs font-medium text-slate-400 border-b border-slate-100">
                        <th className="pb-1.5 pr-3">SKU Code</th>
                        <th className="pb-1.5 pr-3">SKU Name</th>
                        <th className="pb-1.5 pr-3">Qty</th>
                        <th className="pb-1.5">Tinting</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderDetail.lineItems.map((line) => (
                        <tr key={line.id} className="border-b border-slate-50 last:border-0">
                          <td className="py-1.5 pr-3 font-mono text-xs text-slate-700">
                            {line.sku.skuCode}
                          </td>
                          <td className="py-1.5 pr-3 text-slate-600 max-w-[130px] truncate">
                            {line.sku.skuName}
                          </td>
                          <td className="py-1.5 pr-3 text-slate-600">{line.unitQty}</td>
                          <td className="py-1.5">
                            {line.isTinting ? (
                              <span className="bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded">
                                TINT
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <hr className="border-slate-100" />

              {/* Section 3 — Assignment */}
              <div className="flex flex-col gap-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Assign to Operator
                </p>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    Operator
                    {selectedOrder.tintAssignments[0] && (
                      <span className="ml-2 text-xs text-slate-400 font-normal">
                        (currently assigned)
                      </span>
                    )}
                  </label>
                  <Select
                    value={assignedToId}
                    onValueChange={(v) => setAssignedToId(v ?? "")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select operator…" />
                    </SelectTrigger>
                    <SelectContent>
                      {operators.length === 0 ? (
                        <SelectItem value="none" disabled>
                          No operators available
                        </SelectItem>
                      ) : (
                        operators.map((op) => (
                          <SelectItem key={op.id} value={String(op.id)}>
                            {op.name ?? `Operator ${op.id}`}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    Note (optional)
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Any tinting instructions…"
                    rows={3}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#1a237e] focus:outline-none focus:ring-2 focus:ring-[#1a237e]/20 resize-none"
                  />
                </div>

                {assignError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
                    {assignError}
                  </div>
                )}

                <button
                  onClick={handleAssign}
                  disabled={!assignedToId || isAssigning}
                  className="w-full bg-[#1a237e] text-white rounded-lg py-2.5 font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#1a237e]/90 transition-colors"
                >
                  {isAssigning && <Loader2 className="animate-spin" size={16} />}
                  Assign
                </button>
              </div>

            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Helper sub-component ──────────────────────────────────────────────────────

function SheetDetail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="text-slate-400 text-xs">{label}</span>
      <p
        className={`text-slate-700 mt-0.5 truncate ${
          mono ? "font-mono text-xs" : "text-sm"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
