"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, ChevronDown, ChevronUp } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrderListItem {
  id: number;
  obdNumber: string;
  orderType: string;
  workflowStage: string;
  dispatchSlot: string | null;
  dispatchStatus: string | null;
  priorityLevel: number;
  shipToCustomerName: string | null;
  grossWeight: number | null;
  invoiceNo: string | null;
  createdAt: string;
  customer: {
    customerName: string;
    area: { name: string };
  } | null;
  querySnapshot: {
    totalWeight: number;
    totalLines: number;
    hasTinting: boolean;
  } | null;
  batch: { batchRef: string } | null;
}

interface OrdersResponse {
  orders: OrderListItem[];
  total: number;
  page: number;
  totalPages: number;
  pendingSupportCount: number;
  pendingTintCount: number;
  onHoldCount: number;
}

interface StatusLog {
  id: number;
  fromStage: string | null;
  toStage: string;
  note: string | null;
  createdAt: string;
  changedBy: { name: string | null } | null;
}

interface TintAssignment {
  id: number;
  status: string;
  assignedTo: { name: string | null };
}

interface OrderDetail extends OrderListItem {
  sapStatus: string | null;
  materialType: string | null;
  totalUnitQty: number | null;
  obdEmailDate: string | null;
  statusLogs: StatusLog[];
  tintAssignments: TintAssignment[];
}

interface LineItem {
  id: number;
  unitQty: number;
  lineWeight: number;
  isTinting: boolean;
  sku: { skuCode: string; skuName: string };
}

interface OrderDetailResponse {
  order: OrderDetail;
  lineItems: LineItem[];
}

interface SlotOption {
  id: number;
  name: string;
  slotTime: string;
}

interface EditForm {
  dispatchStatus: string;
  priorityLevel: string;
  dispatchSlot: string;
  note: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  order_created:            "Order Created",
  pending_tint_assignment:  "Pending Tint",
  tinting_in_progress:      "Tinting In Progress",
  tinting_done:             "Tinting Done",
  pending_support:          "Pending Support",
  dispatch_confirmation:    "Dispatch Confirmation",
  dispatched:               "Dispatched",
};

const STAGE_COLORS: Record<string, string> = {
  pending_tint_assignment:  "bg-amber-100 text-amber-700",
  tinting_in_progress:      "bg-orange-100 text-orange-700",
  tinting_done:             "bg-green-100 text-green-700",
  pending_support:          "bg-blue-100 text-blue-700",
  dispatch_confirmation:    "bg-purple-100 text-purple-700",
  dispatched:               "bg-slate-100 text-slate-600",
  order_created:            "bg-slate-100 text-slate-600",
};

function StageBadge({ stage }: { stage: string }) {
  const color = STAGE_COLORS[stage] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded ${color}`}>
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
}

function DispatchStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400 text-sm">—</span>;
  const colorMap: Record<string, string> = {
    hold:                      "bg-red-100 text-red-700",
    dispatch:                  "bg-green-100 text-green-700",
    waiting_for_confirmation:  "bg-yellow-100 text-yellow-700",
  };
  const labelMap: Record<string, string> = {
    hold:                      "Hold",
    dispatch:                  "Dispatch",
    waiting_for_confirmation:  "Waiting for Confirmation",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded ${colorMap[status] ?? "bg-slate-100 text-slate-600"}`}>
      {labelMap[status] ?? status}
    </span>
  );
}

function PriorityBadge({ level }: { level: number }) {
  if (level <= 2) {
    return <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded">Urgent</span>;
  }
  return <span className="bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 rounded">Normal</span>;
}

