"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Scissors, MoreHorizontal, UserPlus, ChevronUp, ChevronDown, RefreshCw, X, AlertCircle } from "lucide-react";
import type { TintOrder, SplitCard, CompletedAssignment } from "@/components/tint/tint-manager-content";

export interface TintTableViewProps {
  filteredOrders:          TintOrder[];
  filteredActiveSplits:    SplitCard[];
  filteredCompletedSplits: SplitCard[];
  completedAssignments:    CompletedAssignment[];
  onOrderClick:            (order: TintOrder) => void;
  onSplitClick:            (split: SplitCard) => void;
  onStatusPopover:         (id: number, type: "order" | "split", buttonEl: HTMLButtonElement) => void;
  onAssign:                (order: TintOrder) => void;
  onCreateSplit:           (order: TintOrder) => void;
  onMoveUp:                (id: number, type: "order" | "split") => void;
  onMoveDown:              (id: number, type: "order" | "split") => void;
  onCancelAssignment:      (order: TintOrder) => void;
  onReassignSplit:         (split: SplitCard) => void;
  onCancelSplit:           (split: SplitCard) => void;
  onCustomerMissing?:      (order: TintOrder) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatObdDate(date: string | null, time: string | null): string {
  if (!date) return "";
  const d = new Date(date);
  const dateStr = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return time ? `${dateStr} · ${time.slice(0, 5)}` : dateStr;
}

function formatOrderDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "Asia/Kolkata"
  });
  const timeStr = d.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata"
  });
  return `${dateStr} · ${timeStr}`;
}

function buildTs(date: string | null, time: string | null): number {
  const dateStr = date ?? "1970-01-01";
  const parts = (time ?? "00:00").split(":");
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  const ts = new Date(dateStr);
  ts.setHours(h, m, 0, 0);
  return ts.getTime();
}

function seqPriDateSort(
  aSeq: number | null | undefined,
  aPri: number | null | undefined,
  aIso: string | null,
  aDate: string | null,
  aTime: string | null,
  bSeq: number | null | undefined,
  bPri: number | null | undefined,
  bIso: string | null,
  bDate: string | null,
  bTime: string | null,
): number {
  const seqDiff = (aSeq ?? 0) - (bSeq ?? 0);
  if (seqDiff !== 0) return seqDiff;
  const priDiff = (aPri ?? 5) - (bPri ?? 5);
  if (priDiff !== 0) return priDiff;
  const tsA = aIso ? new Date(aIso).getTime() : buildTs(aDate, aTime);
  const tsB = bIso ? new Date(bIso).getTime() : buildTs(bDate, bTime);
  return tsA - tsB;
}

function getAgeBadge(orderDateTime: string | null, obdEmailDate: string | null): { text: string; className: string } | null {
  const dateStr = orderDateTime ?? obdEmailDate;
  if (!dateStr) return null;
  const orderDate = new Date(dateStr);
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const istOrder = new Date(orderDate.getTime() + istOffset);
  const nowDay = new Date(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());
  const orderDay = new Date(istOrder.getUTCFullYear(), istOrder.getUTCMonth(), istOrder.getUTCDate());
  const diffDays = Math.floor((nowDay.getTime() - orderDay.getTime()) / 86400000);
  if (diffDays <= 0) return null;
  if (diffDays === 1) return { text: "1d", className: "bg-amber-50 text-amber-700 border-amber-200" };
  return { text: `${diffDays}d`, className: "bg-red-50 text-red-700 border-red-200" };
}

function deliveryDotCls(type: string | null | undefined): string {
  if (type === "Local")       return "bg-blue-600";
  if (type === "Upcountry")   return "bg-orange-600";
  if (type === "IGT")         return "bg-teal-600";
  if (type === "Cross Depot") return "bg-rose-600";
  return "bg-gray-300";
}

// ── §40 table constants ──────────────────────────────────────────────────────

const thCls = "text-[10px] font-medium text-gray-400 uppercase tracking-[0.05em] text-left whitespace-nowrap overflow-hidden text-ellipsis align-middle";
const thStyle: React.CSSProperties = { padding: "9px 14px" };
const tdCls = "whitespace-nowrap overflow-hidden text-ellipsis align-middle";
const tdStyle: React.CSSProperties = { padding: "10px 14px" };
const tdObdCls = "overflow-hidden align-top";
const tdObdStyle: React.CSSProperties = { padding: "10px 14px", whiteSpace: "normal" };

