"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Scissors, MoreHorizontal, UserPlus, ChevronUp, ChevronDown, RefreshCw, X } from "lucide-react";
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
  aDate: string | null,
  aTime: string | null,
  bSeq: number | null | undefined,
  bPri: number | null | undefined,
  bDate: string | null,
  bTime: string | null,
): number {
  const seqDiff = (aSeq ?? 0) - (bSeq ?? 0);
  if (seqDiff !== 0) return seqDiff;
  const priDiff = (aPri ?? 5) - (bPri ?? 5);
  if (priDiff !== 0) return priDiff;
  return buildTs(aDate, aTime) - buildTs(bDate, bTime);
}

// ── Shared class strings ──────────────────────────────────────────────────────

const thCls = "px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[0.06em] text-gray-400 whitespace-nowrap";
const tdCls = "px-3 py-[9px] align-middle text-gray-600";

// ── Cell components ───────────────────────────────────────────────────────────

function SmuBadge({ smu }: { smu: string | null | undefined }) {
  if (!smu) return <span className="text-gray-400">—</span>;
  return (
    <span className="font-mono text-[10.5px] bg-[#f0f7ff] text-[#1565c0] border border-[#bfdbfe] px-[6px] py-[1px] rounded-[4px]">
      {smu}
    </span>
  );
}

function SlotBadge({ slot }: { slot: string | null | undefined }) {
  if (!slot) return <span className="text-gray-400">—</span>;
  return (
    <span className="font-mono text-[10.5px] bg-[#f3f4f8] text-gray-500 border border-[#e2e5f1] px-[6px] py-[1px] rounded-[4px]">
      {slot}
    </span>
  );
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
    <span className="inline-flex text-[10.5px] font-semibold bg-[#f1f3f9] text-gray-400 border border-[#e2e5f1] px-[7px] py-[2px] rounded-[5px]">
      Normal
    </span>
  );
}

function OperatorDisplay({ name }: { name: string | null | undefined }) {
  if (!name) return <span className="text-gray-400">—</span>;
  return (
    <div className="flex items-center gap-[7px]">
      <div className="w-6 h-6 rounded-full bg-[#e8eaf6] text-[#1a237e] border border-[#c5cae9] flex items-center justify-center text-[9px] font-bold flex-shrink-0">
        {initials(name)}
      </div>
      <span className="text-[12px] text-gray-700">{name}</span>
    </div>
  );
}

function DispatchStatusBadges({ dispatchStatus }: { dispatchStatus: string | null | undefined }) {
  return (
    <div className="flex gap-[5px] flex-wrap">
      <span className="inline-flex text-[10.5px] font-semibold bg-[#eaf3de] text-[#27500a] border border-[#97c459] px-[7px] py-[2px] rounded-[5px]">
        ✓ Tinting Done
      </span>
      {dispatchStatus === "dispatch" && (
        <span className="inline-flex text-[10.5px] font-semibold bg-[#eaf3de] text-[#27500a] border border-[#97c459] px-[7px] py-[2px] rounded-[5px]">
          🚚 Dispatch
        </span>
      )}
      {dispatchStatus === "hold" && (
        <span className="inline-flex text-[10.5px] font-semibold bg-red-50 text-red-700 border border-red-200 px-[7px] py-[2px] rounded-[5px]">
          Hold
        </span>
      )}
      {dispatchStatus === "waiting_for_confirmation" && (
        <span className="inline-flex text-[10.5px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-[7px] py-[2px] rounded-[5px]">
          Waiting
        </span>
      )}
      {!dispatchStatus && (
        <span className="inline-flex text-[10.5px] font-semibold bg-[#eff6ff] text-[#1e40af] border border-[#bfdbfe] px-[7px] py-[2px] rounded-[5px]">
          Pending Support
        </span>
      )}
    </div>
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
      className="w-[22px] h-[22px] rounded-[5px] border border-[#e2e5f1] flex items-center justify-center text-gray-400 hover:bg-[#e8eaf6] hover:text-[#1a237e] hover:border-[#c5cae9] transition-colors duration-100"
    >
      <Plus size={10} />
    </button>
  );
}

