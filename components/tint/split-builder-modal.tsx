"use client";

import { useState, useEffect } from "react";
import { Loader2, Plus, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModalLineItem {
  id:                number;
  lineId:            number;
  skuCodeRaw:        string;
  skuDescriptionRaw: string | null;
  unitQty:           number;
  volumeLine:        number | null;
  isTinting:         boolean;
  article:           number | null;
  articleTag:        string | null;
}

interface ExistingSplitItem {
  rawLineItemId: number;
  assignedQty:   number;
}

interface PreviousSplit {
  id:             number;
  splitNumber:    number;
  status:         string;
  totalQty:       number;
  articleTag:     string | null;
  dispatchStatus: string | null;
  createdAt:      string;
  assignedTo:     { name: string };
  lineItems: {
    assignedQty: number;
    rawLineItem: {
      skuCodeRaw:        string;
      skuDescriptionRaw: string | null;
    };
  }[];
}

export interface SplitBuilderModalProps {
  open:     boolean;
  onClose:  () => void;
  order: {
    id:             number;
    obdNumber:      string;
    customerName:   string;
    lineItems:      ModalLineItem[];
    existingSplits: ExistingSplitItem[];
    previousSplits: PreviousSplit[];
  };
  operators: { id: number; name: string }[];
  onSuccess: () => void;
}

interface SplitDraftLine {
  rawLineItemId: number;
  assignedQty:   number;
}

interface SplitDraft {
  id:           string;
  assignedToId: number | null;
  lines:        SplitDraftLine[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function makeInitialSplits(): SplitDraft[] {
  return [{ id: genId(), assignedToId: null, lines: [] }];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SplitBuilderModal({
  open,
  onClose,
  order,
  operators,
  onSuccess,
}: SplitBuilderModalProps) {
  const [splits,           setSplits]           = useState<SplitDraft[]>(makeInitialSplits);
  const [isLoading,        setIsLoading]        = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [addLineOpenFor,   setAddLineOpenFor]   = useState<string | null>(null);

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setSplits(makeInitialSplits());
      setError(null);
      setAddLineOpenFor(null);
    }
  }, [open]);

  // Close add-line dropdown on document click
  useEffect(() => {
    if (!addLineOpenFor) return;
    function handler() { setAddLineOpenFor(null); }
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [addLineOpenFor]);

  // ── Remaining qty helper ───────────────────────────────────────────────────

  function getRemainingQty(rawLineItemId: number): number {
    const total = order.lineItems.find((l) => l.id === rawLineItemId)?.unitQty ?? 0;
    const existingAssigned = (order.existingSplits ?? [])
      .filter((s) => s.rawLineItemId === rawLineItemId)
      .reduce((sum, s) => sum + s.assignedQty, 0);
    const draftAssigned = splits
      .flatMap((s) => s.lines)
      .filter((l) => l.rawLineItemId === rawLineItemId)
      .reduce((sum, l) => sum + l.assignedQty, 0);
    return total - existingAssigned - draftAssigned;
  }

  // ── Draft mutations ────────────────────────────────────────────────────────

  function addSplit() {
    setSplits((prev) => [...prev, { id: genId(), assignedToId: null, lines: [] }]);
  }

  function removeSplit(splitId: string) {
    setSplits((prev) => prev.filter((s) => s.id !== splitId));
  }

  function setOperator(splitId: string, operatorId: number | null) {
    setSplits((prev) =>
      prev.map((s) => (s.id === splitId ? { ...s, assignedToId: operatorId } : s)),
    );
  }

  function addLineToSplit(splitId: string, rawLineItemId: number) {
    setSplits((prev) =>
      prev.map((s) => {
        if (s.id !== splitId) return s;
        if (s.lines.some((l) => l.rawLineItemId === rawLineItemId)) return s;
        return { ...s, lines: [...s.lines, { rawLineItemId, assignedQty: 1 }] };
      }),
    );
  }

  function removeLineFromSplit(splitId: string, rawLineItemId: number) {
    setSplits((prev) =>
      prev.map((s) =>
        s.id === splitId
          ? { ...s, lines: s.lines.filter((l) => l.rawLineItemId !== rawLineItemId) }
          : s,
      ),
    );
  }

  function updateLineQty(splitId: string, rawLineItemId: number, qty: number) {
    setSplits((prev) =>
      prev.map((s) =>
        s.id === splitId
          ? {
              ...s,
              lines: s.lines.map((l) =>
                l.rawLineItemId === rawLineItemId ? { ...l, assignedQty: qty } : l,
              ),
            }
          : s,
      ),
    );
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const totalAvailable   = order.lineItems.reduce((sum, l) => sum + l.unitQty, 0);
  const existingTotal    = (order.existingSplits ?? []).reduce((sum, s) => sum + s.assignedQty, 0);
  const draftTotal       = splits.flatMap((s) => s.lines).reduce((sum, l) => sum + l.assignedQty, 0);
  const hasAvailableLines = order.lineItems.some((l) => getRemainingQty(l.id) > 0);

  const isConfirmDisabled =
    isLoading ||
    splits.some((s) => s.assignedToId === null) ||
    splits.some((s) => s.lines.length === 0) ||
    splits.some((s) => s.lines.some((l) => l.assignedQty <= 0));

  // ── Confirm handler ────────────────────────────────────────────────────────

  async function handleConfirm() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tint/manager/splits/create", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          orderId: order.id,
          splits:  splits.map((s) => ({
            assignedToId: s.assignedToId,
            lines:        s.lines,
          })),
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to create splits");
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setIsLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(isOpen: boolean) => { if (!isOpen) onClose(); }}>
      <DialogContent
        className="max-w-4xl sm:max-w-4xl w-full p-0 gap-0 overflow-hidden"
        showCloseButton={false}
      >

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-b border-gray-200">
          <p className="text-[11px] font-bold uppercase tracking-[.6px] text-gray-400 mb-1">
            Create Tint Splits
          </p>
          <h2 className="text-[15px] font-bold text-gray-900">{order.customerName}</h2>
          <p className="text-[11.5px] font-mono text-gray-400">{order.obdNumber}</p>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div className="flex overflow-hidden" style={{ height: "520px" }}>

          {/* Left panel — Available Lines (40%) */}
          <div className="w-2/5 border-r border-gray-200 flex flex-col">
            <div className="px-4 py-2.5 border-b border-gray-200">
              <p className="text-[10.5px] font-bold uppercase tracking-[.5px] text-gray-400">
                Available Lines
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
              {order.lineItems.map((line) => {
                const existing = (order.existingSplits ?? [])
                  .filter((s) => s.rawLineItemId === line.id)
                  .reduce((sum, s) => sum + s.assignedQty, 0);
                const draftUsed = splits
                  .flatMap((s) => s.lines)
                  .filter((l) => l.rawLineItemId === line.id)
                  .reduce((sum, l) => sum + l.assignedQty, 0);
                const remaining = line.unitQty - existing - draftUsed;

                return (
                  <div
                    key={line.id}
                    className="bg-white border border-gray-200 rounded-lg p-3"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[11.5px] font-semibold text-violet-600">
                        {line.skuCodeRaw}
                      </span>
                      {line.isTinting && (
                        <span className="text-[9.5px] font-bold uppercase tracking-wide bg-violet-50 text-violet-600 border border-violet-200 px-1.5 py-0.5 rounded-full">
                          Tint
                        </span>
                      )}
                    </div>
                    {line.skuDescriptionRaw && (
                      <p className="text-[11px] text-gray-500 leading-snug line-clamp-2 mb-2">
                        {line.skuDescriptionRaw}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-[11px] flex-wrap">
                      <span className="text-gray-400">
                        Total:{" "}
                        <span className="font-semibold text-gray-700">{line.unitQty}</span>
                      </span>
                      {(existing + draftUsed) > 0 && (
                        <span className="text-gray-400">
                          Assigned:{" "}
                          <span className="font-semibold text-gray-700">
                            {existing + draftUsed}
                          </span>
                        </span>
                      )}
                      <span
                        className={cn(
                          "font-semibold",
                          remaining > 0 ? "text-green-600" : "text-red-500",
                        )}
                      >
                        Remaining: {remaining}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right panel — Splits (60%) */}
          <div className="flex-1 flex flex-col">
            <div className="px-4 py-2.5 border-b border-gray-200">
              <p className="text-[10.5px] font-bold uppercase tracking-[.5px] text-gray-400">
                Splits
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">

              {splits.map((split, splitIndex) => {
                const splitTotalQty = split.lines.reduce((sum, l) => sum + l.assignedQty, 0);
                const splitVolume   = split.lines.reduce((sum, l) => {
                  const raw = order.lineItems.find((li) => li.id === l.rawLineItemId);
                  if (!raw || !raw.volumeLine || raw.unitQty === 0) return sum;
                  return sum + (l.assignedQty / raw.unitQty) * raw.volumeLine;
                }, 0);

                // Lines that can still be added to this split
                const availableToAdd = order.lineItems.filter((line) => {
                  if (split.lines.some((l) => l.rawLineItemId === line.id)) return false;
                  return getRemainingQty(line.id) > 0;
                });

                const isDropdownOpen  = addLineOpenFor === split.id;
                const canRemoveSplit  = split.lines.length === 0 && splits.length > 1;

                return (
                  <div
                    key={split.id}
                    className="bg-white border border-gray-200 rounded-xl overflow-visible"
                  >
                    {/* Split card header */}
                    <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200 rounded-t-xl">
                      <span className="text-[12.5px] font-bold text-gray-700">
                        Split {splitIndex + 1}
                      </span>
                      {canRemoveSplit && (
                        <button
                          type="button"
                          onClick={() => removeSplit(split.id)}
                          className="flex items-center gap-1 text-[11px] text-red-500 hover:text-red-700 transition-colors"
                        >
                          <X size={12} />
                          Remove
                        </button>
                      )}
                    </div>

                    <div className="p-3 flex flex-col gap-3">

                      {/* Operator picker */}
                      <div>
                        <label className="text-[10.5px] font-bold uppercase tracking-[.4px] text-gray-400 block mb-1.5">
                          Assign To
                        </label>
                        <select
                          value={split.assignedToId ?? ""}
                          onChange={(e) =>
                            setOperator(
                              split.id,
                              e.target.value ? Number(e.target.value) : null,
                            )
                          }
                          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-[12.5px] text-gray-700 bg-white focus:outline-none focus:border-teal-600"
                        >
                          <option value="">Select operator…</option>
                          {operators.map((op) => (
                            <option key={op.id} value={op.id}>
                              {op.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Line assignments */}
                      {split.lines.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          {split.lines.map((splitLine) => {
                            const rawLine = order.lineItems.find(
                              (l) => l.id === splitLine.rawLineItemId,
                            );
                            if (!rawLine) return null;
                            const remaining = getRemainingQty(splitLine.rawLineItemId);
                            const maxQty    = splitLine.assignedQty + remaining;

                            return (
                              <div
                                key={splitLine.rawLineItemId}
                                className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="font-mono text-[11.5px] font-semibold text-violet-600 truncate">
                                    {rawLine.skuCodeRaw}
                                  </p>
                                  {rawLine.skuDescriptionRaw && (
                                    <p className="text-[10.5px] text-gray-400 truncate">
                                      {rawLine.skuDescriptionRaw}
                                    </p>
                                  )}
                                </div>
                                <input
                                  type="number"
                                  min={1}
                                  max={maxQty}
                                  value={splitLine.assignedQty}
                                  onChange={(e) => {
                                    const v = parseInt(e.target.value, 10);
                                    if (!isNaN(v) && v >= 1 && v <= maxQty) {
                                      updateLineQty(split.id, splitLine.rawLineItemId, v);
                                    }
                                  }}
                                  className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-[12px] text-center text-gray-800 bg-white focus:outline-none focus:border-teal-600"
                                />
                                <span className="text-[10.5px] text-gray-400 w-12 text-right flex-shrink-0">
                                  / {maxQty}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    removeLineFromSplit(split.id, splitLine.rawLineItemId)
                                  }
                                  className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Add Line button + dropdown */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddLineOpenFor(isDropdownOpen ? null : split.id);
                          }}
                          disabled={availableToAdd.length === 0}
                          className="flex items-center gap-1.5 text-[11.5px] font-semibold text-teal-700 hover:text-teal-700 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                        >
                          <Plus size={13} />
                          Add Line
                          {availableToAdd.length === 0 && (
                            <span className="font-normal text-gray-300"> (none available)</span>
                          )}
                        </button>

                        {isDropdownOpen && (
                          <div
                            className="absolute left-0 top-7 z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[260px] max-h-[200px] overflow-y-auto"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {availableToAdd.map((line) => {
                              const rem = getRemainingQty(line.id);
                              return (
                                <button
                                  key={line.id}
                                  type="button"
                                  onClick={() => addLineToSplit(split.id, line.id)}
                                  className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-gray-50 transition-colors"
                                >
                                  <span className="font-mono text-[11.5px] font-semibold text-violet-600 flex-shrink-0">
                                    {line.skuCodeRaw}
                                  </span>
                                  <span className="text-[11px] text-gray-400 flex-1 truncate">
                                    {line.skuDescriptionRaw}
                                  </span>
                                  <span className="text-[11px] text-green-600 font-semibold flex-shrink-0">
                                    {rem} left
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Split summary */}
                      {split.lines.length > 0 && (
                        <div className="flex items-center gap-4 pt-2 border-t border-gray-200 text-[11px]">
                          <span className="text-gray-500">
                            Total Qty:{" "}
                            <span className="font-bold text-gray-800">{splitTotalQty}</span>
                          </span>
                          {splitVolume > 0 && (
                            <span className="text-gray-500">
                              Est. Volume:{" "}
                              <span className="font-bold text-gray-800">
                                {splitVolume.toFixed(2)} L
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Add Split button */}
              <button
                type="button"
                onClick={addSplit}
                disabled={!hasAvailableLines}
                className="flex items-center justify-center gap-2 w-full py-2.5 border-2 border-dashed border-teal-200 rounded-xl text-[12px] font-semibold text-teal-700 hover:border-teal-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Plus size={14} />
                Add Split
              </button>

              {/* Previous Splits history */}
              {order.previousSplits.length > 0 && (
                <div className="mt-6 pt-5 border-t border-gray-200">

                  {/* Section title */}
                  <p className="text-[10px] font-extrabold uppercase tracking-[.7px] text-gray-400 mb-3">
                    Previous Splits ({order.previousSplits.length})
                  </p>

                  <div className="flex flex-col gap-2.5">
                    {order.previousSplits.map((split) => (
                      <div
                        key={split.id}
                        className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3"
                      >
                        {/* Header row: Split number + status badge + date/time */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-bold text-gray-800">
                              Split {split.splitNumber}
                            </span>

                            {/* Tinting status badge */}
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                              split.status === "tinting_done" || split.status === "pending_support"
                                ? "bg-green-50 text-green-700 border-green-200"
                                : split.status === "tinting_in_progress"
                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                : split.status === "dispatch_confirmation" || split.status === "dispatched"
                                ? "bg-teal-50 text-teal-700 border-teal-200"
                                : "bg-amber-50 text-amber-700 border-amber-200"
                            )}>
                              {split.status.replace(/_/g, " ")}
                            </span>

                            {/* Dispatch status badge — only if set */}
                            {split.dispatchStatus && (
                              <span className={cn(
                                "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                                split.dispatchStatus === "dispatch"
                                  ? "bg-green-50 text-green-700 border-green-200"
                                  : split.dispatchStatus === "hold"
                                  ? "bg-red-50 text-red-700 border-red-200"
                                  : "bg-amber-50 text-amber-700 border-amber-200"
                              )}>
                                {split.dispatchStatus === "waiting_for_confirmation"
                                  ? "Waiting"
                                  : split.dispatchStatus.charAt(0).toUpperCase() +
                                    split.dispatchStatus.slice(1)}
                              </span>
                            )}
                          </div>

                          {/* Created date + time */}
                          <span className="text-[10.5px] text-gray-400 font-mono">
                            {new Date(split.createdAt).toLocaleDateString("en-GB", {
                              day: "numeric", month: "short", year: "numeric",
                            })}
                            {" "}
                            {new Date(split.createdAt).toLocaleTimeString("en-IN", {
                              hour: "2-digit", minute: "2-digit", hour12: true,
                            })}
                          </span>
                        </div>

                        {/* Operator + qty row */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full bg-teal-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                              {split.assignedTo.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)}
                            </div>
                            <span className="text-[11.5px] font-medium text-gray-700">
                              {split.assignedTo.name}
                            </span>
                          </div>
                          <span className="text-[11.5px] font-semibold text-gray-700">
                            {split.articleTag ?? `${split.totalQty} units`}
                          </span>
                        </div>

                        {/* Line items */}
                        <div className="flex flex-col gap-1">
                          {split.lineItems.map((item, idx) => (
                            <div key={idx} className="flex items-center justify-between text-[11px] text-gray-500">
                              <span className="font-mono text-violet-600 flex-shrink-0">
                                {item.rawLineItem.skuCodeRaw}
                              </span>
                              <span className="flex-1 px-2 truncate">
                                {item.rawLineItem.skuDescriptionRaw}
                              </span>
                              <span className="font-semibold text-gray-700 flex-shrink-0">
                                {item.assignedQty} units
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <div className="text-[12px] text-gray-500">
            <span className="font-semibold text-gray-800">
              {existingTotal + draftTotal}
            </span>
            {" of "}
            <span className="font-semibold text-gray-800">{totalAvailable}</span>
            {" total units assigned"}
          </div>

          <div className="flex items-center gap-2">
            {error && (
              <div className="flex items-center gap-1.5 text-[12px] text-red-600 mr-2 max-w-[260px]">
                <AlertCircle size={13} className="flex-shrink-0" />
                <span className="truncate">{error}</span>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="text-[12.5px] font-semibold text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isConfirmDisabled}
              className="text-[12.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading && <Loader2 className="animate-spin" size={14} />}
              Confirm Splits
            </button>
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}
