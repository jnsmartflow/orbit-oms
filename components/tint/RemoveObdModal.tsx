"use client";

import { useEffect, useState } from "react";
import { X, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

type ReasonValue = "" | "CUSTOMER_CANCELLED" | "WRONG_ORDER";

const REASON_OPTIONS: Array<{ value: Exclude<ReasonValue, "">; label: string }> = [
  { value: "CUSTOMER_CANCELLED", label: "Customer cancelled" },
  { value: "WRONG_ORDER",        label: "Wrong order" },
];

export interface RemoveObdModalProps {
  open:      boolean;
  onClose:   () => void;
  onRemoved: () => void;
  order: {
    id:                 number;
    obdNumber:          string;
    /** ISO string or null. Rendered via the local formatOrderDateTime helper. */
    orderDateTime:      string | null;
    shipToCustomerName: string | null;
    smu:                string | null;
    /** Article summary string, e.g. "6 Tin, 2 Drum". Matches what TM displays elsewhere. */
    articleTag:         string | null;
    /** Litres, from order.querySnapshot.totalVolume. */
    totalVolume:        number | null;
    /** When null, no challan warning is shown. Phase 2d caller may pass null; */
    /** server still voids the linked challan on remove. */
    challan:            { challanNumber: string; isVoided: boolean } | null;
  };
}

// ── Local helpers ────────────────────────────────────────────────────────────

/** Mirrors tint-manager-content.tsx:235 — IST-aware date + time formatting. */
function formatOrderDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", timeZone: "Asia/Kolkata",
  });
  const timeStr = d.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
  return `${dateStr}, ${timeStr}`;
}

// ── Component ────────────────────────────────────────────────────────────────

export function RemoveObdModal({
  open,
  onClose,
  onRemoved,
  order,
}: RemoveObdModalProps): React.JSX.Element | null {
  const [reason,       setReason]       = useState<ReasonValue>("");
  const [remark,       setRemark]       = useState("");
  const [submitting,   setSubmitting]   = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset state on open
  useEffect(() => {
    if (!open) return;
    setReason("");
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

  // ── Validation (live) ──────────────────────────────────────────────────────
  const trimmedRemark = remark.trim();
  const remarkLen     = remark.length;
  const reasonValid   = reason !== "";
  const remarkValid   = trimmedRemark.length >= 1 && remarkLen <= 500;
  const valid         = reasonValid && remarkValid;

  // Show challan warning only when a linked active challan exists.
  const showChallanWarning = order.challan !== null && !order.challan.isVoided;

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(): Promise<void> {
    if (!valid || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/tint/manager/orders/${order.id}/remove`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ reason, remark: trimmedRemark }),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || (json as { ok?: boolean }).ok === false) {
        const errRaw = (json as { error?: unknown }).error;
        const errMsg = typeof errRaw === "string"
          ? errRaw
          : "Could not remove OBD. Please try again.";
        setErrorMessage(errMsg);
        return;
      }
      toast.success(`OBD ${order.obdNumber} removed`);
      onRemoved();
      onClose();
    } catch (err) {
      console.error("[remove-obd] submit failed", err);
      setErrorMessage("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Char counter colour: gray < 450, amber 450..499, red at 500.
  const charCountColor =
    remarkLen >= 500 ? "text-red-600"   :
    remarkLen >= 450 ? "text-amber-600" :
                       "text-gray-400";

  const customerName = order.shipToCustomerName ?? "—";
  const summaryParts = [
    order.smu ?? null,
    order.articleTag ?? null,
    typeof order.totalVolume === "number" ? `${order.totalVolume}L` : null,
  ].filter((s): s is string => s !== null && s !== "");
  const summaryLine = summaryParts.join(" · ");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={() => { if (!submitting) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-obd-title"
        className="bg-white rounded-xl shadow-xl w-[460px] p-[22px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-[14px]">
          <h3 id="remove-obd-title" className="text-[16px] font-semibold text-gray-900">
            Remove OBD
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

        {/* OBD summary */}
        <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5 mb-[14px]">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-gray-900 font-medium">
              {order.obdNumber}
            </span>
            {formatOrderDateTime(order.orderDateTime) && (
              <>
                <span className="text-gray-400 text-[11px]">·</span>
                <span className="text-[11px] text-gray-600">
                  {formatOrderDateTime(order.orderDateTime)}
                </span>
              </>
            )}
          </div>
          <div className="text-[12px] text-gray-900 font-medium mt-1">{customerName}</div>
          {summaryLine && (
            <div className="text-[11px] text-gray-500 mt-0.5">{summaryLine}</div>
          )}
        </div>

        {/* Reason */}
        <div className="mb-3">
          <label
            htmlFor="remove-obd-reason"
            className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5"
          >
            Reason<span className="text-red-600 ml-0.5">*</span>
          </label>
          <select
            id="remove-obd-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as ReasonValue);
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

        {/* Remark */}
        <div className="mb-3">
          <label
            htmlFor="remove-obd-remark"
            className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5"
          >
            Remark<span className="text-red-600 ml-0.5">*</span>
          </label>
          <textarea
            id="remove-obd-remark"
            value={remark}
            onChange={(e) => {
              // Hard-cap at 500 — keeps state aligned with server validation.
              setRemark(e.target.value.slice(0, 500));
              if (errorMessage) setErrorMessage(null);
            }}
            placeholder="Write a short note explaining why…"
            disabled={submitting}
            className="w-full min-h-[76px] px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none resize-y focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <div className={`text-[11px] mt-1 ${charCountColor}`}>
            {remarkLen} / 500
          </div>
        </div>

        {/* Challan-void warning (only when a linked active challan exists) */}
        {showChallanWarning && order.challan && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mb-4 flex items-start gap-2.5">
            <AlertTriangle className="text-red-700 flex-shrink-0 mt-0.5" size={15} />
            <div className="text-[12px] text-red-900">
              <div className="font-medium">Linked challan will be voided.</div>
              <div className="text-red-700 mt-0.5">
                Challan <span className="font-mono">{order.challan.challanNumber}</span> will be marked voided. Print &amp; PDF disabled. Number stays reserved.
              </div>
            </div>
          </div>
        )}

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
          {/* Modal CTA — bg-gray-900 per CLAUDE_UI.md §13 (modals never use teal/red CTAs). */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!valid || submitting}
            className={`h-9 px-3.5 text-[13px] font-medium rounded-lg inline-flex items-center gap-1.5 ${
              valid && !submitting
                ? "bg-gray-900 hover:bg-gray-800 text-white"
                : "bg-gray-300 text-white cursor-not-allowed"
            }`}
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin" size={14} />
                Removing…
              </>
            ) : (
              "Remove OBD"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
