"use client";

import { useEffect, useState } from "react";
import { X, Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// Hide this OBD — admin-only manual hide. Mirrors RemoveObdModal's shape/flow.
// Matches docs/mockups/settings/obd-hide-mockup.html (S6 "Manual hide").
// POST /api/admin/hide/orders/{id}/hide { reason }. Server re-enforces admin.
// ─────────────────────────────────────────────────────────────────────────────

export interface HideObdModalProps {
  open:      boolean;
  onClose:   () => void;
  onHidden:  () => void;
  order: {
    id:       number;
    obdNumber: string;
    siteName:  string | null;
  };
}

export function HideObdModal({
  open,
  onClose,
  onHidden,
  order,
}: HideObdModalProps): React.JSX.Element | null {
  const [reason,       setReason]       = useState("");
  const [submitting,   setSubmitting]   = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset state on open
  useEffect(() => {
    if (!open) return;
    setReason("");
    setSubmitting(false);
    setErrorMessage(null);
  }, [open]);

  // Esc closes (blocked while submitting)
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

  if (!open) return null;

  const trimmed     = reason.trim();
  const reasonLen   = reason.length;
  const valid       = trimmed.length >= 1 && reasonLen <= 500;
  const charCountColor =
    reasonLen >= 500 ? "text-red-600"   :
    reasonLen >= 450 ? "text-amber-600" :
                       "text-gray-400";

  async function handleSubmit(): Promise<void> {
    if (!valid || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/admin/hide/orders/${order.id}/hide`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ reason: trimmed }),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || (json as { ok?: boolean }).ok === false) {
        const errRaw = (json as { error?: unknown }).error;
        const errMsg = typeof errRaw === "string"
          ? errRaw
          : "Could not hide OBD. Please try again.";
        setErrorMessage(errMsg);
        return;
      }
      toast.success(`OBD ${order.obdNumber} hidden`);
      onHidden();
      onClose();
    } catch (err) {
      console.error("[hide-obd] submit failed", err);
      setErrorMessage("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const siteName = order.siteName ?? "—";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={() => { if (!submitting) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hide-obd-title"
        className="bg-white rounded-xl shadow-xl w-[440px] max-w-[92vw] p-[22px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-[14px]">
          <div>
            <h3 id="hide-obd-title" className="text-[16px] font-semibold text-gray-900">
              Hide this OBD
            </h3>
            <p className="text-[11px] text-gray-400 mt-1 flex items-center gap-1.5">
              <span className="font-mono text-gray-600">{order.obdNumber}</span>
              <span>·</span>
              <span>{siteName}</span>
            </p>
          </div>
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

        {/* Info line */}
        <div className="flex items-start gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 mb-[14px] text-[11.5px] text-gray-600 leading-relaxed">
          <Globe size={14} className="text-gray-400 flex-shrink-0 mt-0.5" />
          <span>
            This OBD will disappear from all screens. Find it again any time in{" "}
            <b>Settings › Hide › Hidden Orders</b>.
          </span>
        </div>

        {/* Reason */}
        <div className="mb-4">
          <label
            htmlFor="hide-obd-reason"
            className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5"
          >
            Reason<span className="text-red-600 ml-0.5">*</span>{" "}
            <span className="normal-case text-gray-400 font-normal">(saved to the log)</span>
          </label>
          <textarea
            id="hide-obd-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value.slice(0, 500));
              if (errorMessage) setErrorMessage(null);
            }}
            placeholder="Why are you hiding this OBD?"
            disabled={submitting}
            className="w-full min-h-[76px] px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none resize-y focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <div className={`text-[11px] mt-1 ${charCountColor}`}>
            {reasonLen} / 500
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
          {/* CTA — teal here to match the approved Hide mockup ("Hide OBD"). */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!valid || submitting}
            className={`h-9 px-3.5 text-[13px] font-medium rounded-lg inline-flex items-center gap-1.5 ${
              valid && !submitting
                ? "bg-teal-600 hover:bg-teal-700 text-white"
                : "bg-gray-300 text-white cursor-not-allowed"
            }`}
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin" size={14} />
                Hiding…
              </>
            ) : (
              "Hide OBD"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
