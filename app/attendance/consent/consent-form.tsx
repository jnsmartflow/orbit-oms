"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Camera, MapPin, ShieldCheck } from "lucide-react";

interface ConsentFormProps {
  consentVersion: string;
}

export function ConsentForm({ consentVersion }: ConsentFormProps) {
  const router = useRouter();
  const { update } = useSession();
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showDeclineDialog, setShowDeclineDialog] = useState(false);

  async function handleAccept() {
    if (!checked || submitting) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/attendance/consent", { method: "POST" });
      if (!res.ok) {
        let msg = "Failed to record consent. Please try again.";
        try {
          const data = await res.json();
          if (typeof data?.error === "string") msg = data.error;
        } catch {
          // response wasn't JSON — keep default message
        }
        setErrorMsg(msg);
        setSubmitting(false);
        return;
      }
      // Trigger Node-side jwt callback's `trigger === "update"` branch
      // so the new attendanceConsentVersion lands in the JWT before we
      // navigate. Page-level fresh DB reads guard against any race.
      await update();
      router.push("/attendance");
    } catch {
      setErrorMsg("Network error. Please check your connection and try again.");
      setSubmitting(false);
    }
  }

  function handleDeclineConfirm() {
    signOut({ callbackUrl: "/login" });
  }

  return (
    <div>
      {/* Header — orbit logo (only teal, beside Accept CTA) */}
      <header className="flex items-center gap-2.5 mb-5">
        <div className="w-9 h-9 bg-teal-600 rounded-xl flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="7" stroke="white" strokeWidth="1.6" />
            <circle cx="11" cy="11" r="2.2" fill="white" />
            <circle cx="18" cy="11" r="2" fill="white" />
          </svg>
        </div>
        <div>
          <p className="text-[15px] font-bold text-gray-900 leading-tight">OrbitOMS</p>
          <p className="text-[11px] text-gray-500 leading-tight">Privacy & Consent</p>
        </div>
      </header>

      {/* Lede */}
      <p className="text-[15px] text-gray-700 mb-5 leading-relaxed">
        To check in, OrbitOMS captures a selfie and your location. Your data stays in India and is never shared.
      </p>

      {/* Three info cards */}
      <div className="space-y-3 mb-5">
        <InfoCard
          icon={<Camera className="w-5 h-5" />}
          title="Photo"
          body="A selfie at every check-in & check-out. Stored 90 days, then auto-deleted. Visible to you and admin only."
        />
        <InfoCard
          icon={<MapPin className="w-5 h-5" />}
          title="Location"
          body="GPS confirms you're at the depot. Coordinates stored with the record. Never shared with any third party."
        />
        <InfoCard
          icon={<ShieldCheck className="w-5 h-5" />}
          title="Your rights"
          body="DPDP Act 2023 compliant. Request deletion via admin anytime. Withdraw consent and check-in stops working."
        />
      </div>

      {/* Consent checkbox */}
      <label className="flex items-start gap-3 mb-4 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          disabled={submitting}
          className="mt-0.5 w-5 h-5 shrink-0 rounded border-gray-300 accent-teal-600 cursor-pointer disabled:cursor-not-allowed"
        />
        <span className="text-[15px] text-gray-800 leading-snug">
          I have read and consent to the photo + location capture described above.
        </span>
      </label>

      {/* Inline error block */}
      {errorMsg && (
        <div
          role="alert"
          className="mb-3 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-[13px] text-red-700"
        >
          {errorMsg}
        </div>
      )}

      {/* Accept CTA — only teal element on the page */}
      <button
        type="button"
        onClick={handleAccept}
        disabled={!checked || submitting}
        className="w-full h-[60px] rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[16px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-teal-600"
      >
        {submitting ? "Recording…" : "Accept & Continue"}
      </button>

      {/* Decline link */}
      <button
        type="button"
        onClick={() => setShowDeclineDialog(true)}
        disabled={submitting}
        className="w-full mt-3 h-12 text-[14px] text-gray-500 hover:text-gray-700 disabled:opacity-50"
      >
        Decline
      </button>

      {/* Version note */}
      <p className="text-center text-[10px] text-gray-400 mt-5">Consent version {consentVersion}</p>

      {/* Decline confirm dialog */}
      {showDeclineDialog && (
        <DeclineDialog onConfirm={handleDeclineConfirm} onCancel={() => setShowDeclineDialog(false)} />
      )}
    </div>
  );
}

function InfoCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3 p-3 bg-white border border-gray-200 rounded-lg">
      <div className="w-10 h-10 shrink-0 rounded-lg bg-gray-100 flex items-center justify-center text-gray-600">
        {icon}
      </div>
      <div>
        <p className="text-[14px] font-semibold text-gray-900 mb-0.5">{title}</p>
        <p className="text-[13px] text-gray-600 leading-snug">{body}</p>
      </div>
    </div>
  );
}

function DeclineDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="decline-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[400px] bg-white rounded-lg shadow-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="decline-dialog-title" className="text-[15px] font-semibold text-gray-900 mb-2">
          Decline consent?
        </h3>
        <p className="text-[13px] text-gray-600 leading-relaxed mb-4">
          Check-in is required to use OrbitOMS. Declining will sign you out.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="h-12 px-4 rounded-lg border border-gray-200 text-[14px] text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-12 px-4 rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-[14px] font-semibold"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
