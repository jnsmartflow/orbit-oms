"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Check, Copy, ChevronDown, Pencil, Search, Lock, LockOpen } from "lucide-react";
import { formatTime, smartTitleCase, getLineVolume, getOrderVolume, formatVolume, BATCH_COPY_LIMIT, SPLIT_VOLUME_THRESHOLD, SPLIT_LINE_THRESHOLD, SORT_DISPLAY_THRESHOLD, splitLinesByCategory, sortLinesForPicker, isOdCiFlagged, cleanSubject, getOrderSignals } from "@/lib/mail-orders/utils";
import { searchCustomers, saveLineStatus } from "@/lib/mail-orders/api";
import type { MoOrder, MoOrderLine, CustomerSearchResult, LineStatus } from "@/lib/mail-orders/types";
import { LINE_STATUS_REASONS } from "@/lib/mail-orders/types";
import { ResolveLinePanel } from "./resolve-line-panel";
import { LineStatusPanel } from "./line-status-panel";

// ── Column configuration ────────────────────────────────────────────────────

export interface ColumnConfig {
  key: string;
  label: string;
  width: number;
  alwaysVisible: boolean;
  defaultVisible: boolean;
}

export const ALL_COLUMNS: ColumnConfig[] = [
  { key: "time",      label: "Time",       width: 68,  alwaysVisible: true,  defaultVisible: true },
  { key: "soName",    label: "SO Name",    width: 120, alwaysVisible: false, defaultVisible: true },
  { key: "customer",  label: "Customer",   width: 208, alwaysVisible: true,  defaultVisible: true },
  { key: "lines",     label: "Lines",      width: 68,  alwaysVisible: false, defaultVisible: true },
  { key: "dispatch",  label: "Dispatch",   width: 80,  alwaysVisible: false, defaultVisible: false },
  { key: "remarks",   label: "Remarks",    width: 120, alwaysVisible: false, defaultVisible: true },
  { key: "code",      label: "Code",       width: 90,  alwaysVisible: false, defaultVisible: true },
  { key: "sku",       label: "SKU",        width: 82,  alwaysVisible: true,  defaultVisible: true },
  { key: "soNumber",  label: "SO No.",     width: 110, alwaysVisible: true,  defaultVisible: true },
  { key: "lock",      label: "Lock",       width: 46,  alwaysVisible: false, defaultVisible: true },
  { key: "status",    label: "Status",     width: 80,  alwaysVisible: false, defaultVisible: true },
  { key: "punchedBy", label: "Punched By", width: 100, alwaysVisible: false, defaultVisible: true },
];

// ── Props ────────────────────────────────────────────────────────────────────

