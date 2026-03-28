"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, ChevronDown, ChevronUp, ClipboardList, AlertCircle, CheckCircle2, Clock, Zap, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
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
} from "@/components/ui/sheet";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ObdCode } from "@/components/shared/obd-code";
import { CustomerMissingSheet } from "@/components/shared/customer-missing-sheet";

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
  shipToCustomerId: string | null;
  customerMissing: boolean;
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

interface SplitItem {
  id:             number;
  splitNumber:    number;
  status:         string;
  totalQty:       number;
  totalVolume:    number | null;
  articleTag:     string | null;
  dispatchStatus: string | null;
  assignedTo:     { id: number; name: string | null };
  lineItems: {
    assignedQty: number;
    rawLineItem: {
      skuCodeRaw:        string;
      skuDescriptionRaw: string | null;
      unitQty:           number;
      volumeLine:        number | null;
      isTinting:         boolean;
    };
  }[];
}

interface OrderDetail extends OrderListItem {
  sapStatus: string | null;
  materialType: string | null;
  totalUnitQty: number | null;
  obdEmailDate: string | null;
  statusLogs: StatusLog[];
  tintAssignments: TintAssignment[];
  splits?: SplitItem[];
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
    <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-md ${color}`}>
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const DISPATCH_OPTIONS = [
  { value: "hold",                     label: "Hold",     sel: "border-red-300 bg-red-50 text-red-700"     },
  { value: "dispatch",                 label: "Dispatch", sel: "border-green-300 bg-green-50 text-green-700" },
  { value: "waiting_for_confirmation", label: "Waiting",  sel: "border-amber-300 bg-amber-50 text-amber-700" },
];

const PRIORITY_OPTIONS = [
  { value: "3", label: "Normal", sel: "border-blue-300 bg-blue-50 text-blue-700" },
  { value: "2", label: "Urgent", sel: "border-red-300 bg-red-50 text-red-700"   },
];

const CHIP_LABELS = ["All", "Hold", "Dispatch", "Waiting", "Urgent", "Tint"] as const;

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
  const [chipFilter, setChipFilter] = useState("All");

  const [selectedOrder, setSelectedOrder] = useState<OrderDetailResponse | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const [missingSheetOpen, setMissingSheetOpen] = useState(false);
  const [missingSheetOrder, setMissingSheetOrder] = useState<OrderListItem | null>(null);

  const [editForm, setEditForm] = useState<EditForm>({
    dispatchStatus: "",
    priorityLevel:  "3",
    dispatchSlot:   "",
    note:           "",
  });

  // ── Derived stats (current page) ────────────────────────────────────────────
  const dispatchCount = orders.filter(o => o.dispatchStatus === "dispatch").length;
  const waitingCount  = orders.filter(o => o.dispatchStatus === "waiting_for_confirmation").length;
  const urgentCount   = orders.filter(o => o.priorityLevel <= 2).length;
  const pageWeight    = orders.reduce((s, o) => s + (o.querySnapshot?.totalWeight ?? 0), 0);

  // ── Fetch orders ─────────────────────────────────────────────────────────────
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

  useEffect(() => {
    const timer = setTimeout(fetchOrders, search ? 300 : 0);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, stageFilter, orderTypeFilter, dispatchStatusFilter, page]);

  useEffect(() => {
    if (!sheetOpen) return;
    fetch("/api/admin/slots")
      .then((r) => r.json())
      .then((data: SlotOption[]) => setSlots(data))
      .catch(() => setSlots([]));
  }, [sheetOpen]);

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

  async function handleSplitDispatchStatus(splitId: number, dispatchStatus: string) {
    try {
      await fetch(`/api/support/splits/${splitId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ dispatchStatus }),
      });
      void fetchOrders();
      // Refresh sheet detail to reflect updated split status
      if (selectedOrder) {
        const res  = await fetch(`/api/support/orders/${selectedOrder.order.id}`);
        const data = (await res.json()) as OrderDetailResponse;
        setSelectedOrder(data);
      }
    } catch (err) {
      console.error("Failed to update split dispatch status:", err);
    }
  }

  function handleChip(label: string) {
    setChipFilter(label);
    if (label === "All")      { setDispatchStatusFilter(""); setOrderTypeFilter(""); }
    else if (label === "Hold")     { setDispatchStatusFilter("hold"); setOrderTypeFilter(""); }
    else if (label === "Dispatch") { setDispatchStatusFilter("dispatch"); setOrderTypeFilter(""); }
    else if (label === "Waiting")  { setDispatchStatusFilter("waiting_for_confirmation"); setOrderTypeFilter(""); }
    else if (label === "Urgent")   { setDispatchStatusFilter(""); setOrderTypeFilter(""); }
    else if (label === "Tint")     { setOrderTypeFilter("tint"); setDispatchStatusFilter(""); }
    setPage(1);
  }

  function clearFilters() {
    setSearch("");
    setStageFilter("");
    setOrderTypeFilter("");
    setDispatchStatusFilter("");
    setChipFilter("All");
    setPage(1);
  }

  const LIMIT     = 25;
  const pageStart = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const pageEnd   = Math.min(page * LIMIT, total);

  const o = selectedOrder?.order;
  const customerName = o?.customer?.customerName ?? o?.shipToCustomerName ?? "—";
  const isTint       = o?.orderType === "tint";
  const dispStat     = o?.dispatchStatus as "hold" | "dispatch" | "waiting_for_confirmation" | null;
  const isUrgent     = (o?.priorityLevel ?? 3) <= 2;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f0f2f8]">

      {/* ── Page title ───────────────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-3 flex items-center gap-2">
        <h1 className="text-[17px] font-extrabold text-gray-900">Support Queue</h1>
        <span className="bg-[#f7f8fc] border border-[#e2e5f1] text-gray-400 text-[12px] font-semibold px-2 py-0.5 rounded-full">
          {total}
        </span>
      </div>

      {/* ── Filter chips row ─────────────────────────────────────────────── */}
      <div className="bg-white border-b border-[#e2e5f1] px-6 py-2.5 flex items-center gap-2 flex-wrap">
        <div className="flex gap-1.5">
          {CHIP_LABELS.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => handleChip(label)}
              className={cn(
                "text-[11.5px] font-medium px-2.5 py-1 rounded-md border transition-colors",
                chipFilter === label
                  ? "bg-[#1a237e] text-white border-[#1a237e]"
                  : "bg-white text-gray-500 border-[#e2e5f1] hover:border-[#c5cae9] hover:text-gray-800"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-[#e2e5f1] mx-1" />

        {/* Search */}
        <input
          type="text"
          placeholder="OBD number or customer…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="bg-white border border-[#e2e5f1] rounded-lg px-3 py-1.5 text-[12.5px] placeholder:text-gray-400 focus:border-[#1a237e] focus:outline-none font-sans w-[220px]"
        />

        {/* Stage select */}
        <Select value={stageFilter || "all"} onValueChange={(v) => { setStageFilter((v ?? "") === "all" ? "" : (v ?? "")); setPage(1); }}>
          <SelectTrigger className="h-8 w-44 bg-white border border-[#cdd1e8] rounded-lg text-[12px] text-gray-500 font-sans">
            <SelectValue placeholder="All Stages" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            <SelectItem value="order_created">Order Created</SelectItem>
            <SelectItem value="pending_tint_assignment">Pending Tint</SelectItem>
            <SelectItem value="tinting_in_progress">Tinting In Progress</SelectItem>
            <SelectItem value="tinting_done">Tinting Done</SelectItem>
            <SelectItem value="pending_support">Pending Support</SelectItem>
            <SelectItem value="dispatch_confirmation">Dispatch Confirmation</SelectItem>
            <SelectItem value="dispatched">Dispatched</SelectItem>
          </SelectContent>
        </Select>

        {/* Type select */}
        <Select value={orderTypeFilter || "all"} onValueChange={(v) => { setOrderTypeFilter((v ?? "") === "all" ? "" : (v ?? "")); setPage(1); }}>
          <SelectTrigger className="h-8 w-32 bg-white border border-[#cdd1e8] rounded-lg text-[12px] text-gray-500 font-sans">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="tint">Tint</SelectItem>
            <SelectItem value="non_tint">Non-Tint</SelectItem>
          </SelectContent>
        </Select>

        {/* Right side */}
        <div className="ml-auto flex items-center gap-2.5">
          <span className="text-[11.5px] text-gray-400">{total} results</span>
          <button
            type="button"
            onClick={clearFilters}
            className="text-[11.5px] font-medium text-gray-500 border border-[#e2e5f1] bg-white hover:bg-[#f5f7ff] px-3 py-1.5 rounded-lg transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* ── Stat bar ─────────────────────────────────────────────────────── */}
      <div className="px-6 py-3 flex gap-2.5 flex-wrap">
        <StatCard label="Total Orders"   value={total}          icon={<ClipboardList size={16} />} iconBg="bg-indigo-50" iconColor="text-indigo-600" valueColor="text-indigo-700" />
        <StatCard label="Hold"           value={onHoldCount}    icon={<AlertCircle   size={16} />} iconBg="bg-red-50"    iconColor="text-red-600"    valueColor="text-red-700"    />
        <StatCard label="Dispatch"       value={dispatchCount}  icon={<CheckCircle2  size={16} />} iconBg="bg-green-50"  iconColor="text-green-600"  valueColor="text-green-700"  />
        <StatCard label="Waiting"        value={waitingCount}   icon={<Clock         size={16} />} iconBg="bg-amber-50"  iconColor="text-amber-600"  valueColor="text-amber-700"  />
        <StatCard label="Urgent"         value={urgentCount}    icon={<Zap           size={16} />} iconBg="bg-red-50"    iconColor="text-red-600"    valueColor="text-red-700"    />
        <StatCard label="Weight (page)"  value={`${pageWeight.toFixed(0)} kg`} icon={<Scale size={16} />} iconBg="bg-gray-50" iconColor="text-gray-600" valueColor="text-gray-700" />
        {/* Secondary stats */}
        <StatCard label="Pending Support" value={pendingSupportCount} icon={<ClipboardList size={16} />} iconBg="bg-blue-50"   iconColor="text-blue-600"   valueColor="text-blue-700"   />
        <StatCard label="Pending Tint"    value={pendingTintCount}    icon={<Clock         size={16} />} iconBg="bg-violet-50" iconColor="text-violet-600" valueColor="text-violet-700" />
      </div>

      {/* ── Table section ────────────────────────────────────────────────── */}
      <div className="px-6 pb-6">
        <div className="bg-white border border-[#e2e5f1] rounded-xl overflow-hidden shadow-sm">
          <table className="w-full border-collapse">
              <thead className="bg-[#f7f8fc]">
                <tr>
                  {["OBD No.", "Customer", "Area", "Weight", "Slot", "Type", "Stage", "Dispatch Status", "Priority", "Action"].map((col) => (
                    <th key={col} className="text-[10.5px] font-bold uppercase tracking-[.5px] text-gray-400 py-2.5 px-4 text-left border-b border-[#e2e5f1] whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading && Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-[#e2e5f1]">
                    <td colSpan={10} className="px-4 py-3">
                      <div className="h-4 bg-gray-100 rounded animate-pulse" />
                    </td>
                  </tr>
                ))}
                {!isLoading && orders.length === 0 && (
                  <tr>
                    <td colSpan={10}>
                      <div className="flex flex-col items-center py-16 text-center">
                        <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                          <ClipboardList className="h-5 w-5 text-gray-400" />
                        </div>
                        <p className="text-[13px] font-semibold text-gray-500">No orders found</p>
                        <p className="text-[12px] text-gray-400 mt-1">Try adjusting your filters or search</p>
                      </div>
                    </td>
                  </tr>
                )}
                {!isLoading && orders.length > 0 && (<>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-[#e2e5f1] hover:bg-[#f5f7ff] cursor-pointer transition-colors last:border-0">
                    {/* OBD */}
                    <td className="py-3 px-4">
                      <ObdCode code={order.obdNumber} />
                    </td>
                    {/* Customer */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[12.5px] text-gray-900 max-w-[150px] truncate">
                        {order.customer?.customerName ?? order.shipToCustomerName ?? "—"}
                      </div>
                      {order.customerMissing && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setMissingSheetOrder(order); setMissingSheetOpen(true); }}
                          className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 px-1.5 py-0.5 rounded transition-colors"
                        >
                          ⚠ Customer Missing
                        </button>
                      )}
                    </td>
                    {/* Area */}
                    <td className="py-3 px-4 text-[12px] text-gray-500">
                      {order.customer?.area.name ?? "—"}
                    </td>
                    {/* Weight */}
                    <td className="py-3 px-4 font-mono text-[12px] text-gray-500">
                      {order.querySnapshot?.totalWeight != null
                        ? `${order.querySnapshot.totalWeight.toFixed(1)} kg`
                        : "—"}
                    </td>
                    {/* Slot */}
                    <td className="py-3 px-4">
                      <div className="text-[12px] text-gray-700">{order.dispatchSlot ?? "—"}</div>
                    </td>
                    {/* Type */}
                    <td className="py-3 px-4">
                      <StatusBadge variant={order.orderType === "tint" ? "tint" : "non-tint"} size="sm" />
                    </td>
                    {/* Stage */}
                    <td className="py-3 px-4">
                      <StageBadge stage={order.workflowStage} />
                    </td>
                    {/* Dispatch Status */}
                    <td className="py-3 px-4">
                      {order.dispatchStatus === "hold" && <StatusBadge variant="hold" size="sm" />}
                      {order.dispatchStatus === "dispatch" && <StatusBadge variant="dispatch" size="sm" />}
                      {order.dispatchStatus === "waiting_for_confirmation" && <StatusBadge variant="waiting" size="sm" />}
                      {!order.dispatchStatus && <span className="text-gray-300 text-[12px]">—</span>}
                    </td>
                    {/* Priority */}
                    <td className="py-3 px-4">
                      <StatusBadge variant={order.priorityLevel <= 2 ? "urgent" : "normal"} size="sm" />
                    </td>
                    {/* Action */}
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => openSheet(order.id)}
                        className="text-[11.5px] font-medium text-gray-500 border border-[#e2e5f1] bg-white hover:bg-[#f5f7ff] hover:text-[#1a237e] hover:border-[#c5cae9] px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Edit →
                      </button>
                    </td>
                  </tr>
                ))}
                </>)}
              </tbody>
            </table>

          {/* Table footer / pagination */}
          {!isLoading && total > 0 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-[#e2e5f1] bg-[#f7f8fc]">
              <span className="text-[11.5px] text-gray-400">
                Showing {pageStart}–{pageEnd} of {total} orders
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page <= 1}
                  className="h-7 px-3 text-[11.5px] font-medium border border-[#e2e5f1] rounded-lg bg-white text-gray-600 hover:bg-[#f5f7ff] disabled:opacity-40 transition-colors"
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages}
                  className="h-7 px-3 text-[11.5px] font-medium border border-[#e2e5f1] rounded-lg bg-white text-gray-600 hover:bg-[#f5f7ff] disabled:opacity-40 transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Customer Missing Sheet ───────────────────────────────────────── */}
      <CustomerMissingSheet
        open={missingSheetOpen}
        onOpenChange={setMissingSheetOpen}
        shipToCustomerId={missingSheetOrder?.shipToCustomerId}
        shipToCustomerName={missingSheetOrder?.shipToCustomerName}
        onResolved={() => { setMissingSheetOpen(false); void fetchOrders(); }}
      />

      {/* ── Edit Sheet ───────────────────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          showCloseButton={false}
          className="sm:w-[500px] sm:max-w-[500px] overflow-y-auto flex flex-col p-0 gap-0"
        >
          {/* Sheet header */}
          <div className="px-6 py-5 border-b border-[#e2e5f1] flex items-start gap-3 flex-shrink-0">
            <div className="flex-1 min-w-0">
              <h2 className="text-[15px] font-bold text-gray-900 truncate">{customerName}</h2>
              {o && (
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <ObdCode code={o.obdNumber} />
                  <StatusBadge variant={isTint ? "tint" : "non-tint"} size="sm" />
                  {dispStat === "hold"     && <StatusBadge variant="hold"     size="sm" />}
                  {dispStat === "dispatch" && <StatusBadge variant="dispatch" size="sm" />}
                  {dispStat === "waiting_for_confirmation" && <StatusBadge variant="waiting"  size="sm" />}
                  <StatusBadge variant={isUrgent ? "urgent" : "normal"} size="sm" />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-red-50 hover:text-red-500 flex items-center justify-center text-gray-400 text-[14px] transition-colors flex-shrink-0"
            >
              ✕
            </button>
          </div>

          {sheetLoading ? (
            <div className="flex flex-col gap-3 px-6 py-5 flex-1">
              {[128, 96, 192, 80].map((h, i) => (
                <div key={i} className="bg-gray-100 rounded-xl animate-pulse" style={{ height: `${h}px` }} />
              ))}
            </div>
          ) : selectedOrder ? (
            <div className="flex flex-col flex-1 overflow-y-auto">
              <div className="px-6 py-5 flex flex-col gap-5">

                {/* ── Order Details ──────────────────────────────────────── */}
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[.7px] text-gray-400 pb-2 mb-3 border-b border-[#e2e5f1]">
                    Order Details
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Order Type",    value: selectedOrder.order.orderType === "tint" ? "Tint" : "Non-Tint" },
                      { label: "Workflow Stage", value: STAGE_LABELS[selectedOrder.order.workflowStage] ?? selectedOrder.order.workflowStage },
                      { label: "Batch Ref",     value: selectedOrder.order.batch?.batchRef ?? "—" },
                      { label: "Invoice No",    value: selectedOrder.order.invoiceNo ?? "—" },
                      { label: "Created At",    value: formatDateTime(selectedOrder.order.createdAt) },
                      { label: "Total Weight",  value: selectedOrder.order.querySnapshot?.totalWeight != null ? `${selectedOrder.order.querySnapshot.totalWeight.toFixed(1)} kg` : "—" },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-[10.5px] font-semibold text-gray-400 mb-1">{label}</p>
                        <p className="text-[13px] font-medium text-gray-900">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Actions ──────────────────────────────────────────── */}
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[.7px] text-gray-400 pb-2 mb-3 border-b border-[#e2e5f1]">
                    Actions
                  </p>

                  {/* Dispatch Status toggle */}
                  <div className="mb-4">
                    <label className="text-[11.5px] font-semibold text-gray-600 block mb-2">Dispatch Status</label>
                    <div className="flex gap-2">
                      {DISPATCH_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setField("dispatchStatus", editForm.dispatchStatus === opt.value ? "" : opt.value)}
                          className={cn(
                            "flex-1 py-2 rounded-lg text-center text-[12px] font-semibold border transition-colors",
                            editForm.dispatchStatus === opt.value
                              ? opt.sel
                              : "border-[#cdd1e8] text-gray-400 hover:bg-gray-50"
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Priority toggle */}
                  <div className="mb-4">
                    <label className="text-[11.5px] font-semibold text-gray-600 block mb-2">Priority</label>
                    <div className="flex gap-2">
                      {PRIORITY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setField("priorityLevel", opt.value)}
                          className={cn(
                            "flex-1 py-2 rounded-lg text-center text-[12px] font-semibold border transition-colors",
                            editForm.priorityLevel === opt.value
                              ? opt.sel
                              : "border-[#cdd1e8] text-gray-400 hover:bg-gray-50"
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Slot Override */}
                  <div className="mb-4">
                    <label className="text-[11.5px] font-semibold text-gray-600 block mb-2">Slot Override</label>
                    <Select
                      value={editForm.dispatchSlot || "none"}
                      onValueChange={(v) => setField("dispatchSlot", (v ?? "") === "none" ? "" : (v ?? ""))}
                    >
                      <SelectTrigger className="w-full border-[1.5px] border-[#cdd1e8] rounded-lg h-9 text-[12.5px]">
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
                  <div className="mb-4">
                    <label className="text-[11.5px] font-semibold text-gray-600 block mb-2">Support Note</label>
                    <textarea
                      value={editForm.note}
                      onChange={(e) => setField("note", e.target.value)}
                      placeholder="Add a note…"
                      rows={3}
                      className="w-full border-[1.5px] border-[#cdd1e8] rounded-lg px-3 py-2 text-[12.5px] text-gray-800 placeholder:text-gray-400 focus:border-[#1a237e] focus:ring-2 focus:ring-[#1a237e]/10 outline-none transition resize-none font-sans"
                    />
                  </div>

                  {sheetError && (
                    <div className="flex items-center gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-[12.5px] mb-3">
                      <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                      <span className="text-red-700 font-medium">{sheetError}</span>
                      <button className="ml-auto text-[12px] text-red-600 underline" onClick={handleSave}>Retry</button>
                    </div>
                  )}
                </div>

                {/* ── Tint Splits ──────────────────────────────────────── */}
                {selectedOrder.order.splits && selectedOrder.order.splits.length > 0 && (
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-[.6px] text-gray-400 border-b border-[#e2e5f1] pb-2 mb-3">
                      Tint Splits ({selectedOrder.order.splits.length})
                    </p>

                    {/* OBD progress summary */}
                    <div className="flex items-center gap-3 mb-3 bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg px-3 py-2 text-[11.5px]">
                      <span className="text-gray-500">
                        {selectedOrder.order.splits.filter((s) =>
                          ["tinting_done", "pending_support", "dispatch_confirmation", "dispatched"]
                            .includes(s.status)
                        ).length} of {selectedOrder.order.splits.length} splits done
                      </span>
                      <span className="text-gray-300">·</span>
                      <span className="text-gray-500">
                        {selectedOrder.order.splits.reduce((sum, s) => sum + s.totalQty, 0)} qty assigned
                      </span>
                    </div>

                    {/* Each split card */}
                    {selectedOrder.order.splits.map((split) => (
                      <div key={split.id} className="mb-3 rounded-xl border border-[#e2e5f1] overflow-hidden">

                        {/* Split header */}
                        <div className="flex items-center justify-between px-3 py-2 bg-[#f7f8fc] border-b border-[#e2e5f1]">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-gray-700">
                              Split {split.splitNumber}
                            </span>
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                              split.status === "tinting_done" || split.status === "pending_support"
                                ? "bg-green-50 text-green-700 border-green-200"
                                : split.status === "tinting_in_progress"
                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                : "bg-amber-50 text-amber-700 border-amber-200"
                            )}>
                              {split.status.replace(/_/g, " ")}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-gray-400">
                            <span>{split.assignedTo.name}</span>
                            <span>·</span>
                            <span>{split.articleTag ?? `${split.totalQty} units`}</span>
                          </div>
                        </div>

                        {/* Split dispatch actions — only for done/support splits */}
                        {["tinting_done", "pending_support", "dispatch_confirmation"].includes(split.status) && (
                          <div className="px-3 py-2.5 flex items-center gap-2">
                            <div className="flex gap-1.5 flex-1">
                              {(["dispatch", "hold", "waiting_for_confirmation"] as const).map((ds) => (
                                <button
                                  key={ds}
                                  type="button"
                                  onClick={() => void handleSplitDispatchStatus(split.id, ds)}
                                  className={cn(
                                    "flex-1 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors",
                                    split.dispatchStatus === ds
                                      ? ds === "hold"
                                        ? "bg-red-50 border-red-300 text-red-700"
                                        : ds === "dispatch"
                                        ? "bg-green-50 border-green-300 text-green-700"
                                        : "bg-amber-50 border-amber-300 text-amber-700"
                                      : "bg-white border-[#cdd1e8] text-gray-400 hover:bg-[#f7f8fc]"
                                  )}
                                >
                                  {ds === "waiting_for_confirmation" ? "Waiting"
                                    : ds.charAt(0).toUpperCase() + ds.slice(1)}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Split line items */}
                        <div className="px-3 pb-2.5">
                          {split.lineItems.map((item, idx) => (
                            <div
                              key={idx}
                              className={cn(
                                "flex items-center gap-2 py-1 text-[11px]",
                                idx < split.lineItems.length - 1 ? "border-b border-[#f0f1f8]" : ""
                              )}
                            >
                              <span className="font-mono text-violet-700 flex-shrink-0">
                                {item.rawLineItem.skuCodeRaw}
                              </span>
                              <span className="text-gray-500 flex-1 truncate">
                                {item.rawLineItem.skuDescriptionRaw}
                              </span>
                              <span className="text-gray-700 font-semibold flex-shrink-0">
                                {item.assignedQty} units
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Line Items ───────────────────────────────────────── */}
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[.7px] text-gray-400 pb-2 mb-3 border-b border-[#e2e5f1]">
                    Line Items
                  </p>
                  {selectedOrder.lineItems.length === 0 ? (
                    <p className="text-[12px] text-gray-400 py-2 text-center">No line items found.</p>
                  ) : (
                    <div className="rounded-lg border border-[#e2e5f1] overflow-hidden">
                      <table className="w-full border-collapse text-[12px]">
                        <thead className="bg-[#f7f8fc]">
                          <tr>
                            {["SKU Code", "Name", "Qty", "Weight", "Tint"].map((col) => (
                              <th key={col} className="text-[10px] font-bold uppercase tracking-wide text-gray-400 py-2 px-3 text-left border-b border-[#e2e5f1]">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {selectedOrder.lineItems.map((line) => (
                            <tr
                              key={line.id}
                              className={cn(
                                "border-b border-[#e2e5f1] last:border-0",
                                line.isTinting && "bg-violet-50/50"
                              )}
                            >
                              <td className="py-2 px-3 font-mono text-[11px] text-[#1a237e]">{line.sku.skuCode}</td>
                              <td className="py-2 px-3 text-gray-600 max-w-[120px] truncate">{line.sku.skuName}</td>
                              <td className="py-2 px-3 text-gray-700">{line.unitQty}</td>
                              <td className="py-2 px-3 text-gray-600">{line.lineWeight > 0 ? `${line.lineWeight.toFixed(1)} kg` : "—"}</td>
                              <td className="py-2 px-3">
                                {line.isTinting
                                  ? <StatusBadge variant="tint" size="sm" />
                                  : <span className="text-gray-300">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* ── Status History ───────────────────────────────────── */}
                <div>
                  <button
                    type="button"
                    onClick={() => setHistoryExpanded((v) => !v)}
                    className="flex items-center justify-between w-full text-[11.5px] font-semibold text-gray-500 hover:text-gray-700 mb-2"
                  >
                    <span className="text-[10px] font-extrabold uppercase tracking-[.7px] text-gray-400">Status History</span>
                    {historyExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {historyExpanded && (
                    <div className="flex flex-col gap-2">
                      {selectedOrder.order.statusLogs.length === 0 ? (
                        <p className="text-[12px] text-gray-400">No history yet.</p>
                      ) : (
                        selectedOrder.order.statusLogs.map((log) => (
                          <div key={log.id} className="flex gap-2.5 items-start p-2.5 bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg">
                            <div className="w-2 h-2 rounded-full bg-[#1a237e] mt-1 flex-shrink-0" />
                            <div>
                              <p className="text-[11.5px] font-semibold text-gray-800">
                                {log.fromStage ? `${STAGE_LABELS[log.fromStage] ?? log.fromStage} → ` : ""}{STAGE_LABELS[log.toStage] ?? log.toStage}
                              </p>
                              <p className="text-[10.5px] text-gray-400 mt-0.5">
                                {formatDateTime(log.createdAt)} · {log.changedBy?.name ?? "System"}
                              </p>
                              {log.note && (
                                <p className="text-[11px] text-gray-500 mt-0.5 italic">{log.note}</p>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

              </div>

              {/* Sheet footer */}
              <div className="px-6 py-4 border-t border-[#e2e5f1] flex gap-2.5 bg-white mt-auto flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  className="flex-1 border border-[#cdd1e8] rounded-lg py-2.5 text-[12.5px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex-[2] bg-[#1a237e] hover:bg-[#283593] text-white rounded-lg py-2.5 text-[12.5px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                >
                  {isSaving && <Loader2 className="animate-spin" size={14} />}
                  Save Changes
                </button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