const SCHEME_MAP = {
  indigo: {
    bg:        "bg-[#f0f1ff]",
    border:    "border-b-2 border-[#6366f1]",
    labelColor: "text-[#3730a3]",
    dot:       "bg-indigo-500",
    pill:      "bg-indigo-100 text-indigo-700 border border-indigo-200",
  },
  amber: {
    bg:        "bg-[#fffbeb]",
    border:    "border-b-2 border-[#f59e0b]",
    labelColor: "text-[#92400e]",
    dot:       "bg-amber-400",
    pill:      "bg-amber-100 text-amber-700 border border-amber-200",
  },
  blue: {
    bg:        "bg-[#eff6ff]",
    border:    "border-b-2 border-[#3b82f6]",
    labelColor: "text-[#1e40af]",
    dot:       "bg-blue-400",
    pill:      "bg-blue-100 text-blue-700 border border-blue-200",
  },
  green: {
    bg:        "bg-[#f0fdf4]",
    border:    "border-b-2 border-[#22c55e]",
    labelColor: "text-[#166534]",
    dot:       "bg-green-400",
    pill:      "bg-green-100 text-green-700 border border-green-200",
  },
} as const;

function SectionHeader({ dotClass, label, count, note, colorScheme }: {
  dotClass:    string;
  label:       string;
  count:       number;
  note:        string;
  colorScheme: "indigo" | "amber" | "blue" | "green";
}) {
  const s = SCHEME_MAP[colorScheme];
  return (
    <div className={`flex items-center gap-2.5 px-4 py-[10px] rounded-t-[10px] ${s.bg} ${s.border}`}>
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
      <span className={`text-[12px] font-bold ${s.labelColor}`}>{label}</span>
      <span className={`text-[11px] font-bold px-[9px] py-[1px] rounded-full ${s.pill}`}>
        {count}
      </span>
      <div className="flex-1" />
      <span className="text-[11px] text-gray-500">{note}</span>
    </div>
  );
}

// OBD cell for order rows
function ObdOrderCell({ order }: { order: TintOrder }) {
  const dateStr = formatObdDate(order.obdEmailDate, order.obdEmailTime) || formatTime(order.createdAt);
  return (
    <td className={tdCls}>
      <div className="font-mono text-[11px] font-medium text-[#1a237e]">{order.obdNumber}</div>
      {dateStr && <div className="text-[10.5px] text-gray-400 mt-[2px]">{dateStr}</div>}
    </td>
  );
}

// OBD cell for split rows
function ObdSplitCell({ split }: { split: SplitCard }) {
  const dateStr = formatObdDate(split.obdEmailDate, split.obdEmailTime) || formatTime(split.createdAt);
  return (
    <td className={tdCls}>
      <div className="font-mono text-[11px] font-medium text-[#1a237e]">{split.order.obdNumber}</div>
      {dateStr && <div className="text-[10.5px] text-gray-400 mt-[2px]">{dateStr}</div>}
      <div className="inline-flex items-center gap-[3px] text-[10px] text-gray-400 bg-[#f1f2f8] border border-[#e0e2f0] px-[6px] py-[1px] rounded-[4px] mt-[2px]">
        <Scissors size={9} />
        Split #{split.splitNumber}
      </div>
    </td>
  );
}

const ROW_CLS = "border-b border-[#f0f1f5] last:border-b-0 even:bg-[#fafbfe] hover:bg-[#e8eaf6] cursor-pointer transition-colors duration-100";

