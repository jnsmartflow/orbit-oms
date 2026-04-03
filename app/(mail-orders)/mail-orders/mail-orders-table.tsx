"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Check, Copy, ChevronDown, Pencil, Search } from "lucide-react";
import { formatTime } from "@/lib/mail-orders/utils";
import { searchCustomers } from "@/lib/mail-orders/api";
import type { MoOrder, MoOrderLine, CustomerSearchResult } from "@/lib/mail-orders/types";
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
  onSaveSoNumber: (orderId: number, value: string) => Promise<boolean>;
  onSaveCustomer: (orderId: number, data: { customerCode: string; customerName: string; saveKeyword?: boolean; keyword?: string; area?: string; deliveryType?: string; route?: string }) => Promise<void>;
  openCodePopoverId: number | null;
  setOpenCodePopoverId: (id: number | null) => void;
}

// ── Slot dot colors ──────────────────────────────────────────────────────────

const SLOT_DOTS: Record<string, string> = {
  Morning: "bg-amber-400",
  Afternoon: "bg-blue-500",
  Evening: "bg-purple-500",
  Night: "bg-gray-400",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function cleanSubject(subject: string): string {
  let s = subject;
  s = s.replace(/^(?:(?:fw|fwd|re)\s*:\s*)+/i, "");
  s = s.replace(/^Order\s*:\s*/i, "");
  s = s.replace(/^Order\s+for\s+/i, "");
  s = s.replace(/^Order-\d+\s*/i, "");
  s = s.replace(/^Order\s+/i, "");
  s = s.replace(/^\d{4,}\s*/, ""); // strip leading code
  s = s.replace(/\s*-\s*order$/i, "");
  s = s.replace(/\.+$/, "");
  return s.trim() || subject.trim();
}

function extractSubjectCode(subject: string): string | null {
  const m = subject.match(/Order[\s:\-]*(\d{4,})/i);
  return m ? m[1] : null;
}

const DELIVERY_DOT: Record<string, string> = {
  Local: "bg-blue-600",
  UPC: "bg-orange-600",
  IGT: "bg-teal-600",
  Cross: "bg-rose-600",
};

// ── Component ────────────────────────────────────────────────────────────────

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
  onSaveSoNumber,
  onSaveCustomer,
  openCodePopoverId,
  setOpenCodePopoverId,
}: MailOrdersTableProps) {
  const slotOrder = ["Morning", "Afternoon", "Evening", "Night"] as const;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 68 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 220 }} />
          <col style={{ width: 54 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 140 }} />
          <col style={{ width: 90 }} />
          <col style={{ width: 60 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 70 }} />
          <col style={{ width: 100 }} />
          <col style={{ width: 120 }} />
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
            <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-center px-3.5">
              Dispatch
            </th>
            <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
              Remarks
            </th>
            <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
              Code
            </th>
            <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-right px-3.5">
              SKU
            </th>
            <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
              SO No.
            </th>
            <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-center px-3.5">
              OD/CI
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
                onSaveSoNumber={onSaveSoNumber}
                onSaveCustomer={onSaveCustomer}
                openCodePopoverId={openCodePopoverId}
                setOpenCodePopoverId={setOpenCodePopoverId}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Slot group ───────────────────────────────────────────────────────────────

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
  onSaveSoNumber,
  onSaveCustomer,
  openCodePopoverId,
  setOpenCodePopoverId,
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
  onSaveSoNumber: (orderId: number, value: string) => Promise<boolean>;
  onSaveCustomer: MailOrdersTableProps["onSaveCustomer"];
  openCodePopoverId: number | null;
  setOpenCodePopoverId: (id: number | null) => void;
}) {
  const dotColor = SLOT_DOTS[slot] ?? "bg-gray-400";

  return (
    <>
      {/* Section header */}
      <tr>
        <td
          colSpan={12}
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
            onSaveSoNumber={onSaveSoNumber}
            onSaveCustomer={onSaveCustomer}
            openCodePopoverId={openCodePopoverId}
            setOpenCodePopoverId={setOpenCodePopoverId}
          />
        );
      })}
    </>
  );
}

// ── Code Cell ────────────────────────────────────────────────────────────────

