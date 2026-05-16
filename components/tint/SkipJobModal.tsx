"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Info, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  TINTER_SHADE_COLORS,
  ACOTONE_SHADE_COLORS,
  type ShadeColor,
} from "@/lib/tint/shade-colors";

// ── Types ────────────────────────────────────────────────────────────────────

type Reason =
  | "TINTER_FINISHED"
  | "MACHINE_BREAKDOWN"
  | "MATERIAL_SHORTAGE"
  | "OTHER";

type TinterType = "TINTER" | "ACOTONE";

const REASON_OPTIONS: Array<{ value: Reason; label: string }> = [
  { value: "TINTER_FINISHED",   label: "Tinter finished" },
  { value: "MACHINE_BREAKDOWN", label: "Machine breakdown" },
  { value: "MATERIAL_SHORTAGE", label: "Material shortage" },
  { value: "OTHER",             label: "Other" },
];

export interface SkipJobModalProps {
  open:      boolean;
  onClose:   () => void;
  onSkipped: () => void;
  job: {
    /** tint_assignments.id — whole-OBD only per Phase 3a route contract. */
    assignmentId:       number;
    obdNumber:          string;
    shipToCustomerName: string | null;
    smu:                string | null;
    /** Article summary string (e.g. "7 Tin, 2 Drum"). */
    articleTag:         string | null;
    /** Litres (number) or null. */
    totalVolume:        number | null;
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function SkipJobModal({
  open,
  onClose,
  onSkipped,
  job,
}: SkipJobModalProps): React.JSX.Element | null {
  const [reason,          setReason]          = useState<"" | Reason>("");
  const [tinterType,      setTinterType]      = useState<TinterType>("TINTER");
  const [selectedColours, setSelectedColours] = useState<string[]>([]);
  const [remark,          setRemark]          = useState("");
  const [submitting,      setSubmitting]      = useState(false);
  const [errorMessage,    setErrorMessage]    = useState<string | null>(null);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setReason("");
    setTinterType("TINTER");
    setSelectedColours([]);
    setRemark("");
    setSubmitting(false);
    setErrorMessage(null);
  }, [open]);

  // Esc to close (blocked while submitting)
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (submitting) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  // Tinter-type switch clears the colour selection — keeps the picked
  // codes meaningful inside the active palette.
  function handleTinterTypeChange(next: TinterType): void {
    if (next === tinterType) return;
    setTinterType(next);
    setSelectedColours([]);
  }