function StatCard({ title, value }: { title: string; value: number }) {
  return (
    <Card className="flex-1">
      <CardContent className="pt-4">
        <p className="text-sm text-slate-500">{title}</p>
        <p className="text-2xl font-bold text-[#1a237e] mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Page Content ──────────────────────────────────────────────────────────────

export function SupportPageContent() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [pendingSupportCount, setPendingSupportCount] = useState(0);
  const [pendingTintCount, setPendingTintCount] = useState(0);
  const [onHoldCount, setOnHoldCount] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [orderTypeFilter, setOrderTypeFilter] = useState("");
  const [dispatchStatusFilter, setDispatchStatusFilter] = useState("");

  const [selectedOrder, setSelectedOrder] = useState<OrderDetailResponse | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const [editForm, setEditForm] = useState<EditForm>({
    dispatchStatus: "",
    priorityLevel:  "3",
    dispatchSlot:   "",
    note:           "",
  });

  // ── Fetch orders ────────────────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    setIsLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search)               qs.set("search",         search);
      if (stageFilter)          qs.set("stage",           stageFilter);
      if (orderTypeFilter)      qs.set("orderType",       orderTypeFilter);
      if (dispatchStatusFilter) qs.set("dispatchStatus",  dispatchStatusFilter);
      qs.set("page", String(page));

      const res  = await fetch(`/api/support/orders?${qs.toString()}`);
      const data = (await res.json()) as OrdersResponse;
      setOrders(data.orders);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      setPendingSupportCount(data.pendingSupportCount);
      setPendingTintCount(data.pendingTintCount);
      setOnHoldCount(data.onHoldCount);
    } catch {
      // leave stale data on error
    } finally {
      setIsLoading(false);
    }
  }, [search, stageFilter, orderTypeFilter, dispatchStatusFilter, page]);

  // Debounce: 300ms for search, immediate for other filter/page changes
  useEffect(() => {
    const timer = setTimeout(fetchOrders, search ? 300 : 0);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, stageFilter, orderTypeFilter, dispatchStatusFilter, page]);

  // Fetch slot options when sheet opens
  useEffect(() => {
    if (!sheetOpen) return;
    fetch("/api/admin/slots")
      .then((r) => r.json())
      .then((data: SlotOption[]) => setSlots(data))
      .catch(() => setSlots([]));
  }, [sheetOpen]);

  // Pre-populate edit form when selected order changes
  useEffect(() => {
    if (!selectedOrder) return;
    const o = selectedOrder.order;
    setEditForm({
      dispatchStatus: o.dispatchStatus ?? "",
      priorityLevel:  String(o.priorityLevel),
      dispatchSlot:   o.dispatchSlot ?? "",
      note:           "",
    });
    setHistoryExpanded(false);
    setSheetError(null);
  }, [selectedOrder]);

  function setField<K extends keyof EditForm>(key: K, value: EditForm[K]) {
    setEditForm((prev) => ({ ...prev, [key]: value }));
  }

  // ── Open sheet for an order ──────────────────────────────────────────────
  async function openSheet(orderId: number) {
    setSheetLoading(true);
    setSheetOpen(true);
    setSheetError(null);
    try {
      const res  = await fetch(`/api/support/orders/${orderId}`);
      const data = (await res.json()) as OrderDetailResponse;
      setSelectedOrder(data);
    } catch {
      setSheetOpen(false);
    } finally {
      setSheetLoading(false);
    }
  }

  // ── Save changes ─────────────────────────────────────────────────────────
  async function handleSave() {
    if (!selectedOrder) return;
    setIsSaving(true);
    setSheetError(null);
    try {
      const body = {
        dispatchStatus: editForm.dispatchStatus || undefined,
        priorityLevel:  Number(editForm.priorityLevel),
        dispatchSlot:   editForm.dispatchSlot || null,
        note:           editForm.note || undefined,
      };
      const res = await fetch(`/api/support/orders/${selectedOrder.order.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(typeof err.error === "string" ? err.error : "Save failed");
      }
      setSheetOpen(false);
      setSelectedOrder(null);
      void fetchOrders();
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setStageFilter("");
    setOrderTypeFilter("");
    setDispatchStatusFilter("");
    setPage(1);
  }

  // ── Pagination display ───────────────────────────────────────────────────
  const LIMIT      = 25;
  const pageStart  = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const pageEnd    = Math.min(page * LIMIT, total);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Stats row */}
      <div className="flex gap-4 mb-6">
        <StatCard title="Total Orders"    value={total} />
        <StatCard title="Pending Support" value={pendingSupportCount} />
        <StatCard title="Pending Tint"    value={pendingTintCount} />
        <StatCard title="On Hold"         value={onHoldCount} />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <Input
          placeholder="OBD number or customer…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="max-w-xs"
        />

        {/* Workflow stage */}
        <Select value={stageFilter} onValueChange={(v) => { setStageFilter(v === "all" ? "" : (v ?? "")); setPage(1); }}>
          <SelectTrigger className="w-52"><SelectValue placeholder="All Stages" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            <SelectItem value="order_created">Order Created</SelectItem>
            <SelectItem value="pending_tint_assignment">Pending Tint Assignment</SelectItem>
            <SelectItem value="tinting_in_progress">Tinting In Progress</SelectItem>
            <SelectItem value="tinting_done">Tinting Done</SelectItem>
            <SelectItem value="pending_support">Pending Support</SelectItem>
            <SelectItem value="dispatch_confirmation">Dispatch Confirmation</SelectItem>
            <SelectItem value="dispatched">Dispatched</SelectItem>
          </SelectContent>
        </Select>

        {/* Order type */}
        <Select value={orderTypeFilter} onValueChange={(v) => { setOrderTypeFilter(v === "all" ? "" : (v ?? "")); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="tint">Tint</SelectItem>
            <SelectItem value="non_tint">Non-Tint</SelectItem>
          </SelectContent>
        </Select>

        {/* Dispatch status */}
        <Select value={dispatchStatusFilter} onValueChange={(v) => { setDispatchStatusFilter(v === "all" ? "" : (v ?? "")); setPage(1); }}>
          <SelectTrigger className="w-52"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="not_set">Not Set</SelectItem>
            <SelectItem value="hold">Hold</SelectItem>
            <SelectItem value="dispatch">Dispatch</SelectItem>
            <SelectItem value="waiting_for_confirmation">Waiting for Confirmation</SelectItem>
          </SelectContent>
        </Select>

        <button
          onClick={clearFilters}
          className="text-sm text-slate-600 border border-slate-300 rounded-md px-3 py-1.5 hover:bg-slate-50 transition-colors"
        >
          Clear filters
        </button>
      </div>

      {/* Main table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-slate-400" size={28} />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16 text-slate-400">No orders found.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>OBD Number</TableHead>
                <TableHead>Customer Name</TableHead>
                <TableHead>Area</TableHead>
                <TableHead>Weight (kg)</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Workflow Stage</TableHead>
                <TableHead>Dispatch Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Slot</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id} className="hover:bg-slate-50">
                  <TableCell className="font-mono text-xs font-medium text-slate-800">
                    {order.obdNumber}
                  </TableCell>
                  <TableCell className="text-sm text-slate-700 max-w-[160px] truncate">
                    {order.customer?.customerName ?? order.shipToCustomerName ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {order.customer?.area.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {order.querySnapshot?.totalWeight != null
                      ? order.querySnapshot.totalWeight.toFixed(1)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {order.orderType === "tint" ? (
                      <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">TINT</span>
                    ) : (
                      <span className="bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 rounded">NON-TINT</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StageBadge stage={order.workflowStage} />
                  </TableCell>
                  <TableCell>
                    <DispatchStatusBadge status={order.dispatchStatus} />
                  </TableCell>
                  <TableCell>
                    <PriorityBadge level={order.priorityLevel} />
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {order.dispatchSlot ?? "—"}
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => openSheet(order.id)}
                      className="text-xs text-[#1a237e] border border-[#1a237e]/30 rounded px-2.5 py-1 hover:bg-[#1a237e]/5 font-medium transition-colors"
                    >
                      Edit
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center text-sm text-slate-600">
        <span>
          {total === 0
            ? "No orders"
            : `Showing ${pageStart}–${pageEnd} of ${total} orders`}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => p - 1)}
            disabled={page <= 1}
            className="border border-slate-300 rounded-md px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= totalPages}
            className="border border-slate-300 rounded-md px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      </div>

      {/* ── Edit Sheet ─────────────────────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto flex flex-col">
          <SheetHeader>
            <SheetTitle className="font-mono text-base">
              {selectedOrder?.order.obdNumber ?? "Loading…"}
            </SheetTitle>
            {selectedOrder && (
              <p className="text-sm text-slate-500 mt-0.5">
                {selectedOrder.order.customer?.customerName ??
                  selectedOrder.order.shipToCustomerName ?? "—"}
              </p>
            )}
          </SheetHeader>

          {sheetLoading ? (
            <div className="flex items-center justify-center flex-1 py-12">
              <Loader2 className="animate-spin text-slate-400" size={28} />
            </div>
          ) : selectedOrder ? (
            <div className="px-4 pb-6 flex flex-col gap-6">

              {/* Section 1: Order Details (read-only) */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                  Order Details
                </p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <DetailRow label="Order Type"    value={selectedOrder.order.orderType === "tint" ? "Tint" : "Non-Tint"} />
                  <DetailRow label="Workflow Stage" value={STAGE_LABELS[selectedOrder.order.workflowStage] ?? selectedOrder.order.workflowStage} />
                  <DetailRow label="Batch Ref"     value={selectedOrder.order.batch?.batchRef ?? "—"} mono />
                  <DetailRow label="Invoice No"    value={selectedOrder.order.invoiceNo ?? "—"} />
                  <DetailRow label="Created At"    value={formatDateTime(selectedOrder.order.createdAt)} />
                  <DetailRow label="Total Weight"  value={selectedOrder.order.querySnapshot?.totalWeight != null ? `${selectedOrder.order.querySnapshot.totalWeight.toFixed(1)} kg` : "—"} />
                </div>
              </div>

              <hr className="border-slate-100" />

              {/* Section 2: Actions (editable) */}
              <div className="flex flex-col gap-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Actions
                </p>

                {/* Dispatch Status */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Dispatch Status</label>
                  <Select
                    value={editForm.dispatchStatus}
                    onValueChange={(v) => setField("dispatchStatus", v === "none" ? "" : (v ?? ""))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Not Set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not Set</SelectItem>
                      <SelectItem value="hold">Hold</SelectItem>
                      <SelectItem value="dispatch">Dispatch</SelectItem>
                      <SelectItem value="waiting_for_confirmation">Waiting for Confirmation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Priority */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Priority</label>
                  <Select
                    value={editForm.priorityLevel}
                    onValueChange={(v) => setField("priorityLevel", v ?? "3")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">Normal</SelectItem>
                      <SelectItem value="2">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Slot Override */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Slot Override</label>
                  <Select
                    value={editForm.dispatchSlot}
                    onValueChange={(v) => setField("dispatchSlot", v === "none" ? "" : (v ?? ""))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="No override" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No override</SelectItem>
                      {slots.map((s) => (
                        <SelectItem key={s.id} value={s.name}>
                          {s.name} ({s.slotTime})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Note */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Note</label>
                  <textarea
                    value={editForm.note}
                    onChange={(e) => setField("note", e.target.value)}
                    placeholder="Add a note…"
                    rows={3}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#1a237e] focus:outline-none focus:ring-2 focus:ring-[#1a237e]/20 resize-none"
                  />
                </div>

                {sheetError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
                    {sheetError}
                  </div>
                )}

                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="w-full bg-[#1a237e] text-white rounded-lg py-2.5 font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#1a237e]/90 transition-colors"
                >
                  {isSaving && <Loader2 className="animate-spin" size={16} />}
                  Save Changes
                </button>
              </div>

              <hr className="border-slate-100" />

              {/* Section 3: Line Items */}
              <div>
                <p className="text-sm font-medium text-slate-500 mb-2">Line Items</p>
                {selectedOrder.lineItems.length === 0 ? (
                  <p className="text-slate-400 text-sm">No line items found.</p>
                ) : (
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="text-left text-xs font-medium text-slate-400 border-b border-slate-100">
                        <th className="pb-1.5 pr-3">SKU Code</th>
                        <th className="pb-1.5 pr-3">SKU Name</th>
                        <th className="pb-1.5 pr-3">Qty</th>
                        <th className="pb-1.5 pr-3">Weight</th>
                        <th className="pb-1.5">Tinting</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.lineItems.map((line) => (
                        <tr key={line.id} className="border-b border-slate-50 last:border-0">
                          <td className="py-1.5 pr-3 font-mono text-xs text-slate-700">{line.sku.skuCode}</td>
                          <td className="py-1.5 pr-3 text-slate-600 max-w-[140px] truncate">{line.sku.skuName}</td>
                          <td className="py-1.5 pr-3 text-slate-600">{line.unitQty}</td>
                          <td className="py-1.5 pr-3 text-slate-600">{line.lineWeight > 0 ? `${line.lineWeight.toFixed(1)} kg` : "—"}</td>
                          <td className="py-1.5">
                            {line.isTinting ? (
                              <span className="bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded">TINT</span>
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

              {/* Section 4: Status History (collapsible) */}
              <div>
                <button
                  onClick={() => setHistoryExpanded((v) => !v)}
                  className="flex items-center justify-between w-full text-sm font-medium text-slate-500 hover:text-slate-700"
                >
                  <span>Status History</span>
                  {historyExpanded
                    ? <ChevronUp size={16} />
                    : <ChevronDown size={16} />}
                </button>
                {historyExpanded && (
                  <div className="mt-3 flex flex-col gap-2">
                    {selectedOrder.order.statusLogs.length === 0 ? (
                      <p className="text-slate-400 text-sm">No history yet.</p>
                    ) : (
                      selectedOrder.order.statusLogs.map((log) => (
                        <div key={log.id} className="text-xs bg-slate-50 rounded-lg px-3 py-2">
                          <div className="flex justify-between items-start gap-2">
                            <span className="text-slate-500">{formatDateTime(log.createdAt)}</span>
                            <span className="text-slate-400">{log.changedBy?.name ?? "System"}</span>
                          </div>
                          <div className="text-slate-700 mt-1 font-medium">
                            {log.fromStage ?? "—"} → {log.toStage}
                          </div>
                          {log.note && (
                            <div className="text-slate-500 mt-0.5 italic">{log.note}</div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Helper sub-component ──────────────────────────────────────────────────────

function DetailRow({
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
      <p className={`text-slate-700 mt-0.5 truncate ${mono ? "font-mono text-xs" : "text-sm"}`}>
        {value}
      </p>
    </div>
  );
}
