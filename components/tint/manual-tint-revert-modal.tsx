"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type RevertReasonCode = "classification_miss" | "other";

const REVERT_REASON_OPTIONS: Array<{ value: RevertReasonCode; label: string }> = [
  { value: "classification_miss", label: "Auto-classification Miss" },
  { value: "other",               label: "Other" },
];

const REVERT_ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND:             "Order not found.",
  NOT_MANUAL:            "This order was not pulled in manually.",
  ALREADY_PROGRESSED:    "Order has already moved past pending — cannot revert.",
  ALREADY_ASSIGNED:      "Order has already been assigned to an operator — cannot revert.",
  TI_ALREADY_RECORDED:   "Tinter Issue entries already recorded — cannot revert.",
  ALREADY_SPLIT:         "Order has been split — cannot revert.",
  PULL_RECORD_MISSING:   "Original pull record missing. Contact support.",
  INVALID_REASON:        "Please select a valid reason.",
  REASON_NOTES_REQUIRED: "Notes are required when reason is \"Other\".",
  BAD_REQUEST:           "Invalid request. Please reload and try again.",
  INTERNAL_ERROR:        "Server error. Please try again.",
};

function errorMessageFor(code?: string): string {
  if (!code) return "Could not complete revert. Please try again.";
  return REVERT_ERROR_MESSAGES[code] ?? "Could not complete revert. Please try again.";
}

// ── Component ───────────────────────────────────────────────────────────────

export interface ManualTintRevertModalProps {
  open:       boolean;
  onClose:    () => void;
  onSuccess?: (obdNumber: string) => void;
  orderId:    number | null;
  obdNumber:  string | null;
}

export function ManualTintRevertModal({
  open,
  onClose,
  onSuccess,
  orderId,
  obdNumber,
}: ManualTintRevertModalProps) {
  const [reasonCode,    setReasonCode]    = useState<RevertReasonCode>("classification_miss");
  const [reasonNotes,   setReasonNotes]   = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError,   setSubmitError]   = useState<string | null>(null);

  // Reset state on open
  useEffect(() => {
    if (!open) return;
    setReasonCode("classification_miss");
    setReasonNotes("");
    setSubmitLoading(false);
    setSubmitError(null);
  }, [open]);

  // Esc closes (blocked while submitting)
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (submitLoading) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, submitLoading, onClose]);

  if (!open || orderId == null) return null;

  const trimmedNotes    = reasonNotes.trim();
  const otherNeedsNotes = reasonCode === "other" && trimmedNotes.length === 0;
  const submitEnabled   = !submitLoading && !otherNeedsNotes;
  const notesInvalid    = otherNeedsNotes;

  async function handleSubmit() {
    if (!submitEnabled) return;
    setSubmitLoading(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/tint/manager/manual-entry/revert", {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          reasonCode,
          reasonNotes: trimmedNotes.length > 0 ? trimmedNotes : undefined,
        }),
      });
      const json = (await res.json()) as
        | { ok: true;  order: { id: number; obdNumber: string; workflowStage: string } }
        | { ok: false; errorCode: string; message?: string };

      if (!json.ok) {
        setSubmitError(errorMessageFor(json.errorCode));
        return;
      }

      onSuccess?.(json.order.obdNumber);
      onClose();
    } catch (e) {
      console.error("[manual-tint-revert] submit failed", e);
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={() => { if (!submitLoading) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-tint-revert-title"
        className="bg-white rounded-lg shadow-xl w-[400px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2
            id="manual-tint-revert-title"
            className="text-[13px] font-semibold text-gray-900"
          >
            Remove from Tint Workflow
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          {submitError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-[12px] px-3 py-2 rounded mb-3">
              {submitError}
            </div>
          )}

          <p className="text-[12.5px] text-gray-700 mb-3">
            Remove OBD <span className="font-mono text-gray-900">{obdNumber}</span> from tint?
            This sends it back to the support queue.
          </p>

          <label
            htmlFor="manual-tint-revert-reason"
            className="block text-[11px] font-medium text-gray-500 mb-1"
          >
            Reason
          </label>
          <select
            id="manual-tint-revert-reason"
            value={reasonCode}
            onChange={(e) => {
              setReasonCode(e.target.value as RevertReasonCode);
              if (submitError) setSubmitError(null);
            }}
            className="w-full h-[38px] px-3 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 mb-3 bg-white"
          >
            {REVERT_REASON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <label
            htmlFor="manual-tint-revert-notes"
            className="block text-[11px] font-medium text-gray-500 mb-1"
          >
            {reasonCode === "other" ? (
              <>Notes <span className="text-red-600">*</span></>
            ) : (
              "Notes (optional)"
            )}
          </label>
          <textarea
            id="manual-tint-revert-notes"
            value={reasonNotes}
            onChange={(e) => setReasonNotes(e.target.value)}
            rows={2}
            placeholder={
              reasonCode === "other"
                ? "Required when reason is Other"
                : "Add context (optional)"
            }
            className={`w-full px-3 py-2 text-[13px] border rounded-lg outline-none ${
              notesInvalid
                ? "border-red-300 ring-2 ring-red-500/10"
                : "border-gray-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
            }`}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/30 rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            disabled={submitLoading}
            className="h-[34px] px-3 text-[12px] text-gray-600 hover:text-gray-900 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          {/* Destructive confirm — diverges from CLAUDE_UI.md §13 (gray-900) intentionally. */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!submitEnabled}
            className={`h-[34px] px-4 text-[12px] font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg inline-flex items-center gap-1.5 ${
              submitEnabled ? "" : "cursor-not-allowed opacity-60"
            }`}
          >
            {submitLoading ? (
              <>
                <Loader2 className="animate-spin" size={14} />
                Removing…
              </>
            ) : (
              "Remove from Tint"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