function Colgroup() {
  return (
    <colgroup>
      <col style={{ width: "4%" }} />
      <col style={{ width: "13%" }} />
      <col style={{ width: "10%" }} />
      <col style={{ width: "18%" }} />
      <col style={{ width: "7%" }} />
      <col style={{ width: "9%" }} />
      <col style={{ width: "6%" }} />
      <col style={{ width: "15%" }} />
      <col style={{ width: "10%" }} />
      <col style={{ width: "8%" }} />
    </colgroup>
  );
}

const NUM_COLS = 10;

function SerialTd({ n }: { n: number }) {
  return <td className={tdCls} style={{ ...tdStyle, textAlign: "center" }}><span className="text-[11px] font-mono text-gray-400">{n}</span></td>;
}

// ── Cell components ──────────────────────────────────────────────────────────

function SmuBadge({ smu }: { smu: string | null | undefined }) {
  if (!smu) return <span className="text-gray-400">—</span>;
  return <span className="text-[11px] font-medium text-gray-600">{smu}</span>;
}

function PriorityBadge({ level }: { level: number | null | undefined }) {
  if ((level ?? 5) <= 2) {
    return (
      <span className="inline-flex items-center gap-[3px] text-[10.5px] font-semibold bg-red-50 text-red-700 border border-red-200 px-[7px] py-[2px] rounded-[5px]">
        🚨 Urgent
      </span>
    );
  }
  return (
    <span className="inline-flex text-[10.5px] font-semibold bg-gray-50 text-gray-400 border border-gray-200 px-[7px] py-[2px] rounded-[5px]">
      Normal
    </span>
  );
}

function PlusBtn({ id, type, onStatusPopover }: {
  id: number;
  type: "order" | "split";
  onStatusPopover: (id: number, type: "order" | "split", btn: HTMLButtonElement) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onStatusPopover(id, type, e.currentTarget); }}
      className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
    >
      <Plus size={13} />
    </button>
  );
}

// ── Section header ───────────────────────────────────────────────────────────

const SCHEME_MAP = {
  teal:  { bg: "bg-white", border: "border-b border-gray-200", labelColor: "text-gray-900", dot: "bg-teal-500",  pill: "bg-gray-100 text-gray-700 border border-gray-200" },
  amber: { bg: "bg-white", border: "border-b border-gray-200", labelColor: "text-gray-900", dot: "bg-amber-400", pill: "bg-gray-100 text-gray-700 border border-gray-200" },
  blue:  { bg: "bg-white", border: "border-b border-gray-200", labelColor: "text-gray-900", dot: "bg-blue-400",  pill: "bg-gray-100 text-gray-700 border border-gray-200" },
  green: { bg: "bg-white", border: "border-b border-gray-200", labelColor: "text-gray-900", dot: "bg-green-400", pill: "bg-gray-100 text-gray-700 border border-gray-200" },
} as const;

function SectionHeader({ dotClass, label, count, volume, colorScheme }: {
  dotClass:    string;
  label:       string;
  count:       number;
  volume:      number;
  colorScheme: "teal" | "amber" | "blue" | "green";
}) {
  const s = SCHEME_MAP[colorScheme];
  const volStr = volume > 0 ? `${Math.round(volume).toLocaleString()} L` : "—";
  return (
    <div className={`flex items-center gap-2.5 px-4 py-[10px] rounded-t-lg ${s.bg} ${s.border}`}>
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
      <span className={`text-[12px] font-bold ${s.labelColor}`}>{label}</span>
      <span className={`text-[11px] font-bold px-[9px] py-[1px] rounded-full ${s.pill}`}>{count}</span>
      <div className="flex-1" />
      <span className="text-[13px] text-gray-700 font-semibold">{volStr}</span>
    </div>
  );
}

// ── Row actions menu ─────────────────────────────────────────────────────────