interface MailOrdersTableProps {
  groupedOrders: Record<string, MoOrder[]>;
  flaggedIds: Set<number>;
  expandedId: number | null;
  focusedId: number | null;
  copiedId: number | null;
  copiedCodeId: number | null;
  onFlag: (id: number) => void;
  onExpand: (id: number | null) => void;
  onPunch: (id: number) => Promise<void>;
  onCopy: (id: number, lines: MoOrderLine[], batchIndex?: number) => void;
  onSaveSoNumber: (orderId: number, value: string) => Promise<boolean>;
  onSaveCustomer: (orderId: number, data: { customerCode: string; customerName: string; saveKeyword?: boolean; keyword?: string; area?: string; deliveryType?: string; route?: string }) => Promise<void>;
  openCodePopoverId: number | null;
  setOpenCodePopoverId: (id: number | null) => void;
  batchStates: Record<number, number>;
  onAdvanceBatch: (orderId: number) => void;
  onSplitComplete: () => void;
  visibleColumns: Set<string>;
  recentlyPunchedIds: Set<number>;
  separatePunched: boolean;
  punchedVisible: boolean;
  onTogglePunched: () => void;
  skuPanelOrderId: number | null;
  onCloseSkuPanel: () => void;
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


function getDeliveryDotColor(deliveryType: string | null | undefined): { color: string; title: string } | null {
  if (!deliveryType) return null;
  switch (deliveryType.toUpperCase()) {
    case "LOCAL": return { color: "bg-blue-600", title: "Local" };
    case "UPC": return { color: "bg-orange-600", title: "Upcountry" };
    case "IGT": return { color: "bg-teal-600", title: "IGT" };
    case "CROSS":
    case "CROSS DEPOT": return { color: "bg-rose-600", title: "Cross Depot" };
    default: return null;
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function MailOrdersTable({
  groupedOrders,
  flaggedIds,
  expandedId,
  focusedId,
  copiedId,
  copiedCodeId,
  onFlag,
  onExpand,
  onPunch,
  onCopy,
  onSaveSoNumber,
  onSaveCustomer,
  openCodePopoverId,
  setOpenCodePopoverId,
  batchStates,
  onAdvanceBatch,
  onSplitComplete,
  visibleColumns,
  recentlyPunchedIds,
  separatePunched,
  punchedVisible,
  onTogglePunched,
  skuPanelOrderId,
  onCloseSkuPanel,
}: MailOrdersTableProps) {
  const slotOrder = ["Morning", "Afternoon", "Evening", "Night"] as const;
  const isVis = (key: string) => visibleColumns.has(key);
  const extraWidth = ALL_COLUMNS
    .filter(c => !visibleColumns.has(c.key))
    .reduce((sum, c) => sum + c.width, 0);
  const colCount = visibleColumns.size;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
        <colgroup>
          {isVis("time") && <col style={{ width: 68 }} />}
          {isVis("soName") && <col style={{ width: 120 }} />}
          <col style={{ width: 208 + extraWidth }} />
          {isVis("lines") && <col style={{ width: 68 }} />}
          {isVis("dispatch") && <col style={{ width: 80 }} />}
          {isVis("remarks") && <col style={{ width: 120 }} />}
          {isVis("code") && <col style={{ width: 90 }} />}
          {isVis("sku") && <col style={{ width: 82 }} />}
          {isVis("soNumber") && <col style={{ width: 110 }} />}
          {isVis("lock") && <col style={{ width: 46 }} />}
          {isVis("status") && <col style={{ width: 80 }} />}
          {isVis("punchedBy") && <col style={{ width: 100 }} />}
        </colgroup>

        <thead>
          <tr className="h-[34px] bg-white border-b border-gray-200">
            {isVis("time") && <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
              Time
            </th>}
            {isVis("soName") && <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
              SO Name
            </th>}
            <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
              Customer
            </th>
            {isVis("lines") && <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-center px-3.5">
              Lines
            </th>}
            {isVis("dispatch") && <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-center px-3.5">
              Dispatch
            </th>}
            {isVis("remarks") && <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
              Remarks
            </th>}
            {isVis("code") && <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
              Code
            </th>}
            {isVis("sku") && <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-right px-3.5">
              SKU
            </th>}
            {isVis("soNumber") && <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
              SO No.
            </th>}
            {isVis("lock") && <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-center px-3.5">
              Lock
            </th>}
            {isVis("status") && <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-right px-3.5">
              Status
            </th>}
            {isVis("punchedBy") && <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-right px-3.5">
              Punched By
            </th>}
          </tr>
        </thead>

        <tbody>
          {slotOrder.map((slot) => {
            const orders = groupedOrders[slot];
            if (!orders || orders.length === 0) return null;

            return (
              <SlotGroup
                key={slot}
                slot={slot}
                orders={orders}
                flaggedIds={flaggedIds}
                expandedId={expandedId}
                focusedId={focusedId}
                copiedId={copiedId}
                copiedCodeId={copiedCodeId}
                onFlag={onFlag}
                onExpand={onExpand}
                onPunch={onPunch}
                onCopy={onCopy}
                onSaveSoNumber={onSaveSoNumber}
                onSaveCustomer={onSaveCustomer}
                openCodePopoverId={openCodePopoverId}
                setOpenCodePopoverId={setOpenCodePopoverId}
                batchStates={batchStates}
                onAdvanceBatch={onAdvanceBatch}
                onSplitComplete={onSplitComplete}
                visibleColumns={visibleColumns}
                colCount={colCount}
                recentlyPunchedIds={recentlyPunchedIds}
                separatePunched={separatePunched}
                punchedVisible={punchedVisible}
                onTogglePunched={onTogglePunched}
                skuPanelOrderId={skuPanelOrderId}
                onCloseSkuPanel={onCloseSkuPanel}
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
  flaggedIds,
  expandedId,
  focusedId,
  copiedId,
  copiedCodeId,
  onFlag,
  onExpand,
  onPunch,
  onCopy,
  onSaveSoNumber,
  onSaveCustomer,
  openCodePopoverId,
  setOpenCodePopoverId,
  batchStates,
  onAdvanceBatch,
  onSplitComplete,
  visibleColumns,
  colCount,
  recentlyPunchedIds,
  separatePunched,
  punchedVisible,
  onTogglePunched,
  skuPanelOrderId,
  onCloseSkuPanel,
}: {
  slot: string;
  orders: MoOrder[];
  flaggedIds: Set<number>;
  expandedId: number | null;
  focusedId: number | null;
  copiedId: number | null;
  copiedCodeId: number | null;
  onFlag: (id: number) => void;
  onExpand: (id: number | null) => void;
  onPunch: (id: number) => Promise<void>;
  onCopy: (id: number, lines: MoOrderLine[], batchIndex?: number) => void;
  onSaveSoNumber: (orderId: number, value: string) => Promise<boolean>;
  onSaveCustomer: MailOrdersTableProps["onSaveCustomer"];
  openCodePopoverId: number | null;
  setOpenCodePopoverId: (id: number | null) => void;
  batchStates: Record<number, number>;
  onAdvanceBatch: (orderId: number) => void;
  onSplitComplete: () => void;
  visibleColumns: Set<string>;
  colCount: number;
  recentlyPunchedIds: Set<number>;
  separatePunched: boolean;
  punchedVisible: boolean;
  onTogglePunched: () => void;
  skuPanelOrderId: number | null;
  onCloseSkuPanel: () => void;
}) {
  const dotColor = SLOT_DOTS[slot] ?? "bg-gray-400";

  const pendingOrders = separatePunched
    ? orders.filter(o => o.status !== "punched" || recentlyPunchedIds.has(o.id))
    : orders;
  const punchedOrders = separatePunched
    ? orders
        .filter(o => o.status === "punched" && !recentlyPunchedIds.has(o.id))
        .sort((a, b) => {
          const aTime = a.punchedAt ? new Date(a.punchedAt).getTime() : 0;
          const bTime = b.punchedAt ? new Date(b.punchedAt).getTime() : 0;
          return bTime - aTime;
        })
    : [];
  const renderOrderRow = (order: MoOrder, inPunchedSection?: boolean) => (
    <OrderRow
      key={order.id}
      order={order}
      isFlagged={flaggedIds.has(order.id)}
      isPunched={order.status === "punched"}
      isFocused={focusedId === order.id}
      isExpanded={expandedId === order.id}
      copiedId={copiedId}
      copiedCodeId={copiedCodeId}
      onFlag={onFlag}
      onExpand={onExpand}
      onPunch={onPunch}
      onCopy={onCopy}
      onSaveSoNumber={onSaveSoNumber}
      onSaveCustomer={onSaveCustomer}
      openCodePopoverId={openCodePopoverId}
      setOpenCodePopoverId={setOpenCodePopoverId}
      batchStates={batchStates}
      onAdvanceBatch={onAdvanceBatch}
      onSplitComplete={onSplitComplete}
      visibleColumns={visibleColumns}
      colCount={colCount}
      punchedSection={inPunchedSection}
      skuPanelOrderId={skuPanelOrderId}
      onCloseSkuPanel={onCloseSkuPanel}
    />
  );

  return (
    <>
      {/* Section header */}
      <tr>
        <td
          colSpan={colCount}
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
              {(() => {
                const slotVol = orders.reduce((sum, o) => sum + getOrderVolume(o.lines), 0);
                const volStr = slotVol > 0 ? `${slotVol.toLocaleString()}L` : '';
                const slotPunched = orders.filter(o => o.status === "punched").length;
                return (
                  <>
                    {volStr && <span>{volStr} {"\u00b7"} </span>}
                    <span className="text-green-600">{slotPunched}</span>
                    <span>/{orders.length} punched</span>
                  </>
                );
              })()}
            </div>
          </div>
        </td>
      </tr>

      {/* Pending orders (or all orders when not separating) */}
      {pendingOrders.map((order) => renderOrderRow(order))}

      {/* Punched divider — only when separating */}
      {punchedOrders.length > 0 && (
        <tr>
          <td colSpan={colCount} className="h-[34px] px-4 bg-gray-50/50">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-200" />
              <button
                onClick={onTogglePunched}
                className="text-[11px] font-medium text-gray-500 hover:text-gray-700 flex items-center gap-1.5 shrink-0 transition-colors"
              >
                <span className="inline-flex items-center justify-center w-[20px] h-[20px] rounded-full bg-teal-50 text-teal-700 text-[10px] font-semibold">
                  {punchedOrders.length}
                </span>
                punched
                <span className="text-gray-400 text-[10px]">
                  {punchedVisible ? "\u25BE" : "\u25B8"}
                </span>
              </button>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
          </td>
        </tr>
      )}

      {/* Punched orders — same OrderRow, dimmed */}
      {punchedVisible && punchedOrders.map((order) => renderOrderRow(order, true))}
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
  copiedCodeId,
}: {
  order: MoOrder;
  baseTdClass: string;
  onSaveCustomer: MailOrdersTableProps["onSaveCustomer"];
  isOpen: boolean;
  onToggle: () => void;
  copiedCodeId: number | null;
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
              <div className="text-[11px] text-gray-600 truncate">{smartTitleCase(c.customerName)}</div>
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
      <td data-cell="code" className={`px-2 align-middle relative group ${baseTdClass}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span
            onClick={handleCopyCode}
            className={`font-mono text-[11px] cursor-pointer rounded px-1.5 py-0.5 border transition-colors ${
              codeCopied || copiedCodeId === order.id
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
      <td data-cell="code" className={`px-2 align-middle relative ${baseTdClass}`} onClick={(e) => e.stopPropagation()}>
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
                  <div className="text-[11px] text-gray-600 truncate">{smartTitleCase(c.name)}</div>
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
    <td data-cell="code" className={`px-2 align-middle relative ${baseTdClass}`} onClick={(e) => e.stopPropagation()}>
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
  copiedCodeId,
  onFlag,
  onExpand,
  onPunch,
  onCopy,
  onSaveSoNumber,
  onSaveCustomer,
  openCodePopoverId,
  setOpenCodePopoverId,
  batchStates,
  onAdvanceBatch,
  onSplitComplete,
  visibleColumns,
  colCount,
  punchedSection,
  skuPanelOrderId,
  onCloseSkuPanel,
}: {
  order: MoOrder;
  isFlagged: boolean;
  isPunched: boolean;
  isFocused: boolean;
  isExpanded: boolean;
  copiedId: number | null;
  copiedCodeId: number | null;
  onFlag: (id: number) => void;
  onExpand: (id: number | null) => void;
  onPunch: (id: number) => Promise<void>;
  onCopy: (id: number, lines: MoOrderLine[], batchIndex?: number) => void;
  onSaveSoNumber: (orderId: number, value: string) => Promise<boolean>;
  onSaveCustomer: MailOrdersTableProps["onSaveCustomer"];
  openCodePopoverId: number | null;
  setOpenCodePopoverId: (id: number | null) => void;
  batchStates: Record<number, number>;
  onAdvanceBatch: (orderId: number) => void;
  onSplitComplete: () => void;
  visibleColumns: Set<string>;
  colCount: number;
  punchedSection?: boolean;
  skuPanelOrderId: number | null;
  onCloseSkuPanel: () => void;
}) {
  const isVis = (key: string) => visibleColumns.has(key);
  const autoFlagged = isOdCiFlagged(order);
  const effectiveFlagged = isFlagged || autoFlagged;
  const hasUnmatched = order.matchedLines < order.totalLines;
  const matchedCount = order.lines.filter((l) => l.matchStatus === "matched").length;
  const isDisabled = effectiveFlagged || isPunched || matchedCount === 0;
  const isCopied = copiedId === order.id;
  const currentBatch = batchStates[order.id] ?? 0;
  const needsBatching = matchedCount > BATCH_COPY_LIMIT;
  const totalBatches = needsBatching ? Math.ceil(matchedCount / BATCH_COPY_LIMIT) : 1;
  const sortedLines = order.lines.length > SORT_DISPLAY_THRESHOLD
    ? sortLinesForPicker(order.lines)
    : order.lines;

  const [editingSo, setEditingSo] = useState(false);
  const [soInput, setSoInput] = useState(order.soNumber ?? "");
  const [soError, setSoError] = useState(false);
  const soInputRef = useRef<HTMLInputElement>(null);

  // ── SKU panel state (lifted from ExpandRow) ─────────────────────────────────
  const [activeLineId, setActiveLineId] = useState<number | null>(null);
  const [panelHighlight, setPanelHighlight] = useState(0);
  const [lineStatuses, setLineStatuses] = useState<Record<number, LineStatus>>({});
  const panelActionRef = useRef<{
    toggleFound: (found: boolean) => void;
    selectReason: (index: number) => void;
    save: () => void;
  } | null>(null);

  useEffect(() => {
    const initial: Record<number, LineStatus> = {};
    for (const line of order.lines) {
      if (line.lineStatus) {
        initial[line.id] = line.lineStatus;
      }
    }
    setLineStatuses(initial);
  }, [order.lines]);

  // Open panel when triggered by S key from page
  useEffect(() => {
    if (skuPanelOrderId === order.id) {
      setPanelHighlight(0);
      setActiveLineId(-1);
    }
  }, [skuPanelOrderId, order.id]);

  const handleSaveLineStatus = useCallback(async (
    lineId: number,
    status: { found: boolean; reason?: string; altSkuCode?: string; altSkuDescription?: string; note?: string },
  ) => {
    setLineStatuses(prev => ({
      ...prev,
      [lineId]: {
        found: status.found,
        reason: status.reason ?? null,
        altSkuCode: status.altSkuCode ?? null,
        altSkuDescription: status.altSkuDescription ?? null,
        note: status.note ?? null,
      },
    }));
    setActiveLineId(null);
    onCloseSkuPanel();
    try {
      await saveLineStatus(lineId, status);
    } catch {
      setLineStatuses(prev => {
        const next = { ...prev };
        const original = order.lines.find(l => l.id === lineId)?.lineStatus;
        if (original) next[lineId] = original;
        else delete next[lineId];
        return next;
      });
    }
  }, [order.lines, onCloseSkuPanel]);

  const handleQuickToggle = useCallback(async (lineId: number) => {
    const current = lineStatuses[lineId];
    const newFound = current ? !current.found : false;
    setLineStatuses(prev => ({
      ...prev,
      [lineId]: {
        found: newFound,
        reason: newFound ? null : (current?.reason ?? "out_of_stock"),
        altSkuCode: newFound ? null : (current?.altSkuCode ?? null),
        altSkuDescription: newFound ? null : (current?.altSkuDescription ?? null),
        note: newFound ? null : (current?.note ?? null),
      },
    }));
    try {
      await saveLineStatus(lineId, {
        found: newFound,
        reason: newFound ? undefined : (current?.reason ?? "out_of_stock"),
        altSkuCode: newFound ? undefined : (current?.altSkuCode ?? undefined),
        altSkuDescription: newFound ? undefined : (current?.altSkuDescription ?? undefined),
        note: newFound ? undefined : (current?.note ?? undefined),
      });
    } catch {
      setLineStatuses(prev => {
        if (current) return { ...prev, [lineId]: current };
        const next = { ...prev };
        delete next[lineId];
        return next;
      });
    }
  }, [lineStatuses]);

  // Panel keyboard handler (capture phase)
  useEffect(() => {
    if (activeLineId === null) return;
    const capturedLineId = activeLineId;
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      const isInInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (capturedLineId > 0) {
          const idx = order.lines.findIndex(l => l.id === capturedLineId);
          if (idx >= 0) setPanelHighlight(idx);
          setActiveLineId(-1);
        } else {
          setActiveLineId(null);
          onCloseSkuPanel();
        }
        return;
      }
      if (isInInput) return;
      e.stopPropagation();
      if (capturedLineId === -1) {
        const lines = order.lines;
        if (e.key === "ArrowUp") { e.preventDefault(); setPanelHighlight(p => Math.max(0, p - 1)); }
        else if (e.key === "ArrowDown") { e.preventDefault(); setPanelHighlight(p => Math.min(lines.length - 1, p + 1)); }
        else if (e.key === "-" || e.key === "0") {
          e.preventDefault();
          const line = lines[panelHighlight];
          if (line) { const s = lineStatuses[line.id]; if (!s || s.found) handleQuickToggle(line.id); }
        }
        else if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          const line = lines[panelHighlight];
          if (line) { const s = lineStatuses[line.id]; if (s && !s.found) handleQuickToggle(line.id); }
        }
        else if (e.key === "Enter") {
          e.preventDefault();
          const line = lines[panelHighlight];
          if (line) setActiveLineId(line.id);
        }
      } else {
        const ref = panelActionRef.current;
        if (!ref) return;
        if (e.key === "-" || e.key === "0") { e.preventDefault(); ref.toggleFound(false); }
        else if (e.key === "+" || e.key === "=") { e.preventDefault(); ref.toggleFound(true); }
        else if (e.key >= "1" && e.key <= "5") { e.preventDefault(); ref.selectReason(parseInt(e.key) - 1); }
        else if (e.key === "Enter") { e.preventDefault(); ref.save(); }
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [activeLineId, panelHighlight, order.lines, lineStatuses, handleQuickToggle, onCloseSkuPanel]);

  // Scroll panel highlight into view
  useEffect(() => {
    if (activeLineId !== -1) return;
    const el = document.querySelector(`[data-sku-panel-idx="table-${order.id}-${panelHighlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeLineId, panelHighlight, order.id]);

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
    isFocused && 'bg-amber-50/70',
    isPunched && 'bg-teal-50/40',
  ].filter(Boolean).join(' ');

  const isSplit = !!order.splitLabel;

  const borderLeft = effectiveFlagged
    ? "3px solid #f87171"
    : isFocused
      ? "3px solid #f59e0b"
      : isPunched
        ? "3px solid #0d9488"
        : isSplit
          ? "3px solid #a78bfa"
          : undefined;
  const needsBorderCompensation = effectiveFlagged || isFocused || isPunched || isSplit;

  // Remarks — signal badges (3-tier: blocker / attention / info)
  const signalStyles: Record<string, string> = {
    blocker:   'bg-red-50 text-red-700 border-red-200',
    attention: 'bg-amber-50 text-amber-700 border-amber-200',
    info:      'bg-gray-50 text-gray-500 border-gray-200',
    split:     'bg-purple-50 text-purple-600 border-purple-200',
    bill:      'bg-blue-50 text-blue-700 border-blue-200',
  };

  const totalVol = getOrderVolume(order.lines);
  const volStr = formatVolume(totalVol);

  const signals = getOrderSignals(order, { isPunched });

  const remarksTooltip = [order.remarks, order.billRemarks, order.deliveryRemarks]
    .filter(Boolean)
    .map(s => s!.replace(/;?\s*Code:\s*\d+/gi, '').trim())
    .filter(Boolean)
    .join(' | ');

  const handleCodeToggle = useCallback(() => {
    setOpenCodePopoverId(openCodePopoverId === order.id ? null : order.id);
  }, [openCodePopoverId, order.id, setOpenCodePopoverId]);

  return (
    <>
      <tr
        data-order-id={order.id}
        data-urgent={(!isPunched && (order.dispatchStatus === "Hold" || order.dispatchPriority === "Urgent")) ? "true" : undefined}
        className="h-[52px] border-b border-gray-100 hover:bg-gray-50/50 cursor-pointer"
        style={{ borderLeft, opacity: punchedSection ? 0.5 : (isPunched ? 0.75 : undefined) }}
        onClick={() => onExpand(order.id)}
      >
        {/* Time */}
        {isVis("time") && <td
          className={`px-3.5 align-middle ${baseTdClass}`}
          style={{ paddingLeft: needsBorderCompensation ? 11 : undefined }}
        >
          <span className="font-mono text-[12px] font-semibold text-gray-900">
            {formatTime(order.receivedAt)}
          </span>
        </td>}

        {/* SO Name */}
        {isVis("soName") && <td className={`px-3.5 align-middle ${baseTdClass}`}>
          <span
            title={smartTitleCase(order.soName?.replace(/^\(JSW\)\s*/i, "").trim())}
            className="text-[11px] text-gray-500 truncate block max-w-[120px]"
          >
            {smartTitleCase(order.soName?.replace(/^\(JSW\)\s*/i, "").trim())}
          </span>
        </td>}

        {/* Customer */}
        <td className={`px-3.5 align-middle ${baseTdClass}`}>
          {(() => {
            const isExact = order.customerMatchStatus === "exact";
            const rawName = isExact && order.customerName
              ? order.customerName
              : cleanSubject(order.subject);
            const displayName = smartTitleCase(rawName);
            const splitSuffix = order.splitLabel ? ` (${order.splitLabel})` : '';
            const displayNameFull = displayName + splitSuffix;
            const dot = getDeliveryDotColor(order.customerDeliveryType);
            const area = isExact ? smartTitleCase(order.customerArea) : null;
            const route = isExact ? smartTitleCase(order.customerRoute) : null;
            const subtextParts: React.ReactNode[] = [];
            if (area) subtextParts.push(<span key="area">{area}</span>);
            if (route) subtextParts.push(<span key="route">{route}</span>);
            return (
              <div className="overflow-hidden min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  {dot && (
                    <span className={`w-[5px] h-[5px] rounded-full ${dot.color} flex-shrink-0`} title={dot.title} />
                  )}
                  <span
                    title={displayNameFull}
                    className="text-[12.5px] font-semibold text-gray-900 truncate"
                  >
                    {displayNameFull}
                  </span>
                  {effectiveFlagged && (
                    <Lock size={12} className="text-red-500 flex-shrink-0" />
                  )}
                </div>
                {subtextParts.length > 0 && (
                  <span className="text-[10px] text-gray-400 truncate block">
                    {subtextParts.map((part, i) => (
                      <span key={i}>{i > 0 && <span className="text-gray-300">{" \u00b7 "}</span>}{part}</span>
                    ))}
                  </span>
                )}
              </div>
            );
          })()}
        </td>

        {/* Lines */}
        {isVis("lines") && <td className={`px-2 align-middle text-center ${baseTdClass}`}>
          <div>
            {hasUnmatched ? (
              <button
                onClick={(e) => { e.stopPropagation(); onExpand(order.id); }}
                className="text-[12px] font-semibold text-amber-600 inline-flex items-center gap-0.5"
              >
                <ChevronDown
                  size={10}
                  className={isExpanded ? "rotate-180 transition-transform" : "transition-transform"}
                />
                {order.matchedLines}/{order.totalLines}
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPanelHighlight(0);
                  setActiveLineId(-1);
                }}
                className="text-[12px] font-semibold text-green-600 hover:underline"
              >
                {order.matchedLines}/{order.totalLines}
              </button>
            )}
            {volStr && (
              <div className={`text-[9px] font-mono ${hasUnmatched ? "text-amber-400" : "text-gray-400"}`}>
                {volStr}
              </div>
            )}
          </div>
        </td>}

        {/* Dispatch */}
        {isVis("dispatch") && <td className={`px-2 align-middle text-center ${baseTdClass}`}>
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
        </td>}

        {/* Remarks */}
        {isVis("remarks") && <td className={`px-2 align-middle ${baseTdClass}`} title={remarksTooltip || undefined}>
          {signals.length > 0 ? (
            <div className="flex flex-wrap gap-0.5">
              {signals.map((s, i) => (
                <span
                  key={i}
                  className={`relative text-[9px] font-medium px-1.5 py-0.5 rounded border ${signalStyles[s.type] ?? signalStyles.info}`}
                >
                  {s.dot && (
                    <span className={`absolute -top-[3px] -right-[3px] w-[5px] h-[5px] rounded-full ${s.dot}`} />
                  )}
                  {s.label}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </td>}

        {/* Code */}
        {isVis("code") && <CodeCell
          order={order}
          baseTdClass={baseTdClass}
          onSaveCustomer={onSaveCustomer}
          isOpen={openCodePopoverId === order.id}
          onToggle={handleCodeToggle}
          copiedCodeId={copiedCodeId}
        />}

        {/* SKU */}
        {isVis("sku") && <td data-cell="sku" className={`px-3.5 align-middle text-right ${baseTdClass}`}>
          <button
            disabled={isDisabled}
            onClick={(e) => {
              e.stopPropagation();
              if (needsBatching) {
                onCopy(order.id, sortedLines, currentBatch);
                onAdvanceBatch(order.id);
              } else {
                onCopy(order.id, sortedLines);
              }
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
            ) : needsBatching ? (
              <>
                <Copy size={10} />
                <span className="text-[10px]">
                  {currentBatch * BATCH_COPY_LIMIT + 1}-
                  {Math.min((currentBatch + 1) * BATCH_COPY_LIMIT, matchedCount)}
                </span>
                <span className="text-[8px] text-gray-400">
                  ({currentBatch + 1}/{totalBatches})
                </span>
              </>
            ) : (
              <>
                <Copy size={11} /> {matchedCount}
              </>
            )}
          </button>
        </td>}

        {/* SO No. */}
        {isVis("soNumber") && <td
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
        </td>}

        {/* Lock */}
        {isVis("lock") && <td className={`px-3.5 align-middle text-center ${baseTdClass}`}>
          {isPunched ? (
            <span className="text-gray-300 text-[11px]">—</span>
          ) : effectiveFlagged ? (
            <button
              onClick={(e) => { e.stopPropagation(); onFlag(order.id) }}
              className="bg-red-50 rounded p-1 text-red-500 cursor-pointer"
            >
              <Lock size={14} />
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onFlag(order.id) }}
              className="text-gray-300 hover:text-gray-400 cursor-pointer"
            >
              <LockOpen size={14} />
            </button>
          )}
        </td>}

        {/* Status */}
        {isVis("status") && <td className={`px-3.5 align-middle text-right ${baseTdClass}`}>
          {isPunched ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-md px-2.5 h-[26px]">
              <Check size={9} /> Done
            </span>
          ) : (
            <span className="text-gray-300 text-[11px]">—</span>
          )}
        </td>}

        {/* Punched By */}
        {isVis("punchedBy") && (isPunched ? (
          <td className={`text-right ${baseTdClass}`} style={{ paddingRight: 14 }}>
            <div className="flex items-center justify-end gap-1.5">
              {order.punchedBy?.name && (
                <span
                  className="w-[18px] h-[18px] rounded-full bg-teal-600 flex items-center justify-center text-[8px] font-bold text-white shrink-0"
                  title={order.punchedBy.name}
                >
                  {order.punchedBy.name
                    .split(" ")
                    .map(w => w[0]?.toUpperCase() ?? "")
                    .join("")
                    .slice(0, 2)}
                </span>
              )}
              <div>
                <div className="text-[11px] font-medium text-gray-600 truncate">
                  {order.punchedBy?.name ?? 'operator'}
                </div>
                <div className="text-[10px] text-gray-400 font-mono">
                  {formatTime(order.punchedAt!)}
                </div>
              </div>
            </div>
          </td>
        ) : (
          <td className={baseTdClass} />
        ))}
      </tr>

      {/* Expand sub-row */}
      {isExpanded && (
        <ExpandRow
          order={order}
          onSplitComplete={onSplitComplete}
          colCount={colCount}
          lineStatuses={lineStatuses}
          onOpenPanel={(lineId) => {
            const idx = order.lines.findIndex(l => l.id === lineId);
            if (idx >= 0) setPanelHighlight(idx);
            setActiveLineId(-1);
          }}
        />
      )}

      {/* ── SKU list panel ────────────────────────────────────── */}
      {activeLineId === -1 && (
        <tr><td colSpan={colCount} style={{ padding: 0, border: 0, height: 0 }}>
          <div className="fixed inset-0 z-50 flex">
            <div className="flex-1 bg-black/10" onClick={() => { setActiveLineId(null); onCloseSkuPanel(); }} />
            <div className="w-[360px] bg-white border-l border-gray-200 h-full overflow-y-auto">
              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">
                    SKU lines ({order.lines.length})
                  </p>
                  <button
                    onClick={() => { setActiveLineId(null); onCloseSkuPanel(); }}
                    className="w-6 h-6 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center text-sm"
                  >
                    {"\u00d7"}
                  </button>
                </div>

                {order.lines.map((line, idx) => {
                  const status = lineStatuses[line.id];
                  const isNF = status && !status.found;
                  const reasonObj = isNF && status.reason
                    ? LINE_STATUS_REASONS.find(r => r.value === status.reason)
                    : null;

                  return (
                    <div
                      key={line.id}
                      data-sku-panel-idx={`table-${order.id}-${idx}`}
                      className={`flex items-center gap-2 py-2.5 px-2 rounded-lg mb-1 cursor-pointer transition-colors ${
                        idx === panelHighlight
                          ? "bg-teal-50 ring-1 ring-teal-200"
                          : isNF ? "bg-red-50 hover:bg-red-100" : "hover:bg-gray-50"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleQuickToggle(line.id); }}
                        className={`w-7 h-4 rounded-full relative flex-shrink-0 transition-colors ${
                          isNF ? "bg-red-500" : "bg-green-500"
                        }`}
                      >
                        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                          isNF ? "left-0.5" : "left-[14px]"
                        }`} />
                      </button>
                      <div className="flex-1 min-w-0" onClick={() => setActiveLineId(line.id)}>
                        <p className={`text-xs font-medium truncate ${isNF ? "line-through text-gray-400" : "text-gray-800"}`}>
                          {line.rawText}
                        </p>
                        <div className="flex items-center gap-1 mt-0.5 text-[10px] text-gray-400 flex-wrap">
                          {line.skuCode ? (
                            <span className={`font-mono ${isNF ? "line-through" : ""}`}>{line.skuCode}</span>
                          ) : (
                            <span className="text-amber-500 text-[9px] font-medium">unmatched</span>
                          )}
                          {line.packCode && (
                            <><span className="text-gray-300">{"\u00b7"}</span><span>{line.packCode}</span></>
                          )}
                          <span className="text-gray-300">{"\u00b7"}</span>
                          <span>{"\u00d7"}{line.quantity}</span>
                          {reasonObj && (
                            <><span className="text-gray-300">{"\u00b7"}</span>
                            <span className="text-[8px] font-semibold px-1 py-px rounded bg-red-50 text-red-700 border border-red-200">{reasonObj.label}</span></>
                          )}
                          {isNF && status?.altSkuCode && (
                            <span className="text-[8px] font-semibold px-1 py-px rounded bg-teal-50 text-teal-700 border border-teal-200">ALT</span>
                          )}
                        </div>
                      </div>
                      <svg onClick={() => setActiveLineId(line.id)} className="text-gray-300 flex-shrink-0 cursor-pointer hover:text-gray-500" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="6 4 10 8 6 12"/>
                      </svg>
                    </div>
                  );
                })}

                {(() => {
                  const nfCount = order.lines.filter(l => { const s = lineStatuses[l.id]; return s && !s.found; }).length;
                  return (
                    <div className="flex items-center justify-between py-2 mt-2 border-t border-gray-100 text-[11px]">
                      <span className="text-gray-500">Lines</span>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-green-600">{order.lines.length - nfCount} found</span>
                        {nfCount > 0 && <span className="font-semibold text-red-600">{nfCount} not found</span>}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </td></tr>
      )}

      {/* ── Line detail panel ─────────────────────────────────── */}
      {activeLineId !== null && activeLineId > 0 && (() => {
        const activeLine = order.lines.find(l => l.id === activeLineId);
        if (!activeLine) return null;
        const lineWithStatus = {
          ...activeLine,
          lineStatus: lineStatuses[activeLineId] ?? activeLine.lineStatus ?? null,
        };
        return (
          <LineStatusPanel
            line={lineWithStatus}
            onSave={handleSaveLineStatus}
            onCancel={() => setActiveLineId(-1)}
            actionRef={panelActionRef}
          />
        );
      })()}
    </>
  );
}

// ── Original lines table (read-only, for split orders) ──────────────────────

function OriginalLinesTable({
  lines,
  currentOrderId,
}: {
  lines: Array<MoOrderLine & { groupLabel: string; moOrderId: number }>;
  currentOrderId: number;
}) {
  return (
    <table className="w-full border-collapse">
      <colgroup>
        <col style={{ width: 38 }} />
        <col style={{ width: '30%' }} />
        <col style={{ width: 130 }} />
        <col style={{ width: '25%' }} />
        <col style={{ width: 48 }} />
        <col style={{ width: 52 }} />
        <col style={{ width: 56 }} />
        <col style={{ width: 52 }} />
      </colgroup>
      <thead>
        <tr className="h-[32px] bg-gray-50" style={{ borderBottom: "1px solid #ebebeb" }}>
          <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">#</th>
          <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">Raw Text</th>
          <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">SKU Code</th>
          <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">Description</th>
          <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-center px-3.5">Pk</th>
          <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-right px-3.5">Qty</th>
          <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-right px-3.5">Vol</th>
          <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-center px-3.5">Group</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, idx) => {
          const isMatched = line.matchStatus === "matched";
          const isLast = idx === lines.length - 1;
          const isCurrentGroup = line.moOrderId === currentOrderId;
          const vol = getLineVolume(line.quantity, line.packCode);

          return (
            <tr
              key={line.id}
              className="h-[36px] hover:bg-gray-50"
              style={{
                borderBottom: isLast ? undefined : "1px solid #f0f0f0",
                opacity: isCurrentGroup ? 1 : 0.5,
              }}
            >
              <td className="px-3.5 align-middle text-[11px] text-gray-400">
                {line.originalLineNumber ?? line.lineNumber}
              </td>
              <td className="px-3.5 align-middle text-[11px] text-gray-700">
                {line.rawText}
              </td>
              <td className="px-3.5 align-middle">
                {isMatched ? (
                  <span className="font-mono text-[11px] text-gray-500">{line.skuCode}</span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
              <td className="px-3.5 align-middle text-[11px] text-gray-500 truncate"
                  title={line.skuDescription ?? ''}>
                {isMatched ? (line.skuDescription ?? '—') : '—'}
              </td>
              <td className="px-3.5 align-middle text-center text-[11px] text-gray-500">
                {line.packCode ?? '—'}
              </td>
              <td className="px-3.5 align-middle text-right text-[11px] text-gray-700 font-medium">
                {line.quantity}
              </td>
              <td className="px-3.5 align-middle text-right text-[11px] text-gray-400">
                {vol > 0 ? formatVolume(vol) : '—'}
              </td>
              <td className="px-3.5 align-middle text-center">
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                  line.groupLabel === 'A'
                    ? 'bg-purple-50 text-purple-600 border border-purple-200'
                    : 'bg-blue-50 text-blue-600 border border-blue-200'
                }`}>
                  {line.groupLabel}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Expand sub-row ───────────────────────────────────────────────────────────

function ExpandRow({ order, onSplitComplete, colCount, lineStatuses, onOpenPanel }: { order: MoOrder; onSplitComplete: () => void; colCount: number; lineStatuses: Record<number, LineStatus>; onOpenPanel: (lineId: number) => void }) {
  const [resolveLineId, setResolveLineId] = useState<number | null>(null);
  const [resolvedLines, setResolvedLines] = useState<
    Record<number, { skuCode: string; skuDescription: string }>
  >({});
  const [showSplitSuggestion, setShowSplitSuggestion] = useState(false);
  const [splitPreview, setSplitPreview] = useState<{
    groupA: { lineIds: number[]; count: number; volume: number };
    groupB: { lineIds: number[]; count: number; volume: number };
  } | null>(null);
  const [splitDismissed, setSplitDismissed] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [originalLines, setOriginalLines] = useState<
    Array<MoOrderLine & { groupLabel: string; moOrderId: number }> | null
  >(null);
  const [loadingOriginal, setLoadingOriginal] = useState(false);

  const shouldSort = order.lines.length > SORT_DISPLAY_THRESHOLD;
  const displayLines = shouldSort ? sortLinesForPicker(order.lines) : order.lines;
  const linesToRender = showOriginal && !order.splitLabel ? order.lines : displayLines;

  async function fetchOriginalLines() {
    if (order.splitLabel) {
      // Split order: fetch from API (both halves)
      if (originalLines) {
        setShowOriginal(true);
        return;
      }
      setLoadingOriginal(true);
      try {
        const res = await fetch(`/api/mail-orders/${order.id}/original-lines`);
        if (res.ok) {
          const data = await res.json();
          setOriginalLines(data.lines);
          setShowOriginal(true);
        }
      } catch (err) {
        console.error("Failed to fetch original lines:", err);
      }
      setLoadingOriginal(false);
    } else {
      // Non-split order: just show unsorted lines (email sequence)
      setShowOriginal(true);
    }
  }

  function handleResolved(lineId: number, skuCode: string, skuDescription: string) {
    // Update the resolved line
    const update: Record<number, { skuCode: string; skuDescription: string }> = {
      [lineId]: { skuCode, skuDescription },
    };

    // Propagate to siblings with same rawText + packCode
    const resolvedLine = order.lines.find(l => l.id === lineId);
    if (resolvedLine) {
      const siblings = order.lines.filter(l =>
        l.id !== lineId &&
        l.matchStatus === "unmatched" &&
        l.rawText.toLowerCase() === resolvedLine.rawText.toLowerCase() &&
        l.packCode === resolvedLine.packCode,
      );
      for (const sib of siblings) {
        update[sib.id] = { skuCode, skuDescription };
      }
    }

    setResolvedLines(prev => ({ ...prev, ...update }));
    setResolveLineId(null);
  }

  // Check volume after resolves
  useEffect(() => {
    if (order.splitLabel || splitDismissed) return;

    const totalVol = order.lines.reduce((sum, l) => {
      const isEffectivelyMatched = l.matchStatus === "matched" || !!resolvedLines[l.id];
      return sum + (isEffectivelyMatched ? getLineVolume(l.quantity, l.packCode) : 0);
    }, 0);

    if (totalVol > SPLIT_VOLUME_THRESHOLD || order.lines.length > SPLIT_LINE_THRESHOLD) {
      const effectiveLines = order.lines.filter(
        (l) => l.matchStatus === "matched" || !!resolvedLines[l.id],
      );

      const lineItems = effectiveLines.map((l, idx) => ({
        index: idx,
        quantity: l.quantity,
        packCode: l.packCode,
        productName: l.productName,
        paintType: l.paintType,
        materialType: l.materialType,
      }));

      const [groupAIdx, groupBIdx] = splitLinesByCategory(lineItems);

      const toIds = (indices: number[]) => indices.map((i) => effectiveLines[i].id);
      const toVol = (indices: number[]) =>
        indices.reduce((s, i) => s + getLineVolume(effectiveLines[i].quantity, effectiveLines[i].packCode), 0);

      setSplitPreview({
        groupA: { lineIds: toIds(groupAIdx), count: groupAIdx.length, volume: toVol(groupAIdx) },
        groupB: { lineIds: toIds(groupBIdx), count: groupBIdx.length, volume: toVol(groupBIdx) },
      });
      setShowSplitSuggestion(true);
    } else {
      setShowSplitSuggestion(false);
      setSplitPreview(null);
    }
  }, [resolvedLines, order.lines, order.splitLabel, splitDismissed]);

  async function handleSplit(preview: NonNullable<typeof splitPreview>) {
    try {
      const res = await fetch(`/api/mail-orders/${order.id}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groups: [preview.groupA.lineIds, preview.groupB.lineIds],
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        console.error("Split failed:", err);
        return;
      }

      onSplitComplete();
    } catch (err) {
      console.error("Split error:", err);
    }
  }

  return (
    <tr>
      <td
        colSpan={colCount}
        style={{ padding: 0, background: "#fafafa", borderBottom: "1px solid #e5e7eb" }}
      >
        {/* Split suggestion banner */}
        {showSplitSuggestion && splitPreview && (
          <div className="mx-4 mt-3 mb-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12px] font-semibold text-amber-800">
                  ⚠ Large order — split recommended
                </p>
                <p className="text-[11px] text-amber-600 mt-1">
                  Group A: {splitPreview.groupA.count} lines · {formatVolume(splitPreview.groupA.volume)}
                  <span className="mx-2 text-amber-300">|</span>
                  Group B: {splitPreview.groupB.count} lines · {formatVolume(splitPreview.groupB.volume)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setSplitDismissed(true); setShowSplitSuggestion(false); }}
                  className="text-[10px] text-gray-500 hover:text-gray-700 px-2 py-1"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => handleSplit(splitPreview)}
                  className="text-[10px] font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded px-3 py-1.5 transition-colors"
                >
                  ✂ Split Order
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Toolbar row — for sorted or split orders */}
        {shouldSort && (
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (showOriginal) {
                    setShowOriginal(false);
                  } else {
                    fetchOriginalLines();
                  }
                }}
                className={`text-[10px] font-medium px-2.5 py-1 rounded border transition-colors ${
                  showOriginal
                    ? "bg-purple-50 border-purple-200 text-purple-700"
                    : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                }`}
              >
                {loadingOriginal
                  ? "Loading..."
                  : showOriginal
                    ? (order.splitLabel ? "✂ Split View" : "📦 Sorted View")
                    : (order.splitLabel ? "📧 Original Order" : "📧 Email Order")
                }
              </button>
              {showOriginal && (
                <span className="text-[10px] text-gray-400">
                  {order.splitLabel && originalLines
                    ? `${originalLines.length} lines · original email sequence`
                    : `${order.lines.length} lines · email sequence`
                  }
                </span>
              )}
            </div>
          </div>
        )}
        {/* Line items table */}
        {showOriginal && order.splitLabel && originalLines ? (
          <OriginalLinesTable lines={originalLines} currentOrderId={order.id} />
        ) : (
        <table className="w-full border-collapse">
          <colgroup>
            <col style={{ width: 38 }} />
            <col style={{ width: '30%' }} />    {/* Raw Text */}
            <col style={{ width: 130 }} />      {/* SKU Code */}
            <col style={{ width: '30%' }} />    {/* Description */}
            <col style={{ width: 48 }} />       {/* Pk */}
            <col style={{ width: 52 }} />       {/* Qty */}
            <col style={{ width: 56 }} />       {/* Vol */}
            <col style={{ width: 76 }} />       {/* Status */}
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
              <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left px-3.5">
                Description
              </th>
              <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-center px-3.5">
                Pk
              </th>
              <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-right px-3.5">
                Qty
              </th>
              <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-right px-3.5">
                Vol
              </th>
              <th className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-center px-3.5">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {linesToRender.map((line, idx) => {
              const resolved = resolvedLines[line.id];
              const isMatched = line.matchStatus === "matched" || !!resolved;
              const isLast = idx === linesToRender.length - 1;
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
                    {showOriginal
                      ? (line.originalLineNumber ?? line.lineNumber)
                      : idx + 1
                    }
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
                  <td className={`px-3.5 align-middle text-[11px] text-gray-500 truncate ${unmatchedBg ?? ""}`}
                      title={isMatched ? (resolved?.skuDescription ?? line.skuDescription ?? '') : ''}>
                    {isMatched ? (
                      <span className="truncate block">
                        {resolved?.skuDescription ?? line.skuDescription ?? '—'}
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
                  <td className={`px-3.5 align-middle text-right text-[11px] text-gray-400 ${unmatchedBg ?? ""}`}>
                    {(() => {
                      const vol = getLineVolume(line.quantity, line.packCode);
                      return vol > 0 ? formatVolume(vol) : '—';
                    })()}
                  </td>
                  <td className={`px-3.5 align-middle text-center ${unmatchedBg ?? ""}`}>
                    {isMatched ? (
                      <div className="flex items-center justify-center gap-1">
                        <span className="text-green-600 font-semibold text-[13px]">{"\u2713"}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenPanel(line.id);
                          }}
                          className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold transition-colors ${
                            lineStatuses[line.id]?.found === false
                              ? "bg-red-100 text-red-600 hover:bg-red-200"
                              : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                          }`}
                          title={
                            lineStatuses[line.id]?.found === false
                              ? `Not found: ${lineStatuses[line.id]?.reason ?? "unknown"}`
                              : "Mark line status"
                          }
                        >
                          {lineStatuses[line.id]?.found === false ? "\u2715" : "\u00b7"}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setResolveLineId(line.id);
                        }}
                        className="text-[10px] font-semibold text-amber-600 border border-amber-300 rounded px-1.5 py-0.5 bg-white hover:bg-amber-50 transition-colors"
                      >
                        {"\u26A0"} Fix
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}

        {/* Remarks footer */}
        <div
          className="bg-gray-50/80"
          style={{ borderTop: "1px solid #ebebeb", padding: "12px 16px 14px" }}
        >
          <div className="grid grid-cols-[1fr_1fr_1.2fr_140px] gap-5">
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
                Bill Remarks
              </p>
              <p className="text-[11.5px] text-gray-600">
                {order.billRemarks ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-[9.5px] font-bold uppercase tracking-[0.4px] text-gray-400 mb-1">
                Order Notes
              </p>
              {(() => {
                const filteredRemarks = (order.remarks_list ?? []).filter(
                  r => r.remarkType !== "delivery" && r.remarkType !== "billing"
                );
                if (filteredRemarks.length === 0) {
                  return <p className="text-[11.5px] text-gray-600">—</p>;
                }
                const typeClasses: Record<string, string> = {
                  contact: 'bg-gray-50 text-gray-600 border-gray-200',
                  instruction: 'bg-gray-50 text-gray-500 border-gray-200',
                  cross: 'bg-purple-50 text-purple-600 border-purple-200',
                  customer: 'bg-teal-50 text-teal-600 border-teal-200',
                  unknown: 'bg-amber-50 text-amber-700 border-amber-200',
                };
                return (
                  <div>
                    {filteredRemarks.map((r) => (
                      <div key={r.id} className="flex items-start gap-1 mb-0.5">
                        <span className={`text-[9px] font-medium px-1 py-0 rounded border capitalize shrink-0 ${typeClasses[r.remarkType] ?? typeClasses.unknown}`}>
                          {r.remarkType}
                        </span>
                        <span className="text-[11px] text-gray-600">{r.rawText}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
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
