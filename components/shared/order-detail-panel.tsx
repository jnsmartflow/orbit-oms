"use client";

import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CascadeBadge, shouldShowCascadeBadge } from "@/components/shared/cascade-badge";

// ── Types ────────────────────────────────────────────────────────────────────

interface OrderDetail {
  order: {
    id: number;
    obdNumber: string;
    workflowStage: string;
    dispatchStatus: string | null;
    slotId: number | null;
    slot: { name: string } | null;
    originalSlotId: number | null;
    originalSlot: { name: string } | null;
    priorityLevel: number;
    createdAt: string;
    smu: string | null;
    customer: {
      customerName: string;
      area: {
        name: string;
        primaryRoute: { name: string } | null;
        deliveryType: { name: string } | null;
      } | null;
    } | null;
  };
  importSummary: {
    billToCustomerId: string | null;
    billToCustomerName: string | null;
    shipToCustomerId: string | null;
    shipToCustomerName: string | null;
    obdEmailDate: string | null;
    obdEmailTime: string | null;
    soNumber: string | null;
    invoiceNo: string | null;
    invoiceDate: string | null;
    materialType: string | null;
    totalUnitQty: number | null;
    grossWeight: number | null;
    volume: number | null;
  } | null;
  lineItems: {
    skuCode: string;
    skuDescription: string;
    unitQty: number;
    lineWeight: number | null;
    volumeLine: number | null;
    isTinting: boolean;
  }[];
  splits: {
    id: number;
    status: string;
    dispatchStatus: string | null;
  }[];
  querySnapshot: {
    hasTinting: boolean;
    totalUnitQty: number;
    articleTag: string | null;
  } | null;
}

interface OrderDetailPanelProps {
  orderId: number | null;
  onClose: () => void;
  isHistoryView?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(dateStr: string | null, timeStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const day = d.getUTCDate();
  const mon = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
  if (timeStr) return `${day} ${mon} · ${timeStr}`;
  return `${day} ${mon}`;
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const day = d.getUTCDate();
  const mon = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
  return `${day} ${mon}`;
}

function priLabel(level: number): string {
  if (level <= 1) return "P1";
  if (level === 2) return "P2";
  if (level === 4) return "P3";
  return "FIFO";
}

const SEC_HDR = "text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2";
const SEC_DIV = "border-t border-gray-100 my-4";

// ── Component ────────────────────────────────────────────────────────────────

export function OrderDetailPanel({ orderId, onClose }: OrderDetailPanelProps) {
  const [data, setData] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandLines, setExpandLines] = useState(false);
  const [expandSplits, setExpandSplits] = useState(false);

