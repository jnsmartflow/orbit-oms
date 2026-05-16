"use client";

import { useEffect, useState } from "react";
import { X, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RestoreObdModalProps {
  open:       boolean;
  onClose:    () => void;
  onRestored: () => void;
  row: {
    id:                 number;
    obdNumber:          string;
    shipToCustomerName: string | null;
    removalReason:      string | null;
    removalRemark:      string | null;
    removedAt:          string;
    removedBy:          { id?: number; name: string } | null;
    challan:            { challanNumber: string; isVoided: boolean } | null;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function reasonLabel(reason: string | null): string {
  if (!reason) return "—";
  if (reason === "CUSTOMER_CANCELLED") return "Customer cancelled";
  if (reason === "WRONG_ORDER")        return "Wrong order";
  return reason;
}

function formatIstDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const dateStr = d.toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
  });
  const timeStr = d.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
  return `${dateStr}, ${timeStr} IST`;
}

// ── Component ────────────────────────────────────────────────────────────────

export function RestoreObdModal({
  open,
  onClose,
  onRestored,
  row,
}: RestoreObdModalProps): React.JSX.Element | null {
  const [remark,       setRemark]       = useState("");
  const [submitting,   setSubmitting]   = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset state on open
  useEffect(() => {
    if (!open) return;
    setRemark("");
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

  const remarkLen = remark.length;
  const charCountColor =
    remarkLen >= 500 ? "text-red-600"   :
    remarkLen >= 450 ? "text-amber-600" :
                       "text-gray-400";

  async function handleSubmit(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const trimmed = remark.trim();
      const res = await fetch(`/api/admin/removed-orders/${row.id}/restore`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify(trimmed ? { remark: trimmed } : {}),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || (json as { ok?: boolean }).ok === false) {
        const errRaw = (json as { error?: unknown }).error;
        const errMsg = typeof errRaw === "string"
          ? errRaw
          : "Could not restore OBD. Please try again.";
        setErrorMessage(errMsg);
        return;
      }
      toast.success(`OBD ${row.obdNumber} restored`);
      onRestored();
      onClose();
    } catch (err) {
      console.error("[restore-obd] submit failed", err);
      setErrorMessage("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={() => { if (!submitting) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-obd-title"
        className="bg-white rounded-xl shadow-xl w-[460px] p-[22px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-[14px]">
          <h3 id="restore-obd-title" className="text-[16px] font-semibold text-gray-900">
            Restore OBD
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

        {/* Removal summary */}
        <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5 mb-[14px]">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-gray-900 font-medium">
              {row.obdNumber}
            </span>
            <span className="text-gray-400 text-[11px]">·</span>
            <span className="text-[11px] text-gray-600">
              {formatIstDateTime(row.removedAt)}
            </span>
          </div>
          <div className="text-[12px] text-gray-900 font-medium mt-1">
            {row.shipToCustomerName ?? "—"}
          </div>
          <div className="text-[11px] text-gray-500 mt-1 leading-relaxed">
            <span className="font-medium text-gray-600">Removed by:</span>{" "}
            {row.removedBy?.name ?? "—"}
            {" · "}
            <span className="font-medium text-gray-600">Reason:</span>{" "}
            {reasonLabel(row.removalReason)}
          </div>
          {row.removalRemark && (
            <div className="text-[11px] text-gray-500 mt-1 leading-relaxed">
              <span className="font-medium text-gray-600">Remark:</span>{" "}
              {row.removalRemark}
            </div>
          )}
        </div>

        {/* Optional restoration remark */}
        <div className="mb-3">
          <label
            htmlFor="restore-obd-remark"
            className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5"
          >
            Restoration note (optional)
          </label>
          <textarea
            id="restore-obd-remark"
            value={remark}
            onChange={(e) => {
              setRemark(e.target.value.slice(0, 500));
              if (errorMessage) setErrorMessage(null);
            }}
            placeholder="Why are you restoring this OBD?"
            disabled={submitting}
            className="w-full min-h-[68px] px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none resize-y focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <div className={`text-[11px] mt-1 ${charCountColor}`}>
            {remarkLen} / 500
          </div>
        </div>

        {/* Info box — blue (informational, NOT a warning) */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 mb-4 flex items-start gap-2.5">
          <Info className="text-blue-700 flex-shrink-0 mt-0.5" size={15} />
          <div className="text-[12px] text-blue-900 leading-relaxed">
            <div>The OBD will reappear in its previous workflow stage.</div>
            {row.challan && (
              <div className="mt-0.5">
                Linked challan <span className="font-mono">{row.challan.challanNumber}</span> will also be restored to active.
              </div>
            )}
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
          {/* Modal CTA — bg-gray-900 per CLAUDE_UI.md §13 (modals never use teal/green). */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className={`h-9 px-3.5 text-[13px] font-medium rounded-lg inline-flex items-center gap-1.5 ${
              submitting
                ? "bg-gray-300 text-white cursor-not-allowed"
                : "bg-gray-900 hover:bg-gray-800 text-white"
            }`}
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin" size={14} />
                Restoring…
              </>
            ) : (
              "Restore OBD"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