function CodeCell({
  order,
  baseTdClass,
  onSaveCustomer,
  isOpen,
  onToggle,
}: {
  order: MoOrder;
  baseTdClass: string;
  onSaveCustomer: MailOrdersTableProps["onSaveCustomer"];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) { setShowSearch(false); return; }
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onToggle();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen, onToggle]);

  const [showSearch, setShowSearch] = useState(false);

  // Focus search input on open
  useEffect(() => {
    if (isOpen && (order.customerMatchStatus !== "multiple" || showSearch)) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen, order.customerMatchStatus, showSearch]);

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;
    if (searchQuery.length < 2) { setSearchResults([]); setSearched(false); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchCustomers(searchQuery);
        setSearchResults(results);
        setSearched(true);
      } catch { setSearchResults([]); }
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, isOpen, order.customerMatchStatus]);

  function handleCopyCode() {
    if (!order.customerCode) return;
    navigator.clipboard.writeText(order.customerCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
  }

  async function handlePickCandidate(c: { customerCode: string; customerName: string; area?: string | null; deliveryType?: string | null; route?: string | null }, fromSearch: boolean) {
    const shouldSaveKeyword = fromSearch && searchQuery.length >= 3 && !/^\d+$/.test(searchQuery);
    await onSaveCustomer(order.id, {
      customerCode: c.customerCode,
      customerName: c.customerName,
      saveKeyword: shouldSaveKeyword,
      keyword: shouldSaveKeyword ? searchQuery : undefined,
      area: c.area ?? undefined,
      deliveryType: c.deliveryType ?? undefined,
      route: c.route ?? undefined,
    });
    onToggle();
  }

  const status = order.customerMatchStatus ?? "unmatched";

  const searchPopover = (
    <div ref={popoverRef} className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-[320px]">
      <input
        ref={searchInputRef}
        type="text"
        placeholder="Type customer name or code..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="text-[12px] h-[32px] px-2 border border-gray-200 rounded-md w-full focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 focus:outline-none"
      />
      <div className="max-h-[180px] overflow-y-auto mt-2">
        {searching && <p className="text-[11px] text-gray-400 px-1 py-2">Searching...</p>}
        {!searching && searched && searchResults.length === 0 && (
          <p className="text-[11px] text-gray-400 px-1 py-2">No customers found</p>
        )}
        {!searching && searchResults.map((c) => (
          <div
            key={c.customerCode}
            onClick={() => handlePickCandidate(c, true)}
            className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer"
          >
            <span className="font-mono text-[11px] text-gray-800 flex-shrink-0">{c.customerCode}</span>
            <div className="min-w-0">
              <div className="text-[11px] text-gray-600 truncate">{c.customerName}</div>
              {(c.area || c.route) && (
                <div className="text-[10px] text-gray-400 truncate">
                  {[c.area, c.route].filter(Boolean).join(" \u00b7 ")}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // STATE 1: Exact match
  if (status === "exact" && order.customerCode) {
    return (
      <td className={`px-2 align-middle relative group ${baseTdClass}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span
            onClick={handleCopyCode}
            className={`font-mono text-[11px] cursor-pointer rounded px-1.5 py-0.5 border transition-colors ${
              codeCopied
                ? "bg-teal-50 border-teal-200 text-teal-700"
                : "text-gray-800 bg-gray-50 border-gray-200 hover:bg-gray-100 hover:border-gray-300"
            }`}
          >
            {order.customerCode}
          </span>
          <button
            onClick={() => { setShowSearch(true); onToggle(); }}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity"
          >
            <Pencil size={10} />
          </button>
        </div>
        {isOpen && showSearch && searchPopover}
      </td>
    );
  }

  // STATE 2: Multiple matches
  if (status === "multiple" && order.customerCandidates) {
    let candidates: { code: string; name: string; area?: string | null; deliveryType?: string | null; route?: string | null }[] = [];
    try { candidates = JSON.parse(order.customerCandidates); } catch { /* empty */ }

    return (
      <td className={`px-2 align-middle relative ${baseTdClass}`} onClick={(e) => e.stopPropagation()}>
        <span
          onClick={onToggle}
          className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 cursor-pointer hover:bg-amber-100"
        >
          {candidates.length} found
        </span>
        {isOpen && (
          <div ref={popoverRef} className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-[280px] max-h-[240px] overflow-y-auto">
            {candidates.map((c) => (
              <div
                key={c.code}
                onClick={() => handlePickCandidate({ customerCode: c.code, customerName: c.name, area: c.area, deliveryType: c.deliveryType, route: c.route }, false)}
                className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer"
              >
                <span className="font-mono text-[11px] text-gray-800 flex-shrink-0">{c.code}</span>
                <div className="min-w-0">
                  <div className="text-[11px] text-gray-600 truncate">{c.name}</div>
                  {(c.area || c.route) && (
                    <div className="text-[10px] text-gray-400 truncate">
                      {[c.area, c.route].filter(Boolean).join(" \u00b7 ")}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </td>
    );
  }

  // STATE 3: Unmatched
  return (
    <td className={`px-2 align-middle relative ${baseTdClass}`} onClick={(e) => e.stopPropagation()}>
      <span
        onClick={onToggle}
        className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-600 inline-flex items-center gap-0.5"
      >
        <Search size={9} /> Search
      </span>
      {isOpen && searchPopover}
    </td>
  );
}

// ── Order row ────────────────────────────────────────────────────────────────

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
  onSaveSoNumber,
  onSaveCustomer,
  openCodePopoverId,
  setOpenCodePopoverId,
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
  onSaveSoNumber: (orderId: number, value: string) => Promise<boolean>;
  onSaveCustomer: MailOrdersTableProps["onSaveCustomer"];
  openCodePopoverId: number | null;
  setOpenCodePopoverId: (id: number | null) => void;
}) {
  const hasUnmatched = order.matchedLines < order.totalLines;
  const matchedCount = order.lines.filter((l) => l.matchStatus === "matched").length;
  const isDisabled = isFlagged || isPunched || matchedCount === 0;
  const isCopied = copiedId === order.id;

  const [editingSo, setEditingSo] = useState(false);
  const [soInput, setSoInput] = useState(order.soNumber ?? "");
  const [soError, setSoError] = useState(false);
  const soInputRef = useRef<HTMLInputElement>(null);

  async function handleSoSave() {
    const val = soInput.trim();
    if (!val) { setEditingSo(false); setSoInput(order.soNumber ?? ""); return; }
    if (!/^\d{10}$/.test(val)) {
      setSoError(true);
      setTimeout(() => setSoError(false), 1500);
      return;
    }
    const ok = await onSaveSoNumber(order.id, val);
    if (ok) setEditingSo(false);
  }

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

  const handleCodeToggle = useCallback(() => {
    setOpenCodePopoverId(openCodePopoverId === order.id ? null : order.id);
  }, [openCodePopoverId, order.id, setOpenCodePopoverId]);

  return (
    <>
      <tr
        data-order-id={order.id}
        data-urgent={(!isPunched && (order.dispatchStatus === "Hold" || order.dispatchPriority === "Urgent")) ? "true" : undefined}
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
            const isExact = order.customerMatchStatus === "exact";
            const displayName = isExact && order.customerName
              ? order.customerName
              : cleanSubject(order.subject);
            const subjectCode = extractSubjectCode(order.subject);
            const delType = order.customerDeliveryType;
            const dotColor = delType ? DELIVERY_DOT[delType] : null;
            const area = isExact ? order.customerArea : null;
            const subtextParts = [area, subjectCode].filter(Boolean);
            return (
              <div className="overflow-hidden min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  {dotColor && (
                    <span className={`w-[5px] h-[5px] rounded-full ${dotColor} flex-shrink-0`} title={delType!} />
                  )}
                  <span
                    title={displayName}
                    className="text-[12.5px] font-semibold text-gray-900 truncate"
                  >
                    {displayName}
                  </span>
                  {isFlagged && (
                    <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 flex-shrink-0">
                      OD/CI
                    </span>
                  )}
                </div>
                {subtextParts.length > 0 && (
                  <span className="text-[10px] text-gray-400 truncate block">
                    {subtextParts.join(" \u00b7 ")}
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

        {/* Dispatch */}
        <td className={`px-2 align-middle text-center ${baseTdClass}`}>
          {(() => {
            const isHold = order.dispatchStatus === "Hold";
            const isUrgent = order.dispatchPriority === "Urgent";
            const label = isHold && isUrgent ? "Hold \u00b7 Urgent"
              : isHold ? "Hold"
              : isUrgent ? "Urgent"
              : "Dispatch";
            const style = isHold
              ? "bg-red-50 text-red-700 border-red-200"
              : isUrgent
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-green-50 text-green-700 border-green-200";
            return (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${style}`}>
                {label}
              </span>
            );
          })()}
        </td>

        {/* Remarks */}
        <td className={`px-3.5 align-middle ${baseTdClass}`}>{remarksContent}</td>

        {/* Code */}
        <CodeCell
          order={order}
          baseTdClass={baseTdClass}
          onSaveCustomer={onSaveCustomer}
          isOpen={openCodePopoverId === order.id}
          onToggle={handleCodeToggle}
        />

        {/* SKU */}
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

        {/* SO No. */}
        <td
          className={`px-2 align-middle ${baseTdClass}`}
          onClick={(e) => e.stopPropagation()}
        >
          {order.soNumber && !editingSo ? (
            <div className="flex items-center gap-1 group">
              <span className="font-mono text-[11px] text-gray-800">
                {order.soNumber}
              </span>
              <button
                onClick={() => { setEditingSo(true); setSoInput(order.soNumber ?? ""); }}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity"
              >
                <Pencil size={10} />
              </button>
            </div>
          ) : (
            <input
              ref={soInputRef}
              type="text"
              placeholder="SO Number"
              maxLength={10}
              value={soInput}
              onChange={(e) => { setSoInput(e.target.value); setSoError(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleSoSave(); if (e.key === "Escape") { setEditingSo(false); setSoInput(order.soNumber ?? ""); } }}
              onBlur={() => handleSoSave()}
              className={`w-full border rounded px-2 h-[26px] text-[11px] font-mono text-gray-800 focus:border-teal-500 focus:outline-none placeholder:text-gray-300 ${
                soError ? "border-red-300" : "border-gray-200"
              }`}
            />
          )}
        </td>

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

        {/* Status */}
        <td className={`px-3.5 align-middle text-right ${baseTdClass}`}>
          {isPunched ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-md px-2.5 h-[26px]">
              <Check size={9} /> Done
            </span>
          ) : (
            <span className="text-gray-300 text-[11px]">—</span>
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
        colSpan={12}
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