  function toggleColour(code: string): void {
    setSelectedColours((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
    if (errorMessage) setErrorMessage(null);
  }

  // ── Active palette ─────────────────────────────────────────────────────────
  const palette = useMemo<Array<[string, ShadeColor]>>(
    () => Object.entries(
      tinterType === "TINTER" ? TINTER_SHADE_COLORS : ACOTONE_SHADE_COLORS,
    ),
    [tinterType],
  );

  // ── Validation ─────────────────────────────────────────────────────────────
  const remarkLen = remark.length;
  const reasonValid = reason !== "";
  const tinterFinished = reason === "TINTER_FINISHED";
  const tinterFieldsValid = !tinterFinished
    || (selectedColours.length >= 1);
  const remarkValid = remarkLen <= 500;
  const valid = reasonValid && tinterFieldsValid && remarkValid;

  // Char counter colour (mirrors RemoveObdModal pattern).
  const charCountColor =
    remarkLen >= 500 ? "text-red-600"   :
    remarkLen >= 450 ? "text-amber-600" :
                       "text-gray-400";

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(): Promise<void> {
    if (!valid || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const trimmedRemark = remark.trim();
      const body: Record<string, unknown> = {
        assignmentId: job.assignmentId,
        reason,
      };
      if (reason === "TINTER_FINISHED") {
        body.tinterType        = tinterType;
        body.outOfStockColours = selectedColours;
      }
      if (trimmedRemark.length > 0) body.remark = trimmedRemark;

      const res = await fetch("/api/tint/operator/skip", {
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
          : "Could not skip job. Please try again.";
        setErrorMessage(errMsg);
        return;
      }
      toast.success("Job skipped — sent back to Tint Manager");
      onSkipped();
      onClose();
    } catch (err) {
      console.error("[skip-job] submit failed", err);
      setErrorMessage("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  // ── Job summary string ─────────────────────────────────────────────────────
  const customerName = job.shipToCustomerName ?? "—";
  const summaryParts: string[] = [];
  if (job.smu)                                summaryParts.push(job.smu);
  if (job.articleTag)                         summaryParts.push(job.articleTag);
  if (typeof job.totalVolume === "number")    summaryParts.push(`${Math.round(job.totalVolume)}L`);
  const summaryLine = summaryParts.join(" · ");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={() => { if (!submitting) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="skip-job-title"
        className="bg-white rounded-xl shadow-xl w-[520px] max-h-[90vh] overflow-y-auto p-[22px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-[14px]">
          <h3 id="skip-job-title" className="text-[16px] font-semibold text-gray-900">
            Skip Job
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

        {/* Job summary */}
        <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5 mb-[14px]">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-gray-900 font-medium">
              {job.obdNumber}
            </span>
            <span className="text-gray-400 text-[11px]">·</span>
            <span className="text-[11px] text-gray-500">Top of your queue</span>
          </div>
          <div className="text-[12px] text-gray-900 font-medium mt-1">{customerName}</div>
          {summaryLine && (
            <div className="text-[11px] text-gray-500 mt-0.5">{summaryLine}</div>
          )}
        </div>

        {/* Reason */}
        <div className="mb-[14px]">
          <label
            htmlFor="skip-job-reason"
            className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5"
          >
            Reason<span className="text-red-600 ml-0.5">*</span>
          </label>
          <select
            id="skip-job-reason"
            value={reason}
            onChange={(e) => {
              const next = e.target.value as ("" | Reason);
              setReason(next);
              if (next !== "TINTER_FINISHED") {
                // Other reasons don't carry tinter+colour state — clear.
                setSelectedColours([]);
              }
              if (errorMessage) setErrorMessage(null);
            }}
            disabled={submitting}
            className="w-full h-[38px] px-3 text-[13px] bg-white border border-gray-200 rounded-lg outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <option value="" disabled>Select a reason…</option>
            {REASON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* TINTER_FINISHED — conditional fields */}
        {tinterFinished && (
          <>
            {/* Tinter-type toggle (mirrors UI §49 active-style: gray-900) */}
            <div className="mb-[14px]">
              <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Tinter type<span className="text-red-600 ml-0.5">*</span>
              </label>
              <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
                {(["TINTER", "ACOTONE"] as const).map((t) => {
                  const active = tinterType === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleTinterTypeChange(t)}
                      disabled={submitting}
                      className={cn(
                        "h-[34px] px-3.5 text-[12px] font-medium",
                        active
                          ? "bg-gray-900 text-white"
                          : "bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-900",
                      )}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Colour multi-select grid (7 cols, shared pigment tokens) */}
            <div className="mb-[14px]">
              <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Out-of-stock colours<span className="text-red-600 ml-0.5">*</span>
                <span className="ml-1 font-normal normal-case tracking-normal text-gray-400">
                  — pick one or more
                </span>
              </label>
              <div className="grid grid-cols-7 gap-1.5">
                {palette.map(([code, c]) => {
                  const selected = selectedColours.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleColour(code)}
                      disabled={submitting}
                      className={cn(
                        "relative text-center rounded-md transition-colors",
                        "border border-gray-200",
                        selected ? "border-gray-900" : "hover:bg-gray-50",
                      )}
                      style={{
                        background:    selected ? c.bgFill : "#ffffff",
                        borderTopColor: c.top,
                        borderTopWidth: 3,
                        paddingTop:    6,
                        paddingBottom: 4,
                        paddingLeft:   4,
                        paddingRight:  4,
                      }}
                    >
                      {selected && (
                        <span
                          aria-hidden="true"
                          className="absolute top-[2px] right-[2px] w-3 h-3 bg-gray-900 text-white rounded-full inline-flex items-center justify-center"
                        >
                          <Check size={8} strokeWidth={3} />
                        </span>
                      )}
                      <span
                        className="block text-[9px] font-semibold tracking-wider"
                        style={{ color: selected ? "#111827" : "#374151" }}
                      >
                        {code}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="text-[11px] text-gray-400 mt-1.5">
                {selectedColours.length} selected
              </div>
            </div>
          </>
        )}

        {/* Remark (always shown, optional) */}
        <div className="mb-[14px]">
          <label
            htmlFor="skip-job-remark"
            className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5"
          >
            Remark
            <span className="ml-1 font-normal normal-case tracking-normal text-gray-400">
              — optional
            </span>
          </label>
          <textarea
            id="skip-job-remark"
            value={remark}
            onChange={(e) => {
              setRemark(e.target.value.slice(0, 500));
              if (errorMessage) setErrorMessage(null);
            }}
            placeholder="Anything else worth noting…"
            disabled={submitting}
            className="w-full min-h-[64px] px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none resize-y focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <div className={cn("text-[11px] mt-1", charCountColor)}>
            {remarkLen} / 500
          </div>
        </div>

        {/* Info box (always shown) */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 mb-4 flex items-start gap-2.5">
          <Info className="text-amber-700 flex-shrink-0 mt-0.5" size={14} />
          <div className="text-[12px] text-amber-800 leading-relaxed">
            This job will return to the Tint Manager. They can re-assign it to you
            or another operator once the issue is resolved.
          </div>
        </div>

        {/* Error banner */}
        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 text-[12px] text-red-700">
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
          {/* Modal CTA — bg-gray-900 per UI §13. */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!valid || submitting}
            className={cn(
              "h-9 px-3.5 text-[13px] font-medium rounded-lg inline-flex items-center gap-1.5",
              valid && !submitting
                ? "bg-gray-900 hover:bg-gray-800 text-white"
                : "bg-gray-300 text-white cursor-not-allowed",
            )}
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin" size={14} />
                Skipping…
              </>
            ) : (
              "Skip Job"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