// ── Row actions menu ──────────────────────────────────────────────────────────

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
      className="bg-white border border-[#e2e5f1] rounded-xl shadow-lg py-1 min-w-[168px]"
    >
      {actions.map((action, i) => (
        <button
          key={i}
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(false); action.onClick(); }}
          className={`w-full flex items-center gap-2 px-3.5 py-[7px] text-[12px] text-left transition-colors cursor-pointer ${
            action.danger
              ? "text-red-600 hover:bg-red-50"
              : "text-gray-700 hover:bg-[#f7f8fc]"
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
        className="w-[26px] h-[26px] rounded-[5px] border border-[#e2e5f1] flex items-center justify-center text-gray-400 hover:bg-[#e8eaf6] hover:text-[#1a237e] hover:border-[#c5cae9] transition-colors duration-100"
      >
        <MoreHorizontal size={13} />
      </button>
      {dropdown}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

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
        : "font-mono text-[11.5px] font-medium text-[#1565c0] bg-[#eff6ff] border border-[#bfdbfe] px-[7px] py-[2px] rounded-[5px]"
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
    .sort((a, b) => buildTs(a.obdEmailDate, a.obdEmailTime) - buildTs(b.obdEmailDate, b.obdEmailTime));

  // ── Section 2: Assigned ───────────────────────────────────────────────────

  const assignedOrderRows = filteredOrders
    .filter((o) => o.workflowStage === "tint_assigned" && (o.remainingQty ?? 0) === 0)
    .sort((a, b) => seqPriDateSort(a.sequenceOrder, a.priorityLevel, a.obdEmailDate, a.obdEmailTime, b.sequenceOrder, b.priorityLevel, b.obdEmailDate, b.obdEmailTime));

  const assignedSplitRows = filteredActiveSplits
    .filter((s) => s.status === "tint_assigned")
    .sort((a, b) => seqPriDateSort(a.sequenceOrder, a.priorityLevel, a.obdEmailDate, a.obdEmailTime, b.sequenceOrder, b.priorityLevel, b.obdEmailDate, b.obdEmailTime));

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
      id:                 a.order.id,
      obdNumber:          a.order.obdNumber,
      workflowStage:      "pending_support",
      dispatchSlot:       null,
      dispatchStatus:     null,
      priorityLevel:      5,
      sequenceOrder:      null,
      createdAt:          a.completedAt ?? "",
      shipToCustomerName: a.order.shipToCustomerName,
      shipToCustomerId:   null,
      customerMissing:    false,
      smu:                a.smu,
      obdEmailDate:       a.obdEmailDate,
      obdEmailTime:       a.obdEmailTime,
      customer:           a.order.customer ?? null,
      querySnapshot:      a.order.querySnapshot ?? null,
      tintAssignments: [{
        id:          a.id,
        status:      "tinting_done",
        assignedTo:  a.assignedTo,
        startedAt:   null,
        completedAt: a.completedAt,
        updatedAt:   a.completedAt ?? "",
      }],
      lineItems:      [] as TintOrder["lineItems"],
      existingSplits: [],
      splits:         [],
      remainingQty:   0,
    };
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="bg-[#f0f2f8] px-3 pb-6">

      {/* ── Section 1: Pending Assignment ──────────────────────────────────── */}
      <div className="mb-5">
        <SectionHeader dotClass="bg-indigo-500" label="Pending Assignment" count={pendingRows.length} note="Needs operator assignment" colorScheme="indigo" />
        <div className="bg-white border border-[#e2e5f1] border-t-0 rounded-b-[10px] overflow-hidden">
          <table className="w-full border-collapse text-[12px]">
            <thead className="bg-[#f3f4f8] border-b border-[#e2e5f1]">
              <tr>
                <th className={thCls}>OBD No.</th>
                <th className={thCls}>Customer</th>
                <th className={thCls}>Area</th>
                <th className={thCls}>SMU</th>
                <th className={thCls}>Slot</th>
                <th className={thCls}>Priority</th>
                <th className={thCls}>Articles</th>
                <th className={thCls}>Volume</th>
                <th className={thCls}>Sales Officer</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {pendingRows.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-[12px] text-gray-400 italic">No pending orders</td></tr>
              ) : pendingRows.map((order) => {
                const orderActiveSplits = filteredActiveSplits.filter(
                  (s) => s.order.id === order.id &&
                    (s.status === "tint_assigned" || s.status === "tinting_in_progress")
                );
                const hasSplits =
                  (order.splits ?? []).filter((s) => s.status !== "cancelled").length > 0 ||
                  (order.existingSplits ?? []).length > 0 ||
                  orderActiveSplits.length > 0;
                const pendingActions: RowAction[] = hasSplits
                  ? [
                      { label: "Create Split",    icon: <Scissors size={13} />, onClick: () => onCreateSplit(order) },
                    ]
                  : [
                      { label: "Assign Operator", icon: <UserPlus size={13} />, onClick: () => onAssign(order) },
                      { label: "Create Split",    icon: <Scissors size={13} />, onClick: () => onCreateSplit(order) },
                    ];
                return (
                  <tr key={`p-${order.id}`} onClick={() => onOrderClick(order)} className={ROW_CLS}>
                    <td className={tdCls}>
                      <div className="font-mono text-[11px] font-medium text-[#1a237e]">{order.obdNumber}</div>
                      {(formatObdDate(order.obdEmailDate, order.obdEmailTime) || formatTime(order.createdAt)) && (
                        <div className="text-[10.5px] text-gray-400 mt-[2px]">
                          {formatObdDate(order.obdEmailDate, order.obdEmailTime) || formatTime(order.createdAt)}
                        </div>
                      )}
                      {orderActiveSplits.length > 0 && (order.remainingQty ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 px-[6px] py-[1px] rounded-[4px] mt-[2px]">
                          {order.remainingQty} units remaining
                        </span>
                      )}
                    </td>
                    <td className={tdCls}>
                      <span className="font-medium text-gray-900 text-[12.5px]">{order.customer?.customerName ?? order.shipToCustomerName ?? "—"}</span>
                      {order.customerMissing && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onCustomerMissing?.(order); }}
                          className="mt-0.5 flex items-center gap-1 text-[10.5px] font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 px-1.5 py-0.5 rounded transition-colors"
                        >
                          ⚠ Customer Missing
                        </button>
                      )}
                    </td>
                    <td className={tdCls}>{order.customer?.area.name ?? "—"}</td>
                    <td className={tdCls}><SmuBadge smu={order.smu} /></td>
                    <td className={tdCls}><SlotBadge slot={order.dispatchSlot} /></td>
                    <td className={tdCls}><PriorityBadge level={order.priorityLevel} /></td>
                    <td className={tdCls}><span className="font-mono text-[11px] text-gray-500">{order.querySnapshot?.articleTag ?? "—"}</span></td>
                    <td className={tdCls}>{order.querySnapshot?.totalVolume != null ? `${Math.round(order.querySnapshot.totalVolume)} L` : "—"}</td>
                    <td className={tdCls}><span className="text-[11.5px] text-gray-500">{order.customer?.salesOfficerGroup?.salesOfficer?.name ?? "—"}</span></td>
                    <td className={tdCls} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5 justify-end">
                        <PlusBtn id={order.id} type="order" onStatusPopover={onStatusPopover} />
                        <RowActionsMenu actions={pendingActions} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 2: Assigned ────────────────────────────────────────────── */}
      <div className="mb-5">
        <SectionHeader dotClass="bg-amber-400" label="Assigned" count={assignedOrderRows.length + assignedSplitRows.length} note="Waiting for operator to start" colorScheme="amber" />
        <div className="bg-white border border-[#e2e5f1] border-t-0 rounded-b-[10px] overflow-hidden">
          <table className="w-full border-collapse text-[12px]">
            <thead className="bg-[#f3f4f8] border-b border-[#e2e5f1]">
              <tr>
                <th className={thCls}>OBD No.</th>
                <th className={thCls}>Customer</th>
                <th className={thCls}>Area</th>
                <th className={thCls}>SMU</th>
                <th className={thCls}>Slot</th>
                <th className={thCls}>Priority</th>
                <th className={thCls}>Articles</th>
                <th className={thCls}>Volume</th>
                <th className={thCls}>Sales Officer</th>
                <th className={thCls}>Operator</th>
                <th className={thCls}>Assigned At</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {assignedOrderRows.length === 0 && assignedSplitRows.length === 0 ? (
                <tr><td colSpan={12} className="px-3 py-6 text-center text-[12px] text-gray-400 italic">No assigned orders</td></tr>
              ) : (
                <>
                  {assignedOrderRows.map((order) => (
                    <tr key={`ao-${order.id}`} onClick={() => onOrderClick(order)} className={ROW_CLS}>
                      <ObdOrderCell order={order} />
                      <td className={tdCls}>
                        <span className="font-medium text-gray-900 text-[12.5px]">{order.customer?.customerName ?? order.shipToCustomerName ?? "—"}</span>
                        {order.customerMissing && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onCustomerMissing?.(order); }}
                            className="mt-0.5 flex items-center gap-1 text-[10.5px] font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 px-1.5 py-0.5 rounded transition-colors"
                          >
                            ⚠ Customer Missing
                          </button>
                        )}
                      </td>
                      <td className={tdCls}>{order.customer?.area.name ?? "—"}</td>
                      <td className={tdCls}><SmuBadge smu={order.smu} /></td>
                      <td className={tdCls}><SlotBadge slot={order.dispatchSlot} /></td>
                      <td className={tdCls}><PriorityBadge level={order.priorityLevel} /></td>
                      <td className={tdCls}><span className="font-mono text-[11px] text-gray-500">{order.querySnapshot?.articleTag ?? "—"}</span></td>
                      <td className={tdCls}>{order.querySnapshot?.totalVolume != null ? `${Math.round(order.querySnapshot.totalVolume)} L` : "—"}</td>
                      <td className={tdCls}><span className="text-[11.5px] text-gray-500">{order.customer?.salesOfficerGroup?.salesOfficer?.name ?? "—"}</span></td>
                      <td className={tdCls}><OperatorDisplay name={order.tintAssignments[0]?.assignedTo.name} /></td>
                      <td className={tdCls}><span className="text-[11.5px] text-gray-400 whitespace-nowrap">{formatTime(order.tintAssignments[0]?.updatedAt)}</span></td>
                      <td className={tdCls} onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5 justify-end">
                          <PlusBtn id={order.id} type="order" onStatusPopover={onStatusPopover} />
                          <RowActionsMenu actions={[
                            { label: "Move Up",           icon: <ChevronUp size={13} />,   onClick: () => onMoveUp(order.id, "order") },
                            { label: "Move Down",         icon: <ChevronDown size={13} />, onClick: () => onMoveDown(order.id, "order") },
                            { label: "Cancel Assignment", icon: <X size={13} />,           onClick: () => onCancelAssignment(order), danger: true },
                          ]} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {assignedSplitRows.map((split) => (
                    <tr key={`as-${split.id}`} onClick={() => onSplitClick(split)} className={ROW_CLS}>
                      <ObdSplitCell split={split} />
                      <td className={tdCls}><span className="font-medium text-gray-900 text-[12.5px]">{split.order.customer?.customerName ?? "—"}</span></td>
                      <td className={tdCls}>—</td>
                      <td className={tdCls}><SmuBadge smu={split.smu} /></td>
                      <td className={tdCls}><SlotBadge slot={null} /></td>
                      <td className={tdCls}><PriorityBadge level={split.priorityLevel} /></td>
                      <td className={tdCls}><span className="font-mono text-[11px] text-gray-500">{split.articleTag ?? `${split.totalQty} units`}</span></td>
                      <td className={tdCls}>{split.totalVolume != null ? `${Math.round(split.totalVolume)} L` : "—"}</td>
                      <td className={tdCls}><span className="text-[11.5px] text-gray-500">{split.order.customer?.salesOfficerGroup?.salesOfficer?.name ?? "—"}</span></td>
                      <td className={tdCls}><OperatorDisplay name={split.assignedTo.name} /></td>
                      <td className={tdCls}><span className="text-[11.5px] text-gray-400 whitespace-nowrap">{formatTime(split.createdAt)}</span></td>
                      <td className={tdCls} onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5 justify-end">
                          <PlusBtn id={split.id} type="split" onStatusPopover={onStatusPopover} />
                          <RowActionsMenu actions={[
                            { label: "Move Up",     icon: <ChevronUp size={13} />,   onClick: () => onMoveUp(split.id, "split") },
                            { label: "Move Down",   icon: <ChevronDown size={13} />, onClick: () => onMoveDown(split.id, "split") },
                            { label: "Reassign",    icon: <RefreshCw size={13} />,   onClick: () => onReassignSplit(split) },
                            { label: "Cancel Split", icon: <X size={13} />,          onClick: () => onCancelSplit(split), danger: true },
                          ]} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 3: In Progress ──────────────────────────────────────────── */}
      <div className="mb-5">
        <SectionHeader dotClass="bg-blue-400" label="In Progress" count={inProgressOrderRows.length + inProgressSplitRows.length} note="Currently being tinted" colorScheme="blue" />
        <div className="bg-white border border-[#e2e5f1] border-t-0 rounded-b-[10px] overflow-hidden">
          <table className="w-full border-collapse text-[12px]">
            <thead className="bg-[#f3f4f8] border-b border-[#e2e5f1]">
              <tr>
                <th className={thCls}>OBD No.</th>
                <th className={thCls}>Customer</th>
                <th className={thCls}>Area</th>
                <th className={thCls}>SMU</th>
                <th className={thCls}>Slot</th>
                <th className={thCls}>Priority</th>
                <th className={thCls}>Articles</th>
                <th className={thCls}>Volume</th>
                <th className={thCls}>Sales Officer</th>
                <th className={thCls}>Operator</th>
                <th className={thCls}>Started At</th>
                <th className={thCls}>Elapsed</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {inProgressOrderRows.length === 0 && inProgressSplitRows.length === 0 ? (
                <tr><td colSpan={13} className="px-3 py-6 text-center text-[12px] text-gray-400 italic">No orders in progress</td></tr>
              ) : (
                <>
                  {inProgressOrderRows.map((order) => {
                    const startedAt = order.tintAssignments[0]?.startedAt ?? null;
                    return (
                      <tr key={`ipo-${order.id}`} onClick={() => onOrderClick(order)} className={ROW_CLS}>
                        <ObdOrderCell order={order} />
                        <td className={tdCls}>
                          <span className="font-medium text-gray-900 text-[12.5px]">{order.customer?.customerName ?? order.shipToCustomerName ?? "—"}</span>
                          {order.customerMissing && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onCustomerMissing?.(order); }}
                              className="mt-0.5 flex items-center gap-1 text-[10.5px] font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 px-1.5 py-0.5 rounded transition-colors"
                            >
                              ⚠ Customer Missing
                            </button>
                          )}
                        </td>
                        <td className={tdCls}>{order.customer?.area.name ?? "—"}</td>
                        <td className={tdCls}><SmuBadge smu={order.smu} /></td>
                        <td className={tdCls}><SlotBadge slot={order.dispatchSlot} /></td>
                        <td className={tdCls}><PriorityBadge level={order.priorityLevel} /></td>
                        <td className={tdCls}><span className="font-mono text-[11px] text-gray-500">{order.querySnapshot?.articleTag ?? "—"}</span></td>
                        <td className={tdCls}>{order.querySnapshot?.totalVolume != null ? `${Math.round(order.querySnapshot.totalVolume)} L` : "—"}</td>
                        <td className={tdCls}><span className="text-[11.5px] text-gray-500">{order.customer?.salesOfficerGroup?.salesOfficer?.name ?? "—"}</span></td>
                        <td className={tdCls}><OperatorDisplay name={order.tintAssignments[0]?.assignedTo.name} /></td>
                        <td className={tdCls}><span className="text-[11.5px] text-gray-400 whitespace-nowrap">{formatTime(startedAt)}</span></td>
                        <td className={tdCls}><ElapsedBadge startedAt={startedAt} /></td>
                        <td className={tdCls} onClick={(e) => e.stopPropagation()}><PlusBtn id={order.id} type="order" onStatusPopover={onStatusPopover} /></td>
                      </tr>
                    );
                  })}
                  {inProgressSplitRows.map((split) => (
                    <tr key={`ips-${split.id}`} onClick={() => onSplitClick(split)} className={ROW_CLS}>
                      <ObdSplitCell split={split} />
                      <td className={tdCls}><span className="font-medium text-gray-900 text-[12.5px]">{split.order.customer?.customerName ?? "—"}</span></td>
                      <td className={tdCls}>—</td>
                      <td className={tdCls}><SmuBadge smu={split.smu} /></td>
                      <td className={tdCls}><SlotBadge slot={null} /></td>
                      <td className={tdCls}><PriorityBadge level={split.priorityLevel} /></td>
                      <td className={tdCls}><span className="font-mono text-[11px] text-gray-500">{split.articleTag ?? `${split.totalQty} units`}</span></td>
                      <td className={tdCls}>{split.totalVolume != null ? `${Math.round(split.totalVolume)} L` : "—"}</td>
                      <td className={tdCls}><span className="text-[11.5px] text-gray-500">{split.order.customer?.salesOfficerGroup?.salesOfficer?.name ?? "—"}</span></td>
                      <td className={tdCls}><OperatorDisplay name={split.assignedTo.name} /></td>
                      <td className={tdCls}><span className="text-[11.5px] text-gray-400 whitespace-nowrap">{formatTime(split.startedAt)}</span></td>
                      <td className={tdCls}><ElapsedBadge startedAt={split.startedAt} /></td>
                      <td className={tdCls} onClick={(e) => e.stopPropagation()}><PlusBtn id={split.id} type="split" onStatusPopover={onStatusPopover} /></td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 4: Completed Today ──────────────────────────────────────── */}
      <div className="mb-5">
        <SectionHeader dotClass="bg-green-400" label="Completed Today" count={completedSplitRows.length + completedAssignmentRows.length} note="Tinting done · resets midnight" colorScheme="green" />
        <div className="bg-white border border-[#e2e5f1] border-t-0 rounded-b-[10px] overflow-hidden">
          <table className="w-full border-collapse text-[12px]">
            <thead className="bg-[#f3f4f8] border-b border-[#e2e5f1]">
              <tr>
                <th className={thCls}>OBD No.</th>
                <th className={thCls}>Customer</th>
                <th className={thCls}>Area</th>
                <th className={thCls}>SMU</th>
                <th className={thCls}>Slot</th>
                <th className={thCls}>Priority</th>
                <th className={thCls}>Articles</th>
                <th className={thCls}>Volume</th>
                <th className={thCls}>Sales Officer</th>
                <th className={thCls}>Operator</th>
                <th className={thCls}>Completed At</th>
                <th className={thCls}>Dispatch Status</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {completedSplitRows.length === 0 && completedAssignmentRows.length === 0 ? (
                <tr><td colSpan={13} className="px-3 py-6 text-center text-[12px] text-gray-400 italic">No completed orders today</td></tr>
              ) : (
                <>
                  {completedSplitRows.map((split) => (
                    <tr key={`cs-${split.id}`} onClick={() => onSplitClick(split)} className={ROW_CLS}>
                      <ObdSplitCell split={split} />
                      <td className={tdCls}><span className="font-medium text-gray-900 text-[12.5px]">{split.order.customer?.customerName ?? "—"}</span></td>
                      <td className={tdCls}>—</td>
                      <td className={tdCls}><SmuBadge smu={split.smu} /></td>
                      <td className={tdCls}><SlotBadge slot={null} /></td>
                      <td className={tdCls}><PriorityBadge level={split.priorityLevel} /></td>
                      <td className={tdCls}><span className="font-mono text-[11px] text-gray-500">{split.articleTag ?? `${split.totalQty} units`}</span></td>
                      <td className={tdCls}>{split.totalVolume != null ? `${Math.round(split.totalVolume)} L` : "—"}</td>
                      <td className={tdCls}><span className="text-[11.5px] text-gray-500">{split.order.customer?.salesOfficerGroup?.salesOfficer?.name ?? "—"}</span></td>
                      <td className={tdCls}><OperatorDisplay name={split.assignedTo.name} /></td>
                      <td className={tdCls}><span className="text-[11.5px] text-gray-400 whitespace-nowrap">{formatTime(split.completedAt)}</span></td>
                      <td className={tdCls}><DispatchStatusBadges dispatchStatus={split.dispatchStatus} /></td>
                      <td className={tdCls} onClick={(e) => e.stopPropagation()}><PlusBtn id={split.id} type="split" onStatusPopover={onStatusPopover} /></td>
                    </tr>
                  ))}
                  {completedAssignmentRows.map((a) => {
                    const order = assignmentAsOrder(a);
                    return (
                      <tr key={`ca-${a.id}`} onClick={() => onOrderClick(order)} className={ROW_CLS}>
                        <td className={tdCls}>
                          <div className="font-mono text-[11px] font-medium text-[#1a237e]">{a.order.obdNumber}</div>
                          {(a.obdEmailDate || a.completedAt) && (
                            <div className="text-[10.5px] text-gray-400 mt-[2px]">
                              {formatObdDate(a.obdEmailDate, a.obdEmailTime) || formatTime(a.completedAt)}
                            </div>
                          )}
                        </td>
                        <td className={tdCls}><span className="font-medium text-gray-900 text-[12.5px]">{a.order.customer?.customerName ?? a.order.shipToCustomerName ?? "—"}</span></td>
                        <td className={tdCls}>{a.order.customer?.area.name ?? "—"}</td>
                        <td className={tdCls}><SmuBadge smu={a.smu} /></td>
                        <td className={tdCls}><SlotBadge slot={null} /></td>
                        <td className={tdCls}><PriorityBadge level={5} /></td>
                        <td className={tdCls}><span className="font-mono text-[11px] text-gray-500">{a.order.querySnapshot?.articleTag ?? "—"}</span></td>
                        <td className={tdCls}>{a.order.querySnapshot?.totalVolume != null ? `${Math.round(a.order.querySnapshot.totalVolume)} L` : "—"}</td>
                        <td className={tdCls}><span className="text-[11.5px] text-gray-500">{a.order.customer?.salesOfficerGroup?.salesOfficer?.name ?? "—"}</span></td>
                        <td className={tdCls}><OperatorDisplay name={a.assignedTo.name} /></td>
                        <td className={tdCls}><span className="text-[11.5px] text-gray-400 whitespace-nowrap">{formatTime(a.completedAt)}</span></td>
                        <td className={tdCls}><DispatchStatusBadges dispatchStatus={null} /></td>
                        <td className={tdCls} onClick={(e) => e.stopPropagation()}><PlusBtn id={a.order.id} type="order" onStatusPopover={onStatusPopover} /></td>
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