interface RowAction {
  label:   string;
  icon:    React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

function RowActionsMenu({ actions }: { actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpen((v) => !v);
  }

  if (actions.length === 0) return null;

  const dropdown = open && pos ? createPortal(
    <div
      ref={menuRef}
      style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 9999 }}
      className="bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[168px]"
    >
      {actions.map((action, i) => (
        <button
          key={i}
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(false); action.onClick(); }}
          className={`w-full flex items-center gap-2 px-3.5 py-[7px] text-[12px] text-left transition-colors cursor-pointer ${
            action.danger
              ? "text-red-600 hover:bg-red-50"
              : "text-gray-700 hover:bg-gray-50"
          }`}
        >
          <span className="flex-shrink-0">{action.icon}</span>
          {action.label}
        </button>
      ))}
    </div>,
    document.body
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <MoreHorizontal size={13} />
      </button>
      {dropdown}
    </>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function TintTableView({
  filteredOrders,
  filteredActiveSplits,
  filteredCompletedSplits,
  completedAssignments,
  onOrderClick,
  onSplitClick,
  onStatusPopover,
  onAssign,
  onCreateSplit,
  onMoveUp,
  onMoveDown,
  onCancelAssignment,
  onReassignSplit,
  onCancelSplit,
  onCustomerMissing,
}: TintTableViewProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  function elapsed(startedAt: string | null): { text: string; isLong: boolean } {
    if (!startedAt) return { text: "—", isLong: false };
    const ms = now.getTime() - new Date(startedAt).getTime();
    const h  = Math.floor(ms / 3_600_000);
    const m  = Math.floor((ms % 3_600_000) / 60_000);
    return { text: `${h}h ${m}m`, isLong: h >= 2 };
  }

  function ElapsedBadge({ startedAt }: { startedAt: string | null }) {
    const el = elapsed(startedAt);
    if (el.text === "—") return <span className="text-gray-400">—</span>;
    return (
      <span className={el.isLong
        ? "font-mono text-[11.5px] font-medium text-red-700 bg-red-50 border border-red-200 px-[7px] py-[2px] rounded-[5px]"
        : "font-mono text-[11.5px] font-medium text-blue-700 bg-blue-50 border border-blue-200 px-[7px] py-[2px] rounded-[5px]"
      }>
        {el.text}
      </span>
    );
  }

  // ── Section 1: Pending ────────────────────────────────────────────────────

  const pendingRows = filteredOrders
    .filter((o) =>
      o.workflowStage === "pending_tint_assignment" ||
      ((o.workflowStage === "tint_assigned" || o.workflowStage === "tinting_in_progress") &&
       (o.remainingQty ?? 0) > 0)
    )
    .sort((a, b) => {
      const tsA = a.orderDateTime ? new Date(a.orderDateTime).getTime() : buildTs(a.obdEmailDate, a.obdEmailTime);
      const tsB = b.orderDateTime ? new Date(b.orderDateTime).getTime() : buildTs(b.obdEmailDate, b.obdEmailTime);
      return tsA - tsB;
    });

  // ── Section 2: Assigned ───────────────────────────────────────────────────

  const assignedOrderRows = filteredOrders
    .filter((o) => o.workflowStage === "tint_assigned" && (o.remainingQty ?? 0) === 0)
    .sort((a, b) => seqPriDateSort(a.sequenceOrder, a.priorityLevel, a.orderDateTime, a.obdEmailDate, a.obdEmailTime, b.sequenceOrder, b.priorityLevel, b.orderDateTime, b.obdEmailDate, b.obdEmailTime));

  const assignedSplitRows = filteredActiveSplits
    .filter((s) => s.status === "tint_assigned")
    .sort((a, b) => seqPriDateSort(a.sequenceOrder, a.priorityLevel, a.orderDateTime, a.obdEmailDate, a.obdEmailTime, b.sequenceOrder, b.priorityLevel, b.orderDateTime, b.obdEmailDate, b.obdEmailTime));

  // ── Section 3: In Progress ────────────────────────────────────────────────

  const inProgressOrderRows = filteredOrders.filter(
    (o) => o.workflowStage === "tinting_in_progress" && (o.remainingQty ?? 0) === 0
  );
  const inProgressSplitRows = filteredActiveSplits.filter((s) => s.status === "tinting_in_progress");

  // ── Section 4: Completed Today ────────────────────────────────────────────

  const completedSplitRows = filteredCompletedSplits;
  const completedSplitOrderIds = new Set(completedSplitRows.map((s) => s.order.id));
  const completedAssignmentRows = completedAssignments.filter((a) => !completedSplitOrderIds.has(a.order.id));

  function assignmentAsOrder(a: CompletedAssignment): TintOrder {
    return {
      id: a.order.id, obdNumber: a.order.obdNumber, workflowStage: "pending_support",
      dispatchSlot: null, dispatchStatus: null, priorityLevel: 5, sequenceOrder: null,
      createdAt: a.completedAt ?? "", shipToCustomerName: a.order.shipToCustomerName,
      shipToCustomerId: null, customerMissing: false, smu: a.smu,
      obdEmailDate: a.obdEmailDate, obdEmailTime: a.obdEmailTime, orderDateTime: a.orderDateTime,
      slotId: a.slotId, slotName: a.slotName, slotTime: a.slotTime,
      slotIsNextDay: a.slotIsNextDay, originalSlotId: a.originalSlotId,
      originalSlotName: a.originalSlotName, deliveryTypeName: a.deliveryTypeName,
      customer: a.order.customer ?? null, querySnapshot: a.order.querySnapshot ?? null,
      tintAssignments: [{ id: a.id, status: "tinting_done", assignedTo: a.assignedTo, startedAt: null, completedAt: a.completedAt, updatedAt: a.completedAt ?? "" }],
      lineItems: [] as TintOrder["lineItems"], existingSplits: [], splits: [], remainingQty: 0,
    };
  }

  // ── Section volumes ───────────────────────────────────────────────────────

  const pendingSectionVolume    = pendingRows.reduce((s, o) => s + (o.querySnapshot?.totalVolume ?? 0), 0);
  const assignedSectionVolume   =
    assignedOrderRows.reduce((s, o) => s + (o.querySnapshot?.totalVolume ?? 0), 0) +
    assignedSplitRows.reduce((s, sp) => s + (sp.totalVolume ?? 0), 0);
  const inProgressSectionVolume =
    inProgressOrderRows.reduce((s, o) => s + (o.querySnapshot?.totalVolume ?? 0), 0) +
    inProgressSplitRows.reduce((s, sp) => s + (sp.totalVolume ?? 0), 0);
  const completedSectionVolume  =
    completedSplitRows.reduce((s, sp) => s + (sp.totalVolume ?? 0), 0) +
    completedAssignmentRows.reduce((s, a) => s + (a.order.querySnapshot?.totalVolume ?? 0), 0);

  // ── Shared cell renderers ──────────────────────────────────────────────────

  function OrderObdTd({ order }: { order: TintOrder }) {
    const dateStr = formatOrderDate(order.orderDateTime) || formatObdDate(order.obdEmailDate, order.obdEmailTime) || formatTime(order.createdAt);
    const ageBadge = getAgeBadge(order.orderDateTime, order.obdEmailDate);
    return (
      <td className={tdObdCls} style={tdObdStyle}>
        <div className="flex items-center gap-1.5">
          {order.deliveryTypeName && (
            <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${deliveryDotCls(order.deliveryTypeName)}`} title={order.deliveryTypeName} />
          )}
          <span className="font-mono text-[11px] text-gray-800">{order.obdNumber}</span>
        </div>
        {dateStr && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
            <span className="text-[10px] text-gray-400">{dateStr}</span>
            {ageBadge && <span className={`text-[9px] font-semibold px-[5px] py-[1px] rounded-[3px] border leading-none ${ageBadge.className}`}>{ageBadge.text}</span>}
          </div>
        )}
      </td>
    );
  }

  function SplitObdTd({ split }: { split: SplitCard }) {
    const dateStr = formatOrderDate(split.orderDateTime) || formatObdDate(split.obdEmailDate, split.obdEmailTime) || formatTime(split.createdAt);
    const ageBadge = getAgeBadge(split.orderDateTime, split.obdEmailDate);
    return (
      <td className={tdObdCls} style={tdObdStyle}>
        <div className="flex items-center gap-1.5">
          {split.deliveryTypeName && (
            <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${deliveryDotCls(split.deliveryTypeName)}`} title={split.deliveryTypeName} />
          )}
          <span className="font-mono text-[11px] text-gray-800">{split.order.obdNumber}</span>
        </div>
        {dateStr && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
            <span className="text-[10px] text-gray-400">{dateStr}</span>
            {ageBadge && <span className={`text-[9px] font-semibold px-[5px] py-[1px] rounded-[3px] border leading-none ${ageBadge.className}`}>{ageBadge.text}</span>}
          </div>
        )}
        <div className="inline-flex items-center gap-[3px] text-[9px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded mt-0.5">
          <Scissors size={8} />
          Split #{split.splitNumber}
        </div>
      </td>
    );
  }

  function CustomerTd({ name, missing, onMissing, dispatchStatus }: {
    name: string; missing?: boolean; onMissing?: (e: React.MouseEvent) => void; dispatchStatus?: string | null;
  }) {
    return (
      <td className={tdCls} style={tdStyle}>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-gray-900 truncate">{name}</span>
          {missing && onMissing && (
            <button type="button" onClick={onMissing} className="text-amber-500 hover:bg-amber-50 rounded p-0.5 flex-shrink-0 transition-colors" title="Customer Missing — click to resolve">
              <AlertCircle size={13} />
            </button>
          )}
          {dispatchStatus === "dispatch" && <span className="inline-flex items-center text-[9px] font-semibold bg-green-50 text-green-700 border border-green-200 px-1.5 py-0.5 rounded-full flex-shrink-0">Dispatch</span>}
          {dispatchStatus === "hold" && <span className="inline-flex items-center text-[9px] font-semibold bg-red-50 text-red-700 border border-red-200 px-1.5 py-0.5 rounded-full flex-shrink-0">Hold</span>}
          {dispatchStatus === "waiting_for_confirmation" && <span className="inline-flex items-center text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full flex-shrink-0">Waiting</span>}
        </div>
      </td>
    );
  }

  function OrderCommonTds({ order }: { order: TintOrder }) {
    return (
      <>
        <OrderObdTd order={order} />
        <td className={tdCls} style={tdStyle}><SmuBadge smu={order.smu} /></td>
        <CustomerTd
          name={order.customer?.customerName ?? order.shipToCustomerName ?? "—"}
          missing={order.customerMissing}
          onMissing={(e) => { e.stopPropagation(); onCustomerMissing?.(order); }}
          dispatchStatus={order.dispatchStatus}
        />
        <td className={tdCls} style={tdStyle}><PriorityBadge level={order.priorityLevel} /></td>
        <td className={`${tdCls} font-mono text-[11px] text-gray-600`} style={tdStyle}>{order.querySnapshot?.articleTag ?? "—"}</td>
        <td className={`${tdCls} text-[11px] text-gray-600`} style={tdStyle}>{order.querySnapshot?.totalVolume != null ? `${Math.round(order.querySnapshot.totalVolume)} L` : "—"}</td>
      </>
    );
  }

  function SplitCommonTds({ split }: { split: SplitCard }) {
    return (
      <>
        <SplitObdTd split={split} />
        <td className={tdCls} style={tdStyle}><SmuBadge smu={split.smu} /></td>
        <CustomerTd name={split.order.customer?.customerName ?? "—"} dispatchStatus={split.dispatchStatus} />
        <td className={tdCls} style={tdStyle}><PriorityBadge level={split.priorityLevel} /></td>
        <td className={`${tdCls} font-mono text-[11px] text-gray-600`} style={tdStyle}>{split.articleTag ?? `${split.totalQty} units`}</td>
        <td className={`${tdCls} text-[11px] text-gray-600`} style={tdStyle}>{split.totalVolume != null ? `${Math.round(split.totalVolume)} L` : "—"}</td>
      </>
    );
  }

  function OperatorTd({ name, avatarColor }: { name: string | null | undefined; avatarColor: string }) {
    return (
      <td className={tdCls} style={tdStyle}>
        <div className="flex items-center gap-1.5 min-w-0">
          <div className={`rounded-full ${avatarColor} text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0`} style={{ width: 22, height: 22 }}>{initials(name)}</div>
          <span className="text-[11px] text-gray-600 truncate">{name ?? "—"}</span>
        </div>
      </td>
    );
  }

  function ActionsTd({ children }: { children: React.ReactNode }) {
    return (
      <td className={`${tdCls} text-right`} style={{ ...tdStyle, paddingRight: 14 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1 justify-end">{children}</div>
      </td>
    );
  }

  const rowCls = "border-b border-[#f0f0f0] last:border-b-0 hover:bg-[#fafafa] cursor-pointer transition-colors duration-100";
  const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white px-3 pb-6 text-[12px]">

      {/* ── Section 1: Pending Assignment ──────────────────────────────────── */}
      <div className="mb-4">
        <SectionHeader dotClass="bg-teal-500" label="Pending Assignment" count={pendingRows.length} volume={pendingSectionVolume} colorScheme="teal" />
        <div className="bg-white border border-gray-200 border-t-0 rounded-b-lg overflow-hidden">
          <table style={tableStyle}>
            <Colgroup />
            <thead>
              <tr className="bg-gray-50 border-b border-[#ebebeb]">
                <th className={thCls} style={{ ...thStyle, textAlign: "center" }}>#</th><th className={thCls} style={thStyle}>OBD No.</th><th className={thCls} style={thStyle}>SMU</th><th className={thCls} style={thStyle}>Site Name</th>
                <th className={thCls} style={thStyle}>Priority</th><th className={thCls} style={thStyle}>Articles</th><th className={thCls} style={thStyle}>Volume</th>
                <th className={thCls} style={thStyle}>Action</th><th className={thCls} style={thStyle} /><th className={thCls} style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {pendingRows.length === 0 ? (
                <tr><td colSpan={NUM_COLS} className="px-3 py-6 text-center text-gray-400 italic">No pending orders</td></tr>
              ) : pendingRows.map((order, idx) => {
                const hasSplits =
                  (order.splits ?? []).filter((s) => s.status !== "cancelled").length > 0 ||
                  (order.existingSplits ?? []).length > 0 ||
                  filteredActiveSplits.some((s) => s.order.id === order.id && (s.status === "tint_assigned" || s.status === "tinting_in_progress"));
                const actions: RowAction[] = hasSplits
                  ? [{ label: "Create Split", icon: <Scissors size={13} />, onClick: () => onCreateSplit(order) }]
                  : [
                      { label: "Assign Operator", icon: <UserPlus size={13} />, onClick: () => onAssign(order) },
                      { label: "Create Split",    icon: <Scissors size={13} />, onClick: () => onCreateSplit(order) },
                    ];
                const remainingQty = order.remainingQty ?? 0;
                return (
                  <tr key={`p-${order.id}`} onClick={() => onOrderClick(order)} className={rowCls}>
                    <SerialTd n={idx + 1} />
                    <OrderCommonTds order={order} />
                    <td className={tdCls} onClick={(e) => e.stopPropagation()}>
                      {hasSplits ? (
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => onCreateSplit(order)}
                            className="inline-flex items-center justify-center gap-1.5 min-w-[120px] text-[11px] font-medium text-gray-700 bg-white rounded-[6px] hover:bg-gray-50 hover:border-gray-300 transition-colors" style={{ padding: "4px 14px", border: "0.5px solid #d1d5db" }}>
                            <Scissors size={11} /> Create Split
                          </button>
                          {remainingQty > 0 && <span className="text-[10px] font-semibold text-amber-600">{remainingQty} left</span>}
                        </div>
                      ) : (
                        <button type="button" onClick={() => onAssign(order)}
                          className="inline-flex items-center justify-center gap-1.5 min-w-[120px] text-[11px] font-medium text-gray-700 bg-white rounded-[6px] hover:bg-gray-50 hover:border-gray-300 transition-colors" style={{ padding: "4px 14px", border: "0.5px solid #d1d5db" }}>
                          <UserPlus size={11} /> Assign
                        </button>
                      )}
                    </td>
                    <td className={tdCls} style={tdStyle} />
                    <ActionsTd>
                      <PlusBtn id={order.id} type="order" onStatusPopover={onStatusPopover} />
                      <RowActionsMenu actions={actions} />
                    </ActionsTd>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 2: Assigned ────────────────────────────────────────────── */}
      <div className="mb-4">
        <SectionHeader dotClass="bg-amber-400" label="Assigned" count={assignedOrderRows.length + assignedSplitRows.length} volume={assignedSectionVolume} colorScheme="amber" />
        <div className="bg-white border border-gray-200 border-t-0 rounded-b-lg overflow-hidden">
          <table style={tableStyle}>
            <Colgroup />
            <thead>
              <tr className="bg-gray-50 border-b border-[#ebebeb]">
                <th className={thCls} style={{ ...thStyle, textAlign: "center" }}>#</th><th className={thCls} style={thStyle}>OBD No.</th><th className={thCls} style={thStyle}>SMU</th><th className={thCls} style={thStyle}>Site Name</th>
                <th className={thCls} style={thStyle}>Priority</th><th className={thCls} style={thStyle}>Articles</th><th className={thCls} style={thStyle}>Volume</th>
                <th className={thCls} style={thStyle}>Operator</th><th className={thCls} style={thStyle}>Assigned At</th><th className={thCls} style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {assignedOrderRows.length === 0 && assignedSplitRows.length === 0 ? (
                <tr><td colSpan={NUM_COLS} className="px-3 py-6 text-center text-gray-400 italic">No assigned orders</td></tr>
              ) : (
                <>
                  {assignedOrderRows.map((order, idx) => (
                    <tr key={`ao-${order.id}`} onClick={() => onOrderClick(order)} className={rowCls}>
                      <SerialTd n={idx + 1} />
                      <OrderCommonTds order={order} />
                      <OperatorTd name={order.tintAssignments[0]?.assignedTo.name} avatarColor="bg-teal-600" />
                      <td className={tdCls} style={tdStyle}><span className="text-[11px] text-gray-400">{formatTime(order.tintAssignments[0]?.updatedAt)}</span></td>
                      <ActionsTd>
                        <PlusBtn id={order.id} type="order" onStatusPopover={onStatusPopover} />
                        <RowActionsMenu actions={[
                          { label: "Move Up",           icon: <ChevronUp size={13} />,   onClick: () => onMoveUp(order.id, "order") },
                          { label: "Move Down",         icon: <ChevronDown size={13} />, onClick: () => onMoveDown(order.id, "order") },
                          { label: "Re-assign",         icon: <RefreshCw size={13} />,   onClick: () => onAssign(order) },
                          { label: "Cancel Assignment", icon: <X size={13} />,           onClick: () => onCancelAssignment(order), danger: true },
                        ]} />
                      </ActionsTd>
                    </tr>
                  ))}
                  {assignedSplitRows.map((split, idx) => (
                    <tr key={`as-${split.id}`} onClick={() => onSplitClick(split)} className={rowCls}>
                      <SerialTd n={assignedOrderRows.length + idx + 1} />
                      <SplitCommonTds split={split} />
                      <OperatorTd name={split.assignedTo.name} avatarColor="bg-teal-600" />
                      <td className={tdCls} style={tdStyle}><span className="text-[11px] text-gray-400">{formatTime(split.createdAt)}</span></td>
                      <ActionsTd>
                        <PlusBtn id={split.id} type="split" onStatusPopover={onStatusPopover} />
                        <RowActionsMenu actions={[
                          { label: "Move Up",      icon: <ChevronUp size={13} />,   onClick: () => onMoveUp(split.id, "split") },
                          { label: "Move Down",    icon: <ChevronDown size={13} />, onClick: () => onMoveDown(split.id, "split") },
                          { label: "Reassign",     icon: <RefreshCw size={13} />,   onClick: () => onReassignSplit(split) },
                          { label: "Cancel Split", icon: <X size={13} />,           onClick: () => onCancelSplit(split), danger: true },
                        ]} />
                      </ActionsTd>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 3: In Progress ──────────────────────────────────────────── */}
      <div className="mb-4">
        <SectionHeader dotClass="bg-blue-400" label="In Progress" count={inProgressOrderRows.length + inProgressSplitRows.length} volume={inProgressSectionVolume} colorScheme="blue" />
        <div className="bg-white border border-gray-200 border-t-0 rounded-b-lg overflow-hidden">
          <table style={tableStyle}>
            <Colgroup />
            <thead>
              <tr className="bg-gray-50 border-b border-[#ebebeb]">
                <th className={thCls} style={{ ...thStyle, textAlign: "center" }}>#</th><th className={thCls} style={thStyle}>OBD No.</th><th className={thCls} style={thStyle}>SMU</th><th className={thCls} style={thStyle}>Site Name</th>
                <th className={thCls} style={thStyle}>Priority</th><th className={thCls} style={thStyle}>Articles</th><th className={thCls} style={thStyle}>Volume</th>
                <th className={thCls} style={thStyle}>Operator</th><th className={thCls} style={thStyle}>Elapsed</th><th className={thCls} style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {inProgressOrderRows.length === 0 && inProgressSplitRows.length === 0 ? (
                <tr><td colSpan={NUM_COLS} className="px-3 py-6 text-center text-gray-400 italic">No orders in progress</td></tr>
              ) : (
                <>
                  {inProgressOrderRows.map((order, idx) => {
                    const startedAt = order.tintAssignments[0]?.startedAt ?? null;
                    return (
                      <tr key={`ipo-${order.id}`} onClick={() => onOrderClick(order)} className={rowCls}>
                        <SerialTd n={idx + 1} />
                        <OrderCommonTds order={order} />
                        <OperatorTd name={order.tintAssignments[0]?.assignedTo.name} avatarColor="bg-teal-600" />
                        <td className={tdCls} style={tdStyle}><ElapsedBadge startedAt={startedAt} /></td>
                        <ActionsTd><PlusBtn id={order.id} type="order" onStatusPopover={onStatusPopover} /></ActionsTd>
                      </tr>
                    );
                  })}
                  {inProgressSplitRows.map((split, idx) => (
                    <tr key={`ips-${split.id}`} onClick={() => onSplitClick(split)} className={rowCls}>
                      <SerialTd n={inProgressOrderRows.length + idx + 1} />
                      <SplitCommonTds split={split} />
                      <OperatorTd name={split.assignedTo.name} avatarColor="bg-teal-600" />
                      <td className={tdCls} style={tdStyle}><ElapsedBadge startedAt={split.startedAt} /></td>
                      <ActionsTd><PlusBtn id={split.id} type="split" onStatusPopover={onStatusPopover} /></ActionsTd>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 4: Completed Today ──────────────────────────────────────── */}
      <div className="mb-4">
        <SectionHeader dotClass="bg-green-400" label="Completed Today" count={completedSplitRows.length + completedAssignmentRows.length} volume={completedSectionVolume} colorScheme="green" />
        <div className="bg-white border border-gray-200 border-t-0 rounded-b-lg overflow-hidden">
          <table style={tableStyle}>
            <Colgroup />
            <thead>
              <tr className="bg-gray-50 border-b border-[#ebebeb]">
                <th className={thCls} style={{ ...thStyle, textAlign: "center" }}>#</th><th className={thCls} style={thStyle}>OBD No.</th><th className={thCls} style={thStyle}>SMU</th><th className={thCls} style={thStyle}>Site Name</th>
                <th className={thCls} style={thStyle}>Priority</th><th className={thCls} style={thStyle}>Articles</th><th className={thCls} style={thStyle}>Volume</th>
                <th className={thCls} style={thStyle}>Operator</th><th className={thCls} style={thStyle}>Completed At</th><th className={thCls} style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {completedSplitRows.length === 0 && completedAssignmentRows.length === 0 ? (
                <tr><td colSpan={NUM_COLS} className="px-3 py-6 text-center text-gray-400 italic">No completed orders today</td></tr>
              ) : (
                <>
                  {completedSplitRows.map((split, idx) => (
                    <tr key={`cs-${split.id}`} onClick={() => onSplitClick(split)} className={rowCls}>
                      <SerialTd n={idx + 1} />
                      <SplitCommonTds split={split} />
                      <OperatorTd name={split.assignedTo.name} avatarColor="bg-green-600" />
                      <td className={tdCls} style={tdStyle}><span className="text-[11px] text-gray-400">{formatTime(split.completedAt)}</span></td>
                      <ActionsTd><PlusBtn id={split.id} type="split" onStatusPopover={onStatusPopover} /></ActionsTd>
                    </tr>
                  ))}
                  {completedAssignmentRows.map((a, idx) => {
                    const order = assignmentAsOrder(a);
                    return (
                      <tr key={`ca-${a.id}`} onClick={() => onOrderClick(order)} className={rowCls}>
                        <SerialTd n={completedSplitRows.length + idx + 1} />
                        <td className={tdObdCls} style={tdObdStyle}>
                          <div className="font-mono text-[11px] text-gray-800">{a.order.obdNumber}</div>
                          {(a.orderDateTime || a.obdEmailDate || a.completedAt) && (
                            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                              <span className="text-[10px] text-gray-400">{formatOrderDate(a.orderDateTime) || formatObdDate(a.obdEmailDate, a.obdEmailTime) || formatTime(a.completedAt)}</span>
                            </div>
                          )}
                        </td>
                        <td className={tdCls} style={tdStyle}><SmuBadge smu={a.smu} /></td>
                        <CustomerTd name={a.order.customer?.customerName ?? a.order.shipToCustomerName ?? "—"} dispatchStatus={null} />
                        <td className={tdCls} style={tdStyle}><PriorityBadge level={5} /></td>
                        <td className={`${tdCls} font-mono text-[11px] text-gray-600`} style={tdStyle}>{a.order.querySnapshot?.articleTag ?? "—"}</td>
                        <td className={`${tdCls} text-[11px] text-gray-600`} style={tdStyle}>{a.order.querySnapshot?.totalVolume != null ? `${Math.round(a.order.querySnapshot.totalVolume)} L` : "—"}</td>
                        <OperatorTd name={a.assignedTo.name} avatarColor="bg-green-600" />
                        <td className={tdCls} style={tdStyle}><span className="text-[11px] text-gray-400">{formatTime(a.completedAt)}</span></td>
                        <ActionsTd><PlusBtn id={a.order.id} type="order" onStatusPopover={onStatusPopover} /></ActionsTd>
                      </tr>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