  useEffect(() => {
    if (!orderId) {
      setData(null);
      return;
    }
    setLoading(true);
    setExpandLines(false);
    setExpandSplits(false);
    fetch(`/api/orders/${orderId}/detail`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d as OrderDetail | null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (!orderId) return null;

  const o = data?.order;
  const imp = data?.importSummary;
  const qs = data?.querySnapshot;
  const lines = data?.lineItems ?? [];
  const splits = data?.splits ?? [];

  const customerName = o?.customer?.customerName ?? "—";
  const deliveryType = o?.customer?.area?.deliveryType?.name ?? null;
  const routeName = o?.customer?.area?.primaryRoute?.name ?? null;
  const areaName = o?.customer?.area?.name ?? null;
  const headerLine3Parts = [deliveryType, routeName, areaName].filter(Boolean);
  const headerLine4Parts = [o?.smu, imp?.materialType].filter(Boolean);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-30" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-[600px] bg-white z-40 shadow-xl flex flex-col">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="px-5 py-4 border-b border-gray-200 flex-shrink-0">
          {loading ? (
            <Skeleton h="h-6 w-40" />
          ) : (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono font-bold text-base text-gray-900">
                  {o?.obdNumber ?? "—"}
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  className="text-gray-400 hover:text-gray-700 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-gray-600">
                  {customerName}
                  {imp?.shipToCustomerId && (
                    <span className="text-gray-400"> · SH-{imp.shipToCustomerId}</span>
                  )}
                </p>
                {headerLine3Parts.length > 0 && (
                  <p className="text-xs text-gray-500">{headerLine3Parts.join(" · ")}</p>
                )}
                {headerLine4Parts.length > 0 && (
                  <p className="text-xs text-gray-400">{headerLine4Parts.join(" · ")}</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <SkeletonBody />
          ) : !data ? (
            <p className="text-sm text-gray-400 text-center py-10">Failed to load order details</p>
          ) : (
            <>
              {/* ── Section 1: Reference ─────────────────────────────── */}
              <h3 className={SEC_HDR}>Reference</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-xs mb-1">
                <RefCell label="BILL TO" id={imp?.billToCustomerId} name={imp?.billToCustomerName} />
                <RefCell label="SHIP TO" id={imp?.shipToCustomerId} name={imp?.shipToCustomerName} />
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">OBD Date</p>
                  <p className="text-gray-800 font-mono">{fmtDateTime(imp?.obdEmailDate ?? null, imp?.obdEmailTime ?? null)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">SO No</p>
                  <p className="text-gray-800 font-mono">{imp?.soNumber ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">Inv Date</p>
                  <p className="text-gray-800 font-mono">{fmtDate(imp?.invoiceDate ?? null)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">Inv No</p>
                  <p className="text-gray-800 font-mono">{imp?.invoiceNo ?? "—"}</p>
                </div>
              </div>

              {/* ── Section 2: Quantities ────────────────────────────── */}
              <div className={SEC_DIV} />
              <h3 className={SEC_HDR}>Quantities</h3>
              <div className="grid grid-cols-3 gap-3">
                <StatBox value={imp?.totalUnitQty ?? qs?.totalUnitQty ?? "—"} label="units" />
                <StatBox value={imp?.grossWeight != null ? `${imp.grossWeight.toFixed(1)}` : "—"} label="kg" />
                <StatBox value={imp?.volume != null ? Math.round(imp.volume) : "—"} label="L" />
              </div>

              {/* ── Section 3: Line Items ────────────────────────────── */}
              <div className={SEC_DIV} />
              <div className="flex items-center gap-2 mb-2">
                <h3 className={cn(SEC_HDR, "mb-0")}>Line Items</h3>
                <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{lines.length}</span>
              </div>
              {lines.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No line items found</p>
              ) : (
                <>
                  <div className="rounded border border-gray-100 overflow-hidden text-xs">
                    {/* Header */}
                    <div className="grid grid-cols-[1fr_2fr_50px_60px_28px] gap-2 px-3 py-1.5 bg-gray-50 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                      <span>SKU</span><span>Description</span><span className="text-right">Qty</span><span className="text-right">Vol (L)</span><span className="text-center">🎨</span>
                    </div>
                    {/* Rows */}
                    {(expandLines ? lines : lines.slice(0, 3)).map((li, i) => (
                      <div
                        key={i}
                        className={cn(
                          "grid grid-cols-[1fr_2fr_50px_60px_28px] gap-2 px-3 py-1.5",
                          i % 2 === 1 ? "bg-gray-50" : "bg-white",
                        )}
                      >
                        <span className="font-mono text-gray-700 truncate">{li.skuCode}</span>
                        <span className="text-gray-600 truncate">{li.skuDescription}</span>
                        <span className="text-right text-gray-700 tabular-nums">{li.unitQty}</span>
                        <span className="text-right text-gray-500 tabular-nums">{li.volumeLine != null ? Math.round(li.volumeLine) : "—"}</span>
                        <span className="text-center">{li.isTinting ? <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" /> : <span className="text-gray-300">—</span>}</span>
                      </div>
                    ))}
                  </div>
                  {lines.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setExpandLines(!expandLines)}
                      className="text-xs text-indigo-500 hover:text-indigo-700 mt-1.5 transition-colors"
                    >
                      {expandLines
                        ? "Show less \u25B4"
                        : `\uFF0B ${lines.length - 3} more items — Show all \u25BE`}
                    </button>
                  )}
                </>
              )}

              {/* ── Section 4: Splits ────────────────────────────────── */}
              {splits.length > 0 && (
                <>
                  <div className={SEC_DIV} />
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className={cn(SEC_HDR, "mb-0")}>Splits</h3>
                    <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{splits.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {(expandSplits ? splits : splits.slice(0, 3)).map((sp, i) => (
                      <div key={sp.id} className="flex items-center gap-2 text-xs">
                        <span className="text-gray-700 font-medium">Split {i + 1}</span>
                        <span className="px-2 py-0.5 rounded border border-gray-200 text-gray-500 text-[10px]">{sp.status}</span>
                        {sp.dispatchStatus && (
                          <span className="px-2 py-0.5 rounded border border-gray-200 text-gray-500 text-[10px]">{sp.dispatchStatus}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  {splits.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setExpandSplits(!expandSplits)}
                      className="text-xs text-indigo-500 hover:text-indigo-700 mt-1.5 transition-colors"
                    >
                      {expandSplits
                        ? "Show less \u25B4"
                        : `\uFF0B ${splits.length - 3} more — Show all \u25BE`}
                    </button>
                  )}
                </>
              )}

              {/* ── Section 5: Workflow State ────────────────────────── */}
              <div className={SEC_DIV} />
              <h3 className={SEC_HDR}>Workflow State</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-xs">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">Workflow</p>
                  <p className="text-gray-800">{o?.workflowStage ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">Priority</p>
                  <p className="text-gray-800">{priLabel(o?.priorityLevel ?? 3)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">Dispatch</p>
                  <p className="text-gray-800">{o?.dispatchStatus ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">Tinting</p>
                  <p className="text-gray-800">{qs?.hasTinting ? "Yes" : "No"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">Slot</p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-800">{o?.slot?.name ?? "—"}</span>
                    {o && shouldShowCascadeBadge(o.slotId, o.originalSlotId) && o.originalSlot && (
                      <CascadeBadge originalSlotName={o.originalSlot.name} />
                    )}
                  </div>
                </div>
              </div>

              {/* ── Section 6: Audit History ─────────────────────────── */}
              <div className={SEC_DIV} />
              <h3 className={SEC_HDR}>Audit History</h3>
              <p className="text-xs text-gray-400 italic">Coming soon</p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function RefCell({ label, id, name }: { label: string; id: string | null | undefined; name: string | null | undefined }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">{label}</p>
      <p className="text-gray-800 font-medium">{id ?? "—"}</p>
      <p className="text-gray-500 text-[11px]">{name ?? "—"}</p>
    </div>
  );
}

function StatBox({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-center">
      <p className="text-sm font-bold text-gray-800 tabular-nums">{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}

function Skeleton({ h }: { h: string }) {
  return <div className={cn("animate-pulse bg-gray-200 rounded", h)} />;
}

function SkeletonBody() {
  return (
    <div className="space-y-4">
      <Skeleton h="h-4 w-24" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton h="h-12" />
        <Skeleton h="h-12" />
      </div>
      <Skeleton h="h-4 w-20" />
      <div className="grid grid-cols-3 gap-3">
        <Skeleton h="h-14" />
        <Skeleton h="h-14" />
        <Skeleton h="h-14" />
      </div>
      <Skeleton h="h-4 w-24" />
      <Skeleton h="h-20" />
      <Skeleton h="h-4 w-20" />
      <Skeleton h="h-16" />
    </div>
  );
}
