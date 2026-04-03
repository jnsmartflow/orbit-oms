"use client";

import { useState } from "react";
import { Check, Copy, ChevronDown } from "lucide-react";
import { formatTime } from "@/lib/mail-orders/utils";
import type { MoOrder, MoOrderLine } from "@/lib/mail-orders/types";
import { ResolveLinePanel } from "./resolve-line-panel";

// ── Props ────────────────────────────────────────────────────────────────────

interface MailOrdersTableProps {
  groupedOrders: Record<string, MoOrder[]>;
  flaggedIds: Set<number>;
  expandedId: number | null;
  focusedId: number | null;
  copiedId: number | null;
  onFlag: (id: number) => void;
  onExpand: (id: number | null) => void;
  onPunch: (id: number) => Promise<void>;
  onCopy: (id: number, lines: MoOrderLine[]) => void;
}

// ─�� Slot dot colors ──────────────────────────────────────────────────────────

const SLOT_DOTS: Record<string, string> = {
  Morning: "bg-amber-400",
  Afternoon: "bg-blue-500",
  Evening: "bg-purple-500",
  Night: "bg-gray-400",
};

// ── Helpers ─────���──────────────────────────���─────────────────────────────────

function formatReceivedDate(receivedAt: string): string {
  const d = new Date(receivedAt);
  const day = d.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit" });
  const mon = d.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", month: "short" });
  const time = d.toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${day} ${mon} \u00b7 ${time}`;
}

// ── Component ────���──────────────────────────────────────��────────────────────

export function MailOrdersTable({
  groupedOrders,
  flaggedIds,
  expandedId,
  focusedId,
  copiedId,
  onFlag,
  onExpand,
  onPunch,
  onCopy,
}: MailOrdersTableProps) {
  const slotOrder = ["Morning", "Afternoon", "Evening", "Night"] as const;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 68 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 220 }} />
          <col style={{ width: 64 }} />
          <col style={{ width: 180 }} />
          <col style={{ width: 76 }} />
          <col style={{ width: 56 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 130 }} />
        </colgroup>

        <thead>
          <tr className="h-[34px] bg-white border-b border-gray-200">
            <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
              Time
            </th>
            <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
              SO Name
            </th>
            <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
              Customer
            </th>
            <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-center px-3.5">
              Lines
            </th>
            <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
              Remarks
            </th>
            <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-center px-3.5">
              OD/CI
            </th>
            <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-right px-3.5">
              Copy
            </th>
            <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-right px-3.5">
              Status
            </th>
            <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-right px-3.5">
              Punched By
            </th>
          </tr>
        </thead>

        <tbody>
          {slotOrder.map((slot) => {
            const orders = groupedOrders[slot];
            if (!orders || orders.length === 0) return null;

            const slotMatched = orders.reduce((s, o) => s + o.matchedLines, 0);
            const slotTotal = orders.reduce((s, o) => s + o.totalLines, 0);

            return (
              <SlotGroup
                key={slot}
                slot={slot}
                orders={orders}
                slotMatched={slotMatched}
                slotTotal={slotTotal}
                flaggedIds={flaggedIds}
                expandedId={expandedId}
                focusedId={focusedId}
                copiedId={copiedId}
                onFlag={onFlag}
                onExpand={onExpand}
                onPunch={onPunch}
                onCopy={onCopy}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Slot group ──────────────────────────────────────────────���────────────────

function SlotGroup({
  slot,
  orders,
  slotMatched,
  slotTotal,
  flaggedIds,
  expandedId,
  focusedId,
  copiedId,
  onFlag,
  onExpand,
  onPunch,
  onCopy,
}: {
  slot: string;
  orders: MoOrder[];
  slotMatched: number;
  slotTotal: number;
  flaggedIds: Set<number>;
  expandedId: number | null;
  focusedId: number | null;
  copiedId: number | null;
  onFlag: (id: number) => void;
  onExpand: (id: number | null) => void;
  onPunch: (id: number) => Promise<void>;
  onCopy: (id: number, lines: MoOrderLine[]) => void;
}) {
  const dotColor = SLOT_DOTS[slot] ?? "bg-gray-400";

  return (
    <>
      {/* Section header */}
      <tr>
        <td
          colSpan={9}
          className="h-[36px] bg-gray-50 border-t border-b border-gray-200 px-[18px]"
        >
          <div className="flex items-center justify-between h-full">
            <div className="flex items-center gap-2">
              <span className={`w-[7px] h-[7px] rounded-full ${dotColor}`} />
              <span className="text-[12px] font-semibold text-gray-700">{slot}</span>
              <span className="text-[11px] text-gray-400">
                {orders.length} order{orders.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="text-[11px] text-gray-400">
              <span className="font-semibold text-gray-700">{slotMatched}</span>
              /{slotTotal} lines
            </div>
          </div>
        </td>
      </tr>

      {/* Data rows */}
      {orders.map((order) => {
        const isFlagged = flaggedIds.has(order.id);
        const isPunched = order.status === "punched";
        const isFocused = focusedId === order.id;
        const isExpanded = expandedId === order.id;

        return (
          <OrderRow
            key={order.id}
            order={order}
            isFlagged={isFlagged}
            isPunched={isPunched}
            isFocused={isFocused}
            isExpanded={isExpanded}
            copiedId={copiedId}
            onFlag={onFlag}
            onExpand={onExpand}
            onPunch={onPunch}
            onCopy={onCopy}
          />
        );
      })}
    </>
  );
}

// ── Order row ────────────���───────────────────────────────────────────────────

function OrderRow({
  order,
  isFlagged,
  isPunched,
  isFocused,
  isExpanded,
  copiedId,
  onFlag,
  onExpand,
  onPunch,
  onCopy,
}: {
  order: MoOrder;
  isFlagged: boolean;
  isPunched: boolean;
  isFocused: boolean;
  isExpanded: boolean;
  copiedId: number | null;
  onFlag: (id: number) => void;
  onExpand: (id: number | null) => void;
  onPunch: (id: number) => Promise<void>;
  onCopy: (id: number, lines: MoOrderLine[]) => void;
}) {
  const hasUnmatched = order.matchedLines < order.totalLines;
  const matchedCount = order.lines.filter((l) => l.matchStatus === "matched").length;
  const isDisabled = isFlagged || isPunched || matchedCount === 0;
  const isCopied = copiedId === order.id;

  const baseTdClass = [
    isFocused && 'bg-amber-50/40',
    isPunched && 'bg-teal-50/40',
  ].filter(Boolean).join(' ');

  const borderLeft = isFlagged
    ? "3px solid #f87171"
    : isFocused
      ? "3px solid #f59e0b"
      : isPunched
        ? "3px solid #0d9488"
        : undefined;
  const needsBorderCompensation = isFlagged || isFocused || isPunched;

  // Remarks display
  let remarksContent: React.ReactNode;
  if (isFlagged && order.remarks) {
    remarksContent = (
      <span className="text-[11px] text-red-400 truncate block">
        {order.remarks}
      </span>
    );
  } else if (order.deliveryRemarks) {
    remarksContent = (
      <span className="text-[11px] text-gray-400 truncate block">
        {order.deliveryRemarks}
      </span>
    );
  } else {
    remarksContent = <span className="text-gray-300">—</span>;
  }

  return (
    <>
      <tr
        data-order-id={order.id}
        className="h-[52px] border-b border-gray-100 hover:bg-gray-50/50 cursor-pointer"
        style={{ borderLeft, opacity: isPunched ? 0.75 : undefined }}
        onClick={() => onExpand(order.id)}
      >
        {/* Time */}
        <td
          className={`px-3.5 align-middle ${baseTdClass}`}
          style={{ paddingLeft: needsBorderCompensation ? 11 : undefined }}
        >
          <span className="font-mono text-[12px] font-semibold text-gray-900">
            {formatTime(order.receivedAt)}
          </span>
        </td>

        {/* SO Name */}
        <td className={`px-3.5 align-middle ${baseTdClass}`}>
          <span
            title={order.soName}
            className="text-[11px] text-gray-500 truncate block max-w-[120px]"
          >
            {order.soName}
          </span>
        </td>

        {/* Customer */}
        <td className={`px-3.5 align-middle ${baseTdClass}`}>
          {(() => {
            const customerDisplay = order.customerName ?? order.subject;
            const subjectSnippet = order.subject !== customerDisplay ? order.subject : null;
            return (
              <div className="overflow-hidden min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    title={customerDisplay}
                    className="text-[12.5px] font-semibold text-gray-900 truncate"
                  >
                    {customerDisplay}
                  </span>
                  {isFlagged && (
                    <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 flex-shrink-0">
                      OD/CI
                    </span>
                  )}
                </div>
                {subjectSnippet && (
                  <span
                    title={subjectSnippet}
                    className="text-[11px] text-gray-400 truncate block"
                  >
                    — {subjectSnippet}
                  </span>
                )}
              </div>
            );
          })()}
        </td>

        {/* Lines */}
        <td className={`px-3.5 align-middle text-center ${baseTdClass}`}>
          {hasUnmatched ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onExpand(order.id);
              }}
              className="text-[12px] font-semibold text-amber-600 inline-flex items-center gap-0.5"
            >
              <ChevronDown
                size={10}
                className={isExpanded ? "rotate-180 transition-transform" : "transition-transform"}
              />
              {order.matchedLines}/{order.totalLines}
            </button>
          ) : (
            <span className="text-[12px] font-semibold text-green-600">
              {order.matchedLines}/{order.totalLines}
            </span>
          )}
        </td>

        {/* Remarks */}
        <td className={`px-3.5 align-middle ${baseTdClass}`}>{remarksContent}</td>

        {/* OD/CI */}
        <td className={`px-3.5 align-middle text-center ${baseTdClass}`}>
          {isPunched ? (
            <span className="text-gray-300 text-[11px]">—</span>
          ) : isFlagged ? (
            <button
              onClick={(e) => { e.stopPropagation(); onFlag(order.id) }}
              className="inline-flex items-center gap-1 border border-red-300 rounded-md text-[10.5px] font-medium text-red-600 px-2 h-[24px] bg-red-50 whitespace-nowrap"
            >
              ⚑ Flagged
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onFlag(order.id) }}
              className="inline-flex items-center gap-1 border border-gray-200 rounded-md text-[10.5px] font-medium text-gray-400 px-2 h-[24px] bg-white hover:border-red-300 hover:text-red-500 transition-colors whitespace-nowrap"
            >
              ⚑ Flag
            </button>
          )}
        </td>

        {/* Copy */}
        <td className={`px-3.5 align-middle text-right ${baseTdClass}`}>
          <button
            disabled={isDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onCopy(order.id, order.lines);
            }}
            className={`inline-flex items-center gap-1 border rounded-md text-[11px] font-medium px-2 h-[28px] transition-colors ${
              isCopied
                ? "bg-green-50 border-green-200 text-green-700"
                : isDisabled
                  ? "border-gray-100 text-gray-300 cursor-not-allowed"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {isCopied ? (
              <>
                <Check size={11} /> ✓
              </>
            ) : isDisabled ? (
              <Copy size={11} />
            ) : (
              <>
                <Copy size={11} /> {matchedCount}
              </>
            )}
          </button>
        </td>

        {/* Status */}
        <td className={`px-3.5 align-middle text-right ${baseTdClass}`}>
          {isPunched ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-md px-2.5 h-[26px]">
              <Check size={9} /> Done
            </span>
          ) : isFlagged ? (
            <button
              disabled
              className="inline-flex items-center gap-1 border border-gray-100 rounded-md text-[11px] font-medium px-2.5 h-[28px] text-gray-300 cursor-not-allowed"
            >
              <Check size={10} /> Punched
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPunch(order.id);
              }}
              className="inline-flex items-center gap-1 border border-gray-200 rounded-md text-[11px] font-medium px-2.5 h-[28px] text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Check size={10} /> Punched
            </button>
          )}
        </td>

        {/* Punched By */}
        {isPunched ? (
          <td className={`text-right ${baseTdClass}`} style={{ paddingRight: 14 }}>
            <div className="text-[11px] font-medium text-gray-600 truncate">
              {order.punchedBy?.name ?? 'operator'}
            </div>
            <div className="text-[10px] text-gray-400 font-mono">
              {formatTime(order.punchedAt!)}
            </div>
          </td>
        ) : (
          <td className={baseTdClass} />
        )}
      </tr>

      {/* Expand sub-row */}
      {isExpanded && <ExpandRow order={order} />}
    </>
  );
}

