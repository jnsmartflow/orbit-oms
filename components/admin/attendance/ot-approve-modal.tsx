"use client";

import { useState } from "react";
import { formatIstWeekdayDate } from "@/lib/attendance/format";
import type { PendingRow } from "./ot-pending-table";

interface OtApproveModalProps {
  row: PendingRow;
  onClose(): void;
  onSuccess(recordId: number): void;
  onStaleClose(): void;
}

// Approve modal.
//
// API contract: PATCH /api/admin/attendance/ot-pending/[recordId]
// Body: { action: "approve" }. The backend RECOMPUTES credit from the
// live settings.otTriggerTime and applies that exact value — there is
// no `adjustedMinutes` parameter. The mockup's "credit override" input
// is intentionally NOT implemented here; surfacing one would mislead
// admins about what the backend actually does.
//
// 422 path: backend refuses approve when recomputed minutes = 0 (admin
// changed otTriggerTime past the check-out clock since submission).
// Surface the prescribed copy and let admin reject instead.
//
// 409 path: someone else already actioned this record. Show inline,
// then close + signal parent to refetch.
export function OtApproveModal({
  row,
  onClose,
  onSuccess,
  onStaleClose,
}: OtApproveModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/attendance/ot-pending/${row.recordId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve" }),
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
        // Brief delay so admin sees the message before the modal closes.
        setTimeout(() => onStaleClose(), 800);
        return;
      }
      if (res.status === 422) {
        setError(
          "Trigger time moved past check-out. Reject this claim instead.",
        );
        setSubmitting(false);
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
      aria-labelledby="ot-approve-title"
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
          id="ot-approve-title"
          className="text-[16px] font-semibold text-gray-900 mb-4"
        >
          Approve OT claim
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
          <DetailRow label="Raw OT" value={`${row.otMinutesRaw} min`} />
        </dl>
        {row.otClaimReason && (
          <div className="bg-gray-50 border border-gray-200 rounded-md p-3 mb-4">
            <p className="text-[13px] italic text-gray-700 leading-snug">
              &ldquo;{row.otClaimReason}&rdquo;
            </p>
          </div>
        )}
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
            className="h-9 px-4 bg-teal-600 hover:bg-teal-700 text-white text-[13px] font-semibold rounded-md disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Confirm approve"}
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
