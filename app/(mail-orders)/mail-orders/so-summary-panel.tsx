"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Users, X, Copy, Check } from "lucide-react";
import type { MoOrder } from "@/lib/mail-orders/types";
import {
  smartTitleCase,
  cleanSubject,
  formatTime,
  formatVolume,
  getOrderVolume,
  isOdCiFlagged,
  getOrderFlags,
  buildReplyTemplate,
} from "@/lib/mail-orders/utils";

// ── Types ──────────────────────────────────────────────────────────────────

interface SoSummaryPanelProps {
  orders: MoOrder[];
  open: boolean;
  onClose: () => void;
}

interface SoGroup {
  soName: string;
  displayName: string;
  orders: MoOrder[];
  punchedCount: number;
}

interface PreviewState {
  title: string;
  subtitle: string;
  content: string;
}

// ── Component ──────────────────────────────────────────────────────────────

export function SoSummaryPanel({ orders, open, onClose }: SoSummaryPanelProps) {
  const [soFilter, setSoFilter] = useState("");
  const [checked, setChecked] = useState<Map<number, boolean>>(new Map());
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  // ── Group orders by SO name ──────────────────────────────────────────────

  const soGroups = useMemo(() => {
    const map = new Map<string, MoOrder[]>();
    for (const o of orders) {
      const key = o.soName.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }

    const groups: SoGroup[] = [];
    for (const [, groupOrders] of Array.from(map.entries())) {
      // Sort: punched first, then by receivedAt asc
      const sorted = [...groupOrders].sort((a, b) => {
        if (a.status !== b.status) return a.status === "punched" ? -1 : 1;
        return new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
      });
      groups.push({
        soName: sorted[0].soName,
        displayName: smartTitleCase(sorted[0].soName),
        orders: sorted,
        punchedCount: sorted.filter(o => o.status === "punched").length,
      });
    }

    groups.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return groups;
  }, [orders]);

  // ── Filter groups ────────────────────────────────────────────────────────

  const filteredGroups = useMemo(() => {
    if (!soFilter.trim()) return soGroups;
    const q = soFilter.trim().toLowerCase();
    return soGroups.filter(g => g.soName.toLowerCase().includes(q));
  }, [soGroups, soFilter]);

  // ── Stats ────────────────────────────────────────────────────────────────

  const totalPunched = useMemo(
    () => orders.filter(o => o.status === "punched").length,
    [orders],
  );

  // ── Initialize checkboxes when panel opens / orders change ───────────────

  useEffect(() => {
    if (!open) return;
    const init = new Map<number, boolean>();
    for (const o of orders) {
      init.set(o.id, o.status === "punched" && !!o.soNumber);
    }
    setChecked(init);
    setSoFilter("");
    setPreview(null);
    setCopyState("idle");
  }, [open, orders]);

  // ── Escape key ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ── Checkbox helpers ─────────────────────────────────────────────────────

  const toggleOrder = useCallback((id: number) => {
    setChecked(prev => {
      const next = new Map(prev);
      next.set(id, !next.get(id));
      return next;
    });
  }, []);

  const toggleGroup = useCallback((group: SoGroup) => {
    setChecked(prev => {
      const next = new Map(prev);
      const punchedWithSo = group.orders.filter(o => o.status === "punched" && !!o.soNumber);
      const allChecked = punchedWithSo.every(o => next.get(o.id));
      for (const o of punchedWithSo) {
        next.set(o.id, !allChecked);
      }
      return next;
    });
  }, []);

  // ── Display name for an order ────────────────────────────────────────────

  const orderDisplayName = useCallback((order: MoOrder) => {
    const name = smartTitleCase(
      order.customerMatchStatus === "exact" && order.customerName
        ? order.customerName
        : cleanSubject(order.subject),
    );
    return name + (order.splitLabel ? ` (${order.splitLabel})` : "");
  }, []);

  // ── Copy handlers ───────────────────────────────────────────────────────

  const handleCopySoNos = useCallback((group: SoGroup) => {
    const soNos = group.orders
      .filter(o => checked.get(o.id) && o.soNumber)
      .map(o => o.soNumber!);
    const text = soNos.join("\n");
    setPreview({
      title: `SO Numbers \u2014 ${group.displayName}`,
      subtitle: `${soNos.length} selected`,
      content: text,
    });
    setCopyState("idle");
  }, [checked]);

  const handleCopyReply = useCallback((group: SoGroup) => {
    const selectedOrders = group.orders.filter(o => checked.get(o.id) && o.soNumber);
    const orderData = selectedOrders.map(o => ({
      customerName: orderDisplayName(o),
      customerCode: o.customerCode ?? null,
      area: o.customerArea ?? null,
      soNumber: o.soNumber!,
      flags: getOrderFlags(o),
    }));
    const template = buildReplyTemplate(group.soName, orderData);
    setPreview({
      title: `Reply Preview \u2014 ${group.displayName}`,
      subtitle: `${selectedOrders.length} selected`,
      content: template,
    });
    setCopyState("idle");
  }, [checked, orderDisplayName]);

  const handleCopyPreview = useCallback(() => {
    if (!preview) return;
    navigator.clipboard.writeText(preview.content);
    setCopyState("copied");
    setTimeout(() => setCopyState("idle"), 1500);
  }, [preview]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/15 transition-opacity duration-250 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed right-0 top-0 bottom-0 z-50 w-[420px] bg-white shadow-xl flex flex-col transition-transform duration-250 ease-in-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="h-[48px] flex items-center justify-between px-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <Users size={15} className="text-teal-600" />
            <span className="text-[13px] font-semibold text-gray-800">SO Summary</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Stats bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200 shrink-0">
          <span className="text-[11px] text-gray-500">
            {soGroups.length} SOs &middot; {totalPunched} punched orders
          </span>
          <span className="text-[11px] text-gray-400 font-mono">
            {new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" })}
          </span>
        </div>

        {/* SO filter */}
        <div className="px-4 py-2 border-b border-gray-200 shrink-0">
          <input
            type="text"
            value={soFilter}
            onChange={e => setSoFilter(e.target.value)}
            placeholder="Filter by SO name..."
            className="w-full h-[30px] text-[11px] px-2.5 border border-gray-200 rounded-md bg-white text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
          />
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {filteredGroups.length === 0 && (
            <p className="text-center text-gray-400 mt-8 text-[12px]">No matching SOs</p>
          )}

          {filteredGroups.map(group => {
            const punchedWithSo = group.orders.filter(o => o.status === "punched" && !!o.soNumber);
            const allGroupChecked = punchedWithSo.length > 0 && punchedWithSo.every(o => checked.get(o.id));
            const checkedCount = group.orders.filter(o => checked.get(o.id)).length;

            return (
              <div key={group.soName} className="border-b border-gray-100">
                {/* Group header */}
                <div className="sticky top-0 z-10 bg-white flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={allGroupChecked}
                      onChange={() => toggleGroup(group)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-gray-800 truncate">{group.displayName}</p>
                      <p className="text-[10px] text-gray-400">
                        {group.orders.length} orders &middot; {group.punchedCount} punched
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleCopySoNos(group)}
                      disabled={checkedCount === 0}
                      className="text-[10px] font-medium px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      SO Nos.
                    </button>
                    <button
                      onClick={() => handleCopyReply(group)}
                      disabled={checkedCount === 0}
                      className="text-[10px] font-medium px-2 py-1 rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Reply
                    </button>
                  </div>
                </div>

                {/* Order rows */}
                {group.orders.map(order => {
                  const isPunched = order.status === "punched";
                  const hasSo = !!order.soNumber;
                  const dimmed = !isPunched || !hasSo;
                  const flagged = isOdCiFlagged(order);
                  const vol = getOrderVolume(order.lines);
                  const flags = getOrderFlags(order);

                  return (
                    <div
                      key={order.id}
                      className={`flex items-center gap-2.5 px-4 py-2 ${dimmed ? "opacity-50" : ""} ${flagged ? "bg-red-50/30" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked.get(order.id) ?? false}
                        onChange={() => toggleOrder(order.id)}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[12px] font-medium text-gray-800 truncate">
                              {orderDisplayName(order)}
                            </span>
                            {flags.map(f => (
                              <span
                                key={f}
                                className="text-[9px] font-medium px-1.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200 shrink-0"
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                          {hasSo ? (
                            <span className="font-mono text-[10px] text-gray-500 shrink-0">
                              {order.soNumber}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-400 italic shrink-0">
                              pending
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-gray-400 mt-0.5">
                          <span>{formatTime(order.receivedAt)}</span>
                          <span>&middot;</span>
                          <span className={
                            order.dispatchStatus === "Hold"
                              ? "text-red-500"
                              : order.dispatchStatus === "Dispatch"
                                ? "text-green-500"
                                : ""
                          }>
                            {order.dispatchStatus ?? "Dispatch"}
                          </span>
                          {vol > 0 && (
                            <>
                              <span>&middot;</span>
                              <span>{formatVolume(vol)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Template preview */}
        {preview && (
          <div className="border-t border-gray-200 shrink-0">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50">
              <div>
                <span className="text-[11px] font-medium text-gray-700">{preview.title}</span>
                <span className="text-[10px] text-gray-400 ml-2">{preview.subtitle}</span>
              </div>
              <button
                onClick={handleCopyPreview}
                className="inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded bg-teal-600 text-white hover:bg-teal-700 transition-colors"
              >
                {copyState === "copied" ? (
                  <>
                    <Check size={10} />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={10} />
                    Copy
                  </>
                )}
              </button>
            </div>
            <div className="px-4 py-3">
              <pre className="font-mono text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded p-3 max-h-[200px] overflow-y-auto whitespace-pre-wrap">
                {preview.content}
              </pre>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