// ── Expand sub-row ───────────────────────────────────────────────────────────

function ExpandRow({ order }: { order: MoOrder }) {
  const [resolveLineId, setResolveLineId] = useState<number | null>(null);
  const [resolvedLines, setResolvedLines] = useState<
    Record<number, { skuCode: string; skuDescription: string }>
  >({});

  function handleResolved(lineId: number, skuCode: string, skuDescription: string) {
    setResolvedLines((prev) => ({ ...prev, [lineId]: { skuCode, skuDescription } }));
    setResolveLineId(null);
  }

  return (
    <tr>
      <td
        colSpan={9}
        style={{ padding: 0, background: "#fafafa", borderBottom: "1px solid #e5e7eb" }}
      >
        {/* Line items table */}
        <table className="w-full border-collapse">
          <colgroup>
            <col style={{ width: 38 }} />
            <col />
            <col style={{ width: 150 }} />
            <col style={{ width: 48 }} />
            <col style={{ width: 52 }} />
            <col style={{ width: 76 }} />
          </colgroup>
          <thead>
            <tr className="h-[32px] bg-gray-50" style={{ borderBottom: "1px solid #ebebeb" }}>
              <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
                #
              </th>
              <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
                Raw Text
              </th>
              <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
                SKU Code
              </th>
              <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-center px-3.5">
                Pk
              </th>
              <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-right px-3.5">
                Qty
              </th>
              <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-center px-3.5">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line, idx) => {
              const resolved = resolvedLines[line.id];
              const isMatched = line.matchStatus === "matched" || !!resolved;
              const isLast = idx === order.lines.length - 1;
              const unmatchedBg = !isMatched ? "bg-amber-50/40" : undefined;

              // Show resolve panel instead of normal row
              if (resolveLineId === line.id) {
                return (
                  <ResolveLinePanel
                    key={line.id}
                    line={line}
                    onResolved={handleResolved}
                    onCancel={() => setResolveLineId(null)}
                  />
                );
              }

              return (
                <tr
                  key={line.id}
                  className="h-[36px] hover:bg-gray-50"
                  style={{ borderBottom: isLast ? undefined : "1px solid #f0f0f0" }}
                >
                  <td className={`px-3.5 align-middle text-[11px] text-gray-400 ${unmatchedBg ?? ""}`}>
                    {line.lineNumber}
                  </td>
                  <td className={`px-3.5 align-middle text-[11px] text-gray-700 ${unmatchedBg ?? ""}`}>
                    {line.rawText}
                  </td>
                  <td className={`px-3.5 align-middle ${unmatchedBg ?? ""}`}>
                    {isMatched ? (
                      <span className="font-mono text-[11px] text-gray-500">
                        {resolved?.skuCode ?? line.skuCode}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className={`px-3.5 align-middle text-center text-[11px] text-gray-500 ${unmatchedBg ?? ""}`}>
                    {line.packCode ?? "—"}
                  </td>
                  <td className={`px-3.5 align-middle text-right text-[11px] text-gray-700 font-medium ${unmatchedBg ?? ""}`}>
                    {line.quantity}
                  </td>
                  <td className={`px-3.5 align-middle text-center ${unmatchedBg ?? ""}`}>
                    {isMatched ? (
                      <span className="text-green-600 font-semibold text-[13px]">✓</span>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setResolveLineId(line.id);
                        }}
                        className="text-[10px] font-semibold text-amber-600 border border-amber-300 rounded px-1.5 py-0.5 bg-white hover:bg-amber-50 transition-colors"
                      >
                        ⚠ Fix
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Remarks footer */}
        <div
          className="bg-gray-50/80"
          style={{ borderTop: "1px solid #ebebeb", padding: "12px 16px 14px" }}
        >
          <div className="grid grid-cols-[1fr_1fr_1fr_160px] gap-5">
            <div>
              <p className="text-[9.5px] font-bold uppercase tracking-[0.4px] text-gray-400 mb-1">
                Delivery Remarks
              </p>
              <p className="text-[11.5px] text-gray-600">
                {order.deliveryRemarks ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-[9.5px] font-bold uppercase tracking-[0.4px] text-gray-400 mb-1">
                Body Remarks
              </p>
              <p className="text-[11.5px] text-gray-600">
                {order.remarks ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-[9.5px] font-bold uppercase tracking-[0.4px] text-gray-400 mb-1">
                Bill Remarks
              </p>
              <p className="text-[11.5px] text-gray-600">
                {order.billRemarks ?? "—"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[9.5px] font-bold uppercase tracking-[0.4px] text-gray-400 mb-1">
                Received
              </p>
              <p className="font-mono text-[11px] text-gray-400">
                {formatReceivedDate(order.receivedAt)}
              </p>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
