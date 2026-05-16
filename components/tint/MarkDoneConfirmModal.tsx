"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MarkDoneConfirmModalProps {
  open:      boolean;
  onClose:   () => void;
  onSuccess: () => void;
  assignment: {
    /** orders.id — the done route takes orderId (not assignmentId). */
    orderId:      number;
    obdNumber:    string;
    customerName: string;
    /** startedAt of the current run (server normalises to UTC). */
    startedAt:    string | Date | null;
    /** Already-accumulated minutes carried forward from prior pause cycles. */
    accumulatedMinutes: number;
    pauseCount:         number;
    skus: Array<{
      skuId:       number;
      skuCode:     string;
      shadeName:   string;
      assignedQty: number;
    }>;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseStarted(startedAt: string | Date | null): number | null {
  if (!startedAt) return null;
  if (startedAt instanceof Date) return startedAt.getTime();
  return new Date(startedAt.endsWith("Z") ? startedAt : startedAt + "Z").getTime();
}

function formatHm(minutes: number): string {
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const h  = Math.floor(minutes / 60);
  const mr = minutes % 60;
  return mr === 0 ? `${h}h` : `${h}h ${mr}m`;
}

// ── Component ────────────────────────────────────────────────────────────────

export function MarkDoneConfirmModal({
  open,
  onClose,
  onSuccess,
  assignment,
}: MarkDoneConfirmModalProps): React.JSX.Element | null {
  // Per-SKU done qty. Default each row to assignedQty so the typical one-click
  // flow stays fast — operator overrides only on partial completion.
  const [progress,     setProgress]     = useState<Record<number, number>>({});
  const [submitting,   setSubmitting]   = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Two-stage flow: state 1 = edit; state 2 = soft confirm on partial done.
  const [confirming,   setConfirming]   = useState(false);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setProgress(Object.fromEntries(assignment.skus.map(s => [s.skuId, s.assignedQty])));
    setSubmitting(false);
    setErrorMessage(null);
    setConfirming(false);
  }, [open, assignment]);

  // Esc to close (blocked while submitting)
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (submitting) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  // ── Derived totals + time math (display only — server recomputes) ─────────
  const totalAssigned = useMemo(
    () => assignment.skus.reduce((s, x) => s + x.assignedQty, 0),
    [assignment.skus],
  );
  const totalDone = useMemo(
    () => assignment.skus.reduce((s, x) => s + (progress[x.skuId] ?? 0), 0),
    [assignment.skus, progress],
  );
  const isPartial = totalDone < totalAssigned;
  const diff      = Math.max(0, totalAssigned - totalDone);

  // Client-side estimate for the read-only "Total tinting time" line. The
  // server is authoritative; this only powers the modal copy.
  // accumulatedMinutes captures every prior run delta (filled by pause
  // events). The final run is now − startedAt.
  const finalRunMinutes = useMemo(() => {
    const start = parseStarted(assignment.startedAt);
    if (start == null) return 0;
    return Math.max(0, Math.floor((Date.now() - start) / 60000));
  }, [assignment.startedAt]);
  const totalMinutes     = assignment.accumulatedMinutes + finalRunMinutes;
  const priorRunsMinutes = assignment.pauseCount > 0 ? assignment.accumulatedMinutes : 0;

  // ── Validity ───────────────────────────────────────────────────────────────
  const progressValid = assignment.skus.every(s => {
    const v = progress[s.skuId] ?? 0;
    return Number.isFinite(v) && v >= 0 && v <= s.assignedQty;
  });
  const valid = progressValid;

  // ── Stepper handlers ───────────────────────────────────────────────────────
  function adjustProgress(skuId: number, delta: number): void {
    setProgress(prev => {
      const sku  = assignment.skus.find(s => s.skuId === skuId);
      const max  = sku?.assignedQty ?? 0;
      const cur  = prev[skuId] ?? 0;
      const next = Math.max(0, Math.min(max, cur + delta));
      return { ...prev, [skuId]: next };
    });
    if (errorMessage) setErrorMessage(null);
  }

  function setProgressInput(skuId: number, raw: string): void {
    if (raw === "") { setProgress(prev => ({ ...prev, [skuId]: 0 })); return; }
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return;
    setProgress(prev => ({ ...prev, [skuId]: Math.max(0, n) }));
    if (errorMessage) setErrorMessage(null);
  }

  // ── Confirm flow ───────────────────────────────────────────────────────────
  function handleConfirmClick(): void {
    if (!valid || submitting) return;
    // Soft confirm on partial done — second click required.
    if (isPartial && !confirming) {
      setConfirming(true);
      return;
    }
    void handleSubmit();
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const body = {
        orderId:  assignment.orderId,
        progress: assignment.skus.map(s => ({
          skuId:   s.skuId,
          doneQty: progress[s.skuId] ?? 0,
        })),
      };
      const res = await fetch("/api/tint/operator/done", {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || (data as { success?: boolean }).success === false) {
        const errRaw = (data as { error?: unknown }).error;
        const errMsg = typeof errRaw === "string"
          ? errRaw
          : "Could not mark job done. Please retry.";
        setErrorMessage(errMsg);
        // If we were in the confirming state, drop back to editing so the user
        // can adjust and retry without losing what they typed.
        setConfirming(false);
        return;
      }
      toast.success("Job marked done");
      onSuccess();
      onClose();
    } catch (err) {
      console.error("[mark-done] submit failed", err);
      setErrorMessage("Network error. Please try again.");
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={() => { if (!submitting) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="markdone-title"
        className="bg-white rounded-xl shadow-xl w-[540px] max-h-[90vh] overflow-y-auto p-[22px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <h3 id="markdone-title" className="text-[16px] font-semibold text-gray-900">
            Mark Job Done — OBD <span className="font-mono text-[14px]">{assignment.obdNumber}</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-7 h-7 rounded-md text-gray-400 hover:text-gray-600 inline-flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="text-[11.5px] text-gray-500 mb-[16px]">
          {assignment.customerName} · {assignment.skus.length} SKU{assignment.skus.length === 1 ? "" : "s"} · Confirm final tin counts
        </div>

        {/* Per-SKU progress steppers (always rendered; disabled in soft-confirm) */}
        <div className="mb-[16px]">
          <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">
            Final progress<span className="text-red-600 ml-0.5">*</span>
            <span className="ml-1 font-normal normal-case tracking-normal text-gray-400">
              — defaults to assigned qty
            </span>
          </label>

          {assignment.skus.map(sku => {
            const v       = progress[sku.skuId] ?? 0;
            const overCap = v > sku.assignedQty;
            const isShort = v < sku.assignedQty;
            const showShade = sku.shadeName && sku.shadeName !== sku.skuCode;
            return (
              <div
                key={sku.skuId}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 border rounded-lg mb-1.5 bg-white",
                  overCap ? "border-red-300" : "border-gray-100",
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-gray-900 truncate">
                    <span className="font-mono text-[11px] text-gray-600">{sku.skuCode}</span>
                    {showShade && (
                      <> · <span className="text-gray-900">{sku.shadeName}</span></>
                    )}
                  </div>
                  <div className={cn(
                    "text-[11px] mt-0.5",
                    overCap ? "text-red-600" : isShort ? "text-amber-700" : "text-gray-500",
                  )}>
                    {overCap
                      ? `Cannot exceed assigned quantity (${sku.assignedQty})`
                      : isShort
                        ? `Assigned: ${sku.assignedQty} · short by ${sku.assignedQty - v}`
                        : `Assigned: ${sku.assignedQty} · all done`}
                  </div>
                </div>
                <div className={cn(
                  "inline-flex border rounded-md overflow-hidden flex-shrink-0",
                  overCap ? "border-red-300" : "border-gray-200",
                )}>
                  <button
                    type="button"
                    onClick={() => adjustProgress(sku.skuId, -1)}
                    disabled={submitting || confirming || v <= 0}
                    className="w-7 h-8 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center text-[14px] font-semibold"
                    aria-label={`Decrement ${sku.skuCode}`}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={sku.assignedQty}
                    value={v}
                    onChange={(e) => setProgressInput(sku.skuId, e.target.value)}
                    disabled={submitting || confirming}
                    className={cn(
                      "w-[50px] h-8 text-center text-[13px] font-mono outline-none border-l border-r disabled:bg-gray-50",
                      overCap ? "border-red-300 text-red-600" : "border-gray-200 text-gray-900",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => adjustProgress(sku.skuId, 1)}
                    disabled={submitting || confirming || v >= sku.assignedQty}
                    className="w-7 h-8 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center text-[14px] font-semibold"
                    aria-label={`Increment ${sku.skuCode}`}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Total tinting time (read-only, client-side estimate) */}
        <div className="bg-gray-50 border border-gray-100 rounded-md px-3 py-2 mb-3 text-[12px] text-gray-600">
          <div>
            Total tinting time: <span className="font-semibold text-gray-800">{formatHm(totalMinutes)}</span>
          </div>
          {assignment.pauseCount > 0 && (
            <div className="text-[11px] text-gray-500 mt-0.5">
              Includes {assignment.pauseCount} pause{assignment.pauseCount === 1 ? "" : "s"} · {formatHm(priorRunsMinutes)} tinted before the final run
            </div>
          )}
        </div>

        {/* Soft-confirm banner (only when partial AND user clicked Confirm Done once) */}
        {confirming && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 mb-3 flex items-start gap-2.5">
            <AlertTriangle className="text-amber-700 flex-shrink-0 mt-0.5" size={14} />
            <div className="text-[12px] text-amber-800 leading-relaxed">
              Marking done at <span className="font-semibold">{totalDone}</span> of <span className="font-semibold">{totalAssigned}</span> tins.
              The remaining <span className="font-semibold">{diff}</span> tin{diff === 1 ? "" : "s"} won&rsquo;t be tracked further. Continue?
            </div>
          </div>
        )}

        {/* Error banner */}
        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3 text-[12px] text-red-700">
            {errorMessage}
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center justify-end gap-2">
          {confirming ? (
            <>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={submitting}
                className="h-9 px-3.5 text-[13px] text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirmClick}
                disabled={!valid || submitting}
                className={cn(
                  "h-9 px-3.5 text-[13px] font-medium rounded-lg inline-flex items-center gap-1.5 text-white",
                  valid && !submitting
                    ? "bg-gray-900 hover:bg-gray-800"
                    : "bg-gray-300 cursor-not-allowed",
                )}
              >
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin" size={14} />
                    Marking done…
                  </>
                ) : (
                  <>
                    <Check size={13} />
                    Yes, mark done
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="h-9 px-3.5 text-[13px] text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClick}
                disabled={!valid || submitting}
                className={cn(
                  "h-9 px-3.5 text-[13px] font-medium rounded-lg inline-flex items-center gap-1.5 text-white",
                  valid && !submitting
                    ? "bg-gray-900 hover:bg-gray-800"
                    : "bg-gray-300 cursor-not-allowed",
                )}
              >
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin" size={14} />
                    Marking done…
                  </>
                ) : (
                  <>
                    <Check size={13} />
                    Confirm Done
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
