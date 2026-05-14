"use client";

import { useState } from "react";
import { formatIstWeekdayDate } from "@/lib/attendance/format";
import type { PendingRow } from "./ot-pending-table";

const NOTE_MAX_LEN = 500; // matches MAX_ADMIN_NOTE_CHARS in the API route

interface OtRejectModalProps {
  row: PendingRow;
  onClose(): void;
  onSuccess(recordId: number): void;
  onStaleClose(): void;
}

// Reject modal.
//
// API contract: PATCH /api/admin/attendance/ot-pending/[recordId]
// Body: { action: "reject", note?: string | null }. Empty/whitespace
// note is normalised to null server-side; we send null explicitly so
// the wire body is always one of the two clean shapes.
//
// Q4 policy banner: rejecting does NOT refund the monthly grace
// counter — surfaced inline so admins can't miss it before clicking.
export function OtRejectModal({
  row,
  onClose,
  onSuccess,
  onStaleClose,
}: OtRejectModalProps) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const charCount = note.length;
  const counterClass = charCount > 480 ? "text-amber-600" : "text-gray-400";

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const trimmed = note.trim();
    try {
      const res = await fetch(
        `/api/admin/attendance/ot-pending/${row.recordId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "reject",
            note: trimmed.length > 0 ? trimmed : null,
          }),
        },
      );
      if (res.ok) {
        onSuccess(row.recordId);
        return;
      }
      let serverMsg = `Server error (${res.status})`;
      try {
        const data = await res.json();
        if (typeof data?.error === "string") serverMsg = data.error;
      } catch {
        // non-JSON body — keep generic message
      }
      if (res.status === 409) {
        setError("Already actioned. Closing…");
        setTimeout(() => onStaleClose(), 800);
        return;
      }
      setError(serverMsg);
      setSubmitting(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Network error. Please check your connection and try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ot-reject-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="ot-reject-title"
          className="text-[16px] font-semibold text-gray-900 mb-4"
        >
          Reject OT claim
        </h3>
        <dl className="space-y-1.5 mb-4 text-[13px]">
          <DetailRow
            label="User"
            value={`${row.userName} · ${formatRoleSlug(row.userRole)}`}
          />
          <DetailRow
            label="Date"
            value={formatIstWeekdayDate(row.attendanceDate)}
          />
        </dl>
        {row.otClaimReason && (
          <div className="bg-gray-50 border border-gray-200 rounded-md p-3 mb-4">
            <p className="text-[13px] italic text-gray-700 leading-snug">
              &ldquo;{row.otClaimReason}&rdquo;
            </p>
          </div>
        )}
        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 mb-4 flex items-start gap-2">
          <span
            className="text-amber-600 text-[14px] leading-none mt-px"
            aria-hidden
          >
            ⚠
          </span>
          <p className="text-[12px] text-amber-800 leading-snug">
            Rejected days still consume this user&apos;s monthly grace (Q4
            policy).
          </p>
        </div>
        <label
          htmlFor="ot-reject-note"
          className="block text-[12px] font-medium text-gray-700 mb-1"
        >
          Note (optional, visible in audit only)
        </label>
        <textarea
          id="ot-reject-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={NOTE_MAX_LEN}
          rows={3}
          placeholder="Why this OT isn't being credited"
          disabled={submitting}
          className="w-full border border-gray-300 rounded-md p-3 text-[13px] text-gray-900 placeholder-gray-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 focus:outline-none resize-none disabled:opacity-50 mb-1"
        />
        <div className="flex justify-end mb-4">
          <span className={`text-[12px] tabular-nums ${counterClass}`}>
            {charCount} / {NOTE_MAX_LEN}
          </span>
        </div>
        {error && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-4 text-[12.5px] text-red-700"
          >
            {error}
          </div>
        )}
        <div className="flex justify-end items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-9 px-4 text-[13px] text-gray-500 hover:text-gray-900 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="h-9 px-4 bg-red-600 hover:bg-red-700 text-white text-[13px] font-semibold rounded-md disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Confirm reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 font-medium tabular-nums text-right">{value}</dd>
    </div>
  );
}

function formatRoleSlug(slug: string): string {
  if (!slug) return "—";
  return slug
    .split(/[\s_]+/)
    .map((w) =>
      w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w,
    )
    .join(" ");
}
