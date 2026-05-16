"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Pause } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type Reason =
  | "lunch_break"
  | "shift_end"
  | "machine_breakdown"
  | "material_shortage"
  | "urgent_priority";

const REASON_OPTIONS: Array<{ value: Reason; label: string }> = [
  { value: "lunch_break",       label: "Lunch break" },
  { value: "shift_end",         label: "End of shift" },
  { value: "machine_breakdown", label: "Machine breakdown" },
  { value: "material_shortage", label: "Material shortage" },
  { value: "urgent_priority",   label: "Urgent priority job" },
];

export interface PauseJobModalProps {
  open:      boolean;
  onClose:   () => void;
  onSuccess: () => void;
  assignment: {
    /** tint_assignments.id — whole-OBD only per Phase 4a route contract. */
    id:           number;
    obdNumber:    string;
    customerName: string;
    /** startedAt of the current run (server normalises to UTC). */
    startedAt:    string | Date;
    skus: Array<{
      skuId:       number;
      skuCode:     string;
      shadeName:   string;
      shadeCode?:  string;
      assignedQty: number;
    }>;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatStartedAgo(startedAt: string | Date): string {
  const start = typeof startedAt === "string"
    ? new Date(startedAt.endsWith("Z") ? startedAt : startedAt + "Z").getTime()
    : startedAt.getTime();
  const ms = Math.max(0, Date.now() - start);
  const m  = Math.floor(ms / 60000);
  const h  = Math.floor(m / 60);
  const mr = m % 60;
  if (h === 0) return `${mr}m`;
  return `${h}h ${mr}m`;
}

// ── Component ────────────────────────────────────────────────────────────────

export function PauseJobModal({
  open,
  onClose,
  onSuccess,
  assignment,
}: PauseJobModalProps): React.JSX.Element | null {
  const [reason,       setReason]       = useState<"" | Reason>("");
  const [remark,       setRemark]       = useState("");
  const [progress,     setProgress]     = useState<Record<number, number>>({});
  const [submitting,   setSubmitting]   = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setReason("");
    setRemark("");
    setProgress(Object.fromEntries(assignment.skus.map(s => [s.skuId, 0])));
    setSubmitting(false);
    setErrorMessage(null);
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

  // ── Derived ────────────────────────────────────────────────────────────────
  const remarkLen     = remark.length;
  const skuCount      = assignment.skus.length;
  const sinceStart    = useMemo(() => formatStartedAgo(assignment.startedAt), [assignment.startedAt]);
  const charCountColor =
    remarkLen >= 500 ? "text-red-600"   :
    remarkLen >= 450 ? "text-amber-600" :
                       "text-gray-400";

  // ── Validation ─────────────────────────────────────────────────────────────
  const reasonValid   = reason !== "";
  const remarkValid   = remarkLen <= 500;
  const progressValid = assignment.skus.every(s => {
    const v = progress[s.skuId] ?? 0;
    return Number.isFinite(v) && v >= 0 && v <= s.assignedQty;
  });
  const valid = reasonValid && remarkValid && progressValid;

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
    // Allow over-cap during typing so the red-state validation banner triggers
    // (instead of silently clamping). Submit is blocked by `progressValid`.
    setProgress(prev => ({ ...prev, [skuId]: Math.max(0, n) }));
    if (errorMessage) setErrorMessage(null);
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(): Promise<void> {
    if (!valid || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const trimmedRemark = remark.trim();
      const body: Record<string, unknown> = {
        assignmentId: assignment.id,
        reason,
        progress: assignment.skus.map(s => ({
          skuId:   s.skuId,
          doneQty: progress[s.skuId] ?? 0,
        })),
      };
      if (trimmedRemark.length > 0) body.remark = trimmedRemark;

      const res = await fetch("/api/tint/operator/pause", {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || (json as { ok?: boolean }).ok === false) {
        const errRaw = (json as { error?: unknown }).error;
        const errMsg = typeof errRaw === "string"
          ? errRaw
          : "Could not pause job. Please retry.";
        setErrorMessage(errMsg);
        return;
      }
      toast.success("Job paused");
      onSuccess();
      onClose();
    } catch (err) {
      console.error("[pause-job] submit failed", err);
      setErrorMessage("Network error. Please try again.");
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
        aria-labelledby="pause-job-title"
        className="bg-white rounded-xl shadow-xl w-[540px] max-h-[90vh] overflow-y-auto p-[22px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <h3 id="pause-job-title" className="text-[16px] font-semibold text-gray-900">
            Pause Job — OBD <span className="font-mono text-[14px]">{assignment.obdNumber}</span>
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
          {assignment.customerName} · {skuCount} SKU{skuCount === 1 ? "" : "s"} · Tinting started {sinceStart} ago
        </div>

        {/* Block 1: Reason */}
        <div className="mb-[16px]">
          <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">
            Why are you pausing?<span className="text-red-600 ml-0.5">*</span>
          </label>
          {REASON_OPTIONS.map(opt => {
            const selected = reason === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setReason(opt.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                disabled={submitting}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 border rounded-lg mb-1.5 text-left transition-colors",
                  selected
                    ? "bg-amber-50 border-amber-300"
                    : "bg-white border-gray-100 hover:bg-gray-50",
                  submitting && "opacity-60 cursor-not-allowed",
                )}
              >
                <span
                  className={cn(
                    "w-[14px] h-[14px] rounded-full border-2 flex-shrink-0",
                    selected
                      ? "border-amber-600 bg-amber-600"
                      : "border-gray-300 bg-white",
                  )}
                  style={selected ? { boxShadow: "inset 0 0 0 3px white" } : undefined}
                />
                <span className="text-[13px] text-gray-900">{opt.label}</span>
              </button>
            );
          })}
        </div>

        {/* Block 2: Remark */}
        <div className="mb-[16px]">
          <label
            htmlFor="pause-job-remark"
            className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5"
          >
            Remark
            <span className="ml-1 font-normal normal-case tracking-normal text-gray-400">
              — optional
            </span>
          </label>
          <textarea
            id="pause-job-remark"
            value={remark}
            onChange={(e) => {
              setRemark(e.target.value.slice(0, 500));
              if (errorMessage) setErrorMessage(null);
            }}
            placeholder="Add any context for the Tint Manager…"
            disabled={submitting}
            className="w-full min-h-[64px] px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none resize-y focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <div className={cn("text-[11px] mt-1 text-right", charCountColor)}>
            {remarkLen} / 500
          </div>
        </div>

        {/* Block 3: Per-SKU progress */}
        <div className="mb-[16px]">
          <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">
            Capture progress<span className="text-red-600 ml-0.5">*</span>
            <span className="ml-1 font-normal normal-case tracking-normal text-gray-400">
              — whole tins only
            </span>
          </label>

          {assignment.skus.map(sku => {
            const v       = progress[sku.skuId] ?? 0;
            const overCap = v > sku.assignedQty;
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
                  <div className={cn("text-[11px] mt-0.5", overCap ? "text-red-600" : "text-gray-500")}>
                    {overCap
                      ? `Cannot exceed assigned quantity (${sku.assignedQty})`
                      : `Assigned: ${sku.assignedQty} tins · Done so far:`}
                  </div>
                </div>
                <div className={cn(
                  "inline-flex border rounded-md overflow-hidden flex-shrink-0",
                  overCap ? "border-red-300" : "border-gray-200",
                )}>
                  <button
                    type="button"
                    onClick={() => adjustProgress(sku.skuId, -1)}
                    disabled={submitting || v <= 0}
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
                    disabled={submitting}
                    className={cn(
                      "w-[50px] h-8 text-center text-[13px] font-mono outline-none border-l border-r",
                      overCap ? "border-red-300 text-red-600" : "border-gray-200 text-gray-900",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => adjustProgress(sku.skuId, 1)}
                    disabled={submitting || v >= sku.assignedQty}
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

        {/* Helper */}
        <div className="text-[11.5px] text-gray-600 italic leading-relaxed mb-3">
          Pausing frees up your current slot. The next job in your queue will appear automatically.
        </div>

        {/* Error banner */}
        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3 text-[12px] text-red-700">
            {errorMessage}
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-9 px-3.5 text-[13px] text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          {/* Pause CTA — amber-600 per Phase 4 spec (semantic match: waiting/paused). */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!valid || submitting}
            className={cn(
              "h-9 px-3.5 text-[13px] font-medium rounded-lg inline-flex items-center gap-1.5 text-white",
              valid && !submitting
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-gray-300 cursor-not-allowed",
            )}
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin" size={14} />
                Pausing…
              </>
            ) : (
              <>
                <Pause size={13} fill="currentColor" />
                Pause Job
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
